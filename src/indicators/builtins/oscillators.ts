import { plotStyle, type IndicatorDefinition, type IndicatorInput, type IndicatorPlot, type IndicatorBand, type IndicatorFill, type IndicatorContext } from '../Indicator';
import { MA_TYPES } from '../ta';

const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];

// ---- shared helpers (also used by momentum.ts) ---------------------------------

/** TradingView "Smoothing" group option strings (exact — they appear in the legend). */
export const SMOOTHING_TYPES = ['None', 'SMA', 'SMA + Bollinger Bands', 'EMA', 'SMMA (RMA)', 'WMA', 'VWMA'];

/** Inputs of the standard "Smoothing" group (RSI/CCI/RCI/...): Type, Length, BB StdDev. */
export function smoothingInputs(defType = 'None', defLength = 14): IndicatorInput[] {
  return [
    { id: 'maType', name: 'Type', type: 'select', defval: defType, options: SMOOTHING_TYPES, group: 'Smoothing' },
    { id: 'maLength', name: 'Length', type: 'int', defval: defLength, min: 1, group: 'Smoothing' },
    { id: 'bbMult', name: 'BB StdDev', type: 'float', defval: 2, min: 0.001, max: 50, step: 0.5, group: 'Smoothing' },
  ];
}

/** Plots of the "Smoothing" group: "<X>-based MA" (yellow) + Bollinger upper/lower (green). Hidden until Type != None. */
export function smoothingPlots(prefix: string): IndicatorPlot[] {
  return [
    { id: 'ma', title: `${prefix}-based MA`, style: plotStyle({ color: '#FFEB3B' }) },
    { id: 'bbUpper', title: 'Upper Bollinger Band', style: plotStyle({ color: '#4CAF50' }) },
    { id: 'bbLower', title: 'Lower Bollinger Band', style: plotStyle({ color: '#4CAF50' }) },
  ];
}

export const smoothingFill: IndicatorFill = { id: 'bbFill', title: 'Bollinger Bands Background Fill', a: 'bbUpper', b: 'bbLower', color: '#4CAF50', transparency: 90, visible: true };

/** Compute the "Smoothing" group series for `series` from inputs {maType, maLength, bbMult}. */
export function applySmoothing(ctx: IndicatorContext, series: Float64Array, inp: Record<string, any>): { ma: Float64Array; bbUpper: Float64Array; bbLower: Float64Array } {
  const n = ctx.n;
  let ma = ctx.ta.nanArray(n);
  const bbUpper = ctx.ta.nanArray(n), bbLower = ctx.ta.nanArray(n);
  const type: string = inp.maType || 'None';
  if (type !== 'None') {
    const isBB = type === 'SMA + Bollinger Bands';
    const len = Math.max(1, inp.maLength | 0);
    ma = ctx.ta.maByType(isBB ? 'SMA' : type, series, len, ctx.volume);
    if (isBB) {
      const sd = ctx.ta.stdev(series, len);
      for (let i = 0; i < n; i++) { bbUpper[i] = ma[i] + inp.bbMult * sd[i]; bbLower[i] = ma[i] - inp.bbMult * sd[i]; }
    }
  }
  return { ma, bbUpper, bbLower };
}

/** Standard gray dashed zero line. */
export function zeroBand(title = 'Zero'): IndicatorBand {
  return { id: 'zero', title, value: 0, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true };
}

/** Per-bar colors by sign (>= 0 -> up color). */
export function signColors(vals: Float64Array, up = '#089981', down = '#F23645'): Array<string | null> {
  const out: Array<string | null> = new Array(vals.length);
  for (let i = 0; i < vals.length; i++) { const v = vals[i]; out[i] = v !== v ? null : v >= 0 ? up : down; }
  return out;
}

/** Per-bar colors by direction: rising (v > v[1]) -> up color, otherwise down color. */
export function risingColors(vals: Float64Array, up = '#089981', down = '#F23645'): Array<string | null> {
  const out: Array<string | null> = new Array(vals.length);
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i], p = i > 0 ? vals[i - 1] : NaN;
    out[i] = v !== v ? null : p === p && v > p ? up : down;
  }
  return out;
}

/** MACD-style 4-color histogram scheme (strong up, weak up, weak down, strong down). */
export function histColors4(hist: Float64Array): Array<string | null> {
  const out: Array<string | null> = new Array(hist.length);
  for (let i = 0; i < hist.length; i++) {
    const h = hist[i], p = i > 0 ? hist[i - 1] : NaN;
    if (h !== h) { out[i] = null; continue; }
    out[i] = h >= 0 ? (p === p && h < p ? '#B2DFDB' : '#26A69A') : (p === p && h > p ? '#FFCDD2' : '#FF5252');
  }
  return out;
}

/** Invisible helper plot used only as a fill boundary (gradient-zone approximations). */
function helperPlot(id: string, title: string): IndicatorPlot {
  return { id, title, style: plotStyle({ type: 'none', color: '#787B86', visible: false, showLast: false }), hideInLegend: true };
}

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

  // ---- Stochastic RSI (§3.98 / §11.4) ---------------------------------------
  {
    id: 'Stochastic RSI', name: 'Stochastic RSI', shortName: 'Stoch RSI', category: 'Oscillators', overlay: false, aliases: ['Stoch RSI', 'StochRSI'],
    inputs: [
      { id: 'k', name: 'K', type: 'int', defval: 3, min: 1 },
      { id: 'd', name: 'D', type: 'int', defval: 3, min: 1 },
      { id: 'rsiLength', name: 'RSI Length', type: 'int', defval: 14, min: 1 },
      { id: 'stochLength', name: 'Stochastic Length', type: 'int', defval: 14, min: 1 },
      { id: 'source', name: 'RSI Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [
      { id: 'k', title: 'K', style: plotStyle({ color: '#2962FF' }) },
      { id: 'd', title: 'D', style: plotStyle({ color: '#FF6D00' }) },
    ],
    bands: [
      { id: 'upper', title: 'Upper Band', value: 80, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'middle', title: 'Middle Band', value: 50, color: '#787B86', lineStyle: 1, lineWidth: 1, visible: true },
      { id: 'lower', title: 'Lower Band', value: 20, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#2196F3', transparency: 90, visible: true }],
    precision: 2,
    compute(ctx, inp) {
      const rsi = ctx.ta.rsi(ctx.source(inp.source), inp.rsiLength);
      const k = ctx.ta.sma(ctx.ta.stochNa(rsi, rsi, rsi, inp.stochLength), inp.k);
      const d = ctx.ta.sma(k, inp.d);
      return { k, d };
    },
  },

  // ---- Commodity Channel Index (§3.26) -----------------------------------------
  {
    id: 'Commodity Channel Index', name: 'Commodity Channel Index', shortName: 'CCI', category: 'Oscillators', overlay: false, aliases: ['CCI'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 20, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'hlc3', options: SOURCES },
      ...smoothingInputs('None', 14),
    ],
    plots: [
      { id: 'cci', title: 'CCI', style: plotStyle({ color: '#2962FF' }) },
      ...smoothingPlots('CCI'),
    ],
    bands: [
      { id: 'upper', title: 'Upper Band', value: 100, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'middle', title: 'Middle Band', value: 0, color: '#787B86', lineStyle: 1, lineWidth: 1, visible: true },
      { id: 'lower', title: 'Lower Band', value: -100, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    fills: [
      { id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#2196F3', transparency: 90, visible: true },
      smoothingFill,
    ],
    precision: 2,
    compute(ctx, inp) {
      const cci = ctx.ta.cci(ctx.source(inp.source), inp.length);
      return { cci, ...applySmoothing(ctx, cci, inp) };
    },
  },

  // ---- Williams %R (§3.120) ----------------------------------------------------
  {
    id: 'Williams Percent Range', name: 'Williams Percent Range', shortName: 'Williams %R', category: 'Oscillators', overlay: false, aliases: ['Williams %R', '%R', 'WPR', 'Williams Percent R'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 14, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [{ id: 'r', title: '%R', style: plotStyle({ color: '#7E57C2' }) }],
    bands: [
      { id: 'upper', title: 'Upper Band', value: -20, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'middle', title: 'Middle Level', value: -50, color: '#787B86', lineStyle: 1, lineWidth: 1, visible: true },
      { id: 'lower', title: 'Lower Band', value: -80, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#7E57C2', transparency: 90, visible: true }],
    precision: 2,
    compute(ctx, inp) {
      const src = ctx.source(inp.source);
      const hh = ctx.ta.highest(ctx.high, inp.length), ll = ctx.ta.lowest(ctx.low, inp.length);
      const out = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) {
        if (!ctx.ta.isNum(hh[i]) || !ctx.ta.isNum(ll[i])) continue;
        const den = hh[i] - ll[i];
        out[i] = den === 0 ? 0 : (100 * (src[i] - hh[i])) / den;
      }
      return { r: out };
    },
  },

  // ---- Ultimate Oscillator (§3.108) --------------------------------------------
  {
    id: 'Ultimate Oscillator', name: 'Ultimate Oscillator', shortName: 'UO', category: 'Oscillators', overlay: false, aliases: ['UO'],
    inputs: [
      { id: 'fast', name: 'Fast Length', type: 'int', defval: 7, min: 1 },
      { id: 'middle', name: 'Middle Length', type: 'int', defval: 14, min: 1 },
      { id: 'slow', name: 'Slow Length', type: 'int', defval: 28, min: 1 },
    ],
    plots: [{ id: 'uo', title: 'UO', style: plotStyle({ color: '#F23645' }) }],
    precision: 2,
    compute(ctx, inp) {
      return { uo: ctx.ta.ultimateOsc(ctx.high, ctx.low, ctx.close, inp.fast, inp.middle, inp.slow) };
    },
  },

  // ---- Awesome Oscillator (§3.10) ----------------------------------------------
  {
    id: 'Awesome Oscillator', name: 'Awesome Oscillator', shortName: 'AO', category: 'Oscillators', overlay: false, aliases: ['AO'],
    inputs: [],
    plots: [{ id: 'ao', title: 'AO', style: plotStyle({ type: 'columns', color: '#089981' }) }],
    precision: 'inherit',
    includeZero: true,
    compute(ctx) {
      const fast = ctx.ta.sma(ctx.hl2, 5), slow = ctx.ta.sma(ctx.hl2, 34);
      const ao = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) ao[i] = fast[i] - slow[i];
      // diff = ao - ao[1]; color = diff <= 0 ? red : green
      return { ao: { values: ao, colors: risingColors(ao, '#089981', '#F23645') } };
    },
  },

  // ---- Accelerator Oscillator (§3.132, library only) ---------------------------
  {
    id: 'Accelerator Oscillator', name: 'Accelerator Oscillator', shortName: 'AC', category: 'Oscillators', overlay: false, aliases: ['AC'],
    inputs: [],
    plots: [{ id: 'ac', title: 'AC', style: plotStyle({ type: 'histogram', color: '#089981' }) }],
    precision: 'inherit',
    includeZero: true,
    compute(ctx) {
      const fast = ctx.ta.sma(ctx.hl2, 5), slow = ctx.ta.sma(ctx.hl2, 34);
      const ao = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) ao[i] = fast[i] - slow[i];
      const aoMa = ctx.ta.sma(ao, 5);
      const ac = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) ac[i] = ao[i] - aoMa[i];
      return { ac: { values: ac, colors: risingColors(ac, '#089981', '#F23645') } };
    },
  },

  // ---- Chaikin Oscillator (§3.19) ----------------------------------------------
  {
    id: 'Chaikin Oscillator', name: 'Chaikin Oscillator', shortName: 'Chaikin Osc', category: 'Oscillators', overlay: false, aliases: ['Chaikin Osc'], format: 'volume',
    inputs: [
      { id: 'fast', name: 'Fast Length', type: 'int', defval: 3, min: 1 },
      { id: 'slow', name: 'Slow Length', type: 'int', defval: 10, min: 1 },
    ],
    plots: [{ id: 'osc', title: 'Chaikin Oscillator', style: plotStyle({ color: '#EC407A' }) }],
    bands: [zeroBand('Zero')],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      const ad = ctx.ta.accdist(ctx.high, ctx.low, ctx.close, ctx.volume);
      const f = ctx.ta.ema(ad, inp.fast), s = ctx.ta.ema(ad, inp.slow);
      const out = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) out[i] = f[i] - s[i];
      return { osc: out };
    },
  },

  // ---- Detrended Price Oscillator (§3.32) --------------------------------------
  {
    id: 'Detrended Price Oscillator', name: 'Detrended Price Oscillator', shortName: 'DPO', category: 'Oscillators', overlay: false, aliases: ['DPO'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 21, min: 1 },
      { id: 'centered', name: 'Centered', type: 'bool', defval: false },
    ],
    plots: [{ id: 'dpo', title: 'Detrended Price Oscillator', style: plotStyle({ color: '#43A047' }) }],
    bands: [zeroBand('Zero Line')],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      const len = Math.max(1, inp.length | 0);
      const barsback = Math.floor(len / 2) + 1;
      const ma = ctx.ta.sma(ctx.close, len);
      const out = ctx.ta.nanArray(ctx.n);
      if (inp.centered) {
        // Pine: dpo = close[barsback] - ma, plotted with offset = -barsback. The shift is baked into the values:
        // the value drawn at bar i is close[i] - ma[i + barsback] (last `barsback` bars have no value).
        for (let i = 0; i + barsback < ctx.n; i++) out[i] = ctx.close[i] - ma[i + barsback];
      } else {
        for (let i = barsback; i < ctx.n; i++) out[i] = ctx.close[i] - ma[i - barsback];
      }
      return { dpo: out };
    },
  },

  // ---- Know Sure Thing (§3.51) -------------------------------------------------
  {
    id: 'Know Sure Thing', name: 'Know Sure Thing', shortName: 'KST', category: 'Oscillators', overlay: false, aliases: ['KST'],
    inputs: [
      { id: 'roc1', name: 'ROC Length #1', type: 'int', defval: 10, min: 1 },
      { id: 'roc2', name: 'ROC Length #2', type: 'int', defval: 15, min: 1 },
      { id: 'roc3', name: 'ROC Length #3', type: 'int', defval: 20, min: 1 },
      { id: 'roc4', name: 'ROC Length #4', type: 'int', defval: 30, min: 1 },
      { id: 'sma1', name: 'SMA Length #1', type: 'int', defval: 10, min: 1 },
      { id: 'sma2', name: 'SMA Length #2', type: 'int', defval: 10, min: 1 },
      { id: 'sma3', name: 'SMA Length #3', type: 'int', defval: 10, min: 1 },
      { id: 'sma4', name: 'SMA Length #4', type: 'int', defval: 15, min: 1 },
      { id: 'signal', name: 'Signal Line Length', type: 'int', defval: 9, min: 1 },
    ],
    plots: [
      { id: 'kst', title: 'KST', style: plotStyle({ color: '#089981' }) },
      { id: 'signal', title: 'Signal', style: plotStyle({ color: '#F23645' }) },
    ],
    bands: [zeroBand('Zero')],
    precision: 4,
    includeZero: true,
    compute(ctx, inp) {
      const smaroc = (r: number, s: number) => ctx.ta.sma(ctx.ta.roc(ctx.close, r), s);
      const a = smaroc(inp.roc1, inp.sma1), b = smaroc(inp.roc2, inp.sma2), c = smaroc(inp.roc3, inp.sma3), d = smaroc(inp.roc4, inp.sma4);
      const kst = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) kst[i] = a[i] + 2 * b[i] + 3 * c[i] + 4 * d[i];
      return { kst, signal: ctx.ta.sma(kst, inp.signal) };
    },
  },

  // ---- Relative Vigor Index (§3.87) --------------------------------------------
  {
    id: 'Relative Vigor Index', name: 'Relative Vigor Index', shortName: 'RVGI', category: 'Oscillators', overlay: false, aliases: ['RVGI', 'RVI'],
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 10, min: 1 }],
    plots: [
      { id: 'rvgi', title: 'RVGI', style: plotStyle({ color: '#089981' }) },
      { id: 'signal', title: 'Signal', style: plotStyle({ color: '#F23645' }) },
    ],
    precision: 4,
    compute(ctx, inp) {
      const co = ctx.ta.nanArray(ctx.n), hl = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) { co[i] = ctx.close[i] - ctx.open[i]; hl[i] = ctx.high[i] - ctx.low[i]; }
      const num = ctx.ta.sum(ctx.ta.swma(co), inp.length), den = ctx.ta.sum(ctx.ta.swma(hl), inp.length);
      const rvgi = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) if (ctx.ta.isNum(num[i]) && den[i] !== 0) rvgi[i] = num[i] / den[i];
      return { rvgi, signal: ctx.ta.swma(rvgi) };
    },
  },

  // ---- Fisher Transform (§3.42) ------------------------------------------------
  {
    id: 'Fisher Transform', name: 'Fisher Transform', shortName: 'Fisher', category: 'Oscillators', overlay: false, aliases: ['Fisher'],
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 9, min: 1 }],
    plots: [
      { id: 'fisher', title: 'Fisher', style: plotStyle({ color: '#2962FF' }) },
      { id: 'trigger', title: 'Trigger', style: plotStyle({ color: '#FF6D00' }) },
    ],
    bands: [
      { id: 'level15', title: 'Level 1.5', value: 1.5, color: '#E91E63', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'level075', title: 'Level 0.75', value: 0.75, color: '#F23645', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'zero', title: 'Zero', value: 0, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'levelm075', title: 'Level -0.75', value: -0.75, color: '#F23645', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'levelm15', title: 'Level -1.5', value: -1.5, color: '#E91E63', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    precision: 2,
    compute(ctx, inp) {
      const r = ctx.ta.fisher(ctx.hl2, inp.length);
      return { fisher: r.fisher, trigger: r.trigger };
    },
  },

  // ---- Chande Momentum Oscillator (§3.22) --------------------------------------
  {
    id: 'Chande Momentum Oscillator', name: 'Chande Momentum Oscillator', shortName: 'ChandeMO', category: 'Oscillators', overlay: false, aliases: ['ChandeMO', 'CMO'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 9, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [{ id: 'cmo', title: 'Chande MO', style: plotStyle({ color: '#2962FF' }) }],
    bands: [
      { id: 'upper', title: 'Overbought', value: 50, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: false },
      zeroBand('Zero Line'),
      { id: 'lower', title: 'Oversold', value: -50, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: false },
    ],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      return { cmo: ctx.ta.cmo(ctx.source(inp.source), inp.length) };
    },
  },

  // ---- Balance of Power (§3.11) ------------------------------------------------
  {
    id: 'Balance of Power', name: 'Balance of Power', shortName: 'BOP', category: 'Oscillators', overlay: false, aliases: ['BOP'],
    inputs: [],
    plots: [{ id: 'bop', title: 'BOP', style: plotStyle({ color: '#F23645' }) }],
    bands: [zeroBand('Zero')],
    precision: 2,
    includeZero: true,
    compute(ctx) {
      const out = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) {
        const r = ctx.high[i] - ctx.low[i];
        out[i] = r === 0 ? 0 : (ctx.close[i] - ctx.open[i]) / r;
      }
      return { bop: out };
    },
  },

  // ---- SMI Ergodic Indicator / Oscillator (§3.93) ------------------------------
  {
    id: 'SMI Ergodic Indicator', name: 'SMI Ergodic Indicator', shortName: 'SMII', category: 'Oscillators', overlay: false, aliases: ['SMII', 'SMI Ergodic Indicator/Oscillator', 'SMI Ergodic'],
    inputs: [
      { id: 'longLength', name: 'Long Length', type: 'int', defval: 20, min: 1 },
      { id: 'shortLength', name: 'Short Length', type: 'int', defval: 5, min: 1 },
      { id: 'signalLength', name: 'Signal Line Length', type: 'int', defval: 5, min: 1 },
    ],
    plots: [
      { id: 'indicator', title: 'Indicator', style: plotStyle({ color: '#2962FF' }) },
      { id: 'signal', title: 'Signal', style: plotStyle({ color: '#FF6D00' }) },
    ],
    bands: [zeroBand('Zero')],
    precision: 4,
    includeZero: true,
    compute(ctx, inp) {
      const erg = ctx.ta.tsi(ctx.close, inp.shortLength, inp.longLength);
      return { indicator: erg, signal: ctx.ta.ema(erg, inp.signalLength) };
    },
  },
  {
    id: 'SMI Ergodic Oscillator', name: 'SMI Ergodic Oscillator', shortName: 'SMIO', category: 'Oscillators', overlay: false, aliases: ['SMIO'],
    inputs: [
      { id: 'longLength', name: 'Long Length', type: 'int', defval: 20, min: 1 },
      { id: 'shortLength', name: 'Short Length', type: 'int', defval: 5, min: 1 },
      { id: 'signalLength', name: 'Signal Line Length', type: 'int', defval: 5, min: 1 },
    ],
    plots: [{ id: 'osc', title: 'Oscillator', style: plotStyle({ type: 'histogram', color: '#F23645' }) }],
    bands: [zeroBand('Zero')],
    precision: 4,
    includeZero: true,
    compute(ctx, inp) {
      const erg = ctx.ta.tsi(ctx.close, inp.shortLength, inp.longLength);
      const sig = ctx.ta.ema(erg, inp.signalLength);
      const osc = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) osc[i] = erg[i] - sig[i];
      return { osc };
    },
  },

  // ---- Stochastic Momentum Index (§3.97) ---------------------------------------
  {
    id: 'Stochastic Momentum Index', name: 'Stochastic Momentum Index', shortName: 'SMI', category: 'Oscillators', overlay: false, aliases: ['SMI'],
    inputs: [
      { id: 'k', name: '%K Length', type: 'int', defval: 10, min: 1 },
      { id: 'd', name: '%D Length', type: 'int', defval: 3, min: 1 },
      { id: 'ema', name: 'EMA Length', type: 'int', defval: 3, min: 1 },
    ],
    plots: [
      { id: 'smi', title: 'SMI', style: plotStyle({ color: '#2962FF' }) },
      { id: 'ema', title: 'SMI-based EMA', style: plotStyle({ color: '#FF6D00' }) },
      helperPlot('obZone', 'Overbought Zone'),
      helperPlot('osZone', 'Oversold Zone'),
    ],
    bands: [
      { id: 'ob', title: 'Overbought Line', value: 40, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'middle', title: 'Middle Line', value: 0, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'os', title: 'Oversold Line', value: -40, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    fills: [
      // Approximation of TV's gradient zone fills: flat fill between the line and the level while beyond it.
      { id: 'obFill', title: 'Overbought Fill', a: 'obZone', b: 'ob', color: '#F23645', transparency: 80, visible: true },
      { id: 'osFill', title: 'Oversold Fill', a: 'osZone', b: 'os', color: '#089981', transparency: 80, visible: true },
    ],
    precision: 2,
    compute(ctx, inp) {
      const r = ctx.ta.smi(ctx.high, ctx.low, ctx.close, inp.k, inp.d, inp.ema);
      const ob = ctx.ta.nanArray(ctx.n), os = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) {
        const v = r.smi[i];
        if (v !== v) continue;
        ob[i] = v > 40 ? v : 40;
        os[i] = v < -40 ? v : -40;
      }
      return { smi: r.smi, ema: r.ema, obZone: ob, osZone: os };
    },
  },

  // ---- Price Oscillator (legacy PPO, §3.77) ------------------------------------
  {
    id: 'Price Oscillator', name: 'Price Oscillator', shortName: 'PPO', category: 'Oscillators', overlay: false, aliases: ['Price Osc'],
    inputs: [
      { id: 'shortLength', name: 'Short Length', type: 'int', defval: 10, min: 1 },
      { id: 'longLength', name: 'Long Length', type: 'int', defval: 21, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'exponential', name: 'Exponential', type: 'bool', defval: false },
    ],
    plots: [{ id: 'ppo', title: 'PPO', style: plotStyle({ color: '#089981' }) }],
    bands: [zeroBand('Zero')],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      const src = ctx.source(inp.source);
      const s = inp.exponential ? ctx.ta.ema(src, inp.shortLength) : ctx.ta.sma(src, inp.shortLength);
      const l = inp.exponential ? ctx.ta.ema(src, inp.longLength) : ctx.ta.sma(src, inp.longLength);
      const out = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) if (l[i] !== 0) out[i] = ((s[i] - l[i]) / l[i]) * 100;
      return { ppo: out };
    },
  },

  // ---- Trend Strength Index (§3.103) — placed before True Strength Index so the shared short name "TSI" resolves to the latter.
  {
    id: 'Trend Strength Index', name: 'Trend Strength Index', shortName: 'TSI', category: 'Momentum', overlay: false, aliases: ['Trend Strength'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 14, min: 2 },
      { id: 'bullColor', name: 'Bullish Color', type: 'color', defval: '#089981' },
      { id: 'bearColor', name: 'Bearish Color', type: 'color', defval: '#F23645' },
    ],
    plots: [
      { id: 'tsi', title: 'Trend Strength Index', style: plotStyle({ color: '#089981' }) },
      helperPlot('bullZone', 'Bullish Zone'),
      helperPlot('bearZone', 'Bearish Zone'),
    ],
    bands: [zeroBand('Zero')],
    fills: [
      // Approximation of TV's gradient fill between the line and zero.
      { id: 'bullFill', title: 'Bullish Fill', a: 'bullZone', b: 'zero', color: '#089981', transparency: 80, visible: true },
      { id: 'bearFill', title: 'Bearish Fill', a: 'bearZone', b: 'zero', color: '#F23645', transparency: 80, visible: true },
    ],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      const idx = new Float64Array(ctx.n);
      for (let i = 0; i < ctx.n; i++) idx[i] = i;
      const tsi = ctx.ta.correlation(ctx.close, idx, Math.max(2, inp.length | 0));
      const bull = ctx.ta.nanArray(ctx.n), bear = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) { const v = tsi[i]; if (v !== v) continue; bull[i] = Math.max(v, 0); bear[i] = Math.min(v, 0); }
      return { tsi: { values: tsi, colors: signColors(tsi, inp.bullColor || '#089981', inp.bearColor || '#F23645') }, bullZone: bull, bearZone: bear };
    },
  },

  // ---- True Strength Index (§3.106) --------------------------------------------
  {
    id: 'True Strength Index', name: 'True Strength Index', shortName: 'TSI', category: 'Oscillators', overlay: false, aliases: ['True Strength Indicator', 'TSI'],
    inputs: [
      { id: 'longLength', name: 'Long Length', type: 'int', defval: 25, min: 1 },
      { id: 'shortLength', name: 'Short Length', type: 'int', defval: 13, min: 1 },
      { id: 'signalLength', name: 'Signal Length', type: 'int', defval: 13, min: 1 },
    ],
    plots: [
      { id: 'tsi', title: 'True Strength Index', style: plotStyle({ color: '#2962FF' }) },
      { id: 'signal', title: 'Signal', style: plotStyle({ color: '#F23645' }) },
    ],
    bands: [zeroBand('Zero')],
    precision: 4,
    includeZero: true,
    compute(ctx, inp) {
      const tsi = ctx.ta.tsi(ctx.close, inp.shortLength, inp.longLength);
      return { tsi, signal: ctx.ta.ema(tsi, inp.signalLength) };
    },
  },

  // ---- Woodies CCI (§3.123) ----------------------------------------------------
  {
    id: 'Woodies CCI', name: 'Woodies CCI', shortName: 'Woodies CCI', category: 'Oscillators', overlay: false, aliases: ['Woodies'],
    inputs: [
      { id: 'turbo', name: 'CCI Turbo Length', type: 'int', defval: 6, min: 3, max: 14 },
      { id: 'cci14', name: 'CCI 14 Length', type: 'int', defval: 14, min: 7, max: 20 },
    ],
    plots: [
      { id: 'hist', title: 'CCI 14', style: plotStyle({ type: 'histogram', color: '#787B86', lineWidth: 2 }) },
      { id: 'turbo', title: 'CCI Turbo', style: plotStyle({ color: '#2962FF' }) },
      { id: 'cci14', title: 'CCI 14 Line', style: plotStyle({ color: '#787B86' }), hideInLegend: true },
    ],
    bands: [
      { id: 'p200', title: '+200', value: 200, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'p100', title: '+100', value: 100, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      zeroBand('Zero'),
      { id: 'm100', title: '-100', value: -100, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'm200', title: '-200', value: -200, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      const turbo = ctx.ta.cci(ctx.close, inp.turbo);
      const cci14 = ctx.ta.cci(ctx.close, inp.cci14);
      // State machine on cci14: bars 1-4 on one side of zero gray, bar 5 yellow, bar >= 6 green (>0) / red (<0).
      const colors: Array<string | null> = new Array(ctx.n);
      let side = 0, streak = 0;
      for (let i = 0; i < ctx.n; i++) {
        const v = cci14[i];
        if (v !== v) { colors[i] = null; side = 0; streak = 0; continue; }
        const s = v > 0 ? 1 : v < 0 ? -1 : 0;
        if (s !== 0 && s === side) streak++; else { side = s; streak = s === 0 ? 0 : 1; }
        colors[i] = streak >= 6 ? (side > 0 ? '#4CAF50' : '#F23645') : streak === 5 ? '#FFEB3B' : '#787B86';
      }
      return { hist: { values: cci14, colors }, turbo, cci14 };
    },
  },

  // ---- Connors RSI (§3.27) -----------------------------------------------------
  {
    id: 'Connors RSI', name: 'Connors RSI', shortName: 'CRSI', category: 'Oscillators', overlay: false, aliases: ['CRSI'],
    inputs: [
      { id: 'rsiLength', name: 'RSI Length', type: 'int', defval: 3, min: 1 },
      { id: 'updownLength', name: 'UpDown Length', type: 'int', defval: 2, min: 1 },
      { id: 'rocLength', name: 'ROC Length', type: 'int', defval: 100, min: 1 },
    ],
    plots: [{ id: 'crsi', title: 'CRSI', style: plotStyle({ color: '#2962FF' }) }],
    bands: [
      { id: 'upper', title: 'Upper Band', value: 70, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'middle', title: 'Middle Band', value: 50, color: '#787B86', lineStyle: 1, lineWidth: 1, visible: true },
      { id: 'lower', title: 'Lower Band', value: 30, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#2196F3', transparency: 90, visible: true }],
    precision: 2,
    compute(ctx, inp) {
      const rsi = ctx.ta.rsi(ctx.close, inp.rsiLength);
      const udRsi = ctx.ta.rsi(ctx.ta.updownStreak(ctx.close), inp.updownLength);
      const pr = ctx.ta.percentrankNa(ctx.ta.roc(ctx.close, 1), inp.rocLength);
      const out = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) out[i] = (rsi[i] + udRsi[i] + pr[i]) / 3;
      return { crsi: out };
    },
  },

  // ---- Bull Bear Power (§3.17) -------------------------------------------------
  {
    id: 'Bull Bear Power', name: 'Bull Bear Power', shortName: 'BBPower', category: 'Oscillators', overlay: false, aliases: ['BBPower', 'BBP'],
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 13, min: 1 }],
    plots: [{ id: 'bbp', title: 'BBPower', style: plotStyle({ type: 'columns', color: '#089981' }) }],
    bands: [zeroBand('Zero')],
    precision: 'inherit',
    includeZero: true,
    compute(ctx, inp) {
      const e = ctx.ta.ema(ctx.close, inp.length);
      const out = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) out[i] = (ctx.high[i] - e[i]) + (ctx.low[i] - e[i]);
      return { bbp: { values: out, colors: signColors(out, '#089981', '#F23645') } };
    },
  },

  // ---- Rank Correlation Index (§3.82) ------------------------------------------
  {
    id: 'Rank Correlation Index', name: 'Rank Correlation Index', shortName: 'RCI', category: 'Oscillators', overlay: false, aliases: ['RCI'],
    inputs: [
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'length', name: 'RCI Length', type: 'int', defval: 9, min: 2 },
      ...smoothingInputs('None', 14),
    ],
    plots: [
      { id: 'rci', title: 'RCI', style: plotStyle({ color: '#2962FF' }) },
      ...smoothingPlots('RCI'),
    ],
    bands: [
      { id: 'upper', title: 'Upper Band', value: 80, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      zeroBand('Zero Line'),
      { id: 'lower', title: 'Lower Band', value: -80, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    fills: [smoothingFill],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      const rci = ctx.ta.rci(ctx.source(inp.source), Math.max(2, inp.length | 0));
      return { rci, ...applySmoothing(ctx, rci, inp) };
    },
  },

  // ---- Coppock Curve (§3.28) ---------------------------------------------------
  {
    id: 'Coppock Curve', name: 'Coppock Curve', shortName: 'Coppock Curve', category: 'Oscillators', overlay: false, aliases: ['Coppock'],
    inputs: [
      { id: 'wmaLength', name: 'WMA Length', type: 'int', defval: 10, min: 1 },
      { id: 'longRoc', name: 'Long RoC Length', type: 'int', defval: 14, min: 1 },
      { id: 'shortRoc', name: 'Short RoC Length', type: 'int', defval: 11, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [{ id: 'curve', title: 'Coppock Curve', style: plotStyle({ color: '#2962FF' }) }],
    bands: [zeroBand('Zero')],
    precision: 'inherit',
    includeZero: true,
    compute(ctx, inp) {
      const src = ctx.source(inp.source);
      const a = ctx.ta.roc(src, inp.longRoc), b = ctx.ta.roc(src, inp.shortRoc);
      const s = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) s[i] = a[i] + b[i];
      return { curve: ctx.ta.wma(s, inp.wmaLength) };
    },
  },

  // ---- TRIX (§3.105) -----------------------------------------------------------
  {
    id: 'TRIX', name: 'TRIX', shortName: 'TRIX', category: 'Oscillators', overlay: false, aliases: ['Trix'],
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 18, min: 1 }],
    plots: [{ id: 'trix', title: 'TRIX', style: plotStyle({ color: '#F23645' }) }],
    bands: [zeroBand('Zero')],
    precision: 4,
    includeZero: true,
    compute(ctx, inp) {
      const lg = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) lg[i] = ctx.close[i] > 0 ? Math.log(ctx.close[i]) : NaN;
      const e3 = ctx.ta.ema(ctx.ta.ema(ctx.ta.ema(lg, inp.length), inp.length), inp.length);
      const ch = ctx.ta.change(e3, 1);
      const out = ctx.ta.nanArray(ctx.n);
      for (let i = 0; i < ctx.n; i++) out[i] = 10000 * ch[i];
      return { trix: out };
    },
  },
];
