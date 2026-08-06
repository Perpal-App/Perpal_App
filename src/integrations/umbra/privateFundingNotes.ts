import type {
  DecryptedStealthPoolNoteData,
  ScannedStealthPoolNoteResult,
} from '@umbra-privacy/sdk/burn';
import { reconstructAddressFromU128Parts } from '@umbra-privacy/sdk/solana';

import { estimateUmbraCreateFee } from '@/integrations/umbra/privateFundingFees';

export type PrivateFundingNote = DecryptedStealthPoolNoteData & {
  readonly kind: 'self-burnable';
};

export function matchingPrivateFundingNotes(
  result: ScannedStealthPoolNoteResult,
  target: {
    readonly amountBaseUnits?: string;
    readonly mint: string;
    readonly tradingWalletAddress: string;
  },
): readonly PrivateFundingNote[] {
  return result.ataToStealthPoolSelfBurnable.filter(
    (note): note is PrivateFundingNote =>
      note.kind === 'self-burnable' &&
      note.source === 'public-associated-token-account' &&
      (target.amountBaseUnits === undefined ||
        note.amount === BigInt(target.amountBaseUnits) -
          estimateUmbraCreateFee(BigInt(target.amountBaseUnits))) &&
      note.destinationAddress === target.tradingWalletAddress &&
      reconstructAddressFromU128Parts({
        low: note.h1Components.mintAddressLow,
        high: note.h1Components.mintAddressHigh,
      }) === target.mint,
  );
}

export function privateFundingNoteId(
  note: DecryptedStealthPoolNoteData,
): string {
  return `${note.treeIndex.toString()}:${note.insertionIndex.toString()}`;
}
