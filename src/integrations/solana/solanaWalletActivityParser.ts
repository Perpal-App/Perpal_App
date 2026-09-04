import { JUPITER_SWAP_PROGRAM_ID } from '@/integrations/solana/programIds';

export type WalletScope = 'private' | 'public';

export type WalletAssetAmount = {
  readonly baseUnits: bigint;
  readonly decimals: 6 | 9;
  readonly symbol: 'SOL' | 'USDC' | 'USDT';
};

export type SolanaWalletAction =
  | {
      readonly amount: WalletAssetAmount;
      readonly type: 'pacifica_deposit' | 'pacifica_withdrawal' | 'receive' | 'send';
      readonly wallet: WalletScope;
    }
  | {
      readonly received: WalletAssetAmount;
      readonly spent: WalletAssetAmount;
      readonly type: 'swap';
      readonly wallet: WalletScope;
    }
  | {
      readonly amount: WalletAssetAmount;
      readonly from: WalletScope;
      readonly to: WalletScope;
      readonly type: 'transfer';
    };

type TokenBalance = {
  readonly accountIndex?: unknown;
  readonly mint?: unknown;
  readonly owner?: unknown;
  readonly uiTokenAmount?: {
    readonly amount?: unknown;
    readonly decimals?: unknown;
  };
};

type ParsedInstruction = {
  readonly parsed?: {
    readonly info?: Record<string, unknown>;
    readonly type?: unknown;
  };
  readonly program?: unknown;
  readonly programId?: unknown;
};

export type ParsedWalletTransaction = {
  readonly meta?: {
    readonly err?: unknown;
    readonly fee?: unknown;
    readonly innerInstructions?: readonly {
      readonly instructions?: readonly ParsedInstruction[];
    }[] | null;
    readonly postBalances?: readonly unknown[];
    readonly postTokenBalances?: readonly TokenBalance[] | null;
    readonly preBalances?: readonly unknown[];
    readonly preTokenBalances?: readonly TokenBalance[] | null;
  } | null;
  readonly transaction?: {
    readonly message?: {
      readonly accountKeys?: readonly unknown[];
      readonly instructions?: readonly ParsedInstruction[];
    };
  };
};

type AssetDefinition = {
  readonly decimals: 6;
  readonly mint: string;
  readonly symbol: 'USDC' | 'USDT';
};

type Delta = Omit<WalletAssetAmount, 'baseUnits'> & { readonly delta: bigint };

export function parseSolanaWalletAction(input: {
  readonly privateAddress: string;
  readonly publicAddress: string;
  readonly pacificaProgramId: string;
  readonly transaction: ParsedWalletTransaction;
  readonly usdcMint: string;
  readonly usdtMint: string;
}): SolanaWalletAction | null {
  const meta = input.transaction.meta;
  const message = input.transaction.transaction?.message;

  if (meta == null || meta.err != null || message === undefined) return null;

  const definitions: readonly AssetDefinition[] = [
    { decimals: 6, mint: input.usdcMint, symbol: 'USDC' },
    { decimals: 6, mint: input.usdtMint, symbol: 'USDT' },
  ];
  const publicDeltas = walletDeltas(
    input.publicAddress,
    message.accountKeys,
    meta,
    definitions,
  );
  const privateDeltas = input.privateAddress === input.publicAddress
    ? []
    : walletDeltas(input.privateAddress, message.accountKeys, meta, definitions);
  const transfer = matchingTransfer(publicDeltas, privateDeltas);

  if (transfer !== null) return transfer;

  const programs = instructionProgramIds(message.instructions, meta.innerInstructions);
  const candidates: readonly {
    readonly address: string;
    readonly deltas: readonly Delta[];
    readonly wallet: WalletScope;
  }[] = input.privateAddress === input.publicAddress
    ? [{ address: input.publicAddress, deltas: publicDeltas, wallet: 'public' }]
    : [
        { address: input.publicAddress, deltas: publicDeltas, wallet: 'public' },
        { address: input.privateAddress, deltas: privateDeltas, wallet: 'private' },
      ];

  for (const candidate of candidates) {
    const tokenDeltas = candidate.deltas.filter((delta) => delta.symbol !== 'SOL');
    const usdc = tokenDeltas.find((delta) => delta.symbol === 'USDC');

    if (
      candidate.wallet === 'private'
      && programs.has(input.pacificaProgramId)
      && usdc !== undefined
    ) {
      return {
        amount: magnitude(usdc),
        type: usdc.delta < 0n ? 'pacifica_deposit' : 'pacifica_withdrawal',
        wallet: candidate.wallet,
      };
    }

    if (programs.has(JUPITER_SWAP_PROGRAM_ID)) {
      const spent = candidate.deltas.find((delta) => delta.delta < 0n);
      const received = candidate.deltas.find((delta) => delta.delta > 0n);

      if (spent !== undefined && received !== undefined) {
        return {
          received: magnitude(received),
          spent: magnitude(spent),
          type: 'swap',
          wallet: candidate.wallet,
        };
      }
    }

    const tokenDelta = tokenDeltas.find((delta) => delta.delta !== 0n);
    if (tokenDelta !== undefined) return movement(candidate.wallet, tokenDelta);

    const solDelta = candidate.deltas.find((delta) => delta.symbol === 'SOL');
    if (
      solDelta !== undefined
      && hasSystemTransfer(candidate.address, message.instructions, meta.innerInstructions)
    ) {
      return movement(candidate.wallet, solDelta);
    }
  }

  return null;
}

function movement(wallet: WalletScope, delta: Delta): SolanaWalletAction {
  return {
    amount: magnitude(delta),
    type: delta.delta > 0n ? 'receive' : 'send',
    wallet,
  };
}

function matchingTransfer(
  publicDeltas: readonly Delta[],
  privateDeltas: readonly Delta[],
): SolanaWalletAction | null {
  for (const outgoing of [...publicDeltas, ...privateDeltas]) {
    if (outgoing.delta >= 0n) continue;
    const source = publicDeltas.includes(outgoing) ? 'public' : 'private';
    const destination = source === 'public' ? privateDeltas : publicDeltas;
    const incoming = destination.find((candidate) => (
      candidate.symbol === outgoing.symbol && candidate.delta === -outgoing.delta
    ));

    if (incoming !== undefined) {
      return {
        amount: magnitude(outgoing),
        from: source,
        to: source === 'public' ? 'private' : 'public',
        type: 'transfer',
      };
    }
  }

  return null;
}

function walletDeltas(
  address: string,
  accountKeys: readonly unknown[] | undefined,
  meta: NonNullable<ParsedWalletTransaction['meta']>,
  definitions: readonly AssetDefinition[],
): readonly Delta[] {
  const tokenDeltas = definitions.flatMap((definition) => {
    const before = tokenTotal(meta.preTokenBalances, address, definition);
    const after = tokenTotal(meta.postTokenBalances, address, definition);
    const delta = after - before;
    return delta === 0n ? [] : [{ ...definition, delta }];
  });
  const index = accountKeys?.findIndex((key) => accountKey(key) === address) ?? -1;

  if (index < 0) return tokenDeltas;

  const before = safeLamports(meta.preBalances?.[index]);
  const after = safeLamports(meta.postBalances?.[index]);
  const fee = index === 0 ? safeLamports(meta.fee) : 0n;

  if (before === null || after === null || fee === null) return tokenDeltas;

  const delta = after - before + fee;
  return delta === 0n
    ? tokenDeltas
    : [...tokenDeltas, { decimals: 9, delta, symbol: 'SOL' }];
}

function tokenTotal(
  balances: readonly TokenBalance[] | null | undefined,
  address: string,
  definition: AssetDefinition,
): bigint {
  let total = 0n;

  for (const balance of balances ?? []) {
    const amount = balance.uiTokenAmount?.amount;
    if (
      balance.owner !== address
      || balance.mint !== definition.mint
      || balance.uiTokenAmount?.decimals !== definition.decimals
      || typeof amount !== 'string'
      || !/^\d+$/u.test(amount)
    ) continue;
    total += BigInt(amount);
  }

  return total;
}

function accountKey(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const pubkey = (value as { readonly pubkey?: unknown }).pubkey;
  return typeof pubkey === 'string' ? pubkey : null;
}

function safeLamports(value: unknown): bigint | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? BigInt(value)
    : null;
}

function magnitude(delta: Delta): WalletAssetAmount {
  return {
    baseUnits: delta.delta < 0n ? -delta.delta : delta.delta,
    decimals: delta.decimals,
    symbol: delta.symbol,
  };
}

function instructionProgramIds(
  instructions: readonly ParsedInstruction[] | undefined,
  inner: NonNullable<ParsedWalletTransaction['meta']>['innerInstructions'],
): ReadonlySet<string> {
  const ids = new Set<string>();

  for (const instruction of [
    ...(instructions ?? []),
    ...(inner ?? []).flatMap((group) => group.instructions ?? []),
  ]) {
    if (typeof instruction.programId === 'string') ids.add(instruction.programId);
  }

  return ids;
}

function hasSystemTransfer(
  address: string,
  instructions: readonly ParsedInstruction[] | undefined,
  inner: NonNullable<ParsedWalletTransaction['meta']>['innerInstructions'],
): boolean {
  return [
    ...(instructions ?? []),
    ...(inner ?? []).flatMap((group) => group.instructions ?? []),
  ].some((instruction) => {
    const info = instruction.parsed?.info;
    return instruction.program === 'system'
      && (instruction.parsed?.type === 'transfer'
        || instruction.parsed?.type === 'transferWithSeed')
      && (info?.source === address || info?.destination === address);
  });
}
