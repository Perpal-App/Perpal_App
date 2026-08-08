import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type ViewProps } from 'react-native';

/**
 * Layer heights as fractions of the container, anchored at one edge. Each layer
 * adds the same small blur, so where they overlap the blur accumulates — thick at
 * the anchor, thinning toward the far edge.
 */
const LAYERS = [1, 0.88, 0.76, 0.64, 0.54, 0.44, 0.36, 0.28, 0.22, 0.16] as const;

/** Tail gradient: darkens under the anchored edge and fades out well before the top. */
const TAIL = {
  colors: [
    'rgba(0, 0, 0, 0.70)',
    'rgba(0, 0, 0, 0.32)',
    'rgba(0, 0, 0, 0.08)',
    'rgba(0, 0, 0, 0)',
  ],
  locations: [0, 0.42, 0.68, 0.88],
} as const;

/**
 * Progressive (gradient) blur: strongest at the anchored edge, fading to none.
 *
 * Neither platform exposes a variable-blur radius, so this stacks many thin blur
 * layers with a low per-layer intensity. Each layer's edge contributes only an
 * imperceptible step, so the falloff reads as continuous rather than as bands. A
 * soft dark gradient over the top smooths the tail and keeps whatever sits on the
 * blur legible against bright content scrolling underneath.
 */
export function ProgressiveBlur({
  direction = 'top',
  intensity = 5,
  style,
  ...rest
}: ViewProps & {
  readonly direction?: 'top' | 'bottom';
  readonly intensity?: number;
}) {
  const anchor = direction === 'top' ? styles.top : styles.bottom;

  return (
    <View pointerEvents="none" style={style} {...rest}>
      {LAYERS.map((fraction, index) => (
        <BlurView
          // Android renders these as translucent layers rather than real blurs.
          // Ten stacked native blur views would be the most expensive thing on the
          // screen, and the tail gradient below already carries the legibility
          // this scrim exists for. iOS ignores the prop and blurs natively.
          blurMethod="none"
          intensity={intensity}
          key={index}
          style={[styles.layer, anchor, { height: `${fraction * 100}%` }]}
          tint="dark"
        />
      ))}
      <LinearGradient
        colors={TAIL.colors}
        end={direction === 'top' ? { x: 0.5, y: 1 } : { x: 0.5, y: 0 }}
        locations={TAIL.locations}
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
