import { base64 } from '@scure/base';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Buffer } from 'buffer';
import { PublicKey, Transaction, type AccountInfo } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { DirectWithdrawalError } from '@/integrations/solana/directWithdrawalError';

export type WithdrawalRpcAccount = {
  readonly data: readonly [string, 'base64'];
  readonly executable: boolean;
  readonly lamports: number;
  readonly owner: string;
  readonly rentEpoch?: number;
};

export type WithdrawalRpcInput = {
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
};

export type OwnedTokenAccount = {
  readonly address: string;
  readonly amount: bigint;
  readonly decimals: number;
  readonly programId: string;
};

export async function latestBlockhash(input: WithdrawalRpcInput): Promise<string> {
  const response = await rpc<{ readonly value: { readonly blockhash: string } }>(
    input,
    'getLatestBlockhash',
    [{ commitment: 'confirmed' }],
  );
  return response.value.blockhash;
}

export async function readSolBalance(
  owner: string,
  input: WithdrawalRpcInput,
): Promise<bigint> {
  const response = await rpc<{ readonly value: number }>(
    input,
    'getBalance',
    [owner, { commitment: 'confirmed' }],
  );
  return integer(response.value, 'SOL balance');
}

export async function readAccount(
  address: string,
  input: WithdrawalRpcInput,
): Promise<WithdrawalRpcAccount | null> {
  const response = await rpc<{ readonly value: WithdrawalRpcAccount | null }>(
    input,
    'getAccountInfo',
    [address, { commitment: 'confirmed', encoding: 'base64' }],
  );
  return response.value;
}

export async function readTokenBalance(
  tokenAccount: string,
  input: WithdrawalRpcInput,
): Promise<{ readonly amount: bigint; readonly decimals: number }> {
  const response = await rpc<{
    readonly value: { readonly amount: string; readonly decimals: number };
  }>(input, 'getTokenAccountBalance', [tokenAccount, { commitment: 'confirmed' }]);
  if (!/^\d+$/u.test(response.value.amount) || !Number.isInteger(response.value.decimals)) {
    throw new DirectWithdrawalError('The token balance is invalid.', 'balance_invalid');
  }
  return { amount: BigInt(response.value.amount), decimals: response.value.decimals };
}

export async function readOwnedTokenAccounts(
  owner: string,
  mint: string,
  input: WithdrawalRpcInput,
): Promise<readonly OwnedTokenAccount[]> {
  const response = await rpc<{
    readonly value: readonly {
      readonly pubkey: string;
      readonly account: { readonly owner: string; readonly data: unknown };
    }[];
  }>(
    input,
    'getTokenAccountsByOwner',
    [owner, { mint }, { commitment: 'confirmed', encoding: 'jsonParsed' }],
  );

  return response.value.map((entry) => {
    const data = record(entry.account.data);
    const parsed = record(data.parsed);
    const info = record(parsed.info);
    const tokenAmount = record(info.tokenAmount);
    if (
      info.owner !== owner ||
      info.mint !== mint ||
      typeof tokenAmount.amount !== 'string' ||
      !/^\d+$/u.test(tokenAmount.amount) ||
      !Number.isInteger(tokenAmount.decimals)
    ) {
      throw new DirectWithdrawalError('A source token account is invalid.', 'balance_invalid');
    }
    return {
      address: new PublicKey(entry.pubkey).toBase58(),
      amount: BigInt(tokenAmount.amount),
      decimals: tokenAmount.decimals as number,
      programId: new PublicKey(entry.account.owner).toBase58(),
    };
  }).sort((left, right) => left.address.localeCompare(right.address));
}

export async function minimumRent(bytes: number, input: WithdrawalRpcInput): Promise<bigint> {
  return integer(await rpc<number>(
    input,
    'getMinimumBalanceForRentExemption',
    [bytes, { commitment: 'confirmed' }],
  ), 'token-account rent');
}

export async function transactionFee(
  transaction: Transaction,
  input: WithdrawalRpcInput,
): Promise<bigint> {
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

export async function simulate(
  transaction: Transaction,
  input: WithdrawalRpcInput,
): Promise<void> {
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

export function tokenProgram(owner: string): PublicKey {
  if (owner === TOKEN_PROGRAM_ID.toBase58()) return TOKEN_PROGRAM_ID;
  if (owner === TOKEN_2022_PROGRAM_ID.toBase58()) return TOKEN_2022_PROGRAM_ID;
  throw new DirectWithdrawalError('The selected mint is not an SPL token.', 'mint_invalid');
}

export function accountInfo(value: WithdrawalRpcAccount): AccountInfo<Buffer> {
  return {
    data: Buffer.from(base64.decode(value.data[0])),
    executable: value.executable,
    lamports: Number(integer(value.lamports, 'mint account balance')),
    owner: new PublicKey(value.owner),
    ...(value.rentEpoch === undefined ? {} : { rentEpoch: value.rentEpoch }),
  };
}

export function publicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new DirectWithdrawalError(`${label} is invalid.`, 'address_invalid');
  }
}

function integer(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DirectWithdrawalError(`Solana returned an invalid ${label}.`, 'rpc_invalid');
  }
  return BigInt(value);
}

async function rpc<T>(input: WithdrawalRpcInput, method: string, params: unknown): Promise<T> {
  return signedSolanaRpc<T>({
    method,
    params,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DirectWithdrawalError('A source token account is invalid.', 'balance_invalid');
  }
  return value as Record<string, unknown>;
}
