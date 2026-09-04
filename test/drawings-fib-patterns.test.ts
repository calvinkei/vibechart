import { describe, it, expect } from 'vitest';
import { makeDrawingContext } from './helpers/mockCanvas';
import type { Drawing, DrawingCtor } from '../src/drawings/Drawing';
import {
  fibTools, formatCoeff, DEFAULT_FIB_LEVELS, FibRetracement, FibExtension, FibChannel, FibTimeZone, FibTrendTime,
  FibSpeedResistFan, FibCircles, FibSpiral, FibSpeedResistArcs, FibWedge,
} from '../src/drawings/tools/fibonacci';
import {
  patternsTools, labelSides, formatRatio, XABCDPattern, CypherPattern, ABCDPattern, TrianglePattern, ThreeDrivesPattern,
  HeadAndShoulders, CyclicLines, TimeCycles, SineLine,
} from '../src/drawings/tools/patterns';
import { elliottTools, elliottLabel, ELLIOTT_DEGREES, ElliottImpulseWave, ElliottCorrectionWave, ElliottTripleComboWave } from '../src/drawings/tools/elliott';

const rc = makeDrawingContext();
const bars = rc.mainSeries.bars;
const at = (bar: number, price: number) => ({ time: bars[bar].time, price });
const bx = (bar: number) => rc.timeScale.barCenterX(bar);

function make<T extends Drawing>(ctor: new () => T, pts: Array<{ time: number; price: number }>): T {
  const d = new ctor();
  for (const p of pts) d.addPoint(p);
  d.creating = false;
  return d;
}

const allTools: DrawingCtor[] = [...fibTools, ...patternsTools, ...elliottTools];

describe('registration metadata', () => {
  it('exposes the expected tool ids', () => {
    expect(fibTools.map((c) => c.toolId)).toEqual(['fib_retracement', 'fib_extension', 'fib_channel', 'fib_timezone', 'fib_speed_resist_fan', 'fib_trend_time', 'fib_circles', 'fib_spiral', 'fib_speed_resist_arcs', 'fib_wedge']);
    expect(patternsTools.map((c) => c.toolId)).toEqual(['xabcd_pattern', 'cypher_pattern', 'abcd_pattern', 'triangle_pattern', 'three_drives_pattern', 'head_and_shoulders', 'cyclic_lines', 'time_cycles', 'sine_line']);
    expect(elliottTools.map((c) => c.toolId)).toEqual(['elliott_impulse_wave', 'elliott_correction_wave', 'elliott_triangle_wave', 'elliott_double_combo_wave', 'elliott_triple_combo_wave']);
  });
  it('has group, icon and points count on every tool', () => {
    for (const c of allTools) {
      expect(['fib', 'patterns']).toContain(c.group);
      expect(c.icon).toContain('currentColor');
      expect(c.pointsCount).toBeGreaterThanOrEqual(2);
      const d = new c();
      const defs = d.propertyDefs();
      expect(defs.length).toBeGreaterThan(0);
      // every property def key exists in the default style
      for (const def of defs) if (def.type !== 'section') expect(d.style, `${c.toolId}.${def.key}`).toHaveProperty(def.key);
    }
  });
  it('points counts match the spec', () => {
    expect(FibExtension.pointsCount).toBe(3); expect(FibChannel.pointsCount).toBe(3); expect(FibTrendTime.pointsCount).toBe(3); expect(FibWedge.pointsCount).toBe(3);
    expect(XABCDPattern.pointsCount).toBe(5); expect(CypherPattern.pointsCount).toBe(5); expect(ABCDPattern.pointsCount).toBe(4); expect(TrianglePattern.pointsCount).toBe(4);
    expect(ThreeDrivesPattern.pointsCount).toBe(7); expect(HeadAndShoulders.pointsCount).toBe(7);
    expect(ElliottImpulseWave.pointsCount).toBe(6); expect(ElliottCorrectionWave.pointsCount).toBe(4); expect(ElliottTripleComboWave.pointsCount).toBe(6);
  });
});

describe('creation safety (partial points, degenerate geometry)', () => {
  for (const c of allTools) {
    it(`${c.toolId} renders with 1..n-1 points and with coincident points`, () => {
      for (let k = 1; k < c.pointsCount; k++) {
        const d = new c();
        for (let i = 0; i < k; i++) d.addPoint(at(20 + i * 10, 100 + (i % 2 ? 5 : -5)));
        d.creating = true;
        expect(() => d.render(rc)).not.toThrow();
        expect(() => d.hitTest(100, 100, rc)).not.toThrow();
      }
      const same = new c();
      for (let i = 0; i < c.pointsCount; i++) same.addPoint(at(50, 100));
      same.creating = false;
      expect(() => same.render(rc)).not.toThrow();
      expect(() => same.hitTest(bx(50), rc.priceScale.priceToY(100), rc)).not.toThrow();
      expect(() => same.handles(rc)).not.toThrow();
    });
  }
});

describe('formatting helpers', () => {
  it('formats coefficients like TradingView', () => {
    expect(formatCoeff(0.618)).toBe('0.618');
    expect(formatCoeff(0.5)).toBe('0.5');
    expect(formatCoeff(1)).toBe('1');
    expect(formatCoeff(0)).toBe('0');
    expect(formatCoeff(0.618, true)).toBe('61.8%');
    expect(formatCoeff(0.5, true)).toBe('50%');
    expect(formatCoeff(NaN)).toBe('');
  });
  it('formats ratios with 3 decimals', () => {
    expect(formatRatio(61.8, 100)).toBe('0.618');
    expect(formatRatio(-50, 100)).toBe('0.500');
    expect(formatRatio(1, 0)).toBe('');
  });
  it('default level table matches the spec (11 visible, 24 total)', () => {
    expect(DEFAULT_FIB_LEVELS).toHaveLength(24);
    expect(DEFAULT_FIB_LEVELS.filter((l) => l.visible).map((l) => l.coeff)).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236]);
  });
});

describe('Fib retracement / extension level prices', () => {
  it('retracement: level 0 at point 2, level 1 at point 1', () => {
    const d = make(FibRetracement, [at(10, 100), at(20, 120)]);
    expect(d.levelPrice(0)).toBeCloseTo(120);
    expect(d.levelPrice(1)).toBeCloseTo(100);
    expect(d.levelPrice(0.5)).toBeCloseTo(110);
    d.style.reverse = true;
    expect(d.levelPrice(0)).toBeCloseTo(100);
  });
  it('extension: levels projected from p3 by the p1→p2 swing', () => {
    const d = make(FibExtension, [at(10, 100), at(20, 120), at(30, 110)]);
    expect(d.levelPrice(0)).toBeCloseTo(110);
    expect(d.levelPrice(1)).toBeCloseTo(130);
    expect(d.levelPrice(1.618)).toBeCloseTo(142.36);
    d.style.reverse = true;
    expect(d.levelPrice(1)).toBeCloseTo(90);
    d.style.reverse = false;
    d.style.fibLevelsBasedOnLogScale = true;
    expect(d.levelPrice(1)).toBeCloseTo(132); // 110 * (120/100)
    expect(d.levelPrice(0)).toBeCloseTo(110);
  });
  it('extension: hit-tests level lines, points and the inside band', () => {
    const d = make(FibExtension, [at(10, 100), at(20, 120), at(30, 110)]);
    const p1 = rc.toPixel(d.points[0]);
    expect(d.hitTest(p1.x, p1.y, rc)).toEqual({ type: 'point', index: 0 });
    const y1 = rc.priceScale.priceToY(130);
    expect(d.hitTest(bx(20), y1, rc)).toEqual({ type: 'body' });
    const rows = d.levelRows(rc).slice().sort((p, q) => p.y - q.y);
    let gap = 0, midY = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i].y - rows[i - 1].y > gap) { gap = rows[i].y - rows[i - 1].y; midY = (rows[i].y + rows[i - 1].y) / 2; }
    expect(d.hitTest(bx(25), midY, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(bx(100), y1, rc)).toBeNull();
    d.style.extendRight = true;
    expect(d.hitTest(bx(100), y1, rc)).toEqual({ type: 'body' });
  });
  it('renders labels with level text and price in the level colour', () => {
    const d = make(FibExtension, [at(10, 100), at(20, 120), at(30, 110)]);
    rc.ctx.calls.length = 0;
    d.render(rc);
    const texts = rc.ctx.calls.filter((c) => c.startsWith('fillText'));
    expect(texts.some((t) => t.includes('"1 (130.00)"'))).toBe(true);
    expect(texts.some((t) => t.includes('"0.618 (122.36)"'))).toBe(true);
  });
});

describe('Fib channel', () => {
  it('level lines are the base line shifted by fib multiples of the p3 offset', () => {
    const d = make(FibChannel, [at(10, 100), at(20, 110), at(15, 120)]);
    const ps = rc.priceScale;
    const l1 = d.levelLine(1, rc)!;
    expect(l1[0].x).toBeCloseTo(bx(10));
    expect(l1[0].y).toBeCloseTo(ps.priceToY(115), 3);
    expect(l1[1].y).toBeCloseTo(ps.priceToY(125), 3);
    const l05 = d.levelLine(0.5, rc)!;
    expect(l05[0].y).toBeCloseTo(ps.priceToY(107.5), 3);
    const l0 = d.levelLine(0, rc)!;
    expect(l0[0].y).toBeCloseTo(ps.priceToY(100), 3);
  });
  it('hit-tests the base line, a level line and the inside area', () => {
    const d = make(FibChannel, [at(10, 100), at(20, 110), at(15, 120)]);
    const ps = rc.priceScale;
    expect(d.hitTest(bx(15), ps.priceToY(105), rc)).toEqual({ type: 'body' }); // base line
    expect(d.hitTest(bx(15), ps.priceToY(120), rc)).toEqual({ type: 'point', index: 2 });
    expect(d.hitTest(bx(12), ps.priceToY(102 + 15 * 0.618), rc)).toEqual({ type: 'body' }); // 0.618 line at bar 12
    expect(d.hitTest(bx(12), ps.priceToY(102 + 15 * 2), rc)).toEqual({ type: 'body', part: 'inside' }); // between 1.618 and 2.618
    expect(d.hitTest(bx(40), ps.priceToY(105), rc)).toBeNull();
  });
});

describe('Fib time zone / trend-based fib time (index space)', () => {
  it('time zone lines sit at fibonacci multiples of the bar distance', () => {
    const d = make(FibTimeZone, [at(10, 100), at(15, 105)]);
    expect(d.unit(rc)).toBeCloseTo(5);
    const idx = d.lineIndices(rc).map((l) => l.index);
    expect(idx.slice(0, 7)).toEqual([10, 15, 20, 25, 35, 50, 75]);
    const xs = d.lines(rc).map((l) => l.x);
    expect(xs[2]).toBeCloseTo(bx(20));
    expect(d.hitTest(bx(20), 200, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(bx(23), 200, rc)).toBeNull();
    const p0 = rc.toPixel(d.points[0]);
    expect(d.hitTest(p0.x, p0.y, rc)).toEqual({ type: 'point', index: 0 });
  });
  it('hidden levels are skipped', () => {
    const d = make(FibTimeZone, [at(10, 100), at(15, 105)]);
    expect(d.lineIndices(rc).map((l) => l.l.coeff)).toEqual([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]);
    d.style.levels[1].visible = false;
    expect(d.lineIndices(rc).map((l) => l.l.coeff)).not.toContain(1);
  });
  it('trend-based fib time projects ratios of the p1→p2 distance from p3', () => {
    const d = make(FibTrendTime, [at(10, 100), at(20, 110), at(30, 105)]);
    const byCoeff = new Map(d.lineIndices(rc).map((l) => [l.l.coeff, l.index]));
    expect(byCoeff.get(0)).toBeCloseTo(30);
    expect(byCoeff.get(0.382)).toBeCloseTo(33.82);
    expect(byCoeff.get(1)).toBeCloseTo(40);
    expect(byCoeff.get(1.618)).toBeCloseTo(46.18);
    expect(byCoeff.has(0.5)).toBe(false); // hidden by default
    expect(d.hitTest(bx(40), 150, rc)).toEqual({ type: 'body' });
  });
});

describe('Fib speed resistance fan', () => {
  const d = make(FibSpeedResistFan, [at(10, 100), at(50, 120)]);
  it('builds 13 unique fan rays (7 price + 7 time levels, shared diagonal)', () => {
    expect(d.rays(rc)).toHaveLength(13);
  });
  it('hit-tests the diagonal, the box interior and outside', () => {
    const a = rc.toPixel(d.points[0]), b = rc.toPixel(d.points[1]);
    expect(d.hitTest((a.x + b.x) / 2, (a.y + b.y) / 2, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(a.x + (b.x - a.x) * 0.3, a.y + (b.y - a.y) * 0.9, rc)?.type).toBe('body');
    expect(d.hitTest(a.x - 30, a.y + 30, rc)).toBeNull();
    d.style.reverse = true;
    expect(d.box(rc)!.o).toEqual(b);
    d.style.reverse = false;
  });
});

describe('Fib circles / arcs / spiral / wedge (pixel space)', () => {
  it('circles: level 1 ellipse has radii |dx|, |dy| of p2 − p1', () => {
    const d = make(FibCircles, [at(50, 100), at(60, 110)]);
    const g = d.geometry(rc)!;
    const one = d.rings(rc).find((r) => r.l.coeff === 1)!;
    expect(one.rx).toBeCloseTo(g.rx);
    expect(one.ry).toBeCloseTo(g.ry);
    expect(d.hitTest(g.a.x + g.rx, g.a.y, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(g.a.x, g.a.y - g.ry, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(g.a.x + g.rx * 0.618, g.a.y, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(g.a.x + g.rx * 1.3, g.a.y, rc)).toBeNull();
  });
  it('arcs: centred at p2, half circle facing p1', () => {
    const d = make(FibSpeedResistArcs, [at(50, 100), at(60, 110)]);
    const g = d.geometry(rc)!;
    expect(g.from).toBe(0); // p1 is below p2 on screen → lower half
    expect(d.hitTest(g.c.x, g.c.y + g.L, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(g.c.x, g.c.y - g.L, rc)).toBeNull();
    d.style.fullCircles = true;
    expect(d.hitTest(g.c.x, g.c.y - g.L, rc)).toEqual({ type: 'body' });
  });
  it('spiral passes through p2 and stays finite', () => {
    const d = make(FibSpiral, [at(50, 100), at(60, 104)]);
    const pts = d.spiralPoints(rc);
    expect(pts.length).toBeGreaterThan(50);
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    const b = rc.toPixel(d.points[1]);
    const minD = Math.min(...pts.map((p) => Math.hypot(p.x - b.x, p.y - b.y)));
    expect(minD).toBeLessThan(3);
    expect(d.hitTest(b.x, b.y, rc)).toEqual({ type: 'point', index: 1 });
    const same = make(FibSpiral, [at(50, 100), at(50, 100)]);
    expect(same.spiralPoints(rc)).toEqual([]);
  });
  it('wedge: arcs are clipped to the sector between the two rays', () => {
    const d = make(FibWedge, [at(50, 100), at(70, 110), at(70, 90)]);
    const g = d.geometry(rc)!;
    expect(d.rings(rc).map((r) => r.l.coeff)).toEqual([0.236, 0.382, 0.5, 0.618, 0.786, 1]);
    expect(d.hitTest(g.a.x + g.L, g.a.y, rc)).toEqual({ type: 'body' }); // level-1 arc on the bisector
    expect(d.hitTest(g.a.x - g.L, g.a.y, rc)).toBeNull(); // opposite side of the apex
  });
});

describe('patterns', () => {
  it('labelSides puts labels above highs and below lows', () => {
    expect(labelSides([{ x: 0, y: 100 }, { x: 10, y: 50 }, { x: 20, y: 100 }])).toEqual(['below', 'above', 'below']);
    expect(labelSides([{ x: 0, y: 0 }])).toEqual(['above']);
  });
  it('XABCD ratio labels: AB/XA, BC/AB, CD/BC, AD/XA', () => {
    const d = make(XABCDPattern, [at(10, 100), at(20, 200), at(30, 138.2), at(40, 180), at(50, 120)]);
    expect(d.ratioLabels().map((r) => r.text)).toEqual(['0.618', '0.676', '1.435', '0.800']);
    expect(d.pointLabels()).toEqual(['X', 'A', 'B', 'C', 'D']);
    const x = rc.toPixel(d.points[0]), a = rc.toPixel(d.points[1]), b = rc.toPixel(d.points[2]);
    expect(d.hitTest(x.x, x.y, rc)).toEqual({ type: 'point', index: 0 });
    expect(d.hitTest((x.x + a.x) / 2, (x.y + a.y) / 2, rc)).toEqual({ type: 'body' });
    expect(d.hitTest((x.x + a.x + b.x) / 3, (x.y + a.y + b.y) / 3, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(bx(100), 10, rc)).toBeNull();
  });
  it('Cypher and ABCD ratio labels', () => {
    const c = make(CypherPattern, [at(10, 100), at(20, 200), at(30, 150), at(40, 227.2), at(50, 127.2)]);
    expect(c.ratioLabels().map((r) => r.text)).toEqual(['0.500', '1.272', '1.295', '0.786']);
    const d = make(ABCDPattern, [at(10, 100), at(20, 150), at(30, 119.1), at(40, 169.1)]);
    expect(d.ratioLabels().map((r) => r.text)).toEqual(['0.618', '1.618']);
    expect(d.style.fillBackground).toBe(false);
    expect(d.style.color).toBe('#089981');
  });
  it('Triangle pattern extends A–C and B–D to their apex', () => {
    const d = make(TrianglePattern, [at(10, 100), at(20, 80), at(30, 95), at(40, 85)]);
    const px = d.points.map((p) => rc.toPixel(p));
    const ext = d.extensions(rc, px)!;
    expect(ext[0]).toEqual(ext[1]);
    expect(ext[0].x).toBeGreaterThan(px[3].x);
    // A–C: 100 − 0.25·(bar − 10); B–D: 80 + 0.25·(bar − 20) → meet at bar 55, price 88.75
    expect(ext[0].x).toBeCloseTo(bx(55), 1);
    expect(ext[0].y).toBeCloseTo(rc.priceScale.priceToY(88.75), 1);
    expect(d.hitTest((px[3].x + ext[1].x) / 2, (px[3].y + ext[1].y) / 2, rc)).toEqual({ type: 'body' });
  });
  it('Three drives and Head & Shoulders labels', () => {
    const t = make(ThreeDrivesPattern, [at(10, 100), at(15, 110), at(20, 105), at(25, 115), at(30, 110), at(35, 120), at(40, 112)]);
    expect(t.pointLabels()).toEqual(['0', '1', 'A', '2', 'B', '3', 'C']);
    expect(t.ratioLabels().map((r) => r.text)).toEqual(['0.500', '2.000', '0.500', '2.000', '0.800']);
    const hs = make(HeadAndShoulders, [at(10, 100), at(15, 110), at(20, 102), at(25, 120), at(30, 102), at(35, 110), at(40, 100)]);
    expect(hs.pointLabels()).toEqual(['', 'LS', '', 'H', '', 'RS', '']);
    const px = hs.points.map((p) => rc.toPixel(p));
    const neck = hs.neckline(px)!;
    expect(neck[0].y).toBeCloseTo(rc.priceScale.priceToY(102), 3);
    expect(neck[0].x).toBeCloseTo(bx(10));
    expect(hs.hitTest(bx(12), rc.priceScale.priceToY(102), rc)).toEqual({ type: 'body' });
    expect(hs.hitTest(bx(25), rc.priceScale.priceToY(110), rc)).toEqual({ type: 'body', part: 'inside' });
  });
  it('Cyclic lines repeat every |p2 − p1| bars to the right (and left with extendLeft)', () => {
    const d = make(CyclicLines, [at(10, 100), at(15, 105)]);
    expect(d.period(rc)).toBeCloseTo(5);
    const ks = d.lines(rc);
    expect(ks[0].k).toBe(0);
    expect(ks.slice(0, 4).map((l) => l.index)).toEqual([10, 15, 20, 25]);
    expect(ks[2].x).toBeCloseTo(bx(20));
    expect(ks[ks.length - 1].x).toBeLessThanOrEqual(rc.width + 20);
    expect(d.hitTest(bx(25), 50, rc)).toEqual({ type: 'body' });
    d.style.extendLeft = true;
    expect(d.lines(rc).map((l) => l.index)).toContain(0);
    expect(d.lines(rc).map((l) => l.index)).toContain(5);
  });
  it('Time cycles: semicircles of the bar distance repeated along the time axis', () => {
    const d = make(TimeCycles, [at(10, 100), at(20, 105)]);
    const { up, cycle, items } = d.arcs(rc);
    expect(up).toBe(true);
    expect(cycle).toBeCloseTo(bx(20) - bx(10));
    expect(items[0].cx).toBeCloseTo(bx(15));
    expect(items[0].r).toBeCloseTo(cycle / 2);
    expect(items[1].cx).toBeCloseTo(bx(25));
    expect(items[items.length - 1].cx - items[items.length - 1].r).toBeLessThanOrEqual(rc.width + 20);
    expect(d.hitTest(items[0].cx, items[0].cy - items[0].r, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(items[0].cx, items[0].cy + items[0].r, rc)).toBeNull();
  });
  it('Sine line passes through both points and spans the pane', () => {
    const d = make(SineLine, [at(10, 100), at(30, 110)]);
    const a = rc.toPixel(d.points[0]), b = rc.toPixel(d.points[1]);
    const pts = d.curve(rc);
    expect(pts[0].x).toBeLessThanOrEqual(0);
    expect(pts[pts.length - 1].x).toBeGreaterThanOrEqual(rc.width);
    const yAt = (x: number) => { const p = pts.reduce((best, q) => (Math.abs(q.x - x) < Math.abs(best.x - x) ? q : best)); return p.y; };
    expect(yAt(a.x)).toBeCloseTo(a.y, 0);
    expect(yAt(b.x)).toBeCloseTo(b.y, 0);
    expect(d.hitTest((a.x + b.x) / 2, (a.y + b.y) / 2, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(a.x, a.y, rc)).toEqual({ type: 'point', index: 0 });
  });
});

describe('Elliott waves', () => {
  it('has 15 degrees and formats labels by degree', () => {
    expect(ELLIOTT_DEGREES).toHaveLength(15);
    expect(ELLIOTT_DEGREES[7]).toBe('Intermediate');
    expect(elliottLabel('1', 7).text).toBe('(1)');
    expect(elliottLabel('1', 8).text).toBe('1');
    expect(elliottLabel('1', 5).text).toBe('I');
    expect(elliottLabel('4', 4).text).toBe('(IV)');
    expect(elliottLabel('3', 6)).toEqual({ text: '3', circled: true });
    expect(elliottLabel('A', 7).text).toBe('(A)');
    expect(elliottLabel('a', 10).text).toBe('(a)');
    expect(elliottLabel('2', 10).text).toBe('(ii)');
    expect(elliottLabel('5', 11).text).toBe('v');
    expect(elliottLabel('W', 11).text).toBe('w');
    expect(elliottLabel('0', 7).text).toBe('(0)');
    expect(elliottLabel('1', 12).text).toBe('((1))');
    expect(elliottLabel('1', 0).text).toBe('[[I]]');
    expect(elliottLabel('B', 9)).toEqual({ text: 'b', circled: true });
  });
  it('tools carry the spec colours, default degree and labels', () => {
    const imp = make(ElliottImpulseWave, [at(10, 100), at(15, 110), at(20, 105), at(25, 120), at(30, 112), at(35, 130)]);
    expect(imp.style.degree).toBe(7);
    expect(imp.style.color).toBe('#3D85C6');
    expect(imp.labelTexts().map((l) => l.text)).toEqual(['(0)', '(1)', '(2)', '(3)', '(4)', '(5)']);
    imp.style.degree = 8;
    expect(imp.labelTexts().map((l) => l.text)).toEqual(['0', '1', '2', '3', '4', '5']);
    const cor = make(ElliottCorrectionWave, [at(10, 100), at(15, 90), at(20, 95), at(25, 85)]);
    expect(cor.labelTexts().map((l) => l.text)).toEqual(['(0)', '(A)', '(B)', '(C)']);
    const tri = new ElliottTripleComboWave();
    expect(tri.style.color).toBe('#6AA84F');
    expect(tri.waveLabels()).toEqual(['0', 'W', 'X', 'Y', 'X', 'Z']);
    const p1 = rc.toPixel(imp.points[1]), p2 = rc.toPixel(imp.points[2]);
    expect(imp.hitTest(p1.x, p1.y, rc)).toEqual({ type: 'point', index: 1 });
    expect(imp.hitTest((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, rc)).toEqual({ type: 'body' });
    rc.ctx.calls.length = 0;
    imp.render(rc);
    expect(rc.ctx.calls.filter((c) => c.startsWith('fillText'))).toHaveLength(6);
  });
});

describe('serialization round-trip', () => {
  for (const c of allTools) {
    it(`${c.toolId} survives serialize/applySerialized`, () => {
      const d = new c();
      for (let i = 0; i < c.pointsCount; i++) d.addPoint(at(20 + i * 5, 100 + (i % 2 ? 5 : -5)));
      const copy = new c();
      copy.applySerialized(d.serialize());
      expect(copy.points).toEqual(d.points);
      expect(copy.style).toEqual(d.style);
    });
  }
});
