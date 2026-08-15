import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export type ChartToolName =
  | 'cursor'
  | 'trend'
  | 'horizontal'
  | 'shapes'
  | 'fib'
  | 'position'
  | 'ruler'
  | 'study'
  | 'brush'
  | 'magnet'
  | 'undo'
  | 'clear'
  | 'scale'
  | 'expand';

/**
 * Line-art marks for the chart's tool rail, drawn at a 24-unit grid so every
 * glyph shares one optical weight. Each is decorative: the button around it
 * carries the accessible label.
 */
export function ChartToolIcon({
  color,
  name,
  size = 20,
}: {
  readonly color: string;
  readonly name: ChartToolName;
  readonly size?: number;
}) {
  const common = {
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      {name === 'cursor' ? (
        <>
          <Line {...common} x1="12" x2="12" y1="3" y2="9" />
          <Line {...common} x1="12" x2="12" y1="15" y2="21" />
          <Line {...common} x1="3" x2="9" y1="12" y2="12" />
          <Line {...common} x1="15" x2="21" y1="12" y2="12" />
          <Circle {...common} cx="12" cy="12" r="2.2" />
        </>
      ) : null}

      {name === 'trend' ? (
        <>
          <Line {...common} x1="5" x2="19" y1="18" y2="6" />
          <Circle {...common} cx="5" cy="18" r="2" />
          <Circle {...common} cx="19" cy="6" r="2" />
        </>
      ) : null}

      {name === 'horizontal' ? (
        <>
          <Line {...common} x1="3" x2="21" y1="12" y2="12" />
          <Circle {...common} cx="8" cy="12" r="2" />
        </>
      ) : null}

      {name === 'shapes' ? (
        <>
          <Rect {...common} height="9" rx="1.5" width="11" x="3" y="4" />
          <Circle {...common} cx="15" cy="15" r="5.5" />
        </>
      ) : null}

      {name === 'fib' ? (
        <>
          <Line {...common} x1="3" x2="21" y1="5" y2="5" />
          <Line {...common} x1="3" x2="21" y1="10" y2="10" />
          <Line {...common} x1="3" x2="21" y1="14" y2="14" />
          <Line {...common} x1="3" x2="21" y1="19" y2="19" />
        </>
      ) : null}

      {name === 'position' ? (
        <>
          <Rect {...common} height="6" rx="1" width="16" x="4" y="5" />
          <Rect {...common} height="6" rx="1" width="16" x="4" y="13" />
          <Line {...common} x1="2" x2="22" y1="12" y2="12" />
        </>
      ) : null}

      {/* Three lines fanning from one anchor: the pitchfork's own construction, which also
          reads as the regression channel's median and its two bands. */}
      {name === 'study' ? (
        <>
          <Line {...common} x1="4" x2="20" y1="19" y2="6" />
          <Line {...common} x1="4" x2="20" y1="19" y2="13" />
          <Line {...common} x1="10" x2="20" y1="19" y2="19" />
          <Circle {...common} cx="4" cy="19" r="1.8" />
        </>
      ) : null}

      {name === 'brush' ? (
        <Path {...common} d="M4 17c3-1 3-9 6-9s3 8 6 8 2-6 4-7" />
      ) : null}

      {name === 'magnet' ? (
        <>
          <Path {...common} d="M6 4v7a6 6 0 0 0 12 0V4" />
          <Line {...common} x1="6" x2="10" y1="9" y2="9" />
          <Line {...common} x1="14" x2="18" y1="9" y2="9" />
        </>
      ) : null}

      {name === 'undo' ? (
        <>
          <Path {...common} d="M9 7H15a5 5 0 0 1 0 10H7" />
          <Path {...common} d="M11.5 4.5L9 7l2.5 2.5" />
        </>
      ) : null}

      {name === 'ruler' ? (
        <>
          <Rect {...common} height="10" rx="1.5" width="18" x="3" y="7" />
          <Line {...common} x1="9" x2="9" y1="7" y2="11" />
          <Line {...common} x1="15" x2="15" y1="7" y2="11" />
        </>
      ) : null}

      {name === 'clear' ? (
        <>
          <Path {...common} d="M5 7h14" />
          <Path {...common} d="M8 7V5h8v2" />
          <Path {...common} d="M6.5 7l1 12h9l1-12" />
        </>
      ) : null}

      {name === 'scale' ? (
        <>
          <Line {...common} x1="12" x2="12" y1="4" y2="20" />
          <Path {...common} d="M8.5 7.5L12 4l3.5 3.5" />
          <Path {...common} d="M8.5 16.5L12 20l3.5-3.5" />
        </>
      ) : null}

      {name === 'expand' ? (
        <>
          <Path {...common} d="M4 9V4h5" />
          <Path {...common} d="M20 15v5h-5" />
          <Line {...common} x1="4" x2="10" y1="4" y2="10" />
          <Line {...common} x1="20" x2="14" y1="20" y2="14" />
        </>
      ) : null}
    </Svg>
  );
}
