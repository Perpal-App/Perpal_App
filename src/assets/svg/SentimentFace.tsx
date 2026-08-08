import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export type SentimentMood =
  | 'extreme-fear'
  | 'fear'
  | 'neutral'
  | 'greed'
  | 'extreme-greed';

/** Head, and the eyes that get punched out of it. Shared by every mood. */
const HEAD = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z';
const EYES =
  'M8.6 8.5a1.45 1.45 0 1 0 0 2.9 1.45 1.45 0 0 0 0-2.9ZM15.4 8.5a1.45 1.45 0 1 0 0 2.9 1.45 1.45 0 0 0 0-2.9Z';

/**
 * The mouth is the whole glyph: five expressions built from one shape whose curvature runs
 * from a deep frown to a broad grin.
 *
 * Each is a half-disc rather than a stroked curve, because the features are cut out of the
 * head with the even-odd rule and only a closed shape can cut a hole. A stroke would have to
 * be painted in whatever colour sits behind the face, which is a tint of the face's own
 * colour — so it would have to be recomputed for every band and would break the moment the
 * badge behind it changed.
 *
 * The two middle steps flatten the arc by shrinking only its vertical radius, which keeps
 * the mouth the same width across all five and makes the sequence read as one expression
 * easing rather than as five unrelated faces.
 */
const MOUTH: Record<SentimentMood, string> = {
  'extreme-fear': 'M7.6 17.9A4.4 4.4 0 0 0 16.4 17.9Z',
  fear: 'M7.9 17.2A4.1 2.4 0 0 0 16.1 17.2Z',
  neutral: 'M8.2 14.9h7.6v2.2H8.2Z',
  greed: 'M7.9 14.6A4.1 2.4 0 0 1 16.1 14.6Z',
  'extreme-greed': 'M7.6 13.9A4.4 4.4 0 0 1 16.4 13.9Z',
};

/**
 * A face carrying one market mood.
 *
 * Solid, with the features knocked out of it, so the surface behind shows through them. On a
 * badge tinted with this same colour that reads as one object in one hue — the face, its
 * label and the fill behind them all saying the same thing, which is the point of putting a
 * face on a reading at all.
 */
export function SentimentFace({
  color,
  mood,
  size = 16,
}: {
  readonly color: ColorValue;
  readonly mood: SentimentMood;
  readonly size?: number;
}) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path d={`${HEAD}${EYES}${MOUTH[mood]}`} fill={color} fillRule="evenodd" />
    </Svg>
  );
}
