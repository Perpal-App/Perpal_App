import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { AppScreen } from '@/components/layout/AppScreen';
import { RiseInView } from '@/components/motion/RiseInView';
import { readAppConfig } from '@/config/appConfig';
import { formatCompactTokenPrice } from '@/domain/money/amount';
import { useWalletBalances } from '@/features/account/hooks/useWalletBalances';
import { AccountOverviewCard } from '@/features/home/components/AccountOverviewCard';
import { FearGreedCard } from '@/features/home/components/FearGreedCard';
import { MajorEventsTimeline } from '@/features/home/components/MajorEventsTimeline';
import { MarketNewsSection } from '@/features/home/components/MarketNewsSection';
import { NotificationsPanel } from '@/features/home/components/NotificationsPanel';
import { useFearGreed } from '@/features/home/hooks/useFearGreed';
import { useMarketBriefing } from '@/features/home/hooks/useMarketBriefing';
import { usePacificaPortfolio } from '@/features/portfolio/hooks/usePacificaPortfolio';
import { MarketLogo } from '@/features/trade/components/MarketLogo';
import { usePacificaMarkets } from '@/features/trade/hooks/usePacificaMarkets';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { TAB_BAR_CLEARANCE } from '@/navigation/tabs/GlassTabBar';
import { colors, layout, motion, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

/** How many movers the two lists show. Enough to scan, short enough to stay above the fold. */
const MOVER_COUNT = 4;

/**
 * Landing screen: what the venue is doing right now, and the two ways into it.
 *
 * It answers one question — where is there movement — with the biggest gainers and
 * losers by 24h change, and leaves depth to the markets tab. Everything here is
 * derived from the same venue feed the markets table uses, so opening the app costs
 * no additional request.
 */
export function HomeScreen() {
  const router = useRouter();
  const config = readAppConfig();
  const publicWallet = useWalletProvisioning();
  const tradingSession = useTradingSession();
  const venue = usePacificaMarkets(
    config.ok ? config.value.perps.pacificaApiOrigin : '',
    config.ok ? config.value.perps.pacificaAssetOrigin : '',
    config.ok ? config.value.perps.pacificaWsOrigin : '',
  );
  const fearGreed = useFearGreed(config.ok ? config.value.api.fearGreedUrl : '');
  const briefing = useMarketBriefing(
    config.ok ? config.value.api.marketBriefingUrl : '',
  );
  const walletBalances = useWalletBalances({
    privateAddress: tradingSession.address,
    publicAddress: publicWallet.embeddedWalletAddress,
    signer: tradingSession.signer,
  });
  const portfolio = usePacificaPortfolio(
    config.ok ? config.value.perps.pacificaApiOrigin : '',
    tradingSession.status === 'ready' ? tradingSession.address : null,
  );

  // Indexed, not scanned. Every price message hands back a new snapshot array, so this
  // runs at socket tick rate — and a `find` per market made that a full pass over the
  // catalog for every market in it. One Map turns the whole join linear.
  const ranked = useMemo(() => {
    const byRef = new Map(venue.snapshots.map((snapshot) => [snapshot.venueRef, snapshot]));

    return venue.markets
      .flatMap((market) => {
        const snapshot = byRef.get(market.venueRef);
        return snapshot === undefined ? [] : [{ market, snapshot }];
      })
      .sort((left, right) => right.snapshot.change24hBps - left.snapshot.change24hBps);
  }, [venue.markets, venue.snapshots]);

  // Both ends of the same sorted list. Memoized because they are read as props by child
  // lists: a fresh array on every render re-renders both lists even when the ranking has
  // not moved, and this screen re-renders for reasons that have nothing to do with prices.
  const gainers = useMemo(() => ranked.slice(0, MOVER_COUNT), [ranked]);
  const losers = useMemo(
    () => ranked.slice(-MOVER_COUNT).reverse(),
    [ranked],
  );
  const pending = ranked.length === 0;
  const copyPublicWallet = () => {
    const address = publicWallet.embeddedWalletAddress;
    if (address === null) return;
    void Clipboard.setStringAsync(address).then(
      () => AccessibilityInfo.announceForAccessibility('Public wallet address copied.'),
      () => AccessibilityInfo.announceForAccessibility('Public wallet address could not be copied.'),
    );
  };

  return (
    <AppScreen contentContainerStyle={styles.content}>
      <RiseInView style={styles.header}>
        <View style={styles.identity}>
          <View accessibilityElementsHidden style={styles.avatar}>
            <ProfileIcon />
          </View>
          <View style={styles.headingCopy}>
            <Text accessibilityRole="header" style={styles.greeting}>{greeting()}</Text>
            <View style={styles.walletLine}>
              <Text numberOfLines={1} selectable style={styles.walletAddress}>
                {shortAddress(publicWallet.embeddedWalletAddress)}
              </Text>
              <Pressable
                accessibilityHint="Copies the full Privy public wallet address"
                accessibilityLabel="Copy public wallet address"
                accessibilityRole="button"
                accessibilityState={{ disabled: publicWallet.embeddedWalletAddress === null }}
                disabled={publicWallet.embeddedWalletAddress === null}
                hitSlop={8}
                onPress={copyPublicWallet}
                style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
              >
                <CopyIcon />
              </Pressable>
            </View>
          </View>
        </View>
        <NotificationsPanel
          latestNews={briefing.data?.news.find((article) =>
            article.category === 'perps' || article.category === 'crypto')
            ?? briefing.data?.news[0]
            ?? null}
          topGainer={gainers[0] === undefined
            ? null
            : `${gainers[0].market.baseAsset} ${formatChange(gainers[0].snapshot.change24hBps)}`}
          topLoser={losers[0] === undefined
            ? null
            : `${losers[0].market.baseAsset} ${formatChange(losers[0].snapshot.change24hBps)}`}
        />
      </RiseInView>

      <RiseInView delay={motion.rise.stagger} style={styles.summary}>
        <AccountOverviewCard
          balances={walletBalances.balances}
          balancesPending={walletBalances.status === 'loading'}
          portfolio={portfolio.snapshot}
          portfolioPending={portfolio.status === 'loading'}
        />
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 2}>
        <FearGreedCard {...fearGreed} />
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 3}>
        <MoverList
          markets={gainers}
          onSelect={(venueRef) => router.push({
            pathname: '/(tabs)/trade/[venueRef]',
            params: { venueRef },
          })}
          pending={pending}
          title="Top gainers"
        />
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 4}>
        <MoverList
          markets={losers}
          onSelect={(venueRef) => router.push({
            pathname: '/(tabs)/trade/[venueRef]',
            params: { venueRef },
          })}
          pending={pending}
          title="Top losers"
        />
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 5}>
        <MajorEventsTimeline {...briefing} />
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 6}>
        <MarketNewsSection {...briefing} />
      </RiseInView>
    </AppScreen>
  );
}

type Mover = {
  readonly market: { readonly baseAsset: string; readonly iconUrl: string; readonly venueRef: string };
  readonly snapshot: { readonly change24hBps: number; readonly price: { readonly baseUnits: bigint; readonly decimals: 0 | 2 | 3 | 5 | 6 | 8 | 9 | 10 } };
};

function MoverList({
  markets,
  onSelect,
  pending,
  title,
}: {
  readonly markets: readonly Mover[];
  readonly onSelect: (venueRef: string) => void;
  readonly pending: boolean;
  readonly title: string;
}) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {pending
        ? Array.from({ length: MOVER_COUNT }, (_unused, index) => (
          <View key={index} style={styles.mover}>
            <SkeletonText role="label" width={110} />
            <SkeletonText align="right" role="label" width={90} />
          </View>
        ))
        : markets.map(({ market, snapshot }) => (
          <Pressable
            accessibilityHint="Opens market details"
            accessibilityRole="button"
            key={market.venueRef}
            onPress={() => onSelect(market.venueRef)}
            style={({ pressed }) => [styles.mover, pressed && styles.pressed]}
          >
            <View style={styles.moverIdentity}>
              <MarketLogo symbol={market.baseAsset} url={market.iconUrl} />
              <Text style={styles.moverSymbol}>{market.baseAsset}</Text>
            </View>
            <View style={styles.moverValues}>
              <Text style={styles.moverPrice}>{formatCompactTokenPrice(snapshot.price)}</Text>
              <Text style={[
                styles.moverChange,
                snapshot.change24hBps < 0 ? styles.negative : styles.positive,
              ]}>
                {formatChange(snapshot.change24hBps)}
              </Text>
            </View>
          </Pressable>
        ))}
    </View>
  );
}

function formatChange(basisPoints: number): string {
  const absolute = Math.abs(basisPoints);
  return `${basisPoints >= 0 ? '+' : '-'}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}%`;
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function shortAddress(address: string | null): string {
  return address === null ? 'Privy wallet unavailable' : `${address.slice(0, 5)}…${address.slice(-4)}`;
}

function ProfileIcon() {
  return (
    <Svg height={24} viewBox="0 0 24 24" width={24}>
      <Path
        d="M12 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5 20a7 7 0 0 1 14 0"
        fill="none"
        stroke={colors.accentSoft}
        strokeLinecap="round"
        strokeWidth={1.9}
      />
    </Svg>
  );
}

function CopyIcon() {
  return (
    <Svg height={17} viewBox="0 0 24 24" width={17}>
      <Path
        d="M9 9h10v10H9zM5 15V5h10"
        fill="none"
        stroke={colors.textMuted}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    // The floating bar draws over this screen, so the last row buys its own room.
    paddingBottom: TAB_BAR_CLEARANCE,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdge,
    backgroundColor: colors.surfaceElevated,
  },
  headingCopy: { flex: 1, minWidth: 0, gap: 2 },
  greeting: { ...typography.label, color: colors.textPrimary },
  walletLine: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  walletAddress: { ...typography.caption, flexShrink: 1, color: colors.textMuted },
  copyButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  summary: { width: '100%' },
  section: { gap: spacing.xxs },
  sectionTitle: { ...typography.label, marginBottom: spacing.xxs, color: colors.textSecondary },
  mover: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  moverIdentity: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  moverSymbol: { ...typography.label, color: colors.textPrimary },
  moverValues: { alignItems: 'flex-end' },
  moverPrice: { ...typography.label, color: colors.textPrimary },
  moverChange: { ...typography.caption },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  pressed: { opacity: 0.6, borderRadius: radii.xs },
});
