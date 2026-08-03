import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

type DirectionIconProps = {
  direction: 'left' | 'right';
  color?: string;
  size?: number;
};

const pathByDirection = {
  left: 'M14.5 5 7.5 12l7 7M8 12h10',
  right: 'm9.5 5 7 7-7 7M16 12H6',
} as const;

export function DirectionIcon({
  direction,
  color = colors.textPrimary,
  size = 24,
}: DirectionIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path
        d={pathByDirection[direction]}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}
