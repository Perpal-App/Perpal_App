import type { ComponentProps } from 'react';

import { ActionButton } from '@/components/ui/ActionButton';
import { interfaceType, radii } from '@/theme/tokens';

/**
 * The ticket's bottom action: full height, and rounded end to end rather than the app's default corner.
 *
 * It sits under a keypad of round keys and a row of pill-shaped presets, where a rectangle with small
 * corners was the one boxy shape on the sheet. One component rather than the same props at every call
 * site, so the form and the review cannot drift apart in shape or type — the rest of `ActionButton`, its
 * materials and its states, is untouched. The label is set in the ticket's interface type.
 */
export function TicketActionButton(
  props: Omit<ComponentProps<typeof ActionButton>, 'labelStyle' | 'radius' | 'size'>,
) {
  return <ActionButton {...props} labelStyle={interfaceType.action} radius={radii.pill} size="large" />;
}
