import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  AnchoredMenu,
  anchorAbove,
  type MenuAnchor,
  type MenuOption,
} from '@/components/ui/AnchoredMenu';
import { PressableScale } from '@/components/ui/PressableScale';
import {
  formatTokenAmount,
  type WithdrawableToken,
} from '@/features/portfolio/components/withdrawalAssets';
import { colors, gradients, layout, radii, spacing, typography } from '@/theme/tokens';

const MIN_MENU_WIDTH = 196;

export function WithdrawalTokenSelector({
  disabled,
  onSelect,
  selectedMint,
  symbol,
  tokens,
}: {
  readonly disabled: boolean;
  readonly onSelect: (mint: string) => void;
  readonly selectedMint: string;
  readonly symbol: string;
  readonly tokens: readonly WithdrawableToken[];
}) {
  const anchorRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [open, setOpen] = useState(false);
  const options = useMemo<readonly MenuOption<string>[]>(
    () => tokens.map((token) => ({
      id: token.id ?? token.asset.mint,
      label: token.asset.symbol,
      ...(token.baseUnits === null
        ? {}
        : { detail: formatTokenAmount(token.baseUnits, token.asset.decimals) }),
    })),
    [tokens],
  );

  const openMenu = () => {
    anchorRef.current?.measureInWindow((x, y, width) => {
      setAnchor(anchorAbove(x, y, width, Math.max(width, MIN_MENU_WIDTH)));
      setOpen(true);
    });
  };

  return (
    <View ref={anchorRef}>
      <PressableScale
        accessibilityHint="Chooses which token to send"
        accessibilityLabel={`Token, ${symbol}`}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={openMenu}
        pressedScale={0.97}
        style={[styles.control, disabled && styles.disabled]}
      >
        <LinearGradient
          colors={gradients.surfaceRaise.colors}
          end={{ x: 0.5, y: 1 }}
          locations={gradients.surfaceRaise.locations}
          start={{ x: 0.5, y: 0 }}
          style={styles.fill}
        >
          <Text numberOfLines={1} style={styles.label}>{symbol}</Text>
          <Svg height={14} viewBox="0 0 24 24" width={14}>
            <Path
              d="M6 9.5 12 15.5 18 9.5"
              fill="none"
              stroke={colors.textMuted}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.2}
            />
          </Svg>
        </LinearGradient>
      </PressableScale>

      <AnchoredMenu
        anchor={anchor}
        onClose={() => setOpen(false)}
        onSelect={(next) => {
          onSelect(next);
          setOpen(false);
        }}
        options={options}
        selected={selectedMint}
        title="Token"
        visible={open}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    minHeight: layout.minTouchTarget,
    flexShrink: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
  },
  disabled: { opacity: 0.4 },
  fill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
  },
  label: { ...typography.label, color: colors.textPrimary },
});
