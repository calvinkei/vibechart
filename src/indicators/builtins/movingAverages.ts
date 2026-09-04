import { plotStyle, type IndicatorDefinition } from '../Indicator';
import { MA_TYPES } from '../ta';

const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];

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
];
