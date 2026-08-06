import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig, type PerpsProviderId } from '@/config/appConfig';
import {
  amountFromBaseUnits,
  formatAmount,
  parseAmount,
} from '@/domain/money/amount';
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
    funding.record.feeFundingSignature !== null
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
        `${amount.trim()} ${collateral.symbol} collateral and ${feeReserve.trim()} SOL for provider fees will each move from Privy wallet M through Umbra to private wallet T. Umbra protocol and relayer fees are deducted. M pays the public deposit network fees; PerPal does not sponsor T.`,
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
        Privy wallet M → Umbra pool → private wallet T. Umbra relays both
        claims, including native SOL for T's provider and trade fees.
      </Text>
      <StatusRow label="Collateral" value={shownSymbol} />
      <StatusRow label="Privacy step" value={phaseLabel(funding.record?.phase)} />
      {funding.record?.noteAmountBaseUnits ? (
        <StatusRow
          label="Private note"
          value={`${formatAmount(amountFromBaseUnits(BigInt(funding.record.noteAmountBaseUnits), 6))} ${shownSymbol}`}
        />
      ) : null}
      {funding.record?.relayerFixedFeeLamports ? (
        <StatusRow
          label="Claim network fee"
          value={`${formatAmount(amountFromBaseUnits(BigInt(funding.record.relayerFixedFeeLamports), 9))} SOL · paid by Umbra relayer`}
        />
      ) : null}
      {funding.record?.relayRequestId ? (
        <StatusRow label="Relayer request" value={funding.record.relayRequestId} />
      ) : null}
      {funding.record?.claimSignature ? (
        <StatusRow label="Claim" selectable value={funding.record.claimSignature} />
      ) : null}
      {funding.record?.feeFundingLamports ? (
        <StatusRow
          label="SOL fee reserve"
          value={`${formatAmount(amountFromBaseUnits(BigInt(funding.record.feeFundingLamports), 9))} SOL · funded by you`}
        />
      ) : null}
      {funding.record?.feeFundingNoteAmountLamports ? (
        <StatusRow
          label="Private SOL note"
          value={`${formatAmount(amountFromBaseUnits(BigInt(funding.record.feeFundingNoteAmountLamports), 9))} SOL`}
        />
      ) : null}
      {funding.record?.feeFundingRelayerFixedFeeLamports ? (
        <StatusRow
          label="SOL claim network fee"
          value={`${formatAmount(amountFromBaseUnits(BigInt(funding.record.feeFundingRelayerFixedFeeLamports), 9))} SOL · paid by Umbra relayer`}
        />
      ) : null}
      {funding.record?.feeFundingRelayRequestId ? (
        <StatusRow
          label="SOL relayer request"
          value={funding.record.feeFundingRelayRequestId}
        />
      ) : null}
      {funding.record?.feeFundingSignature ? (
        <StatusRow
          label="SOL claim"
          selectable
          value={funding.record.feeFundingSignature}
        />
      ) : null}

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
          accessibilityLabel="Private SOL fee reserve"
          autoCapitalize="none"
          editable={!funding.isRunning && tradingReady}
          inputMode="decimal"
          onChangeText={setFeeReserve}
          placeholder="SOL fee reserve"
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
          label={funding.isRunning ? 'Private funding in progress' : 'Resume private funding'}
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
    case 'depositing': return 'Deposit approval required';
    case 'scanning': return 'Finding private note';
    case 'proving': return 'Preparing native proof';
    case 'relaying': return 'Gasless claim in progress';
    case 'fee-funding': return 'Privately funding SOL reserve';
    case 'complete': return 'Claimed privately to T';
    default: return 'Ready';
  }
}

function runningMessage(phase: string | undefined): string {
  if (phase === 'proving') {
    return 'Preparing the privacy proof. The first claim downloads and verifies an approximately 60 MB proving asset; later claims use the verified cache.';
  }

  if (phase === 'relaying') {
    return 'Umbra is claiming into T. You can leave this screen; recovery state is saved.';
  }

  if (phase === 'fee-funding') {
    return 'Collateral reached T. The app is privately claiming your SOL reserve into T; no PerPal sponsor or direct M-to-T transfer is used.';
  }

  return 'Private funding is progressing. Each confirmed stage is saved automatically.';
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
