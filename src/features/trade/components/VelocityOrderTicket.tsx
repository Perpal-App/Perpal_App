import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import type { AppConfig } from '@/config/appConfig';
import {
  amountFromBaseUnits,
  formatAmount,
  formatAmountWithCommas,
  parseAmount,
} from '@/domain/money/amount';
import {
  Choice,
  CollateralSlider,
  Field,
  PercentPresets,
  StaticControl,
  TicketRow,
} from '@/features/trade/components/OrderTicketControls';
import { PrivateTradingTicketState } from '@/features/trade/components/PrivateTradingTicketState';
import { useTradeActionRecovery } from '@/features/trade/hooks/useTradeActionRecovery';
import { useTradingStablecoinBalances } from '@/features/trade/hooks/useTradingStablecoinBalances';
import { logTradeError } from '@/integrations/observability/tradeError';
import { reconcilePendingTradeAction } from '@/integrations/perps/tradeActionRecovery';
import {
  prepareVelocityTrade,
  submitVelocityTradePreparation,
  type VelocitySide,
  type VelocityTradePreparation,
} from '@/integrations/perps/velocity/velocityTrade';
import type {
  VelocityMarket,
  VelocityMarketSnapshot,
} from '@/integrations/perps/velocity/velocityMarketData';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { colors, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type Phase = 'idle' | 'preparing' | 'submitting' | 'pending';

export function VelocityOrderTicket({
  config,
  market,
  snapshot,
}: {
  readonly config: AppConfig;
  readonly market: VelocityMarket;
  readonly snapshot: VelocityMarketSnapshot;
}) {
  const session = useTradingSession();
  const [side, setSide] = useState<VelocitySide>('long');
  const [collateral, setCollateral] = useState('');
  const [leverage, setLeverage] = useState(String(Math.min(5, market.maxLeverage)));
  const [phase, setPhase] = useState<Phase>('idle');
  const [preparation, setPreparation] = useState<VelocityTradePreparation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [presetPercent, setPresetPercent] = useState<number | null>(null);
  const [sliderReset, setSliderReset] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const recovery = useTradeActionRecovery({
    owner: session.address,
    provider: 'velocity',
    rpcUrl: config.api.rpcUrl,
    signer: session.signer,
  });
  const balances = useTradingStablecoinBalances({
    owner: session.address,
    rpcUrl: config.api.rpcUrl,
    signer: session.signer,
    usdcMint: config.perps.usdcMint,
    usdtMint: config.perps.usdtMint,
  });

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    controller.current?.abort();
    setCollateral('');
    setLeverage(String(Math.min(5, market.maxLeverage)));
    setPreparation(null);
    setMessage(null);
    setPresetPercent(null);
    setSliderReset((value) => value + 1);
    setPhase('idle');
  }, [market.marketIndex, market.maxLeverage]);

  if (session.status !== 'ready' || session.address === null || session.signer === null) {
    return (
      <PrivateTradingTicketState
        baseAsset={market.baseAsset}
        onRetry={session.retryRestore}
        status={session.status}
      />
    );
  }
  const owner = session.address;
  const signer = session.signer;
  const clearPreview = () => {
    setPreparation(null);
    setMessage(null);
  };
  const applyPercentage = (next: number) => {
    const available = balances.balances?.usdtBaseUnits;
    if (available === undefined) return;
    const percent = Math.max(0, Math.min(100, Math.round(next)));
    setCollateral(stable((available * BigInt(percent)) / 100n));
    clearPreview();
  };

  const prepare = async () => {
    let collateralBaseUnits: bigint;
    const leverageValue = Number(leverage);
    try {
      collateralBaseUnits = parseAmount(collateral, 6).baseUnits;
      if (collateralBaseUnits <= 0n) throw new Error('Enter collateral greater than zero.');
      if (!Number.isSafeInteger(leverageValue) || leverageValue < 1 || leverageValue > market.maxLeverage) {
        throw new Error(`Leverage must be between 1× and ${market.maxLeverage}×.`);
      }
    } catch (cause) {
      setMessage(userMessage(cause));
      return;
    }

    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setPhase('preparing');
    setPreparation(null);
    setMessage(null);
    try {
      const [velocityStatus, walletStatus] = await Promise.all([
        recovery.reconcile(abort.signal),
        reconcilePendingTradeAction({
          owner,
          provider: 'wallet',
          rpcUrl: config.api.rpcUrl,
          signal: abort.signal,
          signer,
        }),
      ]);
      if (velocityStatus === 'pending' || walletStatus === 'pending') {
        setPhase('pending');
        setMessage('A previous transaction is still confirming.');
        return;
      }
      const next = await prepareVelocityTrade({
        collateralBaseUnits,
        leverage: leverageValue,
        marketIndex: market.marketIndex,
        owner,
        programId: config.perps.velocityProgramId,
        publicRpcUrl: config.api.publicRpcUrl,
        rpcUrl: config.api.rpcUrl,
        signal: abort.signal,
        side,
        signer,
        swapBuildUrl: config.api.swapBuildUrl,
        usdcMint: config.perps.usdcMint,
        usdtMint: config.perps.usdtMint,
      });
      if (!abort.signal.aborted) {
        setPreparation(next);
        setPhase('idle');
      }
    } catch (cause) {
      if (!abort.signal.aborted) {
        logTradeError('velocity', 'preparation', cause);
        setMessage(userMessage(cause));
        setPhase('idle');
      }
    }
  };

  const submit = async (reviewed: VelocityTradePreparation) => {
    setPhase('submitting');
    setMessage(null);
    try {
      const result = await submitVelocityTradePreparation({
        owner,
        preparation: reviewed,
        rpcUrl: config.api.rpcUrl,
        signer,
      });
      if (result.status !== 'confirmed') {
        setPreparation(null);
        setPhase('pending');
        setMessage('Transaction submitted and confirming.');
        return;
      }

      const finalOrder = reviewed.kind === 'velocity' && reviewed.plan.action === 'trade';
      setPreparation(null);
      setPhase('idle');
      setMessage(finalOrder
        ? 'Order confirmed.'
        : 'Preparation confirmed. Review the order again when the balance refreshes.');
      publishInAppNotification({
        kind: finalOrder ? 'trade' : 'funding',
        outcome: 'success',
        title: finalOrder ? 'Velocity order confirmed' : 'Trading funds ready',
        message: finalOrder
          ? `${side === 'long' ? 'Long' : 'Short'} ${market.baseAsset} order confirmed.`
          : 'The confirmed balance is ready for the next reviewed step.',
      });
    } catch (cause) {
      logTradeError('velocity', 'submission', cause);
      setPhase('idle');
      setMessage(userMessage(cause));
    }
  };

  const confirm = () => {
    if (preparation === null) return;
    const summary = reviewSummary(preparation, side, market.baseAsset, collateral, leverage);
    Alert.alert(summary.title, summary.body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm and sign', onPress: () => void submit(preparation) },
    ]);
  };

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Order</Text>
      <View style={styles.controls}>
        <StaticControl accessibilityLabel="Margin mode Cross" label="Cross" />
        <Field
          accessibilityLabel="Leverage"
          align="center"
          onChangeText={(value) => {
            setLeverage(value.replace(/\D/gu, ''));
            clearPreview();
          }}
          suffix="×"
          value={leverage}
        />
      </View>
      <StaticControl accessibilityLabel="Order type Market" label="Market" />
      <View accessibilityRole="radiogroup" style={styles.controls}>
        <Choice
          accessibilityLabel={`Buy ${market.baseAsset}`}
          label={`Buy ${market.baseAsset}`}
          onPress={() => { setSide('long'); clearPreview(); }}
          selected={side === 'long'}
          tone="long"
        />
        <Choice
          accessibilityLabel={`Sell ${market.baseAsset}`}
          label={`Sell ${market.baseAsset}`}
          onPress={() => { setSide('short'); clearPreview(); }}
          selected={side === 'short'}
          tone="short"
        />
      </View>
      <Field
        accessibilityLabel="Collateral amount"
        onChangeText={(value) => {
          setCollateral(value);
          setPresetPercent(null);
          setSliderReset((current) => current + 1);
          clearPreview();
        }}
        placeholder="Collateral"
        suffix="USDT"
        value={collateral}
      />
      <CollateralSlider
        onChange={(next) => { applyPercentage(next); setPresetPercent(null); }}
        resetSignal={sliderReset}
      />
      <PercentPresets
        onSelect={(next) => {
          applyPercentage(next);
          setPresetPercent(next);
          setSliderReset((current) => current + 1);
        }}
        selected={presetPercent}
      />
      {preparation === null ? null : <PreparationRows preparation={preparation} />}
      {recovery.error ?? message ? (
        <Text accessibilityLiveRegion="polite" selectable style={styles.message}>
          {recovery.error ?? message}
        </Text>
      ) : null}
      <ActionButton
        disabled={phase === 'pending'}
        label={preparation === null ? `Review ${side}` : 'Confirm transaction'}
        loading={phase === 'preparing' || phase === 'submitting'}
        onPress={preparation === null ? () => void prepare() : confirm}
        tone={side === 'long' ? 'positive' : 'negative'}
      />
      <View style={styles.riskRows}>
        <TicketRow label="Type" screenReaderLabel="Order type" value="Market" />
        <TicketRow label="Oracle" value={`$${formatAmountWithCommas(snapshot.oraclePrice)}`} />
        <TicketRow label="Order value" value={orderValue(collateral, leverage)} />
        <TicketRow label="Margin" value={stableInput(collateral)} />
        <TicketRow label="Min. size" value={`${market.minOrderSize} ${market.baseAsset}`} />
        <TicketRow label="Private USDT" value={balances.balances === null ? 'Loading' : `${stable(balances.balances.usdtBaseUnits)} USDT`} />
        <TicketRow label="Private USDC" value={balances.balances === null ? 'Loading' : `${stable(balances.balances.usdcBaseUnits)} USDC`} />
      </View>
    </View>
  );
}

function PreparationRows({ preparation }: { readonly preparation: VelocityTradePreparation }) {
  if (preparation.kind === 'conversion') {
    return (
      <>
        <TicketRow label="Swap" screenReaderLabel="Required swap" value={`${stable(preparation.plan.amountBaseUnits)} USDC → USDT`} />
        <TicketRow label="Min. received" value={`${stable(preparation.plan.swap.minimumOutputBaseUnits)} USDT`} />
        <TicketRow label="Network fee" value={sol(preparation.plan.swap.feeLamports)} />
      </>
    );
  }
  return (
    <>
      <TicketRow label="Next step" value={preparation.plan.action === 'trade' ? 'Place order' : 'Fund margin'} />
      <TicketRow label="Network fee" value={sol(preparation.plan.feeLamports)} />
    </>
  );
}

function reviewSummary(
  preparation: VelocityTradePreparation,
  side: VelocitySide,
  asset: string,
  collateral: string,
  leverage: string,
): { readonly title: string; readonly body: string } {
  if (preparation.kind === 'conversion') {
    return {
      title: 'Swap private USDC to USDT?',
      body: `Spend: ${stable(preparation.plan.amountBaseUnits)} USDC\n` +
        `Receive at least: ${stable(preparation.plan.swap.minimumOutputBaseUnits)} USDT\n` +
        `Network fee: ${sol(preparation.plan.swap.feeLamports)}\nMaximum slippage: 0.5%`,
    };
  }
  if (preparation.plan.action !== 'trade') {
    return {
      title: 'Make collateral available?',
      body: `Amount: ${stable(preparation.plan.amountBaseUnits)} USDT\n` +
        `Destination: Velocity trading margin\nNetwork fee: ${sol(preparation.plan.feeLamports)}`,
    };
  }
  return {
    title: `Review ${side} ${asset}`,
    body: `Collateral: ${collateral} USDT\nLeverage: ${leverage}×\n` +
      `Order type: Market\nNetwork fee: ${sol(preparation.plan.feeLamports)}`,
  };
}

function stable(value: bigint): string {
  return formatAmount(amountFromBaseUnits(value, 6));
}

function sol(value: bigint): string {
  return `${formatAmount(amountFromBaseUnits(value, 9))} SOL`;
}

function stableInput(value: string): string {
  try {
    return `${stable(parseAmount(value, 6).baseUnits)} USDT`;
  } catch {
    return '--';
  }
}

function orderValue(collateral: string, leverage: string): string {
  const multiplier = Number(leverage);
  if (!Number.isSafeInteger(multiplier) || multiplier < 1) return '--';
  try {
    return `${stable(parseAmount(collateral, 6).baseUnits * BigInt(multiplier))} USDT`;
  } catch {
    return '--';
  }
}

function userMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The transaction could not be prepared.';
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  title: { ...typography.heading, color: colors.textPrimary },
  controls: { flexDirection: 'row', gap: spacing.xs },
  riskRows: {
    gap: spacing.xxs,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
});
