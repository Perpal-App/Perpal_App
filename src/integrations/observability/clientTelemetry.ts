import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { createMMKV, type MMKV } from 'react-native-mmkv';

import { readAppConfig } from '@/config/appConfig';
import {
  postSignedGatewayRequest,
  type GatewayRequestSigner,
} from '@/integrations/api/gatewayClient';

const QUEUE_KEY = 'events.v1';
const MAX_QUEUED_EVENTS = 40;
const MAX_BATCH = 20;

export type ClientTelemetryOutcome = 'cancelled' | 'error' | 'ok' | 'unknown';

export type ClientTelemetryInput = {
  readonly durationMs: number;
  readonly errorCode?: string;
  readonly operation: string;
  readonly outcome: ClientTelemetryOutcome;
  readonly spanId?: string;
  readonly traceId?: string;
};

type QueuedEvent = {
  readonly deviceClass: 'unknown';
  readonly durationMs: number;
  readonly errorCode?: string;
  readonly id: string;
  readonly network: 'mainnet';
  readonly operation: string;
  readonly outcome: ClientTelemetryOutcome;
  readonly release: string;
  readonly spanId: string;
  readonly traceId: string;
};

let signer: GatewayRequestSigner | null = null;
let storage: MMKV | null = null;
let queue: readonly QueuedEvent[] | null = null;
let flushing: Promise<void> | null = null;
let activeAbort: AbortController | null = null;
let lastSignerPublicKey: Uint8Array | null = null;
let hasBoundSignerThisProcess = false;
const processEventIds = new Set<string>();

export function newTraceId(): string {
  return Crypto.randomUUID();
}

export function recordClientTelemetry(input: ClientTelemetryInput): void {
  const config = readAppConfig();
  if (!config.ok || !config.value.telemetry.enabled) return;

  const retain = input.outcome !== 'ok';
  if (!retain && Math.random() >= config.value.telemetry.sampleRate) return;

  const event: QueuedEvent = {
    deviceClass: 'unknown',
    durationMs: clampDuration(input.durationMs),
    ...(input.errorCode === undefined
      ? {}
      : { errorCode: bounded(input.errorCode, 'unknown') }),
    id: Crypto.randomUUID(),
    network: 'mainnet',
    operation: bounded(input.operation, 'unknown'),
    outcome: input.outcome,
    release: releaseId(),
    spanId: input.spanId ?? Crypto.randomUUID(),
    traceId: input.traceId ?? Crypto.randomUUID(),
  };

  processEventIds.add(event.id);
  commit([...readQueue(), event].slice(-MAX_QUEUED_EVENTS));
  void flushClientTelemetry();
}

export function setClientTelemetrySigner(next: GatewayRequestSigner | null): void {
  const interruptedFlush = next !== null && activeAbort !== null ? flushing : null;
  const identityChanged = next !== null && lastSignerPublicKey !== null &&
    !sameBytes(lastSignerPublicKey, next.publicKey);
  if (next === null || identityChanged) activeAbort?.abort();

  if (next !== null && !hasBoundSignerThisProcess) {
    // A persisted event has no locally retained wallet owner by design. Keep only
    // events created during this process so a rotated or newly signed-in identity
    // can never submit another wallet's backlog.
    commit(readQueue().filter((event) => processEventIds.has(event.id)));
    hasBoundSignerThisProcess = true;
  } else if (
    next !== null &&
    identityChanged
  ) {
    commit([]);
  }

  signer = next;
  if (next !== null) {
    lastSignerPublicKey = Uint8Array.from(next.publicKey);
    if (interruptedFlush === null) {
      void flushClientTelemetry();
    } else {
      void interruptedFlush.then(() => flushClientTelemetry());
    }
  }
}

export function flushClientTelemetry(): Promise<void> {
  if (flushing !== null) return flushing;
  const activeSigner = signer;
  const config = readAppConfig();
  const pending = readQueue().slice(0, MAX_BATCH);
  if (!config.ok || !config.value.telemetry.enabled || activeSigner === null || pending.length === 0) {
    return Promise.resolve();
  }

  let sentBatch = false;
  const controller = new AbortController();
  activeAbort = controller;
  flushing = postSignedGatewayRequest<{ readonly accepted: number }>({
    body: pending.map(withoutQueueId),
    cluster: config.value.cluster,
    operation: 'telemetry.write',
    signer: activeSigner,
    signal: controller.signal,
    timeoutMs: 5_000,
    url: config.value.api.telemetryUrl,
  }).then(() => {
    sentBatch = true;
    const sent = new Set(pending.map((event) => event.id));
    commit(readQueue().filter((event) => !sent.has(event.id)));
  }).catch(() => {
    // A later foreground transition or lifecycle event retries the same bounded batch.
  }).finally(() => {
    if (activeAbort === controller) activeAbort = null;
    flushing = null;
    if (sentBatch && signer !== null && readQueue().length > 0) void flushClientTelemetry();
  });

  return flushing;
}

function withoutQueueId(event: QueuedEvent): Omit<QueuedEvent, 'id'> {
  const { id: _id, ...payload } = event;
  return payload;
}

function readQueue(): readonly QueuedEvent[] {
  if (queue !== null) return queue;
  try {
    const encoded = getStorage().getString(QUEUE_KEY);
    queue = encoded === undefined ? [] : parseQueue(JSON.parse(encoded) as unknown);
  } catch {
    queue = [];
  }
  return queue;
}

function commit(next: readonly QueuedEvent[]): void {
  queue = next;
  try {
    getStorage().set(QUEUE_KEY, JSON.stringify(next));
  } catch {
    // The bounded in-memory queue remains usable for this session.
  }
}

function getStorage(): MMKV {
  storage ??= createMMKV({
    id: 'perpal.telemetry.v1',
    compareBeforeSet: true,
    recoveryStrategy: 'discard-on-error',
  });
  return storage;
}

function parseQueue(value: unknown): readonly QueuedEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => validEvent(entry) ? [entry] : []).slice(-MAX_QUEUED_EVENTS);
}

function validEvent(value: unknown): value is QueuedEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return event.deviceClass === 'unknown' &&
    typeof event.durationMs === 'number' && Number.isFinite(event.durationMs) &&
    typeof event.id === 'string' && event.id.length > 0 && event.id.length <= 96 &&
    event.network === 'mainnet' && boundedText(event.operation) &&
    ['cancelled', 'error', 'ok', 'unknown'].includes(String(event.outcome)) &&
    boundedText(event.release) && boundedText(event.spanId) && boundedText(event.traceId) &&
    (event.errorCode === undefined || boundedText(event.errorCode));
}

function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 96;
}

function bounded(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, 96);
  return normalized.length === 0 ? fallback : normalized;
}

function clampDuration(value: number): number {
  return Number.isFinite(value) ? Math.min(600_000, Math.max(0, Math.round(value))) : 0;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function releaseId(): string {
  const runtime = Constants.expoConfig?.runtimeVersion;
  const runtimeText = typeof runtime === 'string' ? runtime : 'native';
  return bounded([
    Application.nativeApplicationVersion ?? '0',
    Application.nativeBuildVersion ?? '0',
    runtimeText,
  ].join(':'), 'unknown');
}
