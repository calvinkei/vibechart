import { describe, it, expect } from 'vitest';
import { makeBars, mockCtx } from './helpers/mockCanvas';
import { buildIndicatorContext, inputDefaults, IndicatorInstance, type IndicatorDefinition } from '../src/indicators/Indicator';
import type { RenderContext } from '../src/series/Series';
import { TimeScale } from '../src/core/TimeScale';
import { PriceScale } from '../src/core/PriceScale';
import { defaultOptions } from '../src/core/options';
import { MainSeries } from '../src/series/MainSeries';
import type { Bar } from '../src/data/types';
import { volumeIndicators, calendarKeys, parseResolution } from '../src/indicators/builtins/volume';
import { volumeProfileIndicators, computeVolumeProfile, valueArea } from '../src/indicators/builtins/volumeProfile';
import { candlestickPatternsIndicators } from '../src/indicators/builtins/candlestickPatterns';
import { miscIndicators } from '../src/indicators/builtins/misc';
import { breadthIndicators } from '../src/indicators/builtins/breadth';

const ALL: IndicatorDefinition[] = [...volumeIndicators, ...volumeProfileIndicators, ...candlestickPatternsIndicators, ...miscIndicators, ...breadthIndicators];

function ctxFor(bars: Bar[], res = '1D') {
  return buildIndicatorContext(bars, res, null, 'Etc/UTC', 0.01);
}

function bar(time: number, o: number, h: number, l: number, c: number, v = 1000): Bar {
  return { time, open: o, high: h, low: l, close: c, volume: v };
}

/** Full RenderContext over synthetic bars; the instance is registered on the price scale so pane studies get a range. */
function makeRc(bars: Bar[], inst: IndicatorInstance, res = '1D', width = 800, height = 400, visible?: { from: number; to: number }) {
  const options = defaultOptions('light');
  const ts = new TimeScale(options.timeScale, options.localization);
  ts.setWidth(width);
  ts.setResolution(res);
  ts.setTimes(bars.map((b) => b.time));
  ts.fitContent();
  const ps = new PriceScale('right', options.rightPriceScale, 'right');
  ps.setHeight(height);
  const main = new MainSeries(options);
  main.setData(bars);
  if (inst.def.overlay) ps.addProvider(main);
  ps.addProvider(inst);
  ps.autoScaleFor(0, bars.length - 1);
  if (ps.isEmpty) ps.setPriceRange({ min: 0, max: 1 }, false);
  const rc: RenderContext = {
    ctx: mockCtx(), timeScale: ts, priceScale: ps, width, height, dpr: 1,
    visible: visible ?? { from: 0, to: bars.length - 1 }, options, font: '12px sans-serif', crosshairIndex: null,
  };
  (rc as any).mainBars = bars;
  return rc;
}

describe('volume / profile / pattern / misc definitions', () => {
  const bars = makeBars(300);
  const ctx = ctxFor(bars);

  it('has unique ids', () => {
    const ids = ALL.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const def of ALL) {
    it(`${def.id}: compute with defaults, short data and empty data`, () => {
      const res = def.compute(ctx, inputDefaults(def));
      for (const p of def.plots) {
        const out = res[p.id];
        if (!out) continue;
        const vals = out instanceof Float64Array ? out : out.values;
        expect(vals.length).toBe(ctx.n);
      }
      expect(() => def.compute(ctxFor(makeBars(5)), inputDefaults(def))).not.toThrow();
      expect(() => def.compute(ctxFor([]), inputDefaults(def))).not.toThrow();
    });

    it(`${def.id}: IndicatorInstance.render + customRender do not throw`, () => {
      const inst = new IndicatorInstance(def);
      inst.compute(ctx);
      expect(inst.error).toBeNull();
      const rc = makeRc(bars, inst);
      expect(() => inst.render(rc)).not.toThrow();
      // empty visible range
      const rcEmpty = makeRc(bars, inst, '1D', 800, 400, { from: 10, to: 5 });
      expect(() => inst.render(rcEmpty)).not.toThrow();
      if (def.customRender) {
        expect(() => def.customRender!(rc, inst)).not.toThrow();
        expect(() => def.customRender!(rcEmpty, inst)).not.toThrow();
      }
    });
  }
});

describe('hand-verified values', () => {
  it('OBV', () => {
    const closes = [10, 11, 10.5, 10.5, 12], vols = [100, 200, 300, 400, 500];
    const bars = closes.map((c, i) => bar(1704067200 + i * 86400, c, c + 1, c - 1, c, vols[i]));
    const def = ALL.find((d) => d.id === 'On Balance Volume')!;
    const res = def.compute(ctxFor(bars), inputDefaults(def));
    expect(Array.from((res.obv as Float64Array))).toEqual([0, 200, -100, -100, 400]);
  });

  it('Accumulation/Distribution', () => {
    const bars = [bar(1, 9, 10, 8, 9, 100), bar(2, 10, 12, 10, 12, 200), bar(3, 8, 10, 6, 7, 100)];
    const def = ALL.find((d) => d.id === 'Accumulation/Distribution')!;
    const ad = def.compute(ctxFor(bars), inputDefaults(def)).ad as Float64Array;
    expect(ad[0]).toBeCloseTo(0);
    expect(ad[1]).toBeCloseTo(200);
    expect(ad[2]).toBeCloseTo(150);
  });

  it('Net Volume and 24-hour Volume on daily bars', () => {
    const bars = makeBars(10);
    const nv = ALL.find((d) => d.id === 'Net Volume')!;
    const r = nv.compute(ctxFor(bars), inputDefaults(nv)).nv as Float64Array;
    for (let i = 1; i < bars.length; i++) {
      const d = bars[i].close - bars[i - 1].close;
      expect(r[i]).toBe(d > 0 ? bars[i].volume! : d < 0 ? -bars[i].volume! : 0);
    }
    const v24 = ALL.find((d) => d.id === '24-hour Volume')!;
    const s = v24.compute(ctxFor(bars), inputDefaults(v24)).vol as Float64Array;
    for (let i = 0; i < bars.length; i++) expect(s[i]).toBeCloseTo(bars[i].volume! * bars[i].close);
  });

  it('VWAP resets at each session (UTC day) and hides on D/W/M when asked', () => {
    // hourly bars over two days
    const bars: Bar[] = [];
    for (let i = 0; i < 48; i++) bars.push(bar(1704067200 + i * 3600, 100 + i, 101 + i, 99 + i, 100.5 + i, 100 + i));
    const def = ALL.find((d) => d.id === 'Volume Weighted Average Price')!;
    const ctx = ctxFor(bars, '60');
    const res = def.compute(ctx, inputDefaults(def));
    const vwap = res.vwap as Float64Array;
    const hlc3 = (i: number) => (bars[i].high + bars[i].low + bars[i].close) / 3;
    expect(vwap[0]).toBeCloseTo(hlc3(0));
    expect(vwap[24]).toBeCloseTo(hlc3(24)); // first bar of day 2 → reset
    const w = (hlc3(24) * 124 + hlc3(25) * 125) / (124 + 125);
    expect(vwap[25]).toBeCloseTo(w);
    expect(vwap[23]).not.toBeCloseTo(hlc3(23));
    const upper1 = res.upper1 as Float64Array, lower1 = res.lower1 as Float64Array;
    expect(upper1[25]).toBeGreaterThanOrEqual(vwap[25]);
    expect(lower1[25]).toBeLessThanOrEqual(vwap[25]);
    expect(Number.isNaN((res.upper2 as Float64Array)[25])).toBe(true); // band 2 hidden by default
    const hidden = def.compute(ctxFor(makeBars(20)), { ...inputDefaults(def), hideOnDWM: true });
    expect(Array.from(hidden.vwap as Float64Array).every((v) => Number.isNaN(v))).toBe(true);
    // Week anchor: keys constant inside a Monday..Sunday week
    const keys = calendarKeys(Float64Array.from(bars, (b) => b.time), 'Etc/UTC', 'Week');
    expect(keys[0]).toBe(keys[47]);
    expect(parseResolution('1D').isDWM).toBe(true);
    expect(parseResolution('15').intraday).toBe(true);
  });

  it('Rolling VWAP widens to Minimum Bars', () => {
    const bars = makeBars(30);
    const def = ALL.find((d) => d.id === 'Rolling VWAP')!;
    const res = def.compute(ctxFor(bars), { ...inputDefaults(def), useAuto: false, days: 1, hours: 0, minutes: 0, minBars: 3 });
    const vwap = res.vwap as Float64Array;
    const hlc3 = (i: number) => (bars[i].high + bars[i].low + bars[i].close) / 3;
    let pv = 0, vv = 0;
    for (let i = 7; i <= 9; i++) { pv += hlc3(i) * bars[i].volume!; vv += bars[i].volume!; }
    expect(vwap[9]).toBeCloseTo(pv / vv);
  });

  it('Relative Volume at Time is 1 for identical days', () => {
    const bars: Bar[] = [];
    for (let d = 0; d < 6; d++) for (let h = 0; h < 8; h++) bars.push(bar(1704067200 + d * 86400 + h * 3600, 100, 101, 99, 100.5, 500 + h * 10));
    const def = ALL.find((d) => d.id === 'Relative Volume at Time')!;
    const res = def.compute(ctxFor(bars, '60'), inputDefaults(def)).rvol as any;
    for (let i = 8; i < bars.length; i++) expect(res.values[i]).toBeCloseTo(1);
    expect(Number.isNaN(res.values[0])).toBe(true);
  });

  it('Cumulative Volume Delta resets per anchor day', () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 48; i++) bars.push(bar(1704067200 + i * 3600, 100, 101, 99, i % 2 ? 101 : 99, 100));
    const def = ALL.find((d) => d.id === 'Cumulative Volume Delta')!;
    const res = def.compute(ctxFor(bars, '60'), inputDefaults(def));
    const open = res.open as Float64Array, close = (res.close as any).values as Float64Array;
    expect(open[0]).toBe(0);
    expect(close[0]).toBe(-100);
    expect(open[1]).toBe(-100);
    expect(open[24]).toBe(0); // new day
  });
});

describe('volume profile engine', () => {
  const bars = makeBars(120);
  it('row totals equal the total volume; POC inside the value area', () => {
    const p = computeVolumeProfile(bars, 0, bars.length - 1, { rowsLayout: 'Number of Rows', rowSize: 24, valueAreaPct: 70, minTick: 0.01 })!;
    expect(p).not.toBeNull();
    let total = 0;
    for (const b of bars) total += b.volume!;
    let rows = 0;
    for (const r of p.rows) rows += r.total;
    expect(rows).toBeCloseTo(total, 6);
    expect(p.total).toBeCloseTo(total, 6);
    expect(p.rows.length).toBeGreaterThanOrEqual(20);
    expect(p.rows.length).toBeLessThanOrEqual(30);
    expect(p.vaLow).toBeLessThanOrEqual(p.poc);
    expect(p.vaHigh).toBeGreaterThanOrEqual(p.poc);
    let va = 0;
    for (let r = p.vaLow; r <= p.vaHigh; r++) va += p.rows[r].total;
    expect(va).toBeLessThanOrEqual(total * 0.7 + 1e-6);
    // up + down == total per row
    for (const r of p.rows) expect(r.up + r.down).toBeCloseTo(r.total, 6);
  });
  it('ticks-per-row layout and degenerate ranges', () => {
    const p = computeVolumeProfile(bars, 0, bars.length - 1, { rowsLayout: 'Ticks Per Row', rowSize: 50, valueAreaPct: 70, minTick: 0.01 })!;
    expect(p.rows.length).toBeGreaterThan(1);
    expect(computeVolumeProfile(bars, 10, 5, { rowsLayout: 'Number of Rows', rowSize: 24, valueAreaPct: 70, minTick: 0.01 })).toBeNull();
    const flat = [bar(1, 10, 10, 10, 10, 100), bar(2, 10, 10, 10, 10, 50)];
    const f = computeVolumeProfile(flat, 0, 1, { rowsLayout: 'Number of Rows', rowSize: 24, valueAreaPct: 70, minTick: 0.01 })!;
    expect(f.total).toBe(150);
  });
  it('value area picks the larger neighbour first', () => {
    const rows = [1, 2, 10, 3, 1].map((t) => ({ lo: 0, hi: 1, up: t, down: 0, total: t }));
    // total 17: at 70 % (target 11.9) adding the larger neighbour (3) would exceed the target → POC only
    expect(valueArea(rows, 2, 70)).toEqual([2, 2]);
    // at 80 % (target 13.6): +3 above → 13, then the next candidate (2 below) would exceed → stop
    expect(valueArea(rows, 2, 80)).toEqual([2, 3]);
    expect(valueArea(rows, 2, 100)).toEqual([0, 4]);
  });
});

describe('candlestick patterns', () => {
  it('detects a bullish engulfing and a doji', () => {
    const bars: Bar[] = [];
    let t = 1704067200;
    for (let i = 0; i < 16; i++) { const o = 100 + (i % 2) * 0.5, c = 100.5 - (i % 2) * 0.5; bars.push(bar(t, o, Math.max(o, c) + 0.2, Math.min(o, c) - 0.2, c)); t += 86400; }
    bars.push(bar(t, 100.4, 100.6, 99.9, 100.0)); t += 86400; // small black
    bars.push(bar(t, 99.9, 101.2, 99.8, 101.0)); t += 86400; // long white engulfing
    bars.push(bar(t, 100.5, 100.8, 100.2, 100.5)); // doji with equal shadows
    const ctx = ctxFor(bars);
    const eng = ALL.find((d) => d.id === 'Bullish Engulfing')!;
    const r = eng.compute(ctx, { trendRule: 'No detection' }) as any;
    expect(r.engulfingBull.values[17]).toBe(1);
    expect(r.engulfingBull.texts[17]).toBe('Engulfing');
    const doji = ALL.find((d) => d.id === 'Doji')!;
    expect((doji.compute(ctx, { trendRule: 'No detection' }) as any).doji.values[18]).toBe(1);
    const all = ALL.find((d) => d.id === 'All Candlestick Patterns')!;
    const a = all.compute(ctx, { ...inputDefaults(all), trendRule: 'No detection' }) as any;
    expect(a.bullish.texts[17]).toContain('Engulfing');
    expect(a.neutral.texts[18]).toContain('Doji');
    const bearOnly = all.compute(ctx, { ...inputDefaults(all), trendRule: 'No detection', patternType: 'Bearish' }) as any;
    expect(Number.isNaN(bearOnly.bullish.values[17])).toBe(true);
    // with SMA50 trend detection and fewer than 50 bars nothing fires
    const r2 = eng.compute(ctx, { trendRule: 'SMA50' }) as any;
    expect(Number.isNaN(r2.engulfingBull.values[17])).toBe(true);
  });
});

describe('misc', () => {
  it('Technical Ratings stay within [-1, 1]', () => {
    const def = ALL.find((d) => d.id === 'Technical Ratings')!;
    const r = def.compute(ctxFor(makeBars(400)), inputDefaults(def)).rating as any;
    let seen = 0;
    for (const v of r.values) if (!Number.isNaN(v)) { seen++; expect(v).toBeGreaterThanOrEqual(-1); expect(v).toBeLessThanOrEqual(1); }
    expect(seen).toBeGreaterThan(100);
  });
  it('Gaps detects an up gap and closes it when price re-enters', () => {
    const bars: Bar[] = [];
    let t = 1704067200;
    for (let i = 0; i < 20; i++) { bars.push(bar(t, 100, 101, 99, 100.5)); t += 86400; }
    bars.push(bar(t, 105, 106, 104, 105.5)); t += 86400; // gap up: low 104 > prev high 101
    bars.push(bar(t, 105, 106, 104.5, 105)); t += 86400;
    bars.push(bar(t, 104, 104.5, 100.5, 101)); t += 86400; // re-enters the box → closes
    const def = ALL.find((d) => d.id === 'Gaps')!;
    const r = def.compute(ctxFor(bars), inputDefaults(def));
    const top = r.gapTop as Float64Array, end = r.gapEnd as Float64Array;
    expect(top[20]).toBe(104);
    expect((r.gapBottom as Float64Array)[20]).toBe(101);
    expect(end[20]).toBe(22);
  });
  it('Performance computes period returns at the last bar', () => {
    const def = ALL.find((d) => d.id === 'Performance')!;
    const bars = makeBars(800);
    const r = def.compute(ctxFor(bars), inputDefaults(def)).table as any;
    expect(r.texts).toEqual(['1W', '1M', '3M', '6M', 'YTD', '1Y', '5Y']);
    const last = bars[bars.length - 1].close, weekAgo = bars[bars.length - 8].close;
    expect(r.values[0]).toBeCloseTo((100 * (last - weekAgo)) / weekAgo);
    expect(Number.isNaN(r.values[6])).toBe(true); // 5Y not covered by 800 daily bars
  });
  it('Median / Majority Rule basic sanity', () => {
    const bars = makeBars(60);
    const ctx = ctxFor(bars);
    const med = ALL.find((d) => d.id === 'Median')!;
    const m = med.compute(ctx, inputDefaults(med));
    expect((m.upper as Float64Array)[59]).toBeGreaterThan((m.lower as Float64Array)[59]);
    const mr = ALL.find((d) => d.id === 'Majority Rule')!;
    const v = (mr.compute(ctx, inputDefaults(mr)).mr as Float64Array)[59];
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });
});
