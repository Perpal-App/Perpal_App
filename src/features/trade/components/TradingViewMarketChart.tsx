import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import {
  MarketChartOptions,
  type ChartStyle,
} from '@/features/trade/components/MarketChartOptions';
import { MarketChartTimeframes } from '@/features/trade/components/MarketChartTimeframes';
import { TRADING_VIEW_CHART_HTML } from '@/features/trade/generated/tradingViewChartHtml';
import type { MarketHistoryStatus } from '@/features/trade/hooks/usePacificaMarketHistory';
import {
  MARKET_TIMEFRAMES,
  type MarketCandle,
  type MarketTimeframe,
} from '@/integrations/perps/pacifica/pacificaHistory';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

const CHART_SOURCE = { html: TRADING_VIEW_CHART_HTML };
const CHART_ORIGIN_WHITELIST = ['*'];

/**
 * An open position as the chart draws it: a dashed line at its entry, the entry on the price axis, and at
 * the line's end a tag with the side, the size, the profit or loss, and a × that asks to close it.
 */
export type ChartPositionLine = {
  /** A close is under way for it, which holds its × back. */
  readonly closing: boolean;
  /** The position's `positionKey`, which is what a tap on its × hands back. */
  readonly id: string;
  /** Unrealized profit or loss, already formatted: `+$0.04`. */
  readonly pnl: string;
  /** The entry, as a number the chart can place the line with. Nothing is valued from it. */
  readonly price: number;
  readonly side: 'long' | 'short';
  /** The side and size: `Short 0.1`. */
  readonly title: string;
  readonly tone: 'negative' | 'plain' | 'positive';
};

const NO_POSITIONS: readonly ChartPositionLine[] = [];

/**
 * The market chart: the interval strip, the canvas, and the series and view controls, in one column.
 *
 * The canvas is the chart and nothing else. The drawing rail that ran down its left edge is gone, and the
 * tool layer with it: on a phone it took a sixth of the width from the candles for tools a finger cannot
 * place precisely. What the canvas does add is the account's own stake in the market — each open position
 * as a line at its entry, beside the dotted line the series draws at the current price, with a × at the
 * line's end that closes the position once the reader confirms. See `useChartPositions`.
 *
 * The strip and the controls each fit the column they are in: see `MarketChartTimeframes` for how the
 * strip decides what fits, and `MarketChartOptions` for why the row under the canvas wraps rather than
 * scrolls. Neither holds chart state — they render what this passes down and call back — so the canvas
 * never reloads because a control moved.
 *
 * What stays here is the part that owns the document: the series and positions messages, the `ready`
 * handshake, and the failure path.
 */
function TradingViewMarketChartComponent({
  candles,
  fill = false,
  onClosePosition,
  onExpand,
  onTimeframeChange,
  positions = NO_POSITIONS,
  status,
  symbol,
  timeframe,
}: {
  readonly candles: readonly MarketCandle[];
  readonly fill?: boolean;
  /** A position line's × was tapped. The chart has not closed anything; it only asks. */
  readonly onClosePosition?: (id: string) => void;
  readonly onExpand?: () => void;
  readonly onTimeframeChange: (timeframe: MarketTimeframe) => void;
  /** The account's open positions on this market. */
  readonly positions?: readonly ChartPositionLine[];
  readonly status: MarketHistoryStatus;
  readonly symbol: string;
  readonly timeframe: MarketTimeframe;
}) {
  const webView = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [chartStyle, setChartStyle] = useState<ChartStyle>('candles');
  const [showSma, setShowSma] = useState(false);
  const [showEma, setShowEma] = useState(false);
  /**
   * Whether the next series to reach the document should be scaled to fill the canvas.
   *
   * Armed by a timeframe change and by a fresh document, spent by the delivery that follows. It is
   * deliberately not part of `payload`: a fit describes the delivery, not the data, and baking it into
   * the serialized body made it stale the moment the body outlived the moment it was built. A payload
   * queued before the document finished loading carried whatever the flag had been when the memo last
   * ran, so a chart that reloaded after a renderer failure could receive its series with `fit: false`
   * and draw it at a default spacing it was never scaled to.
   */
  const shouldFit = useRef(true);
  const timeframeLabel = MARKET_TIMEFRAMES.find((item) => item.id === timeframe)?.label ?? timeframe;
  const payload = useMemo(() => ({
    type: 'market_data',
    candles: candles.map((candle) => ({
      time: Math.floor(candle.timeMs / 1_000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })),
    ema: showEma,
    sma: showSma,
    style: chartStyle,
    symbol,
    timeframe: timeframeLabel,
  }), [candles, chartStyle, showEma, showSma, symbol, timeframeLabel]);

  /**
   * The newest payload the chart has not acknowledged receiving.
   *
   * Held so `ready` can deliver it. Posting used to depend on a `ready` state *transition*, and after a
   * reload there was none to depend on: the flag was still true from the previous document, the effect
   * fired against a page that had not finished loading, the message was dropped, and the arriving
   * `ready` set `true` over `true` — no re-render, no second attempt, no data. A chart with a series it
   * never received is a blank canvas with a watermark.
   */
  const undelivered = useRef<typeof payload | null>(null);

  const deliver = useCallback((body: typeof payload) => {
    webView.current?.postMessage(JSON.stringify({ ...body, fit: shouldFit.current }));
    undelivered.current = null;
    shouldFit.current = false;
  }, []);

  useEffect(() => {
    if (candles.length === 0) return;
    // Queued either way. If the chart is not listening yet, `ready` picks this up when it is.
    undelivered.current = payload;
    if (ready) deliver(payload);
  }, [candles.length, deliver, payload, ready]);

  // The positions travel on their own message, so a tick that moves a profit and loss re-sends a few
  // hundred bytes rather than the whole series. The newest is kept for `ready`, for the same reason as
  // `undelivered`: a document that has just loaded has to be handed what it missed.
  const positionsMessage = useMemo(
    () => JSON.stringify({ type: 'positions', lines: positions }),
    [positions],
  );
  const latestPositions = useRef(positionsMessage);
  useEffect(() => {
    latestPositions.current = positionsMessage;
    if (ready) webView.current?.postMessage(positionsMessage);
  }, [positionsMessage, ready]);

  const send = useCallback((message: Record<string, unknown>) => {
    webView.current?.postMessage(JSON.stringify(message));
  }, []);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const value = JSON.parse(event.nativeEvent.data) as { id?: unknown; type?: unknown };
      if (value.type === 'ready') {
        shouldFit.current = true;
        setReady(true);
        // Delivered here rather than left to the effects. This is the only moment the chart is known to
        // be listening, and whatever was queued before it loaded has to go now — the effects cannot be
        // relied on to run, because `ready` may already have been true.
        const queued = undelivered.current;
        if (queued !== null) deliver(queued);
        webView.current?.postMessage(latestPositions.current);
      } else if (value.type === 'close_position') {
        if (typeof value.id === 'string') onClosePosition?.(value.id);
      } else if (value.type === 'chart_error') {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }
  }, [deliver, onClosePosition]);

  const allowNavigation = useCallback((request: WebViewNavigation) => {
    if (request.url === 'about:blank') return true;
    if (request.url.startsWith('https://www.tradingview.com')) {
      void Linking.openURL(request.url).catch(() => undefined);
    }
    return false;
  }, []);

  const selectTimeframe = (next: MarketTimeframe) => {
    shouldFit.current = true;
    setFailed(false);
    onTimeframeChange(next);
  };

  /**
   * Whether the chart is worth keeping on screen, which is not the same as whether it has data.
   *
   * This used to be `candles.length > 0 && !failed`, and it gated the `WebView`'s existence — so every
   * timeframe change unmounted the chart and remounted it, because the history hook clears its series
   * before fetching the new one. Reloading a document to change an interval was wasteful on its own, and
   * it was also what lost the data: see `undelivered`.
   *
   * The document now outlives the series. It loads once, keeps its chart and its zoom, and a timeframe
   * change is a message rather than a reload. Only a renderer failure takes it down, and that path
   * deliberately unmounts so a retry gets a clean document.
   */
  const mounted = !failed;
  const awaitingCandles = candles.length === 0;

  return (
    <View style={[styles.shell, fill && styles.shellFill]}>
      <MarketChartTimeframes onSelect={selectTimeframe} selected={timeframe} />

      <View
        accessibilityLabel={`Interactive chart for ${symbol}. Drag to pan, pinch sideways to zoom time, pinch vertically to zoom price.${
          positions.length === 0 ? '' : ' Your open position is drawn at its entry price; close it from Positions.'
        }`}
        style={[styles.chart, fill && styles.chartFill]}
      >
        {mounted ? (
          <WebView
            allowFileAccess={false}
            allowUniversalAccessFromFileURLs={false}
            androidLayerType="hardware"
            cacheEnabled
            domStorageEnabled={false}
            javaScriptEnabled
            mixedContentMode="never"
            onError={() => setFailed(true)}
            onHttpError={() => setFailed(true)}
            onMessage={handleMessage}
            onShouldStartLoadWithRequest={allowNavigation}
            originWhitelist={CHART_ORIGIN_WHITELIST}
            ref={webView}
            scrollEnabled={false}
            setSupportMultipleWindows={false}
            source={CHART_SOURCE}
            style={styles.webView}
          />
        ) : null}

        {/* Over the chart rather than instead of it, which is the change that keeps the document
            alive. An empty canvas behind this is a chart waiting for a series, not a broken one. */}
        {mounted && !awaitingCandles ? null : (
          <View
            accessibilityLiveRegion="polite"
            style={[styles.placeholder, mounted && styles.placeholderOverlay]}
          >
            <Text style={styles.placeholderText}>
              {failed ? 'Chart renderer needs a retry' :
                status === 'loading' ? 'Loading market candles' : 'Reconnecting market candles'}
            </Text>
            {failed ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  shouldFit.current = true;
                  undelivered.current = null;
                  setReady(false);
                  setFailed(false);
                }}
                style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
              >
                <Text style={styles.retryText}>Retry chart</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        {status === 'stale' ? <Text style={styles.stale}>History reconnecting</Text> : null}
      </View>

      <MarketChartOptions
        chartStyle={chartStyle}
        onExpand={onExpand}
        onResetScale={() => send({ type: 'reset_scale' })}
        onToggleEma={() => setShowEma((value) => !value)}
        onToggleSma={() => setShowSma((value) => !value)}
        onToggleStyle={() => setChartStyle((current) => current === 'candles' ? 'line' : 'candles')}
        showEma={showEma}
        showSma={showSma}
      />
    </View>
  );
}

export const TradingViewMarketChart = memo(TradingViewMarketChartComponent);

const styles = StyleSheet.create({
  shell: { gap: spacing.xs },
  shellFill: { flex: 1 },
  // The canvas in a hairline frame of its own, full width now that nothing shares it.
  chart: {
    height: 420,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
  },
  chartFill: { flex: 1, height: 0, minHeight: 240 },
  webView: { flex: 1, backgroundColor: colors.background },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  // The same block, laid over a chart that is still mounted rather than replacing it. Opaque, because
  // what is behind it is an empty canvas carrying the renderer's watermark.
  placeholderOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flex: 0,
  },
  retry: {
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
  },
  retryText: { ...typography.label, color: colors.textPrimary },
  placeholderText: { ...typography.bodyCompact, color: colors.textMuted },
  stale: {
    ...typography.caption,
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderRadius: radii.sm,
    color: colors.textSecondary,
    backgroundColor: colors.surfaceElevated,
  },
  pressed: { opacity: 0.72 },
});
