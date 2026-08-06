export class PrivateFundingError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PrivateFundingError';
  }
}

export function classifyPrivateFundingFailure(cause: unknown): string {
  if (cause instanceof PrivateFundingError) {
    return cause.code;
  }

  if (
    typeof cause === 'object' &&
    cause !== null &&
    typeof (cause as { code?: unknown }).code === 'string' &&
    (
      (cause as { code: string }).code.includes('fee_') ||
      (cause as { code: string }).code.startsWith('swap_') ||
      [
        'balance_invalid',
        'plan_invalid',
        'simulation_failed',
      ].includes((cause as { code: string }).code)
    )
  ) {
    return (cause as { code: string }).code;
  }

  const serialized = safeErrorText(cause).toLowerCase();

  if (
    serialized.includes('unabletoverifygroth16proof') ||
    serialized.includes('14005') ||
    serialized.includes('0x36b5')
  ) {
    return 'proof_verification_failed';
  }

  if (serialized.includes('proof') || serialized.includes('zkey')) {
    return 'proof_failed';
  }

  if (serialized.includes('sign') || serialized.includes('reject')) {
    return 'signature_rejected';
  }

  return 'private_funding_failed';
}

export function privateFundingUserMessage(code: string): string {
  if (code === 'proof_verification_failed') {
    return 'Umbra rejected the privacy proof. It was not retried.';
  }

  if (code === 'proof_failed') {
    return 'The native privacy proof could not be prepared.';
  }

  if (code === 'signature_rejected') {
    return 'Private funding was not approved.';
  }

  if (code.includes('fee_')) {
    return 'Private collateral may be ready, but the user-funded SOL reserve is pending.';
  }

  if (
    code.startsWith('swap_') ||
    ['balance_invalid', 'plan_invalid', 'simulation_failed'].includes(code)
  ) {
    return 'The stablecoin conversion could not be verified. Resume funding to prepare a fresh route.';
  }

  return 'Private funding did not complete. Resume it safely.';
}

function safeErrorText(value: unknown, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return `${value.name} ${value.message} ${safeErrorText(value.cause, depth + 1)}`;
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((entry) => safeErrorText(entry, depth + 1))
      .join(' ');
  }

  return String(value);
}
