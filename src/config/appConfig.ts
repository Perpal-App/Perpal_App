import { base58 } from '@scure/base';

import type { PrivyPublicConfig } from '@/config/publicEnv';
import { readRawAppEnv, type RawAppEnv } from '@/config/rawAppEnv';

export type { RawAppEnv } from '@/config/rawAppEnv';

export type PerpsProviderId = 'pacifica' | 'velocity';
export type SolanaCluster = 'mainnet';

export type AppConfig = {
  readonly cluster: SolanaCluster;
  readonly privy: PrivyPublicConfig;
  readonly perps: {
    readonly pacificaApiOrigin: string;
    readonly pacificaAssetOrigin: string;
    readonly pacificaWsOrigin: string;
    readonly pacificaProgramId: string;
    readonly pacificaCentralState: string;
    readonly pacificaVault: string;
    readonly pacificaWithdrawalFeeBaseUnits: bigint;
    readonly velocityDlobApiOrigin: string;
    readonly velocityDlobWsOrigin: string;
    readonly velocityProgramId: string;
    readonly usdcMint: string;
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
    readonly fearGreedPath: string;
    readonly marketBriefingPath: string;
    readonly tokenPricesPath: string;
    readonly swapBuildPath: string;
    readonly rpcUrl: string;
    readonly publicRpcUrl: string;
    readonly marketDataUrl: string;
    readonly marketHistoryUrl: string;
    readonly marketStreamUrl: string;
    readonly fearGreedUrl: string;
    readonly marketBriefingUrl: string;
    readonly tokenPricesUrl: string;
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
    | 'EXPO_PUBLIC_FEAR_GREED_PATH'
    | 'EXPO_PUBLIC_MARKET_BRIEFING_PATH'
    | 'EXPO_PUBLIC_TOKEN_PRICES_PATH'
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
  variable:
    | 'EXPO_PUBLIC_PACIFICA_PROGRAM_ID'
    | 'EXPO_PUBLIC_PACIFICA_CENTRAL_STATE'
    | 'EXPO_PUBLIC_PACIFICA_VAULT'
    | 'EXPO_PUBLIC_VELOCITY_PROGRAM_ID'
    | 'EXPO_PUBLIC_USDC_MINT'
    | 'EXPO_PUBLIC_USDT_MINT',
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

function validateWebSocketOrigin(
  raw: string,
  variable: 'EXPO_PUBLIC_PACIFICA_WS_ORIGIN' | 'EXPO_PUBLIC_VELOCITY_DLOB_WS_ORIGIN',
  issues: ConfigIssue[],
): string {
  try {
    const parsed = new URL(raw);

    if (
      parsed.protocol !== 'wss:' ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0 ||
      parsed.pathname !== '/' ||
      raw.endsWith('/')
    ) {
      throw new Error('invalid WebSocket origin');
    }
  } catch {
    issues.push({
      variable,
      problem: 'must be a WSS origin without credentials or a trailing slash',
    });
    return '';
  }

  return raw;
}

function validatePublicServiceOrigin(
  raw: string,
  variable:
    | 'EXPO_PUBLIC_PACIFICA_API_ORIGIN'
    | 'EXPO_PUBLIC_PACIFICA_ASSET_ORIGIN'
    | 'EXPO_PUBLIC_VELOCITY_DLOB_API_ORIGIN'
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

function validateUsdcFee(raw: string, issues: ConfigIssue[]): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/u.test(raw)) {
    issues.push({
      variable: 'EXPO_PUBLIC_PACIFICA_WITHDRAWAL_FEE_USDC',
      problem: 'must be a non-negative USDC amount with at most 6 decimals',
    });
    return 0n;
  }
  const [whole = '0', fraction = ''] = raw.split('.');
  return BigInt(`${whole}${fraction.padEnd(6, '0')}`);
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
  const fearGreedPath = validatePath(
    raw.fearGreedPath,
    'EXPO_PUBLIC_FEAR_GREED_PATH',
    issues,
  );
  const marketBriefingPath = validatePath(
    raw.marketBriefingPath,
    'EXPO_PUBLIC_MARKET_BRIEFING_PATH',
    issues,
  );
  const tokenPricesPath = validatePath(
    raw.tokenPricesPath,
    'EXPO_PUBLIC_TOKEN_PRICES_PATH',
    issues,
  );
  const swapBuildPath = validatePath(
    raw.swapBuildPath,
    'EXPO_PUBLIC_SWAP_BUILD_PATH',
    issues,
  );
  const pacificaProgramId = validateAddress(
    raw.pacificaProgramId,
    'EXPO_PUBLIC_PACIFICA_PROGRAM_ID',
    issues,
  );
  const pacificaCentralState = validateAddress(
    raw.pacificaCentralState,
    'EXPO_PUBLIC_PACIFICA_CENTRAL_STATE',
    issues,
  );
  const pacificaVault = validateAddress(
    raw.pacificaVault,
    'EXPO_PUBLIC_PACIFICA_VAULT',
    issues,
  );
  const velocityProgramId = validateAddress(
    raw.velocityProgramId,
    'EXPO_PUBLIC_VELOCITY_PROGRAM_ID',
    issues,
  );
  const usdcMint = validateAddress(raw.usdcMint, 'EXPO_PUBLIC_USDC_MINT', issues);
  const usdtMint = validateAddress(
    raw.usdtMint,
    'EXPO_PUBLIC_USDT_MINT',
    issues,
  );
  const pacificaApiOrigin = validatePublicServiceOrigin(
    raw.pacificaApiOrigin,
    'EXPO_PUBLIC_PACIFICA_API_ORIGIN',
    issues,
  );
  const pacificaAssetOrigin = validatePublicServiceOrigin(
    raw.pacificaAssetOrigin,
    'EXPO_PUBLIC_PACIFICA_ASSET_ORIGIN',
    issues,
  );
  const pacificaWsOrigin = validateWebSocketOrigin(
    raw.pacificaWsOrigin,
    'EXPO_PUBLIC_PACIFICA_WS_ORIGIN',
    issues,
  );
  const velocityDlobApiOrigin = validatePublicServiceOrigin(
    raw.velocityDlobApiOrigin,
    'EXPO_PUBLIC_VELOCITY_DLOB_API_ORIGIN',
    issues,
  );
  const velocityDlobWsOrigin = validateWebSocketOrigin(
    raw.velocityDlobWsOrigin,
    'EXPO_PUBLIC_VELOCITY_DLOB_WS_ORIGIN',
    issues,
  );
  const pacificaWithdrawalFeeBaseUnits = validateUsdcFee(
    raw.pacificaWithdrawalFeeUsdc,
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
        pacificaApiOrigin,
        pacificaAssetOrigin,
        pacificaWsOrigin,
        pacificaProgramId,
        pacificaCentralState,
        pacificaVault,
        pacificaWithdrawalFeeBaseUnits,
        velocityDlobApiOrigin,
        velocityDlobWsOrigin,
        velocityProgramId,
        usdcMint,
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
        fearGreedPath,
        marketBriefingPath,
        tokenPricesPath,
        swapBuildPath,
        rpcUrl: `${origin}${rpcPath}`,
        publicRpcUrl: `${origin}${publicRpcPath}`,
        marketDataUrl: `${origin}${marketDataPath}`,
        marketHistoryUrl: `${origin}${marketDataPath}/history`,
        marketStreamUrl: `${origin}${marketStreamPath}`,
        fearGreedUrl: `${origin}${fearGreedPath}`,
        marketBriefingUrl: `${origin}${marketBriefingPath}`,
        tokenPricesUrl: `${origin}${tokenPricesPath}`,
        swapBuildUrl: `${origin}${swapBuildPath}`,
      },
      telemetry: {
        enabled: raw.telemetryEnabled === 'true',
        sampleRate,
      },
    },
  };
}

let resolved: AppConfigResult | null = null;

/** Build-time public configuration, parsed once because it cannot change in-process. */
export function readAppConfig(): AppConfigResult {
  resolved ??= parseAppConfig(readRawAppEnv());
  return resolved;
}
