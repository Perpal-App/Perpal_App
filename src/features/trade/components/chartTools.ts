import type { ChartToolName } from '@/features/trade/components/ChartToolIcon';

/**
 * Every drawing tool the chart document implements. `none` is the default
 * crosshair state, where touches go to the chart for pan, pinch and axis drags.
 */
export type ChartTool =
  | 'none'
  | 'trend'
  | 'ray'
  | 'xline'
  | 'arrow'
  | 'hline'
  | 'hray'
  | 'vline'
  | 'plabel'
  | 'rect'
  | 'ellipse'
  | 'channel'
  | 'fib'
  | 'long'
  | 'short'
  | 'measure'
  | 'prange'
  | 'drange'
  | 'brush';

export type ChartToolGroup = {
  readonly id: string;
  readonly icon: ChartToolName;
  readonly label: string;
  readonly tools: readonly { readonly id: ChartTool; readonly label: string }[];
};

/**
 * The rail, grouped the way TradingView groups it: one button per family, and
 * the family opens to its members. Grouping is what keeps a full tool set
 * reachable on a phone — nineteen flat buttons would not fit beside the chart.
 *
 * Anchors per tool are declared in the chart runtime, not here: one drag places
 * a two-anchor tool, and a drag then a tap places a three-anchor one.
 */
export const CHART_TOOL_GROUPS: readonly ChartToolGroup[] = [
  {
    id: 'cursor',
    icon: 'cursor',
    label: 'Crosshair, pan and zoom',
    tools: [{ id: 'none', label: 'Crosshair' }],
  },
  {
    id: 'lines',
    icon: 'trend',
    label: 'Lines',
    tools: [
      { id: 'trend', label: 'Trend line' },
      { id: 'ray', label: 'Ray' },
      { id: 'xline', label: 'Extended line' },
      { id: 'arrow', label: 'Arrow' },
    ],
  },
  {
    id: 'levels',
    icon: 'horizontal',
    label: 'Levels',
    tools: [
      { id: 'hline', label: 'Horizontal line' },
      { id: 'hray', label: 'Horizontal ray' },
      { id: 'vline', label: 'Vertical line' },
      { id: 'plabel', label: 'Price label' },
    ],
  },
  {
    id: 'shapes',
    icon: 'shapes',
    label: 'Shapes',
    tools: [
      { id: 'rect', label: 'Rectangle' },
      { id: 'ellipse', label: 'Ellipse' },
      { id: 'channel', label: 'Parallel channel' },
    ],
  },
  {
    id: 'fib',
    icon: 'fib',
    label: 'Fibonacci retracement',
    tools: [{ id: 'fib', label: 'Fib retracement' }],
  },
  {
    id: 'positions',
    icon: 'position',
    label: 'Position tools',
    tools: [
      { id: 'long', label: 'Long position' },
      { id: 'short', label: 'Short position' },
    ],
  },
  {
    id: 'measure',
    icon: 'ruler',
    label: 'Measure',
    tools: [
      { id: 'measure', label: 'Measure move and bars' },
      { id: 'prange', label: 'Price range' },
      { id: 'drange', label: 'Date range' },
    ],
  },
  {
    id: 'brush',
    icon: 'brush',
    label: 'Freehand brush',
    tools: [{ id: 'brush', label: 'Brush' }],
  },
];

const BY_TOOL = new Map(
  CHART_TOOL_GROUPS.flatMap((group) =>
    group.tools.map((tool) => [tool.id, { group, tool }] as const),
  ),
);

export function chartToolLabel(tool: ChartTool): string {
  return BY_TOOL.get(tool)?.tool.label ?? 'Crosshair';
}

export function chartToolGroupId(tool: ChartTool): string {
  return BY_TOOL.get(tool)?.group.id ?? 'cursor';
}
