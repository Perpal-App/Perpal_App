import {
  classifyPrivateFundingFailure,
  isGroth16ProofVerificationFailure,
  privateFundingFailureDiagnostic,
} from '@/integrations/umbra/privateFundingErrors';

describe('private funding error classification', () => {
  it('keeps exact Groth16 markers ahead of a generic relayer code', () => {
    const nested = {
      code: 'relayer_api-error',
      cause: { InstructionError: [2, { Custom: 14_005 }] },
    };

    expect(classifyPrivateFundingFailure(nested)).toBe('proof_verification_failed');
    expect(classifyPrivateFundingFailure(new Error('RPC failed', {
      cause: { InstructionError: [2, { Custom: 14_005 }] },
    }))).toBe('proof_verification_failed');
    expect(classifyPrivateFundingFailure({
      code: 'rpc_network',
      message: 'Error Number: 14005',
    })).toBe('proof_verification_failed');
  });

  it('does not treat a larger amount or slot containing 14005 as Groth16', () => {
    expect(isGroth16ProofVerificationFailure({
      lamports: 314_005,
      slot: 440_014_005,
    })).toBe(false);
    expect(isGroth16ProofVerificationFailure(
      'custom program error: 0x36b5a7',
    )).toBe(false);
  });

  it('redacts addresses from relayer diagnostics', () => {
    expect(privateFundingFailureDiagnostic(
      'failed for 4Nd1mYvQwZcDg5pWPQrj2WnQkzq7tBpmJZrQJ5Yx7FhT',
    )).toBe('failed for [address]');
  });
});
