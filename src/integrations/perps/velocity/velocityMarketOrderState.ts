import {
  getPerpMarketPublicKeySync,
  getSpotMarketPublicKeySync,
  getUserAccountPublicKeySync,
  getUserStatsAccountPublicKey,
} from '@velocity-exchange/sdk/lib/browser/addresses/pda';
import { CustomBorshAccountsCoder } from '@velocity-exchange/sdk/lib/browser/decode/customCoder';
import { getRemainingAccounts } from '@velocity-exchange/sdk/lib/browser/core/remainingAccounts';
import { decodeUser } from '@velocity-exchange/sdk/lib/browser/decode/user';
import velocityIdl from '@velocity-exchange/sdk/lib/browser/idl/velocity.json';
import {
  ReferrerStatus,
  type PerpMarketAccount,
  type SpotMarketAccount,
  type StateAccount,
  type UserAccount,
  type UserStatsAccount,
} from '@velocity-exchange/sdk/lib/browser/types';
import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import type { PublicMarketSymbol } from '@/integrations/perps/markets/publicMarketData';
import { normalizeVelocityAccount } from '@/integrations/perps/velocity/normalizeVelocityAccount';

const QUOTE_MARKET_INDEX = 0;
const coder = new CustomBorshAccountsCoder<'State' | 'UserStats' | 'SpotMarket' | 'PerpMarket'>(
  velocityIdl as unknown as ConstructorParameters<typeof CustomBorshAccountsCoder>[0],
);

export class VelocityMarketOrderError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'VelocityMarketOrderError';
  }
}

export type VelocityOrderAddresses = ReturnType<typeof orderAddresses>;
export type VelocityOrderState = {
  readonly addresses: VelocityOrderAddresses;
  readonly slot: number;
  readonly user: UserAccount;
  readonly stats: UserStatsAccount;
  readonly state: StateAccount;
  readonly spotMarket: SpotMarketAccount;
  readonly perpMarket: PerpMarketAccount;
  readonly perpMarkets: readonly PerpMarketAccount[];
};

type AccountValue = {
  readonly owner: string;
  readonly data: readonly [string, 'base64'];
} | null;
type AccountSet = {
  readonly context: { readonly slot: number };
  readonly value: readonly AccountValue[];
};

export async function loadVelocityOrderState(input: {
  readonly owner: string;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly symbol: PublicMarketSymbol;
  readonly signal?: AbortSignal;
}): Promise<VelocityOrderState> {
  const addresses = orderAddresses(input.programId, input.owner, input.symbol);
  const result = await signedSolanaRpc<AccountSet>({
    method: 'getMultipleAccounts',
    params: [
      [
        addresses.stateAccount,
        addresses.userAccount,
        addresses.userStatsAccount,
        addresses.spotMarketAccount,
        ...addresses.perpMarketAccounts,
      ],
      { commitment: 'confirmed', encoding: 'base64' },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const [stateRaw, userRaw, statsRaw, spotRaw, ...perpRaws] = result.value;

  if (
    result.value.length !== 7 ||
    [stateRaw, userRaw, statsRaw, spotRaw, ...perpRaws].some(
      (account) =>
        account === undefined || account === null || account.owner !== input.programId,
    )
  ) {
    throw new VelocityMarketOrderError(
      'Initialize and fund the Velocity account first.',
      'account_unavailable',
    );
  }

  const user = decodeUser(Buffer.from(userRaw!.data[0], 'base64'));
  const stats = decodeAccount<UserStatsAccount>('UserStats', statsRaw!);
  const state = decodeAccount<StateAccount>('State', stateRaw!);
  const spotMarket = {
    ...decodeAccount<SpotMarketAccount>('SpotMarket', spotRaw!),
    pubkey: new PublicKey(addresses.spotMarketAccount),
  };
  const perpMarkets = perpRaws.map((raw, index) => ({
    ...decodeAccount<PerpMarketAccount>('PerpMarket', raw!),
    pubkey: new PublicKey(addresses.perpMarketAccounts[index]!),
  }));
  const perpMarket = perpMarkets.find(
    (market) => market.marketIndex === addresses.marketIndex,
  );

  if (perpMarket === undefined) {
    throw new VelocityMarketOrderError(
      'Velocity omitted the selected market account.',
      'market_mismatch',
    );
  }

  validateAccountShape(user, stats, spotMarket, perpMarkets, addresses, input.owner);

  return {
    addresses,
    slot: result.context.slot,
    user,
    stats,
    state,
    spotMarket,
    perpMarket,
    perpMarkets,
  };
}

export function buildVelocityOrderRemainingAccounts(orderState: VelocityOrderState) {
  const markets = new Map(
    orderState.perpMarkets.map((market) => [market.marketIndex, market]),
  );
  return getRemainingAccounts(
    {
      getPerpMarketAccount: (marketIndex) => {
        const market = markets.get(marketIndex);
        if (market === undefined) {
          throw new VelocityMarketOrderError(
            'A non-core Velocity position cannot be verified.',
            'account_shape_unsupported',
          );
        }
        return market;
      },
      getSpotMarketAccount: (marketIndex) => {
        if (marketIndex !== QUOTE_MARKET_INDEX) {
          throw new VelocityMarketOrderError(
            'A non-USDT Velocity position cannot be verified.',
            'account_shape_unsupported',
          );
        }
        return orderState.spotMarket;
      },
      getUserAccountAndSlot: () => ({ slot: orderState.slot }),
      activeSubAccountId: orderState.user.subAccountId,
      authority: orderState.user.authority,
      perpMarketLastSlotCache: new Map(),
      spotMarketLastSlotCache: new Map(),
      mustIncludePerpMarketIndexes: new Set(),
      mustIncludeSpotMarketIndexes: new Set(),
    },
    {
      userAccounts: [orderState.user],
      writablePerpMarketIndexes: [orderState.addresses.marketIndex],
      writableSpotMarketIndexes: [QUOTE_MARKET_INDEX],
    },
  ).map((account) => ({
    address: account.pubkey.toBase58(),
    writable: account.isWritable,
  }));
}

function orderAddresses(
  programId: string,
  owner: string,
  symbol: PublicMarketSymbol,
) {
  const program = new PublicKey(programId);
  const authority = new PublicKey(owner);
  const marketIndex = { 'BTC-PERP': 0, 'ETH-PERP': 1, 'SOL-PERP': 2 }[symbol];
  const perpMarketAccounts = [0, 1, 2].map((index) =>
    getPerpMarketPublicKeySync(program, index).toBase58(),
  );

  return {
    marketIndex,
    stateAccount: PublicKey.findProgramAddressSync(
      [Buffer.from('velocity_state')],
      program,
    )[0].toBase58(),
    userAccount: getUserAccountPublicKeySync(program, authority).toBase58(),
    userStatsAccount: getUserStatsAccountPublicKey(program, authority).toBase58(),
    spotMarketAccount: getSpotMarketPublicKeySync(
      program,
      QUOTE_MARKET_INDEX,
    ).toBase58(),
    perpMarketAccount: perpMarketAccounts[marketIndex]!,
    perpMarketAccounts,
  };
}

function validateAccountShape(
  user: UserAccount,
  stats: UserStatsAccount,
  spotMarket: SpotMarketAccount,
  perpMarkets: readonly PerpMarketAccount[],
  addresses: VelocityOrderAddresses,
  owner: string,
): void {
  const authority = new PublicKey(owner);
  const coreMarketIndexes = new Set(perpMarkets.map((market) => market.marketIndex));
  const unsupportedPerpExposure = user.perpPositions.some(
    (position) =>
      !coreMarketIndexes.has(position.marketIndex) &&
      (BigInt(position.baseAssetAmount.toString()) !== 0n ||
        BigInt(position.quoteAssetAmount.toString()) !== 0n ||
        position.openOrders > 0 ||
        BigInt(position.isolatedPositionScaledBalance.toString()) !== 0n),
  );
  const hasUnsupportedSpot = user.spotPositions.some(
    (position) =>
      position.marketIndex !== QUOTE_MARKET_INDEX &&
      (BigInt(position.scaledBalance.toString()) !== 0n || position.openOrders > 0),
  );

  if (
    !user.authority.equals(authority) ||
    !stats.authority.equals(authority) ||
    unsupportedPerpExposure ||
    hasUnsupportedSpot
  ) {
    throw new VelocityMarketOrderError(
      'This order path cannot verify a non-core perp or non-USDT spot position.',
      'account_shape_unsupported',
    );
  }

  if ((stats.referrerStatus & ReferrerStatus.IsReferred) !== 0) {
    throw new VelocityMarketOrderError(
      'Referred accounts need the revenue-share order path.',
      'referral_unsupported',
    );
  }

  if (
    spotMarket.marketIndex !== QUOTE_MARKET_INDEX ||
    !perpMarkets.some((market) => market.marketIndex === addresses.marketIndex)
  ) {
    throw new VelocityMarketOrderError(
      'Velocity returned mismatched market accounts.',
      'market_mismatch',
    );
  }
}

function decodeAccount<T>(
  name: 'State' | 'UserStats' | 'SpotMarket' | 'PerpMarket',
  raw: NonNullable<AccountValue>,
): T {
  return normalizeVelocityAccount<T>(
    coder.decode<T>(name, Buffer.from(raw.data[0], 'base64')),
  );
}
