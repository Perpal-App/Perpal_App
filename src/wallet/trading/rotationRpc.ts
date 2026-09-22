import { base64 } from '@scure/base';
import type { Transaction } from '@solana/web3.js';

import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import type { RotationRpcInput } from '@/wallet/trading/rotationAccounts';
import { TradingWalletRotationError } from '@/wallet/trading/rotationTypes';

/**
 * The Solana reads a rotation depends on, and the simulation gate it passes through.
 *
 * Split out of `rotationSafety` because that module owns the *decisions* — what to migrate, in what
 * order, whether the wallet can afford it, what to checkpoint — while every function here is the same
 * shape: one signed JSON-RPC call, one validation of the answer, one typed rotation error when the
 * answer cannot be trusted. Keeping them together means a change to how a value is verified happens
 * in one file rather than in the middle of the flow that consumes it.
 *
 * Every one of these validates before returning. A rotation moves funds, so a malformed or
 * out-of-range answer from a provider has to become a rotation error rather than a number that
 * silently propagates into fee arithmetic.
 */

/**
 * Simulation failures worth naming, and what the reader can do about each.
 *
 * Solana serializes a `TransactionError` with no payload as a bare string, so these arrive as exactly
 * these words; a variant that carries data (`{ InstructionError: [1, …] }`) is an object and falls
 * through to the caller's own message. Only the payload-free variants a rotation can realistically hit
 * are listed — inventing copy for the rest would be guessing at a cause.
 *
 * `AccountNotFound` is the one that matters most and the least obviously named: the runtime reports it
 * when it is asked to debit an account it has no record of, which for these transactions means the fee
 * payer — the source wallet — has never held SOL. It is an empty wallet, not a missing token account.
 *
 * Wording is free of the internal wallet letter and of any address, since these strings are shown to
 * the reader verbatim — a `prepareRotation` failure is toasted by the account screen and a `rotate`
 * failure becomes `session.error`.
 *
 * And they are short because that toast is one line that truncates rather than wraps. Measured against
 * the bundled Poppins, the bar has 264pt for its message on a 360pt screen, which is about 39
 * characters; a properly worded sentence explaining that the wallet needs funding was 608pt and would
 * have arrived as "The private wallet holds no SOL, so it …". The fact has to come before the advice,
 * because only the fact survives.
 */
const SIMULATION_REASONS: Readonly<Record<string, string>> = {
  AccountNotFound: 'Private wallet has no SOL for fees.',
  AlreadyProcessed: 'Already submitted. Resume rotation.',
  BlockhashNotFound: 'Rotation preview expired. Retry.',
  InsufficientFundsForFee: 'Not enough SOL for rotation fees.',
  InvalidAccountForFee: 'Private wallet cannot pay the fee.',
};

export async function latestBlockhash(input: RotationRpcInput): Promise<string> {
  const result = await signedSolanaRpc<{ readonly value: { readonly blockhash: string } }>({
    method: 'getLatestBlockhash',
    params: [{ commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  return result.value.blockhash;
}

/**
 * What the network will charge for this message.
 *
 * Computed from the serialized message alone, which is why it is safe to call before the fee payer is
 * known to exist on chain — the rotation's affordability check depends on that ordering.
 */
export async function transactionFee(
  transaction: Transaction,
  input: RotationRpcInput,
): Promise<bigint> {
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

export async function solBalance(address: string, input: RotationRpcInput): Promise<bigint> {
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

/**
 * Previews a rotation transaction, and fails the rotation when the network rejects it.
 *
 * `message` is the fallback, used only when the reported error is one this module cannot name.
 */
export async function simulate(
  transaction: Transaction,
  input: RotationRpcInput,
  message: string,
): Promise<void> {
  const result = await signedSolanaRpc<{
    readonly value?: { readonly err?: unknown } | null;
  }>({
    method: 'simulateTransaction',
    params: [
      base64.encode(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })),
      { commitment: 'confirmed', encoding: 'base64', sigVerify: false },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  const err = result.value?.err;
  if (err === null) return;

  // Fail closed on a shape that cannot be read. `value` was previously dereferenced unguarded, so a
  // provider that answered without it raised a TypeError from inside a funds-moving path rather than
  // a rotation error the caller could classify. A simulation whose outcome is unknown is not a pass.
  if (err === undefined) {
    throw new TradingWalletRotationError('Rotation preview unverified.');
  }

  throw new TradingWalletRotationError(
    (typeof err === 'string' ? SIMULATION_REASONS[err] : undefined) ?? message,
  );
}
