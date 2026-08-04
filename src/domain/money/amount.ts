/**
 * Base-unit money primitives.
 *
 * Every on-chain amount is an integer in the token's smallest unit (lamports for
 * SOL, 1e6 units for a 6-decimal stablecoin). Amounts are carried as `bigint` and
 * never as `number`, because IEEE-754 silently loses precision above 2^53 and
 * rounds fractions — either of which corrupts an order size or a collateral
 * balance. Nothing in this module accepts or returns a float.
 */

export type TokenDecimals = 0 | 6 | 8 | 9;

/** An exact amount in a token's smallest unit, tagged with its scale. */
export type Amount = {
  readonly baseUnits: bigint;
  readonly decimals: TokenDecimals;
};

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountError';
  }
}

const DIGITS_ONLY = /^\d+$/;

export function amountFromBaseUnits(
  baseUnits: bigint,
  decimals: TokenDecimals,
): Amount {
  return { baseUnits, decimals };
}

export function zeroAmount(decimals: TokenDecimals): Amount {
  return { baseUnits: 0n, decimals };
}

/**
 * Parses a human decimal string ("1.25", "0.000001") into base units.
 *
 * Rejects rather than rounds when the input has more precision than the token
 * supports, so a user can never silently lose a fraction of a deposit. Accepts
 * only plain decimal notation: no exponents, no thousands separators, no spaces.
 */
export function parseAmount(input: string, decimals: TokenDecimals): Amount {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    throw new AmountError('Amount is empty.');
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = '', fraction = ''] = unsigned.split('.');

  if (unsigned.split('.').length > 2) {
    throw new AmountError('Amount has more than one decimal point.');
  }

  if (whole.length === 0 && fraction.length === 0) {
    throw new AmountError('Amount has no digits.');
  }

  if (whole.length > 0 && !DIGITS_ONLY.test(whole)) {
    throw new AmountError('Amount contains non-digit characters.');
  }

  if (fraction.length > 0 && !DIGITS_ONLY.test(fraction)) {
    throw new AmountError('Amount contains non-digit characters.');
  }

  if (fraction.length > decimals) {
    throw new AmountError(
      `Amount has ${fraction.length} decimal places but the token supports ${decimals}.`,
    );
  }

  const padded = fraction.padEnd(decimals, '0');
  const magnitude = BigInt(`${whole === '' ? '0' : whole}${padded}`);

  return { baseUnits: negative ? -magnitude : magnitude, decimals };
}

/** Renders base units as an exact decimal string. Never rounds. */
export function formatAmount(amount: Amount): string {
  const negative = amount.baseUnits < 0n;
  const digits = (negative ? -amount.baseUnits : amount.baseUnits).toString();

  if (amount.decimals === 0) {
    return negative ? `-${digits}` : digits;
  }

  const padded = digits.padStart(amount.decimals + 1, '0');
  const whole = padded.slice(0, padded.length - amount.decimals);
  const fraction = padded.slice(padded.length - amount.decimals).replace(/0+$/, '');
  const body = fraction.length > 0 ? `${whole}.${fraction}` : whole;

  return negative ? `-${body}` : body;
}

function assertSameScale(left: Amount, right: Amount): void {
  if (left.decimals !== right.decimals) {
    throw new AmountError(
      `Cannot combine amounts with different scales (${left.decimals} and ${right.decimals}).`,
    );
  }
}

export function addAmounts(left: Amount, right: Amount): Amount {
  assertSameScale(left, right);

  return { baseUnits: left.baseUnits + right.baseUnits, decimals: left.decimals };
}

export function subtractAmounts(left: Amount, right: Amount): Amount {
  assertSameScale(left, right);

  return { baseUnits: left.baseUnits - right.baseUnits, decimals: left.decimals };
}

export function compareAmounts(left: Amount, right: Amount): -1 | 0 | 1 {
  assertSameScale(left, right);

  if (left.baseUnits < right.baseUnits) {
    return -1;
  }

  return left.baseUnits > right.baseUnits ? 1 : 0;
}

export function isZeroAmount(amount: Amount): boolean {
  return amount.baseUnits === 0n;
}

export function isNegativeAmount(amount: Amount): boolean {
  return amount.baseUnits < 0n;
}

/**
 * Scales an amount by a basis-point rate (10_000 bps = 100%), used for fees and
 * asset weights. Truncates toward zero, which is the conservative direction for a
 * fee estimate, and is stated here so callers never assume rounding.
 */
export function applyBasisPoints(amount: Amount, basisPoints: number): Amount {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new AmountError('Basis points must be a non-negative integer.');
  }

  return {
    baseUnits: (amount.baseUnits * BigInt(basisPoints)) / 10_000n,
    decimals: amount.decimals,
  };
}
