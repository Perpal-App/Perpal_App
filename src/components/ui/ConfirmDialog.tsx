import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ActionButton, type ActionButtonTone } from '@/components/ui/ActionButton';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

/** Scale the card grows from. Close to one: a dialog is an interruption, not an entrance. */
const FROM_SCALE = 0.94;

/**
 * One spring, both directions, and the same physics the anchored menu uses.
 *
 * Damping ratio works out just over 1, so the card settles with no overshoot. A confirmation that
 * bounces reads as playful, which is the wrong register for the last screen before something happens.
 */
const DIALOG_SPRING = { damping: 22, stiffness: 320, mass: 0.6 } as const;

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
 * Deliberately not a sheet. A sheet is a place you go; a confirmation is a question asked where you
 * already are, and moving the screen for it implies the first is happening.
 */
export function ConfirmDialog({
  cancelLabel = 'Cancel',
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  title,
  tone = 'accent',
  visible,
}: {
  readonly cancelLabel?: string;
  readonly confirmLabel: string;
  readonly message: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
  /** `negative` for an action that destroys something. `accent` for one that is merely consequential. */
  readonly tone?: Extract<ActionButtonTone, 'accent' | 'negative'>;
  readonly visible: boolean;
}) {
  const reduceMotion = useReducedMotion();
  // `mounted` keeps the modal in the tree; `progress` is how far open the card is. A dismissal has to
  // finish travelling before the modal can unmount, so one boolean cannot express both.
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.set(reduceMotion ? 1 : withSpring(1, DIALOG_SPRING));
      return;
    }

    if (reduceMotion) {
      progress.set(0);
      setMounted(false);
      return;
    }

    progress.set(withSpring(0, DIALOG_SPRING, (finished) => {
      'worklet';
      if (finished === true) runOnJS(setMounted)(false);
    }));
  }, [progress, reduceMotion, visible]);

  const cardStyle = useAnimatedStyle(() => ({
    // Clamped, because a spring can undershoot past zero and a negative opacity is a warning on some
    // platforms rather than simply invisible.
    opacity: Math.max(progress.value, 0),
    transform: [{ scale: FROM_SCALE + (1 - FROM_SCALE) * progress.value }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: Math.max(progress.value, 0),
  }));

  return (
    <Modal
      // The presentation is ours: `animationType` would run a second, unsprung transition underneath
      // this one and the two would fight over the same frames.
      animationType="none"
      onRequestClose={onCancel}
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
          {/* Tapping outside cancels, which is the same answer the cancel button gives. A dialog that
              can only be dismissed by reading it is a dialog people learn to dismiss without reading. */}
          <Pressable
            accessibilityLabel={cancelLabel}
            accessibilityRole="button"
            onPress={onCancel}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View accessibilityViewIsModal style={[styles.card, cardStyle]}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <ActionButton
              label={cancelLabel}
              onPress={onCancel}
              style={styles.action}
              tone="neutral"
            />
            <ActionButton
              label={confirmLabel}
              onPress={onConfirm}
              style={styles.action}
              tone={tone}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
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
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceElevated,
  },
  title: { ...typography.heading, color: colors.textPrimary },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
  // Equal halves, and the confirm on the right: the same order as the order bar's two sides, so the
  // action that proceeds is always the one under the thumb that reaches furthest.
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
});
