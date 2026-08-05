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

  it('does not finish a write before every provider attempt settles', async () => {
    let finishSecond: ((response: Response) => void) | undefined;
    const second = new Promise<Response>((resolve) => {
      finishSecond = resolve;
    });
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(okResponse)
      .mockReturnValueOnce(second);
    globalThis.fetch = fetchMock as typeof fetch;
    let settled = false;
    const dispatch = dispatchRpc(
      new ProviderRouter(ENDPOINTS, OPTIONS),
      '{"method":"sendTransaction"}',
      'write',
    ).finally(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    finishSecond?.(okResponse);
    await expect(dispatch).resolves.toMatchObject({ routing: 'broadcast' });
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

  it('fans out a rejected batch and restores request order', async () => {
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'getSlot' },
      { jsonrpc: '2.0', id: 2, method: 'getSlot' },
    ] as const;
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 100 })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: 200 })),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await dispatchRpc(
      new ProviderRouter(ENDPOINTS, OPTIONS),
      JSON.stringify(requests),
      'read',
      requests,
    );

    await expect(result.response.json()).resolves.toEqual([
      { jsonrpc: '2.0', id: 1, result: 100 },
      { jsonrpc: '2.0', id: 2, result: 200 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
