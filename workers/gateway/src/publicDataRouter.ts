import type { WorkerEnv } from './env';
import { FEAR_GREED_PATH, handleFearGreedRequest } from './fearGreedHandler';
import {
  handleMarketBriefingRequest,
  MARKET_BRIEFING_PATH,
  type WorkerWaitUntilContext,
} from './marketBriefingHandler';
import { MARKET_DATA_PATH, MARKET_STREAM_PATH } from './marketData';
import { handlePublicMarketsRequest } from './publicMarketsHandler';

export type PublicDataResult = {
  readonly operation: string;
  readonly outcome: 'ok' | 'error' | 'rejected';
  readonly response: Response;
  readonly upstreamMs?: number;
};

export async function routePublicData(
  request: Request,
  env: WorkerEnv,
  context: WorkerWaitUntilContext,
  traceId: string,
): Promise<PublicDataResult | null> {
  const path = new URL(request.url).pathname;

  if (path === MARKET_DATA_PATH || path === MARKET_STREAM_PATH) {
    const result = await handlePublicMarketsRequest(request, env, traceId);
    return {
      ...result,
      operation: path === MARKET_STREAM_PATH ? 'markets.stream' : 'markets.read',
    };
  }

  if (path === FEAR_GREED_PATH) {
    return {
      ...await handleFearGreedRequest(request, env, traceId),
      operation: 'sentiment.fear_greed',
    };
  }

  if (path === MARKET_BRIEFING_PATH) {
    return {
      ...await handleMarketBriefingRequest(request, env, context, traceId),
      operation: 'markets.briefing',
    };
  }

  return null;
}
