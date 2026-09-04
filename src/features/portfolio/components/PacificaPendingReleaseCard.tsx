import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { readAppConfig } from '@/config/appConfig';
import { formatTokenAmount } from '@/features/portfolio/components/withdrawalAssets';
import {
  pendingPacificaWithdrawalBaseUnits,
  resumePacificaCollateralWithdrawalToWallet,
  subscribePacificaWithdrawal,
} from '@/integrations/perps/pacifica/pacificaWithdrawal';
import { showAppToast } from '@/storage/appToast';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function PacificaPendingReleaseCard({
  onBalancesChanged,
  onPacificaRefresh,
}: {
  readonly onBalancesChanged: () => void | Promise<void>;
  readonly onPacificaRefresh: () => void | Promise<void>;
}) {
  const config = readAppConfig();
  const session = useTradingSession();
  const [amountBaseUnits, setAmountBaseUnits] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const account = session.address;
    if (account === null) {
      setAmountBaseUnits(null);
      return;
    }
    let active = true;
    const refresh = () => {
      void pendingPacificaWithdrawalBaseUnits(account)
        .then((amount) => {
          if (active) setAmountBaseUnits(amount);
        })
        .catch((cause) => {
          if (!active) return;
          setAmountBaseUnits(null);
          showAppToast({
            outcome: 'error',
            title: 'Release recovery needs attention',
            message: message(cause),
          });
        });
    };
    const unsubscribe = subscribePacificaWithdrawal(account, refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
      controller.current?.abort();
    };
  }, [session.address]);

  if (amountBaseUnits === null) return null;

  const resume = () => {
    Alert.alert(
      'Resume Pacifica release?',
      `Saved request: ${formatTokenAmount(amountBaseUnits, 6)} USDC\n\n` +
      'This resumes the same saved request and waits for Pacifica confirmation. It will not create a different withdrawal.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Resume', onPress: () => void runResume() },
      ],
      { cancelable: false },
    );
  };

  const runResume = async () => {
    if (!config.ok || session.address === null || session.signer === null || loading) {
      showAppToast({
        outcome: 'error',
        title: 'Release unavailable',
        message: 'Private wallet services are still loading.',
      });
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    try {
      await resumePacificaCollateralWithdrawalToWallet({
        account: session.address,
        apiOrigin: config.value.perps.pacificaApiOrigin,
        mint: config.value.perps.usdcMint,
        rpcUrl: config.value.api.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
        withdrawalFeeBaseUnits: config.value.perps.pacificaWithdrawalFeeBaseUnits,
        wsOrigin: config.value.perps.pacificaWsOrigin,
      });
      if (abort.signal.aborted) return;
      setAmountBaseUnits(null);
      await Promise.all([onBalancesChanged(), onPacificaRefresh()]);
      showAppToast({
        outcome: 'success',
        title: 'USDC released',
        message: 'Pacifica confirmed the saved release. Private balances were refreshed.',
      });
    } catch (cause) {
      if (!abort.signal.aborted) {
        await Promise.all([onBalancesChanged(), onPacificaRefresh()]);
        showAppToast({
          outcome: 'error',
          title: 'Release still pending',
          message: message(cause),
        });
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      if (!abort.signal.aborted) setLoading(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.copy}>
        <Text style={styles.title}>Pacifica release pending</Text>
        <Text style={styles.note}>
          Resume the saved request. If USDC is already in the wallet, it remains available.
        </Text>
      </View>
      <ActionButton
        disabled={loading}
        label="Resume"
        loading={loading}
        onPress={resume}
        tone="neutral"
      />
    </View>
  );
}

function message(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : 'The saved release could not be checked. No new request was created.';
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
  },
  copy: { gap: spacing.xxs },
  title: { ...typography.label, color: colors.textPrimary },
  note: { ...typography.bodyCompact, color: colors.textSecondary },
});
