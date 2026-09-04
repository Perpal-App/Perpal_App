import { base64 } from '@scure/base';
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
} from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';

const MAX_LOOKUP_TABLES = 8;
const MAX_ADDRESSES_PER_TABLE = 256;

type LookupTableMapping = Readonly<Record<string, readonly string[]>> | null;

type RpcAccount = {
  readonly data: unknown;
  readonly executable: boolean;
  readonly owner: string;
};

export class StablecoinSwapLookupTableError extends Error {
  readonly code = 'swap_lookup_table_invalid';

  constructor() {
    super('The token-swap account map could not be verified. Request a fresh quote.');
    this.name = 'StablecoinSwapLookupTableError';
  }
}

export async function readVerifiedStablecoinSwapLookupTables(input: {
  readonly mappings: LookupTableMapping;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
}): Promise<readonly AddressLookupTableAccount[]> {
  const expected = parseMappings(input.mappings);
  if (expected.length === 0) return [];

  const response = await signedSolanaRpc<{
    readonly value: readonly (RpcAccount | null)[];
  }>({
    method: 'getMultipleAccounts',
    params: [
      expected.map(({ key }) => key.toBase58()),
      { commitment: 'confirmed', encoding: 'base64' },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  if (!Array.isArray(response.value) || response.value.length !== expected.length) {
    reject();
  }

  return expected.map((mapping, index) => {
    const account = response.value[index];
    if (
      !isRpcAccount(account) ||
      account.executable ||
      account.owner !== AddressLookupTableProgram.programId.toBase58()
    ) {
      reject();
    }

    try {
      const state = AddressLookupTableAccount.deserialize(accountBytes(account.data));
      const table = new AddressLookupTableAccount({ key: mapping.key, state });
      if (
        !table.isActive() ||
        state.addresses.length !== mapping.addresses.length ||
        state.addresses.some(
          (address, addressIndex) => !address.equals(mapping.addresses[addressIndex]!),
        )
      ) {
        reject();
      }
      return table;
    } catch (cause) {
      if (cause instanceof StablecoinSwapLookupTableError) throw cause;
      reject();
    }
  });
}

function parseMappings(value: LookupTableMapping): readonly {
  readonly addresses: readonly PublicKey[];
  readonly key: PublicKey;
}[] {
  if (value === null) return [];
  if (typeof value !== 'object' || Array.isArray(value)) reject();
  const entries = Object.entries(value);
  if (entries.length > MAX_LOOKUP_TABLES) reject();

  try {
    const tables = entries.map(([table, addresses]) => {
      if (
        !Array.isArray(addresses) ||
        addresses.length === 0 ||
        addresses.length > MAX_ADDRESSES_PER_TABLE ||
        !addresses.every((address) => typeof address === 'string')
      ) {
        reject();
      }
      return {
        addresses: addresses.map((address) => new PublicKey(address)),
        key: new PublicKey(table),
      };
    });
    if (new Set(tables.map(({ key }) => key.toBase58())).size !== tables.length) {
      reject();
    }
    return tables;
  } catch (cause) {
    if (cause instanceof StablecoinSwapLookupTableError) throw cause;
    reject();
  }
}

function isRpcAccount(value: unknown): value is RpcAccount {
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<RpcAccount>).executable === 'boolean' &&
    typeof (value as Partial<RpcAccount>).owner === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'data');
}

function accountBytes(value: unknown): Uint8Array {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'string' ||
    value[1] !== 'base64'
  ) {
    reject();
  }

  try {
    return base64.decode(value[0]);
  } catch {
    reject();
  }
}

function reject(): never {
  throw new StablecoinSwapLookupTableError();
}
