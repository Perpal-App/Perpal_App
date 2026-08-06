type MoproInputs = Readonly<Record<string, readonly string[]>>;

function toMoproStringArray(value: unknown): string[] {
  if (value instanceof Uint8Array) {
    return Array.from(value, String);
  }

  if (Array.isArray(value)) {
    return value.flatMap(toMoproStringArray);
  }

  if (value === null || value === undefined) {
    throw new Error('Umbra circuit input contains a null or undefined scalar.');
  }

  return [String(value)];
}

export function serializeUmbraCircuitInputs(inputs: unknown): string {
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) {
    throw new Error('Umbra circuit inputs must be an object.');
  }

  const converted: MoproInputs = Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [key, toMoproStringArray(value)]),
  );

  return JSON.stringify(converted);
}
