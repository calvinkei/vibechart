import { plotStyle, type IndicatorDefinition, type IndicatorInput, type ComputeResult } from '../Indicator';
import { MA_TYPES } from '../ta';
import { dateParts, tzOffset } from '../../util/time';

const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];
const isNum = (v: number): boolean => v === v && v !== Infinity && v !== -Infinity;

function maDef(id: string, name: string, shortName: string, type: string, length: number, aliases: string[] = []): IndicatorDefinition {
  return {
    id, name, shortName, category: 'Moving Averages', overlay: true, aliases,
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: length, min: 1, max: 5000 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'offset', name: 'Offset', type: 'int', defval: 0, min: -500, max: 500 },
      { id: 'smoothingLine', name: 'Smoothing Line', type: 'select', defval: 'None', options: ['None', ...MA_TYPES], group: 'Smoothing' },
      { id: 'smoothingLength', name: 'Smoothing Length', type: 'int', defval: 5, min: 1, max: 5000, group: 'Smoothing' },
    ],
    plots: [
      { id: 'ma', title: shortName, style: plotStyle({ color: '#2962FF', lineWidth: 1 }) },
      { id: 'smooth', title: 'Smoothing Line', style: plotStyle({ color: '#FF6D00', lineWidth: 1, visible: false }) },
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const src = ctx.source(inp.source);
      const ma = ctx.ta.maByType(type, src, inp.length, ctx.volume);
      const out: Record<string, any> = { ma: { values: ma } };
      if (inp.smoothingLine && inp.smoothingLine !== 'None') out.smooth = ctx.ta.maByType(inp.smoothingLine, ma, inp.smoothingLength, ctx.volume);
      else out.smooth = ctx.ta.nanArray(ctx.n);
      // apply offset via plot style at runtime
      return out;
    },
  };
}

// ---- shared time-period helpers (used by TWAP here and by Pivot Points Standard) ----

function normalizeAnchor(a: string): string {
  switch (a) {
    case 'Week': case 'Weekly': case '1W': case 'W': return 'W';
    case 'Month': case 'Monthly': case '1M': case 'M': return 'M';
    case 'Quarter': case 'Quarterly': case '3M': return '3M';
    case 'Year': case 'Yearly': case '12M': return '12M';
    case 'Biyearly': case '24M': return '24M';
    case 'Triyearly': case '36M': return '36M';
    case 'Quinquennially': case '60M': return '60M';
    case 'Decade': case 'Decennially': case '120M': return '120M';
    case 'Century': return '1200M';
    default: return 'D'; // Session / Daily / 1D
  }
}

/**
 * Period key for a bar time, evaluated in the chart timezone. Two bars belong to the same anchor period when their keys match
 * (Pine `timeframe.change("D"|"W"|"M"|"3M"|"12M")`). Accepts VWAP anchor names ("Session", "Week", ...) and pivot timeframes ("1D", "Weekly", ...).
 */
export function anchorKeyFn(anchor: string, tz: string): (t: number) => string {
  const kind = normalizeAnchor(anchor);
  return (t: number): string => {
    const p = dateParts(t, tz);
    switch (kind) {
      case 'W': { const localDay = Math.floor((t + tzOffset(t, tz)) / 86400); return `W${localDay - ((p.weekday + 6) % 7)}`; }
      case 'M': return `${p.year}-${p.month}`;
      case '3M': return `${p.year}-Q${Math.floor((p.month - 1) / 3)}`;
      case '12M': return `${p.year}`;
      case '24M': return `Y2-${Math.floor(p.year / 2)}`;
      case '36M': return `Y3-${Math.floor(p.year / 3)}`;
      case '60M': return `Y5-${Math.floor(p.year / 5)}`;
      case '120M': return `Y10-${Math.floor(p.year / 10)}`;
      case '1200M': return `Y100-${Math.floor(p.year / 100)}`;
      default: return `${p.year}-${p.month}-${p.day}`;
    }
  };
}

/** Marks bars where `a` crosses `b` in either direction (Pine `ta.cross`). Returns `a` on cross bars, NaN elsewhere. */
function crossMarkers(a: Float64Array, b: Float64Array): Float64Array {
  const n = a.length;
  const out = new Float64Array(n);
  out.fill(NaN);
  for (let i = 1; i < n; i++) {
    if (!isNum(a[i]) || !isNum(b[i]) || !isNum(a[i - 1]) || !isNum(b[i - 1])) continue;
    if ((a[i] > b[i] && a[i - 1] <= b[i - 1]) || (a[i] < b[i] && a[i - 1] >= b[i - 1])) out[i] = a[i];
  }
  return out;
}

/** N simple moving averages on one source (library studies Moving Average Double / Triple / Multiple). */
function multiSmaDef(id: string, shortName: string, lengths: number[], colors: string[]): IndicatorDefinition {
  const inputs: IndicatorInput[] = lengths.map((l, k) => ({ id: `length${k + 1}`, name: `Length ${k + 1}`, type: 'int', defval: l, min: 1 }));
  inputs.push({ id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES });
  return {
    id, name: id, shortName, category: 'Moving Averages', overlay: true,
    inputs,
    plots: lengths.map((_, k) => ({ id: `ma${k + 1}`, title: `Plot ${k + 1}`, style: plotStyle({ color: colors[k] }) })),
    precision: 'inherit',
    compute(ctx, inp) {
      const src = ctx.source(inp.source);
      const out: ComputeResult = {};
      for (let k = 0; k < lengths.length; k++) out[`ma${k + 1}`] = ctx.ta.sma(src, inp[`length${k + 1}`]);
      return out;
    },
  };
}

const RIBBON_COLORS = ['#f6c309', '#fb9800', '#fb6500', '#f70000'];
const RIBBON_LENGTHS = [20, 50, 100, 200];
const GMMA_TRADER = [3, 5, 8, 10, 12, 15];
const GMMA_INVESTOR = [30, 35, 40, 45, 50, 60];
const GMMA_TRANSP = [15, 12, 9, 6, 3, 0];

export const movingAverages: IndicatorDefinition[] = [
  maDef('Moving Average', 'Moving Average', 'SMA', 'SMA', 9, ['MA', 'Simple Moving Average', 'MASimple']),
  maDef('Moving Average Exponential', 'Moving Average Exponential', 'EMA', 'EMA', 9, ['Exponential Moving Average', 'MAExp']),
  maDef('Moving Average Weighted', 'Moving Average Weighted', 'WMA', 'WMA', 9, ['Weighted Moving Average', 'MAWeighted']),
  maDef('Smoothed Moving Average', 'Smoothed Moving Average', 'SMMA', 'SMMA', 7, ['SMMA (RMA)', 'RMA']),
  maDef('Hull Moving Average', 'Hull Moving Average', 'HMA', 'HMA', 9, ['HullMA']),
  maDef('Double EMA', 'Double EMA', 'DEMA', 'DEMA', 9, ['DEMA']),
  maDef('Triple EMA', 'Triple EMA', 'TEMA', 'TEMA', 9, ['TEMA']),
  maDef('Volume Weighted Moving Average', 'Volume Weighted Moving Average', 'VWMA', 'VWMA', 20, ['VWMA']),
  maDef('Least Squares Moving Average', 'Least Squares Moving Average', 'LSMA', 'LSMA', 25, ['LSMA', 'Linear Regression']),
  {
    id: 'Bollinger Bands', name: 'Bollinger Bands', shortName: 'BB', category: 'Volatility', overlay: true, aliases: ['BB'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 20, min: 1 },
      { id: 'maType', name: 'Basis MA Type', type: 'select', defval: 'SMA', options: MA_TYPES },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'mult', name: 'StdDev', type: 'float', defval: 2, min: 0.001, max: 50, step: 0.1 },
      { id: 'offset', name: 'Offset', type: 'int', defval: 0, min: -500, max: 500 },
    ],
    plots: [
      { id: 'basis', title: 'Basis', style: plotStyle({ color: '#2962FF' }) },
      { id: 'upper', title: 'Upper', style: plotStyle({ color: '#089981' }) },
      { id: 'lower', title: 'Lower', style: plotStyle({ color: '#F23645' }) },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#2962FF', transparency: 95, visible: true }],
    precision: 'inherit',
    compute(ctx, inp) {
      const src = ctx.source(inp.source);
      const basis = ctx.ta.maByType(inp.maType, src, inp.length, ctx.volume);
      const dev = ctx.ta.stdev(src, inp.length);
      const upper = ctx.ta.nanArray(ctx.n), lower = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) { upper[i] = basis[i] + inp.mult * dev[i]; lower[i] = basis[i] - inp.mult * dev[i]; }
      return { basis, upper, lower };
    },
  },

  // ---- additions (spec §3.4, 3.41, 3.44, 3.48, 3.55, 3.58, 3.64, 3.101) ----
  {
    id: 'Arnaud Legoux Moving Average', name: 'Arnaud Legoux Moving Average', shortName: 'ALMA', category: 'Moving Averages', overlay: true, aliases: ['ALMA'],
    inputs: [
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'windowSize', name: 'Window Size', type: 'int', defval: 9, min: 1 },
      { id: 'offset', name: 'Offset', type: 'float', defval: 0.85, min: 0, max: 1, step: 0.05 },
      { id: 'sigma', name: 'Sigma', type: 'float', defval: 6, min: 0.001, step: 0.5 },
    ],
    plots: [{ id: 'alma', title: 'ALMA', style: plotStyle({ color: '#2962FF' }) }],
    precision: 'inherit',
    compute(ctx, inp) {
      return { alma: ctx.ta.alma(ctx.source(inp.source), inp.windowSize, inp.offset, inp.sigma) };
    },
  },
  {
    id: 'McGinley Dynamic', name: 'McGinley Dynamic', shortName: 'McGinley Dynamic', category: 'Moving Averages', overlay: true, aliases: ['McGinley'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 14, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [{ id: 'mg', title: 'McGinley Dynamic', style: plotStyle({ color: '#2962FF' }) }],
    precision: 'inherit',
    compute(ctx, inp) {
      return { mg: ctx.ta.mcginley(ctx.source(inp.source), inp.length) };
    },
  },
  {
    id: 'Moving Average Adaptive', name: "Kaufman's Adaptive Moving Average", shortName: 'KAMA', category: 'Moving Averages', overlay: true,
    aliases: ["Kaufman's Adaptive Moving Average", 'KAMA', 'Kaufman Adaptive Moving Average'],
    inputs: [
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'erLength', name: 'ER Length', type: 'int', defval: 10, min: 1 },
      { id: 'fastLength', name: 'Fast Length', type: 'int', defval: 2, min: 1 },
      { id: 'slowLength', name: 'Slow Length', type: 'int', defval: 30, min: 1 },
    ],
    plots: [{ id: 'kama', title: 'KAMA', style: plotStyle({ color: '#2962FF' }) }],
    precision: 'inherit',
    compute(ctx, inp) {
      return { kama: ctx.ta.kama(ctx.source(inp.source), inp.erLength, inp.fastLength, inp.slowLength) };
    },
  },
  {
    id: 'MA Cross', name: 'MA Cross', shortName: 'MA Cross', category: 'Moving Averages', overlay: true, aliases: ['Moving Average Cross'],
    inputs: [
      { id: 'shortLength', name: 'Short MA Length', type: 'int', defval: 9, min: 1 },
      { id: 'longLength', name: 'Long MA Length', type: 'int', defval: 21, min: 1 },
    ],
    plots: [
      { id: 'short', title: 'Short', style: plotStyle({ color: '#FF6D00' }) },
      { id: 'long', title: 'Long', style: plotStyle({ color: '#43A047' }) },
      { id: 'crosses', title: 'Crosses', style: plotStyle({ type: 'cross', color: '#2962FF', lineWidth: 4, showLast: false }) },
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const short = ctx.ta.sma(ctx.close, inp.shortLength);
      const long = ctx.ta.sma(ctx.close, inp.longLength);
      return { short, long, crosses: crossMarkers(short, long) };
    },
  },
  {
    id: 'MA with EMA Cross', name: 'MA with EMA Cross', shortName: 'MA/EMA Cross', category: 'Moving Averages', overlay: true,
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 9, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [
      { id: 'ma', title: 'MA', style: plotStyle({ color: '#FF6D00' }) },
      { id: 'ema', title: 'EMA', style: plotStyle({ color: '#43A047' }) },
      { id: 'crosses', title: 'Crosses', style: plotStyle({ type: 'cross', color: '#2962FF', lineWidth: 4, showLast: false }) },
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const src = ctx.source(inp.source);
      const ma = ctx.ta.sma(src, inp.length);
      const e = ctx.ta.ema(src, inp.length);
      return { ma, ema: e, crosses: crossMarkers(ma, e) };
    },
  },
  {
    id: 'EMA Cross', name: 'EMA Cross', shortName: 'EMA Cross', category: 'Moving Averages', overlay: true,
    inputs: [
      { id: 'shortLength', name: 'Short EMA Length', type: 'int', defval: 9, min: 1 },
      { id: 'longLength', name: 'Long EMA Length', type: 'int', defval: 26, min: 1 },
    ],
    plots: [
      { id: 'short', title: 'Short', style: plotStyle({ color: '#FF6D00' }) },
      { id: 'long', title: 'Long', style: plotStyle({ color: '#43A047' }) },
      { id: 'crosses', title: 'Crosses', style: plotStyle({ type: 'cross', color: '#2196F3', lineWidth: 4, showLast: false }) },
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const short = ctx.ta.ema(ctx.close, inp.shortLength);
      const long = ctx.ta.ema(ctx.close, inp.longLength);
      return { short, long, crosses: crossMarkers(short, long) };
    },
  },
  {
    id: 'Moving Average Ribbon', name: 'Moving Average Ribbon', shortName: 'MA Ribbon', category: 'Moving Averages', overlay: true, aliases: ['MA Ribbon'],
    inputs: RIBBON_LENGTHS.flatMap((len, k): IndicatorInput[] => {
      const g = `MA №${k + 1}`;
      return [
        { id: `ma${k + 1}Enabled`, name: g, type: 'bool', defval: true, group: g, inline: g },
        { id: `ma${k + 1}Type`, name: 'Type', type: 'select', defval: 'SMA', options: MA_TYPES, group: g, inline: g },
        { id: `ma${k + 1}Source`, name: 'Source', type: 'source', defval: 'close', options: SOURCES, group: g, inline: g },
        { id: `ma${k + 1}Length`, name: 'Length', type: 'int', defval: len, min: 1, group: g, inline: g },
      ];
    }),
    plots: RIBBON_LENGTHS.map((_, k) => ({ id: `ma${k + 1}`, title: `MA №${k + 1}`, style: plotStyle({ color: RIBBON_COLORS[k] }) })),
    precision: 'inherit',
    compute(ctx, inp) {
      const out: ComputeResult = {};
      for (let k = 1; k <= 4; k++) {
        out[`ma${k}`] = inp[`ma${k}Enabled`]
          ? ctx.ta.maByType(inp[`ma${k}Type`], ctx.source(inp[`ma${k}Source`]), inp[`ma${k}Length`], ctx.volume)
          : ctx.ta.nanArray(ctx.n);
      }
      return out;
    },
  },
  multiSmaDef('Moving Average Double', 'MA Double', [20, 50], ['#FF6D00', '#2196F3']),
  multiSmaDef('Moving Average Triple', 'MA Triple', [20, 50, 100], ['#FF6D00', '#2196F3', '#26C6DA']),
  multiSmaDef('Moving Average Multiple', 'MA Multiple', [5, 10, 20, 30, 50, 100], ['#9C27B0', '#FF6D00', '#43A047', '#26C6DA', '#F50057', '#2196F3']),
  {
    id: 'Moving Average Hamming', name: 'Moving Average Hamming', shortName: 'MA Hamming', category: 'Moving Averages', overlay: true,
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 20, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [{ id: 'ma', title: 'Plot 1', style: plotStyle({ color: '#4CAF50' }) }],
    precision: 'inherit',
    compute(ctx, inp) {
      return { ma: ctx.ta.hamming(ctx.source(inp.source), inp.length) };
    },
  },
  {
    id: 'Moving Average Channel', name: 'Moving Average Channel', shortName: 'MA Channel', category: 'Moving Averages', overlay: true,
    inputs: [
      { id: 'upperLength', name: 'Upper Length', type: 'int', defval: 20, min: 1 },
      { id: 'lowerLength', name: 'Lower Length', type: 'int', defval: 20, min: 1 },
      { id: 'upperSource', name: 'Upper Source', type: 'source', defval: 'high', options: SOURCES },
      { id: 'lowerSource', name: 'Lower Source', type: 'source', defval: 'low', options: SOURCES },
      { id: 'offset', name: 'Offset', type: 'int', defval: 0, min: -500, max: 500 },
    ],
    plots: [
      { id: 'upper', title: 'Upper', style: plotStyle({ color: '#2196F3' }) },
      { id: 'lower', title: 'Lower', style: plotStyle({ color: '#FF6D00' }) },
    ],
    fills: [{ id: 'bg', title: 'Plots Background', a: 'upper', b: 'lower', color: '#2196F3', transparency: 90, visible: true }],
    precision: 'inherit',
    compute(ctx, inp) {
      const upper = ctx.ta.sma(ctx.source(inp.upperSource), inp.upperLength);
      const lower = ctx.ta.sma(ctx.source(inp.lowerSource), inp.lowerLength);
      return { upper: ctx.ta.shiftSeriesTrend(upper, inp.offset), lower: ctx.ta.shiftSeriesTrend(lower, inp.offset) };
    },
  },
  {
    id: 'Guppy Multiple Moving Average', name: 'Guppy Multiple Moving Average', shortName: 'GMMA', category: 'Moving Averages', overlay: true, aliases: ['GMMA', 'Guppy'],
    inputs: [
      ...GMMA_TRADER.map((l, k): IndicatorInput => ({ id: `trader${k + 1}`, name: `Trader EMA ${k + 1} Length`, type: 'int', defval: l, min: 1, group: 'Trader EMAs' })),
      ...GMMA_INVESTOR.map((l, k): IndicatorInput => ({ id: `investor${k + 1}`, name: `Investor EMA ${k + 1} Length`, type: 'int', defval: l, min: 1, group: 'Investor EMAs' })),
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [
      ...GMMA_TRADER.map((_, k) => ({ id: `trader${k + 1}`, title: `Trader EMA ${k + 1}`, style: plotStyle({ color: '#2196F3', transparency: GMMA_TRANSP[k] }) })),
      ...GMMA_INVESTOR.map((_, k) => ({ id: `investor${k + 1}`, title: `Investor EMA ${k + 1}`, style: plotStyle({ color: '#FF0000', transparency: GMMA_TRANSP[k] }) })),
    ],
    precision: 'inherit',
    compute(ctx, inp) {
      const src = ctx.source(inp.source);
      const out: ComputeResult = {};
      for (let k = 1; k <= 6; k++) {
        out[`trader${k}`] = ctx.ta.ema(src, inp[`trader${k}`]);
        out[`investor${k}`] = ctx.ta.ema(src, inp[`investor${k}`]);
      }
      return out;
    },
  },
  {
    id: 'Time Weighted Average Price', name: 'Time Weighted Average Price', shortName: 'TWAP', category: 'Moving Averages', overlay: true, aliases: ['TWAP'],
    inputs: [
      { id: 'anchor', name: 'Anchor Period', type: 'select', defval: 'Session', options: ['Session', 'Week', 'Month', 'Quarter', 'Year', 'Decade', 'Century'] },
      { id: 'source', name: 'Source', type: 'source', defval: 'ohlc4', options: SOURCES },
      { id: 'offset', name: 'Offset', type: 'int', defval: 0, min: -500, max: 500 },
    ],
    plots: [{ id: 'twap', title: 'TWAP', style: plotStyle({ color: '#2962FF' }) }],
    precision: 'inherit',
    compute(ctx, inp) {
      const src = ctx.source(inp.source);
      const np = ctx.ta.periodChanges(ctx.time, anchorKeyFn(inp.anchor, ctx.timezone));
      const out = ctx.ta.nanArray(ctx.n);
      let s = 0, c = 0;
      for (let i = 0; i < ctx.n; i++) {
        if (np[i]) { s = 0; c = 0; }
        if (isNum(src[i])) { s += src[i]; c++; }
        out[i] = c ? s / c : NaN;
      }
      return { twap: ctx.ta.shiftSeriesTrend(out, inp.offset) };
    },
  },
];
