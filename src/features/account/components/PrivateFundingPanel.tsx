import { useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
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
  PrivateFundingConfirmationModal,
  type PrivateFundingConfirmation,
} from '@/features/account/components/PrivateFundingConfirmationModal';
import {
  hasSubmittedTransaction,
  pendingActionLabel,
  phaseLabel,
  preflightError,
  runningMessage,
  storedError,
} from '@/features/account/components/privateFundingLabels';
import {
  listTradingCollateralOptions,
  type ProviderCollateral,
} from '@/integrations/perps/providerCollateral';
import { usePrivateFunding } from '@/integrations/umbra/PrivateFundingProvider';
import { PrivateFundingError } from '@/integrations/umbra/privateFundingErrors';
import { colors, gradients, layout, radii, spacing, typography } from '@/theme/tokens';

type CollateralSymbol = ProviderCollateral['symbol'];

/** SOL's decimals. The fee reserve is denominated in lamports, not in collateral base units. */
const SOL_DECIMALS = 9;

/** Shared height for a field row, so an input and the token control beside it cannot disagree. */
const FIELD_MIN_HEIGHT = layout.minTouchTarget;

/** Floor for the token menu: enough for a symbol, its balance, and the tick beside them. */
const MIN_MENU_WIDTH = 196;

/**
 * One collateral token the public wallet can fund from, and how much of it there is.
 *
 * `baseUnits` is null while balances are still loading — different from zero, and it has to be: zero
 * means the token is not offered, and treating "not known yet" as zero would tell a reader they hold
 * nothing a moment before the figures arrive.
 */
type FundableToken = {
  readonly collateral: ProviderCollateral;
  readonly baseUnits: bigint | null;
};

/**
 * Adding funds: collateral and a SOL fee reserve, both moving privately into wallet T.
 *
 * Rebuilt on the withdraw panel's layout so the two halves of the same sheet stop looking like two
 * different apps — an amount field paired with a token control, the app's action materials, and the
 * balances shown where the choice is made. What it replaced used a taller bespoke select with a
 * two-line body, inputs a step larger than every other field, and no indication of what was available
 * until a preflight came back and said there was not enough.
 *
 * Both legs are still here because both are required. Collateral is what trades; the SOL reserve is
 * what lets T pay for its own transactions, and a deposit without one would arrive unable to move. It
 * is a fixed second field rather than a third option in the token menu, because it is not an
 * alternative to collateral — every deposit carries both.
 */
export function PrivateFundingPanel({
  balances,
  tradingReady,
}: {
  /** The public wallet is where funds come from, so its balances are what bound the choice. */
  readonly balances: WalletBalances | null;
  readonly tradingReady: boolean;
}) {
  const funding = usePrivateFunding();
  const [amount, setAmount] = useState('');
  const [feeReserve, setFeeReserve] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<CollateralSymbol>('USDC');
  const [confirmation, setConfirmation] = useState<PrivateFundingConfirmation | null>(null);

  const supported = useMemo<readonly ProviderCollateral[]>(() => {
    const config = readAppConfig();
    return config.ok
      ? listTradingCollateralOptions(config.value.perps.usdcMint, config.value.perps.usdtMint)
      : [];
  }, []);
  const fundable = useMemo(() => readFundable(supported, balances), [balances, supported]);

  // Derived, not corrected in an effect. A balance can drop to zero while the panel is open, and the
  // selection has to fall back within the same render — otherwise the amount field would keep
  // describing a token that is no longer on the list.
  const symbol = fundable.some((entry) => entry.collateral.symbol === chosen)
    ? chosen
    : fundable[0]?.collateral.symbol ?? chosen;
  const collateral = fundable.find((entry) => entry.collateral.symbol === symbol)
    ?.collateral ?? null;
  const selectedBalance = fundable.find((entry) => entry.collateral.symbol === symbol)
    ?.baseUnits ?? null;
  const solLamports = balances?.publicWallet.solLamports ?? null;

  const pending = funding.record?.phase === 'complete' ? null : funding.record;
  const shownSymbol = pending?.symbol ?? symbol;
  const balanceError = pending === null
    ? null
    : preflightError(funding.preflight, shownSymbol) ?? funding.preflightError;
  const visibleError = inputError ?? balanceError ?? funding.error
    ?? storedError(funding.record?.errorCode);
  const balanceMissing = funding.preflight !== null
    && (funding.preflight.missingCollateralBaseUnits > 0n
      || funding.preflight.missingSolLamports > 0n);
  const locked = funding.isRunning || !tradingReady;

  const confirmStart = async () => {
    if (collateral === null) {
      setInputError('Collateral configuration is unavailable.');
      return;
    }

    try {
      const parsed = parseAmount(amount, collateral.decimals);
      const parsedFeeReserve = parseAmount(feeReserve, SOL_DECIMALS);

      if (parsed.baseUnits <= 0n || parsedFeeReserve.baseUnits <= 0n) {
        throw new Error('invalid amount');
      }

      setInputError(null);
      const preflight = await funding.check({
        amountBaseUnits: parsed.baseUnits,
        collateralLegPending: true,
        feeLegPending: true,
        feeReserveLamports: parsedFeeReserve.baseUnits,
        mint: collateral.mint,
      });
      const shortage = preflightError(preflight, collateral.symbol);

      if (shortage !== null) {
        setInputError(shortage);
        return;
      }

      setConfirmation({
        amountBaseUnits: parsed.baseUnits,
        decimals: collateral.decimals,
        estimatedNetworkFeeLamports: preflight.estimatedNetworkFeeLamports,
        feeReserveLamports: parsedFeeReserve.baseUnits,
        hasSubmittedTransaction: false,
        mode: 'start',
        requiredSolLamports: preflight.requiredSolLamports,
        symbol: collateral.symbol,
        temporaryRentLamports: preflight.temporaryRentLamports,
      });
    } catch (cause) {
      setInputError(cause instanceof PrivateFundingError
        ? cause.message
        : `Enter valid ${shownSymbol} and SOL reserve amounts.`);
    }
  };

  const confirmResume = async () => {
    const record = funding.record;
    if (record === null) return;

    try {
      const reserveLamports = record.feeFundingLamports === null
        ? parseAmount(feeReserve, SOL_DECIMALS).baseUnits
        : BigInt(record.feeFundingLamports);

      if (reserveLamports <= 0n) throw new Error('invalid amount');

      setInputError(null);
      const preflight = await funding.check({
        amountBaseUnits: BigInt(record.amountBaseUnits),
        collateralLegPending:
          record.depositSignature === null && record.claimSignature === null,
        feeLegPending:
          record.feeFundingDepositSignature === null && record.feeFundingSignature === null,
        feeReserveLamports: reserveLamports,
        mint: record.mint,
      });

      if (preflightError(preflight, record.symbol) !== null) return;

      setConfirmation({
        amountBaseUnits: BigInt(record.amountBaseUnits),
        decimals: 6,
        estimatedNetworkFeeLamports: preflight.estimatedNetworkFeeLamports,
        feeReserveLamports: reserveLamports,
        hasSubmittedTransaction: hasSubmittedTransaction(record),
        mode: 'resume',
        requiredSolLamports: preflight.requiredSolLamports,
        symbol: record.symbol,
        temporaryRentLamports: preflight.temporaryRentLamports,
      });
    } catch (cause) {
      setInputError(cause instanceof PrivateFundingError
        ? cause.message
        : 'Enter a valid SOL reserve amount.');
    }
  };

  const submitConfirmation = () => {
    const confirmed = confirmation;
    setConfirmation(null);
    if (confirmed === null) return;

    if (confirmed.mode === 'resume') {
      void funding.resume(
        funding.record?.feeFundingLamports === null
          ? confirmed.feeReserveLamports
          : undefined,
      );
      return;
    }

    const confirmedCollateral = supported.find(
      (option) => option.symbol === confirmed.symbol,
    );

    if (confirmedCollateral === undefined) {
      setInputError('Collateral configuration is unavailable.');
      return;
    }

    void funding.start(
      confirmed.amountBaseUnits,
      confirmed.feeReserveLamports,
      confirmedCollateral,
    );
  };

  return (
    <View style={styles.panel}>
      {/* No standing explanation under the heading. "Funds move privately from your public wallet into
          private wallet T" described the whole feature to someone who had already chosen it, on a panel
          whose two fields and their balances say what to do. The confirmation before signing still
          states the route, the fees, and what the reserve is for — which is where it matters. */}
      <Text accessibilityRole="header" style={styles.title}>Add funds</Text>
      {funding.record ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {phaseLabel(funding.record.phase)}
        </Text>
      ) : null}

      {pending === null ? (
        <View style={styles.field}>
          <FieldHead
            available={selectedBalance === null
              ? null
              : `${formatAmount(amountFromBaseUnits(selectedBalance, 6))} available`}
            label="COLLATERAL"
          />
          <View style={styles.row}>
            <TextInput
              accessibilityLabel={`${symbol} amount`}
              autoCapitalize="none"
              editable={!locked}
              inputMode="decimal"
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.amountInput]}
              value={amount}
            />
            <TokenSelector
              disabled={locked || fundable.length === 0}
              onSelect={setChosen}
              symbol={symbol}
              tokens={fundable}
            />
          </View>
        </View>
      ) : null}

      {pending === null || funding.record?.feeFundingLamports === null ? (
        <View style={styles.field}>
          {/* A fixed second field, not a third token in the menu: the reserve is what lets wallet T pay
              for its own transactions, so every deposit carries one and it is never an alternative to
              the collateral above. */}
          <FieldHead
            available={solLamports === null
              ? null
              : `${formatAmount(amountFromBaseUnits(solLamports, SOL_DECIMALS))} available`}
            label="FEE RESERVE"
          />
          <View style={styles.row}>
            <TextInput
              accessibilityLabel="SOL network fee reserve"
              autoCapitalize="none"
              editable={!locked}
              inputMode="decimal"
              onChangeText={setFeeReserve}
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.amountInput]}
              value={feeReserve}
            />
            <TokenTag label="SOL" />
          </View>
        </View>
      ) : null}

      {funding.isRunning ? (
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          {runningMessage(funding.record?.phase)}
        </Text>
      ) : null}
      {visibleError ? (
        <Text accessibilityRole="alert" style={styles.error}>{visibleError}</Text>
      ) : null}

      {pending !== null ? (
        <ActionButton
          disabled={!tradingReady || funding.isChecking || balanceMissing}
          label={pendingActionLabel({
            isChecking: funding.isChecking,
            isRunning: funding.isRunning,
            preflight: funding.preflight,
            symbol: funding.record?.symbol ?? null,
          })}
          loading={funding.isRunning || funding.isChecking}
          onPress={() => void confirmResume()}
          tone="neutral"
        />
      ) : (
        <ActionButton
          disabled={!tradingReady || collateral === null}
          label={funding.record?.phase === 'complete' ? 'Add more funds' : 'Add funds'}
          loading={funding.isRunning}
          onPress={() => void confirmStart()}
        />
      )}

      <PrivateFundingConfirmationModal
        confirmation={confirmation}
        onCancel={() => setConfirmation(null)}
        onConfirm={submitConfirmation}
      />
    </View>
  );
}

/**
 * A field's name and what is available to put in it, on one line.
 *
 * The balance rides the label rather than sitting under the input, which keeps the answer to "how much
 * can I add" above the box being typed into instead of below it — and costs a line rather than two.
 */
function FieldHead({
  available,
  label,
}: {
  readonly available: string | null;
  readonly label: string;
}) {
  return (
    <View style={styles.fieldHead}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {available === null ? null : (
        <Text numberOfLines={1} style={styles.fieldAvailable}>{available}</Text>
      )}
    </View>
  );
}

/** Which collateral is being deposited, with each option's balance beside it. */
function TokenSelector({
  disabled,
  onSelect,
  symbol,
  tokens,
}: {
  readonly disabled: boolean;
  readonly onSelect: (symbol: CollateralSymbol) => void;
  readonly symbol: CollateralSymbol;
  readonly tokens: readonly FundableToken[];
}) {
  // A plain View, because the measurement has to come from a host view: `PressableScale` is an
  // animated component and its ref is not guaranteed to expose the native measure methods.
  const anchorRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [open, setOpen] = useState(false);
  const menuOptions = useMemo<readonly MenuOption<CollateralSymbol>[]>(
    () => tokens.map((entry) => ({
      id: entry.collateral.symbol,
      label: entry.collateral.symbol,
      ...(entry.baseUnits === null
        ? {}
        : { detail: formatAmount(amountFromBaseUnits(entry.baseUnits, entry.collateral.decimals)) }),
    })),
    [tokens],
  );

  // Above the control, because this sits partway up a docked sheet with a second field and a button
  // below it — a menu hanging down would cover the very fields the choice applies to.
  const openMenu = () => {
    anchorRef.current?.measureInWindow((x, y, width) => {
      setAnchor(anchorAbove(x, y, width, Math.max(width, MIN_MENU_WIDTH)));
      setOpen(true);
    });
  };

  return (
    <View ref={anchorRef}>
      <PressableScale
        accessibilityHint="Chooses which token to deposit"
        accessibilityLabel={`Deposit token, ${symbol}`}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={openMenu}
        pressedScale={0.97}
        style={[styles.token, disabled && styles.tokenDisabled]}
      >
        <TokenSurface>
          <Text numberOfLines={1} style={styles.tokenLabel}>{symbol}</Text>
          <ChevronDown />
        </TokenSurface>
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

/**
 * The same control with nothing to choose.
 *
 * It shares the selector's material rather than being plain text, so the two field rows read as the
 * same shape — and it carries no chevron, which is what says this one is fixed.
 */
function TokenTag({ label }: { readonly label: string }) {
  return (
    <View accessibilityElementsHidden style={styles.token}>
      <TokenSurface>
        <Text numberOfLines={1} style={styles.tokenLabel}>{label}</Text>
      </TokenSurface>
    </View>
  );
}

function TokenSurface({ children }: { readonly children: ReactNode }) {
  return (
    <LinearGradient
      colors={gradients.surfaceRaise.colors}
      end={{ x: 0.5, y: 1 }}
      locations={gradients.surfaceRaise.locations}
      start={{ x: 0.5, y: 0 }}
      style={styles.tokenFill}
    >
      {children}
    </LinearGradient>
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
 * Which supported tokens the public wallet actually holds.
 *
 * The public wallet, not the private one: this panel moves funds *out* of it. Before balances arrive
 * every supported token is listed with an unknown amount rather than filtered out, because filtering
 * on absent data would empty the menu on open and refill it a moment later.
 */
function readFundable(
  supported: readonly ProviderCollateral[],
  balances: WalletBalances | null,
): readonly FundableToken[] {
  if (balances === null) {
    return supported.map((collateral) => ({ baseUnits: null, collateral }));
  }

  const wallet = balances.publicWallet;

  return supported.flatMap((collateral) => {
    const held = collateral.symbol === 'USDC' ? wallet.usdcBaseUnits : wallet.usdtBaseUnits;
    return held > 0n ? [{ baseUnits: held, collateral }] : [];
  });
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md },
  title: { ...typography.heading, color: colors.textPrimary },
  note: { ...typography.bodyCompact, color: colors.textSecondary },
  status: { ...typography.label, color: colors.accentSoft },
  field: { gap: spacing.xs },
  fieldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  fieldLabel: { ...typography.eyebrow, letterSpacing: 0.5, color: colors.textMuted },
  fieldAvailable: {
    ...typography.caption,
    flexShrink: 1,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  // A hairline rim rather than a full point: an input is a recess, and a full-point edge belongs to a
  // raised surface. Matched to the withdraw panel so the sheet's two halves agree.
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
  // withdraw panel's token control carries.
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
  error: { ...typography.bodyCompact, color: colors.negative },
});
