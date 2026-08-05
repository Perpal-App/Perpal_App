import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { amountFromBaseUnits, formatAmount } from '@/domain/money/amount';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { SolanaRpcError } from '@/integrations/api/signedSolanaRpc';
import {
  prepareVelocityAccountInitialization,
  submitVelocityAccountInitialization,
  VelocityInitializationError,
  type VelocityInitializationPlan,
  type VelocityInitializationResult,
} from '@/integrations/perps/velocity/velocityAccountInitialization';
import { TransactionSigningError } from '@/integrations/solana/signedLegacyTransaction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type Phase = 'idle' | 'preparing' | 'prepared' | 'submitting' | 'complete';

export function VelocityInitializationAction({
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
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<VelocityInitializationPlan | null>(null);
  const [result, setResult] = useState<VelocityInitializationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    setPhase('idle');
    setPlan(null);
    setResult(null);
    setError(null);

    return () => controllerRef.current?.abort();
  }, [owner, programId, rpcUrl, signer]);

  const prepare = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase('preparing');
    setPlan(null);
    setError(null);

    try {
      const next = await prepareVelocityAccountInitialization({
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
      'Initialize Velocity account?',
      `This creates the verified mainnet account shown below. Velocity may charge up to ${sol(plan.requiredLamports)} from trading wallet T. No collateral is deposited.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm and sign',
          onPress: () => void submit(plan),
        },
      ],
    );
  };

  const submit = async (currentPlan: VelocityInitializationPlan) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase('submitting');
    setError(null);

    try {
      const next = await submitVelocityAccountInitialization({
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

  if (result !== null) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>
          {result.status === 'confirmed'
            ? 'Velocity account initialized'
            : 'Initialization submitted'}
        </Text>
        <Text selectable style={styles.message}>
          {result.status === 'unknown'
            ? 'The gateway response was interrupted after signing. Do not submit another initialization; the portfolio will reconcile the known transaction signature.'
            : result.status === 'submitted'
              ? 'The transaction was accepted but confirmation is still pending. The portfolio will update when the account appears.'
              : 'The transaction is confirmed. The portfolio will refresh automatically.'}
        </Text>
        <StatusRow label="Signature" selectable value={short(result.signature)} />
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>
        Account setup
      </Text>
      <Text style={styles.message}>
        Prepare an unsigned Velocity transaction first. Perpal verifies every
        instruction and simulates it before enabling the mainnet signature.
      </Text>

      {plan === null ? null : (
        <View style={styles.summary}>
          <StatusRow label="Action" value="Initialize main account" />
          <StatusRow label="Network" value="Solana mainnet" />
          <StatusRow label="Authority" selectable value={short(plan.owner)} />
          <StatusRow label="User account" selectable value={short(plan.userAccount)} />
          <StatusRow label="Wallet SOL" value={sol(plan.balanceLamports)} />
          <StatusRow label="Maximum cost" value={sol(plan.requiredLamports)} />
          <StatusRow
            label="Verification"
            value={
              plan.simulation === 'passed'
                ? 'Decoded and simulated'
                : 'Waiting for SOL funding'
            }
          />
        </View>
      )}

      {plan?.simulation === 'insufficient-balance' ? (
        <View style={styles.notice}>
          <Text accessibilityRole="alert" style={styles.message}>
            Send at least {sol(plan.requiredLamports - plan.balanceLamports)} to
            trading wallet T, then prepare again. This funds account rent and
            network fees only; it does not deposit trading collateral.
          </Text>
          <Button
            label="Copy trading wallet address"
            onPress={() => void Clipboard.setStringAsync(owner)}
            variant="secondary"
          />
        </View>
      ) : null}

      {error === null ? null : (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.error}
        >
          {error}
        </Text>
      )}

      {plan?.simulation === 'passed' ? (
        <Button
          label="Review and initialize"
          loading={phase === 'submitting'}
          onPress={confirm}
        />
      ) : (
        <Button
          label={plan === null ? 'Prepare account setup' : 'Recheck SOL balance'}
          loading={phase === 'preparing'}
          onPress={() => void prepare()}
          variant="secondary"
        />
      )}
    </View>
  );
}

function sol(lamports: bigint): string {
  return `${formatAmount(amountFromBaseUnits(lamports, 9))} SOL`;
}

function short(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function actionError(cause: unknown): string {
  if (
    cause instanceof VelocityInitializationError ||
    cause instanceof SolanaRpcError ||
    cause instanceof TransactionSigningError
  ) {
    return cause.message;
  }

  return 'Velocity account setup could not be prepared. Try again.';
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
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  message: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
  summary: {
    gap: spacing.sm,
  },
  notice: {
    gap: spacing.md,
  },
  error: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
});
