import { Stack } from 'expo-router';

import { globalScreenOptions } from '@/navigation/screenOptions';

export default function TradeLayout() {
  return <Stack screenOptions={globalScreenOptions} />;
}
