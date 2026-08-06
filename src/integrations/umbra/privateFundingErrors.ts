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
    typeof (cause as { code?: unknown }).code === 'string'
  ) {
    const code = (cause as { code: string }).code.toLowerCase();

    if (
      code.includes('fee_') ||
      code.startsWith('swap_') ||
      code.startsWith('create_utxo_') ||
      code.startsWith('fetch_utxos_') ||
      code.startsWith('relayer_') ||
      code.startsWith('rpc_') ||
      code.startsWith('master_seed_') ||
      [
        'balance_invalid',
        'plan_invalid',
        'simulation_failed',
      ].includes(code)
    ) {
      return code;
    }
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
  if (code === 'insufficient_sol') {
    return 'The public wallet needs more SOL for the reserve, temporary rent, and network fees.';
  }

  if (code === 'insufficient_collateral') {
    return 'The public wallet does not have enough selected collateral.';
  }

  if (code === 'proof_verification_failed') {
    return 'Umbra rejected the privacy proof. It was not retried.';
  }

  if (code === 'proof_failed' || code.endsWith('_zk_proof_generation')) {
    return 'The native privacy proof could not be prepared.';
  }

  if (code === 'signature_rejected' || code.endsWith('_transaction_sign')) {
    return 'Private funding was not approved.';
  }

  if (code === 'fetch_utxos_key_derivation') {
    return 'The Umbra recovery key could not be prepared. No transaction was submitted.';
  }

  if (code.startsWith('fetch_utxos_')) {
    return 'Umbra could not scan the encrypted pool. No transaction was submitted.';
  }

  if (code.startsWith('relayer_')) {
    return 'The Umbra relayer is unavailable. No transaction was submitted.';
  }

  if (code.startsWith('rpc_')) {
    return 'Umbra could not read the required on-chain state. No transaction was submitted.';
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

  if (code === 'flash_deposit_simulation_failed') {
    return 'Flash rejected the collateral deposit preview. Resume funding after checking the detailed error.';
  }

  if (code === 'velocity_deposit_simulation_failed') {
    return 'Velocity rejected the collateral deposit preview. Resume funding after checking the detailed error.';
  }

  if (code.endsWith('_account_fetch') || code.endsWith('_mint_fetch')) {
    return 'Umbra could not read the required on-chain accounts. Your funds were not submitted.';
  }

  if (code.endsWith('_transaction_send')) {
    return 'The funding transaction was not confirmed. Resume to reconcile it before resubmitting.';
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
