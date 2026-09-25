import { parseAmount } from '@/domain/money/amount';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  fetchFreshPacificaAccount,
  type PacificaPortfolioSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  publishPacificaAccountSnapshot,
  readPacificaPortfolioSnapshot,
  refreshPacificaPortfolioSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolioStore';
import { reconcilePendingTradeAction } from '@/integrations/perps/tradeActionRecovery';
import {
  readPendingTradeAction,
  removePendingTradeAction,
  type PendingTradeAction,
} from '@/integrations/perps/tradeActionStorage';
import { readSubmittedTransactionStatus } from '@/integrations/solana/transactionConfirmation';
import { TransactionSigningError } from '@/integrations/solana/transactionSigningError';

const CREDIT_WAIT_MS = 90_000;
const CREDIT_POLL_MS = 1_500;

export type PacificaDepositSettlementStatus =
  | 'none'
  | 'chain-confirming'
  | 'indexing'
  | 'credited'
  | 'failed';

export type PacificaDepositLifecycleResult = {
  readonly fast: boolean;
  readonly signature: string | null;
  readonly status: PacificaDepositSettlementStatus;
};

/** Root-owned exact-byte recovery followed by provider-credit settlement. */
export async function recoverPacificaDepositLifecycle(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly portfolio: PacificaPortfolioSnapshot;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
}): Promise<PacificaDepositLifecycleResult> {
  const record = await readPendingTradeAction(input.account, 'pacifica');
  if (!isTrackedDeposit(record)) return { fast: false, signature: null, status: 'none' };
  const identity = {
    fast: record.kind === 'fast-collateral',
    signature: record.signature,
  };

  let chainConfirmed = false;
  try {
    const recovery = await reconcilePendingTradeAction({
      owner: input.account,
      provider: 'pacifica',
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (recovery === 'expired') return { ...identity, status: 'failed' };
    chainConfirmed = recovery === 'indexing';
  } catch (cause) {
    if (cause instanceof TransactionSigningError && (
      cause.code === 'transaction_failed' || cause.code === 'submission_rejected'
    )) return { ...identity, status: 'failed' };
    throw cause;
  }

  return {
    ...identity,
    status: await reconcilePacificaDepositSettlement({
      ...input,
      chainConfirmed,
    }),
  };
}

/**
 * Keeps a collateral deposit locked after Solana confirmation until Pacifica reflects its exact credit.
 *
 * Normal root polling already has a full portfolio snapshot. If it is still stale, settlement requests
 * only `/account` rather than repeating account + positions + orders, publishes those account fields
 * immediately, and refreshes the heavier lists once after credit.
 */
export async function reconcilePacificaDepositSettlement(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly chainConfirmed?: boolean;
  readonly portfolio?: PacificaPortfolioSnapshot;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
}): Promise<PacificaDepositSettlementStatus> {
  const record = await readPendingTradeAction(input.account, 'pacifica');
  if (!isTrackedDeposit(record)) return 'none';

  if (input.chainConfirmed !== true) {
    const chain = await readSubmittedTransactionStatus({
      rpcUrl: input.rpcUrl,
      signature: record.signature,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (chain === 'failed') {
      await removePendingTradeAction(input.account, 'pacifica');
      return 'failed';
    }
    if (chain !== 'confirmed') return 'chain-confirming';
  }

  if (input.portfolio !== undefined && creditReflected(record, input.portfolio)) {
    await finishCredit(record, input.account, input.apiOrigin);
    return 'credited';
  }

  const accountSnapshot = await fetchFreshPacificaAccount(
    input.apiOrigin,
    input.account,
    input.signal,
  );
  publishPacificaAccountSnapshot({
    account: input.account,
    apiOrigin: input.apiOrigin,
    snapshot: accountSnapshot,
  });
  if (!creditReflected(record, accountSnapshot)) return 'indexing';

  await finishCredit(record, input.account, input.apiOrigin);
  return 'credited';
}

/**
 * Lightweight foreground wait after a known chain confirmation.
 *
 * One Pacifica endpoint per pass, no repeated Solana status RPC and no repeated position/order reads.
 * The published account balance is enough to switch every market ticket to its trading form immediately.
 */
export async function waitForPacificaDepositCredit(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
}): Promise<{ readonly snapshot: PacificaPortfolioSnapshot | null; readonly status: 'credited' | 'indexing' }> {
  const deadline = Date.now() + CREDIT_WAIT_MS;
  let latest = readPacificaPortfolioSnapshot(input.apiOrigin, input.account).data;

  while (Date.now() < deadline && !isAborted(input.signal)) {
    try {
      const record = await readPendingTradeAction(input.account, 'pacifica');
      if (!isTrackedDeposit(record)) return { snapshot: latest, status: 'credited' };
      const accountSnapshot = await fetchFreshPacificaAccount(
        input.apiOrigin,
        input.account,
        input.signal,
      );
      latest = publishPacificaAccountSnapshot({
        account: input.account,
        apiOrigin: input.apiOrigin,
        snapshot: accountSnapshot,
      });
      if (creditReflected(record, accountSnapshot)) {
        await finishCredit(record, input.account, input.apiOrigin);
        return { snapshot: latest, status: 'credited' };
      }
    } catch {
      if (isAborted(input.signal)) break;
      // A transient provider read says nothing about whether credit landed. Keep the same durable lock
      // and try again rather than turning an indexing delay into a failed deposit.
    }
    await wait(CREDIT_POLL_MS, input.signal);
  }

  return { snapshot: latest, status: 'indexing' };
}

function isTrackedDeposit(record: PendingTradeAction | null): record is PendingTradeAction & {
  readonly expectedProviderCreditBaseUnits: string;
  readonly providerBalanceBeforeBaseUnits: string;
} {
  return record !== null &&
    (record.kind === 'collateral' || record.kind === 'fast-collateral') &&
    typeof record.expectedProviderCreditBaseUnits === 'string' &&
    typeof record.providerBalanceBeforeBaseUnits === 'string';
}

function creditReflected(
  record: PendingTradeAction & {
    readonly expectedProviderCreditBaseUnits: string;
    readonly providerBalanceBeforeBaseUnits: string;
  },
  account: { readonly balance: string },
): boolean {
  const balance = parseAmount(account.balance, 6).baseUnits;
  const expected = BigInt(record.providerBalanceBeforeBaseUnits) +
    BigInt(record.expectedProviderCreditBaseUnits);
  return balance >= expected;
}

async function finishCredit(
  record: PendingTradeAction,
  account: string,
  apiOrigin: string,
): Promise<void> {
  await removePendingTradeAction(account, 'pacifica');
  if (__DEV__) {
    console.info('[Perpal Pacifica deposit]', JSON.stringify({
      durationMs: Math.max(0, Date.now() - record.updatedAtMs),
      event: 'credit_reflected',
      route: record.kind === 'fast-collateral' ? 'fast' : 'private',
    }));
  }
  // Account fields are already authoritative and visible. Refresh the heavier position/order arrays in
  // the background; they must not sit in front of the newly tradeable balance.
  void refreshPacificaPortfolioSnapshot({
    account,
    apiOrigin,
    forceNetwork: true,
  }).catch(() => undefined);
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}
