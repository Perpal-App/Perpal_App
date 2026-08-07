import { parsePublicProgramAccount } from '@/integrations/api/publicSolanaRpc';

const OWNER = 'FlashProgram111111111111111111111111111111';

describe('parsePublicProgramAccount', () => {
  it('distinguishes an uninitialized account from an owner mismatch', () => {
    expect(
      parsePublicProgramAccount(
        {
          jsonrpc: '2.0',
          result: { context: { slot: 42 }, value: null },
        },
        OWNER,
      ),
    ).toEqual({ slot: 42, account: null });

    expect(() =>
      parsePublicProgramAccount(
        {
          jsonrpc: '2.0',
          result: {
            context: { slot: 42 },
            value: {
              owner: 'AnotherProgram',
              data: [Buffer.from('account').toString('base64'), 'base64'],
            },
          },
        },
        OWNER,
      ),
    ).toThrow('unexpected program account');
  });
});
