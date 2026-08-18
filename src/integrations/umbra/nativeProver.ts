import Zk, {
  ProofLib,
  uniffiInitAsync,
} from '@umbra-privacy/rn-zk-prover';
import type { Groth16ProofBytes } from '@umbra-privacy/sdk/zk-prover';

import { convertNativeProofToBytes } from '@/integrations/umbra/nativeProofBytes';
import { serializeUmbraCircuitInputs } from '@/integrations/umbra/nativeProverInputs';
import {
  getUmbraZkey,
  type UmbraCircuit,
} from '@/integrations/umbra/zkAssets';

export type NativeUmbraProver = {
  readonly prove: (inputs: unknown) => Promise<Readonly<Groth16ProofBytes>>;
};

let initialization: Promise<void> | null = null;

export function createNativeUmbraProver(
  assetBaseUrl: string,
  circuit: UmbraCircuit,
): NativeUmbraProver {
  return {
    prove: async (inputs) => {
      const initializationStartedAtMs = performance.now();
      initialization ??= uniffiInitAsync();
      await initialization;
      console.info('[Perpal Umbra proof]', JSON.stringify({
        circuit,
        durationMs: Math.round(performance.now() - initializationStartedAtMs),
        event: 'native_ready',
      }));
      const asset = await getUmbraZkey(assetBaseUrl, circuit);

      try {
        return proveWithFallback(asset.uri, inputs, circuit);
      } catch (cause) {
        if (
          asset.source !== 'cache' ||
          !(cause instanceof UmbraNativeProofError) ||
          !isRustPanic(cause)
        ) {
          logBackendFailures('all_backends_failed', circuit, cause);
          throw cause;
        }

        logBackendFailures('cached_asset_failed', circuit, cause);
        console.info('[Perpal Umbra proof]', JSON.stringify({
          circuit,
          event: 'asset_refresh_started',
        }));

        const refreshed = await getUmbraZkey(assetBaseUrl, circuit, {
          refresh: true,
        });
        try {
          const proof = proveWithFallback(refreshed.uri, inputs, circuit);
          console.info('[Perpal Umbra proof]', JSON.stringify({
            circuit,
            event: 'asset_refresh_recovered',
          }));
          return proof;
        } catch (refreshFailure) {
          logBackendFailures('asset_refresh_failed', circuit, refreshFailure);
          throw refreshFailure;
        }
      }
    },
  };
}

function proveWithFallback(
  uri: string,
  inputs: unknown,
  circuit: UmbraCircuit,
): Readonly<Groth16ProofBytes> {
  const path = uri.replace(/^file:\/\//u, '');
  let rapidsnarkFailure: unknown;

  try {
    return proveAndVerify(path, inputs, ProofLib.Rapidsnark, circuit);
  } catch (cause) {
    rapidsnarkFailure = cause;
  }

  try {
    return proveAndVerify(path, inputs, ProofLib.Arkworks, circuit);
  } catch (cause) {
    throw new UmbraNativeProofError(rapidsnarkFailure, cause);
  }
}

function logBackendFailures(
  event: string,
  circuit: UmbraCircuit,
  cause: unknown,
): void {
  const failure = cause instanceof UmbraNativeProofError ? cause : null;
  console.error('[Perpal Umbra proof]', JSON.stringify({
    arkworks: nativeFailureDiagnostic(failure?.arkworksFailure),
    circuit,
    event,
    rapidsnark: nativeFailureDiagnostic(failure?.rapidsnarkFailure),
  }));
}

function isRustPanic(failure: UmbraNativeProofError): boolean {
  return [failure.rapidsnarkFailure, failure.arkworksFailure]
    .some((cause) => nativeFailureMessage(cause)?.toLowerCase().includes('rust panic'));
}

function nativeFailureDiagnostic(cause: unknown): {
  readonly detail: string | null;
  readonly errorName: string | null;
  readonly tag: string | null;
} {
  const value = typeof cause === 'object' && cause !== null
    ? cause as {
        readonly inner?: unknown;
        readonly message?: unknown;
        readonly name?: unknown;
        readonly tag?: unknown;
      }
    : null;
  const message = nativeFailureMessage(cause);

  return {
    detail: message === null ? null : redactNativeFailure(message),
    errorName: safeLabel(value?.name),
    tag: safeLabel(value?.tag),
  };
}

function nativeFailureMessage(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) {
    return cause === undefined || cause === null ? null : String(cause);
  }

  const value = cause as { readonly inner?: unknown; readonly message?: unknown };
  const details = Array.isArray(value.inner)
    ? value.inner.filter((entry): entry is string => typeof entry === 'string')
    : [];

  if (details.length > 0) {
    return details.join(' ');
  }

  return typeof value.message === 'string' ? value.message : null;
}

function redactNativeFailure(message: string): string {
  return message
    .replace(/(?:file:\/\/|\/)[^\s,)]+/giu, '[path]')
    .replace(/[1-9]\d{2,}/gu, '[number]')
    .replace(/[a-z0-9+/=_-]{32,}/giu, '[data]')
    .replace(/\s+/gu, ' ')
    .slice(0, 240);
}

function safeLabel(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9_.-]{1,64}$/iu.test(value)
    ? value
    : null;
}

function proveAndVerify(
  path: string,
  inputs: unknown,
  backend: ProofLib,
  circuit: UmbraCircuit,
): Readonly<Groth16ProofBytes> {
  const startedAtMs = performance.now();
  let proofResult: ReturnType<typeof Zk.mopro.generateCircomProof>;

  try {
    proofResult = Zk.mopro.generateCircomProof(
      path,
      serializeUmbraCircuitInputs(inputs),
      backend,
    );
  } catch (cause) {
    console.error('[Perpal Umbra proof]', JSON.stringify({
      backend: backendLabel(backend),
      circuit,
      durationMs: Math.round(performance.now() - startedAtMs),
      event: 'generation_failed',
    }));
    throw cause;
  }
  const generatedAtMs = performance.now();

  let verified: boolean;
  try {
    verified = Zk.mopro.verifyCircomProof(path, proofResult, backend);
  } catch (cause) {
    console.error('[Perpal Umbra proof]', JSON.stringify({
      backend: backendLabel(backend),
      circuit,
      durationMs: Math.round(performance.now() - generatedAtMs),
      event: 'verification_failed',
      outcome: 'native_error',
    }));
    throw cause;
  }
  const verifiedAtMs = performance.now();

  if (!verified) {
    console.error('[Perpal Umbra proof]', JSON.stringify({
      backend: backendLabel(backend),
      circuit,
      durationMs: Math.round(verifiedAtMs - generatedAtMs),
      event: 'verification_failed',
      outcome: 'invalid',
    }));
    throw new Error('Native Umbra proof failed local verification.');
  }
  console.info('[Perpal Umbra proof]', JSON.stringify({
    backend: backendLabel(backend),
    circuit,
    durationMs: Math.round(generatedAtMs - startedAtMs),
    event: 'proof_generated',
  }));
  console.info('[Perpal Umbra proof]', JSON.stringify({
    backend: backendLabel(backend),
    circuit,
    durationMs: Math.round(verifiedAtMs - generatedAtMs),
    event: 'proof_verified',
  }));

  return convertNativeProofToBytes(proofResult.proof);
}

function backendLabel(backend: ProofLib): 'arkworks' | 'rapidsnark' {
  return backend === ProofLib.Rapidsnark ? 'rapidsnark' : 'arkworks';
}

export class UmbraNativeProofError extends Error {
  constructor(
    readonly rapidsnarkFailure: unknown,
    readonly arkworksFailure: unknown,
  ) {
    super('Both native Umbra proof backends failed.');
    this.name = 'UmbraNativeProofError';
  }
}
