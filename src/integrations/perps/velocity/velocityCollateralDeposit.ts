import { base64 } from '@scure/base';
import {
  getSpotMarketPublicKeySync,
  getUserAccountPublicKeySync,
  getUserStatsAccountPublicKey,
} from '@velocity-exchange/sdk/lib/browser/addresses/pda';
import { MainnetSpotMarkets } from '@velocity-exchange/sdk/lib/browser/constants/spotMarkets';
import { CustomBorshAccountsCoder } from '@velocity-exchange/sdk/lib/browser/decode/customCoder';
import { decodeUser } from '@velocity-exchange/sdk/lib/browser/decode/user';
import velocityIdl from '@velocity-exchange/sdk/lib/browser/idl/velocity.json';
import type {
  SpotMarketAccount,
  UserAccount,
} from '@velocity-exchange/sdk/lib/browser/types';
import { Buffer } from 'buffer';
import * as Crypto from 'expo-crypto';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, Transaction } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  buildVelocityCollateralDepositTransaction,
  verifyVelocityCollateralDepositPlan,
  type VelocityCollateralDepositTransactionPlan,
} from '@/integrations/perps/velocity/velocityCollateralDepositTransaction';
import { normalizeVelocityAccount } from '@/integrations/perps/velocity/normalizeVelocityAccount';
import {
  signAndSubmitLegacyTransaction,
  type SubmittedTransactionResult,
} from '@/integrations/solana/signedLegacyTransaction';

const QUOTE_MARKET_INDEX = 0;
const PLAN_LIFETIME_MS = 60_000;
const resolvedQuoteConfig = MainnetSpotMarkets.find(
  (market) => market.marketIndex === QUOTE_MARKET_INDEX,
);
const coder = new CustomBorshAccountsCoder<'SpotMarket'>(
  velocityIdl as unknown as ConstructorParameters<
    typeof CustomBorshAccountsCoder
  >[0],
);

if (resolvedQuoteConfig === undefined || resolvedQuoteConfig.symbol !== 'USDT') {
  throw new Error('Velocity mainnet USDT market is unavailable.');
}

const quoteConfig = resolvedQuoteConfig;

export type VelocityCollateralDepositPlan =
  VelocityCollateralDepositTransactionPlan & {
    readonly tokenBalanceBaseUnits: bigint;
    readonly solBalanceLamports: bigint;
    readonly feeLamports: bigint;
    readonly simulation: 'passed' | 'insufficient-sol' | 'insufficient-usdt';
    readonly expiresAtMs: number;
    readonly idempotencyKey: string;
  };

export type VelocityCollateralDepositResult = SubmittedTransactionResult;

export class VelocityCollateralDepositError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'VelocityCollateralDepositError';
  }
}

type ActionInput = {
  readonly amountBaseUnits: bigint;
  readonly owner: string;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly signal?: AbortSignal;
};

type AccountValue = {
  readonly owner: string;
  readonly data: readonly [string, 'base64'];
} | null;
type AccountSet = {
  readonly context: { readonly slot: number };
  readonly value: readonly AccountValue[];
};
type ContextValue<T> = {
  readonly context: { readonly slot: number };
  readonly value: T;
};

export async function prepareVelocityCollateralDeposit({
  amountBaseUnits,
  owner,
  programId,
  rpcUrl,
  signer,
  signal,
}: ActionInput): Promise<VelocityCollateralDepositPlan> {
  if (amountBaseUnits <= 0n) {
    throw new VelocityCollateralDepositError(
      'Enter a USDT amount greater than zero.',
      'amount_invalid',
    );
  }

  assertSigner(owner, signer);
  const addresses = depositAddresses(programId, owner);
  const [accounts, blockhash, solBalance] = await Promise.all([
    readDepositAccounts(addresses, rpcUrl, signer, signal),
    signedSolanaRpc<ContextValue<{
      readonly blockhash: string;
      readonly lastValidBlockHeight: number;
    }>>({
      method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
      rpcUrl,
      signer,
      ...(signal === undefined ? {} : { signal }),
    }),
    signedSolanaRpc<ContextValue<number>>({
      method: 'getBalance',
      params: [owner, { commitment: 'confirmed' }],
      rpcUrl,
      signer,
      ...(signal === undefined ? {} : { signal }),
    }),
  ]);
  const state = validateDepositAccounts(accounts, addresses, programId, owner);

  const transaction = buildVelocityCollateralDepositTransaction({
    ...addresses,
    spotMarketVault: state.spotMarket.vault.toBase58(),
    spotMarketOracle: state.spotMarket.oracle.toBase58(),
    amountBaseUnits,
    programId,
    recentBlockhash: blockhash.value.blockhash,
  });
  const fee = await signedSolanaRpc<ContextValue<number | null>>({
    method: 'getFeeForMessage',
    params: [
      base64.encode(transaction.serializeMessage()),
      { commitment: 'confirmed' },
    ],
    rpcUrl,
    signer,
    ...(signal === undefined ? {} : { signal }),
  });

  if (fee.value === null) {
    throw new VelocityCollateralDepositError(
      'The network fee could not be calculated.',
      'fee_unavailable',
    );
  }

  const feeLamports = safeInteger(fee.value, 'network fee');
  const solBalanceLamports = safeInteger(solBalance.value, 'SOL balance');
  const simulation = state.tokenBalanceBaseUnits < amountBaseUnits
    ? 'insufficient-usdt'
    : solBalanceLamports < feeLamports
      ? 'insufficient-sol'
      : await simulateDeposit(transaction, rpcUrl, signer, signal);
  const plan: VelocityCollateralDepositPlan = {
    ...addresses,
    spotMarketVault: state.spotMarket.vault.toBase58(),
    spotMarketOracle: state.spotMarket.oracle.toBase58(),
    amountBaseUnits,
    tokenBalanceBaseUnits: state.tokenBalanceBaseUnits,
    solBalanceLamports,
    feeLamports,
    simulation,
    recentBlockhash: blockhash.value.blockhash,
    unsignedTransaction: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
    idempotencyKey: Crypto.randomUUID(),
  };

  verifyVelocityCollateralDepositPlan(plan, programId);
  return plan;
}

export async function submitVelocityCollateralDeposit(
  input: ActionInput & { readonly plan: VelocityCollateralDepositPlan },
): Promise<VelocityCollateralDepositResult> {
  assertSigner(input.owner, input.signer);
  verifyVelocityCollateralDepositPlan(input.plan, input.programId);

  if (
    input.plan.owner !== input.owner ||
    input.plan.amountBaseUnits !== input.amountBaseUnits ||
    Date.now() >= input.plan.expiresAtMs
  ) {
    throw new VelocityCollateralDepositError(
      'The USDT deposit plan expired. Prepare it again.',
      'plan_expired',
    );
  }

  if (input.plan.simulation !== 'passed') {
    throw new VelocityCollateralDepositError(
      input.plan.simulation === 'insufficient-usdt'
        ? 'Trading wallet T needs more mainnet USDT.'
        : 'Trading wallet T needs SOL for the network fee.',
      input.plan.simulation === 'insufficient-usdt'
        ? 'insufficient_usdt'
        : 'insufficient_sol',
    );
  }

  const addresses = depositAddresses(input.programId, input.owner);
  const accounts = await readDepositAccounts(
    addresses,
    input.rpcUrl,
    input.signer,
    input.signal,
  );
  const state = validateDepositAccounts(
    accounts,
    addresses,
    input.programId,
    input.owner,
  );

  if (state.tokenBalanceBaseUnits < input.amountBaseUnits) {
    throw new VelocityCollateralDepositError(
      'The USDT balance changed. Prepare the deposit again.',
      'balance_changed',
    );
  }

  return signAndSubmitLegacyTransaction({
    idempotencyKey: input.plan.idempotencyKey,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    unsignedTransaction: input.plan.unsignedTransaction,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

function depositAddresses(programId: string, owner: string) {
  const program = new PublicKey(programId);
  const authority = new PublicKey(owner);
  const mint = quoteConfig.mint;

  return {
    owner,
    userAccount: getUserAccountPublicKeySync(program, authority).toBase58(),
    userStatsAccount: getUserStatsAccountPublicKey(program, authority).toBase58(),
    userTokenAccount: getAssociatedTokenAddressSync(
      mint,
      authority,
      false,
      TOKEN_PROGRAM_ID,
    ).toBase58(),
    spotMarketAccount: getSpotMarketPublicKeySync(
      program,
      QUOTE_MARKET_INDEX,
    ).toBase58(),
  };
}

async function readDepositAccounts(
  addresses: ReturnType<typeof depositAddresses>,
  rpcUrl: string,
  signer: GatewayRequestSigner,
  signal?: AbortSignal,
): Promise<AccountSet> {
  return signedSolanaRpc<AccountSet>({
    method: 'getMultipleAccounts',
    params: [
      [
        addresses.userAccount,
        addresses.userStatsAccount,
        addresses.spotMarketAccount,
        addresses.userTokenAccount,
      ],
      { commitment: 'confirmed', encoding: 'base64' },
    ],
    rpcUrl,
    signer,
    ...(signal === undefined ? {} : { signal }),
  });
}

function validateDepositAccounts(
  result: AccountSet,
  addresses: ReturnType<typeof depositAddresses>,
  programId: string,
  owner: string,
): {
  readonly spotMarket: SpotMarketAccount;
  readonly tokenBalanceBaseUnits: bigint;
} {
  const [userRaw, statsRaw, spotRaw, tokenRaw] = result.value;

  if (
    result.value.length !== 4 ||
    userRaw === undefined ||
    statsRaw === undefined ||
    spotRaw === undefined ||
    tokenRaw === undefined ||
    userRaw?.owner !== programId ||
    statsRaw?.owner !== programId ||
    spotRaw?.owner !== programId
  ) {
    throw new VelocityCollateralDepositError(
      'Velocity account state is incomplete.',
      'account_state_invalid',
    );
  }

  const user = decodeUser(Buffer.from(userRaw.data[0], 'base64'));

  if (!user.authority.equals(new PublicKey(owner)) || !supportsInitialDeposit(user)) {
    throw new VelocityCollateralDepositError(
      'This account needs the full position-aware deposit path.',
      'positions_require_full_path',
    );
  }

  const spotMarket = normalizeVelocityAccount<SpotMarketAccount>(
    coder.decode<SpotMarketAccount>(
      'SpotMarket',
      Buffer.from(spotRaw.data[0], 'base64'),
    ),
  );

  if (
    spotMarket.marketIndex !== QUOTE_MARKET_INDEX ||
    !spotMarket.pubkey.equals(new PublicKey(addresses.spotMarketAccount)) ||
    !spotMarket.mint.equals(quoteConfig.mint)
  ) {
    throw new VelocityCollateralDepositError(
      'Velocity returned an unexpected collateral market.',
      'spot_market_invalid',
    );
  }

  return {
    spotMarket,
    tokenBalanceBaseUnits: tokenBalance(tokenRaw, owner),
  };
}

function supportsInitialDeposit(user: UserAccount): boolean {
  const hasPerpRisk = user.perpPositions.some(
    (position) =>
      BigInt(position.baseAssetAmount.toString()) !== 0n ||
      BigInt(position.quoteAssetAmount.toString()) !== 0n ||
      position.openOrders > 0 ||
      BigInt(position.isolatedPositionScaledBalance.toString()) !== 0n,
  );
  const hasUnsupportedSpotRisk = user.spotPositions.some(
    (position) =>
      position.marketIndex !== QUOTE_MARKET_INDEX &&
      (BigInt(position.scaledBalance.toString()) !== 0n || position.openOrders > 0),
  );

  return !hasPerpRisk && !hasUnsupportedSpotRisk && user.openOrders === 0;
}

function tokenBalance(account: AccountValue, owner: string): bigint {
  if (account === null) {
    return 0n;
  }

  const data = Buffer.from(account.data[0], 'base64');

  if (
    account.owner !== TOKEN_PROGRAM_ID.toBase58() ||
    data.length < 72 ||
    !new PublicKey(data.subarray(0, 32)).equals(quoteConfig.mint) ||
    !new PublicKey(data.subarray(32, 64)).equals(new PublicKey(owner))
  ) {
    throw new VelocityCollateralDepositError(
      'Trading wallet T has an unexpected USDT token account.',
      'token_account_invalid',
    );
  }

  return data.readBigUInt64LE(64);
}

async function simulateDeposit(
  transaction: Transaction,
  rpcUrl: string,
  signer: GatewayRequestSigner,
  signal?: AbortSignal,
): Promise<'passed'> {
  const result = await signedSolanaRpc<ContextValue<{ readonly err: unknown }>>({
    method: 'simulateTransaction',
    params: [
      base64.encode(
        transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        }),
      ),
      {
        commitment: 'confirmed',
        encoding: 'base64',
        replaceRecentBlockhash: false,
        sigVerify: false,
      },
    ],
    rpcUrl,
    signer,
    timeoutMs: 12_000,
    ...(signal === undefined ? {} : { signal }),
  });

  if (result.value.err !== null) {
    throw new VelocityCollateralDepositError(
      'Velocity rejected the USDT deposit preview.',
      'simulation_failed',
    );
  }

  return 'passed';
}

function assertSigner(owner: string, signer: GatewayRequestSigner): void {
  if (!new PublicKey(signer.publicKey).equals(new PublicKey(owner))) {
    throw new VelocityCollateralDepositError(
      'The active trading signer does not match trading wallet T.',
      'signer_mismatch',
    );
  }
}

function safeInteger(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new VelocityCollateralDepositError(
      `The ${label} is invalid.`,
      'rpc_value_invalid',
    );
  }

  return BigInt(value);
}
