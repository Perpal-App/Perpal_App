import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base58, base64 } from '@scure/base';

/**
 * Deterministic derivation of the trading wallet (T) from the main wallet (M).
 *
 * The same Privy identity always re-derives the same root T, so a lost local
 * activation can recover by signing the fixed message again. After activation
 * the verified seed is kept in platform secure storage; normal app sessions do
 * not ask the user to unlock it again.
 *
 * The scheme is versioned because it may have to change. If Privy can observe the
 * signature we derive from, then Privy could derive T, and the fix is to mix in a
 * user passphrase. Recording the version alongside the derived key means we can
 * introduce v2 without stranding funds held by a v1 wallet.
 *
 * Nothing here is logged, and the derived secret never leaves this module's
 * callers in serialized form.
 */

export const DERIVATION_VERSION = 2 as const;

export type DerivationVersion = 1 | typeof DERIVATION_VERSION;

/**
 * Domain-separated message M signs. It is fixed and contains the version, so a
 * v1 signature can never be reinterpreted as a v2 input.
 */
export const DERIVATION_MESSAGE =
  'perpal.trading-wallet.derivation.v2\n' +
  'Signing this message derives your private trading wallet.\n' +
  'It authorises no transaction and moves no funds.';

const HKDF_INFO = 'perpal/trading-wallet/v2/ed25519';
const ROTATION_HKDF_INFO = 'perpal/trading-wallet/v2/rotation';
const FLASH_FEE_HKDF_INFO = 'perpal/trading-wallet/v2/flash-fee-payer';

/** Ed25519 signatures are deterministic (RFC 8032), which is what makes this work. */
const EXPECTED_SIGNATURE_BYTES = 64;

export class DerivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DerivationError';
  }
}

export function verifyDerivationSignature(
  encodedSignature: string,
  mainWalletAddress: string,
): Uint8Array {
  try {
    const signature = base64.decode(encodedSignature);
    const publicKey = base58.decode(mainWalletAddress);

    if (
      signature.length !== EXPECTED_SIGNATURE_BYTES ||
      publicKey.length !== 32 ||
      !ed25519.verify(signature, utf8ToBytes(DERIVATION_MESSAGE), publicKey)
    ) {
      throw new Error('invalid signature');
    }

    return signature;
  } catch {
    throw new DerivationError('Privy returned an invalid derivation signature.');
  }
}

export type TradingWalletIdentity = {
  readonly address: string;
  readonly generation: number;
  readonly version: DerivationVersion;
};

export function parseTradingWalletIdentity(
  value: string,
): TradingWalletIdentity | null {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;

    if (
      (candidate.version !== 1 && candidate.version !== DERIVATION_VERSION) ||
      typeof candidate.address !== 'string' ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(candidate.address)
    ) {
      return null;
    }

    const generation = candidate.generation ?? 0;

    if (!Number.isSafeInteger(generation) || Number(generation) < 0) {
      return null;
    }

    return {
      address: candidate.address,
      generation: Number(generation),
      version: candidate.version,
    };
  } catch {
    return null;
  }
}

/** Serializes only recovery identity fields, even when passed a derived wallet. */
export function serializeTradingWalletIdentity(
  identity: TradingWalletIdentity,
): string {
  return JSON.stringify({
    address: identity.address,
    generation: identity.generation,
    version: identity.version,
  });
}

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
    generation: 0,
    version: DERIVATION_VERSION,
    secretKey: seed,
  };
}

/** Derives a new T from the activated root without another Privy signature. */
export function deriveRotatedTradingWallet(
  rootSeed: Uint8Array,
  salt: string,
  generation: number,
): DerivedTradingWallet {
  if (rootSeed.length !== 32) {
    throw new DerivationError('Trading-wallet root seed must contain 32 bytes.');
  }

  if (salt.trim().length === 0) {
    throw new DerivationError('Derivation salt must not be empty.');
  }

  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new DerivationError('Rotation generation must be a positive integer.');
  }

  const info = utf8ToBytes(`${ROTATION_HKDF_INFO}/${generation}`);
  const seed = hkdf(sha512, rootSeed, utf8ToBytes(salt), info, 32);

  return {
    address: base58.encode(ed25519.getPublicKey(seed)),
    generation,
    version: DERIVATION_VERSION,
    secretKey: seed,
  };
}

/** Derives Flash's required distinct fee payer from T without another wallet. */
export function deriveFlashFeeWallet(
  tradingSeed: Uint8Array,
  tradingAddress: string,
): DerivedTradingWallet {
  if (tradingSeed.length !== 32 || tradingAddress.trim().length === 0) {
    throw new DerivationError('Private trading wallet is unavailable.');
  }
  const seed = hkdf(
    sha512,
    tradingSeed,
    utf8ToBytes(tradingAddress),
    utf8ToBytes(FLASH_FEE_HKDF_INFO),
    32,
  );
  return {
    address: base58.encode(ed25519.getPublicKey(seed)),
    generation: 0,
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
    return { status: 'version-upgrade', recorded, derived: publicIdentity(derived) };
  }

  if (
    recorded.generation !== derived.generation ||
    recorded.address !== derived.address
  ) {
    return { status: 'mismatch', recorded, derived: publicIdentity(derived) };
  }

  return { status: 'match' };
}

function publicIdentity(identity: TradingWalletIdentity): TradingWalletIdentity {
  return {
    address: identity.address,
    generation: identity.generation,
    version: identity.version,
  };
}
