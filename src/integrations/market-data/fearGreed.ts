import { fetch } from 'expo/fetch';

export type FearGreedIndex = {
  readonly value: number;
  readonly classification: FearGreedClassification;
  readonly source: 'Alternative.me';
  readonly updatedAtMs: number;
};

export type FearGreedClassification =
  | 'Extreme Fear'
  | 'Fear'
  | 'Neutral'
  | 'Greed'
  | 'Extreme Greed';

const CLASSIFICATIONS: readonly string[] = [
  'Extreme Fear',
  'Fear',
  'Neutral',
  'Greed',
  'Extreme Greed',
];

export async function fetchFearGreedIndex(
  url: string,
  signal: AbortSignal,
): Promise<FearGreedIndex> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Fear and Greed request returned HTTP ${response.status}.`);
  }

  return parseFearGreedIndex(await response.json());
}

export function parseFearGreedIndex(value: unknown): FearGreedIndex {
  const root = record(value);
  const data = record(root.data);
  const score = data.value;
  const classification = data.value_classification;
  const updateTime = data.update_time;
  const source = root.source;
  const updatedAtMs = typeof updateTime === 'string' ? Date.parse(updateTime) : NaN;

  if (
    typeof score !== 'number' ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > 100 ||
    typeof classification !== 'string' ||
    !CLASSIFICATIONS.includes(classification) ||
    source !== 'Alternative.me' ||
    !Number.isFinite(updatedAtMs)
  ) {
    throw new Error('CoinMarketCap returned invalid Fear and Greed data.');
  }

  return {
    value: score,
    classification: classification as FearGreedClassification,
    source,
    updatedAtMs,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('CoinMarketCap returned an invalid response.');
  }

  return value as Record<string, unknown>;
}
