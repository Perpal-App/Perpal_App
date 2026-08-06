export function hasCompletedPrivateWalletFunding(record: {
  readonly claimSignature: string | null;
  readonly feeFundingSignature: string | null;
  readonly providerDepositSignature: string | null;
}): boolean {
  return record.claimSignature !== null &&
    record.feeFundingSignature !== null &&
    record.providerDepositSignature === null;
}
