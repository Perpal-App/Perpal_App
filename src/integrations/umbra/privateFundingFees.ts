const CREATE_FEE_NUMERATOR = 57n;
const CREATE_FEE_DENOMINATOR = 16_384n;

/** Fee charged by the pinned Umbra SDK for each public-to-private note. */
export function estimateUmbraCreateFee(amountBaseUnits: bigint): bigint {
  if (amountBaseUnits < 0n) {
    throw new RangeError('Umbra fee input cannot be negative.');
  }

  return amountBaseUnits * CREATE_FEE_NUMERATOR / CREATE_FEE_DENOMINATOR;
}

/** Amount that reaches the private recipient after Umbra's create-note fee. */
export function creditedUmbraAmount(amountBaseUnits: bigint): bigint {
  return amountBaseUnits - estimateUmbraCreateFee(amountBaseUnits);
}

/** Smallest public amount that yields at least the requested private amount. */
export function minimumUmbraInputForCredit(
  creditedBaseUnits: bigint,
): bigint {
  if (creditedBaseUnits < 0n) {
    throw new RangeError('Umbra credited amount cannot be negative.');
  }

  const retainedNumerator = CREATE_FEE_DENOMINATOR - CREATE_FEE_NUMERATOR;
  let input = (
    creditedBaseUnits * CREATE_FEE_DENOMINATOR + retainedNumerator - 1n
  ) / retainedNumerator;

  while (input > 0n && creditedUmbraAmount(input - 1n) >= creditedBaseUnits) {
    input -= 1n;
  }
  return input;
}
