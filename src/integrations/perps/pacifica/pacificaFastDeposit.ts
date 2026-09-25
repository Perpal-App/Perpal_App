import { base64 } from '@scure/base';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PublicKey, Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import * as Crypto from 'expo-crypto';

import { parseAmount } from '@/domain/money/amount';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS,
} from '@/integrations/perps/pacifica/pacificaDeposit';
import { createPacificaDepositInstruction } from '@/integrations/perps/pacifica/pacificaDepositInstruction';
import { refreshPacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolioStore';
import {
  removePendingTradeAction,
  writePendingTradeAction,
} from '@/integrations/perps/tradeActionStorage';
import {
  readNativeSolBalance,
  readSwapTokenAccount,
  readTokenAccountRent,
} from '@/integrations/solana/stablecoinSwapBalances';
import {
  signAndSubmitMultiAuthorityLegacyTransaction,
  type PublicMultiAuthorityLegacySigner,
} from '@/integrations/solana/signedMultiAuthorityLegacyTransaction';
import { TransactionSigningError } from '@/integrations/solana/transactionSigningError';
import type { SubmittedTransactionResult } from '@/integrations/solana/transactionConfirmation';

const PLAN_LIFETIME_MS = 45_000;
const USDC_DECIMALS = 6;
const U64_MAX = 0xffff_ffff_ffff_ffffn;

export type FastPacificaDepositPlan = {
  readonly amountBaseUnits: bigint;
  readonly centralState: string;
  readonly expiresAtMs: number;
  readonly feeLamports: bigint;
  readonly idempotencyKey: string;
  readonly mint: string;
  readonly pacificaBalanceBeforeBaseUnits: bigint;
  readonly programId: string;
  /** Exact public-wallet USDC moved by the first instruction. */
  readonly publicTransferBaseUnits: bigint;
  readonly publicSolLamports: bigint;
  readonly publicUsdcBaseUnits: bigint;
  readonly publicWalletAddress: string;
  readonly rentLamports: bigint;
  /** Existing T-account USDC explicitly included in the reviewed Pacifica deposit. */
  readonly stagedUsdcBaseUnits: bigint;
  readonly tradingTokenAccountExists: boolean;
  readonly tradingWalletAddress: string;
  readonly unsignedTransaction: Uint8Array;
  readonly vault: string;
};

export class FastPacificaDepositError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'FastPacificaDepositError';
  }
}

/**
 * Builds one atomic, linkable M → T → Pacifica transaction.
 *
 * T remains the Pacifica owner because the supported deposit instruction derives its source ATA from
 * that owner. Putting the transfer and deposit in one transaction removes the separately finalized
 * intermediary balance: Solana commits ATA creation, transfer, and Pacifica credit together or rolls all
 * three back. It does not provide privacy—the same transaction publicly links both wallets and amount.
 */
export async function prepareFastPacificaDeposit(input: {
  readonly amountBaseUnits: bigint;
  readonly apiOrigin: string;
  readonly centralState: string;
  readonly mint: string;
  readonly programId: string;
  readonly publicWalletAddress: string;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly tradingWalletAddress: string;
  readonly vault: string;
}): Promise<FastPacificaDepositPlan> {
  if (input.amountBaseUnits <= 0n || input.amountBaseUnits > U64_MAX) {
    throw new FastPacificaDepositError('Enter a valid USDC top-up.', 'amount_invalid');
  }

  const publicWallet = key(input.publicWalletAddress, 'Public wallet');
  const tradingWallet = key(input.tradingWalletAddress, 'Trading wallet');
  key(input.mint, 'USDC mint');
  if (
    publicWallet.equals(tradingWallet) ||
    !tradingWallet.equals(new PublicKey(input.signer.publicKey))
  ) {
    throw new FastPacificaDepositError('The active funding wallets changed.', 'signer_mismatch');
  }

  const [blockhash, publicToken, tradingToken, publicSolLamports, tokenAccountRent, portfolio] =
    await Promise.all([
      latestBlockhash(input),
      readSwapTokenAccount({
        decimals: USDC_DECIMALS,
        mint: input.mint,
        owner: input.publicWalletAddress,
        rpcUrl: input.rpcUrl,
        signer: input.signer,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }),
      readSwapTokenAccount({
        decimals: USDC_DECIMALS,
        mint: input.mint,
        owner: input.tradingWalletAddress,
        rpcUrl: input.rpcUrl,
        signer: input.signer,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }),
      readNativeSolBalance({
        owner: input.publicWalletAddress,
        rpcUrl: input.rpcUrl,
        signer: input.signer,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }),
      readTokenAccountRent({
        rpcUrl: input.rpcUrl,
        signer: input.signer,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }),
      refreshPacificaPortfolioSnapshot({
        account: input.tradingWalletAddress,
        apiOrigin: input.apiOrigin,
        forceNetwork: true,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }),
    ]);

  const depositAmountBaseUnits = input.amountBaseUnits + tradingToken.amountBaseUnits;
  if (
    depositAmountBaseUnits < PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS ||
    depositAmountBaseUnits > U64_MAX
  ) {
    throw new FastPacificaDepositError(
      'The top-up and staged USDC must total at least 10 USDC.',
      'amount_below_minimum',
    );
  }

  const intent = {
    amountBaseUnits: depositAmountBaseUnits,
    centralState: input.centralState,
    mint: input.mint,
    programId: input.programId,
    publicTransferBaseUnits: input.amountBaseUnits,
    publicWalletAddress: publicWallet.toBase58(),
    stagedUsdcBaseUnits: tradingToken.amountBaseUnits,
    tradingWalletAddress: tradingWallet.toBase58(),
    vault: input.vault,
  };
  const transaction = buildFastTransaction(intent, blockhash);
  const feeLamports = await transactionFee(transaction, input);
  const rentLamports = tradingToken.exists ? 0n : tokenAccountRent;

  if (!publicToken.exists || publicToken.amountBaseUnits < input.amountBaseUnits) {
    throw new FastPacificaDepositError(
      `Public wallet has less than the requested USDC.`,
      'insufficient_usdc',
    );
  }
  if (publicSolLamports < feeLamports + rentLamports) {
    throw new FastPacificaDepositError(
      'Public wallet needs more SOL for the network fee and account rent.',
      'insufficient_sol',
    );
  }

  await simulate(transaction, input);
  const unsignedTransaction = serialize(transaction);
  return {
    ...intent,
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
    feeLamports,
    idempotencyKey: Crypto.randomUUID(),
    pacificaBalanceBeforeBaseUnits: parseAmount(portfolio.balance, USDC_DECIMALS).baseUnits,
    publicSolLamports,
    publicUsdcBaseUnits: publicToken.amountBaseUnits,
    rentLamports,
    tradingTokenAccountExists: tradingToken.exists,
    unsignedTransaction,
  };
}

/** Rechecks current balances, signs both authority slots, and persists before broadcast. */
export async function submitFastPacificaDeposit(input: {
  readonly plan: FastPacificaDepositPlan;
  readonly publicSigner: PublicMultiAuthorityLegacySigner;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
}): Promise<SubmittedTransactionResult> {
  if (Date.now() >= input.plan.expiresAtMs) {
    throw new FastPacificaDepositError('Fast deposit preview expired. Review it again.', 'expired');
  }

  const [publicToken, tradingToken, publicSolLamports] = await Promise.all([
    readSwapTokenAccount({
      decimals: USDC_DECIMALS,
      mint: input.plan.mint,
      owner: input.plan.publicWalletAddress,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    readSwapTokenAccount({
      decimals: USDC_DECIMALS,
      mint: input.plan.mint,
      owner: input.plan.tradingWalletAddress,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    readNativeSolBalance({
      owner: input.plan.publicWalletAddress,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  ]);
  if (!publicToken.exists || publicToken.amountBaseUnits < input.plan.publicTransferBaseUnits) {
    throw new FastPacificaDepositError('Public USDC balance changed.', 'balance_changed');
  }
  if (tradingToken.amountBaseUnits !== input.plan.stagedUsdcBaseUnits) {
    throw new FastPacificaDepositError(
      'The staged USDC balance changed. Review the updated total.',
      'balance_changed',
    );
  }
  if (input.plan.tradingTokenAccountExists && !tradingToken.exists) {
    // The review showed no rent. Recreating a closed account would charge a cost that was not approved.
    throw new FastPacificaDepositError('Trading token account changed.', 'balance_changed');
  }
  const currentRent = tradingToken.exists ? 0n : input.plan.rentLamports;
  if (publicSolLamports < input.plan.feeLamports + currentRent) {
    throw new FastPacificaDepositError('Public SOL balance changed.', 'balance_changed');
  }

  try {
    const result = await signAndSubmitMultiAuthorityLegacyTransaction({
      feePayerAddress: input.plan.publicWalletAddress,
      idempotencyKey: input.plan.idempotencyKey,
      onSigned: (signature, signedTransactionBase64) => writePendingTradeAction({
        amountBaseUnits: input.plan.amountBaseUnits.toString(),
        expectedProviderCreditBaseUnits: input.plan.amountBaseUnits.toString(),
        expiresAtMs: input.plan.expiresAtMs,
        idempotencyKey: input.plan.idempotencyKey,
        kind: 'fast-collateral',
        owner: input.plan.tradingWalletAddress,
        provider: 'pacifica',
        providerBalanceBeforeBaseUnits: input.plan.pacificaBalanceBeforeBaseUnits.toString(),
        signature,
        signedTransactionBase64,
        updatedAtMs: Date.now(),
        version: 1,
      }),
      onSubmissionRejected: () => removePendingTradeAction(
        input.plan.tradingWalletAddress,
        'pacifica',
      ),
      publicSigner: input.publicSigner,
      requestSigner: input.signer,
      rpcUrl: input.rpcUrl,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      tradingOwnerAddress: input.plan.tradingWalletAddress,
      unsignedTransaction: input.plan.unsignedTransaction,
      verifyTransaction: (transaction) => assertFastTransaction(input.plan, transaction),
    });
    return result;
  } catch (cause) {
    if (cause instanceof TransactionSigningError && (
      cause.code === 'transaction_failed' || cause.code === 'submission_rejected'
    )) {
      await removePendingTradeAction(input.plan.tradingWalletAddress, 'pacifica');
    }
    throw cause;
  }
}

export function fastDepositErrorMessage(cause: unknown): string {
  if (cause instanceof FastPacificaDepositError || cause instanceof TransactionSigningError) {
    return cause.message;
  }
  return 'Fast deposit did not complete. Review it again.';
}

type FastIntent = Pick<
  FastPacificaDepositPlan,
  | 'amountBaseUnits'
  | 'centralState'
  | 'mint'
  | 'programId'
  | 'publicTransferBaseUnits'
  | 'publicWalletAddress'
  | 'stagedUsdcBaseUnits'
  | 'tradingWalletAddress'
  | 'vault'
>;

function buildFastTransaction(intent: FastIntent, blockhash: string): Transaction {
  const publicWallet = new PublicKey(intent.publicWalletAddress);
  const tradingWallet = new PublicKey(intent.tradingWalletAddress);
  const mint = new PublicKey(intent.mint);
  const publicToken = getAssociatedTokenAddressSync(mint, publicWallet);
  const tradingToken = getAssociatedTokenAddressSync(mint, tradingWallet);

  return new Transaction({ feePayer: publicWallet, recentBlockhash: blockhash }).add(
    createAssociatedTokenAccountIdempotentInstruction(
      publicWallet,
      tradingToken,
      tradingWallet,
      mint,
      TOKEN_PROGRAM_ID,
    ),
    createTransferCheckedInstruction(
      publicToken,
      mint,
      tradingToken,
      publicWallet,
      intent.publicTransferBaseUnits,
      USDC_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    ),
    createPacificaDepositInstruction(
      {
        amountBaseUnits: intent.amountBaseUnits,
        centralState: intent.centralState,
        mint: intent.mint,
        vault: intent.vault,
      },
      tradingWallet,
      new PublicKey(intent.programId),
    ),
  );
}

function assertFastTransaction(plan: FastPacificaDepositPlan, actual: Transaction): void {
  if (actual.recentBlockhash === undefined) {
    throw new FastPacificaDepositError('Fast deposit has no current blockhash.', 'transaction_invalid');
  }
  const expected = buildFastTransaction(plan, actual.recentBlockhash);
  if (!Buffer.from(expected.serializeMessage()).equals(Buffer.from(actual.serializeMessage()))) {
    throw new FastPacificaDepositError(
      'Fast deposit no longer matches the reviewed amount and wallets.',
      'transaction_mismatch',
    );
  }
}

async function latestBlockhash(input: {
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
}): Promise<string> {
  const response = await signedSolanaRpc<{ readonly value: { readonly blockhash: string } }>({
    method: 'getLatestBlockhash',
    params: [{ commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  return response.value.blockhash;
}

async function transactionFee(
  transaction: Transaction,
  input: { readonly rpcUrl: string; readonly signal?: AbortSignal; readonly signer: GatewayRequestSigner },
): Promise<bigint> {
  const response = await signedSolanaRpc<{ readonly value: number | null }>({
    method: 'getFeeForMessage',
    params: [base64.encode(transaction.serializeMessage()), { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (response.value === null || !Number.isSafeInteger(response.value) || response.value < 0) {
    throw new FastPacificaDepositError('Network fee could not be verified.', 'fee_invalid');
  }
  return BigInt(response.value);
}

async function simulate(
  transaction: Transaction,
  input: { readonly rpcUrl: string; readonly signal?: AbortSignal; readonly signer: GatewayRequestSigner },
): Promise<void> {
  const response = await signedSolanaRpc<{ readonly value: { readonly err: unknown } }>({
    method: 'simulateTransaction',
    params: [
      base64.encode(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })),
      {
        commitment: 'confirmed',
        encoding: 'base64',
        replaceRecentBlockhash: false,
        sigVerify: false,
      },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (response.value.err !== null) {
    throw new FastPacificaDepositError('Pacifica rejected the fast-deposit preview.', 'simulation_failed');
  }
}

function serialize(transaction: Transaction): Uint8Array {
  try {
    return transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  } catch {
    throw new FastPacificaDepositError('Fast deposit is too large to submit.', 'transaction_too_large');
  }
}

function key(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new FastPacificaDepositError(`${label} is invalid.`, 'address_invalid');
  }
}
