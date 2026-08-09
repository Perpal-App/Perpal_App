import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { avatarForAddress } from '@/assets/svg/avatars';
import { AppScreen } from '@/components/layout/AppScreen';
import { layoutMorph } from '@/components/motion/layoutMorph';
import { RiseInView } from '@/components/motion/RiseInView';
import { PressableScale } from '@/components/ui/PressableScale';
import { readAppConfig } from '@/config/appConfig';
import { formatSignedBpsPercent } from '@/domain/money/amount';
import { useWalletBalances } from '@/features/account/hooks/useWalletBalances';
import { AccountOverviewCard } from '@/features/home/components/AccountOverviewCard';
import { FearGreedCard } from '@/features/home/components/FearGreedCard';
import { HomeBackdrop } from '@/features/home/components/HomeBackdrop';
import {
  MarketMoversSection,
  type MoverEntry,
} from '@/features/home/components/MarketMoversSection';
import { MarketNewsSection } from '@/features/home/components/MarketNewsSection';
import { NotificationsPanel } from '@/features/home/components/NotificationsPanel';
import { useFearGreed } from '@/features/home/hooks/useFearGreed';
import { useMarketBriefing } from '@/features/home/hooks/useMarketBriefing';
import { usePacificaPortfolio } from '@/features/portfolio/hooks/usePacificaPortfolio';
import { usePacificaMarkets } from '@/features/trade/hooks/usePacificaMarkets';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { TAB_BAR_CLEARANCE } from '@/navigation/tabs/GlassTabBar';
import { colors, gradients, layout, motion, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

/**
 * The disc, and the drawing inside it — one value, because the figures are composed to fill their
 * box and be clipped to a circle, so anything less than the full disc crops the shoulders.
 *
 * Sized to the greeting-and-address stack beside it, not to the notification disc across the
 * header. The two-line block is a few points taller than the bell's touch target, so an avatar
 * matched to the bell read as the smaller of the two things the greeting sits between; matched to
 * the block instead, its top lands with the greeting and its base with the address.
 */
const AVATAR_SIZE = 52;
const COPY_ICON_SIZE = 16;
/** How long the tick holds before the copy glyph returns. */
const COPIED_HOLD_MS = 1_600;
/** Scale the tick springs up from, so the confirmation lands rather than blinks into place. */
const COPIED_FROM_SCALE = 0.4;

/**
 * Landing screen: what the venue is doing right now, and the ways into it.
 *
 * It answers one question — where is there movement — through a single filtered list of
 * movers, either end of the 24h ranking or the reader's own bookmarks, and leaves depth to
 * the markets tab. Everything here is derived from the same venue feed the markets table
 * uses, so opening the app costs no additional request.
 */
export function HomeScreen() {
  const router = useRouter();
  const config = readAppConfig();
  const publicWallet = useWalletProvisioning();
  const Avatar = avatarForAddress(publicWallet.embeddedWalletAddress);
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
  const ranked = useMemo<readonly MoverEntry[]>(() => {
    const byRef = new Map(venue.snapshots.map((snapshot) => [snapshot.venueRef, snapshot]));

    return venue.markets
      .flatMap((market) => {
        const snapshot = byRef.get(market.venueRef);
        return snapshot === undefined ? [] : [{ market, snapshot }];
      })
      .sort((left, right) => right.snapshot.change24hBps - left.snapshot.change24hBps);
  }, [venue.markets, venue.snapshots]);

  // The two ends of the ranking, for the notification summaries only — the movers section
  // slices its own lists. Guarded on length, because with a single market in the catalog the
  // best and worst performer are the same row and reporting it twice would be a lie.
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
  const pending = ranked.length === 0;

  // Stable, so the movers rows are not handed a new callback on every price batch.
  const openMarket = useCallback(
    (venueRef: string) => router.push({
      pathname: '/(tabs)/trade/[venueRef]',
      params: { venueRef },
    }),
    [router],
  );

  return (
    <AppScreen background={<HomeBackdrop />} contentContainerStyle={styles.content}>
      <RiseInView style={styles.header}>
        <View style={styles.identity}>
          {/* Assigned from the wallet address, so a given wallet always wears the same face.
              The disc is made of the app's own card material — raise, brand wash, lit top edge
              — rather than the flat light fill it started as: a white circle on a near-black
              page read as a hole punched in the screen. The figures are pastel over navy, so
              they still carry against it. */}
          <View accessibilityElementsHidden style={styles.avatar}>
            <LinearGradient
              colors={gradients.cardSheen.colors}
              locations={gradients.cardSheen.locations}
              style={StyleSheet.absoluteFill}
            />
            <Avatar size={AVATAR_SIZE} />
          </View>
          <View style={styles.headingCopy}>
            <Text accessibilityRole="header" style={styles.greeting}>{greeting()}</Text>
            <WalletAddress address={publicWallet.embeddedWalletAddress} />
          </View>
        </View>
        <NotificationsPanel
          latestNews={briefing.data?.news.find((article) =>
            article.category === 'perps' || article.category === 'crypto')
            ?? briefing.data?.news[0]
            ?? null}
          topGainer={best === undefined
            ? null
            : `${best.market.baseAsset} ${formatSignedBpsPercent(best.snapshot.change24hBps)}`}
          topLoser={worst === undefined
            ? null
            : `${worst.market.baseAsset} ${formatSignedBpsPercent(worst.snapshot.change24hBps)}`}
        />
      </RiseInView>

      {/* Every section below the header carries the same layout spring, and it has to be every one
          of them. Reanimated animates the frame of the view the prop is on and nothing else — a
          section further down is placed at its final position on the frame after the change — so
          animating only the box that resized leaves all of its neighbours snapping around it. That
          was the rough shift: the movers list grew smoothly while the news below it jumped. Shared
          physics matters for the same reason; two springs at different rates visibly come apart. */}
      <RiseInView delay={motion.rise.stagger} layout={layoutMorph()} style={styles.summary}>
        <AccountOverviewCard
          balances={walletBalances.balances}
          balancesPending={walletBalances.status === 'loading'}
          portfolio={portfolio.snapshot}
          portfolioPending={portfolio.status === 'loading'}
        />
      </RiseInView>

      {/* Extra air either side of the sentiment block. With neither it nor the balance above in a
          container, the screen's uniform gap left them reading as one run of text; a few points
          more is enough to separate them without opening a hole in the column. */}
      <RiseInView
        delay={motion.rise.stagger * 2}
        layout={layoutMorph()}
        style={styles.sentiment}
      >
        <FearGreedCard {...fearGreed} />
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 3} layout={layoutMorph()}>
        <MarketMoversSection entries={ranked} onSelect={openMarket} pending={pending} />
      </RiseInView>

      {/* The events calendar lives inside this section now, as its "Events" tab — same
          briefing request, one heading. */}
      <RiseInView delay={motion.rise.stagger * 4} layout={layoutMorph()}>
        <MarketNewsSection {...briefing} />
      </RiseInView>
    </AppScreen>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function shortAddress(address: string | null): string {
  return address === null ? 'Privy wallet unavailable' : `${address.slice(0, 5)}…${address.slice(-4)}`;
}

/**
 * The wallet address, and copying it.
 *
 * Confirmation is the icon's job alone. Swapping the address for the word "Copied" would move the
 * only thing on the row anyone came to read, and a toast would put the answer somewhere other than
 * where the tap happened — the glyph is at the finger, so that is where the acknowledgement goes.
 *
 * It reverts on a timer rather than on the next interaction, because there may not be one: copying
 * an address is usually the last thing done here before leaving for another app.
 */
function WalletAddress({ address }: { readonly address: string | null }) {
  const reduceMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const settle = useSharedValue(1);

  useEffect(() => {
    if (!copied) return undefined;

    const timer = setTimeout(() => setCopied(false), COPIED_HOLD_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!copied || reduceMotion) return;

    // Undersized then sprung, so the tick arrives rather than appears. Only on the way in: the
    // revert is a state nobody is watching by then.
    settle.set(COPIED_FROM_SCALE);
    settle.set(withSpring(1, motion.spring));
  }, [copied, reduceMotion, settle]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: settle.value }] }));

  const copy = () => {
    if (address === null) return;

    void Clipboard.setStringAsync(address).then(
      () => {
        setCopied(true);
        AccessibilityInfo.announceForAccessibility('Public wallet address copied.');
      },
      () => AccessibilityInfo.announceForAccessibility('Public wallet address could not be copied.'),
    );
  };

  return (
    <PressableScale
      accessibilityHint="Copies the full Privy public wallet address"
      accessibilityLabel={`Copy public wallet address, ${shortAddress(address)}`}
      accessibilityRole="button"
      disabled={address === null}
      hitSlop={10}
      onPress={copy}
      style={styles.walletRow}
    >
      <Text numberOfLines={1} style={styles.walletAddress}>{shortAddress(address)}</Text>
      <Animated.View style={animatedStyle}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Animated.View>
    </PressableScale>
  );
}

/** Confirmation only. Round caps and joins, so a 1.8pt tick does not end in two hard points. */
function CheckIcon() {
  return (
    <Svg height={COPY_ICON_SIZE} viewBox="0 0 24 24" width={COPY_ICON_SIZE}>
      <Path
        d="M5 12.6 9.7 17.3 19 8"
        fill="none"
        stroke={colors.positive}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

/** Two sheets, the front one offset off the back. Rounded, so it matches the app's chrome. */
function CopyIcon() {
  return (
    <Svg height={COPY_ICON_SIZE} viewBox="0 0 24 24" width={COPY_ICON_SIZE}>
      <Path
        d="M11 9h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2ZM7 15a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2"
        fill="none"
        stroke={colors.textSecondary}
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
  // Glass, not an opaque raise: the screen now has a gradient behind it, and a solid grey disc
  // over a gradient reads as a hole punched through it. `glassTint` lets the ramp show through.
  // Clipped, so the tint, the sheen and the drawing all take the disc's shape — the figures are
  // drawn square and rely on the caller to crop them.
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdge,
    backgroundColor: colors.glassTint,
  },
  headingCopy: { flex: 1, minWidth: 0, gap: spacing.xxs, alignItems: 'flex-start' },
  // `body`, between the two roles this has been. `heading` made it the loudest thing above the
  // balance, which is not what a greeting is for; `label` is the same size and weight as the
  // section titles further down, so it read as one of them. Regular 15 is quieter than both and
  // shares its weight with neither.
  greeting: { ...typography.body, color: colors.textPrimary },
  // No fill and no leading padding: the chip's left inset was holding the address a few points
  // off the greeting's left edge, so the two lines beside the avatar never lined up. The vertical
  // padding stays because it is invisible and buys the touch target its height.
  walletRow: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingVertical: spacing.xxs,
  },
  walletAddress: { ...typography.caption, flexShrink: 1, color: colors.textPrimary },
  summary: { width: '100%' },
  sentiment: { marginTop: spacing.xs, marginBottom: spacing.xs },
});
