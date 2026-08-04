import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

export type TabIconName = 'home' | 'trade' | 'portfolio' | 'account';

/**
 * Stroked line glyphs for the bottom tab bar, matching the app's other SVG
 * icons (24x24 viewBox, 2px rounded strokes). Colour is driven by the
 * navigator's active/inactive tint, so the icon itself stays presentational.
 */
const pathByName: Record<TabIconName, string> = {
  home: 'M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z',
  trade: 'M4 15l4.5-4.5 3 3L18 6M14 6h4v4',
  portfolio:
    'M3 8.5h18V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM8.5 8.5V6.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2',
  account: 'M12 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5.5 20a6.5 6.5 0 0 1 13 0',
};

type TabBarIconProps = {
  name: TabIconName;
  // Matches the navigator's active/inactive tint, which is a ColorValue.
  color?: ColorValue;
  size?: number;
};

export function TabBarIcon({
  name,
  color = colors.textMuted,
  size = 24,
}: TabBarIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path
        d={pathByName[name]}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}
