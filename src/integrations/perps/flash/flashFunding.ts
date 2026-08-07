import { base64 } from '@scure/base';
import { BN } from '@flash_trade/flash-sdk-v2/node_modules/@coral-xyz/anchor';
import { DELEGATION_PROGRAM_ID } from '@flash_trade/flash-sdk-v2/dist/constants';
import { delegateBasket } from '@flash_trade/flash-sdk-v2/dist/instructions/trade/delegateBasket';
import { depositDirect } from '@flash_trade/flash-sdk-v2/dist/instructions/trade/depositDirect';
import { initializeBasket } from '@flash_trade/flash-sdk-v2/dist/instructions/trade/initializeBasket';
import { initializeUserDepositLedger } from '@flash_trade/flash-sdk-v2/dist/instructions/setup/initializeUserDepositLedger';
import {
  findBasketAddress,
  findTradeVaultAddress,
  findTradeVaultTokenAccountAddress,
  findUserDepositLedgerAddress,
} from '@flash_trade/flash-sdk-v2/dist/utils';
import { Buffer } from 'buffer';
import * as Crypto from 'expo-crypto';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { createFlashProgram } from '@/integrations/perps/flash/flashProgram';
import { fundingRequiredSol } from '@/integrations/perps/tradeCollateralMath';
import {
  signAndSubmitLegacyTransaction,
  type SubmittedTransactionResult,
} from '@/integrations/solana/signedLegacyTransaction';

const PLAN_LIFETIME_MS = 60_000;
const COMPUTE_UNIT_LIMIT = 600_000;
const COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 5_000;
const BASKET_ACCOUNT_SIZE = 96;
const USER_DEPOSIT_LEDGER_SIZE = 696;

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

type ActionInput = {
  readonly amountBaseUnits: bigint;
  readonly mint: string;
  readonly owner: string;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly signal?: AbortSignal;
};

export type FlashFundingPlan = {
  readonly amountBaseUnits: bigint;
  readonly basket: string;
  readonly createBasket: boolean;
  readonly createLedger: boolean;
  readonly delegateBasket: boolean;
  readonly feeLamports: bigint;
  readonly idempotencyKey: string;
  readonly ledger: string;
  readonly mint: string;
  readonly owner: string;
  readonly recentBlockhash: string;
  readonly rentLamports: bigint;
  readonly requiredSolLamports: bigint;
  readonly simulation: 'passed' | 'insufficient-sol' | 'insufficient-token';
  readonly solBalanceLamports: bigint;
  readonly tokenBalanceBaseUnits: bigint;
  readonly unsignedTransaction: Uint8Array;
  readonly expiresAtMs: number;
};

export class FlashFundingError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'FlashFundingError';
  }
}

export async function prepareFlashFunding(
  input: ActionInput,
): Promise<FlashFundingPlan> {
  assertInput(input);
  const addresses = fundingAddresses(input);
  const [accounts, blockhash, solBalance] = await Promise.all([
    readAccounts(addresses, input),
    signedSolanaRpc<ContextValue<{
      readonly blockhash: string;
      readonly lastValidBlockHeight: number;
    }>>({
      method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    signedSolanaRpc<ContextValue<number>>({
      method: 'getBalance',
      params: [input.owner, { commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  ]);
  const state = validateAccounts(accounts, input.programId);
  const transaction = await buildTransaction({
    ...input,
    ...state,
    recentBlockhash: blockhash.value.blockhash,
  });
  const [fee, rentLamports] = await Promise.all([
    signedSolanaRpc<ContextValue<number | null>>({
      method: 'getFeeForMessage',
      params: [base64.encode(transaction.serializeMessage()), { commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    flashFundingRent(state, input),
  ]);
  const feeLamports = safeInteger(fee.value, 'network fee');
  const solBalanceLamports = safeInteger(solBalance.value, 'SOL balance');
  const requiredSolLamports = fundingRequiredSol(
    feeLamports,
    rentLamports,
  );
  const simulation = state.tokenBalanceBaseUnits < input.amountBaseUnits
    ? 'insufficient-token'
    : solBalanceLamports < requiredSolLamports
      ? 'insufficient-sol'
      : await simulate(transaction, input);
  const plan: FlashFundingPlan = {
    amountBaseUnits: input.amountBaseUnits,
    basket: addresses.basket,
    createBasket: state.createBasket,
    createLedger: state.createLedger,
    delegateBasket: state.delegateBasket,
    feeLamports,
    idempotencyKey: Crypto.randomUUID(),
    ledger: addresses.ledger,
    mint: input.mint,
    owner: input.owner,
    recentBlockhash: blockhash.value.blockhash,
    rentLamports,
    requiredSolLamports,
    simulation,
    solBalanceLamports,
    tokenBalanceBaseUnits: state.tokenBalanceBaseUnits,
    unsignedTransaction: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
  };

  await verifyFlashFundingPlan(plan, input.programId);
  return plan;
}

export async function submitFlashFunding(
  input: ActionInput & {
    readonly plan: FlashFundingPlan;
    readonly onSigned?: (signature: string) => Promise<void>;
  },
): Promise<SubmittedTransactionResult> {
  assertInput(input);
  await verifyFlashFundingPlan(input.plan, input.programId);

  if (
    input.plan.owner !== input.owner ||
    input.plan.mint !== input.mint ||
    input.plan.amountBaseUnits !== input.amountBaseUnits ||
    Date.now() >= input.plan.expiresAtMs
  ) {
    throw new FlashFundingError('The Flash funding plan expired.', 'plan_expired');
  }

  if (input.plan.simulation !== 'passed') {
    throw new FlashFundingError(
      input.plan.simulation === 'insufficient-token'
        ? 'Private wallet T needs the claimed USDC before Flash funding.'
        : 'Private wallet T needs SOL for Flash setup fees.',
      input.plan.simulation === 'insufficient-token'
        ? 'insufficient_usdc'
        : 'insufficient_sol',
    );
  }

  return signAndSubmitLegacyTransaction({
    idempotencyKey: input.plan.idempotencyKey,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    unsignedTransaction: input.plan.unsignedTransaction,
    ...(input.onSigned === undefined ? {} : { onSigned: input.onSigned }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

async function flashFundingRent(
  state: { readonly createBasket: boolean; readonly createLedger: boolean },
  input: ActionInput,
): Promise<bigint> {
  const sizes = [
    ...(state.createBasket ? [BASKET_ACCOUNT_SIZE] : []),
    ...(state.createLedger ? [USER_DEPOSIT_LEDGER_SIZE] : []),
  ];
  const rents = await Promise.all(sizes.map((size) =>
    signedSolanaRpc<number>({
      method: 'getMinimumBalanceForRentExemption',
      params: [size, { commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  ));
  return rents.reduce(
    (total, value) => total + safeInteger(value, 'account rent'),
    0n,
  );
}

async function verifyFlashFundingPlan(
  plan: FlashFundingPlan,
  programId: string,
): Promise<void> {
  const expected = await buildTransaction({
    amountBaseUnits: plan.amountBaseUnits,
    createBasket: plan.createBasket,
    createLedger: plan.createLedger,
    delegateBasket: plan.delegateBasket,
    mint: plan.mint,
    owner: plan.owner,
    programId,
    recentBlockhash: plan.recentBlockhash,
  });
  const actual = Transaction.from(plan.unsignedTransaction);

  if (
    actual.feePayer?.toBase58() !== plan.owner ||
    actual.recentBlockhash !== plan.recentBlockhash ||
    !actual.serializeMessage().equals(expected.serializeMessage()) ||
    actual.signatures.some((entry) =>
      entry.signature?.some((byte) => byte !== 0),
    )
  ) {
    throw new FlashFundingError(
      'The prepared transaction does not match Flash setup and deposit.',
      'verification_failed',
    );
  }
}

async function buildTransaction(input: {
  readonly amountBaseUnits: bigint;
  readonly createBasket: boolean;
  readonly createLedger: boolean;
  readonly delegateBasket: boolean;
  readonly mint: string;
  readonly owner: string;
  readonly programId: string;
  readonly recentBlockhash: string;
}): Promise<Transaction> {
  const owner = new PublicKey(input.owner);
  const mint = new PublicKey(input.mint);
  const program = createFlashProgram(input.programId, owner);
  const instructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
    }),
  ];

  if (input.createBasket) {
    instructions.push(await initializeBasket(program, owner));
  }
  if (input.createLedger) {
    instructions.push(await initializeUserDepositLedger(program, owner));
  }

  instructions.push(
    await depositDirect(
      program,
      owner,
      mint,
      getAssociatedTokenAddressSync(mint, owner),
      new BN(input.amountBaseUnits.toString()),
      owner,
    ),
  );

  if (input.delegateBasket) {
    instructions.push(await delegateBasket(program, owner, owner));
  }

  return new Transaction({
    feePayer: owner,
    recentBlockhash: input.recentBlockhash,
  }).add(...instructions);
}

function fundingAddresses(input: Pick<ActionInput, 'mint' | 'owner' | 'programId'>) {
  const owner = new PublicKey(input.owner);
  const mint = new PublicKey(input.mint);
  const program = new PublicKey(input.programId);
  return {
    basket: findBasketAddress(owner, program)[0].toBase58(),
    ledger: findUserDepositLedgerAddress(owner, program)[0].toBase58(),
    tokenAccount: getAssociatedTokenAddressSync(mint, owner).toBase58(),
    tradeVault: findTradeVaultAddress(mint, program)[0].toBase58(),
    tradeVaultTokenAccount:
      findTradeVaultTokenAccountAddress(mint, program)[0].toBase58(),
  };
}

async function readAccounts(
  addresses: ReturnType<typeof fundingAddresses>,
  input: ActionInput,
): Promise<AccountSet> {
  return signedSolanaRpc<AccountSet>({
    method: 'getMultipleAccounts',
    params: [
      [
        addresses.basket,
        addresses.ledger,
        addresses.tokenAccount,
        addresses.tradeVault,
        addresses.tradeVaultTokenAccount,
      ],
      { commitment: 'confirmed', encoding: 'base64' },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

function validateAccounts(
  result: AccountSet,
  programId: string,
): {
  readonly createBasket: boolean;
  readonly createLedger: boolean;
  readonly delegateBasket: boolean;
  readonly tokenBalanceBaseUnits: bigint;
} {
  const [basket, ledger, token, tradeVault, tradeVaultToken] = result.value;

  if (result.value.length !== 5 || token == null || tradeVault == null || tradeVaultToken == null) {
    throw new FlashFundingError('Flash funding accounts are unavailable.', 'account_unavailable');
  }

  const delegatedOwner = DELEGATION_PROGRAM_ID.toBase58();
  const createBasket = basket == null;
  const createLedger = ledger == null;
  const delegate = basket == null || basket.owner === programId;

  if (
    (basket != null && basket.owner !== programId && basket.owner !== delegatedOwner) ||
    (ledger != null && ledger.owner !== programId) ||
    token.owner !== TOKEN_PROGRAM_ID.toBase58() ||
    tradeVault.owner !== programId ||
    tradeVaultToken.owner !== TOKEN_PROGRAM_ID.toBase58()
  ) {
    throw new FlashFundingError('Flash returned mismatched funding accounts.', 'account_mismatch');
  }

  return {
    createBasket,
    createLedger,
    delegateBasket: delegate,
    tokenBalanceBaseUnits: tokenAmount(token.data[0]),
  };
}

async function simulate(
  transaction: Transaction,
  input: ActionInput,
): Promise<'passed'> {
  const result = await signedSolanaRpc<ContextValue<{ readonly err: unknown }>>({
    method: 'simulateTransaction',
    params: [
      base64.encode(transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      })),
      {
        commitment: 'confirmed',
        encoding: 'base64',
        replaceRecentBlockhash: false,
        sigVerify: false,
      },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    timeoutMs: 12_000,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  if (result.value.err !== null) {
    throw new FlashFundingError('Flash rejected setup or deposit.', 'simulation_failed');
  }
  return 'passed';
}

function assertInput(input: ActionInput): void {
  if (input.amountBaseUnits <= 0n) {
    throw new FlashFundingError('Flash deposit must be greater than zero.', 'amount_invalid');
  }
  if (!new PublicKey(input.signer.publicKey).equals(new PublicKey(input.owner))) {
    throw new FlashFundingError('Trading wallet T does not match the signer.', 'signer_mismatch');
  }
}

function tokenAmount(encoded: string): bigint {
  const data = Buffer.from(encoded, 'base64');
  if (data.length < 72) {
    throw new FlashFundingError('Flash USDC token account is invalid.', 'token_account_invalid');
  }
  return data.readBigUInt64LE(64);
}

function safeInteger(value: number | null, label: string): bigint {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new FlashFundingError(`Flash ${label} is invalid.`, 'rpc_value_invalid');
  }
  return BigInt(value);
}
