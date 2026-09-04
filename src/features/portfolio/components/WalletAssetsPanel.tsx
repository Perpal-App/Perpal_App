import { useCallback, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { readAppConfig } from '@/config/appConfig';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import {
  WalletScopeSlider,
  type WalletScope,
} from '@/features/portfolio/components/WalletScopeSlider';
import { WalletTokenList } from '@/features/portfolio/components/WalletTokenList';
import { TokenLogo } from '@/features/portfolio/components/TokenLogo';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import type { TokenMetadataMap } from '@/integrations/solana/tokenMetadata';
import { colors, motion, spacing, typography } from '@/theme/tokens';

const EMPTY_METADATA: TokenMetadataMap = new Map();

export function WalletAssetsPanel({
  balances,
  snapshot,
}: {
  readonly balances: WalletBalances | null;
  readonly snapshot: PacificaPortfolioSnapshot | null;
}) {
  const reduceMotion = useReducedMotion();
  const [scope, setScope] = useState<WalletScope>('public');
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);

  const select = useCallback((next: WalletScope) => {
    setScope(next);
    const target = next === 'public' ? 0 : 1;
    progress.set(reduceMotion ? target : withSpring(target, motion.spring));
  }, [progress, reduceMotion]);

  const pagesStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -progress.value * width }],
  }));

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>Assets</Text>
        <Text style={styles.subtitle}>Balances by wallet</Text>
      </View>

      <WalletScopeSlider onSelect={select} progress={progress} selected={scope} />

      <View onLayout={onLayout} style={styles.viewport}>
        {width > 0 ? (
          <Animated.View style={[styles.pages, { width: width * 2 }, pagesStyle]}>
            <View style={[styles.page, { width }]}>
              <WalletTokenList
                metadata={balances?.tokenMetadata ?? EMPTY_METADATA}
                wallet={balances?.publicWallet ?? null}
              />
            </View>
            <View style={[styles.page, { width }]}>
              <PacificaBalance balances={balances} snapshot={snapshot} />
              <WalletTokenList
                metadata={balances?.tokenMetadata ?? EMPTY_METADATA}
                wallet={balances?.privateWallet ?? null}
              />
            </View>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

function PacificaBalance({
  balances,
  snapshot,
}: {
  readonly balances: WalletBalances | null;
  readonly snapshot: PacificaPortfolioSnapshot | null;
}) {
  const config = readAppConfig();
  const imageUrl = config.ok
    ? balances?.tokenMetadata.get(config.value.perps.usdcMint)?.imageUrl ?? null
    : null;
  return (
    <View style={styles.providerRow}>
      <TokenLogo url={imageUrl} />
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
  const match = /^(-?\d+)(?:\.(\d+))?$/u.exec(value);
  if (match === null) return '--';
  const rawWhole = match[1] ?? '0';
  const negative = rawWhole.startsWith('-');
  const digits = negative ? rawWhole.slice(1) : rawWhole;
  const whole = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const fraction = match[2]?.replace(/0+$/u, '') ?? '';
  const formatted = fraction.length === 0 ? whole : `${whole}.${fraction}`;
  return negative ? `-${formatted}` : formatted;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  heading: { gap: 2 },
  title: { ...typography.heading, color: colors.textPrimary },
  subtitle: { ...typography.bodyCompact, color: colors.textSecondary },
  viewport: { minHeight: 128, overflow: 'hidden' },
  pages: { flexDirection: 'row', alignItems: 'flex-start' },
  page: { gap: spacing.sm },
  providerRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingBottom: spacing.sm,
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
