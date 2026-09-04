import { NATIVE_MINT } from '@solana/spl-token';
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
import {
  beginPrivateExit,
  canResetPrivateExit,
  resetPrivateExit,
  resumePrivateExit,
} from '@/integrations/umbra/privateExit';
import {
  readPrivateExitRecord,
  type PrivateExitRecord,
} from '@/integrations/umbra/privateExitStorage';
import { PrivateFundingError } from '@/integrations/umbra/privateFundingErrors';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { showAppToast } from '@/storage/appToast';
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
  readonly reset: () => Promise<void>;
  readonly canReset: boolean;
};

export type PrivateExitAsset = {
  readonly decimals: number;
  readonly kind: 'native' | 'spl';
  readonly mint: string;
  readonly symbol: string;
};

const Context = createContext<State | null>(null);

export function PrivateExitProvider({ children }: { readonly children: ReactNode }) {
  const session = useTradingSession();
  const mainWalletAddress = session.mainWalletAddress;
  const [record, setRecord] = useState<PrivateExitRecord | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
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
      const message = cause instanceof PrivateFundingError
        ? cause.message
        : 'Private withdrawal did not complete. Progress is saved for a safe retry.';
      setError(message);
      publishInAppNotification({
        kind: 'withdrawal',
        outcome: 'error',
        title: 'Private withdrawal needs attention',
        message,
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
   * The protocol leg rechecks the live source-token and SOL balances after registration and recovery
   * scanning, immediately before it prepares a new deposit. For SOL, Umbra uses its native mint
   * internally, wraps on deposit, and unwraps in the relayed claim callback.
   */
  const start = useCallback(async (
    amountBaseUnits: bigint,
    destinationAddress: string,
    asset: PrivateExitAsset,
  ) => {
    await run(async () => {
      const input = operationInput();

      if (asset.kind === 'native' && asset.mint !== NATIVE_MINT.toBase58()) {
        throw new Error('The native SOL withdrawal mint is invalid.');
      }

      if (asset.kind !== 'native' && asset.mint === input.config.perps.usdcMint) {
        await ensurePacificaCollateralInWallet(amountBaseUnits, {
          account: input.sourceWalletAddress,
          apiOrigin: input.config.perps.pacificaApiOrigin,
          mint: asset.mint,
          rpcUrl: input.config.api.rpcUrl,
          signer: input.gatewaySigner,
          withdrawalFeeBaseUnits: input.config.perps.pacificaWithdrawalFeeBaseUnits,
          wsOrigin: input.config.perps.pacificaWsOrigin,
        });
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
      ? 'The destination received native SOL through the private Umbra route.'
      : undefined, asset.kind === 'native' ? 'Private SOL withdrawal completed' : undefined);
  }, [operationInput, run]);

  const resume = useCallback(async () => {
    if (record === null || record.phase === 'complete') return;
    await run(() => resumePrivateExit(record, operationInput(), setRecord));
  }, [operationInput, record, run]);

  const reset = useCallback(async () => {
    if (record === null || runningRef.current) return;
    runningRef.current = true;
    setIsRunning(true);
    try {
      await resetPrivateExit(record);
      setRecord(null);
      setError(null);
      showAppToast({
        outcome: 'info',
        title: 'Withdrawal reset',
        message: 'No transaction was submitted. Enter a new amount.',
      });
    } catch {
      showAppToast({
        outcome: 'error',
        title: 'Resume required',
        message: 'This withdrawal may have been submitted and cannot be discarded.',
      });
    } finally {
      runningRef.current = false;
      setIsRunning(false);
    }
  }, [record]);

  const value = useMemo(() => ({
    record,
    isRunning,
    error,
    mainWalletAddress,
    start,
    resume,
    reset,
    canReset: record !== null && canResetPrivateExit(record),
  }), [error, isRunning, mainWalletAddress, record, reset, resume, start]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePrivateExit(): State {
  const value = useContext(Context);
  if (value === null) throw new Error('usePrivateExit must be inside PrivateExitProvider.');
  return value;
}
