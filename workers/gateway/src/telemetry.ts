import type { AnalyticsEngineBinding } from './env';

const MAX_EVENTS = 20;
const MAX_TEXT = 96;

export type TelemetryEvent = {
  readonly release: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly operation: string;
  readonly deviceClass: 'low' | 'mid' | 'high' | 'unknown';
  readonly network: 'devnet' | 'mainnet';
  readonly outcome: string;
  readonly durationMs: number;
  readonly errorCode?: string;
};

const ALLOWED_KEYS = new Set([
  'release',
  'traceId',
  'spanId',
  'operation',
  'deviceClass',
  'network',
  'outcome',
  'durationMs',
  'errorCode',
]);

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT;
}

function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const event = value as Record<string, unknown>;

  if (Object.keys(event).some((key) => !ALLOWED_KEYS.has(key))) {
    return false;
  }

  return (
    isBoundedText(event.release) &&
    isBoundedText(event.traceId) &&
    isBoundedText(event.spanId) &&
    isBoundedText(event.operation) &&
    ['low', 'mid', 'high', 'unknown'].includes(String(event.deviceClass)) &&
    (event.network === 'devnet' || event.network === 'mainnet') &&
    isBoundedText(event.outcome) &&
    typeof event.durationMs === 'number' &&
    Number.isFinite(event.durationMs) &&
    event.durationMs >= 0 &&
    event.durationMs <= 600_000 &&
    (event.errorCode === undefined || isBoundedText(event.errorCode))
  );
}

export function parseTelemetryEvents(payload: unknown): readonly TelemetryEvent[] | null {
  const events = Array.isArray(payload) ? payload : [payload];

  return events.length > 0 &&
    events.length <= MAX_EVENTS &&
    events.every(isTelemetryEvent)
    ? events
    : null;
}

export function writeTelemetry(
  dataset: AnalyticsEngineBinding,
  events: readonly TelemetryEvent[],
): void {
  for (const event of events) {
    dataset.writeDataPoint({
      blobs: [
        event.release,
        event.traceId,
        event.spanId,
        event.operation,
        event.deviceClass,
        event.network,
        event.outcome,
        event.errorCode ?? '',
      ],
      doubles: [event.durationMs],
      indexes: [event.operation],
    });
  }
}
