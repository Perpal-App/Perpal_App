import { parseAppConfig, type RawAppEnv } from '@/config/appConfig';

/**
 * Validation is tested through `parseAppConfig` rather than `readAppConfig`.
 *
 * Babel inlines `process.env.EXPO_PUBLIC_*` at transform time, so a test cannot
 * change what `readAppConfig` sees by mutating `process.env`. Keeping the rules in
 * a pure function is what makes them verifiable at all.
 */

const VALID: RawAppEnv = {
  venue: 'drift-devnet',
  cluster: 'devnet',
  apiOrigin: 'https://gateway.example',
  rpcPath: '/v1/rpc',
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
  it('accepts a coherent devnet configuration', () => {
    const result = parseAppConfig(VALID);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.venue).toBe('drift-devnet');
      expect(result.value.cluster).toBe('devnet');
      // Composed once here so no caller concatenates origin and path itself.
      expect(result.value.api.rpcUrl).toBe('https://gateway.example/v1/rpc');
    }
  });

  it('derives the cluster from the venue', () => {
    const result = parseAppConfig(
      withEnv({ venue: 'flash-mainnet', cluster: 'mainnet' }),
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.cluster).toBe('mainnet');
    }
  });

  it('rejects a devnet venue pointed at mainnet', () => {
    expect(issueVariables({ cluster: 'mainnet' })).toContain(
      'EXPO_PUBLIC_SOLANA_CLUSTER',
    );
  });

  it('rejects a mainnet venue pointed at devnet', () => {
    expect(issueVariables({ venue: 'flash-mainnet' })).toContain(
      'EXPO_PUBLIC_SOLANA_CLUSTER',
    );
  });

  it('rejects an unknown venue', () => {
    expect(issueVariables({ venue: 'drift-mainnet' })).toContain(
      'EXPO_PUBLIC_PERPS_VENUE',
    );
  });

  it('names every missing variable at once rather than stopping at the first', () => {
    const variables = issueVariables({
      venue: '',
      apiOrigin: '',
      privyAppId: '',
    });

    expect(variables).toContain('EXPO_PUBLIC_PERPS_VENUE');
    expect(variables).toContain('EXPO_PUBLIC_API_ORIGIN');
    expect(variables).toContain('EXPO_PUBLIC_PRIVY_APP_ID');
  });

  it('rejects a non-https origin on a real host', () => {
    expect(issueVariables({ apiOrigin: 'http://gateway.example' })).toContain(
      'EXPO_PUBLIC_API_ORIGIN',
    );
  });

  it('allows http on loopback so a local Worker can be used', () => {
    expect(parseAppConfig(withEnv({ apiOrigin: 'http://localhost:8787' })).ok).toBe(
      true,
    );
    expect(parseAppConfig(withEnv({ apiOrigin: 'http://127.0.0.1:8787' })).ok).toBe(
      true,
    );
  });

  it('rejects a trailing slash, which would produce a double slash in the RPC url', () => {
    expect(issueVariables({ apiOrigin: 'https://gateway.example/' })).toContain(
      'EXPO_PUBLIC_API_ORIGIN',
    );
  });

  it('rejects a malformed origin', () => {
    expect(issueVariables({ apiOrigin: 'gateway.example' })).toContain(
      'EXPO_PUBLIC_API_ORIGIN',
    );
  });

  it('rejects an rpc path that is not rooted or that trails a slash', () => {
    expect(issueVariables({ rpcPath: 'v1/rpc' })).toContain('EXPO_PUBLIC_RPC_PATH');
    expect(issueVariables({ rpcPath: '/v1/rpc/' })).toContain(
      'EXPO_PUBLIC_RPC_PATH',
    );
  });

  it('rejects a sample rate outside 0..1', () => {
    expect(issueVariables({ telemetrySampleRate: '2' })).toContain(
      'EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE',
    );
    expect(issueVariables({ telemetrySampleRate: '-1' })).toContain(
      'EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE',
    );
    expect(issueVariables({ telemetrySampleRate: 'half' })).toContain(
      'EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE',
    );
  });

  it('treats telemetry as enabled only on an exact "true"', () => {
    for (const value of ['TRUE', 'True', '1', 'yes', '']) {
      const result = parseAppConfig(withEnv({ telemetryEnabled: value }));

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.value.telemetry.enabled).toBe(false);
      }
    }

    const enabled = parseAppConfig(withEnv({ telemetryEnabled: 'true' }));

    expect(enabled.ok && enabled.value.telemetry.enabled).toBe(true);
  });

  it('requires the privy client id as well as the app id', () => {
    expect(issueVariables({ privyClientId: '' })).toContain(
      'EXPO_PUBLIC_PRIVY_CLIENT_ID',
    );
  });
});
