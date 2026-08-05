#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { ed25519 } from '@noble/curves/ed25519.js';

import {
  buildGatewaySigningMessage,
  bytesToHex,
  gatewayHeaders,
} from '../src/integrations/api/gatewayProtocol.ts';

const rpcUrl = process.argv[2];

if (!rpcUrl) {
  console.error('Usage: npm run smoke:gateway -- <https-rpc-url>');
  process.exit(1);
}

const parsedUrl = new URL(rpcUrl);

if (parsedUrl.protocol !== 'https:') {
  console.error('Gateway smoke URL must use HTTPS.');
  process.exit(1);
}

const seed = randomBytes(32);
const publicKey = ed25519.getPublicKey(seed);

function signedHeaders(body, operation, idempotencyKey = '') {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const timestamp = Date.now().toString();
  const nonce = randomUUID();
  const signature = ed25519.sign(
    buildGatewaySigningMessage({
      bodyHash,
      idempotencyKey,
      network: 'devnet',
      nonce,
      operation,
      timestamp,
    }),
    seed,
  );

  return {
    'content-type': 'application/json',
    [gatewayHeaders.network]: 'devnet',
    [gatewayHeaders.nonce]: nonce,
    [gatewayHeaders.publicKey]: bytesToHex(publicKey),
    [gatewayHeaders.signature]: bytesToHex(signature),
    [gatewayHeaders.timestamp]: timestamp,
    ...(idempotencyKey
      ? { [gatewayHeaders.idempotencyKey]: idempotencyKey }
      : {}),
  };
}

try {
  const readBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getSlot',
    params: [{ commitment: 'confirmed' }],
  });
  const readHeaders = signedHeaders(readBody, 'getSlot');
  const read = await fetch(rpcUrl, {
    method: 'POST',
    headers: readHeaders,
    body: readBody,
  });
  const readPayload = await read.json();

  if (!read.ok || typeof readPayload?.result !== 'number') {
    throw new Error(`Signed RPC failed with HTTP ${read.status}.`);
  }

  const nonceReplay = await fetch(rpcUrl, {
    method: 'POST',
    headers: readHeaders,
    body: readBody,
  });
  const nonceReplayPayload = await nonceReplay.json();

  if (
    nonceReplay.status !== 409 ||
    nonceReplayPayload?.error?.code !== 'replay_detected'
  ) {
    throw new Error(`Replay guard failed with HTTP ${nonceReplay.status}.`);
  }

  // Invalid transaction bytes are safe on-chain while still exercising the
  // write broadcast and Redis idempotency paths on both configured providers.
  const writeBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'sendTransaction',
    params: ['invalid-smoke-transaction', { encoding: 'base64' }],
  });
  const idempotencyKey = createHash('sha256').update(writeBody).digest('hex');
  const write = await fetch(rpcUrl, {
    method: 'POST',
    headers: signedHeaders(writeBody, 'sendTransaction', idempotencyKey),
    body: writeBody,
  });

  if (
    !write.ok ||
    write.headers.get('x-perpal-routing') !== 'broadcast' ||
    write.headers.get('x-perpal-idempotency') !== 'stored'
  ) {
    throw new Error(`Write broadcast failed with HTTP ${write.status}.`);
  }

  const writeReplay = await fetch(rpcUrl, {
    method: 'POST',
    headers: signedHeaders(writeBody, 'sendTransaction', idempotencyKey),
    body: writeBody,
  });

  if (
    !writeReplay.ok ||
    writeReplay.headers.get('x-perpal-idempotency') !== 'replayed'
  ) {
    throw new Error(`Idempotency replay failed with HTTP ${writeReplay.status}.`);
  }

  const telemetryUrl = new URL('/v1/telemetry', parsedUrl).toString();
  const telemetryBody = JSON.stringify({
    release: 'gateway-smoke',
    traceId: randomUUID(),
    spanId: randomUUID(),
    operation: 'gateway.smoke',
    deviceClass: 'unknown',
    network: 'devnet',
    outcome: 'ok',
    durationMs: 0,
  });
  const telemetry = await fetch(telemetryUrl, {
    method: 'POST',
    headers: signedHeaders(telemetryBody, 'telemetry.write'),
    body: telemetryBody,
  });

  if (telemetry.status !== 202) {
    throw new Error(`Telemetry ingestion failed with HTTP ${telemetry.status}.`);
  }

  const healthUrl = new URL('/health', parsedUrl).toString();
  const forbiddenOrigin = await fetch(healthUrl, {
    headers: { origin: 'https://example.invalid' },
  });

  if (forbiddenOrigin.status !== 403) {
    throw new Error(`CORS rejection failed with HTTP ${forbiddenOrigin.status}.`);
  }

  console.log(
    JSON.stringify({
      signedRpc: 'ok',
      slot: readPayload.result,
      provider: read.headers.get('x-perpal-provider'),
      routing: read.headers.get('x-perpal-routing'),
      traceId: read.headers.get('x-perpal-trace-id'),
      replayGuard: 'ok',
      writeBroadcast: 'ok',
      idempotency: 'ok',
      telemetry: 'ok',
      cors: 'ok',
    }),
  );
} finally {
  seed.fill(0);
}
