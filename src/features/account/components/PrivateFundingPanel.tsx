import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton } from '@/components/ui/ActionButton';
import { PressableScale } from '@/components/ui/PressableScale';
import { readAppConfig } from '@/config/appConfig';
import { amountFromBaseUnits, formatAmount, parseAmount } from '@/domain/money/amount';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import {
  PrivateFundingConfirmationModal,
  type PrivateFundingConfirmation,
} from '@/features/account/components/PrivateFundingConfirmationModal';
import {
  hasSubmittedTransaction,
  pendingActionLabel,
  phaseLabel,
  preflightError,
  runningMessage,
  storedError,
} from '@/features/account/components/privateFundingLabels';
import {
  pacificaCollateral,
  type ProviderCollateral,
} from '@/integrations/perps/providerCollateral';
import { PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS } from '@/integrations/perps/pacifica/pacificaDeposit';
import { usePrivateFunding } from '@/integrations/umbra/PrivateFundingProvider';
import { PrivateFundingError } from '@/integrations/umbra/privateFundingErrors';
import {
  creditedUmbraAmount,
  minimumUmbraInputForCredit,
} from '@/integrations/umbra/privateFundingFees';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';
const SOL_DECIMALS = 9;
const FIELD_MIN_HEIGHT = layout.minTouchTarget;
const MINIMUM_PUBLIC_USDC_BASE_UNITS = minimumUmbraInputForCredit(
  PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS,
);

export function PrivateFundingPanel({
  balances,
  onBalancesChanged,
  onPacificaRefresh,
  tradingReady,
}: {
  /** The public wallet is where funds come from, so its balances are what bound the choice. */
  readonly balances: WalletBalances | null;
  readonly onBalancesChanged: () => void;
  readonly onPacificaRefresh: () => void;
  readonly tradingReady: boolean;
}) {
  const funding = usePrivateFunding();
  const [amount, setAmount] = useState('');
  const [feeReserve, setFeeReserve] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PrivateFundingConfirmation | null>(null);
  const refreshedCompletion = useRef<string | null>(null);

  const collateral = useMemo<ProviderCollateral | null>(() => {
    const config = readAppConfig();
    return config.ok ? pacificaCollateral(config.value.perps.usdcMint) : null;
  }, []);
  const symbol = collateral?.symbol ?? 'USDC';
  const selectedBalance = balances?.publicWallet?.usdcBaseUnits ?? null;
  const solLamports = balances?.publicWallet?.solLamports ?? null;

  const pending = funding.record?.phase === 'complete' ? null : funding.record;
  const shownSymbol = pending?.symbol ?? symbol;
  const balanceError = pending === null
    ? null
    : preflightError(funding.preflight, shownSymbol) ?? funding.preflightError;
  const visibleError = inputError ?? balanceError ?? funding.error
    ?? storedError(funding.record?.errorCode);
  const balanceMissing = funding.preflight !== null
    && (funding.preflight.missingCollateralBaseUnits > 0n
      || funding.preflight.missingSolLamports > 0n);
  const locked = funding.isRunning || !tradingReady;

  useEffect(() => {
    const record = funding.record;
    if (record?.phase !== 'complete') return;

    const completion = `${record.updatedAtMs}:${record.claimSignature ?? ''}:${record.feeFundingSignature ?? ''}`;
    if (refreshedCompletion.current === completion) return;
    refreshedCompletion.current = completion;
    onBalancesChanged();
    onPacificaRefresh();
  }, [funding.record, onBalancesChanged, onPacificaRefresh]);

  const useMaximum = () => {
    if (selectedBalance === null) return;
    setAmount(formatAmount(amountFromBaseUnits(selectedBalance, 6)));
    setInputError(null);
  };

  const confirmStart = async () => {
    if (collateral === null) {
      setInputError('Collateral configuration is unavailable.');
      return;
    }

    try {
      const parsed = parseAmount(amount, collateral.decimals);
      const parsedFeeReserve = parseAmount(feeReserve, SOL_DECIMALS);

      if (parsed.baseUnits <= 0n || parsedFeeReserve.baseUnits <= 0n) {
        throw new Error('invalid amount');
      }
      if (
        creditedUmbraAmount(parsed.baseUnits) <
          PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS
      ) {
        throw new PrivateFundingError(
          `Enter at least ${minimumPublicUsdc()} USDC so Pacifica receives 10 USDC after the Umbra fee.`,
          'pacifica_deposit_below_minimum',
        );
      }

      setInputError(null);
      const preflight = await funding.check({
        amountBaseUnits: parsed.baseUnits,
        collateralLegPending: true,
        feeLegPending: true,
        feeReserveLamports: parsedFeeReserve.baseUnits,
        mint: collateral.mint,
      });
      const shortage = preflightError(preflight, collateral.symbol);

      if (shortage !== null) {
        setInputError(shortage);
        return;
      }

      setConfirmation({
        amountBaseUnits: parsed.baseUnits,
        decimals: collateral.decimals,
        destination: 'pacifica',
        estimatedNetworkFeeLamports: preflight.estimatedNetworkFeeLamports,
        feeReserveLamports: parsedFeeReserve.baseUnits,
        hasSubmittedTransaction: false,
        mode: 'start',
        requiredSolLamports: preflight.requiredSolLamports,
        symbol: collateral.symbol,
        temporaryRentLamports: preflight.temporaryRentLamports,
      });
    } catch (cause) {
      setInputError(cause instanceof PrivateFundingError
        ? cause.message
        : `Enter valid ${shownSymbol} and SOL reserve amounts.`);
    }
  };

  const confirmResume = async () => {
    const record = funding.record;
    if (record === null) return;

    try {
      const reserveLamports = record.feeFundingLamports === null
        ? parseAmount(feeReserve, SOL_DECIMALS).baseUnits
        : BigInt(record.feeFundingLamports);

      if (reserveLamports <= 0n) throw new Error('invalid amount');

      setInputError(null);
      if (
        record.claimSignature !== null &&
        record.feeFundingSignature !== null
      ) {
        setConfirmation({
          amountBaseUnits: BigInt(record.amountBaseUnits),
          decimals: 6,
          destination: record.destination,
          estimatedNetworkFeeLamports: 0n,
          feeReserveLamports: reserveLamports,
          hasSubmittedTransaction: hasSubmittedTransaction(record),
          mode: 'resume',
          requiredSolLamports: 0n,
          symbol: record.symbol,
          temporaryRentLamports: 0n,
        });
        return;
      }
      const preflight = await funding.check({
        amountBaseUnits: BigInt(record.amountBaseUnits),
        collateralLegPending:
          record.depositSignature === null && record.claimSignature === null,
        feeLegPending:
          record.feeFundingDepositSignature === null && record.feeFundingSignature === null,
        feeReserveLamports: reserveLamports,
        mint: record.mint,
      });

      if (preflightError(preflight, record.symbol) !== null) return;

      setConfirmation({
        amountBaseUnits: BigInt(record.amountBaseUnits),
        decimals: 6,
        destination: record.destination,
        estimatedNetworkFeeLamports: preflight.estimatedNetworkFeeLamports,
        feeReserveLamports: reserveLamports,
        hasSubmittedTransaction: hasSubmittedTransaction(record),
        mode: 'resume',
        requiredSolLamports: preflight.requiredSolLamports,
        symbol: record.symbol,
        temporaryRentLamports: preflight.temporaryRentLamports,
      });
    } catch (cause) {
      setInputError(cause instanceof PrivateFundingError
        ? cause.message
        : 'Enter a valid SOL reserve amount.');
    }
  };

  const submitConfirmation = () => {
    const confirmed = confirmation;
    setConfirmation(null);
    if (confirmed === null) return;

    if (confirmed.mode === 'resume') {
      void funding.resume(
        funding.record?.feeFundingLamports === null
          ? confirmed.feeReserveLamports
          : undefined,
      );
      return;
    }

    if (collateral === null || confirmed.symbol !== 'USDC') {
      setInputError('Collateral configuration is unavailable.');
      return;
    }

    void funding.start(
      confirmed.amountBaseUnits,
      confirmed.feeReserveLamports,
      collateral,
    );
  };

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Add funds</Text>
      {funding.record ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {phaseLabel(funding.record.phase)}
        </Text>
      ) : null}

      {pending === null ? (
        <>
          <View style={styles.summary}>
            <Text numberOfLines={1} style={styles.summaryProvider}>Pacifica · USDC</Text>
            <Text numberOfLines={1} style={styles.summaryMinimum}>Min 10 USDC credited</Text>
          </View>
          <View style={styles.field}>
            <FieldHead
              available={selectedBalance === null
                ? null
                : `Spendable ${formatAmount(amountFromBaseUnits(selectedBalance, 6))} USDC`}
              label="Amount"
            />
            <View style={styles.row}>
              <TextInput
                accessibilityLabel="USDC amount"
                autoCapitalize="none"
                editable={!locked}
                inputMode="decimal"
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.amountInput]}
                value={amount}
              />
              <PressableScale
                accessibilityLabel="Use maximum USDC balance"
                accessibilityRole="button"
                disabled={locked || selectedBalance === null}
                onPress={useMaximum}
                style={styles.maxButton}
              >
                <Text style={styles.maxLabel}>Max</Text>
              </PressableScale>
              <TokenTag label="USDC" />
            </View>
            <Text numberOfLines={1} style={styles.hint}>
              Min {minimumPublicUsdc()} USDC including privacy fee
            </Text>
          </View>
        </>
      ) : null}

      {pending === null || funding.record?.feeFundingLamports === null ? (
        <View style={styles.field}>
          <FieldHead
            available={solLamports === null
              ? null
              : `Available ${formatAmount(amountFromBaseUnits(solLamports, SOL_DECIMALS))} SOL`}
            label="Fee reserve"
          />
          <View style={styles.row}>
            <TextInput
              accessibilityLabel="SOL network fee reserve"
              autoCapitalize="none"
              editable={!locked}
              inputMode="decimal"
              onChangeText={setFeeReserve}
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.amountInput]}
              value={feeReserve}
            />
            <TokenTag label="SOL" />
          </View>
        </View>
      ) : null}

      {funding.isRunning ? (
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          {runningMessage(funding.record?.phase)}
        </Text>
      ) : null}
      {visibleError ? (
        <Text accessibilityRole="alert" style={styles.error}>{visibleError}</Text>
      ) : null}

      {pending !== null ? (
        <ActionButton
          disabled={!tradingReady || funding.isChecking || balanceMissing}
          label={pendingActionLabel({
            isChecking: funding.isChecking,
            isRunning: funding.isRunning,
            preflight: funding.preflight,
            symbol: funding.record?.symbol ?? null,
          })}
          loading={funding.isRunning || funding.isChecking}
          onPress={() => void confirmResume()}
          tone="neutral"
        />
      ) : (
        <ActionButton
          disabled={!tradingReady || collateral === null}
          label={funding.record?.phase === 'complete' ? 'Add more funds' : 'Add funds'}
          loading={funding.isRunning}
          onPress={() => void confirmStart()}
        />
      )}

      <PrivateFundingConfirmationModal
        confirmation={confirmation}
        onCancel={() => setConfirmation(null)}
        onConfirm={submitConfirmation}
      />
    </View>
  );
}

function FieldHead({
  available,
  label,
}: {
  readonly available: string | null;
  readonly label: string;
}) {
  return (
    <View style={styles.fieldHead}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {available === null ? null : (
        <Text numberOfLines={1} style={styles.fieldAvailable}>{available}</Text>
      )}
    </View>
  );
}

function TokenTag({ label }: { readonly label: string }) {
  return (
    <View accessibilityElementsHidden style={styles.token}>
      <Text numberOfLines={1} style={styles.tokenLabel}>{label}</Text>
    </View>
  );
}

function minimumPublicUsdc(): string {
  return formatAmount(amountFromBaseUnits(MINIMUM_PUBLIC_USDC_BASE_UNITS, 6));
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md },
  title: { ...typography.heading, color: colors.textPrimary },
  note: { ...typography.bodyCompact, color: colors.textSecondary },
  status: { ...typography.label, color: colors.accentSoft },
  summary: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  summaryProvider: {
    ...typography.label,
    flexShrink: 1,
    color: colors.textPrimary,
  },
  summaryMinimum: {
    ...typography.caption,
    flexShrink: 1,
    color: colors.textSecondary,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  field: { gap: spacing.xs },
  fieldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  fieldLabel: { ...typography.label, color: colors.textSecondary },
  fieldAvailable: {
    ...typography.caption,
    flexShrink: 1,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  input: {
    minHeight: FIELD_MIN_HEIGHT,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    ...typography.bodyCompact,
  },
  amountInput: { flex: 1, minWidth: 0 },
  maxButton: {
    minWidth: 56,
    minHeight: FIELD_MIN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
  },
  maxLabel: { ...typography.label, color: colors.textPrimary },
  token: {
    minHeight: FIELD_MIN_HEIGHT,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
  },
  tokenLabel: { ...typography.label, color: colors.textPrimary },
  hint: { ...typography.caption, color: colors.textMuted },
  error: { ...typography.bodyCompact, color: colors.negative },
});
