import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  prepareFlashFunding,
  submitFlashFunding,
} from '@/integrations/perps/flash/flashFunding';
import {
  prepareVelocityAccountInitialization,
  submitVelocityAccountInitialization,
  VelocityInitializationError,
} from '@/integrations/perps/velocity/velocityAccountInitialization';
import {
  prepareVelocityCollateralDeposit,
  submitVelocityCollateralDeposit,
} from '@/integrations/perps/velocity/velocityCollateralDeposit';
import {
  readSubmittedTransactionStatus,
  type SubmittedTransactionResult,
} from '@/integrations/solana/signedLegacyTransaction';
import { PrivateFundingError } from '@/integrations/umbra/privateFundingErrors';
import type { PrivateFundingRecord } from '@/integrations/umbra/umbraSecureStorage';

type Input = {
  readonly config: AppConfig;
  readonly record: PrivateFundingRecord;
  readonly signer: GatewayRequestSigner;
  readonly onRecord: (record: PrivateFundingRecord) => Promise<void>;
};

export async function fundSelectedProvider(input: Input): Promise<PrivateFundingRecord> {
  return input.record.provider === 'velocity'
    ? fundVelocity(input)
    : fundFlash(input);
}

async function fundVelocity(input: Input): Promise<PrivateFundingRecord> {
  let record = await save(input, {
    ...input.record,
    phase: 'provider-setup',
    updatedAtMs: Date.now(),
  });

  if (!record.providerSetupComplete) {
    if (record.providerSetupSignature !== null) {
      await requireConfirmed(record.providerSetupSignature, input);
      record = await save(input, {
        ...record,
        providerSetupComplete: true,
        updatedAtMs: Date.now(),
      });
    } else {
      try {
        const plan = await prepareVelocityAccountInitialization({
          owner: record.tradingWalletAddress,
          programId: input.config.perps.velocityProgramId,
          rpcUrl: input.config.api.rpcUrl,
          signer: input.signer,
        });
        const result = await submitVelocityAccountInitialization({
          owner: record.tradingWalletAddress,
          plan,
          programId: input.config.perps.velocityProgramId,
          rpcUrl: input.config.api.rpcUrl,
          signer: input.signer,
        });
        record = await save(input, {
          ...record,
          providerSetupComplete: result.status === 'confirmed',
          providerSetupSignature: result.signature,
          updatedAtMs: Date.now(),
        });
        requireResultConfirmed(result);
      } catch (cause) {
        if (
          cause instanceof VelocityInitializationError &&
          cause.code === 'already_initialized'
        ) {
          record = await save(input, {
            ...record,
            providerSetupComplete: true,
            updatedAtMs: Date.now(),
          });
        } else {
          throw cause;
        }
      }
    }
  }

  record = await save(input, {
    ...record,
    phase: 'provider-depositing',
    updatedAtMs: Date.now(),
  });

  if (record.providerDepositSignature !== null) {
    await requireConfirmed(record.providerDepositSignature, input);
    return complete(input, record);
  }

  const amountBaseUnits = claimedAmount(record);
  const plan = await prepareVelocityCollateralDeposit({
    amountBaseUnits,
    owner: record.tradingWalletAddress,
    programId: input.config.perps.velocityProgramId,
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
  });
  const result = await submitVelocityCollateralDeposit({
    amountBaseUnits,
    owner: record.tradingWalletAddress,
    plan,
    programId: input.config.perps.velocityProgramId,
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
  });
  record = await save(input, {
    ...record,
    providerDepositSignature: result.signature,
    updatedAtMs: Date.now(),
  });
  requireResultConfirmed(result);
  return complete(input, record);
}

async function fundFlash(input: Input): Promise<PrivateFundingRecord> {
  let record = await save(input, {
    ...input.record,
    phase: 'provider-depositing',
    updatedAtMs: Date.now(),
  });

  if (record.providerDepositSignature !== null) {
    await requireConfirmed(record.providerDepositSignature, input);
    return complete(input, {
      ...record,
      providerSetupComplete: true,
    });
  }

  const plan = await prepareFlashFunding({
    amountBaseUnits: claimedAmount(record),
    mint: record.mint,
    owner: record.tradingWalletAddress,
    programId: input.config.perps.flashProgramId,
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
  });
  const result = await submitFlashFunding({
    amountBaseUnits: claimedAmount(record),
    mint: record.mint,
    owner: record.tradingWalletAddress,
    plan,
    programId: input.config.perps.flashProgramId,
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
  });
  record = await save(input, {
    ...record,
    providerSetupComplete: result.status === 'confirmed',
    providerSetupSignature: result.signature,
    providerDepositSignature: result.signature,
    updatedAtMs: Date.now(),
  });
  requireResultConfirmed(result);
  return complete(input, record);
}

async function requireConfirmed(signature: string, input: Input): Promise<void> {
  const status = await readSubmittedTransactionStatus({
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
    signature,
  });

  if (status === 'failed') {
    throw new PrivateFundingError(
      'The provider funding transaction failed on-chain.',
      'provider_failed',
    );
  }
  if (status !== 'confirmed') {
    throw providerPending();
  }
}

function requireResultConfirmed(result: SubmittedTransactionResult): void {
  if (result.status !== 'confirmed') {
    throw providerPending();
  }
}

function providerPending(): PrivateFundingError {
  return new PrivateFundingError(
    'Provider funding is submitted and will resume after confirmation.',
    'provider_pending',
  );
}

function claimedAmount(record: PrivateFundingRecord): bigint {
  const amount = BigInt(record.noteAmountBaseUnits ?? record.amountBaseUnits);
  if (amount <= 0n) {
    throw new PrivateFundingError('The claimed collateral amount is invalid.', 'amount_invalid');
  }
  return amount;
}

async function complete(input: Input, record: PrivateFundingRecord) {
  return save(input, {
    ...record,
    phase: 'complete',
    providerSetupComplete: true,
    errorCode: null,
    updatedAtMs: Date.now(),
  });
}

async function save(
  input: Input,
  record: PrivateFundingRecord,
): Promise<PrivateFundingRecord> {
  await input.onRecord(record);
  return record;
}
