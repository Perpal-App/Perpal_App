import { safeDriftDiagnosticMessage } from '@/integrations/perps/drift/driftDiagnostics';

describe('Drift diagnostics', () => {
  it('redacts endpoints and key-like values from SDK errors', () => {
    const message = safeDriftDiagnosticMessage(
      new Error(
        'Failed https://rpc.example/path for 11111111111111111111111111111111',
      ),
    );

    expect(message).toBe('Failed [url] for [base58]');
  });
});
