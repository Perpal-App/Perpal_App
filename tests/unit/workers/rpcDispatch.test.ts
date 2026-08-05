import {
  ProviderRouter,
  type ProviderEndpoint,
  type RouterOptions,
} from '../../../workers/gateway/src/providerRouter';
import { dispatchRpc } from '../../../workers/gateway/src/rpcDispatch';

const ENDPOINTS: readonly ProviderEndpoint[] = [
  { id: 'helius', url: 'https://helius.example' },
  { id: 'alchemy', url: 'https://alchemy.example' },
];

const OPTIONS: RouterOptions = {
  failureThreshold: 2,
  openDurationMs: 1_000,
  hedgeAfterMs: 100,
  timeoutMs: 1_000,
};

const okResponse = { ok: true, status: 200 } as Response;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('dispatchRpc', () => {
  it('broadcasts identical write bytes to every healthy provider', async () => {
    const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>(
      async () => okResponse,
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await dispatchRpc(
      new ProviderRouter(ENDPOINTS, OPTIONS),
      '{"method":"sendTransaction"}',
      'write',
    );

    expect(result.routing).toBe('broadcast');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[1]?.body)).toEqual([
      '{"method":"sendTransaction"}',
      '{"method":"sendTransaction"}',
    ]);
  });

  it('fails an idempotent heavy read over to the other provider', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockRejectedValueOnce(new Error('primary unavailable'))
      .mockResolvedValueOnce(okResponse);
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await dispatchRpc(
      new ProviderRouter(ENDPOINTS, OPTIONS),
      '{"method":"getProgramAccounts"}',
      'heavy-read',
    );

    expect(result.routing).toBe('failover');
    expect(result.provider.id).toBe('alchemy');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
