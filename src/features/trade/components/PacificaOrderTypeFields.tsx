import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  AnchoredMenu,
  anchorBelow,
  type MenuAnchor,
  type MenuOption,
} from '@/components/ui/AnchoredMenu';
import { ChevronDown } from '@/components/ui/ChevronDown';
import type { PacificaOrderType } from '@/integrations/perps/pacifica/pacificaOrder';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const OPTIONS: readonly MenuOption<PacificaOrderType>[] = [
  { id: 'market', label: 'Market' },
  { id: 'limit', label: 'Limit' },
  { id: 'stop-market', label: 'Stop market' },
  { id: 'stop-limit', label: 'Stop limit' },
];

/** Menu width when the trigger itself is narrower than its longest option. */
const MIN_MENU_WIDTH = 168;

export function PacificaOrderTypeFields(props: {
  readonly disabled?: boolean;
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
      // The menu is at least as wide as its trigger, and never narrower than its longest
      // option needs — the trigger is half a phone and `Stop market` has to arrive whole.
      setAnchor(anchorBelow(x, y, width, height, Math.max(width, MIN_MENU_WIDTH)));
      setMenuOpen(true);
    });
  };

  return (
    <View style={styles.fields}>
      {/* The trigger owns its row outright. Sharing one with the leverage field left it
          72pt wide, of which 30 went on the chevron and the insets around it — so `Market`
          arrived as `Mark…` and `Stop market` never had a chance. A menu whose trigger
          cannot say what is selected is not a menu. */}
      <View ref={anchorRef}>
        <Pressable
          accessibilityLabel={`Order type ${label}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: props.disabled, expanded: menuOpen }}
          disabled={props.disabled}
          onPress={openMenu}
          style={({ pressed }) => [
            styles.selector,
            props.disabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text numberOfLines={1} style={styles.selectorLabel}>{label}</Text>
          <ChevronDown />
        </Pressable>
      </View>
      {/* The one figure on the ticket that nothing here sets — every price the reader types is judged
          against it — so it is not another `TicketRow` in the summary's 12pt caption. A caps metric
          label and the value a step up in weight, which is the least that separates a reference price
          from the rows of derived figures below the action — and it is the treatment the market header
          behind the sheet already gives the same word and the same number.

          `MARK` beside a six-figure price is all that fits in this column; the full phrase goes to the
          screen reader. */}
      <View
        accessible
        accessibilityLabel={`Live mark price: ${props.markPrice}`}
        style={styles.markRow}
      >
        <Text style={styles.markLabel}>MARK</Text>
        <Text numberOfLines={1} style={styles.markValue}>{props.markPrice}</Text>
      </View>
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
  // 40pt tall with an 8pt gutter, matching the ticket's other controls: these sit in a
  // half-width column, and 12pt of inset on each side of a price is 12pt the price itself
  // needs. The right inset is a step tighter still, because the chevron is drawn inside its
  // own 14pt box with the stroke inset from its edges — matched paddings leave it looking
  // adrift of the edge it belongs to.
  selector: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xxs, paddingLeft: spacing.xs, paddingRight: spacing.xxs, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm, backgroundColor: colors.surface },
  selectorLabel: { ...typography.bodyCompact, flexShrink: 1, color: colors.textPrimary },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.6 },
  markRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  // `basisLabel`'s treatment from `MarketDetailHeader`, down to the tracking: that is the same word
  // against the same price one screen behind this sheet, and the two should not be different objects.
  markLabel: { ...typography.eyebrow, flexShrink: 0, letterSpacing: 0.5, color: colors.textMuted },
  // No `fontVariant: ['tabular-nums']`, for the reason `MarketTable` records: Poppins ships
  // proportional figures and no `tnum` feature, so the declaration draws nothing. The price holds its
  // place because the row is `space-between` and the text right-aligned, not because the digits are
  // equal width.
  markValue: { ...typography.label, flexShrink: 1, color: colors.textPrimary, textAlign: 'right' },
  priceField: { minWidth: 0, minHeight: 40, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm, backgroundColor: colors.surface },
  input: { flex: 1, minWidth: 0, minHeight: 38, paddingHorizontal: spacing.xs, color: colors.textPrimary, ...typography.bodyCompact },
  suffix: { ...typography.caption, paddingRight: spacing.xs, color: colors.textMuted },
});
