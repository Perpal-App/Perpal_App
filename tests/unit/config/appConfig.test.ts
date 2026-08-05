import { parseAppConfig, type RawAppEnv } from '@/config/appConfig';

const VALID: RawAppEnv = {
  cluster: 'mainnet',
  apiOrigin: 'https://gateway.example',
  rpcPath: '/v1/rpc',
  marketDataPath: '/v1/markets',
  driftProgramId: '11111111111111111111111111111111',
  flashProgramId: '11111111111111111111111111111111',
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
  it('accepts both provider programs on one mainnet build', () => {
    const result = parseAppConfig(VALID);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.cluster).toBe('mainnet');
      expect(result.value.api.rpcUrl).toBe('https://gateway.example/v1/rpc');
      expect(result.value.api.marketDataUrl).toBe(
        'https://gateway.example/v1/markets',
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
      driftProgramId: '',
      flashProgramId: 'invalid',
      marketDataPath: 'v1/markets',
    });

    expect(variables).toEqual(
      expect.arrayContaining([
        'EXPO_PUBLIC_DRIFT_PROGRAM_ID',
        'EXPO_PUBLIC_FLASH_PROGRAM_ID',
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
