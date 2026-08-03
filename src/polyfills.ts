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
 *
 * `buffer` is deliberately not polyfilled. Add it only if the Solana client we
 * select at the protocol boundary requires it.
 */
import 'fast-text-encoding';
import 'react-native-get-random-values';
import '@ethersproject/shims';

if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  // Fail loudly at startup rather than producing weak key material later.
  throw new Error('polyfills: crypto.getRandomValues is unavailable');
}
