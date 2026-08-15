/**
 * Experience and levels.
 *
 * A flat curve — every level costs the same — rather than an escalating one. An escalating
 * curve is a retention device: it makes the tenth level feel earned by making it slow, which
 * is a reasonable thing for a game to do and a dishonest thing for a trading app to do with a
 * reader's study time. Ten lessons is ten lessons at any level.
 *
 * Pure, and separate from where the total is stored, so the curve can change without a
 * migration: only the total is persisted and the level is always derived from it.
 */
export const XP_PER_LEVEL = 100;

/** The first level, held by a reader with no experience at all. There is no level zero. */
export const FIRST_LEVEL = 1;

export type LearningLevel = {
  readonly level: number;
  /** Experience earned inside the current level, from 0 up to `XP_PER_LEVEL`. */
  readonly xpIntoLevel: number;
  /** Experience still needed to reach the next level. Never zero. */
  readonly xpToNextLevel: number;
  /** Share of the current level completed, 0 to 1, for a progress track. */
  readonly progress: number;
};

/**
 * The level a total of experience buys, and where it sits inside that level.
 *
 * Defensive about its input because the total comes off disk: a negative, fractional, or
 * non-finite value is floored to no experience rather than producing a fractional level or a
 * progress track that runs backwards.
 */
export function levelFromXp(xp: number): LearningLevel {
  const total = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  const xpIntoLevel = total % XP_PER_LEVEL;

  return {
    level: FIRST_LEVEL + Math.floor(total / XP_PER_LEVEL),
    xpIntoLevel,
    xpToNextLevel: XP_PER_LEVEL - xpIntoLevel,
    progress: xpIntoLevel / XP_PER_LEVEL,
  };
}

/**
 * Experience as it is written next to a figure.
 *
 * Grouped with the reader's locale separator, because a five-figure total is otherwise a run
 * of digits, and left as a bare number without the unit — the label beside it carries that.
 */
export function formatXp(xp: number): string {
  const total = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  return new Intl.NumberFormat().format(total);
}
