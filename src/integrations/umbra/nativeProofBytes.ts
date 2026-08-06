import type { Groth16ProofBytes } from '@umbra-privacy/sdk/zk-prover';

const U256_BYTE_LENGTH = 32;
const U256_LIMIT = 1n << 256n;

type NativeGroth16Proof = {
  readonly a: { readonly x: string; readonly y: string };
  readonly b: {
    readonly x: readonly string[];
    readonly y: readonly string[];
  };
  readonly c: { readonly x: string; readonly y: string };
};

export function convertNativeProofToBytes(
  proof: NativeGroth16Proof,
): Readonly<Groth16ProofBytes> {
  const proofA = new Uint8Array([
    ...coordinateBytes(proof.a.x, 'a.x'),
    ...coordinateBytes(proof.a.y, 'a.y'),
  ]);
  const proofB = new Uint8Array([
    ...coordinateBytes(proof.b.x[1], 'b.x[1]'),
    ...coordinateBytes(proof.b.x[0], 'b.x[0]'),
    ...coordinateBytes(proof.b.y[1], 'b.y[1]'),
    ...coordinateBytes(proof.b.y[0], 'b.y[0]'),
  ]);
  const proofC = new Uint8Array([
    ...coordinateBytes(proof.c.x, 'c.x'),
    ...coordinateBytes(proof.c.y, 'c.y'),
  ]);

  return {
    proofA: proofA as Groth16ProofBytes['proofA'],
    proofB: proofB as Groth16ProofBytes['proofB'],
    proofC: proofC as Groth16ProofBytes['proofC'],
  };
}

function coordinateBytes(
  value: string | undefined,
  label: string,
): Uint8Array {
  if (value === undefined || !/^\d+$/u.test(value)) {
    throw new Error(`Native Umbra proof has an invalid ${label} coordinate.`);
  }

  let coordinate: bigint;

  try {
    coordinate = BigInt(value);
  } catch {
    throw new Error(`Native Umbra proof has an invalid ${label} coordinate.`);
  }

  if (coordinate < 0n || coordinate >= U256_LIMIT) {
    throw new Error(`Native Umbra proof has an invalid ${label} coordinate.`);
  }

  const bytes = new Uint8Array(U256_BYTE_LENGTH);
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(coordinate & 0xffn);
    coordinate >>= 8n;
  }
  return bytes;
}
