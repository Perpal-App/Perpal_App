import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { AppScreen } from '@/components/layout/AppScreen';
import { layout, spacing } from '@/theme/tokens';

/**
 * Portfolio tab placeholder. Honest not-yet-available state; balances,
 * positions, and history will render here once wallet and market data are wired.
 */
export function PortfolioScreen() {
  return (
    <AppScreen>
      <View style={styles.container}>
        <EmptyState
          message="Your balances, positions, and trade history will appear here soon."
          title="Your portfolio is on the way"
        />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.lg,
  },
});
