#!/usr/bin/env node
/**
 * Builds the offline chart document used by TradingViewMarketChart.
 *
 * TradingView's Lightweight Charts is inlined rather than fetched, so the chart
 * renders with no network access and no third-party script at runtime. The
 * output is a TypeScript module holding the document as a string; regenerate it
 * with `npm run generate:chart` after changing anything below.
 *
 * What lives in here rather than in React Native: candle rendering, the
 * crosshair legend, price-axis pinch zoom and the drawing layer. All three need
 * per-frame access to the chart's coordinate system, so they stay inside the
 * WebView where that is a direct call instead of a bridge round trip. React
 * Native owns the toolbars and posts intent (`set_tool`, `clear_drawings`,
 * `reset_scale`, `market_data`) across the bridge once per interaction.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const libraryPath = join(
  root,
  'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js',
);
const outputPath = join(
  root,
  'src/features/trade/generated/tradingViewChartHtml.ts',
);
const library = readFileSync(libraryPath, 'utf8').replaceAll('</script', '<\\/script');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <style>
    * { box-sizing: border-box; }
    html, body, #wrap { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #07060b; }
    body { font-family: system-ui, -apple-system, sans-serif; }
    #wrap { position: relative; }
    #chart { position: absolute; inset: 0; }
    /* Sits over the chart and only takes touches while a drawing tool is armed,
       so panning stays with the chart the rest of the time. */
    #draw { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
    #legend {
      position: absolute; z-index: 4; top: 10px; left: 12px; right: 64px;
      color: #bdb8cc; font-size: 12px; line-height: 18px; pointer-events: none;
      font-variant-numeric: tabular-nums;
    }
    #legend strong { color: #fff; font-weight: 600; }
    #legend .up { color: #4ade80; }
    #legend .down { color: #ef6262; }
    #scale {
      position: absolute; z-index: 4; right: 8px; bottom: 26px; padding: 2px 8px;
      border-radius: 8px; border: 1px solid #3a3b48; background: #171820;
      color: #c4b5fd; font-size: 11px; line-height: 18px; display: none;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="wrap">
    <div id="chart"></div>
    <canvas id="draw"></canvas>
    <div id="legend" aria-live="polite"></div>
    <div id="scale">manual scale</div>
  </div>
  <script>${library}</script>
  <script>
    (() => {
      const TV = window.LightweightCharts;
      const host = document.getElementById('chart');
      const overlay = document.getElementById('draw');
      const legend = document.getElementById('legend');
      const scaleBadge = document.getElementById('scale');
      const post = (payload) => window.ReactNativeWebView?.postMessage(JSON.stringify(payload));

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
          rightOffset: 4, barSpacing: 8, minBarSpacing: 3,
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      });

      /**
       * Manual price range, or null while the chart autoscales. Lightweight
       * Charts has no setter for a visible price range, so the range is fed
       * back through each series' autoscale hook and re-requested by toggling
       * autoScale — the supported way to drive the axis from outside.
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

      // ---- price-axis pinch ------------------------------------------------
      // Two fingers moving apart vertically stretch the price axis about the
      // point between them, the same gesture TradingView uses. A pinch that is
      // mostly horizontal is left to the library, which scales the time axis.
      let pinch = null;
      const spread = (touches) => ({
        dx: Math.abs(touches[0].clientX - touches[1].clientX),
        dy: Math.abs(touches[0].clientY - touches[1].clientY),
        centerY: (touches[0].clientY + touches[1].clientY) / 2,
      });

      host.addEventListener('touchstart', (event) => {
        if (event.touches.length !== 2) return;
        const { dx, dy, centerY } = spread(event.touches);
        if (dy <= dx) return;
        const range = priceOverride ?? visibleRange();
        if (range === null) return;
        const rect = host.getBoundingClientRect();
        const ratio = Math.min(Math.max((centerY - rect.top) / Math.max(rect.height, 1), 0), 1);
        pinch = {
          distance: Math.max(dy, 1),
          span: range.max - range.min,
          anchor: range.max - (range.max - range.min) * ratio,
          ratio,
        };
        event.stopPropagation();
      }, { capture: true, passive: false });

      host.addEventListener('touchmove', (event) => {
        if (pinch === null || event.touches.length !== 2) return;
        const { dy } = spread(event.touches);
        // Fingers apart shrinks the span, which is a zoom in.
        const factor = Math.min(Math.max(pinch.distance / Math.max(dy, 1), 0.02), 50);
        const span = Math.max(pinch.span * factor, Math.abs(pinch.anchor) * 1e-6 + 1e-9);
        priceOverride = {
          max: pinch.anchor + span * pinch.ratio,
          min: pinch.anchor - span * (1 - pinch.ratio),
        };
        rescale();
        render();
        event.preventDefault();
        event.stopPropagation();
      }, { capture: true, passive: false });

      const endPinch = (event) => {
        if (pinch !== null && event.touches.length < 2) pinch = null;
      };
      host.addEventListener('touchend', endPinch, { capture: true });
      host.addEventListener('touchcancel', endPinch, { capture: true });

      // ---- drawing layer ---------------------------------------------------
      // Anchors are logical bar indices, not timestamps: a logical index still
      // maps to a coordinate past the last candle, so a line keeps its position
      // when the chart is panned into empty space or zoomed.
      const context = overlay.getContext('2d');
      const shapes = [];
      let tool = 'none';
      let draft = null;
      let frame = null;

      const sizeOverlay = () => {
        const ratio = window.devicePixelRatio || 1;
        overlay.width = Math.floor(host.clientWidth * ratio);
        overlay.height = Math.floor(host.clientHeight * ratio);
        overlay.style.width = host.clientWidth + 'px';
        overlay.style.height = host.clientHeight + 'px';
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
      };
      const toPoint = (clientX, clientY) => {
        const rect = host.getBoundingClientRect();
        const logical = chart.timeScale().coordinateToLogical(clientX - rect.left);
        const price = candles.coordinateToPrice(clientY - rect.top);
        return logical === null || price === null ? null : { logical, price };
      };
      const toPixels = (point) => {
        const x = chart.timeScale().logicalToCoordinate(point.logical);
        const y = candles.priceToCoordinate(point.price);
        return x === null || y === null ? null : { x, y };
      };
      const priceText = (value) => value >= 1
        ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : value.toLocaleString(undefined, { maximumSignificantDigits: 4 });

      const drawSegment = (shape, active) => {
        const a = toPixels(shape.a);
        const b = shape.b === null ? null : toPixels(shape.b);
        if (a === null) return;
        context.lineWidth = 1.5;
        context.strokeStyle = active ? '#c4b5fd' : '#8b5cf6';
        context.setLineDash([]);

        if (shape.kind === 'horizontal') {
          context.beginPath();
          context.moveTo(0, a.y);
          context.lineTo(host.clientWidth, a.y);
          context.stroke();
          label(priceText(shape.a.price), 6, a.y - 8);
          return;
        }
        if (b === null) return;
        if (shape.kind === 'ruler') {
          context.setLineDash([4, 3]);
          context.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          const move = shape.b.price - shape.a.price;
          const percent = shape.a.price === 0 ? 0 : (move / shape.a.price) * 100;
          const bars = Math.round(Math.abs(shape.b.logical - shape.a.logical));
          label(
            (move >= 0 ? '+' : '') + priceText(move) + '  ' + (move >= 0 ? '+' : '') + percent.toFixed(2) + '%  ' + bars + ' bars',
            Math.min(a.x, b.x) + 4,
            Math.min(a.y, b.y) - 8,
          );
          return;
        }
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
        dot(a);
        dot(b);
      };
      const dot = (point) => {
        context.beginPath();
        context.arc(point.x, point.y, 3, 0, Math.PI * 2);
        context.fillStyle = '#c4b5fd';
        context.fill();
      };
      const label = (text, x, y) => {
        context.font = '11px system-ui, -apple-system, sans-serif';
        const width = context.measureText(text).width + 10;
        const top = Math.max(y - 14, 0);
        context.fillStyle = 'rgba(23, 24, 32, 0.92)';
        context.fillRect(x, top, width, 18);
        context.fillStyle = '#c4b5fd';
        context.fillText(text, x + 5, top + 13);
      };

      function render() {
        context.clearRect(0, 0, host.clientWidth, host.clientHeight);
        for (const shape of shapes) drawSegment(shape, false);
        if (draft !== null) drawSegment(draft, true);
      }
      // Price-scale changes emit no event, so an armed or populated overlay
      // repaints per frame to stay glued to the axis. It stops when idle.
      const loop = () => {
        render();
        frame = shapes.length > 0 || draft !== null ? requestAnimationFrame(loop) : null;
      };
      const wake = () => {
        if (frame === null && (shapes.length > 0 || draft !== null)) frame = requestAnimationFrame(loop);
        else render();
      };

      const armed = () => tool !== 'none';
      const syncOverlay = () => {
        overlay.style.pointerEvents = armed() ? 'auto' : 'none';
      };

      overlay.addEventListener('touchstart', (event) => {
        if (!armed() || event.touches.length !== 1) return;
        const point = toPoint(event.touches[0].clientX, event.touches[0].clientY);
        if (point === null) return;
        draft = { kind: tool, a: point, b: tool === 'horizontal' ? null : point };
        wake();
        event.preventDefault();
      }, { passive: false });

      overlay.addEventListener('touchmove', (event) => {
        if (draft === null || event.touches.length !== 1) return;
        const point = toPoint(event.touches[0].clientX, event.touches[0].clientY);
        if (point !== null && draft.kind !== 'horizontal') draft.b = point;
        if (point !== null && draft.kind === 'horizontal') draft.a = point;
        event.preventDefault();
      }, { passive: false });

      overlay.addEventListener('touchend', (event) => {
        if (draft === null) return;
        shapes.push(draft);
        draft = null;
        tool = 'none';
        syncOverlay();
        wake();
        post({ type: 'tool_done', shapes: shapes.length });
        event.preventDefault();
      }, { passive: false });

      // ---- data + indicators ----------------------------------------------
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
          return [{ time: row.time, value }];
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
          if (message.type === 'set_tool') {
            tool = message.tool;
            draft = null;
            syncOverlay();
            wake();
            return;
          }
          if (message.type === 'clear_drawings') {
            shapes.length = 0;
            draft = null;
            render();
            return;
          }
          if (message.type === 'reset_scale') {
            priceOverride = null;
            rescale();
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
          showLegend(rows.at(-1));
          if (message.fit) chart.timeScale().fitContent();
          render();
        } catch (error) {
          post({ type: 'chart_error' });
        }
      };

      chart.subscribeCrosshairMove((param) => {
        const candle = param.seriesData.get(candles);
        const row = candle || rows.find((item) => item.time === param.time) || rows.at(-1);
        showLegend(row);
      });
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => render());
      new ResizeObserver(() => { sizeOverlay(); render(); }).observe(host);

      sizeOverlay();
      window.addEventListener('message', receive);
      document.addEventListener('message', receive);
      post({ type: 'ready' });
    })();
  </script>
</body>
</html>`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `// Generated by scripts/generate-tradingview-chart.mjs. Do not edit.\nexport const TRADING_VIEW_CHART_HTML = ${JSON.stringify(html)};\n`,
);
