import * as Crypto from 'expo-crypto';
import { Buffer } from 'buffer';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  ExtensionType,
  getAccountLenForMint,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  NATIVE_MINT,
  unpackMint,
} from '@solana/spl-token';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  removePendingTradeAction,
  writePendingTradeAction,
} from '@/integrations/perps/tradeActionStorage';
import {
  signAndSubmitLegacyTransaction,
  TransactionSigningError,
  type LegacyTransactionAuthority,
  type SubmittedTransactionResult,
} from '@/integrations/solana/signedLegacyTransaction';
import {
  accountInfo,
  latestBlockhash,
  minimumRent,
  publicKey,
  readAccount,
  readOwnedTokenAccounts,
  readSolBalance,
  readTokenBalance,
  simulate,
  tokenProgram,
  transactionFee,
} from '@/integrations/solana/directWithdrawalRpc';
import { DirectWithdrawalError } from '@/integrations/solana/directWithdrawalError';

export { DirectWithdrawalError } from '@/integrations/solana/directWithdrawalError';

const PLAN_LIFETIME_MS = 45_000;
const UNSUPPORTED_TOKEN_2022_EXTENSIONS = new Set([
  ExtensionType.ConfidentialTransferMint,
  ExtensionType.NonTransferable,
  ExtensionType.TransferFeeConfig,
  ExtensionType.TransferHook,
]);

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
  readonly sourceTokenAccounts: readonly {
    readonly address: string;
    readonly amountBaseUnits: bigint;
  }[];
  readonly symbol: string;
  readonly tokenAccountRentLamports: bigint;
  readonly tokenProgramId: string | null;
  readonly unsignedTransaction: Uint8Array;
};

export async function prepareDirectWithdrawal(input: {
  readonly amountBaseUnits: bigint | 'max';
  readonly decimals: number;
  readonly destinationAddress: string;
  readonly kind: 'native' | 'spl';
  readonly mint: string;
  readonly owner: string;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly symbol: string;
  readonly transactionAuthorityPublicKey?: Uint8Array;
}): Promise<DirectWithdrawalPlan> {
  const owner = publicKey(input.owner, 'Source wallet');
  const destination = publicKey(input.destinationAddress, 'Destination wallet');
  if (
    (input.amountBaseUnits !== 'max' && input.amountBaseUnits <= 0n) ||
    owner.equals(destination) ||
    !PublicKey.isOnCurve(destination.toBytes()) ||
    !new PublicKey(input.transactionAuthorityPublicKey ?? input.signer.publicKey).equals(owner)
  ) {
    throw new DirectWithdrawalError('Review the amount and destination wallet.', 'plan_invalid');
  }

  const [blockhash, solBalance] = await Promise.all([
    latestBlockhash(input),
    readSolBalance(input.owner, input),
  ]);
  const transaction = new Transaction({ feePayer: owner, recentBlockhash: blockhash });
  let amountBaseUnits = input.amountBaseUnits === 'max'
    ? solBalance
    : input.amountBaseUnits;
  let destinationTokenAccount: string | null = null;
  let rentLamports = 0n;
  let sourceTokenAccounts: DirectWithdrawalPlan['sourceTokenAccounts'] = [];
  let tokenAccountRentLamports = 0n;
  let tokenProgramId: string | null = null;

  if (input.kind === 'native') {
    if (input.mint !== NATIVE_MINT.toBase58() || input.decimals !== 9) {
      throw new DirectWithdrawalError('The native SOL withdrawal details are invalid.', 'plan_invalid');
    }
    transaction.add(SystemProgram.transfer({
      fromPubkey: owner,
      lamports: amountBaseUnits,
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

    const destinationAccount = getAssociatedTokenAddressSync(mint, destination, false, programId);
    const [ownedAccounts, targetAccount, accountRent] = await Promise.all([
      readOwnedTokenAccounts(owner.toBase58(), mint.toBase58(), input),
      readAccount(destinationAccount.toBase58(), input),
      minimumRent(getAccountLenForMint(mintState), input),
    ]);
    const usableAccounts = ownedAccounts.filter((account) => account.amount > 0n);
    if (usableAccounts.some(
      (account) => account.programId !== programId.toBase58() || account.decimals !== input.decimals,
    )) {
      throw new DirectWithdrawalError('A source token account changed.', 'balance_invalid');
    }
    const sourceBalance = usableAccounts.reduce((total, account) => total + account.amount, 0n);
    if (sourceBalance === 0n) {
      throw new DirectWithdrawalError(`This wallet does not hold ${input.symbol}.`, 'balance_invalid');
    }
    if (targetAccount !== null && targetAccount.owner !== programId.toBase58()) {
      throw new DirectWithdrawalError('The destination token account is invalid.', 'destination_invalid');
    }
    if (input.amountBaseUnits === 'max') amountBaseUnits = sourceBalance;
    if (
      amountBaseUnits <= 0n ||
      sourceBalance < amountBaseUnits
    ) {
      throw new DirectWithdrawalError(
        `This wallet does not hold enough ${input.symbol}.`,
        'insufficient_token',
      );
    }

    tokenAccountRentLamports = accountRent;
    rentLamports = targetAccount === null ? accountRent : 0n;
    sourceTokenAccounts = allocateTokenSources(usableAccounts, amountBaseUnits);
    destinationTokenAccount = destinationAccount.toBase58();
    transaction.add(createAssociatedTokenAccountIdempotentInstruction(
      owner,
      destinationAccount,
      destination,
      mint,
      programId,
    ));
    for (const source of sourceTokenAccounts) {
      transaction.add(createTransferCheckedInstruction(
        new PublicKey(source.address),
        mint,
        destinationAccount,
        owner,
        source.amountBaseUnits,
        input.decimals,
        [],
        programId,
      ));
    }
  }

  const feeLamports = await transactionFee(transaction, input);
  if (input.kind === 'native' && input.amountBaseUnits === 'max') {
    if (solBalance <= feeLamports) {
      throw new DirectWithdrawalError(
        'This wallet does not have enough SOL to cover the network fee.',
        'insufficient_sol',
      );
    }
    amountBaseUnits = solBalance - feeLamports;
    transaction.instructions[0] = SystemProgram.transfer({
      fromPubkey: owner,
      lamports: amountBaseUnits,
      toPubkey: destination,
    });
  }
  const requiredSolLamports = feeLamports + rentLamports +
    (input.kind === 'native' ? amountBaseUnits : 0n);
  if (solBalance < requiredSolLamports) {
    throw new DirectWithdrawalError(
      input.kind === 'native'
        ? 'This wallet needs enough SOL for the amount and network fee.'
        : 'This wallet needs more SOL for the network fee and destination token-account rent.',
      'insufficient_sol',
    );
  }

  await simulate(transaction, input);
  return {
    amountBaseUnits,
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
    sourceTokenAccounts,
    symbol: input.symbol,
    tokenAccountRentLamports,
    tokenProgramId,
    unsignedTransaction: serializeWithdrawal(transaction, sourceTokenAccounts.length > 1),
  };
}

function serializeWithdrawal(transaction: Transaction, splitAcrossAccounts: boolean): Uint8Array {
  try {
    return transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
  } catch {
    throw new DirectWithdrawalError(
      splitAcrossAccounts
        ? 'This token is spread across too many accounts to send in one transaction.'
        : 'The withdrawal transaction could not be prepared safely.',
      splitAcrossAccounts ? 'transaction_too_large' : 'transaction_invalid',
    );
  }
}

export async function submitDirectWithdrawal(input: {
  readonly plan: DirectWithdrawalPlan;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly transactionAuthority?: LegacyTransactionAuthority;
}): Promise<SubmittedTransactionResult> {
  if (Date.now() >= input.plan.expiresAtMs) {
    throw new DirectWithdrawalError('The withdrawal preview expired. Review it again.', 'plan_expired');
  }
  assertReviewedTransaction(input.plan);

  const destinationExists = input.plan.destinationTokenAccount === null
    ? true
    : await readAccount(input.plan.destinationTokenAccount, input) !== null;
  const [solBalance, tokenBalances] = await Promise.all([
    readSolBalance(input.plan.owner, input),
    Promise.all(input.plan.sourceTokenAccounts.map((source) =>
      readTokenBalance(source.address, input),
    )),
  ]);
  const requiredSol = input.plan.feeLamports +
    (destinationExists ? 0n : input.plan.tokenAccountRentLamports) +
    (input.plan.kind === 'native' ? input.plan.amountBaseUnits : 0n);
  if (solBalance < requiredSol) {
    throw new DirectWithdrawalError('The SOL balance changed. Review a fresh withdrawal.', 'balance_changed');
  }
  if (tokenBalances.some((balance, index) => (
    balance.amount < input.plan.sourceTokenAccounts[index]!.amountBaseUnits ||
    balance.decimals !== input.plan.decimals
  ))) {
    throw new DirectWithdrawalError(
      `The ${input.plan.symbol} balance changed. Review a fresh withdrawal.`,
      'balance_changed',
    );
  }
  await simulate(Transaction.from(input.plan.unsignedTransaction), input);

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
      ...(input.transactionAuthority === undefined
        ? {}
        : { transactionAuthority: input.transactionAuthority }),
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
      plan.sourceTokenAccounts.length === 0 ||
      plan.destinationTokenAccount === null ||
      plan.tokenProgramId === null
    ) {
      throw new DirectWithdrawalError('The withdrawal transaction is invalid.', 'transaction_invalid');
    }
    const mint = new PublicKey(plan.mint);
    const programId = new PublicKey(plan.tokenProgramId);
    const destinationAccount = new PublicKey(plan.destinationTokenAccount);
    expected.add(createAssociatedTokenAccountIdempotentInstruction(
      owner,
      destinationAccount,
      destination,
      mint,
      programId,
    ));
    for (const source of plan.sourceTokenAccounts) {
      expected.add(createTransferCheckedInstruction(
        new PublicKey(source.address),
        mint,
        destinationAccount,
        owner,
        source.amountBaseUnits,
        plan.decimals,
        [],
        programId,
      ));
    }
  }

  if (!Buffer.from(actual.serializeMessage()).equals(Buffer.from(expected.serializeMessage()))) {
    throw new DirectWithdrawalError(
      'The withdrawal transaction no longer matches your review.',
      'transaction_mismatch',
    );
  }
}

function allocateTokenSources(
  accounts: readonly { readonly address: string; readonly amount: bigint }[],
  amount: bigint,
): DirectWithdrawalPlan['sourceTokenAccounts'] {
  let remaining = amount;
  const sources: { address: string; amountBaseUnits: bigint }[] = [];
  for (const account of accounts) {
    if (remaining === 0n) break;
    const next = account.amount < remaining ? account.amount : remaining;
    if (next > 0n) sources.push({ address: account.address, amountBaseUnits: next });
    remaining -= next;
  }
  if (remaining !== 0n) {
    throw new DirectWithdrawalError('The token balance changed. Review a fresh withdrawal.', 'balance_changed');
  }
  return sources;
}
