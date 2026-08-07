import { useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, fonts, spacing } from '@/theme/tokens';

const CODE_LENGTH = 6;
const PRIVY_BORDER = '#E2E3F0';
const PRIVY_ERROR = '#EF4444';
const PRIVY_TEXT = '#040217';
const PRIVY_SURFACE = '#FFFFFF';

type PrivyOtpInputProps = {
  value: string;
  editable: boolean;
  error: boolean;
  onChangeText: (value: string) => void;
  onComplete: (value: string) => void;
};

/** Six-cell OTP field matching Privy's confirmation-code presentation. */
export function PrivyOtpInput({
  value,
  editable,
  error,
  onChangeText,
  onComplete,
}: PrivyOtpInputProps) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const activeIndex = focused ? Math.min(value.length, CODE_LENGTH - 1) : -1;

  const updateValue = (rawValue: string) => {
    const nextValue = rawValue.replace(/\D/g, '').slice(0, CODE_LENGTH);
    onChangeText(nextValue);

    if (nextValue.length === CODE_LENGTH && value.length < CODE_LENGTH) {
      onComplete(nextValue);
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        ref={inputRef}
        accessibilityLabel="Email verification code"
        autoComplete="one-time-code"
        autoFocus
        caretHidden={Platform.OS === 'ios'}
        cursorColor="transparent"
        editable={editable}
        keyboardType="number-pad"
        maxLength={CODE_LENGTH}
        onBlur={() => setFocused(false)}
        onChangeText={updateValue}
        onFocus={() => setFocused(true)}
        returnKeyType="done"
        selectionColor="transparent"
        style={styles.hiddenInput}
        textContentType="oneTimeCode"
        value={value}
      />
      <Pressable
        accessible={false}
        disabled={!editable}
        onPress={() => inputRef.current?.focus()}
        style={styles.codeRow}
      >
        {[0, 1, 2].map((index) => (
          <CodeCell
            error={error}
            focused={activeIndex === index}
            key={index}
            value={value[index] ?? ''}
          />
        ))}
        <Text style={styles.separator}>−</Text>
        {[3, 4, 5].map((index) => (
          <CodeCell
            error={error}
            focused={activeIndex === index}
            key={index}
            value={value[index] ?? ''}
          />
        ))}
      </Pressable>
    </View>
  );
}

function CodeCell({
  value,
  focused,
  error,
}: {
  value: string;
  focused: boolean;
  error: boolean;
}) {
  return (
    <View
      style={[
        styles.cell,
        error && styles.errorCell,
        focused && styles.focusedCell,
      ]}
    >
      <Text style={styles.digit}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 56,
    justifyContent: 'center',
  },
  hiddenInput: {
    position: 'absolute',
    zIndex: 1,
    width: '100%',
    height: 56,
    opacity: 0,
    color: 'transparent',
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  cell: {
    flex: 1,
    minWidth: 34,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PRIVY_BORDER,
    borderRadius: 12,
    backgroundColor: PRIVY_SURFACE,
  },
  focusedCell: {
    borderWidth: 2,
    borderColor: colors.accent,
  },
  errorCell: {
    borderColor: PRIVY_ERROR,
  },
  digit: {
    color: PRIVY_TEXT,
    fontFamily: fonts.semiBold,
    fontSize: 18,
    lineHeight: 27,
  },
  separator: {
    color: PRIVY_TEXT,
    fontFamily: fonts.semiBold,
    fontSize: 18,
    lineHeight: 27,
  },
});
