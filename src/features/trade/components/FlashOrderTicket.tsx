import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { amountFromBaseUnits, formatAmount, parseAmount } from '@/domain/money/amount';
import { TradeCollateralStepView } from '@/features/trade/components/TradeCollateralStepView';
import { useTradeActionRecovery } from '@/features/trade/hooks/useTradeActionRecovery';
import {
  FlashMarketOrderError,
  prepareFlashMarketOrder,
  submitFlashMarketOrder,
  type FlashMarketOrderPlan,
  type FlashOrderAction,
  type FlashOrderSide,
} from '@/integrations/perps/flash/flashMarketOrder';
import { queueFlashSettlement } from '@/integrations/perps/flash/flashSettlementStorage';
import { resumeFlashSettlements } from '@/integrations/perps/flash/flashSettlement';
import type { MainnetMarket } from '@/integrations/perps/markets/mainnetCatalog';
import { logTradeError } from '@/integrations/observability/tradeError';
import {
  prepareFlashTradeCollateral,
  submitTradeCollateralStep,
  type TradeCollateralStep,
} from '@/integrations/perps/tradeCollateral';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type Phase = 'idle' | 'preparing' | 'prepared' | 'submitting' | 'complete';

export function FlashOrderTicket({
  baseRpcUrl,
  erRpcUrl,
  market,
  programId,
  rpcUrl,
  swapBuildUrl,
  usdtMint,
}: {
  readonly baseRpcUrl: string;
  readonly erRpcUrl: string;
  readonly market: MainnetMarket;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly swapBuildUrl: string;
  readonly usdtMint: string;
}) {
  const router = useRouter();
  const session = useTradingSession();
  const [action, setAction] = useState<FlashOrderAction>('open');
  const [side, setSide] = useState<FlashOrderSide>('long');
  const [collateral, setCollateral] = useState('');
  const [leverage, setLeverage] = useState('5');
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<FlashMarketOrderPlan | null>(null);
  const [preparation, setPreparation] = useState<TradeCollateralStep | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const recovery = useTradeActionRecovery({
    owner: session.address,
    provider: 'flash',
    rpcUrl,
    signer: session.signer,
  });

  const reset = () => {
    controller.current?.abort();
    setPlan(null);
    setPreparation(null);
    setSignature(null);
    setError(null);
    setPhase('idle');
  };

  useEffect(() => {
    reset();
    setCollateral('');
    return () => controller.current?.abort();
  }, [market.venueRef, session.address]);

  const prepare = async () => {
    if (session.address === null || session.signer === null) {
      setError('Activate private trading before preparing an order.');
      return;
    }
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setPhase('preparing');
    setPlan(null);
    setPreparation(null);
    setError(null);
    try {
      const recoveryStatus = await recovery.reconcile(abort.signal);
      if (recoveryStatus === 'pending') {
        setError('A previous Flash preparation is still confirming. It will resume automatically.');
        setPhase('idle');
        return;
      }
      const collateralBaseUnits = action === 'open'
        ? parseAmount(collateral, 6).baseUnits
        : 0n;
      if (action === 'open') {
        const nextPreparation = await prepareFlashTradeCollateral({
          flashProgramId: programId,
          owner: session.address,
          portfolioRpcUrl: baseRpcUrl,
          requiredBaseUnits: collateralBaseUnits,
          rpcUrl,
          signal: abort.signal,
          signer: session.signer,
          swapBuildUrl,
          usdtMint,
        });
        if (nextPreparation !== null) {
          setPreparation(nextPreparation);
          setPhase('prepared');
          return;
        }
      }
      const next = await prepareFlashMarketOrder({
        action,
        baseRpcUrl,
        collateralInputBaseUnits: collateralBaseUnits,
        erRpcUrl,
        leverage: action === 'open' ? Number(leverage) : 1,
        market,
        owner: session.address,
        programId,
        side,
        signer: session.signer,
        signal: abort.signal,
      });
      if (!abort.signal.aborted) {
        setPlan(next);
        setPhase('prepared');
      }
    } catch (cause) {
      if (!abort.signal.aborted) {
        logTradeError('flash', 'preparation', cause);
        setError(cause instanceof Error ? cause.message : 'Flash order preview failed.');
        setPhase('idle');
      }
    }
  };

  const submitPreparation = async () => {
    if (preparation === null || session.address === null || session.signer === null) return;
    const abort = new AbortController();
    controller.current = abort;
    setPhase('submitting');
    setError(null);
    try {
      const result = await submitTradeCollateralStep({
        flashProgramId: programId,
        owner: session.address,
        programId,
        rpcUrl,
        signal: abort.signal,
        signer: session.signer,
        step: preparation,
      });
      if (result.status !== 'confirmed') {
        recovery.setPending(true);
        setPreparation(null);
        setError('Trade preparation was signed and is still confirming. Do not submit it again.');
        setPhase('idle');
        return;
      }
      recovery.setPending(false);
      setPreparation(null);
      setPhase('idle');
      await prepare();
    } catch (cause) {
      if (!abort.signal.aborted) {
        logTradeError('flash', 'submission', cause);
        setError(cause instanceof Error ? cause.message : 'Flash trade preparation failed.');
        setPhase('idle');
        void recovery.reconcile().then((status) => {
          if (status === 'pending') setPreparation(null);
        }).catch(() => undefined);
      }
    }
  };

  const submit = async (confirmed: FlashMarketOrderPlan, intentStartedAtMs: number) => {
    if (session.address === null || session.signer === null) return;
    setPhase('submitting');
    setError(null);
    try {
      const result = await submitFlashMarketOrder({
        action: confirmed.action,
        baseRpcUrl,
        collateralInputBaseUnits: confirmed.collateralInputBaseUnits,
        erRpcUrl,
        leverage: Number(confirmed.leverageHundredths) / 100,
        market,
        intentStartedAtMs,
        owner: session.address,
        plan: confirmed,
        programId,
        side: confirmed.side,
        signer: session.signer,
        ...(confirmed.action === 'close'
          ? {
              onSigned: (closeSignature: string) => queueFlashSettlement({
                amountBaseUnits: (confirmed.receiveAmountBaseUnits ?? 0n).toString(),
                closeSignature,
                owner: session.address!,
                poolName: confirmed.poolName,
                side: confirmed.side,
                symbol: confirmed.symbol,
              }),
            }
          : {}),
      });
      setSignature(result.signature);
      setPhase('complete');
      if (confirmed.action === 'close' && session.flashFeeSigner !== null) {
        void resumeFlashSettlements({
          erRpcUrl,
          feeSigner: session.flashFeeSigner,
          owner: session.address,
          programId,
          rpcUrl,
          signer: session.signer,
        });
      }
    } catch (cause) {
      logTradeError('flash', 'submission', cause);
      setError(cause instanceof FlashMarketOrderError || cause instanceof Error
        ? cause.message
        : 'Flash order submission failed.');
      setPlan(null);
      setPhase('idle');
    }
  };

  if (session.status !== 'ready' || session.address === null || session.signer === null) {
    return (
      <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>Trade {market.symbol}</Text>
        <Text style={styles.message}>Set up and fund private trading from Wallet first.</Text>
        <Button label="Open Wallet" onPress={() => router.push('/(tabs)/account')} />
      </View>
    );
  }

  const confirm = () => plan && Alert.alert(
    `${plan.action === 'open' ? 'Open' : 'Close'} ${plan.side} ${plan.symbol}?`,
    `${plan.action === 'open' ? `${usdc(plan.collateralInputBaseUnits)} collateral, ${leverageLabel(plan)} leverage` : 'Full position close; proceeds will be collected automatically'}, estimated price ${usd(plan.entryPriceUsdBaseUnits)}, fee ${usd(plan.feeUsdBaseUnits)}, slippage limit 0.5%.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm and sign', onPress: () => void submit(plan, performance.now()) },
    ],
  );

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Trade {market.symbol}</Text>
      <View style={styles.row}>
        <View style={styles.flex}><Button label="Open" onPress={() => { setAction('open'); reset(); }} variant={action === 'open' ? 'primary' : 'secondary'} /></View>
        <View style={styles.flex}><Button label="Close" onPress={() => { setAction('close'); reset(); }} variant={action === 'close' ? 'primary' : 'secondary'} /></View>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}><Button label={action === 'close' ? 'Close long' : 'Long'} onPress={() => { setSide('long'); reset(); }} variant={side === 'long' ? 'primary' : 'secondary'} /></View>
        <View style={styles.flex}><Button label={action === 'close' ? 'Close short' : 'Short'} onPress={() => { setSide('short'); reset(); }} variant={side === 'short' ? 'primary' : 'secondary'} /></View>
      </View>
      {action === 'open' ? (
        <View style={styles.row}>
          <TextInput accessibilityLabel="USDC collateral" inputMode="decimal" onChangeText={(value) => { setCollateral(value); reset(); }} placeholder="USDC collateral" placeholderTextColor={colors.textMuted} style={[styles.input, styles.flex]} value={collateral} />
          <TextInput accessibilityLabel="Leverage" inputMode="numeric" onChangeText={(value) => { setLeverage(value); reset(); }} placeholder="5×" placeholderTextColor={colors.textMuted} style={[styles.input, styles.leverage]} value={leverage} />
        </View>
      ) : null}
      {preparation ? (
        <TradeCollateralStepView
          loading={phase === 'submitting'}
          onConfirm={() => void submitPreparation()}
          step={preparation}
        />
      ) : plan ? (
        <View style={styles.summary}>
          <StatusRow label="Action" value={`${plan.action} ${plan.side}`} />
          <StatusRow
            label="Collateral / leverage"
            value={plan.action === 'open' ? `${usdc(plan.collateralInputBaseUnits)} · ${leverageLabel(plan)}` : 'Full position close'}
          />
          <StatusRow label="Notional" value={usd(plan.sizeUsdBaseUnits)} />
          <StatusRow label="Estimated price" value={usd(plan.entryPriceUsdBaseUnits)} />
          <StatusRow label="Liquidation" value={plan.liquidationPriceUsdBaseUnits === null ? 'Position closes' : usd(plan.liquidationPriceUsdBaseUnits)} />
          <StatusRow label="Fees" value={`${usd(plan.feeUsdBaseUnits)} + ${sol(plan.erFeeLamports)}`} />
          <StatusRow label="Quote limits" value={`0.5% slippage · expires ${new Date(plan.expiresAtMs).toLocaleTimeString()}`} />
          <StatusRow label="Verification" value="Decoded and simulated" />
        </View>
      ) : null}
      {signature ? <StatusRow label="Signature" selectable value={signature} /> : null}
      {recovery.pending ? <Text style={styles.message}>Previous trade preparation is still confirming.</Text> : null}
      {error || recovery.error ? <Text accessibilityRole="alert" style={styles.error}>{error ?? recovery.error}</Text> : null}
      {preparation ? null : plan ? (
        <Button label="Review order" loading={phase === 'submitting'} onPress={confirm} />
      ) : signature === null ? (
        <Button label={recovery.pending ? 'Check preparation' : 'Prepare order'} loading={phase === 'preparing'} onPress={() => void prepare()} variant="secondary" />
      ) : null}
      <Text style={styles.message}>Signed locally after confirmation. Other open positions remain unchanged.</Text>
    </View>
  );
}

function usd(value: bigint) { return `$${formatAmount(amountFromBaseUnits(value, 6))}`; }
function usdc(value: bigint) { return `${formatAmount(amountFromBaseUnits(value, 6))} USDC`; }
function sol(value: bigint) { return `${formatAmount(amountFromBaseUnits(value, 9))} SOL`; }
function leverageLabel(plan: FlashMarketOrderPlan) {
  return `${plan.leverageHundredths / 100n}.${(plan.leverageHundredths % 100n).toString().padStart(2, '0')}×`;
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong, borderRadius: radii.md, backgroundColor: colors.surface },
  title: { ...typography.heading, color: colors.textPrimary },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  leverage: { width: 88 },
  input: { minHeight: 54, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.md, color: colors.textPrimary, backgroundColor: colors.background, ...typography.body },
  summary: { gap: spacing.sm },
  error: { ...typography.bodyCompact, color: colors.textSecondary },
});
