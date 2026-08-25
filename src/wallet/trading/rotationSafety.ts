import * as Crypto from 'expo-crypto';
import { base64 } from '@scure/base';
import {
  createCloseAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { fetchPacificaPortfolio } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { hasPendingPacificaWithdrawal } from '@/integrations/perps/pacifica/pacificaWithdrawal';
import { readPendingTradeAction } from '@/integrations/perps/tradeActionStorage';
import {
  signAndSubmitLegacyTransaction,
  type SubmittedTransactionResult,
} from '@/integrations/solana/signedLegacyTransaction';
import { readPrivateExitRecord } from '@/integrations/umbra/privateExitStorage';
import { readPrivateFundingRecord } from '@/integrations/umbra/umbraSecureStorage';

export class TradingWalletRotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradingWalletRotationError';
  }
}

export type TradingWalletRotationPlan = {
  readonly feeLamports: bigint;
  readonly idempotencyKey: string;
  readonly nextWalletAddress: string;
  readonly recoveredRentLamports: bigint;
  readonly transferredLamports: bigint;
  readonly unsignedTransaction: Uint8Array | null;
};

type RotationInput = {
  readonly config: AppConfig;
  readonly mainWalletAddress: string;
  readonly signer: GatewayRequestSigner;
  readonly tradingWalletAddress: string;
};

type TokenAccount = {
  readonly address: string;
  readonly amount: bigint;
  readonly lamports: bigint;
  readonly programId: string;
};

export async function prepareTradingWalletRotation(
  input: RotationInput & { readonly nextWalletAddress: string },
): Promise<TradingWalletRotationPlan> {
  const [nativeBalance, tokenAccounts] = await Promise.all([
    solBalance(input.tradingWalletAddress, input),
    readTokenAccounts(input),
    assertNoPendingActivity(input),
  ]);

  if (tokenAccounts.some((account) => account.amount !== 0n)) {
    throw new TradingWalletRotationError('Withdraw every token balance from T first.');
  }

  const recoveredRentLamports = tokenAccounts.reduce(
    (total, account) => total + account.lamports,
    0n,
  );
  if (nativeBalance === 0n && tokenAccounts.length === 0) {
    return emptyPlan(input.nextWalletAddress);
  }

  const source = new PublicKey(input.tradingWalletAddress);
  const destination = new PublicKey(input.nextWalletAddress);
  const { blockhash } = await latestBlockhash(input);
  const transaction = new Transaction({ feePayer: source, recentBlockhash: blockhash });

  for (const account of tokenAccounts) {
    transaction.add(createCloseAccountInstruction(
      new PublicKey(account.address),
      destination,
      source,
      [],
      new PublicKey(account.programId),
    ));
  }

  if (nativeBalance > 0n) {
    transaction.add(SystemProgram.transfer({ fromPubkey: source, toPubkey: destination, lamports: 0 }));
  }

  const feeLamports = await transactionFee(transaction, input);
  if (nativeBalance < feeLamports) {
    throw new TradingWalletRotationError(
      'Private wallet T needs enough SOL to pay the one-time rotation transaction fee.',
    );
  }

  const transferredLamports = nativeBalance - feeLamports;
  if (nativeBalance > 0n) {
    transaction.instructions[transaction.instructions.length - 1] = SystemProgram.transfer({
      fromPubkey: source,
      toPubkey: destination,
      lamports: transferredLamports,
    });
  }

  await simulate(transaction, input);

  let unsignedTransaction: Uint8Array;
  try {
    unsignedTransaction = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
  } catch {
    throw new TradingWalletRotationError(
      'Too many empty token accounts exist for one atomic rotation. Close some accounts first.',
    );
  }

  return {
    feeLamports,
    idempotencyKey: Crypto.randomUUID(),
    nextWalletAddress: input.nextWalletAddress,
    recoveredRentLamports,
    transferredLamports,
    unsignedTransaction,
  };
}

export async function submitTradingWalletRotation(
  plan: TradingWalletRotationPlan,
  input: RotationInput,
): Promise<SubmittedTransactionResult | null> {
  if (plan.unsignedTransaction === null) return null;

  const result = await signAndSubmitLegacyTransaction({
    idempotencyKey: plan.idempotencyKey,
    owner: input.tradingWalletAddress,
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
    unsignedTransaction: plan.unsignedTransaction,
  });

  if (result.status !== 'confirmed') {
    throw new TradingWalletRotationError(
      `Rotation submission ${result.signature} is not confirmed yet. Retry after it settles.`,
    );
  }

  const [oldNativeBalance, oldTokenAccounts] = await Promise.all([
    solBalance(input.tradingWalletAddress, input),
    readTokenAccounts(input),
  ]);
  if (oldNativeBalance !== 0n || oldTokenAccounts.length !== 0) {
    throw new TradingWalletRotationError(
      'The rotation confirmed but the old wallet is not empty. The active wallet was not changed.',
    );
  }

  return result;
}

async function assertNoPendingActivity(input: RotationInput): Promise<void> {
  const [funding, exit, directExit, pacificaWithdrawal, pacifica, pacificaAction] = await Promise.all([
    readPrivateFundingRecord(input.mainWalletAddress),
    readPrivateExitRecord(input.tradingWalletAddress),
    readPendingTradeAction(input.tradingWalletAddress, 'wallet-withdrawal'),
    hasPendingPacificaWithdrawal(input.tradingWalletAddress),
    fetchPacificaPortfolio(input.config.perps.pacificaApiOrigin, input.tradingWalletAddress),
    readPendingTradeAction(input.tradingWalletAddress, 'pacifica'),
  ]);

  if (funding !== null && funding.phase !== 'complete') {
    throw new TradingWalletRotationError('Private funding is still pending.');
  }
  if (exit !== null && exit.phase !== 'complete') {
    throw new TradingWalletRotationError('A private withdrawal is still pending.');
  }
  if (directExit !== null) {
    throw new TradingWalletRotationError('A direct withdrawal is still pending confirmation.');
  }
  if (pacificaWithdrawal) {
    throw new TradingWalletRotationError('A Pacifica withdrawal is still pending.');
  }
  if (pacificaAction !== null) {
    throw new TradingWalletRotationError('A trading transaction is still pending confirmation.');
  }
  if (
    pacifica.positionsCount > 0 ||
    pacifica.ordersCount > 0 ||
    pacifica.stopOrdersCount > 0 ||
    nonZero(pacifica.balance) ||
    nonZero(pacifica.pendingBalance)
  ) {
    throw new TradingWalletRotationError(
      'Pacifica still holds positions, orders, stop orders, collateral, or a pending balance.',
    );
  }
}

async function readTokenAccounts(input: RotationInput): Promise<readonly TokenAccount[]> {
  const programs = [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()];
  const batches = await Promise.all(programs.map(async (programId) => {
    const result = await signedSolanaRpc<{
      readonly value: readonly {
        readonly pubkey: string;
        readonly account: { readonly data: unknown; readonly lamports: number; readonly owner: string };
      }[];
    }>({
      method: 'getTokenAccountsByOwner',
      params: [
        input.tradingWalletAddress,
        { programId },
        { commitment: 'confirmed', encoding: 'jsonParsed' },
      ],
      rpcUrl: input.config.api.rpcUrl,
      signer: input.signer,
    });

    return result.value.map((entry): TokenAccount => {
      if (
        entry.account.owner !== programId ||
        !Number.isSafeInteger(entry.account.lamports) ||
        entry.account.lamports < 0
      ) throw invalidToken();
      return {
        address: new PublicKey(entry.pubkey).toBase58(),
        amount: parsedTokenAmount(entry.account.data),
        lamports: BigInt(entry.account.lamports),
        programId,
      };
    });
  }));
  return batches.flat();
}

async function solBalance(address: string, input: RotationInput): Promise<bigint> {
  const result = await signedSolanaRpc<{ readonly value: number }>({
    method: 'getBalance',
    params: [address, { commitment: 'confirmed' }],
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
  });
  if (!Number.isSafeInteger(result.value) || result.value < 0) {
    throw new TradingWalletRotationError('A wallet balance could not be verified.');
  }
  return BigInt(result.value);
}

async function latestBlockhash(input: RotationInput): Promise<{ readonly blockhash: string }> {
  const result = await signedSolanaRpc<{
    readonly value: { readonly blockhash: string; readonly lastValidBlockHeight: number };
  }>({
    method: 'getLatestBlockhash',
    params: [{ commitment: 'confirmed' }],
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
  });
  return { blockhash: result.value.blockhash };
}

async function transactionFee(transaction: Transaction, input: RotationInput): Promise<bigint> {
  const result = await signedSolanaRpc<{ readonly value: number | null }>({
    method: 'getFeeForMessage',
    params: [base64.encode(transaction.serializeMessage()), { commitment: 'confirmed' }],
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
  });
  if (result.value === null || !Number.isSafeInteger(result.value) || result.value < 0) {
    throw new TradingWalletRotationError('The rotation transaction fee could not be verified.');
  }
  return BigInt(result.value);
}

async function simulate(transaction: Transaction, input: RotationInput): Promise<void> {
  const unsigned = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  const result = await signedSolanaRpc<{ readonly value: { readonly err: unknown } }>({
    method: 'simulateTransaction',
    params: [
      base64.encode(unsigned),
      { commitment: 'confirmed', encoding: 'base64', sigVerify: false },
    ],
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
  });
  if (result.value.err !== null) {
    throw new TradingWalletRotationError(
      'The atomic rent-and-SOL recovery preview failed. The wallet was not changed.',
    );
  }
}

function emptyPlan(nextWalletAddress: string): TradingWalletRotationPlan {
  return {
    feeLamports: 0n,
    idempotencyKey: Crypto.randomUUID(),
    nextWalletAddress,
    recoveredRentLamports: 0n,
    transferredLamports: 0n,
    unsignedTransaction: null,
  };
}

function nonZero(value: string): boolean {
  return !/^0+(?:\.0+)?$/u.test(value);
}

function parsedTokenAmount(value: unknown): bigint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalidToken();
  const parsed = (value as Record<string, unknown>).parsed;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalidToken();
  const info = (parsed as Record<string, unknown>).info;
  if (typeof info !== 'object' || info === null || Array.isArray(info)) throw invalidToken();
  const tokenAmount = (info as Record<string, unknown>).tokenAmount;
  if (typeof tokenAmount !== 'object' || tokenAmount === null || Array.isArray(tokenAmount)) {
    throw invalidToken();
  }
  const amount = (tokenAmount as Record<string, unknown>).amount;
  if (typeof amount !== 'string' || !/^\d+$/u.test(amount)) throw invalidToken();
  return BigInt(amount);
}

function invalidToken() {
  return new TradingWalletRotationError('A token account could not be verified.');
}
