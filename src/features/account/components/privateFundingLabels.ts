import { amountFromBaseUnits, formatAmount } from '@/domain/money/amount';
import { privateFundingUserMessage } from '@/integrations/umbra/privateFundingErrors';
import type { PrivateFundingPreflight } from '@/integrations/umbra/privateFundingPreflight';
import type { PrivateFundingRecord } from '@/integrations/umbra/umbraSecureStorage';

/**
 * Every string the funding panel derives, and the one record predicate it needs.
 *
 * Lifted out of the panel because it was two files' worth of code in one: the panel arranges fields
 * and owns the confirmation flow, while all of this is pure mapping from a record or a preflight to
 * words. None of it touches React, so none of it belongs in a component.
 */

/** Formats base units for a message. Collateral is 6 decimals, SOL is 9. */
export function token(baseUnits: bigint, decimals: 6 | 9): string {
  return formatAmount(amountFromBaseUnits(baseUnits, decimals));
}

/**
 * The shortfall a preflight found, as something a reader can act on.
 *
 * It names what is there and what is needed rather than only that something is missing, because the
 * next action is to top up by the difference and that number is the whole answer. Collateral is
 * reported before SOL: a missing fee reserve is meaningless if the collateral leg cannot run either.
 */
export function preflightError(
  preflight: PrivateFundingPreflight | null,
  symbol: string,
): string | null {
  if (preflight === null) return null;

  if (preflight.missingCollateralBaseUnits > 0n) {
    return `Insufficient ${symbol}: ${token(preflight.availableCollateralBaseUnits, 6)} available, `
      + `${token(preflight.requiredCollateralBaseUnits, 6)} required. `
      + `Add at least ${token(preflight.missingCollateralBaseUnits, 6)} ${symbol}.`;
  }

  return preflight.missingSolLamports > 0n
    ? `Insufficient SOL: ${token(preflight.availableSolLamports, 9)} available, about `
      + `${token(preflight.requiredSolLamports, 9)} required. `
      + `Add at least ${token(preflight.missingSolLamports, 9)} SOL.`
    : null;
}

/**
 * What the resume control says.
 *
 * A shortfall takes priority over the word "resume", because a run that cannot proceed should not
 * offer to proceed — the label becomes the amount to add instead.
 */
export function pendingActionLabel(input: {
  readonly isChecking: boolean;
  readonly isRunning: boolean;
  readonly preflight: PrivateFundingPreflight | null;
  readonly symbol: string | null;
}): string {
  if (input.isRunning) return 'Funding in progress';
  if (input.isChecking) return 'Checking balances';

  if (input.preflight !== null && input.preflight.missingCollateralBaseUnits > 0n) {
    return `Add ${token(input.preflight.missingCollateralBaseUnits, 6)} ${input.symbol ?? 'collateral'}`;
  }
  if (input.preflight !== null && input.preflight.missingSolLamports > 0n) {
    return `Add ${token(input.preflight.missingSolLamports, 9)} SOL`;
  }

  return 'Resume funding';
}

/**
 * A stored failure, with its code kept.
 *
 * The reference is part of the message on purpose: a funding failure is the one thing on this screen
 * a reader may need to quote to support, and a code they cannot see is a code they cannot report.
 */
export function storedError(code: string | null | undefined): string | null {
  return code === null || code === undefined
    ? null
    : `${privateFundingUserMessage(code)} Error reference: ${code}.`;
}

/** Where a run has reached, in the reader's terms rather than the state machine's. */
export function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'depositing': return 'Preparing private transfer';
    case 'proving': return 'Preparing privacy proof';
    case 'scanning':
    case 'relaying':
    case 'fee-funding':
    case 'collateral-converting':
    case 'provider-setup':
    case 'provider-depositing': return 'Getting trading funds ready';
    case 'complete': return 'Ready to trade';
    default: return 'Ready';
  }
}

/**
 * What to say while a run is in flight.
 *
 * Proving gets its own line because it is the one phase that can take minutes, and a reader who is
 * not told that will assume the app has hung.
 */
export function runningMessage(phase: string | undefined): string {
  return phase === 'proving'
    ? 'Setting up private trading. First use can take a few minutes; later transfers reuse the verified local setup.'
    : 'Getting your trading funds ready. You can leave this screen; progress is saved.';
}

/**
 * Whether anything has been broadcast for this record.
 *
 * The confirmation copy turns on it: once a transaction exists, resuming is continuing something the
 * chain already knows about rather than starting fresh, and the reader has to be told which.
 */
export function hasSubmittedTransaction(record: PrivateFundingRecord): boolean {
  return [
    record.populateSignature,
    record.depositSignature,
    record.relayRequestId,
    record.claimSignature,
    record.feeFundingWrapSignature,
    record.feeFundingPopulateSignature,
    record.feeFundingDepositSignature,
    record.feeFundingRelayRequestId,
    record.feeFundingSignature,
    record.conversionSignature,
    record.providerSetupSignature,
    record.providerDepositSignature,
  ].some((value) => value !== null);
}
