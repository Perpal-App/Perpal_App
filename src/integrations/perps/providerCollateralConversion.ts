import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { providerCollateral } from '@/integrations/perps/providerCollateral';
import {
  prepareStablecoinSwap,
  readTokenBalance,
} from '@/integrations/solana/stablecoinSwap';
import {
  signAndSubmitVersionedTransaction,
  storedVersionedTransactionIsCurrent,
  submitSignedVersionedTransaction,
} from '@/integrations/solana/signedVersionedTransaction';
import { readSubmittedTransactionStatus } from '@/integrations/solana/signedLegacyTransaction';
import { PrivateFundingError } from '@/integrations/umbra/privateFundingErrors';
import type { PrivateFundingRecord } from '@/integrations/umbra/umbraSecureStorage';

type Input = {
  readonly config: AppConfig;
  readonly onRecord: (record: PrivateFundingRecord) => Promise<void>;
  readonly record: PrivateFundingRecord;
  readonly signer: GatewayRequestSigner;
};

export async function ensureProviderCollateral(
  input: Input,
): Promise<PrivateFundingRecord> {
  const target = providerCollateral(
    input.record.provider,
    input.config.perps.flashProgramId,
  );

  if (input.record.mint === target.mint) {
    return input.record;
  }

  let record = await save(input, {
    ...input.record,
    phase: 'collateral-converting',
    updatedAtMs: Date.now(),
  });

  if (record.conversionOutputBaseUnits !== null) {
    return record;
  }

  if (record.conversionSignature !== null) {
    const status = await readSubmittedTransactionStatus({
      rpcUrl: input.config.api.rpcUrl,
      signature: record.conversionSignature,
      signer: input.signer,
    });

    if (status === 'confirmed') {
      return finishConversion(input, record, target.mint);
    }
    if (status === 'failed') {
      record = await clearSubmittedConversion(input, record);
    } else if (record.conversionSignedTransactionBase64 !== null) {
      const current = await storedVersionedTransactionIsCurrent({
        rpcUrl: input.config.api.rpcUrl,
        signedTransactionBase64: record.conversionSignedTransactionBase64,
        signer: input.signer,
      });

      if (current) {
        const result = await submitSignedVersionedTransaction({
          expectedSignature: record.conversionSignature,
          idempotencyKey: `${record.id}:stablecoin-conversion`,
          owner: record.tradingWalletAddress,
          rpcUrl: input.config.api.rpcUrl,
          signedTransactionBase64: record.conversionSignedTransactionBase64,
          signer: input.signer,
        });

        if (result.status === 'confirmed') {
          return finishConversion(input, record, target.mint);
        }
        throw conversionPending();
      }

      record = await clearSubmittedConversion(input, record);
    } else {
      throw new PrivateFundingError(
        'The stored stablecoin conversion cannot be resumed safely.',
        'provider_failed',
      );
    }
  }

  const before = await readTokenBalance({
    mint: target.mint,
    owner: record.tradingWalletAddress,
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
  });
  record = await save(input, {
    ...record,
    conversionOutputBalanceBeforeBaseUnits: before.toString(),
    updatedAtMs: Date.now(),
  });
  const plan = await prepareStablecoinSwap({
    amountBaseUnits: claimedAmount(record),
    inputMint: record.mint,
    outputMint: target.mint,
    owner: record.tradingWalletAddress,
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
    swapBuildUrl: input.config.api.swapBuildUrl,
  });
  record = await save(input, {
    ...record,
    conversionExpectedOutBaseUnits: plan.expectedOutputBaseUnits.toString(),
    conversionMinimumOutBaseUnits: plan.minimumOutputBaseUnits.toString(),
    updatedAtMs: Date.now(),
  });
  const result = await signAndSubmitVersionedTransaction({
    idempotencyKey: `${record.id}:stablecoin-conversion`,
    owner: record.tradingWalletAddress,
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
    transaction: plan.transaction,
    onSigned: async (signature, signedTransactionBase64) => {
      record = await save(input, {
        ...record,
        conversionSignature: signature,
        conversionSignedTransactionBase64: signedTransactionBase64,
        updatedAtMs: Date.now(),
      });
    },
  });

  if (result.status !== 'confirmed') {
    throw conversionPending();
  }

  return finishConversion(input, record, target.mint);
}

function claimedAmount(record: PrivateFundingRecord): bigint {
  const amount = BigInt(record.noteAmountBaseUnits ?? record.amountBaseUnits);
  if (amount <= 0n) {
    throw new PrivateFundingError(
      'The claimed collateral amount is invalid.',
      'amount_invalid',
    );
  }
  return amount;
}

async function finishConversion(
  input: Input,
  record: PrivateFundingRecord,
  outputMint: string,
): Promise<PrivateFundingRecord> {
  const before = BigInt(record.conversionOutputBalanceBeforeBaseUnits ?? '-1');
  const minimum = BigInt(record.conversionMinimumOutBaseUnits ?? '-1');
  const after = await readTokenBalance({
    mint: outputMint,
    owner: record.tradingWalletAddress,
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
  });
  const received = after - before;

  if (before < 0n || minimum <= 0n || received < minimum) {
    throw new PrivateFundingError(
      'The stablecoin conversion output could not be verified.',
      'provider_failed',
    );
  }

  return save(input, {
    ...record,
    conversionOutputBaseUnits: received.toString(),
    updatedAtMs: Date.now(),
  });
}

async function clearSubmittedConversion(
  input: Input,
  record: PrivateFundingRecord,
): Promise<PrivateFundingRecord> {
  return save(input, {
    ...record,
    conversionExpectedOutBaseUnits: null,
    conversionMinimumOutBaseUnits: null,
    conversionOutputBalanceBeforeBaseUnits: null,
    conversionSignature: null,
    conversionSignedTransactionBase64: null,
    updatedAtMs: Date.now(),
  });
}

function conversionPending(): PrivateFundingError {
  return new PrivateFundingError(
    'Stablecoin conversion is submitted and will resume after confirmation.',
    'provider_pending',
  );
}

async function save(
  input: Input,
  record: PrivateFundingRecord,
): Promise<PrivateFundingRecord> {
  await input.onRecord(record);
  return record;
}
