import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient,
  Path,
  Polygon,
  Stop,
} from 'react-native-svg';

import type { AvatarProps } from '@/assets/svg/avatars/types';

/** Artwork palette, not design tokens. See `Avatar1` for why these live beside the drawing. */
const INK = '#00214E';
const LIGHT = '#F2D4CF';
const LIGHT_SHADE = '#DAAEA8';
const SKIN = '#F2A196';
const TEETH = '#FFFFFF';

export function Avatar4({ size }: AvatarProps) {
  return (
    <Svg height={size} viewBox="0 0 366.34 366.34" width={size}>
      <Defs>
        <LinearGradient
          gradientUnits="userSpaceOnUse"
          id="brim"
          x1="135.61"
          x2="164.83"
          y1="137.64"
          y2="68.33"
        >
          <Stop offset="0.29" stopColor="#00214E" />
          <Stop offset="0.51" stopColor="#6878B1" />
          <Stop offset="0.79" stopColor="#00214E" />
        </LinearGradient>
        <LinearGradient
          gradientUnits="userSpaceOnUse"
          id="rainbow"
          x1="116.11"
          x2="182.66"
          y1="127.57"
          y2="46.55"
        >
          <Stop offset="0" stopColor="#FF2609" />
          <Stop offset="0.17" stopColor="#FF8500" />
          <Stop offset="0.36" stopColor="#FFED00" />
          <Stop offset="0.55" stopColor="#00830D" />
          <Stop offset="0.72" stopColor="#004AFF" />
          <Stop offset="1" stopColor="#81008C" />
        </LinearGradient>
      </Defs>

      <Path
        d="M244.67,107.86c-4.24-19.92-6-35.11-23.19-47.8a74.19,74.19,0,0,0-14.75-8.43,71.47,71.47,0,0,0-33.59-5.75A109.1,109.1,0,0,0,153,49.55a106.54,106.54,0,0,0-26.74,11.36A58.94,58.94,0,0,0,110.06,75c-6.31,8.32-10.83,18.44-14.27,29.18-5.18,16.15-8,33.72-10.79,48.71C80.15,178.4,75.81,204,71.46,229.6c29.94,3,186.24,2.11,186.24,2.11S254.12,152.15,244.67,107.86ZM170.5,128.3l-16.8-5.43,50.66-19,3.71,2.06Z"
        fill={INK}
      />
      <Path
        d="M296.41,282.35a184.56,184.56,0,0,1-226.48-1l48.66-22.81a47.68,47.68,0,0,0,4.35-2.34l1.12-.7c.4-.25.79-.51,1.18-.78a46.54,46.54,0,0,0,14.67-16.47c4-7.55,5.32-15.89,5.38-24.39,0-5.72-.31-11.44-.37-17.17q-.06-4.76-.1-9.51l2,1,5.2,2.69L182.29,196l31.12,5.3.94,32,.47,15.87,11.47,4.67,9,3.64Z"
        fill={LIGHT}
      />
      <Path
        d="M214.16,225.61c-2.72,1.68-5.29,2.47-7.54,2.23-14.79-1.59-43.64-13.18-61.8-34.63q0-1.58-.06-3.15-.06-4.76-.1-9.51l2,1,5.2,2.69,30.29,5.15,31.12,5.3Z"
        fill={LIGHT_SHADE}
      />
      <Path
        d="M296.41,282.35a184.56,184.56,0,0,1-226.48-1l48.66-22.81a47.68,47.68,0,0,0,4.35-2.34c23.68,17.41,56.64,28.75,85.06,16,8.06-3.62,15.33-10,18.29-18.31l9,3.64Z"
        fill={SKIN}
      />
      <Circle cx="118.14" cy="153.89" fill={LIGHT} r="17" />
      <Circle cx="124.14" cy="151.89" fill={LIGHT_SHADE} r="17" />
      <Path
        d="M233.68,128.15c11.74,40.68-13.2,89.87-28.54,89.87-21,0-72-16.78-83.73-57.46s3.87-80.93,34.87-89.88S221.93,87.46,233.68,128.15Z"
        fill={LIGHT}
      />
      <Path
        d="M202.93,124.13A31.18,31.18,0,0,1,225.78,122"
        fill="none"
        stroke={INK}
        strokeMiterlimit={10}
      />
      <Path
        d="M154.05,126.42a36.76,36.76,0,0,1,31.23-1"
        fill="none"
        stroke={INK}
        strokeMiterlimit={10}
      />
      <Ellipse
        cx="167.28"
        cy="139.45"
        fill={INK}
        rx="3.27"
        ry="7.94"
        transform="translate(15.86 295.97) rotate(-85.77)"
      />
      <Ellipse
        cx="218.77"
        cy="137.8"
        fill={INK}
        rx="7.94"
        ry="3.27"
        transform="translate(-25.74 53.74) rotate(-13.23)"
      />
      <Path
        d="M203.73,148.49s.29,5.65,1.62,8.3c.57,1.15,1.45,2.11,2,3.24,2.21,4.34-1.37,5.25-4.81,5.25"
        fill="none"
        stroke={INK}
        strokeMiterlimit={10}
      />
      <Path
        d="M189.81,158.37a3.4,3.4,0,0,0,2.11,6.38"
        fill="none"
        stroke={INK}
        strokeMiterlimit={10}
      />
      <Path
        d="M171.83,173.88a1.87,1.87,0,0,1,2.69-.5c2.07,1.46,5.87,4.56,11.27,5.64,7.36,1.46,13.75-1.48,15.27.41.86,1.07-.19,2.38-2.2,4A19.68,19.68,0,0,1,184,187.17c-7.09-1.33-12.4-9.53-12.4-12.43A1.72,1.72,0,0,1,171.83,173.88Z"
        fill={TEETH}
      />
      <Polygon
        fill={INK}
        points="226.5 95.61 204.36 103.9 153.7 122.87 153.69 122.87 115.86 137.04 115.28 110.47 114.5 74.61 137.99 67.29 175.5 55.61 226.5 95.61"
      />
      <Path
        d="M204.36,103.9l-50.66,19h0l-38.41-12.4-19.49-6.29c3.44-10.74,8-20.86,14.27-29.18a58.94,58.94,0,0,1,16.21-14.09c3.5,1.89,7.47,4,11.72,6.38C161.45,80.11,193.57,97.91,204.36,103.9Z"
        fill="url(#brim)"
      />
      <Path
        d="M206.73,51.63c-10.11,4.59-33.67,16.11-46.9,29.19-17.18,17-42.24,55.34-42.24,55.34A210,210,0,0,1,121.9,109c3.36-14.7,9.08-31.32,14.17-39.29C139.87,63.77,146.53,56,153,49.55a109.1,109.1,0,0,1,20.13-3.67A71.47,71.47,0,0,1,206.73,51.63Z"
        fill="url(#rainbow)"
      />
    </Svg>
  );
}
