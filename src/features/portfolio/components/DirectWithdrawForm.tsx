import { TextInput, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import type { DirectWithdrawalSource } from '@/features/portfolio/components/directWithdrawPanelSupport';
import type { WithdrawableToken } from '@/features/portfolio/components/withdrawalAssets';
import { WithdrawalTokenSelector } from '@/features/portfolio/components/WithdrawalTokenSelector';
import {
  WithdrawChoice,
  withdrawOptionStyle,
} from '@/features/portfolio/components/WithdrawChoice';
import {
  WITHDRAW_RADIUS,
  withdrawSheetStyles as styles,
} from '@/features/portfolio/components/withdrawSheetStyles';
import type { DirectWithdrawalPhase } from '@/features/portfolio/hooks/useDirectWithdrawalRecovery';
import { colors } from '@/theme/tokens';

export type DirectDestinationMode = 'external' | 'privy';

/**
 * What a direct withdrawal is composed from: where it goes, how much, and in which token.
 *
 * Split from `DirectWithdrawPanel`, which owns the preparation, the Pacifica release, the signing and
 * the recovery — none of which this needs to know about. It renders props and reports intent, so the
 * panel is orchestration and this is the form, and neither file carries both.
 *
 * It has no heading and no note. "Direct withdrawal" restated the route button selected directly above
 * it, and "Pacifica USDC is released automatically when needed" described plumbing the reader has no
 * decision to make about — it happens either way. The public variant's note promised that fees and rent
 * are shown before approval, which the review it leads to already does; saying so in advance only added
 * a line to get past.
 */
export function DirectWithdrawForm({
  amount,
  destinationMode,
  disabled,
  externalAddress,
  maxDisabled,
  onAmountChange,
  onDestinationMode,
  onExternalAddress,
  onMax,
  onReview,
  onTokenChange,
  phase,
  running,
  selectedId,
  source,
  symbol,
  tokens,
}: {
  readonly amount: string;
  readonly destinationMode: DirectDestinationMode;
  /** True when the form cannot produce a valid request at all — no asset, or no destination wallet. */
  readonly disabled: boolean;
  readonly externalAddress: string;
  /**
   * True when there is no balance to fill in. Kept apart from `disabled` because Max only reads the
   * selected token; a destination the review still needs is no reason to refuse to fill the amount.
   */
  readonly maxDisabled: boolean;
  readonly onAmountChange: (value: string) => void;
  readonly onDestinationMode: (mode: DirectDestinationMode) => void;
  readonly onExternalAddress: (value: string) => void;
  readonly onMax: () => void;
  readonly onReview: () => void;
  readonly onTokenChange: (id: string) => void;
  readonly phase: DirectWithdrawalPhase;
  readonly running: boolean;
  readonly selectedId: string;
  readonly source: DirectWithdrawalSource;
  readonly symbol: string;
  readonly tokens: readonly WithdrawableToken[];
}) {
  return (
    <View style={styles.panel}>
      {source === 'private' ? (
        <WithdrawChoice label="To">
          <ActionButton
            accessibilityHint="Sends the withdrawal to your Privy public wallet"
            disabled={running}
            label="Public wallet"
            onPress={() => onDestinationMode('privy')}
            radius={WITHDRAW_RADIUS}
            selected={destinationMode === 'privy'}
            style={withdrawOptionStyle}
            tone={destinationMode === 'privy' ? 'accent' : 'neutral'}
          />
          <ActionButton
            accessibilityHint="Sends the withdrawal to an address you enter"
            disabled={running}
            label="Other wallet"
            onPress={() => onDestinationMode('external')}
            radius={WITHDRAW_RADIUS}
            selected={destinationMode === 'external'}
            style={withdrawOptionStyle}
            tone={destinationMode === 'external' ? 'accent' : 'neutral'}
          />
        </WithdrawChoice>
      ) : null}

      <View style={styles.amountRow}>
        <TextInput
          accessibilityLabel={`${symbol} withdrawal amount`}
          editable={!running}
          inputMode="decimal"
          onChangeText={onAmountChange}
          placeholder="0.00"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.amountInput]}
          value={amount}
        />
        <WithdrawalTokenSelector
          disabled={running || tokens.length === 0}
          onSelect={onTokenChange}
          selectedMint={selectedId}
          symbol={symbol}
          tokens={tokens}
        />
        <ActionButton
          accessibilityHint="Fills the amount with everything available to withdraw"
          disabled={maxDisabled || running}
          label="Max"
          onPress={onMax}
          radius={WITHDRAW_RADIUS}
          style={styles.max}
          tone="neutral"
        />
      </View>

      {source === 'public' || destinationMode === 'external' ? (
        <TextInput
          accessibilityLabel="Destination Solana wallet"
          autoCapitalize="none"
          editable={!running}
          onChangeText={onExternalAddress}
          placeholder="Solana wallet address"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={externalAddress}
        />
      ) : null}

      <ActionButton
        disabled={disabled || running}
        label={ctaLabel(phase, source)}
        loading={phase === 'preparing' || phase === 'submitting'}
        onPress={onReview}
        radius={WITHDRAW_RADIUS}
        style={styles.cta}
      />
    </View>
  );
}

/**
 * What the primary action says at each stage.
 *
 * `submitting` is still listed even though the review takes over the screen before signing: a recovered
 * withdrawal can land the panel in that phase without the review ever having been on screen.
 */
function ctaLabel(phase: DirectWithdrawalPhase, source: DirectWithdrawalSource): string {
  if (phase === 'pending') return 'Withdrawal confirming';
  if (phase === 'preparing') return 'Checking fees';
  if (phase === 'submitting') return 'Submitting withdrawal';
  return source === 'public' ? 'Review send' : 'Review direct withdrawal';
}
