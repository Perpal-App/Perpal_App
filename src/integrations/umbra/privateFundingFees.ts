const CREATE_FEE_NUMERATOR = 57n;
const CREATE_FEE_DENOMINATOR = 16_384n;

/** Fee charged by the pinned Umbra SDK for each public-to-private note. */
export function estimateUmbraCreateFee(amountBaseUnits: bigint): bigint {
  if (amountBaseUnits < 0n) {
    throw new RangeError('Umbra fee input cannot be negative.');
  }

  return amountBaseUnits * CREATE_FEE_NUMERATOR / CREATE_FEE_DENOMINATOR;
}
