import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { TabBarIcon } from '@/assets/svg/TabBarIcon';
import { colors, fonts } from '@/theme/tokens';

/**
 * Authenticated bottom-tab shell. Uses expo-router's JS Tabs (which wraps its
 * own vendored bottom-tabs, so no extra dependency) with a tokenized bar. Each
 * screen renders through AppScreen, which owns the safe area; the navigator
 * supplies the tab bar's own bottom inset.
 */
export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="trade"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen
        name="trade"
        options={{
          title: 'Markets',
          tabBarIcon: ({ color }) => <TabBarIcon color={color} name="trade" />,
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: 'Portfolio',
          tabBarIcon: ({ color }) => (
            <TabBarIcon color={color} name="portfolio" />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ color }) => (
            <TabBarIcon color={color} name="account" />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
  },
  tabLabel: {
    // No lineHeight: the tab bar sizes its own label box, and Poppins' natural
    // 1.5em leading is what keeps the descender in "Portfolio" off the crop.
    fontFamily: fonts.semiBold,
    fontSize: 11,
  },
});
