import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

/**
 * Palette and geometry are the supplied artwork's own, transcribed rather than reinterpreted.
 *
 * They sit here beside the drawing instead of in the design tokens because they are picture
 * colours, not semantic roles — the same reasoning as the avatar illustrations. Nothing else in
 * the app should be able to reach for "the lit top of the mailbox".
 *
 * This is the one blue thing in a violet app, deliberately left that way: it is a piece of
 * commissioned art, and recolouring it to the ramp would mean redrawing its shading too.
 */
const POLE = '#1C56B1';
const FLAG = '#F8675A';
const FLAG_FOLD = '#AF4137';
const LEG_FOLD = '#164194';
const DOOR = '#2C72E6';
const SHELL_BASE = '#2C72E6';
const SHELL_LIT = '#38BAEB';
const TICK = '#FFFFFF';

/** Opacities and stroke weight as authored. Round numbers would visibly redraw the shading. */
const FLAG_FOLD_OPACITY = 0.4;
const LEG_FOLD_OPACITY = 0.29;
const TICK_WIDTH = 6.4926;

const FLAG_POLE =
  'm76.4 11h-3.9c-1.3 0-2.5 1.2-2.5 2.6v31.3h9.1v-31.3c-0.1-1.5-1.3-2.6-2.7-2.6z';
const FLAG_BODY =
  'm79 15h12c6-0.1 11.5 3.8 11.8 9.5 0.2 6.2-4.8 12-11.6 12.1h-12.2v-21.6z';
const FLAG_SHADOW = 'm79 15s3.9 15.2 10.9 21.6h-10.9v-21.6z';
const SHELL = 'm105.7 44.5h-60.8v72.4h85v-47.3c-0.6-12.5-11.1-24.9-24.2-25.1z';
const LEG = 'm65.1 116.9v21.9h17.8v-21.9z';
const LEG_SHADOW = 'm65.1 116.9c4.8 0.9 13.4 4.8 17.5 12.7v-12.7z';
const DOOR_PANEL =
  'm44.4 44.6c-13.1 0-25.2 11.6-25.3 25.9v46.4h49.6v-47.2c-0.4-11.6-9.8-25-24.3-25.1z';
const TICK_PATH = 'm29.2 80 9.8 10.3 20-21.5';

/**
 * Mailbox with a raised flag and a tick on its door: the notifications empty state.
 *
 * A tick rather than an open lid, because an empty log is a resolved state and not a failure —
 * and it is the same mark the sheet's own read action uses, so the drawing speaks the vocabulary
 * the rest of the panel already established.
 *
 * Draw order is load-bearing and matches the source exactly: the pole and flag go down first so
 * the shell covers where the pole enters it, the leg and its shadow next, then the door panel over
 * the shell's left end, and the tick last so it sits on the door rather than under it.
 *
 * The artwork's own square viewBox is kept rather than cropped to the ink. The figure sits a little
 * left of centre inside it, which is the artwork's composition and not worth re-framing by hand.
 */
export function MailboxMark({ size = 132 }: { readonly size?: number }) {
  return (
    <Svg height={size} viewBox="0 0 150 150" width={size}>
      <Defs>
        {/* `userSpaceOnUse`, so the ramp is pinned to the shell's own coordinates — bottom of the
            box to the top of it — rather than to the bounding box of whatever it fills. */}
        <LinearGradient
          gradientUnits="userSpaceOnUse"
          id="mailboxShell"
          x1={85.44}
          x2={85.44}
          y1={116.9}
          y2={44.53}
        >
          <Stop offset={0} stopColor={SHELL_BASE} />
          <Stop offset={1} stopColor={SHELL_LIT} />
        </LinearGradient>
      </Defs>

      <Path d={FLAG_POLE} fill={POLE} />
      <Path d={FLAG_BODY} fill={FLAG} />
      <Path d={FLAG_SHADOW} fill={FLAG_FOLD} opacity={FLAG_FOLD_OPACITY} />
      <Path d={SHELL} fill="url(#mailboxShell)" />
      <Path d={LEG} fill={POLE} />
      <Path d={LEG_SHADOW} fill={LEG_FOLD} opacity={LEG_FOLD_OPACITY} />
      <Path d={DOOR_PANEL} fill={DOOR} />
      <Path
        d={TICK_PATH}
        fill="none"
        stroke={TICK}
        strokeMiterlimit={10}
        strokeWidth={TICK_WIDTH}
      />
    </Svg>
  );
}
