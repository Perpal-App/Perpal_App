import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  DepositPlusIcon,
  SwapIcon,
  WithdrawArrowIcon,
} from '@/assets/svg/FundingActionIcons';
import { PressableScale } from '@/components/ui/PressableScale';
import {
  colors,
  fonts,
  gradients,
  motion,
  radii,
  spacing,
  typography,
} from '@/theme/tokens';

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
 * The three funding actions, as graphite chips on the card.
 *
 * Three layers make the material, and none of them is a border:
 *
 * 1. `surfaceRaise` as a vertical ramp — the app's existing raised grey, lighter at the top edge than
 *    at the base, so the fill reads as a curved surface rather than a flat swatch.
 * 2. An inset `boxShadow` in `raisedTopLight` along the top, which is the specular the removed rim
 *    used to fake. Inset rather than a `borderTopWidth`, because a border draws on all four sides or
 *    none and light does not arrive from four directions.
 * 3. An outer `boxShadow` in `raisedHalo` below, which grounds the chip against the violet.
 *
 * Dark on violet is the point: a tinted chip has to fight the card's own ramp to stay legible at both
 * ends of it, where graphite simply sits below the whole ramp and separates everywhere. The halo is
 * what keeps that from reading as a hole punched in the card.
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
      {/* The ramp is a child rather than the pressable itself, so the halo on the parent is not
          clipped by the `overflow` this needs to keep the fill inside the corner. */}
      <LinearGradient
        colors={gradients.surfaceRaise.colors}
        end={{ x: 0.5, y: 1 }}
        locations={gradients.surfaceRaise.locations}
        start={{ x: 0.5, y: 0 }}
        style={styles.fill}
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
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  // `flexBasis: 'auto'` with `flexGrow` and no shrink: each chip starts at its own content width,
  // shares whatever is left over, and moves to the next line rather than compressing its label.
  //
  // Carries the halo and no fill of its own. Offset down and spread slightly negative, so the shadow
  // sits under the chip rather than ringing it — a symmetric blur at this radius reads as a smudge.
  chip: {
    minHeight: CHIP_HEIGHT,
    flexGrow: 1,
    flexBasis: 'auto',
    flexShrink: 0,
    borderRadius: radii.pill,
    boxShadow: [
      {
        blurRadius: 14,
        color: colors.raisedHalo,
        offsetX: 0,
        offsetY: 5,
        spreadDistance: -2,
      },
    ],
  },
  // Clipped to the corner, and carrying the inset top light. A tight blur with a negative spread keeps
  // the highlight on the top edge instead of letting it bleed down into the fill.
  fill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
    boxShadow: [
      {
        blurRadius: 3,
        color: colors.raisedTopLight,
        inset: true,
        offsetX: 0,
        offsetY: 1,
        spreadDistance: -1,
      },
    ],
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
