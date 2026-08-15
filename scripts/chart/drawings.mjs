/**
 * Drawing layer for the chart WebView.
 *
 * Lightweight Charts ships no drawing tools — they belong to TradingView's
 * licensed Advanced Charts library — so every tool here is drawn on a canvas
 * over the chart. Anchors are stored as (logical bar index, price) rather than
 * pixels or timestamps: a logical index still resolves to a coordinate past the
 * last candle, so a shape keeps its place through pan, zoom and axis stretch.
 *
 * Runs in the same closure as runtime.mjs and uses `chart`, `candles`, `host`,
 * `overlay`, `rows` and `post` from it. `render` is a function declaration so the
 * runtime's gesture handlers can call it before this file's statements run.
 */
export const DRAWING_RUNTIME = `
// Anchor count per tool. 0 means freehand: collect points until the finger lifts.
const TOOL_ANCHORS = {
  hline: 1, hray: 1, vline: 1, plabel: 1,
  trend: 2, ray: 2, xline: 2, arrow: 2, rect: 2, ellipse: 2,
  fib: 2, measure: 2, prange: 2, drange: 2,
  channel: 3, long: 3, short: 3,
  brush: 0,
};
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const INK = '#8b5cf6';
const INK_ACTIVE = '#c4b5fd';
const UP = '#00d69d';
const DOWN = '#f04469';

const context = overlay.getContext('2d');
const shapes = [];
let tool = 'none';
let magnet = false;
let pending = null;
let frame = null;

const sizeOverlay = () => {
  const ratio = window.devicePixelRatio || 1;
  overlay.width = Math.floor(host.clientWidth * ratio);
  overlay.height = Math.floor(host.clientHeight * ratio);
  overlay.style.width = host.clientWidth + 'px';
  overlay.style.height = host.clientHeight + 'px';
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
};

const X = (point) => chart.timeScale().logicalToCoordinate(point.logical);
const Y = (point) => candles.priceToCoordinate(point.price);
const pixels = (point) => {
  const x = X(point);
  const y = Y(point);
  return x === null || y === null ? null : { x: x, y: y };
};

/** Snaps a price to the nearest open, high, low or close of the bar under it. */
const snap = (point) => {
  if (!magnet || rows.length === 0) return point;
  const index = Math.min(Math.max(Math.round(point.logical), 0), rows.length - 1);
  const row = rows[index];
  if (!row) return point;
  const nearest = [row.open, row.high, row.low, row.close].reduce(
    (best, value) => Math.abs(value - point.price) < Math.abs(best - point.price) ? value : best,
    row.close,
  );
  return { logical: point.logical, price: nearest };
};
/**
 * The host's box, captured once when a drawing gesture starts.
 *
 * \`getBoundingClientRect\` forces the browser to settle pending layout, and calling it for every
 * touchmove meant a synchronous layout read on every frame of every drag. The box cannot move
 * while a finger is down, so reading it once per gesture is both cheaper and no less correct.
 */
let dragRect = null;

const toPoint = (touch) => {
  const rect = dragRect || host.getBoundingClientRect();
  const logical = chart.timeScale().coordinateToLogical(touch.clientX - rect.left);
  const price = candles.coordinateToPrice(touch.clientY - rect.top);
  return logical === null || price === null ? null : snap({ logical: logical, price: price });
};

const priceText = (value) => Math.abs(value) >= 1
  ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  : value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
const signed = (value) => (value >= 0 ? '+' : '') + priceText(value);
const barCount = (a, b) => Math.round(Math.abs(b.logical - a.logical));
const duration = (a, b) => {
  const first = rows[Math.min(Math.max(Math.round(a.logical), 0), rows.length - 1)];
  const last = rows[Math.min(Math.max(Math.round(b.logical), 0), rows.length - 1)];
  if (!first || !last) return '';
  const minutes = Math.abs(last.time - first.time) / 60;
  if (minutes < 90) return Math.round(minutes) + 'm';
  if (minutes < 60 * 48) return (minutes / 60).toFixed(1) + 'h';
  return (minutes / 1440).toFixed(1) + 'd';
};

const label = (text, x, y, color) => {
  context.font = '11px system-ui, -apple-system, sans-serif';
  const width = context.measureText(text).width + 10;
  const left = Math.min(Math.max(x, 0), Math.max(host.clientWidth - width, 0));
  const top = Math.min(Math.max(y - 14, 0), Math.max(host.clientHeight - 18, 0));
  context.fillStyle = 'rgba(16, 17, 22, 0.92)';
  context.fillRect(left, top, width, 18);
  context.fillStyle = color || INK_ACTIVE;
  context.fillText(text, left + 5, top + 13);
};
const dot = (point) => {
  context.beginPath();
  context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
  context.fillStyle = INK_ACTIVE;
  context.fill();
};
const stroke = (from, to) => {
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
};
/** Projects a→b out to the canvas edge, for rays and extended lines. */
const project = (a, b, distance) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: b.x + (dx / length) * distance, y: b.y + (dy / length) * distance };
};
const box = (a, b, fill) => {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  if (fill) {
    context.fillStyle = fill;
    context.fillRect(left, top, width, height);
  }
  context.strokeRect(left, top, width, height);
  return { left: left, top: top, width: width, height: height };
};

const RENDERERS = {
  hline: (shape, a) => {
    stroke({ x: 0, y: a.y }, { x: host.clientWidth, y: a.y });
    label(priceText(shape.points[0].price), 4, a.y - 4);
  },
  hray: (shape, a) => {
    stroke(a, { x: host.clientWidth, y: a.y });
    dot(a);
    label(priceText(shape.points[0].price), a.x + 6, a.y - 4);
  },
  vline: (shape, a) => {
    stroke({ x: a.x, y: 0 }, { x: a.x, y: host.clientHeight });
  },
  plabel: (shape, a) => {
    dot(a);
    label(priceText(shape.points[0].price), a.x + 6, a.y - 4);
  },
  trend: (shape, a, b) => { stroke(a, b); dot(a); dot(b); },
  ray: (shape, a, b) => { stroke(a, project(a, b, 4000)); dot(a); dot(b); },
  xline: (shape, a, b) => { stroke(project(b, a, 4000), project(a, b, 4000)); dot(a); dot(b); },
  arrow: (shape, a, b) => {
    stroke(a, b);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const wing = 9;
    context.beginPath();
    context.moveTo(b.x, b.y);
    context.lineTo(b.x - wing * Math.cos(angle - 0.4), b.y - wing * Math.sin(angle - 0.4));
    context.moveTo(b.x, b.y);
    context.lineTo(b.x - wing * Math.cos(angle + 0.4), b.y - wing * Math.sin(angle + 0.4));
    context.stroke();
    dot(a);
  },
  rect: (shape, a, b) => { box(a, b, 'rgba(139, 92, 246, 0.12)'); },
  ellipse: (shape, a, b) => {
    context.beginPath();
    context.ellipse(
      (a.x + b.x) / 2, (a.y + b.y) / 2,
      Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2,
      0, 0, Math.PI * 2,
    );
    context.fillStyle = 'rgba(139, 92, 246, 0.10)';
    context.fill();
    context.stroke();
  },
  fib: (shape, a, b) => {
    const from = shape.points[0].price;
    const to = shape.points[1].price;
    const left = Math.min(a.x, b.x);
    for (const level of FIB_LEVELS) {
      const price = from + (to - from) * level;
      const y = candles.priceToCoordinate(price);
      if (y === null) continue;
      context.setLineDash(level === 0 || level === 1 ? [] : [3, 3]);
      stroke({ x: left, y: y }, { x: host.clientWidth, y: y });
      label(level.toFixed(3) + '  ' + priceText(price), left + 4, y - 4);
    }
    context.setLineDash([]);
    stroke(a, b);
  },
  measure: (shape, a, b) => {
    context.setLineDash([4, 3]);
    const shape2 = box(a, b, 'rgba(139, 92, 246, 0.10)');
    context.setLineDash([]);
    const move = shape.points[1].price - shape.points[0].price;
    const percent = shape.points[0].price === 0 ? 0 : (move / shape.points[0].price) * 100;
    label(
      signed(move) + '  ' + (percent >= 0 ? '+' : '') + percent.toFixed(2) + '%  '
        + barCount(shape.points[0], shape.points[1]) + ' bars  ' + duration(shape.points[0], shape.points[1]),
      shape2.left + 4, shape2.top - 4,
      move >= 0 ? UP : DOWN,
    );
  },
  prange: (shape, a, b) => {
    const shape2 = box(a, b, 'rgba(139, 92, 246, 0.10)');
    const move = shape.points[1].price - shape.points[0].price;
    const percent = shape.points[0].price === 0 ? 0 : (move / shape.points[0].price) * 100;
    label(signed(move) + '  ' + (percent >= 0 ? '+' : '') + percent.toFixed(2) + '%',
      shape2.left + 4, shape2.top - 4, move >= 0 ? UP : DOWN);
  },
  drange: (shape, a, b) => {
    const shape2 = box(a, b, 'rgba(139, 92, 246, 0.10)');
    label(barCount(shape.points[0], shape.points[1]) + ' bars  '
      + duration(shape.points[0], shape.points[1]), shape2.left + 4, shape2.top - 4);
  },
  channel: (shape, a, b, c) => {
    if (!c) { stroke(a, b); dot(a); dot(b); return; }
    // The third anchor sets the channel width as a price offset from the base.
    const base = shape.points[0];
    const end = shape.points[1];
    const span = end.logical - base.logical;
    const at = span === 0 ? base.price : base.price + (end.price - base.price) * ((shape.points[2].logical - base.logical) / span);
    const offset = shape.points[2].price - at;
    const a2 = pixels({ logical: base.logical, price: base.price + offset });
    const b2 = pixels({ logical: end.logical, price: end.price + offset });
    stroke(a, b);
    if (a2 && b2) {
      stroke(a2, b2);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.lineTo(b2.x, b2.y);
      context.lineTo(a2.x, a2.y);
      context.closePath();
      context.fillStyle = 'rgba(139, 92, 246, 0.10)';
      context.fill();
    }
    dot(a); dot(b);
  },
  long: (shape, a, b, c) => positionTool(shape, a, b, c, 'Long'),
  short: (shape, a, b, c) => positionTool(shape, a, b, c, 'Short'),
  brush: (shape) => {
    context.beginPath();
    let started = false;
    for (const point of shape.points) {
      const at = pixels(point);
      if (at === null) continue;
      if (started) context.lineTo(at.x, at.y);
      else { context.moveTo(at.x, at.y); started = true; }
    }
    context.stroke();
  },
};

/**
 * Entry, stop and target as two shaded blocks with the reward-to-risk ratio.
 * Both directions share this renderer: the profit block is always the target
 * side of entry and the risk block the stop side, so it reads correctly whether
 * the target sits above or below.
 */
function positionTool(shape, a, b, c, name) {
  if (!c) { stroke(a, b); dot(a); dot(b); return; }
  const entry = shape.points[0];
  const stop = shape.points[1];
  const target = shape.points[2];
  const right = Math.max(a.x, b.x, c.x) + 24;
  const stopAt = pixels({ logical: entry.logical, price: stop.price });
  const targetAt = pixels({ logical: entry.logical, price: target.price });
  if (stopAt === null || targetAt === null) return;

  context.fillStyle = 'rgba(0, 214, 157, 0.16)';
  context.fillRect(a.x, Math.min(a.y, targetAt.y), right - a.x, Math.abs(targetAt.y - a.y));
  context.fillStyle = 'rgba(240, 68, 105, 0.16)';
  context.fillRect(a.x, Math.min(a.y, stopAt.y), right - a.x, Math.abs(stopAt.y - a.y));
  stroke({ x: a.x, y: a.y }, { x: right, y: a.y });

  const risk = Math.abs(entry.price - stop.price);
  const reward = Math.abs(target.price - entry.price);
  label(
    name + '  ' + priceText(entry.price) + '  R:R ' + (risk === 0 ? '—' : (reward / risk).toFixed(2)),
    a.x + 4, Math.min(a.y, targetAt.y) - 4,
  );
}

const drawShape = (shape, active) => {
  const renderer = RENDERERS[shape.kind];
  if (!renderer) return;
  const spots = shape.points.map(pixels);
  if (spots.length === 0 || spots[0] === null) return;
  context.lineWidth = 1.5;
  context.strokeStyle = active ? INK_ACTIVE : INK;
  context.setLineDash([]);
  renderer(shape, spots[0], spots[1] || null, spots[2] || null);
  context.setLineDash([]);
};

function render() {
  if (!context) return;
  context.clearRect(0, 0, host.clientWidth, host.clientHeight);
  for (const shape of shapes) drawShape(shape, false);
  if (pending !== null) drawShape(pending, true);
}
/**
 * A fingerprint of the mapping from data to pixels: the prices at the top and bottom of the
 * viewport, the visible logical range, and the canvas size. If none of those moved, every shape
 * would redraw to exactly the same pixels.
 *
 * This exists because the price scale emits no change event, so there is no way to be told that a
 * shape needs repainting — the only options are to poll or to be wrong. Polling a six-number
 * comparison is orders of magnitude cheaper than clearing the canvas and re-projecting every
 * anchor, which is what the previous version did unconditionally.
 */
const projection = () => {
  const range = chart.timeScale().getVisibleLogicalRange();
  return [
    candles.coordinateToPrice(0),
    candles.coordinateToPrice(host.clientHeight),
    range === null ? 0 : range.from,
    range === null ? 0 : range.to,
    host.clientWidth,
    host.clientHeight,
  ].join(',');
};

/**
 * Frames of stillness before the watcher stops. Half a second at 60Hz — long enough to cover an
 * autoscale settling after the last gesture event, short enough that an idle chart costs nothing.
 */
const IDLE_FRAMES = 30;
let signature = '';
let idle = 0;

/**
 * Watches for the projection moving under the shapes, and stops once it has been still.
 *
 * The previous loop was the single worst thing on this screen: it re-entered
 * \`requestAnimationFrame\` for as long as a single shape existed, so drawing one trend line put
 * the WebView into a permanent 60fps clear-and-repaint of the whole canvas — for the life of the
 * screen, whether or not anything had changed. That is the jitter and the battery drain.
 */
const step = () => {
  const next = projection();

  if (next !== signature) {
    signature = next;
    idle = 0;
    render();
  } else if (pending === null && gesture === null) {
    idle += 1;
  }

  frame = idle < IDLE_FRAMES && (shapes.length > 0 || pending !== null)
    ? requestAnimationFrame(step)
    : null;
};

/** Paints now, and puts the watcher back to work if there is anything left for it to watch. */
const wake = () => {
  idle = 0;
  signature = projection();
  render();

  if (frame === null && (shapes.length > 0 || pending !== null)) {
    frame = requestAnimationFrame(step);
  }
};
const syncOverlay = () => {
  overlay.style.pointerEvents = tool === 'none' ? 'none' : 'auto';
};
const finish = () => {
  if (pending === null) return;
  shapes.push(pending);
  pending = null;
  tool = 'none';
  syncOverlay();
  wake();
  post({ type: 'tool_done', shapes: shapes.length });
};

overlay.addEventListener('touchstart', (event) => {
  if (tool === 'none' || event.touches.length !== 1) return;
  dragRect = host.getBoundingClientRect();
  const point = toPoint(event.touches[0]);
  if (point === null) return;
  const needed = TOOL_ANCHORS[tool] || 0;
  if (pending === null) {
    pending = { kind: tool, points: needed >= 2 ? [point, point] : [point] };
  } else {
    pending.points.push(point);
  }
  wake();
  event.preventDefault();
}, { passive: false });

overlay.addEventListener('touchmove', (event) => {
  if (pending === null || event.touches.length !== 1) return;
  const point = toPoint(event.touches[0]);
  if (point === null) return;
  if (pending.kind === 'brush') pending.points.push(point);
  else pending.points[pending.points.length - 1] = point;
  // Paints on the same frame as the move. The watcher only notices the projection changing, and
  // dragging an anchor does not move it — the shape has to ask for this one itself.
  wake();
  event.preventDefault();
}, { passive: false });

overlay.addEventListener('touchend', (event) => {
  dragRect = null;
  if (pending === null) return;
  const needed = TOOL_ANCHORS[pending.kind] || 0;
  if (needed === 0 || pending.points.length >= needed) finish();
  event.preventDefault();
}, { passive: false });

overlay.addEventListener('touchcancel', () => {
  // A cancelled touch must not leave a half-built shape armed, or the next tap continues it.
  dragRect = null;
  pending = null;
  wake();
});

/** Returns true when the message belonged to the drawing layer. */
function handleDrawingMessage(message) {
  if (message.type === 'set_tool') {
    tool = message.tool;
    pending = null;
    syncOverlay();
    wake();
    return true;
  }
  if (message.type === 'set_magnet') {
    magnet = message.magnet === true;
    return true;
  }
  if (message.type === 'undo_drawing') {
    pending = null;
    shapes.pop();
    wake();
    return true;
  }
  if (message.type === 'clear_drawings') {
    pending = null;
    shapes.length = 0;
    wake();
    return true;
  }
  return false;
}

new ResizeObserver(() => { sizeOverlay(); wake(); }).observe(host);
sizeOverlay();
window.addEventListener('message', receive);
document.addEventListener('message', receive);
post({ type: 'ready' });
`;
