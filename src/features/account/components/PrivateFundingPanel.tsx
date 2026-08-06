import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig, type PerpsProviderId } from '@/config/appConfig';
import { parseAmount } from '@/domain/money/amount';
import { providerCollateral } from '@/integrations/perps/providerCollateral';
import { usePrivateFunding } from '@/integrations/umbra/PrivateFundingProvider';
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
  const collateral = useMemo(() => {
    const config = readAppConfig();
    return config.ok
      ? providerCollateral(provider, config.value.perps.flashProgramId)
      : null;
  }, [provider]);
  const pending =
    funding.record?.phase === 'complete' &&
    funding.record.providerDepositSignature !== null
      ? null
      : funding.record;
  const shownSymbol = pending?.symbol ?? collateral?.symbol ?? 'collateral';

  const confirmStart = () => {
    if (collateral === null) {
      setInputError('Provider collateral configuration is unavailable.');
      return;
    }

    try {
      const parsed = parseAmount(amount, collateral.decimals);
      const parsedFeeReserve = parseAmount(feeReserve, 9);

      if (parsed.baseUnits <= 0n || parsedFeeReserve.baseUnits <= 0n) {
        throw new Error('invalid amount');
      }

      setInputError(null);
      Alert.alert(
        'Add private trading funds',
        `${amount.trim()} ${collateral.symbol} and ${feeReserve.trim()} SOL for network fees will move privately into your trading wallet. Umbra and network fees apply. Provider setup happens automatically.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Continue',
            onPress: () =>
              void funding.start(
                parsed.baseUnits,
                parsedFeeReserve.baseUnits,
                provider,
              ),
          },
        ],
      );
    } catch {
      setInputError(
        `Enter valid ${shownSymbol} collateral and SOL reserve amounts.`,
      );
    }
  };

  const confirmResume = () => {
    if (
      funding.record !== null &&
      funding.record.feeFundingLamports !== null
    ) {
      void funding.resume();
      return;
    }

    try {
      const parsed = parseAmount(feeReserve, 9);

      if (parsed.baseUnits <= 0n) {
        throw new Error('invalid amount');
      }

      setInputError(null);
      void funding.resume(parsed.baseUnits);
    } catch {
      setInputError('Enter a valid user-funded SOL reserve amount.');
    }
  };

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>
        Add private trading funds
      </Text>
      <Text style={styles.message}>
        Enter collateral and a SOL network-fee reserve once. Perpal privately
        funds trading and prepares the selected provider automatically.
      </Text>
      <StatusRow label="Collateral" value={shownSymbol} />
      <StatusRow label="Status" value={phaseLabel(funding.record?.phase)} />

      {pending === null ? (
        <TextInput
          accessibilityLabel={`${shownSymbol} amount`}
          autoCapitalize="none"
          editable={!funding.isRunning && tradingReady}
          inputMode="decimal"
          onChangeText={setAmount}
          placeholder={`0.00 ${shownSymbol}`}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={amount}
        />
      ) : null}

      {pending === null || funding.record?.feeFundingLamports === null ? (
        <TextInput
          accessibilityLabel="SOL network fee reserve"
          autoCapitalize="none"
          editable={!funding.isRunning && tradingReady}
          inputMode="decimal"
          onChangeText={setFeeReserve}
          placeholder="SOL for network fees"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={feeReserve}
        />
      ) : null}

      {funding.isRunning ? (
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {runningMessage(funding.record?.phase)}
        </Text>
      ) : null}
      {inputError ?? funding.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {inputError ?? funding.error}
        </Text>
      ) : null}

      {pending !== null ? (
        <Button
          disabled={!tradingReady}
          label={funding.isRunning ? 'Funding in progress' : 'Continue funding'}
          loading={funding.isRunning}
          onPress={confirmResume}
          variant="secondary"
        />
      ) : (
        <Button
          disabled={!tradingReady || collateral === null}
          label={funding.record?.phase === 'complete' ? 'Add more private funds' : 'Add private funds'}
          loading={funding.isRunning}
          onPress={confirmStart}
        />
      )}
    </View>
  );
}

function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'depositing': return 'Waiting for confirmation';
    case 'scanning':
    case 'proving':
    case 'relaying':
    case 'fee-funding':
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
