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

import { readAppConfig } from '@/config/appConfig';
import {
  beginPrivateFunding,
  resumePrivateFunding,
} from '@/integrations/umbra/privateFunding';
import { PrivateFundingError } from '@/integrations/umbra/privateFundingErrors';
import {
  readPrivateFundingRecord,
  type PrivateFundingRecord,
} from '@/integrations/umbra/umbraSecureStorage';
import type { PerpsProviderId } from '@/config/appConfig';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type PrivateFundingState = {
  readonly record: PrivateFundingRecord | null;
  readonly isRunning: boolean;
  readonly error: string | null;
  readonly start: (
    amountBaseUnits: bigint,
    feeReserveLamports: bigint,
    provider: PerpsProviderId,
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
  const mainWalletAddress = isConnected(wallet)
    ? (wallet.wallets[0]?.address ?? null)
    : null;
  const [record, setRecord] = useState<PrivateFundingRecord | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const autoResumedRef = useRef<string | null>(null);

  useEffect(() => {
    autoResumedRef.current = null;
    setRecord(null);
    setError(null);

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

    runningRef.current = true;
    setIsRunning(true);
    setError(null);

    try {
      setRecord(await action());
    } catch (cause) {
      setError(
        cause instanceof PrivateFundingError
          ? cause.message
          : 'Private funding did not complete. Resume it safely.',
      );
    } finally {
      runningRef.current = false;
      setIsRunning(false);
    }
  }, []);

  const start = useCallback(
    async (
      amountBaseUnits: bigint,
      feeReserveLamports: bigint,
      provider: PerpsProviderId,
    ) => {
      await run(async () =>
        beginPrivateFunding(
          {
            ...(await operationInput()),
            amountBaseUnits,
            feeReserveLamports,
            provider,
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
      (record.phase === 'complete' && record.feeFundingSignature !== null)
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

  useEffect(() => {
    if (
      record === null ||
      (record.phase === 'complete' && record.feeFundingSignature !== null) ||
      record.phase === 'depositing' ||
      record.feeFundingLamports === null ||
      autoResumedRef.current === record.id ||
      isRunning
    ) {
      return;
    }

    autoResumedRef.current = record.id;
    void resume();
  }, [isRunning, record, resume]);

  const value = useMemo(
    () => ({ record, isRunning, error, start, resume }),
    [error, isRunning, record, resume, start],
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
