import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base58 } from '@scure/base';

/**
 * Deterministic derivation of the trading wallet (T) from the main wallet (M).
 *
 * The same Privy identity always re-derives the same T, so logout, reinstall, and
 * a new device all recover by signing in again. There is no seed phrase to back
 * up, which is the whole point of D3.
 *
 * The scheme is versioned because it may have to change. If Privy can observe the
 * signature we derive from, then Privy could derive T, and the fix is to mix in a
 * user passphrase. Recording the version alongside the derived key means we can
 * introduce v2 without stranding funds held by a v1 wallet.
 *
 * Nothing here is logged, and the derived secret never leaves this module's
 * callers in serialized form.
 */

export const DERIVATION_VERSION = 1 as const;

export type DerivationVersion = typeof DERIVATION_VERSION;

/**
 * Domain-separated message M signs. It is fixed and contains the version, so a
 * v1 signature can never be reinterpreted as a v2 input.
 */
export const DERIVATION_MESSAGE =
  'perpal.trading-wallet.derivation.v1\n' +
  'Signing this message derives your private trading wallet.\n' +
  'It authorises no transaction and moves no funds.';

const HKDF_INFO = 'perpal/trading-wallet/v1/ed25519';

/** Ed25519 signatures are deterministic (RFC 8032), which is what makes this work. */
const EXPECTED_SIGNATURE_BYTES = 64;

export class DerivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DerivationError';
  }
}

export type TradingWalletIdentity = {
  readonly address: string;
  readonly version: DerivationVersion;
};

export type DerivedTradingWallet = TradingWalletIdentity & {
  /** Raw 32-byte ed25519 seed. Zero it after use; never persist or log it. */
  readonly secretKey: Uint8Array;
};

/**
 * Derives T from M's signature over {@link DERIVATION_MESSAGE}.
 *
 * @param signature - Raw 64-byte ed25519 signature produced by M.
 * @param salt - Stable, non-secret domain salt. The Privy user's wallet address
 *   is a good choice: it varies per user so two users cannot collide, and it is
 *   not secret so it need not be protected.
 */
export function deriveTradingWallet(
  signature: Uint8Array,
  salt: string,
): DerivedTradingWallet {
  if (signature.length !== EXPECTED_SIGNATURE_BYTES) {
    throw new DerivationError(
      `Expected a ${EXPECTED_SIGNATURE_BYTES}-byte signature, received ${signature.length}.`,
    );
  }

  if (salt.trim().length === 0) {
    throw new DerivationError('Derivation salt must not be empty.');
  }

  // HKDF-SHA512 rather than a bare hash: the signature is high-entropy but not
  // uniformly distributed, and HKDF gives domain separation via `info`.
  const seed = hkdf(sha512, signature, utf8ToBytes(salt), utf8ToBytes(HKDF_INFO), 32);
  const publicKey = ed25519.getPublicKey(seed);

  return {
    address: base58.encode(publicKey),
    version: DERIVATION_VERSION,
    secretKey: seed,
  };
}

/** Overwrites secret bytes in place. Call once the signer no longer needs them. */
export function zeroize(secret: Uint8Array): void {
  secret.fill(0);
}

export type IdentityCheck =
  | { readonly status: 'first-derivation' }
  | { readonly status: 'match' }
  | {
      /**
       * The derived address no longer matches what we recorded. Privy may have
       * re-provisioned the embedded wallet, which means funds sit at the previous
       * address. Never silently adopt the new one.
       */
      readonly status: 'mismatch';
      readonly recorded: TradingWalletIdentity;
      readonly derived: TradingWalletIdentity;
    }
  | {
      /** Recorded under an older scheme; migration required before use. */
      readonly status: 'version-upgrade';
      readonly recorded: TradingWalletIdentity;
      readonly derived: TradingWalletIdentity;
    };

/**
 * Compares a freshly derived wallet against the recorded one.
 *
 * This runs on every authenticated session. A mismatch is a recovery flow, not a
 * new wallet: adopting a different T would leave the user's balance behind at an
 * address the app no longer references.
 */
export function checkTradingWalletIdentity(
  recorded: TradingWalletIdentity | null,
  derived: TradingWalletIdentity,
): IdentityCheck {
  if (recorded === null) {
    return { status: 'first-derivation' };
  }

  if (recorded.version !== derived.version) {
    return { status: 'version-upgrade', recorded, derived };
  }

  if (recorded.address !== derived.address) {
    return { status: 'mismatch', recorded, derived };
  }

  return { status: 'match' };
}
