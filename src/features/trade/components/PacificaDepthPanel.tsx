import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Skeleton } from '@/components/feedback/Skeleton';
import {
  AnchoredMenu,
  anchorBelow,
  type MenuAnchor,
  type MenuOption,
} from '@/components/ui/AnchoredMenu';
import { ChevronDown } from '@/components/ui/ChevronDown';
import { amountFromBaseUnits, formatAmount, parseAmount } from '@/domain/money/amount';
import {
  OrderBookTable,
  orderBookTableHeight,
  type OrderBookWidth,
} from '@/features/trade/components/OrderBookTable';
import {
  usePacificaPublicMarket,
  type PacificaPublicMarketStatus,
} from '@/features/trade/hooks/usePacificaPublicMarket';
import {
  PACIFICA_BOOK_AGGREGATIONS,
  type PacificaBookAggregation,
} from '@/integrations/perps/pacifica/pacificaPublicMarket';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type AggregationId = `${PacificaBookAggregation}`;

/**
 * Levels rendered per side, by how much room the panel has.
 *
 * Nine a side lands the split book's last row near the order ticket's, which is what
 * makes the two columns read as one workspace instead of two unrelated lists. The wide
 * tab can afford a few more.
 */
const DEPTH: Record<OrderBookWidth, number> = { full: 12, split: 9 };

/** Width of the price-step menu, enough for the largest aggregated step. */
const STEP_MENU_WIDTH = 148;

/**
 * Pacifica's order book.
 *
 * Price, cumulative size, and where the depth sits between the two sides — that is what a
 * book is read for while an order is being sized, and beside the ticket that is all it
 * shows. The venue's name and the snapshot's clock belong to the dedicated tab: a time
 * ticking once a second next to a field the reader is typing into is just movement. A feed
 * that is not live says so in words, in both places.
 */
export function PacificaDepthPanel({
  apiOrigin,
  symbol,
  tickSize,
  variant = 'full',
  wsOrigin,
}: {
  readonly apiOrigin: string;
  readonly symbol: string;
  readonly tickSize: string;
  readonly variant?: OrderBookWidth;
  readonly wsOrigin: string;
}) {
  const [aggregation, setAggregation] = useState<PacificaBookAggregation>(1);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const market = usePacificaPublicMarket(apiOrigin, wsOrigin, symbol, aggregation);
  const book = market.book;
  const options = useMemo<readonly MenuOption<AggregationId>[]>(
    () => PACIFICA_BOOK_AGGREGATIONS.map((value) => ({
      id: String(value) as AggregationId,
      label: formatPriceStep(tickSize, value),
      detail: 'USD',
    })),
    [tickSize],
  );
  const selectedId = String(aggregation) as AggregationId;
  const selectedStep = options.find((option) => option.id === selectedId)?.label ?? tickSize;
  const depth = DEPTH[variant];

  const openMenu = () => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor(anchorBelow(x, y, width, height, STEP_MENU_WIDTH));
      setMenuOpen(true);
    });
  };

  return (
    <View style={styles.panel}>
      <View style={styles.toolbar}>
        <Text numberOfLines={1} style={styles.title}>Order book</Text>
        <View ref={anchorRef}>
          <Pressable
            accessibilityHint="Groups the book by a larger price step"
            accessibilityLabel={`Price step ${selectedStep} USD`}
            accessibilityRole="button"
            accessibilityState={{ expanded: menuOpen }}
            hitSlop={10}
            onPress={openMenu}
            style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={styles.stepValue}>{selectedStep}</Text>
            <ChevronDown size={12} />
          </Pressable>
        </View>
      </View>

      {market.status === 'live' || market.status === 'loading' ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {statusLabel(market.status)}
        </Text>
      )}

      {book === null ? (
        <View style={styles.placeholder}>
          <Skeleton height={orderBookTableHeight(depth)} radius={radii.xs} />
        </View>
      ) : (
        <OrderBookTable book={book} depth={depth} width={variant} />
      )}

      {variant === 'full' && book !== null ? (
        <Text style={styles.source}>{`Pacifica book · ${formatTime(book.publishedAtMs)}`}</Text>
      ) : null}

      <AnchoredMenu
        anchor={anchor}
        onClose={() => setMenuOpen(false)}
        onSelect={(next) => {
          setAggregation(Number(next) as PacificaBookAggregation);
          setMenuOpen(false);
        }}
        options={options}
        selected={selectedId}
        title="Price step"
        visible={menuOpen}
      />
    </View>
  );
}

function formatPriceStep(tickSize: string, aggregation: PacificaBookAggregation): string {
  const tick = parseAmount(tickSize, 10);
  return formatAmount(amountFromBaseUnits(tick.baseUnits * BigInt(aggregation), tick.decimals));
}

function statusLabel(status: PacificaPublicMarketStatus): string {
  if (status === 'reconnecting') return 'Reconnecting · showing the last book';
  if (status === 'error') return 'Pacifica depth unavailable';
  return 'Loading Pacifica depth';
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const styles = StyleSheet.create({
  // The panel owns its own gutter rather than taking one from the container, so the
  // toolbar, the rows and the footnote all sit on the same two edges.
  panel: { paddingVertical: spacing.xs },
  toolbar: { minHeight: 32, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: spacing.xs, rowGap: spacing.xxs, paddingHorizontal: spacing.xs, paddingBottom: spacing.xs },
  title: { ...typography.label, flexShrink: 1, color: colors.textPrimary },
  // One line, one value. The old control spelled "Price step" above the number, which cost
  // the toolbar a second row on every phone to label a control that labels itself again on
  // the way in.
  //
  // The hairline is what makes it a control: on its own the raised fill read as a shadow
  // under the number rather than a button around it. The right inset is tighter than the
  // left because the chevron is drawn inside its own box and brings padding with it.
  stepButton: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingLeft: spacing.xs,
    paddingRight: spacing.xxs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.xs,
    backgroundColor: colors.surfaceElevated,
  },
  stepValue: { ...typography.caption, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.72 },
  status: { ...typography.caption, paddingHorizontal: spacing.xs, color: colors.textSecondary },
  placeholder: { paddingHorizontal: spacing.xs },
  source: { ...typography.caption, paddingTop: spacing.xs, paddingHorizontal: spacing.xs, color: colors.textMuted },
});
