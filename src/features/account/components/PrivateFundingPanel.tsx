import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/ui/Button';
import { readAppConfig, type PerpsProviderId } from '@/config/appConfig';
import {
  amountFromBaseUnits,
  formatAmount,
  parseAmount,
} from '@/domain/money/amount';
import { CollateralSelector } from '@/features/account/components/CollateralSelector';
import {
  PrivateFundingConfirmationModal,
  type PrivateFundingConfirmation,
} from '@/features/account/components/PrivateFundingConfirmationModal';
import {
  listTradingCollateralOptions,
  type ProviderCollateral,
} from '@/integrations/perps/providerCollateral';
import { usePrivateFunding } from '@/integrations/umbra/PrivateFundingProvider';
import {
  PrivateFundingError,
  privateFundingUserMessage,
} from '@/integrations/umbra/privateFundingErrors';
import type { PrivateFundingPreflight } from '@/integrations/umbra/privateFundingPreflight';
import type { PrivateFundingRecord } from '@/integrations/umbra/umbraSecureStorage';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export function PrivateFundingPanel({
  provider,
  tradingReady,
}: {
  readonly provider: PerpsProviderId;
  readonly tradingReady: boolean;
}) {
  const funding = usePrivateFunding();
  const [amount, setAmount] = useState('');
  const [feeReserve, setFeeReserve] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [confirmation, setConfirmation] =
    useState<PrivateFundingConfirmation | null>(null);
  const collateralOptions = useMemo(() => {
    const config = readAppConfig();
    return config.ok
      ? listTradingCollateralOptions(config.value.perps.flashProgramId)
      : [];
  }, []);
  const [selectedSymbol, setSelectedSymbol] = useState<
    ProviderCollateral['symbol']
  >(() => {
    const config = readAppConfig();
    return config.ok
      ? listTradingCollateralOptions(config.value.perps.flashProgramId)[0]?.symbol ?? 'USDC'
      : 'USDC';
  });
  const collateral =
    collateralOptions.find((option) => option.symbol === selectedSymbol) ?? null;
  const pending = funding.record?.phase === 'complete' ? null : funding.record;
  const shownSymbol = pending?.symbol ?? collateral?.symbol ?? 'collateral';
  const balanceError = pending === null
    ? null
    : preflightError(funding.preflight, shownSymbol) ?? funding.preflightError;
  const visibleError = inputError ?? balanceError ?? funding.error ??
    storedError(funding.record?.errorCode);
  const balanceMissing = funding.preflight !== null &&
    (funding.preflight.missingCollateralBaseUnits > 0n ||
      funding.preflight.missingSolLamports > 0n);

  const confirmStart = async () => {
    if (collateral === null) {
      setInputError('Collateral configuration is unavailable.');
      return;
    }

    try {
      const parsed = parseAmount(amount, collateral.decimals);
      const parsedFeeReserve = parseAmount(feeReserve, 9);

      if (parsed.baseUnits <= 0n || parsedFeeReserve.baseUnits <= 0n) {
        throw new Error('invalid amount');
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
        estimatedNetworkFeeLamports: preflight.estimatedNetworkFeeLamports,
        feeReserveLamports: parsedFeeReserve.baseUnits,
        hasSubmittedTransaction: false,
        mode: 'start',
        provider,
        requiredSolLamports: preflight.requiredSolLamports,
        symbol: collateral.symbol,
        temporaryRentLamports: preflight.temporaryRentLamports,
      });
    } catch (cause) {
      setInputError(cause instanceof PrivateFundingError
        ? cause.message
        : `Enter valid ${shownSymbol} collateral and SOL reserve amounts.`);
    }
  };

  const confirmResume = async () => {
    const record = funding.record;

    if (record === null) {
      return;
    }

    try {
      const reserveLamports = record.feeFundingLamports === null
        ? parseAmount(feeReserve, 9).baseUnits
        : BigInt(record.feeFundingLamports);

      if (reserveLamports <= 0n) {
        throw new Error('invalid amount');
      }

      setInputError(null);
      const preflight = await funding.check({
        amountBaseUnits: BigInt(record.amountBaseUnits),
        collateralLegPending:
          record.depositSignature === null && record.claimSignature === null,
        feeLegPending:
          record.feeFundingDepositSignature === null &&
          record.feeFundingSignature === null,
        feeReserveLamports: reserveLamports,
        mint: record.mint,
      });

      if (preflightError(preflight, record.symbol) !== null) {
        return;
      }
      setConfirmation({
        amountBaseUnits: BigInt(record.amountBaseUnits),
        decimals: 6,
        estimatedNetworkFeeLamports: preflight.estimatedNetworkFeeLamports,
        feeReserveLamports: reserveLamports,
        hasSubmittedTransaction: hasSubmittedTransaction(record),
        mode: 'resume',
        provider: record.provider,
        requiredSolLamports: preflight.requiredSolLamports,
        symbol: record.symbol,
        temporaryRentLamports: preflight.temporaryRentLamports,
      });
    } catch (cause) {
      setInputError(cause instanceof PrivateFundingError
        ? cause.message
        : 'Enter a valid user-funded SOL reserve amount.');
    }
  };

  const submitConfirmation = () => {
    const confirmed = confirmation;
    setConfirmation(null);

    if (confirmed === null) {
      return;
    }

    if (confirmed.mode === 'resume') {
      void funding.resume(
        funding.record?.feeFundingLamports === null
          ? confirmed.feeReserveLamports
          : undefined,
      );
      return;
    }

    const confirmedCollateral = collateralOptions.find(
      (option) => option.symbol === confirmed.symbol,
    );

    if (confirmedCollateral === undefined) {
      setInputError('Collateral configuration is unavailable.');
      return;
    }

    void funding.start(
      confirmed.amountBaseUnits,
      confirmed.feeReserveLamports,
      confirmed.provider,
      confirmedCollateral,
    );
  };

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>
        Add funds
      </Text>
      <Text style={styles.message}>
        Funds move privately from your public wallet into private wallet T.
        Trading allocates provider collateral only when needed.
      </Text>
      {funding.record ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {phaseLabel(funding.record.phase)}
        </Text>
      ) : null}

      {pending === null ? (
        <>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Pay with</Text>
            <Pressable
              accessibilityLabel="Select collateral token"
              accessibilityRole="button"
              accessibilityState={{ expanded: selectorOpen }}
              disabled={funding.isRunning || !tradingReady}
              onPress={() => setSelectorOpen(true)}
              style={({ pressed }) => [
                styles.select,
                pressed && styles.selectPressed,
              ]}
            >
              <View>
                <Text style={styles.selectValue}>{shownSymbol}</Text>
                <Text style={styles.selectDetail}>
                  {collateral ? 'Store in private wallet T' : 'Unavailable'}
                </Text>
              </View>
              <Text accessibilityElementsHidden style={styles.chevron}>
                ⌄
              </Text>
            </Pressable>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{shownSymbol} amount</Text>
            <TextInput
              accessibilityLabel={`${shownSymbol} amount`}
              autoCapitalize="none"
              editable={!funding.isRunning && tradingReady}
              inputMode="decimal"
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={amount}
            />
          </View>
        </>
      ) : null}

      {pending === null || funding.record?.feeFundingLamports === null ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Trading fee reserve · SOL</Text>
          <TextInput
            accessibilityLabel="SOL network fee reserve"
            autoCapitalize="none"
            editable={!funding.isRunning && tradingReady}
            inputMode="decimal"
            onChangeText={setFeeReserve}
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={feeReserve}
          />
        </View>
      ) : null}

      {funding.isRunning ? (
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {runningMessage(funding.record?.phase)}
        </Text>
      ) : null}
      {visibleError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {visibleError}
        </Text>
      ) : null}

      {pending !== null ? (
        <Button
          disabled={!tradingReady || funding.isChecking || balanceMissing}
          label={pendingActionLabel(funding)}
          loading={funding.isRunning || funding.isChecking}
          onPress={confirmResume}
          variant="secondary"
        />
      ) : (
        <Button
          disabled={!tradingReady || collateral === null}
          label={
            funding.record?.phase === 'complete' ? 'Add more funds' : 'Add funds'
          }
          loading={funding.isRunning}
          onPress={confirmStart}
        />
      )}

      <CollateralSelector
        onClose={() => setSelectorOpen(false)}
        onSelect={(option) => {
          setSelectorOpen(false);
          setInputError(null);
          setSelectedSymbol(option.symbol);
        }}
        options={collateralOptions}
        selectedSymbol={selectedSymbol}
        visible={selectorOpen}
      />
      <PrivateFundingConfirmationModal
        confirmation={confirmation}
        onCancel={() => setConfirmation(null)}
        onConfirm={submitConfirmation}
      />
    </View>
  );
}

function hasSubmittedTransaction(record: PrivateFundingRecord): boolean {
  return [
    record.populateSignature,
    record.depositSignature,
    record.relayRequestId,
    record.claimSignature,
    record.feeFundingWrapSignature,
    record.feeFundingPopulateSignature,
    record.feeFundingDepositSignature,
    record.feeFundingRelayRequestId,
    record.feeFundingSignature,
    record.conversionSignature,
    record.providerSetupSignature,
    record.providerDepositSignature,
  ].some((value) => value !== null);
}

function preflightError(
  preflight: PrivateFundingPreflight | null,
  symbol: string,
): string | null {
  if (preflight === null) {
    return null;
  }

  if (preflight.missingCollateralBaseUnits > 0n) {
    return `Insufficient ${symbol}: ${token(preflight.availableCollateralBaseUnits, 6)} available; ${token(preflight.requiredCollateralBaseUnits, 6)} required. Add at least ${token(preflight.missingCollateralBaseUnits, 6)} ${symbol}.`;
  }

  return preflight.missingSolLamports > 0n
    ? `Insufficient SOL: ${token(preflight.availableSolLamports, 9)} available; about ${token(preflight.requiredSolLamports, 9)} required. Add at least ${token(preflight.missingSolLamports, 9)} SOL.`
    : null;
}

function pendingActionLabel(funding: ReturnType<typeof usePrivateFunding>): string {
  if (funding.isRunning) {
    return 'Funding in progress';
  }
  if (funding.isChecking) {
    return 'Checking balances';
  }
  if (funding.preflight?.missingCollateralBaseUnits) {
    return `Add ${token(funding.preflight.missingCollateralBaseUnits, 6)} ${funding.record?.symbol ?? 'collateral'}`;
  }
  if (funding.preflight?.missingSolLamports) {
    return `Add ${token(funding.preflight.missingSolLamports, 9)} SOL`;
  }
  return 'Resume funding';
}

function token(baseUnits: bigint, decimals: 6 | 9): string {
  return formatAmount(amountFromBaseUnits(baseUnits, decimals));
}

function storedError(code: string | null | undefined): string | null {
  return code === null || code === undefined
    ? null
    : `${privateFundingUserMessage(code)} Error reference: ${code}.`;
}

function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'depositing': return 'Preparing private transfer';
    case 'proving': return 'Preparing privacy proof';
    case 'scanning':
    case 'relaying':
    case 'fee-funding':
    case 'collateral-converting':
    case 'provider-setup':
    case 'provider-depositing': return 'Getting trading funds ready';
    case 'complete': return 'Ready to trade';
    default: return 'Ready';
  }
}

function runningMessage(phase: string | undefined): string {
  return phase === 'proving'
    ? 'Setting up private trading. First use can take a few minutes; later transfers reuse the verified local setup.'
    : 'Getting your trading funds ready. You can leave this screen; progress is saved.';
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  title: { ...typography.heading, color: colors.textPrimary },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
  status: { ...typography.label, color: colors.accentSoft },
  field: { gap: spacing.xs },
  fieldLabel: { ...typography.label, color: colors.textSecondary },
  select: {
    minHeight: 58,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectPressed: { opacity: 0.72 },
  selectValue: { ...typography.body, color: colors.textPrimary },
  selectDetail: { ...typography.bodyCompact, color: colors.textSecondary },
  chevron: { ...typography.heading, color: colors.textSecondary },
  input: {
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    ...typography.body,
  },
  error: { ...typography.bodyCompact, color: colors.textSecondary },
});
