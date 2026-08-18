export function hasCompletedPrivateWalletFunding(record: {
  readonly claimSignature: string | null;
  readonly feeFundingSignature: string | null;
  readonly providerDepositSignature: string | null;
}): boolean {
  return record.claimSignature !== null &&
    record.feeFundingSignature !== null &&
    record.providerDepositSignature === null;
}

export function nextPrivateFundingLegAction(input: {
  readonly claimSignature: string | null;
  readonly deferRelayPolling: boolean;
  readonly relayRequestId: string | null;
}): 'continue' | 'done' | 'poll-relay' | 'wait-for-peer-leg' {
  if (input.claimSignature !== null) return 'done';
  if (input.relayRequestId === null) return 'continue';
  return input.deferRelayPolling ? 'wait-for-peer-leg' : 'poll-relay';
}
