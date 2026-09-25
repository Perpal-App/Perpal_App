import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { gradients } from '@/theme/tokens';

/**
 * The modelling on a raised control: light across the top, shade through the belly, easing off again at
 * the lower edge.
 *
 * Two fixed overlays over whatever solid colour the caller has put behind them. Every raised action in
 * the app catches light the same way because they all use this, and none of them build the colour and
 * the modelling into one ramp.
 *
 * That separation is load-bearing. `expo-linear-gradient`'s Android view rebuilds its shader from two
 * independent setters and skips the rebuild whenever `colors` and `locations` disagree in length, so a
 * gradient whose stops change at runtime can be left drawing the wrong thing or nothing — which is what
 * happened to a selected button, and why the colour is now a `backgroundColor` and these props are
 * constant. Nothing here ever changes, so nothing here can fail to update.
 *
 * `sheen` scales the specular only. A quiet grey surface wants a fraction of what a saturated one
 * absorbs; at full strength on `surfaceRaise` the highlight lifts the top edge to nearly `borderStrong`
 * and a secondary control becomes the loudest thing in a row of them. It is an opacity rather than a
 * second pair of gradients for the same reason as everything else here.
 */
export function RaisedMaterial({ sheen = 1 }: { readonly sheen?: number }) {
  return (
    <>
      <LinearGradient
        colors={gradients.actionSheen.colors}
        end={END}
        locations={gradients.actionSheen.locations}
        pointerEvents="none"
        start={START}
        style={[StyleSheet.absoluteFill, { opacity: sheen }]}
      />
      <LinearGradient
        colors={gradients.actionShade.colors}
        end={END}
        locations={gradients.actionShade.locations}
        pointerEvents="none"
        start={START}
        style={StyleSheet.absoluteFill}
      />
    </>
  );
}

const START = { x: 0.5, y: 0 } as const;
const END = { x: 0.5, y: 1 } as const;
