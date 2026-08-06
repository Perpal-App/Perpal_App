import Zk, {
  ProofLib,
  uniffiInitAsync,
} from '@umbra-privacy/rn-zk-prover';
import {
  convertSnarkjsProofToBytes,
  type Groth16ProofBytes,
  type SnarkjsGroth16Proof,
} from '@umbra-privacy/sdk/zk-prover';

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
      const uri = await getUmbraZkey(assetBaseUrl, circuit);
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
    },
  };
}

function proveAndVerify(
  path: string,
  inputs: unknown,
  backend: ProofLib,
): Readonly<Groth16ProofBytes> {
  const proofResult = Zk.mopro.generateCircomProof(
    path,
    JSON.stringify(toCircomJson(inputs)),
    backend,
  );

  if (!Zk.mopro.verifyCircomProof(path, proofResult, backend)) {
    throw new Error('Native Umbra proof failed local verification.');
  }

  const { a, b, c } = proofResult.proof;
  const proof: SnarkjsGroth16Proof = {
    pi_a: [a.x, a.y, a.z],
    pi_b: [
      [b.x[0] ?? '', b.x[1] ?? ''],
      [b.y[0] ?? '', b.y[1] ?? ''],
      [b.z[0] ?? '', b.z[1] ?? ''],
    ],
    pi_c: [c.x, c.y, c.z],
  };

  return convertSnarkjsProofToBytes(proof);
}

function toCircomJson(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Uint8Array) {
    return Array.from(value, String);
  }

  if (Array.isArray(value)) {
    return value.map(toCircomJson);
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toCircomJson(entry)]),
    );
  }

  return value;
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
