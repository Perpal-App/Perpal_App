import { Stack } from 'expo-router';

import { globalScreenOptions } from '@/navigation/screenOptions';

export default function AuthLayout() {
  return <Stack screenOptions={globalScreenOptions} />;
}
