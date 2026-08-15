import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import {
  ChartToolIcon,
  type ChartToolName,
} from '@/features/trade/components/ChartToolIcon';
import {
  CHART_TOOL_GROUPS,
  chartToolGroupId,
  type ChartTool,
} from '@/features/trade/components/chartTools';
import { TRADING_VIEW_CHART_HTML } from '@/features/trade/generated/tradingViewChartHtml';
import type { MarketHistoryStatus } from '@/features/trade/hooks/usePacificaMarketHistory';
import {
  MARKET_TIMEFRAMES,
  type MarketCandle,
  type MarketTimeframe,
} from '@/integrations/perps/pacifica/pacificaHistory';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

type ChartStyle = 'candles' | 'line';

export function TradingViewMarketChart({
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

  useEffect(() => {
    if (!ready || candles.length === 0) return;
    webView.current?.postMessage(message);
    shouldFit.current = false;
  }, [candles.length, message, ready]);

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
  }, []);

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

  const live = candles.length > 0 && !failed;

  return (
    <View style={[styles.shell, fill && styles.shellFill]}>
      <ScrollView
        accessibilityRole="tablist"
        contentContainerStyle={styles.toolbar}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {MARKET_TIMEFRAMES.map((item) => (
          <ToolButton
            key={item.id}
            label={item.label}
            onPress={() => selectTimeframe(item.id)}
            selected={item.id === timeframe}
          />
        ))}
        <View style={styles.divider} />
        <ToolButton
          label={chartStyle === 'candles' ? 'Candles' : 'Line'}
          onPress={() => setChartStyle((current) => current === 'candles' ? 'line' : 'candles')}
          selected
        />
        <ToolButton label="SMA 20" onPress={() => setShowSma((value) => !value)} selected={showSma} />
        <ToolButton label="EMA 20" onPress={() => setShowEma((value) => !value)} selected={showEma} />
        <View style={styles.divider} />
        <IconButton
          icon="scale"
          label="Reset zoom and price scale"
          onPress={() => send({ type: 'reset_scale' })}
        />
        {onExpand ? (
          <IconButton icon="expand" label="Full-screen chart" onPress={onExpand} />
        ) : null}
      </ScrollView>

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
          {live ? (
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
              originWhitelist={['*']}
              ref={webView}
              scrollEnabled={false}
              setSupportMultipleWindows={false}
              source={{ html: TRADING_VIEW_CHART_HTML }}
              style={styles.webView}
            />
          ) : (
            <View accessibilityLiveRegion="polite" style={styles.placeholder}>
              <Text style={styles.placeholderText}>
                {status === 'loading' ? 'Loading Pacifica candles' : 'Price history unavailable'}
              </Text>
            </View>
          )}
          {status === 'stale' ? <Text style={styles.stale}>History reconnecting</Text> : null}
        </View>
      </View>

    </View>
  );
}

function ToolButton({
  label,
  onPress,
  selected = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tool,
        selected && styles.toolSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.toolText, selected && styles.toolTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  selected = false,
}: {
  readonly icon: ChartToolName;
  readonly label: string;
  readonly onPress: () => void;
  readonly selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconTool,
        selected && styles.toolSelected,
        pressed && styles.pressed,
      ]}
    >
      <ChartToolIcon color={selected ? colors.accentSoft : colors.textMuted} name={icon} />
    </Pressable>
  );
}

const RAIL_WIDTH = 40;

const styles = StyleSheet.create({
  shell: { gap: spacing.xs },
  shellFill: { flex: 1 },
  toolbar: { minHeight: layout.minTouchTarget, alignItems: 'center', gap: spacing.xxs },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    marginHorizontal: spacing.xxs,
    backgroundColor: colors.borderStrong,
  },
  tool: {
    minWidth: 44,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  iconTool: {
    width: RAIL_WIDTH,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  toolSelected: { backgroundColor: colors.surfaceElevated },
  toolText: { ...typography.caption, color: colors.textMuted },
  toolTextSelected: { color: colors.textPrimary },
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
    width: RAIL_WIDTH,
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
    left: RAIL_WIDTH + spacing.xxs,
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
