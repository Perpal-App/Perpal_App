import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';

import {
  DERIVATION_MESSAGE,
  DERIVATION_VERSION,
  DerivationError,
  checkTradingWalletIdentity,
  deriveRotatedTradingWallet,
  deriveTradingWallet,
  parseTradingWalletIdentity,
  serializeTradingWalletIdentity,
  verifyDerivationSignature,
  zeroize,
} from '@/wallet/trading/derivation';

const SALT = 'So11111111111111111111111111111111111111112';

function signature(fill: number): Uint8Array {
  return new Uint8Array(64).fill(fill);
}

describe('deriveTradingWallet', () => {
  it('accepts only a valid Privy signature from the active main wallet', () => {
    const secret = new Uint8Array(32).fill(11);
    const publicKey = ed25519.getPublicKey(secret);
    const signed = ed25519.sign(new TextEncoder().encode(DERIVATION_MESSAGE), secret);

    expect(
      verifyDerivationSignature(base64.encode(signed), base58.encode(publicKey)),
    ).toEqual(signed);
    expect(() =>
      verifyDerivationSignature(base64.encode(signature(2)), base58.encode(publicKey)),
    ).toThrow(DerivationError);
  });

  it('is deterministic: the same signature and salt always give the same wallet', () => {
    const first = deriveTradingWallet(signature(7), SALT);
    const second = deriveTradingWallet(signature(7), SALT);

    expect(second.address).toBe(first.address);
    expect(Array.from(second.secretKey)).toEqual(Array.from(first.secretKey));
  });

  it('produces a different wallet for a different signature', () => {
    const a = deriveTradingWallet(signature(7), SALT);
    const b = deriveTradingWallet(signature(8), SALT);

    expect(a.address).not.toBe(b.address);
  });

  it('produces a different wallet for a different salt, so users cannot collide', () => {
    const a = deriveTradingWallet(signature(7), SALT);
    const b = deriveTradingWallet(signature(7), 'a-different-user-wallet');

    expect(a.address).not.toBe(b.address);
  });

  it('derives a 32-byte secret and a base58 address', () => {
    const wallet = deriveTradingWallet(signature(3), SALT);

    expect(wallet.secretKey).toHaveLength(32);
    expect(wallet.generation).toBe(0);
    expect(wallet.version).toBe(DERIVATION_VERSION);
    // base58 excludes 0, O, I, l by construction.
    expect(wallet.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it('rejects a signature of the wrong length rather than deriving from it', () => {
    expect(() => deriveTradingWallet(new Uint8Array(32), SALT)).toThrow(DerivationError);
    expect(() => deriveTradingWallet(new Uint8Array(65), SALT)).toThrow(DerivationError);
  });

  it('rejects an empty salt', () => {
    expect(() => deriveTradingWallet(signature(1), '   ')).toThrow(DerivationError);
  });
});

describe('zeroize', () => {
  it('overwrites the secret in place', () => {
    const wallet = deriveTradingWallet(signature(9), SALT);

    zeroize(wallet.secretKey);

    expect(Array.from(wallet.secretKey).every((byte) => byte === 0)).toBe(true);
  });
});

describe('checkTradingWalletIdentity', () => {
  const derived = { address: 'AAA', generation: 0, version: DERIVATION_VERSION } as const;

  it('reports first derivation when nothing is recorded', () => {
    expect(checkTradingWalletIdentity(null, derived).status).toBe('first-derivation');
  });

  it('matches when the recorded address is identical', () => {
    expect(
      checkTradingWalletIdentity({ address: 'AAA', generation: 0, version: DERIVATION_VERSION }, derived)
        .status,
    ).toBe('match');
  });

  it('flags a mismatch instead of silently adopting a new wallet', () => {
    const result = checkTradingWalletIdentity(
      { address: 'BBB', generation: 0, version: DERIVATION_VERSION },
      derived,
    );

    expect(result.status).toBe('mismatch');
  });

  it('flags a version upgrade separately from a mismatch', () => {
    const result = checkTradingWalletIdentity({ address: 'AAA', generation: 0, version: 1 }, derived);

    expect(result.status).toBe('version-upgrade');
  });
});

describe('parseTradingWalletIdentity', () => {
  it('accepts only the current version and a valid base58 address', () => {
    const address = deriveTradingWallet(signature(4), SALT).address;

    expect(
      parseTradingWalletIdentity(
        JSON.stringify({ address, version: DERIVATION_VERSION }),
      ),
    ).toEqual({ address, generation: 0, version: DERIVATION_VERSION });
    expect(parseTradingWalletIdentity('{"address":"bad","version":1}')).toBeNull();
    expect(
      parseTradingWalletIdentity(JSON.stringify({ address, version: 1 })),
    ).toEqual({ address, generation: 0, version: 1 });
    expect(parseTradingWalletIdentity('{not json')).toBeNull();
  });

  it('never serializes derived secret bytes into recovery identity', () => {
    const derived = deriveTradingWallet(signature(5), SALT);
    const serialized = serializeTradingWalletIdentity(derived);

    expect(Object.keys(JSON.parse(serialized) as object)).toEqual([
      'address',
      'generation',
      'version',
    ]);
    expect(serialized).not.toContain('secretKey');
  });
});

describe('deriveRotatedTradingWallet', () => {
  it('derives a deterministic, generation-bound address without mutating the root', () => {
    const root = deriveTradingWallet(signature(6), SALT);
    const original = Uint8Array.from(root.secretKey);
    const first = deriveRotatedTradingWallet(root.secretKey, SALT, 1);
    const again = deriveRotatedTradingWallet(root.secretKey, SALT, 1);

    expect(first.address).toBe(again.address);
    expect(first.address).not.toBe(root.address);
    expect(first.generation).toBe(1);
    expect(root.secretKey).toEqual(original);
  });
});
