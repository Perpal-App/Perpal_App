import Svg, { Path } from 'react-native-svg';

type AuthMailIconProps = {
  color: string;
};

/** Mail glyph used inside the email authentication field. */
export function AuthMailIcon({ color }: AuthMailIconProps) {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Path
        d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        fill="none"
        stroke={color}
        strokeLinejoin="round"
        strokeWidth={2}
      />
      <Path
        d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"
        fill="none"
        stroke={color}
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}
