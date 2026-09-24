import { StyleSheet, View } from 'react-native';

import {
  IconButton,
  ToolButton,
} from '@/features/trade/components/ChartToolbarControls';
import { spacing } from '@/theme/tokens';

export type ChartStyle = 'candles' | 'line';

/**
 * What the chart draws and how it is framed: the series controls, then the view controls.
 *
 * Below the chart rather than above it, and not in a scroll view. These sat at the far right of the
 * interval strip's horizontal scroll, past thirteen interval chips — about 300pt beyond the right edge
 * of a phone, reachable only by a sideways drag that nothing advertised. Moving them under the canvas
 * gives them a row of their own that starts at the left margin, which is the only way they are visible
 * without being looked for.
 *
 * The row wraps instead of scrolling, and that is the no-crop guarantee. At the default text size it is
 * one line on every phone the app supports; past about 1.2x it becomes two. Either way every control
 * is on screen, which a scroll view could not promise — and unlike a scroll view, a second line is
 * visible evidence that there is more, rather than a silent overflow.
 *
 * The two groups wrap as units, so the break lands between the series controls and the view controls
 * rather than through the middle of either. That is also why there is no rule between them: the gap and
 * the grouping do the separating, and a hairline that can end up at the start of a wrapped line reads
 * as a mistake.
 *
 * They are pushed to opposite ends rather than packed to the left. Packed left, the row stopped well
 * short of the chart frame above it and left an obvious void under the price axis — five controls
 * huddled at one end of a width they had been given all of. Series controls at the leading edge and
 * view controls at the trailing one give the row the same span as the canvas, which is what makes it
 * read as belonging to the chart rather than as something dropped below it.
 */
export function MarketChartOptions({
  chartStyle,
  onExpand,
  onResetScale,
  onToggleEma,
  onToggleSma,
  onToggleStyle,
  showEma,
  showSma,
}: {
  readonly chartStyle: ChartStyle;
  /** Omitted by the full-screen chart, which is already the expanded view. */
  readonly onExpand?: (() => void) | undefined;
  readonly onResetScale: () => void;
  readonly onToggleEma: () => void;
  readonly onToggleSma: () => void;
  readonly onToggleStyle: () => void;
  readonly showEma: boolean;
  readonly showSma: boolean;
}) {
  return (
    <View accessibilityRole="toolbar" style={styles.row}>
      <View style={styles.group}>
        <ToolButton
          label={chartStyle === 'candles' ? 'Candles' : 'Line'}
          onPress={onToggleStyle}
          selected
        />
        <ToolButton label="SMA 20" onPress={onToggleSma} selected={showSma} />
        <ToolButton label="EMA 20" onPress={onToggleEma} selected={showEma} />
      </View>

      <View style={styles.group}>
        <IconButton icon="scale" label="Reset zoom and price scale" onPress={onResetScale} />
        {onExpand === undefined ? null : (
          <IconButton icon="expand" label="Full-screen chart" onPress={onExpand} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    // Applies per line, so when the row does wrap the view controls sit at the start of the second line
    // rather than being flung to its far end with nothing to be spaced against.
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  group: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
});
