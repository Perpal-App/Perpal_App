import { base58 } from '@scure/base';

import type { ProviderEndpoint } from './providerRouter';
import type { MarketAsset, MarketDataConfig } from './marketData';

/**
 * Worker configuration.
 *
 * Secrets arrive from `wrangler secret put` and never appear in source or logs.
 * Non-secret values come from `[vars]` in `wrangler.toml`, per environment.
 *
 * Provider URLs are composed here, once, so no other module concatenates a key
 * into a URL and risks logging the result.
 */

export type WorkerEnv = {
  // Secrets
  readonly HELIUS_API_KEY?: string;
  readonly ALCHEMY_API_KEY?: string;
  readonly UPSTASH_REDIS_REST_URL?: string;
  readonly UPSTASH_REDIS_REST_TOKEN?: string;
  readonly PYTH_API_KEY?: string;
  readonly JUPITER_API_KEY?: string;

  // Vars
  readonly PERPS_PROVIDERS?: string;
  readonly SOLANA_CLUSTER?: string;
  readonly CORS_ALLOWED_ORIGINS?: string;
  readonly PYTH_HERMES_ORIGIN?: string;
  readonly PYTH_HISTORY_ORIGIN?: string;
  readonly PYTH_MARKET_FEEDS?: string;
  readonly FEAR_GREED_URL?: string;
  readonly COINDESK_NEWS_FEED_URL?: string;
  readonly MARKETWATCH_NEWS_FEED_URL?: string;
  readonly FED_MONETARY_NEWS_FEED_URL?: string;
  readonly USD_ECONOMIC_CALENDAR_URL?: string;
  readonly JUPITER_API_ORIGIN?: string;
  readonly STABLECOIN_MINTS?: string;

  // Bindings
  readonly RATE_LIMITER?: {
    limit(input: { readonly key: string }): Promise<{ readonly success: boolean }>;
  };
  readonly GLOBAL_RATE_LIMITER?: {
    limit(input: { readonly key: string }): Promise<{ readonly success: boolean }>;
  };
  readonly TELEMETRY?: AnalyticsEngineBinding;
};

export type AnalyticsEngineBinding = {
  writeDataPoint(point: {
    readonly blobs?: readonly string[];
    readonly doubles?: readonly number[];
    readonly indexes?: readonly string[];
  }): void;
};

export type ResolvedCluster = 'mainnet';

export type GatewayConfig = {
  readonly cluster: ResolvedCluster;
  readonly perpsProviders: readonly ['pacifica'];
  readonly providers: readonly ProviderEndpoint[];
  readonly marketData: MarketDataConfig;
  readonly jupiter: {
    readonly origin: string;
    readonly apiKey: string;
    readonly stablecoinMints: readonly [string, string];
  } | null;
  readonly redis: { readonly url: string; readonly token: string } | null;
  readonly corsAllowedOrigins: readonly string[];
};

export class ConfigurationError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`Missing or invalid Worker configuration: ${missing.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

const HELIUS_HOST = 'https://mainnet.helius-rpc.com';
const ALCHEMY_HOST = 'https://solana-mainnet.g.alchemy.com/v2';

function isCluster(value: string | undefined): value is ResolvedCluster {
  return value === 'mainnet';
}

function parseHttpsOrigin(
  raw: string | undefined,
  variable: string,
  invalid: string[],
): string {
  const value = raw?.trim() ?? '';

  try {
    const parsed = new URL(value);

    if (parsed.protocol === 'https:' && parsed.origin === value) {
      return value;
    }
  } catch {
    // Report the binding name below without exposing its value.
  }

  invalid.push(`${variable} (exact HTTPS origin required)`);
  return '';
}

function parseMarketFeeds(
  raw: string | undefined,
  invalid: string[],
): Readonly<Record<MarketAsset, string>> {
  const entries = new Map(
    (raw ?? '').split(',').map((entry) => {
      const [asset = '', feedId = ''] = entry.split(':');
      return [asset.trim(), feedId.trim().toLowerCase()];
    }),
  );
  const result = {
    BTC: entries.get('BTC') ?? '',
    ETH: entries.get('ETH') ?? '',
    SOL: entries.get('SOL') ?? '',
  };

  if (Object.values(result).some((feedId) => !/^[0-9a-f]{64}$/u.test(feedId))) {
    invalid.push('PYTH_MARKET_FEEDS (BTC, ETH, and SOL feed ids required)');
  }

  return result;
}

function parseStablecoinMints(
  raw: string | undefined,
  invalid: string[],
): readonly [string, string] {
  const entries = new Map(
    (raw ?? '').split(',').map((entry) => {
      const [symbol = '', mint = ''] = entry.split(':');
      return [symbol.trim(), mint.trim()];
    }),
  );
  const usdc = entries.get('USDC') ?? '';
  const usdt = entries.get('USDT') ?? '';

  try {
    if (base58.decode(usdc).length !== 32 || base58.decode(usdt).length !== 32) {
      throw new Error('invalid mint');
    }
  } catch {
    invalid.push('STABLECOIN_MINTS (USDC and USDT addresses required)');
  }

  return [usdc, usdt];
}

export function resolveMarketDataConfig(env: WorkerEnv): MarketDataConfig {
  const invalid: string[] = [];
  const origin = parseHttpsOrigin(
    env.PYTH_HERMES_ORIGIN,
    'PYTH_HERMES_ORIGIN',
    invalid,
  );
  const historyOrigin = parseHttpsOrigin(
    env.PYTH_HISTORY_ORIGIN,
    'PYTH_HISTORY_ORIGIN',
    invalid,
  );
  const feedIds = parseMarketFeeds(env.PYTH_MARKET_FEEDS, invalid);

  if (invalid.length > 0) {
    throw new ConfigurationError(invalid);
  }

  return {
    origin,
    historyOrigin,
    feedIds,
    apiKey: env.PYTH_API_KEY?.trim() || null,
  };
}

export function resolveFearGreedUrl(env: WorkerEnv): string {
  return parseHttpsUrl(env.FEAR_GREED_URL, 'FEAR_GREED_URL', true);
}

export type PublicMarketBriefingConfig = {
  readonly cryptoNewsUrl: string;
  readonly marketsNewsUrl: string;
  readonly fedNewsUrl: string;
  readonly economicCalendarUrl: string;
};

export function resolvePublicMarketBriefingConfig(
  env: WorkerEnv,
): PublicMarketBriefingConfig {
  return {
    cryptoNewsUrl: parseHttpsUrl(
      env.COINDESK_NEWS_FEED_URL,
      'COINDESK_NEWS_FEED_URL',
    ),
    marketsNewsUrl: parseHttpsUrl(
      env.MARKETWATCH_NEWS_FEED_URL,
      'MARKETWATCH_NEWS_FEED_URL',
    ),
    fedNewsUrl: parseHttpsUrl(
      env.FED_MONETARY_NEWS_FEED_URL,
      'FED_MONETARY_NEWS_FEED_URL',
    ),
    economicCalendarUrl: parseHttpsUrl(
      env.USD_ECONOMIC_CALENDAR_URL,
      'USD_ECONOMIC_CALENDAR_URL',
    ),
  };
}

function parseHttpsUrl(
  raw: string | undefined,
  variable: string,
  allowQuery = false,
): string {
  const value = raw?.trim() ?? '';

  try {
    const parsed = new URL(value);

    if (
      parsed.protocol === 'https:' &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      (allowQuery || parsed.search.length === 0) &&
      parsed.hash.length === 0
    ) {
      return value;
    }
  } catch {
    // Report the binding name without exposing its configured value.
  }

  throw new ConfigurationError([`${variable} (exact HTTPS URL required)`]);
}

/**
 * Provider secrets must be the bare API key, not the full RPC URL the provider
 * dashboard shows you. Rejecting URLs also prevents a key field from silently
 * overriding the configured mainnet provider host.
 */
function assertBareKey(
  value: string,
  variable: string,
  missing: string[],
): void {
  if (value.length === 0) {
    return;
  }

  if (value.includes('://') || value.toLowerCase().startsWith('http')) {
    missing.push(`${variable} (supply the API key only, not the full RPC URL)`);
  }
}

function parseCorsOrigins(raw: string | undefined, invalid: string[]): string[] {
  const origins = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  for (const origin of origins) {
    try {
      const parsed = new URL(origin);

      if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
        invalid.push('CORS_ALLOWED_ORIGINS (exact HTTPS origins only)');
        return [];
      }
    } catch {
      invalid.push('CORS_ALLOWED_ORIGINS (exact HTTPS origins only)');
      return [];
    }
  }

  return [...new Set(origins)];
}

/**
 * Validates the environment and composes provider endpoints.
 *
 * Fails closed: a gateway with no usable provider must refuse to start rather
 * than serve confusing partial errors on every request.
 */
export function resolveConfig(env: WorkerEnv): GatewayConfig {
  const missing: string[] = [];

  if (!isCluster(env.SOLANA_CLUSTER)) {
    missing.push('SOLANA_CLUSTER (must be "mainnet")');
  }

  const perpsProviders = env.PERPS_PROVIDERS?.trim() ?? '';

  if (perpsProviders !== 'pacifica') {
    missing.push('PERPS_PROVIDERS (must be "pacifica")');
  }

  const heliusKey = env.HELIUS_API_KEY?.trim() ?? '';
  const alchemyKey = env.ALCHEMY_API_KEY?.trim() ?? '';
  const corsAllowedOrigins = parseCorsOrigins(
    env.CORS_ALLOWED_ORIGINS,
    missing,
  );
  const jupiterOrigin = parseHttpsOrigin(
    env.JUPITER_API_ORIGIN,
    'JUPITER_API_ORIGIN',
    missing,
  );
  const stablecoinMints = parseStablecoinMints(
    env.STABLECOIN_MINTS,
    missing,
  );
  const jupiterApiKey = env.JUPITER_API_KEY?.trim() ?? '';
  let marketData: MarketDataConfig | null = null;

  try {
    marketData = resolveMarketDataConfig(env);
  } catch (cause) {
    if (cause instanceof ConfigurationError) {
      missing.push(...cause.missing);
    }
  }

  if (heliusKey.length === 0 && alchemyKey.length === 0) {
    missing.push('HELIUS_API_KEY or ALCHEMY_API_KEY (at least one)');
  }

  assertBareKey(heliusKey, 'HELIUS_API_KEY', missing);
  assertBareKey(alchemyKey, 'ALCHEMY_API_KEY', missing);

  if (
    missing.length > 0 ||
    !isCluster(env.SOLANA_CLUSTER) ||
    marketData === null
  ) {
    throw new ConfigurationError(missing);
  }

  const cluster = env.SOLANA_CLUSTER;
  const providers: ProviderEndpoint[] = [];

  if (heliusKey.length > 0) {
    providers.push({
      id: 'helius',
      url: `${HELIUS_HOST}/?api-key=${heliusKey}`,
    });
  }

  if (alchemyKey.length > 0) {
    providers.push({
      id: 'alchemy',
      url: `${ALCHEMY_HOST}/${alchemyKey}`,
    });
  }

  const redisUrl = env.UPSTASH_REDIS_REST_URL?.trim() ?? '';
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? '';

  return {
    cluster,
    perpsProviders: ['pacifica'],
    providers,
    marketData,
    jupiter:
      jupiterApiKey.length === 0
        ? null
        : {
            origin: jupiterOrigin,
            apiKey: jupiterApiKey,
            stablecoinMints,
          },
    redis:
      redisUrl.length > 0 && redisToken.length > 0
        ? { url: redisUrl, token: redisToken }
        : null,
    corsAllowedOrigins,
  };
}

/** Strips credentials before a URL is ever put in a log or error. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);

    parsed.search = '';
    // Alchemy carries the key in the path, so drop everything but the host.
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '[unparseable-url]';
  }
}
