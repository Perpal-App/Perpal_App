import * as Crypto from 'expo-crypto';

import {
  GatewayError,
  postSignedGatewayRequest,
  type GatewayRequestSigner,
} from '@/integrations/api/gatewayClient';

type RpcError = {
  readonly code: number;
  readonly data?: unknown;
  readonly message: string;
};

export type SolanaRpcDiagnostic = {
  readonly detail: string | null;
  readonly logs: readonly string[];
  readonly message: string;
};

type RpcResponse<T> = {
  readonly jsonrpc: '2.0';
  readonly id: string;
  readonly result?: T;
  readonly error?: RpcError;
};

type SignedRpcRequest = {
  readonly method: string;
  readonly params?: unknown;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
};

export class SolanaRpcError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly diagnostic: SolanaRpcDiagnostic | null = null,
  ) {
    super(message);
    this.name = 'SolanaRpcError';
  }
}

export async function signedSolanaRpc<T>({
  method,
  params,
  rpcUrl,
  signer,
  idempotencyKey,
  signal,
  timeoutMs,
}: SignedRpcRequest): Promise<T> {
  const id = Crypto.randomUUID();
  let response: RpcResponse<T>;

  try {
    response = await postSignedGatewayRequest<RpcResponse<T>>({
      body: {
        jsonrpc: '2.0',
        id,
        method,
        ...(params === undefined ? {} : { params }),
      },
      cluster: 'mainnet',
      operation: method,
      signer,
      url: rpcUrl,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ...(signal === undefined ? {} : { signal }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  } catch (cause) {
    if (cause instanceof GatewayError) {
      throw new SolanaRpcError(cause.message, cause.code);
    }

    throw new SolanaRpcError('Solana request failed.', 'rpc_unavailable');
  }

  if (response.jsonrpc !== '2.0' || response.id !== id) {
    throw new SolanaRpcError('Solana returned an invalid response.', 'rpc_invalid');
  }

  if (response.error !== undefined) {
    throw new SolanaRpcError(
      'Solana rejected the request.',
      `rpc_${response.error.code}`,
      createSolanaRpcDiagnostic(response.error),
    );
  }

  if (!Object.prototype.hasOwnProperty.call(response, 'result')) {
    throw new SolanaRpcError('Solana omitted the result.', 'rpc_invalid');
  }

  const result = response.result as T;
  if (method === 'simulateTransaction') {
    const diagnostic = createSolanaSimulationDiagnostic(result);
    if (diagnostic !== null) {
      console.error('[Perpal RPC simulation]', JSON.stringify({
        event: 'rejected',
        ...diagnostic,
      }));
    }
  }

  return result;
}

export function createSolanaRpcDiagnostic(error: RpcError): SolanaRpcDiagnostic {
  const data = typeof error.data === 'object' && error.data !== null
    ? error.data as { readonly err?: unknown; readonly logs?: unknown }
    : null;
  const logs = Array.isArray(data?.logs)
    ? data.logs
        .filter((entry): entry is string => typeof entry === 'string')
        .slice(-8)
        .map(redactRpcText)
    : [];

  return {
    detail: data?.err === undefined
      ? null
      : redactRpcText(JSON.stringify(data.err)),
    logs,
    message: redactRpcText(error.message),
  };
}

export function createSolanaSimulationDiagnostic(
  result: unknown,
): SolanaRpcDiagnostic | null {
  const value = typeof result === 'object' && result !== null
    ? (result as { readonly value?: unknown }).value
    : null;
  const simulation = typeof value === 'object' && value !== null
    ? value as { readonly err?: unknown; readonly logs?: unknown }
    : null;

  if (simulation?.err === undefined || simulation.err === null) {
    return null;
  }

  return createSolanaRpcDiagnostic({
    code: -32002,
    data: simulation,
    message: 'Transaction simulation failed',
  });
}

function redactRpcText(value: string): string {
  return value
    .replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/gu, '[address]')
    .replace(/[a-z0-9+/=_-]{64,}/giu, '[data]')
    .replace(/\s+/gu, ' ')
    .slice(0, 320);
}
