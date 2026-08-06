import { Buffer } from 'buffer';

import { base58, base64 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  encodeShortvec,
  rebaseProgramIndices,
  serializeMessageUnbounded,
} from '@flash_trade/flash-sdk-v2/dist/utils/erWire';
import { fetch } from 'expo/fetch';
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  type Message,
  type TransactionInstruction,
} from '@flash_trade/flash-sdk-v2/node_modules/@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  logTradeTiming,
  type TradeTimingContext,
} from '@/integrations/observability/tradeTiming';

const MAX_RESPONSE_BYTES = 512 * 1024;
const CONFIRM_ATTEMPTS = 20;
const CONFIRM_INTERVAL_MS = 1_000;

export type FlashErTransaction = {
  readonly blockhash: string;
  readonly feeLamports: bigint;
  readonly instructions: readonly TransactionInstruction[];
  readonly message: Uint8Array;
  readonly simulation: 'passed';
};

export async function prepareFlashErTransaction(input: {
  readonly erRpcUrl: string;
  readonly instructions: readonly TransactionInstruction[];
  readonly owner: string;
  readonly signal?: AbortSignal;
}): Promise<FlashErTransaction> {
  const blockhash = await rpc<{ readonly value: { readonly blockhash: string } }>(
    input.erRpcUrl,
    'getLatestBlockhash',
    [{ commitment: 'confirmed' }],
    input.signal,
  );
  const transaction = new Transaction({
    feePayer: new PublicKey(input.owner),
    recentBlockhash: blockhash.value.blockhash,
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ...input.instructions,
  );
  const message = compileUnbounded(transaction);
  const [fee, simulation] = await Promise.all([
    rpc<{ readonly value: number | null }>(
      input.erRpcUrl,
      'getFeeForMessage',
      [base64.encode(message), { commitment: 'confirmed' }],
      input.signal,
    ),
    rpc<{ readonly value: { readonly err: unknown } }>(
      input.erRpcUrl,
      'simulateTransaction',
      [
        base64.encode(unsignedWire(message)),
        {
          commitment: 'confirmed',
          encoding: 'base64',
          replaceRecentBlockhash: false,
          sigVerify: false,
        },
      ],
      input.signal,
    ),
  ]);
  if (fee.value === null || !Number.isSafeInteger(fee.value) || fee.value < 0) {
    throw new Error('Flash ER omitted the transaction fee.');
  }
  if (simulation.value.err !== null) {
    throw new Error('Flash rejected the order preview.');
  }
  return {
    blockhash: blockhash.value.blockhash,
    feeLamports: BigInt(fee.value),
    instructions: input.instructions,
    message,
    simulation: 'passed',
  };
}

export async function submitFlashErTransaction(input: {
  readonly erRpcUrl: string;
  readonly message: Uint8Array;
  readonly owner: string;
  readonly signer: GatewayRequestSigner;
  readonly onSigned?: (signature: string) => Promise<void>;
  readonly tradeTiming: TradeTimingContext;
}): Promise<{ readonly signature: string; readonly status: 'confirmed' | 'submitted' }> {
  const owner = new PublicKey(input.owner);
  if (base58.encode(input.signer.publicKey) !== owner.toBase58()) {
    throw new Error('Flash signer does not match private wallet T.');
  }
  const signature = await input.signer.sign(input.message);
  if (signature.length !== 64 || !ed25519.verify(signature, input.message, owner.toBytes())) {
    throw new Error('Flash returned an invalid local signature.');
  }
  const expected = base58.encode(signature);
  await input.onSigned?.(expected);
  const wire = Buffer.concat([
    encodeShortvec(1),
    Buffer.from(signature),
    Buffer.from(input.message),
  ]);
  const submissionStartedAtMs = performance.now();
  logTradeTiming(
    input.tradeTiming,
    'intent_to_submission',
    input.tradeTiming.intentStartedAtMs,
    'ok',
  );
  let submitted: string;
  try {
    submitted = await rpc<string>(
      input.erRpcUrl,
      'sendTransaction',
      [base64.encode(wire), { encoding: 'base64', maxRetries: 0, skipPreflight: true }],
    );
  } catch (cause) {
    logTradeTiming(
      input.tradeTiming,
      'submission_to_acknowledgement',
      submissionStartedAtMs,
      'error',
    );
    throw cause;
  }
  logTradeTiming(
    input.tradeTiming,
    'submission_to_acknowledgement',
    submissionStartedAtMs,
    submitted === expected ? 'ok' : 'unknown',
  );
  if (submitted !== expected) throw new Error('Flash ER returned a mismatched signature.');

  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
    const result = await rpc<{ readonly meta: { readonly err: unknown } } | null>(
      input.erRpcUrl,
      'getTransaction',
      [expected, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
    ).catch(() => null);
    if (result !== null) {
      if (result.meta.err !== null) throw new Error('Flash order failed on the ER.');
      return { signature: expected, status: 'confirmed' };
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_INTERVAL_MS));
  }
  return { signature: expected, status: 'submitted' };
}

export async function readFlashErTransactionStatus(
  erRpcUrl: string,
  signature: string,
): Promise<'confirmed' | 'failed' | 'pending'> {
  const result = await rpc<{ readonly meta: { readonly err: unknown } } | null>(
    erRpcUrl,
    'getTransaction',
    [signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
  ).catch(() => null);
  if (result === null) return 'pending';
  return result.meta.err === null ? 'confirmed' : 'failed';
}

function compileUnbounded(transaction: Transaction): Uint8Array {
  const message = (transaction as Transaction & { _compile(): Message })._compile();
  if (
    message.header.numRequiredSignatures !== 1 ||
    !message.accountKeys[0]?.equals(transaction.feePayer!)
  ) {
    throw new Error('Flash order requires an unexpected signer.');
  }
  rebaseProgramIndices(message);
  return serializeMessageUnbounded(message);
}

function unsignedWire(message: Uint8Array): Uint8Array {
  return Buffer.concat([encodeShortvec(1), Buffer.alloc(64), Buffer.from(message)]);
}

async function rpc<T>(
  url: string,
  method: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`Flash ER returned HTTP ${response.status}.`);
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('Flash ER returned an oversized response.');
  }
  const parsed = JSON.parse(body) as {
    readonly id?: unknown;
    readonly result?: T;
    readonly error?: { readonly message?: unknown };
  };
  if (parsed.id !== method || parsed.error !== undefined || !('result' in parsed)) {
    throw new Error('Flash ER rejected the request.');
  }
  return parsed.result as T;
}
