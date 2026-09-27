/**
 * Position lines for the chart WebView.
 *
 * Each of the account's open positions on the market, drawn as a dashed line at
 * its entry with the entry on the price axis, and at the line's right end a tag:
 * the side and size, the live unrealized profit or loss on a badge filled green
 * or red by its direction, and a close control. The app sends the figures
 * already formatted, to the cent; nothing here values a position.
 *
 * Drawn by a series primitive, so the lines are painted in the library's own
 * render pass and stay on the price scale through every pan, pinch and
 * autoscale without a watcher of their own. The close control is hit-tested,
 * on the chart's own click, against where it was last painted, and a hit only
 * asks: the app confirms with the reader before anything is sent.
 *
 * Runs in the same closure as runtime.mjs and uses `chart`, `candles` and
 * `post` from it. Keep it ES2019, and free of template literals and
 * backslashes, which the generator's own template would interpret.
 */
export const POSITIONS_RUNTIME = `
const TAG_FONT = '600 11px -apple-system, system-ui, sans-serif';
const BADGE_FONT = '700 11px -apple-system, system-ui, sans-serif';
const TAG_HEIGHT = 24;
const TAG_PAD = 8;
const TAG_SPACE = 6;
// The profit and loss on a pill of its own inside the tag, filled in its direction's colour.
const BADGE_HEIGHT = 18;
const BADGE_PAD = 6;
const BADGE_GAP = 4;
// Clear of the price axis and of the band beside it that the axis drag claims, so a tap on the close
// control reaches the chart rather than starting a scale gesture.
const TAG_RIGHT = 14;
const TAG_INSET = 4;
const CLOSE_WIDTH = 26;
const CLOSE_ARM = 3.5;
// Beyond the control's own box, within which a tap still counts: the box is a mark, not a target.
const CLOSE_SLOP_X = 6;
const CLOSE_SLOP_Y = 10;
const LONG_INK = '#4ade80';
const SHORT_INK = '#ef6262';
const TAG_FILL = '#101116';
const TAG_RIM = '#292a35';
const TAG_TEXT = '#ffffff';
const TAG_MUTED = '#8b8798';
// Near-black on the green and the red alike: it reads on both, where white on the red did not.
const INK_ON_FILL = '#07060b';

let positionLines = [];
let positionHost = candles;
let positionAxisViews = [];
let requestPositionsPaint = null;
/** Where each close control was last painted, in pane pixels: what a tap is tested against. */
let closeTargets = [];

const sideInk = (item) => item.side === 'long' ? LONG_INK : SHORT_INK;
/** Green for a profit, red for a loss; a flat or unknown figure is neither. */
const badgeFill = (item) => item.tone === 'positive' ? LONG_INK : item.tone === 'negative' ? SHORT_INK : TAG_RIM;
const badgeInk = (item) => item.tone === 'plain' ? TAG_TEXT : INK_ON_FILL;

const roundedRect = (context, x, y, width, height, radius) => {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
};

const paintPositions = (scope) => {
  const context = scope.context;
  const width = scope.mediaSize.width;
  const height = scope.mediaSize.height;
  const targets = [];
  context.save();
  context.font = TAG_FONT;
  context.textBaseline = 'middle';
  for (let index = 0; index < positionLines.length; index += 1) {
    const item = positionLines[index];
    const y = positionHost.priceToCoordinate(item.price);
    if (y === null) continue;
    const ink = sideInk(item);

    // The line itself, only while its price is in view.
    if (y >= 0 && y <= height) {
      context.globalAlpha = 0.85;
      context.strokeStyle = ink;
      context.lineWidth = 1;
      context.setLineDash([6, 4]);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;
    }

    // The tag stays on the canvas when the entry is scrolled out of range, pinned to the nearer edge,
    // so the position and its close control are never lost off the top or the bottom. Laid out from
    // the right, so the close control holds still while the figures change width.
    const half = TAG_HEIGHT / 2;
    const middle = Math.min(Math.max(y, half + TAG_INSET), height - half - TAG_INSET);
    const top = middle - half;
    context.font = BADGE_FONT;
    const badgeWidth = context.measureText(item.pnl).width + BADGE_PAD * 2;
    context.font = TAG_FONT;
    const titleWidth = context.measureText(item.title).width;
    const right = width - TAG_RIGHT;
    const closeLeft = right - CLOSE_WIDTH;
    const badgeLeft = closeLeft - BADGE_GAP - badgeWidth;
    const titleLeft = badgeLeft - TAG_SPACE - titleWidth;
    const left = titleLeft - TAG_PAD;

    roundedRect(context, left, top, right - left, TAG_HEIGHT, 6);
    context.fillStyle = TAG_FILL;
    context.fill();
    context.strokeStyle = ink;
    context.lineWidth = 1;
    context.stroke();

    context.textAlign = 'left';
    context.fillStyle = ink;
    context.fillText(item.title, titleLeft, middle);

    roundedRect(context, badgeLeft, middle - BADGE_HEIGHT / 2, badgeWidth, BADGE_HEIGHT, BADGE_HEIGHT / 2);
    context.fillStyle = badgeFill(item);
    context.fill();
    context.font = BADGE_FONT;
    context.textAlign = 'center';
    context.fillStyle = badgeInk(item);
    context.fillText(item.pnl, badgeLeft + badgeWidth / 2, middle);

    context.strokeStyle = TAG_RIM;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(closeLeft, top + 5);
    context.lineTo(closeLeft, top + TAG_HEIGHT - 5);
    context.stroke();

    // Drawn as two strokes rather than set as a glyph, so it is the same mark in every font. Dimmed
    // while a close is already under way, when a tap on it does nothing.
    const centre = closeLeft + CLOSE_WIDTH / 2;
    context.strokeStyle = item.closing ? TAG_MUTED : TAG_TEXT;
    context.lineWidth = 1.5;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(centre - CLOSE_ARM, middle - CLOSE_ARM);
    context.lineTo(centre + CLOSE_ARM, middle + CLOSE_ARM);
    context.moveTo(centre + CLOSE_ARM, middle - CLOSE_ARM);
    context.lineTo(centre - CLOSE_ARM, middle + CLOSE_ARM);
    context.stroke();

    targets.push({
      bottom: top + TAG_HEIGHT,
      closing: item.closing === true,
      id: item.id,
      left: closeLeft,
      right: right,
      top: top,
    });
  }
  context.restore();
  closeTargets = targets;
};

const positionRenderer = { draw: (target) => target.useMediaCoordinateSpace(paintPositions) };
const positionPaneViews = [{ renderer: () => positionRenderer, zOrder: () => 'top' }];

const axisViewFor = (item) => ({
  coordinate: () => {
    const y = positionHost.priceToCoordinate(item.price);
    return y === null ? -1000 : y;
  },
  text: () => positionHost.priceFormatter().format(item.price),
  textColor: () => INK_ON_FILL,
  backColor: () => sideInk(item),
  visible: () => positionHost.priceToCoordinate(item.price) !== null,
});

const positionLayer = {
  attached: (param) => { requestPositionsPaint = param.requestUpdate; },
  detached: () => { requestPositionsPaint = null; },
  paneViews: () => positionPaneViews,
  priceAxisViews: () => positionAxisViews,
};

const validLine = (item) => item !== null && typeof item === 'object'
  && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.pnl === 'string'
  && typeof item.price === 'number' && isFinite(item.price) && item.price > 0;

const setPositions = (lines) => {
  positionLines = Array.isArray(lines) ? lines.filter(validLine) : [];
  positionAxisViews = positionLines.map(axisViewFor);
  if (positionLines.length === 0) closeTargets = [];
  if (requestPositionsPaint !== null) requestPositionsPaint();
};

const showPositionsOn = (series) => {
  if (series === positionHost) return;
  positionHost.detachPrimitive(positionLayer);
  positionHost = series;
  positionHost.attachPrimitive(positionLayer);
};

candles.attachPrimitive(positionLayer);

// A tap arrives as the chart's own click. Only a hit on a close control means anything, and all it does
// is ask the app, which confirms with the reader before a close is sent.
chart.subscribeClick((param) => {
  if (!param.point) return;
  const x = param.point.x;
  const y = param.point.y;
  for (let index = 0; index < closeTargets.length; index += 1) {
    const target = closeTargets[index];
    const hit = x >= target.left - CLOSE_SLOP_X && x <= target.right + CLOSE_SLOP_X
      && y >= target.top - CLOSE_SLOP_Y && y <= target.bottom + CLOSE_SLOP_Y;
    if (hit) {
      // With the control's centre, so the app's confirmation can grow out of the very mark tapped.
      if (!target.closing) {
        post({
          type: 'close_position',
          id: target.id,
          x: (target.left + target.right) / 2,
          y: (target.top + target.bottom) / 2,
        });
      }
      return;
    }
  }
});
`;
