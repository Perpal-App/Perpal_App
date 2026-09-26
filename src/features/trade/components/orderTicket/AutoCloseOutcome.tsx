import { StyleSheet, View } from 'react-native';

import type { AutoCloseEstimate } from '@/features/trade/components/orderTicket/autoClosePnl';
import { OPTION_TEXT_SCALE } from '@/features/trade/components/orderTicket/OptionCard';
import { PnlIndicator } from '@/features/trade/components/orderTicket/PnlIndicator';

/**
 * What the exits come to, on the right of the collapsed auto-close card, in the place the leverage card
 * shows its multiple: the estimated profit at the take profit, over the estimated loss at the stop loss.
 *
 * Stacked in the order the subtitle lists the prices, so the top figure belongs to the first price and the
 * bottom one to the second, and each carries the caret and colour it has in the editor. Two lines at the
 * label's leading come to the header's title and subtitle together, so a card with both exits set is no
 * taller than one with neither, and the keypad under it does not move.
 */
export function AutoCloseOutcome({ estimates }: { readonly estimates: readonly AutoCloseEstimate[] }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.stack}>
      {estimates.map(({ figure, kind }) => (
        <PnlIndicator figure={figure} key={kind} maxFontSizeMultiplier={OPTION_TEXT_SCALE} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Right-aligned, so the two amounts line up on their last digit against the chevron.
  stack: { alignItems: 'flex-end' },
});
