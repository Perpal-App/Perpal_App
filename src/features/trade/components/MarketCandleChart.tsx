import { StyleSheet, Text, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import type { MarketHistoryStatus } from '@/features/trade/hooks/usePythMarketHistory';
import type { MarketCandle } from '@/integrations/perps/markets/pythHistory';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const MAX_VISIBLE_CANDLES = 72;
const CHART_HEIGHT = 224;
const PADDING = { top: 14, right: 58, bottom: 26, left: 8 } as const;

export function MarketCandleChart({
  candles,
  status,
  width,
}: {
  readonly candles: readonly MarketCandle[];
  readonly status: MarketHistoryStatus;
  readonly width: number;
}) {
  const visible = candles.slice(-MAX_VISIBLE_CANDLES);

  if (visible.length === 0) {
    return (
      <View
        accessibilityLiveRegion="polite"
        style={[styles.placeholder, { width }]}
      >
        <Text style={styles.placeholderText}>
          {status === 'loading' ? 'Loading Pyth candles' : 'Price history unavailable'}
        </Text>
      </View>
    );
  }

  const high = Math.max(...visible.map((candle) => candle.high));
  const low = Math.min(...visible.map((candle) => candle.low));
  const range = high === low ? Math.max(high * 0.001, 0.000001) : high - low;
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const step = plotWidth / visible.length;
  const bodyWidth = Math.max(2, Math.min(6, step * 0.58));
  const y = (price: number) =>
    PADDING.top + ((high - price) / range) * plotHeight;
  const x = (index: number) => PADDING.left + step * index + step / 2;
  const gridPrices = [0, 1, 2, 3].map((index) => high - (range * index) / 3);
  const first = visible[0];
  const middle = visible[Math.floor(visible.length / 2)];
  const last = visible[visible.length - 1];

  return (
    <View
      accessible
      accessibilityLabel={`Pyth candlestick chart. High ${formatPrice(high)}. Low ${formatPrice(low)}.`}
      style={styles.frame}
    >
      <Svg height={CHART_HEIGHT} width={width}>
        {gridPrices.map((price) => {
          const lineY = y(price);
          return (
            <G key={price}>
              <Line
                stroke={colors.border}
                strokeWidth={StyleSheet.hairlineWidth}
                x1={PADDING.left}
                x2={width - PADDING.right}
                y1={lineY}
                y2={lineY}
              />
              <SvgText
                fill={colors.textMuted}
                fontSize={10}
                textAnchor="end"
                x={width - 4}
                y={lineY + 3}
              >
                {formatPrice(price)}
              </SvgText>
            </G>
          );
        })}

        {visible.map((candle, index) => {
          const candleX = x(index);
          const openY = y(candle.open);
          const closeY = y(candle.close);
          const rising = candle.close >= candle.open;
          const tone = rising ? colors.positive : colors.negative;
          const top = Math.min(openY, closeY);
          const height = Math.max(1, Math.abs(closeY - openY));

          return (
            <G key={candle.timeMs}>
              <Line
                stroke={tone}
                strokeWidth={1}
                x1={candleX}
                x2={candleX}
                y1={y(candle.high)}
                y2={y(candle.low)}
              />
              <Rect
                fill={tone}
                height={height}
                width={bodyWidth}
                x={candleX - bodyWidth / 2}
                y={top}
              />
            </G>
          );
        })}

        {[first, middle, last].map((candle, index) => candle === undefined ? null : (
          <SvgText
            fill={colors.textMuted}
            fontSize={10}
            key={`${candle.timeMs}:${index}`}
            textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}
            x={index === 0 ? PADDING.left : index === 2 ? width - PADDING.right : width / 2}
            y={CHART_HEIGHT - 7}
          >
            {formatTime(candle.timeMs)}
          </SvgText>
        ))}
      </Svg>
      {status === 'stale' ? <Text style={styles.stale}>History reconnecting</Text> : null}
    </View>
  );
}

function formatPrice(value: number): string {
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  placeholder: {
    height: CHART_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  placeholderText: { ...typography.bodyCompact, color: colors.textMuted },
  stale: {
    ...typography.caption,
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    color: colors.textMuted,
  },
});
