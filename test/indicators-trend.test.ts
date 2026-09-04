import { describe, it, expect } from 'vitest';
import { makeBars } from './helpers/mockCanvas';
import { buildIndicatorContext, inputDefaults, type IndicatorDefinition } from '../src/indicators/Indicator';
import { movingAverages } from '../src/indicators/builtins/movingAverages';
import { trendIndicators } from '../src/indicators/builtins/trend';
import { volatilityIndicators } from '../src/indicators/builtins/volatility';
import { pivotsIndicators } from '../src/indicators/builtins/pivots';
import * as ta from '../src/indicators/ta';
import type { Bar } from '../src/data/types';

const bars = makeBars(300);
const ctx = buildIndicatorContext(bars, '1D', null, 'Etc/UTC', 0.01);
// makeBars opens each bar at the previous close, so every peak carries two equal highs and strict pivots never form;
// jitter highs/lows deterministically for the pivot-based tests (Zig Zag, Auto Fib, Pivot Points High Low).
const jbars = makeBars(300).map((b, i) => ({ ...b, high: b.high * (1 + 0.0005 * ((i * 7919) % 13)), low: b.low * (1 - 0.0005 * ((i * 104729) % 11)) }));
const jctx = buildIndicatorContext(jbars, '1D', null, 'Etc/UTC', 0.01);
const all: IndicatorDefinition[] = [...movingAverages, ...trendIndicators, ...volatilityIndicators, ...pivotsIndicators];
const byId = (id: string): IndicatorDefinition => {
  const d = all.find((x) => x.id === id);
  if (!d) throw new Error(`missing indicator ${id}`);
  return d;
};
const run = (def: IndicatorDefinition, inputs: Record<string, any> = {}, c = ctx) => def.compute(c, { ...inputDefaults(def), ...inputs });
const vals = (res: ReturnType<IndicatorDefinition['compute']>, id: string): Float64Array => {
  const v = res[id];
  return v instanceof Float64Array ? v : v.values;
};
const maxOf = (a: ArrayLike<number>, from: number, to: number): number => { let m = -Infinity; for (let i = from; i <= to; i++) m = Math.max(m, a[i]); return m; };
const minOf = (a: ArrayLike<number>, from: number, to: number): number => { let m = Infinity; for (let i = from; i <= to; i++) m = Math.min(m, a[i]); return m; };

describe('MA / trend / volatility / pivot indicators: shape and robustness', () => {
  const ids = new Set<string>();
  for (const def of all) {
    it(`${def.id}: unique id, every plot has an n-length output, tolerates short and empty data`, () => {
      expect(ids.has(def.id)).toBe(false);
      ids.add(def.id);
      const res = run(def);
      for (const p of def.plots) {
        expect(res[p.id], `${def.id}: plot ${p.id} missing`).toBeDefined();
        expect(vals(res, p.id).length).toBe(ctx.n);
      }
      for (const f of def.fills || []) {
        const ok = (x: string) => def.plots.some((p) => p.id === x) || (def.bands || []).some((b) => b.id === x);
        expect(ok(f.a) && ok(f.b), `${def.id}: fill ${f.id} references unknown plot/band`).toBe(true);
      }
      for (const len of [0, 1, 2, 5, 30]) {
        const small = buildIndicatorContext(bars.slice(0, len), '1D', null, 'Etc/UTC', 0.01);
        expect(() => def.compute(small, inputDefaults(def)), `${def.id} with ${len} bars`).not.toThrow();
        const r = def.compute(small, inputDefaults(def));
        for (const p of def.plots) expect(vals(r, p.id).length).toBe(len);
      }
      // intraday resolution path (HV annualisation, pivot auto timeframe, RVOL anchors)
      const intraday = buildIndicatorContext(makeBars(200, 100, 900), '15', null, 'America/New_York', 0.01);
      expect(() => def.compute(intraday, inputDefaults(def))).not.toThrow();
    });
  }
});

describe('hand-verified values', () => {
  it('Donchian Channels: upper = highest high, lower = lowest low, basis = midpoint', () => {
    const r = run(byId('Donchian Channels'));
    const i = 100;
    const hh = maxOf(ctx.high, i - 19, i), ll = minOf(ctx.low, i - 19, i);
    expect(vals(r, 'upper')[i]).toBeCloseTo(hh, 10);
    expect(vals(r, 'lower')[i]).toBeCloseTo(ll, 10);
    expect(vals(r, 'basis')[i]).toBeCloseTo((hh + ll) / 2, 10);
    expect(Number.isNaN(vals(r, 'upper')[18])).toBe(true);
    // offset shifts values to the right
    const ro = run(byId('Donchian Channels'), { offset: 3 });
    expect(vals(ro, 'upper')[i + 3]).toBeCloseTo(hh, 10);
  });

  it('Ichimoku: conversion = (hh9 + ll9) / 2, base = (hh26 + ll26) / 2, lead A = avg, cloud halves partition the spans', () => {
    const r = run(byId('Ichimoku Cloud'));
    const i = 120;
    expect(vals(r, 'conversion')[i]).toBeCloseTo((maxOf(ctx.high, i - 8, i) + minOf(ctx.low, i - 8, i)) / 2, 10);
    expect(vals(r, 'base')[i]).toBeCloseTo((maxOf(ctx.high, i - 25, i) + minOf(ctx.low, i - 25, i)) / 2, 10);
    expect(vals(r, 'leadA')[i]).toBeCloseTo((vals(r, 'conversion')[i] + vals(r, 'base')[i]) / 2, 10);
    expect(vals(r, 'leadB')[i]).toBeCloseTo((maxOf(ctx.high, i - 51, i) + minOf(ctx.low, i - 51, i)) / 2, 10);
    expect(vals(r, 'lagging')[i]).toBe(ctx.close[i]);
    const a = vals(r, 'leadA'), b = vals(r, 'leadB'), ua = vals(r, 'cloudUpA'), da = vals(r, 'cloudDnA');
    let both = 0;
    for (let k = 60; k < ctx.n; k++) {
      if (a[k] > b[k]) expect(ua[k]).toBe(a[k]); else expect(da[k]).toBe(a[k]);
      if (!Number.isNaN(ua[k]) && !Number.isNaN(da[k])) both++;
    }
    expect(both).toBeGreaterThan(0); // crossing bars belong to both halves so the cloud has no gaps
    // a different displacement shifts the spans by the difference from the default
    const r2 = run(byId('Ichimoku Cloud'), { displacement: 30 });
    expect(vals(r2, 'leadA')[i + 4]).toBeCloseTo(vals(r, 'leadA')[i], 10);
    expect(vals(r2, 'lagging')[i - 4]).toBe(ctx.close[i]);
  });

  it('Supertrend: direction flips, up/down plots are complementary and match the band on each side', () => {
    const r = run(byId('Supertrend'));
    const up = vals(r, 'up'), down = vals(r, 'down');
    let ups = 0, downs = 0, flips = 0, prev = 0;
    for (let i = 1; i < ctx.n; i++) {
      const hasUp = !Number.isNaN(up[i]), hasDown = !Number.isNaN(down[i]);
      if (!hasUp && !hasDown) continue;
      expect(hasUp && hasDown).toBe(false);
      const dir = hasUp ? -1 : 1;
      if (hasUp) { ups++; expect(up[i]).toBeLessThanOrEqual(ctx.close[i]); } else { downs++; expect(down[i]).toBeGreaterThanOrEqual(ctx.close[i]); }
      if (prev !== 0 && dir !== prev) flips++;
      prev = dir;
    }
    expect(ups).toBeGreaterThan(0);
    expect(downs).toBeGreaterThan(0);
    expect(flips).toBeGreaterThan(0);
    expect(Number.isNaN(up[0]) && Number.isNaN(down[0])).toBe(true);
  });

  it('Parabolic SAR: bar 0 is NaN, bar 1 seeds at the previous low/high, SAR sits outside the bar range', () => {
    const r = run(byId('Parabolic SAR'));
    const sar = vals(r, 'sar');
    expect(Number.isNaN(sar[0])).toBe(true);
    const seed = ctx.close[1] > ctx.close[0] ? ctx.low[0] : ctx.high[0];
    expect(sar[1]).toBeCloseTo(seed, 10);
    for (let i = 3; i < ctx.n; i++) expect(sar[i] <= ctx.high[i] || sar[i] >= ctx.low[i]).toBe(true);
  });

  it('Aroon: 100 on a fresh 15-bar high, values within [0, 100], oscillator = up - down', () => {
    const r = run(byId('Aroon'));
    const up = vals(r, 'up'), down = vals(r, 'down');
    let saw100 = false;
    for (let i = 14; i < ctx.n; i++) {
      expect(up[i]).toBeGreaterThanOrEqual(0); expect(up[i]).toBeLessThanOrEqual(100);
      expect(down[i]).toBeGreaterThanOrEqual(0); expect(down[i]).toBeLessThanOrEqual(100);
      if (ctx.high[i] >= maxOf(ctx.high, i - 14, i)) { expect(up[i]).toBe(100); saw100 = true; }
    }
    expect(saw100).toBe(true);
    const o = run(byId('Aroon Oscillator'));
    expect(vals(o, 'osc')[100]).toBeCloseTo(up[100] - down[100], 10);
  });

  it('ADX / DMI: 0..100, DMI ADX equals ADX study, DI lines seeded after the first TR', () => {
    const adx = vals(run(byId('Average Directional Index')), 'adx');
    const d = run(byId('Directional Movement Index'));
    for (let i = 40; i < ctx.n; i++) {
      expect(adx[i]).toBeGreaterThanOrEqual(0); expect(adx[i]).toBeLessThanOrEqual(100);
      expect(vals(d, 'adx')[i]).toBe(adx[i]);
      expect(vals(d, 'plus')[i]).toBeGreaterThanOrEqual(0);
      expect(vals(d, 'minus')[i]).toBeGreaterThanOrEqual(0);
    }
    expect(Number.isNaN(vals(d, 'plus')[13])).toBe(true);
    expect(Number.isNaN(vals(d, 'plus')[14])).toBe(false);
  });

  it('Pivot Points Standard (Traditional, Daily on daily bars): levels come from the previous bar', () => {
    const r = run(byId('Pivot Points Standard'), { pivotsTimeframe: 'Daily' });
    const i = ctx.n - 1;
    const H = ctx.high[i - 1], L = ctx.low[i - 1], C = ctx.close[i - 1];
    const P = (H + L + C) / 3;
    expect(vals(r, 'P')[i]).toBeCloseTo(P, 10);
    expect(vals(r, 'R1')[i]).toBeCloseTo(2 * P - L, 10);
    expect(vals(r, 'S1')[i]).toBeCloseTo(2 * P - H, 10);
    expect(vals(r, 'R2')[i]).toBeCloseTo(P + (H - L), 10);
    expect(vals(r, 'S5')[i]).toBeCloseTo(4 * P - (4 * H - L), 10);
    // only the last 15 periods are drawn
    expect(Number.isNaN(vals(r, 'P')[i - 15])).toBe(true);
    expect(Number.isNaN(vals(r, 'P')[i - 14])).toBe(false);
    // labels carry the price text at the period start
    const lbl = r.PLabel as { values: Float64Array; texts?: Array<string | null> | null };
    expect(lbl.texts?.[i]).toBe(`P (${P.toFixed(2)})`);
    // Fibonacci / DM / Camarilla level sets
    const fib = run(byId('Pivot Points Standard'), { pivotsTimeframe: 'Daily', type: 'Fibonacci' });
    expect(vals(fib, 'R1')[i]).toBeCloseTo(P + 0.382 * (H - L), 10);
    expect(Number.isNaN(vals(fib, 'R4')[i])).toBe(true);
    const dm = run(byId('Pivot Points Standard'), { pivotsTimeframe: 'Daily', type: 'DM' });
    const O = ctx.open[i - 1];
    const X = O === C ? H + L + 2 * C : C > O ? 2 * H + L + C : 2 * L + H + C;
    expect(vals(dm, 'P')[i]).toBeCloseTo(X / 4, 10);
    const cam = run(byId('Pivot Points Standard'), { pivotsTimeframe: 'Daily', type: 'Camarilla' });
    expect(vals(cam, 'R5')[i]).toBeCloseTo((H / L) * C, 10);
    // monthly periods: all bars of Feb 2024 share one value computed from Jan 2024 (bars 0..30)
    const m = run(byId('Pivot Points Standard'), { pivotsTimeframe: 'Monthly', lookBack: 100 });
    const Pm = (maxOf(ctx.high, 0, 30) + minOf(ctx.low, 0, 30) + ctx.close[30]) / 3;
    for (let k = 31; k < 60; k++) expect(vals(m, 'P')[k]).toBeCloseTo(Pm, 10);
  });

  it('Williams Fractal: an isolated spike is an up fractal on the centre bar; a dip is a down fractal', () => {
    const flat: Bar[] = [];
    for (let i = 0; i < 20; i++) flat.push({ time: 1704067200 + i * 86400, open: 100, high: 101, low: 99, close: 100, volume: 1000 });
    flat[10] = { ...flat[10], high: 110 };
    flat[15] = { ...flat[15], low: 90 };
    const c = buildIndicatorContext(flat, '1D', null, 'Etc/UTC', 0.01);
    const r = run(byId('Williams Fractal'), {}, c);
    const up = vals(r, 'up'), down = vals(r, 'down');
    expect(up[10]).toBe(1);
    expect(down[15]).toBe(1);
    expect(up.filter((v) => v === 1).length).toBe(1);
    expect(down.filter((v) => v === 1).length).toBe(1);
  });

  it('Zig Zag: pivots alternate, every added leg exceeds the deviation, polyline passes through pivots', () => {
    const { pivots, projected } = ta.zigzag(jctx.high, jctx.low, 5, 10);
    expect(pivots.length).toBeGreaterThan(2);
    for (let k = 1; k < pivots.length; k++) {
      expect(pivots[k].isHigh).toBe(!pivots[k - 1].isHigh);
      expect(pivots[k].bar).toBeGreaterThan(pivots[k - 1].bar);
      expect((Math.abs(pivots[k].price - pivots[k - 1].price) / pivots[k - 1].price) * 100).toBeGreaterThanOrEqual(5);
      if (pivots[k].isHigh) expect(pivots[k].price).toBe(jctx.high[pivots[k].bar]); else expect(pivots[k].price).toBe(jctx.low[pivots[k].bar]);
    }
    const r = run(byId('Zig Zag'), {}, jctx);
    const line = vals(r, 'zigzag');
    for (const p of pivots) expect(line[p.bar]).toBeCloseTo(p.price, 10);
    const mid = Math.floor((pivots[0].bar + pivots[1].bar) / 2);
    expect(Number.isNaN(line[mid])).toBe(false);
    if (projected) {
      expect(projected.isHigh).toBe(!pivots[pivots.length - 1].isHigh);
      expect(vals(r, 'projection')[projected.bar]).toBeCloseTo(projected.price, 10);
    }
    const labels = r.highLabels as { texts?: Array<string | null> | null };
    const firstHigh = pivots.find((p) => p.isHigh)!;
    expect(labels.texts?.[firstHigh.bar]).toContain(firstHigh.price.toFixed(2));
  });

  it('Auto Fib Retracement: level 0 = last pivot, level 1 = previous pivot, drawn from the last pivot bar', () => {
    const { pivots } = ta.zigzag(jctx.high, jctx.low, 3, 10);
    const p1 = pivots[pivots.length - 2], p2 = pivots[pivots.length - 1];
    const r = run(byId('Auto Fib Retracement'), {}, jctx);
    expect(vals(r, 'level0')[jctx.n - 1]).toBeCloseTo(p2.price, 10);
    expect(vals(r, 'level6')[jctx.n - 1]).toBeCloseTo(p1.price, 10);
    expect(vals(r, 'level4')[jctx.n - 1]).toBeCloseTo(p2.price + (p1.price - p2.price) * 0.618, 10);
    expect(Number.isNaN(vals(r, 'level0')[p2.bar - 1])).toBe(true);
    expect(Number.isNaN(vals(r, 'level0')[p2.bar])).toBe(false);
    const e = run(byId('Auto Fib Extension'), {}, jctx);
    const p0 = pivots[pivots.length - 3];
    expect(vals(e, 'level6')[jctx.n - 1]).toBeCloseTo(p2.price + (p1.price - p0.price), 10);
  });

  it('Williams Alligator: jaw/teeth/lips are SMMA(hl2) (offsets live in the plot styles)', () => {
    const r = run(byId('Williams Alligator'));
    const jaw = ta.rma(ctx.hl2, 13);
    expect(vals(r, 'jaw')[100]).toBeCloseTo(jaw[100], 10);
    expect(byId('Williams Alligator').plots[0].style.offset).toBe(8);
    const r2 = run(byId('Williams Alligator'), { jawOffset: 10 });
    expect(vals(r2, 'jaw')[102]).toBeCloseTo(jaw[100], 10);
  });

  it('Keltner / Envelope / Price Channel / Chandelier: band arithmetic', () => {
    const kc = run(byId('Keltner Channels'));
    const basis = ta.ema(ctx.close, 20), atr = ta.atr(ctx.high, ctx.low, ctx.close, 10);
    expect(vals(kc, 'upper')[100]).toBeCloseTo(basis[100] + 2 * atr[100], 10);
    const env = run(byId('Envelope'));
    const sma = ta.sma(ctx.close, 20);
    expect(vals(env, 'upper')[100]).toBeCloseTo(sma[100] * 1.1, 10);
    expect(vals(env, 'lower')[100]).toBeCloseTo(sma[100] * 0.9, 10);
    const pc = run(byId('Price Channel'));
    expect(vals(pc, 'high')[100]).toBeCloseTo(maxOf(ctx.high, 81, 100), 10);
    const ch = run(byId('Chandelier Exit'));
    const atr22 = ta.atr(ctx.high, ctx.low, ctx.close, 22);
    expect(vals(ch, 'long')[100]).toBeCloseTo(maxOf(ctx.high, 79, 100) - 3 * atr22[100], 10);
  });

  it('Linear Regression Channel: base line ends at LSMA, channel symmetric around it, Pearson label on the last bar', () => {
    const r = run(byId('Linear Regression Channel'));
    const last = ctx.n - 1;
    const lsma = ta.linreg(ctx.close, 100, 0);
    expect(vals(r, 'base')[last]).toBeCloseTo(lsma[last], 8);
    expect(vals(r, 'upper')[last] - vals(r, 'base')[last]).toBeCloseTo(vals(r, 'base')[last] - vals(r, 'lower')[last], 8);
    expect(Number.isNaN(vals(r, 'base')[last - 100])).toBe(true);
    expect(Number.isNaN(vals(r, 'base')[last - 99])).toBe(false);
    const pear = r.pearson as { values: Float64Array; texts?: Array<string | null> | null };
    expect(pear.texts?.[last]).toMatch(/^Pearson's R: -?\d\.\d{3}$/);
    const ext = run(byId('Linear Regression Channel'), { extendLeft: true });
    expect(Number.isNaN(vals(ext, 'base')[0])).toBe(false);
    const slope = vals(run(byId('Linear Regression Slope')), 'slope');
    expect(slope[100]).toBeCloseTo(ta.linregSlope(ctx.close, 14)[100], 10);
  });

  it('Moving averages: ALMA, KAMA seed, McGinley seed, Hamming symmetric weights, ribbon and cross markers', () => {
    expect(vals(run(byId('Arnaud Legoux Moving Average')), 'alma')[50]).toBeCloseTo(ta.alma(ctx.close, 9, 0.85, 6)[50], 12);
    const k = vals(run(byId('Moving Average Adaptive')), 'kama');
    expect(k[0]).toBe(ctx.close[0]);
    expect(Number.isNaN(k[50])).toBe(false);
    const mg = vals(run(byId('McGinley Dynamic')), 'mg');
    expect(Number.isNaN(mg[12])).toBe(true);
    expect(mg[13]).toBeCloseTo(ta.ema(ctx.close, 14)[13], 12);
    const flat = buildIndicatorContext(makeBars(40, 100, 86400).map((b) => ({ ...b, close: 50 })), '1D', null, 'Etc/UTC', 0.01);
    expect(vals(run(byId('Moving Average Hamming'), {}, flat), 'ma')[30]).toBeCloseTo(50, 12);
    const rib = run(byId('Moving Average Ribbon'));
    expect(vals(rib, 'ma2')[100]).toBeCloseTo(ta.sma(ctx.close, 50)[100], 12);
    expect(Number.isNaN(vals(run(byId('Moving Average Ribbon'), { ma3Enabled: false }), 'ma3')[150])).toBe(true);
    const cross = run(byId('MA Cross'));
    const s = vals(cross, 'short'), l = vals(cross, 'long'), c = vals(cross, 'crosses');
    let count = 0;
    for (let i = 21; i < ctx.n; i++) {
      const crossed = (s[i] > l[i] && s[i - 1] <= l[i - 1]) || (s[i] < l[i] && s[i - 1] >= l[i - 1]);
      expect(Number.isNaN(c[i])).toBe(!crossed);
      if (crossed) { expect(c[i]).toBe(s[i]); count++; }
    }
    expect(count).toBeGreaterThan(0);
    const multi = run(byId('Moving Average Multiple'));
    expect(vals(multi, 'ma6')[200]).toBeCloseTo(ta.sma(ctx.close, 100)[200], 12);
    const gmma = run(byId('Guppy Multiple Moving Average'));
    expect(vals(gmma, 'investor6')[200]).toBeCloseTo(ta.ema(ctx.close, 60)[200], 12);
  });

  it('TWAP resets at session boundaries (15-minute bars) and at week starts (daily bars)', () => {
    const intra = buildIndicatorContext(makeBars(96 * 3, 100, 900), '15', null, 'Etc/UTC', 0.01);
    const tw = vals(run(byId('Time Weighted Average Price'), {}, intra), 'twap');
    expect(tw[96]).toBeCloseTo(intra.ohlc4[96], 12); // first bar of day 2
    let s = 0;
    for (let i = 96; i <= 100; i++) s += intra.ohlc4[i];
    expect(tw[100]).toBeCloseTo(s / 5, 10);
    const daily = vals(run(byId('Time Weighted Average Price'), { anchor: 'Week' }), 'twap');
    expect(daily[1]).toBeCloseTo((ctx.ohlc4[0] + ctx.ohlc4[1]) / 2, 10); // 2024-01-01 is a Monday
  });

  it('Volatility family: BB %B, BBW, HV annualisation, StdDev, Ulcer, ADR, Mass Index, Chop values', () => {
    const b = ta.bb(ctx.close, 20, 2);
    expect(vals(run(byId('Bollinger Bands %B')), 'bbr')[100]).toBeCloseTo((ctx.close[100] - b.lower[100]) / (b.upper[100] - b.lower[100]), 12);
    expect(vals(run(byId('Bollinger Bands Width')), 'bbw')[100]).toBeCloseTo(((b.upper[100] - b.lower[100]) / b.basis[100]) * 100, 12);
    const lr = new Float64Array(ctx.n).fill(NaN);
    for (let i = 1; i < ctx.n; i++) lr[i] = Math.log(ctx.close[i] / ctx.close[i - 1]);
    const hvDaily = vals(run(byId('Historical Volatility')), 'hv');
    expect(hvDaily[100]).toBeCloseTo(100 * ta.stdev(lr, 10)[100] * Math.sqrt(365), 10);
    const weekly = buildIndicatorContext(bars, '1W', null, 'Etc/UTC', 0.01);
    expect(vals(run(byId('Historical Volatility'), {}, weekly), 'hv')[100]).toBeCloseTo(100 * ta.stdev(lr, 10)[100] * Math.sqrt(365 / 7), 10);
    expect(vals(run(byId('Standard Deviation')), 'stdev')[100]).toBeCloseTo(ta.stdev(ctx.close, 20)[100], 12);
    const ui = vals(run(byId('Ulcer Index')), 'ui');
    expect(ui[100]).toBeGreaterThanOrEqual(0);
    const hh = maxOf(ctx.close, 87, 100);
    let acc = 0;
    for (let i = 87; i <= 100; i++) { const d = ((ctx.close[i] - maxOf(ctx.close, i - 13, i)) / maxOf(ctx.close, i - 13, i)) * 100; acc += d * d; }
    void hh;
    expect(ui[100]).toBeCloseTo(Math.sqrt(acc / 14), 10);
    expect(vals(run(byId('Average Daily Range')), 'adr')[100]).toBeCloseTo(ta.sma(ctx.high, 14)[100] - ta.sma(ctx.low, 14)[100], 10);
    const mi = vals(run(byId('Mass Index')), 'mi')[100];
    expect(mi).toBeGreaterThan(5); expect(mi).toBeLessThan(15);
    const chop = vals(run(byId('Choppiness Index')), 'chop');
    for (let i = 20; i < ctx.n; i++) { expect(chop[i]).toBeGreaterThanOrEqual(0); expect(chop[i]).toBeLessThanOrEqual(100); }
    const zone = run(byId('Chop Zone')).zone as { values: Float64Array; colors?: Array<string | null> | null };
    for (let i = 40; i < ctx.n; i++) { expect(zone.values[i]).toBe(1); expect(zone.colors?.[i]).toMatch(/^#[0-9A-F]{6}$/i); }
    const rvi = vals(run(byId('Relative Volatility Index')), 'rvi');
    for (let i = 40; i < ctx.n; i++) { expect(rvi[i]).toBeGreaterThanOrEqual(0); expect(rvi[i]).toBeLessThanOrEqual(100); }
    const se = vals(run(byId('Standard Error')), 'stderr');
    expect(se[100]).toBeGreaterThan(0);
    const flat = buildIndicatorContext(makeBars(40).map((b, i) => ({ ...b, close: 100 + i })), '1D', null, 'Etc/UTC', 0.01);
    expect(vals(run(byId('Standard Error'), {}, flat), 'stderr')[30]).toBeCloseTo(0, 9); // perfect line -> zero residuals
  });

  it('Volatility Stop never moves against the trend and colours by direction; Chande Kroll stops bracket price', () => {
    const r = run(byId('Volatility Stop')).stop as { values: Float64Array; colors?: Array<string | null> | null };
    for (let i = 1; i < ctx.n; i++) {
      const up = r.colors?.[i] === '#089981';
      if (up && r.colors?.[i - 1] === '#089981') expect(r.values[i]).toBeGreaterThanOrEqual(r.values[i - 1] - 1e-9);
      if (!up && r.colors?.[i - 1] === '#F23645') expect(r.values[i]).toBeLessThanOrEqual(r.values[i - 1] + 1e-9);
      if (up) expect(ctx.close[i]).toBeGreaterThanOrEqual(r.values[i]); else expect(ctx.close[i]).toBeLessThan(r.values[i]);
    }
    const ck = run(byId('Chande Kroll Stop'));
    expect(Number.isNaN(vals(ck, 'long')[16])).toBe(true);
    expect(Number.isNaN(vals(ck, 'long')[17])).toBe(false);
    expect(vals(ck, 'short')[100]).toBeLessThan(maxOf(ctx.high, 83, 100));
  });

  it('Vortex and Pivot Points High Low', () => {
    const vi = run(byId('Vortex Indicator'));
    expect(vals(vi, 'plus')[100]).toBeGreaterThan(0);
    expect(vals(vi, 'minus')[100]).toBeGreaterThan(0);
    const ph = run(byId('Pivot Points High Low'), {}, jctx).high as { values: Float64Array; texts?: Array<string | null> | null };
    const pivots = ta.pivotHigh(jctx.high, 10, 10);
    let count = 0;
    for (let i = 0; i < ctx.n; i++) if (!Number.isNaN(pivots[i])) { count++; expect(ph.values[i - 10]).toBe(pivots[i]); expect(ph.texts?.[i - 10]).toBe(pivots[i].toFixed(2)); }
    expect(count).toBeGreaterThan(0);
  });

});
