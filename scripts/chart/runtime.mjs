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
const overlay = document.getElementById('draw');
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
  grid: { vertLines: { color: '#171820' }, horzLines: { color: '#171820' } },
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
const sma = chart.addSeries(TV.LineSeries, {
  color: '#f5c451', lineWidth: 2, visible: false, priceLineVisible: false,
});
const ema = chart.addSeries(TV.LineSeries, {
  color: '#58a6ff', lineWidth: 2, visible: false, priceLineVisible: false,
});

const rescale = () => {
  scaleBadge.style.display = priceOverride === null ? 'none' : 'block';
  chart.priceScale('right').applyOptions({ autoScale: true });
};
const visibleRange = () => {
  const top = candles.coordinateToPrice(0);
  const bottom = candles.coordinateToPrice(host.clientHeight);
  return top === null || bottom === null || top <= bottom ? null : { min: bottom, max: top };
};
const clampSpan = (span, anchor) => Math.max(span, Math.abs(anchor) * 1e-6 + 1e-9);
const setSpan = (span, anchor, ratio) => {
  const safe = clampSpan(span, anchor);
  priceOverride = { max: anchor + safe * ratio, min: anchor - safe * (1 - ratio) };
  rescale();
  render();
};

// ---- gesture plumbing ------------------------------------------------------
// One handler set decides, on touchstart, which of four gestures is in play:
// price-axis stretch, time-axis stretch, vertical pinch (price) or nothing,
// in which case the touch falls through to the library for pan and time pinch.
const AXIS_GRAB = 8;
let gesture = null;

const localPoint = (touch) => {
  const rect = host.getBoundingClientRect();
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top, width: rect.width, height: rect.height };
};
const spread = (touches) => ({
  dx: Math.abs(touches[0].clientX - touches[1].clientX),
  dy: Math.abs(touches[0].clientY - touches[1].clientY),
  centerY: (touches[0].clientY + touches[1].clientY) / 2,
});
const onPriceAxis = (point) => point.x >= point.width - chart.priceScale('right').width() - AXIS_GRAB;
const onTimeAxis = (point) => point.y >= point.height - chart.timeScale().height() - AXIS_GRAB;

host.addEventListener('touchstart', (event) => {
  if (event.touches.length === 2) {
    const reading = spread(event.touches);
    if (reading.dy <= reading.dx) return;
    const range = priceOverride || visibleRange();
    if (range === null) return;
    const rect = host.getBoundingClientRect();
    const ratio = Math.min(Math.max((reading.centerY - rect.top) / Math.max(rect.height, 1), 0), 1);
    gesture = {
      kind: 'pinch',
      distance: Math.max(reading.dy, 1),
      span: range.max - range.min,
      anchor: range.max - (range.max - range.min) * ratio,
      ratio: ratio,
    };
    event.stopPropagation();
    return;
  }

  if (event.touches.length !== 1) return;
  const point = localPoint(event.touches[0]);

  if (onPriceAxis(point)) {
    const range = priceOverride || visibleRange();
    if (range === null) return;
    gesture = {
      kind: 'priceAxis',
      startY: point.y,
      height: Math.max(point.height, 1),
      span: range.max - range.min,
      anchor: (range.max + range.min) / 2,
    };
    event.stopPropagation();
    event.preventDefault();
    return;
  }

  if (onTimeAxis(point)) {
    gesture = {
      kind: 'timeAxis',
      startX: point.x,
      width: Math.max(point.width, 1),
      barSpacing: chart.timeScale().options().barSpacing,
    };
    event.stopPropagation();
    event.preventDefault();
  }
}, { capture: true, passive: false });

host.addEventListener('touchmove', (event) => {
  if (gesture === null) return;

  if (gesture.kind === 'pinch') {
    if (event.touches.length !== 2) return;
    // Fingers apart shrinks the span, which is a zoom in.
    const factor = Math.min(Math.max(gesture.distance / Math.max(spread(event.touches).dy, 1), 0.02), 50);
    setSpan(gesture.span * factor, gesture.anchor, gesture.ratio);
  } else if (gesture.kind === 'priceAxis') {
    // Dragging down stretches the axis open, the same direction TradingView
    // uses, so the candles compress toward the middle of the range.
    const travel = (localPoint(event.touches[0]).y - gesture.startY) / gesture.height;
    const factor = Math.min(Math.max(1 + travel * 2.5, 0.05), 20);
    setSpan(gesture.span * factor, gesture.anchor, 0.5);
  } else {
    // Dragging right along the time axis widens the bars.
    const travel = (localPoint(event.touches[0]).x - gesture.startX) / gesture.width;
    const next = Math.min(Math.max(gesture.barSpacing * (1 + travel * 2.5), 2), 120);
    chart.timeScale().applyOptions({ barSpacing: next });
    render();
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

const format = (value) => value >= 1
  ? value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  : value.toLocaleString(undefined, { maximumSignificantDigits: 6 });
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
    if (handleDrawingMessage(message)) return;
    if (message.type === 'reset_scale') {
      priceOverride = null;
      rescale();
      chart.timeScale().applyOptions({ barSpacing: 8 });
      chart.timeScale().fitContent();
      render();
      return;
    }
    if (message.type !== 'market_data') return;
    rows = message.candles;
    symbol = message.symbol;
    timeframe = message.timeframe;
    candles.setData(rows);
    line.setData(rows.map((row) => ({ time: row.time, value: row.close })));
    sma.setData(movingAverage(rows, 20, false));
    ema.setData(movingAverage(rows, 20, true));
    candles.applyOptions({ visible: message.style !== 'line' });
    line.applyOptions({ visible: message.style === 'line' });
    sma.applyOptions({ visible: message.sma });
    ema.applyOptions({ visible: message.ema });
    showLegend(rows[rows.length - 1]);
    if (message.fit) chart.timeScale().fitContent();
    render();
  } catch (error) {
    post({ type: 'chart_error' });
  }
};

chart.subscribeCrosshairMove((param) => {
  const candle = param.seriesData.get(candles);
  const row = candle || rows.find((item) => item.time === param.time) || rows[rows.length - 1];
  showLegend(row);
});
chart.timeScale().subscribeVisibleLogicalRangeChange(() => render());
`;
