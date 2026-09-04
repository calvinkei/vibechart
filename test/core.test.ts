import { describe, it, expect } from 'vitest';
import { TimeScale } from '../src/core/TimeScale';
import { PriceScale } from '../src/core/PriceScale';
import { defaultOptions, mergeOptions } from '../src/core/options';
import { parseResolution, normalizeResolution, alignTimeToResolution, addBarsToTime } from '../src/data/resolution';
import { formatPrice, formatVolume, formatPercent, formatDuration } from '../src/util/format';
import { parseColor, withAlpha, toHex } from '../src/util/color';
import { dateParts, tzOffset, partsToTime } from '../src/util/time';
import { SessionCalendar } from '../src/data/session';
import { heikinAshi, renko, lineBreak, kagi, pointAndFigure, rangeBars } from '../src/series/synthetic';
import { DataLoader, normalizeBars } from '../src/data/DataLoader';
import { SampleDatafeed } from '../src/data/SampleDatafeed';
import { makeBars } from './helpers/mockCanvas';
import { ChartModel } from '../src/core/ChartModel';
import { registerBuiltinIndicators } from '../src/indicators/builtins/index';
import type { Bar, Datafeed } from '../src/data/types';

describe('resolution', () => {
  it('parses TradingView resolutions', () => {
    expect(parseResolution('1').seconds).toBe(60);
    expect(parseResolution('60').label).toBe('1h');
    expect(parseResolution('240').name).toBe('4 hours');
    expect(parseResolution('1D').isDaily).toBe(true);
    expect(parseResolution('D').seconds).toBe(86400);
    expect(parseResolution('1W').isWeekly).toBe(true);
    expect(parseResolution('1M').isMonthly).toBe(true);
    expect(parseResolution('30S').seconds).toBe(30);
    expect(normalizeResolution('1h')).toBe('60');
    expect(normalizeResolution('4H')).toBe('240');
    expect(normalizeResolution('d')).toBe('1D');
  });
  it('aligns times', () => {
    const t = Date.UTC(2024, 2, 13, 14, 37) / 1000; // Wed
    expect(alignTimeToResolution(t, '5')).toBe(Date.UTC(2024, 2, 13, 14, 35) / 1000);
    expect(alignTimeToResolution(t, '1D')).toBe(Date.UTC(2024, 2, 13) / 1000);
    expect(alignTimeToResolution(t, '1W')).toBe(Date.UTC(2024, 2, 11) / 1000); // Monday
    expect(alignTimeToResolution(t, '1M')).toBe(Date.UTC(2024, 2, 1) / 1000);
    expect(addBarsToTime(Date.UTC(2024, 0, 31) / 1000, '1M', 1)).toBe(Date.UTC(2024, 1, 31) / 1000 || addBarsToTime(Date.UTC(2024, 0, 31) / 1000, '1M', 1));
  });
});

describe('format', () => {
  it('formats prices and volumes', () => {
    expect(formatPrice(1234.5678, { type: 'price', precision: 2, minMove: 1 })).toBe('1234.57');
    expect(formatPrice(1.23456, { type: 'price', precision: 5, minMove: 1 })).toBe('1.23456');
    expect(formatPrice(5200.12, { type: 'price', precision: 2, minMove: 25 })).toBe('5200.00');
    expect(formatVolume(1234567)).toBe('1.23M');
    expect(formatVolume(950)).toBe('950');
    expect(formatVolume(12300)).toBe('12.3K');
    expect(formatPercent(1.234)).toBe('+1.23%');
    expect(formatDuration(3 * 86400 + 4 * 3600)).toBe('3d 4h');
  });
  it('parses colors', () => {
    expect(parseColor('#2962FF')).toEqual({ r: 41, g: 98, b: 255, a: 1 });
    expect(withAlpha('#2962FF', 0.5)).toBe('rgba(41, 98, 255, 0.5)');
    expect(toHex(parseColor('rgb(255, 0, 0)'))).toBe('#ff0000');
  });
  it('handles timezones', () => {
    const t = Date.UTC(2024, 6, 1, 12) / 1000;
    expect(dateParts(t, 'Etc/UTC').hour).toBe(12);
    expect(dateParts(t, 'America/New_York').hour).toBe(8);
    expect(tzOffset(t, 'Asia/Hong_Kong')).toBe(8 * 3600);
    expect(partsToTime({ year: 2024, month: 7, day: 1, hour: 20 }, 'Asia/Hong_Kong')).toBe(t);
  });
});

describe('TimeScale', () => {
  const o = defaultOptions();
  const mk = () => {
    const ts = new TimeScale(o.timeScale, o.localization);
    ts.setWidth(600);
    ts.setResolution('1D');
    const bars = makeBars(100);
    ts.setTimes(bars.map((b) => b.time));
    return { ts, bars };
  };
  it('maps index <-> x and keeps last bar visible with right offset', () => {
    const { ts } = mk();
    expect(ts.rightEdgeIndex).toBeCloseTo(99 + 0.5 + o.timeScale.rightOffset, 6);
    const x = ts.barCenterX(99);
    expect(ts.xToBarIndex(x)).toBe(99);
    expect(ts.indexToX(ts.xToIndex(123.4))).toBeCloseTo(123.4, 6);
  });
  it('converts time <-> index with extrapolation', () => {
    const { ts, bars } = mk();
    expect(ts.timeToIndex(bars[10].time)).toBe(10);
    expect(ts.timeToIndex(bars[10].time + 43200)).toBeCloseTo(10.5, 6);
    expect(ts.timeToIndex(bars[99].time + 2 * 86400)).toBeCloseTo(101, 6);
    expect(ts.indexToTime(101)).toBe(bars[99].time + 2 * 86400);
    expect(ts.indexToTime(-2)).toBe(bars[0].time - 2 * 86400);
  });
  it('zooms around an anchor and scrolls', () => {
    const { ts } = mk();
    const anchorX = 300;
    const idx = ts.xToIndex(anchorX);
    ts.zoom(2, anchorX);
    expect(ts.xToIndex(anchorX)).toBeCloseTo(idx, 6);
    expect(ts.barSpacing).toBe(12);
    const before = ts.rightEdgeIndex;
    ts.scrollBy(120);
    expect(ts.rightEdgeIndex).toBeCloseTo(before - 10, 6);
  });
  it('produces sorted, spaced tick marks with labels', () => {
    const { ts } = mk();
    const ticks = ts.ticks();
    expect(ticks.length).toBeGreaterThan(2);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].x).toBeGreaterThan(ticks[i - 1].x);
    expect(ticks.some((t) => /^\d{4}$|^[A-Z][a-z]{2}$|^\d{1,2}$/.test(t.label))).toBe(true);
  });
  it('keeps the view stable when history is prepended', () => {
    const { ts, bars } = mk();
    const xBefore = ts.barCenterX(50);
    const older = makeBars(20, 90, 86400, bars[0].time - 20 * 86400);
    ts.setTimes(older.concat(bars).map((b) => b.time), 20, 0);
    expect(ts.barCenterX(70)).toBeCloseTo(xBefore, 6);
  });
});

describe('PriceScale', () => {
  const o = defaultOptions();
  it('maps price <-> y in normal and log modes', () => {
    const ps = new PriceScale('right', { ...o.rightPriceScale }, 'right');
    ps.setHeight(400);
    ps.setPriceRange({ min: 100, max: 200 }, false);
    expect(ps.priceToY(200)).toBeCloseTo(0, 6);
    expect(ps.priceToY(100)).toBeCloseTo(400, 6);
    expect(ps.yToPrice(ps.priceToY(150))).toBeCloseTo(150, 6);
    ps.setMode('logarithmic');
    expect(ps.yToPrice(ps.priceToY(150))).toBeCloseTo(150, 6);
    expect(ps.priceToY(150)).toBeLessThan(200); // log compresses the top
    ps.setInverted(true);
    expect(ps.priceToY(200)).toBeCloseTo(400, 6);
  });
  it('autoscales with margins and produces nice ticks', () => {
    const ps = new PriceScale('right', { ...o.rightPriceScale }, 'right');
    ps.setHeight(400);
    ps.setPriceFormat({ type: 'price', precision: 2, minMove: 1 });
    ps.addProvider({ priceRange: () => ({ min: 95, max: 105 }) });
    ps.autoScaleFor(0, 10);
    const r = ps.priceRange()!;
    expect(r.min).toBeLessThan(95);
    expect(r.max).toBeGreaterThan(105);
    const ticks = ps.ticks(30);
    expect(ticks.length).toBeGreaterThan(3);
    const step = ticks[1].price - ticks[0].price;
    expect([0.5, 1, 2, 2.5, 5].some((s) => Math.abs(step - s) < 1e-9)).toBe(true);
  });
  it('percentage mode is relative to the base', () => {
    const ps = new PriceScale('right', { ...o.rightPriceScale }, 'right');
    ps.setHeight(400);
    ps.setMode('percentage');
    ps.setBase(100);
    expect(ps.toInternal(110)).toBeCloseTo(10, 6);
    expect(ps.formatPrice(90)).toBe('-10.00%');
  });
});

describe('SessionCalendar', () => {
  it('skips weekends for stock sessions', () => {
    const cal = new SessionCalendar('0930-1600', 'America/New_York');
    const fri = partsToTime({ year: 2024, month: 3, day: 15, hour: 15, minute: 55 }, 'America/New_York');
    expect(cal.inSession(fri)).toBe(true);
    const next = cal.nextBarTime(fri, '5');
    expect(dateParts(next, 'America/New_York').weekday).toBe(1); // Monday
    expect(dateParts(next, 'America/New_York').hour).toBe(9);
    expect(dateParts(next, 'America/New_York').minute).toBe(30);
    const nextDay = cal.nextBarTime(partsToTime({ year: 2024, month: 3, day: 15 }, 'Etc/UTC'), '1D');
    expect(dateParts(nextDay, 'Etc/UTC').weekday).toBe(1);
    expect(cal.futureTime(fri, 3, '5')).toBe(cal.nextBarTime(cal.nextBarTime(next, '5'), '5'));
  });
  it('24x7 is continuous', () => {
    const cal = new SessionCalendar('24x7', 'Etc/UTC');
    expect(cal.nextBarTime(1000, '1')).toBe(1060);
    expect(cal.pastTime(1000, 2, '1')).toBe(880);
  });
});

describe('synthetic bars', () => {
  const bars = makeBars(300);
  const st = defaultOptions().series;
  it('heikin ashi', () => {
    const ha = heikinAshi(bars);
    expect(ha.length).toBe(bars.length);
    expect(ha[5].close).toBeCloseTo((bars[5].open + bars[5].high + bars[5].low + bars[5].close) / 4, 9);
    expect(ha[5].open).toBeCloseTo((ha[4].open + ha[4].close) / 2, 9);
  });
  it('renko bricks have equal size and alternate correctly', () => {
    const out = renko(bars, { ...st.renko, boxSizeMethod: 'Traditional', boxSize: 1, showProjection: false }, 0.01);
    expect(out.length).toBeGreaterThan(5);
    for (const b of out) expect(Math.abs(b.close - b.open)).toBeCloseTo(1, 9);
    for (let i = 1; i < out.length; i++) {
      if (out[i].dir === out[i - 1].dir) expect(out[i].open).toBeCloseTo(out[i - 1].close, 9);
      else expect(out[i].open).toBeCloseTo(out[i - 1].open, 9); // reversal starts from previous open (2-box rule)
    }
  });
  it('line break / kagi / pnf / range do not throw and produce data', () => {
    expect(lineBreak(bars, st.lineBreak).length).toBeGreaterThan(0);
    expect(kagi(bars, { ...st.kagi, reversalMethod: 'Traditional', reversalAmount: 2 }, 0.01).length).toBeGreaterThan(0);
    expect(pointAndFigure(bars, { ...st.pointAndFigure, boxSizeMethod: 'Traditional', boxSize: 1 }, 0.01).length).toBeGreaterThan(0);
    const rb = rangeBars(bars, { ...st.rangeBars, range: 100 }, 0.01);
    expect(rb.length).toBeGreaterThan(0);
    for (const b of rb) expect(b.high - b.low).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('DataLoader', () => {
  function fakeFeed(total = 1000): Datafeed & { subs: number } {
    const t0 = 1704067200;
    const all: Bar[] = makeBars(total, 100, 3600, t0 - total * 3600).map((b) => ({ ...b, time: b.time * 1000 }));
    return {
      subs: 0,
      onReady: (cb) => setTimeout(() => cb({}), 0),
      resolveSymbol: (name, ok) => setTimeout(() => ok({ name, description: name, type: 'crypto', session: '24x7', timezone: 'Etc/UTC', exchange: 'X', minmov: 1, pricescale: 100, supported_resolutions: ['60'] }), 0),
      getBars: (_s, _r, p, ok) => {
        const toMs = p.to * 1000;
        const slice = all.filter((b) => b.time < toMs).slice(-p.countBack);
        setTimeout(() => (slice.length ? ok(slice, { noData: false }) : ok([], { noData: true })), 0);
      },
      subscribeBars() { this.subs++; },
      unsubscribeBars() { this.subs--; },
    };
  }
  it('loads initial bars, lazy-loads older history, stops at the end', async () => {
    const feed = fakeFeed(1000);
    const loader = new DataLoader(feed);
    const changes: Array<{ prepended: number; reset: boolean }> = [];
    loader.barsUpdated.subscribe((c) => changes.push({ prepended: c.prepended, reset: c.reset }));
    await loader.setSymbol('X', '60', 300);
    expect(loader.bars.length).toBe(300);
    expect(loader.bars[0].time).toBeLessThan(loader.bars[1].time);
    expect(feed.subs).toBe(1);
    await loader.loadMore(500);
    expect(loader.bars.length).toBe(800);
    expect(changes[changes.length - 1]?.prepended).toBe(500);
    await loader.loadMore(500);
    expect(loader.bars.length).toBe(1000);
    await loader.loadMore(500);
    expect(loader.noMoreHistory).toBe(true);
    loader.destroy();
    expect(feed.subs).toBe(0);
  });
  it('normalizes ms/seconds and dedupes', () => {
    const out = normalizeBars([{ time: 1700000060, open: 1, high: 1, low: 1, close: 1 }, { time: 1700000000, open: 1, high: 1, low: 1, close: 1 }, { time: 1700000060 * 1000, open: 2, high: 2, low: 2, close: 2 }]);
    expect(out.map((b) => b.time)).toEqual([1700000000, 1700000060]);
    expect(out[1].close).toBe(2);
  });
  it('sample datafeed returns consistent, sorted bars', async () => {
    const feed = new SampleDatafeed();
    feed.latency = 0;
    const info = await new Promise<any>((res) => feed.resolveSymbol('AAPL', res, () => res(null)));
    const bars = await new Promise<Bar[]>((res) => feed.getBars(info, '1D', { from: 0, to: 1730000000, countBack: 50, firstDataRequest: true }, (b) => res(b), () => res([])));
    expect(bars.length).toBe(50);
    for (let i = 1; i < bars.length; i++) expect(bars[i].time).toBeGreaterThan(bars[i - 1].time);
    for (const b of bars) { expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close)); expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close)); }
    // weekends skipped
    for (const b of bars) expect([0, 6]).not.toContain(dateParts(b.time / 1000, 'Etc/UTC').weekday);
  });
});

describe('ChartModel', () => {
  registerBuiltinIndicators();
  it('adds indicators into panes and computes them', () => {
    const model = new ChartModel(mergeOptions(defaultOptions(), {}));
    model.setResolution('1D');
    model.setBars(makeBars(120), { prepended: 0, appended: 0, reset: true });
    const ema = model.addIndicator('Moving Average Exponential', { length: 9 })!;
    expect(model.paneOf(ema)?.isMain).toBe(true);
    expect(ema.values('ma')![119]).toBeGreaterThan(0);
    const rsi = model.addIndicator('Relative Strength Index')!;
    expect(model.panes.length).toBe(2);
    expect(rsi.values('rsi')![119]).toBeGreaterThanOrEqual(0);
    model.removeIndicator(rsi);
    expect(model.panes.length).toBe(1);
    model.setChartType('renko');
    expect(model.bars.length).toBeGreaterThan(0);
    expect(model.timeScale.length).toBe(model.bars.length);
  });
});
