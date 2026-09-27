import { readAppConfig } from '@/config/appConfig';
import type { Amount } from '@/domain/money/amount';
import { unrealizedPnl } from '@/domain/portfolio/accountFigures';
import { positionFigures, totalPositionFigures } from '@/domain/portfolio/positionFigures';
import { useLivePositions } from '@/features/trade/public';
import type {
  PacificaPortfolioSnapshot,
  PacificaPosition,
} from '@/integrations/perps/pacifica/pacificaPortfolio';

const NO_POSITIONS: readonly PacificaPosition[] = [];

export type LiveUnrealized = {
  /** Worked out from the live mark, as every position card is. `false` while the account snapshot stands in. */
  readonly live: boolean;
  readonly pnl: Amount | null;
  /**
   * The rate each card shows, taken over all of them: return on the margin behind the positions, or the
   * price move where the margin is not known. `null` while the snapshot stands in.
   */
  readonly positionRateBps: number | null;
};

/**
 * The account's unrealized profit and loss, as the sum of its position cards.
 *
 * It used to be the account snapshot's equity less its deposited balance. That snapshot is read every few
 * seconds — and can be served from a cache older than that — at whatever mark the venue had then, while
 * each card is valued from the mark as it streams. So the headline trailed the cards it sits above and,
 * between reads, disagreed with them. It is now the cards' own figures: the same positions, the same live
 * mark, the same leverage, added up exactly before a cent is rounded, so the two cannot differ.
 *
 * Until every position has a live mark it falls back to the snapshot's figure, which is the venue's own and
 * the best there is, rather than to a blank.
 */
export function useLiveUnrealized(portfolio: PacificaPortfolioSnapshot | null): LiveUnrealized {
  const config = readAppConfig();
  const perps = config.ok ? config.value.perps : null;
  const positions = portfolio === null ? NO_POSITIONS : portfolio.positions;
  const live = useLivePositions({
    apiOrigin: perps?.pacificaApiOrigin ?? '',
    assetOrigin: perps?.pacificaAssetOrigin ?? '',
    positions,
    wsOrigin: perps?.pacificaWsOrigin ?? '',
  });

  if (portfolio === null) return { live: false, pnl: null, positionRateBps: null };

  const total = totalPositionFigures(positions.map((position) => {
    const facts = live(position);
    return positionFigures(position, facts.snapshot?.price ?? null, facts.leverage);
  }));
  if (total === null) return { live: false, pnl: unrealizedPnl(portfolio), positionRateBps: null };
  return { live: true, pnl: total.unrealizedPnl, positionRateBps: total.roeBps ?? total.pnlBps };
}
