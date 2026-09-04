import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS,
  preparePacificaDeposit,
  submitPacificaDeposit,
  type PacificaDepositPlan,
} from '@/integrations/perps/pacifica/pacificaDeposit';
import {
  readSubmittedTransactionStatus,
  storedLegacyTransactionIsCurrent,
  submitSignedLegacyTransaction,
  TransactionSigningError,
} from '@/integrations/solana/signedLegacyTransaction';
import { PrivateFundingError } from '@/integrations/umbra/privateFundingErrors';
import type { PrivateFundingRecord } from '@/integrations/umbra/umbraSecureStorage';

type ProviderDepositCheckpoint = Pick<
  PrivateFundingRecord,
  | 'providerDepositExpiresAtMs'
  | 'providerDepositIdempotencyKey'
  | 'providerDepositSignature'
  | 'providerDepositSignedTransactionBase64'
>;

export async function fundPacificaFromPrivateWallet(input: {
  readonly config: AppConfig;
  readonly onCheckpoint: (checkpoint: ProviderDepositCheckpoint) => Promise<void>;
  readonly record: PrivateFundingRecord;
  readonly signer: GatewayRequestSigner;
}): Promise<string> {
  const amountBaseUnits = privateDepositAmount(input.record);

  if (amountBaseUnits < PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS) {
    throw new PrivateFundingError(
      'Pacifica must receive at least 10 USDC after the Umbra fee.',
      'pacifica_deposit_below_minimum',
    );
  }

  const recovered = await reconcileSignedDeposit(input);
  if (recovered !== null) return recovered;

  let plan: PacificaDepositPlan;
  try {
    plan = await preparePacificaDeposit({
      amountBaseUnits,
      centralState: input.config.perps.pacificaCentralState,
      mint: input.config.perps.usdcMint,
      owner: input.record.tradingWalletAddress,
      programId: input.config.perps.pacificaProgramId,
      rpcUrl: input.config.api.rpcUrl,
      signer: input.signer,
      vault: input.config.perps.pacificaVault,
    });
  } catch (cause) {
    if (hasTypedCode(cause)) throw cause;
    throw new PrivateFundingError(
      'The Pacifica deposit preview could not be verified.',
      'pacifica_deposit_prepare_failed',
    );
  }

  if (plan.simulation === 'insufficient-token') {
    throw new PrivateFundingError(
      'The private wallet has not received enough USDC yet.',
      'pacifica_deposit_insufficient_usdc',
    );
  }
  if (plan.simulation === 'insufficient-sol') {
    throw new PrivateFundingError(
      'The private wallet needs more SOL for the Pacifica deposit fee.',
      'pacifica_deposit_insufficient_sol',
    );
  }

  try {
    const result = await submitPacificaDeposit({
      plan,
      rpcUrl: input.config.api.rpcUrl,
      signer: input.signer,
      onSigned: (signature, signedTransactionBase64) => input.onCheckpoint({
        providerDepositExpiresAtMs: plan.expiresAtMs,
        providerDepositIdempotencyKey: plan.idempotencyKey,
        providerDepositSignature: signature,
        providerDepositSignedTransactionBase64: signedTransactionBase64,
      }),
      onSubmissionRejected: () => input.onCheckpoint(emptyCheckpoint()),
    });

    if (result.status === 'confirmed') return result.signature;
    throw pendingDeposit();
  } catch (cause) {
    if (cause instanceof PrivateFundingError) throw cause;
    if (cause instanceof TransactionSigningError) {
      throw new PrivateFundingError(
        cause.message,
        `pacifica_deposit_${cause.code}`,
      );
    }
    throw new PrivateFundingError(
      'The Pacifica deposit could not be submitted.',
      'pacifica_deposit_failed',
    );
  }
}

async function reconcileSignedDeposit(input: {
  readonly config: AppConfig;
  readonly onCheckpoint: (checkpoint: ProviderDepositCheckpoint) => Promise<void>;
  readonly record: PrivateFundingRecord;
  readonly signer: GatewayRequestSigner;
}): Promise<string | null> {
  const signature = input.record.providerDepositSignature;
  if (signature === null) return null;

  const status = await readSubmittedTransactionStatus({
    rpcUrl: input.config.api.rpcUrl,
    signature,
    signer: input.signer,
  });
  if (status === 'confirmed') return signature;
  if (status === 'failed') {
    await input.onCheckpoint(emptyCheckpoint());
    throw new PrivateFundingError(
      'The Pacifica deposit failed on-chain. It is safe to prepare it again.',
      'pacifica_deposit_transaction_failed',
    );
  }

  const transaction = input.record.providerDepositSignedTransactionBase64;
  const idempotencyKey = input.record.providerDepositIdempotencyKey;
  const expiresAtMs = input.record.providerDepositExpiresAtMs;
  if (transaction === null || idempotencyKey === null || expiresAtMs === null) {
    throw pendingDeposit();
  }

  const current = await storedLegacyTransactionIsCurrent({
    rpcUrl: input.config.api.rpcUrl,
    signedTransactionBase64: transaction,
    signer: input.signer,
  });
  if (!current) {
    await input.onCheckpoint(emptyCheckpoint());
    return null;
  }

  try {
    const result = await submitSignedLegacyTransaction({
      expectedSignature: signature,
      idempotencyKey,
      owner: input.record.tradingWalletAddress,
      rpcUrl: input.config.api.rpcUrl,
      signedTransactionBase64: transaction,
      signer: input.signer,
    });
    if (result.status === 'confirmed') return result.signature;
    throw pendingDeposit();
  } catch (cause) {
    if (cause instanceof PrivateFundingError) throw cause;
    if (cause instanceof TransactionSigningError) {
      throw new PrivateFundingError(
        cause.message,
        `pacifica_deposit_${cause.code}`,
      );
    }
    throw cause;
  }
}

function privateDepositAmount(record: PrivateFundingRecord): bigint {
  if (record.noteAmountBaseUnits === null) {
    throw new PrivateFundingError(
      'The confirmed private USDC amount is unavailable.',
      'pacifica_deposit_amount_unavailable',
    );
  }
  return BigInt(record.noteAmountBaseUnits);
}

function emptyCheckpoint(): ProviderDepositCheckpoint {
  return {
    providerDepositExpiresAtMs: null,
    providerDepositIdempotencyKey: null,
    providerDepositSignature: null,
    providerDepositSignedTransactionBase64: null,
  };
}

function pendingDeposit(): PrivateFundingError {
  return new PrivateFundingError(
    'The Pacifica deposit is submitted and still confirming.',
    'pacifica_deposit_pending',
  );
}

function hasTypedCode(value: unknown): value is { readonly code: string } {
  return typeof value === 'object' && value !== null &&
    typeof (value as { readonly code?: unknown }).code === 'string';
}
