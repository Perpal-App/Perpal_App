import { fetch } from 'expo/fetch';

export type FearGreedIndex = {
  readonly value: number;
  readonly classification: string;
  readonly updatedAtMs: number;
};

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
  const updatedAtMs = typeof updateTime === 'string' ? Date.parse(updateTime) : NaN;

  if (
    typeof score !== 'number' ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > 100 ||
    typeof classification !== 'string' ||
    classification.trim().length === 0 ||
    classification.length > 32 ||
    !Number.isFinite(updatedAtMs)
  ) {
    throw new Error('CoinMarketCap returned invalid Fear and Greed data.');
  }

  return {
    value: score,
    classification: classification.trim(),
    updatedAtMs,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('CoinMarketCap returned an invalid response.');
  }

  return value as Record<string, unknown>;
}
