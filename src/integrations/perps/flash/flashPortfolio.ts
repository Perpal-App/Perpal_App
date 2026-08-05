import { Buffer } from 'buffer';

import { PublicKey } from '@solana/web3.js';

import { amountFromBaseUnits, type Amount } from '@/domain/money/amount';
import { fetchPublicProgramAccount } from '@/integrations/api/publicSolanaRpc';
import { decodeFlashBasket } from '@/integrations/perps/flash/flashAccountCoder';
import { flashPool } from '@/integrations/perps/flash/flashMarketData';

export type FlashPortfolioPosition = {
  readonly marketAddress: string;
  readonly symbol: string;
  readonly side: 'Long' | 'Short';
  readonly size: string;
  readonly entryPrice: string;
  readonly notional: Amount;
  readonly collateral: Amount;
  readonly collateralSymbol: string;
  readonly leverage: string | null;
};

export type FlashPortfolioSnapshot = {
  readonly initialized: boolean;
  readonly accountAddress: string;
  readonly positions: readonly FlashPortfolioPosition[];
  readonly openOrders: number;
  readonly slot: number;
};

export async function fetchFlashPortfolio(
  erRpcUrl: string,
  programId: string,
  walletAddress: string,
  signal: AbortSignal,
): Promise<FlashPortfolioSnapshot> {
  const pool = flashPool(programId);
  const owner = new PublicKey(walletAddress);
  const [basketAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('basket'), owner.toBuffer()],
    new PublicKey(programId),
  );
  const response = await fetchPublicProgramAccount(
    erRpcUrl,
    basketAddress.toBase58(),
    programId,
    signal,
  );

  if (response.account === null) {
    return emptySnapshot(basketAddress.toBase58(), response.slot);
  }

  const basket = decodeFlashBasket(response.account);

  if (basket.owner.toBase58() !== owner.toBase58()) {
    throw new Error('Flash ER returned a basket for another authority.');
  }

  const positions = basket.positions
    .filter(({ position }) => position.isActive && !position.sizeAmount.isZero())
    .map(({ market, position }) => {
      const config = pool.markets.find((candidate) =>
        candidate.marketAccount.equals(market),
      );

      if (config === undefined) {
        throw new Error('Flash returned a position outside its current SDK catalog.');
      }

      const collateral = pool.tokens.find((token) =>
        token.mintKey.equals(config.collateralMint),
      );
      const sizeUsd = BigInt(position.sizeUsd.toString());
      const collateralUsd = BigInt(position.collateralUsd.toString());

      return {
        marketAddress: market.toBase58(),
        symbol: `${config.marketNameUi.split(' ')[0] ?? 'UNKNOWN'}-PERP`,
        side: 'long' in config.side ? 'Long' : 'Short',
        size: decimalString(
          BigInt(position.sizeAmount.toString()),
          position.sizeDecimals,
        ),
        entryPrice: oracleDecimal(
          BigInt(position.entryPrice.price.toString()),
          position.entryPrice.exponent,
        ),
        notional: usd(sizeUsd),
        collateral: usd(collateralUsd),
        collateralSymbol: collateral?.symbol ?? 'Unknown',
        leverage: ratio(sizeUsd, collateralUsd),
      } satisfies FlashPortfolioPosition;
    });

  return {
    initialized: true,
    accountAddress: basketAddress.toBase58(),
    positions,
    openOrders: basket.orders.reduce(
      (total, entry) => total + entry.order.activeOrders,
      0,
    ),
    slot: response.slot,
  };
}

function emptySnapshot(
  accountAddress: string,
  slot: number,
): FlashPortfolioSnapshot {
  return {
    initialized: false,
    accountAddress,
    positions: [],
    openOrders: 0,
    slot,
  };
}

function oracleDecimal(value: bigint, exponent: number): string {
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 18) {
    throw new Error('Flash returned an invalid oracle exponent.');
  }

  return exponent >= 0
    ? `${value}${'0'.repeat(exponent)}`
    : decimalString(value, -exponent);
}

function decimalString(value: bigint, decimals: number): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('Flash returned an invalid token precision.');
  }

  if (decimals === 0) {
    return value.toString();
  }

  const digits = value.toString().padStart(decimals + 1, '0');
  const fraction = digits.slice(-decimals).replace(/0+$/u, '');
  const whole = digits.slice(0, -decimals);

  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

function ratio(numerator: bigint, denominator: bigint): string | null {
  if (denominator === 0n) {
    return null;
  }

  const hundredths = (numerator * 100n + denominator / 2n) / denominator;
  const fraction = (hundredths % 100n).toString().padStart(2, '0');

  return `${hundredths / 100n}.${fraction}`.replace(/\.00$/u, '');
}

function usd(baseUnits: bigint): Amount {
  return amountFromBaseUnits(baseUnits, 6);
}
