import * as Crypto from 'expo-crypto';
import { base64 } from '@scure/base';
import { Buffer } from 'buffer';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  ExtensionType,
  getAccountLenForMint,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from '@solana/spl-token';
import { PublicKey, SystemProgram, Transaction, type AccountInfo } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  removePendingTradeAction,
  writePendingTradeAction,
} from '@/integrations/perps/tradeActionStorage';
import {
  signAndSubmitLegacyTransaction,
  TransactionSigningError,
  type SubmittedTransactionResult,
} from '@/integrations/solana/signedLegacyTransaction';

const PLAN_LIFETIME_MS = 45_000;
const UNSUPPORTED_TOKEN_2022_EXTENSIONS = new Set([
  ExtensionType.ConfidentialTransferMint,
  ExtensionType.NonTransferable,
  ExtensionType.TransferFeeConfig,
  ExtensionType.TransferHook,
]);

type RpcAccount = {
  readonly data: readonly [string, 'base64'];
  readonly executable: boolean;
  readonly lamports: number;
  readonly owner: string;
  readonly rentEpoch?: number;
};

export type DirectWithdrawalPlan = {
  readonly amountBaseUnits: bigint;
  readonly destinationAddress: string;
  readonly destinationTokenAccount: string | null;
  readonly decimals: number;
  readonly expiresAtMs: number;
  readonly feeLamports: bigint;
  readonly idempotencyKey: string;
  readonly kind: 'native' | 'spl';
  readonly mint: string;
  readonly owner: string;
  readonly rentLamports: bigint;
  readonly sourceTokenAccount: string | null;
  readonly symbol: string;
  readonly tokenAccountRentLamports: bigint;
  readonly tokenProgramId: string | null;
  readonly unsignedTransaction: Uint8Array;
};

export class DirectWithdrawalError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'DirectWithdrawalError';
  }
}

export async function prepareDirectWithdrawal(input: {
  readonly amountBaseUnits: bigint;
  readonly decimals: number;
  readonly destinationAddress: string;
  readonly kind: 'native' | 'spl';
  readonly mint: string;
  readonly owner: string;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly symbol: string;
}): Promise<DirectWithdrawalPlan> {
  const owner = publicKey(input.owner, 'Private wallet T');
  const destination = publicKey(input.destinationAddress, 'Destination wallet');
  if (
    input.amountBaseUnits <= 0n ||
    owner.equals(destination) ||
    !PublicKey.isOnCurve(destination.toBytes()) ||
    !new PublicKey(input.signer.publicKey).equals(owner)
  ) {
    throw new DirectWithdrawalError('Review the amount and destination wallet.', 'plan_invalid');
  }

  const [blockhash, solBalance] = await Promise.all([
    latestBlockhash(input),
    readSolBalance(input.owner, input),
  ]);
  const transaction = new Transaction({ feePayer: owner, recentBlockhash: blockhash });
  let destinationTokenAccount: string | null = null;
  let rentLamports = 0n;
  let sourceTokenAccount: string | null = null;
  let tokenAccountRentLamports = 0n;
  let tokenProgramId: string | null = null;

  if (input.kind === 'native') {
    if (input.mint !== NATIVE_MINT.toBase58() || input.decimals !== 9) {
      throw new DirectWithdrawalError('The native SOL withdrawal details are invalid.', 'plan_invalid');
    }
    transaction.add(SystemProgram.transfer({
      fromPubkey: owner,
      lamports: input.amountBaseUnits,
      toPubkey: destination,
    }));
  } else {
    const mint = publicKey(input.mint, 'Token mint');
    const mintAccount = await readAccount(mint.toBase58(), input);
    if (mintAccount === null) {
      throw new DirectWithdrawalError('The selected token mint does not exist.', 'mint_invalid');
    }
    const programId = tokenProgram(mintAccount.owner);
    tokenProgramId = programId.toBase58();
    const mintState = unpackMint(mint, accountInfo(mintAccount), programId);
    if (mintState.decimals !== input.decimals || !mintState.isInitialized) {
      throw new DirectWithdrawalError('The selected token details changed.', 'mint_invalid');
    }
    if (getExtensionTypes(mintState.tlvData).some(
      (extension) => UNSUPPORTED_TOKEN_2022_EXTENSIONS.has(extension),
    )) {
      throw new DirectWithdrawalError(
        'This Token-2022 mint has transfer rules that cannot be reviewed safely in-app.',
        'token_rules_unsupported',
      );
    }

    const source = getAssociatedTokenAddressSync(mint, owner, false, programId);
    const destinationAccount = getAssociatedTokenAddressSync(mint, destination, false, programId);
    const [sourceAccount, targetAccount, accountRent] = await Promise.all([
      readAccount(source.toBase58(), input),
      readAccount(destinationAccount.toBase58(), input),
      minimumRent(getAccountLenForMint(mintState), input),
    ]);
    if (sourceAccount?.owner !== programId.toBase58()) {
      throw new DirectWithdrawalError(`Private wallet T does not hold ${input.symbol}.`, 'balance_invalid');
    }
    if (targetAccount !== null && targetAccount.owner !== programId.toBase58()) {
      throw new DirectWithdrawalError('The destination token account is invalid.', 'destination_invalid');
    }
    const sourceBalance = await readTokenBalance(source.toBase58(), input);
    if (sourceBalance.amount < input.amountBaseUnits || sourceBalance.decimals !== input.decimals) {
      throw new DirectWithdrawalError(
        `Private wallet T does not hold enough ${input.symbol}.`,
        'insufficient_token',
      );
    }

    tokenAccountRentLamports = accountRent;
    rentLamports = targetAccount === null ? accountRent : 0n;
    sourceTokenAccount = source.toBase58();
    destinationTokenAccount = destinationAccount.toBase58();
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        destinationAccount,
        destination,
        mint,
        programId,
      ),
      createTransferCheckedInstruction(
        source,
        mint,
        destinationAccount,
        owner,
        input.amountBaseUnits,
        input.decimals,
        [],
        programId,
      ),
    );
  }

  const feeLamports = await transactionFee(transaction, input);
  const requiredSolLamports = feeLamports + rentLamports +
    (input.kind === 'native' ? input.amountBaseUnits : 0n);
  if (solBalance < requiredSolLamports) {
    throw new DirectWithdrawalError(
      input.kind === 'native'
        ? 'Private wallet T needs enough SOL for the amount and network fee.'
        : 'Private wallet T needs more SOL for the network fee and destination token-account rent.',
      'insufficient_sol',
    );
  }

  await simulate(transaction, input);
  return {
    amountBaseUnits: input.amountBaseUnits,
    destinationAddress: destination.toBase58(),
    destinationTokenAccount,
    decimals: input.decimals,
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
    feeLamports,
    idempotencyKey: Crypto.randomUUID(),
    kind: input.kind,
    mint: input.mint,
    owner: owner.toBase58(),
    rentLamports,
    sourceTokenAccount,
    symbol: input.symbol,
    tokenAccountRentLamports,
    tokenProgramId,
    unsignedTransaction: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  };
}

export async function submitDirectWithdrawal(input: {
  readonly plan: DirectWithdrawalPlan;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
}): Promise<SubmittedTransactionResult> {
  if (Date.now() >= input.plan.expiresAtMs) {
    throw new DirectWithdrawalError('The withdrawal preview expired. Review it again.', 'plan_expired');
  }
  assertReviewedTransaction(input.plan);

  const destinationExists = input.plan.destinationTokenAccount === null
    ? true
    : await readAccount(input.plan.destinationTokenAccount, input) !== null;
  const [solBalance, tokenBalance] = await Promise.all([
    readSolBalance(input.plan.owner, input),
    input.plan.sourceTokenAccount === null
      ? Promise.resolve(null)
      : readTokenBalance(input.plan.sourceTokenAccount, input),
  ]);
  const requiredSol = input.plan.feeLamports +
    (destinationExists ? 0n : input.plan.tokenAccountRentLamports) +
    (input.plan.kind === 'native' ? input.plan.amountBaseUnits : 0n);
  if (solBalance < requiredSol) {
    throw new DirectWithdrawalError('The SOL balance changed. Review a fresh withdrawal.', 'balance_changed');
  }
  if (tokenBalance !== null && (
    tokenBalance.amount < input.plan.amountBaseUnits ||
    tokenBalance.decimals !== input.plan.decimals
  )) {
    throw new DirectWithdrawalError(
      `The ${input.plan.symbol} balance changed. Review a fresh withdrawal.`,
      'balance_changed',
    );
  }

  try {
    const result = await signAndSubmitLegacyTransaction({
      idempotencyKey: input.plan.idempotencyKey,
      onSigned: (signature, signedTransactionBase64) => writePendingTradeAction({
        amountBaseUnits: input.plan.amountBaseUnits.toString(),
        expiresAtMs: input.plan.expiresAtMs,
        idempotencyKey: input.plan.idempotencyKey,
        kind: 'withdraw',
        owner: input.plan.owner,
        provider: 'wallet-withdrawal',
        signature,
        signedTransactionBase64,
        updatedAtMs: Date.now(),
        version: 1,
      }),
      onSubmissionRejected: () => removePendingTradeAction(
        input.plan.owner,
        'wallet-withdrawal',
      ),
      owner: input.plan.owner,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      unsignedTransaction: input.plan.unsignedTransaction,
    });
    if (result.status === 'confirmed') {
      await removePendingTradeAction(input.plan.owner, 'wallet-withdrawal');
    }
    return result;
  } catch (cause) {
    if (cause instanceof TransactionSigningError && (
      cause.code === 'transaction_failed' || cause.code === 'submission_rejected'
    )) {
      await removePendingTradeAction(input.plan.owner, 'wallet-withdrawal');
    }
    throw cause;
  }
}

function assertReviewedTransaction(plan: DirectWithdrawalPlan): void {
  const actual = Transaction.from(plan.unsignedTransaction);
  if (actual.recentBlockhash === undefined) {
    throw new DirectWithdrawalError('The withdrawal transaction is invalid.', 'transaction_invalid');
  }
  const owner = new PublicKey(plan.owner);
  const destination = new PublicKey(plan.destinationAddress);
  const expected = new Transaction({ feePayer: owner, recentBlockhash: actual.recentBlockhash });

  if (plan.kind === 'native') {
    expected.add(SystemProgram.transfer({
      fromPubkey: owner,
      lamports: plan.amountBaseUnits,
      toPubkey: destination,
    }));
  } else {
    if (
      plan.sourceTokenAccount === null ||
      plan.destinationTokenAccount === null ||
      plan.tokenProgramId === null
    ) {
      throw new DirectWithdrawalError('The withdrawal transaction is invalid.', 'transaction_invalid');
    }
    const mint = new PublicKey(plan.mint);
    const programId = new PublicKey(plan.tokenProgramId);
    const source = new PublicKey(plan.sourceTokenAccount);
    const destinationAccount = new PublicKey(plan.destinationTokenAccount);
    expected.add(
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        destinationAccount,
        destination,
        mint,
        programId,
      ),
      createTransferCheckedInstruction(
        source,
        mint,
        destinationAccount,
        owner,
        plan.amountBaseUnits,
        plan.decimals,
        [],
        programId,
      ),
    );
  }

  if (!Buffer.from(actual.serializeMessage()).equals(Buffer.from(expected.serializeMessage()))) {
    throw new DirectWithdrawalError(
      'The withdrawal transaction no longer matches your review.',
      'transaction_mismatch',
    );
  }
}

async function latestBlockhash(input: RpcInput): Promise<string> {
  const response = await rpc<{ readonly value: { readonly blockhash: string } }>(
    input,
    'getLatestBlockhash',
    [{ commitment: 'confirmed' }],
  );
  return response.value.blockhash;
}

async function readSolBalance(owner: string, input: RpcInput): Promise<bigint> {
  const response = await rpc<{ readonly value: number }>(
    input,
    'getBalance',
    [owner, { commitment: 'confirmed' }],
  );
  return integer(response.value, 'SOL balance');
}

async function readAccount(address: string, input: RpcInput): Promise<RpcAccount | null> {
  const response = await rpc<{ readonly value: RpcAccount | null }>(
    input,
    'getAccountInfo',
    [address, { commitment: 'confirmed', encoding: 'base64' }],
  );
  return response.value;
}

async function readTokenBalance(
  tokenAccount: string,
  input: RpcInput,
): Promise<{ readonly amount: bigint; readonly decimals: number }> {
  const response = await rpc<{
    readonly value: { readonly amount: string; readonly decimals: number };
  }>(input, 'getTokenAccountBalance', [tokenAccount, { commitment: 'confirmed' }]);
  if (!/^\d+$/u.test(response.value.amount) || !Number.isInteger(response.value.decimals)) {
    throw new DirectWithdrawalError('The token balance is invalid.', 'balance_invalid');
  }
  return { amount: BigInt(response.value.amount), decimals: response.value.decimals };
}

async function minimumRent(bytes: number, input: RpcInput): Promise<bigint> {
  return integer(await rpc<number>(
    input,
    'getMinimumBalanceForRentExemption',
    [bytes, { commitment: 'confirmed' }],
  ), 'token-account rent');
}

async function transactionFee(transaction: Transaction, input: RpcInput): Promise<bigint> {
  const response = await rpc<{ readonly value: number | null }>(
    input,
    'getFeeForMessage',
    [base64.encode(transaction.serializeMessage()), { commitment: 'confirmed' }],
  );
  if (response.value === null) {
    throw new DirectWithdrawalError('The network fee could not be verified.', 'fee_invalid');
  }
  return integer(response.value, 'network fee');
}

async function simulate(transaction: Transaction, input: RpcInput): Promise<void> {
  const response = await rpc<{ readonly value: { readonly err: unknown } }>(
    input,
    'simulateTransaction',
    [
      base64.encode(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })),
      { commitment: 'confirmed', encoding: 'base64', sigVerify: false },
    ],
  );
  if (response.value.err !== null) {
    throw new DirectWithdrawalError(
      'The direct withdrawal preview failed. No funds were moved.',
      'simulation_failed',
    );
  }
}

type RpcInput = {
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
};

async function rpc<T>(input: RpcInput, method: string, params: unknown): Promise<T> {
  return signedSolanaRpc<T>({
    method,
    params,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

function tokenProgram(owner: string): PublicKey {
  if (owner === TOKEN_PROGRAM_ID.toBase58()) return TOKEN_PROGRAM_ID;
  if (owner === TOKEN_2022_PROGRAM_ID.toBase58()) return TOKEN_2022_PROGRAM_ID;
  throw new DirectWithdrawalError('The selected mint is not an SPL token.', 'mint_invalid');
}

function accountInfo(value: RpcAccount): AccountInfo<Buffer> {
  return {
    data: Buffer.from(base64.decode(value.data[0])),
    executable: value.executable,
    lamports: Number(integer(value.lamports, 'mint account balance')),
    owner: new PublicKey(value.owner),
    ...(value.rentEpoch === undefined ? {} : { rentEpoch: value.rentEpoch }),
  };
}

function integer(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DirectWithdrawalError(`Solana returned an invalid ${label}.`, 'rpc_invalid');
  }
  return BigInt(value);
}

function publicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new DirectWithdrawalError(`${label} is invalid.`, 'address_invalid');
  }
}
