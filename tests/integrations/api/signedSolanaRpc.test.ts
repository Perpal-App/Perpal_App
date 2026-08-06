import {
  createSolanaRpcDiagnostic,
  createSolanaSimulationDiagnostic,
} from '@/integrations/api/signedSolanaRpc';

describe('signed Solana RPC diagnostics', () => {
  it('keeps simulation codes while redacting addresses', () => {
    const diagnostic = createSolanaRpcDiagnostic({
      code: -32002,
      data: {
        err: { InstructionError: [2, { Custom: 14005 }] },
        logs: [
          'Program 11111111111111111111111111111111 invoke [1]',
          'Program log: custom program error: 0x36b5',
        ],
      },
      message: 'Transaction simulation failed',
    });

    expect(diagnostic.detail).toBe('{"InstructionError":[2,{"Custom":14005}]}');
    expect(diagnostic.logs).toEqual([
      'Program [address] invoke [1]',
      'Program log: custom program error: 0x36b5',
    ]);
  });

  it('extracts a rejected simulation result without transaction data', () => {
    expect(createSolanaSimulationDiagnostic({
      value: {
        err: { InstructionError: [3, 'InvalidAccountData'] },
        logs: ['Program 11111111111111111111111111111111 failed'],
      },
    })).toEqual({
      detail: '{"InstructionError":[3,"InvalidAccountData"]}',
      logs: ['Program [address] failed'],
      message: 'Transaction simulation failed',
    });
  });
});
