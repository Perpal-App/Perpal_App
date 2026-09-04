export function parsePacificaOrderId(value: unknown): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Pacifica returned an invalid order response.');
  }
  const raw = (value as Record<string, unknown>).order_id;
  const orderId = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof orderId !== 'number' || !Number.isSafeInteger(orderId) || orderId <= 0) {
    throw new Error('Pacifica returned an invalid order identifier.');
  }
  return orderId;
}
