import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { readAppConfig } from '@/config/appConfig';
import { PacificaOrderTicket } from '@/features/trade/components/PacificaOrderTicket';
import type { PacificaOrderSide } from '@/integrations/perps/pacifica/pacificaOrder';
import type {
  PacificaMarket,
  PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

/**
 * The app's only way into an order.
 *
 * Both the buttons and the ticket they open live here, so a screen cannot grow a
 * second order form of its own: it mounts this bar, and every order in the app
 * starts from the same two controls and finishes in the same ticket. Screens pass
 * it through `AppScreen`'s `footer`, which pins it under the content whatever the
 * screen is showing above.
 *
 * The ticket opens as a sheet rather than inline. Order entry is a task, not part
 * of the page, and a sheet keeps the market data behind it on screen while the
 * ticket has focus.
 */
export function OrderActionBar({
  market,
  snapshot,
}: {
  readonly market: PacificaMarket;
  readonly snapshot: PacificaMarketSnapshot | null;
}) {
  const config = readAppConfig();
  const [side, setSide] = useState<PacificaOrderSide | null>(null);
  // Trading needs a current mark and a valid build: without either, the buttons
  // stay visible but inert rather than opening a ticket that cannot price.
  const tradable = snapshot !== null && config.ok;

  return (
    <View style={styles.bar}>
      {tradable ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.blocked}>
          {config.ok
            ? 'Waiting for a current Pacifica mark'
            : 'Market configuration unavailable'}
        </Text>
      )}

      {/* The two sides are `ActionButton`s now rather than this file's own pressables. The material
          is identical — it was lifted from here — and sharing it is what lets a deposit on the
          portfolio screen read as the same kind of control as a buy. */}
      <View style={styles.actions}>
        <ActionButton
          accessibilityHint="Opens the order ticket on this side"
          disabled={!tradable}
          label="Buy / Long"
          onPress={() => setSide('long')}
          style={styles.action}
          tone="positive"
        />
        <ActionButton
          accessibilityHint="Opens the order ticket on this side"
          disabled={!tradable}
          label="Sell / Short"
          onPress={() => setSide('short')}
          style={styles.action}
          tone="negative"
        />
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setSide(null)}
        statusBarTranslucent
        transparent
        visible={side !== null && tradable}
      >
        <View style={styles.sheetRoot}>
          <Pressable
            accessibilityLabel="Dismiss order ticket"
            accessibilityRole="button"
            onPress={() => setSide(null)}
            style={styles.scrim}
          />
          <View accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {`${market.baseAsset}-USD · ${side === 'short' ? 'Sell / Short' : 'Buy / Long'}`}
              </Text>
              <Pressable
                accessibilityLabel="Close order ticket"
                accessibilityRole="button"
                hitSlop={12}
                onPress={() => setSide(null)}
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              >
                <Text style={styles.closeLabel}>✕</Text>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {side !== null && snapshot !== null && config.ok ? (
                <PacificaOrderTicket
                  apiOrigin={config.value.perps.pacificaApiOrigin}
                  centralState={config.value.perps.pacificaCentralState}
                  initialSide={side}
                  market={market}
                  programId={config.value.perps.pacificaProgramId}
                  rpcUrl={config.value.api.rpcUrl}
                  snapshot={snapshot}
                  usdcMint={config.value.perps.usdcMint}
                  vault={config.value.perps.pacificaVault}
                />
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: spacing.xs,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  blocked: { ...typography.caption, color: colors.textMuted },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  pressed: { opacity: 0.86 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim, opacity: 0.72 },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: radii.panel,
    borderTopRightRadius: radii.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  grabber: {
    width: 44,
    height: 4,
    marginTop: spacing.sm,
    alignSelf: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.sm,
  },
  sheetTitle: { ...typography.label, flexShrink: 1, color: colors.textPrimary },
  close: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  closeLabel: { ...typography.caption, color: colors.textSecondary },
  // Generous bottom padding rather than a read inset: it clears the home
  // indicator on every device the app supports and keeps insets in one place.
  sheetContent: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
});
