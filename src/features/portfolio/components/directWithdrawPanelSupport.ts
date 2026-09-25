import { isConnected, useEmbeddedSolanaWallet } from '@privy-io/expo';

import { readAppConfig } from '@/config/appConfig';
import { parseAmount } from '@/domain/money/amount';
import type {
  WalletBalance,
  WalletBalances,
} from '@/features/account/hooks/useWalletBalances';
import {
  formatTokenAmount,
  listWalletTokens,
  type WithdrawableToken,
} from '@/features/portfolio/components/withdrawalAssets';
import {
  availablePacificaReturnBaseUnits,
  PACIFICA_MINIMUM_WITHDRAWAL_BASE_UNITS,
} from '@/integrations/perps/pacifica/pacificaWithdrawal';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { listTradingCollateralOptions } from '@/integrations/perps/providerCollateral';
import {
  createPrivyLegacyTransactionAuthority,
  isPrivyWalletAddress,
} from '@/integrations/privy/privySolanaTransactionAuthority';
import { DirectWithdrawalError } from '@/integrations/solana/directWithdrawal';
import { TransactionSigningError } from '@/integrations/solana/signedLegacyTransaction';

export type DirectWithdrawalSource = 'private' | 'public';

export type PacificaReleaseRequirement =
  | {
      readonly amountBaseUnits: bigint;
      readonly kind: 'new';
      readonly shortfallBaseUnits: bigint;
      readonly targetWalletBalanceBaseUnits: bigint;
    }
  | {
      readonly amountBaseUnits: bigint;
      readonly kind: 'resume';
    };

export function directWithdrawalTokens(
  balances: WalletBalances | null,
  source: DirectWithdrawalSource,
  snapshot: PacificaPortfolioSnapshot | null,
): readonly WithdrawableToken[] {
  const config = readAppConfig();
  const configured = config.ok
    ? listTradingCollateralOptions(config.value.perps.usdcMint, config.value.perps.usdtMint)
    : [];
  const wallet = balances?.[source === 'public' ? 'publicWallet' : 'privateWallet'] ?? null;
  const tokens = [...listWalletTokens(wallet, configured)];
  if (source !== 'private' || !config.ok || snapshot === null) return tokens;

  const providerAmount = pacificaNetWithdrawable(
    snapshot,
    config.value.perps.pacificaWithdrawalFeeBaseUnits,
  );
  if (providerAmount <= 0n) return tokens;

  const usdc = configured.find((asset) => asset.mint === config.value.perps.usdcMint);
  if (usdc === undefined) return tokens;
  const index = tokens.findIndex((token) => token.asset.mint === usdc.mint);
  if (index >= 0) {
    const existing = tokens[index]!;
    tokens[index] = {
      ...existing,
      baseUnits: (existing.baseUnits ?? 0n) + providerAmount,
    };
    return tokens;
  }

  const providerToken: WithdrawableToken = {
    asset: { ...usdc, kind: 'spl' },
    baseUnits: providerAmount,
    id: `spl:${usdc.mint}`,
  };
  const nativeIndex = tokens.findIndex((token) => token.asset.kind !== 'native');
  tokens.splice(nativeIndex < 0 ? tokens.length : nativeIndex, 0, providerToken);
  return tokens;
}

export function walletAssetBalance(
  wallet: WalletBalance | null | undefined,
  token: WithdrawableToken,
): bigint {
  if (wallet === null || wallet === undefined) return 0n;
  if (token.asset.kind === 'native') return wallet.solLamports;
  return wallet.holdings.find((holding) => holding.mint === token.asset.mint)?.baseUnits ?? 0n;
}

export function pacificaReleaseRequirement(input: {
  readonly feeBaseUnits: bigint;
  readonly pendingBaseUnits: bigint | null;
  readonly targetWalletBalanceBaseUnits: bigint;
  readonly walletBaseUnits: bigint;
}): PacificaReleaseRequirement | null {
  // A pending venue release is relevant only when this transfer actually needs venue funds.
  // Wallet-funded USDC and unrelated tokens must remain independently withdrawable.
  if (input.walletBaseUnits >= input.targetWalletBalanceBaseUnits) return null;
  if (input.pendingBaseUnits !== null) {
    return { amountBaseUnits: input.pendingBaseUnits, kind: 'resume' };
  }
  const shortfall = input.targetWalletBalanceBaseUnits - input.walletBaseUnits;
  const grossRequired = shortfall + input.feeBaseUnits;
  return {
    amountBaseUnits: grossRequired < PACIFICA_MINIMUM_WITHDRAWAL_BASE_UNITS
      ? PACIFICA_MINIMUM_WITHDRAWAL_BASE_UNITS
      : grossRequired,
    kind: 'new',
    shortfallBaseUnits: shortfall,
    targetWalletBalanceBaseUnits: input.targetWalletBalanceBaseUnits,
  };
}

export async function publicTransactionAuthority(
  owner: string,
  wallet: ReturnType<typeof useEmbeddedSolanaWallet>,
) {
  if (!isConnected(wallet)) throw new Error('The public wallet is not connected.');
  const publicWallet = wallet.wallets.find((candidate) => candidate.walletIndex === 0);
  if (publicWallet === undefined || !isPrivyWalletAddress(owner, publicWallet.address)) {
    throw new Error('The active public wallet changed. Review a fresh transfer.');
  }
  return createPrivyLegacyTransactionAuthority({
    address: owner,
    provider: await publicWallet.getProvider(),
  });
}

/**
 * A failure as one short sentence pair, because this is raised as a toast.
 *
 * Each of these used to be a full explanation — the on-chain failure ran to ninety-eight characters —
 * and the bar could show about half of one. Cutting the tail cut the reassurance, which on a transfer
 * failure is the part that matters. Every case now says what happened and what became of the amount, in
 * that order, inside `TOAST_MESSAGE_LIMIT`. Nothing true was dropped: a failed transfer may still have
 * cost a network fee, and that is still stated.
 */
export function directErrorMessage(cause: unknown): string {
  if (cause instanceof DirectWithdrawalError) return cause.message;
  if (cause instanceof TransactionSigningError) {
    if (cause.code === 'transaction_failed') {
      return 'Transfer failed on-chain. Amount unmoved, fee may apply.';
    }
    if (cause.code === 'submission_rejected') {
      return 'Solana rejected the transfer. Amount unmoved.';
    }
    if (cause.code === 'blockhash_expired') return 'Preview expired. Review it again.';
    if (cause.code.includes('signature')) return 'Not approved. No funds moved.';
  }
  if (cause instanceof Error && (
    cause.message.includes('Pacifica') ||
    cause.message.includes('trading withdrawal') ||
    cause.message.includes('private balance')
  )) return cause.message;
  return 'Withdrawal did not complete. Balances refreshed.';
}

export function sol(lamports: bigint): string {
  return `${formatTokenAmount(lamports, 9)} SOL`;
}

/**
 * What "Max" just put in the amount field.
 *
 * SOL adds `Fee reserved` because the figure is deliberately below the balance shown above the field,
 * and that gap is the one thing the reader cannot work out for themselves. It does not name the reserve
 * in lamports: the exact fee is on the review, and spelling it out here pushed the line past the width
 * the toast has. SPL amounts are the whole balance, so there is nothing to explain.
 */
export function maxAmountMessage(input: {
  readonly decimals: number;
  readonly kind: 'native' | 'spl';
  readonly maxBaseUnits: bigint;
  readonly symbol: string;
}): string {
  const amount = `Max ${formatTokenAmount(input.maxBaseUnits, input.decimals)} ${input.symbol}.`;
  return input.kind === 'native' ? `${amount} Fee reserved.` : amount;
}

/** Raised by both Max and Review when balances have not arrived, so it is written once. */
export function loadingMessage(source: DirectWithdrawalSource): string {
  return `${source === 'public' ? 'Public' : 'Private'} balances still loading.`;
}

/**
 * Why "Max" had nothing to offer, as the missing prerequisite rather than a range to type into.
 *
 * A SOL balance too small to cover its own fee and an empty token balance are different problems with
 * different next steps, and neither is solved by entering a smaller number.
 */
export function emptyBalanceMessage(input: {
  readonly kind: 'native' | 'spl';
  readonly symbol: string;
}): string {
  return input.kind === 'native'
    ? 'Not enough SOL for the network fee.'
    : `No ${input.symbol} left to withdraw.`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

function pacificaNetWithdrawable(
  snapshot: PacificaPortfolioSnapshot,
  withdrawalFeeBaseUnits: bigint,
): bigint {
  try {
    return availablePacificaReturnBaseUnits(
      parseAmount(snapshot.availableToWithdraw, 6).baseUnits,
      withdrawalFeeBaseUnits,
    );
  } catch {
    return 0n;
  }
}

/**
 * The facts a direct withdrawal is approved on, as scannable rows.
 *
 * Built here rather than in the panel because it is a mapping from a plan to copy, with no state and no
 * rendering in it — and because the panel it came out of was within twenty lines of the file ceiling.
 *
 * `Route` used to be the opening clause of the note underneath: "Visible on Solana." It is a fact about
 * this transfer with a short fixed value, which is what a row is, and as prose it was the reason the note
 * ran to three lines. It reads as a row here and it is parallel with the Umbra route, which already
 * states itself this way.
 *
 * Rent appears only when there is some. A `0 SOL` row for an account that already exists is a number
 * the reader has to read and then discard, and every such row makes the ones that matter harder to find.
 */
export function directReviewRows(plan: {
  readonly destinationAddress: string;
  readonly feeLamports: bigint;
  readonly rentLamports: bigint;
}): readonly { readonly label: string; readonly value: string }[] {
  return [
    { label: 'To', value: shortAddress(plan.destinationAddress) },
    { label: 'Route', value: 'Public on Solana' },
    { label: 'Network fee', value: sol(plan.feeLamports) },
    ...(plan.rentLamports > 0n
      ? [{ label: 'Account rent', value: sol(plan.rentLamports) }]
      : []),
  ];
}

/**
 * The one thing about this route that is a sentence rather than a row.
 *
 * It was three sentences and wrapped to three lines under a step with four rows above it, which is a
 * paragraph to read before a signature and reads as fine print. Two of the three were not sentences at
 * all: "Visible on Solana" is now the `Route` row, and "no Umbra routing or registration fee" described
 * a cost that does not apply — the rows itemise every cost that does, so a fee absent from that list is
 * already absent.
 *
 * What is left cannot be a row, because it is a conditional about a failure rather than a value. It
 * stays because a reader who watches a transfer fail without having been told this will assume the
 * amount went with it.
 */
export const DIRECT_REVIEW_NOTE = 'A failed transfer leaves the amount available.';
