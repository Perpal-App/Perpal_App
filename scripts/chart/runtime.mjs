/**
 * Chart runtime: series, legend, indicators and every scale gesture.
 *
 * Exported as a string because it runs inside the chart WebView, not in the app
 * bundle. Keep it dependency-free ES2019 and avoid template literals so the
 * assembling generator can nest it safely.
 *
 * Scale gestures are handled here rather than left to Lightweight Charts. The
 * library's own axis handling assumes a mouse and, more importantly, it fights
 * the price range this file feeds back through `autoscaleInfoProvider`: every
 * autoscale pass would overwrite a drag. Owning the touch stream keeps pinch and
 * axis drag driving one piece of state.
 */
export const CHART_RUNTIME = `
const TV = window.LightweightCharts;
const host = document.getElementById('chart');
const legend = document.getElementById('legend');
const scaleBadge = document.getElementById('scale');
const post = (payload) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));

const chart = TV.createChart(host, {
  autoSize: true,
  layout: {
    attributionLogo: true,
    background: { type: TV.ColorType.Solid, color: '#07060b' },
    textColor: '#8b8798',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  // Price rules only. Levels are what the eye reads across a chart; the vertical rules were noise
  // between the candles.
  grid: { vertLines: { visible: false }, horzLines: { color: '#171820' } },
  crosshair: {
    mode: TV.CrosshairMode.Normal,
    vertLine: { color: '#8b5cf6', labelBackgroundColor: '#8b5cf6' },
    horzLine: { color: '#8b5cf6', labelBackgroundColor: '#8b5cf6' },
  },
  rightPriceScale: { borderColor: '#292a35', scaleMargins: { top: 0.14, bottom: 0.08 } },
  timeScale: {
    borderColor: '#292a35', timeVisible: true, secondsVisible: false,
    rightOffset: 4, barSpacing: 8, minBarSpacing: 2,
  },
  handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  // Axis drags are implemented below; the library only keeps the horizontal
  // two-finger pinch, which it does well.
  handleScale: { axisPressedMouseMove: false, mouseWheel: true, pinch: true },
});

/**
 * Manual price range, or null while the chart autoscales. Lightweight Charts
 * has no setter for a visible price range, so the range is fed back through
 * each series' autoscale hook and re-requested by toggling autoScale.
 */
let priceOverride = null;
const overrideRange = (original) => priceOverride === null
  ? original()
  : { priceRange: { minValue: priceOverride.min, maxValue: priceOverride.max } };

const candles = chart.addSeries(TV.CandlestickSeries, {
  upColor: '#00d69d', downColor: '#f04469', borderVisible: false,
  wickUpColor: '#00d69d', wickDownColor: '#f04469', priceLineVisible: true,
  autoscaleInfoProvider: overrideRange,
});
const line = chart.addSeries(TV.LineSeries, {
  color: '#8b5cf6', lineWidth: 2, visible: false, priceLineVisible: true,
  autoscaleInfoProvider: overrideRange,
});
// The indicators take the manual range too. Left out, a visible average pulled the range back open
// on every autoscale pass, and a stretched axis sprang back the moment one was switched on.
const sma = chart.addSeries(TV.LineSeries, {
  color: '#f5c451', lineWidth: 2, visible: false, priceLineVisible: false,
  autoscaleInfoProvider: overrideRange,
});
const ema = chart.addSeries(TV.LineSeries, {
  color: '#58a6ff', lineWidth: 2, visible: false, priceLineVisible: false,
  autoscaleInfoProvider: overrideRange,
});

/**
 * Prices at the market's own tick. The library's default is two decimals, which drew a 0.0708 market's
 * axis, its last price and any entry on it as "0.07".
 */
let priceFormatKey = '';
const applyPriceFormat = (format) => {
  if (!format || typeof format.precision !== 'number' || !(format.minMove > 0)) return;
  const key = format.precision + ':' + format.minMove;
  if (key === priceFormatKey) return;
  priceFormatKey = key;
  const priceFormat = { type: 'price', precision: format.precision, minMove: format.minMove };
  [candles, line, sma, ema].forEach((series) => series.applyOptions({ priceFormat: priceFormat }));
};

let badgeShown = false;
const rescale = () => {
  // Written only when it changes: a gesture calls this every frame, and a style write every frame is a
  // layout the drag does not need.
  const manual = priceOverride !== null;
  if (manual !== badgeShown) {
    badgeShown = manual;
    scaleBadge.style.display = manual ? 'block' : 'none';
  }
  chart.priceScale('right').applyOptions({ autoScale: true });
};
/** The pane's own height: the host's, less the time axis under it. */
const paneHeight = () => Math.max(host.clientHeight - chart.timeScale().height(), 1);
/** The prices at the top and the bottom of the pane as it is drawn now, or null before there is data. */
const visibleRange = () => {
  const top = candles.coordinateToPrice(0);
  const bottom = candles.coordinateToPrice(paneHeight());
  return top === null || bottom === null || top <= bottom ? null : { min: bottom, max: top };
};
/**
 * What to hand autoscale so the pane shows exactly this view. The price scale pads whatever autoscale
 * returns by its margins, so they come off first. Fed back as it was, every gesture began by zooming out
 * by the margins, and that was the jump the moment a finger landed.
 */
const toAutoscale = (view) => {
  const margins = chart.priceScale('right').options().scaleMargins;
  const span = view.max - view.min;
  return { min: view.min + span * margins.bottom, max: view.max - span * margins.top };
};
const clampSpan = (span, anchor) => Math.max(span, Math.abs(anchor) * 1e-6 + 1e-9);
/**
 * The starting view scaled by a factor about a fixed price: the one a given ratio down the pane, 0 at the
 * top and 1 at the bottom, stays under the finger.
 */
const scaledView = (start, factor, ratio) => {
  const anchor = start.max - (start.max - start.min) * ratio;
  const span = clampSpan((start.max - start.min) * factor, anchor);
  return { max: anchor + span * ratio, min: anchor - span * (1 - ratio) };
};
const showView = (view) => {
  priceOverride = toAutoscale(view);
  rescale();
};

// ---- gesture plumbing ------------------------------------------------------
// One handler set decides, on touchstart, which of four gestures is in play:
// price-axis stretch, time-axis stretch, vertical pinch (price) or nothing,
// in which case the touch falls through to the library for pan and time pinch.
//
// Every gesture works from the view as it stood when the fingers landed and
// scales it by an exponential of the distance travelled: a drag up exactly
// undoes the same drag down, and no stretch runs away near the end of the
// axis, which a linear factor did. Updates land once per frame, however fast
// the touches arrive, so the chart redraws at the display's pace.
const AXIS_GRAB = 8;
/** How far a drag the length of the axis scales: e to the 2.4, about elevenfold. */
const AXIS_GAIN = 2.4;
let gesture = null;
let queued = null;
let frame = 0;

const schedule = (apply) => {
  queued = apply;
  if (frame !== 0) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const next = queued;
    queued = null;
    if (next !== null) next();
  });
};
const localPoint = (touch, rect) => ({ x: touch.clientX - rect.left, y: touch.clientY - rect.top });
const spread = (touches) => ({
  dx: Math.abs(touches[0].clientX - touches[1].clientX),
  dy: Math.abs(touches[0].clientY - touches[1].clientY),
  centerY: (touches[0].clientY + touches[1].clientY) / 2,
});
const onPriceAxis = (point, rect) => point.x >= rect.width - chart.priceScale('right').width() - AXIS_GRAB;
const onTimeAxis = (point, rect) => point.y >= rect.height - chart.timeScale().height() - AXIS_GRAB;

host.addEventListener('touchstart', (event) => {
  // The box is read once per gesture: it cannot move while a finger is down, and reading it on every
  // move forced a layout on every frame of the drag.
  const rect = host.getBoundingClientRect();

  if (event.touches.length === 2) {
    const reading = spread(event.touches);
    if (reading.dy <= reading.dx) return;
    const view = visibleRange();
    if (view === null) return;
    const height = paneHeight();
    gesture = {
      kind: 'pinch',
      distance: Math.max(reading.dy, 1),
      ratio: Math.min(Math.max((reading.centerY - rect.top) / height, 0), 1),
      view: view,
    };
    event.stopPropagation();
    return;
  }

  if (event.touches.length !== 1) return;
  const point = localPoint(event.touches[0], rect);

  if (onPriceAxis(point, rect)) {
    const view = visibleRange();
    if (view === null) return;
    gesture = { kind: 'priceAxis', height: paneHeight(), rect: rect, startY: point.y, view: view };
    event.stopPropagation();
    event.preventDefault();
    return;
  }

  if (onTimeAxis(point, rect)) {
    gesture = {
      kind: 'timeAxis',
      barSpacing: chart.timeScale().options().barSpacing,
      rect: rect,
      startX: point.x,
    };
    event.stopPropagation();
    event.preventDefault();
  }
}, { capture: true, passive: false });

host.addEventListener('touchmove', (event) => {
  if (gesture === null) return;
  const current = gesture;

  if (current.kind === 'pinch') {
    if (event.touches.length !== 2) return;
    // Fingers apart shrinks the span, which is a zoom in, about the price between them.
    const factor = Math.min(Math.max(current.distance / Math.max(spread(event.touches).dy, 1), 0.02), 50);
    schedule(() => showView(scaledView(current.view, factor, current.ratio)));
  } else if (current.kind === 'priceAxis') {
    // Down stretches the axis open, TradingView's direction, so the candles compress toward the middle.
    const travel = (localPoint(event.touches[0], current.rect).y - current.startY) / current.height;
    const factor = Math.exp(travel * AXIS_GAIN);
    schedule(() => showView(scaledView(current.view, factor, 0.5)));
  } else {
    // Right widens the bars. The library holds the newest bar where it is while the spacing changes.
    const travel = (localPoint(event.touches[0], current.rect).x - current.startX) / Math.max(current.rect.width, 1);
    const spacing = Math.min(Math.max(current.barSpacing * Math.exp(travel * AXIS_GAIN), 2), 120);
    schedule(() => chart.timeScale().applyOptions({ barSpacing: spacing }));
  }

  event.preventDefault();
  event.stopPropagation();
}, { capture: true, passive: false });

const endGesture = (event) => {
  if (gesture === null) return;
  if (gesture.kind === 'pinch' ? event.touches.length < 2 : event.touches.length === 0) gesture = null;
};
host.addEventListener('touchend', endGesture, { capture: true });
host.addEventListener('touchcancel', endGesture, { capture: true });

// ---- data + indicators -----------------------------------------------------
let rows = [];
let symbol = '';
let timeframe = '';

/**
 * Legend precision, scaled to the size of the number.
 *
 * Four decimals on a four-figure price is noise that costs a whole line: ETH printed as
 * "1,913.7849" four times wrapped the OHLC row onto a third line and pushed the legend over the
 * candles. Two decimals past a hundred says everything the eye needs; small-cap prices keep their
 * significant digits, where the decimals are the only thing distinguishing one bar from the next.
 */
const format = (value) => {
  if (value >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return value.toLocaleString(undefined, { maximumSignificantDigits: 5 });
};
const movingAverage = (values, period, exponential) => {
  if (values.length < period) return [];
  if (!exponential) {
    let total = 0;
    return values.flatMap((row, index) => {
      total += row.close;
      if (index >= period) total -= values[index - period].close;
      return index < period - 1 ? [] : [{ time: row.time, value: total / period }];
    });
  }
  const multiplier = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, row) => sum + row.close, 0) / period;
  return values.flatMap((row, index) => {
    if (index < period - 1) return [];
    if (index >= period) value = (row.close - value) * multiplier + value;
    return [{ time: row.time, value: value }];
  });
};
const showLegend = (row) => {
  if (!row) { legend.textContent = symbol + ' · ' + timeframe; return; }
  const delta = row.close - row.open;
  const percent = row.open === 0 ? 0 : delta / row.open * 100;
  legend.innerHTML = '<strong>' + symbol + ' · ' + timeframe + '</strong><br>'
    + 'O ' + format(row.open) + '  H ' + format(row.high) + '  L ' + format(row.low)
    + '  C ' + format(row.close) + '  <span class="' + (delta >= 0 ? 'up' : 'down') + '">'
    + (delta >= 0 ? '+' : '') + percent.toFixed(2) + '%</span>';
};

const receive = (event) => {
  try {
    const message = JSON.parse(event.data);
    if (message.type === 'positions') {
      setPositions(message.lines);
      return;
    }
    if (message.type === 'reset_scale') {
      priceOverride = null;
      rescale();
      chart.timeScale().applyOptions({ barSpacing: 8 });
      chart.timeScale().fitContent();
      return;
    }
    if (message.type !== 'market_data') return;
    rows = message.candles;
    symbol = message.symbol;
    timeframe = message.timeframe;
    applyPriceFormat(message.priceFormat);
    candles.setData(rows);
    line.setData(rows.map((row) => ({ time: row.time, value: row.close })));
    sma.setData(movingAverage(rows, 20, false));
    ema.setData(movingAverage(rows, 20, true));
    candles.applyOptions({ visible: message.style !== 'line' });
    line.applyOptions({ visible: message.style === 'line' });
    // The position lines ride on whichever series is showing: an invisible series draws nothing.
    showPositionsOn(message.style === 'line' ? line : candles);
    sma.applyOptions({ visible: message.sma });
    ema.applyOptions({ visible: message.ema });
    showLegend(rows[rows.length - 1]);
    if (message.fit) chart.timeScale().fitContent();
  } catch (error) {
    post({ type: 'chart_error' });
  }
};

chart.subscribeCrosshairMove((param) => {
  const candle = param.seriesData.get(candles);
  const row = candle || rows.find((item) => item.time === param.time) || rows[rows.length - 1];
  showLegend(row);
});
`;

/**
 * Last in the closure: starts listening, and says so, only once every handler
 * above it exists.
 */
export const CHART_BOOT = `
window.addEventListener('message', receive);
document.addEventListener('message', receive);
post({ type: 'ready' });
`;
