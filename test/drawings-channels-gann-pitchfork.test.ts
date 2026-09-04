import { describe, it, expect } from 'vitest';
import { makeDrawingContext, makeBars } from './helpers/mockCanvas';
import { registerDrawingTool, getDrawingTool, deserializeDrawing, type DrawingCtor, type FibLevel } from '../src/drawings/Drawing';
import { RegressionTrend, FlatTopBottom, DisjointChannel, channelsTools } from '../src/drawings/tools/channels';
import { GannBox, GannSquare, GannSquareFixed, GannFan, gannTools } from '../src/drawings/tools/gann';
import { Pitchfork, SchiffPitchfork, ModifiedSchiffPitchfork, InsidePitchfork, Pitchfan, pitchforkTools } from '../src/drawings/tools/pitchfork';

const allTools: DrawingCtor[] = [...channelsTools, ...gannTools, ...pitchforkTools];
for (const c of allTools) registerDrawingTool(c);

const rc = makeDrawingContext();
const bars = rc.mainSeries.bars;
const at = (i: number, mul = 1) => ({ time: bars[i].time, price: bars[i].close * mul });
const px = (p: { time: number; price: number }) => rc.toPixel(p);
const near = (p: { x: number; y: number }, q: { x: number; y: number }) => { expect(p.x).toBeCloseTo(q.x, 9); expect(p.y).toBeCloseTo(q.y, 9); };

describe('registry', () => {
  it('registers the expected ids, names, point counts and groups', () => {
    const expected: Array<[string, string, number, string]> = [
      ['regression_trend', 'Regression Trend', 2, 'lines'], ['flat_top_bottom', 'Flat Top/Bottom', 3, 'lines'], ['disjoint_channel', 'Disjoint Channel', 3, 'lines'],
      ['gann_box', 'Gann Box', 2, 'gann'], ['gann_square_fixed', 'Gann Square Fixed', 2, 'gann'], ['gann_square', 'Gann Square', 2, 'gann'], ['gann_fan', 'Gann Fan', 2, 'gann'],
      ['pitchfork', 'Pitchfork', 3, 'pitchfork'], ['schiff_pitchfork', 'Schiff Pitchfork', 3, 'pitchfork'], ['modified_schiff_pitchfork', 'Modified Schiff Pitchfork', 3, 'pitchfork'],
      ['inside_pitchfork', 'Inside Pitchfork', 3, 'pitchfork'], ['pitchfan', 'Pitchfan', 3, 'pitchfork'],
    ];
    expect(allTools.length).toBe(expected.length);
    for (const [id, name, n, group] of expected) {
      const c = getDrawingTool(id);
      expect(c, id).toBeDefined();
      expect(c!.toolName).toBe(name);
      expect(c!.pointsCount).toBe(n);
      expect(c!.group).toBe(group);
      expect(c!.icon).toContain('<svg');
    }
  });

  it('every default style key has a property definition', () => {
    for (const ctor of allTools) {
      const d = new ctor();
      const defs = new Set(d.propertyDefs().map((p) => p.key));
      for (const k of Object.keys(d.defaultStyle())) expect(defs.has(k), `${ctor.toolId}.${k}`).toBe(true);
    }
  });

  it('serializes and restores level tables and points', () => {
    for (const ctor of allTools) {
      const d = new ctor();
      for (let i = 0; i < Math.max(ctor.pointsCount, 2); i++) d.addPoint(at(20 + i * 15, i % 2 ? 1.05 : 0.95));
      const levelsKey = ['levels', 'hLevels'].find((k) => Array.isArray(d.style[k]));
      if (levelsKey) (d.style[levelsKey] as FibLevel[])[0].visible = !(d.style[levelsKey] as FibLevel[])[0].visible;
      const copy = deserializeDrawing(d.serialize())!;
      expect(copy.type).toBe(ctor.toolId);
      expect(copy.points).toEqual(d.points);
      expect(copy.style).toEqual(d.style);
      expect(() => copy.render(rc)).not.toThrow();
    }
  });

  it('renders degenerate geometry (coincident points, zero span) without throwing', () => {
    for (const ctor of allTools) {
      const d = new ctor();
      for (let i = 0; i < Math.max(ctor.pointsCount, 2); i++) d.addPoint(at(30));
      expect(() => d.render(rc), ctor.toolId).not.toThrow();
      expect(() => d.hitTest(10, 10, rc), ctor.toolId).not.toThrow();
      expect(() => d.handles(rc), ctor.toolId).not.toThrow();
      // single point (first click of creation)
      const e = new ctor();
      e.addPoint(at(30));
      e.creating = true;
      expect(() => e.render({ ...rc, creating: true }), ctor.toolId).not.toThrow();
    }
  });
});

describe('RegressionTrend', () => {
  it('matches a hand-computed OLS case (y = 1,3,2,5,4)', () => {
    const b = makeBars(40);
    [1, 3, 2, 5, 4].forEach((y, k) => { const bar = b[10 + k]; bar.open = y; bar.close = y; bar.high = y + 0.1; bar.low = y - 0.1; });
    const ctx = makeDrawingContext(b);
    const d = new RegressionTrend();
    d.addPoint({ time: b[10].time, price: 0 });
    d.addPoint({ time: b[14].time, price: 0 });
    const r = d.regression(ctx)!;
    expect([r.i0, r.i1, r.n]).toEqual([10, 14, 5]);
    expect(r.slope).toBeCloseTo(0.8, 10);
    expect(r.intercept).toBeCloseTo(1.4, 10);
    expect(r.sigma).toBeCloseTo(Math.sqrt(0.72), 10);
    expect(r.r).toBeCloseTo(0.8, 10);
  });

  it('perfect line: sigma 0, R 1, handles sit on the base line, order of anchors irrelevant', () => {
    const b = makeBars(60);
    b.forEach((bar, i) => { bar.open = 100 + 2 * i; bar.close = 100 + 2 * i; bar.high = bar.close + 1; bar.low = bar.close - 1; });
    const ctx = makeDrawingContext(b);
    const d = new RegressionTrend();
    d.addPoint({ time: b[25].time, price: 1 });
    d.addPoint({ time: b[5].time, price: 1 });
    const r = d.regression(ctx)!;
    expect([r.i0, r.i1]).toEqual([5, 25]);
    expect(r.slope).toBeCloseTo(2, 9);
    expect(r.intercept).toBeCloseTo(110, 9);
    expect(r.sigma).toBeCloseTo(0, 9);
    expect(r.r).toBeCloseTo(1, 9);
    const hs = d.handles(ctx);
    expect(hs.length).toBe(2);
    expect(hs[0].index).toBe(0);
    expect(hs[0].x).toBeCloseTo(ctx.timeScale.indexToX(25.5), 6);
    expect(hs[0].y).toBeCloseTo(ctx.priceScale.priceToY(150), 6);
    expect(hs[1].x).toBeCloseTo(ctx.timeScale.indexToX(5.5), 6);
    expect(hs[1].y).toBeCloseTo(ctx.priceScale.priceToY(110), 6);
    // source select changes the fit
    d.style.source = 'high';
    d.onChanged();
    expect(d.regression(ctx)!.intercept).toBeCloseTo(111, 9);
    expect(() => d.render(ctx)).not.toThrow();
  });

  it('hit-tests handles, the base line and the channel interior', () => {
    const b = makeBars(60);
    b.forEach((bar, i) => { const c = 100 + 2 * i + (i % 2 ? 3 : -3); bar.open = c; bar.close = c; bar.high = c + 1; bar.low = c - 1; });
    const ctx = makeDrawingContext(b);
    const d = new RegressionTrend();
    d.addPoint({ time: b[5].time, price: 1 });
    d.addPoint({ time: b[45].time, price: 1 });
    const r = d.regression(ctx)!;
    expect(r.sigma).toBeCloseTo(3, 2);
    const [h0, h1] = d.handles(ctx);
    expect(d.hitTest(h0.x, h0.y, ctx)).toEqual({ type: 'point', index: 0 });
    expect(d.hitTest(h1.x + 3, h1.y - 3, ctx)).toEqual({ type: 'point', index: 1 });
    const midX = (h0.x + h1.x) / 2;
    const midY = (h0.y + h1.y) / 2;
    expect(d.hitTest(midX, midY, ctx)).toEqual({ type: 'body' });
    const upperY = ctx.priceScale.priceToY(r.intercept + r.slope * 20 + 2 * r.sigma);
    expect(d.hitTest(midX, upperY, ctx)).toEqual({ type: 'body' });
    expect(d.hitTest(midX, (midY + upperY) / 2, ctx)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(midX, upperY - 40, ctx)).toBeNull();
    expect(d.hitTest(h1.x + 60, h1.y, ctx)).toBeNull();
    d.style.extendLines = true;
    expect(d.hitTest(h1.x + 60, h1.y + (h1.y - h0.y) * (60 / (h1.x - h0.x)), ctx)).toEqual({ type: 'body' });
  });

  it('caches the regression until onChanged', () => {
    const d = new RegressionTrend();
    d.addPoint(at(10));
    d.addPoint(at(40));
    const a = d.regression(rc);
    expect(d.regression(rc)).toBe(a);
    d.onChanged();
    expect(d.regression(rc)).not.toBe(a);
    expect(d.regression(rc)).toEqual(a);
  });
});

describe('FlatTopBottom', () => {
  const make = () => {
    const d = new FlatTopBottom();
    d.addPoint(at(20));
    d.addPoint(at(60, 1.1));
    d.addPoint(at(40, 0.9));
    return d;
  };

  it('exposes four handles: sloped ends and flat ends at p3 price', () => {
    const d = make();
    const hs = d.handles(rc);
    const a = px(d.points[0]), b = px(d.points[1]);
    const yFlat = rc.priceScale.priceToY(d.points[2].price);
    expect(hs.map((h) => h.index)).toEqual([0, 1, 2, 3]);
    expect(hs[2]).toEqual({ x: a.x, y: yFlat, index: 2 });
    expect(hs[3]).toEqual({ x: b.x, y: yFlat, index: 3 });
  });

  it('hit-tests lines, flat handles and the fill', () => {
    const d = make();
    const hs = d.handles(rc);
    expect(d.hitTest(hs[2].x, hs[2].y, rc)).toEqual({ type: 'point', index: 2 });
    expect(d.hitTest((hs[2].x + hs[3].x) / 2, hs[2].y, rc)).toEqual({ type: 'body' });
    expect(d.hitTest((hs[0].x + hs[1].x) / 2, (hs[0].y + hs[1].y) / 2, rc)).toEqual({ type: 'body' });
    const midSlope = (hs[0].y + hs[1].y) / 2;
    expect(d.hitTest((hs[0].x + hs[1].x) / 2, (midSlope + hs[2].y) / 2, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(hs[1].x + 50, hs[2].y, rc)).toBeNull();
    d.style.extendRight = true;
    expect(d.hitTest(hs[1].x + 50, hs[2].y, rc)).toEqual({ type: 'body' });
  });

  it('flat handles only move the flat price', () => {
    const d = make();
    const t = d.points[2].time;
    d.movePoint(3, { time: bars[90].time, price: 123 });
    expect(d.points[2]).toEqual({ time: t, price: 123 });
    d.movePoint(0, { time: bars[5].time, price: 77 });
    expect(d.points[0]).toEqual({ time: bars[5].time, price: 77 });
  });

  it('renders with every option enabled and during creation', () => {
    const d = make();
    Object.assign(d.style, { extendLeft: true, extendRight: true, leftEnd: 1, rightEnd: 1, showPrices: true, showPriceRange: true, showBarsRange: true, showDateTimeRange: true, labelVisible: true, labelText: 'hello' });
    expect(() => d.render(rc)).not.toThrow();
    d.style.extendLeft = false; d.style.extendRight = false;
    expect(() => d.render(rc)).not.toThrow();
    expect(rc.ctx.calls.some((c) => c.startsWith('fillText'))).toBe(true);
    const e = new FlatTopBottom();
    e.addPoint(at(20)); e.addPoint(at(30));
    expect(() => e.render({ ...rc, creating: true })).not.toThrow();
  });
});

describe('DisjointChannel', () => {
  it('follows the manager creation protocol: 3 clicks produce 4 points with a parallel second line', () => {
    const d = new DisjointChannel();
    const p1 = at(20), p2 = at(60, 1.1);
    expect(d.addPoint(p1)).toBe(false);
    d.addPoint({ ...p1 }); // pending point added by the manager
    expect(d.points.length).toBe(2);
    d.updatePendingPoint(p2);
    expect(d.isComplete()).toBe(false);
    d.addPoint({ ...p2 }); // next pending point
    expect(d.points.length).toBe(4);
    const line1At = (t: number) => p1.price + ((p2.price - p1.price) * (t - p1.time)) / (p2.time - p1.time);
    const t3 = bars[40].time;
    d.updatePendingPoint({ time: t3, price: line1At(t3) + 5 });
    expect(d.isComplete()).toBe(true);
    expect(d.points[2].time).toBe(p1.time);
    expect(d.points[3].time).toBe(p2.time);
    expect(d.points[2].price - p1.price).toBeCloseTo(5, 9);
    expect(d.points[3].price - p2.price).toBeCloseTo(5, 9);
    expect(d.handles(rc).map((h) => h.index)).toEqual([0, 1, 2, 3]);
    // the 4 ends are then independent
    d.movePoint(3, { time: p2.time, price: p2.price + 20 });
    expect(d.points[3].price).toBeCloseTo(p2.price + 20, 9);
    expect(d.points[2].price - p1.price).toBeCloseTo(5, 9);
  });

  it('hit-tests both lines and the quad, and materialises the 4th point from a 3-point state', () => {
    const d = new DisjointChannel();
    d.addPoint(at(20)); d.addPoint(at(60, 1.1)); d.addPoint(at(20, 0.9));
    const hs = d.handles(rc);
    expect(hs.length).toBe(4);
    expect(d.hitTest((hs[2].x + hs[3].x) / 2, (hs[2].y + hs[3].y) / 2, rc)).toEqual({ type: 'body' });
    expect(d.hitTest((hs[0].x + hs[1].x) / 2, (hs[0].y + hs[1].y + hs[2].y + hs[3].y) / 4, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(hs[3].x, hs[3].y, rc)).toEqual({ type: 'point', index: 3 });
    expect(d.hitTest(hs[1].x + 40, hs[1].y, rc)).toBeNull();
    // load a legacy 3-point drawing, then drag handle 3
    const three = new DisjointChannel();
    three.applySerialized({ ...d.serialize(), points: d.points.slice(0, 3) });
    expect(three.points.length).toBe(3);
    expect(three.handles(rc).length).toBe(4);
    three.movePoint(3, { time: bars[60].time, price: 50 });
    expect(three.points.length).toBe(4);
    expect(three.points[3]).toEqual({ time: bars[60].time, price: 50 });
    expect(() => three.render(rc)).not.toThrow();
  });
});

describe('GannBox', () => {
  const make = () => { const d = new GannBox(); d.addPoint(at(20, 0.9)); d.addPoint(at(60, 1.1)); return d; };

  it('has four corner handles and hit-tests levels and the interior', () => {
    const d = make();
    const [p0, p1] = d.points;
    const a = px(p0), b = px(p1);
    const hs = d.handles(rc);
    expect(hs.map((h) => h.index)).toEqual([0, 1, 2, 3]);
    expect(hs[2]).toEqual({ x: b.x, y: a.y, index: 2 });
    const yHalf = rc.priceScale.priceToY(p0.price + (p1.price - p0.price) * 0.5);
    const xHalf = (a.x + b.x) / 2;
    expect(d.hitTest(xHalf + 17, yHalf, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(xHalf, a.y + (yHalf - a.y) * 0.9, rc)).toEqual({ type: 'body' });
    const y382 = rc.priceScale.priceToY(p0.price + (p1.price - p0.price) * 0.382);
    const x382 = a.x + (b.x - a.x) * 0.382;
    expect(d.hitTest(x382, (y382 + yHalf) / 2, rc)).toEqual({ type: 'body' });
    expect(d.hitTest((x382 + xHalf) / 2, (y382 + yHalf) / 2, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(b.x + 30, yHalf, rc)).toBeNull();
    expect(d.hitTest(hs[3].x, hs[3].y, rc)).toEqual({ type: 'point', index: 3 });
  });

  it('corner handles 2/3 resize like a rectangle', () => {
    const d = make();
    const [p0, p1] = d.points.map((p) => ({ ...p }));
    d.movePoint(2, { time: bars[70].time, price: 5 });
    expect(d.points[1]).toEqual({ time: bars[70].time, price: p1.price });
    expect(d.points[0]).toEqual({ time: p0.time, price: 5 });
  });

  it('renders with fans, reverse and labels and hidden levels', () => {
    const d = make();
    d.style.showFans = true; d.style.reverse = true;
    (d.style.hLevels as FibLevel[])[3].visible = false;
    expect(() => d.render(rc)).not.toThrow();
    expect(rc.ctx.calls.some((c) => c.startsWith('fillText("0.382"'))).toBe(true);
  });
});

describe('GannSquare / GannSquareFixed', () => {
  it('builds a 5x5 grid from the two corners and hit-tests grid, fans, arcs and interior', () => {
    const d = new GannSquare();
    d.addPoint(at(20, 0.9)); d.addPoint(at(70, 1.1));
    const g = d.geometry(rc)!;
    const a = px(d.points[0]), b = px(d.points[1]);
    expect(g.o).toEqual(a);
    expect(g.f).toEqual(b);
    expect(g.cellW * 5).toBeCloseTo(b.x - a.x, 9);
    expect(g.levelY(5)).toBeCloseTo(b.y, 9);
    expect(g.levelY(0)).toBeCloseTo(a.y, 9);
    expect(g.levelX(2)).toBeCloseTo(a.x + (b.x - a.x) * 0.4, 9);
    // grid line (vertical level 2, mid-height)
    expect(d.hitTest(g.levelX(2), (a.y + b.y) / 2 + 0.3, rc)).toEqual({ type: 'body' });
    // 1x1 fan = diagonal
    expect(d.hitTest(a.x + (b.x - a.x) * 0.3, a.y + (b.y - a.y) * 0.3, rc)).toEqual({ type: 'body' });
    // arc through grid point (1,0): a point on the ellipse rx=|cellW|, ry=|cellH| at 45°
    const rx = Math.abs(g.cellW), ry = Math.abs(g.cellH);
    const ax = g.o.x + Math.sign(g.cellW) * rx * Math.SQRT1_2;
    const ay = g.o.y + Math.sign(g.cellH) * ry * Math.SQRT1_2;
    expect(d.hitTest(ax, ay, rc)).toEqual({ type: 'body' });
    // interior away from lines
    expect(d.hitTest(a.x + (b.x - a.x) * 0.9, a.y + (b.y - a.y) * 0.1, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(b.x + 200, b.y, rc)).toBeNull();
    expect(d.handles(rc).map((h) => h.index)).toEqual([0, 1]);
    d.style.reverse = true;
    expect(d.geometry(rc)!.o).toEqual(b);
    expect(() => d.render(rc)).not.toThrow();
  });

  it('fixed variant keeps the box square on screen (side = bar distance)', () => {
    const d = new GannSquareFixed();
    d.addPoint(at(20, 0.9)); d.addPoint(at(70, 1.1));
    const g = d.geometry(rc)!;
    const a = px(d.points[0]), b = px(d.points[1]);
    expect(Math.abs(g.cellW)).toBeCloseTo(Math.abs(g.cellH), 9);
    expect(g.f.x).toBeCloseTo(b.x, 9);
    expect(Math.sign(g.f.y - a.y)).toBe(Math.sign(b.y - a.y));
    const hs = d.handles(rc);
    expect(hs[1].x).toBeCloseTo(g.f.x, 9);
    expect(hs[1].y).toBeCloseTo(g.f.y, 9);
    expect(d.style.showLabels).toBe(false);
    expect(() => d.render(rc)).not.toThrow();
  });
});

describe('GannFan', () => {
  it('ray slopes are the 1x1 slope scaled by coeff1/coeff2, flattest first', () => {
    const d = new GannFan();
    d.addPoint(at(20, 0.9)); d.addPoint(at(60, 1.1));
    const a = px(d.points[0]), b = px(d.points[1]);
    const s = (b.y - a.y) / (b.x - a.x);
    const f = d.fan(rc);
    expect(f.rays.length).toBe(9);
    expect(f.slope).toBeCloseTo(s, 9);
    expect(f.rays.map((r) => r.factor)).toEqual([1 / 8, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 8]);
    for (const r of f.rays) {
      expect(r.slope).toBeCloseTo((s * r.l.coeff1) / r.l.coeff2, 9);
      expect(r.unit.y / r.unit.x).toBeCloseTo(r.slope, 9);
      expect(r.unit.x).toBeGreaterThan(0);
      expect(Math.hypot(r.unit.x, r.unit.y)).toBeCloseTo(1, 9);
    }
    const one = f.rays.find((r) => r.l.coeff1 === 1 && r.l.coeff2 === 1)!;
    expect(one.slope).toBeCloseTo(s, 9);
  });

  it('points left when p2 is left of p1 and survives a vertical 1x1', () => {
    const d = new GannFan();
    d.addPoint(at(60)); d.addPoint(at(20, 1.1));
    expect(d.fan(rc).sx).toBe(-1);
    for (const r of d.fan(rc).rays) expect(r.unit.x).toBeLessThan(0);
    const v = new GannFan();
    v.addPoint(at(40)); v.addPoint(at(40, 1.2));
    expect(v.fan(rc).rays.every((r) => Number.isFinite(r.unit.x) && Number.isFinite(r.unit.y))).toBe(true);
    expect(() => v.render(rc)).not.toThrow();
  });

  it('hit-tests rays, the fan interior and nothing behind the origin', () => {
    const d = new GannFan();
    d.addPoint(at(20, 0.9)); d.addPoint(at(60, 1.1));
    const { a, rays } = d.fan(rc);
    const two = rays.find((r) => r.factor === 2)!;
    expect(d.hitTest(a.x + two.unit.x * 120, a.y + two.unit.y * 120, rc)).toEqual({ type: 'body' });
    const mid = { x: (rays[4].unit.x + rays[5].unit.x) / 2, y: (rays[4].unit.y + rays[5].unit.y) / 2 };
    expect(d.hitTest(a.x + mid.x * 150, a.y + mid.y * 150, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(a.x - 40, a.y, rc)).toBeNull();
    expect(d.hitTest(a.x, a.y, rc)).toEqual({ type: 'point', index: 0 });
    d.style.showLabels = true;
    d.render(rc);
    expect(rc.ctx.calls.some((c) => c.startsWith('fillText("1/8"'))).toBe(true);
    expect(rc.ctx.calls.some((c) => c.startsWith('fillText("8/1"'))).toBe(true);
  });
});

describe('Pitchfork family', () => {
  const build = (ctor: new () => Pitchfork | SchiffPitchfork | ModifiedSchiffPitchfork | InsidePitchfork) => {
    const d = new ctor();
    d.addPoint(at(20, 0.95)); d.addPoint(at(50, 1.15)); d.addPoint(at(70, 0.9));
    return d;
  };
  const mid = (p: { x: number; y: number }, q: { x: number; y: number }) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

  it('median and tine math per variant', () => {
    const d = build(Pitchfork);
    const A = px(d.points[0]), B = px(d.points[1]), C = px(d.points[2]);
    const M = mid(B, C);
    const g = d.geometry(rc)!;
    expect(g.O).toEqual(A);
    expect(g.M).toEqual(M);
    const len = Math.hypot(M.x - A.x, M.y - A.y);
    expect(g.len).toBeCloseTo(len, 9);
    expect(g.unit.x).toBeCloseTo((M.x - A.x) / len, 9);
    expect(g.unit.y).toBeCloseTo((M.y - A.y) / len, 9);
    near(d.tineStart(g, 1, 1), C);
    near(d.tineStart(g, 1, -1), B);
    near(d.tineStart(g, 0.5, 1), mid(M, C));

    const sch = build(SchiffPitchfork);
    expect(sch.style.style).toBe(1);
    expect(sch.geometry(rc)!.O).toEqual({ x: A.x, y: (A.y + B.y) / 2 });

    const mod = build(ModifiedSchiffPitchfork);
    expect(mod.style.style).toBe(3);
    expect(mod.geometry(rc)!.O).toEqual(mid(A, B));

    const ins = build(InsidePitchfork);
    expect(ins.style.style).toBe(2);
    const gi = ins.geometry(rc)!;
    expect(gi.O).toEqual(A);
    expect(gi.half.x).toBeCloseTo((C.x - B.x) / 4, 9);
    expect(gi.half.y).toBeCloseTo((C.y - B.y) / 4, 9);
    // tines pass through the midpoints of A–B / A–C: same distance from the median as those points
    const distToMedian = (p: { x: number; y: number }) => Math.abs((p.x - A.x) * gi.unit.y - (p.y - A.y) * gi.unit.x);
    expect(distToMedian(ins.tineStart(gi, 1, -1))).toBeCloseTo(distToMedian(mid(A, B)), 6);

    // the style dropdown switches variants in place
    d.style.style = 3;
    expect(d.geometry(rc)!.O).toEqual(mid(A, B));
  });

  it('hit-tests handles, the median ray and the tines; extendLines reaches behind the origin', () => {
    const d = build(Pitchfork);
    const g = d.geometry(rc)!;
    const B = px(d.points[1]), C = px(d.points[2]);
    expect(d.hitTest(B.x, B.y, rc)).toEqual({ type: 'point', index: 1 });
    const onMedian = { x: g.O.x + g.unit.x * 120, y: g.O.y + g.unit.y * 120 };
    expect(d.hitTest(onMedian.x, onMedian.y, rc)).toEqual({ type: 'body' });
    const onTine = { x: C.x + g.unit.x * 60, y: C.y + g.unit.y * 60 };
    expect(d.hitTest(onTine.x, onTine.y, rc)).toEqual({ type: 'body' });
    const behind = { x: g.O.x - g.unit.x * 40, y: g.O.y - g.unit.y * 40 };
    expect(d.hitTest(behind.x, behind.y, rc)).toBeNull();
    d.style.extendLines = true;
    expect(d.hitTest(behind.x, behind.y, rc)).toEqual({ type: 'body' });
    d.style.medianVisible = false;
    d.style.extendLines = false;
    expect(d.hitTest(onMedian.x, onMedian.y, rc)).toBeNull();
  });

  it('renders every variant with labels, prices, fills and extension, plus the two-point preview', () => {
    for (const ctor of [Pitchfork, SchiffPitchfork, ModifiedSchiffPitchfork, InsidePitchfork]) {
      const d = build(ctor);
      Object.assign(d.style, { showLabels: true, showPrices: true, extendLines: true });
      (d.style.levels as FibLevel[]).forEach((l) => (l.visible = true));
      expect(() => d.render(rc)).not.toThrow();
      const prev = new ctor();
      prev.addPoint(at(20)); prev.addPoint(at(40));
      expect(() => prev.render({ ...rc, creating: true })).not.toThrow();
      expect(prev.hitTest(px(at(30)).x, (px(at(20)).y + px(at(40)).y) / 2, rc)?.type).toBe('body');
    }
    expect(rc.ctx.calls.some((c) => c.startsWith('fillText("0.5"'))).toBe(true);
  });
});

describe('Pitchfan', () => {
  it('rays run from A through the median point and the level points on B–C', () => {
    const d = new Pitchfan();
    d.addPoint(at(20, 0.95)); d.addPoint(at(50, 1.15)); d.addPoint(at(70, 0.9));
    const A = px(d.points[0]), B = px(d.points[1]), C = px(d.points[2]);
    const M = { x: (B.x + C.x) / 2, y: (B.y + C.y) / 2 };
    const f = d.rays(rc)!;
    expect(f.rays.length).toBe(5); // median + 2 visible levels × 2 sides
    expect(f.rays.map((r) => r.k)).toEqual([-1, -0.5, 0, 0.5, 1]);
    const median = f.rays.find((r) => r.k === 0)!;
    const lm = Math.hypot(M.x - A.x, M.y - A.y);
    expect(median.unit.x).toBeCloseTo((M.x - A.x) / lm, 9);
    expect(median.unit.y).toBeCloseTo((M.y - A.y) / lm, 9);
    near(f.rays.find((r) => r.k === 1)!.through, C);
    near(f.rays.find((r) => r.k === -1)!.through, B);
    expect(f.rays.find((r) => r.k === 0.5)!.color).toBe('#00BCD4');
    const c1 = f.rays.find((r) => r.k === 1)!;
    expect(d.hitTest(A.x + c1.unit.x * 200, A.y + c1.unit.y * 200, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(A.x - c1.unit.x * 30, A.y - c1.unit.y * 30, rc)).toBeNull();
    expect(d.hitTest(A.x, A.y, rc)).toEqual({ type: 'point', index: 0 });
    Object.assign(d.style, { showLabels: true, showPrices: true });
    expect(() => d.render(rc)).not.toThrow();
  });
});
