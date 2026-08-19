import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import { getUserAccountPublicKeySync } from '@velocity-exchange/sdk/lib/browser/addresses/pda';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  prepareVelocityTransactionPlan,
  type VelocityTradePreparation,
} from '@/integrations/perps/velocity/velocityTrade';
import {
  subscribedVelocityClient,
  velocityBn,
} from '@/integrations/perps/velocity/velocityClient';

const QUOTE_MARKET_INDEX = 0;

export async function prepareVelocityWithdrawal(input: {
  readonly amountBaseUnits: bigint;
  readonly owner: string;
  readonly programId: string;
  readonly publicRpcUrl: string;
  readonly rpcUrl: string;
  readonly signal: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly usdtMint: string;
}): Promise<VelocityTradePreparation> {
  if (input.amountBaseUnits <= 0n) throw new Error('No Velocity balance is available to move.');
  const owner = new PublicKey(input.owner);
  const programId = new PublicKey(input.programId);
  const connection = new Connection(input.publicRpcUrl, 'confirmed');
  const userPda = getUserAccountPublicKeySync(programId, owner, 0);
  const userExists = await connection.getAccountInfo(userPda, 'confirmed') !== null;
  if (!userExists) throw new Error('No Velocity account exists for this wallet.');
  const client = await subscribedVelocityClient({ connection, owner, programId, userExists });

  try {
    const available = BigInt(client.getUser(0).getFreeCollateral().toString());
    const amount = input.amountBaseUnits > available ? available : input.amountBaseUnits;
    if (amount <= 0n) throw new Error('No Velocity balance is available to move.');
    const destination = getAssociatedTokenAddressSync(new PublicKey(input.usdtMint), owner);
    const instructions = await client.getWithdrawalIxs(
      velocityBn(amount),
      QUOTE_MARKET_INDEX,
      destination,
      true,
      0,
    );
    return {
      kind: 'velocity',
      plan: await prepareVelocityTransactionPlan({
        action: 'withdraw',
        amountBaseUnits: amount,
        client,
        instructions,
        owner,
        programId,
        rpcUrl: input.rpcUrl,
        signal: input.signal,
        signer: input.signer,
      }),
    };
  } finally {
    await client.unsubscribe();
  }
}
