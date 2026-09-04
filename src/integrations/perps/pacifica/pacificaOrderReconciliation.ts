import {
  PacificaApiError,
  pacificaGet,
  pacificaGetPage,
  type PacificaPage,
} from '@/integrations/perps/pacifica/pacificaApi';
import {
  readPendingPacificaCommand,
  removePendingPacificaCommand,
  type PendingPacificaCommand,
} from '@/integrations/perps/pacifica/pacificaCommandStorage';
import { recordClientTelemetry } from '@/integrations/observability/clientTelemetry';

const HISTORY_PAGE_SIZE = 100;
const MAX_HISTORY_PAGES = 10;
const HISTORY_VISIBILITY_GRACE_MS = 15_000;

export type PacificaOrderStatus =
  | 'open'
  | 'partially_filled'
  | 'filled'
  | 'cancelled'
  | 'rejected';

export type PacificaCommandReconciliation =
  | { readonly status: 'none' }
  | {
      readonly clientOrderId: string;
      readonly kind: 'create';
      readonly orderId: number;
      readonly orderStatus: PacificaOrderStatus;
      readonly status: 'resolved';
      readonly traceId: string;
    }
  | {
      readonly kind: 'cancel';
      readonly orderId: number;
      readonly orderStatus: PacificaOrderStatus;
      readonly status: 'resolved';
      readonly traceId: string;
    }
  | {
      readonly kind: 'create' | 'cancel';
      readonly status: 'pending';
      readonly traceId: string;
    }
  | {
      readonly kind: 'create';
      readonly status: 'review_required';
      readonly traceId: string;
    };

export type PacificaMarketSetting = {
  readonly leverage: number;
  readonly marginMode: 'cross' | 'isolated';
};

type OrderRecord = {
  readonly clientOrderId: string | null;
  readonly createdAtMs: number;
  readonly orderId: number;
  readonly orderStatus: PacificaOrderStatus;
};

export async function fetchPacificaMarketSetting(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly maxLeverage: number;
  readonly signal?: AbortSignal | undefined;
  readonly symbol: string;
}): Promise<PacificaMarketSetting> {
  const raw = await pacificaGet<unknown>({
    apiOrigin: input.apiOrigin,
    path: '/account/settings',
    query: { account: input.account },
    signal: input.signal,
  });
  const settings = object(raw, 'account settings');
  if (!Array.isArray(settings.margin_settings)) {
    throw new Error('Pacifica returned invalid account margin settings.');
  }
  const match = settings.margin_settings.find((candidate) => (
    isObject(candidate) && candidate.symbol === input.symbol
  ));
  if (match === undefined) {
    return { leverage: input.maxLeverage, marginMode: 'cross' };
  }
  const value = object(match, 'market margin setting');
  const leverage = positiveInteger(value.leverage, 'market leverage');
  if (leverage > input.maxLeverage) {
    throw new Error('Pacifica returned leverage above the market maximum.');
  }
  if (typeof value.isolated !== 'boolean') {
    throw new Error('Pacifica returned invalid market margin mode.');
  }
  return { leverage, marginMode: value.isolated ? 'isolated' : 'cross' };
}

export async function reconcilePendingPacificaCommand(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly signal?: AbortSignal | undefined;
}): Promise<PacificaCommandReconciliation> {
  const command = await readPendingPacificaCommand(input.account);
  if (command === null) return { status: 'none' };
  const startedAt = performance.now();
  try {
    const result = command.kind === 'create'
      ? await reconcileCreate(input.apiOrigin, command, input.signal)
      : await reconcileCancel(input.apiOrigin, command, input.signal);
    recordClientTelemetry({
      durationMs: performance.now() - startedAt,
      operation: `trade.pacifica.${command.kind}.reconcile`,
      outcome: result.status === 'pending' ? 'unknown' : 'ok',
      traceId: command.traceId,
    });
    return result;
  } catch (cause) {
    recordClientTelemetry({
      durationMs: performance.now() - startedAt,
      errorCode: errorCode(cause),
      operation: `trade.pacifica.${command.kind}.reconcile`,
      outcome: input.signal?.aborted ? 'cancelled' : 'error',
      traceId: command.traceId,
    });
    throw cause;
  }
}

export function isAmbiguousPacificaFailure(cause: unknown): boolean {
  return !(cause instanceof PacificaApiError) || cause.status === 0 || cause.status >= 500;
}

async function reconcileCreate(
  apiOrigin: string,
  command: Extract<PendingPacificaCommand, { readonly kind: 'create' }>,
  signal?: AbortSignal,
): Promise<PacificaCommandReconciliation> {
  if (command.stage !== 'order_pending' && command.stage !== 'acknowledged') {
    await removePendingPacificaCommand(command.owner);
    return { kind: 'create', status: 'review_required', traceId: command.traceId };
  }

  const open = await fetchOpenOrders(apiOrigin, command.owner, signal);
  const openMatch = open.find((order) => order.clientOrderId === command.clientOrderId);
  if (openMatch !== undefined) {
    const resolved = createResolved(command, openMatch);
    await removePendingPacificaCommand(command.owner);
    return resolved;
  }

  if (command.stage === 'acknowledged') {
    const acknowledgedOrderId = command.orderId;
    if (acknowledgedOrderId === null) {
      throw new Error('Stored Pacifica acknowledgement is missing its order ID.');
    }
    const acknowledged = await fetchOrderHistoryById(apiOrigin, acknowledgedOrderId, signal);
    if (acknowledged === null) {
      return { kind: 'create', status: 'pending', traceId: command.traceId };
    }
    const resolved = createResolved(command, acknowledged);
    await removePendingPacificaCommand(command.owner);
    return resolved;
  }

  const history = await findOrderInHistory(apiOrigin, command, signal);
  if (history.match !== null) {
    const resolved = createResolved(command, history.match);
    await removePendingPacificaCommand(command.owner);
    return resolved;
  }
  if (history.authoritativeAbsence) {
    await removePendingPacificaCommand(command.owner);
    return { kind: 'create', status: 'review_required', traceId: command.traceId };
  }
  return { kind: 'create', status: 'pending', traceId: command.traceId };
}

async function reconcileCancel(
  apiOrigin: string,
  command: Extract<PendingPacificaCommand, { readonly kind: 'cancel' }>,
  signal?: AbortSignal,
): Promise<PacificaCommandReconciliation> {
  const latest = await fetchOrderHistoryById(apiOrigin, command.orderId, signal);
  if (latest !== null && (
    latest.orderId !== command.orderId ||
    (command.clientOrderId !== null && latest.clientOrderId !== command.clientOrderId)
  )) {
    throw new Error('Pacifica returned cancellation history for a different order.');
  }
  if (latest !== null && terminal(latest.orderStatus)) {
    await removePendingPacificaCommand(command.owner);
    return {
      kind: 'cancel',
      orderId: command.orderId,
      orderStatus: latest.orderStatus,
      status: 'resolved',
      traceId: command.traceId,
    };
  }
  if (Date.now() - command.attemptedAtMs >= HISTORY_VISIBILITY_GRACE_MS) {
    const open = await fetchOpenOrders(apiOrigin, command.owner, signal);
    const match = open.find((order) => order.orderId === command.orderId);
    if (match !== undefined) {
      if (command.clientOrderId !== null && match.clientOrderId !== command.clientOrderId) {
        throw new Error('Pacifica returned an open order with a different client order ID.');
      }
      await removePendingPacificaCommand(command.owner);
      return {
        kind: 'cancel',
        orderId: command.orderId,
        orderStatus: match.orderStatus,
        status: 'resolved',
        traceId: command.traceId,
      };
    }
  }
  return { kind: 'cancel', status: 'pending', traceId: command.traceId };
}

async function fetchOrderHistoryById(
  apiOrigin: string,
  orderId: number,
  signal?: AbortSignal,
): Promise<OrderRecord | null> {
  const raw = await pacificaGet<readonly unknown[]>({
    apiOrigin,
    path: '/orders/history_by_id',
    query: { order_id: String(orderId) },
    signal,
  });
  return parseOrders(raw, 'order history').reduce<OrderRecord | null>(
    (current, event) => current === null || event.createdAtMs > current.createdAtMs
      ? event
      : current,
    null,
  );
}

async function fetchOpenOrders(
  apiOrigin: string,
  account: string,
  signal?: AbortSignal,
): Promise<readonly OrderRecord[]> {
  const raw = await pacificaGet<readonly unknown[]>({
    apiOrigin,
    path: '/orders',
    query: { account },
    signal,
  });
  return parseOrders(raw, 'open orders', 'open');
}

async function findOrderInHistory(
  apiOrigin: string,
  command: Extract<PendingPacificaCommand, { readonly kind: 'create' }>,
  signal?: AbortSignal,
): Promise<{ readonly authoritativeAbsence: boolean; readonly match: OrderRecord | null }> {
  let cursor: string | null = null;
  for (let pageIndex = 0; pageIndex < MAX_HISTORY_PAGES; pageIndex += 1) {
    const page: PacificaPage<readonly unknown[]> = await pacificaGetPage<readonly unknown[]>({
      apiOrigin,
      path: '/orders/history',
      query: {
        account: command.owner,
        limit: String(HISTORY_PAGE_SIZE),
        ...(cursor === null ? {} : { cursor }),
      },
      signal,
    });
    const records = parseOrders(page.data, 'order history');
    const match = records.reduce<OrderRecord | null>(
      (latest, order) => order.clientOrderId !== command.clientOrderId
        ? latest
        : latest === null || order.createdAtMs > latest.createdAtMs
          ? order
          : latest,
      null,
    );
    if (match !== null) return { authoritativeAbsence: false, match };

    const graceElapsed = Date.now() - command.attemptedAtMs >= HISTORY_VISIBILITY_GRACE_MS;
    const reachedBeforeAttempt = records.some(
      (order) => order.createdAtMs < command.attemptedAtMs - HISTORY_VISIBILITY_GRACE_MS,
    );
    if (graceElapsed && (reachedBeforeAttempt || !page.hasMore)) {
      return { authoritativeAbsence: true, match: null };
    }
    if (!page.hasMore || page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return { authoritativeAbsence: false, match: null };
}

function createResolved(
  command: Extract<PendingPacificaCommand, { readonly kind: 'create' }>,
  order: OrderRecord,
): PacificaCommandReconciliation {
  if (command.orderId !== null && command.orderId !== order.orderId) {
    throw new Error('Pacifica returned an order that does not match its acknowledgement.');
  }
  if (order.clientOrderId !== command.clientOrderId) {
    throw new Error('Pacifica returned an order with a different client order ID.');
  }
  return {
    clientOrderId: command.clientOrderId,
    kind: 'create',
    orderId: order.orderId,
    orderStatus: order.orderStatus,
    status: 'resolved',
    traceId: command.traceId,
  };
}

function parseOrders(
  value: unknown,
  label: string,
  defaultStatus?: PacificaOrderStatus,
): readonly OrderRecord[] {
  if (!Array.isArray(value)) throw new Error(`Pacifica returned invalid ${label}.`);
  return value.map((entry) => {
    const order = object(entry, label);
    return {
      clientOrderId: nullableText(order.client_order_id, 'client order id'),
      createdAtMs: positiveInteger(order.created_at, 'order timestamp'),
      orderId: positiveInteger(order.order_id, 'order id'),
      orderStatus: defaultStatus === undefined
        ? orderStatus(order.order_status)
        : openOrderStatus(order.filled_amount),
    };
  });
}

function orderStatus(value: unknown): PacificaOrderStatus {
  if (
    value === 'open' || value === 'partially_filled' || value === 'filled' ||
    value === 'cancelled' || value === 'rejected'
  ) return value;
  throw new Error('Pacifica returned invalid order status.');
}

function openOrderStatus(value: unknown): PacificaOrderStatus {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/u.test(value)) {
    throw new Error('Pacifica returned invalid filled order amount.');
  }
  return /^0(?:\.0+)?$/u.test(value) ? 'open' : 'partially_filled';
}

function terminal(status: PacificaOrderStatus): boolean {
  return status === 'filled' || status === 'cancelled' || status === 'rejected';
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`Pacifica returned invalid ${label}.`);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new Error(`Pacifica returned invalid ${label}.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Pacifica returned invalid ${label}.`);
  }
  return parsed;
}

function errorCode(cause: unknown): string {
  return cause instanceof PacificaApiError ? cause.code : 'reconciliation_failed';
}
