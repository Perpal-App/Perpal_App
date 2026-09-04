import { validatePublicRpcPayload } from '../../../workers/gateway/src/rpcValidation';

describe('public RPC validation', () => {
  it('allows the blockhash read required to prepare a transaction', () => {
    expect(validatePublicRpcPayload({
      id: 'transaction-blockhash',
      jsonrpc: '2.0',
      method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
    }).ok).toBe(true);
  });
});
