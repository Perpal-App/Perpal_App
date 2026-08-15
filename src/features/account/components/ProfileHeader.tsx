import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { avatarForAddress } from '@/assets/svg/avatars';
import { colors, gradients, radii } from '@/theme/tokens';

/**
 * The disc, and the drawing inside it — one value, because the figures are composed to fill
 * their box and be clipped to a circle, so anything less than the full disc crops the shoulders.
 */
const AVATAR_SIZE = 112;

/**
 * The ring around the avatar, drawn in the page colour.
 *
 * It is what makes the overlap read. The disc sits half on the violet panel and half on the
 * page, and without a ring the two halves would each blend into whatever is behind them; a ring
 * in the page's own colour cuts a clean hole in the panel for the disc to sit in.
 */
const AVATAR_RING = 5;

/**
 * Height of the gradient band.
 *
 * A constant, because the band carries nothing and so has no content to measure. That is the one
 * case where a fixed height is the right answer: it is a decorative surface, not a container
 * whose height has to accommodate type at any scale. Sized against the disc rather than the
 * screen — enough violet above the overlap for the band to read as a panel rather than a stripe.
 */
const PANEL_HEIGHT = 160;

/**
 * The band's corners, shared by the clipped container and the glow layer inside it.
 *
 * Rounded on all four, so the band reads as one object rather than as a stripe cut off at the top.
 * The top pair is tighter than the bottom: those corners sit against the device's own rounding and
 * a radius competing with it looks like a mistake, while the bottom pair is the edge the disc
 * straddles and carries the curve the eye actually reads.
 */
const PANEL_RADII = {
  borderTopLeftRadius: radii.lg,
  borderTopRightRadius: radii.lg,
  borderBottomLeftRadius: radii.panel,
  borderBottomRightRadius: radii.panel,
} as const;

/**
 * Who this device is: a gradient band across the top, and the avatar straddling its bottom edge.
 *
 * The band is empty on purpose. Everything it used to carry — the screen title, the address, the
 * word "wallet" — is either already in the list below or redundant with the tab the reader
 * pressed to get here, and a header that repeats the first row of its own screen is decoration.
 * What is left is the identity mark and the colour, which is what the reference does too.
 *
 * The gradient is the home backdrop's ramp, stopped early so it completes inside the band: the
 * light is the same, the room is smaller.
 *
 * Full width, and built without a negative margin anywhere. The band simply carries no
 * horizontal padding of its own — the screen hands its gutter to the settings groups instead —
 * so it runs to both edges of the content column inside the safe area. The overlap is padding
 * too: the wrapper reserves half the disc's height below the band and the disc is pinned to the
 * wrapper's bottom edge, so it lands half over each with no inset math.
 */
export function ProfileHeader({ address }: { readonly address: string | null }) {
  const Avatar = avatarForAddress(address);

  return (
    <View style={styles.wrapper}>
      {/* Two layers in a clipped box rather than one gradient with more stops: the base ramp
          darkens downward and the glow lifts its bottom third back up, and a single set of stops
          that reversed on itself would be impossible to adjust later. */}
      <View style={styles.panel}>
        <LinearGradient
          colors={gradients.profilePanel.colors}
          end={{ x: 0.5, y: 1 }}
          locations={gradients.profilePanel.locations}
          start={{ x: 0.5, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={gradients.profileGlow.colors}
          end={{ x: 0.5, y: 1 }}
          locations={gradients.profileGlow.locations}
          start={{ x: 0.5, y: 0 }}
          style={[StyleSheet.absoluteFill, styles.glow]}
        />
      </View>

      {/* A full-width slot rather than the disc positioning itself, so the centring comes from a
          flex container instead of from `alignSelf` on an absolutely positioned child. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.avatarSlot}
      >
        <View style={styles.avatar}>
          {/* The same lit top edge the app's other glass discs carry, so the drawing sits on a
              surface rather than on a flat patch of colour. */}
          <LinearGradient
            colors={gradients.cardSheen.colors}
            locations={gradients.cardSheen.locations}
            style={StyleSheet.absoluteFill}
          />
          <Avatar size={AVATAR_SIZE} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Reserves the half of the disc that hangs below the band. This is what the overlap is made
  // of, so the disc needs no negative offset of its own.
  wrapper: { paddingBottom: AVATAR_SIZE / 2 + AVATAR_RING },
  // Clipped, so both gradient layers take the band's corners.
  panel: {
    height: PANEL_HEIGHT,
    overflow: 'hidden',
    borderCurve: 'continuous',
    ...PANEL_RADII,
  },
  // Carries the corners itself as well as the parent's clip. An absolutely positioned child of a
  // rounded, clipped View is the case Android is least reliable about clipping, and when it fails
  // the layer paints square over the corners — which looks exactly like a radius that was never
  // applied.
  glow: PANEL_RADII,
  avatarSlot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
  },
  avatar: {
    width: AVATAR_SIZE + AVATAR_RING * 2,
    height: AVATAR_SIZE + AVATAR_RING * 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: AVATAR_RING,
    borderColor: colors.background,
    backgroundColor: colors.surfaceElevated,
  },
});
