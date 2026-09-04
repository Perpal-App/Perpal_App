import { Alert } from 'react-native';

import { formatTokenAmount } from '@/features/portfolio/components/withdrawalAssets';
import type { PacificaReleaseRequirement } from '@/features/portfolio/components/directWithdrawPanelSupport';
import { PACIFICA_MINIMUM_WITHDRAWAL_BASE_UNITS } from '@/integrations/perps/pacifica/pacificaWithdrawal';

export function showPacificaReleaseConfirmation(input: {
  readonly feeBaseUnits: bigint;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly release: PacificaReleaseRequirement;
}): void {
  const amountLabel = `${formatTokenAmount(input.release.amountBaseUnits, 6)} USDC`;
  const creditedBaseUnits = input.release.amountBaseUnits > input.feeBaseUnits
    ? input.release.amountBaseUnits - input.feeBaseUnits
    : 0n;
  const message = input.release.kind === 'resume'
    ? `An earlier ${amountLabel} Pacifica request is still pending. ` +
      'Resume the same request, then review the Solana transfer.'
    : `Pacifica request: ${amountLabel}\n` +
      `Credited to wallet: ${formatTokenAmount(creditedBaseUnits, 6)} USDC\n` +
      `Required shortfall: ${formatTokenAmount(input.release.shortfallBaseUnits, 6)} USDC\n` +
      `Pacifica fee: ${formatTokenAmount(input.feeBaseUnits, 6)} USDC\n\n` +
      (input.release.amountBaseUnits > input.release.shortfallBaseUnits
        ? `Pacifica requires at least ${formatTokenAmount(
          PACIFICA_MINIMUM_WITHDRAWAL_BASE_UNITS,
          6,
        )} USDC per release. `
        : '') +
      'After the USDC reaches your private wallet, review the destination and Solana costs before signing.';

  Alert.alert(
    input.release.kind === 'resume' ? 'Resume USDC release?' : 'Release USDC from Pacifica?',
    message,
    [
      { text: 'Cancel', style: 'cancel', onPress: input.onCancel },
      {
        text: input.release.kind === 'resume' ? 'Resume and continue' : 'Release and continue',
        onPress: input.onConfirm,
      },
    ],
    { cancelable: false },
  );
}
