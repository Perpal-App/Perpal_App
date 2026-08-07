import { useCallback, useEffect, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';

/**
 * Orientation control for the full-screen chart.
 *
 * Orientation is read from the OS rather than inferred from window dimensions,
 * so the flag is authoritative and no layout has to measure the viewport to know
 * which way the device is held. The screen that mounts this hook is the only one
 * allowed to rotate: leaving it locks the app back to portrait, because every
 * other screen is a portrait layout.
 */
export function useChartOrientation(): {
  readonly landscape: boolean;
  readonly toggle: () => void;
} {
  const [landscape, setLandscape] = useState(false);

  useEffect(() => {
    let active = true;

    const apply = (orientation: ScreenOrientation.Orientation) => {
      if (!active) return;
      setLandscape(
        orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT,
      );
    };

    void ScreenOrientation.getOrientationAsync().then(apply).catch(() => undefined);
    const subscription = ScreenOrientation.addOrientationChangeListener((event) => {
      apply(event.orientationInfo.orientation);
    });

    return () => {
      active = false;
      ScreenOrientation.removeOrientationChangeListener(subscription);
      // Fire and forget: the screen is already unmounting, and the app's other
      // routes must not inherit a landscape lock from this one.
      void ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => undefined);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = landscape
      ? ScreenOrientation.OrientationLock.PORTRAIT_UP
      : ScreenOrientation.OrientationLock.LANDSCAPE;

    // The listener above confirms the change, so state follows the device
    // rather than the request.
    void ScreenOrientation.lockAsync(next).catch(() => undefined);
  }, [landscape]);

  return { landscape, toggle };
}
