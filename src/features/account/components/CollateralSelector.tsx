import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProviderCollateral } from '@/integrations/perps/providerCollateral';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export function CollateralSelector({
  onClose,
  onSelect,
  options,
  selectedSymbol,
  visible,
}: {
  readonly onClose: () => void;
  readonly onSelect: (option: ProviderCollateral) => void;
  readonly options: readonly ProviderCollateral[];
  readonly selectedSymbol: ProviderCollateral['symbol'];
  readonly visible: boolean;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Close collateral selector"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.selector}>
          <Text accessibilityRole="header" style={styles.title}>
            Select collateral
          </Text>
          {options.map((option) => {
            const selected = option.symbol === selectedSymbol;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={option.mint}
                onPress={() => onSelect(option)}
                style={({ pressed }) => [
                  styles.option,
                  selected && styles.optionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <View>
                  <Text style={styles.value}>{option.symbol}</Text>
                  <Text style={styles.detail}>Available for either provider</Text>
                </View>
                <Text style={styles.state}>{selected ? 'Selected' : ''}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  selector: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  title: { ...typography.heading, color: colors.textPrimary },
  option: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionSelected: { borderColor: colors.accent },
  pressed: { opacity: 0.72 },
  value: { ...typography.body, color: colors.textPrimary },
  detail: { ...typography.bodyCompact, color: colors.textSecondary },
  state: { ...typography.bodyCompact, color: colors.accentSoft },
});
