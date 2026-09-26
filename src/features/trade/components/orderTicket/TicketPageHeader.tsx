import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors, interfaceType, radii } from '@/theme/tokens';

const BACK_SIZE = 36;
const BACK_GLYPH = 18;
/** Both sides get the same width, so the title stays centred whatever sits on the right. */
const SIDE_WIDTH = 72;

/**
 * Back on the left, the page's name centred, one optional control on the right.
 *
 * A back chevron rather than a close cross: the sheet's own close control sits directly above this row,
 * and two crosses one over the other — one for the page, one for the whole ticket — is a guess the reader
 * should not have to make.
 */
export function TicketPageHeader({
  accessory,
  backDisabled = false,
  onBack,
  title,
}: {
  readonly accessory?: ReactNode;
  /** While something the page started cannot be abandoned, such as a signature in flight. */
  readonly backDisabled?: boolean;
  readonly onBack: () => void;
  readonly title: string;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.side}>
        <PressableScale
          accessibilityHint="Returns to the order"
          accessibilityLabel="Back"
          accessibilityRole="button"
          accessibilityState={{ disabled: backDisabled }}
          disabled={backDisabled}
          hitSlop={8}
          onPress={onBack}
          style={[styles.back, backDisabled && styles.backDisabled]}
        >
          <Ionicons color={colors.textPrimary} name="chevron-back" size={BACK_GLYPH} />
        </PressableScale>
      </View>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</Text>
      <View style={[styles.side, styles.trailing]}>{accessory}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  side: { width: SIDE_WIDTH, flexShrink: 0 },
  trailing: { alignItems: 'flex-end' },
  back: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  backDisabled: { opacity: 0.4 },
  title: { ...interfaceType.headline, flex: 1, minWidth: 0, color: colors.textPrimary, textAlign: 'center' },
});
