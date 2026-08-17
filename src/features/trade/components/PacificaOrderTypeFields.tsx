import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  AnchoredMenu,
  anchorBelow,
  type MenuAnchor,
  type MenuOption,
} from '@/components/ui/AnchoredMenu';
import { StatusRow } from '@/components/ui/StatusRow';
import type { PacificaOrderType } from '@/integrations/perps/pacifica/pacificaOrder';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const OPTIONS: readonly MenuOption<PacificaOrderType>[] = [
  { id: 'market', label: 'Market' },
  { id: 'limit', label: 'Limit' },
  { id: 'stop-market', label: 'Stop market' },
  { id: 'stop-limit', label: 'Stop limit' },
];

export function PacificaOrderTypeFields(props: {
  readonly limitPrice: string;
  readonly markPrice: string;
  readonly onLimitPriceChange: (value: string) => void;
  readonly onOrderTypeChange: (value: PacificaOrderType) => void;
  readonly onTriggerPriceChange: (value: string) => void;
  readonly orderType: PacificaOrderType;
  readonly triggerPrice: string;
}) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const label = OPTIONS.find((option) => option.id === props.orderType)?.label ?? 'Market';
  const needsLimit = props.orderType === 'limit' || props.orderType === 'stop-limit';
  const needsTrigger = props.orderType === 'stop-market' || props.orderType === 'stop-limit';

  const openMenu = () => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor(anchorBelow(x, y, width, height, width));
      setMenuOpen(true);
    });
  };

  return (
    <View style={styles.fields}>
      <View ref={anchorRef}>
        <Pressable
          accessibilityLabel={`Order type ${label}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: menuOpen }}
          onPress={openMenu}
          style={({ pressed }) => [styles.selector, pressed && styles.pressed]}
        >
          <Text numberOfLines={1} style={styles.selectorLabel}>{label}</Text>
          <Text accessibilityElementsHidden style={styles.chevron}>⌄</Text>
        </Pressable>
      </View>
      <StatusRow label="Live mark" value={props.markPrice} />
      {needsTrigger ? (
        <PriceField
          accessibilityLabel="Trigger price"
          onChangeText={props.onTriggerPriceChange}
          placeholder="Trigger price"
          value={props.triggerPrice}
        />
      ) : null}
      {needsLimit ? (
        <PriceField
          accessibilityLabel="Limit price"
          onChangeText={props.onLimitPriceChange}
          placeholder="Limit price"
          value={props.limitPrice}
        />
      ) : null}
      <AnchoredMenu
        anchor={anchor}
        onClose={() => setMenuOpen(false)}
        onSelect={(value) => {
          props.onOrderTypeChange(value);
          setMenuOpen(false);
        }}
        options={OPTIONS}
        selected={props.orderType}
        title="Order type"
        visible={menuOpen}
      />
    </View>
  );
}

function PriceField(props: {
  readonly accessibilityLabel: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder: string;
  readonly value: string;
}) {
  return (
    <View style={styles.priceField}>
      <TextInput
        accessibilityLabel={props.accessibilityLabel}
        inputMode="decimal"
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={props.value}
      />
      <Text style={styles.suffix}>USD</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { width: '100%', minWidth: 0, gap: spacing.xs },
  selector: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm, backgroundColor: colors.surface },
  selectorLabel: { ...typography.bodyCompact, color: colors.textPrimary },
  chevron: { ...typography.bodyCompact, color: colors.textMuted },
  pressed: { opacity: 0.72 },
  priceField: { minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm, backgroundColor: colors.surface },
  input: { flex: 1, minWidth: 0, minHeight: 42, paddingHorizontal: spacing.sm, color: colors.textPrimary, ...typography.bodyCompact },
  suffix: { ...typography.caption, paddingRight: spacing.sm, color: colors.textMuted },
});
