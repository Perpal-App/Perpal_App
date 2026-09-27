import { StyleSheet, Text, View } from 'react-native';

import { useRetainedValue } from '@/components/motion/useRetainedValue';
import { ConfirmDialog, type DialogOrigin } from '@/components/ui/ConfirmDialog';
import { colors, interfaceType, radii, spacing } from '@/theme/tokens';

type Tone = 'negative' | 'plain' | 'positive';

/** The pill's side padding, and the share of the panel's right inset each plain figure carries itself. */
const PILL_PAD = spacing.xs;

/** What the confirmation says about the position it would close, already formatted. */
export type PositionCloseSummary = {
  readonly entry: string;
  readonly id: string;
  readonly mark: string | null;
  readonly pnl: string;
  readonly side: 'long' | 'short';
  /** The size alone, without the token: `0.1`. */
  readonly size: string;
  readonly symbol: string;
  readonly tone: Tone;
};

const INK: Readonly<Record<Tone, string>> = {
  negative: colors.negative,
  plain: colors.textPrimary,
  positive: colors.positive,
};

/** The profit-and-loss pill's fill, the same washes the position card's pill uses. */
const WASH: Readonly<Record<Tone, string>> = {
  negative: colors.depthAsk,
  plain: colors.surface,
  positive: colors.depthBid,
};

/**
 * The question a × on the chart asks before it closes a position.
 *
 * The app's own dialog rather than the platform's: on Android that was a grey slab with teal capitals
 * in a font and a palette from no part of the app, at the one moment a reader most needs to trust what
 * they are looking at. The facts are set as the position card sets them — a label beside each figure,
 * tabular, and the profit or loss on its pill in its direction's colour — so it reads as the same
 * position the card and the chart show, and they stay live while the dialog is open.
 *
 * Holds the last position through its exit, so the card does not blank while it springs away.
 */
export function PositionCloseDialog({
  onCancel,
  onConfirm,
  origin,
  summary,
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  /** The × it was asked from, on screen: the card grows out of it and goes back into it. */
  readonly origin: DialogOrigin | null;
  /** The position being asked about, or `null` when nothing is. Must be memoised. */
  readonly summary: PositionCloseSummary | null;
}) {
  const shown = useRetainedValue(summary);
  const side = shown === null ? '' : shown.side;

  return (
    <ConfirmDialog
      actions="row"
      cancelLabel="Keep open"
      confirmLabel="Close position"
      onCancel={onCancel}
      onConfirm={onConfirm}
      origin={origin}
      title={shown === null ? 'Close position?' : `Close ${shown.symbol} ${side}?`}
      tone="negative"
      visible={summary !== null}
    >
      {shown === null ? null : (
        <View style={styles.facts}>
          <Fact label="Size" value={`${shown.size} ${shown.symbol}`} />
          <Fact label="Entry" value={shown.entry} />
          <Fact label="Mark" value={shown.mark ?? '--'} />
          <View
            accessibilityLabel={`Unrealized profit and loss: ${shown.pnl}`}
            accessible
            style={styles.fact}
          >
            <Text style={styles.label}>Unrealized PnL</Text>
            <View style={[styles.pnl, { backgroundColor: WASH[shown.tone] }]}>
              <Text numberOfLines={1} style={[styles.pnlValue, { color: INK[shown.tone] }]}>{shown.pnl}</Text>
            </View>
          </View>
        </View>
      )}
    </ConfirmDialog>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View accessibilityLabel={`${label}: ${value}`} accessible style={styles.fact}>
      <Text style={styles.label}>{label}</Text>
      <Text numberOfLines={1} selectable style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // One inset panel of facts, so the figures read as a single statement about one position rather than
  // as lines of prose. Rounded to sit inside the dialog's corner rather than square against it.
  //
  // The right inset is split: half here, half on each value. The profit and loss sits on a pill whose own
  // padding is that same half, so its figure ends exactly where every figure above it ends — with the whole
  // inset on the panel, the pill's padding pushed its figure a step left of the column.
  facts: {
    gap: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: spacing.md - PILL_PAD,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    backgroundColor: colors.background,
  },
  fact: { minHeight: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  label: { ...interfaceType.body, color: colors.textSecondary },
  value: { ...interfaceType.figure, flexShrink: 1, paddingRight: PILL_PAD, color: colors.textPrimary },
  pnl: {
    flexShrink: 1,
    paddingHorizontal: PILL_PAD,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderCurve: 'continuous',
  },
  pnlValue: interfaceType.figureRounded,
});
