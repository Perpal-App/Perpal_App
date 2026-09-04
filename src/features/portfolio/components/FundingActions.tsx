import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  DepositPlusIcon,
  SwapIcon,
  WithdrawArrowIcon,
} from '@/assets/svg/FundingActionIcons';
import { PressableScale } from '@/components/ui/PressableScale';
import { colors, fonts, motion, radii, spacing, typography } from '@/theme/tokens';

export type FundingAction = 'deposit' | 'swap' | 'withdraw';

/**
 * Medium: tall enough to hit with the pill's curve eating into both ends, short enough that three of
 * them do not become the card's centre of gravity. `hitSlop` covers the gap to the 48pt minimum
 * rather than inflating a chip that has to fit two others beside it.
 */
const CHIP_HEIGHT = 44;
const HIT_SLOP = 6;
const GLYPH_SIZE = 16;
/**
 * Deeper than the app's 0.96 default, and on a slacker spring.
 *
 * The two together are the gooey part: 6% is enough displacement to feel like the chip gives under a
 * thumb, and `pressGooey` lets it come back through one overshoot instead of stopping dead. Both run
 * as Reanimated shared values on the UI thread, so neither waits on JS to respond or to finish.
 */
const PRESSED_SCALE = 0.94;

/**
 * The three funding actions, as chips on the card.
 *
 * Built to sit *in* the card rather than on it. The rim and the specular sheen went together — both
 * were doing the same job of lifting a control off its surface, which is exactly what made three
 * buttons look like a widget dropped onto the balance. Press feedback carries the affordance the rim
 * was carrying.
 *
 * The fill is `glassRaised`, not the `glassHighlight` the funds panel uses. Matching the panel put the
 * chips at the same value as the card's own upper gradient stop and they disappeared into it; this is
 * the same violet, lighter and half again as dense, which separates at both ends of the ramp without
 * needing an edge to do it.
 *
 * Sized by content and allowed to wrap. Equal thirds would fit "Withdraw" at default type and
 * truncate it at the reader's larger settings; growing from a content floor and wrapping when the row
 * runs out means the label stays whole and the layout gives way instead.
 */
export function FundingActions({
  onAction,
}: {
  readonly onAction: (action: FundingAction) => void;
}) {
  return (
    <View accessibilityRole="toolbar" style={styles.row}>
      <ActionChip
        hint="Opens the deposit options"
        icon={<DepositPlusIcon size={GLYPH_SIZE} />}
        label="Deposit"
        onPress={() => onAction('deposit')}
      />
      <ActionChip
        hint="Opens the swap options"
        icon={<SwapIcon size={GLYPH_SIZE} />}
        label="Swap"
        onPress={() => onAction('swap')}
      />
      <ActionChip
        hint="Opens the withdrawal options"
        icon={<WithdrawArrowIcon size={GLYPH_SIZE} />}
        label="Withdraw"
        onPress={() => onAction('withdraw')}
      />
    </View>
  );
}

function ActionChip({
  hint,
  icon,
  label,
  onPress,
}: {
  readonly hint: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={HIT_SLOP}
      onPress={onPress}
      pressSpring={motion.pressGooey}
      pressedScale={PRESSED_SCALE}
      style={styles.chip}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      >
        {icon}
      </View>
      <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.label}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  // `flexBasis: 'auto'` with `flexGrow` and no shrink: each chip starts at its own content width,
  // shares whatever is left over, and moves to the next line rather than compressing its label.
  chip: {
    minHeight: CHIP_HEIGHT,
    flexGrow: 1,
    flexBasis: 'auto',
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.glassRaised,
  },
  // SemiBold at caption size. The face is named, never reached through `fontWeight` — Poppins ships
  // its weights under legacy family names, so a numeric weight silently resolves to Regular on iOS
  // and to a synthetic bold on Android.
  label: {
    ...typography.caption,
    fontFamily: fonts.semiBold,
    color: colors.textPrimary,
  },
});
