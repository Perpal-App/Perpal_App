import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  StablecoinSwapError,
  SWAP_ASSET_DECIMALS,
  type SwapAssetSymbol,
  type SwapTokenAccountSnapshot,
} from '@/integrations/solana/stablecoinSwapTypes';

const TOKEN_ACCOUNT_BYTES = 165;

type RpcAccountInfo = {
  readonly executable: boolean;
  readonly lamports: number;
  readonly owner: string;
};

type RpcInput = {
  readonly owner: string;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
};

export async function readNativeSolBalance(input: RpcInput): Promise<bigint> {
  const response = await signedSolanaRpc<{ readonly value: number }>({
    method: 'getBalance',
    params: [input.owner, { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (!Number.isSafeInteger(response.value) || response.value < 0) {
    throw new StablecoinSwapError(
      'The wallet SOL balance could not be verified.',
      'balance_invalid',
    );
  }
  return BigInt(response.value);
}

export async function readSwapAssetBalance(input: RpcInput & {
  readonly mint: string;
  readonly symbol: SwapAssetSymbol;
}): Promise<bigint> {
  if (input.symbol === 'SOL' && input.mint !== NATIVE_MINT.toBase58()) {
    throw invalidBalance();
  }
  return input.symbol === 'SOL'
    ? readNativeSolBalance(input)
    : readTokenBalance({
        ...input,
        decimals: SWAP_ASSET_DECIMALS[input.symbol],
      });
}

export async function readTokenBalance(input: RpcInput & {
  readonly decimals?: number;
  readonly mint: string;
}): Promise<bigint> {
  return (await readSwapTokenAccount({
    ...input,
    decimals: input.decimals ?? 6,
  })).amountBaseUnits;
}

export async function readSwapTokenAccount(input: RpcInput & {
  readonly decimals: number;
  readonly mint: string;
}): Promise<SwapTokenAccountSnapshot> {
  let address: string;
  try {
    address = getAssociatedTokenAddressSync(
      new PublicKey(input.mint),
      new PublicKey(input.owner),
    ).toBase58();
  } catch {
    throw invalidBalance();
  }
  const account = await signedSolanaRpc<{ readonly value: RpcAccountInfo | null }>({
    method: 'getAccountInfo',
    params: [address, { commitment: 'confirmed', encoding: 'base64' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  if (account.value === null) {
    return { address, amountBaseUnits: 0n, exists: false, lamports: 0n };
  }
  if (
    account.value.executable ||
    account.value.owner !== TOKEN_PROGRAM_ID.toBase58() ||
    !Number.isSafeInteger(account.value.lamports) ||
    account.value.lamports < 0
  ) {
    throw invalidBalance();
  }

  const balance = await signedSolanaRpc<{
    readonly value: { readonly amount: string; readonly decimals: number };
  }>({
    method: 'getTokenAccountBalance',
    params: [address, { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (
    !Number.isInteger(input.decimals) ||
    input.decimals < 0 ||
    input.decimals > 255 ||
    balance.value.decimals !== input.decimals ||
    !/^\d+$/u.test(balance.value.amount)
  ) {
    throw invalidBalance();
  }

  return {
    address,
    amountBaseUnits: BigInt(balance.value.amount),
    exists: true,
    lamports: BigInt(account.value.lamports),
  };
}

export async function readTokenAccountRent(input: Omit<RpcInput, 'owner'>): Promise<bigint> {
  const value = await signedSolanaRpc<number>({
    method: 'getMinimumBalanceForRentExemption',
    params: [TOKEN_ACCOUNT_BYTES, { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StablecoinSwapError(
      'Token-account rent could not be verified.',
      'rent_invalid',
    );
  }
  return BigInt(value);
}

function invalidBalance(): StablecoinSwapError {
  return new StablecoinSwapError('The token balance is invalid.', 'balance_invalid');
}
