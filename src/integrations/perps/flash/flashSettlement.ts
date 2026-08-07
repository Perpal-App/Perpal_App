import { base64 } from '@scure/base';
import { BN } from '@flash_trade/flash-sdk-v2/node_modules/@coral-xyz/anchor';
import { withdrawalWithAction } from '@flash_trade/flash-sdk-v2/dist/instructions/trade/withdrawalWithAction';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { readFlashErTransactionStatus } from '@/integrations/perps/flash/flashErRpc';
import { flashPool } from '@/integrations/perps/flash/flashMarketData';
import { fetchFlashPortfolio } from '@/integrations/perps/flash/flashPortfolio';
import { createFlashProgram } from '@/integrations/perps/flash/flashProgram';
import {
  readPendingFlashSettlements,
  removePendingFlashSettlement,
  writePendingFlashSettlement,
  type PendingFlashSettlement,
} from '@/integrations/perps/flash/flashSettlementStorage';
import {
  readSubmittedTransactionStatus,
  signAndSubmitLegacyTransaction,
  signAndSubmitMultiSignerLegacyTransaction,
} from '@/integrations/solana/signedLegacyTransaction';

const RECEIPT_BYTES = 112;
// MagicBlock's official account size classes bound both delegation PDAs at 256 bytes.
const DELEGATION_PDA_BYTES = 256;
const SETTLEMENT_POLL_ATTEMPTS = 60;
const SETTLEMENT_POLL_MS = 2_000;

type Input = {
  readonly erRpcUrl: string;
  readonly feeSigner: GatewayRequestSigner;
  readonly owner: string;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
};

export async function resumeFlashSettlements(input: Input): Promise<void> {
  for (let attempt = 0; attempt < SETTLEMENT_POLL_ATTEMPTS; attempt += 1) {
    const records = await readPendingFlashSettlements(input.owner);
    if (records.length === 0) return;
    await Promise.all(records.map(async (record) => {
      try {
        await resumeOne(record, input);
      } catch (cause) {
        const latest = (await readPendingFlashSettlements(input.owner)).find(
          (candidate) =>
            candidate.poolName === record.poolName &&
            candidate.symbol === record.symbol &&
            candidate.side === record.side,
        );
        if (latest !== undefined) {
          await writePendingFlashSettlement({
            ...latest,
            errorCode: cause instanceof Error ? cause.name : 'settlement_failed',
            updatedAtMs: Date.now(),
          });
        }
      }
    }));
    const pending = await readPendingFlashSettlements(input.owner);
    if (pending.length === 0 || pending.every((record) => record.errorCode !== null)) return;
    await delay(SETTLEMENT_POLL_MS);
  }
}

export async function ensureFlashCollateralInWallet(
  amountBaseUnits: bigint,
  input: Input,
): Promise<void> {
  const before = await tokenBalance(input);
  if (before >= amountBaseUnits) return;
  const missing = amountBaseUnits - before;
  const portfolio = await fetchFlashPortfolio(
    input.erRpcUrl,
    input.programId,
    input.owner,
    new AbortController().signal,
  );
  if ((portfolio.deposits.USDC?.baseUnits ?? 0n) < missing) {
    throw new Error('The requested amount exceeds T and available Flash collateral.');
  }
  let prepared = await prepareWithdrawal(missing, input);
  const funding = prepared.requiredFeePayerLamports > prepared.feePayerBalance
    ? prepared.requiredFeePayerLamports - prepared.feePayerBalance
    : 0n;
  if (funding > 0n) {
    await fundFeeSigner(
      funding,
      `direct_${input.owner}_${amountBaseUnits}_${before}`,
      input,
    );
    prepared = await prepareWithdrawal(missing, input);
  }
  await simulate(prepared.transaction, input);
  await signAndSubmitMultiSignerLegacyTransaction({
    idempotencyKey: `flash_withdraw_direct_${input.owner}_${amountBaseUnits}_${before}`,
    requestSigner: input.signer,
    rpcUrl: input.rpcUrl,
    signers: [input.feeSigner, input.signer],
    unsignedTransaction: prepared.transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await tokenBalance(input) >= amountBaseUnits) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('Flash collateral is still settling into T. Resume shortly.');
}

async function resumeOne(record: PendingFlashSettlement, input: Input): Promise<void> {
  const amount = BigInt(record.amountBaseUnits);
  if (amount <= 0n) {
    await remove(record);
    return;
  }
  const closeStatus = await readFlashErTransactionStatus(input.erRpcUrl, record.closeSignature);
  if (closeStatus === 'failed') {
    await remove(record);
    return;
  }
  if (closeStatus !== 'confirmed') return;

  if (record.withdrawalSignature !== null) {
    const status = await readSubmittedTransactionStatus({
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      signature: record.withdrawalSignature,
    });
    if (status === 'failed') throw new Error('FlashWithdrawalFailed');
    if (status === 'confirmed' && record.walletBalanceBefore !== null) {
      const balance = await tokenBalance(input);
      if (balance >= BigInt(record.walletBalanceBefore) + amount) await remove(record);
    }
    return;
  }

  const portfolio = await fetchFlashPortfolio(
    input.erRpcUrl,
    input.programId,
    input.owner,
    new AbortController().signal,
  );
  const stillOpen = portfolio.positions.some((position) =>
    position.poolName === record.poolName &&
    position.symbol === record.symbol &&
    position.side.toLowerCase() === record.side,
  );
  const available = portfolio.deposits.USDC?.baseUnits ?? 0n;
  if (stillOpen || available < amount) return;

  let prepared = await prepareWithdrawal(amount, input);
  const funding = prepared.requiredFeePayerLamports > prepared.feePayerBalance
    ? prepared.requiredFeePayerLamports - prepared.feePayerBalance
    : 0n;
  if (funding > 0n) {
    if (record.feeFundingSignature !== null) {
      const status = await readSubmittedTransactionStatus({
        rpcUrl: input.rpcUrl,
        signer: input.signer,
        signature: record.feeFundingSignature,
      });
      if (status === 'pending') return;
      if (status === 'failed') throw new Error('FlashFeeFundingFailed');
    }
    await fundFeeSigner(
      funding,
      record.closeSignature,
      input,
      async (feeFundingSignature) => writePendingFlashSettlement({
        ...record,
        errorCode: null,
        feeFundingSignature,
        updatedAtMs: Date.now(),
      }),
    );
    prepared = await prepareWithdrawal(amount, input);
    if (prepared.feePayerBalance < prepared.requiredFeePayerLamports) {
      throw new Error('FlashFeeReserveInsufficient');
    }
  }
  await simulate(prepared.transaction, input);
  const balanceBefore = await tokenBalance(input);
  await signAndSubmitMultiSignerLegacyTransaction({
    idempotencyKey: `flash_withdraw_${record.closeSignature}`,
    requestSigner: input.signer,
    rpcUrl: input.rpcUrl,
    signers: [input.feeSigner, input.signer],
    unsignedTransaction: prepared.transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
    onSigned: async (withdrawalSignature) => writePendingFlashSettlement({
      ...record,
      errorCode: null,
      walletBalanceBefore: balanceBefore.toString(),
      withdrawalSignature,
      updatedAtMs: Date.now(),
    }),
  });
}

async function prepareWithdrawal(amount: bigint, input: Input) {
  const owner = new PublicKey(input.owner);
  const feePayer = new PublicKey(input.feeSigner.publicKey);
  const pool = flashPool(input.programId);
  const usdc = pool.tokens.find((token) => token.symbol === 'USDC');
  if (usdc === undefined) throw new Error('FlashUsdcUnavailable');
  const program = createFlashProgram(input.programId, owner);
  const instruction = await withdrawalWithAction(
    program,
    owner,
    usdc.mintKey,
    getAssociatedTokenAddressSync(usdc.mintKey, owner),
    new BN(amount.toString()),
    feePayer,
  );
  const [blockhash, feePayerBalance, receiptRent, delegationRent] = await Promise.all([
    latestBlockhash(input),
    balance(feePayer.toBase58(), input),
    rent(RECEIPT_BYTES, input),
    rent(DELEGATION_PDA_BYTES, input),
  ]);
  const transaction = new Transaction({
    feePayer,
    recentBlockhash: blockhash,
  }).add(instruction);
  const fee = await signedSolanaRpc<{ readonly value: number | null }>({
    method: 'getFeeForMessage',
    params: [base64.encode(transaction.serializeMessage()), { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  if (fee.value === null || !Number.isSafeInteger(fee.value)) throw new Error('FlashFeeUnavailable');
  return {
    feePayerBalance,
    // Receipt + buffer use the exact Flash account size; delegation record and
    // metadata use MagicBlock's published upper bound. Unused rent stays in S.
    requiredFeePayerLamports: BigInt(fee.value) + receiptRent * 2n + delegationRent * 2n,
    transaction,
  };
}

async function fundFeeSigner(
  amount: bigint,
  operationId: string,
  input: Input,
  onSigned?: (signature: string) => Promise<void>,
) {
  const transaction = new Transaction({
    feePayer: new PublicKey(input.owner),
    recentBlockhash: await latestBlockhash(input),
  }).add(SystemProgram.transfer({
    fromPubkey: new PublicKey(input.owner),
    toPubkey: new PublicKey(input.feeSigner.publicKey),
    lamports: amount,
  }));
  const result = await signAndSubmitLegacyTransaction({
    idempotencyKey: `flash_fee_${operationId}_${amount}`,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    unsignedTransaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
    ...(onSigned === undefined ? {} : { onSigned }),
  });
  if (result.status !== 'confirmed') throw new Error('FlashFeeFundingPending');
}

async function simulate(transaction: Transaction, input: Input) {
  const result = await signedSolanaRpc<{ readonly value: { readonly err: unknown } }>({
    method: 'simulateTransaction',
    params: [
      base64.encode(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })),
      { commitment: 'confirmed', encoding: 'base64', sigVerify: false },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  if (result.value.err !== null) throw new Error('FlashWithdrawalSimulationFailed');
}

async function tokenBalance(input: Input): Promise<bigint> {
  const pool = flashPool(input.programId);
  const mint = pool.tokens.find((token) => token.symbol === 'USDC')?.mintKey;
  if (mint === undefined) throw new Error('FlashUsdcUnavailable');
  const account = getAssociatedTokenAddressSync(mint, new PublicKey(input.owner));
  const value = await signedSolanaRpc<{ readonly value: { readonly amount: string } }>({
    method: 'getTokenAccountBalance',
    params: [account.toBase58(), { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  return BigInt(value.value.amount);
}

async function latestBlockhash(input: Input): Promise<string> {
  const value = await signedSolanaRpc<{ readonly value: { readonly blockhash: string } }>({
    method: 'getLatestBlockhash',
    params: [{ commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  return value.value.blockhash;
}
async function balance(address: string, input: Input): Promise<bigint> {
  const value = await signedSolanaRpc<{ readonly value: number }>({ method: 'getBalance', params: [address, { commitment: 'confirmed' }], rpcUrl: input.rpcUrl, signer: input.signer });
  return BigInt(value.value);
}
async function rent(bytes: number, input: Input): Promise<bigint> {
  return BigInt(await signedSolanaRpc<number>({ method: 'getMinimumBalanceForRentExemption', params: [bytes, { commitment: 'confirmed' }], rpcUrl: input.rpcUrl, signer: input.signer }));
}
async function remove(record: PendingFlashSettlement) {
  await removePendingFlashSettlement(
    record.owner,
    record.poolName,
    record.symbol,
    record.side,
  );
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
