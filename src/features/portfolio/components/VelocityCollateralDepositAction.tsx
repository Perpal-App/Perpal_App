import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import {
  AmountError,
  amountFromBaseUnits,
  formatAmount,
  parseAmount,
} from '@/domain/money/amount';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { SolanaRpcError } from '@/integrations/api/signedSolanaRpc';
import {
  prepareVelocityCollateralDeposit,
  submitVelocityCollateralDeposit,
  VelocityCollateralDepositError,
  type VelocityCollateralDepositPlan,
  type VelocityCollateralDepositResult,
} from '@/integrations/perps/velocity/velocityCollateralDeposit';
import { TransactionSigningError } from '@/integrations/solana/signedLegacyTransaction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type Phase = 'idle' | 'preparing' | 'prepared' | 'submitting' | 'complete';

export function VelocityCollateralDepositAction({
  owner,
  programId,
  rpcUrl,
  signer,
}: {
  readonly owner: string;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
}) {
  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<VelocityCollateralDepositPlan | null>(null);
  const [result, setResult] = useState<VelocityCollateralDepositResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    setAmount('');
    setPhase('idle');
    setPlan(null);
    setResult(null);
    setError(null);

    return () => controllerRef.current?.abort();
  }, [owner, programId, rpcUrl, signer]);

  const changeAmount = (value: string) => {
    setAmount(value);
    setPlan(null);
    setResult(null);
    setError(null);
    setPhase('idle');
  };

  const prepare = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase('preparing');
    setPlan(null);
    setResult(null);
    setError(null);

    try {
      const amountBaseUnits = parseAmount(amount, 6).baseUnits;
      const next = await prepareVelocityCollateralDeposit({
        amountBaseUnits,
        owner,
        programId,
        rpcUrl,
        signer,
        signal: controller.signal,
      });

      if (!controller.signal.aborted) {
        setPlan(next);
        setPhase('prepared');
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(actionError(cause));
        setPhase('idle');
      }
    }
  };

  const confirm = () => {
    if (plan === null || phase !== 'prepared') {
      return;
    }

    Alert.alert(
      'Deposit USDT to Velocity?',
      `Deposit ${usdt(plan.amountBaseUnits)} from trading wallet T to the verified Velocity mainnet account. Network fee: up to ${sol(plan.feeLamports)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm and sign',
          onPress: () => void submit(plan),
        },
      ],
    );
  };

  const submit = async (currentPlan: VelocityCollateralDepositPlan) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase('submitting');
    setError(null);

    try {
      const next = await submitVelocityCollateralDeposit({
        amountBaseUnits: currentPlan.amountBaseUnits,
        owner,
        programId,
        rpcUrl,
        signer,
        plan: currentPlan,
        signal: controller.signal,
      });

      if (!controller.signal.aborted) {
        setResult(next);
        setPhase('complete');
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(actionError(cause));
        setPlan(null);
        setPhase('idle');
      }
    }
  };

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>
        Deposit collateral
      </Text>
      <Text style={styles.message}>
        Velocity mainnet uses USDT. The app verifies and simulates the exact
        deposit before trading wallet T signs it.
      </Text>

      <TextInput
        accessibilityLabel="USDT deposit amount"
        autoCorrect={false}
        editable={phase !== 'preparing' && phase !== 'submitting'}
        inputMode="decimal"
        keyboardType="decimal-pad"
        onChangeText={changeAmount}
        placeholder="0.00 USDT"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={amount}
      />

      {plan === null ? null : (
        <View style={styles.summary}>
          <StatusRow label="Action" value="Deposit to Velocity" />
          <StatusRow label="Network" value="Solana mainnet" />
          <StatusRow label="Amount" value={usdt(plan.amountBaseUnits)} />
          <StatusRow label="Wallet USDT" value={usdt(plan.tokenBalanceBaseUnits)} />
          <StatusRow label="Network fee" value={sol(plan.feeLamports)} />
          <StatusRow
            label="Verification"
            value={
              plan.simulation === 'passed'
                ? 'Decoded and simulated'
                : plan.simulation === 'insufficient-usdt'
                  ? 'Waiting for USDT'
                  : 'Waiting for SOL'
            }
          />
        </View>
      )}

      {plan !== null && plan.simulation !== 'passed' ? (
        <View style={styles.notice}>
          <Text accessibilityRole="alert" style={styles.message}>
            {plan.simulation === 'insufficient-usdt'
              ? `Send ${usdt(plan.amountBaseUnits - plan.tokenBalanceBaseUnits)} to trading wallet T, then prepare again.`
              : `Send at least ${sol(plan.feeLamports - plan.solBalanceLamports)} to trading wallet T for the network fee, then prepare again.`}
          </Text>
          <Button
            label="Copy trading wallet address"
            onPress={() => void Clipboard.setStringAsync(owner)}
            variant="secondary"
          />
        </View>
      ) : null}

      {result === null ? null : (
        <View accessibilityLiveRegion="polite" style={styles.notice}>
          <Text style={styles.message}>
            {result.status === 'confirmed'
              ? 'Deposit confirmed. Portfolio balances will refresh automatically.'
              : result.status === 'submitted'
                ? 'Deposit submitted and awaiting confirmation. Do not submit it again.'
                : 'The response was interrupted after signing. Do not submit it again; the known signature will be reconciled.'}
          </Text>
          <StatusRow label="Signature" selectable value={short(result.signature)} />
        </View>
      )}

      {error === null ? null : (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}

      {plan?.simulation === 'passed' ? (
        <Button
          label="Review deposit"
          loading={phase === 'submitting'}
          onPress={confirm}
        />
      ) : result === null ? (
        <Button
          label={plan === null ? 'Prepare deposit' : 'Recheck wallet balances'}
          loading={phase === 'preparing'}
          onPress={() => void prepare()}
          variant="secondary"
        />
      ) : null}
    </View>
  );
}

function usdt(baseUnits: bigint): string {
  return `${formatAmount(amountFromBaseUnits(baseUnits, 6))} USDT`;
}

function sol(lamports: bigint): string {
  return `${formatAmount(amountFromBaseUnits(lamports, 9))} SOL`;
}

function short(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function actionError(cause: unknown): string {
  if (
    cause instanceof AmountError ||
    cause instanceof VelocityCollateralDepositError ||
    cause instanceof SolanaRpcError ||
    cause instanceof TransactionSigningError
  ) {
    return cause.message;
  }

  return 'The Velocity collateral deposit could not be prepared.';
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
    ...typography.heading,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  summary: { gap: spacing.sm },
  notice: { gap: spacing.md },
  error: { ...typography.bodyCompact, color: colors.textSecondary },
});
