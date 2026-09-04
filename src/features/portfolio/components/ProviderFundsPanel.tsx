import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig } from '@/config/appConfig';
import { amountFromBaseUnits, formatAmount, parseAmount } from '@/domain/money/amount';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  availablePacificaReturnBaseUnits,
  hasPendingPacificaWithdrawal,
  resumePacificaCollateralWithdrawalToWallet,
  withdrawPacificaCollateralToWallet,
} from '@/integrations/perps/pacifica/pacificaWithdrawal';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { colors, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function ProviderFundsPanel(props: {
  readonly onBalancesChanged: () => void;
  readonly onPacificaRefresh: () => void;
  readonly pacifica: PacificaPortfolioSnapshot | null;
}) {
  const config = readAppConfig();
  const session = useTradingSession();
  const [busy, setBusy] = useState(false);
  const [pacificaPending, setPacificaPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pacificaAvailable = config.ok && props.pacifica !== null
    ? availablePacificaReturnBaseUnits(
        parseAmount(props.pacifica.availableToWithdraw, 6).baseUnits,
        config.value.perps.pacificaWithdrawalFeeBaseUnits,
      )
    : null;
  const ready = config.ok && session.address !== null && session.signer !== null;

  useEffect(() => {
    let active = true;
    if (session.address === null) {
      setPacificaPending(false);
      return undefined;
    }
    void hasPendingPacificaWithdrawal(session.address)
      .then((pending) => { if (active) setPacificaPending(pending); })
      .catch((cause) => {
        if (active) {
          setPacificaPending(false);
          publishFailure('Pacifica', cause);
        }
      });
    return () => { active = false; };
  }, [session.address]);

  const movePacifica = async () => {
    if (!config.ok || session.address === null || session.signer === null ||
      (!pacificaPending && (pacificaAvailable === null || pacificaAvailable <= 0n))) return;
    setBusy(true);
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    try {
      const withdrawalInput = {
        account: session.address,
        apiOrigin: config.value.perps.pacificaApiOrigin,
        mint: config.value.perps.usdcMint,
        rpcUrl: config.value.api.rpcUrl,
        signer: session.signer,
        signal: abort.signal,
        withdrawalFeeBaseUnits: config.value.perps.pacificaWithdrawalFeeBaseUnits,
      };
      let moved: bigint;
      if (pacificaPending) {
        moved = await resumePacificaCollateralWithdrawalToWallet(withdrawalInput);
      } else {
        if (pacificaAvailable === null) return;
        await withdrawPacificaCollateralToWallet(pacificaAvailable, withdrawalInput);
        moved = pacificaAvailable;
      }
      setPacificaPending(false);
      props.onBalancesChanged();
      props.onPacificaRefresh();
      publishInAppNotification({
        kind: 'withdrawal', outcome: 'success', title: 'Pacifica funds moved',
        message: `${stable(moved)} USDC returned to your private balance.`,
      });
    } catch (cause) {
      if (!abort.signal.aborted) {
        try {
          setPacificaPending(await hasPendingPacificaWithdrawal(session.address));
        } catch {
          setPacificaPending(false);
        }
        publishFailure('Pacifica', cause);
      }
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Return provider funds</Text>
      <View style={styles.provider}>
        <StatusRow label="Pacifica USDC" value={token(pacificaAvailable, 'USDC')} />
        <ActionButton
          disabled={!ready || (!pacificaPending &&
            (pacificaAvailable === null || pacificaAvailable <= 0n))}
          label={pacificaPending ? 'Resume Pacifica return' : 'Return from Pacifica'}
          loading={busy}
          onPress={() => Alert.alert(
            'Return Pacifica funds?',
            pacificaPending
              ? 'Resume the existing withdrawal without submitting another request.'
              : `${token(pacificaAvailable, 'USDC')} will be moved after the configured venue fee.`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Confirm', onPress: () => void movePacifica() },
            ],
          )}
        />
      </View>
    </View>
  );
}

function publishFailure(provider: string, cause: unknown): void {
  publishInAppNotification({
    kind: 'withdrawal', outcome: 'error', title: `${provider} withdrawal failed`,
    message: cause instanceof Error ? cause.message : 'The funds remain in the provider account.',
  });
}

function stable(value: bigint): string {
  return formatAmount(amountFromBaseUnits(value, 6));
}

function token(value: bigint | null, symbol: string): string {
  return value === null ? 'Loading' : `${stable(value)} ${symbol}`;
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md },
  title: { ...typography.heading, color: colors.textPrimary },
  provider: { gap: spacing.sm },
});
