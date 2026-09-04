import { describe, it, expect } from 'vitest';
import { makeDrawingContext, makeBars } from './helpers/mockCanvas';
import { registerDrawingTool, getDrawingTool } from '../src/drawings/Drawing';
import { allBuiltinDrawings } from '../src/drawings/tools/index';
import {
  predictionTools, LongPosition, ShortPosition, Forecast, BarsPattern, GhostFeed, Projection, PriceRange, DateRange, DateAndPriceRange, AnchoredVWAP,
  computeVWAP, rangeStats, volumeBetween, tickSize,
} from '../src/drawings/tools/prediction';
import { measureTools, Measure } from '../src/drawings/tools/measure';
import { volumeProfileTools, FixedRangeVolumeProfile, AnchoredVolumeProfile, computeVolumeProfile } from '../src/drawings/tools/volumeProfile';

for (const c of allBuiltinDrawings()) registerDrawingTool(c);

const rc = makeDrawingContext();
const bars = rc.mainSeries.bars;
const T = (i: number) => bars[i].time;

describe('registration', () => {
  it('exports the expected tools with ids, names, points and icons', () => {
    expect(predictionTools.map((c) => c.toolId)).toEqual(['long_position', 'short_position', 'forecast', 'bars_pattern', 'ghost_feed', 'projection', 'price_range', 'date_range', 'date_and_price_range', 'anchored_vwap']);
    expect(measureTools.map((c) => c.toolId)).toEqual(['measure']);
    expect(volumeProfileTools.map((c) => c.toolId)).toEqual(['fixed_range_volume_profile', 'anchored_volume_profile']);
    for (const c of [...predictionTools, ...measureTools, ...volumeProfileTools]) {
      expect(getDrawingTool(c.toolId)).toBe(c);
      expect(c.icon).toContain('<svg');
      expect(c.icon).toContain('currentColor');
      expect(c.toolName.length).toBeGreaterThan(0);
    }
    expect(LongPosition.pointsCount).toBe(1);
    expect(AnchoredVWAP.pointsCount).toBe(1);
    expect(AnchoredVolumeProfile.pointsCount).toBe(1);
    expect(Projection.pointsCount).toBe(3);
    expect(Measure.group).toBe('measure');
    for (const c of [...predictionTools, ...volumeProfileTools]) expect(c.group).toBe('prediction');
  });

  it('every style key has a property definition (except hidden data blobs)', () => {
    const hidden = new Set(['pattern']);
    for (const c of [...predictionTools, ...measureTools, ...volumeProfileTools]) {
      const d = new c();
      const keys = new Set(d.propertyDefs().filter((p) => p.type !== 'section').map((p) => p.key));
      for (const k of Object.keys(d.defaultStyle())) if (!hidden.has(k)) expect(keys.has(k), `${c.toolId}.${k}`).toBe(true);
    }
  });
});

describe('long / short position', () => {
  it('one click creates the entry and derives target, stop and width from the visible range', () => {
    const d = new LongPosition();
    expect(d.addPoint({ time: T(50), price: 100 })).toBe(true);
    d.render(rc);
    expect(d.points.length).toBe(3);
    expect(d.points[1].price).toBeGreaterThan(100);
    expect(d.points[2].price).toBeLessThan(100);
    expect(d.points[1].time).toBe(d.points[2].time);
    expect(d.points[1].time).toBeGreaterThan(T(50));
    // spec: profit = stop = (visible H − L) × 20 ticks
    const vb = rc.timeScale.visibleBars()!;
    let hi = -Infinity, lo = Infinity;
    for (let i = vb.from; i <= vb.to; i++) { hi = Math.max(hi, bars[i].high); lo = Math.min(lo, bars[i].low); }
    const dist = (hi - lo) * 20 * tickSize(rc);
    expect(d.points[1].price - 100).toBeCloseTo(dist, 6);
    expect(100 - d.points[2].price).toBeCloseTo(dist, 6);
    const s = new ShortPosition();
    s.addPoint({ time: T(50), price: 100 });
    s.render(rc);
    expect(s.points[1].price).toBeLessThan(100);
    expect(s.points[2].price).toBeGreaterThan(100);
  });

  it('computes qty, amounts and risk/reward per the TradingView formulas', () => {
    const d = new LongPosition({ accountSize: 1000, risk: 25 });
    d.points = [{ time: T(10), price: 100 }, { time: T(30), price: 120 }, { time: T(30), price: 90 }];
    const st = d.stats(rc);
    expect(st.riskSize).toBe(250);
    expect(st.riskPct).toBe(25);
    expect(st.qty).toBe(25);
    expect(st.profit).toBe(500);
    expect(st.loss).toBe(250);
    expect(st.rr).toBe(2);
    expect(st.targetPct).toBeCloseTo(20);
    expect(st.stopPct).toBeCloseTo(-10);
    expect(st.targetTicks).toBeCloseTo(2000);
    expect(st.stopTicks).toBeCloseTo(1000);
    // money risk mode + lot size
    const m = new LongPosition({ risk: 100, riskDisplayMode: 'money', lotSize: 10 });
    m.points = d.points.map((p) => ({ ...p }));
    const ms = m.stats(rc);
    expect(ms.riskSize).toBe(100);
    expect(ms.qty).toBe(1);
    expect(ms.profit).toBe(200);
    expect(ms.loss).toBe(100);
    // leverage caps the quantity
    const l = new LongPosition({ accountSize: 1000, risk: 25, leverage: 1 });
    l.points = d.points.map((p) => ({ ...p }));
    expect(l.stats(rc).qty).toBe(10);
    // short: RR = (entry − target) / (stop − entry)
    const s = new ShortPosition({ accountSize: 1000, risk: 25 });
    s.points = [{ time: T(10), price: 100 }, { time: T(30), price: 80 }, { time: T(30), price: 110 }];
    const ss = s.stats(rc);
    expect(ss.rr).toBe(2);
    expect(ss.qty).toBe(25);
    expect(ss.profit).toBe(500);
    expect(ss.loss).toBe(250);
  });

  it('shows open P&L only while the last close is inside the target/stop range', () => {
    const last = bars[bars.length - 1].close;
    const d = new LongPosition({ accountSize: 1000, risk: 25 });
    d.points = [{ time: T(150), price: last - 1 }, { time: T(170), price: last + 5 }, { time: T(170), price: last - 5 }];
    const st = d.stats(rc);
    expect(st.qty).toBe(62.5);
    expect(st.openPnl).toBeCloseTo(62.5);
    const s = new ShortPosition({ accountSize: 1000, risk: 25 });
    s.points = [{ time: T(150), price: last + 1 }, { time: T(170), price: last - 5 }, { time: T(170), price: last + 5 }];
    expect(s.stats(rc).openPnl).toBeCloseTo(62.5);
    const far = new LongPosition();
    far.points = [{ time: T(150), price: last * 3 }, { time: T(170), price: last * 3 + 5 }, { time: T(170), price: last * 3 - 5 }];
    expect(far.stats(rc).openPnl).toBeNull();
  });

  it('handles are constrained: target/stop change price only, width changes time only, entry moves all', () => {
    const d = new LongPosition();
    d.points = [{ time: T(10), price: 100 }, { time: T(30), price: 120 }, { time: T(30), price: 90 }];
    d.render(rc);
    expect(d.handles(rc).length).toBe(4);
    d.movePoint(1, { time: T(5), price: 130 });
    expect(d.points[1]).toEqual({ time: T(30), price: 130 });
    d.movePoint(1, { time: T(5), price: 50 }); // below entry → clamped to entry + 1 tick
    expect(d.points[1].price).toBeCloseTo(100.01);
    d.movePoint(2, { time: T(5), price: 150 }); // above entry → clamped to entry − 1 tick
    expect(d.points[2]).toEqual({ time: T(30), price: expect.closeTo(99.99) });
    d.movePoint(3, { time: T(60), price: 999 });
    expect(d.points[1].time).toBe(T(60));
    expect(d.points[2].time).toBe(T(60));
    expect(d.points[1].price).toBeCloseTo(100.01);
    d.movePoint(3, { time: T(5), price: 0 }); // left of entry → at least one bar to the right
    expect(d.points[1].time).toBe(T(11));
    d.movePoint(0, { time: T(20), price: 110 });
    expect(d.points[0]).toEqual({ time: T(20), price: 110 });
    expect(d.points[1].time).toBe(T(21));
    expect(d.points[1].price).toBeCloseTo(110.01);
    expect(d.points[2].price).toBeCloseTo(109.99);
    // short clamps the other way
    const s = new ShortPosition();
    s.points = [{ time: T(10), price: 100 }, { time: T(30), price: 80 }, { time: T(30), price: 110 }];
    s.render(rc);
    s.movePoint(1, { time: T(5), price: 150 });
    expect(s.points[1].price).toBeCloseTo(99.99);
    s.movePoint(2, { time: T(5), price: 10 });
    expect(s.points[2].price).toBeCloseTo(100.01);
  });

  it('hit-tests handles and the body at known pixels', () => {
    const d = new LongPosition();
    d.points = [{ time: T(10), price: 100 }, { time: T(30), price: 120 }, { time: T(30), price: 90 }];
    d.render(rc);
    const hs = d.handles(rc);
    expect(d.hitTest(hs[0].x, hs[0].y, rc)).toEqual({ type: 'point', index: 0 });
    expect(d.hitTest(hs[1].x, hs[1].y, rc)).toEqual({ type: 'point', index: 1 });
    expect(d.hitTest(hs[2].x, hs[2].y, rc)).toEqual({ type: 'point', index: 2 });
    expect(d.hitTest(hs[3].x, hs[3].y, rc)).toEqual({ type: 'point', index: 3 });
    const inside = rc.toPixel({ time: T(15), price: 110 });
    expect(d.hitTest(inside.x, inside.y, rc)).toEqual({ type: 'body' });
    const outside = rc.toPixel({ time: T(5), price: 100 });
    expect(d.hitTest(outside.x - 20, outside.y, rc)).toBeNull();
    const above = rc.toPixel({ time: T(15), price: 130 });
    expect(d.hitTest(above.x, above.y - 20, rc)).toBeNull();
  });

  it('serializes and restores all three points and inputs', () => {
    const d = new LongPosition({ accountSize: 5000 });
    d.addPoint({ time: T(50), price: 100 });
    d.render(rc);
    const s = d.serialize();
    expect(s.points.length).toBe(3);
    const copy = new LongPosition();
    copy.applySerialized(s);
    expect(copy.points).toEqual(d.points);
    expect(copy.style.accountSize).toBe(5000);
    expect(copy.stats(rc).rr).toBeCloseTo(1);
  });

  it('renders without stats when not selected and with stats when selected', () => {
    const d = new LongPosition();
    d.points = [{ time: T(10), price: 100 }, { time: T(30), price: 120 }, { time: T(30), price: 90 }];
    const quiet = makeDrawingContext();
    d.render(quiet);
    const textCalls = quiet.ctx.calls.filter((c) => c.startsWith('fillText'));
    expect(textCalls.some((c) => c.includes('Target'))).toBe(false);
    const sel = makeDrawingContext();
    sel.selected = true;
    d.render(sel);
    const selText = sel.ctx.calls.filter((c) => c.startsWith('fillText')).join('\n');
    expect(selText).toContain('Target: 120.00');
    expect(selText).toContain('Risk/Reward Ratio: 2.00');
    expect(selText).toContain('Stop: 90.00');
    expect(selText).toContain('Qty: 25');
  });
});

describe('forecast', () => {
  const hiIn = (a: number, b: number) => Math.max(...bars.slice(a, b + 1).map((x) => x.high));
  it('classifies success / failure / pending', () => {
    const ok = new Forecast();
    ok.points = [{ time: T(10), price: bars[10].low }, { time: T(30), price: hiIn(10, 30) }];
    expect(ok.state(rc)).toBe('success');
    const bad = new Forecast();
    bad.points = [{ time: T(10), price: bars[10].low }, { time: T(30), price: hiIn(10, 30) * 1.5 }];
    expect(bad.state(rc)).toBe('failure');
    const pending = new Forecast();
    pending.points = [{ time: T(10), price: 100 }, { time: bars[bars.length - 1].time + 5 * 86400, price: 100 }];
    expect(pending.state(rc)).toBe('pending');
    pending.creating = true;
    expect(pending.state(rc)).toBe('none');
    for (const d of [ok, bad, pending]) expect(() => d.render(rc)).not.toThrow();
  });
  it('hit-tests the line body', () => {
    const d = new Forecast();
    d.points = [{ time: T(10), price: 100 }, { time: T(30), price: 110 }];
    const a = rc.toPixel(d.points[0]), b = rc.toPixel(d.points[1]);
    expect(d.hitTest((a.x + b.x) / 2, (a.y + b.y) / 2, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(a.x, a.y, rc)).toEqual({ type: 'point', index: 0 });
    expect(d.hitTest((a.x + b.x) / 2, (a.y + b.y) / 2 + 40, rc)).toBeNull();
  });
});

describe('bars pattern', () => {
  it('captures the bars between the points once created and keeps them when moved', () => {
    const d = new BarsPattern();
    d.addPoint({ time: T(29), price: bars[29].close });
    d.addPoint({ time: T(20), price: bars[20].close });
    d.creating = true;
    d.render(rc);
    expect(d.style.pattern).toBeNull();
    d.creating = false;
    d.render(rc);
    const pat = d.style.pattern;
    expect(pat.bars.length).toBe(10);
    expect(pat.bars[0]).toEqual([bars[20].open, bars[20].high, bars[20].low, bars[20].close]);
    expect(d.points[0].time).toBe(T(20)); // normalised left → right
    expect(d.pattern(rc)!.anchorIdx).toBe(20);
    d.moveBy(50, 10, rc.timeScale);
    d.render(rc);
    expect(d.style.pattern.bars.length).toBe(10);
    expect(d.pattern(rc)!.anchorIdx).toBe(70);
    const hs = d.handles(rc);
    expect(hs[0].x).toBeCloseTo(rc.timeScale.barCenterX(70));
    expect(hs[1].x).toBeCloseTo(rc.timeScale.barCenterX(79));
    const mid = rc.toPixel({ time: T(75), price: bars[25].close + 10 });
    expect(d.hitTest(mid.x, mid.y, rc)).toEqual({ type: 'body' });
    d.movePoint(1, { time: T(80), price: d.points[1].price });
    expect(d.points[0].time).toBe(T(71));
    for (const mode of [0, 1, 2, 3, 4, 5, 6]) { d.style.mode = mode; expect(() => d.render(rc)).not.toThrow(); }
    d.style.mirrored = true; d.style.flipped = true;
    expect(() => d.render(rc)).not.toThrow();
    const copy = new BarsPattern();
    copy.applySerialized(d.serialize());
    expect(copy.style.pattern.bars).toEqual(pat.bars);
  });
});

describe('ghost feed', () => {
  it('generates one candle per bar along the path, ending exactly at each point', () => {
    const g = new GhostFeed();
    g.points = [{ time: T(10), price: 100 }, { time: T(20), price: 110 }, { time: T(25), price: 105 }];
    const c = g.candles(rc);
    expect(c.length).toBe(15);
    expect(c[0].open).toBe(100);
    expect(c[0].idx).toBe(11);
    expect(c[9].close).toBeCloseTo(110);
    expect(c[14].close).toBeCloseTo(105);
    for (let i = 1; i < c.length; i++) expect(c[i].open).toBe(c[i - 1].close);
    for (const k of c) { expect(k.high).toBeGreaterThanOrEqual(Math.max(k.open, k.close)); expect(k.low).toBeLessThanOrEqual(Math.min(k.open, k.close)); }
    expect(g.candles(rc)).toBe(c); // cached
    const twin = new GhostFeed({}, g.id);
    twin.points = g.points.map((p) => ({ ...p }));
    expect(twin.candles(rc).map((k) => k.close)).toEqual(c.map((k) => k.close)); // deterministic per id
    expect(() => g.render(rc)).not.toThrow();
    expect(g.hitTest(rc.timeScale.barCenterX(15), rc.priceScale.priceToY(c[4].close), rc)).toEqual({ type: 'body' });
  });
  it('stays open while creating and completes with two or more points', () => {
    const g = new GhostFeed();
    g.creating = true;
    expect(g.addPoint({ time: T(1), price: 1 })).toBe(false);
    expect(g.addPoint({ time: T(2), price: 1 })).toBe(false);
    expect(g.isComplete()).toBe(false);
    g.creating = false;
    expect(g.isComplete()).toBe(true);
  });
});

describe('projection', () => {
  it('fills the wedge and hit-tests inside it', () => {
    const d = new Projection();
    d.points = [{ time: T(10), price: 100 }, { time: T(30), price: 100 }, { time: T(40), price: 110 }];
    d.render(rc);
    const inside = rc.toPixel({ time: T(35), price: 102 });
    expect(d.hitTest(inside.x, inside.y, rc)).toEqual({ type: 'body', part: 'inside' });
    const below = rc.toPixel({ time: T(35), price: 96 });
    expect(d.hitTest(below.x, below.y, rc)).toEqual({ type: 'body', part: 'inside' }); // mirrored half
    const far = rc.toPixel({ time: T(35), price: 130 });
    expect(d.hitTest(far.x, far.y, rc)).toBeNull();
    d.points.length = 2;
    expect(() => d.render(rc)).not.toThrow();
  });
});

describe('range stats', () => {
  it('computes Δ, %, pips, bars, elapsed and volume between two points', () => {
    const st = rangeStats(rc, { time: T(10), price: 100 }, { time: T(20), price: 110 });
    expect(st.dp).toBe(10);
    expect(st.pct).toBeCloseTo(10);
    expect(st.pips).toBeCloseTo(1000);
    expect(st.bars).toBe(10);
    expect(st.seconds).toBe(10 * 86400);
    let vol = 0;
    for (let i = 10; i <= 20; i++) vol += bars[i].volume!;
    expect(st.volume).toBe(vol);
    expect(volumeBetween(bars, 20, 10)).toBe(vol);
    expect(volumeBetween(bars, 500, 600)).toBe(0);
    expect(volumeBetween(bars, -5, -1)).toBe(0);
  });
});

describe('price / date / date-and-price range', () => {
  it('hit-tests the box and honours extend options', () => {
    const p = new PriceRange();
    p.points = [{ time: T(10), price: 100 }, { time: T(20), price: 110 }];
    p.render(rc);
    const c = rc.toPixel({ time: T(15), price: 105 });
    expect(p.hitTest(c.x, c.y, rc)).toEqual({ type: 'body' });
    const left = rc.toPixel({ time: T(2), price: 105 });
    expect(p.hitTest(left.x, left.y, rc)).toBeNull();
    p.style.extendLeft = true;
    expect(p.hitTest(left.x, left.y, rc)).toEqual({ type: 'body' });
    const d = new DateRange();
    d.points = [{ time: T(10), price: 100 }, { time: T(20), price: 110 }];
    d.render(rc);
    expect(d.hitTest(c.x, c.y, rc)).toEqual({ type: 'body' });
    const above = rc.toPixel({ time: T(15), price: 125 });
    expect(d.hitTest(above.x, above.y, rc)).toBeNull();
    d.style.extendTop = true;
    expect(d.hitTest(above.x, above.y, rc)).toEqual({ type: 'body' });
    const dp = new DateAndPriceRange();
    dp.points = [{ time: T(10), price: 100 }, { time: T(20), price: 110 }];
    dp.render(rc);
    const a = rc.toPixel(dp.points[0]);
    expect(dp.hitTest(a.x, a.y, rc)).toEqual({ type: 'point', index: 0 });
    expect(dp.hitTest(c.x, c.y, rc)).toEqual({ type: 'body' });
    const text = rc.ctx.calls.filter((k) => k.startsWith('fillText')).join('\n');
    expect(text).toContain('10 bars');
    expect(text).toContain('+10.00');
  });
});

describe('measure', () => {
  it('is green when the end price is higher, red when lower, and hit-tests the box', () => {
    const m = new Measure();
    m.points = [{ time: T(10), price: 100 }, { time: T(20), price: 110 }];
    expect(m.isUp()).toBe(true);
    m.points[1].price = 90;
    expect(m.isUp()).toBe(false);
    const c = rc.toPixel({ time: T(15), price: 95 });
    expect(m.hitTest(c.x, c.y, rc)).toEqual({ type: 'body' });
    const a = rc.toPixel(m.points[0]), b = rc.toPixel(m.points[1]);
    expect(m.hitTest(a.x, a.y, rc)).toEqual({ type: 'point', index: 0 });
    expect(m.hitTest(b.x, b.y, rc)).toEqual({ type: 'point', index: 1 });
    const off = rc.toPixel({ time: T(15), price: 130 });
    expect(m.hitTest(off.x, off.y, rc)).toBeNull();
    const ctx = makeDrawingContext();
    m.render(ctx);
    const text = ctx.ctx.calls.filter((k) => k.startsWith('fillText')).join('\n');
    expect(text).toContain('10 bars');
    expect(text).toContain('Vol');
    const single = new Measure();
    single.addPoint({ time: T(10), price: 100 });
    expect(() => single.render(rc)).not.toThrow();
  });
});

describe('anchored VWAP', () => {
  it('matches a hand computation of Σ(hlc3·vol)/Σvol and the volume-weighted σ', () => {
    const b = makeBars(30);
    const v = computeVWAP(b, 5, 15, 'hlc3');
    expect(v.from).toBe(5);
    expect(v.vwap.length).toBe(11);
    let spv = 0, sv = 0, sp2v = 0;
    for (let i = 5; i <= 15; i++) {
      const p = (b[i].high + b[i].low + b[i].close) / 3;
      spv += p * b[i].volume!; sv += b[i].volume!; sp2v += p * p * b[i].volume!;
      expect(v.vwap[i - 5]).toBeCloseTo(spv / sv, 9);
      expect(v.sigma[i - 5]).toBeCloseTo(Math.sqrt(Math.max(0, sp2v / sv - (spv / sv) ** 2)), 9);
    }
    expect(v.vwap[0]).toBeCloseTo((b[5].high + b[5].low + b[5].close) / 3, 9);
    expect(v.sigma[0]).toBeCloseTo(0, 9);
    const c = computeVWAP(b, 0, 2, 'close');
    expect(c.vwap[2]).toBeCloseTo((b[0].close * b[0].volume! + b[1].close * b[1].volume! + b[2].close * b[2].volume!) / (b[0].volume! + b[1].volume! + b[2].volume!), 9);
    const noVol = computeVWAP(b.map((x) => ({ ...x, volume: undefined })), 0, 1, 'close');
    expect(noVol.vwap[1]).toBeCloseTo((b[0].close + b[1].close) / 2, 9);
  });
  it('anchors at the clicked bar, caches, and hit-tests the line', () => {
    const a = new AnchoredVWAP();
    a.addPoint({ time: T(100), price: 50 });
    a.render(rc);
    expect(a.anchorIndex(rc)).toBe(100);
    const ser = a.series(rc)!;
    expect(ser.vwap.length).toBe(100);
    expect(a.series(rc)).toBe(ser);
    const h = a.handles(rc)[0];
    expect(h.x).toBeCloseTo(rc.timeScale.barCenterX(100));
    expect(h.y).toBeCloseTo(rc.priceScale.priceToY(ser.vwap[0]));
    expect(a.hitTest(h.x, h.y, rc)).toEqual({ type: 'point', index: 0 });
    expect(a.hitTest(rc.timeScale.barCenterX(150), rc.priceScale.priceToY(ser.vwap[50]), rc)).toEqual({ type: 'body' });
    expect(a.hitTest(rc.timeScale.barCenterX(150), rc.priceScale.priceToY(ser.vwap[50]) + 30, rc)).toBeNull();
    expect(a.hitTest(rc.timeScale.barCenterX(50), rc.priceScale.priceToY(ser.vwap[0]), rc)).toBeNull(); // before the anchor
    a.movePoint(0, { time: T(120), price: 1 });
    expect(a.series(rc)!.vwap.length).toBe(80);
    a.style.band2Visible = true; a.style.band3Visible = true; a.style.bandsMode = 'percent';
    expect(() => a.render(rc)).not.toThrow();
  });
});

describe('volume profile', () => {
  const b = makeBars(60);
  const opts = { rowsLayout: 'rows' as const, rowSize: 24, tick: 0.01, valueArea: 70 };
  it('row totals equal the sum of volumes, rows partition the range, POC and value area are consistent', () => {
    const p = computeVolumeProfile(b, 10, 40, opts)!;
    expect(p.rows.length).toBe(24);
    let total = 0;
    for (let i = 10; i <= 40; i++) total += b[i].volume!;
    const rowSum = p.rows.reduce((s, r) => s + r.total, 0);
    expect(rowSum).toBeCloseTo(total, 6);
    expect(p.totalVolume).toBe(total);
    for (const r of p.rows) expect(r.up + r.down).toBeCloseTo(r.total, 9);
    expect(p.rows[0].lo).toBe(p.bottom);
    expect(p.rows[23].hi).toBe(p.top);
    for (let k = 1; k < p.rows.length; k++) expect(p.rows[k].lo).toBeCloseTo(p.rows[k - 1].hi, 9);
    expect(p.top).toBe(Math.max(...b.slice(10, 41).map((x) => x.high)));
    expect(p.bottom).toBe(Math.min(...b.slice(10, 41).map((x) => x.low)));
    expect(p.rows[p.poc].total).toBe(p.maxTotal);
    for (const r of p.rows) expect(r.total).toBeLessThanOrEqual(p.maxTotal);
    expect(p.vaLow).toBeLessThanOrEqual(p.poc);
    expect(p.vaHigh).toBeGreaterThanOrEqual(p.poc);
    let va = 0;
    for (let k = p.vaLow; k <= p.vaHigh; k++) { va += p.rows[k].total; expect(p.rows[k].inVA).toBe(true); }
    expect(va).toBeGreaterThanOrEqual(0.7 * total - 1e-6);
    expect(p.vah).toBe(p.rows[p.vaHigh].hi);
    expect(p.val).toBe(p.rows[p.vaLow].lo);
    for (let k = 0; k < p.rows.length; k++) if (k < p.vaLow || k > p.vaHigh) expect(p.rows[k].inVA).toBe(false);
  });
  it('splits up/down by close vs open and supports ticks-per-row layout', () => {
    const allUp = b.map((x) => ({ ...x, open: Math.min(x.open, x.close), close: Math.max(x.open, x.close) }));
    const up = computeVolumeProfile(allUp, 0, 20, opts)!;
    for (const r of up.rows) expect(r.down).toBe(0);
    const allDown = b.map((x) => ({ ...x, open: Math.max(x.open, x.close) + 0.001, close: Math.min(x.open, x.close), high: Math.max(x.high, Math.max(x.open, x.close) + 0.001) }));
    const dn = computeVolumeProfile(allDown, 0, 20, opts)!;
    for (const r of dn.rows) expect(r.up).toBe(0);
    const t = computeVolumeProfile(b, 10, 40, { ...opts, rowsLayout: 'ticks', rowSize: 50 })!;
    expect(t.rows.length).toBe(Math.ceil((t.top - t.bottom) / 0.5 - 1e-9));
    expect(t.rows.reduce((s, r) => s + r.total, 0)).toBeCloseTo(t.totalVolume, 6);
    expect(computeVolumeProfile(b, 100, 120, opts)).toBeNull();
    expect(computeVolumeProfile([], 0, 1, opts)).toBeNull();
    const one = computeVolumeProfile(b, 5, 5, opts)!;
    expect(one.rows.reduce((s, r) => s + r.total, 0)).toBeCloseTo(b[5].volume!, 9);
    const nan = computeVolumeProfile(b.map((x) => ({ ...x, volume: NaN })), 0, 5, opts)!;
    expect(nan.totalVolume).toBe(0);
    expect(nan.maxTotal).toBe(0);
  });
  it('fixed-range drawing spans the two bars, caches the profile and hit-tests the box', () => {
    const d = new FixedRangeVolumeProfile();
    d.points = [{ time: T(10), price: 100 }, { time: T(40), price: 100 }];
    d.render(rc);
    const p = d.profile(rc)!;
    expect(p.from).toBe(10);
    expect(p.to).toBe(40);
    expect(d.profile(rc)).toBe(p);
    const hs = d.handles(rc);
    expect(hs.length).toBe(2);
    expect(hs[0].x).toBeCloseTo(rc.timeScale.indexToX(10));
    expect(hs[1].x).toBeCloseTo(rc.timeScale.indexToX(41));
    expect(d.hitTest(hs[0].x, hs[0].y, rc)).toEqual({ type: 'point', index: 0 });
    expect(d.hitTest(rc.timeScale.barCenterX(25), rc.priceScale.priceToY((p.top + p.bottom) / 2), rc)).toEqual({ type: 'body' });
    expect(d.hitTest(rc.timeScale.barCenterX(60), rc.priceScale.priceToY((p.top + p.bottom) / 2), rc)).toBeNull();
    d.movePoint(1, { time: T(50), price: 1 });
    expect(d.profile(rc)!.to).toBe(50);
    d.style.extendRight = true;
    d.onChanged();
    expect(d.profile(rc)!.to).toBe(bars.length - 1);
    for (const mode of ['updown', 'total', 'delta']) { d.style.volumeMode = mode; d.style.showValues = true; expect(() => d.render(rc)).not.toThrow(); }
    const empty = new FixedRangeVolumeProfile();
    empty.points = [{ time: bars[bars.length - 1].time + 86400 * 10, price: 100 }, { time: bars[bars.length - 1].time + 86400 * 20, price: 100 }];
    expect(() => empty.render(rc)).not.toThrow();
    expect(empty.profile(rc)).toBeNull();
  });
  it('anchored drawing runs from the anchor to the last bar', () => {
    const a = new AnchoredVolumeProfile();
    a.addPoint({ time: T(150), price: 100 });
    a.render(rc);
    const p = a.profile(rc)!;
    expect(p.from).toBe(150);
    expect(p.to).toBe(bars.length - 1);
    expect(a.handles(rc).length).toBe(1);
    expect(a.handles(rc)[0].x).toBeCloseTo(rc.timeScale.indexToX(150));
  });
});
