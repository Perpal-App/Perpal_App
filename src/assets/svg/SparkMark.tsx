import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

type SparkMarkProps = {
  size?: number;
};

const VIEWBOX_WIDTH = 199.8;
const VIEWBOX_HEIGHT = 60.7;

/** Exact three-star geometry supplied by the user, generated with Arrow by QuiverAI. */
const STAR_PATH =
  'm141 29.9-0.5-0.1c-5.5-0.8-10.5-5.3-11.6-11.2l-0.5-13.6-0.6 13c-0.5 7.5-5.8 12-12.3 12.3h-3.5c-6.5-0.4-12-4.7-12.7-11.7l-0.5-13.6-0.6 13c-0.5 6.6-5.2 11.9-12.2 12.1h-3c-6.5-0.1-12.4-4.1-13-11.5l-0.5-13.6-0.6 13.4c-0.3 5.8-5.6 11-12.2 11.6l-12.2 0.5 12.1 0.5c6.4 0.3 11.9 4.3 12.4 11.7l0.5 12.3 0.5-11.9c0.3-7.1 5-12.2 12.8-12.2h2.2c7.3 0 12.4 4.2 13.3 11.8l0.6 12.3 0.4-11.9c0.3-4.4 2.8-8.1 5.7-9.8 2.7-1.7 4.8-2.4 8.5-2.4h0.6c6.9 0 12.8 2.8 13.8 11.2l0.5 12.9 0.6-12.4c0.4-6.8 5.6-11 11.5-11.5l12.9-0.6-12.4-0.6z';

export function SparkMark({ size = 200 }: SparkMarkProps) {
  const height = (size * VIEWBOX_HEIGHT) / VIEWBOX_WIDTH;

  return (
    <Svg height={height} viewBox="0 0 199.8 60.7" width={size}>
      <Path d={STAR_PATH} fill={colors.textPrimary} />
    </Svg>
  );
}
