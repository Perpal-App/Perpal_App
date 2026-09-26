import { useState } from 'react';

/**
 * The value while there is one, and the last one after it goes.
 *
 * For content inside a `PresenceView` whose visibility is derived from that same content. The moment
 * the value becomes `null` the view starts its exit — but its children are still mounted and still
 * rendering, and without this they would render from `null` and blank out halfway through their own
 * departure.
 *
 * State set during render rather than a ref written there: this is React's documented pattern for
 * keeping information from a previous render, and it is the one `PresenceView` itself uses to hold its
 * children through an exit.
 *
 * The value must be referentially stable — state, or memoised. A fresh object on every render is a new
 * value on every render, and setting state for each one would never settle.
 */
export function useRetainedValue<T>(value: T | null): T | null {
  const [retained, setRetained] = useState(value);
  if (value !== null && value !== retained) setRetained(value);
  return value ?? retained;
}
