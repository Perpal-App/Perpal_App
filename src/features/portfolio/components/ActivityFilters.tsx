import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  AnchoredMenu,
  anchorBelow,
  type MenuAnchor,
  type MenuOption,
} from '@/components/ui/AnchoredMenu';
import { PressableScale } from '@/components/ui/PressableScale';
import { SearchField } from '@/components/ui/SearchField';
import type { ActivityKind } from '@/features/portfolio/components/activityItems';
import { colors, gradients, radii, spacing } from '@/theme/tokens';

export type ActivityFilter = 'all' | ActivityKind;

/**
 * The filters, in the order a reader scans them.
 *
 * "All" first because it is the resting state, then the stable activity groups. Fixed here rather than derived
 * from what the history happens to contain: a list that gains and loses options as events arrive
 * would move under the reader's thumb, and an option that currently matches nothing is a useful
 * answer — it says the account has no withdrawals, which a missing option does not.
 */
const FILTERS: readonly MenuOption<ActivityFilter>[] = [
  { id: 'all', label: 'All activity' },
  { id: 'trade', label: 'Trades' },
  { id: 'funding', label: 'Deposits' },
  { id: 'withdrawal', label: 'Withdrawals' },
  { id: 'swap', label: 'Swaps' },
  { id: 'transfer', label: 'Wallet transfers' },
];

/**
 * The name of a filter, for the summary line under the list.
 *
 * Exported because the selection is no longer visible on screen once it lives behind a button — the
 * accent material says *that* something is narrowing the list, and this is what says *what*.
 */
export function activityFilterLabel(filter: ActivityFilter): string {
  return FILTERS.find((option) => option.id === filter)?.label ?? 'All activity';
}

/**
 * Names what the box actually searches.
 *
 * Market and amount, because those are the two things the matcher reaches: the title carries the
 * event and the symbol, the detail carries the size, price and fee. There is deliberately no mention
 * of a transaction hash — the venue's activity feed does not return one, and a placeholder promising
 * a field the matcher cannot see would send a reader looking for a bug.
 */
const SEARCH_PLACEHOLDER = 'Search market or amount';

/** Square, and matched to the search field's own minimum height so the two read as a control pair. */
const BUTTON_SIZE = 46;

const GLYPH_SIZE = 18;

/**
 * Search and filter controls for the history.
 *
 * The four filters used to be a chip strip under the field, which spent a whole row on options that
 * are almost always left at "All" — and the selected chip, being the accent material, made the
 * loudest thing in the section a control nobody had touched. They hang off the button beside the
 * field now: one row instead of two, and the accent only appears once a filter is actually narrowing
 * something.
 *
 * Both controls are cut from the app's action materials. The field is the raised grey the markets
 * search and the table header share, and the button is the same construction — neutral at rest, the
 * accent ramp while a filter is on, so its state is a change of material rather than a badge.
 */
export function ActivityFilters({
  filter,
  onFilterChange,
  onQueryChange,
  query,
}: {
  readonly filter: ActivityFilter;
  readonly onFilterChange: (filter: ActivityFilter) => void;
  readonly onQueryChange: (query: string) => void;
  readonly query: string;
}) {
  // A plain View rather than the pressable itself, because the measurement has to come from a host
  // view: `PressableScale` is an animated component and its ref is not guaranteed to expose the
  // native measure methods.
  const anchorRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [open, setOpen] = useState(false);
  const active = filter !== 'all';

  // Measured on press rather than on layout. The section sits in a scroll view, so the button's
  // window position changes as the reader scrolls and a position captured at layout time would hang
  // the menu wherever the button used to be.
  const openMenu = () => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor(anchorBelow(x, y, width, height));
      setOpen(true);
    });
  };

  return (
    <View style={styles.controls}>
      <View style={styles.field}>
        <SearchField
          flush
          onChangeText={onQueryChange}
          placeholder={SEARCH_PLACEHOLDER}
          value={query}
        />
      </View>

      <View ref={anchorRef}>
        <PressableScale
          accessibilityHint="Chooses which kinds of activity are listed"
          accessibilityLabel={`Filter activity, ${activityFilterLabel(filter)}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={openMenu}
          pressedScale={0.97}
          style={[
            styles.button,
            { borderColor: active ? colors.accentEdge : colors.border },
          ]}
        >
          <LinearGradient
            colors={active ? gradients.accentAction.colors : gradients.surfaceRaise.colors}
            end={{ x: 0.5, y: 1 }}
            locations={active
              ? gradients.accentAction.locations
              : gradients.surfaceRaise.locations}
            start={{ x: 0.5, y: 0 }}
            style={styles.buttonFill}
          >
            <FilterGlyph tone={active ? colors.onAccent : colors.textSecondary} />
          </LinearGradient>
        </PressableScale>
      </View>

      <AnchoredMenu
        anchor={anchor}
        onClose={() => setOpen(false)}
        onSelect={(next) => {
          onFilterChange(next);
          setOpen(false);
        }}
        options={FILTERS}
        selected={filter}
        title="Show"
        visible={open}
      />
    </View>
  );
}

/** Three sliders. A funnel was tried and at 18pt its taper closes into a solid wedge. */
function FilterGlyph({ tone }: { readonly tone: string }) {
  const stroke = {
    fill: 'none',
    stroke: tone,
    strokeLinecap: 'round',
    strokeWidth: 1.9,
  } as const;

  return (
    <Svg height={GLYPH_SIZE} viewBox="0 0 24 24" width={GLYPH_SIZE}>
      <Path {...stroke} d="M4 7.5h16" />
      <Path {...stroke} d="M7 12h10" />
      <Path {...stroke} d="M10 16.5h4" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // `stretch`, so the button takes the field's height rather than a duplicate of its magic number.
  // The field grows with the reader's text size and a fixed square beside it would drift out of
  // alignment exactly when the row is tallest.
  controls: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  field: { flex: 1, minWidth: 0 },
  // Clipped, so the ramp takes the corners. Rimmed at a full point rather than a hairline, which is
  // what makes the edge read as the side of a raised surface instead of an outline around it.
  button: {
    width: BUTTON_SIZE,
    minHeight: BUTTON_SIZE,
    flexShrink: 0,
    overflow: 'hidden',
    borderWidth: 1,
    // `xs`, matching the search field beside it rather than the buttons elsewhere: at this size the
    // larger radius curves the whole edge and the two controls stop looking like a pair.
    borderRadius: radii.xs,
  },
  buttonFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
