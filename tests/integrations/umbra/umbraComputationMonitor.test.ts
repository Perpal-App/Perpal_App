const mockGetPollingComputationMonitor = jest.fn();
const mockSignedSolanaRpc = jest.fn();
const mockDefaultDeps = {
  accountFetcher: { fetchEncodedAccount: jest.fn() },
  clock: { now: jest.fn() },
  decoders: {},
  logger: { error: jest.fn(), warn: jest.fn() },
  rpcBuilders: {
    createRpc: jest.fn(),
    createRpcSubscriptions: jest.fn(),
  },
  timers: {},
};

jest.mock('@umbra-privacy/sdk/arcium', () => ({
  getDefaultArciumDeps: () => mockDefaultDeps,
  getPollingComputationMonitor: (...args: unknown[]) =>
    mockGetPollingComputationMonitor(...args),
}));

jest.mock('@/integrations/api/signedSolanaRpc', () => ({
  signedSolanaRpc: (input: unknown) => mockSignedSolanaRpc(input),
}));

import { createSignedPollingComputationMonitor } from '@/integrations/umbra/umbraComputationMonitor';

it('uses Umbra polling through the signed RPC adapter', async () => {
  mockGetPollingComputationMonitor.mockReturnValue({ prepareMonitor: jest.fn() });
  mockSignedSolanaRpc
    .mockResolvedValueOnce(123)
    .mockResolvedValueOnce([{ err: null, signature: 'callback-signature' }]);
  const account = { address: 'account', exists: false };
  const accountInfoProvider = jest.fn(async () => new Map([['account', account]]));
  const signer = { sign: jest.fn() } as never;

  createSignedPollingComputationMonitor({
    accountInfoProvider: accountInfoProvider as never,
    rpcUrl: 'https://gateway.example/v1/rpc',
    signer,
  });

  const [, deps] = mockGetPollingComputationMonitor.mock.calls[0];
  const rpc = deps.rpcBuilders.createRpc();

  await expect(rpc.getSlot({ commitment: 'confirmed' }).send()).resolves.toBe(123n);
  await expect(
    rpc.getSignaturesForAddress('account', { limit: 10 }).send(),
  ).resolves.toEqual([{ err: null, signature: 'callback-signature' }]);
  await expect(
    deps.accountFetcher.fetchEncodedAccount(rpc, 'account', {
      commitment: 'confirmed',
    }),
  ).resolves.toBe(account);
  expect(mockSignedSolanaRpc).toHaveBeenCalledWith(expect.objectContaining({
    method: 'getSlot',
    rpcUrl: 'https://gateway.example/v1/rpc',
    signer,
  }));
  expect(mockSignedSolanaRpc).toHaveBeenCalledWith(expect.objectContaining({
    method: 'getSignaturesForAddress',
    params: ['account', { limit: 10 }],
    rpcUrl: 'https://gateway.example/v1/rpc',
    signer,
  }));
  expect(accountInfoProvider).toHaveBeenCalledWith(
    ['account'],
    { commitment: 'confirmed' },
  );
});
