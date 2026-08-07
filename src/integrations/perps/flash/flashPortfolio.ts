import { Buffer } from 'buffer';

import { PublicKey } from '@solana/web3.js';
import { findUserDepositLedgerAddress } from '@flash_trade/flash-sdk-v2/dist/utils';

import {
  amountFromBaseUnits,
  type Amount,
  type TokenDecimals,
} from '@/domain/money/amount';
import { fetchPublicProgramAccount } from '@/integrations/api/publicSolanaRpc';
import {
  decodeFlashBasket,
  decodeFlashUserDepositLedger,
} from '@/integrations/perps/flash/flashAccountCoder';
import { flashPools } from '@/integrations/perps/flash/flashMarketData';

export type FlashPortfolioPosition = {
  readonly marketAddress: string;
  readonly poolName: string;
  readonly symbol: string;
  readonly side: 'Long' | 'Short';
  readonly size: string;
  readonly entryPrice: string;
  readonly notional: Amount;
  readonly sizeUsdBaseUnits: bigint;
  readonly collateral: Amount;
  readonly collateralSymbol: string;
  readonly leverage: string | null;
};

export type FlashPortfolioSnapshot = {
  readonly initialized: boolean;
  readonly accountAddress: string;
  readonly positions: readonly FlashPortfolioPosition[];
  readonly openOrders: number;
  readonly deposits: Readonly<Record<string, Amount>>;
  readonly reservedWithdrawals: Readonly<Record<string, Amount>>;
  readonly slot: number;
};

export async function fetchFlashPortfolio(
  erRpcUrl: string,
  programId: string,
  walletAddress: string,
  signal: AbortSignal,
): Promise<FlashPortfolioSnapshot> {
  const pools = flashPools(programId);
  const owner = new PublicKey(walletAddress);
  const [basketAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('basket'), owner.toBuffer()],
    new PublicKey(programId),
  );
  const [ledgerAddress] = findUserDepositLedgerAddress(owner, new PublicKey(programId));
  const [response, ledgerResponse] = await Promise.all([
    fetchPublicProgramAccount(erRpcUrl, basketAddress.toBase58(), programId, signal),
    fetchPublicProgramAccount(erRpcUrl, ledgerAddress.toBase58(), programId, signal),
  ]);

  if (response.account === null) {
    if (ledgerResponse.account !== null) {
      throw new Error('Flash returned a deposit ledger without a basket.');
    }
    return emptySnapshot(basketAddress.toBase58(), Math.max(response.slot, ledgerResponse.slot));
  }

  const basket = decodeFlashBasket(response.account);

  if (basket.owner.toBase58() !== owner.toBase58()) {
    throw new Error('Flash ER returned a basket for another authority.');
  }
  const ledger = ledgerResponse.account === null
    ? null
    : decodeFlashUserDepositLedger(ledgerResponse.account);
  if (ledger !== null && ledger.owner.toBase58() !== owner.toBase58()) {
    throw new Error('Flash ER returned a deposit ledger for another authority.');
  }

  const positions = basket.positions
    .filter(({ position }) => position.isActive && !position.sizeAmount.isZero())
    .map(({ market, position }) => {
      const resolved = pools.flatMap((pool) =>
        pool.markets.map((config) => ({ config, pool })),
      ).find(({ config }) => config.marketAccount.equals(market));

      if (resolved === undefined) {
        throw new Error('Flash returned a position outside its current SDK catalog.');
      }
      const { config, pool } = resolved;

      const collateral = pool.tokens.find((token) =>
        token.mintKey.equals(config.collateralMint),
      );
      const sizeUsd = BigInt(position.sizeUsd.toString());
      const collateralUsd = BigInt(position.collateralUsd.toString());

      return {
        marketAddress: market.toBase58(),
        poolName: pool.poolName,
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
        sizeUsdBaseUnits: sizeUsd,
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
    deposits: ledger === null ? {} : depositMap(ledger.deposits, pools),
    reservedWithdrawals:
      ledger === null ? {} : depositMap(ledger.reservedWithdrawals, pools),
    slot: Math.max(response.slot, ledgerResponse.slot),
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
    deposits: {},
    reservedWithdrawals: {},
    slot,
  };
}

function depositMap(
  entries: readonly { readonly mint: PublicKey; readonly amount: { toString(): string } }[],
  pools: ReturnType<typeof flashPools>,
): Readonly<Record<string, Amount>> {
  return Object.fromEntries(entries
    .filter((entry) => BigInt(entry.amount.toString()) !== 0n)
    .map((entry) => {
      const token = pools.flatMap((pool) => pool.tokens)
        .find((candidate) => candidate.mintKey.equals(entry.mint));
      if (token === undefined) throw new Error('Flash returned an unknown deposit mint.');
      return [
        token.symbol,
        amountFromBaseUnits(BigInt(entry.amount.toString()), tokenDecimals(token.decimals)),
      ];
    }));
}

function tokenDecimals(value: number): TokenDecimals {
  if (value !== 0 && value !== 6 && value !== 8 && value !== 9) {
    throw new Error('Flash returned an unsupported token precision.');
  }
  return value;
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
