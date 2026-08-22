import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { Skeleton } from '@/components/feedback/Skeleton';
import { formatCompactTokenPrice } from '@/domain/money/amount';
import { usePacificaFundingHistory } from '@/features/trade/hooks/usePacificaFundingHistory';
import { formatPacificaRatePercent } from '@/integrations/perps/pacifica/pacificaMarketData';
import type { PacificaFundingPoint } from '@/integrations/perps/pacifica/pacificaPublicMarket';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

const WIDTH = 1000;
const HEIGHT = 240;
const TOP = 24;
const BOTTOM = 208;

const RANGES = [
  { id: '24h', label: '24H', limit: 24 },
  { id: '7d', label: '7D', limit: 168 },
  { id: '30d', label: '30D', limit: 720 },
] as const;

type RangeId = (typeof RANGES)[number]['id'];

export function PacificaFundingPanel({
  apiOrigin,
  symbol,
}: {
  readonly apiOrigin: string;
  readonly symbol: string;
}) {
  const [range, setRange] = useState<RangeId>('24h');
  const selected = RANGES.find((candidate) => candidate.id === range) ?? RANGES[0];
  const history = usePacificaFundingHistory(apiOrigin, symbol, selected.limit);
  const latest = history.points.at(-1) ?? null;

  return (
    <View style={styles.panel}>
      <View style={styles.toolbar}>
        <View>
          <Text style={styles.title}>Funding rate</Text>
          <Text accessibilityLiveRegion="polite" style={styles.muted}>
            {history.status === 'ready' ? 'Hourly Pacifica history' :
              history.status === 'error' ? 'Retrying funding history' : 'Loading history'}
          </Text>
        </View>
        <View accessibilityLabel="Funding history range" style={styles.filters}>
          {RANGES.map((option) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: option.id === range }}
              key={option.id}
              onPress={() => setRange(option.id)}
              style={({ pressed }) => [
                styles.filter,
                option.id === range && styles.filterSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={option.id === range ? styles.filterTextSelected : styles.filterText}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {latest === null ? (
        history.status === 'error' ? (
          <Text style={styles.empty}>Pacifica did not return funding history for this market.</Text>
        ) : <Skeleton height={HEIGHT} radius={radii.sm} />
      ) : (
        <>
          <FundingSummary point={latest} />
          <FundingChart points={history.points} />
          <FundingHistory points={history.points} />
        </>
      )}
      <Text style={styles.source}>Source: Pacifica hourly funding history</Text>
    </View>
  );
}

function FundingSummary({ point }: { readonly point: PacificaFundingPoint }) {
  return (
    <View style={styles.summary}>
      <Summary label="Current" rate={point.fundingRate} />
      <Summary label="Next" rate={point.nextFundingRate} />
      <View style={styles.summaryItem}>
        <Text style={styles.muted}>Oracle</Text>
        <Text numberOfLines={1} selectable style={styles.value}>
          {formatCompactTokenPrice(point.oraclePrice)}
        </Text>
      </View>
      <View style={styles.summaryItem}>
        <Text style={styles.muted}>Impact bid / ask</Text>
        <Text numberOfLines={1} selectable style={styles.value}>
          {formatCompactTokenPrice(point.bidImpactPrice)} / {formatCompactTokenPrice(point.askImpactPrice)}
        </Text>
      </View>
    </View>
  );
}

function Summary({ label, rate }: { readonly label: string; readonly rate: string }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.muted}>{label}</Text>
      <Text selectable style={[styles.value, rateTone(rate)]}>
        {formatPacificaRatePercent(rate)}
      </Text>
    </View>
  );
}

function FundingChart({ points }: { readonly points: readonly PacificaFundingPoint[] }) {
  const chart = useMemo(() => buildChart(points), [points]);
  return (
    <View accessibilityLabel="Pacifica hourly funding-rate history" style={styles.chart}>
      <Svg height="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%">
        <Line
          stroke={colors.borderStrong}
          strokeDasharray="12 12"
          strokeWidth={2}
          x1={20}
          x2={WIDTH - 20}
          y1={chart.zeroY}
          y2={chart.zeroY}
        />
        <Path d={chart.path} fill="none" stroke={colors.accentSoft} strokeWidth={5} />
      </Svg>
      <View style={styles.chartLabels}>
        <Text style={styles.muted}>{formatDate(points[0]?.publishedAtMs)}</Text>
        <Text style={styles.muted}>{formatDate(points.at(-1)?.publishedAtMs)}</Text>
      </View>
    </View>
  );
}

function FundingHistory({ points }: { readonly points: readonly PacificaFundingPoint[] }) {
  return (
    <View style={styles.history}>
      <View style={styles.row}>
        <Text style={[styles.header, styles.time]}>Time</Text>
        <Text style={[styles.header, styles.rate]}>Funding</Text>
        <Text style={[styles.header, styles.rate]}>Next</Text>
      </View>
      {[...points].reverse().slice(0, 10).map((point) => (
        <View key={point.publishedAtMs} style={styles.row}>
          <Text selectable style={[styles.cell, styles.time]}>{formatTime(point.publishedAtMs)}</Text>
          <Text selectable style={[styles.cell, styles.rate, rateTone(point.fundingRate)]}>
            {formatPacificaRatePercent(point.fundingRate)}
          </Text>
          <Text selectable style={[styles.cell, styles.rate, rateTone(point.nextFundingRate)]}>
            {formatPacificaRatePercent(point.nextFundingRate)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function buildChart(points: readonly PacificaFundingPoint[]) {
  if (points.length === 0) return { path: '', zeroY: (TOP + BOTTOM) / 2 };
  const values = points.map((point) => point.fundingRateBaseUnits);
  const minimum = values.reduce((result, value) => value < result ? value : result, 0n);
  const maximum = values.reduce((result, value) => value > result ? value : result, 0n);
  const range = maximum - minimum || 1n;
  const xStep = points.length < 2 ? 0 : (WIDTH - 40) / (points.length - 1);
  const y = (value: bigint) => TOP + Number(((maximum - value) * 10_000n) / range) /
    10_000 * (BOTTOM - TOP);
  return {
    path: points.map((point, index) =>
      `${index === 0 ? 'M' : 'L'} ${20 + xStep * index} ${y(point.fundingRateBaseUnits)}`,
    ).join(' '),
    zeroY: y(0n),
  };
}

function rateTone(value: string) {
  if (!/[1-9]/u.test(value)) return styles.neutral;
  return value.startsWith('-') ? styles.negative : styles.positive;
}

function formatDate(value: number | undefined): string {
  return value === undefined ? '--' : new Date(value).toLocaleDateString([], {
    month: 'short', day: 'numeric',
  });
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md, paddingTop: spacing.xs },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.heading, color: colors.textPrimary },
  muted: { ...typography.caption, color: colors.textMuted },
  filters: { flexDirection: 'row', gap: spacing.xxs },
  filter: {
    minWidth: layout.minTouchTarget,
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
  },
  filterSelected: { backgroundColor: colors.surfaceElevated },
  filterText: { ...typography.caption, color: colors.textMuted },
  filterTextSelected: { ...typography.caption, color: colors.accentSoft },
  pressed: { opacity: 0.72 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryItem: { minWidth: '46%', flexGrow: 1 },
  value: { ...typography.label, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  neutral: { color: colors.textPrimary },
  chart: { height: HEIGHT, borderRadius: radii.sm, backgroundColor: colors.surface, overflow: 'hidden' },
  chartLabels: {
    position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: spacing.xs,
    flexDirection: 'row', justifyContent: 'space-between',
  },
  history: { gap: spacing.xxs },
  row: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  header: { ...typography.eyebrow, color: colors.textMuted },
  cell: { ...typography.bodyCompact, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  time: { flex: 1.3 },
  rate: { flex: 1, textAlign: 'right' },
  empty: { ...typography.bodyCompact, paddingVertical: spacing.xxl, color: colors.textMuted, textAlign: 'center' },
  source: { ...typography.caption, color: colors.textMuted },
});
