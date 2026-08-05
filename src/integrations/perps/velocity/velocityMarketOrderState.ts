import {
  getPerpMarketPublicKeySync,
  getSpotMarketPublicKeySync,
  getUserAccountPublicKeySync,
  getUserStatsAccountPublicKey,
} from '@velocity-exchange/sdk/lib/browser/addresses/pda';
import { CustomBorshAccountsCoder } from '@velocity-exchange/sdk/lib/browser/decode/customCoder';
import { decodeUser } from '@velocity-exchange/sdk/lib/browser/decode/user';
import velocityIdl from '@velocity-exchange/sdk/lib/browser/idl/velocity.json';
import {
  ReferrerStatus,
  isVariant,
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
        addresses.perpMarketAccount,
      ],
      { commitment: 'confirmed', encoding: 'base64' },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const [stateRaw, userRaw, statsRaw, spotRaw, perpRaw] = result.value;

  if (
    result.value.length !== 5 ||
    [stateRaw, userRaw, statsRaw, spotRaw, perpRaw].some(
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
  const perpMarket = {
    ...decodeAccount<PerpMarketAccount>('PerpMarket', perpRaw!),
    pubkey: new PublicKey(addresses.perpMarketAccount),
  };

  validateAccountShape(user, stats, spotMarket, perpMarket, addresses, input.owner);

  return {
    addresses,
    slot: result.context.slot,
    user,
    stats,
    state,
    spotMarket,
    perpMarket,
  };
}

export function buildVelocityOrderRemainingAccounts(orderState: VelocityOrderState) {
  const accounts = [] as { address: string; writable: boolean }[];

  if (!orderState.spotMarket.oracle.equals(PublicKey.default)) {
    accounts.push({
      address: orderState.spotMarket.oracle.toBase58(),
      writable: false,
    });
  }

  accounts.push({
    address: orderState.perpMarket.oracle.toBase58(),
    writable: isVariant(orderState.perpMarket.oracleSource, 'prelaunch'),
  });
  accounts.push({
    address: orderState.addresses.spotMarketAccount,
    writable: false,
  });
  accounts.push({
    address: orderState.addresses.perpMarketAccount,
    writable: true,
  });
  return accounts;
}

function orderAddresses(
  programId: string,
  owner: string,
  symbol: PublicMarketSymbol,
) {
  const program = new PublicKey(programId);
  const authority = new PublicKey(owner);
  const marketIndex = { 'BTC-PERP': 0, 'ETH-PERP': 1, 'SOL-PERP': 2 }[symbol];

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
    perpMarketAccount: getPerpMarketPublicKeySync(program, marketIndex).toBase58(),
  };
}

function validateAccountShape(
  user: UserAccount,
  stats: UserStatsAccount,
  spotMarket: SpotMarketAccount,
  perpMarket: PerpMarketAccount,
  addresses: VelocityOrderAddresses,
  owner: string,
): void {
  const authority = new PublicKey(owner);
  const unsupportedPerpExposure = user.perpPositions.some(
    (position) =>
      position.marketIndex !== addresses.marketIndex &&
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
    user.openOrders > 0 ||
    unsupportedPerpExposure ||
    hasUnsupportedSpot
  ) {
    throw new VelocityMarketOrderError(
      'This order path supports one selected core position and no open orders.',
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
    perpMarket.marketIndex !== addresses.marketIndex
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
