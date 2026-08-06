import { Buffer } from 'buffer';

import type {
  Basket,
  Market,
  UserDepositLedger,
} from '@flash_trade/flash-sdk-v2/dist/types';
import flashIdl from '@flash_trade/flash-sdk-v2/dist/idl/perpetuals.json';
import { BorshAccountsCoder } from '@flash_trade/flash-sdk-v2/node_modules/@coral-xyz/anchor/dist/cjs/coder/borsh/accounts.js';
import { convertIdlToCamelCase } from '@flash_trade/flash-sdk-v2/node_modules/@coral-xyz/anchor/dist/cjs/idl.js';

// Keep the mounted Expo path away from Flash's root barrel: it imports Node
// `crypto`. These are the exact browser-safe account coder and IDL used by the
// installed Flash SDK, so account layouts still come from Flash rather than a
// duplicate schema maintained by PerPal.
const coder = new BorshAccountsCoder(
  convertIdlToCamelCase(flashIdl as never),
);

export function decodeFlashMarket(data: Buffer): Market {
  return coder.decode<Market>('market', data);
}

export function decodeFlashBasket(data: Buffer): Basket {
  return coder.decode<Basket>('basket', data);
}

export function decodeFlashUserDepositLedger(data: Buffer): UserDepositLedger {
  return coder.decode<UserDepositLedger>('userDepositLedger', data);
}
