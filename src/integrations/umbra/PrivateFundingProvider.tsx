import {
  isConnected,
  useEmbeddedSolanaWallet,
} from '@privy-io/expo';
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
import { AppState } from 'react-native';

import { readAppConfig } from '@/config/appConfig';
import {
  beginPrivateFunding,
  resumePrivateFunding,
} from '@/integrations/umbra/privateFunding';
import {
  classifyPrivateFundingFailure,
  PrivateFundingError,
  privateFundingUserMessage,
} from '@/integrations/umbra/privateFundingErrors';
import {
  preparePrivateFundingPreflight,
  type PrivateFundingPreflight,
  type PrivateFundingPreflightInput,
} from '@/integrations/umbra/privateFundingPreflight';
import {
  nextPrivateFundingRelayRecoveryAttempt,
  privateFundingRelayRecoveryKey,
  recoverSubmittedPrivateFundingRelay,
} from '@/integrations/umbra/privateFundingRelayRecovery';
import {
  readPrivateFundingRecord,
  type PrivateFundingRecord,
} from '@/integrations/umbra/umbraSecureStorage';
import type { ProviderCollateral } from '@/integrations/perps/providerCollateral';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type BalanceCheckInput = Pick<
  PrivateFundingPreflightInput,
  | 'amountBaseUnits'
  | 'collateralLegPending'
  | 'feeLegPending'
  | 'feeReserveLamports'
  | 'mint'
>;

type PrivateFundingState = {
  readonly record: PrivateFundingRecord | null;
  readonly preflight: PrivateFundingPreflight | null;
  readonly preflightError: string | null;
  readonly isChecking: boolean;
  readonly isRunning: boolean;
  readonly error: string | null;
  readonly check: (input: BalanceCheckInput) => Promise<PrivateFundingPreflight>;
  readonly start: (
    amountBaseUnits: bigint,
    feeReserveLamports: bigint,
    collateral: ProviderCollateral,
  ) => Promise<void>;
  readonly resume: (feeReserveLamports?: bigint) => Promise<void>;
};

const PrivateFundingContext = createContext<PrivateFundingState | null>(null);

export function PrivateFundingProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const wallet = useEmbeddedSolanaWallet();
  const tradingSession = useTradingSession();
  const mainWalletAddress = wallet.wallets?.[0]?.address ?? null;
  const [record, setRecord] = useState<PrivateFundingRecord | null>(null);
  const [preflight, setPreflight] = useState<PrivateFundingPreflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [activeRefresh, setActiveRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const preflightRef = useRef<AbortController | null>(null);
  const passiveRecoveryAbortRef = useRef<AbortController | null>(null);
  const passiveRecoveryRef = useRef<string | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setActiveRefresh((value) => value + 1);
      } else {
        passiveRecoveryAbortRef.current?.abort();
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    passiveRecoveryAbortRef.current?.abort();
    passiveRecoveryAbortRef.current = null;
    passiveRecoveryRef.current = null;
    setRecord(null);
    setPreflight(null);
    setPreflightError(null);
    setError(null);
    preflightRef.current?.abort();

    if (mainWalletAddress === null) {
      return;
    }

    let cancelled = false;
    void readPrivateFundingRecord(mainWalletAddress)
      .then((stored) => {
        if (!cancelled) {
          setRecord(stored);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Private-funding recovery state could not be read.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mainWalletAddress]);

  useEffect(() => {
    const recoveryKey = privateFundingRelayRecoveryKey(record);
    const attemptKey = nextPrivateFundingRelayRecoveryAttempt({
      activeRefresh,
      isRunning,
      lastAttemptKey: passiveRecoveryRef.current,
      recoveryKey,
    });

    if (record === null || attemptKey === null) {
      return;
    }

    const config = readAppConfig();
    if (!config.ok) {
      return;
    }

    passiveRecoveryRef.current = attemptKey;
    const controller = new AbortController();
    passiveRecoveryAbortRef.current = controller;
    void recoverSubmittedPrivateFundingRelay({
      apiEndpoint: config.value.privacy.umbraRelayerUrl,
      onRecord: setRecord,
      record,
      signal: controller.signal,
    }).then((next) => {
      if (!controller.signal.aborted && next.phase === 'complete') {
        publishInAppNotification({
          kind: 'funding',
          outcome: 'success',
          title: 'Private deposit completed',
          message: 'Funds are available in private wallet T.',
        });
      }
    }).catch((cause) => {
      const errorCode = classifyPrivateFundingFailure(cause);
      if (
        !controller.signal.aborted &&
        errorCode !== 'relay_cancelled' &&
        errorCode !== 'relay_pending'
      ) {
        console.error('[Perpal private funding]', JSON.stringify({
          event: 'passive_recovery_failed',
          errorCode,
        }));
        setError(`${privateFundingUserMessage(errorCode)} Error reference: ${errorCode}.`);
      }
    });

    return () => {
      controller.abort();
      if (passiveRecoveryAbortRef.current === controller) {
        passiveRecoveryAbortRef.current = null;
      }
    };
  }, [activeRefresh, isRunning, record]);

  const check = useCallback(async (
    input: BalanceCheckInput,
  ): Promise<PrivateFundingPreflight> => {
    const config = readAppConfig();

    if (!config.ok || mainWalletAddress === null || tradingSession.signer === null) {
      throw new PrivateFundingError(
        'Public-wallet balances are unavailable.',
        'balance_unavailable',
      );
    }

    preflightRef.current?.abort();
    const controller = new AbortController();
    preflightRef.current = controller;
    setIsChecking(true);
    setPreflight(null);
    setPreflightError(null);

    try {
      const result = await preparePrivateFundingPreflight({
        ...input,
        rpcUrl: config.value.api.rpcUrl,
        signer: tradingSession.signer,
        signal: controller.signal,
        walletAddress: mainWalletAddress,
      });

      if (preflightRef.current === controller) {
        setPreflight(result);
      }
      return result;
    } catch (cause) {
      const safeCause = cause instanceof PrivateFundingError
        ? cause
        : new PrivateFundingError(
          'Public-wallet balances could not be checked.',
          'balance_unavailable',
        );
      if (!controller.signal.aborted && preflightRef.current === controller) {
        setPreflightError(safeCause.message);
      }
      throw safeCause;
    } finally {
      if (preflightRef.current === controller) {
        preflightRef.current = null;
        setIsChecking(false);
      }
    }
  }, [mainWalletAddress, tradingSession.signer]);

  useEffect(() => {
    if (
      record === null ||
      record.feeFundingLamports === null ||
      record.phase === 'complete'
    ) {
      return;
    }

    void check({
      amountBaseUnits: BigInt(record.amountBaseUnits),
      collateralLegPending:
        record.depositSignature === null && record.claimSignature === null,
      feeLegPending:
        record.feeFundingDepositSignature === null &&
        record.feeFundingSignature === null,
      feeReserveLamports: BigInt(record.feeFundingLamports),
      mint: record.mint,
    }).catch(() => undefined);

    return () => {
      preflightRef.current?.abort();
    };
  }, [activeRefresh, check, record]);

  const operationInput = useCallback(async () => {
    const config = readAppConfig();

    if (
      !config.ok ||
      !isConnected(wallet) ||
      mainWalletAddress === null ||
      tradingSession.status !== 'ready' ||
      tradingSession.address === null ||
      tradingSession.signer === null
    ) {
      throw new PrivateFundingError(
        'Activate private trading before adding funds.',
        'wallet_unavailable',
      );
    }

    const embedded = wallet.wallets[0];

    if (embedded === undefined) {
      throw new PrivateFundingError('Privy wallet is unavailable.', 'wallet_unavailable');
    }

    return {
      config: config.value,
      gatewaySigner: tradingSession.signer,
      mainWalletAddress,
      privyProvider: await embedded.getProvider(),
      tradingWalletAddress: tradingSession.address,
    };
  }, [mainWalletAddress, tradingSession, wallet]);

  const run = useCallback(async (action: () => Promise<PrivateFundingRecord>) => {
    if (runningRef.current) {
      return;
    }

    passiveRecoveryAbortRef.current?.abort();
    passiveRecoveryRef.current = null;
    runningRef.current = true;
    setIsRunning(true);
    setError(null);

    try {
      const next = await action();
      setRecord(next);
      if (next.phase === 'complete') {
        publishInAppNotification({
          kind: 'funding',
          outcome: 'success',
          title: 'Private deposit completed',
          message: 'Funds are available in private wallet T.',
        });
      }
    } catch (cause) {
      const errorCode = classifyPrivateFundingFailure(cause);
      console.error('[Perpal private funding]', JSON.stringify({
        event: 'failed',
        errorCode,
        errorName: cause instanceof Error ? cause.name : typeof cause,
      }));
      setError(
        `${cause instanceof PrivateFundingError
          ? cause.message
          : privateFundingUserMessage(errorCode)} Error reference: ${errorCode}.`,
      );
      publishInAppNotification({
        kind: 'funding',
        outcome: 'error',
        title: 'Private deposit needs attention',
        message: 'Open Portfolio to review and safely resume the deposit.',
      });
    } finally {
      runningRef.current = false;
      setIsRunning(false);
    }
  }, []);

  const start = useCallback(
    async (
      amountBaseUnits: bigint,
      feeReserveLamports: bigint,
      collateral: ProviderCollateral,
    ) => {
      await run(async () =>
        beginPrivateFunding(
          {
            ...(await operationInput()),
            amountBaseUnits,
            feeReserveLamports,
            collateral,
          },
          setRecord,
        ),
      );
    },
    [operationInput, run],
  );

  const resume = useCallback(async (feeReserveLamports?: bigint) => {
    if (
      record === null ||
      record.phase === 'complete'
    ) {
      return;
    }

    await run(async () =>
      resumePrivateFunding(
        record,
        await operationInput(),
        setRecord,
        feeReserveLamports,
      ),
    );
  }, [operationInput, record, run]);

  const value = useMemo(
    () => ({
      check,
      error,
      isChecking,
      isRunning,
      preflight,
      preflightError,
      record,
      resume,
      start,
    }),
    [
      check,
      error,
      isChecking,
      isRunning,
      preflight,
      preflightError,
      record,
      resume,
      start,
    ],
  );

  return (
    <PrivateFundingContext.Provider value={value}>
      {children}
    </PrivateFundingContext.Provider>
  );
}

export function usePrivateFunding(): PrivateFundingState {
  const value = useContext(PrivateFundingContext);

  if (value === null) {
    throw new Error('usePrivateFunding must be inside PrivateFundingProvider.');
  }

  return value;
}
