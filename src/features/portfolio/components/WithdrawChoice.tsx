import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme/tokens';

/**
 * One decision in the withdraw sheet: a small label, and the buttons that answer it.
 *
 * This replaces the pattern each panel had grown independently — an 18pt `heading` plus a paragraph of
 * `bodyCompact` above its own button row. Three panels nest inside one sheet, so that produced three
 * full titles and three paragraphs stacked ahead of the single amount field the sheet exists for, each
 * one titled as loudly as the sheet itself. The reader had to get through roughly forty words to reach
 * an input.
 *
 * An `eyebrow` label instead: it names the choice without competing with the sheet's own title, and at
 * 11pt caps it reads as a field label rather than as a section of its own.
 *
 * `note` survives for the one case that earns a sentence — see the route choice, where which option is
 * visible on-chain is a privacy claim and not decoration. It is deliberately a single short line at
 * caption size, and panels that had a paragraph of mechanics now pass nothing.
 */
export function WithdrawChoice({
  children,
  label,
  note,
}: {
  /** The options. Laid out as an even row, so pass exactly the buttons. */
  readonly children: ReactNode;
  readonly label: string;
  readonly note?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {children}
      </View>
      {note === undefined ? null : <Text style={styles.note}>{note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: {
    ...typography.eyebrow,
    color: colors.textMuted,
  },
  options: { flexDirection: 'row', gap: spacing.sm },
  // Under the options rather than above them, which is where a consequence belongs: it describes what
  // the buttons just did, so reading it before the choice existed was backwards.
  note: { ...typography.caption, color: colors.textSecondary },
});

/** Even halves of the row. Exported so every panel's options are the same width. */
export const withdrawOptionStyle = StyleSheet.create({
  option: { flex: 1, minWidth: 0 },
}).option;
