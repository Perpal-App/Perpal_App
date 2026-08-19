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
import type { VelocityAccountSnapshot } from '@/integrations/perps/velocity/velocityAccount';
import {
  submitVelocityTradePreparation,
  type VelocityTradePreparation,
} from '@/integrations/perps/velocity/velocityTrade';
import { prepareVelocityWithdrawal } from '@/integrations/perps/velocity/velocityWithdrawal';
import { reconcilePendingTradeAction } from '@/integrations/perps/tradeActionRecovery';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { colors, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function ProviderFundsPanel(props: {
  readonly onBalancesChanged: () => void;
  readonly onPacificaRefresh: () => void;
  readonly onVelocityRefresh: () => void;
  readonly pacifica: PacificaPortfolioSnapshot | null;
  readonly velocity: VelocityAccountSnapshot | null;
}) {
  const config = readAppConfig();
  const session = useTradingSession();
  const [busy, setBusy] = useState<'pacifica' | 'velocity' | null>(null);
  const [pacificaPending, setPacificaPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pacificaAvailable = config.ok && props.pacifica !== null
    ? availablePacificaReturnBaseUnits(
        parseAmount(props.pacifica.availableToWithdraw, 6).baseUnits,
        config.value.perps.pacificaWithdrawalFeeBaseUnits,
      )
    : null;
  const velocityAvailable = props.velocity?.freeCollateralBaseUnits ?? null;
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
    setBusy('pacifica');
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
        message: `${stable(moved)} USDC is available in private wallet T.`,
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
      if (!abort.signal.aborted) setBusy(null);
    }
  };

  const prepareVelocity = async () => {
    if (!config.ok || session.address === null || session.signer === null ||
      velocityAvailable === null || velocityAvailable <= 0n) return;
    setBusy('velocity');
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    try {
      const recovery = await reconcilePendingTradeAction({
        owner: session.address,
        provider: 'velocity',
        rpcUrl: config.value.api.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
      });
      if (recovery === 'pending') {
        publishInAppNotification({
          kind: 'withdrawal',
          outcome: 'info',
          title: 'Velocity action confirming',
          message: 'The previous signed action is still confirming. It was not submitted again.',
        });
        setBusy(null);
        return;
      }
      const preparation = await prepareVelocityWithdrawal({
        amountBaseUnits: velocityAvailable,
        owner: session.address,
        programId: config.value.perps.velocityProgramId,
        publicRpcUrl: config.value.api.publicRpcUrl,
        rpcUrl: config.value.api.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
        usdtMint: config.value.perps.usdtMint,
      });
      if (!abort.signal.aborted) reviewVelocity(preparation);
    } catch (cause) {
      if (!abort.signal.aborted) publishFailure('Velocity', cause);
      setBusy(null);
    }
  };

  const reviewVelocity = (preparation: VelocityTradePreparation) => {
    if (preparation.kind !== 'velocity' || preparation.plan.action !== 'withdraw') {
      setBusy(null);
      publishFailure('Velocity', new Error('The withdrawal preview was invalid.'));
      return;
    }
    Alert.alert(
      'Move Velocity funds to T?',
      `Amount: ${stable(preparation.plan.amountBaseUnits)} USDT\n` +
        `Network fee: ${sol(preparation.plan.feeLamports)} SOL\n` +
        'Open positions remain untouched. Velocity limits the withdrawal to free collateral.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setBusy(null) },
        { text: 'Confirm and sign', onPress: () => void submitVelocity(preparation) },
      ],
      { cancelable: false },
    );
  };

  const submitVelocity = async (preparation: VelocityTradePreparation) => {
    if (!config.ok || session.address === null || session.signer === null) {
      setBusy(null);
      publishFailure('Velocity', new Error('Private wallet T changed. Review the withdrawal again.'));
      return;
    }
    try {
      const result = await submitVelocityTradePreparation({
        owner: session.address,
        preparation,
        rpcUrl: config.value.api.rpcUrl,
        signer: session.signer,
      });
      publishInAppNotification({
        kind: 'withdrawal',
        outcome: result.status === 'confirmed' ? 'success' : 'info',
        title: result.status === 'confirmed' ? 'Velocity funds moved' : 'Withdrawal submitted',
        message: result.status === 'confirmed'
          ? `${stable(preparation.plan.amountBaseUnits)} USDT is available in private wallet T.`
          : 'Velocity is confirming the withdrawal. It will resume safely.',
      });
      props.onBalancesChanged();
      props.onVelocityRefresh();
    } catch (cause) {
      publishFailure('Velocity', cause);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Move to private wallet T</Text>
      <View style={styles.provider}>
        <StatusRow label="Pacifica USDC" value={token(pacificaAvailable, 'USDC')} />
        <ActionButton
          disabled={!ready || (!pacificaPending &&
            (pacificaAvailable === null || pacificaAvailable <= 0n))}
          label={pacificaPending ? 'Resume Pacifica move' : 'Move from Pacifica'}
          loading={busy === 'pacifica'}
          onPress={() => Alert.alert(
            'Move Pacifica funds to T?',
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
      <View style={styles.provider}>
        <StatusRow label="Velocity USDT" value={token(velocityAvailable, 'USDT')} />
        <ActionButton
          disabled={!ready || velocityAvailable === null || velocityAvailable <= 0n}
          label="Move from Velocity"
          loading={busy === 'velocity'}
          onPress={() => void prepareVelocity()}
          tone="neutral"
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

function sol(value: bigint): string {
  return formatAmount(amountFromBaseUnits(value, 9));
}

function token(value: bigint | null, symbol: string): string {
  return value === null ? 'Loading' : `${stable(value)} ${symbol}`;
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md },
  title: { ...typography.heading, color: colors.textPrimary },
  provider: { gap: spacing.sm },
});
