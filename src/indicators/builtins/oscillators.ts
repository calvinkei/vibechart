import { plotStyle, type IndicatorDefinition } from '../Indicator';
import { MA_TYPES } from '../ta';

const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];

export const oscillators: IndicatorDefinition[] = [
  {
    id: 'Relative Strength Index', name: 'Relative Strength Index', shortName: 'RSI', category: 'Oscillators', overlay: false, aliases: ['RSI'],
    inputs: [
      { id: 'length', name: 'RSI Length', type: 'int', defval: 14, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'maType', name: 'MA Type', type: 'select', defval: 'None', options: ['None', ...MA_TYPES, 'Bollinger Bands'], group: 'MA Settings' },
      { id: 'maLength', name: 'MA Length', type: 'int', defval: 14, min: 1, group: 'MA Settings' },
      { id: 'bbMult', name: 'BB StdDev', type: 'float', defval: 2, min: 0.001, max: 50, step: 0.1, group: 'MA Settings' },
    ],
    plots: [
      { id: 'rsi', title: 'RSI', style: plotStyle({ color: '#7E57C2', lineWidth: 1 }) },
      { id: 'ma', title: 'RSI-based MA', style: plotStyle({ color: '#FFEB3B', lineWidth: 1 }) },
      { id: 'bbUpper', title: 'Upper Bollinger Band', style: plotStyle({ color: '#089981', lineWidth: 1 }) },
      { id: 'bbLower', title: 'Lower Bollinger Band', style: plotStyle({ color: '#089981', lineWidth: 1 }) },
    ],
    bands: [
      { id: 'upper', title: 'Upper Band', value: 70, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'middle', title: 'Middle Band', value: 50, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'lower', title: 'Lower Band', value: 30, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    fills: [
      { id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#7E57C2', transparency: 90, visible: true },
      { id: 'bbFill', title: 'BB Background', a: 'bbUpper', b: 'bbLower', color: '#089981', transparency: 90, visible: true },
    ],
    precision: 2,
    compute(ctx, inp) {
      const rsi = ctx.ta.rsi(ctx.source(inp.source), inp.length);
      let ma = ctx.ta.nanArray(ctx.n);
      let bbUpper = ctx.ta.nanArray(ctx.n), bbLower = ctx.ta.nanArray(ctx.n);
      if (inp.maType && inp.maType !== 'None') {
        const t = inp.maType === 'Bollinger Bands' ? 'SMA' : inp.maType;
        ma = ctx.ta.maByType(t, rsi, inp.maLength, ctx.volume);
        if (inp.maType === 'Bollinger Bands') {
          const sd = ctx.ta.stdev(rsi, inp.maLength);
          for (let i = 0; i < ctx.n; i++) { bbUpper[i] = ma[i] + inp.bbMult * sd[i]; bbLower[i] = ma[i] - inp.bbMult * sd[i]; }
        }
      }
      return { rsi, ma, bbUpper, bbLower };
    },
  },
  {
    id: 'MACD', name: 'Moving Average Convergence Divergence', shortName: 'MACD', category: 'Oscillators', overlay: false, aliases: ['MACD', 'Moving Average Convergence/Divergence'],
    inputs: [
      { id: 'fast', name: 'Fast Length', type: 'int', defval: 12, min: 1 },
      { id: 'slow', name: 'Slow Length', type: 'int', defval: 26, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'signal', name: 'Signal Smoothing', type: 'int', defval: 9, min: 1, max: 50 },
      { id: 'maType', name: 'Oscillator MA Type', type: 'select', defval: 'EMA', options: ['SMA', 'EMA'] },
      { id: 'sigType', name: 'Signal Line MA Type', type: 'select', defval: 'EMA', options: ['SMA', 'EMA'] },
    ],
    plots: [
      { id: 'hist', title: 'Histogram', style: plotStyle({ type: 'histogram', color: '#26A69A' }) },
      { id: 'macd', title: 'MACD', style: plotStyle({ color: '#2962FF' }) },
      { id: 'signal', title: 'Signal', style: plotStyle({ color: '#FF6D00' }) },
    ],
    bands: [{ id: 'zero', title: 'Zero', value: 0, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true }],
    precision: 'inherit',
    includeZero: true,
    compute(ctx, inp) {
      const r = ctx.ta.macd(ctx.source(inp.source), inp.fast, inp.slow, inp.signal, inp.maType, inp.sigType);
      const colors: Array<string | null> = new Array(ctx.n);
      for (let i = 0; i < ctx.n; i++) {
        const h = r.hist[i], p = r.hist[i - 1];
        if (h !== h) { colors[i] = null; continue; }
        colors[i] = h >= 0 ? (p === p && h < p ? '#B2DFDB' : '#26A69A') : (p === p && h > p ? '#FFCDD2' : '#FF5252');
      }
      return { hist: { values: r.hist, colors }, macd: r.macd, signal: r.signal };
    },
  },
  {
    id: 'Stochastic', name: 'Stochastic', shortName: 'Stoch', category: 'Oscillators', overlay: false, aliases: ['Stoch'],
    inputs: [
      { id: 'k', name: '%K Length', type: 'int', defval: 14, min: 1 },
      { id: 'kSmooth', name: '%K Smoothing', type: 'int', defval: 1, min: 1 },
      { id: 'd', name: '%D Smoothing', type: 'int', defval: 3, min: 1 },
    ],
    plots: [
      { id: 'k', title: '%K', style: plotStyle({ color: '#2962FF' }) },
      { id: 'd', title: '%D', style: plotStyle({ color: '#FF6D00' }) },
    ],
    bands: [
      { id: 'upper', title: 'Upper Band', value: 80, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'middle', title: 'Middle Band', value: 50, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: false },
      { id: 'lower', title: 'Lower Band', value: 20, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#2962FF', transparency: 90, visible: true }],
    precision: 2,
    compute(ctx, inp) {
      const k = ctx.ta.sma(ctx.ta.stoch(ctx.close, ctx.high, ctx.low, inp.k), inp.kSmooth);
      const d = ctx.ta.sma(k, inp.d);
      return { k, d };
    },
  },
  {
    id: 'Volume', name: 'Volume', shortName: 'Vol', category: 'Volume', overlay: false, aliases: ['Volume'], format: 'volume', precision: 2,
    inputs: [
      { id: 'showMA', name: 'Show MA', type: 'bool', defval: false },
      { id: 'maLength', name: 'MA Length', type: 'int', defval: 20, min: 1 },
      { id: 'colorBased', name: 'Color based on previous close', type: 'bool', defval: false },
    ],
    plots: [
      { id: 'vol', title: 'Volume', style: plotStyle({ type: 'columns', color: '#26A69A', transparency: 50 }) },
      { id: 'ma', title: 'Volume MA', style: plotStyle({ color: '#2962FF', visible: false }) },
    ],
    compute(ctx, inp) {
      const colors: Array<string | null> = new Array(ctx.n);
      for (let i = 0; i < ctx.n; i++) {
        const up = inp.colorBased && i > 0 ? ctx.close[i] >= ctx.close[i - 1] : ctx.close[i] >= ctx.open[i];
        colors[i] = up ? '#26A69A' : '#EF5350';
      }
      return { vol: { values: ctx.volume, colors }, ma: inp.showMA ? ctx.ta.sma(ctx.volume, inp.maLength) : ctx.ta.nanArray(ctx.n) };
    },
  },
  {
    id: 'Average True Range', name: 'Average True Range', shortName: 'ATR', category: 'Volatility', overlay: false, aliases: ['ATR'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 14, min: 1 },
      { id: 'smoothing', name: 'Smoothing', type: 'select', defval: 'RMA', options: ['RMA', 'SMA', 'EMA', 'WMA'] },
    ],
    plots: [{ id: 'atr', title: 'ATR', style: plotStyle({ color: '#F23645' }) }],
    precision: 'inherit',
    compute(ctx, inp) {
      const tr = ctx.ta.tr(ctx.high, ctx.low, ctx.close, true);
      return { atr: ctx.ta.maByType(inp.smoothing, tr, inp.length) };
    },
  },
];
