import { base64 } from '@scure/base';
import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getPublicStealthPoolDepositInputBufferSize } from '@umbra-privacy/umbra-codama';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { PrivateFundingError } from '@/integrations/umbra/privateFundingErrors';

const TOKEN_ACCOUNT_BYTES = 165;

type ContextValue<T> = {
  readonly context: { readonly slot: number };
  readonly value: T;
};

type AccountValue = {
  readonly data: readonly [string, 'base64'];
  readonly owner: string;
} | null;

export type PrivateFundingPreflight = {
  readonly availableCollateralBaseUnits: bigint;
  readonly availableSolLamports: bigint;
  readonly estimatedNetworkFeeLamports: bigint;
  readonly missingCollateralBaseUnits: bigint;
  readonly missingSolLamports: bigint;
  readonly requiredCollateralBaseUnits: bigint;
  readonly requiredSolLamports: bigint;
  readonly temporaryRentLamports: bigint;
};

export type PrivateFundingPreflightInput = {
  readonly amountBaseUnits: bigint;
  readonly collateralLegPending: boolean;
  readonly feeLegPending: boolean;
  readonly feeReserveLamports: bigint;
  readonly mint: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly signal?: AbortSignal;
  readonly walletAddress: string;
};

export async function preparePrivateFundingPreflight(
  input: PrivateFundingPreflightInput,
): Promise<PrivateFundingPreflight> {
  const owner = new PublicKey(input.walletAddress);
  const collateralAta = getAssociatedTokenAddressSync(
    new PublicKey(input.mint),
    owner,
  );
  const wrappedSolAta = getAssociatedTokenAddressSync(NATIVE_MINT, owner);
  const [balance, collateralAccount, wrappedSolAccount, proofRent, tokenRent, blockhash] =
    await Promise.all([
      rpc<ContextValue<number>>(input, 'getBalance', [
        input.walletAddress,
        { commitment: 'confirmed' },
      ]),
      account(input, collateralAta),
      account(input, wrappedSolAta),
      rpc<number>(input, 'getMinimumBalanceForRentExemption', [
        getPublicStealthPoolDepositInputBufferSize(),
        { commitment: 'confirmed' },
      ]),
      rpc<number>(input, 'getMinimumBalanceForRentExemption', [
        TOKEN_ACCOUNT_BYTES,
        { commitment: 'confirmed' },
      ]),
      rpc<ContextValue<{
        readonly blockhash: string;
        readonly lastValidBlockHeight: number;
      }>>(input, 'getLatestBlockhash', [{ commitment: 'confirmed' }]),
    ]);
  const feeMessage = new Transaction({
    feePayer: owner,
    recentBlockhash: blockhash.value.blockhash,
  }).add(SystemProgram.transfer({ fromPubkey: owner, lamports: 0, toPubkey: owner }));
  const fee = await rpc<ContextValue<number | null>>(input, 'getFeeForMessage', [
    base64.encode(feeMessage.serializeMessage()),
    { commitment: 'confirmed' },
  ]);
  const availableSolLamports = integer(balance.value, 'SOL balance');
  const proofRentLamports = integer(proofRent, 'Umbra proof-buffer rent');
  const tokenRentLamports = integer(tokenRent, 'token-account rent');
  const networkFeeLamports = fee.value === null
    ? null
    : integer(fee.value, 'network fee');

  if (networkFeeLamports === null) {
    throw new PrivateFundingError(
      'Solana could not estimate the private-funding network fee.',
      'fee_unavailable',
    );
  }

  const availableCollateralBaseUnits = tokenAmount(collateralAccount);
  const wrappedSolLamports = tokenAmount(wrappedSolAccount);
  const reserveDeficit = input.feeLegPending && wrappedSolLamports < input.feeReserveLamports
    ? input.feeReserveLamports - wrappedSolLamports
    : 0n;
  const ataRentLamports = reserveDeficit > 0n && wrappedSolAccount === null
    ? tokenRentLamports
    : 0n;
  const collateralStageLamports = input.collateralLegPending
    ? proofRentLamports + networkFeeLamports * 2n
    : 0n;
  const feeStageLamports = input.feeLegPending
    ? reserveDeficit + ataRentLamports + proofRentLamports +
      networkFeeLamports * 2n
    : 0n;
  const requiredSolLamports = collateralStageLamports > feeStageLamports
    ? collateralStageLamports
    : feeStageLamports;
  const requiredCollateralBaseUnits = input.collateralLegPending
    ? input.amountBaseUnits
    : 0n;
  const estimatedNetworkFeeLamports = networkFeeLamports *
    ((input.collateralLegPending ? 2n : 0n) +
      (input.feeLegPending ? 2n : 0n));

  return {
    availableCollateralBaseUnits,
    availableSolLamports,
    estimatedNetworkFeeLamports,
    missingCollateralBaseUnits: positiveDifference(
      requiredCollateralBaseUnits,
      availableCollateralBaseUnits,
    ),
    missingSolLamports: positiveDifference(requiredSolLamports, availableSolLamports),
    requiredCollateralBaseUnits,
    requiredSolLamports,
    temporaryRentLamports: proofRentLamports + ataRentLamports,
  };
}

export function assertPrivateFundingPreflight(
  preflight: PrivateFundingPreflight,
): void {
  if (preflight.missingCollateralBaseUnits > 0n) {
    throw new PrivateFundingError(
      'The public wallet does not have enough selected collateral.',
      'insufficient_collateral',
    );
  }

  if (preflight.missingSolLamports > 0n) {
    throw new PrivateFundingError(
      'The public wallet needs more SOL for the reserve, temporary rent, and network fees.',
      'insufficient_sol',
    );
  }
}

async function account(
  input: PrivateFundingPreflightInput,
  accountAddress: PublicKey,
): Promise<AccountValue> {
  const response = await rpc<ContextValue<AccountValue>>(input, 'getAccountInfo', [
    accountAddress.toBase58(),
    { commitment: 'confirmed', encoding: 'base64' },
  ]);
  return response.value;
}

async function rpc<T>(
  input: PrivateFundingPreflightInput,
  method: string,
  params: unknown,
): Promise<T> {
  return signedSolanaRpc<T>({
    method,
    params,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

function tokenAmount(accountValue: AccountValue): bigint {
  if (accountValue === null) {
    return 0n;
  }

  if (accountValue.owner !== TOKEN_PROGRAM_ID.toBase58()) {
    throw new PrivateFundingError(
      'A funding token account has an unexpected owner.',
      'balance_invalid',
    );
  }

  const data = base64.decode(accountValue.data[0]);

  if (data.length < 72) {
    throw new PrivateFundingError(
      'A funding token balance is invalid.',
      'balance_invalid',
    );
  }

  let amount = 0n;
  for (let index = 0; index < 8; index += 1) {
    amount |= BigInt(data[64 + index] ?? 0) << BigInt(index * 8);
  }
  return amount;
}

function integer(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PrivateFundingError(`Solana returned an invalid ${label}.`, 'balance_invalid');
  }
  return BigInt(value);
}

function positiveDifference(required: bigint, available: bigint): bigint {
  return required > available ? required - available : 0n;
}
