import type { ProviderEndpoint } from './providerRouter';

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

  // Vars
  readonly PERPS_VENUE?: string;
  readonly SOLANA_CLUSTER?: string;
};

export type ResolvedCluster = 'devnet' | 'mainnet';

export type GatewayConfig = {
  readonly cluster: ResolvedCluster;
  readonly venue: string;
  readonly providers: readonly ProviderEndpoint[];
  readonly redis: { readonly url: string; readonly token: string } | null;
};

export class ConfigurationError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`Missing or invalid Worker configuration: ${missing.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

const HELIUS_HOST: Readonly<Record<ResolvedCluster, string>> = {
  devnet: 'https://devnet.helius-rpc.com',
  mainnet: 'https://mainnet.helius-rpc.com',
};

const ALCHEMY_HOST: Readonly<Record<ResolvedCluster, string>> = {
  devnet: 'https://solana-devnet.g.alchemy.com/v2',
  mainnet: 'https://solana-mainnet.g.alchemy.com/v2',
};

function isCluster(value: string | undefined): value is ResolvedCluster {
  return value === 'devnet' || value === 'mainnet';
}

/**
 * Provider secrets must be the bare API key, not the full RPC URL the provider
 * dashboard shows you.
 *
 * This matters beyond tidiness: the host is chosen here from the deployment's
 * cluster, so a pasted URL is the one way a mainnet endpoint could end up serving
 * a devnet deployment. Rejecting it keeps that impossible.
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

/**
 * Validates the environment and composes provider endpoints.
 *
 * Fails closed: a gateway with no usable provider must refuse to start rather
 * than serve confusing partial errors on every request.
 */
export function resolveConfig(env: WorkerEnv): GatewayConfig {
  const missing: string[] = [];

  if (!isCluster(env.SOLANA_CLUSTER)) {
    missing.push('SOLANA_CLUSTER (must be "devnet" or "mainnet")');
  }

  const venue = env.PERPS_VENUE?.trim() ?? '';

  if (venue.length === 0) {
    missing.push('PERPS_VENUE');
  }

  const heliusKey = env.HELIUS_API_KEY?.trim() ?? '';
  const alchemyKey = env.ALCHEMY_API_KEY?.trim() ?? '';

  if (heliusKey.length === 0 && alchemyKey.length === 0) {
    missing.push('HELIUS_API_KEY or ALCHEMY_API_KEY (at least one)');
  }

  assertBareKey(heliusKey, 'HELIUS_API_KEY', missing);
  assertBareKey(alchemyKey, 'ALCHEMY_API_KEY', missing);

  if (missing.length > 0 || !isCluster(env.SOLANA_CLUSTER)) {
    throw new ConfigurationError(missing);
  }

  const cluster = env.SOLANA_CLUSTER;
  const providers: ProviderEndpoint[] = [];

  if (heliusKey.length > 0) {
    providers.push({
      id: 'helius',
      url: `${HELIUS_HOST[cluster]}/?api-key=${heliusKey}`,
    });
  }

  if (alchemyKey.length > 0) {
    providers.push({
      id: 'alchemy',
      url: `${ALCHEMY_HOST[cluster]}/${alchemyKey}`,
    });
  }

  const redisUrl = env.UPSTASH_REDIS_REST_URL?.trim() ?? '';
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? '';

  return {
    cluster,
    venue,
    providers,
    redis:
      redisUrl.length > 0 && redisToken.length > 0
        ? { url: redisUrl, token: redisToken }
        : null,
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
