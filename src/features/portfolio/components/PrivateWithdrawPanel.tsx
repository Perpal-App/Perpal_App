import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';

import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig } from '@/config/appConfig';
import { amountFromBaseUnits, formatAmount, parseAmount } from '@/domain/money/amount';
import { pacificaCollateral } from '@/integrations/perps/providerCollateral';
import { usePrivateExit } from '@/integrations/umbra/PrivateExitProvider';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export function PrivateWithdrawPanel() {
  const privateExit = usePrivateExit();
  const [amount, setAmount] = useState('');
  const [destinationMode, setDestinationMode] = useState<'privy' | 'external'>('privy');
  const [externalAddress, setExternalAddress] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const collateral = useMemo(() => {
    const config = readAppConfig();
    return config.ok
      ? pacificaCollateral(config.value.perps.usdcMint)
      : null;
  }, []);
  const pending = privateExit.record !== null && privateExit.record.phase !== 'complete';

  const confirm = () => {
    if (collateral === null) {
      setInputError('Withdrawal configuration is unavailable.');
      return;
    }
    try {
      const parsed = parseAmount(amount, collateral.decimals);
      const destination = destinationMode === 'privy'
        ? privateExit.mainWalletAddress
        : externalAddress.trim();
      if (parsed.baseUnits <= 0n || destination === null) throw new Error('invalid input');
      const validated = new PublicKey(destination).toBase58();
      setInputError(null);
      Alert.alert(
        'Withdraw privately',
        `${amount.trim()} ${collateral.symbol} will move through private wallet T, then privately to ${destinationMode === 'privy' ? 'your public wallet' : 'the external wallet'}. Trading withdrawal fee: ${feeLabel()}. Umbra relayer fees are deducted from the private transfer.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Withdraw',
            onPress: () => void privateExit.start(parsed.baseUnits, validated),
          },
        ],
      );
    } catch {
      setInputError(`Enter a valid ${collateral.symbol} amount and destination.`);
    }
  };

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Withdraw</Text>
      <Text selectable style={styles.note}>
        Closing a trade releases its collateral into your private balance. One
        withdrawal moves the requested USDC through T and privately delivers it
        to your public wallet or another Solana wallet.
      </Text>
      <View style={styles.buttons}>
        <View style={styles.button}>
          <Button
            label="My public wallet"
            onPress={() => setDestinationMode('privy')}
            variant={destinationMode === 'privy' ? 'primary' : 'secondary'}
          />
        </View>
        <View style={styles.button}>
          <Button
            label="Another Solana wallet"
            onPress={() => setDestinationMode('external')}
            variant={destinationMode === 'external' ? 'primary' : 'secondary'}
          />
        </View>
      </View>
      <TextInput
        accessibilityLabel={`${collateral?.symbol ?? 'Collateral'} withdrawal amount`}
        editable={!privateExit.isRunning && !pending}
        inputMode="decimal"
        onChangeText={setAmount}
        placeholder={`0.00 ${collateral?.symbol ?? ''}`}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={amount}
      />
      {destinationMode === 'external' ? (
        <TextInput
          accessibilityLabel="Destination Solana wallet"
          autoCapitalize="none"
          editable={!privateExit.isRunning && !pending}
          onChangeText={setExternalAddress}
          placeholder="Solana wallet address"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={externalAddress}
        />
      ) : null}
      {privateExit.record ? (
        <StatusRow
          label="Status"
          value={exitStatus(privateExit.record.phase)}
        />
      ) : null}
      {privateExit.isRunning ? (
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          Private withdrawal is progressing automatically. Recovery state is saved.
        </Text>
      ) : null}
      {inputError ?? privateExit.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {inputError ?? privateExit.error}
        </Text>
      ) : null}
      {pending ? (
        <Button
          disabled={privateExit.isRunning || privateExit.error === null}
          label={privateExit.error === null ? 'Withdrawal in progress' : 'Retry withdrawal'}
          loading={privateExit.isRunning}
          onPress={() => void privateExit.resume()}
          variant="secondary"
        />
      ) : (
        <Button
          disabled={collateral === null || privateExit.mainWalletAddress === null}
          label="Withdraw privately"
          loading={privateExit.isRunning}
          onPress={confirm}
        />
      )}
    </View>
  );
}

function feeLabel(): string {
  const config = readAppConfig();
  if (!config.ok) return 'unavailable';
  const units = config.value.perps.pacificaWithdrawalFeeBaseUnits;
  return `${formatAmount(amountFromBaseUnits(units, 6))} USDC`;
}

function exitStatus(phase: string): string {
  switch (phase) {
    case 'depositing':
    case 'scanning':
    case 'proving': return 'Preparing private withdrawal';
    case 'relaying': return 'Sending privately';
    case 'complete': return 'Delivered privately';
    default: return 'Ready';
  }
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.md,
  },
  title: { ...typography.heading, color: colors.textPrimary },
  note: { ...typography.bodyCompact, color: colors.textSecondary },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  button: { flex: 1 },
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
  error: { ...typography.bodyCompact, color: colors.negative },
});
