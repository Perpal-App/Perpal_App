import {
  buildGatewaySigningMessage,
  bytesToHex,
  hexToBytes,
  isValidGatewayNonce,
  parseGatewayRpcOperation,
} from '@/integrations/api/gatewayProtocol';

describe('gateway signing protocol', () => {
  it('builds one stable domain-separated message', () => {
    const message = buildGatewaySigningMessage({
      bodyHash: 'abc123',
      idempotencyKey: '',
      network: 'devnet',
      nonce: '12345678-1234-1234-1234-123456789abc',
      operation: 'getSlot',
      timestamp: '1700000000000',
    });

    expect(new TextDecoder().decode(message)).toBe(
      [
        'perpal.gateway.v1',
        '1700000000000',
        '12345678-1234-1234-1234-123456789abc',
        'devnet',
        'getSlot',
        'abc123',
        '',
      ].join('\n'),
    );
  });

  it('round-trips fixed-length lowercase hex and rejects malformed input', () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 255]);

    expect(hexToBytes(bytesToHex(bytes), bytes.length)).toEqual(bytes);
    expect(hexToBytes('0A', 1)).toBeNull();
    expect(hexToBytes('zz', 1)).toBeNull();
    expect(hexToBytes('00', 2)).toBeNull();
  });

  it('accepts bounded random nonces only', () => {
    expect(isValidGatewayNonce('12345678-1234-1234-1234-123456789abc')).toBe(true);
    expect(isValidGatewayNonce('short')).toBe(false);
    expect(isValidGatewayNonce('bad nonce with spaces')).toBe(false);
  });

  it('extracts one RPC method and rejects batches or malformed bodies', () => {
    expect(parseGatewayRpcOperation('{"jsonrpc":"2.0","method":"getSlot"}')).toBe(
      'getSlot',
    );
    expect(parseGatewayRpcOperation('[{"method":"getSlot"}]')).toBeNull();
    expect(parseGatewayRpcOperation('{not json')).toBeNull();
  });
});
