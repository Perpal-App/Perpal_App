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

import { readAppConfig, type PerpsProviderId } from '@/config/appConfig';
import { providerCollateral } from '@/integrations/perps/providerCollateral';
import {
  ensureFlashCollateralInWallet,
  resumeFlashSettlements,
} from '@/integrations/perps/flash/flashSettlement';
import { resumeVelocitySettlements } from '@/integrations/perps/velocity/velocitySettlement';
import { readPendingVelocitySettlements } from '@/integrations/perps/velocity/velocitySettlementStorage';
import { ensureVelocityCollateralInWallet } from '@/integrations/perps/velocity/velocityCollateralWithdrawal';
import {
  beginPrivateExit,
  resumePrivateExit,
} from '@/integrations/umbra/privateExit';
import {
  readPrivateExitRecord,
  type PrivateExitRecord,
} from '@/integrations/umbra/privateExitStorage';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type State = {
  readonly record: PrivateExitRecord | null;
  readonly isRunning: boolean;
  readonly error: string | null;
  readonly mainWalletAddress: string | null;
  readonly start: (
    amountBaseUnits: bigint,
    destinationAddress: string,
    provider: PerpsProviderId,
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
      setRecord(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Private withdrawal did not complete.');
    } finally {
      runningRef.current = false;
      setIsRunning(false);
    }
  }, []);

  const start = useCallback(async (
    amountBaseUnits: bigint,
    destinationAddress: string,
    provider: PerpsProviderId,
  ) => {
    await run(async () => {
      const input = operationInput();
      if (provider === 'velocity') {
        await resumeVelocitySettlements({
          marketDataUrl: input.config.api.marketDataUrl,
          owner: input.sourceWalletAddress,
          programId: input.config.perps.velocityProgramId,
          rpcUrl: input.config.api.rpcUrl,
          signer: input.gatewaySigner,
        });
        if ((await readPendingVelocitySettlements(input.sourceWalletAddress)).length > 0) {
          throw new Error('A closed Velocity position is still settling into T.');
        }
        await ensureVelocityCollateralInWallet({
          amountBaseUnits,
          owner: input.sourceWalletAddress,
          programId: input.config.perps.velocityProgramId,
          rpcUrl: input.config.api.rpcUrl,
          signer: input.gatewaySigner,
        });
      } else {
        if (session.flashFeeSigner === null) {
          throw new Error('Flash private fee signer is unavailable.');
        }
        const flashInput = {
          erRpcUrl: input.config.perps.flashErRpc,
          feeSigner: session.flashFeeSigner,
          owner: input.sourceWalletAddress,
          programId: input.config.perps.flashProgramId,
          rpcUrl: input.config.api.rpcUrl,
          signer: input.gatewaySigner,
        };
        await resumeFlashSettlements(flashInput);
        await ensureFlashCollateralInWallet(amountBaseUnits, flashInput);
      }
      const collateral = providerCollateral(provider, input.config.perps.flashProgramId);
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
  }, [operationInput, run, session.flashFeeSigner]);

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
