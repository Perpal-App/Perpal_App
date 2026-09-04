import * as Crypto from 'expo-crypto';
import { base64 } from '@scure/base';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  readSubmittedTransactionStatus,
  signAndSubmitLegacyTransaction,
  storedLegacyTransactionIsCurrent,
  submitSignedLegacyTransaction,
} from '@/integrations/solana/signedLegacyTransaction';
import {
  readTradingWalletRotation,
  removeTradingWalletRotation,
  writeTradingWalletRotation,
  type TradingWalletRotationCheckpoint,
} from '@/storage/trading-wallet-rotation';
import {
  orderTokenMigrations,
  readRotatableTokenAccounts,
  tokenMigrationInstructions,
  type RotatableTokenAccount,
  type RotationRpcInput,
} from '@/wallet/trading/rotationAccounts';
import {
  assertNoPendingRotationActivity,
} from '@/wallet/trading/rotationReadiness';
import {
  TradingWalletRotationError,
  type TradingWalletRotationPlan,
} from '@/wallet/trading/rotationTypes';

const ROTATION_REVIEW_LIFETIME_MS = 45_000;

export { TradingWalletRotationError } from '@/wallet/trading/rotationTypes';
export type { TradingWalletRotationPlan } from '@/wallet/trading/rotationTypes';
export { assertTradingWalletIdentityRetired } from '@/wallet/trading/rotationReadiness';

type RotationInput = {
  readonly config: AppConfig;
  readonly mainWalletAddress: string;
  readonly signer: GatewayRequestSigner;
  readonly tradingWalletAddress: string;
};

export type TradingWalletRotationRecovery =
  | { readonly status: 'none' }
  | {
      readonly checkpoint: TradingWalletRotationCheckpoint;
      readonly status: 'complete' | 'needs-resume';
    };

export async function prepareTradingWalletRotation(
  input: RotationInput & {
    readonly destinationGeneration: number;
    readonly nextWalletAddress: string;
  },
): Promise<TradingWalletRotationPlan> {
  const checkpoint = await readTradingWalletRotation(input.mainWalletAddress);
  await assertNoPendingRotationActivity(input, checkpoint !== null);
  if (checkpoint !== null) {
    assertCheckpointMatches(checkpoint, input, input.nextWalletAddress, input.destinationGeneration);
  }

  const rpcInput = rotationRpcInput(input);
  const [sourceSolLamports, accounts, blockhash] = await Promise.all([
    solBalance(input.tradingWalletAddress, rpcInput),
    readRotatableTokenAccounts(
      input.tradingWalletAddress,
      input.nextWalletAddress,
      rpcInput,
    ),
    latestBlockhash(rpcInput),
  ]);
  const ordered = orderTokenMigrations(accounts);
  let estimatedFeeLamports = 0n;
  for (const account of ordered) {
    const transaction = tokenTransaction(account, input, input.nextWalletAddress, blockhash);
    estimatedFeeLamports += await transactionFee(transaction, rpcInput);
    await simulate(transaction, rpcInput, 'A token migration preview failed.');
  }
  estimatedFeeLamports += await estimatedSweepFee(input, blockhash, rpcInput);

  const uniqueDestinationAccounts = new Map<string, bigint>();
  for (const account of accounts) {
    if (account.destinationAccount !== null && account.destinationRentLamports > 0n) {
      uniqueDestinationAccounts.set(account.destinationAccount, account.destinationRentLamports);
    }
  }
  const destinationRentLamports = [...uniqueDestinationAccounts.values()].reduce(
    (total, rent) => total + rent,
    0n,
  );
  const recoverableRentLamports = accounts.reduce(
    (total, account) => total + account.lamports,
    0n,
  );
  const finalLamports = sourceSolLamports + recoverableRentLamports -
    destinationRentLamports - estimatedFeeLamports;
  if ((sourceSolLamports > 0n || accounts.length > 0) && (
    sourceSolLamports === 0n || finalLamports < 0n
  )) {
    throw new TradingWalletRotationError(
      'Private wallet T needs more SOL for live token-account rent and rotation fees.',
    );
  }

  return {
    destinationGeneration: input.destinationGeneration,
    destinationRentLamports,
    estimatedFeeLamports,
    expiresAtMs: Date.now() + ROTATION_REVIEW_LIFETIME_MS,
    nextWalletAddress: input.nextWalletAddress,
    recoverableRentLamports,
    sourceSolLamports,
    sourceWalletAddress: input.tradingWalletAddress,
    tokenAccountCount: accounts.length,
    tokenMintCount: new Set(accounts.map((account) => account.mint)).size,
  };
}

export async function submitTradingWalletRotation(
  plan: TradingWalletRotationPlan,
  input: RotationInput,
): Promise<void> {
  assertPlanMatches(plan, input);
  await assertNoPendingRotationActivity(input, true);
  let checkpoint = await ensureCheckpoint(plan, input);
  checkpoint = await settleStoredSubmission(checkpoint, input);

  while (checkpoint.phase === 'migrating-tokens') {
    const accounts = orderTokenMigrations(await readRotatableTokenAccounts(
      input.tradingWalletAddress,
      plan.nextWalletAddress,
      rotationRpcInput(input),
    ));
    const account = accounts[0];
    if (account === undefined) {
      checkpoint = await updateCheckpoint(checkpoint, { phase: 'sweeping-sol', submitted: null });
      break;
    }
    await submitStep(
      tokenTransaction(
        account,
        input,
        plan.nextWalletAddress,
        await latestBlockhash(rotationRpcInput(input)),
      ),
      checkpoint,
      input,
    );
    checkpoint = await requireCheckpoint(input.mainWalletAddress);
    checkpoint = await settleStoredSubmission(checkpoint, input);
  }

  if (checkpoint.phase === 'sweeping-sol') {
    const accounts = await readRotatableTokenAccounts(
      input.tradingWalletAddress,
      plan.nextWalletAddress,
      rotationRpcInput(input),
    );
    if (accounts.length > 0) {
      await updateCheckpoint(checkpoint, { phase: 'migrating-tokens', submitted: null });
      return submitTradingWalletRotation(plan, input);
    }
    const balance = await solBalance(input.tradingWalletAddress, rotationRpcInput(input));
    if (balance > 0n) {
      await submitStep(await sweepTransaction(input, plan.nextWalletAddress, balance), checkpoint, input);
      checkpoint = await requireCheckpoint(input.mainWalletAddress);
      checkpoint = await settleStoredSubmission(checkpoint, input);
    }
  }

  const [remainingSol, remainingTokens] = await Promise.all([
    solBalance(input.tradingWalletAddress, rotationRpcInput(input)),
    readRotatableTokenAccounts(
      input.tradingWalletAddress,
      plan.nextWalletAddress,
      rotationRpcInput(input),
    ),
  ]);
  if (remainingSol !== 0n || remainingTokens.length !== 0) {
    throw new TradingWalletRotationError(
      'Rotation is partially complete. Resume it to migrate the remaining private-wallet assets.',
    );
  }
  await updateCheckpoint(checkpoint, { phase: 'complete', submitted: null });
}

export async function reconcileTradingWalletRotation(
  input: RotationInput,
): Promise<TradingWalletRotationRecovery> {
  const checkpoint = await readTradingWalletRotation(input.mainWalletAddress);
  if (checkpoint === null) return { status: 'none' };
  if (
    checkpoint.sourceWalletAddress !== input.tradingWalletAddress &&
    checkpoint.destinationWalletAddress !== input.tradingWalletAddress
  ) {
    throw new TradingWalletRotationError(
      'Saved rotation does not belong to the active private-wallet identity.',
    );
  }
  const [remainingSol, remainingTokens] = await Promise.all([
    solBalance(checkpoint.sourceWalletAddress, rotationRpcInput(input)),
    readRotatableTokenAccounts(
      checkpoint.sourceWalletAddress,
      checkpoint.destinationWalletAddress,
      rotationRpcInput(input),
    ),
  ]);
  return {
    checkpoint,
    status: remainingSol === 0n && remainingTokens.length === 0
      ? 'complete'
      : 'needs-resume',
  };
}

export async function finalizeTradingWalletRotation(mainWalletAddress: string): Promise<void> {
  await removeTradingWalletRotation(mainWalletAddress);
}

async function ensureCheckpoint(
  plan: TradingWalletRotationPlan,
  input: RotationInput,
): Promise<TradingWalletRotationCheckpoint> {
  const current = await readTradingWalletRotation(input.mainWalletAddress);
  if (current !== null) {
    assertCheckpointMatches(current, input, plan.nextWalletAddress, plan.destinationGeneration);
    return current;
  }
  const now = Date.now();
  const checkpoint: TradingWalletRotationCheckpoint = {
    createdAtMs: now,
    destinationGeneration: plan.destinationGeneration,
    destinationWalletAddress: plan.nextWalletAddress,
    mainWalletAddress: input.mainWalletAddress,
    phase: 'migrating-tokens',
    sourceWalletAddress: input.tradingWalletAddress,
    submitted: null,
    updatedAtMs: now,
    version: 1,
  };
  await writeTradingWalletRotation(checkpoint);
  return checkpoint;
}

async function settleStoredSubmission(
  checkpoint: TradingWalletRotationCheckpoint,
  input: RotationInput,
): Promise<TradingWalletRotationCheckpoint> {
  const submitted = checkpoint.submitted;
  if (submitted === null) return checkpoint;
  const status = await readSubmittedTransactionStatus({
    rpcUrl: input.config.api.rpcUrl,
    signature: submitted.signature,
    signer: input.signer,
  });
  if (status === 'confirmed' || status === 'failed') {
    return updateCheckpoint(checkpoint, { submitted: null });
  }
  const current = await storedLegacyTransactionIsCurrent({
    rpcUrl: input.config.api.rpcUrl,
    signedTransactionBase64: submitted.signedTransactionBase64,
    signer: input.signer,
  });
  if (!current) return updateCheckpoint(checkpoint, { submitted: null });
  const result = await submitSignedLegacyTransaction({
    expectedSignature: submitted.signature,
    idempotencyKey: submitted.idempotencyKey,
    owner: checkpoint.sourceWalletAddress,
    rpcUrl: input.config.api.rpcUrl,
    signedTransactionBase64: submitted.signedTransactionBase64,
    signer: input.signer,
  });
  if (result.status !== 'confirmed') {
    throw new TradingWalletRotationError(
      `Rotation transaction ${result.signature} is still confirming. Resume after it settles.`,
    );
  }
  return updateCheckpoint(checkpoint, { submitted: null });
}

async function submitStep(
  transaction: Transaction,
  checkpoint: TradingWalletRotationCheckpoint,
  input: RotationInput,
): Promise<void> {
  await simulate(transaction, rotationRpcInput(input), 'The rotation preview changed.');
  const idempotencyKey = Crypto.randomUUID();
  const result = await signAndSubmitLegacyTransaction({
    idempotencyKey,
    onSigned: async (signature, signedTransactionBase64) => {
      await updateCheckpoint(checkpoint, {
        submitted: { idempotencyKey, signature, signedTransactionBase64 },
      });
    },
    onSubmissionRejected: async () => {
      await updateCheckpoint(checkpoint, { submitted: null });
    },
    owner: input.tradingWalletAddress,
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
    unsignedTransaction: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  });
  if (result.status !== 'confirmed') {
    throw new TradingWalletRotationError(
      `Rotation transaction ${result.signature} is still confirming. Resume after it settles.`,
    );
  }
  const latest = await requireCheckpoint(input.mainWalletAddress);
  await updateCheckpoint(latest, { submitted: null });
}

function tokenTransaction(
  account: RotatableTokenAccount,
  input: RotationInput,
  destinationAddress: string,
  blockhash: string,
): Transaction {
  const source = new PublicKey(input.tradingWalletAddress);
  const transaction = new Transaction({ feePayer: source, recentBlockhash: blockhash });
  transaction.add(...tokenMigrationInstructions(
    account,
    input.tradingWalletAddress,
    destinationAddress,
  ));
  return transaction;
}

async function sweepTransaction(
  input: RotationInput,
  destinationAddress: string,
  balance: bigint,
): Promise<Transaction> {
  const source = new PublicKey(input.tradingWalletAddress);
  const destination = new PublicKey(destinationAddress);
  const transaction = new Transaction({
    feePayer: source,
    recentBlockhash: await latestBlockhash(rotationRpcInput(input)),
  });
  transaction.add(SystemProgram.transfer({ fromPubkey: source, toPubkey: destination, lamports: 0n }));
  const fee = await transactionFee(transaction, rotationRpcInput(input));
  if (balance < fee) {
    throw new TradingWalletRotationError('Private wallet T needs more SOL for the final rotation fee.');
  }
  transaction.instructions[0] = SystemProgram.transfer({
    fromPubkey: source,
    toPubkey: destination,
    lamports: balance - fee,
  });
  return transaction;
}

async function estimatedSweepFee(
  input: RotationInput,
  blockhash: string,
  rpcInput: RotationRpcInput,
): Promise<bigint> {
  const source = new PublicKey(input.tradingWalletAddress);
  const transaction = new Transaction({ feePayer: source, recentBlockhash: blockhash });
  transaction.add(SystemProgram.transfer({ fromPubkey: source, toPubkey: source, lamports: 0n }));
  return transactionFee(transaction, rpcInput);
}

async function latestBlockhash(input: RotationRpcInput): Promise<string> {
  const result = await signedSolanaRpc<{ readonly value: { readonly blockhash: string } }>({
    method: 'getLatestBlockhash',
    params: [{ commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  return result.value.blockhash;
}

async function transactionFee(transaction: Transaction, input: RotationRpcInput): Promise<bigint> {
  const result = await signedSolanaRpc<{ readonly value: number | null }>({
    method: 'getFeeForMessage',
    params: [base64.encode(transaction.serializeMessage()), { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  if (result.value === null || !Number.isSafeInteger(result.value) || result.value < 0) {
    throw new TradingWalletRotationError('The live rotation fee could not be verified.');
  }
  return BigInt(result.value);
}

async function solBalance(address: string, input: RotationRpcInput): Promise<bigint> {
  const result = await signedSolanaRpc<{ readonly value: number }>({
    method: 'getBalance',
    params: [address, { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  if (!Number.isSafeInteger(result.value) || result.value < 0) {
    throw new TradingWalletRotationError('A private-wallet SOL balance could not be verified.');
  }
  return BigInt(result.value);
}

async function simulate(
  transaction: Transaction,
  input: RotationRpcInput,
  message: string,
): Promise<void> {
  const result = await signedSolanaRpc<{ readonly value: { readonly err: unknown } }>({
    method: 'simulateTransaction',
    params: [
      base64.encode(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })),
      { commitment: 'confirmed', encoding: 'base64', sigVerify: false },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  if (result.value.err !== null) throw new TradingWalletRotationError(message);
}

async function updateCheckpoint(
  current: TradingWalletRotationCheckpoint,
  update: Partial<Pick<TradingWalletRotationCheckpoint, 'phase' | 'submitted'>>,
): Promise<TradingWalletRotationCheckpoint> {
  const next = { ...current, ...update, updatedAtMs: Date.now() };
  await writeTradingWalletRotation(next);
  return next;
}

async function requireCheckpoint(mainWalletAddress: string): Promise<TradingWalletRotationCheckpoint> {
  const checkpoint = await readTradingWalletRotation(mainWalletAddress);
  if (checkpoint === null) throw new TradingWalletRotationError('Rotation checkpoint is missing.');
  return checkpoint;
}

function rotationRpcInput(input: RotationInput): RotationRpcInput {
  return { rpcUrl: input.config.api.rpcUrl, signer: input.signer };
}

function assertPlanMatches(plan: TradingWalletRotationPlan, input: RotationInput): void {
  if (
    !Number.isSafeInteger(plan.expiresAtMs) || plan.expiresAtMs <= Date.now() ||
    plan.sourceWalletAddress !== input.tradingWalletAddress ||
    plan.destinationGeneration <= 0 || plan.nextWalletAddress === input.tradingWalletAddress
  ) throw new TradingWalletRotationError(
    'The reviewed rotation expired or no longer matches this wallet. Review it again.',
  );
}

function assertCheckpointMatches(
  checkpoint: TradingWalletRotationCheckpoint,
  input: RotationInput,
  destination: string,
  generation: number,
): void {
  if (
    checkpoint.mainWalletAddress !== input.mainWalletAddress ||
    checkpoint.sourceWalletAddress !== input.tradingWalletAddress ||
    checkpoint.destinationWalletAddress !== destination ||
    checkpoint.destinationGeneration !== generation
  ) throw new TradingWalletRotationError('Saved rotation does not match the reviewed wallet identities.');
}
