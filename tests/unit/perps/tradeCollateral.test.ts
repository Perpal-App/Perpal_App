import {
  preparePacificaTradeCollateral,
  submitTradeCollateralStep,
  TradeFundingRequirementError,
  type TradeCollateralStep,
} from '@/integrations/perps/tradeCollateral';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';

/**
 * The just-in-time collateral path, which had no coverage at all.
 *
 * It is the half of Pacifica funding that decides *how much* to deposit, and it is the only half that
 * asks the venue what it already holds. Every case here is about that arithmetic being right in base
 * units, plus the two rejections that must happen before a transaction is ever built.
 *
 * `pacificaDeposit` is mocked except for its minimum, which is a venue fact rather than a collaborator:
 * Pacifica does not credit deposits under 10 USDC, so a test that invented its own figure would pass
 * while the app stranded funds.
 */
jest.mock('@/integrations/perps/pacifica/pacificaDeposit', () => ({
  PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS: 10_000_000n,
  preparePacificaDeposit: jest.fn(),
  submitPacificaDeposit: jest.fn(),
}));
jest.mock('@/integrations/perps/pacifica/pacificaPortfolio', () => ({
  fetchFreshPacificaPortfolio: jest.fn(),
}));
jest.mock('@/integrations/solana/stablecoinSwap', () => ({ readTokenBalance: jest.fn() }));
jest.mock('@/integrations/perps/tradeActionStorage', () => ({
  removePendingTradeAction: jest.fn(),
  writePendingTradeAction: jest.fn(),
}));

const { preparePacificaDeposit, submitPacificaDeposit } = jest.requireMock(
  '@/integrations/perps/pacifica/pacificaDeposit',
) as {
  preparePacificaDeposit: jest.Mock;
  submitPacificaDeposit: jest.Mock;
};
const { fetchFreshPacificaPortfolio } = jest.requireMock(
  '@/integrations/perps/pacifica/pacificaPortfolio',
) as { fetchFreshPacificaPortfolio: jest.Mock };
const { readTokenBalance } = jest.requireMock(
  '@/integrations/solana/stablecoinSwap',
) as { readTokenBalance: jest.Mock };

/** Only `availableToSpend` is read, so the rest of the snapshot is deliberately absent. */
function portfolio(availableToSpend: string): PacificaPortfolioSnapshot {
  return { availableToSpend } as unknown as PacificaPortfolioSnapshot;
}

function request(requiredBaseUnits: bigint) {
  return {
    apiOrigin: 'https://api.test',
    centralState: 'CentralState11111111111111111111111111111111',
    owner: 'Owner1111111111111111111111111111111111111',
    programId: 'Program111111111111111111111111111111111111',
    requiredBaseUnits,
    rpcUrl: 'https://rpc.test',
    signal: new AbortController().signal,
    signer: { publicKey: new Uint8Array(32), sign: jest.fn() },
    usdcMint: 'Usdc11111111111111111111111111111111111111',
    vault: 'Vault11111111111111111111111111111111111111',
  };
}

function depositAmountPassedToChain(): bigint {
  return (preparePacificaDeposit.mock.calls[0]?.[0] as { amountBaseUnits: bigint }).amountBaseUnits;
}

beforeEach(() => {
  preparePacificaDeposit.mockResolvedValue({ amountBaseUnits: 0n, expiresAtMs: 0, simulation: 'passed' });
  readTokenBalance.mockResolvedValue(1_000_000_000n);
});

describe('preparePacificaTradeCollateral', () => {
  it('asks for no deposit when the account already holds the collateral', async () => {
    fetchFreshPacificaPortfolio.mockResolvedValue(portfolio('25.5'));

    await expect(preparePacificaTradeCollateral(request(20_000_000n))).resolves.toBeNull();
    expect(preparePacificaDeposit).not.toHaveBeenCalled();
  });

  it('treats an exactly-covered requirement as no shortfall', async () => {
    fetchFreshPacificaPortfolio.mockResolvedValue(portfolio('20'));

    await expect(preparePacificaTradeCollateral(request(20_000_000n))).resolves.toBeNull();
  });

  it('deposits only the shortfall once it clears the venue minimum', async () => {
    fetchFreshPacificaPortfolio.mockResolvedValue(portfolio('5'));

    await preparePacificaTradeCollateral(request(30_000_000n));

    expect(depositAmountPassedToChain()).toBe(25_000_000n);
  });

  it('rounds a shortfall under the venue minimum up to it', async () => {
    fetchFreshPacificaPortfolio.mockResolvedValue(portfolio('0'));

    await preparePacificaTradeCollateral(request(3_000_000n));

    // Not 3 USDC. Pacifica does not credit below 10, so submitting the shortfall would strand it.
    expect(depositAmountPassedToChain()).toBe(10_000_000n);
  });

  it('subtracts the credited balance before applying the minimum', async () => {
    fetchFreshPacificaPortfolio.mockResolvedValue(portfolio('5'));

    await preparePacificaTradeCollateral(request(12_000_000n));

    // Shortfall is 7, which is under the minimum, so it becomes 10 rather than the full 12.
    expect(depositAmountPassedToChain()).toBe(10_000_000n);
  });

  it('rejects before building a transaction when the private wallet cannot pay', async () => {
    fetchFreshPacificaPortfolio.mockResolvedValue(portfolio('0'));
    readTokenBalance.mockResolvedValue(0n);

    const failure = await preparePacificaTradeCollateral(request(4_000_000n)).catch(
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(TradeFundingRequirementError);
    expect((failure as TradeFundingRequirementError).requirement).toEqual({
      minimumBaseUnits: 10_000_000n,
      usdcAvailableBaseUnits: 0n,
    });
    // The state behind the order ticket's funding dead end: nothing is signed, nothing is built.
    expect(preparePacificaDeposit).not.toHaveBeenCalled();
  });

  it('rejects a malformed balance rather than coercing it', async () => {
    fetchFreshPacificaPortfolio.mockResolvedValue(portfolio('not-a-number'));

    await expect(preparePacificaTradeCollateral(request(4_000_000n))).rejects.toThrow(
      'Pacifica balance is invalid.',
    );
  });
});

describe('submitTradeCollateralStep', () => {
  function step(expiresAtMs: number): TradeCollateralStep {
    return {
      kind: 'pacifica-deposit',
      provider: 'pacifica',
      plan: {
        amountBaseUnits: 10_000_000n,
        expiresAtMs,
        idempotencyKey: 'key',
        simulation: 'passed',
      },
    } as unknown as TradeCollateralStep;
  }

  it('refuses an expired preparation without submitting it', async () => {
    await expect(submitTradeCollateralStep({
      owner: 'Owner1111111111111111111111111111111111111',
      rpcUrl: 'https://rpc.test',
      signal: new AbortController().signal,
      signer: { publicKey: new Uint8Array(32), sign: jest.fn() },
      step: step(Date.now() - 1),
    })).rejects.toThrow('Trade preparation expired. Prepare it again.');

    expect(submitPacificaDeposit).not.toHaveBeenCalled();
  });

  it('submits a preparation that is still current', async () => {
    submitPacificaDeposit.mockResolvedValue({ signature: 'sig', status: 'confirmed' });

    await expect(submitTradeCollateralStep({
      owner: 'Owner1111111111111111111111111111111111111',
      rpcUrl: 'https://rpc.test',
      signal: new AbortController().signal,
      signer: { publicKey: new Uint8Array(32), sign: jest.fn() },
      step: step(Date.now() + 30_000),
    })).resolves.toEqual({ signature: 'sig', status: 'confirmed' });

    expect(submitPacificaDeposit).toHaveBeenCalledTimes(1);
  });
});
