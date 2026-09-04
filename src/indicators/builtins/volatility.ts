import { plotStyle, type IndicatorDefinition, type IndicatorInstance } from '../Indicator';
import type { RenderContext } from '../../series/Series';

/** Volatility indicators (spec §3.7, 3.13–3.16, 3.20, 3.45, 3.57, 3.88, 3.95, 3.107). */

const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];
const isNum = (v: number): boolean => v === v && v !== Infinity && v !== -Infinity;

export const volatilityIndicators: IndicatorDefinition[] = [
  {
    id: 'Bollinger Bands %B', name: 'Bollinger Bands %B', shortName: 'BB %B', category: 'Volatility', overlay: false, aliases: ['BB %B', 'BB%B'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 20, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'mult', name: 'StdDev', type: 'float', defval: 2, min: 0.001, max: 50, step: 0.1 },
    ],
    plots: [{ id: 'bbr', title: '%B', style: plotStyle({ color: '#26A69A' }) }],
    bands: [
      { id: 'overbought', title: 'Overbought', value: 1, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'oversold', title: 'Oversold', value: 0, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'overbought', b: 'oversold', color: '#26A69A', transparency: 90, visible: true }],
    precision: 2,
    compute(ctx, inp) {
      const { n, ta } = ctx;
      const src = ctx.source(inp.source);
      const b = ta.bb(src, inp.length, inp.mult);
      const out = ta.nanArray(n);
      for (let i = 0; i < n; i++) { const w = b.upper[i] - b.lower[i]; if (isNum(w) && w !== 0) out[i] = (src[i] - b.lower[i]) / w; }
      return { bbr: out };
    },
  },
  {
    id: 'Bollinger Bands Width', name: 'Bollinger BandWidth', shortName: 'BBW', category: 'Volatility', overlay: false, aliases: ['Bollinger BandWidth', 'BBW'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 20, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'mult', name: 'StdDev', type: 'float', defval: 2, min: 0.001, max: 50, step: 0.1 },
      { id: 'expLength', name: 'Highest Expansion Length', type: 'int', defval: 125, min: 1 },
      { id: 'contrLength', name: 'Lowest Contraction Length', type: 'int', defval: 125, min: 1 },
    ],
    plots: [
      { id: 'bbw', title: 'Bollinger BandWidth', style: plotStyle({ color: '#2962FF' }) },
      { id: 'exp', title: 'Highest Expansion', style: plotStyle({ color: '#089981' }) },
      { id: 'contr', title: 'Lowest Contraction', style: plotStyle({ color: '#F23645' }) },
    ],
    precision: 2,
    compute(ctx, inp) {
      const { n, ta } = ctx;
      const b = ta.bb(ctx.source(inp.source), inp.length, inp.mult);
      const bbw = ta.nanArray(n);
      for (let i = 0; i < n; i++) if (isNum(b.basis[i]) && b.basis[i] !== 0) bbw[i] = ((b.upper[i] - b.lower[i]) / b.basis[i]) * 100;
      return { bbw, exp: ta.highestNa(bbw, inp.expLength), contr: ta.lowestNa(bbw, inp.contrLength) };
    },
  },
  {
    id: 'Bollinger Bars', name: 'Bollinger Bars', shortName: 'Bollinger Bars', category: 'Volatility', overlay: true,
    inputs: [],
    // Colour-only plots (type none) expose the three colours in the Style tab; the bars are drawn by customRender.
    plots: [
      { id: 'up', title: 'Up Body', style: plotStyle({ type: 'none', color: '#089981', showLast: false }), hideInLegend: true },
      { id: 'down', title: 'Down Body', style: plotStyle({ type: 'none', color: '#F23645', showLast: false }), hideInLegend: true },
      { id: 'wick', title: 'Wick', style: plotStyle({ type: 'none', color: '#2962FF', showLast: false }), hideInLegend: true },
    ],
    precision: 'inherit',
    compute(ctx) {
      // Stash OHLC in the results so customRender does not depend on the main series.
      return { up: ctx.open, down: ctx.close, wick: ctx.high, low: ctx.low };
    },
    customRender(rc: RenderContext, inst: IndicatorInstance) {
      const o = inst.values('up'), c = inst.values('down'), h = inst.values('wick'), l = inst.values('low');
      if (!o || !c || !h || !l) return;
      const { ctx, timeScale, priceScale, visible } = rc;
      const bs = timeScale.barSpacing;
      let bw = bs < 2.5 ? Math.max(1, Math.floor(bs)) : Math.max(1, Math.floor(bs * 0.7));
      if (bw > 1 && bw % 2 === 0) bw -= 1;
      const half = Math.floor(bw / 2);
      const upColor = inst.styles.up?.color ?? '#089981', downColor = inst.styles.down?.color ?? '#F23645', wickColor = inst.styles.wick?.color ?? '#2962FF';
      ctx.save();
      for (let i = Math.max(0, visible.from); i <= Math.min(o.length - 1, visible.to); i++) {
        if (!isNum(o[i]) || !isNum(c[i]) || !isNum(h[i]) || !isNum(l[i])) continue;
        const x = Math.round(timeScale.barCenterX(i)) - half;
        const yO = priceScale.priceToY(o[i]), yC = priceScale.priceToY(c[i]), yH = priceScale.priceToY(h[i]), yL = priceScale.priceToY(l[i]);
        const top = Math.min(yO, yC), bottom = Math.max(yO, yC);
        ctx.fillStyle = wickColor;
        if (top - yH > 0) ctx.fillRect(x, yH, bw, top - yH);
        if (yL - bottom > 0) ctx.fillRect(x, bottom, bw, yL - bottom);
        ctx.fillStyle = c[i] >= o[i] ? upColor : downColor;
        ctx.fillRect(x, top, bw, Math.max(1, bottom - top));
      }
      ctx.restore();
    },
  },
  {
    id: 'BBTrend', name: 'BBTrend', shortName: 'BBTrend', category: 'Volatility', overlay: false,
    inputs: [
      { id: 'shortLength', name: 'Short BB Length', type: 'int', defval: 20, min: 1 },
      { id: 'longLength', name: 'Long BB Length', type: 'int', defval: 50, min: 1 },
      { id: 'mult', name: 'StdDev', type: 'float', defval: 2, min: 0.001, max: 50, step: 0.1 },
    ],
    plots: [{ id: 'bbtrend', title: 'BBTrend', style: plotStyle({ type: 'columns', color: '#26A69A' }) }],
    bands: [{ id: 'zero', title: 'Zero', value: 0, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true }],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      const { n, ta, close } = ctx;
      const s = ta.bb(close, inp.shortLength, inp.mult), l = ta.bb(close, inp.longLength, inp.mult);
      const out = ta.nanArray(n);
      const colors: Array<string | null> = new Array(n).fill(null);
      for (let i = 0; i < n; i++) {
        if (!isNum(s.basis[i]) || !isNum(l.basis[i]) || s.basis[i] === 0) continue;
        out[i] = ((Math.abs(s.lower[i] - l.lower[i]) - Math.abs(s.upper[i] - l.upper[i])) / s.basis[i]) * 100;
        const p = out[i - 1];
        const v = out[i];
        colors[i] = v >= 0 ? (isNum(p) && v < p ? '#B2DFDB' : '#26A69A') : (isNum(p) && v > p ? '#FFCDD2' : '#FF5252');
      }
      return { bbtrend: { values: out, colors } };
    },
  },
  {
    id: 'Historical Volatility', name: 'Historical Volatility', shortName: 'HV', category: 'Volatility', overlay: false, aliases: ['HV'],
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 10, min: 1 }],
    plots: [{ id: 'hv', title: 'HV', style: plotStyle({ color: '#2962FF' }) }],
    precision: 2,
    compute(ctx, inp) {
      const { n, ta, close } = ctx;
      const r = ta.parseResolution(ctx.resolution);
      const per = r.isIntraday || (r.isDaily && r.multiplier === 1) ? 1 : 7;
      const lr = ta.nanArray(n);
      for (let i = 1; i < n; i++) if (close[i - 1] > 0 && close[i] > 0) lr[i] = Math.log(close[i] / close[i - 1]);
      const sd = ta.stdev(lr, inp.length);
      const k = 100 * Math.sqrt(365 / per);
      const out = ta.nanArray(n);
      for (let i = 0; i < n; i++) out[i] = sd[i] * k;
      return { hv: out };
    },
  },
  {
    id: 'Standard Deviation', name: 'Standard Deviation', shortName: 'StdDev', category: 'Volatility', overlay: false, aliases: ['StdDev'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 20, min: 1 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [{ id: 'stdev', title: 'Standard Deviation', style: plotStyle({ color: '#089981' }) }],
    precision: 'inherit',
    compute(ctx, inp) {
      return { stdev: ctx.ta.stdev(ctx.source(inp.source), inp.length) };
    },
  },
  {
    id: 'Standard Error', name: 'Standard Error', shortName: 'StdErr', category: 'Volatility', overlay: false, aliases: ['StdErr'],
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 14, min: 2 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
    ],
    plots: [{ id: 'stderr', title: 'Standard Error', style: plotStyle({ color: '#FF6D00' }) }],
    precision: 'inherit',
    compute(ctx, inp) {
      return { stderr: ctx.ta.stderr(ctx.source(inp.source), inp.length) };
    },
  },
  {
    id: 'Standard Error Bands', name: 'Standard Error Bands', shortName: 'StdErr Bands', category: 'Volatility', overlay: true,
    inputs: [
      { id: 'length', name: 'Length', type: 'int', defval: 21, min: 2 },
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'mult', name: 'Standard Error Mult', type: 'float', defval: 2, min: 0, step: 0.1 },
      { id: 'smoothing', name: 'Smoothing', type: 'int', defval: 3, min: 1 },
    ],
    plots: [
      { id: 'upper', title: 'Plot 1', style: plotStyle({ color: '#2196F3' }) },
      { id: 'basis', title: 'Plot 2', style: plotStyle({ color: '#FF6D00' }) },
      { id: 'lower', title: 'Plot 3', style: plotStyle({ color: '#2196F3' }) },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#2196F3', transparency: 95, visible: true }],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta } = ctx;
      const src = ctx.source(inp.source);
      const basis = ta.sma(ta.linreg(src, inp.length, 0), inp.smoothing);
      const se = ta.sma(ta.stderr(src, inp.length), inp.smoothing);
      const upper = ta.nanArray(n), lower = ta.nanArray(n);
      for (let i = 0; i < n; i++) { upper[i] = basis[i] + inp.mult * se[i]; lower[i] = basis[i] - inp.mult * se[i]; }
      return { upper, basis, lower };
    },
  },
  {
    id: 'Chaikin Volatility', name: 'Chaikin Volatility', shortName: 'Chaikin Vol', category: 'Volatility', overlay: false,
    inputs: [
      { id: 'periods', name: 'Periods', type: 'int', defval: 10, min: 1 },
      { id: 'roc', name: 'Rate of Change', type: 'int', defval: 10, min: 1 },
    ],
    plots: [{ id: 'cv', title: 'Chaikin Volatility', style: plotStyle({ color: '#AB47BC' }) }],
    bands: [{ id: 'zero', title: 'Zero', value: 0, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true }],
    precision: 2,
    includeZero: true,
    compute(ctx, inp) {
      const { n, ta, high, low } = ctx;
      const hl = ta.nanArray(n);
      for (let i = 0; i < n; i++) hl[i] = high[i] - low[i];
      const e = ta.ema(hl, inp.periods);
      const out = ta.nanArray(n);
      for (let i = inp.roc; i < n; i++) { const p = e[i - inp.roc]; if (isNum(p) && p !== 0 && isNum(e[i])) out[i] = ((e[i] - p) / p) * 100; }
      return { cv: out };
    },
  },
  {
    id: 'Mass Index', name: 'Mass Index', shortName: 'Mass Index', category: 'Volatility', overlay: false,
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 10, min: 1 }],
    plots: [{ id: 'mi', title: 'Mass Index', style: plotStyle({ color: '#2962FF' }) }],
    // TradingView draws no hlines; the classic 27 / 26.5 reversal-bulge levels are provided hidden.
    bands: [
      { id: 'bulge', title: 'Reversal Bulge', value: 27, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: false },
      { id: 'trigger', title: 'Trigger', value: 26.5, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: false },
    ],
    precision: 4,
    compute(ctx, inp) {
      const { n, ta, high, low } = ctx;
      const span = ta.nanArray(n);
      for (let i = 0; i < n; i++) span[i] = high[i] - low[i];
      const e1 = ta.ema(span, 9), e2 = ta.ema(e1, 9);
      const ratio = ta.nanArray(n);
      for (let i = 0; i < n; i++) if (isNum(e2[i]) && e2[i] !== 0) ratio[i] = e1[i] / e2[i];
      return { mi: ta.sum(ratio, inp.length) };
    },
  },
  {
    id: 'Relative Volatility Index', name: 'Relative Volatility Index', shortName: 'RVI', category: 'Volatility', overlay: false, aliases: ['RVI'],
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 10, min: 1 }],
    plots: [{ id: 'rvi', title: 'RVI', style: plotStyle({ color: '#7E57C2' }) }],
    bands: [
      { id: 'upper', title: 'Upper Band', value: 80, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'middle', title: 'Middle Band', value: 50, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'lower', title: 'Lower Band', value: 20, color: '#787B86', lineStyle: 2, lineWidth: 1, visible: true },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: '#7E57C2', transparency: 90, visible: true }],
    precision: 2,
    compute(ctx, inp) {
      const { n, ta, close } = ctx;
      const sd = ta.stdev(close, inp.length);
      const up = ta.nanArray(n), dn = ta.nanArray(n);
      for (let i = 1; i < n; i++) {
        if (!isNum(sd[i])) continue;
        const ch = close[i] - close[i - 1];
        up[i] = ch <= 0 ? 0 : sd[i];
        dn[i] = ch > 0 ? 0 : sd[i];
      }
      const eu = ta.ema(up, 14), ed = ta.ema(dn, 14);
      const out = ta.nanArray(n);
      for (let i = 0; i < n; i++) { const s = eu[i] + ed[i]; if (isNum(s) && s !== 0) out[i] = (eu[i] / s) * 100; }
      return { rvi: out };
    },
  },
  {
    id: 'Ulcer Index', name: 'Ulcer Index', shortName: 'Ulcer Index', category: 'Volatility', overlay: false,
    inputs: [
      { id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES },
      { id: 'length', name: 'Length', type: 'int', defval: 14, min: 1 },
    ],
    plots: [{ id: 'ui', title: 'Ulcer Index', style: plotStyle({ color: '#2962FF' }) }],
    precision: 2,
    compute(ctx, inp) {
      const { n, ta } = ctx;
      const src = ctx.source(inp.source);
      const hh = ta.highest(src, inp.length);
      const dd2 = ta.nanArray(n);
      for (let i = 0; i < n; i++) if (isNum(hh[i]) && hh[i] !== 0) { const d = ((src[i] - hh[i]) / hh[i]) * 100; dd2[i] = d * d; }
      const s = ta.sum(dd2, inp.length);
      const out = ta.nanArray(n);
      for (let i = 0; i < n; i++) if (isNum(s[i])) out[i] = Math.sqrt(s[i] / inp.length);
      return { ui: out };
    },
  },
  {
    id: 'Average Daily Range', name: 'Average Daily Range', shortName: 'ADR', category: 'Volatility', overlay: false, aliases: ['Average Day Range', 'ADR'],
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 14, min: 1 }],
    plots: [{ id: 'adr', title: 'ADR', style: plotStyle({ color: '#2962FF' }) }],
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta } = ctx;
      const h = ta.sma(ctx.high, inp.length), l = ta.sma(ctx.low, inp.length);
      const out = ta.nanArray(n);
      for (let i = 0; i < n; i++) out[i] = h[i] - l[i];
      return { adr: out };
    },
  },
];
