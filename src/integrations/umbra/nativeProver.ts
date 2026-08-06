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
      initialization ??= uniffiInitAsync();
      await initialization;
      const asset = await getUmbraZkey(assetBaseUrl, circuit);

      try {
        return proveWithFallback(asset.uri, inputs);
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
          const proof = proveWithFallback(refreshed.uri, inputs);
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
): Readonly<Groth16ProofBytes> {
  const path = uri.replace(/^file:\/\//u, '');
  let rapidsnarkFailure: unknown;

  try {
    return proveAndVerify(path, inputs, ProofLib.Rapidsnark);
  } catch (cause) {
    rapidsnarkFailure = cause;
  }

  try {
    return proveAndVerify(path, inputs, ProofLib.Arkworks);
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
): Readonly<Groth16ProofBytes> {
  const proofResult = Zk.mopro.generateCircomProof(
    path,
    serializeUmbraCircuitInputs(inputs),
    backend,
  );

  if (!Zk.mopro.verifyCircomProof(path, proofResult, backend)) {
    throw new Error('Native Umbra proof failed local verification.');
  }

  return convertNativeProofToBytes(proofResult.proof);
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
