import { isConnected, useEmbeddedSolanaWallet } from '@privy-io/expo';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { readAppConfig } from '@/config/appConfig';
import { ensurePacificaCollateralInWallet } from '@/integrations/perps/pacifica/pacificaWithdrawal';
import { readTokenBalance } from '@/integrations/solana/stablecoinSwap';
import { withdrawNativeSol } from '@/integrations/solana/nativeSolWithdrawal';
import {
  beginPrivateExit,
  resumePrivateExit,
} from '@/integrations/umbra/privateExit';
import {
  readPrivateExitRecord,
  type PrivateExitRecord,
} from '@/integrations/umbra/privateExitStorage';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type State = {
  readonly record: PrivateExitRecord | null;
  readonly isRunning: boolean;
  readonly error: string | null;
  readonly mainWalletAddress: string | null;
  readonly start: (
    amountBaseUnits: bigint,
    destinationAddress: string,
    asset: PrivateExitAsset,
  ) => Promise<void>;
  readonly resume: () => Promise<void>;
};

export type PrivateExitAsset = {
  readonly decimals: number;
  readonly kind: 'native' | 'spl';
  readonly mint: string;
  readonly symbol: string;
};

const Context = createContext<State | null>(null);

export function PrivateExitProvider({ children }: { readonly children: ReactNode }) {
  const wallet = useEmbeddedSolanaWallet();
  const session = useTradingSession();
  const mainWalletAddress = isConnected(wallet)
    ? (wallet.wallets[0]?.address ?? null)
    : null;
  const [record, setRecord] = useState<PrivateExitRecord | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const autoResumedRef = useRef<string | null>(null);

  useEffect(() => {
    autoResumedRef.current = null;
    setRecord(null);
    if (session.status !== 'ready' || session.address === null) return;
    let cancelled = false;
    void readPrivateExitRecord(session.address)
      .then((value) => {
        if (!cancelled) setRecord(value);
      })
      .catch(() => {
        if (!cancelled) setError('Private-withdraw recovery state could not be read.');
      });
    return () => {
      cancelled = true;
    };
  }, [session.address, session.status]);

  const operationInput = useCallback(() => {
    const config = readAppConfig();
    if (
      !config.ok ||
      session.status !== 'ready' ||
      session.address === null ||
      session.signer === null
    ) {
      throw new Error('Private trading wallet T is unavailable.');
    }
    return {
      config: config.value,
      gatewaySigner: session.signer,
      sourceWalletAddress: session.address,
    };
  }, [session.address, session.signer, session.status]);

  const run = useCallback(async (
    action: () => Promise<PrivateExitRecord>,
    successMessage = 'The destination received the private withdrawal.',
    successTitle = 'Private withdrawal completed',
  ) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsRunning(true);
    setError(null);
    try {
      const next = await action();
      setRecord(next);
      if (next.phase === 'complete') {
        publishInAppNotification({
          kind: 'withdrawal',
          outcome: 'success',
          title: successTitle,
          message: successMessage,
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Private withdrawal did not complete.');
      publishInAppNotification({
        kind: 'withdrawal',
        outcome: 'error',
        title: 'Private withdrawal needs attention',
        message: 'Open Portfolio to review and safely resume the withdrawal.',
      });
    } finally {
      runningRef.current = false;
      setIsRunning(false);
    }
  }, []);

  /**
   * Withdraws one collateral token privately.
   *
   * Two legs, and only the first is token-specific. The venue holds its margin in USDC alone, so
   * collecting from the trading account is a USDC operation — `ensurePacificaCollateralInWallet`
   * validates `availableToWithdraw` as USDC and posts a USDC-denominated withdraw. Any other
   * collateral is already sitting in private wallet T, having been deposited there and never sent to
   * the venue, so there is nothing to collect and the leg is skipped.
   *
   * The private leg was already token-agnostic: `beginPrivateExit` takes the mint and symbol, records
   * them for recovery, and `assertRelayerSupportsMint` refuses a mint the Umbra relayer cannot route
   * before any funds move. So this change opens the path that existed rather than widening it.
   *
   * The skipped leg is replaced by a balance read, not by nothing. Collection is what would otherwise
   * have surfaced a shortfall, and entering a resumable state machine for an amount the wallet does
   * not hold would leave a record to recover from a failure that was knowable up front.
   */
  const start = useCallback(async (
    amountBaseUnits: bigint,
    destinationAddress: string,
    asset: PrivateExitAsset,
  ) => {
    await run(async () => {
      const input = operationInput();

      if (asset.kind === 'native') {
        const result = await withdrawNativeSol({
          amountLamports: amountBaseUnits,
          destinationAddress,
          owner: input.sourceWalletAddress,
          rpcUrl: input.config.api.rpcUrl,
          signer: input.gatewaySigner,
        });
        if (result.status !== 'confirmed') {
          throw new Error(
            `SOL withdrawal ${result.signature} was submitted but is not confirmed yet.`,
          );
        }
        return {
          version: 1,
          id: result.signature,
          sourceWalletAddress: input.sourceWalletAddress,
          destinationAddress,
          mint: asset.mint,
          symbol: asset.symbol,
          amountBaseUnits: amountBaseUnits.toString(),
          phase: 'complete',
          generationIndex: null,
          excludedNoteIds: [],
          scanStartLeafCounts: null,
          populateSignature: null,
          depositSignature: null,
          relayRequestId: null,
          claimSignature: result.signature,
          noteAmountBaseUnits: null,
          relayerFixedFeeLamports: result.feeLamports.toString(),
          errorCode: null,
          updatedAtMs: Date.now(),
        };
      }

      if (asset.mint === input.config.perps.usdcMint) {
        await ensurePacificaCollateralInWallet(amountBaseUnits, {
          account: input.sourceWalletAddress,
          apiOrigin: input.config.perps.pacificaApiOrigin,
          mint: asset.mint,
          rpcUrl: input.config.api.rpcUrl,
          signer: input.gatewaySigner,
          withdrawalFeeBaseUnits: input.config.perps.pacificaWithdrawalFeeBaseUnits,
        });
      } else {
        const held = await readTokenBalance({
          decimals: asset.decimals,
          mint: asset.mint,
          owner: input.sourceWalletAddress,
          rpcUrl: input.config.api.rpcUrl,
          signer: input.gatewaySigner,
        });

        if (held < amountBaseUnits) {
          throw new Error(
            `Private wallet T does not hold enough ${asset.symbol} for this withdrawal.`,
          );
        }
      }

      return beginPrivateExit(
        {
          ...input,
          amountBaseUnits,
          destinationAddress,
          mint: asset.mint,
          symbol: asset.symbol,
        },
        setRecord,
      );
    }, asset.kind === 'native'
      ? 'The destination received the public native SOL transfer.'
      : undefined, asset.kind === 'native' ? 'SOL withdrawal completed' : undefined);
  }, [operationInput, run]);

  const resume = useCallback(async () => {
    if (record === null || record.phase === 'complete') return;
    await run(() => resumePrivateExit(record, operationInput(), setRecord));
  }, [operationInput, record, run]);

  useEffect(() => {
    if (
      record === null ||
      record.phase === 'complete' ||
      autoResumedRef.current === record.id ||
      isRunning
    ) return;
    autoResumedRef.current = record.id;
    console.info('[Perpal recovery]', JSON.stringify({
      event: 'auto_resume',
      operation: 'private_withdrawal',
      phase: record.phase,
    }));
    void resume();
  }, [isRunning, record, resume]);

  const value = useMemo(() => ({
    record,
    isRunning,
    error,
    mainWalletAddress,
    start,
    resume,
  }), [error, isRunning, mainWalletAddress, record, resume, start]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePrivateExit(): State {
  const value = useContext(Context);
  if (value === null) throw new Error('usePrivateExit must be inside PrivateExitProvider.');
  return value;
}
