import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import {
  CHART_ICON_SIZE,
  IconButton,
} from '@/features/trade/components/ChartToolbarControls';
import {
  CHART_TOOL_GROUPS,
  chartToolGroupId,
  type ChartTool,
} from '@/features/trade/components/chartTools';
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
 * The market chart: the interval strip, the canvas with its drawing rail, and the series and view
 * controls — in that order, in one column.
 *
 * The strip and the controls used to be one horizontal `ScrollView` above the canvas, and it ran to
 * 632pt of content on a 336pt column. Everything past `30m` was off the right edge with no indication
 * it was there, which put the daily and weekly intervals and every one of the series controls out of
 * reach in practice. They are now two rows that each fit the column they are in: see
 * `MarketChartTimeframes` for how the strip decides what fits, and `MarketChartOptions` for why the
 * row under the canvas wraps rather than scrolls.
 *
 * What stayed here is the part that owns the document: the series message, the `ready` handshake, the
 * drawing rail's tool state, and the failure path. The two control rows hold no chart state — they
 * render what this passes down and call back — so the canvas never reloads because a control moved.
 */
function TradingViewMarketChartComponent({
  candles,
  fill = false,
  onExpand,
  onTimeframeChange,
  status,
  symbol,
  timeframe,
}: {
  readonly candles: readonly MarketCandle[];
  readonly fill?: boolean;
  readonly onExpand?: () => void;
  readonly onTimeframeChange: (timeframe: MarketTimeframe) => void;
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
  const [tool, setTool] = useState<ChartTool>('none');
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [magnet, setMagnet] = useState(false);
  const shouldFit = useRef(true);
  const timeframeLabel = MARKET_TIMEFRAMES.find((item) => item.id === timeframe)?.label ?? timeframe;
  const message = useMemo(() => JSON.stringify({
    type: 'market_data',
    candles: candles.map((candle) => ({
      time: Math.floor(candle.timeMs / 1_000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })),
    ema: showEma,
    fit: shouldFit.current,
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
  const undelivered = useRef<string | null>(null);

  const deliver = useCallback((payload: string) => {
    webView.current?.postMessage(payload);
    undelivered.current = null;
    shouldFit.current = false;
  }, []);

  useEffect(() => {
    if (candles.length === 0) return;
    // Queued either way. If the chart is not listening yet, `ready` picks this up when it is.
    undelivered.current = message;
    if (ready) deliver(message);
  }, [candles.length, deliver, message, ready]);

  const send = useCallback((payload: Record<string, unknown>) => {
    webView.current?.postMessage(JSON.stringify(payload));
  }, []);

  const selectTool = useCallback((next: ChartTool) => {
    setTool(next);
    setOpenGroup(null);
    send({ type: 'set_tool', tool: next });
  }, [send]);

  const toggleMagnet = useCallback(() => {
    setMagnet((current) => {
      send({ type: 'set_magnet', magnet: !current });
      return !current;
    });
  }, [send]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const value = JSON.parse(event.nativeEvent.data) as { type?: unknown };
      if (value.type === 'ready') {
        shouldFit.current = true;
        setReady(true);
        // Delivered here rather than left to the effect. This is the only moment the chart is known to
        // be listening, and whatever was queued before it loaded has to go now — the effect cannot be
        // relied on to run, because `ready` may already have been true.
        const queued = undelivered.current;
        if (queued !== null) deliver(queued);
      } else if (value.type === 'tool_done') {
        // The chart disarms itself once a shape lands, so the rail follows it
        // back to the crosshair instead of drawing a second shape by accident.
        setTool('none');
      } else if (value.type === 'chart_error') {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }
  }, [deliver]);

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
   * The document now outlives the series. It loads once, keeps its chart, its drawings and its zoom, and
   * a timeframe change is a message rather than a reload. Only a renderer failure takes it down, and
   * that path deliberately unmounts so a retry gets a clean document.
   */
  const mounted = !failed;
  const awaitingCandles = candles.length === 0;

  return (
    <View style={[styles.shell, fill && styles.shellFill]}>
      <MarketChartTimeframes onSelect={selectTimeframe} selected={timeframe} />

      <View style={[styles.workspace, fill && styles.workspaceFill]}>
        <ScrollView
          accessibilityRole="toolbar"
          contentContainerStyle={styles.rail}
          showsVerticalScrollIndicator={false}
          style={styles.railScroll}
        >
          {CHART_TOOL_GROUPS.map((group) => (
            <IconButton
              icon={group.icon}
              key={group.id}
              label={group.label}
              onPress={() => {
                if (group.tools.length === 1 && group.tools[0] !== undefined) {
                  selectTool(group.tools[0].id);
                  return;
                }
                setOpenGroup((current) => current === group.id ? null : group.id);
              }}
              selected={tool === 'none'
                ? group.id === 'cursor'
                : chartToolGroupId(tool) === group.id}
            />
          ))}
          <View style={styles.railDivider} />
          <IconButton
            icon="magnet"
            label="Snap drawings to candle highs, lows, opens and closes"
            onPress={toggleMagnet}
            selected={magnet}
          />
          <IconButton
            icon="undo"
            label="Remove the last drawing"
            onPress={() => send({ type: 'undo_drawing' })}
          />
          <IconButton
            icon="clear"
            label="Remove all drawings"
            onPress={() => {
              selectTool('none');
              send({ type: 'clear_drawings' });
            }}
          />
        </ScrollView>

        {openGroup === null ? null : (
          <View accessibilityRole="menu" style={styles.picker}>
            {(CHART_TOOL_GROUPS.find((group) => group.id === openGroup)?.tools ?? []).map((item) => (
              <Pressable
                accessibilityRole="menuitem"
                accessibilityState={{ selected: tool === item.id }}
                key={item.id}
                onPress={() => selectTool(item.id)}
                style={({ pressed }) => [styles.pickerItem, pressed && styles.pressed]}
              >
                <Text style={[styles.pickerLabel, tool === item.id && styles.pickerLabelActive]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <View
          accessibilityLabel={`Interactive chart for ${symbol}. Drag to pan, pinch sideways to zoom time, pinch vertically to zoom price.`}
          style={styles.chart}
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
  // Rail and chart share one bordered frame, so the tools read as part of the
  // chart surface rather than as a floating strip beside it.
  workspace: {
    height: 420,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
  },
  workspaceFill: { flex: 1, height: 0, minHeight: 240 },
  railScroll: {
    flexGrow: 0,
    flexShrink: 0,
    width: CHART_ICON_SIZE,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    backgroundColor: colors.surface,
  },
  rail: { alignItems: 'center', paddingVertical: spacing.xxs, gap: spacing.xxs },
  // Opens beside the rail, inside the chart frame, so a family's members are one
  // tap away without a modal covering the candles.
  picker: {
    position: 'absolute',
    zIndex: 2,
    top: spacing.xxs,
    left: CHART_ICON_SIZE + spacing.xxs,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
  },
  pickerItem: {
    minHeight: 38,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  pickerLabel: { ...typography.caption, color: colors.textSecondary },
  pickerLabelActive: { color: colors.accentSoft },
  railDivider: {
    width: 20,
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.xxs,
    backgroundColor: colors.borderStrong,
  },
  chart: { flex: 1, minWidth: 0 },
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
