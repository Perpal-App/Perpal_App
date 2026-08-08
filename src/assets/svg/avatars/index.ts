import type { ComponentType } from 'react';

import { Avatar1 } from '@/assets/svg/avatars/Avatar1';
import { Avatar2 } from '@/assets/svg/avatars/Avatar2';
import { Avatar3 } from '@/assets/svg/avatars/Avatar3';
import { Avatar4 } from '@/assets/svg/avatars/Avatar4';
import { Avatar5 } from '@/assets/svg/avatars/Avatar5';
import type { AvatarProps } from '@/assets/svg/avatars/types';

export type { AvatarProps };

/**
 * Every avatar the app can assign, in a fixed order.
 *
 * The order is part of the mapping below, so reordering this list reassigns every wallet's
 * face. Append; do not rearrange.
 *
 * A tuple rather than an array: it is what lets the first entry be indexed without a check,
 * which is the only reason the fallback below needs no assertion.
 */
export const AVATARS = [Avatar1, Avatar2, Avatar3, Avatar4, Avatar5] as const;

/**
 * FNV-1a, 32-bit.
 *
 * A character sum would do for five buckets, but wallet addresses share long runs of the same
 * base58 alphabet and differ in only a few positions, and a sum ignores position entirely — two
 * addresses that are anagrams of each other would land on the same avatar. Mixing after every
 * byte spreads those apart.
 */
function hash(value: string): number {
  let result = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    // `imul` because the FNV prime overflows 32 bits: `*` would promote to a float and lose
    // the low bits the hash depends on.
    result = Math.imul(result, 0x01000193);
  }

  return result >>> 0;
}

/**
 * The avatar belonging to an address.
 *
 * Derived rather than stored, so a wallet keeps the same face on every device and after every
 * reinstall with nothing to persist or migrate. It is a portrait, not a fingerprint — five
 * faces cannot identify a wallet, and nothing should ever treat them as though they could.
 *
 * Before the address resolves there is nothing to derive from, so the first avatar stands in.
 * It swaps once when the wallet arrives; the alternative is an empty disc on every cold start,
 * which is a worse trade for a change most people will never catch.
 */
export function avatarForAddress(address: string | null): ComponentType<AvatarProps> {
  if (address === null || address.length === 0) {
    return AVATARS[0];
  }

  return AVATARS[hash(address) % AVATARS.length] ?? AVATARS[0];
}
