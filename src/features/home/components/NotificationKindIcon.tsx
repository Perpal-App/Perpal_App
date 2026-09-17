import Svg, { Path, Rect } from 'react-native-svg';

import type { InAppNotification, InAppNotificationKind } from '@/storage/inAppNotifications';
import { colors } from '@/theme/tokens';

/**
 * Tint by outcome, not by kind.
 *
 * Four kinds times three outcomes is twelve colours, which is a palette rather than a signal. The
 * kind is already named by the shape, so colour is free to carry the one thing the shape cannot: how
 * it went. Three hues, each meaning what it means everywhere else in the app — the same green as a
 * rising price, the same red as a falling one.
 */
const TINTS: Readonly<Record<InAppNotification['outcome'], string>> = {
  error: colors.negative,
  info: colors.accentSoft,
  success: colors.positive,
};

/**
 * Filled marks, drawn without a container.
 *
 * The tile is gone. A hairline box around a thin outline glyph spent most of its area on padding,
 * which is why the icon read as small however large the box got — the tile was the thing being
 * measured, not the mark. Solid shapes carry their own weight at this size and need no frame to sit
 * in, so the same footprint now goes almost entirely to ink.
 *
 * All four fill the 3–21 band of a 24-unit box on both axes, so no shape looks lighter than its
 * neighbour down the column.
 */
export function NotificationKindIcon({
  kind,
  outcome,
  size,
}: {
  readonly kind: InAppNotificationKind;
  readonly outcome: InAppNotification['outcome'];
  readonly size: number;
}) {
  const tint = TINTS[outcome];

  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      {kind === 'trade' ? <TradeMark tint={tint} /> : null}
      {kind === 'funding' ? <TransferMark direction="in" tint={tint} /> : null}
      {kind === 'withdrawal' ? <TransferMark direction="out" tint={tint} /> : null}
      {kind === 'wallet' ? <WalletMark tint={tint} /> : null}
    </Svg>
  );
}

/**
 * Rising bars, which is what the trend arrow became.
 *
 * An arrow is a line, and a line has no interior to fill — the filled version of it is either a
 * thick diagonal slab or a stroke pretending to be a shape. Bars are the same statement in a form
 * that is solid by nature, and they read at a glance in a way a 3pt diagonal never did.
 */
function TradeMark({ tint }: { readonly tint: string }) {
  return (
    <>
      <Rect fill={tint} height={7.5} rx={1.3} width={4} x={3.5} y={13} />
      <Rect fill={tint} height={12} rx={1.3} width={4} x={10} y={8.5} />
      <Rect fill={tint} height={17} rx={1.3} width={4} x={16.5} y={3.5} />
    </>
  );
}

/**
 * Money in and money out: one arrow, one baseline, mirrored.
 *
 * Kept as a single component taking a direction rather than two lookalike drawings, because they are
 * one operation in two directions and two separate paths would let them drift apart the first time
 * either is adjusted.
 */
function TransferMark({
  direction,
  tint,
}: {
  readonly direction: 'in' | 'out';
  readonly tint: string;
}) {
  const incoming = direction === 'in';

  return (
    <>
      <Rect
        fill={tint}
        height={8}
        rx={1.75}
        width={3.5}
        x={10.25}
        y={incoming ? 3.5 : 9.5}
      />
      {/* Sharp at the tip and blunt across the back, so the head reads as an arrow rather than as a
          rounded lozenge. The 1pt round join takes the needle off the point without softening it. */}
      <Path
        d={incoming ? 'M7 10.5h10L12 16.5Z' : 'M7 10.5h10L12 4.5Z'}
        fill={tint}
        stroke={tint}
        strokeLinejoin="round"
        strokeWidth={1}
      />
      {/* The account the money moves into or out of. Both directions share it, which is what makes
          the pair read as two halves of one idea. */}
      <Rect fill={tint} height={2.5} rx={1.25} width={17} x={3.5} y={18.5} />
    </>
  );
}

/**
 * A filled wallet with the clasp punched out rather than drawn on.
 *
 * The clasp has to be a hole, not a lighter shape: there is no container behind the mark any more,
 * so a second colour would have to guess at whatever surface the row happens to sit on. A hole is
 * correct on every surface.
 */
function WalletMark({ tint }: { readonly tint: string }) {
  return (
    <Path
      // Body and clasp in one path under `evenodd`, so the clasp is genuinely absent rather than
      // painted over in a matching colour. Nothing here can know what is behind it — the card is a
      // gradient, so any "matching" fill would only be right at one height of the ramp — and a real
      // hole is correct on every surface the mark is ever placed on.
      d={
        'M6.5 5h11A3.5 3.5 0 0 1 21 8.5V16a3.5 3.5 0 0 1-3.5 3.5h-11A3.5 3.5 0 0 1 3 16V8.5A3.5 3.5 0 0 1 6.5 5Z' +
        'M15.5 12.25a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0Z'
      }
      fill={tint}
      fillRule="evenodd"
    />
  );
}
