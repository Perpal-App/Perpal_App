export type BriefingArticle = {
  readonly category: 'crypto' | 'perps' | 'us-crypto' | 'fed' | 'markets';
  readonly headline: string;
  readonly publishedAtMs: number;
  readonly source: string;
  readonly summary: string | null;
  readonly url: string;
};

export type BriefingEvent = {
  readonly actual: string | null;
  readonly estimate: string | null;
  readonly event: string;
  readonly previous: string | null;
  readonly scheduledAtMs: number;
  readonly unit: string | null;
};

export type MarketBriefing = {
  readonly events: readonly BriefingEvent[];
  readonly fetchedAtMs: number;
  readonly news: readonly BriefingArticle[];
  readonly source: string;
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

export function parsePublicMarketBriefing(
  cryptoRss: string,
  marketsRss: string,
  fedRss: string,
  calendar: unknown,
  nowMs: number,
): MarketBriefing {
  const news = [
    ...parseRssFeed(cryptoRss, 'crypto', 'CoinDesk'),
    ...parseRssFeed(marketsRss, 'markets', 'MarketWatch'),
    ...parseRssFeed(fedRss, 'fed', 'Federal Reserve'),
  ]
    .filter((article, index, all) =>
      all.findIndex((candidate) => candidate.url === article.url) === index)
    .sort((left, right) => right.publishedAtMs - left.publishedAtMs)
    .slice(0, 40);

  if (news.length === 0) {
    throw new Error('Public news feeds returned no valid articles.');
  }

  const root = record(calendar);
  const quality = record(root.data_quality);

  if (quality.is_official !== true || quality.is_stale === true) {
    throw new Error('The U.S. economic calendar is not current official data.');
  }

  const events = array(root.data)
    .flatMap((value) => {
      const item = record(value);
      const event = text(item.name, 160);
      const scheduledAtMs = unixTimeMs(item.announcement_datetime)
        ?? utcTime(item.announcement_datetime_utc);

      if (
        event === null ||
        scheduledAtMs === null ||
        scheduledAtMs < nowMs ||
        scheduledAtMs > nowMs + THIRTY_DAYS_MS ||
        item.event_importance !== 'high'
      ) {
        return [];
      }

      return [{
        actual: null,
        estimate: null,
        event,
        previous: null,
        scheduledAtMs,
        unit: null,
      } satisfies BriefingEvent];
    })
    .sort((left, right) => left.scheduledAtMs - right.scheduledAtMs)
    .slice(0, 30);

  return {
    events,
    fetchedAtMs: nowMs,
    news,
    source: 'CoinDesk · MarketWatch · Federal Reserve · FXMacroData',
  };
}

function parseRssFeed(
  xml: string,
  feed: 'crypto' | 'markets' | 'fed',
  source: string,
): BriefingArticle[] {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)].flatMap((match) => {
    const item = match[1] ?? '';
    const headline = element(item, 'title', 240);
    const publishedAtMs = utcTime(element(item, 'pubDate', 80));
    const url = httpsUrl(element(item, 'link', 2_048));

    if (headline === null || publishedAtMs === null || url === null) return [];

    const summary = element(item, 'description', 480);
    return [{
      category: classifyArticle(feed, `${headline} ${summary ?? ''}`),
      headline,
      publishedAtMs,
      source,
      summary,
      url,
    }];
  });
}

function classifyArticle(
  feed: 'crypto' | 'markets' | 'fed',
  value: string,
): BriefingArticle['category'] {
  if (feed === 'fed') return 'fed';

  const normalized = value.toLowerCase();

  if (feed === 'crypto') {
    if (/\b(perpetuals?|perps?|futures?|derivatives?)\b/u.test(normalized)) {
      return 'perps';
    }
    if (/\b(sec|cftc|congress|u\.s\.|united states)\b/u.test(normalized)) {
      return 'us-crypto';
    }
    return 'crypto';
  }

  return /\b(federal reserve|fomc|jerome powell|fed rate)\b/u.test(normalized)
    ? 'fed'
    : 'markets';
}

function element(xml: string, name: string, maxLength: number): string | null {
  const match = new RegExp(
    `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,
    'iu',
  ).exec(xml);

  if (match === null) return null;
  return text(decodeXml(match[1] ?? '').replace(/<[^>]+>/gu, ' '), maxLength);
}

function decodeXml(value: string): string {
  const raw = value.replace(/^\s*<!\[CDATA\[/u, '').replace(/\]\]>\s*$/u, '');
  return raw.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/giu, (_entity, code: string) => {
    const named: Readonly<Record<string, string>> = {
      amp: '&', apos: "'", gt: '>', lt: '<', quot: '"',
    };
    const normalized = code.toLowerCase();

    if (named[normalized] !== undefined) return named[normalized];

    const point = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
      ? String.fromCodePoint(point)
      : '';
  });
}

function unixTimeMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value * 1_000
    : null;
}

function utcTime(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.username.length === 0
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.replace(/\s+/gu, ' ').trim();
  return result.length > 0 && result.length <= maxLength ? result : null;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
