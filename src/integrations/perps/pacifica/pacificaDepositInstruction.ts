import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';

const DEPOSIT_DISCRIMINATOR = sha256(utf8ToBytes('global:deposit')).slice(0, 8);

/**
 * Pacifica's locally supported `global:deposit` instruction.
 *
 * One pure builder is shared by the ordinary T-funded deposit and the atomic fast route. The account
 * order and flags are protocol data: duplicating them would let one route drift while the other still
 * simulated successfully against a different intent.
 *
 * Pacifica derives the token source from `owner`, so this instruction cannot debit a public wallet for
 * a different trading account. The fast route first transfers the exact amount into T's ATA in the same
 * atomic transaction, then invokes this instruction with T as owner.
 */
export function createPacificaDepositInstruction(
  input: {
    readonly amountBaseUnits: bigint;
    readonly centralState: string;
    readonly mint: string;
    readonly vault: string;
  },
  owner: PublicKey,
  programId: PublicKey,
): TransactionInstruction {
  const mint = new PublicKey(input.mint);
  const data = Buffer.alloc(16);
  data.set(DEPOSIT_DISCRIMINATOR, 0);
  data.writeBigUInt64LE(input.amountBaseUnits, 8);
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('__event_authority')],
    programId,
  );

  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(mint, owner), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.centralState), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.vault), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false },
    ],
  });
}
