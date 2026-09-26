import { useEffect, useState } from 'react';

/**
 * Whether a quote's deadline has passed.
 *
 * One timeout at the deadline rather than a ticking clock: nothing on screen counts down, so nothing
 * needs to re-render until the one moment the answer changes. Keyed by the deadline itself, so a fresh
 * quote — a new `expiresAtMs` — reads as live the instant it arrives, with no state to clear.
 *
 * The screen is told so it can offer a refresh instead of a confirmation that is certain to fail. It is
 * not the check: the order lifecycle refuses an expired plan itself, whatever this says.
 */
export function useQuoteExpiry(expiresAtMs: number | null): boolean {
  const [expiredAt, setExpiredAt] = useState<number | null>(null);

  useEffect(() => {
    if (expiresAtMs === null) return undefined;
    // Scheduled even when already past, at zero, so the state update never runs inside the effect body.
    const timer = setTimeout(
      () => setExpiredAt(expiresAtMs),
      Math.max(expiresAtMs - Date.now(), 0),
    );
    return () => clearTimeout(timer);
  }, [expiresAtMs]);

  return expiresAtMs !== null && expiredAt === expiresAtMs;
}
