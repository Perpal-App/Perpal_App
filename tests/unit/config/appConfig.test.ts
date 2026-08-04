import { readAppConfig } from '@/config/appConfig';

/**
 * `appConfig` reads `process.env.EXPO_PUBLIC_*` directly, because Expo inlines
 * those reads at bundle time and dynamic indexing would yield undefined in a
 * release build. Tests therefore set the same variables on `process.env`.
 */

const VALID = {
  EXPO_PUBLIC_PERPS_VENUE: 'drift-devnet',
  EXPO_PUBLIC_SOLANA_CLUSTER: 'devnet',
  EXPO_PUBLIC_API_ORIGIN: 'https://gateway.example',
  EXPO_PUBLIC_RPC_PATH: '/v1/rpc',
  EXPO_PUBLIC_PRIVY_APP_ID: 'app-id',
  EXPO_PUBLIC_PRIVY_CLIENT_ID: 'client-id',
  EXPO_PUBLIC_TELEMETRY_ENABLED: 'false',
  EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE: '0',
} as const;

const KEYS = Object.keys(VALID) as (keyof typeof VALID)[];

function apply(overrides: Partial<Record<keyof typeof VALID, string>>): void {
  for (const key of KEYS) {
    const value = key in overrides ? overrides[key] : VALID[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function issueVariables(): readonly string[] {
  const result = readAppConfig();

  return result.ok ? [] : result.issues.map((issue) => issue.variable);
}

describe('readAppConfig', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('accepts a coherent devnet configuration', () => {
    apply({});

    const result = readAppConfig();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.venue).toBe('drift-devnet');
      expect(result.value.cluster).toBe('devnet');
      // Composed once, so no caller ever concatenates origin and path.
      expect(result.value.api.rpcUrl).toBe('https://gateway.example/v1/rpc');
    }
  });

  it('rejects a devnet venue pointed at mainnet', () => {
    apply({ EXPO_PUBLIC_SOLANA_CLUSTER: 'mainnet' });

    expect(issueVariables()).toContain('EXPO_PUBLIC_SOLANA_CLUSTER');
  });

  it('rejects an unknown venue', () => {
    apply({ EXPO_PUBLIC_PERPS_VENUE: 'drift-mainnet' });

    expect(issueVariables()).toContain('EXPO_PUBLIC_PERPS_VENUE');
  });

  it('names every missing variable at once rather than failing on the first', () => {
    apply({
      EXPO_PUBLIC_PERPS_VENUE: undefined,
      EXPO_PUBLIC_API_ORIGIN: undefined,
      EXPO_PUBLIC_PRIVY_APP_ID: undefined,
    });

    const variables = issueVariables();

    expect(variables).toContain('EXPO_PUBLIC_PERPS_VENUE');
    expect(variables).toContain('EXPO_PUBLIC_API_ORIGIN');
    expect(variables).toContain('EXPO_PUBLIC_PRIVY_APP_ID');
  });

  it('rejects a non-https origin on a real host', () => {
    apply({ EXPO_PUBLIC_API_ORIGIN: 'http://gateway.example' });

    expect(issueVariables()).toContain('EXPO_PUBLIC_API_ORIGIN');
  });

  it('allows http on loopback so a local Worker can be used', () => {
    apply({ EXPO_PUBLIC_API_ORIGIN: 'http://localhost:8787' });

    expect(readAppConfig().ok).toBe(true);
  });

  it('rejects a trailing slash, which would produce a double-slash RPC path', () => {
    apply({ EXPO_PUBLIC_API_ORIGIN: 'https://gateway.example/' });

    expect(issueVariables()).toContain('EXPO_PUBLIC_API_ORIGIN');
  });

  it('rejects a malformed origin', () => {
    apply({ EXPO_PUBLIC_API_ORIGIN: 'gateway.example' });

    expect(issueVariables()).toContain('EXPO_PUBLIC_API_ORIGIN');
  });

  it('rejects an rpc path that is not rooted', () => {
    apply({ EXPO_PUBLIC_RPC_PATH: 'v1/rpc' });

    expect(issueVariables()).toContain('EXPO_PUBLIC_RPC_PATH');
  });

  it('rejects a sample rate outside 0..1', () => {
    apply({ EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE: '2' });

    expect(issueVariables()).toContain('EXPO_PUBLIC_TELEMETRY_SAMPLE_RATE');
  });

  it('treats telemetry as enabled only on an exact "true"', () => {
    apply({ EXPO_PUBLIC_TELEMETRY_ENABLED: 'TRUE' });

    const result = readAppConfig();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.telemetry.enabled).toBe(false);
    }
  });
});
