import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import {
  address,
  lamports,
  type Address,
  type Blockhash,
  type MaybeEncodedAccount,
} from '@solana/kit';
import {
  Message,
  PublicKey,
  Transaction,
  VersionedMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type {
  IUmbraSigner,
  SignableTransaction,
  SignedMessage,
} from '@umbra-privacy/sdk/client';
import type {
  AccountInfoProviderFunction,
  GetEpochInfo,
  GetLatestBlockhash,
  SignedTransaction,
  TransactionForwarder,
  TransactionSignature,
} from '@umbra-privacy/sdk/solana';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { createUmbraLocalSigner } from '@/integrations/umbra/umbraLocalSigner';

const ZERO_SIGNATURE = new Uint8Array(64);
const CONFIRMATION_ATTEMPTS = 45;
const CONFIRMATION_INTERVAL_MS = 1_000;

export type PrivySolanaProvider = {
  request(input: {
    readonly method: 'signMessage';
    readonly params: { readonly message: string };
  }): Promise<{ readonly signature: string }>;
  request<T extends Transaction | VersionedTransaction>(input: {
    readonly method: 'signTransaction';
    readonly params: { readonly transaction: T };
  }): Promise<{ readonly signedTransaction: T }>;
};

export type UmbraGatewayDependencies = {
  readonly signer: IUmbraSigner;
  readonly accountInfoProvider: AccountInfoProviderFunction;
  readonly blockhashProvider: GetLatestBlockhash;
  readonly epochInfoProvider: GetEpochInfo;
  readonly transactionForwarder: TransactionForwarder;
};

export function createUmbraGatewayDependencies(input: {
  readonly gatewaySigner: GatewayRequestSigner;
  readonly mainWalletAddress: string;
  readonly provider: PrivySolanaProvider;
  readonly rpcUrl: string;
}): UmbraGatewayDependencies {
  return {
    signer: createUmbraPrivySigner(input.mainWalletAddress, input.provider),
    accountInfoProvider: createAccountInfoProvider(
      input.rpcUrl,
      input.gatewaySigner,
    ),
    blockhashProvider: createBlockhashProvider(
      input.rpcUrl,
      input.gatewaySigner,
    ),
    epochInfoProvider: createEpochInfoProvider(
      input.rpcUrl,
      input.gatewaySigner,
    ),
    transactionForwarder: createTransactionForwarder(
      input.rpcUrl,
      input.gatewaySigner,
    ),
  };
}

export function createUmbraLocalGatewayDependencies(input: {
  readonly gatewaySigner: GatewayRequestSigner;
  readonly rpcUrl: string;
  readonly walletAddress: string;
}): UmbraGatewayDependencies {
  return {
    signer: createUmbraLocalSigner(input.walletAddress, input.gatewaySigner),
    accountInfoProvider: createAccountInfoProvider(input.rpcUrl, input.gatewaySigner),
    blockhashProvider: createBlockhashProvider(input.rpcUrl, input.gatewaySigner),
    epochInfoProvider: createEpochInfoProvider(input.rpcUrl, input.gatewaySigner),
    transactionForwarder: createTransactionForwarder(input.rpcUrl, input.gatewaySigner),
  };
}

function createUmbraPrivySigner(
  walletAddress: string,
  provider: PrivySolanaProvider,
): IUmbraSigner {
  const publicKey = new PublicKey(walletAddress);
  const signerAddress = address(walletAddress);

  const signTransaction = async (
    transaction: SignableTransaction,
  ): Promise<SignedTransaction> => {
    if (!(walletAddress in transaction.signatures)) {
      throw new Error('Umbra transaction does not require the active Privy wallet.');
    }

    const native = toNativeTransaction(transaction);
    const { signedTransaction } = await provider.request({
      method: 'signTransaction',
      params: { transaction: native },
    });

    if (
      !equalBytes(
        messageBytes(signedTransaction),
        Uint8Array.from(transaction.messageBytes),
      )
    ) {
      throw new Error('Privy changed the Umbra transaction message.');
    }

    const signatures = nativeSignatures(signedTransaction);
    const walletSignature = signatures[walletAddress];

    if (
      walletSignature === undefined ||
      !ed25519.verify(
        walletSignature,
        Uint8Array.from(transaction.messageBytes),
        publicKey.toBytes(),
      )
    ) {
      throw new Error('Privy returned an invalid Umbra transaction signature.');
    }

    return {
      ...transaction,
      signatures: { ...transaction.signatures, ...signatures },
    } as SignedTransaction;
  };

  return {
    address: signerAddress,
    signTransaction,
    signTransactions: async (transactions) => {
      const signed: SignedTransaction[] = [];

      for (const transaction of transactions) {
        signed.push(await signTransaction(transaction));
      }

      return signed;
    },
    signMessage: async (message): Promise<SignedMessage> => {
      const { signature: encoded } = await provider.request({
        method: 'signMessage',
        params: { message: base64.encode(message) },
      });
      const signature = base64.decode(encoded);

      if (
        signature.length !== 64 ||
        !ed25519.verify(signature, message, publicKey.toBytes())
      ) {
        throw new Error('Privy returned an invalid Umbra recovery signature.');
      }

      return { message, signature, signer: signerAddress } as SignedMessage;
    },
  };
}

function createAccountInfoProvider(
  rpcUrl: string,
  signer: GatewayRequestSigner,
): AccountInfoProviderFunction {
  return async (requested, options) => {
    const addresses = [...new Set(requested)];
    const accounts = new Map<Address, MaybeEncodedAccount>();

    for (let start = 0; start < addresses.length; start += 100) {
      const chunk = addresses.slice(start, start + 100);
      const response = await signedSolanaRpc<{
        readonly value: readonly (
          | {
              readonly data: readonly [string, 'base64'];
              readonly executable: boolean;
              readonly lamports: number;
              readonly owner: string;
              readonly space: number;
            }
          | null
        )[];
      }>({
        method: 'getMultipleAccounts',
        params: [
          chunk,
          {
            commitment: options?.commitment ?? 'confirmed',
            encoding: 'base64',
          },
        ],
        rpcUrl,
        signer,
      });

      if (response.value.length !== chunk.length) {
        throw new Error('Solana omitted an Umbra account response.');
      }

      chunk.forEach((accountAddress, index) => {
        const value = response.value[index];

        if (value === null || value === undefined) {
          accounts.set(accountAddress, { exists: false, address: accountAddress });
          return;
        }

        const data = base64.decode(value.data[0]);
        accounts.set(accountAddress, {
          exists: true,
          address: accountAddress,
          data,
          executable: value.executable,
          lamports: lamports(safeBigInt(value.lamports, 'account balance')),
          programAddress: address(value.owner),
          space: safeBigInt(value.space, 'account size'),
        });
      });
    }

    return accounts;
  };
}

function createBlockhashProvider(
  rpcUrl: string,
  signer: GatewayRequestSigner,
): GetLatestBlockhash {
  return async (options) => {
    const response = await signedSolanaRpc<{
      readonly value: {
        readonly blockhash: string;
        readonly lastValidBlockHeight: number;
      };
    }>({
      method: 'getLatestBlockhash',
      params: [{ commitment: options?.commitment ?? 'confirmed' }],
      rpcUrl,
      signer,
    });

    return {
      blockhash: response.value.blockhash as Blockhash,
      lastValidBlockHeight: safeBigInt(
        response.value.lastValidBlockHeight,
        'last valid block height',
      ),
    };
  };
}

function createEpochInfoProvider(
  rpcUrl: string,
  signer: GatewayRequestSigner,
): GetEpochInfo {
  return async (options) => {
    const value = await signedSolanaRpc<{
      readonly epoch: number;
      readonly slotIndex: number;
      readonly slotsInEpoch: number;
      readonly absoluteSlot: number;
      readonly blockHeight: number;
      readonly transactionCount: number | null;
    }>({
      method: 'getEpochInfo',
      params: [{ commitment: options?.commitment ?? 'confirmed' }],
      rpcUrl,
      signer,
    });

    return {
      epoch: safeBigInt(value.epoch, 'epoch'),
      slotIndex: safeBigInt(value.slotIndex, 'epoch slot'),
      slotsInEpoch: safeBigInt(value.slotsInEpoch, 'slots in epoch'),
      absoluteSlot: safeBigInt(value.absoluteSlot, 'absolute slot'),
      blockHeight: safeBigInt(value.blockHeight, 'block height'),
      ...(value.transactionCount === null
        ? {}
        : {
            transactionCount: safeBigInt(
              value.transactionCount,
              'transaction count',
            ),
          }),
    };
  };
}

function createTransactionForwarder(
  rpcUrl: string,
  signer: GatewayRequestSigner,
): TransactionForwarder {
  const submit = async (
    transaction: SignedTransaction,
    confirm: boolean,
  ): Promise<TransactionSignature> => {
    const { bytes, signature } = serializeSignedTransaction(transaction);
    const submitted = await signedSolanaRpc<string>({
      method: 'sendTransaction',
      params: [
        base64.encode(bytes),
        {
          encoding: 'base64',
          maxRetries: 0,
          preflightCommitment: 'confirmed',
          skipPreflight: false,
        },
      ],
      rpcUrl,
      signer,
      idempotencyKey: `umbra_${signature}`,
      timeoutMs: 15_000,
    });

    if (submitted !== signature) {
      throw new Error('Solana returned a different Umbra transaction signature.');
    }

    if (confirm) {
      await confirmUmbraSignature(rpcUrl, signer, signature);
    }

    return signature as TransactionSignature;
  };

  return {
    fireAndForget: (transaction) => submit(transaction, false),
    forwardInParallel: (transactions) =>
      Promise.all(transactions.map((transaction) => submit(transaction, true))),
    forwardSequentially: async (transactions) => {
      const signatures: TransactionSignature[] = [];

      for (const transaction of transactions) {
        signatures.push(await submit(transaction, true));
      }

      return signatures;
    },
  };
}

function toNativeTransaction(
  transaction: SignableTransaction,
): Transaction | VersionedTransaction {
  const messageBytes = Uint8Array.from(transaction.messageBytes);
  const message = decodeMessage(messageBytes);
  const required = requiredSignerKeys(message);
  const signatures = required.map((key) =>
    transaction.signatures[address(key.toBase58())] ?? ZERO_SIGNATURE,
  );

  return message instanceof Message
    ? Transaction.populate(message, signatures.map((value) => base58.encode(value)))
    : new VersionedTransaction(message, signatures.map((value) => Uint8Array.from(value)));
}

function serializeSignedTransaction(transaction: SignedTransaction): {
  readonly bytes: Uint8Array;
  readonly signature: string;
} {
  const messageBytes = Uint8Array.from(transaction.messageBytes);
  const message = decodeMessage(messageBytes);
  const required = requiredSignerKeys(message);
  const signatures = required.map((key) => {
    const signature = transaction.signatures[address(key.toBase58())];

    if (
      signature === null ||
      signature === undefined ||
      !ed25519.verify(signature, messageBytes, key.toBytes())
    ) {
      throw new Error('Umbra transaction is missing a valid required signature.');
    }

    return signature;
  });
  const native = message instanceof Message
    ? Transaction.populate(message, signatures.map((value) => base58.encode(value)))
    : new VersionedTransaction(message, signatures.map((value) => Uint8Array.from(value)));

  return {
    bytes: native instanceof Transaction
      ? native.serialize({ requireAllSignatures: true, verifySignatures: true })
      : native.serialize(),
    signature: base58.encode(signatures[0] ?? ZERO_SIGNATURE),
  };
}

function decodeMessage(bytes: Uint8Array): Message | VersionedMessage {
  return (bytes[0] ?? 0) & 0x80
    ? VersionedMessage.deserialize(bytes)
    : Message.from(bytes);
}

function requiredSignerKeys(message: Message | VersionedMessage): PublicKey[] {
  return message.staticAccountKeys.slice(0, message.header.numRequiredSignatures);
}

function messageBytes(transaction: Transaction | VersionedTransaction): Uint8Array {
  return transaction instanceof Transaction
    ? transaction.serializeMessage()
    : transaction.message.serialize();
}

function nativeSignatures(
  transaction: Transaction | VersionedTransaction,
): Record<string, Uint8Array> {
  if (transaction instanceof Transaction) {
    return Object.fromEntries(
      transaction.signatures.flatMap(({ publicKey, signature }) =>
        signature === null ? [] : [[publicKey.toBase58(), Uint8Array.from(signature)]],
      ),
    );
  }

  return Object.fromEntries(
    requiredSignerKeys(transaction.message).flatMap((key, index) => {
      const signature = transaction.signatures[index];
      return signature === undefined || equalBytes(signature, ZERO_SIGNATURE)
        ? []
        : [[key.toBase58(), Uint8Array.from(signature)]];
    }),
  );
}

export async function confirmUmbraSignature(
  rpcUrl: string,
  signer: GatewayRequestSigner,
  signature: string,
): Promise<void> {
  for (let attempt = 0; attempt < CONFIRMATION_ATTEMPTS; attempt += 1) {
    const response = await signedSolanaRpc<{
      readonly value: readonly (
        | { readonly err: unknown; readonly confirmationStatus?: string }
        | null
      )[];
    }>({
      method: 'getSignatureStatuses',
      params: [[signature], { searchTransactionHistory: true }],
      rpcUrl,
      signer,
    });
    const status = response.value[0];

    if (status?.err !== null && status?.err !== undefined) {
      throw new Error('Umbra transaction failed on-chain.');
    }

    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return;
    }

    await wait(CONFIRMATION_INTERVAL_MS);
  }

  throw new Error('Umbra transaction confirmation timed out.');
}

function safeBigInt(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Solana returned an invalid ${label}.`);
  }

  return BigInt(value);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
