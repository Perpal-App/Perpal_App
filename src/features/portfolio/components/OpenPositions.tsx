import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  PositionCard,
  positionKey,
  useLivePositions,
  usePacificaPositionClose,
} from '@/features/trade/public';
import type { PacificaPosition } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { layout, spacing } from '@/theme/tokens';

/** With more than one position, each card takes this much of the row, so the next one shows at the edge. */
const PEEK_SHARE = 0.88;
const CARD_GAP = spacing.sm;

/**
 * The portfolio's open positions, valued at live prices and closable where they stand.
 *
 * A row of cards the reader swipes through, one card to a stop and no scroll bar. One position fills the
 * row; with more, each card is a little narrower than it, so the next card's edge says there is more.
 * Named by the segment above it, so it carries no heading of its own.
 *
 * The price feed is subscribed here rather than by the screen, so a tick redraws only these cards and not
 * the whole portfolio around them. `useLivePositions` holds it, with the leverage each position runs at,
 * and lets it go while the cards are out of sight.
 */
export function OpenPositions({
  apiOrigin,
  assetOrigin,
  enabled,
  onClosed,
  positions,
  wsOrigin,
}: {
  readonly apiOrigin: string;
  readonly assetOrigin: string;
  /** Whether the cards are on screen, which is what holds the price feed. */
  readonly enabled: boolean;
  /** After a close attempt ends, so the screen's own account read catches up. */
  readonly onClosed: () => void;
  readonly positions: readonly PacificaPosition[];
  readonly wsOrigin: string;
}) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const live = useLivePositions({ apiOrigin, assetOrigin, enabled, positions, wsOrigin });
  const positionClose = usePacificaPositionClose({ apiOrigin, assetOrigin, onSettled: onClosed });

  if (positions.length === 0) return null;

  // The width the screen's content column gives this row; the row scrolls inside it.
  const row = Math.min(width, layout.maxContentWidth) - layout.screenPadding * 2;
  const several = positions.length > 1;
  const cardWidth = several ? Math.round(row * PEEK_SHARE) : row;

  return (
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
              // Only here: the market screen's own cards already sit on a market.
              onOpen={() => router.push({
                pathname: '/market/[venueRef]',
                params: { venueRef: position.symbol },
              })}
              position={position}
            />
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  track: { gap: CARD_GAP },
});
