import * as Application from 'expo-application';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Placeholder root route. It exists so the native shell can be verified on a
 * device before any product surface is built. No product UI here yet.
 */
export default function Index() {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
    >
      <Text style={styles.title} accessibilityRole="header">
        Pivote
      </Text>
      <Text style={styles.body}>Native shell initialized. No features implemented yet.</Text>
      <View style={styles.panel}>
        <Row label="Build" value={Application.nativeBuildVersion ?? 'unknown'} />
        <Row label="Version" value={Application.nativeApplicationVersion ?? 'unknown'} />
        <Row label="Platform" value={`${Platform.OS} ${String(Platform.Version)}`} />
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0D10', paddingHorizontal: 20, gap: 8 },
  title: { color: '#F2F4F7', fontSize: 28, fontWeight: '600', letterSpacing: -0.4 },
  body: { color: '#98A2B3', fontSize: 15, lineHeight: 22 },
  panel: {
    marginTop: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#22262E',
    backgroundColor: '#12151A',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  rowLabel: { color: '#98A2B3', fontSize: 13 },
  rowValue: {
    color: '#E4E7EC',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
});
