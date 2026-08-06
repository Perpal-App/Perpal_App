import { gatewayHeaders } from '../../../src/integrations/api/gatewayProtocol';

const ALLOWED_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  gatewayHeaders.idempotencyKey,
  gatewayHeaders.network,
  gatewayHeaders.nonce,
  gatewayHeaders.publicKey,
  gatewayHeaders.signature,
  gatewayHeaders.timestamp,
].join(', ');

export type BodyReadResult =
  | { readonly ok: true; readonly body: string; readonly payload: unknown }
  | {
      readonly ok: false;
      readonly code: 'invalid_content_type' | 'invalid_json' | 'payload_too_large';
      readonly status: 400 | 413 | 415;
    };

export function corsHeaders(request: Request, allowedOrigins: readonly string[]) {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = { vary: 'Origin' };

  if (origin !== null && allowedOrigins.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'POST, OPTIONS';
    headers['access-control-allow-headers'] = ALLOWED_REQUEST_HEADERS;
    headers['access-control-max-age'] = '86400';
  }

  return headers;
}

export function isOriginAllowed(
  request: Request,
  allowedOrigins: readonly string[],
): boolean {
  const origin = request.headers.get('origin');

  // Native Android requests do not carry a browser Origin header.
  return origin === null || allowedOrigins.includes(origin);
}

export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<BodyReadResult> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim();

  if (contentType !== 'application/json') {
    return { ok: false, code: 'invalid_content_type', status: 415 };
  }

  const declaredLength = Number(request.headers.get('content-length'));

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, code: 'payload_too_large', status: 413 };
  }

  if (request.body === null) {
    return { ok: false, code: 'invalid_json', status: 400 };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const part = await reader.read();

    if (part.done) {
      break;
    }

    byteLength += part.value.byteLength;

    if (byteLength > maxBytes) {
      await reader.cancel();
      return { ok: false, code: 'payload_too_large', status: 413 };
    }

    chunks.push(part.value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const body = new TextDecoder().decode(bytes);

  try {
    return { ok: true, body, payload: JSON.parse(body) as unknown };
  } catch {
    return { ok: false, code: 'invalid_json', status: 400 };
  }
}

export function serverTiming(timings: Readonly<Record<string, number>>): string {
  return Object.entries(timings)
    .map(([name, duration]) => `${name};dur=${Math.max(0, duration).toFixed(1)}`)
    .join(', ');
}
