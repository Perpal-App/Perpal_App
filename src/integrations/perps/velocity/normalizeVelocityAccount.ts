/**
 * Velocity's browser account coder currently preserves IDL snake_case even
 * though its public types and math modules consume camelCase account fields.
 */
export function normalizeVelocityAccount<T>(value: unknown): T {
  return normalizeVelocityValue(value) as T;
}

function normalizeVelocityValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeVelocityValue);
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      camelCaseVelocityKey(key),
      normalizeVelocityValue(nested),
    ]),
  );
}

function camelCaseVelocityKey(key: string): string {
  return key
    .replace(/_([a-z0-9])/g, (_, character: string) =>
      character.toUpperCase(),
    )
    .replace(/24h/g, '24H')
    .replace(/5min/g, '5Min');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
