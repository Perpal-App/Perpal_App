import Svg, { Path, Rect } from 'react-native-svg';

import type { ActivityItem } from '@/features/portfolio/components/activityItems';
import { colors } from '@/theme/tokens';

/**
 * Which way value moved, resolved once for the whole row.
 *
 * Read from the sign already printed on the amount rather than re-derived from the event kind, and
 * that ordering matters: a funding payment goes either way round and a balance transfer can be a
 * credit or a debit, so deriving direction from the kind would eventually disagree with the number
 * sitting beside it. An unsigned amount is a move that changed nothing — an exchange, or a hop
 * between two wallets the same person owns.
 *
 * Exported so the mark and the amount cannot fall out of step: one call, one answer, two consumers.
 */
export type ActivityDirection = 'error' | 'in' | 'neutral' | 'out';

export function activityDirection(item: ActivityItem): ActivityDirection {
  if (item.outcome === 'error') return 'error';
  if (item.value?.startsWith('+') === true) return 'in';
  if (item.value?.startsWith('-') === true) return 'out';
  return 'neutral';
}

/** The amount's colour. Neutral keeps full contrast: it is still the row's primary figure. */
export function activityAmountColor(direction: ActivityDirection): string {
  if (direction === 'in') return colors.positive;
  if (direction === 'out' || direction === 'error') return colors.negative;
  return colors.textPrimary;
}

/**
 * The mark's colour, one step quieter than the amount's on a neutral row.
 *
 * A move that is neither in nor out has nothing to signal, so its glyph steps back and lets the
 * title lead. In and out take the same green and red as the figure they open, so direction is stated
 * twice on the row and a reader gets it from the shape as well as the tone.
 */
function markColor(direction: ActivityDirection): string {
  if (direction === 'in') return colors.positive;
  if (direction === 'out' || direction === 'error') return colors.negative;
  return colors.textSecondary;
}

/**
 * The mark that opens a history row.
 *
 * Filled rather than stroked, matching the notification marks: a solid shape holds its weight at
 * glyph size without a container, where a 1.8pt outline needed a bordered tile to look deliberate —
 * and that tile put a second surface and a second radius on every row of a forty-row feed.
 *
 * Direction is the vocabulary. Down for value arriving, up for value leaving, one arrow for a move
 * that goes one way, two for an exchange that goes both, rising bars for a trade. A failure takes the
 * alert shape as well as the loss colour, so an error is never read from tone alone.
 *
 * All of them fill the 3–21 band of a 24-unit box, so no shape in the column looks lighter than its
 * neighbour. The two horizontal arrows are the deliberate exception: forced to the full height they
 * stop reading as arrows and start reading as chevrons.
 */
export function ActivityMark({
  direction,
  item,
  size,
}: {
  readonly direction: ActivityDirection;
  readonly item: ActivityItem;
  readonly size: number;
}) {
  const tint = markColor(direction);

  if (direction === 'error') return <AlertMark size={size} tint={tint} />;
  if (item.kind === 'trade') return <TradeMark size={size} tint={tint} />;
  if (item.kind === 'swap') return <ExchangeMark size={size} tint={tint} />;
  if (item.kind === 'transfer') return <MoveMark size={size} tint={tint} />;

  return (
    <FlowMark direction={item.kind === 'funding' ? 'in' : 'out'} size={size} tint={tint} />
  );
}

type MarkProps = { readonly size: number; readonly tint: string };

function Frame({ children, size }: { readonly children: React.ReactNode; readonly size: number }) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      {children}
    </Svg>
  );
}

/** Rising bars. A trade has no direction to point in; it has a size and a result. */
function TradeMark({ size, tint }: MarkProps) {
  return (
    <Frame size={size}>
      <Rect fill={tint} height={7.5} rx={1.3} width={4} x={3.5} y={13} />
      <Rect fill={tint} height={12} rx={1.3} width={4} x={10} y={8.5} />
      <Rect fill={tint} height={17} rx={1.3} width={4} x={16.5} y={3.5} />
    </Frame>
  );
}

/** Value crossing the account boundary: an arrow onto a baseline, or off it. */
function FlowMark({ direction, size, tint }: MarkProps & { readonly direction: 'in' | 'out' }) {
  const incoming = direction === 'in';

  return (
    <Frame size={size}>
      <Rect fill={tint} height={8} rx={1.75} width={3.5} x={10.25} y={incoming ? 3.5 : 9.5} />
      <Path
        d={incoming ? 'M7 10.5h10L12 16.5Z' : 'M7 10.5h10L12 4.5Z'}
        fill={tint}
        stroke={tint}
        strokeLinejoin="round"
        strokeWidth={1}
      />
      <Rect fill={tint} height={2.5} rx={1.25} width={17} x={3.5} y={18.5} />
    </Frame>
  );
}

/** One arrow: a move between two wallets the same person owns. Nothing was gained or lost. */
function MoveMark({ size, tint }: MarkProps) {
  return (
    <Frame size={size}>
      <Rect fill={tint} height={2.6} rx={1.3} width={12} x={3.5} y={10.7} />
      <Path d="M13.8 6.4 21 12l-7.2 5.6Z" fill={tint} stroke={tint} strokeLinejoin="round" strokeWidth={1} />
    </Frame>
  );
}

/** Two arrows, opposed: one asset out and another back in, which is what a swap is. */
function ExchangeMark({ size, tint }: MarkProps) {
  return (
    <Frame size={size}>
      <Rect fill={tint} height={2.2} rx={1.1} width={11} x={3.5} y={6.5} />
      <Path d="M13.4 3.5 20.5 7.6l-7.1 4.1Z" fill={tint} stroke={tint} strokeLinejoin="round" strokeWidth={1} />
      <Rect fill={tint} height={2.2} rx={1.1} width={11} x={9.5} y={15.3} />
      <Path d="M10.6 12.3 3.5 16.4l7.1 4.1Z" fill={tint} stroke={tint} strokeLinejoin="round" strokeWidth={1} />
    </Frame>
  );
}

/**
 * A failure, as a shape and not only as a colour.
 *
 * Bar and dot are punched out of the disc under `evenodd` rather than painted over it in the row's
 * fill: the card behind this is a gradient, so a "matching" colour would only match at one height of
 * the ramp.
 */
function AlertMark({ size, tint }: MarkProps) {
  return (
    <Frame size={size}>
      <Path
        d={
          'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 1 0 0-17Z' +
          'M12 7.9a1.05 1.05 0 0 1 1.05 1.05v3.5a1.05 1.05 0 0 1-2.1 0V8.95A1.05 1.05 0 0 1 12 7.9Z' +
          'M10.85 16.15a1.15 1.15 0 1 0 2.3 0 1.15 1.15 0 1 0-2.3 0Z'
        }
        fill={tint}
        fillRule="evenodd"
      />
    </Frame>
  );
}
