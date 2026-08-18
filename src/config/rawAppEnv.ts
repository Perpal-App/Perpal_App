export type RawAppEnv = {
  readonly cluster: string;
  readonly apiOrigin: string;
  readonly rpcPath: string;
  readonly publicRpcPath: string;
  readonly marketDataPath: string;
  readonly marketStreamPath: string;
  readonly fearGreedPath: string;
  readonly marketBriefingPath: string;
  readonly tokenPricesPath: string;
  readonly swapBuildPath: string;
  readonly pacificaApiOrigin: string;
  readonly pacificaAssetOrigin: string;
  readonly pacificaWsOrigin: string;
  readonly pacificaProgramId: string;
  readonly pacificaCentralState: string;
  readonly pacificaVault: string;
  readonly pacificaWithdrawalFeeUsdc: string;
  readonly velocityDlobApiOrigin: string;
  readonly velocityDlobWsOrigin: string;
  readonly velocityProgramId: string;
  readonly usdcMint: string;
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
    marketDataPath: process.env.EXPO_PUBLIC_MARKET_DATA_PATH?.trim() ?? '',
    marketStreamPath: process.env.EXPO_PUBLIC_MARKET_STREAM_PATH?.trim() ?? '',
    fearGreedPath: process.env.EXPO_PUBLIC_FEAR_GREED_PATH?.trim() ?? '',
    marketBriefingPath: process.env.EXPO_PUBLIC_MARKET_BRIEFING_PATH?.trim() ?? '',
    tokenPricesPath: process.env.EXPO_PUBLIC_TOKEN_PRICES_PATH?.trim() ?? '',
    swapBuildPath: process.env.EXPO_PUBLIC_SWAP_BUILD_PATH?.trim() ?? '',
    pacificaApiOrigin: process.env.EXPO_PUBLIC_PACIFICA_API_ORIGIN?.trim() ?? '',
    pacificaAssetOrigin: process.env.EXPO_PUBLIC_PACIFICA_ASSET_ORIGIN?.trim() ?? '',
    pacificaWsOrigin: process.env.EXPO_PUBLIC_PACIFICA_WS_ORIGIN?.trim() ?? '',
    pacificaProgramId: process.env.EXPO_PUBLIC_PACIFICA_PROGRAM_ID?.trim() ?? '',
    pacificaCentralState: process.env.EXPO_PUBLIC_PACIFICA_CENTRAL_STATE?.trim() ?? '',
    pacificaVault: process.env.EXPO_PUBLIC_PACIFICA_VAULT?.trim() ?? '',
    pacificaWithdrawalFeeUsdc:
      process.env.EXPO_PUBLIC_PACIFICA_WITHDRAWAL_FEE_USDC?.trim() ?? '',
    velocityDlobApiOrigin:
      process.env.EXPO_PUBLIC_VELOCITY_DLOB_API_ORIGIN?.trim() ?? '',
    velocityDlobWsOrigin:
      process.env.EXPO_PUBLIC_VELOCITY_DLOB_WS_ORIGIN?.trim() ?? '',
    velocityProgramId: process.env.EXPO_PUBLIC_VELOCITY_PROGRAM_ID?.trim() ?? '',
    usdcMint: process.env.EXPO_PUBLIC_USDC_MINT?.trim() ?? '',
    usdtMint: process.env.EXPO_PUBLIC_USDT_MINT?.trim() ?? '',
    umbraIndexerUrl: process.env.EXPO_PUBLIC_UMBRA_INDEXER_URL?.trim() ?? '',
    umbraRelayerUrl: process.env.EXPO_PUBLIC_UMBRA_RELAYER_URL?.trim() ?? '',
    umbraZkAssetBaseUrl: process.env.EXPO_PUBLIC_UMBRA_ZK_ASSET_BASE_URL?.trim() ?? '',
    telemetryEnabled: process.env.EXPO_PUBLIC_TELEMETRY_ENABLED?.trim() ?? '',
    telemetrySampleRate: process.env.EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE?.trim() ?? '',
    privyAppId: process.env.EXPO_PUBLIC_PRIVY_APP_ID?.trim() ?? '',
    privyClientId: process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID?.trim() ?? '',
  };
}
