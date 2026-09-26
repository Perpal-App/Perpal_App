import { useCallback, useEffect, useRef } from 'react';

import { parseAmount } from '@/domain/money/amount';
import type { PacificaOrderDraft } from '@/features/trade/hooks/usePacificaOrderFlow';
import type {
  PacificaMarket,
  PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import {
  buildPacificaOrderPlan,
  type PacificaOrderPlan,
} from '@/integrations/perps/pacifica/pacificaOrder';
import {
  fetchPacificaMarketSetting,
  type PacificaMarketSetting,
} from '@/integrations/perps/pacifica/pacificaOrderReconciliation';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { collateralShortfall } from '@/integrations/perps/tradeCollateralMath';

/**
 * How old, by its local receipt time, the account snapshot may be for an order to be priced from it
 * without reading it again. The shared snapshot is refreshed every 5 seconds while the app is open, so this
 * mostly guards against one that has stopped updating — after the app was in the background, say. The REST
 * layer under it may itself serve a read up to 15 seconds old.
 */
const PORTFOLIO_MAX_AGE_MS = 10_000;

/** How old the account's margin setting may be. It changes only when an order or the reader changes it. */
const SETTING_MAX_AGE_MS = 60_000;

type CachedSetting = {
  readonly account: string;
  readonly readAtMs: number;
  readonly setting: PacificaMarketSetting;
  readonly symbol: string;
};

/**
 * Prices an order on the device, at once, from reads the ticket already holds — so review opens with the
 * real figures the moment it is asked for instead of after a round of network calls.
 *
 * Every figure still comes from the order builder, `buildPacificaOrderPlan`, and it is the same plan that
 * would be signed: nothing is estimated for display. What changes is where the inputs come from — the
 * account snapshot the app keeps current, and the account's margin setting for this market, read when the
 * ticket opens and re-read after each order.
 *
 * It declines, returning `null`, whenever the full path would do more than price: a snapshot or setting
 * older than its bound, a recovery check not yet run or still pending, or an amount over what the venue
 * holds, which needs a collateral transfer built on-chain. The caller then takes the full path, which reads
 * everything afresh. Order-builder refusals — a size under the market's minimum, say — are thrown, exactly
 * as they would be from the full path.
 *
 * Signing trusts none of it: `submitPacificaOrder` re-checks the plan's expiry, the live price against its
 * slippage limit, and the margin setting against the one the plan was priced with, and refuses the order if
 * any has moved.
 */
export function useInstantOrderPlan(input: {
  readonly account: string | null;
  readonly apiOrigin: string;
  readonly market: PacificaMarket;
}) {
  const { account, apiOrigin, market } = input;
  const cached = useRef<CachedSetting | null>(null);

  /** Keeps a setting the full path has just read, so the next review can use it. */
  const remember = useCallback((setting: PacificaMarketSetting | null) => {
    if (account === null || setting === null) return;
    cached.current = { account, readAtMs: Date.now(), setting, symbol: market.venueRef };
  }, [account, market.venueRef]);

  const readSetting = useCallback((signal?: AbortSignal) => {
    if (account === null || apiOrigin.length === 0) return;
    void fetchPacificaMarketSetting({
      account,
      apiOrigin,
      maxLeverage: market.maxLeverage,
      signal,
      symbol: market.venueRef,
    }).then((setting) => {
      if (signal?.aborted !== true) remember(setting);
    // A failed read costs only speed: the next review reads the setting itself.
    }).catch(() => undefined);
  }, [account, apiOrigin, market.maxLeverage, market.venueRef, remember]);

  // Read as the ticket opens, for this identity and this market, so it is in hand by the time the reader
  // has typed an amount.
  useEffect(() => {
    cached.current = null;
    const abort = new AbortController();
    readSetting(abort.signal);
    return () => abort.abort();
  }, [readSetting]);

  const build = useCallback((args: {
    readonly draft: PacificaOrderDraft;
    readonly portfolio: PacificaPortfolioSnapshot | null;
    /** A recovery check has run for this identity and found nothing still in flight. */
    readonly recoveryClear: boolean;
    readonly snapshot: PacificaMarketSnapshot;
  }): PacificaOrderPlan | null => {
    const { draft, portfolio, snapshot } = args;
    const setting = cached.current;
    const now = Date.now();
    if (draft.action !== 'open' || !args.recoveryClear || portfolio === null) return null;
    if (now - portfolio.fetchedAtMs > PORTFOLIO_MAX_AGE_MS) return null;
    if (setting === null || setting.account !== account || setting.symbol !== market.venueRef) return null;
    if (now - setting.readAtMs > SETTING_MAX_AGE_MS) return null;

    const collateral = parseAmount(draft.collateral, 6).baseUnits;
    let available: bigint;
    try {
      available = parseAmount(portfolio.availableToSpend, 6).baseUnits;
    } catch {
      return null;
    }
    if (collateralShortfall(collateral, available) > 0n) return null;

    // The same inputs, field for field, as the full path hands `preparePacificaOrder`.
    return buildPacificaOrderPlan({
      action: draft.action,
      collateralBaseUnits: collateral,
      leverage: Number(draft.leverage),
      marginMode: draft.marginMode,
      market,
      orderPrice: draft.limitPrice,
      orderType: draft.orderType,
      portfolio,
      reviewedSetting: setting.setting,
      side: draft.side,
      snapshot,
      ...(draft.tpSlEnabled
        ? { stopLossPrice: draft.stopLoss, takeProfitPrice: draft.takeProfit }
        : {}),
      triggerPrice: draft.triggerPrice,
    });
  }, [account, market]);

  return {
    build,
    /** Re-reads the setting in the background: after an order, which may itself have changed it. */
    refreshSetting: readSetting,
    remember,
  };
}
