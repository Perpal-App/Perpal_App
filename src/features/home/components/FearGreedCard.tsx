import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { SentimentFace, type SentimentMood } from '@/assets/svg/SentimentFace';
import { Skeleton, SkeletonText } from '@/components/feedback/Skeleton';
import {
  GAUGE_HEIGHT,
  SentimentGauge,
  TICK_RADIUS,
} from '@/features/home/components/SentimentGauge';
import type { FearGreedState } from '@/features/home/hooks/useFearGreed';
import type { FearGreedClassification } from '@/integrations/market-data/fearGreed';
import { colors, fonts, gradients, motion, radii, spacing, typography } from '@/theme/tokens';

/** Match the provider's explicit classification instead of inventing score boundaries. */
const PRESENTATION: Record<FearGreedClassification, {
  readonly mood: SentimentMood;
  readonly tone: string;
}> = {
  'Extreme Fear': { mood: 'extreme-fear', tone: colors.sentimentExtremeFear },
  Fear: { mood: 'fear', tone: colors.sentimentFear },
  Neutral: { mood: 'neutral', tone: colors.sentimentNeutral },
  Greed: { mood: 'greed', tone: colors.sentimentGreed },
  'Extreme Greed': { mood: 'extreme-greed', tone: colors.sentimentExtremeGreed },
};

const FACE_SIZE = 18;

/**
 * Badge corner, matched to the card's by eye rather than by construction.
 *
 * The concentric rule — inner radius equals outer radius less the gap between them — was tried
 * first and is wrong here. It holds when the gap is small next to the outer radius; this gap is
 * a body padding of 12 against a card radius of 16, which leaves 4, and 4 on a chip this size
 * reads as a square with clipped corners rather than as the card's rounding continued inward.
 *
 * `sm` is a third of the badge's height: clearly rounded, clearly not a capsule, and close
 * enough in character to the card's `md` that the two read as the same family. Small shapes need
 * proportionally more radius than large ones to look equally rounded, which is the thing the
 * concentric rule does not account for.
 */
const BADGE_RADIUS = radii.sm;
/** What the badge measures once it has content: its tallest child plus its own padding. */
const BADGE_PAD_V = spacing.xxs;
const BADGE_HEIGHT = Math.max(FACE_SIZE, typography.label.lineHeight) + BADGE_PAD_V * 2;



/**
 * Today's Fear and Greed reading.
 *
 * A block on the screen's gradient rather than a card on it, matching the balance above: neither
 * has a container, and the spacing between them is what separates them.
 *
 * The reading's colour appears in three places, all of which are about the reading itself — the
 * face, the word beside it, and the filled part of the gauge. Nothing structural is tinted. That
 * is also why the gauge is one colour rather than a red-to-green ramp: a ramp shows all five bands
 * at full strength and leaves the reader to work out which is current, while one colour filled to
 * the reading states it.
 *
 * The scale's ends are unlabelled. The word in the badge names the band, the figure is out of a
 * stated hundred, and two more lines of type to say a gauge fills rightward was more than the
 * block could carry.
 */
export function FearGreedCard({ data }: FearGreedState) {
  const band = data === null ? null : PRESENTATION[data.classification];
  const tone = band?.tone ?? colors.textMuted;

  return (
    <View style={styles.body}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Fear &amp; Greed</Text>

        {/* Glass, not a coloured chip. The surface is the app's own glass recipe — a translucent
            tint, a light edge, a highlight down the top — and carries no hue of its own, so the
            reading's colour is left to the two things that are actually about the reading: the
            face and the word. A tinted fill behind them made the badge itself the loudest object
            on the block. */}
        {data === null || band === null ? (
          // Sized and cornered to the badge it stands in for, so the badge does not change
          // shape as it resolves. Derived from the label rather than the face because the
          // label's line is the taller of the two and therefore what sets the height.
          <Skeleton height={BADGE_HEIGHT} radius={BADGE_RADIUS} width={112} />
        ) : (
          <View style={styles.badge}>
            <LinearGradient
              colors={gradients.cardSheen.colors}
              locations={gradients.cardSheen.locations}
              style={[StyleSheet.absoluteFill, styles.badgeSheen]}
            />
            <FacePop mood={band.mood} tone={tone} value={data.value} />
            <Text style={[styles.badgeLabel, { color: tone }]}>{data.classification}</Text>
          </View>
        )}
      </View>

      {data === null ? (
        <View style={styles.pending}>
          {/* `heading`, matching the reading's role, so the number lands on the line its
              placeholder held rather than a taller one. */}
          <SkeletonText role="heading" width={72} />
          <Skeleton height={GAUGE_HEIGHT} radius={TICK_RADIUS} />
        </View>
      ) : (
        <>
          <View style={styles.readingRow}>
            <Text style={styles.reading}>{data.value}</Text>
            <Text style={styles.scale}>/ 100</Text>
          </View>

          <View
            accessibilityLabel={`Fear and Greed index ${data.value} out of 100, ${data.classification}`}
            accessibilityRole="progressbar"
            accessibilityValue={{
              min: 0,
              max: 100,
              now: data.value,
              text: data.classification,
            }}
          >
            <SentimentGauge tone={tone} value={data.value} />
          </View>
          <Text style={styles.source}>Source: {data.source}</Text>
        </>
      )}
    </View>
  );
}

/**
 * The face, springing into place as the reading lands.
 *
 * A spring rather than the app's usual timed reveal, and the one place in this card that
 * overshoots: a face is the only element here with a character to it, and letting it settle
 * past its size and back is what makes the mood read as an expression rather than an icon.
 * Scale only, so the badge's own layout never moves under it.
 */
function FacePop({
  mood,
  tone,
  value,
}: {
  readonly mood: SentimentMood;
  readonly tone: string;
  readonly value: number;
}) {
  const reduceMotion = useReducedMotion();
  const settle = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      settle.set(1);
      return;
    }

    settle.set(0);
    settle.set(withSpring(1, motion.spring));
  }, [reduceMotion, settle, value]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: settle.value,
    transform: [{ scale: settle.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <SentimentFace color={tone} mood={mood} size={FACE_SIZE} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // No border, no fill, no padding of its own: the screen's gradient is this block's surface, and
  // the balance above it sits on the same one. A panel here would have put a frame around the
  // second-most-important thing on the screen while the most important had none.
  body: { gap: spacing.sm },
  // Centred, not top-aligned: with the source line gone the title is a single line and the
  // badge is the taller of the two, so aligning their tops would hang the title off it.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  // Takes the leftover width so a long classification never squeezes the title.
  title: { ...typography.label, flex: 1, minWidth: 0, color: colors.textPrimary },
  source: { ...typography.caption, color: colors.textMuted },
  // Clipped, so the three material layers take the badge's corners and none of them needs to
  // repeat the radius. Padding is symmetric: a capsule needed more room on its flat side than
  // its curved one, but a rounded box has two flat sides, and the optical difference between a
  // round glyph and text at this size is under a point.
  badge: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: BADGE_PAD_V,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdge,
    borderRadius: BADGE_RADIUS,
    // Continuous curvature, as on the tab bar's capsule. A circular corner meets the straight
    // edge at an abrupt change in curvature, which at a hairline weight is what reads as the
    // edge being slightly wrong; a continuous corner eases into it.
    borderCurve: 'continuous',
    backgroundColor: colors.glassTint,
  },
  // The highlight carries the corner as well, rather than trusting the parent's `overflow` alone.
  // An absolutely positioned child of a rounded, clipped View is the case Android is least
  // reliable about clipping, and when it fails the layer paints square over the corners — which
  // looks exactly like a radius that was never applied.
  badgeSheen: { borderRadius: BADGE_RADIUS },
  badgeLabel: { ...typography.label },
  pending: { gap: spacing.sm },
  readingRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  // The reading still anchors the card, but on weight rather than size now that the card is
  // compact: bold against the title's semibold at four points larger. `title`'s 26 needed a
  // 39pt line to keep Android from cropping its descenders, which was a fifth of the card's
  // height spent on one number.
  reading: {
    ...typography.heading,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  scale: { ...typography.caption, color: colors.textMuted },
});
