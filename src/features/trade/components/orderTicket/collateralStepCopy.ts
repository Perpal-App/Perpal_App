import { Alert } from 'react-native';

import { amountFromBaseUnits, formatAmount } from '@/domain/money/amount';
import type { TradeCollateralStep } from '@/integrations/perps/tradeCollateral';

/**
 * What a collateral step says: the figures on its review, why it cannot run when it cannot, and the
 * confirmation that stands between it and a signature.
 *
 * One module so the rows on the page and the rows in the dialog are the same rows. A summary drawn one
 * way and confirmed another is how a reader ends up approving a figure they never saw.
 */
export function collateralStepRows(step: TradeCollateralStep): readonly (readonly [string, string])[] {
  return [
    ['Action', 'Deposit collateral to Pacifica'],
    ['Collateral', token(step.plan.amountBaseUnits)],
    ['Network fee', sol(step.plan.feeLamports)],
    ['Fee balance', sol(step.plan.solBalanceLamports)],
  ];
}

/** Why the step's simulation did not pass, as a sentence the reader can act on. */
export function collateralStepBlockedMessage(step: TradeCollateralStep): string {
  if (step.plan.simulation === 'insufficient-token') {
    return `Pacifica funding requires ${token(step.plan.amountBaseUnits)}. ` +
      `Private balance has ${token(step.plan.tokenBalanceBaseUnits)}.`;
  }
  return `Minimum network fee still needed: ${sol(step.plan.feeLamports - step.plan.solBalanceLamports)}.`;
}

/**
 * The explicit confirmation before the step is signed. `onConfirm` runs only from its own action.
 *
 * It says plainly that this is not the order: in the trading form a deposit can be the first of two
 * signatures, and a reader who thought this one placed their trade would be wrong about their position.
 */
export function confirmCollateralStep(step: TradeCollateralStep, onConfirm: () => void): void {
  const rows = collateralStepRows(step).map(([label, value]) => `${label}: ${value}`).join('\n');
  Alert.alert(
    'Confirm deposit?',
    `${rows}\n\nThis does not place the order. You will review the final order separately.`,
    [
      { style: 'cancel', text: 'Cancel' },
      { onPress: onConfirm, text: 'Confirm and sign' },
    ],
  );
}

function token(value: bigint): string {
  return `${formatAmount(amountFromBaseUnits(value, 6))} USDC`;
}

function sol(value: bigint): string {
  return `${formatAmount(amountFromBaseUnits(value > 0n ? value : 0n, 9))} SOL`;
}
