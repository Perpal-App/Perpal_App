import { BlurTargetView } from 'expo-blur';
import { useRouter, useSegments } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { useCallback, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { GlassTabBar, type GlassTabItem } from '@/navigation/tabs/GlassTabBar';
import { GlassTabButton } from '@/navigation/tabs/GlassTabButton';
import { TabBarMinimizeProvider } from '@/navigation/tabs/minimizeState';
import { renderTabScreen } from '@/navigation/tabs/tabScreenTransition';
import { colors } from '@/theme/tokens';

/**
 * The group has no `index` route, so without this expo-router would sort the tab
 * routes alphabetically and land on `account`. Pinning it keeps the landing screen
 * aligned with the bar's first item, which also means the highlight starts under
 * the focused tab instead of springing across the pill on launch.
 */
export const unstable_settings = { initialRouteName: 'home' };

/**
 * Tab order is the bar's order and the scrub axis, so it is declared once here and
 * everything else — highlight position, haptic boundaries, index-based selection —
 * derives from it.
 */
const TABS: readonly (GlassTabItem & { readonly href: string })[] = [
  // `/home` rather than `/`: the root path is the onboarding route, so the home tab
  // needs a segment of its own or the two would resolve to the same URL.
  { name: 'home', label: 'Home', icon: 'home', href: '/home' },
  { name: 'trade', label: 'Markets', icon: 'trade', href: '/trade' },
  { name: 'portfolio', label: 'Portfolio', icon: 'portfolio', href: '/portfolio' },
  { name: 'account', label: 'Profile', icon: 'account', href: '/account' },
];

/**
 * Authenticated shell built on expo-router's headless tabs.
 *
 * The navigator draws no bar of its own: `TabSlot` renders the focused screen full
 * height and the glass pill floats over it, which is what lets the bar shrink and
 * blur the content passing underneath. Screens keep their own safe area through
 * `AppScreen` and add `TAB_BAR_CLEARANCE` to their bottom padding so nothing hides
 * behind the pill.
 *
 * Selection is driven by index rather than by each trigger's own press: the bar
 * owns a single gesture across the whole capsule so a finger can scrub between
 * tabs, and a per-trigger handler could not see a drag that started on its
 * neighbour.
 */
export default function TabsLayout() {
  const router = useRouter();
  const blurTarget = useRef<View | null>(null);
  const segments = useSegments();

  // A tab root shares the bottom of the screen with the bar. A screen pushed on top of
  // one owns it outright — the market detail screen pins the order buttons down there,
  // and the bar cannot merely overlap them: the capsule samples what sits behind it, so
  // it would bury the buttons and take on their colour at the same time.
  //
  // Read from the route rather than declared per screen, so a detail route added later
  // gets this without anyone remembering to opt in. Phrased as "positively identified a
  // pushed screen" rather than "not a root", so any unexpected segment shape leaves the
  // bar on screen instead of hiding it on a tab where it belongs.
  const leafSegment = segments[segments.length - 1];
  const isPushedScreen =
    segments.length > 1 && TABS.every((tab) => tab.name !== leafSegment);

  const goToIndex = useCallback(
    (index: number) => {
      const tab = TABS[index];
      // `navigate`, not `replace`: replacing the route tears the group's history
      // down and remounts the destination, which is the blank frame that flashed
      // between tabs. Navigating to a tab route switches tabs and leaves each
      // tab's own stack where the user left it.
      if (tab !== undefined) router.navigate(tab.href as never);
    },
    [router],
  );

  return (
    <TabBarMinimizeProvider>
      <Tabs>
        {/* The container the bar samples for its blur. Android's blur reads a
            specific view rather than the window, so the screen host has to be a
            declared target; iOS ignores this and blurs what is behind it. */}
        <BlurTargetView ref={blurTarget} style={styles.shell}>
          {/* Tabs are siblings, not a stack, so the native push animation the rest
              of the app uses would be wrong here — there is no hierarchy to move
              through. `renderTabScreen` substitutes the shared-element morph from
              the onboarding handoff. */}
          <TabSlot renderFn={renderTabScreen} />
        </BlurTargetView>

        <TabList asChild>
          <GlassTabBar
            blurTarget={blurTarget}
            dismissed={isPushedScreen}
            onIndexSelected={goToIndex}
          >
            {TABS.map((tab, index) => (
              <TabTrigger asChild href={tab.href as never} key={tab.name} name={tab.name}>
                <GlassTabButton index={index} item={tab} />
              </TabTrigger>
            ))}
          </GlassTabBar>
        </TabList>
      </Tabs>
    </TabBarMinimizeProvider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.background },
});
