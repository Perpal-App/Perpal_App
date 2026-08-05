import * as Crypto from 'expo-crypto';

import {
  GatewayError,
  postSignedGatewayRequest,
  type GatewayRequestSigner,
} from '@/integrations/api/gatewayClient';

type RpcError = {
  readonly code: number;
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
    );
  }

  if (!Object.prototype.hasOwnProperty.call(response, 'result')) {
    throw new SolanaRpcError('Solana omitted the result.', 'rpc_invalid');
  }

  return response.result as T;
}
