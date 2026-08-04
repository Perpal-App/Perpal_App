import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { AppScreen } from '@/components/layout/AppScreen';
import { layout, spacing } from '@/theme/tokens';

/**
 * Trade tab placeholder. Honest not-yet-available state; the perpetuals trade
 * ticket and order flow will render here once the execution path is built.
 */
export function TradeScreen() {
  return (
    <AppScreen>
      <View style={styles.container}>
        <EmptyState
          message="Placing and managing perpetual trades will be available here soon."
          title="Trading is on the way"
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
