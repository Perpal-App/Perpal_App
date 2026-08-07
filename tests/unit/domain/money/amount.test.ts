import {
  AmountError,
  addAmounts,
  amountFromBaseUnits,
  applyBasisPoints,
  compareAmounts,
  formatAmountWithCommas,
  formatAmount,
  formatCompactTokenPrice,
  formatCompactUsd,
  formatDetailedUsd,
  isNegativeAmount,
  parseAmount,
  subtractAmounts,
  zeroAmount,
} from '@/domain/money/amount';

describe('parseAmount', () => {
  it('parses whole and fractional values at wSOL scale', () => {
    expect(parseAmount('1', 9).baseUnits).toBe(1_000_000_000n);
    expect(parseAmount('1.5', 9).baseUnits).toBe(1_500_000_000n);
    expect(parseAmount('0.000000001', 9).baseUnits).toBe(1n);
  });

  it('parses stablecoin scale', () => {
    expect(parseAmount('12.34', 6).baseUnits).toBe(12_340_000n);
  });

  it('accepts values far beyond IEEE-754 exact range without loss', () => {
    // 2^53 lamports + 1: a float would round this away.
    expect(parseAmount('9007199.254740993', 9).baseUnits).toBe(9_007_199_254_740_993n);
  });

  it('accepts leading-dot and trailing-dot forms', () => {
    expect(parseAmount('.5', 9).baseUnits).toBe(500_000_000n);
    expect(parseAmount('5.', 9).baseUnits).toBe(5_000_000_000n);
  });

  it('rejects excess precision instead of rounding it away', () => {
    expect(() => parseAmount('0.0000000001', 9)).toThrow(AmountError);
    expect(() => parseAmount('1.1234567', 6)).toThrow(AmountError);
  });

  it('rejects malformed input', () => {
    for (const bad of ['', '   ', 'abc', '1.2.3', '1e9', '1_000', '1,5', '$5']) {
      expect(() => parseAmount(bad, 9)).toThrow(AmountError);
    }
  });

  it('parses negative amounts', () => {
    expect(parseAmount('-2.5', 9).baseUnits).toBe(-2_500_000_000n);
  });
});

describe('formatAmount', () => {
  it('round-trips through parseAmount', () => {
    for (const value of ['0', '1', '1.5', '0.000000001', '123456.789']) {
      expect(formatAmount(parseAmount(value, 9))).toBe(value);
    }
  });

  it('trims trailing zeros but keeps significant digits', () => {
    expect(formatAmount(amountFromBaseUnits(1_500_000_000n, 9))).toBe('1.5');
    expect(formatAmount(amountFromBaseUnits(1n, 9))).toBe('0.000000001');
    expect(formatAmount(zeroAmount(9))).toBe('0');
  });

  it('formats zero-decimal tokens', () => {
    expect(formatAmount(amountFromBaseUnits(42n, 0))).toBe('42');
  });

  it('formats negatives', () => {
    expect(formatAmount(amountFromBaseUnits(-2_500_000_000n, 9))).toBe('-2.5');
  });
});

describe('display formatting', () => {
  it('keeps exact math while fitting live market and portfolio values', () => {
    const btc = amountFromBaseUnits(64_628_266_872n, 6);
    const openInterest = amountFromBaseUnits(395_855_907_958n, 6);

    expect(formatCompactTokenPrice(btc)).toBe('$64,628.27');
    expect(formatCompactUsd(openInterest)).toBe('$395.86K');
    expect(formatDetailedUsd(openInterest)).toBe('$395,855.91');
    expect(formatAmountWithCommas(openInterest)).toBe('395,855.907958');
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly', () => {
    const a = parseAmount('0.1', 9);
    const b = parseAmount('0.2', 9);

    // 0.1 + 0.2 === 0.3 exactly, which floats cannot do.
    expect(formatAmount(addAmounts(a, b))).toBe('0.3');
    expect(formatAmount(subtractAmounts(b, a))).toBe('0.1');
  });

  it('produces negative results when subtracting a larger amount', () => {
    const result = subtractAmounts(parseAmount('1', 9), parseAmount('3', 9));

    expect(isNegativeAmount(result)).toBe(true);
    expect(formatAmount(result)).toBe('-2');
  });

  it('refuses to combine mismatched scales', () => {
    const lamports = parseAmount('1', 9);
    const stable = parseAmount('1', 6);

    expect(() => addAmounts(lamports, stable)).toThrow(AmountError);
    expect(() => subtractAmounts(lamports, stable)).toThrow(AmountError);
    expect(() => compareAmounts(lamports, stable)).toThrow(AmountError);
  });

  it('compares amounts', () => {
    expect(compareAmounts(parseAmount('1', 9), parseAmount('2', 9))).toBe(-1);
    expect(compareAmounts(parseAmount('2', 9), parseAmount('1', 9))).toBe(1);
    expect(compareAmounts(parseAmount('1', 9), parseAmount('1', 9))).toBe(0);
  });
});

describe('applyBasisPoints', () => {
  it('applies a fee rate', () => {
    // 10 bps of 1 SOL = 0.001 SOL
    expect(formatAmount(applyBasisPoints(parseAmount('1', 9), 10))).toBe('0.001');
  });

  it('truncates toward zero rather than rounding up', () => {
    const result = applyBasisPoints(amountFromBaseUnits(9n, 9), 1);

    expect(result.baseUnits).toBe(0n);
  });

  it('rejects invalid rates', () => {
    expect(() => applyBasisPoints(parseAmount('1', 9), -1)).toThrow(AmountError);
    expect(() => applyBasisPoints(parseAmount('1', 9), 1.5)).toThrow(AmountError);
  });
});
