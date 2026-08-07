export function collateralShortfall(
  required: bigint,
  available: bigint,
): bigint {
  return required > available ? required - available : 0n;
}

export function scaledInputForMinimumOutput(
  quotedInput: bigint,
  requiredOutput: bigint,
  quotedMinimumOutput: bigint,
): bigint {
  if (quotedInput <= 0n || requiredOutput <= 0n || quotedMinimumOutput <= 0n) {
    throw new Error('Stablecoin conversion amounts must be positive.');
  }
  return (quotedInput * requiredOutput + quotedMinimumOutput - 1n) /
    quotedMinimumOutput;
}

export function fundingRequiredSol(
  feeLamports: bigint,
  rentLamports: bigint,
): bigint {
  return feeLamports + rentLamports;
}
