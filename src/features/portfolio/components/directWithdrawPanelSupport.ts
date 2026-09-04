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

export function directErrorMessage(cause: unknown): string {
  if (cause instanceof DirectWithdrawalError) return cause.message;
  if (cause instanceof TransactionSigningError) {
    if (cause.code === 'transaction_failed') {
      return 'The transfer failed on-chain. The amount remains available; Solana may still charge a network fee.';
    }
    if (cause.code === 'submission_rejected') {
      return 'Solana rejected the transfer before submission. The amount remains available.';
    }
    if (cause.code === 'blockhash_expired') return 'The withdrawal preview expired. Review it again.';
    if (cause.code.includes('signature')) return 'The withdrawal was not approved. No funds were moved.';
  }
  if (cause instanceof Error && (
    cause.message.includes('Pacifica') ||
    cause.message.includes('trading withdrawal') ||
    cause.message.includes('private balance')
  )) return cause.message;
  return 'The direct withdrawal did not complete. Wallet balances were refreshed from Solana.';
}

export function sol(lamports: bigint): string {
  return `${formatTokenAmount(lamports, 9)} SOL`;
}

export function maxCostMessage(input: {
  readonly amountBaseUnits: bigint;
  readonly decimals: number;
  readonly feeLamports: bigint;
  readonly rentLamports: bigint;
  readonly symbol: string;
}): string {
  const rent = input.rentLamports > 0n
    ? ` Recipient token-account rent: ${sol(input.rentLamports)}.`
    : '';
  return `Max: ${formatTokenAmount(input.amountBaseUnits, input.decimals)} ${input.symbol}. ` +
    `Network fee: ${sol(input.feeLamports)}.${rent} Costs are checked again before signing.`;
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
