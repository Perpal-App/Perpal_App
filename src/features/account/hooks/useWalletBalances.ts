import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { readAppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { listTradingCollateralOptions } from '@/integrations/perps/providerCollateral';
import { readTokenBalance } from '@/integrations/solana/stablecoinSwap';

type WalletBalance = {
  readonly solLamports: bigint;
  readonly usdcBaseUnits: bigint;
  readonly usdtBaseUnits: bigint;
};

type WalletBalances = {
  readonly publicWallet: WalletBalance;
  readonly privateWallet: WalletBalance;
};

type BalanceStatus = 'idle' | 'loading' | 'ready' | 'error';
const REFRESH_INTERVAL_MS = 5_000;

export function useWalletBalances(input: {
  readonly privateAddress: string | null;
  readonly publicAddress: string | null;
  readonly signer: GatewayRequestSigner | null;
}) {
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [status, setStatus] = useState<BalanceStatus>('idle');
  const hasBalances = useRef(false);

  useEffect(() => {
    hasBalances.current = false;
    setBalances(null);
    setStatus(
      input.privateAddress !== null &&
      input.publicAddress !== null &&
      input.signer !== null
        ? 'loading'
        : 'idle',
    );
  }, [input.privateAddress, input.publicAddress, input.signer]);

  useFocusEffect(
    useCallback(() => {
      const config = readAppConfig();
      if (
        !config.ok ||
        input.privateAddress === null ||
        input.publicAddress === null ||
        input.signer === null
      ) {
        return undefined;
      }

      let active = true;
      let controller: AbortController | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const load = async () => {
        controller?.abort();
        controller = new AbortController();
        if (!hasBalances.current) setStatus('loading');

        try {
          const [publicWallet, privateWallet] = await Promise.all([
            readWalletBalance(input.publicAddress!, input.signer!, config.value.api.rpcUrl, config.value.perps.usdcMint, config.value.perps.usdtMint, controller.signal),
            readWalletBalance(input.privateAddress!, input.signer!, config.value.api.rpcUrl, config.value.perps.usdcMint, config.value.perps.usdtMint, controller.signal),
          ]);
          if (active) {
            hasBalances.current = true;
            setBalances({ publicWallet, privateWallet });
            setStatus('ready');
          }
        } catch {
          if (active && !controller.signal.aborted && !hasBalances.current) {
            setStatus('error');
          }
        } finally {
          if (active) timer = setTimeout(() => void load(), REFRESH_INTERVAL_MS);
        }
      };

      void load();
      return () => {
        active = false;
        controller?.abort();
        if (timer !== undefined) clearTimeout(timer);
      };
    }, [input.privateAddress, input.publicAddress, input.signer]),
  );

  return { balances, status };
}

async function readWalletBalance(
  owner: string,
  signer: GatewayRequestSigner,
  rpcUrl: string,
  usdcMint: string,
  usdtMint: string,
  signal: AbortSignal,
): Promise<WalletBalance> {
  const collateral = listTradingCollateralOptions(usdcMint, usdtMint);
  const usdc = collateral.find((token) => token.symbol === 'USDC');
  const usdt = collateral.find((token) => token.symbol === 'USDT');
  if (usdc === undefined || usdt === undefined) throw new Error('Collateral unavailable.');

  const [sol, usdcBaseUnits, usdtBaseUnits] = await Promise.all([
    signedSolanaRpc<{ readonly value: number }>({
      method: 'getBalance',
      params: [owner, { commitment: 'confirmed' }],
      rpcUrl,
      signal,
      signer,
    }),
    readTokenBalance({ mint: usdc.mint, owner, rpcUrl, signal, signer }),
    readTokenBalance({ mint: usdt.mint, owner, rpcUrl, signal, signer }),
  ]);
  if (!Number.isSafeInteger(sol.value) || sol.value < 0) {
    throw new Error('SOL balance is invalid.');
  }

  return { solLamports: BigInt(sol.value), usdcBaseUnits, usdtBaseUnits };
}
