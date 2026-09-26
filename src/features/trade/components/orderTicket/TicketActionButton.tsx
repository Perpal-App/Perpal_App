import type { ComponentProps } from 'react';

import { ActionButton } from '@/components/ui/ActionButton';
import { radii } from '@/theme/tokens';

/**
 * The ticket's bottom action: full height, and rounded end to end rather than the app's default corner.
 *
 * It sits under a keypad of round keys and a row of pill-shaped presets, where a rectangle with small
 * corners was the one boxy shape on the sheet. One component rather than the same two props at every call
 * site, so the form and the review cannot drift apart in shape — the rest of `ActionButton`, its materials
 * and its states, is untouched.
 */
export function TicketActionButton(
  props: Omit<ComponentProps<typeof ActionButton>, 'radius' | 'size'>,
) {
  return <ActionButton {...props} radius={radii.pill} size="large" />;
}
