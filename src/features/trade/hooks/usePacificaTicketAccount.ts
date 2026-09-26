import { parseAmount } from '@/domain/money/amount';
import { availableTradingFundsBaseUnits } from '@/features/trade/components/PacificaOrderTicketFormatting';
import { usePacificaTicketPortfolio } from '@/features/trade/hooks/usePacificaTicketPortfolio';
import { useTradeActionRecovery } from '@/features/trade/hooks/useTradeActionRecovery';
import { useTradingStablecoinBalances } from '@/features/trade/hooks/useTradingStablecoinBalances';
import { PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS } from '@/integrations/perps/pacifica/pacificaDeposit';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

/**
 * The account behind the order ticket: what it holds, where, and which of the ticket's forms that calls
 * for.
 *
 * Split out of the ticket so the component is left rendering, and so the funding rules below live
 * together with the reasons for them rather than scattered through a form.
 */
export function usePacificaTicketAccount(input: {
  readonly apiOrigin: string;
  readonly rpcUrl: string;
  readonly usdcMint: string;
}) {
  const session = useTradingSession();
  const recovery = useTradeActionRecovery({
    owner: session.address,
    provider: 'pacifica',
    rpcUrl: input.rpcUrl,
    signer: session.signer,
  });
  const privateBalances = useTradingStablecoinBalances({
    owner: session.address,
    rpcUrl: input.rpcUrl,
    signer: session.signer,
    usdcMint: input.usdcMint,
  });
  const portfolioState = usePacificaTicketPortfolio({
    account: session.address,
    apiOrigin: input.apiOrigin,
    enabled: session.status === 'ready',
  });
  const portfolio = portfolioState.portfolio;

  // A zero `availableToSpend` is not an unfunded account: open margin, pending risk changes, or reserved
  // collateral can consume spendable funds while the account still exists. The first-funding form is for
  // an account with no credited cash/activity evidence; actual order insufficiency is checked during
  // preparation against a fresh snapshot.
  const fundingOnly = portfolio !== null && !hasCreditedPacificaCollateral(portfolio);
  // `null` while the balance is still being read. Insufficiency is a claim about a number, so it waits
  // for the number rather than assuming zero — a ticket that flashed "Insufficient funds" on every open
  // and then corrected itself would be worse than the button it replaces.
  const privateUsdc = privateBalances.balances?.usdcBaseUnits ?? null;
  /**
   * The deposit on offer cannot be paid, whatever amount is typed.
   *
   * Pacifica does not credit deposits below its minimum, so a private balance under that floor cannot
   * produce a valid deposit at any size. A primary action that is the brightest thing on the card and
   * cannot succeed is the wrong shape for that state, so the ticket shows the block instead.
   */
  const cannotFund = fundingOnly && privateUsdc !== null &&
    privateUsdc < PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS;
  // Shown up front rather than only after a failed attempt, so the two figures that explain the block are
  // on screen with it. The flow's own requirement wins once it has one: that came from the venue.
  const belowMinimum = cannotFund && privateUsdc !== null
    ? { minimumBaseUnits: PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS, usdcAvailableBaseUnits: privateUsdc }
    : null;
  /**
   * Both facts or neither.
   *
   * The venue balance alone used to be enough to render, so the moment it arrived saying "nothing
   * credited" the ticket drew the deposit form while the wallet balance was still in flight — and when
   * that landed at zero the whole form was replaced by "Insufficient funds". Two reveals for one answer,
   * and the first was wrong. Only the deposit form needs the second fact; a tradable account's form
   * renders as soon as the venue answers.
   */
  const settled = portfolio !== null &&
    !(fundingOnly && (privateUsdc === null || portfolioState.checking));
  /** What the percentage presets divide and the card prints: Pacifica's spendable plus movable USDC. */
  const availableBaseUnits = portfolio === null
    ? null
    : availableTradingFundsBaseUnits(portfolio.availableToSpend, privateBalances.balances);

  return {
    availableBaseUnits,
    belowMinimum,
    cannotFund,
    fundingOnly,
    portfolio,
    portfolioState,
    recovery,
    session,
    settled,
  };
}

function hasCreditedPacificaCollateral(portfolio: PacificaPortfolioSnapshot): boolean {
  return parseAmount(portfolio.balance, 6).baseUnits > 0n ||
    portfolio.positionsCount > 0 ||
    portfolio.ordersCount > 0 ||
    portfolio.stopOrdersCount > 0;
}
