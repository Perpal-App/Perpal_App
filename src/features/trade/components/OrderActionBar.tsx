import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { readAppConfig } from '@/config/appConfig';
import { PacificaOrderTicket } from '@/features/trade/components/PacificaOrderTicket';
import type { PacificaOrderSide } from '@/integrations/perps/pacifica/pacificaOrder';
import type {
  PacificaMarket,
  PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import { colors, gradients, layout, radii, spacing, typography } from '@/theme/tokens';

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

      <View style={styles.actions}>
        <SideButton disabled={!tradable} onPress={() => setSide('long')} side="long" />
        <SideButton disabled={!tradable} onPress={() => setSide('short')} side="short" />
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
                  swapBuildUrl={config.value.api.swapBuildUrl}
                  usdcMint={config.value.perps.usdcMint}
                  usdtMint={config.value.perps.usdtMint}
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

function SideButton({
  disabled,
  onPress,
  side,
}: {
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly side: PacificaOrderSide;
}) {
  const long = side === 'long';
  const ramp = long ? gradients.longAction : gradients.shortAction;

  return (
    <Pressable
      accessibilityHint="Opens the order ticket on this side"
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { borderColor: long ? colors.longEdge : colors.shortEdge },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <LinearGradient
        colors={ramp.colors}
        end={{ x: 0.5, y: 1 }}
        locations={ramp.locations}
        start={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <Text style={[styles.label, long ? styles.onLong : styles.onShort]}>
        {long ? 'Buy / Long' : 'Sell / Short'}
      </Text>
    </Pressable>
  );
}

/** Compact by intent: tall enough to hit, short enough to leave the data room. */
const BUTTON_HEIGHT = 42;

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
  button: {
    flex: 1,
    height: BUTTON_HEIGHT,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radii.sm,
  },
  label: { ...typography.label },
  onLong: { color: colors.onLight },
  onShort: { color: colors.onAccent },
  pressed: { opacity: 0.86 },
  disabled: { opacity: 0.4 },
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
