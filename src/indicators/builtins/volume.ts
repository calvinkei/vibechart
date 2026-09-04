/**
 * Volume-based built-ins (TradingView study names as ids).
 *
 * Notes on approximations (documented per indicator):
 * - Volume Delta / Cumulative Volume Delta / Up-Down Volume use intrabar (lower-timeframe) data on
 *   TradingView. No LTF feed exists here, so each chart bar's whole volume is assigned one polarity
 *   using the spec's tie rule (close vs open, then close vs previous close, then previous polarity).
 * - 24-hour Volume sums `volume * price` over the chart bars that opened in the last 24 h (TV uses
 *   1-/5-/60-minute LTF bars) and cannot convert currencies.
 * - Relative Volume at Time matches bars of previous anchor periods by time offset from the first bar
 *   of the period.
 */
import { plotStyle, type IndicatorDefinition, type IndicatorInput, type IndicatorContext, type IndicatorInstance, type ComputeResult } from '../Indicator';
import type { RenderContext } from '../../series/Series';
import { dateParts, tzOffset } from '../../util/time';
import * as ta from '../ta';

export const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];
export const SMOOTHING_TYPES = ['None', 'SMA', 'SMA + Bollinger Bands', 'EMA', 'SMMA (RMA)', 'WMA', 'VWMA'];
const GRAY = '#787B86';
const UP = '#089981';
const DOWN = '#F23645';
const BLUE = '#2962FF';

// ---- resolution / calendar helpers (shared with volumeProfile.ts and misc.ts) ------------------

export interface ResolutionInfo {
  unit: 'S' | 'MIN' | 'D' | 'W' | 'M' | 'R';
  mult: number;
  /** nominal bar length in seconds (Pine `timeframe.in_seconds`) */
  seconds: number;
  intraday: boolean;
  /** daily, weekly or monthly (Pine `timeframe.isdwm`) */
  isDWM: boolean;
  /** approximate calendar days per bar (0 for intraday) */
  days: number;
}

/** Parse a TradingView resolution string ("1", "15", "240", "1S", "1D", "1W", "1M", "3M", "12M"). */
export function parseResolution(res: string): ResolutionInfo {
  const s = String(res ?? '1').trim().toUpperCase();
  const m = s.match(/^(\d*)\s*([SDWMHR]?)$/);
  let mult = m && m[1] ? parseInt(m[1], 10) : 1;
  if (!(mult > 0)) mult = 1;
  const u = m ? m[2] : '';
  switch (u) {
    case 'S': return { unit: 'S', mult, seconds: mult, intraday: true, isDWM: false, days: 0 };
    case 'H': return { unit: 'MIN', mult: mult * 60, seconds: mult * 3600, intraday: true, isDWM: false, days: 0 };
    case 'D': return { unit: 'D', mult, seconds: mult * 86400, intraday: false, isDWM: true, days: mult };
    case 'W': return { unit: 'W', mult, seconds: mult * 604800, intraday: false, isDWM: true, days: mult * 7 };
    case 'M': return { unit: 'M', mult, seconds: mult * 2628003, intraday: false, isDWM: true, days: mult * 30 };
    case 'R': return { unit: 'R', mult, seconds: 60, intraday: true, isDWM: false, days: 0 };
    default: return { unit: 'MIN', mult, seconds: mult * 60, intraday: true, isDWM: false, days: 0 };
  }
}

export type CalendarAnchor = 'Session' | 'Week' | 'Month' | 'Quarter' | 'Year' | 'Decade' | 'Century';
export const ANCHOR_PERIODS: CalendarAnchor[] = ['Session', 'Week', 'Month', 'Quarter', 'Year', 'Decade', 'Century'];

function calendarKey(anchor: string, day: number, year: number, month: number, weekday: number): number {
  switch (anchor) {
    case 'Week': return day - ((weekday + 6) % 7); // Monday-based week start (day number)
    case 'Month': return year * 12 + (month - 1);
    case 'Quarter': return year * 4 + Math.floor((month - 1) / 3);
    case 'Year': return year;
    case 'Decade': return Math.floor(year / 10);
    case 'Century': return Math.floor(year / 100);
    default: return day; // Session = calendar day in the chart timezone
  }
}

/**
 * Per-bar calendar period key for a VWAP-style anchor, evaluated in timezone `tz`.
 * A new period starts whenever the key changes. Uses at most one Intl call per distinct local day.
 */
export function calendarKeys(time: ArrayLike<number>, tz: string, anchor: string): Float64Array {
  const n = time.length;
  const out = new Float64Array(n);
  let off = 0, day = NaN, year = 1970, month = 1, weekday = 4;
  for (let i = 0; i < n; i++) {
    const t = time[i];
    const cand = Math.floor((t + off) / 86400);
    if (i === 0 || cand !== day) {
      off = tzOffset(t, tz);
      const d = Math.floor((t + off) / 86400);
      if (d !== day || i === 0) {
        const p = dateParts(t, tz);
        day = d; year = p.year; month = p.month; weekday = p.weekday;
      }
    }
    out[i] = calendarKey(anchor, day, year, month, weekday);
  }
  return out;
}

/** 1 on bars where the key changes (and on the first bar). */
export function newPeriodFlags(keys: ArrayLike<number>): Uint8Array {
  const n = keys.length;
  const f = new Uint8Array(n);
  for (let i = 0; i < n; i++) f[i] = i === 0 || keys[i] !== keys[i - 1] ? 1 : 0;
  return f;
}

/** Period keys for a Pine timeframe string ("5", "60", "1D", "1W", "1M", "3M", "12M"), à la `timeframe.change(tf)`. */
export function timeframeKeys(time: ArrayLike<number>, tz: string, tf: string): Float64Array {
  const r = parseResolution(tf);
  const n = time.length;
  if (r.unit === 'S' || r.unit === 'MIN' || r.unit === 'R') {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.floor(time[i] / r.seconds);
    return out;
  }
  if (r.unit === 'D') {
    const k = calendarKeys(time, tz, 'Session');
    if (r.mult > 1) for (let i = 0; i < n; i++) k[i] = Math.floor(k[i] / r.mult);
    return k;
  }
  if (r.unit === 'W') {
    const k = calendarKeys(time, tz, 'Week');
    if (r.mult > 1) for (let i = 0; i < n; i++) k[i] = Math.floor(k[i] / (7 * r.mult));
    return k;
  }
  if (r.mult === 3) return calendarKeys(time, tz, 'Quarter');
  if (r.mult === 12) return calendarKeys(time, tz, 'Year');
  const k = calendarKeys(time, tz, 'Month');
  if (r.mult > 1) for (let i = 0; i < n; i++) k[i] = Math.floor(k[i] / r.mult);
  return k;
}

/** Resolve the "Auto" anchor of VWAP Auto Anchored / Auto Anchored Volume Profile for a chart resolution. */
export function autoAnchorFor(res: string): CalendarAnchor {
  const r = parseResolution(res);
  if (r.intraday) return 'Session';
  if (r.days <= 1) return 'Month';
  if (r.days <= 10) return 'Quarter';
  if (r.days <= 60) return 'Year';
  return 'Decade';
}

// ---- Smoothing group (OBV / MFI style) --------------------------------------------------------

export function smoothingInputs(length = 14): IndicatorInput[] {
  return [
    { id: 'smoothingType', name: 'Type', type: 'select', defval: 'None', options: SMOOTHING_TYPES, group: 'Smoothing' },
    { id: 'smoothingLength', name: 'Length', type: 'int', defval: length, min: 1, max: 5000, group: 'Smoothing' },
    { id: 'bbStdDev', name: 'BB StdDev', type: 'float', defval: 2, min: 0.001, max: 50, step: 0.1, group: 'Smoothing' },
  ];
}

export function applySmoothing(ctx: IndicatorContext, src: Float64Array, inp: Record<string, any>): { ma: Float64Array; bbUpper: Float64Array; bbLower: Float64Array } {
  const n = ctx.n;
  const type: string = inp.smoothingType || 'None';
  let ma = ta.nanArray(n);
  const bbUpper = ta.nanArray(n), bbLower = ta.nanArray(n);
  if (type !== 'None') {
    const len = Math.max(1, inp.smoothingLength | 0);
    const t = type === 'SMA + Bollinger Bands' ? 'SMA' : type;
    ma = ta.maByType(t, src, len, ctx.volume);
    if (type === 'SMA + Bollinger Bands') {
      const sd = ta.stdev(src, len);
      for (let i = 0; i < n; i++) { bbUpper[i] = ma[i] + inp.bbStdDev * sd[i]; bbLower[i] = ma[i] - inp.bbStdDev * sd[i]; }
    }
  }
  return { ma, bbUpper, bbLower };
}

const smoothingPlots = (ma = 'Smoothed MA') => [
  { id: 'ma', title: ma, style: plotStyle({ color: '#FFEB3B', visible: true }) },
  { id: 'bbUpper', title: 'Upper Bollinger Band', style: plotStyle({ color: UP }) },
  { id: 'bbLower', title: 'Lower Bollinger Band', style: plotStyle({ color: UP }) },
];
const smoothingFill = { id: 'bbFill', title: 'BB Background', a: 'bbUpper', b: 'bbLower', color: UP, transparency: 90, visible: true };

const zeroBand = { id: 'zero', title: 'Zero', value: 0, color: GRAY, lineStyle: 2 as const, lineWidth: 1 as const, visible: true };

// ---- helpers for delta candles ----------------------------------------------------------------

/** Draw open→close bodies (no wicks: without intrabar data high/low equal the body extremes). */
function renderDeltaCandles(rc: RenderContext, inst: IndicatorInstance, openId: string, closeId: string): void {
  const o = inst.results[openId]?.values;
  const out = inst.results[closeId];
  if (!o || !out) return;
  const c = out.values;
  const st = inst.styles[closeId];
  if (!st || !st.visible) return;
  const { ctx, timeScale, priceScale, visible, dpr } = rc;
  const bs = timeScale.barSpacing;
  let bw = bs < 2.5 ? Math.max(1, Math.floor(bs)) : Math.max(1, Math.floor(bs * 0.7));
  if (bw > 1 && bw % 2 === 0) bw -= 1;
  const half = Math.floor(bw / 2);
  const from = Math.max(0, visible.from), to = Math.min(visible.to, c.length - 1);
  ctx.save();
  for (let i = from; i <= to; i++) {
    const ov = o[i], cv = c[i];
    if (ov !== ov || cv !== cv) continue;
    ctx.fillStyle = out.colors?.[i] ?? st.color;
    const xc = Math.round(timeScale.barCenterX(i) * dpr) / dpr;
    const y0 = priceScale.priceToY(ov), y1 = priceScale.priceToY(cv);
    const top = Math.min(y0, y1);
    const h = Math.max(1, Math.abs(y1 - y0));
    ctx.fillRect(Math.round((xc - half) * dpr) / dpr, top, bw, h);
  }
  ctx.restore();
}

function signColors(vals: ArrayLike<number>, up = UP, down = DOWN): Array<string | null> {
  const n = vals.length;
  const colors: Array<string | null> = new Array(n);
  for (let i = 0; i < n; i++) { const v = vals[i]; colors[i] = v !== v ? null : v >= 0 ? up : down; }
  return colors;
}

function bandPlots(): IndicatorDefinition['plots'] {
  return [
    { id: 'upper1', title: 'Upper Band #1', style: plotStyle({ color: '#4CAF50' }) },
    { id: 'lower1', title: 'Lower Band #1', style: plotStyle({ color: '#4CAF50' }) },
    { id: 'upper2', title: 'Upper Band #2', style: plotStyle({ color: '#808000', visible: false }) },
    { id: 'lower2', title: 'Lower Band #2', style: plotStyle({ color: '#808000', visible: false }) },
    { id: 'upper3', title: 'Upper Band #3', style: plotStyle({ color: '#00897B', visible: false }) },
    { id: 'lower3', title: 'Lower Band #3', style: plotStyle({ color: '#00897B', visible: false }) },
  ];
}
function bandFills(): IndicatorDefinition['fills'] {
  return [
    { id: 'fill1', title: 'Bands Fill #1', a: 'upper1', b: 'lower1', color: '#4CAF50', transparency: 95, visible: true },
    { id: 'fill2', title: 'Bands Fill #2', a: 'upper2', b: 'lower2', color: '#808000', transparency: 95, visible: false },
    { id: 'fill3', title: 'Bands Fill #3', a: 'upper3', b: 'lower3', color: '#00897B', transparency: 95, visible: false },
  ];
}
function bandInputs(): IndicatorInput[] {
  const G = 'Bands Settings';
  return [
    { id: 'calcMode', name: 'Bands Calculation Mode', type: 'select', defval: 'Standard Deviation', options: ['Standard Deviation', 'Percentage'], group: G },
    { id: 'showBand1', name: 'Show Band #1', type: 'bool', defval: true, group: G, inline: 'band1' },
    { id: 'bandMult1', name: 'Bands Multiplier #1', type: 'float', defval: 1, min: 0, step: 0.5, group: G, inline: 'band1' },
    { id: 'showBand2', name: 'Show Band #2', type: 'bool', defval: false, group: G, inline: 'band2' },
    { id: 'bandMult2', name: 'Bands Multiplier #2', type: 'float', defval: 2, min: 0, step: 0.5, group: G, inline: 'band2' },
    { id: 'showBand3', name: 'Show Band #3', type: 'bool', defval: false, group: G, inline: 'band3' },
    { id: 'bandMult3', name: 'Bands Multiplier #3', type: 'float', defval: 3, min: 0, step: 0.5, group: G, inline: 'band3' },
  ];
}

/** VWAP + 3 band pairs from a vwap/stdev pair; hidden bands are NaN (Pine `display.none`). */
function vwapBands(n: number, vwap: Float64Array, stdev: Float64Array, inp: Record<string, any>, offset = 0): ComputeResult {
  const out: ComputeResult = {};
  const pct = inp.calcMode === 'Percentage';
  const mk = (k: number) => {
    const up = ta.nanArray(n), lo = ta.nanArray(n);
    if (inp[`showBand${k}`]) {
      const mult = +inp[`bandMult${k}`] || 0;
      for (let i = 0; i < n; i++) {
        const basis = pct ? vwap[i] * 0.01 : stdev[i];
        up[i] = vwap[i] + basis * mult;
        lo[i] = vwap[i] - basis * mult;
      }
    }
    out[`upper${k}`] = offset ? ta.shift(up, offset) : up;
    out[`lower${k}`] = offset ? ta.shift(lo, offset) : lo;
  };
  out.vwap = offset ? ta.shift(vwap, offset) : vwap;
  mk(1); mk(2); mk(3);
  return out;
}

function nanResult(n: number, ids: string[]): ComputeResult {
  const out: ComputeResult = {};
  for (const id of ids) out[id] = ta.nanArray(n);
  return out;
}

const LTF_INPUTS: IndicatorInput[] = [
  { id: 'useCustomTf', name: 'Use custom timeframe', type: 'bool', defval: false, tooltip: 'Kept for TradingView parity; no lower-timeframe data is available so bars are classified by their own direction.' },
  { id: 'timeframe', name: 'Timeframe', type: 'resolution', defval: '1' },
];

// ---- definitions -------------------------------------------------------------------------------

export const volumeIndicators: IndicatorDefinition[] = [
  {
    id: 'On Balance Volume', name: 'On Balance Volume', shortName: 'OBV', category: 'Volume', overlay: false, aliases: ['OBV'], format: 'volume', precision: 2,
    inputs: smoothingInputs(14),
    plots: [{ id: 'obv', title: 'OnBalanceVolume', style: plotStyle({ color: BLUE }) }, ...smoothingPlots('OBV-based MA')],
    fills: [smoothingFill],
    compute(ctx, inp) {
      const obv = ctx.ta.obv(ctx.close, ctx.volume);
      return { obv, ...applySmoothing(ctx, obv, inp) };
    },
  },
  {
    id: 'Accumulation/Distribution', name: 'Accumulation/Distribution', shortName: 'Accum/Dist', category: 'Volume', overlay: false,
    aliases: ['ADL', 'Accumulation Distribution', 'Accumulation Distribution (ADL)'], format: 'volume', precision: 2,
    inputs: [],
    plots: [{ id: 'ad', title: 'Accumulation/Distribution', style: plotStyle({ color: BLUE }) }],
    compute(ctx) { return { ad: ctx.ta.accdist(ctx.high, ctx.low, ctx.close, ctx.volume) }; },
  },
  {
    id: 'Chaikin Money Flow', name: 'Chaikin Money Flow', shortName: 'CMF', category: 'Volume', overlay: false, aliases: ['CMF'], precision: 2, includeZero: true,
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 20, min: 1 }],
    plots: [{ id: 'mf', title: 'MF', style: plotStyle({ color: '#43A047' }) }],
    bands: [zeroBand],
    compute(ctx, inp) {
      const n = ctx.n;
      const ad = ta.nanArray(n);
      for (let i = 0; i < n; i++) {
        const h = ctx.high[i], l = ctx.low[i], c = ctx.close[i];
        ad[i] = (c === h && c === l) || h === l ? 0 : ((2 * c - l - h) / (h - l)) * ctx.volume[i];
      }
      const num = ctx.ta.sum(ad, inp.length), den = ctx.ta.sum(ctx.volume, inp.length);
      const mf = ta.nanArray(n);
      for (let i = 0; i < n; i++) if (ta.isNum(num[i]) && den[i] !== 0) mf[i] = num[i] / den[i];
      return { mf };
    },
  },
  {
    id: 'Money Flow Index', name: 'Money Flow Index', shortName: 'MFI', category: 'Volume', overlay: false, aliases: ['MFI'], precision: 2,
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 14, min: 1, max: 2000 }, ...smoothingInputs(14)],
    plots: [{ id: 'mf', title: 'MF', style: plotStyle({ color: '#7E57C2' }) }, ...smoothingPlots('MFI-based MA')],
    bands: [
      { id: 'upper', title: 'Overbought', value: 80, color: GRAY, lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'lower', title: 'Oversold', value: 20, color: GRAY, lineStyle: 2, lineWidth: 1, visible: true },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#7E57C2', transparency: 90, visible: true }, smoothingFill],
    compute(ctx, inp) {
      const mf = ctx.ta.mfi(ctx.hlc3, ctx.volume, inp.length);
      return { mf, ...applySmoothing(ctx, mf, inp) };
    },
  },
  {
    id: 'Ease of Movement', name: 'Ease of Movement', shortName: 'EOM', category: 'Volume', overlay: false, aliases: ['EOM', 'Ease Of Movement'], format: 'volume', precision: 2, includeZero: true,
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 14, min: 1 },
      { id: 'divisor', name: 'Divisor', type: 'int', defval: 10000, min: 1 },
    ],
    plots: [{ id: 'eom', title: 'EOM', style: plotStyle({ color: '#43A047' }) }],
    bands: [zeroBand],
    compute(ctx, inp) {
      const n = ctx.n;
      const raw = ta.nanArray(n);
      for (let i = 1; i < n; i++) {
        const v = ctx.volume[i];
        if (!(v > 0)) continue;
        raw[i] = (inp.divisor * (ctx.hl2[i] - ctx.hl2[i - 1]) * (ctx.high[i] - ctx.low[i])) / v;
      }
      return { eom: ctx.ta.sma(raw, inp.length) };
    },
  },
  {
    id: 'Net Volume', name: 'Net Volume', shortName: 'Net Volume', category: 'Volume', overlay: false, format: 'volume', precision: 2, includeZero: true,
    inputs: [],
    plots: [{ id: 'nv', title: 'Net Volume', style: plotStyle({ color: BLUE }) }],
    bands: [zeroBand],
    compute(ctx) {
      const n = ctx.n;
      const nv = ta.nanArray(n);
      for (let i = 1; i < n; i++) { const d = ctx.close[i] - ctx.close[i - 1]; nv[i] = d > 0 ? ctx.volume[i] : d < 0 ? -ctx.volume[i] : 0; }
      return { nv };
    },
  },
  {
    id: 'Price Volume Trend', name: 'Price Volume Trend', shortName: 'PVT', category: 'Volume', overlay: false, aliases: ['PVT'], format: 'volume', precision: 2,
    inputs: [],
    plots: [{ id: 'pvt', title: 'PVT', style: plotStyle({ color: BLUE }) }],
    compute(ctx) { return { pvt: ctx.ta.pvt(ctx.close, ctx.volume) }; },
  },
  {
    id: 'Volume Oscillator', name: 'Volume Oscillator', shortName: 'Volume Osc', category: 'Volume', overlay: false, aliases: ['Volume Osc'], precision: 2, includeZero: true,
    inputs: [
      { id: 'shortLen', name: 'Short Length', type: 'int', defval: 5, min: 1 },
      { id: 'longLen', name: 'Long Length', type: 'int', defval: 10, min: 1 },
    ],
    plots: [{ id: 'osc', title: 'VolumeOsc', style: plotStyle({ color: BLUE }) }],
    bands: [zeroBand],
    compute(ctx, inp) {
      const s = ctx.ta.ema(ctx.volume, inp.shortLen), l = ctx.ta.ema(ctx.volume, inp.longLen);
      const osc = ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) if (ta.isNum(l[i]) && l[i] !== 0) osc[i] = (100 * (s[i] - l[i])) / l[i];
      return { osc };
    },
  },
  {
    id: 'Percentage Volume Oscillator', name: 'Percentage Volume Oscillator', shortName: 'PVO', category: 'Volume', overlay: false, aliases: ['PVO'], precision: 2, includeZero: true,
    inputs: [
      { id: 'fast', name: 'Fast Length', type: 'int', defval: 12, min: 1 },
      { id: 'slow', name: 'Slow Length', type: 'int', defval: 26, min: 1 },
      { id: 'signal', name: 'Signal Length', type: 'int', defval: 9, min: 1 },
      { id: 'maType', name: 'Oscillator MA Type', type: 'select', defval: 'EMA', options: ['EMA', 'SMA'] },
      { id: 'sigType', name: 'Signal MA Type', type: 'select', defval: 'EMA', options: ['EMA', 'SMA'] },
    ],
    plots: [
      { id: 'hist', title: 'Histogram', style: plotStyle({ type: 'histogram', color: '#26A69A' }) },
      { id: 'pvo', title: 'PVO', style: plotStyle({ color: BLUE }) },
      { id: 'signal', title: 'Signal', style: plotStyle({ color: '#FF6D00' }) },
    ],
    bands: [zeroBand],
    compute(ctx, inp) {
      const n = ctx.n;
      const ma = (src: Float64Array, len: number, t: string) => (t === 'SMA' ? ctx.ta.sma(src, len) : ctx.ta.ema(src, len));
      const f = ma(ctx.volume, inp.fast, inp.maType), s = ma(ctx.volume, inp.slow, inp.maType);
      const pvo = ta.nanArray(n);
      for (let i = 0; i < n; i++) if (ta.isNum(s[i]) && s[i] !== 0) pvo[i] = ((f[i] - s[i]) / s[i]) * 100;
      const signal = ma(pvo, inp.signal, inp.sigType);
      const hist = ta.nanArray(n);
      const colors: Array<string | null> = new Array(n);
      for (let i = 0; i < n; i++) {
        hist[i] = pvo[i] - signal[i];
        const h = hist[i], p = hist[i - 1];
        colors[i] = h !== h ? null : h >= 0 ? (p === p && h < p ? '#B2DFDB' : '#26A69A') : (p === p && h > p ? '#FFCDD2' : '#FF5252');
      }
      return { hist: { values: hist, colors }, pvo, signal };
    },
  },
  {
    id: 'Elder Force Index', name: 'Elder Force Index', shortName: 'EFI', category: 'Volume', overlay: false, aliases: ['EFI', "Elder's Force Index", 'Elders Force Index'], format: 'volume', precision: 2, includeZero: true,
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 13, min: 1 }],
    plots: [{ id: 'efi', title: 'EFI', style: plotStyle({ color: DOWN }) }],
    bands: [zeroBand],
    compute(ctx, inp) {
      const raw = ta.nanArray(ctx.n);
      for (let i = 1; i < ctx.n; i++) raw[i] = (ctx.close[i] - ctx.close[i - 1]) * ctx.volume[i];
      return { efi: ctx.ta.ema(raw, inp.length) };
    },
  },
  {
    id: 'Klinger Oscillator', name: 'Klinger Oscillator', shortName: 'Klinger', category: 'Volume', overlay: false, precision: 'inherit', includeZero: true,
    inputs: [],
    plots: [
      { id: 'kvo', title: 'Klinger Oscillator', style: plotStyle({ color: BLUE }) },
      { id: 'signal', title: 'Signal', style: plotStyle({ color: '#43A047' }) },
    ],
    bands: [zeroBand],
    compute(ctx) {
      // TradingView's shipped version: signed volume by hlc3 direction (not the textbook volume force).
      const n = ctx.n;
      const sv = ta.nanArray(n);
      for (let i = 0; i < n; i++) sv[i] = i > 0 && ctx.hlc3[i] - ctx.hlc3[i - 1] >= 0 ? ctx.volume[i] : -ctx.volume[i];
      const e34 = ctx.ta.ema(sv, 34), e55 = ctx.ta.ema(sv, 55);
      const kvo = ta.nanArray(n);
      for (let i = 0; i < n; i++) kvo[i] = e34[i] - e55[i];
      return { kvo, signal: ctx.ta.ema(kvo, 13) };
    },
  },
  {
    id: 'Negative Volume Index', name: 'Negative Volume Index', shortName: 'NVI', category: 'Volume', overlay: false, aliases: ['NVI'], precision: 2,
    inputs: [{ id: 'emaLength', name: 'EMA Length', type: 'int', defval: 255, min: 1 }],
    plots: [{ id: 'nvi', title: 'NVI', style: plotStyle({ color: BLUE }) }, { id: 'ema', title: 'EMA', style: plotStyle({ color: '#FF6D00' }) }],
    compute(ctx, inp) { const nvi = volumeIndex(ctx, -1); return { nvi, ema: ctx.ta.ema(nvi, inp.emaLength) }; },
  },
  {
    id: 'Positive Volume Index', name: 'Positive Volume Index', shortName: 'PVI', category: 'Volume', overlay: false, aliases: ['PVI'], precision: 2,
    inputs: [{ id: 'emaLength', name: 'EMA Length', type: 'int', defval: 255, min: 1 }],
    plots: [{ id: 'pvi', title: 'PVI', style: plotStyle({ color: BLUE }) }, { id: 'ema', title: 'EMA', style: plotStyle({ color: '#FF6D00' }) }],
    compute(ctx, inp) { const pvi = volumeIndex(ctx, 1); return { pvi, ema: ctx.ta.ema(pvi, inp.emaLength) }; },
  },
  {
    id: 'Up/Down Volume', name: 'Up/Down Volume', shortName: 'Up/Down Volume', category: 'Volume', overlay: false, aliases: ['Up Down Volume'], format: 'volume', precision: 2, includeZero: true,
    description: 'Approximation: without lower-timeframe bars each chart bar is classified by its own direction (close vs open, then vs previous close, then previous polarity).',
    inputs: LTF_INPUTS,
    plots: [
      { id: 'up', title: 'Up Volume', style: plotStyle({ type: 'columns', color: UP }) },
      { id: 'down', title: 'Down Volume', style: plotStyle({ type: 'columns', color: DOWN }) },
      { id: 'delta', title: 'Delta', style: plotStyle({ type: 'histogram', color: GRAY }) },
    ],
    bands: [zeroBand],
    compute(ctx) {
      const n = ctx.n;
      const pol = ctx.ta.barPolarity(ctx.open, ctx.close);
      const up = ta.nanArray(n), down = ta.nanArray(n), delta = ta.nanArray(n);
      for (let i = 0; i < n; i++) {
        const v = ta.isNum(ctx.volume[i]) ? ctx.volume[i] : 0;
        up[i] = pol[i] > 0 ? v : 0;
        down[i] = pol[i] < 0 ? -v : 0;
        delta[i] = up[i] + down[i];
      }
      return { up, down, delta: { values: delta, colors: signColors(delta) } };
    },
  },
  {
    id: 'Volume Delta', name: 'Volume Delta', shortName: 'Vol Delta', category: 'Volume', overlay: false, format: 'volume', precision: 2, includeZero: true,
    description: 'Approximation: without lower-timeframe bars the whole bar volume takes the bar polarity (see Up/Down Volume). Drawn as open(0)→close(delta) candles.',
    inputs: LTF_INPUTS,
    plots: [
      { id: 'close', title: 'Delta', style: plotStyle({ type: 'candles', color: UP }) },
      { id: 'open', title: 'Open', style: plotStyle({ type: 'none', color: GRAY, showLast: false }), hideInLegend: true },
    ],
    bands: [zeroBand],
    compute(ctx) {
      const n = ctx.n;
      const pol = ctx.ta.barPolarity(ctx.open, ctx.close);
      const open = ta.nanArray(n), close = ta.nanArray(n);
      for (let i = 0; i < n; i++) { const v = ta.isNum(ctx.volume[i]) ? ctx.volume[i] : 0; open[i] = 0; close[i] = pol[i] * v; }
      return { close: { values: close, colors: signColors(close) }, open };
    },
    customRender(rc, inst) { renderDeltaCandles(rc, inst, 'open', 'close'); },
  },
  {
    id: 'Cumulative Volume Delta', name: 'Cumulative Volume Delta', shortName: 'CVD', category: 'Volume', overlay: false, aliases: ['CVD'], format: 'volume', precision: 2, includeZero: true,
    description: 'Approximation: bar polarity from OHLC (no intrabar data). Candle open = previous close (0 at each anchor period), close = open + bar delta.',
    inputs: [
      { id: 'anchor', name: 'Anchor period', type: 'select', defval: '1D', options: ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M', '3M', '12M'] },
      ...LTF_INPUTS,
    ],
    plots: [
      { id: 'close', title: 'CVD', style: plotStyle({ type: 'candles', color: UP }) },
      { id: 'open', title: 'Open', style: plotStyle({ type: 'none', color: GRAY, showLast: false }), hideInLegend: true },
    ],
    bands: [zeroBand],
    compute(ctx, inp) {
      const n = ctx.n;
      const pol = ctx.ta.barPolarity(ctx.open, ctx.close);
      const np = newPeriodFlags(timeframeKeys(ctx.time, ctx.timezone, inp.anchor));
      const open = ta.nanArray(n), close = ta.nanArray(n);
      let cum = 0;
      for (let i = 0; i < n; i++) {
        if (np[i]) cum = 0;
        const v = ta.isNum(ctx.volume[i]) ? ctx.volume[i] : 0;
        open[i] = cum;
        cum += pol[i] * v;
        close[i] = cum;
      }
      const colors: Array<string | null> = new Array(n);
      for (let i = 0; i < n; i++) colors[i] = close[i] >= open[i] ? UP : DOWN;
      return { close: { values: close, colors }, open };
    },
    customRender(rc, inst) { renderDeltaCandles(rc, inst, 'open', 'close'); },
  },
  {
    id: '24-hour Volume', name: '24-hour Volume', shortName: '24h Vol', category: 'Volume', overlay: false, aliases: ['24h Volume'], format: 'volume', precision: 2, includeZero: true,
    description: 'Sum of volume × price over the chart bars that opened in the last 24 hours (TradingView uses lower-timeframe bars and can convert currency; only "Default" currency is supported).',
    inputs: [
      { id: 'source', name: 'Price Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'currency', name: 'Target Currency', type: 'select', defval: 'Default', options: ['Default', 'USD', 'EUR', 'CAD', 'JPY', 'GBP', 'HKD', 'CNY', 'NZD', 'RUB'], tooltip: 'Currency conversion is not available (no FX feed); all options behave like Default.' },
    ],
    plots: [{ id: 'vol', title: '24h Volume', style: plotStyle({ color: BLUE }) }],
    compute(ctx, inp) {
      const n = ctx.n;
      const price = ctx.source(inp.source);
      const pv = ta.nanArray(n);
      for (let i = 0; i < n; i++) pv[i] = ta.isNum(ctx.volume[i]) ? ctx.volume[i] * price[i] : 0;
      const start = ctx.ta.timeWindowStart(ctx.time, 86400, 1);
      return { vol: ctx.ta.windowSum(pv, start) };
    },
  },
  {
    id: 'Relative Volume at Time', name: 'Relative Volume at Time', shortName: 'RVOL', category: 'Volume', overlay: false, aliases: ['RVOL', 'Relative Volume'], precision: 2, includeZero: true,
    inputs: [
      { id: 'anchorTf', name: 'Anchor Timeframe', type: 'select', defval: '1D', options: ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M'] },
      { id: 'length', name: 'Length', type: 'int', defval: 5, min: 1, max: 500 },
      { id: 'mode', name: 'Calculation Mode', type: 'select', defval: 'Cumulative', options: ['Cumulative', 'Regular'] },
      { id: 'adjustRealtime', name: 'Adjust unconfirmed volume', type: 'bool', defval: true, tooltip: 'No effect: bars are treated as closed.' },
    ],
    plots: [{ id: 'rvol', title: 'Relative Volume', style: plotStyle({ type: 'columns', color: UP }) }],
    bands: [{ id: 'one', title: 'Level', value: 1, color: GRAY, lineStyle: 2, lineWidth: 1, visible: true }],
    compute(ctx, inp) {
      const n = ctx.n;
      const out = ta.nanArray(n);
      const length = Math.max(1, inp.length | 0);
      const vol = ctx.volume;
      const anchorSec = parseResolution(inp.anchorTf).seconds;
      const chartSec = parseResolution(ctx.resolution).seconds;
      const cumulative = inp.mode !== 'Regular';
      if (anchorSec <= chartSec) {
        // every chart bar is its own anchor period: volume vs the average of the previous `length` bars
        for (let i = length; i < n; i++) {
          let s = 0, ok = true;
          for (let k = 1; k <= length; k++) { const v = vol[i - k]; if (!ta.isNum(v)) { ok = false; break; } s += v; }
          if (ok && s > 0) out[i] = vol[i] / (s / length);
        }
      } else {
        const keys = timeframeKeys(ctx.time, ctx.timezone, inp.anchorTf);
        const starts: number[] = [];
        const pidx = new Int32Array(n), offs = new Float64Array(n), cums = new Float64Array(n);
        let cum = 0;
        for (let i = 0; i < n; i++) {
          if (i === 0 || keys[i] !== keys[i - 1]) { starts.push(i); cum = 0; }
          const p = starts.length - 1;
          cum += ta.isNum(vol[i]) ? vol[i] : 0;
          pidx[i] = p; offs[i] = ctx.time[i] - ctx.time[starts[p]]; cums[i] = cum;
        }
        const endOf = (p: number) => (p + 1 < starts.length ? starts[p + 1] - 1 : n - 1);
        for (let i = 0; i < n; i++) {
          const p = pidx[i];
          let s = 0, cnt = 0;
          for (let k = 1; k <= length; k++) {
            const q = p - k;
            if (q < 0) break;
            // last bar of period q whose offset <= current offset (binary search; offsets are increasing)
            let lo = starts[q], hi = endOf(q), j = -1;
            while (lo <= hi) { const mid = (lo + hi) >> 1; if (offs[mid] <= offs[i]) { j = mid; lo = mid + 1; } else hi = mid - 1; }
            if (j < 0) continue;
            s += cumulative ? cums[j] : (ta.isNum(vol[j]) ? vol[j] : 0);
            cnt++;
          }
          if (cnt > 0 && s > 0) out[i] = (cumulative ? cums[i] : vol[i]) / (s / cnt);
        }
      }
      const colors: Array<string | null> = new Array(n);
      for (let i = 0; i < n; i++) colors[i] = out[i] !== out[i] ? null : out[i] >= 1 ? UP : DOWN;
      return { rvol: { values: out, colors } };
    },
  },
  {
    id: 'Volume Weighted Average Price', name: 'Volume Weighted Average Price', shortName: 'VWAP', category: 'Volume', overlay: true, aliases: ['VWAP'], precision: 'inherit',
    inputs: [
      { id: 'hideOnDWM', name: 'Hide VWAP on 1D or Above', type: 'bool', defval: false, group: 'VWAP Settings' },
      { id: 'anchor', name: 'Anchor Period', type: 'select', defval: 'Session', options: ANCHOR_PERIODS, group: 'VWAP Settings' },
      { id: 'source', name: 'Source', type: 'source', defval: 'hlc3', options: SOURCES, group: 'VWAP Settings' },
      { id: 'offset', name: 'Offset', type: 'int', defval: 0, min: 0, group: 'VWAP Settings' },
      ...bandInputs(),
    ],
    plots: [{ id: 'vwap', title: 'VWAP', style: plotStyle({ color: BLUE }) }, ...bandPlots()],
    fills: bandFills(),
    compute(ctx, inp) {
      const n = ctx.n;
      const ids = ['vwap', 'upper1', 'lower1', 'upper2', 'lower2', 'upper3', 'lower3'];
      if (inp.hideOnDWM && parseResolution(ctx.resolution).isDWM) return nanResult(n, ids);
      const src = ctx.source(inp.source);
      const np = newPeriodFlags(calendarKeys(ctx.time, ctx.timezone, inp.anchor));
      const { vwap, stdev } = ctx.ta.vwapStdev(src, ctx.volume, np);
      return vwapBands(n, vwap, stdev, inp, Math.max(0, inp.offset | 0));
    },
  },
  {
    id: 'VWAP Auto Anchored', name: 'VWAP Auto Anchored', shortName: 'VWAP Auto', category: 'Volume', overlay: true, aliases: ['Auto Anchored VWAP'], precision: 'inherit',
    inputs: [
      { id: 'anchor', name: 'Anchor Period', type: 'select', defval: 'Auto', options: ['Auto', 'Highest High', 'Lowest Low', 'Highest Volume', ...ANCHOR_PERIODS] },
      { id: 'length', name: 'Length', type: 'int', defval: 10, min: 1, max: 5000, tooltip: 'Rolling window for the Highest High / Lowest Low / Highest Volume anchors' },
      { id: 'source', name: 'Source', type: 'source', defval: 'hlc3', options: SOURCES },
      { id: 'offset', name: 'Offset', type: 'int', defval: 0, min: 0 },
      ...bandInputs(),
    ],
    plots: [{ id: 'vwap', title: 'VWAP', style: plotStyle({ color: BLUE }) }, ...bandPlots()],
    fills: bandFills(),
    compute(ctx, inp) {
      const n = ctx.n;
      const ids = ['vwap', 'upper1', 'lower1', 'upper2', 'lower2', 'upper3', 'lower3'];
      if (n === 0) return nanResult(n, ids);
      const src = ctx.source(inp.source);
      const anchorIdx = findAnchorIndex(ctx, inp.anchor, inp.length | 0);
      const np = new Uint8Array(n);
      np[anchorIdx] = 1;
      const masked = ta.nanArray(n);
      for (let i = anchorIdx; i < n; i++) masked[i] = src[i];
      const { vwap, stdev } = ctx.ta.vwapStdev(masked, ctx.volume, np);
      return vwapBands(n, vwap, stdev, inp, Math.max(0, inp.offset | 0));
    },
  },
  {
    id: 'Rolling VWAP', name: 'Rolling VWAP', shortName: 'RVWAP', category: 'Volume', overlay: true, aliases: ['RVWAP'], precision: 'inherit',
    inputs: [
      { id: 'source', name: 'Source', type: 'source', defval: 'hlc3', options: SOURCES },
      { id: 'useAuto', name: 'Use Auto Time Window', type: 'bool', defval: true },
      { id: 'days', name: 'Days', type: 'int', defval: 1, min: 0, group: 'Fixed Time Period', inline: 'fixed' },
      { id: 'hours', name: 'Hours', type: 'int', defval: 0, min: 0, max: 23, group: 'Fixed Time Period', inline: 'fixed' },
      { id: 'minutes', name: 'Minutes', type: 'int', defval: 0, min: 0, max: 59, group: 'Fixed Time Period', inline: 'fixed' },
      { id: 'minBars', name: 'Minimum Bars', type: 'int', defval: 10, min: 1 },
      ...bandInputs(),
    ],
    plots: [{ id: 'vwap', title: 'RVWAP', style: plotStyle({ color: BLUE }) }, ...bandPlots()],
    fills: bandFills(),
    compute(ctx, inp) {
      const n = ctx.n;
      const src = ctx.source(inp.source);
      let windowSec = inp.useAuto ? autoRollingWindow(ctx.resolution) : (inp.days | 0) * 86400 + (inp.hours | 0) * 3600 + (inp.minutes | 0) * 60;
      if (!(windowSec > 0)) windowSec = autoRollingWindow(ctx.resolution);
      const start = ctx.ta.timeWindowStart(ctx.time, windowSec, Math.max(1, inp.minBars | 0));
      const v = ta.nanArray(n), pv = ta.nanArray(n), ppv = ta.nanArray(n);
      for (let i = 0; i < n; i++) {
        const vol = ta.isNum(ctx.volume[i]) ? ctx.volume[i] : 0;
        v[i] = vol; pv[i] = src[i] * vol; ppv[i] = src[i] * src[i] * vol;
      }
      const sv = ctx.ta.windowSum(v, start), spv = ctx.ta.windowSum(pv, start), sppv = ctx.ta.windowSum(ppv, start);
      const vwap = ta.nanArray(n), stdev = ta.nanArray(n);
      for (let i = 0; i < n; i++) {
        if (!(sv[i] > 0)) continue;
        const m = spv[i] / sv[i];
        vwap[i] = m;
        stdev[i] = Math.sqrt(Math.max(sppv[i] / sv[i] - m * m, 0));
      }
      return vwapBands(n, vwap, stdev, inp, 0);
    },
  },
];

/** Auto time window of the Rolling VWAP script (`timeStep_translate`): seconds→1D, ≤15min→1W, >15min→1M, D/W/M→12M. */
export function autoRollingWindow(res: string): number {
  const r = parseResolution(res);
  if (r.unit === 'S') return 86400;
  if (r.unit === 'MIN' || r.unit === 'R') return r.mult <= 15 ? 604800 : 2628003;
  return 12 * 2628003;
}

/** Anchor bar index for VWAP Auto Anchored / Auto Anchored Volume Profile. */
export function findAnchorIndex(ctx: { n: number; time: Float64Array; high: Float64Array; low: Float64Array; volume: Float64Array; resolution: string; timezone: string }, anchor: string, length: number): number {
  const n = ctx.n;
  if (n === 0) return 0;
  const len = Math.max(1, Math.min(n, length || 1));
  const from = n - len;
  if (anchor === 'Highest High' || anchor === 'Lowest Low' || anchor === 'Highest Volume') {
    let best = from;
    for (let i = from; i < n; i++) {
      if (anchor === 'Highest High' && ctx.high[i] > ctx.high[best]) best = i;
      else if (anchor === 'Lowest Low' && ctx.low[i] < ctx.low[best]) best = i;
      else if (anchor === 'Highest Volume' && (ctx.volume[i] || 0) > (ctx.volume[best] || 0)) best = i;
    }
    return best;
  }
  const a = anchor === 'Auto' || !anchor ? autoAnchorFor(ctx.resolution) : anchor;
  const keys = calendarKeys(ctx.time, ctx.timezone, a);
  let idx = 0;
  for (let i = n - 1; i > 0; i--) if (keys[i] !== keys[i - 1]) { idx = i; break; }
  return idx;
}

/** NVI (dir = -1) / PVI (dir = +1) starting at 1000. */
function volumeIndex(ctx: IndicatorContext, dir: 1 | -1): Float64Array {
  const n = ctx.n;
  const out = ta.nanArray(n);
  let prev = 1000;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const c = ctx.close[i], pc = ctx.close[i - 1];
      const v = ctx.volume[i], pv = ta.isNum(ctx.volume[i - 1]) ? ctx.volume[i - 1] : 0;
      const trigger = dir < 0 ? v < pv : v > pv;
      if (trigger && ta.isNum(c) && ta.isNum(pc) && pc !== 0) prev = prev + ((c - pc) / pc) * prev;
    }
    out[i] = prev;
  }
  return out;
}
