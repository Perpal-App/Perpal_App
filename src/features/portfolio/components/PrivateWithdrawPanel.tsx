import { useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import { getSupportedMints } from '@umbra-privacy/sdk/constants';
import { NATIVE_MINT } from '@solana/spl-token';
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
import { readAppConfig } from '@/config/appConfig';
import { amountFromBaseUnits, formatAmount, parseAmount } from '@/domain/money/amount';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import {
  listTradingCollateralOptions,
} from '@/integrations/perps/providerCollateral';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  usePrivateExit,
  type PrivateExitAsset,
} from '@/integrations/umbra/PrivateExitProvider';
import { colors, gradients, layout, radii, spacing, typography } from '@/theme/tokens';
import { showAppToast } from '@/storage/appToast';

/**
 * One token the account can actually withdraw, and how much of it there is.
 *
 * `baseUnits` is null while balances are still loading — which is different from zero, and has to be:
 * zero means the token is not offered, and treating "not known yet" as zero would tell a reader they
 * hold nothing a moment before the figures arrive.
 */
export type WithdrawableToken = {
  readonly asset: PrivateExitAsset;
  readonly baseUnits: bigint | null;
  readonly id?: string;
};

export function PrivateWithdrawPanel({
  balances,
  snapshot,
}: {
  readonly balances: WalletBalances | null;
  readonly snapshot: PacificaPortfolioSnapshot | null;
}) {
  const privateExit = usePrivateExit();
  const [amount, setAmount] = useState('');
  const [destinationMode, setDestinationMode] = useState<'privy' | 'external'>('privy');
  const [externalAddress, setExternalAddress] = useState('');
  const [chosenMint, setChosenMint] = useState('');
  const configured = useMemo(() => {
    const config = readAppConfig();
    return config.ok
      ? listTradingCollateralOptions(
        config.value.perps.usdcMint,
        config.value.perps.usdtMint,
      ).map((asset) => ({ ...asset, kind: 'spl' as const }))
      : [];
  }, []);

  const withdrawable = useMemo(
    () => readWithdrawable(configured, balances, snapshot),
    [balances, configured, snapshot],
  );

  // Derived, not corrected in an effect. A balance can drop to zero while the panel is open, and the
  // selection has to fall back within the same render — otherwise the amount field would keep
  // describing a token that is no longer on the list.
  const selected = withdrawable.find((token) => token.asset.mint === chosenMint)
    ?? withdrawable[0]
    ?? null;
  const asset = selected?.asset ?? null;
  const symbol = asset?.symbol ?? 'Token';
  const pending = privateExit.record !== null && privateExit.record.phase !== 'complete';
  const empty = withdrawable.length === 0;
  const nativeSol = asset?.kind === 'native';
  // The venue keeps its margin in USDC, so only a USDC withdrawal can pull from the trading account
  // Only a USDC withdrawal pays the venue's withdrawal fee; other assets are already private.
  const collectsFromVenue = symbol === 'USDC';

  const confirm = () => {
    if (asset === null) {
      showAppToast({
        outcome: 'error', title: 'Withdrawal unavailable',
        message: 'Withdrawal configuration is unavailable.',
      });
      return;
    }
    try {
      const parsed = parseTokenAmount(amount, asset.decimals);
      const destination = destinationMode === 'privy'
        ? privateExit.mainWalletAddress
        : externalAddress.trim();
      if (parsed <= 0n || destination === null) throw new Error('invalid input');
      const validated = new PublicKey(destination).toBase58();
      Alert.alert(
        nativeSol ? 'Withdraw SOL privately' : 'Withdraw privately',
        [
          nativeSol
            ? `${amount.trim()} SOL will move from your private balance through Umbra`
            : `${amount.trim()} ${asset.symbol} will move from your private balance through Umbra`,
          `to ${destinationMode === 'privy' ? 'your public wallet' : 'the external wallet'}.`,
          collectsFromVenue ? `Trading withdrawal fee: ${feeLabel()}.` : null,
          nativeSol
            ? 'Umbra wraps SOL inside the pool and delivers native SOL after the relayed claim.'
            : 'Umbra relayer fees are deducted from the private transfer.',
          'First use may create Umbra registration accounts and spend SOL on rent and network fees. If a claim is interrupted after deposit, resume it to recover the Umbra note.',
        ].filter((line): line is string => line !== null).join(' '),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Withdraw',
            onPress: () => void privateExit.start(parsed, validated, asset),
          },
        ],
      );
    } catch {
      showAppToast({
        outcome: 'error', title: 'Review withdrawal',
        message: `Enter a valid ${asset.symbol} amount and destination.`,
      });
    }
  };

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Withdraw</Text>
      <Text selectable style={styles.note}>
        {empty
          ? 'Nothing to withdraw yet. Deposited collateral and closed margin appear here.'
          : collectsFromVenue
            ? 'One withdrawal collects the USDC into your private balance, then delivers it privately.'
            : nativeSol
              ? 'SOL is delivered privately through Umbra and arrives as native SOL.'
            : `${symbol} is already in your private balance and is delivered privately in one step.`}
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
          // Open even with a single token, because the menu is where the balance is shown and one
          // token still has a figure worth reading. Only a run in flight or nothing at all locks it.
          disabled={privateExit.isRunning || pending || empty}
          onSelect={setChosenMint}
          selectedMint={asset?.mint ?? ''}
          symbol={symbol}
          tokens={withdrawable}
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

      {pending ? (
        <View style={styles.buttons}>
          <ActionButton
            disabled={privateExit.isRunning}
            label={privateExit.isRunning
              ? 'Withdrawal in progress'
              : privateExit.error === null
                ? 'Resume withdrawal'
                : 'Retry withdrawal'}
            loading={privateExit.isRunning}
            onPress={() => void privateExit.resume()}
            style={styles.button}
            tone="neutral"
          />
          {privateExit.canReset ? (
            <ActionButton
              disabled={privateExit.isRunning}
              label="Change amount"
              onPress={() => void privateExit.reset()}
              style={styles.button}
              tone="neutral"
            />
          ) : null}
        </View>
      ) : (
        <ActionButton
          disabled={asset === null || empty || privateExit.mainWalletAddress === null}
          label={nativeSol ? 'Withdraw SOL privately' : 'Withdraw privately'}
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
export function TokenSelector({
  disabled,
  onSelect,
  selectedMint,
  symbol,
  tokens,
}: {
  readonly disabled: boolean;
  readonly onSelect: (mint: string) => void;
  readonly selectedMint: string;
  readonly symbol: string;
  readonly tokens: readonly WithdrawableToken[];
}) {
  // A plain View, because the measurement has to come from a host view: `PressableScale` is an
  // animated component and its ref is not guaranteed to expose the native measure methods.
  const anchorRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [open, setOpen] = useState(false);
  // The balance rides each option, because "which token" and "how much of it" are the same question
  // here: without it the reader picks a symbol and then finds out from an error whether they had any.
  const menuOptions = useMemo<readonly MenuOption<string>[]>(
    () => tokens.map((token) => ({
      id: token.id ?? token.asset.mint,
      label: token.asset.symbol,
      ...(token.baseUnits === null
        ? {}
        : { detail: formatTokenAmount(token.baseUnits, token.asset.decimals) }),
    })),
    [tokens],
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
        selected={selectedMint}
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

/**
 * Which supported tokens the account actually holds, and how much.
 *
 * USDC counts the private balance plus what the venue reports as withdrawable, because one
 * withdrawal collects the second into the first before delivering it. Counting only the wallet would
 * hide USDC from a trader holding all of it as margin — which is most traders, most of the time — and
 * leave them with no way to withdraw at all.
 *
 * Before balances arrive every supported token is listed with an unknown amount rather than filtered
 * out. Filtering on absent data would empty the menu on open and refill it a moment later.
 */
function readWithdrawable(
  configured: readonly PrivateExitAsset[],
  balances: WalletBalances | null,
  snapshot: PacificaPortfolioSnapshot | null,
): readonly WithdrawableToken[] {
  if (balances === null) {
    return configured.map((asset) => ({ asset, baseUnits: null }));
  }

  const wallet = balances.privateWallet;
  const supported = new Set(getSupportedMints('mainnet').map(String));
  const known = new Map(configured.map((asset) => [asset.mint, asset]));
  const nativeMint = NATIVE_MINT.toBase58();
  const assets = wallet.holdings
    .filter((holding) => supported.has(holding.mint) && holding.mint !== nativeMint)
    .map((holding): PrivateExitAsset => known.get(holding.mint) ?? {
      decimals: holding.decimals,
      kind: 'spl',
      mint: holding.mint,
      symbol: `MINT-${holding.mint.slice(0, 5).toUpperCase()}`,
    });
  const solBaseUnits = wallet.solLamports + (
    wallet.holdings.find((holding) => holding.mint === nativeMint)?.baseUnits ?? 0n
  );
  if (solBaseUnits > 0n && supported.has(nativeMint)) {
    assets.unshift({
      decimals: 9,
      kind: 'native',
      mint: nativeMint,
      symbol: 'SOL',
    });
  }
  const usdc = configured.find((asset) => asset.symbol === 'USDC');
  if (usdc !== undefined && venueWithdrawable(snapshot) > 0n && !assets.some(
    (asset) => asset.mint === usdc.mint,
  )) assets.unshift(usdc);

  return assets.flatMap((asset) => {
    const inWallet = asset.kind === 'native'
      ? solBaseUnits
      : wallet.holdings.find((holding) => holding.mint === asset.mint)?.baseUnits ?? 0n;
    const onVenue = asset.symbol === 'USDC' ? venueWithdrawable(snapshot) : 0n;
    const total = inWallet + onVenue;

    return total > 0n ? [{ asset, baseUnits: total }] : [];
  });
}

/** The venue's own withdrawable margin, in USDC base units. Unreadable or absent counts as none. */
function venueWithdrawable(snapshot: PacificaPortfolioSnapshot | null): bigint {
  if (snapshot === null) return 0n;

  try {
    return parseAmount(snapshot.availableToWithdraw, 6).baseUnits;
  } catch {
    return 0n;
  }
}

function feeLabel(): string {
  const config = readAppConfig();
  if (!config.ok) return 'unavailable';
  const units = config.value.perps.pacificaWithdrawalFeeBaseUnits;
  return `${formatAmount(amountFromBaseUnits(units, 6))} USDC`;
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('invalid');
  const parts = trimmed.split('.');
  if (parts.length > 2) throw new Error('invalid');
  const [whole = '', fraction = ''] = parts;
  if (!/^\d+$/u.test(whole) || !/^\d*$/u.test(fraction) || fraction.length > decimals) {
    throw new Error('invalid');
  }
  return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
}

export function formatTokenAmount(value: bigint, decimals: number): string {
  if (value < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return '--';
  if (decimals === 0) return value.toString();
  const digits = value.toString().padStart(decimals + 1, '0');
  const fraction = digits.slice(-decimals).replace(/0+$/u, '');
  return fraction.length === 0
    ? digits.slice(0, -decimals)
    : `${digits.slice(0, -decimals)}.${fraction}`;
}

/**
 * Floor for a field's height.
 *
 * The row is `stretch`, so the field and the token control take whichever of them is taller and can
 * never disagree — this only sets how short the pair may be when the text inside is small. It grows on
 * its own with the reader's text size.
 */
const FIELD_MIN_HEIGHT = layout.minTouchTarget;

/** Floor for the token menu: enough for a symbol, its balance, and the tick beside them. */
const MIN_MENU_WIDTH = 196;

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
    minHeight: FIELD_MIN_HEIGHT,
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
    minHeight: FIELD_MIN_HEIGHT,
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
});
