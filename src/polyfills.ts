/**
 * Cryptographic and encoding polyfills.
 *
 * This module must be evaluated before the router mounts and before any Privy,
 * Solana, Umbra or MagicBlock module is imported. Import order inside this file
 * is significant.
 *
 * - `fast-text-encoding`      TextEncoder / TextDecoder (required by Privy)
 * - `react-native-get-random-values`  crypto.getRandomValues (required by Privy
 *                             and by the audited key-derivation libraries)
 * - `@ethersproject/shims`    misc runtime shims required by Privy's peer set
 * - `expo-crypto`             native WebCrypto digest used by Solana Kit PDAs
 * - `@solana/webcrypto-ed25519-polyfill`  Kit Ed25519 CryptoKeys on Hermes
 * - `buffer`                  required by the Solana SDK transaction models
 */
import 'fast-text-encoding';
import 'react-native-get-random-values';
import '@ethersproject/shims';
import { Buffer } from 'buffer';
import * as ExpoCrypto from 'expo-crypto';
import { install as installEd25519 } from '@solana/webcrypto-ed25519-polyfill';

const globals = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
globals.Buffer ??= Buffer;

// Hermes can drop Buffer's prototype from subarray views. Anchor decoders then
// receive a Uint8Array without readUIntLE, so repair only the affected runtime.
if (typeof Buffer.alloc(1).subarray(0, 1).readUIntLE !== 'function') {
  const subarray = Buffer.prototype.subarray;

  Buffer.prototype.subarray = function bufferSubarray(
    start?: number,
    end?: number,
  ) {
    const view = subarray.call(this, start, end);
    Object.setPrototypeOf(view, Buffer.prototype);
    return view;
  };
}

if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  // Fail loudly at startup rather than producing weak key material later.
  throw new Error('polyfills: crypto.getRandomValues is unavailable');
}

if (typeof globalThis.crypto.subtle?.digest !== 'function') {
  Object.defineProperty(globalThis.crypto, 'subtle', {
    configurable: true,
    value: {
      digest: (algorithm: AlgorithmIdentifier, data: BufferSource) =>
        ExpoCrypto.digest(
          (typeof algorithm === 'string'
            ? algorithm
            : algorithm.name) as ExpoCrypto.CryptoDigestAlgorithm,
          toNativeBytes(data),
        ),
    },
  });
}

// Solana Kit's documented fallback for runtimes without WebCrypto Ed25519.
// Umbra uses Kit CryptoKeys for its proving signers during registration.
installEd25519();

function toNativeBytes(data: BufferSource): Uint8Array<ArrayBuffer> {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);

  const nativeBytes = new Uint8Array(bytes.byteLength);
  nativeBytes.set(bytes);
  return nativeBytes;
}
