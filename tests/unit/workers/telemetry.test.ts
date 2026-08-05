import { parseTelemetryEvents } from '../../../workers/gateway/src/telemetry';

const VALID = {
  release: '0.1.0-dev',
  traceId: 'trace-1',
  spanId: 'span-1',
  operation: 'rpc.getSlot',
  deviceClass: 'mid',
  network: 'mainnet',
  outcome: 'ok',
  durationMs: 42,
} as const;

describe('parseTelemetryEvents', () => {
  it('accepts one redacted event or a bounded batch', () => {
    expect(parseTelemetryEvents(VALID)).toEqual([VALID]);
    expect(parseTelemetryEvents([VALID, { ...VALID, spanId: 'span-2' }])).toHaveLength(2);
  });

  it('rejects extra fields that could carry sensitive payloads', () => {
    expect(parseTelemetryEvents({ ...VALID, wallet: 'sensitive' })).toBeNull();
    expect(parseTelemetryEvents({ ...VALID, signature: 'sensitive' })).toBeNull();
  });

  it('rejects invalid durations and oversized batches', () => {
    expect(parseTelemetryEvents({ ...VALID, durationMs: -1 })).toBeNull();
    expect(parseTelemetryEvents(Array.from({ length: 21 }, () => VALID))).toBeNull();
  });
});
