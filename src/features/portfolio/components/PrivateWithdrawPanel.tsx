import { useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';

import { ActionButton } from '@/components/ui/ActionButton';
import {
  AnchoredMenu,
  anchorAbove,
  type MenuAnchor,
  type MenuOption,
} from '@/components/ui/AnchoredMenu';
import { PressableScale } from '@/components/ui/PressableScale';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig } from '@/config/appConfig';
import { amountFromBaseUnits, formatAmount, parseAmount } from '@/domain/money/amount';
import {
  listTradingCollateralOptions,
  type ProviderCollateral,
} from '@/integrations/perps/providerCollateral';
import { usePrivateExit } from '@/integrations/umbra/PrivateExitProvider';
import { colors, gradients, radii, spacing, typography } from '@/theme/tokens';

type CollateralSymbol = ProviderCollateral['symbol'];

export function PrivateWithdrawPanel() {
  const privateExit = usePrivateExit();
  const [amount, setAmount] = useState('');
  const [destinationMode, setDestinationMode] = useState<'privy' | 'external'>('privy');
  const [externalAddress, setExternalAddress] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState<CollateralSymbol>('USDC');

  /**
   * Every token this wallet can hold as collateral, which is the set that can be withdrawn.
   *
   * Taken from the same list the deposit panel offers rather than from what the wallet happens to
   * contain: the two are the same set by construction, and reading live holdings would offer a token
   * the Umbra relayer may not route. Native SOL is deliberately absent — it is there to pay fees, not
   * as deposited collateral, and it is not a mint the private transfer handles.
   */
  const collateralOptions = useMemo<readonly ProviderCollateral[]>(() => {
    const config = readAppConfig();
    return config.ok
      ? listTradingCollateralOptions(config.value.perps.usdcMint, config.value.perps.usdtMint)
      : [];
  }, []);
  const collateral = collateralOptions.find((option) => option.symbol === symbol) ?? null;
  const pending = privateExit.record !== null && privateExit.record.phase !== 'complete';
  // The venue keeps its margin in USDC, so only a USDC withdrawal can pull from the trading account
  // and only a USDC withdrawal pays the venue's withdrawal fee. Anything else is already in T.
  const collectsFromVenue = collateral?.symbol === 'USDC';

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
        [
          `${amount.trim()} ${collateral.symbol} will move through private wallet T, then privately`,
          `to ${destinationMode === 'privy' ? 'your public wallet' : 'the external wallet'}.`,
          collectsFromVenue ? `Trading withdrawal fee: ${feeLabel()}.` : null,
          'Umbra relayer fees are deducted from the private transfer.',
        ].filter((line): line is string => line !== null).join(' '),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Withdraw',
            onPress: () => void privateExit.start(parsed.baseUnits, validated, collateral),
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
        {collectsFromVenue
          ? 'One withdrawal collects the USDC into your private wallet, then delivers it privately.'
          : `${symbol} is already in your private wallet and is delivered privately in one step.`}
      </Text>

      <View style={styles.buttons}>
        <ActionButton
          accessibilityHint="Sends the withdrawal to your Privy public wallet"
          label="Public wallet"
          onPress={() => setDestinationMode('privy')}
          selected={destinationMode === 'privy'}
          style={styles.button}
          tone={destinationMode === 'privy' ? 'accent' : 'neutral'}
        />
        <ActionButton
          accessibilityHint="Sends the withdrawal to an address you enter"
          label="Other wallet"
          onPress={() => setDestinationMode('external')}
          selected={destinationMode === 'external'}
          style={styles.button}
          tone={destinationMode === 'external' ? 'accent' : 'neutral'}
        />
      </View>

      {/* Amount and token on one row, the same pairing the activity search uses. The token sets what
          the amount means, so putting it anywhere else would leave the field ambiguous while the
          reader typed into it. */}
      <View style={styles.amountRow}>
        <TextInput
          accessibilityLabel={`${symbol} withdrawal amount`}
          editable={!privateExit.isRunning && !pending}
          inputMode="decimal"
          onChangeText={setAmount}
          placeholder="0.00"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.amountInput]}
          value={amount}
        />
        <TokenSelector
          disabled={privateExit.isRunning || pending}
          onSelect={setSymbol}
          options={collateralOptions}
          symbol={symbol}
        />
      </View>

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
        <StatusRow label="Status" value={exitStatus(privateExit.record.phase)} />
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
        <ActionButton
          disabled={privateExit.isRunning || privateExit.error === null}
          label={privateExit.error === null ? 'Withdrawal in progress' : 'Retry withdrawal'}
          loading={privateExit.isRunning}
          onPress={() => void privateExit.resume()}
          tone="neutral"
        />
      ) : (
        <ActionButton
          disabled={collateral === null || privateExit.mainWalletAddress === null}
          label="Withdraw privately"
          loading={privateExit.isRunning}
          onPress={confirm}
        />
      )}
    </View>
  );
}

/**
 * Which token is being withdrawn.
 *
 * A dropdown rather than a second pair of buttons: the destination above is a choice between two
 * things and reads well as a pair, while this is a value attached to the amount beside it and belongs
 * in a field-shaped control. It is locked while a withdrawal is in flight, because the token is part
 * of the record being recovered and changing it mid-run would describe a different operation than the
 * one that is running.
 */
function TokenSelector({
  disabled,
  onSelect,
  options,
  symbol,
}: {
  readonly disabled: boolean;
  readonly onSelect: (symbol: CollateralSymbol) => void;
  readonly options: readonly ProviderCollateral[];
  readonly symbol: CollateralSymbol;
}) {
  // A plain View, because the measurement has to come from a host view: `PressableScale` is an
  // animated component and its ref is not guaranteed to expose the native measure methods.
  const anchorRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [open, setOpen] = useState(false);
  const menuOptions = useMemo<readonly MenuOption<CollateralSymbol>[]>(
    () => options.map((option) => ({ id: option.symbol, label: option.symbol })),
    [options],
  );

  // Above the control, and sized to it. This sits two rows from the bottom of a docked sheet, so a
  // menu hanging below would run off the screen — the last option was clipped behind the home
  // indicator. Matching the control's width is what stops a card twice its size reading as detached
  // from the button that opened it; the floor is what keeps "Token" and a tick from crowding.
  const openMenu = () => {
    anchorRef.current?.measureInWindow((x, y, width) => {
      setAnchor(anchorAbove(x, y, width, Math.max(width, MIN_MENU_WIDTH)));
      setOpen(true);
    });
  };

  return (
    <View ref={anchorRef}>
      <PressableScale
        accessibilityHint="Chooses which token to withdraw"
        accessibilityLabel={`Withdrawal token, ${symbol}`}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={openMenu}
        pressedScale={0.97}
        style={[styles.token, disabled && styles.tokenDisabled]}
      >
        <LinearGradient
          colors={gradients.surfaceRaise.colors}
          end={{ x: 0.5, y: 1 }}
          locations={gradients.surfaceRaise.locations}
          start={{ x: 0.5, y: 0 }}
          style={styles.tokenFill}
        >
          <Text numberOfLines={1} style={styles.tokenLabel}>{symbol}</Text>
          <ChevronDown />
        </LinearGradient>
      </PressableScale>

      <AnchoredMenu
        anchor={anchor}
        onClose={() => setOpen(false)}
        onSelect={(next) => {
          onSelect(next);
          setOpen(false);
        }}
        options={menuOptions}
        selected={symbol}
        title="Token"
        visible={open}
      />
    </View>
  );
}

function ChevronDown() {
  return (
    <Svg height={14} viewBox="0 0 24 24" width={14}>
      <Path
        d="M6 9.5 12 15.5 18 9.5"
        fill="none"
        stroke={colors.textMuted}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.2}
      />
    </Svg>
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

/** Shared height for the amount row, so the field and the token control cannot disagree. */
const FIELD_HEIGHT = 46;

/** Floor for the token menu: enough for the "TOKEN" caption and a symbol beside its tick. */
const MIN_MENU_WIDTH = 148;

const styles = StyleSheet.create({
  panel: { gap: spacing.md },
  title: { ...typography.heading, color: colors.textPrimary },
  note: { ...typography.bodyCompact, color: colors.textSecondary },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  button: { flex: 1 },
  amountRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  // A hairline rim rather than a full point: an input is a recess, and a full-point edge belongs to a
  // raised surface. Height matched to the buttons above and below so the stack reads evenly.
  input: {
    minHeight: FIELD_HEIGHT,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    ...typography.bodyCompact,
  },
  amountInput: { flex: 1, minWidth: 0 },
  // The raised material, because this is a control rather than a field — the same neutral ramp the
  // activity filter button carries, so a dropdown looks the same wherever it appears.
  token: {
    minHeight: FIELD_HEIGHT,
    flexShrink: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
  },
  tokenDisabled: { opacity: 0.4 },
  tokenFill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
  },
  tokenLabel: { ...typography.label, color: colors.textPrimary },
  error: { ...typography.bodyCompact, color: colors.negative },
});
