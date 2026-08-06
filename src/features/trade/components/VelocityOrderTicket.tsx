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
import type { MainnetMarket } from '@/integrations/perps/markets/mainnetCatalog';
import {
  prepareVelocityMarketOrder,
  submitVelocityMarketOrder,
  VelocityMarketOrderError,
  type VelocityMarketOrderPlan,
} from '@/integrations/perps/velocity/velocityMarketOrder';
import type { VelocityMarketSnapshot } from '@/integrations/perps/velocity/velocityMarketData';
import type { VelocityOrderSide } from '@/integrations/perps/velocity/velocityMarketOrderTransaction';
import { SolanaRpcError } from '@/integrations/api/signedSolanaRpc';
import {
  TransactionSigningError,
  type SubmittedTransactionResult,
} from '@/integrations/solana/signedLegacyTransaction';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type Phase = 'idle' | 'preparing' | 'prepared' | 'submitting' | 'complete';

export function VelocityOrderTicket({
  market,
  venue,
  marketDataUrl,
  programId,
  rpcUrl,
}: {
  readonly market: MainnetMarket;
  readonly venue: VelocityMarketSnapshot;
  readonly marketDataUrl: string;
  readonly programId: string;
  readonly rpcUrl: string;
}) {
  const session = useTradingSession();
  const [side, setSide] = useState<VelocityOrderSide>('long');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [size, setSize] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<VelocityMarketOrderPlan | null>(null);
  const [result, setResult] = useState<SubmittedTransactionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    setSize('');
    setReduceOnly(false);
    setPhase('idle');
    setPlan(null);
    setResult(null);
    setError(null);

    return () => controllerRef.current?.abort();
  }, [market.symbol, session.address]);

  const resetQuote = () => {
    controllerRef.current?.abort();
    setPlan(null);
    setResult(null);
    setError(null);
    setPhase('idle');
  };

  const prepare = async () => {
    if (session.address === null || session.signer === null) {
      setError('Activate private trading before preparing an order.');
      return;
    }

    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setPhase('preparing');
    setPlan(null);
    setResult(null);
    setError(null);

    try {
      const next = await prepareVelocityMarketOrder({
        baseAssetAmount: parseAmount(size, 9).baseUnits,
        marketDataUrl,
        owner: session.address,
        programId,
        reduceOnly,
        rpcUrl,
        side,
        signer: session.signer,
        symbol: market.symbol,
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
      `Confirm ${plan.side} ${plan.symbol}?`,
      `${plan.reduceOnly ? 'Reduce-only ' : ''}${capitalize(plan.side)} ${base(plan.baseAssetAmount)} at an estimated ${usd(plan.estimatedEntryPrice)}. Maximum execution price ${usd(plan.limitPrice)}, initial margin ${usdt(plan.requiredMarginBaseUnits)}, fee up to ${usdt(plan.takerFeeBaseUnits)}, liquidation ${liquidation(plan)}.${plan.closesPosition ? ' Closed-position proceeds will be collected automatically.' : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm and sign', onPress: () => void submit(plan, performance.now()) },
      ],
    );
  };

  const submit = async (
    currentPlan: VelocityMarketOrderPlan,
    intentStartedAtMs: number,
  ) => {
    if (session.address === null || session.signer === null) {
      setError('Your private trading wallet became unavailable before signing.');
      setPlan(null);
      setPhase('idle');
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase('submitting');
    setError(null);

    try {
      const next = await submitVelocityMarketOrder({
        baseAssetAmount: currentPlan.baseAssetAmount,
        marketDataUrl,
        intentStartedAtMs,
        owner: session.address,
        programId,
        reduceOnly: currentPlan.reduceOnly,
        rpcUrl,
        side: currentPlan.side,
        signer: session.signer,
        symbol: currentPlan.symbol,
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

  if (session.status !== 'ready' || session.address === null || session.signer === null) {
    return (
      <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>Trade {market.symbol}</Text>
        <Text style={styles.message}>
          Market data stays public. Activate private trading once before preparing an order.
        </Text>
        {session.status === 'inactive' ? (
          <Button label="Activate private trading" onPress={() => void session.activate()} />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Trade {market.symbol}</Text>
      <View style={styles.sideButtons}>
        <View style={styles.sideButton}>
          <Button
            label="Long"
            onPress={() => {
              setSide('long');
              resetQuote();
            }}
            variant={side === 'long' ? 'primary' : 'secondary'}
          />
        </View>
        <View style={styles.sideButton}>
          <Button
            label="Short"
            onPress={() => {
              setSide('short');
              resetQuote();
            }}
            variant={side === 'short' ? 'primary' : 'secondary'}
          />
        </View>
      </View>

      <Button
        label={reduceOnly ? 'Reduce only · On' : 'Reduce only · Off'}
        onPress={() => {
          setReduceOnly((current) => !current);
          resetQuote();
        }}
        variant={reduceOnly ? 'primary' : 'secondary'}
      />

      <TextInput
        accessibilityLabel={`${market.baseAsset} position size`}
        autoCorrect={false}
        editable={phase !== 'preparing' && phase !== 'submitting'}
        inputMode="decimal"
        keyboardType="decimal-pad"
        onChangeText={(value) => {
          setSize(value);
          resetQuote();
        }}
        placeholder={`0.00 ${market.baseAsset}`}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={size}
      />

      {plan === null ? null : (
        <View style={styles.summary}>
          <StatusRow
            label="Order"
            value={`${capitalize(plan.side)} · market IOC${plan.reduceOnly ? ' · reduce only' : ''}`}
          />
          <StatusRow label="Size" value={base(plan.baseAssetAmount)} />
          <StatusRow label="Estimated entry" value={usd(plan.estimatedEntryPrice)} />
          <StatusRow label="Maximum price" value={usd(plan.limitPrice)} />
          <StatusRow label="Maximum notional" value={usdt(plan.notionalBaseUnits)} />
          <StatusRow label="Effective leverage" value={leverage(plan)} />
          <StatusRow label="Initial margin" value={usdt(plan.requiredMarginBaseUnits)} />
          <StatusRow label="Taker fee" value={`Up to ${usdt(plan.takerFeeBaseUnits)}`} />
          <StatusRow label="Liquidation estimate" value={liquidation(plan)} />
          <StatusRow label="Funding" value={plan.fundingLabel} />
          <StatusRow label="Slippage limit" value={`${plan.slippageBps / 100}%`} />
          <StatusRow label="Network fee" value={sol(plan.feeLamports)} />
          <StatusRow
            label="Verification"
            value={plan.simulation === 'passed' ? 'Decoded and simulated' : 'Waiting for SOL'}
          />
        </View>
      )}

      {plan?.simulation === 'insufficient-sol' ? (
        <View style={styles.notice}>
          <Text accessibilityRole="alert" style={styles.message}>
            Your private trading wallet needs {sol(plan.feeLamports - plan.solBalanceLamports)} for this transaction. Add a private SOL fee reserve from Account; transferring directly from the Privy wallet would weaken privacy.
          </Text>
        </View>
      ) : null}

      {result === null ? null : (
        <View accessibilityLiveRegion="polite" style={styles.notice}>
          <Text style={styles.message}>
            {result.status === 'confirmed'
              ? 'Order confirmed. Portfolio will refresh the resulting position.'
              : 'Order was signed and may still be confirming. Do not submit it again.'}
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
        <Button label="Review order" loading={phase === 'submitting'} onPress={confirm} />
      ) : result === null ? (
        <Button
          label={plan === null ? 'Prepare order' : 'Recheck SOL balance'}
          loading={phase === 'preparing'}
          onPress={() => void prepare()}
          variant="secondary"
        />
      ) : null}

      <Text style={styles.message}>
        Current venue mark: {formatAmount(venue.markPrice)}. No order is signed until the final confirmation.
      </Text>
    </View>
  );
}

function base(value: bigint): string {
  return formatAmount(amountFromBaseUnits(value, 9));
}

function usdt(value: bigint): string {
  return `${formatAmount(amountFromBaseUnits(value, 6))} USDT`;
}

function usd(value: bigint): string {
  return `$${formatAmount(amountFromBaseUnits(value, 6))}`;
}

function sol(value: bigint): string {
  return `${formatAmount(amountFromBaseUnits(value, 9))} SOL`;
}

function leverage(plan: VelocityMarketOrderPlan): string {
  if (plan.totalCollateralBaseUnits <= 0n) return 'Unavailable';
  const hundredths = (plan.notionalBaseUnits * 100n + plan.totalCollateralBaseUnits - 1n) /
    plan.totalCollateralBaseUnits;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}×`;
}

function liquidation(plan: VelocityMarketOrderPlan): string {
  return plan.liquidationPrice === null
    ? 'No remaining positive threshold'
    : usd(plan.liquidationPrice);
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function short(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function actionError(cause: unknown): string {
  if (
    cause instanceof AmountError ||
    cause instanceof VelocityMarketOrderError ||
    cause instanceof SolanaRpcError ||
    cause instanceof TransactionSigningError
  ) {
    return cause.message;
  }
  return 'The Velocity order could not be prepared.';
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  title: { ...typography.heading, color: colors.textPrimary },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
  sideButtons: { flexDirection: 'row', gap: spacing.sm },
  sideButton: { flex: 1 },
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
