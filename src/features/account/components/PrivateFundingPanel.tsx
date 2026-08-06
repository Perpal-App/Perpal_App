import { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/ui/Button';
import { readAppConfig, type PerpsProviderId } from '@/config/appConfig';
import { parseAmount } from '@/domain/money/amount';
import {
  listTradingCollateralOptions,
  providerCollateral,
  type ProviderCollateral,
} from '@/integrations/perps/providerCollateral';
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
  const [selectorOpen, setSelectorOpen] = useState(false);
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
      ? providerCollateral(provider, config.value.perps.flashProgramId).symbol
      : 'USDC';
  });
  const collateral =
    collateralOptions.find((option) => option.symbol === selectedSymbol) ?? null;
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
      const config = readAppConfig();
      const providerToken = config.ok
        ? providerCollateral(provider, config.value.perps.flashProgramId)
        : null;
      const conversionNotice =
        providerToken !== null && providerToken.mint !== collateral.mint
          ? ` It will convert inside your private wallet to ${providerToken.symbol} with at most 0.5% slippage before funding ${providerLabel(provider)}.`
          : '';
      Alert.alert(
        'Add private trading funds',
        `${amount.trim()} ${collateral.symbol} and ${feeReserve.trim()} SOL for network fees will move privately into your trading wallet.${conversionNotice} Umbra, swap, and network fees apply. Provider setup happens automatically.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Continue',
            onPress: () =>
              void funding.start(
                parsed.baseUnits,
                parsedFeeReserve.baseUnits,
                provider,
                collateral,
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
        Add funds
      </Text>
      <Text style={styles.message}>
        Funds move privately from your public wallet into trading. Provider
        setup happens automatically.
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
                  {collateral ? `Use on ${providerLabel(provider)}` : 'Unavailable'}
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
    </View>
  );
}

function CollateralSelector({
  onClose,
  onSelect,
  options,
  selectedSymbol,
  visible,
}: {
  readonly onClose: () => void;
  readonly onSelect: (option: ProviderCollateral) => void;
  readonly options: readonly ProviderCollateral[];
  readonly selectedSymbol: ProviderCollateral['symbol'];
  readonly visible: boolean;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Close collateral selector"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.selector}>
          <Text accessibilityRole="header" style={styles.title}>
            Select collateral
          </Text>
          {options.map((option) => {
            const selected = option.symbol === selectedSymbol;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={option.mint}
                onPress={() => onSelect(option)}
                style={({ pressed }) => [
                  styles.option,
                  selected && styles.optionSelected,
                  pressed && styles.selectPressed,
                ]}
              >
                <View>
                  <Text style={styles.selectValue}>{option.symbol}</Text>
                  <Text style={styles.selectDetail}>
                    Available for either provider
                  </Text>
                </View>
                <Text style={styles.optionState}>
                  {selected ? 'Selected' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

function providerLabel(provider: PerpsProviderId): string {
  return provider === 'flash' ? 'Flash Trade v2' : 'Velocity';
}

function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'depositing': return 'Waiting for confirmation';
    case 'scanning':
    case 'proving':
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
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  selector: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  option: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionSelected: { borderColor: colors.accent },
  optionState: { ...typography.bodyCompact, color: colors.accentSoft },
});
