import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  DepositPlusIcon,
  SwapIcon,
  WithdrawArrowIcon,
} from '@/assets/svg/FundingActionIcons';
import { RaisedChip } from '@/components/ui/RaisedChip';
import { colors, fonts, spacing, typography } from '@/theme/tokens';

export type FundingAction = 'deposit' | 'swap' | 'withdraw';

/**
 * Medium: tall enough to hit with the pill's curve eating into both ends, short enough that three of
 * them do not become the card's centre of gravity. `RaisedChip` carries `hitSlop` for the gap to the
 * 48pt minimum, rather than inflating a chip that has to fit two others beside it.
 */
const CHIP_HEIGHT = 44;
const GLYPH_SIZE = 16;

/**
 * The three funding actions, as raised chips on the card.
 *
 * The material — ramp, inset top light, halo — lives in `RaisedChip`, shared with the assets control in
 * the card's header. Only the sizing and the content are here.
 *
 * Sized by content and allowed to wrap. Equal thirds would fit "Withdraw" at default type and truncate
 * it at the reader's larger settings; growing from a content floor and wrapping when the row runs out
 * means the label stays whole and the layout gives way instead.
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
    <RaisedChip
      accessibilityHint={hint}
      accessibilityLabel={label}
      onPress={onPress}
      pressEffect="gooey"
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
    </RaisedChip>
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
