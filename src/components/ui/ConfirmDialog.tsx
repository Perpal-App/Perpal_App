import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { ActionButton, type ActionButtonTone } from '@/components/ui/ActionButton';
import { PressableScale } from '@/components/ui/PressableScale';
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
type ConfirmDialogBody =
  | { readonly children: ReactNode; readonly message?: never }
  | { readonly children?: never; readonly message: string };

type ConfirmDialogProps = ConfirmDialogBody & {
  readonly cancelLabel?: string;
  readonly confirmLabel: string;
  readonly confirmLoading?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
  /** `negative` for an action that destroys something. `accent` for one that is merely consequential. */
  readonly tone?: Extract<ActionButtonTone, 'accent' | 'negative'>;
  readonly visible: boolean;
};

export function ConfirmDialog({
  cancelLabel = 'Cancel',
  children,
  confirmLabel,
  confirmLoading = false,
  message,
  onCancel,
  onConfirm,
  title,
  tone = 'accent',
  visible,
}: ConfirmDialogProps) {
  const reduceMotion = useReducedMotion();
  const requestCancel = () => {
    if (!confirmLoading) onCancel();
  };
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
      onRequestClose={requestCancel}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
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
          style={[styles.card, cardStyle]}
        >
          <View style={styles.titleRow}>
            <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            <PressableScale
              accessibilityLabel={`Close ${title}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: confirmLoading }}
              disabled={confirmLoading}
              hitSlop={12}
              onPress={requestCancel}
              pressedScale={0.94}
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
          <View style={styles.actions}>
            <ActionButton
              disabled={confirmLoading}
              label={cancelLabel}
              onPress={requestCancel}
              style={styles.action}
              tone="neutral"
            />
            <ActionButton
              label={confirmLabel}
              loading={confirmLoading}
              onPress={onConfirm}
              style={styles.action}
              tone={tone}
            />
          </View>
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
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceElevated,
  },
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
});
