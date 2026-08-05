import { BulkAccountLoader } from '@drift-labs/sdk/lib/browser/accounts/bulkAccountLoader';
import { DriftClient } from '@drift-labs/sdk/lib/browser/driftClient';
import { WalletV2 } from '@drift-labs/sdk/lib/browser/wallet';
import { Connection, Keypair, type FetchFn } from '@solana/web3.js';

import {
  createGatewayRequestHeaders,
  GatewayError,
  type GatewayRequestSigner,
} from '@/integrations/api/gatewayClient';
import { parseGatewayRpcOperation } from '@/integrations/api/gatewayProtocol';

const REQUEST_TIMEOUT_MS = 8_000;
const POLLING_INTERVAL_MS = 1_000;

function signedGatewayFetch(signer: GatewayRequestSigner): FetchFn {
  return async (input, init) => {
    const body = typeof init?.body === 'string' ? init.body : null;
    const operation = body === null ? null : parseGatewayRpcOperation(body);

    if (body === null || operation === null) {
      throw new GatewayError('Drift produced an invalid RPC request.', 0, 'rpc_invalid');
    }

    const signedHeaders = await createGatewayRequestHeaders({
      body,
      cluster: 'devnet',
      operation,
      signer,
      useBodyHashAsIdempotencyKey: operation === 'sendTransaction',
    });
    const headers = new Headers(init?.headers);

    for (const [name, value] of Object.entries(signedHeaders)) {
      headers.set(name, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await fetch(input, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

/**
 * Opens a direct Drift devnet session backed by the anonymous trading key.
 * The caller must invoke `close` on logout or wallet replacement.
 */
export function openDriftDevnetSession(rpcUrl: string, seed: Uint8Array) {
  if (seed.length !== 32) {
    throw new Error('A 32-byte trading-wallet seed is required.');
  }

  const payer = Keypair.fromSeed(seed);
  const wallet = new WalletV2(payer);
  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
    fetch: signedGatewayFetch({
      publicKey: payer.publicKey.toBytes(),
      sign: (message) => wallet.signMessage(message),
    }),
  });
  const accountLoader = new BulkAccountLoader(
    connection,
    'confirmed',
    POLLING_INTERVAL_MS,
  );
  const client = new DriftClient({
    connection,
    wallet,
    env: 'devnet',
    skipLoadUsers: true,
    accountSubscription: { type: 'polling', accountLoader },
  });
  let closed = false;

  return {
    client,
    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;

      try {
        await client.unsubscribe();
      } finally {
        accountLoader.stopPolling();
        payer.secretKey.fill(0);
      }
    },
  };
}
