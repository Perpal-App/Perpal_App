import { fetch } from 'expo/fetch';

export type NewsCategory = 'crypto' | 'perps' | 'us-crypto' | 'fed' | 'markets';

export type MarketNewsArticle = {
  readonly category: NewsCategory;
  readonly headline: string;
  readonly publishedAtMs: number;
  readonly source: string;
  readonly summary: string | null;
  readonly url: string;
};

export type MajorFinanceEvent = {
  readonly actual: string | null;
  readonly estimate: string | null;
  readonly event: string;
  readonly previous: string | null;
  readonly scheduledAtMs: number;
  readonly unit: string | null;
};

export type MarketBriefing = {
  readonly events: readonly MajorFinanceEvent[];
  readonly fetchedAtMs: number;
  readonly news: readonly MarketNewsArticle[];
  readonly source: string;
};

export async function fetchMarketBriefing(
  url: string,
  signal: AbortSignal,
): Promise<MarketBriefing> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Market briefing request returned HTTP ${response.status}.`);
  }

  return parseMarketBriefing(await response.json());
}

export function parseMarketBriefing(value: unknown): MarketBriefing {
  const root = record(value);
  const source = string(root.source, 80);
  const fetchedAtMs = number(root.fetchedAtMs);
  const news = array(root.news).map(parseArticle);
  const events = array(root.events).map(parseEvent);

  if (source === null || fetchedAtMs === null || news.length === 0) {
    throw new Error('Market briefing response is invalid.');
  }

  return { events, fetchedAtMs, news, source };
}

function parseArticle(value: unknown): MarketNewsArticle {
  const item = record(value);
  const category = item.category;
  const headline = string(item.headline, 240);
  const publishedAtMs = number(item.publishedAtMs);
  const source = string(item.source, 80);
  const summary = item.summary === null ? null : string(item.summary, 480);
  const url = httpsUrl(item.url);

  if (
    !['crypto', 'perps', 'us-crypto', 'fed', 'markets'].includes(
      typeof category === 'string' ? category : '',
    ) ||
    headline === null ||
    publishedAtMs === null ||
    source === null ||
    summary === undefined ||
    url === null
  ) {
    throw new Error('Market briefing contains an invalid news article.');
  }

  return {
    category: category as NewsCategory,
    headline,
    publishedAtMs,
    source,
    summary,
    url,
  };
}

function parseEvent(value: unknown): MajorFinanceEvent {
  const item = record(value);
  const event = string(item.event, 160);
  const scheduledAtMs = number(item.scheduledAtMs);
  const actual = nullableString(item.actual, 40);
  const estimate = nullableString(item.estimate, 40);
  const previous = nullableString(item.previous, 40);
  const unit = nullableString(item.unit, 24);

  if (
    event === null ||
    scheduledAtMs === null ||
    actual === undefined ||
    estimate === undefined ||
    previous === undefined ||
    unit === undefined
  ) {
    throw new Error('Market briefing contains an invalid finance event.');
  }

  return { actual, estimate, event, previous, scheduledAtMs, unit };
}

function nullableString(value: unknown, maxLength: number): string | null | undefined {
  return value === null ? null : string(value, maxLength) ?? undefined;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function string(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error('Market briefing array is missing.');
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Market briefing object is invalid.');
  }
  return value as Record<string, unknown>;
}
