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
import type {
  VelocityPublicMarketState,
} from '@/features/trade/hooks/useVelocityPublicMarket';
import {
  VELOCITY_BOOK_AGGREGATIONS,
  type VelocityBookAggregation,
} from '@/integrations/perps/velocity/velocityPublicMarket';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type AggregationId = `${VelocityBookAggregation}`;

const DEPTH: Record<OrderBookWidth, number> = { full: 12, split: 9 };
const STEP_MENU_WIDTH = 148;

export function VelocityDepthPanel({
  aggregation,
  market,
  onAggregationChange,
  tickSize,
  variant = 'full',
}: {
  readonly aggregation: VelocityBookAggregation;
  readonly market: VelocityPublicMarketState;
  readonly onAggregationChange: (value: VelocityBookAggregation) => void;
  readonly tickSize: string;
  readonly variant?: OrderBookWidth;
}) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const options = useMemo<readonly MenuOption<AggregationId>[]>(
    () => VELOCITY_BOOK_AGGREGATIONS.map((value) => ({
      detail: 'USD',
      id: String(value) as AggregationId,
      label: formatPriceStep(tickSize, value),
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
      <View style={variant === 'split' ? styles.headerStack : styles.headerRow}>
        <Text numberOfLines={1} style={styles.title}>Order book</Text>
        <View style={[styles.headerControls, variant === 'split' && styles.headerControlsSpread]}>
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
          <Text style={styles.unit}>USD</Text>
        </View>
      </View>

      {market.status === 'live' || market.status === 'loading' ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {statusLabel(market.status)}
        </Text>
      )}

      {market.book === null ? (
        <View style={styles.placeholder}>
          <Skeleton height={orderBookTableHeight(depth)} radius={radii.xs} />
        </View>
      ) : (
        <OrderBookTable book={market.book} depth={depth} width={variant} />
      )}

      {variant === 'full' && market.book !== null ? (
        <Text style={styles.source}>
          {`Velocity DLOB · slot ${market.book.slot.toLocaleString()} · ${formatTime(market.book.publishedAtMs)}`}
        </Text>
      ) : null}

      <AnchoredMenu
        anchor={anchor}
        onClose={() => setMenuOpen(false)}
        onSelect={(next) => {
          onAggregationChange(Number(next) as VelocityBookAggregation);
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

function formatPriceStep(tickSize: string, aggregation: VelocityBookAggregation): string {
  const tick = parseAmount(tickSize, 6);
  return formatAmount(amountFromBaseUnits(tick.baseUnits * BigInt(aggregation), 6));
}

function statusLabel(status: VelocityPublicMarketState['status']): string {
  if (status === 'reconnecting') return 'Reconnecting · showing the last book';
  if (status === 'error') return 'Velocity depth unavailable';
  return 'Loading Velocity depth';
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const styles = StyleSheet.create({
  panel: { paddingVertical: spacing.xs },
  headerRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs, paddingHorizontal: spacing.xs, paddingBottom: spacing.xs },
  headerStack: { gap: spacing.xxs, paddingHorizontal: spacing.xs, paddingBottom: spacing.xs },
  headerControls: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.xs },
  headerControlsSpread: { alignSelf: 'stretch', justifyContent: 'space-between' },
  unit: { ...typography.caption, color: colors.textMuted },
  title: { ...typography.label, flexShrink: 1, color: colors.textPrimary },
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
