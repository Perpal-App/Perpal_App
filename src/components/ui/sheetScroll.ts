import { createContext, useContext } from 'react';

/**
 * What a sheet lends its content: a way back to the top of its own scroll.
 *
 * For content that changes what it is showing without changing where it is mounted — the order
 * ticket covering its form with its review. That review draws from the top of the body, and a reader
 * who had scrolled down to the action that opened it would otherwise land on the middle of the
 * review with its header above the fold. The scroll view is the sheet's, so the sheet
 * is what offers to move it; nothing outside gets a ref to it.
 */
export type SheetScroll = { readonly scrollToTop: () => void };

export const SheetScrollContext = createContext<SheetScroll | null>(null);

/** The enclosing sheet's scroll, or `null` outside one, so content can be mounted anywhere. */
export function useSheetScroll(): SheetScroll | null {
  return useContext(SheetScrollContext);
}
