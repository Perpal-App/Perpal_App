import type { Idl, Program, Provider } from '@flash_trade/flash-sdk-v2/node_modules/@coral-xyz/anchor';
import { Program as AnchorProgram } from '@flash_trade/flash-sdk-v2/node_modules/@coral-xyz/anchor';
import flashIdl from '@flash_trade/flash-sdk-v2/dist/idl/perpetuals.json';
import { PublicKey } from '@solana/web3.js';

export function createFlashProgram(
  programId: string,
  payer: PublicKey,
): Program {
  const idl = { ...flashIdl, address: programId } as unknown as Idl;
  const provider = { publicKey: payer } as Provider;
  return new AnchorProgram(idl, provider);
}
