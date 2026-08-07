import { parseAppConfig, type RawAppEnv } from '@/config/appConfig';

const VALID: RawAppEnv = {
  cluster: 'mainnet',
  apiOrigin: 'https://gateway.example',
  rpcPath: '/v1/rpc',
  publicRpcPath: '/v1/rpc/public',
  marketDataPath: '/v1/markets',
  marketStreamPath: '/v1/markets/stream',
  swapBuildPath: '/v1/swap/build',
  flashProgramId: '11111111111111111111111111111111',
  flashErRpc: 'https://flash.magicblock.xyz',
  usdtMint: '11111111111111111111111111111111',
  umbraIndexerUrl: 'https://utxo-indexer.api.umbraprivacy.com',
  umbraRelayerUrl: 'https://relayer.api.umbraprivacy.com',
  umbraZkAssetBaseUrl: 'https://zk.api.umbraprivacy.com',
  telemetryEnabled: 'false',
  telemetrySampleRate: '0',
  privyAppId: 'app-id',
  privyClientId: 'client-id',
};

function withEnv(overrides: Partial<RawAppEnv>): RawAppEnv {
  return { ...VALID, ...overrides };
}

function issueVariables(overrides: Partial<RawAppEnv>): readonly string[] {
  const result = parseAppConfig(withEnv(overrides));
  return result.ok ? [] : result.issues.map((issue) => issue.variable);
}

describe('parseAppConfig', () => {
  it('accepts the Flash mainnet configuration', () => {
    const result = parseAppConfig(VALID);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.cluster).toBe('mainnet');
      expect(result.value.api.rpcUrl).toBe('https://gateway.example/v1/rpc');
      expect(result.value.api.publicRpcUrl).toBe(
        'https://gateway.example/v1/rpc/public',
      );
      expect(result.value.api.marketDataUrl).toBe(
        'https://gateway.example/v1/markets',
      );
      expect(result.value.api.marketStreamUrl).toBe(
        'https://gateway.example/v1/markets/stream',
      );
      expect(result.value.privacy.umbraRelayerUrl).toBe(
        'https://relayer.api.umbraprivacy.com',
      );
    }
  });

  it('rejects every non-mainnet configuration', () => {
    expect(issueVariables({ cluster: 'testnet' })).toContain(
      'EXPO_PUBLIC_SOLANA_CLUSTER',
    );
  });

  it('rejects missing provider addresses and malformed paths', () => {
    const variables = issueVariables({
      flashProgramId: 'invalid',
      flashErRpc: 'http://flash.magicblock.xyz',
      usdtMint: '',
      marketDataPath: 'v1/markets',
    });

    expect(variables).toEqual(
      expect.arrayContaining([
        'EXPO_PUBLIC_FLASH_PROGRAM_ID',
        'EXPO_PUBLIC_FLASH_ER_RPC',
        'EXPO_PUBLIC_USDT_MINT',
        'EXPO_PUBLIC_MARKET_DATA_PATH',
      ]),
    );
  });

  it('rejects unsafe origins and invalid telemetry sampling', () => {
    expect(issueVariables({ apiOrigin: 'http://gateway.example' })).toContain(
      'EXPO_PUBLIC_API_ORIGIN',
    );
    expect(issueVariables({ telemetrySampleRate: '2' })).toContain(
      'EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE',
    );
    expect(issueVariables({ umbraRelayerUrl: 'http://relay.example' })).toContain(
      'EXPO_PUBLIC_UMBRA_RELAYER_URL',
    );
  });

  it('requires both public Privy identifiers', () => {
    const variables = issueVariables({ privyAppId: '', privyClientId: '' });

    expect(variables).toEqual(
      expect.arrayContaining([
        'EXPO_PUBLIC_PRIVY_APP_ID',
        'EXPO_PUBLIC_PRIVY_CLIENT_ID',
      ]),
    );
  });
});
