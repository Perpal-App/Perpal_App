import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { amountFromBaseUnits, formatAmount } from '@/domain/money/amount';
import {
  tradeCollateralStepCanSubmit,
  type TradeCollateralStep,
} from '@/integrations/perps/tradeCollateral';
import { colors, spacing, typography } from '@/theme/tokens';

export function TradeCollateralStepView({
  loading,
  onConfirm,
  step,
}: {
  readonly loading: boolean;
  readonly onConfirm: () => void;
  readonly step: TradeCollateralStep;
}) {
  const rows = summary(step);
  const canSubmit = tradeCollateralStepCanSubmit(step);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>Trade preparation</Text>
      {rows.map(([label, value]) => <StatusRow key={label} label={label} value={value} />)}
      {!canSubmit ? (
        <Text accessibilityRole="alert" style={styles.message}>{blockedMessage(step)}</Text>
      ) : null}
      <Button
        disabled={!canSubmit}
        label="Review trade preparation"
        loading={loading}
        onPress={() => Alert.alert(
          'Confirm trade preparation?',
          `${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\nThis does not place the order. You will review the final order separately.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Confirm and sign', onPress: onConfirm },
          ],
        )}
      />
    </View>
  );
}

function summary(step: TradeCollateralStep): readonly (readonly [string, string])[] {
  if (step.kind === 'conversion') {
    return [
      ['Action', `Convert ${step.input.symbol} to ${step.output.symbol}`],
      ['Spend', token(step.inputAmountBaseUnits, step.input.symbol)],
      ['Receive at least', token(step.plan.minimumOutputBaseUnits, step.output.symbol)],
      ['Maximum slippage', '0.5%'],
    ];
  }
  return [
    ['Action', 'Deposit collateral to Pacifica'],
    ['Collateral', token(step.plan.amountBaseUnits, 'USDC')],
    ['Network fee', sol(step.plan.feeLamports)],
    ['T wallet SOL', sol(step.plan.solBalanceLamports)],
  ];
}

function blockedMessage(step: TradeCollateralStep): string {
  if (step.kind === 'pacifica-deposit') {
    if (step.plan.simulation === 'insufficient-token') {
      return `Pacifica funding requires ${token(step.plan.amountBaseUnits, 'USDC')}. ` +
        `Private balance has ${token(step.plan.tokenBalanceBaseUnits, 'USDC')}.`;
    }
    return `Minimum network fee still needed: ${sol(step.plan.feeLamports - step.plan.solBalanceLamports)}.`;
  }
  return `Conversion requires ${token(step.inputAmountBaseUnits, step.input.symbol)}. ` +
    `Private balance has ${token(step.sourceBalanceBaseUnits, step.input.symbol)}.`;
}

function token(value: bigint, symbol: string): string {
  return `${formatAmount(amountFromBaseUnits(value, 6))} ${symbol}`;
}

function sol(value: bigint): string {
  return `${formatAmount(amountFromBaseUnits(value > 0n ? value : 0n, 9))} SOL`;
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  title: { ...typography.heading, color: colors.textPrimary },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
});
