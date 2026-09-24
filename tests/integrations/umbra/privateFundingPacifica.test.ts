import type { AppConfig } from '@/config/appConfig';
import { fundPacificaFromPrivateWallet } from '@/integrations/umbra/privateFundingPacifica';
import type { PrivateFundingRecord } from '@/integrations/umbra/umbraSecureStorage';

/**
 * The hand-off between the two Pacifica deposit paths.
 *
 * This flow keeps its deposit checkpoint inside the Umbra funding record, keyed by the public wallet.
 * The order ticket reconciles a different store, keyed by the trading wallet — so until this flow also
 * wrote there, a deposit it had signed was invisible to the ticket. Pacifica reports zero available
 * until a deposit confirms, so the ticket would size the same shortfall again and sign a second one.
 *
 * These cases pin the shared record being written before the transaction is broadcast and cleared once
 * it confirms. They are the regression net for the double-deposit window, not for the deposit itself.
 */
jest.mock('@/integrations/perps/pacifica/pacificaDeposit', () => ({
  PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS: 10_000_000n,
  preparePacificaDeposit: jest.fn(),
  submitPacificaDeposit: jest.fn(),
}));
jest.mock('@/integrations/perps/tradeActionStorage', () => ({
  removePendingTradeAction: jest.fn(),
  writePendingTradeAction: jest.fn(),
}));
jest.mock('@/integrations/solana/signedLegacyTransaction', () => ({
  readSubmittedTransactionStatus: jest.fn(),
  storedLegacyTransactionIsCurrent: jest.fn(),
  submitSignedLegacyTransaction: jest.fn(),
  TransactionSigningError: class extends Error {
    constructor(message: string, readonly code = 'signing_failed') {
      super(message);
    }
  },
}));

const deposit = jest.requireMock('@/integrations/perps/pacifica/pacificaDeposit') as {
  preparePacificaDeposit: jest.Mock;
  submitPacificaDeposit: jest.Mock;
};
const store = jest.requireMock('@/integrations/perps/tradeActionStorage') as {
  removePendingTradeAction: jest.Mock;
  writePendingTradeAction: jest.Mock;
};

const TRADING_WALLET = 'Trading1111111111111111111111111111111111';

const PLAN = {
  amountBaseUnits: 12_000_000n,
  expiresAtMs: Date.now() + 45_000,
  idempotencyKey: 'idem-key',
  simulation: 'passed' as const,
};

function record(): PrivateFundingRecord {
  return {
    noteAmountBaseUnits: '12000000',
    providerDepositExpiresAtMs: null,
    providerDepositIdempotencyKey: null,
    providerDepositSignature: null,
    providerDepositSignedTransactionBase64: null,
    tradingWalletAddress: TRADING_WALLET,
  } as unknown as PrivateFundingRecord;
}

function config(): AppConfig {
  return { api: { rpcUrl: 'https://rpc.test' }, perps: {
    pacificaCentralState: 'Central1111111111111111111111111111111111',
    pacificaProgramId: 'Program111111111111111111111111111111111111',
    pacificaVault: 'Vault11111111111111111111111111111111111111',
    usdcMint: 'Usdc11111111111111111111111111111111111111',
  } } as unknown as AppConfig;
}

function run(onCheckpoint = jest.fn().mockResolvedValue(undefined)) {
  return fundPacificaFromPrivateWallet({
    config: config(),
    onCheckpoint,
    record: record(),
    signer: { publicKey: new Uint8Array(32), sign: jest.fn() },
  });
}

beforeEach(() => {
  deposit.preparePacificaDeposit.mockResolvedValue(PLAN);
});

it('records the deposit in the shared store before it is broadcast', async () => {
  const order: string[] = [];
  store.writePendingTradeAction.mockImplementation(() => {
    order.push('shared-store-written');
    return Promise.resolve();
  });
  deposit.submitPacificaDeposit.mockImplementation(async (input: {
    onSigned: (signature: string, transaction: string) => Promise<void>;
  }) => {
    await input.onSigned('sig-1', 'base64-tx');
    order.push('broadcast');
    return { signature: 'sig-1', status: 'confirmed' };
  });

  await expect(run()).resolves.toBe('sig-1');

  // Ordering is the guarantee. A record written after the broadcast would leave a window in which the
  // ticket could still size and sign a second deposit for the same collateral.
  expect(order).toEqual(['shared-store-written', 'broadcast']);
  expect(store.writePendingTradeAction).toHaveBeenCalledWith(expect.objectContaining({
    amountBaseUnits: '12000000',
    idempotencyKey: 'idem-key',
    kind: 'collateral',
    owner: TRADING_WALLET,
    provider: 'pacifica',
    signature: 'sig-1',
  }));
});

it('clears the shared record once the deposit confirms', async () => {
  deposit.submitPacificaDeposit.mockImplementation(async (input: {
    onSigned: (signature: string, transaction: string) => Promise<void>;
  }) => {
    await input.onSigned('sig-2', 'base64-tx');
    return { signature: 'sig-2', status: 'confirmed' };
  });

  await run();

  expect(store.removePendingTradeAction).toHaveBeenCalledWith(TRADING_WALLET, 'pacifica');
});

it('clears the shared record when the submission is rejected', async () => {
  deposit.submitPacificaDeposit.mockImplementation(async (input: {
    onSubmissionRejected: () => Promise<void>;
  }) => {
    await input.onSubmissionRejected();
    return { signature: 'sig-3', status: 'pending' };
  });

  await expect(run()).rejects.toThrow(/still confirming/u);
  expect(store.removePendingTradeAction).toHaveBeenCalledWith(TRADING_WALLET, 'pacifica');
});

it('leaves the shared record in place while the deposit is still confirming', async () => {
  deposit.submitPacificaDeposit.mockImplementation(async (input: {
    onSigned: (signature: string, transaction: string) => Promise<void>;
  }) => {
    await input.onSigned('sig-4', 'base64-tx');
    return { signature: 'sig-4', status: 'pending' };
  });

  await expect(run()).rejects.toThrow(/still confirming/u);

  // The whole point: an unconfirmed deposit stays visible to the order ticket.
  expect(store.writePendingTradeAction).toHaveBeenCalledTimes(1);
  expect(store.removePendingTradeAction).not.toHaveBeenCalled();
});

it('refuses a note below the venue minimum without touching either store', async () => {
  const below = {
    ...record(),
    noteAmountBaseUnits: '9000000',
  } as unknown as PrivateFundingRecord;

  await expect(fundPacificaFromPrivateWallet({
    config: config(),
    onCheckpoint: jest.fn(),
    record: below,
    signer: { publicKey: new Uint8Array(32), sign: jest.fn() },
  })).rejects.toThrow('Pacifica must receive at least 10 USDC after the Umbra fee.');

  expect(deposit.preparePacificaDeposit).not.toHaveBeenCalled();
  expect(store.writePendingTradeAction).not.toHaveBeenCalled();
});
