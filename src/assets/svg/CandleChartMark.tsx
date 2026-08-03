import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Defs,
  G,
  LinearGradient,
  Line,
  Mask,
  Rect,
  Stop,
} from 'react-native-svg';

import { colors, motion } from '@/theme/tokens';

/**
 * Decorative candlestick series used only as a brand backdrop behind the
 * wordmark. It is not market data: the values are a fixed, hand-tuned pattern
 * with pronounced up/down swings. The series fades toward the bottom via a
 * gradient mask so the text below it stays legible.
 */
type Candle = {
  x: number;
  high: number;
  low: number;
  bodyTop: number;
  bodyBottom: number;
  up: boolean;
};

type AnimatedCandleProps = {
  candle: Candle;
  index: number;
  reduceMotion: boolean;
};

const VIEW_BOX_WIDTH = 480;
const VIEW_BOX_HEIGHT = 210;
const BODY_WIDTH = 32;
const WICK_WIDTH = 4.2;

const { duration: CANDLE_REVEAL_DURATION, stagger: CANDLE_REVEAL_STAGGER } =
  motion.candleReveal;

/**
 * Ease-in-out ("easy ease"): each candle accelerates out of nothing and settles
 * gently instead of snapping in, which is what the symmetric curve buys over a
 * plain ease-out.
 */
const CANDLE_REVEAL_EASING = Easing.inOut(Easing.cubic);

/**
 * y grows downward; smaller y sits higher on screen. The run intentionally
 * zig-zags between highs and lows so it never reads as a straight trend line.
 */
const CANDLES: Candle[] = [
  { x: 26, high: 48, low: 150, bodyTop: 62, bodyBottom: 134, up: true },
  { x: 88, high: 86, low: 172, bodyTop: 98, bodyBottom: 162, up: false },
  { x: 150, high: 40, low: 140, bodyTop: 54, bodyBottom: 126, up: true },
  { x: 212, high: 78, low: 164, bodyTop: 92, bodyBottom: 152, up: false },
  { x: 274, high: 30, low: 128, bodyTop: 44, bodyBottom: 116, up: true },
  { x: 336, high: 72, low: 158, bodyTop: 86, bodyBottom: 146, up: false },
  { x: 398, high: 24, low: 120, bodyTop: 38, bodyBottom: 110, up: true },
  { x: 460, high: 82, low: 166, bodyTop: 96, bodyBottom: 152, up: false },
];

/**
 * When the last candle finishes fading. Callers sequence follow-on reveals
 * against this so they begin as the sweep lands, and stay in step if the
 * timings or the number of candles change.
 */
export const CANDLE_REVEAL_TOTAL_DURATION =
  (CANDLES.length - 1) * CANDLE_REVEAL_STAGGER + CANDLE_REVEAL_DURATION;

const AnimatedGroup = Animated.createAnimatedComponent(G);

function AnimatedCandle({
  candle,
  index,
  reduceMotion,
}: AnimatedCandleProps) {
  const reveal = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      reveal.set(1);
      return;
    }

    reveal.set(0);
    reveal.set(
      withDelay(
        index * CANDLE_REVEAL_STAGGER,
        withTiming(1, {
          duration: CANDLE_REVEAL_DURATION,
          easing: CANDLE_REVEAL_EASING,
        }),
      ),
    );
  }, [index, reduceMotion, reveal]);

  const animatedProps = useAnimatedProps(() => ({
    opacity: reveal.value,
  }));
  const color = candle.up ? colors.accent : colors.textMuted;

  return (
    <AnimatedGroup animatedProps={animatedProps}>
      <Line
        stroke={color}
        strokeLinecap="round"
        strokeWidth={WICK_WIDTH}
        x1={candle.x}
        x2={candle.x}
        y1={candle.high}
        y2={candle.low}
      />
      <Rect
        fill={color}
        height={Math.max(candle.bodyBottom - candle.bodyTop, 3)}
        rx={3}
        width={BODY_WIDTH}
        x={candle.x - BODY_WIDTH / 2}
        y={candle.bodyTop}
      />
    </AnimatedGroup>
  );
}

export function CandleChartMark() {
  const reduceMotion = useReducedMotion();

  return (
    <Svg
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      viewBox={`0 0 ${VIEW_BOX_WIDTH} ${VIEW_BOX_HEIGHT}`}
      width="100%"
    >
      <Defs>
        <LinearGradient id="candleFade" x1="0" x2="0" y1="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
          <Stop offset="0.66" stopColor="#FFFFFF" stopOpacity={0.85} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
        <Mask id="candleFadeMask">
          <Rect
            fill="url(#candleFade)"
            height={VIEW_BOX_HEIGHT}
            width={VIEW_BOX_WIDTH}
            x={0}
            y={0}
          />
        </Mask>
      </Defs>

      <G mask="url(#candleFadeMask)">
        {CANDLES.map((candle, index) => (
          <AnimatedCandle
            candle={candle}
            index={index}
            key={candle.x}
            reduceMotion={reduceMotion}
          />
        ))}
      </G>
    </Svg>
  );
}
