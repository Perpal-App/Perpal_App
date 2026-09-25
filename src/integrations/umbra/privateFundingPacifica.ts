import { parseAmount } from '@/domain/money/amount';
import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS,
  preparePacificaDeposit,
  submitPacificaDeposit,
  type PacificaDepositPlan,
} from '@/integrations/perps/pacifica/pacificaDeposit';
import { waitForPacificaDepositCredit } from '@/integrations/perps/pacifica/pacificaDepositSettlement';
import { refreshPacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolioStore';
import {
  removePendingTradeAction,
  writePendingTradeAction,
} from '@/integrations/perps/tradeActionStorage';
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

/**
 * Announces an in-flight Pacifica deposit where the rest of the app looks for one.
 *
 * This flow keeps its own checkpoint inside the Umbra funding record, which it has to: the record is
 * keyed by the public wallet and the phase machine needs the deposit's state co-located with the leg
 * that produced it. But the order ticket reconciles a different store — `PendingTradeAction`, keyed by
 * the trading wallet and the provider — and so it could not see a deposit this flow had already signed.
 *
 * That gap was a double-deposit window, and a narrow one rather than a theoretical one. While a deposit
 * from here is signed but not yet confirmed, Pacifica still reports zero available, so the ticket
 * computes the full shortfall again and builds a second deposit for the same collateral. Writing the
 * shared record closes it: the ticket's `reconcile` returns `pending` and its own preparation refuses
 * with "A previous collateral transaction is still confirming."
 *
 * Both records describe the same transaction and are written and cleared together. This is not the
 * single store the two paths should eventually share — it is the safety property that store was for.
 */
async function announceDeposit(
  owner: string,
  plan: PacificaDepositPlan,
  signature: string,
  signedTransactionBase64: string,
): Promise<void> {
  await writePendingTradeAction({
    amountBaseUnits: plan.amountBaseUnits.toString(),
    expiresAtMs: plan.expiresAtMs,
    idempotencyKey: plan.idempotencyKey,
    kind: 'collateral',
    owner,
    provider: 'pacifica',
    providerBalanceBeforeBaseUnits: plan.providerBalanceBeforeBaseUnits.toString(),
    expectedProviderCreditBaseUnits: plan.amountBaseUnits.toString(),
    signature,
    signedTransactionBase64,
    updatedAtMs: Date.now(),
    version: 1,
  });
}

/** Clears the shared record. Safe to call when none was written. */
function withdrawAnnouncement(owner: string): Promise<void> {
  return removePendingTradeAction(owner, 'pacifica');
}

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
    const portfolio = await refreshPacificaPortfolioSnapshot({
      account: input.record.tradingWalletAddress,
      apiOrigin: input.config.perps.pacificaApiOrigin,
      forceNetwork: true,
    });
    plan = await preparePacificaDeposit({
      amountBaseUnits,
      centralState: input.config.perps.pacificaCentralState,
      mint: input.config.perps.usdcMint,
      owner: input.record.tradingWalletAddress,
      programId: input.config.perps.pacificaProgramId,
      providerBalanceBeforeBaseUnits: parseAmount(portfolio.balance, 6).baseUnits,
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
      'The private wallet needs more SOL for the Pacifica deposit network fee.',
      'pacifica_deposit_insufficient_sol',
    );
  }

  try {
    const owner = input.record.tradingWalletAddress;
    const result = await submitPacificaDeposit({
      plan,
      rpcUrl: input.config.api.rpcUrl,
      signer: input.signer,
      onSigned: async (signature, signedTransactionBase64) => {
        await input.onCheckpoint({
          providerDepositExpiresAtMs: plan.expiresAtMs,
          providerDepositIdempotencyKey: plan.idempotencyKey,
          providerDepositSignature: signature,
          providerDepositSignedTransactionBase64: signedTransactionBase64,
        });
        await announceDeposit(owner, plan, signature, signedTransactionBase64);
      },
      onSubmissionRejected: async () => {
        await input.onCheckpoint(emptyCheckpoint());
        await withdrawAnnouncement(owner);
      },
    });

    if (result.status === 'confirmed') {
      const settlement = await waitForPacificaDepositCredit({
        account: owner,
        apiOrigin: input.config.perps.pacificaApiOrigin,
        rpcUrl: input.config.api.rpcUrl,
        signer: input.signer,
      });
      if (settlement.status === 'credited') return result.signature;
      throw indexingDeposit();
    }
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

  const owner = input.record.tradingWalletAddress;
  const status = await readSubmittedTransactionStatus({
    rpcUrl: input.config.api.rpcUrl,
    signature,
    signer: input.signer,
  });
  if (status === 'confirmed') {
    const settlement = await waitForPacificaDepositCredit({
      account: owner,
      apiOrigin: input.config.perps.pacificaApiOrigin,
      rpcUrl: input.config.api.rpcUrl,
      signer: input.signer,
    });
    if (settlement.status === 'credited') return signature;
    throw indexingDeposit();
  }
  if (status === 'failed') {
    await input.onCheckpoint(emptyCheckpoint());
    await withdrawAnnouncement(owner);
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
    if (status === 'processed') throw pendingDeposit();
    await input.onCheckpoint(emptyCheckpoint());
    await withdrawAnnouncement(owner);
    return null;
  }

  try {
    const result = await submitSignedLegacyTransaction({
      expectedSignature: signature,
      idempotencyKey,
      owner,
      rpcUrl: input.config.api.rpcUrl,
      signedTransactionBase64: transaction,
      signer: input.signer,
    });
    if (result.status === 'confirmed') {
      const settlement = await waitForPacificaDepositCredit({
        account: owner,
        apiOrigin: input.config.perps.pacificaApiOrigin,
        rpcUrl: input.config.api.rpcUrl,
        signer: input.signer,
      });
      if (settlement.status === 'credited') return result.signature;
      throw indexingDeposit();
    }
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

  // The baseline was visible on the confirmation as "Private USDC included". Freeze it at start and add
  // only this operation's confirmed note: reading the live wallet balance here would silently sweep any
  // unrelated USDC that arrived while the privacy route was running, whereas ignoring the baseline is
  // what stranded small earlier deposits in the intermediary wallet.
  return BigInt(record.privateUsdcBaseUnitsAtStart) + BigInt(record.noteAmountBaseUnits);
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

function indexingDeposit(): PrivateFundingError {
  return new PrivateFundingError(
    'The transfer confirmed. Pacifica is still crediting the trading balance.',
    'pacifica_deposit_indexing',
  );
}

function hasTypedCode(value: unknown): value is { readonly code: string } {
  return typeof value === 'object' && value !== null &&
    typeof (value as { readonly code?: unknown }).code === 'string';
}
