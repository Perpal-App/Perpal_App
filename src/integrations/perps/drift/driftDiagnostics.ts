const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gu;
const BASE58_PATTERN = /\b[1-9A-HJ-NP-Za-km-z]{32,88}\b/gu;
const LONG_HEX_PATTERN = /\b(?:0x)?[0-9a-fA-F]{64,}\b/gu;
const MAX_DIAGNOSTIC_LENGTH = 200;

/** Keeps local SDK errors useful without printing endpoints or key-like data. */
export function safeDriftDiagnosticMessage(cause: unknown): string | null {
  if (!(cause instanceof Error) || cause.message.length === 0) {
    return null;
  }

  return cause.message
    .replace(URL_PATTERN, '[url]')
    .replace(BASE58_PATTERN, '[base58]')
    .replace(LONG_HEX_PATTERN, '[hex]')
    .slice(0, MAX_DIAGNOSTIC_LENGTH);
}
