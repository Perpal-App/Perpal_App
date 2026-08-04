import {
  DERIVATION_VERSION,
  DerivationError,
  checkTradingWalletIdentity,
  deriveTradingWallet,
  zeroize,
} from '@/wallet/trading/derivation';

const SALT = 'So11111111111111111111111111111111111111112';

function signature(fill: number): Uint8Array {
  return new Uint8Array(64).fill(fill);
}

describe('deriveTradingWallet', () => {
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
  const derived = { address: 'AAA', version: DERIVATION_VERSION } as const;

  it('reports first derivation when nothing is recorded', () => {
    expect(checkTradingWalletIdentity(null, derived).status).toBe('first-derivation');
  });

  it('matches when the recorded address is identical', () => {
    expect(
      checkTradingWalletIdentity({ address: 'AAA', version: DERIVATION_VERSION }, derived)
        .status,
    ).toBe('match');
  });

  it('flags a mismatch instead of silently adopting a new wallet', () => {
    const result = checkTradingWalletIdentity(
      { address: 'BBB', version: DERIVATION_VERSION },
      derived,
    );

    expect(result.status).toBe('mismatch');
  });

  it('flags a version upgrade separately from a mismatch', () => {
    const result = checkTradingWalletIdentity({ address: 'AAA', version: 0 as 1 }, derived);

    expect(result.status).toBe('version-upgrade');
  });
});
