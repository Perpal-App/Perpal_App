import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { ActionButton } from '@/components/ui/ActionButton';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import type { FundsRequest } from '@/features/portfolio/components/FundsSheet';
import {
  WalletScopeSlider,
  type WalletScope,
} from '@/features/portfolio/components/WalletScopeSlider';
import { WalletTokenList } from '@/features/portfolio/components/WalletTokenList';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { colors, layout, motion, spacing, typography } from '@/theme/tokens';

export function WalletAccountSection({
  balances,
  onRequest,
  snapshot,
}: {
  readonly balances: WalletBalances | null;
  readonly onRequest: (request: FundsRequest) => void;
  readonly snapshot: PacificaPortfolioSnapshot | null;
}) {
  const reduceMotion = useReducedMotion();
  const window = useWindowDimensions();
  const [scope, setScope] = useState<WalletScope>('public');
  const progress = useSharedValue(0);
  const pageWidth = Math.max(
    Math.min(window.width, layout.maxContentWidth) - layout.screenPadding * 2,
    1,
  );

  const select = useCallback((next: WalletScope) => {
    setScope(next);
    const target = next === 'public' ? 0 : 1;
    progress.set(reduceMotion ? target : withSpring(target, motion.spring));
  }, [progress, reduceMotion]);

  const pagerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -progress.value * pageWidth }],
  }));

  return (
    <View style={styles.section}>
      <WalletScopeSlider onSelect={select} progress={progress} selected={scope} />
      <View style={styles.viewport}>
        <Animated.View
          style={[
            styles.pages,
            { width: pageWidth * 2 },
            pagerStyle,
          ]}
        >
          <WalletPage title="Public wallet" width={pageWidth}>
            <WalletTokenList wallet={balances?.publicWallet ?? null} />
            <View style={styles.actions}>
              <ActionButton
                label="Deposit"
                onPress={() => onRequest({ mode: 'deposit' })}
                style={styles.action}
              />
              <ActionButton
                label="Swap"
                onPress={() => onRequest({ mode: 'swap', scope: 'public' })}
                style={styles.action}
                tone="neutral"
              />
              <ActionButton
                label="Send"
                onPress={() => onRequest({ mode: 'public-send' })}
                style={styles.action}
                tone="neutral"
              />
            </View>
          </WalletPage>

          <WalletPage title="Private funds" width={pageWidth}>
            <PacificaBalance snapshot={snapshot} />
            <WalletTokenList wallet={balances?.privateWallet ?? null} />
            <View style={styles.actions}>
              <ActionButton
                label="Swap"
                onPress={() => onRequest({ mode: 'swap', scope: 'private' })}
                style={styles.action}
              />
              <ActionButton
                label="Withdraw"
                onPress={() => onRequest({ mode: 'private-withdraw' })}
                style={styles.action}
                tone="neutral"
              />
            </View>
          </WalletPage>
        </Animated.View>
      </View>
    </View>
  );
}

function WalletPage({
  children,
  title,
  width,
}: {
  readonly children: ReactNode;
  readonly title: string;
  readonly width: number;
}) {
  return (
    <View style={[styles.page, { width: Math.max(width, 1) }]}>
      <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
      {children}
    </View>
  );
}

function PacificaBalance({ snapshot }: { readonly snapshot: PacificaPortfolioSnapshot | null }) {
  return (
    <View style={styles.providerRow}>
      <View style={styles.providerCopy}>
        <Text style={styles.providerLabel}>Trading equity</Text>
        <Text style={styles.providerName}>Pacifica</Text>
      </View>
      {snapshot === null ? (
        <SkeletonText role="label" width={88} />
      ) : (
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          numberOfLines={1}
          selectable
          style={styles.providerValue}
        >
          {decimal(snapshot.accountEquity)} USDC
        </Text>
      )}
    </View>
  );
}

function decimal(value: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(value);
  if (match === null) return '--';
  const whole = (match[1] ?? '0').replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const fraction = match[2]?.replace(/0+$/u, '') ?? '';
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  viewport: { overflow: 'hidden' },
  pages: { flexDirection: 'row', alignItems: 'flex-start' },
  page: { gap: spacing.sm, paddingTop: spacing.xs },
  heading: { ...typography.label, color: colors.textPrimary },
  actions: { flexDirection: 'row', gap: spacing.xs },
  action: { flex: 1, minWidth: 0 },
  providerRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
  },
  providerCopy: { flex: 1, minWidth: 0, gap: 1 },
  providerLabel: { ...typography.label, color: colors.textPrimary },
  providerName: { ...typography.eyebrow, color: colors.textMuted },
  providerValue: {
    ...typography.label,
    maxWidth: '58%',
    color: colors.textPrimary,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
