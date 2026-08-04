import type { PrivyPublicConfig } from '@/config/publicEnv';

/**
 * The single typed view of build-time configuration.
 *
 * Rules this module enforces, rather than trusting callers to remember:
 *
 * - No endpoint, cluster, or program value is ever hardcoded. Every value comes
 *   from `EXPO_PUBLIC_*`, which Expo inlines at bundle time.
 * - Missing or malformed values fail closed with the exact variable names, so a
 *   misconfigured build shows a useful screen instead of dialling a wrong network.
 * - The venue and the cluster are two independent variables that are then
 *   cross-checked. A half-edited env file cannot produce a devnet venue pointed
 *   at mainnet, which is the mistake that would be expensive.
 */

/**
 * Which perps venue this binary was built against.
 *
 * This is a build target, not a runtime setting. Devnet trades on Drift; mainnet
 * trades on Flash. They are different protocols with different SDKs, so the
 * selection happens at bundle time and only one adapter is reachable per build.
 */
export type PerpsVenueId = 'drift-devnet' | 'flash-mainnet';

export type SolanaCluster = 'devnet' | 'mainnet';

/** Cluster is derived from the venue, never configured independently. */
const VENUE_CLUSTER: Readonly<Record<PerpsVenueId, SolanaCluster>> = {
  'drift-devnet': 'devnet',
  'flash-mainnet': 'mainnet',
};

export type AppConfig = {
  readonly venue: PerpsVenueId;
  readonly cluster: SolanaCluster;
  readonly privy: PrivyPublicConfig;
  readonly api: {
    /** Worker origin, no trailing slash. */
    readonly origin: string;
    /** Path on the Worker that proxies Solana JSON-RPC. */
    readonly rpcPath: string;
    /** Absolute RPC URL, composed once here so callers never string-concatenate. */
    readonly rpcUrl: string;
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

const VENUE_IDS: readonly PerpsVenueId[] = ['drift-devnet', 'flash-mainnet'];
const CLUSTERS: readonly SolanaCluster[] = ['devnet', 'mainnet'];

function isVenueId(value: string): value is PerpsVenueId {
  return (VENUE_IDS as readonly string[]).includes(value);
}

function isCluster(value: string): value is SolanaCluster {
  return (CLUSTERS as readonly string[]).includes(value);
}

/** The raw, untrusted string form of every configuration variable. */
export type RawAppEnv = {
  readonly venue: string;
  readonly cluster: string;
  readonly apiOrigin: string;
  readonly rpcPath: string;
  readonly telemetryEnabled: string;
  readonly telemetrySampleRate: string;
  readonly privyAppId: string;
  readonly privyClientId: string;
};

/**
 * Reads the raw variables.
 *
 * Direct `process.env.EXPO_PUBLIC_*` property access is required: Babel
 * substitutes these statically at bundle time, so dynamic indexing yields
 * `undefined` in a release build. That same inlining is why validation lives in
 * {@link parseAppConfig} instead of here — a test cannot influence an inlined
 * literal, so the parsing logic takes its input as an argument.
 */
export function readRawAppEnv(): RawAppEnv {
  return {
    venue: process.env.EXPO_PUBLIC_PERPS_VENUE?.trim() ?? '',
    cluster: process.env.EXPO_PUBLIC_SOLANA_CLUSTER?.trim() ?? '',
    apiOrigin: process.env.EXPO_PUBLIC_API_ORIGIN?.trim() ?? '',
    rpcPath: process.env.EXPO_PUBLIC_RPC_PATH?.trim() ?? '',
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

  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    issues.push({
      variable: 'EXPO_PUBLIC_API_ORIGIN',
      problem: 'must be an absolute URL',
    });
    return '';
  }

  // Plain http is allowed only for loopback, so a device build cannot ship
  // cleartext to a real host.
  const isLoopback =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    issues.push({
      variable: 'EXPO_PUBLIC_API_ORIGIN',
      problem: 'must use https, except http on localhost',
    });
    return '';
  }

  if (raw.endsWith('/')) {
    issues.push({
      variable: 'EXPO_PUBLIC_API_ORIGIN',
      problem: 'must not have a trailing slash',
    });
    return '';
  }

  return raw;
}

function validateRpcPath(raw: string, issues: ConfigIssue[]): string {
  if (raw.length === 0) {
    issues.push({ variable: 'EXPO_PUBLIC_RPC_PATH', problem: 'is required' });
    return '';
  }

  if (!raw.startsWith('/') || raw.endsWith('/')) {
    issues.push({
      variable: 'EXPO_PUBLIC_RPC_PATH',
      problem: 'must start with "/" and not end with one',
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

/** Validates raw configuration. Pure, so it is directly testable. */
export function parseAppConfig(raw: RawAppEnv): AppConfigResult {
  const issues: ConfigIssue[] = [];

  if (raw.venue.length === 0) {
    issues.push({ variable: 'EXPO_PUBLIC_PERPS_VENUE', problem: 'is required' });
  } else if (!isVenueId(raw.venue)) {
    issues.push({
      variable: 'EXPO_PUBLIC_PERPS_VENUE',
      problem: `must be one of ${VENUE_IDS.join(' | ')}`,
    });
  }

  if (raw.cluster.length === 0) {
    issues.push({ variable: 'EXPO_PUBLIC_SOLANA_CLUSTER', problem: 'is required' });
  } else if (!isCluster(raw.cluster)) {
    issues.push({
      variable: 'EXPO_PUBLIC_SOLANA_CLUSTER',
      problem: `must be one of ${CLUSTERS.join(' | ')}`,
    });
  }

  // The cross-check that matters: a devnet venue must never be pointed at a
  // mainnet cluster, and vice versa. Both are declared so a partially edited env
  // file is rejected rather than silently resolved in favour of one of them.
  if (isVenueId(raw.venue) && isCluster(raw.cluster)) {
    const expected = VENUE_CLUSTER[raw.venue];

    if (expected !== raw.cluster) {
      issues.push({
        variable: 'EXPO_PUBLIC_SOLANA_CLUSTER',
        problem: `must be "${expected}" for venue "${raw.venue}"`,
      });
    }
  }

  const origin = validateOrigin(raw.apiOrigin, issues);
  const rpcPath = validateRpcPath(raw.rpcPath, issues);
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

  if (!isVenueId(raw.venue) || issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      venue: raw.venue,
      cluster: VENUE_CLUSTER[raw.venue],
      privy: { appId: raw.privyAppId, clientId: raw.privyClientId },
      api: {
        origin,
        rpcPath,
        rpcUrl: `${origin}${rpcPath}`,
      },
      telemetry: {
        enabled: raw.telemetryEnabled === 'true',
        sampleRate: sampleRate,
      },
    },
  };
}

/** Reads and validates the active build configuration. */
export function readAppConfig(): AppConfigResult {
  return parseAppConfig(readRawAppEnv());
}
