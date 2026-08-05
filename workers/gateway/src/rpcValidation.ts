import {
  GATEWAY_RPC_BATCH_OPERATION,
  MAX_GATEWAY_RPC_BATCH_ENTRIES,
} from '../../../src/integrations/api/gatewayProtocol';

import { classifyMethod, type MethodClass } from './rpcAllowlist';

export type JsonRpcRequest = {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly method: string;
  readonly params?: unknown;
};

type RpcValidationFailure = {
  readonly ok: false;
  readonly code:
    | 'batch_write_unsupported'
    | 'invalid_request'
    | 'method_not_allowed';
  readonly message: string;
  readonly operation: string;
  readonly status: 400 | 403;
};

export type RpcValidationResult =
  | {
      readonly ok: true;
      readonly batchRequests: readonly JsonRpcRequest[] | null;
      readonly methodClass: MethodClass;
      readonly operation: string;
    }
  | RpcValidationFailure;

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const id = candidate.id;

  return (
    candidate.jsonrpc === '2.0' &&
    typeof candidate.method === 'string' &&
    candidate.method.length > 0 &&
    candidate.method.length <= 96 &&
    (id === null || typeof id === 'string' || typeof id === 'number')
  );
}

function idKey(id: JsonRpcRequest['id']): string {
  return `${typeof id}:${String(id)}`;
}

export function validateRpcPayload(value: unknown): RpcValidationResult {
  const requests = Array.isArray(value) ? value : [value];
  const operation = Array.isArray(value)
    ? GATEWAY_RPC_BATCH_OPERATION
    : 'rpc.invalid';

  if (
    requests.length === 0 ||
    requests.length > MAX_GATEWAY_RPC_BATCH_ENTRIES ||
    !requests.every(isJsonRpcRequest)
  ) {
    return {
      ok: false,
      code: 'invalid_request',
      message: 'Expected a valid JSON-RPC 2.0 request or bounded batch.',
      operation,
      status: 400,
    };
  }

  const typedRequests = requests as readonly JsonRpcRequest[];
  const ids = new Set(typedRequests.map((request) => idKey(request.id)));

  if (ids.size !== typedRequests.length) {
    return {
      ok: false,
      code: 'invalid_request',
      message: 'Batch request IDs must be unique.',
      operation,
      status: 400,
    };
  }

  let methodClass: MethodClass = 'read';

  for (const request of typedRequests) {
    const requestClass = classifyMethod(request.method);

    if (requestClass === null) {
      return {
        ok: false,
        code: 'method_not_allowed',
        message: `Method "${request.method}" is not on the gateway allowlist.`,
        operation: request.method,
        status: 403,
      };
    }

    if (typedRequests.length > 1 && requestClass === 'write') {
      return {
        ok: false,
        code: 'batch_write_unsupported',
        message: 'State-changing RPC requests must be sent individually.',
        operation,
        status: 400,
      };
    }

    if (requestClass === 'write' || requestClass === 'heavy-read') {
      methodClass = requestClass;
    }
  }

  return {
    ok: true,
    batchRequests: typedRequests.length > 1 ? typedRequests : null,
    methodClass,
    operation:
      typedRequests.length > 1
        ? GATEWAY_RPC_BATCH_OPERATION
        : typedRequests[0].method,
  };
}
