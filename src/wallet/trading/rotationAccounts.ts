import { base64 } from '@scure/base';
import { Buffer } from 'buffer';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  ExtensionType,
  getAccountLenForMint,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackAccount,
  unpackMint,
} from '@solana/spl-token';
import {
  PublicKey,
  type AccountInfo,
  type TransactionInstruction,
} from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { TradingWalletRotationError } from '@/wallet/trading/rotationTypes';

const UNSUPPORTED_TOKEN_2022_EXTENSIONS = new Set([
  ExtensionType.ConfidentialTransferMint,
  ExtensionType.NonTransferable,
  ExtensionType.TransferFeeConfig,
  ExtensionType.TransferHook,
]);

export type RotationRpcInput = {
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
};

export type RotatableTokenAccount = {
  readonly address: string;
  readonly amount: bigint;
  readonly decimals: number;
  readonly destinationAccount: string | null;
  readonly destinationExists: boolean;
  readonly destinationRentLamports: bigint;
  readonly lamports: bigint;
  readonly mint: string;
  readonly programId: string;
};

type RpcAccount = {
  readonly data: readonly [string, 'base64'];
  readonly executable: boolean;
  readonly lamports: number;
  readonly owner: string;
  readonly rentEpoch?: number;
};

type ParsedTokenAccount = {
  readonly address: string;
  readonly amount: bigint;
  readonly closeAuthority: string | null;
  readonly decimals: number;
  readonly frozen: boolean;
  readonly lamports: bigint;
  readonly mint: string;
  readonly owner: string;
  readonly programId: string;
};

export async function readRotatableTokenAccounts(
  sourceAddress: string,
  destinationAddress: string,
  input: RotationRpcInput,
): Promise<readonly RotatableTokenAccount[]> {
  const parsed = await readParsedTokenAccounts(sourceAddress, input);
  const destination = new PublicKey(destinationAddress);
  const mintDetails = new Map<string, Awaited<ReturnType<typeof readMintDetails>>>();

  return Promise.all(parsed.map(async (account) => {
    if (
      account.owner !== sourceAddress ||
      account.frozen ||
      (account.closeAuthority !== null && account.closeAuthority !== sourceAddress)
    ) {
      throw new TradingWalletRotationError(
        'A token account is frozen or controlled by another close authority. Move it before rotating.',
      );
    }

    const key = `${account.programId}:${account.mint}`;
    let details = mintDetails.get(key);
    if (details === undefined) {
      details = await readMintDetails(account.mint, account.programId, input);
      mintDetails.set(key, details);
    }
    if (details.decimals !== account.decimals) {
      throw new TradingWalletRotationError('A token account changed while rotation was reviewed.');
    }

    if (account.amount === 0n || account.mint === NATIVE_MINT.toBase58()) {
      return {
        ...account,
        destinationAccount: null,
        destinationExists: true,
        destinationRentLamports: 0n,
      };
    }

    const mint = new PublicKey(account.mint);
    const programId = new PublicKey(account.programId);
    const destinationAccount = getAssociatedTokenAddressSync(
      mint,
      destination,
      false,
      programId,
    );
    const target = await readAccount(destinationAccount.toBase58(), input);
    if (target !== null) {
      validateDestinationAccount(target, destinationAccount, destination, mint, programId);
    }
    return {
      ...account,
      destinationAccount: destinationAccount.toBase58(),
      destinationExists: target !== null,
      destinationRentLamports: target === null ? details.accountRentLamports : 0n,
    };
  }));
}

export function tokenMigrationInstructions(
  account: RotatableTokenAccount,
  sourceAddress: string,
  destinationAddress: string,
): readonly TransactionInstruction[] {
  const source = new PublicKey(sourceAddress);
  const destination = new PublicKey(destinationAddress);
  const tokenAccount = new PublicKey(account.address);
  const programId = new PublicKey(account.programId);

  if (account.amount === 0n || account.mint === NATIVE_MINT.toBase58()) {
    return [createCloseAccountInstruction(tokenAccount, source, source, [], programId)];
  }

  if (account.destinationAccount === null) {
    throw new TradingWalletRotationError('A destination token account is missing.');
  }
  const mint = new PublicKey(account.mint);
  const target = new PublicKey(account.destinationAccount);
  const instructions: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(
      source,
      target,
      destination,
      mint,
      programId,
    ),
  ];
  if (account.amount > 0n) {
    instructions.push(createTransferCheckedInstruction(
      tokenAccount,
      mint,
      target,
      source,
      account.amount,
      account.decimals,
      [],
      programId,
    ));
  }
  instructions.push(createCloseAccountInstruction(
    tokenAccount,
    source,
    source,
    [],
    programId,
  ));
  return instructions;
}

export function orderTokenMigrations(
  accounts: readonly RotatableTokenAccount[],
): readonly RotatableTokenAccount[] {
  return [...accounts].sort((left, right) => {
    const leftCost = left.destinationRentLamports - left.lamports;
    const rightCost = right.destinationRentLamports - right.lamports;
    if (leftCost < rightCost) return -1;
    if (leftCost > rightCost) return 1;
    return left.address.localeCompare(right.address);
  });
}

async function readParsedTokenAccounts(
  owner: string,
  input: RotationRpcInput,
): Promise<readonly ParsedTokenAccount[]> {
  const programs = [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()];
  const batches = await Promise.all(programs.map(async (programId) => {
    const response = await rpc<{
      readonly value: readonly {
        readonly pubkey: string;
        readonly account: { readonly data: unknown; readonly lamports: number; readonly owner: string };
      }[];
    }>(input, 'getTokenAccountsByOwner', [
      owner,
      { programId },
      { commitment: 'confirmed', encoding: 'jsonParsed' },
    ]);
    return response.value.map((entry) => parseTokenAccount(entry, programId));
  }));
  return batches.flat();
}

function parseTokenAccount(
  entry: {
    readonly pubkey: string;
    readonly account: { readonly data: unknown; readonly lamports: number; readonly owner: string };
  },
  programId: string,
): ParsedTokenAccount {
  const data = record(entry.account.data);
  const info = record(record(data.parsed).info);
  const tokenAmount = record(info.tokenAmount);
  if (
    entry.account.owner !== programId ||
    !Number.isSafeInteger(entry.account.lamports) || entry.account.lamports < 0 ||
    typeof info.owner !== 'string' || typeof info.mint !== 'string' ||
    typeof tokenAmount.amount !== 'string' || !/^\d+$/u.test(tokenAmount.amount) ||
    !Number.isInteger(tokenAmount.decimals) ||
    (info.state !== 'initialized' && info.state !== 'frozen') ||
    (info.closeAuthority !== undefined && info.closeAuthority !== null &&
      typeof info.closeAuthority !== 'string')
  ) throw invalidToken();
  return {
    address: new PublicKey(entry.pubkey).toBase58(),
    amount: BigInt(tokenAmount.amount),
    closeAuthority: typeof info.closeAuthority === 'string' ? info.closeAuthority : null,
    decimals: tokenAmount.decimals as number,
    frozen: info.state === 'frozen',
    lamports: BigInt(entry.account.lamports),
    mint: new PublicKey(info.mint).toBase58(),
    owner: new PublicKey(info.owner).toBase58(),
    programId,
  };
}

async function readMintDetails(
  mintAddress: string,
  programAddress: string,
  input: RotationRpcInput,
): Promise<{ readonly accountRentLamports: bigint; readonly decimals: number }> {
  const mint = new PublicKey(mintAddress);
  const programId = new PublicKey(programAddress);
  const account = await readAccount(mintAddress, input);
  if (account === null || account.owner !== programAddress) throw invalidToken();
  const state = unpackMint(mint, accountInfo(account), programId);
  if (!state.isInitialized || getExtensionTypes(state.tlvData).some(
    (extension) => UNSUPPORTED_TOKEN_2022_EXTENSIONS.has(extension),
  )) {
    throw new TradingWalletRotationError(
      'A Token-2022 mint has transfer rules that cannot be verified safely. Move it before rotating.',
    );
  }
  const accountBytes = getAccountLenForMint(state);
  const rent = await rpc<number>(
    input,
    'getMinimumBalanceForRentExemption',
    [accountBytes, { commitment: 'confirmed' }],
  );
  if (!Number.isSafeInteger(rent) || rent < 0) throw invalidToken();
  return { accountRentLamports: BigInt(rent), decimals: state.decimals };
}

function validateDestinationAccount(
  value: RpcAccount,
  address: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  programId: PublicKey,
): void {
  if (value.owner !== programId.toBase58()) throw invalidToken();
  const account = unpackAccount(address, accountInfo(value), programId);
  if (!account.owner.equals(owner) || !account.mint.equals(mint) || account.isFrozen) {
    throw new TradingWalletRotationError('A destination token account is invalid or frozen.');
  }
}

async function readAccount(
  address: string,
  input: RotationRpcInput,
): Promise<RpcAccount | null> {
  return (await rpc<{ readonly value: RpcAccount | null }>(
    input,
    'getAccountInfo',
    [address, { commitment: 'confirmed', encoding: 'base64' }],
  )).value;
}

function accountInfo(value: RpcAccount): AccountInfo<Buffer> {
  if (!Number.isSafeInteger(value.lamports) || value.lamports < 0) throw invalidToken();
  return {
    data: Buffer.from(base64.decode(value.data[0])),
    executable: value.executable,
    lamports: value.lamports,
    owner: new PublicKey(value.owner),
    ...(value.rentEpoch === undefined ? {} : { rentEpoch: value.rentEpoch }),
  };
}

async function rpc<T>(
  input: RotationRpcInput,
  method: string,
  params: unknown,
): Promise<T> {
  return signedSolanaRpc<T>({
    method,
    params,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalidToken();
  return value as Record<string, unknown>;
}

function invalidToken(): TradingWalletRotationError {
  return new TradingWalletRotationError('A token account could not be verified safely.');
}
