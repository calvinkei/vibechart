/**
 * Candlestick pattern recognizers (TradingView "All Candlestick Patterns" built-in and the per-pattern scripts).
 * Helper definitions follow the built-in (spec §3.131): body average = EMA(14) of the body, doji body ≤ 5 % of the
 * range, shadow factor 2, "has shadow" > 5 % of the body. Pattern conditions are reconstructed from the built-in's
 * documented logic. Trend detection: SMA50 (default) | SMA50, SMA200 | No detection.
 */
import { plotStyle, type IndicatorDefinition, type IndicatorInput, type IndicatorContext, type IndicatorPlot, type ComputeResult } from '../Indicator';
import * as ta from '../ta';

const BULL = '#089981';
const BEAR = '#F23645';
const NEUTRAL = '#787B86';
const TREND_RULES = ['SMA50', 'SMA50, SMA200', 'No detection'];

type Kind = 'bull' | 'bear' | 'neutral';

interface F {
  n: number;
  o: Float64Array; h: Float64Array; l: Float64Array; c: Float64Array; hl2: Float64Array;
  bodyHi: Float64Array; bodyLo: Float64Array; body: Float64Array; bodyAvg: Float64Array;
  small: Uint8Array; long: Uint8Array;
  upSh: Float64Array; dnSh: Float64Array; hasUp: Uint8Array; hasDn: Uint8Array;
  white: Uint8Array; black: Uint8Array; range: Float64Array; mid: Float64Array;
  shEq: Uint8Array; dojiBody: Uint8Array; doji: Uint8Array;
  up: Uint8Array; down: Uint8Array;
}

export function candleFeatures(ctx: IndicatorContext, trendRule: string): F {
  const n = ctx.n;
  const o = ctx.open, h = ctx.high, l = ctx.low, c = ctx.close;
  const bodyHi = new Float64Array(n), bodyLo = new Float64Array(n), body = new Float64Array(n);
  for (let i = 0; i < n; i++) { bodyHi[i] = Math.max(c[i], o[i]); bodyLo[i] = Math.min(c[i], o[i]); body[i] = bodyHi[i] - bodyLo[i]; }
  const bodyAvg = ta.ema(body, 14);
  const f: F = {
    n, o, h, l, c, hl2: ctx.hl2, bodyHi, bodyLo, body, bodyAvg,
    small: new Uint8Array(n), long: new Uint8Array(n), upSh: new Float64Array(n), dnSh: new Float64Array(n),
    hasUp: new Uint8Array(n), hasDn: new Uint8Array(n), white: new Uint8Array(n), black: new Uint8Array(n),
    range: new Float64Array(n), mid: new Float64Array(n), shEq: new Uint8Array(n), dojiBody: new Uint8Array(n), doji: new Uint8Array(n),
    up: new Uint8Array(n), down: new Uint8Array(n),
  };
  const sma50 = trendRule === 'No detection' ? null : ta.sma(c, 50);
  const sma200 = trendRule === 'SMA50, SMA200' ? ta.sma(c, 200) : null;
  for (let i = 0; i < n; i++) {
    f.small[i] = body[i] < bodyAvg[i] ? 1 : 0;
    f.long[i] = body[i] > bodyAvg[i] ? 1 : 0;
    f.upSh[i] = h[i] - bodyHi[i];
    f.dnSh[i] = bodyLo[i] - l[i];
    f.hasUp[i] = f.upSh[i] > 0.05 * body[i] ? 1 : 0;
    f.hasDn[i] = f.dnSh[i] > 0.05 * body[i] ? 1 : 0;
    f.white[i] = o[i] < c[i] ? 1 : 0;
    f.black[i] = o[i] > c[i] ? 1 : 0;
    f.range[i] = h[i] - l[i];
    f.mid[i] = body[i] / 2 + bodyLo[i];
    const u = f.upSh[i], d = f.dnSh[i];
    f.shEq[i] = u === d || ((Math.abs(u - d) / d) * 100 < 100 && (Math.abs(d - u) / u) * 100 < 100) ? 1 : 0;
    f.dojiBody[i] = f.range[i] > 0 && body[i] <= f.range[i] * 0.05 ? 1 : 0;
    f.doji[i] = f.dojiBody[i] && f.shEq[i] ? 1 : 0;
    if (!sma50) { f.up[i] = 1; f.down[i] = 1; }
    else if (sma200) { f.up[i] = c[i] > sma50[i] && sma50[i] > sma200[i] ? 1 : 0; f.down[i] = c[i] < sma50[i] && sma50[i] < sma200[i] ? 1 : 0; }
    else { f.up[i] = c[i] > sma50[i] ? 1 : 0; f.down[i] = c[i] < sma50[i] ? 1 : 0; }
  }
  return f;
}

export interface PatternDef {
  id: string;
  name: string;
  /** short label drawn on the chart */
  label: string;
  kind: Kind;
  /** bars the pattern spans (the test is evaluated on the last bar) */
  bars: number;
  test: (f: F, i: number) => boolean;
}

const T = (a: Uint8Array, i: number) => a[i] === 1;

const marubozuWhite = (f: F, i: number) => T(f.white, i) && T(f.long, i) && f.upSh[i] <= 0.05 * f.body[i] && f.dnSh[i] <= 0.05 * f.body[i];
const marubozuBlack = (f: F, i: number) => T(f.black, i) && T(f.long, i) && f.upSh[i] <= 0.05 * f.body[i] && f.dnSh[i] <= 0.05 * f.body[i];
const hammerShape = (f: F, i: number) => T(f.small, i) && f.body[i] > 0 && f.bodyLo[i] > f.hl2[i] && f.dnSh[i] >= 2 * f.body[i] && !T(f.hasUp, i);
const invHammerShape = (f: F, i: number) => T(f.small, i) && f.body[i] > 0 && f.bodyHi[i] < f.hl2[i] && f.upSh[i] >= 2 * f.body[i] && !T(f.hasDn, i);
const inside = (f: F, i: number) => f.h[i] <= f.bodyHi[i - 1] && f.l[i] >= f.bodyLo[i - 1];
const engulfBull = (f: F, i: number) => T(f.down, i) && T(f.white, i) && T(f.long, i) && T(f.black, i - 1) && T(f.small, i - 1) && f.c[i] >= f.o[i - 1] && f.o[i] <= f.c[i - 1] && (f.c[i] > f.o[i - 1] || f.o[i] < f.c[i - 1]);
const engulfBear = (f: F, i: number) => T(f.up, i) && T(f.black, i) && T(f.long, i) && T(f.white, i - 1) && T(f.small, i - 1) && f.c[i] <= f.o[i - 1] && f.o[i] >= f.c[i - 1] && (f.c[i] < f.o[i - 1] || f.o[i] > f.c[i - 1]);
const haramiBull = (f: F, i: number) => T(f.long, i - 1) && T(f.black, i - 1) && T(f.down, i - 1) && T(f.white, i) && T(f.small, i) && inside(f, i);
const haramiBear = (f: F, i: number) => T(f.long, i - 1) && T(f.white, i - 1) && T(f.up, i - 1) && T(f.black, i) && T(f.small, i) && inside(f, i);
const dragonfly = (f: F, i: number) => T(f.dojiBody, i) && f.upSh[i] <= f.body[i];
const gravestone = (f: F, i: number) => T(f.dojiBody, i) && f.dnSh[i] <= f.body[i];

export const PATTERNS: PatternDef[] = [
  { id: 'abandonedBabyBull', name: 'Abandoned Baby Bullish', label: 'Aband. Baby', kind: 'bull', bars: 3,
    test: (f, i) => T(f.down, i - 2) && T(f.black, i - 2) && T(f.dojiBody, i - 1) && f.h[i - 1] < f.l[i - 2] && T(f.white, i) && f.l[i] > f.h[i - 1] },
  { id: 'abandonedBabyBear', name: 'Abandoned Baby Bearish', label: 'Aband. Baby', kind: 'bear', bars: 3,
    test: (f, i) => T(f.up, i - 2) && T(f.white, i - 2) && T(f.dojiBody, i - 1) && f.l[i - 1] > f.h[i - 2] && T(f.black, i) && f.h[i] < f.l[i - 1] },
  { id: 'darkCloudCover', name: 'Dark Cloud Cover', label: 'Dark Cloud', kind: 'bear', bars: 2,
    test: (f, i) => T(f.up, i - 1) && T(f.white, i - 1) && T(f.long, i - 1) && T(f.black, i) && f.o[i] >= f.h[i - 1] && f.c[i] < f.mid[i - 1] && f.c[i] > f.o[i - 1] },
  { id: 'doji', name: 'Doji', label: 'Doji', kind: 'neutral', bars: 1, test: (f, i) => T(f.doji, i) && !dragonfly(f, i) && !gravestone(f, i) },
  { id: 'dojiStarBull', name: 'Doji Star Bullish', label: 'Doji Star', kind: 'bull', bars: 2,
    test: (f, i) => T(f.down, i) && T(f.black, i - 1) && T(f.long, i - 1) && T(f.dojiBody, i) && f.bodyHi[i] < f.bodyLo[i - 1] },
  { id: 'dojiStarBear', name: 'Doji Star Bearish', label: 'Doji Star', kind: 'bear', bars: 2,
    test: (f, i) => T(f.up, i) && T(f.white, i - 1) && T(f.long, i - 1) && T(f.dojiBody, i) && f.bodyLo[i] > f.bodyHi[i - 1] },
  { id: 'downsideTasukiGap', name: 'Downside Tasuki Gap', label: 'Down Tasuki', kind: 'bear', bars: 3,
    test: (f, i) => T(f.down, i) && T(f.long, i - 2) && T(f.black, i - 2) && T(f.small, i - 1) && T(f.black, i - 1) && f.bodyHi[i - 1] < f.bodyLo[i - 2] && T(f.white, i)
      && f.bodyLo[i] >= f.bodyLo[i - 1] && f.bodyLo[i] <= f.bodyHi[i - 1] && f.bodyHi[i] > f.bodyHi[i - 1] && f.bodyHi[i] < f.bodyLo[i - 2] },
  { id: 'dragonflyDoji', name: 'Dragonfly Doji', label: 'Dragonfly', kind: 'bull', bars: 1, test: dragonfly },
  { id: 'engulfingBull', name: 'Engulfing Bullish', label: 'Engulfing', kind: 'bull', bars: 2, test: engulfBull },
  { id: 'engulfingBear', name: 'Engulfing Bearish', label: 'Engulfing', kind: 'bear', bars: 2, test: engulfBear },
  { id: 'eveningDojiStar', name: 'Evening Doji Star', label: 'Even. Doji', kind: 'bear', bars: 3,
    test: (f, i) => T(f.up, i) && T(f.long, i - 2) && T(f.dojiBody, i - 1) && T(f.long, i) && T(f.white, i - 2) && f.bodyLo[i - 1] > f.bodyHi[i - 2] && T(f.black, i)
      && f.bodyLo[i] <= f.mid[i - 2] && f.bodyLo[i] > f.bodyLo[i - 2] && f.bodyLo[i - 1] > f.bodyHi[i] },
  { id: 'eveningStar', name: 'Evening Star', label: 'Evening Star', kind: 'bear', bars: 3,
    test: (f, i) => T(f.up, i) && T(f.long, i - 2) && T(f.small, i - 1) && T(f.long, i) && T(f.white, i - 2) && f.bodyLo[i - 1] > f.bodyHi[i - 2] && T(f.black, i)
      && f.bodyLo[i] <= f.mid[i - 2] && f.bodyLo[i] > f.bodyLo[i - 2] && f.bodyLo[i - 1] > f.bodyHi[i] },
  { id: 'fallingThreeMethods', name: 'Falling Three Methods', label: 'Falling 3', kind: 'bear', bars: 5,
    test: (f, i) => {
      if (!(T(f.down, i - 4) && T(f.long, i - 4) && T(f.black, i - 4))) return false;
      for (let k = 1; k <= 3; k++) if (!(T(f.small, i - k) && T(f.white, i - k) && f.o[i - k] > f.l[i - 4] && f.c[i - k] < f.h[i - 4])) return false;
      return T(f.long, i) && T(f.black, i) && f.c[i] < f.c[i - 4];
    } },
  { id: 'fallingWindow', name: 'Falling Window', label: 'Falling Win', kind: 'bear', bars: 2,
    test: (f, i) => T(f.down, i - 1) && f.range[i] !== 0 && f.range[i - 1] !== 0 && f.h[i] < f.l[i - 1] },
  { id: 'gravestoneDoji', name: 'Gravestone Doji', label: 'Gravestone', kind: 'bear', bars: 1, test: gravestone },
  { id: 'hammer', name: 'Hammer', label: 'Hammer', kind: 'bull', bars: 1, test: (f, i) => hammerShape(f, i) && T(f.down, i) },
  { id: 'hangingMan', name: 'Hanging Man', label: 'Hanging Man', kind: 'bear', bars: 1, test: (f, i) => hammerShape(f, i) && T(f.up, i) },
  { id: 'haramiBull', name: 'Harami Bullish', label: 'Harami', kind: 'bull', bars: 2, test: haramiBull },
  { id: 'haramiBear', name: 'Harami Bearish', label: 'Harami', kind: 'bear', bars: 2, test: haramiBear },
  { id: 'haramiCrossBull', name: 'Harami Cross Bullish', label: 'Harami X', kind: 'bull', bars: 2,
    test: (f, i) => T(f.long, i - 1) && T(f.black, i - 1) && T(f.down, i - 1) && T(f.dojiBody, i) && inside(f, i) },
  { id: 'haramiCrossBear', name: 'Harami Cross Bearish', label: 'Harami X', kind: 'bear', bars: 2,
    test: (f, i) => T(f.long, i - 1) && T(f.white, i - 1) && T(f.up, i - 1) && T(f.dojiBody, i) && inside(f, i) },
  { id: 'invertedHammer', name: 'Inverted Hammer', label: 'Inv. Hammer', kind: 'bull', bars: 1, test: (f, i) => invHammerShape(f, i) && T(f.down, i) },
  { id: 'kickingBull', name: 'Kicking Bullish', label: 'Kicking', kind: 'bull', bars: 2, test: (f, i) => marubozuBlack(f, i - 1) && marubozuWhite(f, i) && f.l[i] > f.h[i - 1] },
  { id: 'kickingBear', name: 'Kicking Bearish', label: 'Kicking', kind: 'bear', bars: 2, test: (f, i) => marubozuWhite(f, i - 1) && marubozuBlack(f, i) && f.h[i] < f.l[i - 1] },
  { id: 'longLowerShadow', name: 'Long Lower Shadow', label: 'Long Lower', kind: 'bull', bars: 1, test: (f, i) => f.dnSh[i] > f.range[i] * 0.75 },
  { id: 'longUpperShadow', name: 'Long Upper Shadow', label: 'Long Upper', kind: 'bear', bars: 1, test: (f, i) => f.upSh[i] > f.range[i] * 0.75 },
  { id: 'marubozuBlack', name: 'Marubozu Black', label: 'Marubozu', kind: 'bear', bars: 1, test: marubozuBlack },
  { id: 'marubozuWhite', name: 'Marubozu White', label: 'Marubozu', kind: 'bull', bars: 1, test: marubozuWhite },
  { id: 'morningDojiStar', name: 'Morning Doji Star', label: 'Morn. Doji', kind: 'bull', bars: 3,
    test: (f, i) => T(f.down, i) && T(f.long, i - 2) && T(f.dojiBody, i - 1) && T(f.long, i) && T(f.black, i - 2) && f.bodyHi[i - 1] < f.bodyLo[i - 2] && T(f.white, i)
      && f.bodyHi[i] >= f.mid[i - 2] && f.bodyHi[i] < f.bodyHi[i - 2] && f.bodyHi[i - 1] < f.bodyLo[i] },
  { id: 'morningStar', name: 'Morning Star', label: 'Morning Star', kind: 'bull', bars: 3,
    test: (f, i) => T(f.down, i) && T(f.long, i - 2) && T(f.small, i - 1) && T(f.long, i) && T(f.black, i - 2) && f.bodyHi[i - 1] < f.bodyLo[i - 2] && T(f.white, i)
      && f.bodyHi[i] >= f.mid[i - 2] && f.bodyHi[i] < f.bodyHi[i - 2] && f.bodyHi[i - 1] < f.bodyLo[i] },
  { id: 'onNeck', name: 'On Neck', label: 'On Neck', kind: 'bear', bars: 2,
    test: (f, i) => T(f.down, i) && T(f.black, i - 1) && T(f.long, i - 1) && T(f.white, i) && f.o[i] < f.c[i - 1] && T(f.small, i) && f.range[i] !== 0 && Math.abs(f.c[i] - f.l[i - 1]) <= f.bodyAvg[i] * 0.05 },
  { id: 'piercing', name: 'Piercing', label: 'Piercing', kind: 'bull', bars: 2,
    test: (f, i) => T(f.down, i - 1) && T(f.black, i - 1) && T(f.long, i - 1) && T(f.white, i) && f.o[i] <= f.l[i - 1] && f.c[i] > f.mid[i - 1] && f.c[i] < f.o[i - 1] },
  { id: 'risingThreeMethods', name: 'Rising Three Methods', label: 'Rising 3', kind: 'bull', bars: 5,
    test: (f, i) => {
      if (!(T(f.up, i - 4) && T(f.long, i - 4) && T(f.white, i - 4))) return false;
      for (let k = 1; k <= 3; k++) if (!(T(f.small, i - k) && T(f.black, i - k) && f.o[i - k] < f.h[i - 4] && f.c[i - k] > f.l[i - 4])) return false;
      return T(f.long, i) && T(f.white, i) && f.c[i] > f.c[i - 4];
    } },
  { id: 'risingWindow', name: 'Rising Window', label: 'Rising Win', kind: 'bull', bars: 2,
    test: (f, i) => T(f.up, i - 1) && f.range[i] !== 0 && f.range[i - 1] !== 0 && f.l[i] > f.h[i - 1] },
  { id: 'shootingStar', name: 'Shooting Star', label: 'Shooting Star', kind: 'bear', bars: 1, test: (f, i) => invHammerShape(f, i) && T(f.up, i) },
  { id: 'spinningTopBlack', name: 'Spinning Top Black', label: 'Spin. Top', kind: 'neutral', bars: 1,
    test: (f, i) => T(f.black, i) && f.dnSh[i] >= f.range[i] * 0.34 && f.upSh[i] >= f.range[i] * 0.34 && !T(f.dojiBody, i) },
  { id: 'spinningTopWhite', name: 'Spinning Top White', label: 'Spin. Top', kind: 'neutral', bars: 1,
    test: (f, i) => T(f.white, i) && f.dnSh[i] >= f.range[i] * 0.34 && f.upSh[i] >= f.range[i] * 0.34 && !T(f.dojiBody, i) },
  { id: 'threeBlackCrows', name: 'Three Black Crows', label: '3 Crows', kind: 'bear', bars: 3,
    test: (f, i) => T(f.up, i - 3 < 0 ? 0 : i - 3) && T(f.black, i - 2) && T(f.long, i - 2) && T(f.black, i - 1) && T(f.long, i - 1) && T(f.black, i) && T(f.long, i)
      && f.o[i - 1] < f.o[i - 2] && f.o[i - 1] > f.c[i - 2] && f.o[i] < f.o[i - 1] && f.o[i] > f.c[i - 1] && f.c[i - 1] < f.c[i - 2] && f.c[i] < f.c[i - 1]
      && f.dnSh[i - 2] <= 0.05 * f.body[i - 2] && f.dnSh[i - 1] <= 0.05 * f.body[i - 1] && f.dnSh[i] <= 0.05 * f.body[i] },
  { id: 'threeWhiteSoldiers', name: 'Three White Soldiers', label: '3 Soldiers', kind: 'bull', bars: 3,
    test: (f, i) => T(f.down, i - 3 < 0 ? 0 : i - 3) && T(f.white, i - 2) && T(f.long, i - 2) && T(f.white, i - 1) && T(f.long, i - 1) && T(f.white, i) && T(f.long, i)
      && f.o[i - 1] > f.o[i - 2] && f.o[i - 1] < f.c[i - 2] && f.o[i] > f.o[i - 1] && f.o[i] < f.c[i - 1] && f.c[i - 1] > f.c[i - 2] && f.c[i] > f.c[i - 1]
      && f.upSh[i - 2] <= 0.05 * f.body[i - 2] && f.upSh[i - 1] <= 0.05 * f.body[i - 1] && f.upSh[i] <= 0.05 * f.body[i] },
  { id: 'triStarBull', name: 'Tri-Star Bullish', label: 'Tri-Star', kind: 'bull', bars: 3,
    test: (f, i) => T(f.down, i - 2) && T(f.doji, i - 2) && T(f.doji, i - 1) && T(f.doji, i) && f.bodyHi[i - 1] < f.bodyLo[i - 2] && f.bodyHi[i - 1] < f.bodyLo[i] },
  { id: 'triStarBear', name: 'Tri-Star Bearish', label: 'Tri-Star', kind: 'bear', bars: 3,
    test: (f, i) => T(f.up, i - 2) && T(f.doji, i - 2) && T(f.doji, i - 1) && T(f.doji, i) && f.bodyLo[i - 1] > f.bodyHi[i - 2] && f.bodyLo[i - 1] > f.bodyHi[i] },
  { id: 'tweezerBottom', name: 'Tweezer Bottom', label: 'Tweezer Bot', kind: 'bull', bars: 2,
    test: (f, i) => T(f.down, i - 1) && (!T(f.dojiBody, i) || (T(f.hasUp, i) && T(f.hasDn, i))) && Math.abs(f.l[i] - f.l[i - 1]) <= f.bodyAvg[i] * 0.05 && T(f.black, i - 1) && T(f.white, i) && T(f.long, i - 1) },
  { id: 'tweezerTop', name: 'Tweezer Top', label: 'Tweezer Top', kind: 'bear', bars: 2,
    test: (f, i) => T(f.up, i - 1) && (!T(f.dojiBody, i) || (T(f.hasUp, i) && T(f.hasDn, i))) && Math.abs(f.h[i] - f.h[i - 1]) <= f.bodyAvg[i] * 0.05 && T(f.white, i - 1) && T(f.black, i) && T(f.long, i - 1) },
  { id: 'upsideTasukiGap', name: 'Upside Tasuki Gap', label: 'Up Tasuki', kind: 'bull', bars: 3,
    test: (f, i) => T(f.up, i) && T(f.long, i - 2) && T(f.white, i - 2) && T(f.small, i - 1) && T(f.white, i - 1) && f.bodyLo[i - 1] > f.bodyHi[i - 2] && T(f.black, i)
      && f.bodyHi[i] <= f.bodyHi[i - 1] && f.bodyHi[i] >= f.bodyLo[i - 1] && f.bodyLo[i] < f.bodyLo[i - 1] && f.bodyLo[i] > f.bodyHi[i - 2] },
  // Not TradingView built-ins (textbook confirmations of harami / engulfing), added because they were requested.
  { id: 'threeInsideUp', name: 'Three Inside Up', label: '3 Inside', kind: 'bull', bars: 3, test: (f, i) => haramiBull(f, i - 1) && T(f.white, i) && f.c[i] > f.bodyHi[i - 2] },
  { id: 'threeInsideDown', name: 'Three Inside Down', label: '3 Inside', kind: 'bear', bars: 3, test: (f, i) => haramiBear(f, i - 1) && T(f.black, i) && f.c[i] < f.bodyLo[i - 2] },
  { id: 'threeOutsideUp', name: 'Three Outside Up', label: '3 Outside', kind: 'bull', bars: 3, test: (f, i) => engulfBull(f, i - 1) && T(f.white, i) && f.c[i] > f.c[i - 1] },
  { id: 'threeOutsideDown', name: 'Three Outside Down', label: '3 Outside', kind: 'bear', bars: 3, test: (f, i) => engulfBear(f, i - 1) && T(f.black, i) && f.c[i] < f.c[i - 1] },
];

const byId = new Map(PATTERNS.map((p) => [p.id, p]));

/** Evaluate one pattern over all bars: 1 where detected, NaN elsewhere. */
export function detectPattern(f: F, p: PatternDef): Float64Array {
  const out = ta.nanArray(f.n);
  for (let i = p.bars - 1; i < f.n; i++) if (p.test(f, i)) out[i] = 1;
  return out;
}

function shapeStyle(kind: Kind) {
  return plotStyle({
    type: 'shapes', color: kind === 'bull' ? BULL : kind === 'bear' ? BEAR : NEUTRAL,
    shape: kind === 'bull' ? 'labelUp' : 'labelDown', location: kind === 'bull' ? 'belowBar' : 'aboveBar', size: 'small', showLast: false,
  });
}

const trendInput: IndicatorInput = { id: 'trendRule', name: 'Detect Trend Based On', type: 'select', defval: 'SMA50', options: TREND_RULES };

interface StudySpec { id: string; patterns: string[]; aliases?: string[] }

const STUDIES: StudySpec[] = [
  { id: 'Doji', patterns: ['doji'] },
  { id: 'Hammer', patterns: ['hammer'], aliases: ['Hammer - Bullish'] },
  { id: 'Inverted Hammer', patterns: ['invertedHammer'], aliases: ['Inverted Hammer - Bullish'] },
  { id: 'Hanging Man', patterns: ['hangingMan'], aliases: ['Hanging Man - Bearish'] },
  { id: 'Shooting Star', patterns: ['shootingStar'], aliases: ['Shooting Star - Bearish'] },
  { id: 'Bullish Engulfing', patterns: ['engulfingBull'], aliases: ['Engulfing - Bullish'] },
  { id: 'Bearish Engulfing', patterns: ['engulfingBear'], aliases: ['Engulfing - Bearish'] },
  { id: 'Bullish Harami', patterns: ['haramiBull'], aliases: ['Harami - Bullish'] },
  { id: 'Bearish Harami', patterns: ['haramiBear'], aliases: ['Harami - Bearish'] },
  { id: 'Harami Cross', patterns: ['haramiCrossBull', 'haramiCrossBear'], aliases: ['Harami Cross - Bullish', 'Harami Cross - Bearish'] },
  { id: 'Morning Star', patterns: ['morningStar'], aliases: ['Morning Star - Bullish'] },
  { id: 'Evening Star', patterns: ['eveningStar'], aliases: ['Evening Star - Bearish'] },
  { id: 'Morning Doji Star', patterns: ['morningDojiStar'], aliases: ['Morning Doji Star - Bullish'] },
  { id: 'Evening Doji Star', patterns: ['eveningDojiStar'], aliases: ['Evening Doji Star - Bearish'] },
  { id: 'Doji Star', patterns: ['dojiStarBull', 'dojiStarBear'], aliases: ['Doji Star - Bullish', 'Doji Star - Bearish'] },
  { id: 'Three White Soldiers', patterns: ['threeWhiteSoldiers'], aliases: ['Three White Soldiers - Bullish'] },
  { id: 'Three Black Crows', patterns: ['threeBlackCrows'], aliases: ['Three Black Crows - Bearish'] },
  { id: 'Piercing', patterns: ['piercing'], aliases: ['Piercing - Bullish'] },
  { id: 'Dark Cloud Cover', patterns: ['darkCloudCover'], aliases: ['Dark Cloud Cover - Bearish'] },
  { id: 'Marubozu', patterns: ['marubozuWhite', 'marubozuBlack'], aliases: ['Marubozu White - Bullish', 'Marubozu Black - Bearish', 'Marubozu White', 'Marubozu Black'] },
  { id: 'Spinning Top', patterns: ['spinningTopWhite', 'spinningTopBlack'], aliases: ['Spinning Top White', 'Spinning Top Black'] },
  { id: 'Dragonfly Doji', patterns: ['dragonflyDoji'], aliases: ['Dragonfly Doji - Bullish'] },
  { id: 'Gravestone Doji', patterns: ['gravestoneDoji'], aliases: ['Gravestone Doji - Bearish'] },
  { id: 'Long Lower Shadow', patterns: ['longLowerShadow'], aliases: ['Long Lower Shadow - Bullish'] },
  { id: 'Long Upper Shadow', patterns: ['longUpperShadow'], aliases: ['Long Upper Shadow - Bearish'] },
  { id: 'Tweezer Top', patterns: ['tweezerTop'], aliases: ['Tweezer Top - Bearish'] },
  { id: 'Tweezer Bottom', patterns: ['tweezerBottom'], aliases: ['Tweezer Bottom - Bullish'] },
  { id: 'Kicking', patterns: ['kickingBull', 'kickingBear'], aliases: ['Kicking - Bullish', 'Kicking - Bearish'] },
  { id: 'Abandoned Baby', patterns: ['abandonedBabyBull', 'abandonedBabyBear'], aliases: ['Abandoned Baby - Bullish', 'Abandoned Baby - Bearish'] },
  { id: 'Tri-Star', patterns: ['triStarBull', 'triStarBear'], aliases: ['Tri-Star - Bullish', 'Tri-Star - Bearish', 'TriStar'] },
  { id: 'Rising Three Methods', patterns: ['risingThreeMethods'], aliases: ['Rising Three Methods - Bullish'] },
  { id: 'Falling Three Methods', patterns: ['fallingThreeMethods'], aliases: ['Falling Three Methods - Bearish'] },
  { id: 'Rising Window', patterns: ['risingWindow'], aliases: ['Rising Window - Bullish'] },
  { id: 'Falling Window', patterns: ['fallingWindow'], aliases: ['Falling Window - Bearish'] },
  { id: 'Upside Tasuki Gap', patterns: ['upsideTasukiGap'], aliases: ['Upside Tasuki Gap - Bullish'] },
  { id: 'Downside Tasuki Gap', patterns: ['downsideTasukiGap'], aliases: ['Downside Tasuki Gap - Bearish'] },
  { id: 'On Neck', patterns: ['onNeck'], aliases: ['On Neck - Bearish'] },
  { id: 'Three Inside', patterns: ['threeInsideUp', 'threeInsideDown'], aliases: ['Three Inside Up', 'Three Inside Down'] },
  { id: 'Three Outside', patterns: ['threeOutsideUp', 'threeOutsideDown'], aliases: ['Three Outside Up', 'Three Outside Down'] },
];

function makeStudy(s: StudySpec): IndicatorDefinition {
  const pats = s.patterns.map((id) => byId.get(id)!);
  const plots: IndicatorPlot[] = pats.map((p) => ({ id: p.id, title: p.name, style: shapeStyle(p.kind) }));
  return {
    id: s.id, name: s.id, shortName: s.id, category: 'Candlestick Patterns', overlay: true, aliases: s.aliases,
    inputs: [trendInput],
    plots,
    compute(ctx, inp) {
      const f = candleFeatures(ctx, inp.trendRule);
      const out: ComputeResult = {};
      for (const p of pats) {
        const values = detectPattern(f, p);
        const texts: Array<string | null> = new Array(ctx.n).fill(null);
        for (let i = 0; i < ctx.n; i++) if (values[i] === 1) texts[i] = p.label;
        out[p.id] = { values, texts };
      }
      return out;
    },
  };
}

function toggleId(s: StudySpec): string { return 'show' + s.id.replace(/[^A-Za-z0-9]/g, ''); }

const allPatterns: IndicatorDefinition = {
  id: 'All Candlestick Patterns', name: 'All Candlestick Patterns', shortName: 'All Candlestick Patterns', category: 'Candlestick Patterns', overlay: true, aliases: ['Candlestick Patterns'],
  inputs: [
    trendInput,
    { id: 'patternType', name: 'Pattern Type', type: 'select', defval: 'Both', options: ['Both', 'Bullish', 'Bearish'] },
    ...STUDIES.map((s): IndicatorInput => ({ id: toggleId(s), name: s.id, type: 'bool', defval: true, group: 'Patterns' })),
  ],
  plots: [
    { id: 'bullish', title: 'Bullish', style: shapeStyle('bull') },
    { id: 'bearish', title: 'Bearish', style: shapeStyle('bear') },
    { id: 'neutral', title: 'Neutral', style: shapeStyle('neutral') },
  ],
  compute(ctx, inp) {
    const n = ctx.n;
    const f = candleFeatures(ctx, inp.trendRule);
    const mk = () => ({ values: ta.nanArray(n), texts: new Array<string | null>(n).fill(null) });
    const bull = mk(), bear = mk(), neutral = mk();
    const wantBull = inp.patternType !== 'Bearish', wantBear = inp.patternType !== 'Bullish';
    for (const s of STUDIES) {
      if (inp[toggleId(s)] === false) continue;
      for (const pid of s.patterns) {
        const p = byId.get(pid)!;
        if (p.kind === 'bull' && !wantBull) continue;
        if (p.kind === 'bear' && !wantBear) continue;
        const target = p.kind === 'bull' ? bull : p.kind === 'bear' ? bear : neutral;
        for (let i = p.bars - 1; i < n; i++) {
          if (!p.test(f, i)) continue;
          target.values[i] = 1;
          target.texts[i] = target.texts[i] ? `${target.texts[i]} / ${p.label}` : p.label;
        }
      }
    }
    return { bullish: bull, bearish: bear, neutral };
  },
};

export const candlestickPatternsIndicators: IndicatorDefinition[] = [allPatterns, ...STUDIES.map(makeStudy)];
