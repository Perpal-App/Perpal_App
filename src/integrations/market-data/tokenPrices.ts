export type TokenPriceBatch = {
  readonly prices: ReadonlyMap<string, string>;
  readonly timestampMs: number;
};

export class TokenPricesError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly traceId: string | null = null,
  ) {
    super(message);
    this.name = 'TokenPricesError';
  }
}

const PRICE_BATCH_SIZE = 50;
const REQUEST_TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 250;
const REQUEST_ATTEMPTS = 2;

export async function fetchTokenPrices(
  mints: readonly string[],
  tokenPricesUrl: string,
  signal: AbortSignal,
): Promise<TokenPriceBatch> {
  if (mints.length === 0) {
    return { prices: new Map(), timestampMs: Date.now() };
  }

  const chunks = Array.from(
    { length: Math.ceil(mints.length / PRICE_BATCH_SIZE) },
    (_, index) => mints.slice(index * PRICE_BATCH_SIZE, (index + 1) * PRICE_BATCH_SIZE),
  );
  const batches = await Promise.all(
    chunks.map((ids) => fetchPriceBatch(ids, tokenPricesUrl, signal)),
  );

  return {
    prices: new Map(batches.flatMap((batch) => [...batch.prices.entries()])),
    timestampMs: Math.min(...batches.map((batch) => batch.timestampMs)),
  };
}

async function fetchPriceBatch(
  ids: readonly string[],
  tokenPricesUrl: string,
  signal: AbortSignal,
): Promise<TokenPriceBatch> {
  let latestFailure: unknown;

  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await fetchPriceBatchOnce(ids, tokenPricesUrl, signal);
    } catch (cause) {
      latestFailure = cause;
      if (signal.aborted || attempt === REQUEST_ATTEMPTS || !isRetryable(cause)) {
        throw cause;
      }
      await abortableDelay(RETRY_DELAY_MS, signal);
    }
  }

  throw latestFailure;
}

async function fetchPriceBatchOnce(
  ids: readonly string[],
  tokenPricesUrl: string,
  signal: AbortSignal,
): Promise<TokenPriceBatch> {
  let url: URL;
  try {
    url = new URL(tokenPricesUrl);
  } catch {
    throw new TokenPricesError(
      'Token price endpoint is invalid.',
      0,
      'token_prices_config_invalid',
    );
  }
  url.searchParams.set('ids', ids.join(','));

  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as unknown;
    const traceId = response.headers.get('x-perpal-trace-id');

    if (!response.ok) {
      const gatewayError = readGatewayError(payload);
      throw new TokenPricesError(
        gatewayError.message ?? 'Token prices are unavailable.',
        response.status,
        gatewayError.code ?? 'token_prices_request_failed',
        traceId,
      );
    }

    return parsePriceBatch(payload, ids, traceId);
  } catch (cause) {
    if (cause instanceof TokenPricesError) throw cause;
    if (controller.signal.aborted) {
      throw new TokenPricesError(
        timedOut ? 'Token price request timed out.' : 'Token price request was cancelled.',
        0,
        timedOut ? 'request_timeout' : 'request_cancelled',
      );
    }
    throw new TokenPricesError('Token price service is unreachable.', 0, 'network_error');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

function parsePriceBatch(
  value: unknown,
  ids: readonly string[],
  traceId: string | null,
): TokenPriceBatch {
  const body = record(value);
  const rawPrices = record(body?.prices);
  if (
    body?.source !== 'Jupiter Price API V3' ||
    !Number.isSafeInteger(body?.timestampMs) ||
    (body?.timestampMs as number) <= 0 ||
    rawPrices === null
  ) {
    throw invalidResponse(traceId);
  }

  const allowed = new Set(ids);
  const prices = new Map<string, string>();
  for (const [mint, price] of Object.entries(rawPrices)) {
    if (
      !allowed.has(mint) ||
      typeof price !== 'string' ||
      !/^\d+(?:\.\d{1,18})?$/u.test(price)
    ) {
      throw invalidResponse(traceId);
    }
    prices.set(mint, price);
  }

  return { prices, timestampMs: body.timestampMs as number };
}

function readGatewayError(value: unknown): { readonly code?: string; readonly message?: string } {
  const body = record(value);
  const error = record(body?.error);
  return {
    ...(typeof error?.code === 'string' ? { code: error.code } : {}),
    ...(typeof error?.message === 'string' ? { message: error.message } : {}),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function invalidResponse(traceId: string | null): TokenPricesError {
  return new TokenPricesError(
    'Token price response is invalid.',
    0,
    'token_prices_response_invalid',
    traceId,
  );
}

function isRetryable(cause: unknown): boolean {
  return cause instanceof TokenPricesError && (
    cause.status === 502 ||
    cause.code === 'network_error' ||
    cause.code === 'request_timeout'
  );
}

async function abortableDelay(durationMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw new TokenPricesError('Token price request was cancelled.', 0, 'request_cancelled');
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, durationMs);
    const abort = () => {
      clearTimeout(timer);
      reject(new TokenPricesError('Token price request was cancelled.', 0, 'request_cancelled'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}
