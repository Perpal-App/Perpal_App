import { NATIVE_MINT } from '@solana/spl-token';

import type { WalletBalance } from '@/features/account/hooks/useWalletBalances';
import type { ProviderCollateral } from '@/integrations/perps/providerCollateral';
import type { PrivateExitAsset } from '@/integrations/umbra/PrivateExitProvider';

export type WithdrawableToken = {
  readonly asset: PrivateExitAsset;
  readonly baseUnits: bigint | null;
  readonly id?: string;
};

export function listWalletTokens(
  wallet: WalletBalance | null,
  configured: readonly ProviderCollateral[],
): readonly WithdrawableToken[] {
  if (wallet === null) return [];

  const known = new Map(configured.map((asset) => [asset.mint, asset]));
  const rank = new Map(configured.map((asset, index) => [asset.mint, index]));
  const nativeMint = NATIVE_MINT.toBase58();
  const tokens = wallet.holdings.flatMap((holding): WithdrawableToken[] => {
    if (holding.baseUnits <= 0n) return [];
    const configuredAsset = known.get(holding.mint);
    const asset: PrivateExitAsset = configuredAsset === undefined
      ? {
          decimals: holding.decimals,
          kind: 'spl',
          mint: holding.mint,
          symbol: holding.mint === nativeMint
            ? 'WSOL'
            : shortMint(holding.mint),
        }
      : { ...configuredAsset, kind: 'spl' };

    return [{ asset, baseUnits: holding.baseUnits, id: `spl:${holding.mint}` }];
  });

  if (wallet.solLamports > 0n) {
    tokens.unshift({
      asset: { decimals: 9, kind: 'native', mint: nativeMint, symbol: 'SOL' },
      baseUnits: wallet.solLamports,
      id: `native:${nativeMint}`,
    });
  }

  return tokens.sort((left, right) => {
    if (left.asset.kind === 'native') return right.asset.kind === 'native' ? 0 : -1;
    if (right.asset.kind === 'native') return 1;
    const leftRank = rank.get(left.asset.mint) ?? configured.length;
    const rightRank = rank.get(right.asset.mint) ?? configured.length;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.asset.symbol.localeCompare(right.asset.symbol) ||
      left.asset.mint.localeCompare(right.asset.mint);
  });
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('invalid');
  const parts = trimmed.split('.');
  if (parts.length > 2) throw new Error('invalid');
  const [whole = '', fraction = ''] = parts;
  if (!/^\d+$/u.test(whole) || !/^\d*$/u.test(fraction) || fraction.length > decimals) {
    throw new Error('invalid');
  }
  return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
}

export function formatTokenAmount(value: bigint, decimals: number): string {
  if (value < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return '--';
  if (decimals === 0) return value.toString();
  const digits = value.toString().padStart(decimals + 1, '0');
  const fraction = digits.slice(-decimals).replace(/0+$/u, '');
  return fraction.length === 0
    ? digits.slice(0, -decimals)
    : `${digits.slice(0, -decimals)}.${fraction}`;
}

export function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}
