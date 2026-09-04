import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Produces a stable local-only identifier without persisting the source value.
 *
 * Wallet addresses, transaction signatures, provider request IDs, and order IDs must not be
 * copied into MMKV just to index bounded UI state. A namespace is included in the digest so the
 * same source value cannot correlate unrelated records across storage owners.
 */
export function privateIdentifier(namespace: string, value: string): string {
  const digest = sha256(utf8ToBytes(`${namespace}\u0000${value}`));
  let encoded = '';
  for (const byte of digest) encoded += byte.toString(16).padStart(2, '0');
  return encoded;
}
