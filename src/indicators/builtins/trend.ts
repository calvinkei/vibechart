import { plotStyle, type IndicatorDefinition, type IndicatorContext, type ComputeResult } from '../Indicator';

/**
 * Trend indicators (spec docs/research/03-indicators.md §3.5–3.8, 3.21–3.25, 3.33, 3.35, 3.39, 3.47, 3.49, 3.53, 3.72, 3.74,
 * 3.76, 3.99, 3.111, 3.118, 3.121, 3.122, 3.124, 3.126, 3.127 and the Pine listings in §11.7–11.9, 11.12).
 */

const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];
const isNum = (v: number): boolean => v === v && v !== Infinity && v !== -Infinity;

function priceDecimals(minMove: number): number {
  if (!(minMove > 0)) return 2;
  return Math.max(0, Math.min(8, Math.round(-Math.log10(minMove))));
}
function fmtPrice(v: number, minMove: number): string { return v.toFixed(priceDecimals(minMove)); }
function fmtVolume(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(0);
}

/** Pine `donchian(len) => math.avg(ta.lowest(len), ta.highest(len))`. */
function donchianMid(ctx: IndicatorContext, len: number): Float64Array {
  const hh = ctx.ta.highest(ctx.high, len), ll = ctx.ta.lowest(ctx.low, len);
  const out = ctx.ta.nanArray(ctx.n);
  for (let i = 0; i < ctx.n; i++) out[i] = (hh[i] + ll[i]) / 2;
  return out;
}

/**
 * Split two series into "a > b" and "a <= b" halves for two single-colour fills (the renderer has one colour per fill).
 * Bar i is included in a half when either bar i or bar i+1 satisfies it, so each fill segment [i, i+1] takes the colour
 * of bar i+1 — Pine's `fill(p1, p2, color = cond ? green : red)` semantics without gaps at crossings.
 */
function splitFill(a: Float64Array, b: Float64Array): { aUp: Float64Array; bUp: Float64Array; aDn: Float64Array; bDn: Float64Array } {
  const n = a.length;
  const aUp = new Float64Array(n).fill(NaN), bUp = new Float64Array(n).fill(NaN), aDn = new Float64Array(n).fill(NaN), bDn = new Float64Array(n).fill(NaN);
  const up = new Uint8Array(n);
  for (let i = 0; i < n; i++) up[i] = a[i] > b[i] ? 1 : 0;
  for (let i = 0; i < n; i++) {
    if (!isNum(a[i]) || !isNum(b[i])) continue;
    const next = i + 1 < n && isNum(a[i + 1]) && isNum(b[i + 1]);
    if (up[i] || (next && up[i + 1])) { aUp[i] = a[i]; bUp[i] = b[i]; }
    if (!up[i] || (next && !up[i + 1])) { aDn[i] = a[i]; bDn[i] = b[i]; }
  }
  return { aUp, bUp, aDn, bDn };
}

/** DMI / ADX exactly as the built-in: `ta.tr` (first bar na), RMA smoothing, fixnan on the DI lines. */
function dmiSeries(ctx: IndicatorContext, diLen: number, adxLen: number): { plus: Float64Array; minus: Float64Array; adx: Float64Array } {
  const { high, low, close, n, ta } = ctx;
  const plusDM = ta.nanArray(n), minusDM = ta.nanArray(n);
  for (let i = 1; i < n; i++) {
    const up = high[i] - high[i - 1], down = low[i - 1] - low[i];
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }
  const trur = ta.rma(ta.tr(high, low, close, false), diLen);
  const pr = ta.rma(plusDM, diLen), mr = ta.rma(minusDM, diLen);
  const plusRaw = ta.nanArray(n), minusRaw = ta.nanArray(n);
  for (let i = 0; i < n; i++) { plusRaw[i] = (100 * pr[i]) / trur[i]; minusRaw[i] = (100 * mr[i]) / trur[i]; }
  const plus = ta.fixnan(plusRaw), minus = ta.fixnan(minusRaw);
  const dx = ta.nanArray(n);
  for (let i = 0; i < n; i++) {
    if (!isNum(plus[i]) || !isNum(minus[i])) continue;
    const s = plus[i] + minus[i];
    dx[i] = Math.abs(plus[i] - minus[i]) / (s === 0 ? 1 : s);
  }
  const adxR = ta.rma(dx, adxLen);
  const adx = ta.nanArray(n);
  for (let i = 0; i < n; i++) adx[i] = 100 * adxR[i];
  return { plus, minus, adx };
}

/** Williams Fractal flags (1 on the centre bar), ported from the built-in's frontier logic (§11.9). */
function fractalFlags(src: Float64Array, n: number, periods: number, up: boolean): Float64Array {
  const len = src.length;
  const out = new Float64Array(len).fill(NaN);
  const N = periods;
  for (let c = 0; c < len; c++) {
    const H = (k: number): number => (c - k >= 0 ? src[c - k] : NaN);
    const centre = H(N);
    if (!isNum(centre)) continue;
    // "before" = strictly beyond the centre on the newer side; "beyond-equal" tolerates runs of equal values on the older side
    const lt = (v: number): boolean => (up ? v < centre : v > centre);
    const le = (v: number): boolean => (up ? v <= centre : v >= centre);
    let downFrontier = true;
    const upF = [true, true, true, true, true];
    for (let i = 1; i <= N; i++) {
      downFrontier = downFrontier && lt(H(N - i));
      upF[0] = upF[0] && lt(H(N + i));
      upF[1] = upF[1] && le(H(N + 1)) && lt(H(N + i + 1));
      upF[2] = upF[2] && le(H(N + 1)) && le(H(N + 2)) && lt(H(N + i + 2));
      upF[3] = upF[3] && le(H(N + 1)) && le(H(N + 2)) && le(H(N + 3)) && lt(H(N + i + 3));
      upF[4] = upF[4] && le(H(N + 1)) && le(H(N + 2)) && le(H(N + 3)) && le(H(N + 4)) && lt(H(N + i + 4));
    }
    if (downFrontier && (upF[0] || upF[1] || upF[2] || upF[3] || upF[4])) out[c - N] = 1;
  }
  void n;
  return out;
}

/** Fill `out` with the straight segment from (b0, p0) to (b1, p1) (inclusive). */
function segment(out: Float64Array, b0: number, p0: number, b1: number, p1: number): void {
  if (b1 <= b0) { out[b1] = p1; return; }
  const span = b1 - b0;
  for (let i = b0; i <= b1; i++) out[i] = p0 + ((p1 - p0) * (i - b0)) / span;
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236];
const FIB_COLORS = ['#787B86', '#F23645', '#FF9800', '#4CAF50', '#089981', '#00BCD4', '#787B86', '#2962FF', '#F23645', '#9C27B0', '#E91E63'];

/** Auto Fib Retracement / Extension built on the Zig Zag engine (§3.126 / §3.127). */
function autoFibDef(mode: 'retracement' | 'extension'): IndicatorDefinition {
  const id = mode === 'retracement' ? 'Auto Fib Retracement' : 'Auto Fib Extension';
  return {
    id, name: id, shortName: mode === 'retracement' ? 'Auto Fib' : 'Auto Fib Ext', category: 'Trend', overlay: true,
    inputs: [
      { id: 'deviation', name: 'Deviation', type: 'float', defval: 3, min: 0.00001, max: 100, step: 0.5 },
      { id: 'depth', name: 'Depth', type: 'int', defval: 10, min: 2 },
      { id: 'extendLines', name: 'Extend Lines', type: 'bool', defval: false },
      { id: 'reverse', name: 'Reverse', type: 'bool', defval: false },
    ],
    plots: FIB_LEVELS.map((lv, k) => ({ id: `level${k}`, title: String(lv), style: plotStyle({ color: FIB_COLORS[k], showLast: false }) })),
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta, high, low } = ctx;
      const { pivots } = ta.zigzag(high, low, inp.deviation, inp.depth);
      const out: ComputeResult = {};
      const series = FIB_LEVELS.map(() => ta.nanArray(n));
      let base = NaN, leg = NaN, fromBar = -1;
      if (mode === 'retracement' && pivots.length >= 2) {
        const p1 = pivots[pivots.length - 2], p2 = pivots[pivots.length - 1];
        let start = p1.price, end = p2.price;
        if (inp.reverse) { const t = start; start = end; end = t; }
        base = end; leg = start - end; fromBar = p2.bar;
      } else if (mode === 'extension' && pivots.length >= 3) {
        const p1 = pivots[pivots.length - 3], p2 = pivots[pivots.length - 2], p3 = pivots[pivots.length - 1];
        base = p3.price; leg = p2.price - p1.price; if (inp.reverse) leg = -leg; fromBar = p3.bar;
      }
      if (fromBar >= 0) {
        const from = inp.extendLines ? 0 : fromBar;
        for (let k = 0; k < FIB_LEVELS.length; k++) {
          const price = base + leg * FIB_LEVELS[k];
          for (let i = from; i < n; i++) series[k][i] = price;
        }
      }
      for (let k = 0; k < FIB_LEVELS.length; k++) out[`level${k}`] = series[k];
      return out;
    },
  };
}

const CHOP_ZONE_COLORS = {
  turquoise: '#26C6DA', darkGreen: '#43A047', paleGreen: '#A5D6A7', lime: '#009688',
  darkRed: '#D50000', red: '#E91E63', orange: '#FF6D00', lightOrange: '#FFB74D', yellow: '#FDD835',
};

export const trendIndicators: IndicatorDefinition[] = [
  {
    id: 'Ichimoku Cloud', name: 'Ichimoku Cloud', shortName: 'Ichimoku', category: 'Trend', overlay: true, aliases: ['Ichimoku'],
    inputs: [
      { id: 'conversion', name: 'Conversion Line Length', type: 'int', defval: 9, min: 1 },
      { id: 'base', name: 'Base Line Length', type: 'int', defval: 26, min: 1 },
      { id: 'spanB', name: 'Leading Span B Length', type: 'int', defval: 52, min: 1 },
      { id: 'displacement', name: 'Lagging Span', type: 'int', defval: 26, min: 1 },
    ],
    // Style offsets assume the default displacement 26 (±25); compute() shifts values by the difference for other inputs.
    plots: [
      { id: 'conversion', title: 'Conversion Line', style: plotStyle({ color: '#2962FF' }) },
      { id: 'base', title: 'Base Line', style: plotStyle({ color: '#B71C1C' }) },
      { id: 'lagging', title: 'Lagging Span', style: plotStyle({ color: '#43A047', offset: -25 }) },
      { id: 'leadA', title: 'Leading Span A', style: plotStyle({ color: '#A5D6A7', offset: 25 }) },
      { id: 'leadB', title: 'Leading Span B', style: plotStyle({ color: '#EF9A9A', offset: 25 }) },
      { id: 'cloudUpA', title: 'Leading Span Background', style: plotStyle({ type: 'none', color: '#43A047', offset: 25, showLast: false }), hideInLegend: true },
      { id: 'cloudUpB', title: 'Leading Span Background', style: plotStyle({ type: 'none', color: '#43A047', offset: 25, showLast: false }), hideInLegend: true },
      { id: 'cloudDnA', title: 'Leading Span Background', style: plotStyle({ type: 'none', color: '#F44336', offset: 25, showLast: false }), hideInLegend: true },
      { id: 'cloudDnB', title: 'Leading Span Background', style: plotStyle({ type: 'none', color: '#F44336', offset: 25, showLast: false }), hideInLegend: true },
    ],
    fills: [
      { id: 'cloudUp', title: 'Cloud (A > B)', a: 'cloudUpA', b: 'cloudUpB', color: '#43A047', transparency: 90, visible: true },
      { id: 'cloudDown', title: 'Cloud (A < B)', a: 'cloudDnA', b: 'cloudDnB', color: '#F44336', transparency: 90, visible: true },
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta } = ctx;
      const conversion = donchianMid(ctx, inp.conversion);
      const base = donchianMid(ctx, inp.base);
      const leadA = ta.nanArray(n);
      for (let i = 0; i < n; i++) leadA[i] = (conversion[i] + base[i]) / 2;
      const leadB = donchianMid(ctx, inp.spanB);
      const delta = inp.displacement - 26;
      const lagging = ta.shiftSeriesTrend(ctx.close, -delta);
      const a = ta.shiftSeriesTrend(leadA, delta), b = ta.shiftSeriesTrend(leadB, delta);
      const cloud = splitFill(a, b);
      return { conversion, base, lagging, leadA: a, leadB: b, cloudUpA: cloud.aUp, cloudUpB: cloud.bUp, cloudDnA: cloud.aDn, cloudDnB: cloud.bDn };
    },
  },
  {
    id: 'Supertrend', name: 'Supertrend', shortName: 'Supertrend', category: 'Trend', overlay: true, aliases: ['SuperTrend'],
    inputs: [
      { id: 'atrLength', name: 'ATR Length', type: 'int', defval: 10, min: 1 },
      { id: 'factor', name: 'Factor', type: 'float', defval: 3, min: 0.01, step: 0.01 },
    ],
    plots: [
      { id: 'up', title: 'Up Trend', style: plotStyle({ color: '#089981' }) },
      { id: 'down', title: 'Down Trend', style: plotStyle({ color: '#F23645' }) },
      { id: 'bodyMiddle', title: 'Body Middle', style: plotStyle({ type: 'none', color: '#787B86', showLast: false }), hideInLegend: true },
    ],
    fills: [
      { id: 'upFill', title: 'Up Trend Fill', a: 'bodyMiddle', b: 'up', color: '#089981', transparency: 90, visible: true },
      { id: 'downFill', title: 'Down Trend Fill', a: 'bodyMiddle', b: 'down', color: '#F23645', transparency: 90, visible: true },
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta } = ctx;
      const st = ta.supertrend(ctx.high, ctx.low, ctx.close, inp.factor, inp.atrLength);
      const up = ta.nanArray(n), down = ta.nanArray(n), bodyMiddle = ta.nanArray(n);
      for (let i = 0; i < n; i++) {
        if (i === 0) continue; // barstate.isfirst ? na
        const v = st.line[i];
        if (!isNum(v)) continue;
        if (st.direction[i] < 0) up[i] = v; else down[i] = v;
        bodyMiddle[i] = (ctx.open[i] + ctx.close[i]) / 2;
      }
      return { up, down, bodyMiddle };
    },
  },
  {
    id: 'Parabolic SAR', name: 'Parabolic SAR', shortName: 'SAR', category: 'Trend', overlay: true, aliases: ['SAR', 'PSAR'],
    inputs: [
      { id: 'start', name: 'Start', type: 'float', defval: 0.02, min: 0, step: 0.01 },
      { id: 'increment', name: 'Increment', type: 'float', defval: 0.02, min: 0, step: 0.01 },
      { id: 'maximum', name: 'Max Value', type: 'float', defval: 0.2, min: 0, step: 0.01 },
    ],
    plots: [{ id: 'sar', title: 'ParabolicSAR', style: plotStyle({ type: 'cross', color: '#2962FF' }) }],
    precision: 'inherit',
    compute(ctx, inp) {
      return { sar: ctx.ta.sarPine(ctx.high, ctx.low, ctx.close, inp.start, inp.increment, inp.maximum) };
    },
  },
  {
    id: 'Average Directional Index', name: 'Average Directional Index', shortName: 'ADX', category: 'Trend', overlay: false, aliases: ['ADX'],
    inputs: [
      { id: 'adxSmoothing', name: 'ADX Smoothing', type: 'int', defval: 14, min: 1, max: 50 },
      { id: 'diLength', name: 'DI Length', type: 'int', defval: 14, min: 1 },
    ],
    plots: [{ id: 'adx', title: 'ADX', style: plotStyle({ color: '#F50057' }) }],
    precision: 2,
    compute(ctx, inp) {
      return { adx: dmiSeries(ctx, inp.diLength, inp.adxSmoothing).adx };
    },
  },
  {
    id: 'Directional Movement Index', name: 'Directional Movement Index', shortName: 'DMI', category: 'Trend', overlay: false, aliases: ['DMI', 'Directional Movement'],
    inputs: [
      { id: 'adxSmoothing', name: 'ADX Smoothing', type: 'int', defval: 14, min: 1, max: 50 },
      { id: 'diLength', name: 'DI Length', type: 'int', defval: 14, min: 1 },
    ],
    plots: [
      { id: 'adx', title: 'ADX', style: plotStyle({ color: '#F50057' }) },
      { id: 'plus', title: '+DI', style: plotStyle({ color: '#2962FF' }) },
      { id: 'minus', title: '-DI', style: plotStyle({ color: '#FF6D00' }) },
    ],
    precision: 4,
    compute(ctx, inp) {
      const r = dmiSeries(ctx, inp.diLength, inp.adxSmoothing);
      return { adx: r.adx, plus: r.plus, minus: r.minus };
    },
  },
  {
    id: 'Aroon', name: 'Aroon', shortName: 'Aroon', category: 'Trend', overlay: false, aliases: ['Aroon Indicator'],
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 14, min: 1 }],
    plots: [
      { id: 'up', title: 'Aroon Up', style: plotStyle({ color: '#FB8C00' }) },
      { id: 'down', title: 'Aroon Down', style: plotStyle({ color: '#2962FF' }) },
    ],
    precision: 2,
    compute(ctx, inp) {
      const r = ctx.ta.aroon(ctx.high, ctx.low, inp.length);
      return { up: r.up, down: r.down };
    },
  },
  {
    id: 'Aroon Oscillator', name: 'Aroon Oscillator', shortName: 'Aroon Osc', category: 'Trend', overlay: false,
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 14, min: 1 }],
    plots: [{ id: 'osc', title: 'Aroon Oscillator', style: plotStyle({ color: '#089981' }) }],
    bands: [
      { id: 'upper', title: 'Upper Band', value: 90, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'zero', title: 'Zero', value: 0, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'lower', title: 'Lower Band', value: -90, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      const r = ctx.ta.aroon(ctx.high, ctx.low, inp.length);
      const osc = ctx.ta.nanArray(ctx.n);
      const colors: Array<string | null> = new Array(ctx.n).fill(null);
      for (let i = 0; i < ctx.n; i++) {
        osc[i] = r.up[i] - r.down[i];
        if (isNum(osc[i])) colors[i] = osc[i] >= 0 ? '#089981' : '#F23645';
      }
      return { osc: { values: osc, colors } };
    },
  },
  {
    id: 'Donchian Channels', name: 'Donchian Channels', shortName: 'DC', category: 'Trend', overlay: true, aliases: ['DC', 'Donchian'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 20, min: 1 },
      { id: 'offset', name: 'Offset', type: 'int', defval: 0, min: -500, max: 500 },
    ],
    plots: [
      { id: 'basis', title: 'Basis', style: plotStyle({ color: '#FF6D00' }) },
      { id: 'upper', title: 'Upper', style: plotStyle({ color: '#2962FF' }) },
      { id: 'lower', title: 'Lower', style: plotStyle({ color: '#2962FF' }) },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#2196F3', transparency: 95, visible: true }],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta } = ctx;
      const upper = ta.highest(ctx.high, inp.length), lower = ta.lowest(ctx.low, inp.length);
      const basis = ta.nanArray(n);
      for (let i = 0; i < n; i++) basis[i] = (upper[i] + lower[i]) / 2;
      return { basis: ta.shiftSeriesTrend(basis, inp.offset), upper: ta.shiftSeriesTrend(upper, inp.offset), lower: ta.shiftSeriesTrend(lower, inp.offset) };
    },
  },
  {
    id: 'Envelope', name: 'Envelope', shortName: 'Env', category: 'Trend', overlay: true, aliases: ['Envelopes', 'Env'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 20, min: 1 },
      { id: 'percent', name: 'Percent', type: 'float', defval: 10, min: 0, step: 0.5 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'exponential', name: 'Exponential', type: 'bool', defval: false },
    ],
    plots: [
      { id: 'basis', title: 'Basis', style: plotStyle({ color: '#FF6D00' }) },
      { id: 'upper', title: 'Upper', style: plotStyle({ color: '#2962FF' }) },
      { id: 'lower', title: 'Lower', style: plotStyle({ color: '#2962FF' }) },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#2196F3', transparency: 95, visible: true }],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta } = ctx;
      const src = ctx.source(inp.source);
      const basis = inp.exponential ? ta.ema(src, inp.length) : ta.sma(src, inp.length);
      const k = inp.percent / 100;
      const upper = ta.nanArray(n), lower = ta.nanArray(n);
      for (let i = 0; i < n; i++) { upper[i] = basis[i] * (1 + k); lower[i] = basis[i] * (1 - k); }
      return { basis, upper, lower };
    },
  },
  {
    id: 'Keltner Channels', name: 'Keltner Channels', shortName: 'KC', category: 'Trend', overlay: true, aliases: ['KC', 'Keltner'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 20, min: 1 },
      { id: 'mult', name: 'Multiplier', type: 'float', defval: 2, min: 0, step: 0.1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'useEma', name: 'Use Exponential MA', type: 'bool', defval: true },
      { id: 'bandsStyle', name: 'Bands Style', type: 'select', defval: 'Average True Range', options: ['Average True Range', 'True Range', 'Range'] },
      { id: 'atrLength', name: 'ATR Length', type: 'int', defval: 10, min: 1 },
    ],
    plots: [
      { id: 'upper', title: 'Upper', style: plotStyle({ color: '#2962FF' }) },
      { id: 'basis', title: 'Basis', style: plotStyle({ color: '#2962FF' }) },
      { id: 'lower', title: 'Lower', style: plotStyle({ color: '#2962FF' }) },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#2196F3', transparency: 95, visible: true }],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta, high, low, close } = ctx;
      const src = ctx.source(inp.source);
      const ma = inp.useEma ? ta.ema(src, inp.length) : ta.sma(src, inp.length);
      let rangema: Float64Array;
      if (inp.bandsStyle === 'True Range') rangema = ta.tr(high, low, close, true);
      else if (inp.bandsStyle === 'Range') { const hl = ta.nanArray(n); for (let i = 0; i < n; i++) hl[i] = high[i] - low[i]; rangema = ta.rma(hl, inp.length); }
      else rangema = ta.atr(high, low, close, inp.atrLength);
      const upper = ta.nanArray(n), lower = ta.nanArray(n);
      for (let i = 0; i < n; i++) { upper[i] = ma[i] + rangema[i] * inp.mult; lower[i] = ma[i] - rangema[i] * inp.mult; }
      return { upper, basis: ma, lower };
    },
  },
  {
    id: 'Price Channel', name: 'Price Channel', shortName: 'Price Channel', category: 'Trend', overlay: true,
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 20, min: 1 },
      { id: 'offset', name: 'Offset', type: 'int', defval: 0, min: -500, max: 500 },
    ],
    plots: [
      { id: 'high', title: 'High Price', style: plotStyle({ color: '#F50057' }) },
      { id: 'low', title: 'Low Price', style: plotStyle({ color: '#F50057' }) },
      { id: 'center', title: 'Center Price', style: plotStyle({ color: '#2196F3' }) },
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta } = ctx;
      const hi = ta.highest(ctx.high, inp.length), lo = ta.lowest(ctx.low, inp.length);
      const center = ta.nanArray(n);
      for (let i = 0; i < n; i++) center[i] = (hi[i] + lo[i]) / 2;
      return { high: ta.shiftSeriesTrend(hi, inp.offset), low: ta.shiftSeriesTrend(lo, inp.offset), center: ta.shiftSeriesTrend(center, inp.offset) };
    },
  },
  {
    id: 'Linear Regression Channel', name: 'Linear Regression Channel', shortName: 'LinReg', category: 'Trend', overlay: true, aliases: ['Linear Regression Channel', 'LinReg Channel'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 100, min: 2, max: 5000 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'useUpperDev', name: 'Upper Deviation', type: 'bool', defval: true, group: 'Channel Settings', inline: 'upper' },
      { id: 'upperMult', name: 'Upper Deviation Multiplier', type: 'float', defval: 2, min: 0, step: 0.1, group: 'Channel Settings', inline: 'upper' },
      { id: 'useLowerDev', name: 'Lower Deviation', type: 'bool', defval: true, group: 'Channel Settings', inline: 'lower' },
      { id: 'lowerMult', name: 'Lower Deviation Multiplier', type: 'float', defval: 2, min: 0, step: 0.1, group: 'Channel Settings', inline: 'lower' },
      { id: 'showPearson', name: "Show Pearson's R", type: 'bool', defval: true, group: 'Display' },
      { id: 'extendLeft', name: 'Extend Lines Left', type: 'bool', defval: false, group: 'Display' },
      { id: 'extendRight', name: 'Extend Lines Right', type: 'bool', defval: true, group: 'Display' },
    ],
    plots: [
      { id: 'upper', title: 'Upper Channel', style: plotStyle({ color: '#2196F3', showLast: false }) },
      { id: 'base', title: 'Base Line', style: plotStyle({ color: '#F23645', showLast: false }) },
      { id: 'lower', title: 'Lower Channel', style: plotStyle({ color: '#F23645', showLast: false }) },
      { id: 'pearson', title: "Pearson's R", style: plotStyle({ type: 'chars', color: '#B2B5BE', showLast: false }), hideInLegend: true },
    ],
    fills: [
      { id: 'upperFill', title: 'Upper Channel Fill', a: 'base', b: 'upper', color: '#2196F3', transparency: 85, visible: true },
      { id: 'lowerFill', title: 'Lower Channel Fill', a: 'base', b: 'lower', color: '#F23645', transparency: 85, visible: true },
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta, high, low } = ctx;
      const src = ctx.source(inp.source);
      const base = ta.nanArray(n), upper = ta.nanArray(n), lower = ta.nanArray(n), pear = ta.nanArray(n);
      const texts: Array<string | null> = new Array(n).fill(null);
      const len = Math.min(inp.length | 0, n);
      const last = n - 1;
      if (len >= 2) {
        let sumX = 0, sumY = 0, sumXSqr = 0, sumXY = 0, ok = true;
        for (let i = 0; i < len; i++) {
          const per = i + 1, val = src[last - i];
          if (!isNum(val)) { ok = false; break; }
          sumX += per; sumY += val; sumXSqr += per * per; sumXY += per * val;
        }
        if (ok) {
          const slope = (len * sumXY - sumX * sumY) / (len * sumXSqr - sumX * sumX);
          const average = sumY / len;
          const intercept = average - (slope * sumX) / len + slope;
          let upDev = 0, dnDev = 0, stdAcc = 0, dsxx = 0, dsyy = 0, dsxy = 0;
          const periods = len - 1;
          const daY = intercept + (slope * periods) / 2;
          let val = intercept;
          for (let j = 0; j < len; j++) {
            const idx = last - j;
            let price = high[idx] - val;
            if (price > upDev) upDev = price;
            price = val - low[idx];
            if (price > dnDev) dnDev = price;
            price = src[idx];
            const dxt = price - average, dyt = val - daY;
            price -= val;
            stdAcc += price * price; dsxx += dxt * dxt; dsyy += dyt * dyt; dsxy += dxt * dyt;
            val += slope;
          }
          const stdDev = Math.sqrt(stdAcc / (periods === 0 ? 1 : periods));
          const r = dsxx === 0 || dsyy === 0 ? 0 : dsxy / Math.sqrt(dsxx * dsyy);
          const upOff = inp.useUpperDev ? inp.upperMult * stdDev : upDev;
          const dnOff = inp.useLowerDev ? inp.lowerMult * stdDev : dnDev;
          const from = inp.extendLeft ? 0 : n - len;
          for (let i = from; i < n; i++) { const v = intercept + slope * (last - i); base[i] = v; upper[i] = v + upOff; lower[i] = v - dnOff; }
          if (inp.showPearson) { pear[last] = upper[last]; texts[last] = `Pearson's R: ${r.toFixed(3)}`; }
        }
      }
      return { upper, base, lower, pearson: { values: pear, texts } };
    },
  },
  {
    id: 'Linear Regression Slope', name: 'Linear Regression Slope', shortName: 'LinReg Slope', category: 'Trend', overlay: false,
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 14, min: 2 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [{ id: 'slope', title: 'Linear Regression Slope', style: plotStyle({ color: '#FF5252' }) }],
    bands: [{ id: 'zero', title: 'Zero', value: 0, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true }],
    precision: 'inherit',
    includeZero: true,
    compute(ctx, inp) {
      return { slope: ctx.ta.linregSlope(ctx.source(inp.source), inp.length) };
    },
  },
  {
    id: 'Linear Regression Curve', name: 'Linear Regression Curve', shortName: 'LinReg Curve', category: 'Trend', overlay: true,
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 9, min: 2 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [{ id: 'curve', title: 'Linear Regression Curve', style: plotStyle({ color: '#2196F3' }) }],
    precision: 'inherit',
    compute(ctx, inp) {
      return { curve: ctx.ta.linreg(ctx.source(inp.source), inp.length, 0) };
    },
  },
  {
    id: 'Williams Alligator', name: 'Williams Alligator', shortName: 'Alligator', category: 'Trend', overlay: true, aliases: ['Alligator'],
    inputs: [
      { id: 'jawLength', name: 'Jaw Length', type: 'int', defval: 13, min: 1 },
      { id: 'teethLength', name: 'Teeth Length', type: 'int', defval: 8, min: 1 },
      { id: 'lipsLength', name: 'Lips Length', type: 'int', defval: 5, min: 1 },
      { id: 'jawOffset', name: 'Jaw Offset', type: 'int', defval: 8, min: -500, max: 500 },
      { id: 'teethOffset', name: 'Teeth Offset', type: 'int', defval: 5, min: -500, max: 500 },
      { id: 'lipsOffset', name: 'Lips Offset', type: 'int', defval: 3, min: -500, max: 500 },
    ],
    // Style offsets hold the defaults (8/5/3) so the lines project into the future; compute() shifts by the input difference.
    plots: [
      { id: 'jaw', title: 'Jaw', style: plotStyle({ color: '#2962FF', offset: 8 }) },
      { id: 'teeth', title: 'Teeth', style: plotStyle({ color: '#E91E63', offset: 5 }) },
      { id: 'lips', title: 'Lips', style: plotStyle({ color: '#66BB6A', offset: 3 }) },
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const { ta, hl2 } = ctx;
      return {
        jaw: ta.shiftSeriesTrend(ta.rma(hl2, inp.jawLength), inp.jawOffset - 8),
        teeth: ta.shiftSeriesTrend(ta.rma(hl2, inp.teethLength), inp.teethOffset - 5),
        lips: ta.shiftSeriesTrend(ta.rma(hl2, inp.lipsLength), inp.lipsOffset - 3),
      };
    },
  },
  {
    id: 'Williams Fractal', name: 'Williams Fractal', shortName: 'Fractals', category: 'Trend', overlay: true, aliases: ['Williams Fractals', 'Fractals'],
    inputs: [{ id: 'periods', name: 'Periods', type: 'int', defval: 2, min: 2 }],
    plots: [
      { id: 'down', title: 'Down Fractals', style: plotStyle({ type: 'shapes', shape: 'triangleDown', location: 'belowBar', color: '#F23645', size: 'small', showLast: false }) },
      { id: 'up', title: 'Up Fractals', style: plotStyle({ type: 'shapes', shape: 'triangleUp', location: 'aboveBar', color: '#089981', size: 'small', showLast: false }) },
    ],
    precision: 0,
    compute(ctx, inp) {
      return { down: fractalFlags(ctx.low, ctx.n, inp.periods, false), up: fractalFlags(ctx.high, ctx.n, inp.periods, true) };
    },
  },
  {
    id: 'Zig Zag', name: 'Zig Zag', shortName: 'Zig Zag', category: 'Trend', overlay: true, aliases: ['ZigZag'],
    inputs: [
      { id: 'deviation', name: 'Price deviation for reversals (%)', type: 'float', defval: 5, min: 0.00001, max: 100, step: 0.5 },
      { id: 'depth', name: 'Pivot legs', type: 'int', defval: 10, min: 2 },
      { id: 'lineColor', name: 'Line color', type: 'color', defval: '#2962FF' },
      { id: 'extendToLast', name: 'Extend to last bar', type: 'bool', defval: true },
      { id: 'showPrice', name: 'Display reversal price', type: 'bool', defval: true },
      { id: 'showVolume', name: 'Display cumulative volume', type: 'bool', defval: true },
      { id: 'showChange', name: 'Display reversal price change', type: 'bool', defval: false, inline: 'change' },
      { id: 'changeType', name: 'Change type', type: 'select', defval: 'Absolute', options: ['Absolute', 'Percent'], inline: 'change' },
    ],
    plots: [
      { id: 'zigzag', title: 'Zig Zag', style: plotStyle({ color: '#2962FF', lineWidth: 2, showLast: false }), hideInLegend: true },
      { id: 'projection', title: 'Projected Leg', style: plotStyle({ color: '#2962FF', lineWidth: 2, lineStyle: 2, showLast: false }), hideInLegend: true },
      { id: 'highLabels', title: 'High Labels', style: plotStyle({ type: 'chars', location: 'aboveBar', color: '#089981', showLast: false }), hideInLegend: true },
      { id: 'lowLabels', title: 'Low Labels', style: plotStyle({ type: 'chars', location: 'belowBar', color: '#F23645', showLast: false }), hideInLegend: true },
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta, high, low, volume, minMove } = ctx;
      const { pivots, projected } = ta.zigzag(high, low, inp.deviation, inp.depth);
      const line = ta.nanArray(n), proj = ta.nanArray(n), hiVals = ta.nanArray(n), loVals = ta.nanArray(n);
      const hiTexts: Array<string | null> = new Array(n).fill(null), loTexts: Array<string | null> = new Array(n).fill(null);
      const cumVol = ta.cum(volume);
      const label = (p: { bar: number; price: number }, prev: { bar: number; price: number } | null): string | null => {
        const parts: string[] = [];
        if (inp.showPrice) parts.push(fmtPrice(p.price, minMove));
        if (inp.showVolume && prev) parts.push(fmtVolume(cumVol[p.bar] - cumVol[prev.bar]));
        if (inp.showChange && prev) {
          const d = p.price - prev.price;
          parts.push(inp.changeType === 'Percent' ? `${((d / prev.price) * 100).toFixed(2)}%` : fmtPrice(d, minMove));
        }
        return parts.length ? parts.join(' ') : null;
      };
      const place = (p: { bar: number; price: number; isHigh: boolean }, prev: { bar: number; price: number } | null): void => {
        const t = label(p, prev);
        if (p.isHigh) { hiVals[p.bar] = p.price; hiTexts[p.bar] = t; } else { loVals[p.bar] = p.price; loTexts[p.bar] = t; }
      };
      for (let k = 0; k < pivots.length; k++) {
        const p = pivots[k], prev = k > 0 ? pivots[k - 1] : null;
        if (prev) segment(line, prev.bar, prev.price, p.bar, p.price); else line[p.bar] = p.price;
        place(p, prev);
      }
      if (inp.extendToLast && projected && pivots.length) {
        const last = pivots[pivots.length - 1];
        segment(proj, last.bar, last.price, projected.bar, projected.price);
        place(projected, last);
      }
      const colors = inp.lineColor && inp.lineColor !== '#2962FF' ? new Array<string | null>(n).fill(inp.lineColor) : null;
      return {
        zigzag: { values: line, colors }, projection: { values: proj, colors },
        highLabels: { values: hiVals, texts: hiTexts }, lowLabels: { values: loVals, texts: loTexts },
      };
    },
  },
  {
    id: 'Chande Kroll Stop', name: 'Chande Kroll Stop', shortName: 'Chande Kroll Stop', category: 'Trend', overlay: true,
    inputs: [
      { id: 'atrLength', name: 'ATR Length', type: 'int', defval: 10, min: 1 },
      { id: 'atrCoef', name: 'ATR Coefficient', type: 'float', defval: 1, min: 0, step: 0.1 },
      { id: 'stopLength', name: 'Stop Length', type: 'int', defval: 9, min: 1 },
    ],
    plots: [
      { id: 'long', title: 'Stop Long', style: plotStyle({ color: '#089981' }) },
      { id: 'short', title: 'Stop Short', style: plotStyle({ color: '#F23645' }) },
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta, high, low, close } = ctx;
      const atr = ta.atr(high, low, close, inp.atrLength);
      const hh = ta.highest(high, inp.atrLength), ll = ta.lowest(low, inp.atrLength);
      const firstHigh = ta.nanArray(n), firstLow = ta.nanArray(n);
      for (let i = 0; i < n; i++) { firstHigh[i] = hh[i] - inp.atrCoef * atr[i]; firstLow[i] = ll[i] + inp.atrCoef * atr[i]; }
      return { short: ta.highestNa(firstHigh, inp.stopLength), long: ta.lowestNa(firstLow, inp.stopLength) };
    },
  },
  {
    id: 'Volatility Stop', name: 'Volatility Stop', shortName: 'VStop', category: 'Trend', overlay: true, aliases: ['VStop'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 20, min: 2 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'mult', name: 'vStop Multiplier', type: 'float', defval: 2, min: 0.25, step: 0.25 },
    ],
    plots: [{ id: 'stop', title: 'Volatility Stop', style: plotStyle({ type: 'cross', color: '#089981' }) }],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta, high, low, close } = ctx;
      const src = ctx.source(inp.source);
      const atr = ta.atr(high, low, close, inp.length);
      const trv = ta.tr(high, low, close, false);
      const stop = ta.nanArray(n);
      const colors: Array<string | null> = new Array(n).fill(null);
      let max = NaN, min = NaN, s = NaN;
      let uptrend: boolean = true;
      for (let i = 0; i < n; i++) {
        const v = src[i];
        if (!isNum(v)) continue;
        if (!isNum(max)) { max = v; min = v; }
        const atrM = isNum(atr[i]) ? atr[i] * inp.mult : trv[i];
        max = Math.max(max, v); min = Math.min(min, v);
        let ns = uptrend ? Math.max(s, max - atrM) : Math.min(s, min + atrM);
        if (!isNum(ns)) ns = v;
        s = ns;
        const prevUp: boolean = uptrend;
        uptrend = v - s >= 0;
        if (uptrend !== prevUp && i > 0) {
          max = v; min = v;
          s = uptrend ? max - atrM : min + atrM;
          if (!isNum(s)) s = v;
        }
        stop[i] = s;
        colors[i] = uptrend ? '#089981' : '#F23645';
      }
      return { stop: { values: stop, colors } };
    },
  },
  {
    id: 'Chandelier Exit', name: 'Chandelier Exit', shortName: 'Chandelier Exit', category: 'Trend', overlay: true,
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 22, min: 1 },
      { id: 'atrLength', name: 'ATR Length', type: 'int', defval: 22, min: 1 },
      { id: 'mult', name: 'ATR Multiplier', type: 'float', defval: 3, min: 0, step: 0.1 },
    ],
    plots: [
      { id: 'long', title: 'Long Exit', style: plotStyle({ color: '#2962FF' }) },
      { id: 'short', title: 'Short Exit', style: plotStyle({ color: '#FF6D00' }) },
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta, high, low, close } = ctx;
      const atr = ta.atr(high, low, close, inp.atrLength);
      const hh = ta.highest(high, inp.length), ll = ta.lowest(low, inp.length);
      const long = ta.nanArray(n), short = ta.nanArray(n);
      for (let i = 0; i < n; i++) { long[i] = hh[i] - inp.mult * atr[i]; short[i] = ll[i] + inp.mult * atr[i]; }
      return { long, short };
    },
  },
  {
    id: 'Vortex Indicator', name: 'Vortex Indicator', shortName: 'VI', category: 'Trend', overlay: false, aliases: ['VI', 'Vortex'],
    inputs: [{ id: 'period', name: 'Period', type: 'int', defval: 14, min: 2 }],
    plots: [
      { id: 'plus', title: 'VI +', style: plotStyle({ color: '#2962FF' }) },
      { id: 'minus', title: 'VI -', style: plotStyle({ color: '#E91E63' }) },
    ],
    precision: 4,
    compute(ctx, inp) {
      const { n, ta, high, low, close } = ctx;
      const vmp = ta.nanArray(n), vmm = ta.nanArray(n);
      for (let i = 1; i < n; i++) { vmp[i] = Math.abs(high[i] - low[i - 1]); vmm[i] = Math.abs(low[i] - high[i - 1]); }
      const str = ta.sum(ta.tr(high, low, close, true), inp.period);
      const sp = ta.sum(vmp, inp.period), sm = ta.sum(vmm, inp.period);
      const plus = ta.nanArray(n), minus = ta.nanArray(n);
      for (let i = 0; i < n; i++) { plus[i] = sp[i] / str[i]; minus[i] = sm[i] / str[i]; }
      return { plus, minus };
    },
  },
  {
    id: 'Choppiness Index', name: 'Choppiness Index', shortName: 'CHOP', category: 'Trend', overlay: false, aliases: ['CHOP'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 14, min: 1 },
      { id: 'offset', name: 'Offset', type: 'int', defval: 0, min: -500, max: 500 },
    ],
    plots: [{ id: 'chop', title: 'CHOP', style: plotStyle({ color: '#2962FF' }) }],
    bands: [
      { id: 'upper', title: 'Upper Band', value: 61.8, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'middle', title: 'Middle Band', value: 50, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'lower', title: 'Lower Band', value: 38.2, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#2196F3', transparency: 90, visible: true }],
    precision: 2,
    compute(ctx, inp) {
      const { n, ta, high, low, close } = ctx;
      const len = inp.length;
      const atrSum = ta.sum(ta.tr(high, low, close, true), len);
      const hh = ta.highest(high, len), ll = ta.lowest(low, len);
      const out = ta.nanArray(n);
      const logLen = Math.log10(len);
      for (let i = 0; i < n; i++) {
        const range = hh[i] - ll[i];
        if (!isNum(atrSum[i]) || !(range > 0) || logLen === 0) continue;
        out[i] = (100 * Math.log10(atrSum[i] / range)) / logLen;
      }
      return { chop: ta.shiftSeriesTrend(out, inp.offset) };
    },
  },
  {
    id: 'Chop Zone', name: 'Chop Zone', shortName: 'Chop Zone', category: 'Trend', overlay: false,
    inputs: [],
    plots: [{ id: 'zone', title: 'Chop Zone', style: plotStyle({ type: 'columns', color: '#000080' }) }],
    precision: 4,
    compute(ctx) {
      const { n, ta, high, low, close, hlc3 } = ctx;
      const periods = 30;
      const hh = ta.highest(high, periods), ll = ta.lowest(low, periods);
      const ema34 = ta.ema(close, 34);
      const values = ta.nanArray(n);
      const colors: Array<string | null> = new Array(n).fill(null);
      const C = CHOP_ZONE_COLORS;
      for (let i = 1; i < n; i++) {
        if (!isNum(hh[i]) || !isNum(ll[i]) || !isNum(ema34[i]) || !isNum(ema34[i - 1])) continue;
        const span = (25 / (hh[i] - ll[i])) * ll[i];
        const y2 = ((ema34[i - 1] - ema34[i]) / hlc3[i]) * span;
        const c = Math.sqrt(1 + y2 * y2);
        const angle1 = Math.round((180 * Math.acos(1 / c)) / Math.PI);
        const angle = y2 > 0 ? -angle1 : angle1;
        let color: string;
        if (angle >= 5) color = C.turquoise;
        else if (angle >= 3.57) color = C.darkGreen;
        else if (angle >= 2.14) color = C.paleGreen;
        else if (angle >= 0.71) color = C.lime;
        else if (angle <= -5) color = C.darkRed;
        else if (angle <= -3.57) color = C.red;
        else if (angle <= -2.14) color = C.orange;
        else if (angle <= -0.71) color = C.lightOrange;
        else color = C.yellow;
        values[i] = 1;
        colors[i] = color;
      }
      return { zone: { values, colors } };
    },
  },
  {
    id: 'Pivot Points High Low', name: 'Pivot Points High Low', shortName: 'Pivots HL', category: 'Trend', overlay: true, aliases: ['Pivots HL'],
    inputs: [
      { id: 'lengthHigh', name: 'Pivot High', type: 'int', defval: 10, min: 1 },
      { id: 'lengthLow', name: 'Pivot Low', type: 'int', defval: 10, min: 1 },
    ],
    plots: [
      { id: 'high', title: 'Pivot High', style: plotStyle({ type: 'chars', location: 'aboveBar', color: '#F23645', showLast: false }) },
      { id: 'low', title: 'Pivot Low', style: plotStyle({ type: 'chars', location: 'belowBar', color: '#089981', showLast: false }) },
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta, high, low, minMove } = ctx;
      const ph = ta.pivotHigh(high, inp.lengthHigh, inp.lengthHigh), pl = ta.pivotLow(low, inp.lengthLow, inp.lengthLow);
      const hv = ta.nanArray(n), lv = ta.nanArray(n);
      const ht: Array<string | null> = new Array(n).fill(null), lt: Array<string | null> = new Array(n).fill(null);
      for (let i = 0; i < n; i++) {
        if (isNum(ph[i])) { const c = i - inp.lengthHigh; hv[c] = ph[i]; ht[c] = fmtPrice(ph[i], minMove); }
        if (isNum(pl[i])) { const c = i - inp.lengthLow; lv[c] = pl[i]; lt[c] = fmtPrice(pl[i], minMove); }
      }
      return { high: { values: hv, texts: ht }, low: { values: lv, texts: lt } };
    },
  },
  autoFibDef('retracement'),
  autoFibDef('extension'),
];
