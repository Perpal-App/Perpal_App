import {
  type Connection,
  type PublicKey,
  type Transaction,
} from '@solana/web3.js';
import { BulkAccountLoader } from '@velocity-exchange/sdk/lib/browser/accounts/bulkAccountLoader';
import {
  getMarketsAndOraclesForSubscription,
  initialize,
} from '@velocity-exchange/sdk/lib/browser/config';
import { BN } from '@velocity-exchange/sdk/lib/browser/isomorphic/anchor';
import { VelocityClient } from '@velocity-exchange/sdk/lib/browser/velocityClient';

export async function subscribedVelocityClient(input: {
  readonly connection: Connection;
  readonly owner: PublicKey;
  readonly programId: PublicKey;
  readonly userExists: boolean;
}): Promise<VelocityClient> {
  const configured = initialize({ env: 'mainnet-beta' });
  if (configured.VELOCITY_PROGRAM_ID !== input.programId.toBase58()) {
    throw new Error('Velocity program configuration is invalid.');
  }
  const subscriptions = getMarketsAndOraclesForSubscription('mainnet-beta');
  const client = new VelocityClient({
    accountSubscription: {
      accountLoader: new BulkAccountLoader(input.connection, 'confirmed', 1_000),
      type: 'polling',
    },
    connection: input.connection,
    env: 'mainnet-beta',
    oracleInfos: subscriptions.oracleInfos,
    perpMarketIndexes: subscriptions.perpMarketIndexes,
    programID: input.programId,
    skipLoadUsers: !input.userExists,
    spotMarketIndexes: [0],
    ...(input.userExists ? { subAccountIds: [0] } : {}),
    wallet: readOnlyWallet(input.owner),
  });
  if (!await client.subscribe()) throw new Error('Velocity accounts could not be loaded.');
  return client;
}

export function velocityBn(value: bigint): BN {
  const Constructor = BN as unknown as new (value: string) => BN;
  return new Constructor(value.toString());
}

function readOnlyWallet(publicKey: PublicKey) {
  return {
    publicKey,
    signAllTransactions: async (_transactions: Transaction[]) => {
      throw new Error('Velocity instruction building cannot sign transactions.');
    },
    signTransaction: async (_transaction: Transaction) => {
      throw new Error('Velocity instruction building cannot sign transactions.');
    },
  };
}
