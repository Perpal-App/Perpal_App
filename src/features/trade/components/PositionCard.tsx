import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native';

import { IOSLoader } from '@/components/feedback/IOSLoader';
import { PressableScale } from '@/components/ui/PressableScale';
import {
  formatAmountWithCommas,
  formatDetailedUsd,
  formatSignedBpsPercent,
  formatSignedDetailedUsd,
  type Amount,
} from '@/domain/money/amount';
import { positionFigures, type LiquidationLevel } from '@/domain/portfolio/positionFigures';
import { MarketLogo } from '@/features/trade/components/MarketLogo';
import { formatPositionPrice, tickPlaces } from '@/features/trade/components/positionText';
import type { PacificaMarketSnapshot } from '@/integrations/perps/pacifica/pacificaMarketData';
import type { PacificaPosition } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { colors, gradients, interfaceType, radii, spacing } from '@/theme/tokens';

/** Printed where a figure cannot be read or valued. */
const UNAVAILABLE = '--';
const MINUS = '\u2212';
const LOGO = 20;
const CHEVRON = 14;
/** The one action a screen reader is offered on the title: the same open a tap on the card performs. */
const OPEN_ACTIONS = [{ name: 'activate' }] as const;

type Tone = 'muted' | 'negative' | 'plain' | 'positive';

const INK: Readonly<Record<Tone, string>> = {
  muted: colors.textMuted,
  negative: colors.negative,
  plain: colors.textPrimary,
  positive: colors.positive,
};

/** The profit-and-loss pill's fill: the depth greens and reds, and a neutral step for a flat or unknown figure. */
const WASH: Readonly<Record<Tone, string>> = {
  muted: colors.surfaceElevated,
  negative: colors.depthAsk,
  plain: colors.surfaceElevated,
  positive: colors.depthBid,
};

/** What the card knows about the position's market, from the live catalog. */
export type PositionMarket = {
  readonly iconUrl: string;
  /** The market's price step, which is the precision its prices are shown at. */
  readonly tickSize: string;
};

/**
 * One open position, valued live, closable in one tap.
 *
 * The header says what the position is — the token, the instrument, one badge for side and margin mode — and
 * carries its one action. Under it the unrealized profit or loss and the return on the capital behind it,
 * worked out on the device from the streamed mark so they move with the market. Then nine facts about this
 * trade in a grid of equal boxes, three to a row: what is held, what it is worth and the capital it uses;
 * where it was entered, where it is now and where it would be liquidated; its leverage, when it opened and
 * how long it has been open.
 *
 * A trading screen asks for `facts="trade"`: the first six boxes only, with the leverage moved onto the badge
 * beside the side and margin mode — what a decision about the position reads, and not the clock.
 *
 * Small, tabular type throughout, so three figures fit a row and every value lines up. Prices are shown at
 * their market's tick. The card says nothing while prices are current and marks the profit and loss as
 * delayed when the feed falls behind, so an old valuation is never presented as a current one.
 *
 * Close is a single tap: the card shows what is being closed, and the close that is sent is checked against
 * it — the same side and the same size the card shows, or nothing is sent.
 */
export function PositionCard({
  closeDisabled,
  closing,
  facts = 'all',
  leverage,
  market,
  onClose,
  onOpen,
  position,
  snapshot,
}: {
  /** Another close is under way, which holds this one back. */
  readonly closeDisabled: boolean;
  readonly closing: boolean;
  /** `all`, the whole record, or `trade`: the six trading facts, the leverage on the badge. */
  readonly facts?: 'all' | 'trade';
  /** The multiple the position runs at, or `null` while it is not known. */
  readonly leverage: number | null;
  readonly market: PositionMarket | null;
  readonly onClose: () => void;
  /**
   * Opens the position's market. Given, the whole card is the way there — a tap anywhere on it but its
   * Close — and a chevron after the title says so. Left out where the card already sits on a market.
   */
  readonly onOpen?: () => void;
  readonly position: PacificaPosition;
  /** The live market for this position's instrument, or `null` until the feed has it. */
  readonly snapshot: PacificaMarketSnapshot | null;
}) {
  const figures = positionFigures(position, snapshot?.price ?? null, leverage);
  const long = position.side === 'long';
  const pnl = figures === null ? null : figures.unrealizedPnl;
  const tone = amountTone(pnl);
  const delayed = snapshot !== null && snapshot.priceStale;
  const places = market === null ? null : tickPlaces(market.tickSize);
  const rateBps = figures === null ? null : figures.roeBps ?? figures.pnlBps;
  const pnlText = pnl === null ? UNAVAILABLE : formatSignedDetailedUsd(pnl);
  const rateText = rateBps === null ? null : formatSignedBpsPercent(rateBps).replace('-', MINUS);
  const liquidation = figures === null ? null : figures.liquidation;
  const side = long ? 'Long' : 'Short';
  const mode = position.marginMode === 'cross' ? 'Cross' : 'Isolated';
  const multiple = figures === null ? null : figures.leverage;
  // Said on the badge only in the trade form, and only once it is known: the badge never guesses.
  const badgeMultiple = facts === 'trade' ? multiple : null;

  const setup = `${side}, ${mode} margin${badgeMultiple === null ? '' : `, ${badgeMultiple} times leverage`}`;
  // With somewhere to go, the title is the card's link for a screen reader: one element naming the position
  // and where it leads, activated like a button. Touch needs none of this — the card itself takes the tap.
  const link = onOpen === undefined ? {} : {
    accessibilityActions: OPEN_ACTIONS,
    accessibilityHint: `Opens the ${position.symbol} market`,
    accessibilityLabel: `${position.symbol}, ${setup}`,
    accessibilityRole: 'link' as const,
    accessible: true,
    onAccessibilityAction: (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'activate') onOpen();
    },
  };

  const card = (
    <LinearGradient
      colors={gradients.surfaceRaise.colors}
      end={{ x: 0.5, y: 1 }}
      locations={gradients.surfaceRaise.locations}
      start={{ x: 0.5, y: 0 }}
      style={styles.card}
    >
      <View style={styles.header}>
        <View {...link} style={styles.identity}>
          <MarketLogo size={LOGO} symbol={position.symbol} url={market?.iconUrl ?? ''} />
          <Text accessibilityRole="header" numberOfLines={1} style={styles.symbol}>{position.symbol}</Text>
          <View
            accessibilityLabel={setup}
            accessible
            style={[styles.badge, { backgroundColor: long ? colors.depthBid : colors.depthAsk }]}
          >
            <Text numberOfLines={1} style={[styles.badgeLabel, { color: long ? colors.positive : colors.negative }]}>
              {`${side} · ${mode}${badgeMultiple === null ? '' : ` · ${badgeMultiple}×`}`}
            </Text>
          </View>
          {onOpen === undefined ? null : (
            <Ionicons color={colors.textMuted} name="chevron-forward" size={CHEVRON} style={styles.chevron} />
          )}
        </View>
        <CloseButton
          closing={closing}
          disabled={closeDisabled}
          onPress={onClose}
          spoken={`Close ${position.symbol} ${position.side}`}
        />
      </View>

      <View
        accessibilityLabel={`Unrealized profit and loss${delayed ? ', delayed' : ''}: ${pnlText}${
          rateText === null ? '' : `, ${rateText}${figures?.roeBps === null ? '' : ' on margin'}`
        }`}
        accessible
        style={styles.pnl}
      >
        <Text numberOfLines={1} style={styles.pnlLabel}>{delayed ? 'Unrealized PnL · delayed' : 'Unrealized PnL'}</Text>
        {/* The figure on its own pill, washed in its direction's colour, straight after the words that name
            it rather than across the card from them. */}
        <View style={[styles.pnlBadge, { backgroundColor: WASH[tone] }]}>
          <Text adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={1} style={[styles.pnlValue, { color: INK[tone] }]}>
            {pnlText}
          </Text>
          {rateText === null ? null : (
            <Text numberOfLines={1} style={[styles.pnlRate, { color: INK[tone] }]}>{rateText}</Text>
          )}
        </View>
      </View>

      <View style={styles.grid}>
        <View style={styles.gridRow}>
          <Cell label="Size" value={figures === null ? UNAVAILABLE : `${formatAmountWithCommas(figures.size)} ${position.symbol}`} />
          <Cell label="Value" value={usd(figures === null ? null : figures.notional)} />
          <Cell label="Margin" spoken="Margin used" value={usd(figures === null ? null : figures.marginUsed)} />
        </View>
        <View style={styles.gridRow}>
          <Cell label="Entry" spoken="Entry price" value={figures === null ? UNAVAILABLE : formatPositionPrice(figures.entryPrice, places)} />
          <Cell label="Mark" spoken="Mark price" value={figures === null || figures.mark === null ? UNAVAILABLE : formatPositionPrice(figures.mark, places)} />
          <Cell
            label="Liq. price"
            spoken={liquidationSpoken(liquidation)}
            tone={liquidation === null || liquidation.kind !== 'price' ? 'muted' : 'negative'}
            value={liquidationText(liquidation, places)}
          />
        </View>
        {facts === 'all' ? (
          <View style={styles.gridRow}>
            <Cell label="Leverage" value={multiple === null ? UNAVAILABLE : `${multiple}×`} />
            <Cell label="Opened" value={position.openedAtMs === null ? UNAVAILABLE : openedText(position.openedAtMs)} />
            <Cell label="Held" spoken="Open for" value={position.openedAtMs === null ? UNAVAILABLE : heldText(position.openedAtMs)} />
          </View>
        ) : null}
      </View>
    </LinearGradient>
  );

  if (onOpen === undefined) return card;

  // The card gives a little under the finger and opens its market on release. Close keeps its own touch:
  // the innermost control under a finger takes it, so closing never opens the market too. A sideways
  // swipe belongs to the row of cards and cancels the tap. Kept out of the accessibility tree, where the
  // title carries the same action, so every fact and the Close stay readable on their own.
  return (
    <PressableScale accessible={false} onPress={onOpen} pressedScale={0.985}>
      {card}
    </PressableScale>
  );
}

/**
 * The card's one action, sized to sit in the header rather than across the card. Washed in the loss colour,
 * as the destructive control. While the close is in flight it holds a spinner in the same box, so nothing
 * around it moves.
 */
function CloseButton({
  closing,
  disabled,
  onPress,
  spoken,
}: {
  readonly closing: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly spoken: string;
}) {
  return (
    <PressableScale
      accessibilityHint="Closes the whole position at market, reduce-only"
      accessibilityLabel={spoken}
      accessibilityRole="button"
      accessibilityState={{ busy: closing, disabled }}
      disabled={disabled}
      hitSlop={10}
      onPress={onPress}
      style={[styles.close, disabled && !closing && styles.closeIdle]}
    >
      {closing ? <IOSLoader color={colors.negative} /> : <Text style={styles.closeLabel}>Close</Text>}
    </PressableScale>
  );
}

/** One box of the grid: a quiet label over its value, the two read as one statement. */
function Cell({
  label,
  spoken,
  tone = 'plain',
  value,
}: {
  readonly label: string;
  readonly spoken?: string;
  readonly tone?: Tone;
  readonly value: string;
}) {
  return (
    <View accessibilityLabel={`${spoken ?? label}: ${value}`} accessible style={styles.cell}>
      <Text numberOfLines={1} style={styles.cellLabel}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        numberOfLines={1}
        selectable
        style={[styles.cellValue, { color: value === UNAVAILABLE ? colors.textMuted : INK[tone] }]}
      >
        {value}
      </Text>
    </View>
  );
}

function amountTone(value: Amount | null): Tone {
  if (value === null || value.baseUnits === 0n) return 'plain';
  return value.baseUnits > 0n ? 'positive' : 'negative';
}

function usd(value: Amount | null): string {
  return value === null ? UNAVAILABLE : formatDetailedUsd(value);
}

function liquidationText(level: LiquidationLevel | null, places: number | null): string {
  if (level === null || level.kind === 'unknown') return UNAVAILABLE;
  return formatPositionPrice(level.price, places);
}

function liquidationSpoken(level: LiquidationLevel | null): string {
  return level !== null && level.kind === 'belowZero'
    ? 'Liquidation price, below zero, which the price cannot reach'
    : 'Liquidation price';
}

/** The time alone for a position opened today, the day and the time for one opened before. */
function openedText(ms: number): string {
  const opened = new Date(ms);
  const time = opened.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (opened.toDateString() === new Date().toDateString()) return time;
  return `${opened.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

/**
 * How long the position has been open, to the minute: `4m`, `2h 15m`, `3d 6h`. Worked out on each render,
 * and the card renders with every price the feed publishes, so it keeps up without a timer of its own.
 */
function heldText(ms: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    gap: spacing.xs,
    padding: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderCurve: 'continuous',
  },
  header: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  identity: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0, gap: spacing.xs },
  symbol: { ...interfaceType.cardTitle, flexShrink: 0, color: colors.textPrimary },
  badge: { flexShrink: 1, minWidth: 0, paddingHorizontal: spacing.xs, paddingVertical: 1, borderRadius: radii.pill },
  badgeLabel: interfaceType.badge,
  // Tucked against the badge, never pushed away from it: it says the title goes somewhere.
  chevron: { flexShrink: 0, marginLeft: -2 },
  close: {
    minWidth: 56,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.depthAsk,
  },
  closeIdle: { opacity: 0.4 },
  closeLabel: { ...interfaceType.badge, color: colors.negative },
  // One line: the name, then its figure on a pill beside it.
  pnl: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pnlLabel: { ...interfaceType.caption, flexShrink: 0, color: colors.textMuted },
  pnlBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexShrink: 1,
    minWidth: 0,
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderCurve: 'continuous',
  },
  pnlValue: { ...interfaceType.figureRounded, flexShrink: 1 },
  pnlRate: interfaceType.figureRoundedSmall,
  // Rows of three equal boxes: every box the same width and every row the same height, so the grid is
  // symmetric whatever the values are.
  grid: { gap: spacing.xxs },
  gridRow: { flexDirection: 'row', gap: spacing.xxs },
  cell: {
    flex: 1,
    minWidth: 0,
    gap: 1,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
  },
  cellLabel: { ...interfaceType.fieldLabel, color: colors.textMuted },
  cellValue: interfaceType.figureCompact,
});
