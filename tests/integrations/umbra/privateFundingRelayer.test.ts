import { privateFundingRelayFailure } from '@/integrations/umbra/privateFundingRelayer';

describe('private funding relayer failures', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('does not reinterpret remote proof or signature wording as a local failure', () => {
    expect(privateFundingRelayFailure(
      'proof payload was rejected by the relayer',
      'failed',
    ).code).toBe('relay_failed');
    expect(privateFundingRelayFailure(
      'signature validation failed at the relayer',
      'failed',
    ).code).toBe('relay_failed');
  });

  it('preserves an explicit on-chain Groth16 marker', () => {
    expect(privateFundingRelayFailure(
      'custom program error: 0x36b5',
      'failed',
    ).code).toBe('proof_verification_failed');
  });
});
