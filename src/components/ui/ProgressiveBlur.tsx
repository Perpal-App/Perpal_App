import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { gradients } from '@/theme/tokens';

/**
 * The blur stack, tallest layer first. `fraction` is how much of the container a layer covers
 * from the anchored edge, `intensity` is how much blur it adds. A point is blurred by every layer
 * tall enough to reach it, so the totals accumulate downward: thickest at the anchor, thinning
 * toward the far edge.
 *
 * Two things this table has to get right at once, and they pull against each other.
 *
 * The falloff has to be visible. `intensity` runs from 1 to 100 and 1 is very nearly nothing, so
 * the layers covering the exposed band need real values — an earlier version graded them down to
 * 1 and 2 up there, which removed the hard edge by removing the blur, and the band above the bar
 * came out sharp. Cumulative intensity at the top of the capsule is around 50 here, and it is
 * still in the twenties a third of the way up the band.
 *
 * The exposed edge has to be quiet. Every layer's far edge is a hard boundary between blurred and
 * unblurred pixels, and its visibility depends on nothing but that layer's own intensity. Only
 * the tallest layer's edge lands in the open, so that one carries 1 and its neighbours 2 — every
 * edge below them is buried under the layers stacked above it, which is why they can afford to be
 * strong. Uniform intensity, the original arrangement, put the same step at the exposed end as at
 * the hidden one.
 *
 * So: strength climbs quickly just under the exposed edge and keeps climbing toward the anchor,
 * with the fractions spaced tightly across the band where the gradient does its work. Layers are
 * concentrated in the upper half deliberately — everything below the capsule's top is either
 * behind the capsule or in the narrow margins beside it, and covered by every band layer anyway.
 */
const LAYERS = [
  { fraction: 1, intensity: 1 },
  { fraction: 0.97, intensity: 2 },
  { fraction: 0.93, intensity: 2 },
  { fraction: 0.89, intensity: 3 },
  { fraction: 0.85, intensity: 3 },
  { fraction: 0.8, intensity: 4 },
  { fraction: 0.75, intensity: 5 },
  { fraction: 0.7, intensity: 5 },
  { fraction: 0.65, intensity: 6 },
  { fraction: 0.6, intensity: 6 },
  { fraction: 0.55, intensity: 7 },
  { fraction: 0.5, intensity: 7 },
  { fraction: 0.42, intensity: 8 },
  { fraction: 0.32, intensity: 9 },
] as const;

/**
 * Progressive (gradient) blur: strongest at the anchored edge, fading to none.
 *
 * Neither platform exposes a variable-blur radius, so this stacks many thin blur layers whose
 * per-layer intensity is graded by height — see `LAYERS` for why that grading, and not a uniform
 * value, is what keeps the exposed end of the ramp from reading as an edge. The `chromeScrim`
 * gradient over the top smooths the tail and keeps whatever sits on the blur legible against
 * bright content scrolling underneath.
 *
 * The honest limitation: a real faded blur needs a gradient alpha mask over a single blur, which
 * wants either a masked view or Skia, and this project has neither. A graded stack is the closest
 * approximation available, and the remaining steps are sub-perceptual rather than absent.
 *
 * `tint` is the one colour here that is not a token, on both this and the capsule's blur:
 * those are `expo-blur` material names, resolved by the platform, not values the palette
 * can supply.
 */
export function ProgressiveBlur({
  direction = 'top',
  style,
  ...rest
}: ViewProps & {
  readonly direction?: 'top' | 'bottom';
}) {
  const anchor = direction === 'top' ? styles.top : styles.bottom;

  return (
    <View pointerEvents="none" style={style} {...rest}>
      {LAYERS.map((layer, index) => (
        <BlurView
          // Android renders these as translucent layers rather than real blurs.
          // Fourteen stacked native blur views would be the most expensive thing on
          // the screen, and the tail gradient below already carries the legibility
          // this scrim exists for. iOS ignores the prop and blurs natively.
          blurMethod="none"
          intensity={layer.intensity}
          key={index}
          style={[styles.layer, anchor, { height: `${layer.fraction * 100}%` }]}
          tint="dark"
        />
      ))}
      {/* Runs from the anchored edge outward, so one token serves both directions. */}
      <LinearGradient
        colors={gradients.chromeScrim.colors}
        end={direction === 'top' ? { x: 0.5, y: 1 } : { x: 0.5, y: 0 }}
        locations={gradients.chromeScrim.locations}
        start={direction === 'top' ? { x: 0.5, y: 0 } : { x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0 },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
