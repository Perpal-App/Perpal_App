import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from 'react-native';

type ConcealedValueProps = Omit<TextProps, 'children' | 'selectable' | 'style'> & {
  readonly hidden: boolean;
  readonly selectable?: boolean;
  readonly style?: StyleProp<TextStyle>;
  readonly value: string;
};

/** Masks a figure without changing the measured width or height of its original value. */
export function ConcealedValue({
  hidden,
  selectable = true,
  style,
  value,
  ...textProps
}: ConcealedValueProps) {
  return (
    <View
      accessible={hidden}
      style={styles.frame}
      {...(hidden ? { accessibilityLabel: 'Hidden value' } : {})}
    >
      <Text
        {...textProps}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
        selectable={selectable && !hidden}
        style={[style, hidden && styles.measuredOnly]}
      >
        {value}
      </Text>
      {hidden ? (
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          numberOfLines={1}
          style={[style, styles.mask]}
        >
          ***
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'relative', minWidth: 0 },
  measuredOnly: { opacity: 0 },
  mask: { position: 'absolute', inset: 0 },
});
