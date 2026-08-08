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
import { pacificaCollateral } from '@/integrations/perps/providerCollateral';
import { ensurePacificaCollateralInWallet } from '@/integrations/perps/pacifica/pacificaWithdrawal';
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
  ) => Promise<void>;
  readonly resume: () => Promise<void>;
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

  const run = useCallback(async (action: () => Promise<PrivateExitRecord>) => {
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
          title: 'Private withdrawal completed',
          message: 'The destination received the private withdrawal.',
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

  const start = useCallback(async (
    amountBaseUnits: bigint,
    destinationAddress: string,
  ) => {
    await run(async () => {
      const input = operationInput();
      await ensurePacificaCollateralInWallet(amountBaseUnits, {
        account: input.sourceWalletAddress,
        apiOrigin: input.config.perps.pacificaApiOrigin,
        mint: input.config.perps.usdcMint,
        rpcUrl: input.config.api.rpcUrl,
        signer: input.gatewaySigner,
        withdrawalFeeBaseUnits: input.config.perps.pacificaWithdrawalFeeBaseUnits,
      });
      const collateral = pacificaCollateral(input.config.perps.usdcMint);
      return beginPrivateExit(
        {
          ...input,
          amountBaseUnits,
          destinationAddress,
          mint: collateral.mint,
          symbol: collateral.symbol,
        },
        setRecord,
      );
    });
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
