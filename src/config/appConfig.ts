import { base58 } from '@scure/base';

import type { PrivyPublicConfig } from '@/config/publicEnv';

export type PerpsProviderId = 'flash';
export type SolanaCluster = 'mainnet';

export type AppConfig = {
  readonly cluster: SolanaCluster;
  readonly privy: PrivyPublicConfig;
  readonly perps: {
    readonly flashProgramId: string;
    readonly flashErRpc: string;
    readonly flashDataOrigin: string;
    readonly flashStatsOrigin: string;
    readonly pythBenchmarksOrigin: string;
    readonly usdtMint: string;
  };
  readonly privacy: {
    readonly umbraIndexerUrl: string;
    readonly umbraRelayerUrl: string;
    readonly umbraZkAssetBaseUrl: string;
  };
  readonly api: {
    readonly origin: string;
    readonly rpcPath: string;
    readonly publicRpcPath: string;
    readonly marketDataPath: string;
    readonly marketStreamPath: string;
    readonly swapBuildPath: string;
    readonly rpcUrl: string;
    readonly publicRpcUrl: string;
    readonly marketDataUrl: string;
    readonly marketStreamUrl: string;
    readonly swapBuildUrl: string;
  };
  readonly telemetry: {
    readonly enabled: boolean;
    readonly sampleRate: number;
  };
};

export type ConfigIssue = {
  readonly variable: string;
  readonly problem: string;
};

export type AppConfigResult =
  | { readonly ok: true; readonly value: AppConfig }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

export type RawAppEnv = {
  readonly cluster: string;
  readonly apiOrigin: string;
  readonly rpcPath: string;
  readonly publicRpcPath: string;
  readonly marketDataPath: string;
  readonly marketStreamPath: string;
  readonly swapBuildPath: string;
  readonly flashProgramId: string;
  readonly flashErRpc: string;
  readonly flashDataOrigin: string;
  readonly flashStatsOrigin: string;
  readonly pythBenchmarksOrigin: string;
  readonly usdtMint: string;
  readonly umbraIndexerUrl: string;
  readonly umbraRelayerUrl: string;
  readonly umbraZkAssetBaseUrl: string;
  readonly telemetryEnabled: string;
  readonly telemetrySampleRate: string;
  readonly privyAppId: string;
  readonly privyClientId: string;
};

export function readRawAppEnv(): RawAppEnv {
  return {
    cluster: process.env.EXPO_PUBLIC_SOLANA_CLUSTER?.trim() ?? '',
    apiOrigin: process.env.EXPO_PUBLIC_API_ORIGIN?.trim() ?? '',
    rpcPath: process.env.EXPO_PUBLIC_RPC_PATH?.trim() ?? '',
    publicRpcPath: process.env.EXPO_PUBLIC_PUBLIC_RPC_PATH?.trim() ?? '',
    marketDataPath:
      process.env.EXPO_PUBLIC_MARKET_DATA_PATH?.trim() ?? '',
    marketStreamPath:
      process.env.EXPO_PUBLIC_MARKET_STREAM_PATH?.trim() ?? '',
    swapBuildPath:
      process.env.EXPO_PUBLIC_SWAP_BUILD_PATH?.trim() ?? '',
    flashProgramId:
      process.env.EXPO_PUBLIC_FLASH_PROGRAM_ID?.trim() ?? '',
    flashErRpc: process.env.EXPO_PUBLIC_FLASH_ER_RPC?.trim() ?? '',
    flashDataOrigin:
      process.env.EXPO_PUBLIC_FLASH_DATA_ORIGIN?.trim() ?? '',
    flashStatsOrigin:
      process.env.EXPO_PUBLIC_FLASH_STATS_ORIGIN?.trim() ?? '',
    pythBenchmarksOrigin:
      process.env.EXPO_PUBLIC_PYTH_BENCHMARKS_ORIGIN?.trim() ?? '',
    usdtMint: process.env.EXPO_PUBLIC_USDT_MINT?.trim() ?? '',
    umbraIndexerUrl:
      process.env.EXPO_PUBLIC_UMBRA_INDEXER_URL?.trim() ?? '',
    umbraRelayerUrl:
      process.env.EXPO_PUBLIC_UMBRA_RELAYER_URL?.trim() ?? '',
    umbraZkAssetBaseUrl:
      process.env.EXPO_PUBLIC_UMBRA_ZK_ASSET_BASE_URL?.trim() ?? '',
    telemetryEnabled: process.env.EXPO_PUBLIC_TELEMETRY_ENABLED?.trim() ?? '',
    telemetrySampleRate:
      process.env.EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE?.trim() ?? '',
    privyAppId: process.env.EXPO_PUBLIC_PRIVY_APP_ID?.trim() ?? '',
    privyClientId: process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID?.trim() ?? '',
  };
}

function validateOrigin(raw: string, issues: ConfigIssue[]): string {
  if (raw.length === 0) {
    issues.push({ variable: 'EXPO_PUBLIC_API_ORIGIN', problem: 'is required' });
    return '';
  }

  try {
    const parsed = new URL(raw);
    const isLoopback =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

    if (
      (parsed.protocol !== 'https:' &&
        !(parsed.protocol === 'http:' && isLoopback)) ||
      raw.endsWith('/')
    ) {
      throw new Error('invalid origin');
    }
  } catch {
    issues.push({
      variable: 'EXPO_PUBLIC_API_ORIGIN',
      problem: 'must be an absolute HTTPS origin without a trailing slash',
    });
    return '';
  }

  return raw;
}

function validatePath(
  raw: string,
  variable:
    | 'EXPO_PUBLIC_RPC_PATH'
    | 'EXPO_PUBLIC_PUBLIC_RPC_PATH'
    | 'EXPO_PUBLIC_MARKET_DATA_PATH'
    | 'EXPO_PUBLIC_MARKET_STREAM_PATH'
    | 'EXPO_PUBLIC_SWAP_BUILD_PATH',
  issues: ConfigIssue[],
): string {
  if (raw.length === 0 || !raw.startsWith('/') || raw.endsWith('/')) {
    issues.push({
      variable,
      problem: 'must start with "/" and not end with one',
    });
    return '';
  }

  return raw;
}

function validateAddress(
  raw: string,
  variable: 'EXPO_PUBLIC_FLASH_PROGRAM_ID' | 'EXPO_PUBLIC_USDT_MINT',
  issues: ConfigIssue[],
): string {
  try {
    if (base58.decode(raw).length !== 32) {
      throw new Error('invalid address');
    }
  } catch {
    issues.push({ variable, problem: 'must be a Solana address' });
    return '';
  }

  return raw;
}

function validateFlashErRpc(raw: string, issues: ConfigIssue[]): string {
  try {
    const parsed = new URL(raw);

    if (
      parsed.protocol !== 'https:' ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0 ||
      parsed.pathname !== '/' ||
      raw.endsWith('/')
    ) {
      throw new Error('invalid Flash ER RPC');
    }
  } catch {
    issues.push({
      variable: 'EXPO_PUBLIC_FLASH_ER_RPC',
      problem: 'must be an HTTPS origin without credentials or a trailing slash',
    });
    return '';
  }

  return raw;
}

function validatePublicServiceOrigin(
  raw: string,
  variable:
    | 'EXPO_PUBLIC_FLASH_DATA_ORIGIN'
    | 'EXPO_PUBLIC_FLASH_STATS_ORIGIN'
    | 'EXPO_PUBLIC_PYTH_BENCHMARKS_ORIGIN'
    | 'EXPO_PUBLIC_UMBRA_INDEXER_URL'
    | 'EXPO_PUBLIC_UMBRA_RELAYER_URL'
    | 'EXPO_PUBLIC_UMBRA_ZK_ASSET_BASE_URL',
  issues: ConfigIssue[],
): string {
  try {
    const parsed = new URL(raw);

    if (
      parsed.protocol !== 'https:' ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0 ||
      raw.endsWith('/')
    ) {
      throw new Error('invalid service origin');
    }
  } catch {
    issues.push({
      variable,
      problem: 'must be an HTTPS URL without credentials or a trailing slash',
    });
    return '';
  }

  return raw;
}

function validateSampleRate(raw: string, issues: ConfigIssue[]): number {
  if (raw.length === 0) {
    return 0;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    issues.push({
      variable: 'EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE',
      problem: 'must be a number between 0 and 1',
    });
    return 0;
  }

  return parsed;
}

export function parseAppConfig(raw: RawAppEnv): AppConfigResult {
  const issues: ConfigIssue[] = [];

  if (raw.cluster !== 'mainnet') {
    issues.push({
      variable: 'EXPO_PUBLIC_SOLANA_CLUSTER',
      problem: 'must be "mainnet"',
    });
  }

  const origin = validateOrigin(raw.apiOrigin, issues);
  const rpcPath = validatePath(raw.rpcPath, 'EXPO_PUBLIC_RPC_PATH', issues);
  const publicRpcPath = validatePath(
    raw.publicRpcPath,
    'EXPO_PUBLIC_PUBLIC_RPC_PATH',
    issues,
  );
  const marketDataPath = validatePath(
    raw.marketDataPath,
    'EXPO_PUBLIC_MARKET_DATA_PATH',
    issues,
  );
  const marketStreamPath = validatePath(
    raw.marketStreamPath,
    'EXPO_PUBLIC_MARKET_STREAM_PATH',
    issues,
  );
  const swapBuildPath = validatePath(
    raw.swapBuildPath,
    'EXPO_PUBLIC_SWAP_BUILD_PATH',
    issues,
  );
  const flashProgramId = validateAddress(
    raw.flashProgramId,
    'EXPO_PUBLIC_FLASH_PROGRAM_ID',
    issues,
  );
  const usdtMint = validateAddress(
    raw.usdtMint,
    'EXPO_PUBLIC_USDT_MINT',
    issues,
  );
  const flashErRpc = validateFlashErRpc(raw.flashErRpc, issues);
  const flashDataOrigin = validatePublicServiceOrigin(
    raw.flashDataOrigin,
    'EXPO_PUBLIC_FLASH_DATA_ORIGIN',
    issues,
  );
  const flashStatsOrigin = validatePublicServiceOrigin(
    raw.flashStatsOrigin,
    'EXPO_PUBLIC_FLASH_STATS_ORIGIN',
    issues,
  );
  const pythBenchmarksOrigin = validatePublicServiceOrigin(
    raw.pythBenchmarksOrigin,
    'EXPO_PUBLIC_PYTH_BENCHMARKS_ORIGIN',
    issues,
  );
  const umbraIndexerUrl = validatePublicServiceOrigin(
    raw.umbraIndexerUrl,
    'EXPO_PUBLIC_UMBRA_INDEXER_URL',
    issues,
  );
  const umbraRelayerUrl = validatePublicServiceOrigin(
    raw.umbraRelayerUrl,
    'EXPO_PUBLIC_UMBRA_RELAYER_URL',
    issues,
  );
  const umbraZkAssetBaseUrl = validatePublicServiceOrigin(
    raw.umbraZkAssetBaseUrl,
    'EXPO_PUBLIC_UMBRA_ZK_ASSET_BASE_URL',
    issues,
  );
  const sampleRate = validateSampleRate(raw.telemetrySampleRate, issues);

  if (raw.privyAppId.length === 0) {
    issues.push({ variable: 'EXPO_PUBLIC_PRIVY_APP_ID', problem: 'is required' });
  }

  if (raw.privyClientId.length === 0) {
    issues.push({
      variable: 'EXPO_PUBLIC_PRIVY_CLIENT_ID',
      problem: 'is required',
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      cluster: 'mainnet',
      privy: { appId: raw.privyAppId, clientId: raw.privyClientId },
      perps: {
        flashProgramId,
        flashErRpc,
        flashDataOrigin,
        flashStatsOrigin,
        pythBenchmarksOrigin,
        usdtMint,
      },
      privacy: {
        umbraIndexerUrl,
        umbraRelayerUrl,
        umbraZkAssetBaseUrl,
      },
      api: {
        origin,
        rpcPath,
        publicRpcPath,
        marketDataPath,
        marketStreamPath,
        swapBuildPath,
        rpcUrl: `${origin}${rpcPath}`,
        publicRpcUrl: `${origin}${publicRpcPath}`,
        marketDataUrl: `${origin}${marketDataPath}`,
        marketStreamUrl: `${origin}${marketStreamPath}`,
        swapBuildUrl: `${origin}${swapBuildPath}`,
      },
      telemetry: {
        enabled: raw.telemetryEnabled === 'true',
        sampleRate,
      },
    },
  };
}

export function readAppConfig(): AppConfigResult {
  return parseAppConfig(readRawAppEnv());
}
