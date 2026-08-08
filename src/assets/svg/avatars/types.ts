/**
 * Every avatar takes only a size and fills a square.
 *
 * The source drawings share one 366.34 viewBox and are composed to be clipped to a circle, so
 * the caller owns the disc, its background and its rim — an avatar draws the figure and
 * nothing else.
 */
export type AvatarProps = {
  readonly size: number;
};
