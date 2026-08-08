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
import { colors, fonts, gradients, motion, radii, spacing, typography } from '@/theme/tokens';

/**
 * The five bands, in order, with CoinMarketCap's own boundaries.
 *
 * A band runs up to but not including its `upTo`, which is what makes 40 the first point of
 * Neutral rather than the last of Fear — the venue classifies it that way, and a card whose
 * colour disagreed with the label printed on it would be worse than an uncoloured one.
 */
const BANDS = [
  { upTo: 20, mood: 'extreme-fear', tone: colors.sentimentExtremeFear },
  { upTo: 40, mood: 'fear', tone: colors.sentimentFear },
  { upTo: 60, mood: 'neutral', tone: colors.sentimentNeutral },
  { upTo: 80, mood: 'greed', tone: colors.sentimentGreed },
  {
    upTo: Number.POSITIVE_INFINITY,
    mood: 'extreme-greed',
    tone: colors.sentimentExtremeGreed,
  },
] as const satisfies readonly {
  readonly upTo: number;
  readonly mood: SentimentMood;
  readonly tone: string;
}[];

const FACE_SIZE = 18;

/**
 * How strongly the band's colour washes the card. Held here rather than in the colour tokens
 * because the colour itself is the reading's, which no token can know in advance — only its
 * strength is fixed. Low, because it covers the whole card: enough that the surface is
 * unmistakably tinted, not enough to compete with the badge or the gauge for the eye.
 */
const WASH_OPACITY = 0.07;

/**
 * Today's Fear and Greed reading.
 *
 * The band's colour is the card's only accent and it is stated three times over — as a wash
 * across the whole surface, as the badge's tint, and as the filled part of the gauge. Nothing
 * else is coloured, so the card has one thing to say and says it in one hue. That is also why
 * the gauge is a single colour rather than a red-to-green ramp: a ramp shows all five bands at
 * full strength and leaves the reader to work out which is current, while one colour filled to
 * the reading states it.
 *
 * The surface is built from a raise gradient, the wash, and a light edge along the top, in that
 * order. Three near-invisible layers rather than one flat fill, because a card this size reads
 * as a printed panel when its surface is perfectly even — the gradient is what makes it sit
 * under the light the rest of the app is lit by.
 */
export function FearGreedCard({ data, status }: FearGreedState) {
  // Derived from the reading rather than matched against the venue's label text, so a wording
  // change upstream cannot leave the card uncoloured.
  const band = data === null
    ? null
    : BANDS[BANDS.findIndex((candidate) => data.value < candidate.upTo)] ?? null;
  const tone = band?.tone ?? colors.textMuted;

  return (
    <View style={styles.card}>
      <LinearGradient
        colors={gradients.surfaceRaise.colors}
        locations={gradients.surfaceRaise.locations}
        style={StyleSheet.absoluteFill}
      />
      {/* The band's colour over the whole surface, evenly. A directional falloff was tried
          and read as a highlight on one corner rather than as the card taking the reading's
          colour — the tint has to be a property of the surface, not a light shining on part
          of it. The raise gradient underneath is what keeps the surface from going flat. */}
      <View style={[StyleSheet.absoluteFill, styles.wash, { backgroundColor: tone }]} />
      <LinearGradient
        colors={gradients.cardSheen.colors}
        locations={gradients.cardSheen.locations}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.body}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>Fear &amp; Greed</Text>

          {data === null || band === null ? (
            status === 'loading'
              // Sized to the badge it stands in for: the face plus its padding, not the
              // taller pill the badge used to be.
              ? <Skeleton height={FACE_SIZE + spacing.xs} radius={radii.pill} width={112} />
              : <Text style={styles.unavailable}>Unavailable</Text>
          ) : (
            <View style={styles.badge}>
              {/* One solid colour drives the fill, the face and the label, so the three cannot
                  fall out of step. The fill is that colour turned down rather than a second
                  token per band — but it has to be turned down, or the face and the label are
                  painted in the colour they are sitting on. */}
              <View
                style={[StyleSheet.absoluteFill, styles.badgeFill, { backgroundColor: tone }]}
              />
              <FacePop mood={band.mood} tone={tone} value={data.value} />
              <Text style={[styles.badgeLabel, { color: tone }]}>{data.classification}</Text>
            </View>
          )}
        </View>

        {data === null ? (
          status === 'loading' ? (
            <View style={styles.pending}>
              {/* `heading`, matching the reading's role, so the number lands on the line its
                  placeholder held rather than a taller one. */}
              <SkeletonText role="heading" width={72} />
              <Skeleton height={GAUGE_HEIGHT} radius={TICK_RADIUS} />
            </View>
          ) : null
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

            {/* The gauge is one colour, so nothing in it says which end is which. These do. */}
            <View style={styles.legend}>
              <Text style={styles.legendLabel}>Extreme fear</Text>
              <Text style={styles.legendLabel}>Extreme greed</Text>
            </View>
          </>
        )}
      </View>
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
  // Clipped, so all three surface layers take the card's rounding.
  card: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    // Stepped down with the padding: `lg` was cut for a card half again as tall, and a radius
    // that large on a compact card starts curving the whole edge instead of its corners.
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  wash: { opacity: WASH_OPACITY },
  body: { gap: spacing.sm, padding: spacing.sm },
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
  badge: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingLeft: spacing.xs,
    paddingRight: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  badgeFill: { opacity: 0.18, borderRadius: radii.pill },
  badgeLabel: { ...typography.label },
  unavailable: { ...typography.caption, color: colors.textMuted },
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
  legend: { flexDirection: 'row', justifyContent: 'space-between' },
  // `caption`, not `label`: these name the ends of a scale nobody needs to read twice, and
  // `label`'s semibold 14 gave them the same weight as the data. Caption is Poppins Medium at
  // 12, so they sit back — smaller, lighter, and quieter against the muted grey.
  legendLabel: { ...typography.caption, color: colors.textMuted },
});
