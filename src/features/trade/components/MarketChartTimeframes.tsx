import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import {
  AnchoredMenu,
  anchorBelow,
  type MenuAnchor,
  type MenuOption,
} from '@/components/ui/AnchoredMenu';
import { ChevronDown } from '@/components/ui/ChevronDown';
import {
  CHART_ICON_SIZE,
  ToolButton,
} from '@/features/trade/components/ChartToolbarControls';
import {
  MARKET_TIMEFRAMES,
  type MarketTimeframe,
} from '@/integrations/perps/pacifica/pacificaHistory';
import { colors, layout, radii, spacing } from '@/theme/tokens';

/**
 * Width of an interval chip, fixed rather than sized to its label.
 *
 * Fixed is the whole mechanism: the strip works out how many intervals fit by dividing its own
 * measured width, and that division is only exact if every chip is the same known width. 40 rather
 * than the 44 a label chip takes, because the difference is one more interval on a phone — at 44 a
 * 375pt screen fits six intervals and the opener, at 40 it fits seven.
 *
 * 40 wide by the row's 48 tall is 1920pt² against the 1936 of a 44 square, so nothing is lost on the
 * touch target; it is the same area in a shape that suits a thumb better. `AnchoredMenu` already runs
 * 40pt rows on the same reasoning: these select a view, and a mis-tap costs one tap to undo.
 */
const CHIP_WIDTH = 40;
const CHIP_GAP = spacing.xxs;

/**
 * Which intervals earn a place on the strip when not all of them fit, most deserving first.
 *
 * A `Record` rather than a list so the type system checks it covers the union — an interval left out
 * of the ranking would otherwise silently sort to the front.
 *
 * `15m` leads because it is the interval the workspace opens on, so the strip can never be in a state
 * where the selected chip had to displace another. After it the order is the intervals a perpetuals
 * trader actually reaches for — the intraday set, then the swing set, then the odd ones. `30m`, `2h`,
 * `8h` and `12h` come last not because they are useless but because each sits between two intervals
 * already on the strip, so their absence costs the least.
 *
 * `1M` — the `ALL` chip — is ranked ahead of `1w`, which is the one place this is not ordered by how
 * often an interval is used. The two are close in usefulness and `ALL` is the end of the scale, so on a
 * phone that can show seven the row wants to finish on it: a strip that runs out at `1D` reads as
 * though the market has no longer view, where `1m … 1D ALL` reads as a complete range with a step
 * missing from the middle.
 *
 * The strip does not render in this order. It picks by it and then renders ascending, so the row always
 * reads as a scale whichever intervals made it on.
 */
const PRIORITY: Record<MarketTimeframe, number> = {
  '15m': 0,
  '1h': 1,
  '5m': 2,
  '4h': 3,
  '1d': 4,
  '1m': 5,
  '1M': 6,
  '1w': 7,
  '3m': 8,
  '30m': 9,
  '12h': 10,
  '2h': 11,
  '8h': 12,
};

const RANKED = [...MARKET_TIMEFRAMES].sort((a, b) => PRIORITY[a.id] - PRIORITY[b.id]);

/**
 * Spelled out for the menu, where there is room for words and no reason to make the reader expand
 * `12h` themselves. The detail is the muted figure on the right, so the row that is picked is
 * recognisable as the chip it becomes on the strip.
 *
 * `1M` is the one row where the two say different things, because its chip is `ALL` and a reader is
 * owed the resolution behind that: monthly candles over a 300-month window, which is the whole of any
 * Pacifica market's history. See the entry's note in `pacificaHistory`.
 */
const MENU_ROWS: Record<MarketTimeframe, { readonly detail: string; readonly label: string }> = {
  '1m': { detail: '1m', label: '1 minute' },
  '3m': { detail: '3m', label: '3 minutes' },
  '5m': { detail: '5m', label: '5 minutes' },
  '15m': { detail: '15m', label: '15 minutes' },
  '30m': { detail: '30m', label: '30 minutes' },
  '1h': { detail: '1h', label: '1 hour' },
  '2h': { detail: '2h', label: '2 hours' },
  '4h': { detail: '4h', label: '4 hours' },
  '8h': { detail: '8h', label: '8 hours' },
  '12h': { detail: '12h', label: '12 hours' },
  '1d': { detail: '1D', label: '1 day' },
  '1w': { detail: '1W', label: '1 week' },
  '1M': { detail: 'monthly', label: 'All time' },
};

function menuOption(item: (typeof MARKET_TIMEFRAMES)[number]): MenuOption<MarketTimeframe> {
  return { ...MENU_ROWS[item.id], id: item.id };
}

/**
 * The chart's interval strip: the intervals that fit, and a way to the ones that do not.
 *
 * This was a horizontal `ScrollView` carrying all thirteen intervals plus the series and view
 * controls, which came to 632pt of content against the 336pt a 360pt phone gives it. Practically
 * everything past `30m` was off the right edge with nothing to say so — a scroll view gives no hint
 * that it has more in it, so the daily and weekly intervals were simply missing as far as the reader
 * was concerned. The series and view controls were further right again, past all thirteen.
 *
 * Nothing scrolls now. The strip measures itself, renders as many intervals as fit whole, and puts the
 * ones that did not fit — only those — in a menu behind the opener at its end. So the row is never
 * cropped and never hides anything: what is not on it is one tap away, and the menu is exactly the
 * remainder rather than a second copy of the strip.
 *
 * The consequence of that is the menu has no tick, because the selected interval is always on the strip
 * and so never in the menu. That is the right reading of it: these are intervals to switch to, not a
 * place the current one could be hiding.
 *
 * Which intervals those are follows from the width, so a larger phone, a tablet, or this chart in
 * landscape each get more of them. Measured against this screen's gutters that comes to
 * `1m 5m 15m 1h 4h 1D` at 360pt, `1m 5m 15m 1h 4h 1D ALL` from 375pt, plus `1W` from 430pt, and every
 * interval with no opener at all past 568pt of strip — a tablet, or this chart in landscape.
 *
 * The selected interval is always on the strip whatever its rank: picking `8h` from the menu
 * substitutes it for the least-used visible chip rather than leaving the row with no selection showing.
 */
export function MarketChartTimeframes({
  onSelect,
  selected,
}: {
  readonly onSelect: (timeframe: MarketTimeframe) => void;
  readonly selected: MarketTimeframe;
}) {
  // Null until the row has been laid out. The row's width does not depend on its children — it spans
  // the column either way — so a first frame with nothing in it settles into the right number of chips
  // without moving anything. A guessed count would have to be wrong on some device and correct itself
  // visibly; `null` is one frame of an empty strip that is already holding its own height.
  const [width, setWidth] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const opener = useRef<View>(null);
  const strip = useMemo(
    () => width === null ? null : fitTimeframes(width, selected),
    [selected, width],
  );

  const openMenu = () => {
    opener.current?.measureInWindow((x, y, openerWidth, height) => {
      setAnchor(anchorBelow(x, y, openerWidth, height));
      setMenuOpen(true);
    });
  };

  return (
    // The menu is a sibling of the strip rather than a child of it, and deliberately. A `Modal`
    // measures as a zero-size view in its parent, and in a row with a `gap` a zero-size child still
    // earns its gap — 4pt of phantom content past a width the strip just divided exactly, which is
    // enough to clip the last chip on a screen where that division comes out even.
    <View>
      <View
        accessibilityRole="tablist"
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        style={styles.strip}
      >
        {strip === null ? null : strip.timeframes.map((item) => (
          <ToolButton
            key={item.id}
            label={item.label}
            onPress={() => onSelect(item.id)}
            selected={item.id === selected}
            width={CHIP_WIDTH}
          />
        ))}

        {strip === null || strip.hidden.length === 0 ? null : (
          <View ref={opener}>
            <Pressable
              accessibilityHint="Lists every interval this market publishes"
              accessibilityLabel="More intervals"
              accessibilityRole="button"
              accessibilityState={{ expanded: menuOpen }}
              onPress={openMenu}
              style={({ pressed }) => [
                styles.opener,
                menuOpen && styles.openerOpen,
                pressed && styles.pressed,
              ]}
            >
              <ChevronDown color={menuOpen ? colors.accentSoft : colors.textMuted} size={16} />
            </Pressable>
          </View>
        )}
      </View>

      <AnchoredMenu
        anchor={anchor}
        onClose={() => setMenuOpen(false)}
        onSelect={(next) => {
          setMenuOpen(false);
          if (next !== selected) onSelect(next);
        }}
        options={strip?.hidden ?? []}
        selected={selected}
        title="More intervals"
        visible={menuOpen}
      />
    </View>
  );
}

/**
 * Which intervals the strip can show at this width, and which are left for the menu.
 *
 * `n` chips with a gap between each occupy `n * (CHIP_WIDTH + CHIP_GAP) - CHIP_GAP`, so adding one
 * gap to the width before dividing counts the run without its trailing gap. Flooring is what
 * guarantees no crop: a chip that does not fit whole is not rendered.
 *
 * One slot pays for the opener unless every interval already fits, in which case `hidden` is empty and
 * the opener is not drawn — there would be nothing behind it.
 *
 * The two sets partition the catalog: every interval is in exactly one of them, which is the property
 * that lets the menu be the remainder rather than a duplicate of the strip.
 */
function fitTimeframes(width: number, selected: MarketTimeframe): {
  readonly hidden: readonly MenuOption<MarketTimeframe>[];
  readonly timeframes: readonly (typeof MARKET_TIMEFRAMES)[number][];
} {
  const slots = Math.max(2, Math.floor((width + CHIP_GAP) / (CHIP_WIDTH + CHIP_GAP)));
  if (slots >= MARKET_TIMEFRAMES.length) {
    return { hidden: [], timeframes: MARKET_TIMEFRAMES };
  }

  const count = slots - 1;
  const chosen = new Set(RANKED.slice(0, count).map((item) => item.id));
  if (!chosen.has(selected)) {
    // The last one in by rank gives up its place, so a selection made in the menu is visible on the
    // strip without the row growing past the width it just measured.
    chosen.delete(RANKED[count - 1]?.id ?? selected);
    chosen.add(selected);
  }

  // Both filtered from the canonical list rather than sorted, so the strip and the menu are each
  // ascending and an interval keeps the same neighbours wherever it appears.
  return {
    hidden: MARKET_TIMEFRAMES.filter((item) => !chosen.has(item.id)).map(menuOption),
    timeframes: MARKET_TIMEFRAMES.filter((item) => chosen.has(item.id)),
  };
}

const styles = StyleSheet.create({
  strip: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: CHIP_GAP,
  },
  opener: {
    width: CHIP_WIDTH,
    height: CHART_ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  openerOpen: { backgroundColor: colors.surfaceElevated },
  pressed: { opacity: 0.72 },
});
