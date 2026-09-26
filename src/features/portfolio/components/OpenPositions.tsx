import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  PositionCard,
  positionKey,
  useLivePositions,
  usePacificaPositionClose,
} from '@/features/trade/public';
import type { PacificaPosition } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { colors, layout, spacing, typography } from '@/theme/tokens';

/** With more than one position, each card takes this much of the row, so the next one shows at the edge. */
const PEEK_SHARE = 0.88;
const CARD_GAP = spacing.sm;

/**
 * The portfolio's open positions, valued at live prices and closable where they stand.
 *
 * A row of cards the reader swipes through, one card to a stop and no scroll bar. One position fills the
 * row; with more, each card is a little narrower than it, so the next card's edge says there is more.
 *
 * The price feed is subscribed here rather than by the screen, so a tick redraws only these cards and not
 * the whole portfolio around them. `useLivePositions` holds it, with the leverage each position runs at.
 */
export function OpenPositions({
  apiOrigin,
  assetOrigin,
  onClosed,
  positions,
  wsOrigin,
}: {
  readonly apiOrigin: string;
  readonly assetOrigin: string;
  /** After a close attempt ends, so the screen's own account read catches up. */
  readonly onClosed: () => void;
  readonly positions: readonly PacificaPosition[];
  readonly wsOrigin: string;
}) {
  const { width } = useWindowDimensions();
  const live = useLivePositions({ apiOrigin, assetOrigin, positions, wsOrigin });
  const positionClose = usePacificaPositionClose({ apiOrigin, assetOrigin, onSettled: onClosed });

  if (positions.length === 0) return null;

  // The width the screen's content column gives this row; the row scrolls inside it.
  const row = Math.min(width, layout.maxContentWidth) - layout.screenPadding * 2;
  const several = positions.length > 1;
  const cardWidth = several ? Math.round(row * PEEK_SHARE) : row;

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {several ? `Open positions · ${positions.length}` : 'Open positions'}
      </Text>
      <ScrollView
        contentContainerStyle={styles.track}
        decelerationRate="fast"
        disableIntervalMomentum
        horizontal
        scrollEnabled={several}
        showsHorizontalScrollIndicator={false}
        snapToAlignment="start"
        snapToInterval={cardWidth + CARD_GAP}
      >
        {positions.map((position) => {
          const key = positionKey(position);
          return (
            <View key={key} style={{ width: cardWidth }}>
              <PositionCard
                {...live(position)}
                closeDisabled={positionClose.closing !== null}
                closing={positionClose.closing === key}
                onClose={() => positionClose.close(position)}
                position={position}
              />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  heading: { ...typography.label, color: colors.textPrimary },
  track: { gap: CARD_GAP },
});
