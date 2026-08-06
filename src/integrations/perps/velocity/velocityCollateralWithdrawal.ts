import { base64 } from '@scure/base';
import { CustomBorshCoder } from '@velocity-exchange/sdk/lib/browser/decode/customCoder';
import velocityIdl from '@velocity-exchange/sdk/lib/browser/idl/velocity.json';
import { BN } from '@velocity-exchange/sdk/lib/browser/isomorphic/anchor';
import { getTokenAmount } from '@velocity-exchange/sdk/lib/browser/math/spotBalance';
import { getVelocitySignerPublicKey } from '@velocity-exchange/sdk/lib/browser/addresses/pda';
import { SpotBalanceType } from '@velocity-exchange/sdk/lib/browser/types';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  buildVelocityOrderRemainingAccounts,
  loadVelocityOrderState,
  VelocityMarketOrderError,
} from '@/integrations/perps/velocity/velocityMarketOrderState';
import { signAndSubmitLegacyTransaction } from '@/integrations/solana/signedLegacyTransaction';

const QUOTE_MARKET_INDEX = 0;
const coder = new CustomBorshCoder(
  velocityIdl as unknown as ConstructorParameters<typeof CustomBorshCoder>[0],
);

export async function ensureVelocityCollateralInWallet(input: {
  readonly amountBaseUnits: bigint;
  readonly owner: string;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
}): Promise<void> {
  const state = await loadVelocityOrderState({
    ...input,
    symbol: 'BTC-PERP',
  });
  const owner = new PublicKey(input.owner);
  const tokenAccount = getAssociatedTokenAddressSync(state.spotMarket.mint, owner);
  const walletBalance = await signedSolanaRpc<{
    readonly context: { readonly slot: number };
    readonly value: { readonly amount: string };
  }>({
    method: 'getTokenAccountBalance',
    params: [tokenAccount.toBase58(), { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  const current = BigInt(walletBalance.value.amount);
  if (current >= input.amountBaseUnits) return;

  const missing = input.amountBaseUnits - current;
  const spotPosition = state.user.spotPositions.find(
    (position) => position.marketIndex === QUOTE_MARKET_INDEX,
  );
  const deposit = spotPosition === undefined || spotPosition.balanceType !== SpotBalanceType.DEPOSIT
    ? 0n
    : BigInt(getTokenAmount(
        spotPosition.scaledBalance,
        state.spotMarket,
        SpotBalanceType.DEPOSIT,
      ).toString());
  if (deposit < missing) {
    throw new VelocityMarketOrderError(
      'The requested amount exceeds T and available Velocity collateral.',
      'withdrawal_balance_insufficient',
    );
  }

  const blockhash = await signedSolanaRpc<{
    readonly context: { readonly slot: number };
    readonly value: { readonly blockhash: string };
  }>({
    method: 'getLatestBlockhash',
    params: [{ commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  const remaining = buildVelocityOrderRemainingAccounts(state).map((account) => ({
    pubkey: new PublicKey(account.address),
    isSigner: false,
    isWritable: account.writable,
  }));
  const transaction = buildWithdrawal({
    amountBaseUnits: missing,
    mint: state.spotMarket.mint,
    owner,
    programId: new PublicKey(input.programId),
    recentBlockhash: blockhash.value.blockhash,
    remaining,
    spotMarketVault: state.spotMarket.vault,
    stateAccount: new PublicKey(state.addresses.stateAccount),
    userAccount: new PublicKey(state.addresses.userAccount),
    userStatsAccount: new PublicKey(state.addresses.userStatsAccount),
  });
  await simulate(transaction, input);
  const result = await signAndSubmitLegacyTransaction({
    idempotencyKey: `velocity_private_exit_${input.owner}_${input.amountBaseUnits}_${current}`,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    unsignedTransaction: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  });
  if (result.status !== 'confirmed') {
    throw new VelocityMarketOrderError(
      'Velocity collateral withdrawal is still confirming. Resume shortly.',
      'withdrawal_pending',
    );
  }
}

function buildWithdrawal(input: {
  readonly amountBaseUnits: bigint;
  readonly mint: PublicKey;
  readonly owner: PublicKey;
  readonly programId: PublicKey;
  readonly recentBlockhash: string;
  readonly remaining: readonly AccountMeta[];
  readonly spotMarketVault: PublicKey;
  readonly stateAccount: PublicKey;
  readonly userAccount: PublicKey;
  readonly userStatsAccount: PublicKey;
}): Transaction {
  return new Transaction({ feePayer: input.owner, recentBlockhash: input.recentBlockhash })
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
    .add(new TransactionInstruction({
      programId: input.programId,
      keys: [
        ro(input.stateAccount),
        rw(input.userAccount),
        rw(input.userStatsAccount),
        signer(input.owner),
        rw(input.spotMarketVault),
        ro(getVelocitySignerPublicKey(input.programId)),
        rw(getAssociatedTokenAddressSync(input.mint, input.owner)),
        ro(TOKEN_PROGRAM_ID),
        ...input.remaining,
      ],
      data: coder.instruction.encode('withdraw', {
        market_index: QUOTE_MARKET_INDEX,
        amount: bn(input.amountBaseUnits),
        reduce_only: true,
      }),
    }));
}

async function simulate(
  transaction: Transaction,
  input: { readonly rpcUrl: string; readonly signer: GatewayRequestSigner },
) {
  const result = await signedSolanaRpc<{ readonly value: { readonly err: unknown } }>({
    method: 'simulateTransaction',
    params: [
      base64.encode(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })),
      { commitment: 'confirmed', encoding: 'base64', sigVerify: false },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  if (result.value.err !== null) {
    throw new VelocityMarketOrderError(
      'Velocity cannot withdraw that collateral without affecting open risk.',
      'withdrawal_simulation_failed',
    );
  }
}

function bn(value: bigint): BN {
  const Constructor = BN as unknown as { new (input: string): BN };
  return new Constructor(value.toString());
}
function ro(pubkey: PublicKey): AccountMeta { return { pubkey, isSigner: false, isWritable: false }; }
function rw(pubkey: PublicKey): AccountMeta { return { pubkey, isSigner: false, isWritable: true }; }
function signer(pubkey: PublicKey): AccountMeta { return { pubkey, isSigner: true, isWritable: true }; }
