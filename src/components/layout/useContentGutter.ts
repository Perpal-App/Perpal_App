import { useWindowDimensions } from 'react-native';

import { layout, spacing } from '@/theme/tokens';

/**
 * Share of the content column spent on each margin.
 *
 * Four percent is where a grouped list stops looking inset and starts looking like it belongs to the
 * screen. `layout.screenPadding` is 24 flat, which is right for a screen of running text and too much
 * for a column of cards — on a 390pt phone it was giving 48 of 390 to empty margin.
 */
const GUTTER_RATIO = 0.04;

/**
 * Adaptive horizontal gutter for a column of cards.
 *
 * Derived from the width rather than picked per breakpoint. The app's existing responsive rule is a
 * single boolean flip at `layout.compactWidth`, which is the right shape for a dense data screen that
 * has to choose between two layouts — but here there is only one layout and the question is just how
 * much margin it can afford, which is a continuous quantity. A ratio answers every width, including
 * the ones between the breakpoints.
 *
 * Clamped at both ends so it cannot degenerate: below `spacing.sm` the cards read as touching the
 * screen edge, and above `spacing.lg` the ratio would undo itself on a tablet.
 *
 * Measured against the **column**, not the window. The content column caps at
 * `layout.maxContentWidth`, so on a tablet the margin has to be proportional to the 520pt the cards
 * actually occupy rather than to the 1024pt of glass around them.
 *
 * Reading `width` is deliberate and permitted: it drives a horizontal margin, never a height. Nothing
 * here measures the viewport to size a layout.
 */
export function useContentGutter(): number {
  const { width } = useWindowDimensions();
  const column = Math.min(width, layout.maxContentWidth);

  return Math.round(
    Math.min(Math.max(column * GUTTER_RATIO, spacing.sm), spacing.lg),
  );
}
