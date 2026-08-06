/**
 * RPC method allowlist.
 *
 * The gateway is not an open proxy. Only methods the app actually needs are
 * forwarded, and each one is classified, because the classification decides
 * routing: reads can be load-split and hedged, writes cannot.
 *
 * Adding a method here is a deliberate act. An unlisted method is rejected.
 */

export type MethodClass =
  /** Idempotent and safe to hedge across providers. */
  | 'read'
  /** Idempotent but expensive; load-split without hedging. */
  | 'heavy-read'
  /** Not idempotent. Never hedged, never retried blindly. */
  | 'write';

const METHODS: Readonly<Record<string, MethodClass>> = {
  getAccountInfo: 'read',
  getMultipleAccounts: 'read',
  getBalance: 'read',
  getTokenAccountBalance: 'read',
  getTokenAccountsByOwner: 'read',
  getLatestBlockhash: 'read',
  isBlockhashValid: 'read',
  getSlot: 'read',
  getMinimumBalanceForRentExemption: 'read',
  getFeeForMessage: 'read',
  getSignatureStatuses: 'read',
  getSignaturesForAddress: 'read',
  getTransaction: 'read',
  getEpochInfo: 'read',
  getRecentPrioritizationFees: 'read',

  getProgramAccounts: 'heavy-read',
  simulateTransaction: 'heavy-read',

  sendTransaction: 'write',
};

export function classifyMethod(method: string): MethodClass | null {
  return Object.prototype.hasOwnProperty.call(METHODS, method)
    ? (METHODS[method] as MethodClass)
    : null;
}

export function isHedgeable(methodClass: MethodClass): boolean {
  return methodClass === 'read';
}

export function allowlistedMethods(): readonly string[] {
  return Object.keys(METHODS);
}
