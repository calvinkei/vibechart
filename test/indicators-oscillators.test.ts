import { describe, it, expect } from 'vitest';
import { makeBars } from './helpers/mockCanvas';
import { buildIndicatorContext, inputDefaults, type IndicatorDefinition } from '../src/indicators/Indicator';
import { oscillators } from '../src/indicators/builtins/oscillators';
import { momentumIndicators } from '../src/indicators/builtins/momentum';
import * as ta from '../src/indicators/ta';
import type { Bar } from '../src/data/types';

const ALL = [...oscillators, ...momentumIndicators];
const byId = (id: string): IndicatorDefinition => {
  const d = ALL.find((x) => x.id === id);
  if (!d) throw new Error(`missing ${id}`);
  return d;
};
const ctxOf = (bars: Bar[]) => buildIndicatorContext(bars, '1D', null, 'Etc/UTC', 0.01);
const run = (id: string, bars: Bar[], overrides: Record<string, any> = {}) => {
  const def = byId(id);
  return def.compute(ctxOf(bars), { ...inputDefaults(def), ...overrides });
};
const vals = (r: any, id: string): Float64Array => (r[id] instanceof Float64Array ? r[id] : r[id].values);
const finiteTail = (a: Float64Array, tail: number) => { for (let i = a.length - tail; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };
const allNaN = (a: Float64Array) => { for (let i = 0; i < a.length; i++) if (a[i] === a[i]) return false; return true; };
const inRange = (a: Float64Array, lo: number, hi: number) => { for (let i = 0; i < a.length; i++) { const v = a[i]; if (v !== v) continue; if (v < lo - 1e-9 || v > hi + 1e-9) return false; } return true; };

const BARS = makeBars(900);
const SHORT = makeBars(5);

describe('oscillator/momentum definitions are well-formed', () => {
  it('ids are unique and every plot/band/fill reference resolves', () => {
    const ids = new Set<string>();
    for (const d of ALL) {
      expect(ids.has(d.id)).toBe(false);
      ids.add(d.id);
      expect(d.overlay).toBe(false);
      const plotIds = new Set(d.plots.map((p) => p.id));
      expect(plotIds.size).toBe(d.plots.length);
      const bandIds = new Set((d.bands || []).map((b) => b.id));
      expect(bandIds.size).toBe((d.bands || []).length);
      for (const f of d.fills || []) {
        expect(plotIds.has(f.a) || bandIds.has(f.a)).toBe(true);
        expect(plotIds.has(f.b) || bandIds.has(f.b)).toBe(true);
      }
      const inputIds = new Set(d.inputs.map((i) => i.id));
      expect(inputIds.size).toBe(d.inputs.length);
    }
  });

  for (const def of ALL) {
    it(`${def.id}: computes with defaults, correct lengths, finite after warm-up`, () => {
      const ctx = ctxOf(BARS);
      const res = def.compute(ctx, inputDefaults(def));
      for (const p of def.plots) {
        expect(res[p.id], `plot ${p.id}`).toBeDefined();
        const v = vals(res, p.id);
        expect(v.length).toBe(ctx.n);
        // optional plots (smoothing MA / BB when Type = None, Volume MA when off) are all-NaN; everything else must be finite in the tail
        if (!allNaN(v)) expect(finiteTail(v, 50), `plot ${p.id} has NaN in last 50 bars`).toBe(true);
        const colors = (res[p.id] as any).colors;
        if (colors) expect(colors.length).toBe(ctx.n);
      }
    });

    it(`${def.id}: short data does not throw`, () => {
      const ctx = ctxOf(SHORT);
      expect(() => def.compute(ctx, inputDefaults(def))).not.toThrow();
      const res = def.compute(ctx, inputDefaults(def));
      for (const p of def.plots) expect(vals(res, p.id).length).toBe(ctx.n);
      expect(() => def.compute(ctxOf([]), inputDefaults(def))).not.toThrow();
    });
  }
});

describe('bounded oscillators stay within their ranges', () => {
  it('Stochastic RSI K/D in 0..100', () => {
    const r = run('Stochastic RSI', BARS);
    expect(inRange(vals(r, 'k'), 0, 100)).toBe(true);
    expect(inRange(vals(r, 'd'), 0, 100)).toBe(true);
  });
  it('Williams %R in -100..0', () => expect(inRange(vals(run('Williams Percent Range', BARS), 'r'), -100, 0)).toBe(true));
  it('Ultimate Oscillator in 0..100', () => expect(inRange(vals(run('Ultimate Oscillator', BARS), 'uo'), 0, 100)).toBe(true));
  it('Connors RSI in 0..100', () => expect(inRange(vals(run('Connors RSI', BARS), 'crsi'), 0, 100)).toBe(true));
  it('Chande MO in -100..100', () => expect(inRange(vals(run('Chande Momentum Oscillator', BARS), 'cmo'), -100, 100)).toBe(true));
  it('Balance of Power in -1..1', () => expect(inRange(vals(run('Balance of Power', BARS), 'bop'), -1, 1)).toBe(true));
  it('RCI in -100..100', () => expect(inRange(vals(run('Rank Correlation Index', BARS), 'rci'), -100, 100)).toBe(true));
  it('SMI in -100..100', () => expect(inRange(vals(run('Stochastic Momentum Index', BARS), 'smi'), -100, 100)).toBe(true));
  it('Trend Strength Index in -1..1', () => expect(inRange(vals(run('Trend Strength Index', BARS), 'tsi'), -1, 1)).toBe(true));
  it('True Strength Index in -100..100', () => expect(inRange(vals(run('True Strength Index', BARS), 'tsi'), -100, 100)).toBe(true));
});

describe('hand-verified values', () => {
  const close = BARS.map((b) => b.close);

  it('Momentum = close - close[10]', () => {
    const m = vals(run('Momentum', BARS), 'mom');
    expect(m[9]).toBeNaN();
    for (const i of [10, 100, 899]) expect(m[i]).toBeCloseTo(close[i] - close[i - 10], 10);
  });

  it('Rate Of Change = 100 * (close - close[9]) / close[9]', () => {
    const r = vals(run('Rate Of Change', BARS), 'roc');
    expect(r[8]).toBeNaN();
    for (const i of [9, 250, 899]) expect(r[i]).toBeCloseTo((100 * (close[i] - close[i - 9])) / close[i - 9], 10);
  });

  it('Williams %R on a tiny array', () => {
    const bars: Bar[] = [
      { time: 1, open: 9, high: 10, low: 8, close: 9 },
      { time: 2, open: 9, high: 11, low: 9, close: 10 },
      { time: 3, open: 10, high: 12, low: 10, close: 11 },
      { time: 4, open: 11, high: 12, low: 9, close: 9.5 },
    ];
    const r = vals(run('Williams Percent Range', bars, { length: 3 }), 'r');
    expect(r[0]).toBeNaN();
    expect(r[1]).toBeNaN();
    expect(r[2]).toBeCloseTo((100 * (11 - 12)) / (12 - 8), 10); // -25
    expect(r[3]).toBeCloseTo((100 * (9.5 - 12)) / (12 - 9), 10); // -83.33
  });

  it('Balance of Power = (close - open) / (high - low)', () => {
    const b = vals(run('Balance of Power', BARS), 'bop');
    for (const i of [0, 50, 899]) expect(b[i]).toBeCloseTo((BARS[i].close - BARS[i].open) / (BARS[i].high - BARS[i].low), 10);
  });

  it('Awesome Oscillator = SMA(hl2,5) - SMA(hl2,34) with rising/falling colors', () => {
    const ctx = ctxOf(BARS);
    const r: any = run('Awesome Oscillator', BARS);
    const f = ta.sma(ctx.hl2, 5), s = ta.sma(ctx.hl2, 34);
    expect(r.ao.values[32]).toBeNaN();
    for (const i of [33, 200, 899]) expect(r.ao.values[i]).toBeCloseTo(f[i] - s[i], 10);
    for (let i = 34; i < 900; i++) expect(r.ao.colors[i]).toBe(r.ao.values[i] > r.ao.values[i - 1] ? '#089981' : '#F23645');
  });

  it('Accelerator Oscillator = AO - SMA(AO,5)', () => {
    const ctx = ctxOf(BARS);
    const ao = new Float64Array(ctx.n);
    const f = ta.sma(ctx.hl2, 5), s = ta.sma(ctx.hl2, 34);
    for (let i = 0; i < ctx.n; i++) ao[i] = f[i] - s[i];
    const aoMa = ta.sma(ao, 5);
    const ac = vals(run('Accelerator Oscillator', BARS), 'ac');
    for (const i of [40, 500, 899]) expect(ac[i]).toBeCloseTo(ao[i] - aoMa[i], 10);
  });

  it('Bull Bear Power = (high - ema13) + (low - ema13)', () => {
    const e = ta.ema(close, 13);
    const b = vals(run('Bull Bear Power', BARS), 'bbp');
    for (const i of [20, 400, 899]) expect(b[i]).toBeCloseTo(BARS[i].high - e[i] + (BARS[i].low - e[i]), 10);
  });

  it('DPO non-centered = close - sma[barsback]; centered = close - sma[+barsback] (last bars empty)', () => {
    const sma = ta.sma(close, 21);
    const d = vals(run('Detrended Price Oscillator', BARS), 'dpo');
    for (const i of [40, 500, 899]) expect(d[i]).toBeCloseTo(close[i] - sma[i - 11], 10);
    const c = vals(run('Detrended Price Oscillator', BARS, { centered: true }), 'dpo');
    for (const i of [40, 500, 888]) expect(c[i]).toBeCloseTo(close[i] - sma[i + 11], 10);
    for (let i = 889; i < 900; i++) expect(c[i]).toBeNaN();
  });

  it('Price Oscillator = (sma10 - sma21) / sma21 * 100', () => {
    const s = ta.sma(close, 10), l = ta.sma(close, 21);
    const p = vals(run('Price Oscillator', BARS), 'ppo');
    for (const i of [30, 300, 899]) expect(p[i]).toBeCloseTo(((s[i] - l[i]) / l[i]) * 100, 10);
    const e = vals(run('Price Oscillator', BARS, { exponential: true }), 'ppo');
    const es = ta.ema(close, 10), el = ta.ema(close, 21);
    expect(e[899]).toBeCloseTo(((es[899] - el[899]) / el[899]) * 100, 10);
  });

  it('Percentage Price Oscillator: hist = ppo - signal, MACD 4-color scheme', () => {
    const r: any = run('Percentage Price Oscillator', BARS);
    const f = ta.ema(close, 12), s = ta.ema(close, 26);
    expect(r.ppo[899]).toBeCloseTo(((f[899] - s[899]) / s[899]) * 100, 10);
    for (const i of [100, 899]) expect(r.hist.values[i]).toBeCloseTo(r.ppo[i] - r.signal[i], 10);
    expect(['#26A69A', '#B2DFDB', '#FFCDD2', '#FF5252']).toContain(r.hist.colors[899]);
  });

  it('KST = smaroc(10,10) + 2*smaroc(15,10) + 3*smaroc(20,10) + 4*smaroc(30,15); signal = sma(kst, 9)', () => {
    const sr = (r: number, s: number) => ta.sma(ta.roc(close, r), s);
    const a = sr(10, 10), b = sr(15, 10), c = sr(20, 10), d = sr(30, 15);
    const r: any = run('Know Sure Thing', BARS);
    const i = 899;
    expect(r.kst[i]).toBeCloseTo(a[i] + 2 * b[i] + 3 * c[i] + 4 * d[i], 10);
    expect(r.signal[i]).toBeCloseTo(ta.sma(r.kst, 9)[i], 10);
  });

  it('Coppock Curve = wma10(roc14 + roc11)', () => {
    const a = ta.roc(close, 14), b = ta.roc(close, 11);
    const s = new Float64Array(900);
    for (let i = 0; i < 900; i++) s[i] = a[i] + b[i];
    const w = ta.wma(s, 10);
    const c = vals(run('Coppock Curve', BARS), 'curve');
    for (const i of [30, 899]) expect(c[i]).toBeCloseTo(w[i], 10);
    expect(c[22]).toBeNaN();
  });

  it('TRIX = 10000 * change(ema^3(log close, 18))', () => {
    const lg = close.map(Math.log);
    const e3 = ta.ema(ta.ema(ta.ema(lg, 18), 18), 18);
    const t = vals(run('TRIX', BARS), 'trix');
    expect(t[899]).toBeCloseTo(10000 * (e3[899] - e3[898]), 8);
  });

  it('Stochastic RSI K = sma3(stoch(rsi14, 14)), D = sma3(K); starts after the RSI warm-up', () => {
    const rsi = ta.rsi(close, 14);
    const k = ta.sma(ta.stochNa(rsi, rsi, rsi, 14), 3);
    const r: any = run('Stochastic RSI', BARS);
    for (const i of [60, 899]) expect(r.k[i]).toBeCloseTo(k[i], 10);
    expect(r.d[899]).toBeCloseTo(ta.sma(r.k, 3)[899], 10);
    // rsi valid from bar 14, stoch needs 14 rsi values (bar 27), K smoothing 3 (bar 29)
    expect(r.k[28]).toBeNaN();
    expect(Number.isFinite(r.k[29])).toBe(true);
  });

  it('Fisher: trigger is the previous Fisher value; monotonic series pins Fisher positive', () => {
    const r: any = run('Fisher Transform', BARS);
    for (const i of [20, 500, 899]) expect(r.trigger[i]).toBe(r.fisher[i - 1]);
    const up = makeBars(60).map((b, i) => ({ ...b, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i }));
    const f = vals(run('Fisher Transform', up), 'fisher');
    expect(f[59]).toBeGreaterThan(1.5);
  });

  it('RCI: +100 on a strictly rising series, -100 on a strictly falling one', () => {
    const up = makeBars(30).map((b, i) => ({ ...b, close: 100 + i }));
    const dn = makeBars(30).map((b, i) => ({ ...b, close: 100 - i }));
    expect(vals(run('Rank Correlation Index', up), 'rci')[29]).toBeCloseTo(100, 10);
    expect(vals(run('Rank Correlation Index', dn), 'rci')[29]).toBeCloseTo(-100, 10);
    // ties get average ranks: a flat series has zero rank variance -> 0
    const flat = makeBars(30).map((b) => ({ ...b, close: 100 }));
    expect(vals(run('Rank Correlation Index', flat), 'rci')[29]).toBe(0);
  });

  it('CMO = 100 on a strictly rising series; smoothing group off by default', () => {
    const up = makeBars(30).map((b, i) => ({ ...b, close: 100 + i }));
    expect(vals(run('Chande Momentum Oscillator', up), 'cmo')[29]).toBeCloseTo(100, 10);
    const r = run('Commodity Channel Index', BARS);
    expect(allNaN(vals(r, 'ma'))).toBe(true);
    const s = run('Commodity Channel Index', BARS, { maType: 'SMA + Bollinger Bands' });
    expect(finiteTail(vals(s, 'ma'), 10)).toBe(true);
    expect(vals(s, 'bbUpper')[899]).toBeGreaterThan(vals(s, 'bbLower')[899]);
    expect(vals(s, 'ma')[899]).toBeCloseTo(ta.sma(vals(s, 'cci'), 14)[899], 10);
  });

  it('CCI matches ta.cci on hlc3', () => {
    const ctx = ctxOf(BARS);
    const c = vals(run('Commodity Channel Index', BARS), 'cci');
    const ref = ta.cci(ctx.hlc3, 20);
    for (const i of [25, 899]) expect(c[i]).toBeCloseTo(ref[i], 10);
  });

  it('SMI Ergodic: indicator = ta.tsi(close, 5, 20), oscillator = indicator - ema5(indicator)', () => {
    const erg = ta.tsi(close, 5, 20);
    const ind: any = run('SMI Ergodic Indicator', BARS);
    const osc = vals(run('SMI Ergodic Oscillator', BARS), 'osc');
    expect(ind.indicator[899]).toBeCloseTo(erg[899], 10);
    expect(osc[899]).toBeCloseTo(ind.indicator[899] - ind.signal[899], 10);
  });

  it('True Strength Index = ta.tsi(close, 13, 25); signal = ema13', () => {
    const r: any = run('True Strength Index', BARS);
    const ref = ta.tsi(close, 13, 25);
    expect(r.tsi[899]).toBeCloseTo(ref[899], 10);
    expect(r.signal[899]).toBeCloseTo(ta.ema(ref, 13)[899], 10);
  });

  it('Ultimate Oscillator hand check on a tiny array', () => {
    // 3 bars, lengths 1/1/1 => uo = 100 * bp/tr of the current bar
    const bars: Bar[] = [
      { time: 1, open: 10, high: 11, low: 9, close: 10 },
      { time: 2, open: 10, high: 12, low: 9.5, close: 11.5 },
      { time: 3, open: 11.5, high: 12, low: 10, close: 10.5 },
    ];
    const u = vals(run('Ultimate Oscillator', bars, { fast: 1, middle: 1, slow: 1 }), 'uo');
    expect(u[0]).toBeNaN();
    // bar 1: low_ = min(9.5, 10) = 9.5, high_ = max(12, 10) = 12 -> bp = 2, tr = 2.5
    expect(u[1]).toBeCloseTo(100 * (2 / 2.5), 10);
    // bar 2: low_ = min(10, 11.5) = 10, high_ = max(12, 11.5) = 12 -> bp = 0.5, tr = 2
    expect(u[2]).toBeCloseTo(100 * (0.5 / 2), 10);
  });

  it('Chaikin Oscillator = ema3(accdist) - ema10(accdist)', () => {
    const ctx = ctxOf(BARS);
    const ad = ta.accdist(ctx.high, ctx.low, ctx.close, ctx.volume);
    const ref = ta.ema(ad, 3)[899] - ta.ema(ad, 10)[899];
    expect(vals(run('Chaikin Oscillator', BARS), 'osc')[899]).toBeCloseTo(ref, 8);
  });

  it('Woodies CCI: color state machine (gray 1-4, yellow 5, trend color 6+) and lines', () => {
    const r: any = run('Woodies CCI', BARS);
    const c14 = ta.cci(close, 14), turbo = ta.cci(close, 6);
    expect(r.hist.values[899]).toBeCloseTo(c14[899], 10);
    expect(r.cci14[899]).toBeCloseTo(c14[899], 10);
    expect(r.turbo[899]).toBeCloseTo(turbo[899], 10);
    let side = 0, streak = 0;
    for (let i = 0; i < 900; i++) {
      const v = c14[i];
      if (v !== v) { expect(r.hist.colors[i]).toBeNull(); side = 0; streak = 0; continue; }
      const s = v > 0 ? 1 : v < 0 ? -1 : 0;
      if (s !== 0 && s === side) streak++; else { side = s; streak = s === 0 ? 0 : 1; }
      const want = streak >= 6 ? (side > 0 ? '#4CAF50' : '#F23645') : streak === 5 ? '#FFEB3B' : '#787B86';
      expect(r.hist.colors[i]).toBe(want);
    }
    expect(new Set(r.hist.colors.filter((x: string | null) => x)).size).toBeGreaterThanOrEqual(3);
  });

  it('Connors RSI = avg(rsi3, rsi2(updown streak), percentrank100(roc1))', () => {
    const rsi = ta.rsi(close, 3);
    const ud = ta.updownStreak(close);
    const udRsi = ta.rsi(ud, 2);
    const pr = ta.percentrankNa(ta.roc(close, 1), 100);
    const c = vals(run('Connors RSI', BARS), 'crsi');
    expect(c[100]).toBeNaN(); // roc(1) is NaN at bar 0 -> percentrank window not full until bar 101
    for (const i of [101, 899]) expect(c[i]).toBeCloseTo((rsi[i] + udRsi[i] + pr[i]) / 3, 10);
    // streak semantics
    const s = ta.updownStreak([1, 2, 3, 3, 2, 1, 2]);
    expect(Array.from(s.slice(1))).toEqual([1, 2, 0, -1, -2, 1]);
  });

  it('Relative Vigor Index = sum(swma(c-o),10)/sum(swma(h-l),10); signal = swma(rvgi)', () => {
    const ctx = ctxOf(BARS);
    const co = new Float64Array(900), hl = new Float64Array(900);
    for (let i = 0; i < 900; i++) { co[i] = ctx.close[i] - ctx.open[i]; hl[i] = ctx.high[i] - ctx.low[i]; }
    const ref = ta.sum(ta.swma(co), 10)[899] / ta.sum(ta.swma(hl), 10)[899];
    const r: any = run('Relative Vigor Index', BARS);
    expect(r.rvgi[899]).toBeCloseTo(ref, 10);
    expect(r.signal[899]).toBeCloseTo(ta.swma(r.rvgi)[899], 10);
  });

  it('Stochastic Momentum Index: zone helper plots clamp at ±40, EMA = ema3(SMI)', () => {
    const r: any = run('Stochastic Momentum Index', BARS);
    for (let i = 0; i < 900; i++) {
      const v = r.smi[i];
      if (v !== v) continue;
      expect(r.obZone[i]).toBe(v > 40 ? v : 40);
      expect(r.osZone[i]).toBe(v < -40 ? v : -40);
    }
    expect(r.ema[899]).toBeCloseTo(ta.ema(r.smi, 3)[899], 10);
  });

  it('Trend Strength Index = correlation(close, bar_index, 14); +1 on a straight line', () => {
    const up = makeBars(30).map((b, i) => ({ ...b, close: 100 + 2 * i }));
    const r: any = run('Trend Strength Index', up);
    expect(r.tsi.values[29]).toBeCloseTo(1, 10);
    expect(r.tsi.colors[29]).toBe('#089981');
    expect(r.bullZone[29]).toBeCloseTo(1, 10);
    expect(r.bearZone[29]).toBe(0);
  });

  it('Price Momentum Oscillator: custom EMA alpha 2/len seeded from 0, signal = ema10', () => {
    const roc1 = new Float64Array(900).fill(NaN);
    for (let i = 1; i < 900; i++) roc1[i] = (100 * (close[i] - close[i - 1])) / close[i - 1];
    const e1 = ta.emaAlphaNz(roc1, 2 / 35);
    const scaled = new Float64Array(900);
    for (let i = 0; i < 900; i++) scaled[i] = 10 * e1[i];
    const pmo = ta.emaAlphaNz(scaled, 2 / 20);
    const r: any = run('Price Momentum Oscillator', BARS);
    expect(r.pmo[899]).toBeCloseTo(pmo[899], 10);
    expect(r.signal[899]).toBeCloseTo(ta.ema(pmo, 10)[899], 10);
    // alpha semantics: e[1] = 0 + alpha * (s[1] - 0)
    const e = ta.emaAlphaNz([NaN, 5, 5], 0.5);
    expect(e[0]).toBeNaN();
    expect(e[1]).toBe(2.5);
    expect(e[2]).toBe(3.75);
  });

  it("Pring's Special K: weighted sum of 12 smoothed ROCs; NaN before 725 bars", () => {
    const r: any = run("Pring's Special K", BARS);
    expect(r.specialK[720]).toBeNaN();
    expect(Number.isFinite(r.specialK[899])).toBe(true);
    const terms: Array<[number, number, number]> = [[10, 10, 1], [15, 10, 2], [20, 10, 3], [30, 15, 4], [40, 50, 1], [65, 65, 2], [75, 75, 3], [100, 100, 4], [195, 130, 1], [265, 130, 2], [390, 130, 3], [530, 195, 4]];
    let ref = 0;
    for (const [rr, s, w] of terms) ref += w * ta.sma(ta.roc(close, rr), s)[899];
    expect(r.specialK[899]).toBeCloseTo(ref, 8);
  });
});

describe('new ta primitives', () => {
  it('highestNa/lowestNa propagate NaN, stochNa stays NaN until the window is clean', () => {
    const s = [NaN, 1, 2, 3, 4];
    expect(ta.highestNa(s, 2)[1]).toBeNaN();
    expect(ta.highestNa(s, 2)[2]).toBe(2);
    expect(ta.lowestNa(s, 3)[3]).toBe(1);
    expect(ta.stochNa(s, s, s, 2)[1]).toBeNaN();
    expect(ta.stochNa(s, s, s, 2)[4]).toBe(100);
  });
  it('percentrankNa: strict window, ties count as <=', () => {
    const s = [5, 1, 2, 3, 3, 4];
    expect(ta.percentrankNa(s, 3)[2]).toBeNaN();
    expect(ta.percentrankNa(s, 3)[3]).toBeCloseTo((100 * 2) / 3, 10); // window [5,1,2] vs 3 -> 2 of 3
    expect(ta.percentrankNa(s, 3)[4]).toBe(100); // window [1,2,3] vs 3 -> all <= 3
    expect(ta.percentrankNa(s, 3)[5]).toBe(100);
    expect(ta.percentrankNa([NaN, 1, 2, 3], 3)[3]).toBeNaN();
  });
  it('rci handles ties with average ranks', () => {
    expect(ta.rci([1, 2, 2, 3], 4)[3]).toBeGreaterThan(90);
    expect(ta.rci([1, 2, 2, 3], 4)[3]).toBeLessThan(100);
  });
});
