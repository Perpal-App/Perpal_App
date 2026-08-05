import { Buffer } from 'buffer';
import { fetch } from 'expo/fetch';

const MAX_ACCOUNT_COUNT = 24;
const MAX_RESPONSE_BYTES = 256 * 1024;

export type PublicProgramAccounts = {
  readonly slot: number;
  readonly accounts: readonly Buffer[];
};

export type PublicProgramAccount = {
  readonly slot: number;
  readonly account: Buffer | null;
};

export async function fetchPublicProgramAccount(
  rpcUrl: string,
  address: string,
  expectedOwner: string,
  signal: AbortSignal,
): Promise<PublicProgramAccount> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'provider-account',
      method: 'getAccountInfo',
      params: [address, { commitment: 'processed', encoding: 'base64' }],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Public RPC returned HTTP ${response.status}.`);
  }

  const body = await response.text();

  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('Public RPC returned an oversized response.');
  }

  return parsePublicProgramAccount(JSON.parse(body) as unknown, expectedOwner);
}

export async function fetchPublicProgramAccounts(
  rpcUrl: string,
  addresses: readonly string[],
  expectedOwner: string,
  signal: AbortSignal,
): Promise<PublicProgramAccounts> {
  if (addresses.length === 0 || addresses.length > MAX_ACCOUNT_COUNT) {
    throw new Error('Public account request has an invalid size.');
  }

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'provider-markets',
      method: 'getMultipleAccounts',
      params: [addresses, { commitment: 'processed', encoding: 'base64' }],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Public RPC returned HTTP ${response.status}.`);
  }

  const body = await response.text();

  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('Public RPC returned an oversized response.');
  }

  return parsePublicProgramAccounts(
    JSON.parse(body) as unknown,
    addresses.length,
    expectedOwner,
  );
}

export function parsePublicProgramAccounts(
  value: unknown,
  expectedCount: number,
  expectedOwner: string,
): PublicProgramAccounts {
  const root = record(value);
  const result = record(root.result);
  const context = record(result.context);

  if (
    root.jsonrpc !== '2.0' ||
    typeof context.slot !== 'number' ||
    !Number.isSafeInteger(context.slot) ||
    context.slot <= 0 ||
    !Array.isArray(result.value) ||
    result.value.length !== expectedCount
  ) {
    throw new Error('Public RPC returned an invalid account response.');
  }

  const accounts = result.value.map((rawAccount) => {
    const account = record(rawAccount);
    const data = account.data;

    if (
      account.owner !== expectedOwner ||
      !Array.isArray(data) ||
      data.length !== 2 ||
      typeof data[0] !== 'string' ||
      data[1] !== 'base64'
    ) {
      throw new Error('Public RPC returned an unexpected program account.');
    }

    const decoded = Buffer.from(data[0], 'base64');

    if (decoded.byteLength === 0) {
      throw new Error('Public RPC returned an empty program account.');
    }

    return decoded;
  });

  return { slot: context.slot, accounts };
}

export function parsePublicProgramAccount(
  value: unknown,
  expectedOwner: string,
): PublicProgramAccount {
  const root = record(value);
  const result = record(root.result);
  const context = record(result.context);

  if (
    root.jsonrpc !== '2.0' ||
    typeof context.slot !== 'number' ||
    !Number.isSafeInteger(context.slot) ||
    context.slot <= 0
  ) {
    throw new Error('Public RPC returned an invalid account response.');
  }

  if (result.value === null) {
    return { slot: context.slot, account: null };
  }

  const account = record(result.value);
  const data = account.data;

  if (
    account.owner !== expectedOwner ||
    !Array.isArray(data) ||
    data.length !== 2 ||
    typeof data[0] !== 'string' ||
    data[1] !== 'base64'
  ) {
    throw new Error('Public RPC returned an unexpected program account.');
  }

  const decoded = Buffer.from(data[0], 'base64');

  if (decoded.byteLength === 0) {
    throw new Error('Public RPC returned an empty program account.');
  }

  return { slot: context.slot, account: decoded };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Public RPC returned malformed JSON.');
  }

  return value as Record<string, unknown>;
}
