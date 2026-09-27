import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { useDialogMorph, type DialogOrigin } from '@/components/motion/useDialogMorph';
import { ActionButton, type ActionButtonTone } from '@/components/ui/ActionButton';
import { PressableScale } from '@/components/ui/PressableScale';
import { colors, layout, motion, radii, spacing, typography } from '@/theme/tokens';

export type { DialogOrigin } from '@/components/motion/useDialogMorph';

/** The card's resting corner, which the morph eases into from a full round. */
const CARD_RADIUS = radii.lg;

/**
 * The app's confirmation, in the app's own materials.
 *
 * It replaces `Alert.alert`, which draws the platform's dialog: on Android a grey slab with teal text
 * buttons, in a font and a palette that belong to no part of this app. That is acceptable for a
 * developer warning and not for the control that rotates a wallet — the last thing a reader sees before
 * a consequential action should not look like it came from somewhere else.
 *
 * Both actions are real buttons rather than tinted text, so the destructive one can carry the app's red
 * material and the pair can be told apart at a glance instead of by reading them.
 *
 * Given the point it was asked from, it grows out of that control and goes back into it when dismissed;
 * see `useDialogMorph`. Without one it rises in place.
 *
 * Deliberately not a sheet. A sheet is a place you go; a confirmation is a question asked where you
 * already are, and moving the screen for it implies the first is happening.
 */
type ConfirmDialogBody =
  | { readonly children: ReactNode; readonly message?: never }
  | { readonly children?: never; readonly message: string };

type ConfirmDialogProps = ConfirmDialogBody & {
  /**
   * How the two answers sit. `stack`, the default: full width, one over the other, which a long
   * consequential label — "Verify and recover" — needs to stay whole at any text size. `row`: side by side
   * as fully rounded capsules, for a pair of short labels, where a row reads faster than a stack. Both keep
   * the raised material every action in the app is cut from.
   */
  readonly actions?: 'row' | 'stack';
  readonly cancelLabel?: string;
  readonly confirmLabel: string;
  readonly confirmLoading?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  /** Where on screen the dialog was asked from, in window coordinates, to grow out of and go back into. */
  readonly origin?: DialogOrigin | null;
  readonly title: string;
  /** `negative` for an action that destroys something. `accent` for one that is merely consequential. */
  readonly tone?: Extract<ActionButtonTone, 'accent' | 'negative'>;
  readonly visible: boolean;
};

export function ConfirmDialog({
  actions = 'stack',
  cancelLabel = 'Cancel',
  children,
  confirmLabel,
  confirmLoading = false,
  message,
  onCancel,
  onConfirm,
  origin = null,
  title,
  tone = 'accent',
  visible,
}: ConfirmDialogProps) {
  const inline = actions === 'row';
  const morph = useDialogMorph({ origin, radius: CARD_RADIUS, visible });
  // Each answer is felt as well as seen: a light tick for backing out, a firmer tap for going ahead, a
  // firmer one again when what goes ahead destroys something. iOS only, as everywhere in the app.
  const requestCancel = () => {
    if (confirmLoading) return;
    if (Platform.OS === 'ios') void Haptics.selectionAsync();
    onCancel();
  };
  const requestConfirm = () => {
    if (Platform.OS === 'ios') {
      void Haptics.impactAsync(tone === 'negative'
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light);
    }
    onConfirm();
  };

  return (
    <Modal
      // The presentation is ours: `animationType` would run a second, unsprung transition underneath
      // this one and the two would fight over the same frames.
      animationType="none"
      onRequestClose={requestCancel}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={morph.mounted}
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, morph.scrimStyle]}>
          {/* Tapping outside cancels, which is the same answer the cancel button gives. A dialog that
              can only be dismissed by reading it is a dialog people learn to dismiss without reading. */}
          <Pressable
            accessibilityLabel={cancelLabel}
            accessibilityRole="button"
            accessibilityState={{ disabled: confirmLoading }}
            disabled={confirmLoading}
            onPress={requestCancel}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View
          accessibilityViewIsModal
          onAccessibilityEscape={requestCancel}
          onLayout={morph.onCardLayout}
          style={[styles.card, morph.cardStyle]}
        >
          {/* Everything inside fades on its own layer, late on the way in and early on the way out, so
              the card is only ever seen full of its contents or as a clean shape. */}
          <Animated.View style={[styles.body, morph.contentStyle]}>
            <View style={styles.titleRow}>
              <Text accessibilityRole="header" style={styles.title}>{title}</Text>
              <PressableScale
                accessibilityLabel={`Close ${title}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: confirmLoading }}
                disabled={confirmLoading}
                hitSlop={12}
                onPress={requestCancel}
                // Pinches in, then springs back just past round: the same give the buttons below have.
                pressRebound={0.45}
                pressSpring={motion.pressGooey}
                pressedScale={0.88}
                style={styles.close}
              >
                <CloseIcon />
              </PressableScale>
            </View>
            <View style={styles.content}>
              {message === undefined ? children : (
                <Text selectable style={styles.message}>{message}</Text>
              )}
            </View>
            {/* Both answers squash under the finger and spring back through a small wobble on release,
                the press every raised action in the app gives. The answer still lands on release;
                nothing waits for the wobble. */}
            <View style={[styles.actions, inline && styles.actionsRow]}>
              <ActionButton
                disabled={confirmLoading}
                gooey
                label={cancelLabel}
                onPress={requestCancel}
                {...(inline ? { radius: radii.pill } : {})}
                style={inline ? styles.actionInline : styles.action}
                tone={inline ? 'secondary' : 'neutral'}
              />
              <ActionButton
                gooey
                label={confirmLabel}
                loading={confirmLoading}
                onPress={requestConfirm}
                {...(inline ? { radius: radii.pill } : {})}
                style={inline ? styles.actionInline : styles.action}
                tone={tone}
              />
            </View>
          </Animated.View>
        </Animated.View>
      </SafeAreaView>
    </Modal>
  );
}

function CloseIcon() {
  return (
    <Svg accessibilityElementsHidden height={18} viewBox="0 0 24 24" width={18}>
      <Path
        d="M6 6 18 18M18 6 6 18"
        fill="none"
        stroke={colors.textSecondary}
        strokeLinecap="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: layout.screenPadding },
  // Its own layer, so the fade never touches the card's opacity: dimming the card as it grew would make
  // it read as a projection rather than as a surface.
  scrim: { backgroundColor: 'rgba(5, 5, 9, 0.72)' },
  card: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '100%',
    flexShrink: 1,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: CARD_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceElevated,
  },
  body: { flexShrink: 1, gap: spacing.sm },
  titleRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: { ...typography.heading, flex: 1, color: colors.textPrimary },
  close: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  content: { flexShrink: 1 },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
  // Full-width actions survive small screens and large text without shortening a consequential label.
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  action: { width: '100%' },
  // Backing out on the left and going ahead on the right, in equal halves, so neither answer is the
  // bigger target.
  actionsRow: { flexDirection: 'row' },
  // Equal halves at one fixed height, whatever either label measures.
  actionInline: { flex: 1, minWidth: 0, height: layout.minTouchTarget },
});
