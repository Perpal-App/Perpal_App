/**
 * The rest of the tool set, registered onto the drawing layer.
 *
 * Concatenated after drawings.mjs and runs in the same closure, so it extends `TOOL_ANCHORS` and
 * `RENDERERS` in place and reuses that file's helpers — `stroke`, `dot`, `label`, `project`,
 * `pixels`, `priceText` — rather than restating them. It is a separate source only because the two
 * files together would blow the 500-line budget; there is no boundary between them at runtime.
 *
 * Everything registers before any message can arrive: the whole script block executes
 * synchronously, well before the first `postMessage` round trip lands.
 *
 * Keep this dependency-free ES2019 and free of template literals, the same constraint the other
 * two runtime sources carry, so the generator can nest it safely.
 */
export const EXTRA_TOOLS_RUNTIME = `
Object.assign(TOOL_ANCHORS, {
  crossline: 1,
  trendangle: 2,
  arc: 2,
  fibfan: 2,
  regression: 2,
  triangle: 3,
  fibext: 3,
  pitchfork: 3,
});

/** Fib ratios for the extension and the fan. Both read from the same ladder as the retracement. */
const FIB_EXTEND = [0, 0.618, 1, 1.618, 2.618];
const FIB_FAN = [0.236, 0.382, 0.5, 0.618, 0.786];

/** Least squares over the closes between two bars, for the regression channel. */
const fitLine = (fromLogical, toLogical) => {
  const first = Math.min(Math.max(Math.round(fromLogical), 0), rows.length - 1);
  const last = Math.min(Math.max(Math.round(toLogical), 0), rows.length - 1);
  const start = Math.min(first, last);
  const end = Math.max(first, last);
  const count = end - start + 1;
  if (rows.length === 0 || count < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let index = start; index <= end; index += 1) {
    const x = index - start;
    const y = rows[index].close;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const divisor = count * sumXX - sumX * sumX;
  if (divisor === 0) return null;
  const slope = (count * sumXY - sumX * sumY) / divisor;
  const intercept = (sumY - slope * sumX) / count;

  // Standard deviation of the residuals sets the channel width, which is what makes the band
  // describe the data rather than an arbitrary offset the user happened to drag.
  let squared = 0;
  for (let index = start; index <= end; index += 1) {
    const residual = rows[index].close - (intercept + slope * (index - start));
    squared += residual * residual;
  }

  return {
    start: start,
    end: end,
    slope: slope,
    intercept: intercept,
    deviation: Math.sqrt(squared / count),
  };
};

Object.assign(RENDERERS, {
  crossline: function (shape, a) {
    stroke({ x: 0, y: a.y }, { x: host.clientWidth, y: a.y });
    stroke({ x: a.x, y: 0 }, { x: a.x, y: host.clientHeight });
    label(priceText(shape.points[0].price), a.x + 6, a.y - 4);
  },

  trendangle: function (shape, a, b) {
    if (!b) { dot(a); return; }
    stroke(a, b);
    dot(a);
    dot(b);
    // Screen angle, not price-per-bar: it is the angle the trader sees, and it moves with the
    // zoom for the same reason a printed trendline does.
    const degrees = -Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    label(degrees.toFixed(1) + '\\u00b0', b.x + 6, b.y - 4);
  },

  arc: function (shape, a, b) {
    if (!b) { dot(a); return; }
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const radius = Math.sqrt(dx * dx + dy * dy) / 2;
    const angle = Math.atan2(dy, dx);
    context.beginPath();
    context.arc(midX, midY, radius, angle, angle + Math.PI);
    context.stroke();
    dot(a);
    dot(b);
  },

  triangle: function (shape, a, b, c) {
    if (!c) { stroke(a, b); dot(a); dot(b); return; }
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.lineTo(c.x, c.y);
    context.closePath();
    context.fillStyle = 'rgba(139, 92, 246, 0.10)';
    context.fill();
    context.stroke();
    dot(a);
    dot(b);
    dot(c);
  },

  fibfan: function (shape, a, b) {
    if (!b) { dot(a); return; }
    // Rays from the first anchor through fractions of the box the two anchors describe.
    for (const ratio of FIB_FAN) {
      const through = { x: a.x + (b.x - a.x), y: a.y + (b.y - a.y) * ratio };
      context.setLineDash([3, 3]);
      stroke(a, project(a, through, 4000));
      label(ratio.toFixed(3), through.x - 34, through.y - 4);
    }
    context.setLineDash([]);
    stroke(a, b);
    dot(a);
    dot(b);
  },

  fibext: function (shape, a, b, c) {
    if (!c) { stroke(a, b); dot(a); dot(b); return; }
    // The move is anchor one to two; the levels are projected from anchor three.
    const move = shape.points[1].price - shape.points[0].price;
    const base = shape.points[2].price;
    const left = Math.min(a.x, b.x, c.x);
    for (const ratio of FIB_EXTEND) {
      const price = base + move * ratio;
      const y = candles.priceToCoordinate(price);
      if (y === null) continue;
      context.setLineDash(ratio === 0 || ratio === 1 ? [] : [3, 3]);
      stroke({ x: left, y: y }, { x: host.clientWidth, y: y });
      label(ratio.toFixed(3) + '  ' + priceText(price), left + 4, y - 4);
    }
    context.setLineDash([]);
    stroke(a, b);
    stroke(b, c);
    dot(a);
    dot(b);
    dot(c);
  },

  pitchfork: function (shape, a, b, c) {
    if (!c) { stroke(a, b); dot(a); dot(b); return; }
    // Median from the first anchor through the midpoint of the other two, with a parallel
    // through each of them. Andrews' construction.
    const midX = (b.x + c.x) / 2;
    const midY = (b.y + c.y) / 2;
    const median = project(a, { x: midX, y: midY }, 4000);
    const dx = median.x - a.x;
    const dy = median.y - a.y;
    stroke(a, median);
    stroke({ x: b.x, y: b.y }, { x: b.x + dx, y: b.y + dy });
    stroke({ x: c.x, y: c.y }, { x: c.x + dx, y: c.y + dy });
    context.setLineDash([3, 3]);
    stroke(b, c);
    context.setLineDash([]);
    dot(a);
    dot(b);
    dot(c);
  },

  regression: function (shape, a, b) {
    if (!b) { dot(a); return; }
    const fit = fitLine(shape.points[0].logical, shape.points[1].logical);
    if (fit === null) { stroke(a, b); return; }

    const span = fit.end - fit.start;
    const priceAt = (offset) => fit.intercept + fit.slope * offset;
    const cornerAt = (offset, shift) => pixels({
      logical: fit.start + offset,
      price: priceAt(offset) + shift,
    });

    for (const shift of [0, fit.deviation, -fit.deviation]) {
      const from = cornerAt(0, shift);
      const to = cornerAt(span, shift);
      if (from === null || to === null) continue;
      context.setLineDash(shift === 0 ? [] : [3, 3]);
      stroke(from, to);
    }
    context.setLineDash([]);
    label(
      (fit.slope >= 0 ? 'up ' : 'down ') + priceText(Math.abs(fit.slope)) + '/bar',
      Math.min(a.x, b.x) + 4,
      Math.min(a.y, b.y) - 4,
      fit.slope >= 0 ? UP : DOWN,
    );
  },
});
`;
