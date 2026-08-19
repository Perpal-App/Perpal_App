import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { amountFromBaseUnits, formatAmountWithCommas } from '@/domain/money/amount';
import type {
  PacificaOpenOrder,
  PacificaPosition,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import type {
  VelocityOpenOrder,
  VelocityPosition,
} from '@/integrations/perps/velocity/velocityAccount';
import { colors, fonts, gradients, radii, spacing, typography } from '@/theme/tokens';

/**
 * A position or an order, on the same raised material as the action buttons.
 *
 * The card is the app's `surfaceRaise` ramp with a hairline rim — a lit top edge over a deeper base,
 * which is the treatment reserved for chrome that frames data. A position is exactly that: a small
 * number of discrete objects, each one a thing you can act on. It is deliberately not used for the
 * activity feed below, where a gradient repeated down forty rows stops reading as a surface and
 * starts reading as stripes.
 *
 * Figures sit in the strip the market detail screen uses for a venue's headline numbers: an eyebrow
 * label over a semibold value, evenly spread, wrapping rather than clipping at large text sizes.
 * Six label-and-value rows said the same thing in six times the height.
 */
function Card({ children }: { readonly children: ReactNode }) {
  return (
    <LinearGradient
      colors={gradients.surfaceRaise.colors}
      end={{ x: 0.5, y: 1 }}
      locations={gradients.surfaceRaise.locations}
      start={{ x: 0.5, y: 0 }}
      style={styles.card}
    >
      {children}
    </LinearGradient>
  );
}

export function PositionCard({ position }: { readonly position: PacificaPosition }) {
  const long = position.side === 'long';

  return (
    <Card>
      <View style={styles.header}>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.symbol}>
          {position.symbol}
        </Text>
        {/* The margin mode rides the header rather than taking a figure cell of its own. It is a
            parameter of the position, not a number to scan against the others. */}
        <Text numberOfLines={1} style={styles.mode}>{position.marginMode}</Text>
        <Text style={long ? styles.long : styles.short}>{long ? 'Long' : 'Short'}</Text>
      </View>

      <View style={styles.figures}>
        <Figure label="SIZE" value={position.amount} />
        <Figure label="ENTRY" value={usd(position.entryPrice)} />
        <Figure
          label="LIQ."
          tone="negative"
          value={position.liquidationPrice === null
            ? UNAVAILABLE
            : usd(position.liquidationPrice)}
        />
        <Figure label="MARGIN" value={usd(position.margin)} />
        <Figure label="FUNDING" value={usd(position.funding)} />
      </View>
    </Card>
  );
}

export function OrderCard({
  onCancel,
  order,
}: {
  readonly onCancel: () => void;
  readonly order: PacificaOpenOrder;
}) {
  const bid = order.side === 'bid';

  return (
    <Card>
      <View style={styles.header}>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.symbol}>
          {order.symbol}
        </Text>
        <Text style={bid ? styles.long : styles.short}>{bid ? 'Buy' : 'Sell'}</Text>
      </View>

      <View style={styles.figures}>
        <Figure label="AMOUNT" value={order.initialAmount} />
        <Figure label="PRICE" value={usd(order.price)} />
      </View>

      {/* The red material, because cancelling is the destructive path and the app keeps primary and
          destructive actions visibly apart. The confirmation still carries the detail. */}
      <ActionButton
        accessibilityHint={`Asks to confirm cancelling the ${order.symbol} order`}
        label="Cancel order"
        onPress={onCancel}
        tone="negative"
      />
    </Card>
  );
}

export function VelocityPositionCard({
  position,
}: {
  readonly position: VelocityPosition;
}) {
  const long = position.side === 'long';

  return (
    <Card>
      <View style={styles.header}>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.symbol}>
          {position.symbol}
        </Text>
        <Text numberOfLines={1} style={styles.mode}>{position.marginMode}</Text>
        <Text style={long ? styles.long : styles.short}>{long ? 'Long' : 'Short'}</Text>
      </View>
      <View style={styles.figures}>
        <Figure label="SIZE" value={`${base(position.baseAssetAmount)} ${position.symbol}`} />
        <Figure label="ENTRY" value={usdBase(position.entryPriceBaseUnits)} />
        <Figure label="MARK" value={usdBase(position.markPriceBaseUnits)} />
        <Figure label="PNL" value={signedUsdBase(position.pnlBaseUnits)} />
        <Figure
          label="LIQ."
          tone="negative"
          value={position.liquidationPriceBaseUnits === null
            ? UNAVAILABLE
            : usdBase(position.liquidationPriceBaseUnits)}
        />
      </View>
    </Card>
  );
}

export function VelocityOrderCard({ order }: { readonly order: VelocityOpenOrder }) {
  const long = order.side === 'long';

  return (
    <Card>
      <View style={styles.header}>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.symbol}>
          {order.symbol}
        </Text>
        <Text style={long ? styles.long : styles.short}>{long ? 'Buy' : 'Sell'}</Text>
      </View>
      <View style={styles.figures}>
        <Figure label="TYPE" value={`${order.orderType}${order.reduceOnly ? ' · Reduce' : ''}`} />
        <Figure label="REMAINING" value={`${base(order.remainingBaseUnits)} ${order.symbol}`} />
        <Figure
          label="PRICE"
          value={order.priceBaseUnits === null ? 'Market' : usdBase(order.priceBaseUnits)}
        />
      </View>
    </Card>
  );
}

/** Printed where the venue has not published a usable value. Shared with the markets table. */
const UNAVAILABLE = '--.--';

function Figure({
  label,
  tone = 'plain',
  value,
}: {
  readonly label: string;
  /** `negative` marks the one figure that is a threshold rather than a balance. */
  readonly tone?: 'negative' | 'plain';
  readonly value: string;
}) {
  return (
    <View style={styles.figure}>
      <Text numberOfLines={1} style={styles.figureLabel}>{label}</Text>
      <Text
        numberOfLines={1}
        selectable
        style={[
          styles.figureValue,
          tone === 'negative' && styles.negativeValue,
          value === UNAVAILABLE && styles.absent,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

/** Groups the venue's decimal string for display. The value itself is never recomputed here. */
function usd(value: string): string {
  const [whole = '0', fraction] = value.split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const body = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  return negative ? `-$${body}` : `$${body}`;
}

function base(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return formatAmountWithCommas(amountFromBaseUnits(absolute, 9));
}

function usdBase(value: bigint): string {
  return `$${formatAmountWithCommas(amountFromBaseUnits(value, 6))}`;
}

function signedUsdBase(value: bigint): string {
  if (value === 0n) return '$0';
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : '+'}${usdBase(absolute)}`;
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderCurve: 'continuous',
  },
  // `space-between` as well as the mode's own `flex`, because an order card has no mode between the
  // symbol and the side: without it those two would sit together at the left edge.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  symbol: { ...typography.label, flexShrink: 1, color: colors.textPrimary },
  mode: { ...typography.caption, flex: 1, minWidth: 0, color: colors.textMuted },
  long: { ...typography.label, flexShrink: 0, color: colors.positive },
  short: { ...typography.label, flexShrink: 0, color: colors.negative },
  // Each cell is only as wide as its own content and the leftover space is shared, so the row reads
  // as evenly spaced without any cell being cut off. `wrap` is the safety valve rather than the
  // layout: at normal text size the five fit one line, and if the reader scales type up they drop to
  // a second row instead of clipping.
  figures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    rowGap: spacing.sm,
  },
  figure: { minWidth: 0 },
  figureLabel: { ...typography.eyebrow, letterSpacing: 0.5, color: colors.textMuted },
  // Caption size so five figures clear one row, but on the semibold face: these are numbers to
  // scan, and the medium-weight caption reads as body copy.
  figureValue: {
    ...typography.caption,
    fontFamily: fonts.semiBold,
    color: colors.textPrimary,
  },
  negativeValue: { color: colors.negative },
  absent: { color: colors.textMuted },
});
