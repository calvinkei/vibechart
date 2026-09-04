import { plotStyle, type IndicatorDefinition } from '../Indicator';
import { zeroBand, histColors4 } from './oscillators';

const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];

/** momentum indicators — implemented in this file. */
export const momentumIndicators: IndicatorDefinition[] = [
  // ---- Momentum (§3.61) --------------------------------------------------------
  {
    id: 'Momentum', name: 'Momentum', shortName: 'Mom', category: 'Momentum', overlay: false, aliases: ['Mom', 'MOM'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 10, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [{ id: 'mom', title: 'MOM', style: plotStyle({ color: '#2962FF' }) }],
    bands: [zeroBand('Zero')],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      return { mom: ctx.ta.mom(ctx.source(inp.source), inp.length) };
    },
  },

  // ---- Rate Of Change (§3.83) --------------------------------------------------
  {
    id: 'Rate Of Change', name: 'Rate Of Change', shortName: 'ROC', category: 'Momentum', overlay: false, aliases: ['ROC', 'Rate of Change'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 9, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [{ id: 'roc', title: 'ROC', style: plotStyle({ color: '#2962FF' }) }],
    bands: [zeroBand('Zero Line')],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      return { roc: ctx.ta.roc(ctx.source(inp.source), inp.length) };
    },
  },

  // ---- Percentage Price Oscillator (§3.77, newer built-in) ---------------------
  {
    id: 'Percentage Price Oscillator', name: 'Percentage Price Oscillator', shortName: 'PPO', category: 'Momentum', overlay: false, aliases: ['Percent Price Oscillator'],
    inputs: [
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'fast', name: 'Fast Length', type: 'int', defval: 12, min: 1 },
      { id: 'slow', name: 'Slow Length', type: 'int', defval: 26, min: 1 },
      { id: 'signal', name: 'Signal Length', type: 'int', defval: 9, min: 1 },
      { id: 'maType', name: 'Oscillator MA Type', type: 'select', defval: 'EMA', options: ['EMA', 'SMA'] },
      { id: 'sigType', name: 'Signal MA Type', type: 'select', defval: 'EMA', options: ['EMA', 'SMA'] },
    ],
    plots: [
      { id: 'hist', title: 'Histogram', style: plotStyle({ type: 'columns', color: '#26A69A' }) },
      { id: 'ppo', title: 'PPO', style: plotStyle({ color: '#2962FF' }) },
      { id: 'signal', title: 'Signal', style: plotStyle({ color: '#FF6D00' }) },
    ],
    bands: [zeroBand('Zero')],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      const src = ctx.source(inp.source);
      const f = inp.maType === 'SMA' ? ctx.ta.sma(src, inp.fast) : ctx.ta.ema(src, inp.fast);
      const s = inp.maType === 'SMA' ? ctx.ta.sma(src, inp.slow) : ctx.ta.ema(src, inp.slow);
      const ppo = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) if (s[i] !== 0) ppo[i] = ((f[i] - s[i]) / s[i]) * 100;
      const signal = inp.sigType === 'SMA' ? ctx.ta.sma(ppo, inp.signal) : ctx.ta.ema(ppo, inp.signal);
      const hist = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) hist[i] = ppo[i] - signal[i];
      return { hist: { values: hist, colors: histColors4(hist) }, ppo, signal };
    },
  },

  // ---- Price Momentum Oscillator (§3.80) ---------------------------------------
  {
    id: 'Price Momentum Oscillator', name: 'Price Momentum Oscillator', shortName: 'PMO', category: 'Momentum', overlay: false, aliases: ['PMO'],
    inputs: [
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'length1', name: 'Length 1', type: 'int', defval: 35, min: 1 },
      { id: 'length2', name: 'Length 2', type: 'int', defval: 20, min: 1 },
      { id: 'signal', name: 'Signal Length', type: 'int', defval: 10, min: 1 },
    ],
    plots: [
      { id: 'pmo', title: 'PMO', style: plotStyle({ color: '#2962FF' }) },
      { id: 'signal', title: 'Signal', style: plotStyle({ color: '#FF6D00' }) },
    ],
    bands: [zeroBand('Zero')],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      const src = ctx.source(inp.source);
      // roc1 = 100 * change(src) / src[1]; custom EMA alpha = 2/length seeded from 0.
      const roc1 = ctx.ta.nanArray(ctx.n);
      for (let i = 1; i < ctx.n; i++) roc1[i] = src[i - 1] === 0 ? NaN : (100 * (src[i] - src[i - 1])) / src[i - 1];
      const e1 = ctx.ta.emaAlphaNz(roc1, 2 / Math.max(1, inp.length1));
      const scaled = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) scaled[i] = 10 * e1[i];
      const pmo = ctx.ta.emaAlphaNz(scaled, 2 / Math.max(1, inp.length2));
      return { pmo, signal: ctx.ta.ema(pmo, inp.signal) };
    },
  },

  // ---- Pring's Special K (§3.81) -----------------------------------------------
  {
    id: "Pring's Special K", name: "Pring's Special K", shortName: 'Special K', category: 'Momentum', overlay: false, aliases: ['Special K', 'Pring Special K'],
    inputs: [
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'sig1', name: 'Signal Length 1', type: 'int', defval: 100, min: 1 },
      { id: 'sig2', name: 'Signal Length 2', type: 'int', defval: 100, min: 1 },
    ],
    plots: [
      { id: 'specialK', title: 'Special K', style: plotStyle({ color: '#2962FF' }) },
      { id: 'signal', title: 'Signal', style: plotStyle({ color: '#FF6D00' }) },
    ],
    bands: [zeroBand('Zero')],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      const src = ctx.source(inp.source);
      const terms: Array<[number, number, number]> = [
        [10, 10, 1], [15, 10, 2], [20, 10, 3], [30, 15, 4],
        [40, 50, 1], [65, 65, 2], [75, 75, 3], [100, 100, 4],
        [195, 130, 1], [265, 130, 2], [390, 130, 3], [530, 195, 4],
      ];
      const sk = new Float64Array(ctx.n);
      for (const [r, s, w] of terms) {
        const t = ctx.ta.sma(ctx.ta.roc(src, r), s);
        for (let i = 0; i < ctx.n; i++) sk[i] += w * t[i];
      }
      return { specialK: sk, signal: ctx.ta.sma(ctx.ta.sma(sk, inp.sig1), inp.sig2) };
    },
  },
];
