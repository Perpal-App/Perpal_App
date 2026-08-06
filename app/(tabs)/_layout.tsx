import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { TabBarIcon } from '@/assets/svg/TabBarIcon';
import { colors } from '@/theme/tokens';

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
    fontSize: 11,
    fontWeight: '600',
  },
});
