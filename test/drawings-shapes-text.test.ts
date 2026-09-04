import { describe, it, expect } from 'vitest';
import { makeDrawingContext } from './helpers/mockCanvas';
import { registerDrawingTool, type Drawing, type DrawingCtor, type DrawingRenderContext } from '../src/drawings/Drawing';
import { allBuiltinDrawings } from '../src/drawings/tools/index';
import { shapeTools, Rectangle, RotatedRectangle, Ellipse, Circle, Triangle, Arc, Curve, DoubleCurve, Polyline, Path, Brush, Highlighter } from '../src/drawings/tools/shapes';
import { textTools, TextTool, AnchoredText, Note, Pin, Callout, Comment, PriceLabel, PriceNote, Signpost, FlagMark, Table, Emoji, IconTool, bubblePath } from '../src/drawings/tools/text';
import { arrowsTools, ArrowMarker, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, arrowMarkerPolygon } from '../src/drawings/tools/arrows';
import { formatPrice } from '../src/util/format';
import { mockCtx } from './helpers/mockCanvas';

for (const c of allBuiltinDrawings()) registerDrawingTool(c);

const rc = makeDrawingContext(); // 800 x 400 pane
const at = (x: number, y: number) => rc.fromPixel(x, y);

function make<T extends Drawing>(ctor: DrawingCtor, pixels: Array<[number, number]>, style: Record<string, any> = {}, ctx: DrawingRenderContext = rc): T {
  const d = new ctor(style) as T;
  for (const [x, y] of pixels) d.points.push(ctx.fromPixel(x, y));
  d.creating = false;
  return d;
}

/** Rect equality tolerant to the float noise of the pixel → point → pixel round trip. */
function near(r: { x: number; y: number; w: number; h: number }, e: [number, number, number, number]): void {
  expect(r.x).toBeCloseTo(e[0], 6);
  expect(r.y).toBeCloseTo(e[1], 6);
  expect(r.w).toBeCloseTo(e[2], 6);
  expect(r.h).toBeCloseTo(e[3], 6);
}

const mine: DrawingCtor[] = [...shapeTools, ...textTools, ...arrowsTools];
const EXPECTED_IDS = ['brush', 'highlighter', 'rectangle', 'rotated_rectangle', 'ellipse', 'circle', 'polyline', 'path', 'triangle', 'arc', 'curve', 'double_curve',
  'text', 'anchored_text', 'note', 'anchored_note', 'pin', 'callout', 'comment', 'price_label', 'price_note', 'signpost', 'flag_mark', 'table', 'emoji', 'icon',
  'arrow_marker', 'arrow_up', 'arrow_down', 'arrow_left', 'arrow_right'];

describe('registration and metadata', () => {
  it('exports every expected tool exactly once and registers it', () => {
    const ids = mine.map((c) => c.toolId);
    expect(ids.sort()).toEqual([...EXPECTED_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
    const all = new Set(allBuiltinDrawings().map((c) => c.toolId));
    for (const id of EXPECTED_IDS) expect(all.has(id)).toBe(true);
  });
  it('has a display name, icon and group for every tool', () => {
    for (const c of mine) {
      expect(c.toolName.length).toBeGreaterThan(0);
      expect(c.icon).toContain('<svg');
      expect(c.icon).toContain('currentColor');
      expect(['shapes', 'text']).toContain(c.group);
    }
  });
  it('property defs cover the default style (and nothing more)', () => {
    const allow = new Set(['cells']);
    for (const c of mine) {
      const d = new c();
      const keys = new Set(d.propertyDefs().filter((p) => p.type !== 'section').map((p) => p.key));
      for (const k of keys) expect(k in d.defaultStyle(), `${c.toolId}: def ${k} missing in defaultStyle`).toBe(true);
      for (const k of Object.keys(d.defaultStyle())) if (!allow.has(k)) expect(keys.has(k), `${c.toolId}: style ${k} has no property def`).toBe(true);
    }
  });
  it('renders during creation with one point and with the pending point', () => {
    for (const c of mine) {
      const d = new c();
      d.creating = true;
      d.addPoint(at(100, 100));
      expect(() => d.render({ ...rc, creating: true })).not.toThrow();
      d.addPoint(at(100, 100));
      expect(() => d.render({ ...rc, creating: true })).not.toThrow();
      expect(() => d.hitTest(100, 100, rc)).not.toThrow();
      expect(() => d.handles(rc)).not.toThrow();
    }
  });
});

describe('Rectangle', () => {
  it('hit-tests edges, inside and corners; has 8 handles', () => {
    const d = make<Rectangle>(Rectangle, [[100, 100], [300, 200]]);
    d.render(rc);
    expect(d.handles(rc).length).toBe(8);
    expect(d.hitTest(200, 150, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(100, 130, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(100, 150, rc)).toEqual({ type: 'point', index: 7 }); // left-edge midpoint handle
    expect(d.hitTest(50, 50, rc)).toBeNull();
    expect(d.hitTest(300, 100, rc)).toEqual({ type: 'point', index: 2 });
    expect(d.hitTest(200, 100, rc)).toEqual({ type: 'point', index: 4 });
  });
  it('unfilled rectangle is only hit on its border', () => {
    const d = make<Rectangle>(Rectangle, [[100, 100], [300, 200]], { fillBackground: false });
    expect(d.hitTest(200, 150, rc)).toBeNull();
    expect(d.hitTest(250, 200, rc)).toEqual({ type: 'body' });
  });
  it('corner and edge handles resize the rectangle', () => {
    const d = make<Rectangle>(Rectangle, [[100, 100], [300, 200]]);
    d.movePoint(2, at(350, 80));
    let r = d.rect(rc);
    expect([r.x1, r.y1, r.x2, r.y2].map(Math.round)).toEqual([100, 80, 350, 200]);
    d.movePoint(6, at(0, 260)); // bottom edge
    r = d.rect(rc);
    expect(Math.round(r.y2)).toBe(260);
    d.movePoint(7, at(60, 0)); // left edge
    r = d.rect(rc);
    expect(Math.round(r.x1)).toBe(60);
  });
  it('derives the fill from an injected line colour', () => {
    expect(new Rectangle({ lineColor: '#FF0000' }).style.fillColor).toBe('rgba(255, 0, 0, 0.2)');
    expect(new Rectangle({ lineColor: '#FF0000', fillColor: 'blue' }).style.fillColor).toBe('blue');
    expect(new Rectangle().style.fillColor).toBe('rgba(156, 39, 176, 0.2)');
  });
});

describe('Circle', () => {
  it('uses the pixel distance to the radius point as radius', () => {
    const d = make<Circle>(Circle, [[400, 200], [450, 200]]);
    expect(d.radius(rc)).toBeCloseTo(50, 5);
    d.render(rc);
    expect(d.hitTest(400, 150, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(420, 200, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(400, 260, rc)).toBeNull();
    expect(d.hitTest(450, 200, rc)).toEqual({ type: 'point', index: 1 });
  });
});

describe('Ellipse', () => {
  it('is defined by an axis and a minor radius', () => {
    const d = make<Ellipse>(Ellipse, [[200, 200], [400, 200], [300, 150]]);
    const g = d.geom(rc);
    expect(g.rx).toBeCloseTo(100, 4);
    expect(g.ry).toBeCloseTo(50, 4);
    expect(g.angle).toBeCloseTo(0, 6);
    d.render(rc);
    expect(d.hitTest(300, 200, rc)).toEqual({ type: 'body', part: 'inside' });
    const t = Math.PI / 4;
    expect(d.hitTest(300 + 100 * Math.cos(t), 200 + 50 * Math.sin(t), rc)).toEqual({ type: 'body' });
    expect(d.hitTest(300, 300, rc)).toBeNull();
    expect(d.hitTest(300, 150, rc)).toEqual({ type: 'point', index: 2 });
    expect(d.handles(rc).length).toBe(4);
  });
  it('supports a rotated axis', () => {
    const n = Math.SQRT1_2;
    const d = make<Ellipse>(Ellipse, [[200, 200], [300, 300], [250 - n * 30, 250 + n * 30]]);
    const g = d.geom(rc);
    expect(g.angle).toBeCloseTo(Math.PI / 4, 6);
    expect(g.ry).toBeCloseTo(30, 4);
    expect(d.hitTest(250, 250, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(200, 300, rc)).toBeNull();
  });
});

describe('Rotated rectangle', () => {
  it('builds the far edge from the perpendicular distance of the third point', () => {
    const d = make<RotatedRectangle>(RotatedRectangle, [[100, 100], [300, 100], [300, 180]]);
    const c = d.corners(rc).map((p) => [Math.round(p.x), Math.round(p.y)]);
    expect(c).toEqual([[100, 100], [300, 100], [300, 180], [100, 180]]);
    d.render(rc);
    expect(d.hitTest(200, 140, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(200, 100, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(200, 300, rc)).toBeNull();
    expect(d.hitTest(100, 180, rc)).toEqual({ type: 'point', index: 3 });
  });
});

describe('Triangle', () => {
  it('hits the inside of a filled triangle', () => {
    const d = make<Triangle>(Triangle, [[100, 300], [300, 300], [200, 100]]);
    expect(d.hitTest(200, 250, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(200, 300, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(50, 50, rc)).toBeNull();
  });
});

describe('Arc', () => {
  it('draws the circle through three points and fills to the chord', () => {
    const d = make<Arc>(Arc, [[100, 200], [300, 200], [200, 100]]);
    const g = d.geom(rc);
    expect(g && !g.line && Math.round(g.cx) === 200 && Math.round(g.cy) === 200 && Math.round(g.r) === 100).toBe(true);
    d.render(rc);
    const k = 100 * Math.SQRT1_2;
    expect(d.hitTest(200 - k, 200 - k, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(200, 150, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(200, 250, rc)).toBeNull();
    expect(d.hitTest(200 + k, 200 + k, rc)).toBeNull(); // opposite half of the circle is not part of the arc
  });
  it('degrades to a line for collinear points', () => {
    const d = make<Arc>(Arc, [[100, 100], [300, 100], [200, 100]]);
    expect(() => d.render(rc)).not.toThrow();
    expect(d.hitTest(150, 100, rc)).toEqual({ type: 'body' });
  });
});

describe('Curves', () => {
  it('quadratic curve passes through B(0.5)', () => {
    const d = make<Curve>(Curve, [[100, 300], [300, 300], [200, 100]]);
    d.render(rc);
    expect(d.hitTest(200, 200, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(200, 250, rc)).toBeNull();
    d.style.fillBackground = true;
    expect(d.hitTest(200, 250, rc)).toEqual({ type: 'body', part: 'inside' });
  });
  it('cubic curve passes through B(0.5) and renders with extensions and arrows', () => {
    const d = make<DoubleCurve>(DoubleCurve, [[100, 300], [300, 300], [150, 100], [250, 100]], { extendLeft: true, extendRight: true, leftEnd: 1, rightEnd: 1 });
    expect(() => d.render(rc)).not.toThrow();
    expect(d.hitTest(200, 150, rc)).toEqual({ type: 'body' });
    expect(d.style.lineColor).toBe('#673AB7');
  });
});

describe('Polyline / Path', () => {
  it('keeps adding vertices until closed by clicking the first point', () => {
    const d = new Polyline();
    d.creating = true;
    expect(d.addPoint(at(100, 100))).toBe(false);
    d.addPoint(at(100, 100)); // pending
    d.updatePendingPoint(at(200, 100));
    expect(d.isComplete()).toBe(false);
    d.addPoint(at(200, 100));
    d.updatePendingPoint(at(200, 200));
    expect(d.isComplete()).toBe(false);
    d.addPoint(at(200, 200));
    d.updatePendingPoint(at(101, 101));
    d.render({ ...rc, creating: true });
    expect(d.isComplete()).toBe(true);
    expect(d.points.length).toBe(3);
    expect(d.style.filled).toBe(true);
    d.creating = false;
    expect(d.hitTest(170, 130, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(150, 100, rc)).toEqual({ type: 'body' });
  });
  it('path is open, finishes on double-click (never auto-completes) and draws an arrow head', () => {
    const d = new Path();
    d.creating = true;
    expect(d.addPoint(at(100, 100))).toBe(false);
    d.addPoint(at(200, 150));
    expect(d.isComplete()).toBe(false);
    d.creating = false;
    expect(d.isComplete()).toBe(true);
    expect(d.style.rightEnd).toBe(1);
    d.render(rc);
    expect(d.hitTest(150, 125, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(150, 160, rc)).toBeNull();
    expect(Path.pointsCount).not.toBe(0);
  });
});

describe('Brush / Highlighter', () => {
  it('brush is freehand and hit along its stroke', () => {
    expect(Brush.pointsCount).toBe(0);
    const d = make<Brush>(Brush, [[100, 100], [150, 120], [200, 100], [250, 130]]);
    d.render(rc);
    expect(d.handles(rc).map((h) => h.index)).toEqual([0, 3]);
    expect(d.hitTest(125, 110, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(125, 200, rc)).toBeNull();
  });
  it('highlighter keeps its wide translucent stroke when the chart injects default line colour/width', () => {
    const d = make<Highlighter>(Highlighter, [[100, 100], [300, 100]], { lineColor: '#2962FF', lineWidth: 2, textColor: '#2962FF' });
    expect(d.style.color).toBe('rgba(242, 54, 69, 0.2)');
    expect(d.style.width).toBe(20);
    d.render(rc);
    expect(d.hitTest(200, 110, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(200, 130, rc)).toBeNull();
  });
});

describe('Text', () => {
  it('lays out a box at the anchor and hit-tests it', () => {
    const d = make<TextTool>(TextTool, [[100, 100]], { text: 'Hello' });
    d.render(rc);
    near(d.box!, [100, 100, 43, 26]);
    expect(d.hitTest(120, 110, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(300, 300, rc)).toBeNull();
    expect(d.hitTest(100, 100, rc)).toEqual({ type: 'point', index: 0 });
  });
  it('wraps text at the wrap width', () => {
    const d = make<TextTool>(TextTool, [[100, 100]], { text: 'aaaa bbbb cccc dddd', wrap: true, wrapWidth: 60 });
    d.render(rc);
    expect(d.box!.h).toBe(4 * 18 + 8);
    expect(d.box!.w).toBe(60 + 8);
  });
});

describe('Anchored text', () => {
  it('stays at a fixed pane position while the chart scrolls, follows drags, and round-trips', () => {
    const ctx = makeDrawingContext();
    const d = make<AnchoredText>(AnchoredText, [[100, 100]], { text: 'Hi' }, ctx);
    d.onChanged();
    d.render(ctx);
    expect(d.style.anchorX).toBeCloseTo(12.5, 5);
    expect(d.style.anchorY).toBeCloseTo(25, 5);
    expect(d.box!.x).toBeCloseTo(100, 5);
    expect(d.box!.y).toBeCloseTo(100, 5);
    // scrolling the time scale moves the point but not the box
    ctx.timeScale.scrollBy(60);
    expect(ctx.toPixel(d.points[0]).x).not.toBeCloseTo(100, 0);
    d.render(ctx);
    expect(d.box!.x).toBeCloseTo(100, 5);
    // a body drag (points shifted + onChanged) moves the box by the same screen delta
    const cur = ctx.toPixel(d.points[0]);
    d.points[0] = ctx.fromPixel(cur.x + 30, cur.y + 10);
    d.onChanged();
    d.render(ctx);
    expect(d.box!.x).toBeCloseTo(130, 4);
    expect(d.box!.y).toBeCloseTo(110, 4);
    // a handle drag places the box under the pointer
    d.movePoint(0, ctx.fromPixel(500, 300));
    d.render(ctx);
    expect(d.box!.x).toBeCloseTo(500, 4);
    expect(d.box!.y).toBeCloseTo(300, 4);
    expect(d.handles(ctx)[0].x).toBeCloseTo(500, 4);
    // serialized percentages are authoritative after a reload
    const copy = new AnchoredText();
    copy.applySerialized(d.serialize());
    ctx.timeScale.scrollBy(-200);
    copy.render(ctx);
    expect(copy.box!.x).toBeCloseTo(500, 4);
    expect(copy.box!.y).toBeCloseTo(300, 4);
    expect(new AnchoredText({ anchorX: 50, anchorY: 50 }).style.anchorX).toBe(50);
  });
  it('honours the box alignment', () => {
    const ctx = makeDrawingContext();
    const d = make<AnchoredText>(AnchoredText, [[400, 200]], { text: 'Hi', hAlign: 'right', vAlign: 'bottom' }, ctx);
    d.render(ctx);
    expect(d.box!.x + d.box!.w).toBeCloseTo(400, 4);
    expect(d.box!.y + d.box!.h).toBeCloseTo(200, 4);
  });
});

describe('Note / Pin', () => {
  it('shows the popup only on hover/selection (or always)', () => {
    const d = make<Note>(Note, [[300, 300]], { text: 'hello' });
    d.render(rc);
    expect(d.box).toBeNull();
    expect(d.markerRect).not.toBeNull();
    expect(d.hitTest(300, 290, rc)).toEqual({ type: 'body', part: 'marker' });
    d.render({ ...rc, hovered: true });
    expect(d.box).not.toBeNull();
    expect(d.hitTest(d.box!.x + 5, d.box!.y + 5, rc)).toEqual({ type: 'body' });
    expect(d.box!.y + d.box!.h).toBeLessThan(d.markerRect!.y);
    d.style.alwaysShowText = true;
    d.render(rc);
    expect(d.box).not.toBeNull();
  });
  it('pin uses a pin glyph with the tip at the point', () => {
    const d = make<Pin>(Pin, [[300, 300]], { text: 'p' });
    d.render(rc);
    expect(d.box).toBeNull();
    expect(d.markerRect!.y + d.markerRect!.h).toBeGreaterThanOrEqual(300);
    expect(d.hitTest(300, 285, rc)).toEqual({ type: 'body', part: 'marker' });
  });
});

describe('Callout / Comment / Price label / Price note', () => {
  it('callout centres the box on the second point with a tail to the first', () => {
    const d = make<Callout>(Callout, [[100, 300], [300, 150]], { text: 'Hey' });
    d.render(rc);
    const b = d.box!;
    expect(b.x + b.w / 2).toBeCloseTo(300, 4);
    expect(b.y + b.h / 2).toBeCloseTo(150, 4);
    expect(d.hitTest(310, 150, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(200, 225, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(600, 50, rc)).toBeNull();
    expect(d.hitTest(100, 300, rc)).toEqual({ type: 'point', index: 0 });
    expect(d.style.color).toBe('#FFFFFF');
  });
  it('comment bubble sits above-right of the anchor', () => {
    const d = make<Comment>(Comment, [[200, 200]]);
    d.render(rc);
    const b = d.box!;
    expect(b.x).toBeCloseTo(212, 4);
    expect(b.y + b.h).toBeCloseTo(186, 4);
    expect(b.w).toBe(65);
    expect(b.h).toBe(37);
    expect(d.hitTest(b.x + 5, b.y + 5, rc)).toEqual({ type: 'body' });
  });
  it('price label shows the formatted price of its point', () => {
    const d = make<PriceLabel>(PriceLabel, [[200, 200]]);
    const expected = formatPrice(d.points[0].price, rc.priceFormat);
    expect(d.labelText(rc)).toBe(expected);
    d.render(rc);
    expect(rc.ctx.calls.some((c) => c.startsWith(`fillText(${JSON.stringify(expected)}`))).toBe(true);
    expect(d.style.bold).toBe(true);
    expect(d.hitTest(d.box!.x + 3, d.box!.y + 3, rc)).toEqual({ type: 'body' });
  });
  it('price note joins the price with the custom text and is hit along its line', () => {
    const d = make<PriceNote>(PriceNote, [[100, 200], [300, 120]], { text: 'buy' });
    const price = formatPrice(d.points[0].price, rc.priceFormat);
    expect(d.labelText(rc)).toBe(`${price} buy`);
    d.style.showPrice = false;
    expect(d.labelText(rc)).toBe('buy');
    d.style.showPrice = true;
    d.render(rc);
    expect(d.hitTest(200, 200, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(300, 160, rc)).toEqual({ type: 'body' });
    expect(d.box!.y + d.box!.h).toBeCloseTo(120, 4);
    expect(d.hitTest(200, 300, rc)).toBeNull();
  });
});

describe('Signpost / Flag / Emoji / Icon', () => {
  it('signpost plate is at a pane-relative height and only moves vertically', () => {
    const d = make<Signpost>(Signpost, [[200, 300]]);
    d.render(rc);
    expect(d.plateY(rc)).toBe(100);
    const hs = d.handles(rc);
    expect(hs.length).toBe(2);
    expect(hs[1].x).toBeCloseTo(200, 6);
    expect(hs[1].y).toBe(100);
    expect(hs[1].index).toBe(1);
    expect(d.hitTest(200, 200, rc)).toEqual({ type: 'body' }); // on the stem
    const before = { ...d.points[0] };
    d.movePoint(1, at(50, 200));
    expect(d.style.platePosition).toBeCloseTo(50, 5);
    expect(d.points[0]).toEqual(before);
    d.render(rc);
    expect(d.plateY(rc)).toBeCloseTo(200, 5);
    expect(d.hitTest(200, 250, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(200, 300, rc)).toEqual({ type: 'point', index: 0 });
    expect(d.hitTest(200, d.plateY(rc), rc)).toEqual({ type: 'point', index: 1 });
    expect(d.plate).not.toBeNull();
  });
  it('flag mark is hit on its glyph', () => {
    const d = make<FlagMark>(FlagMark, [[200, 300]]);
    d.render(rc);
    expect(d.hitTest(206, 286, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(250, 300, rc)).toBeNull();
    expect(d.style.flagColor).toBe('#2962FF');
  });
  it('emoji renders its glyph at the configured size', () => {
    const d = make<Emoji>(Emoji, [[200, 200]], { emoji: '🚀', size: 40 });
    d.render(rc);
    expect(rc.ctx.calls.some((c) => c.startsWith('fillText("🚀"'))).toBe(true);
    expect(d.hitTest(215, 215, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(230, 230, rc)).toBeNull();
  });
  it('icon draws a built-in glyph and falls back for unknown names', () => {
    for (const icon of ['star', 'heart', 'check', 'cross', 'bolt', 'nope']) {
      const d = make<IconTool>(IconTool, [[200, 200]], { icon });
      expect(() => d.render(rc)).not.toThrow();
    }
    const d = make<IconTool>(IconTool, [[200, 200]], { size: 20 });
    expect(d.hitTest(208, 208, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(215, 215, rc)).toBeNull();
  });
});

describe('Table', () => {
  it('lays out equal cells between its corner points', () => {
    const d = make<Table>(Table, [[100, 100], [400, 250]]);
    const cells = d.cellRects(rc);
    expect(cells.length).toBe(3);
    expect(cells[0].length).toBe(3);
    near(cells[0][0], [100, 100, 100, 50]);
    near(cells[2][2], [300, 200, 100, 50]);
    expect(d.cellAtPixel(350, 230, rc)).toEqual({ row: 2, col: 2 });
    expect(d.cellAtPixel(50, 50, rc)).toBeNull();
  });
  it('stores cell text and grows the grid', () => {
    const d = make<Table>(Table, [[100, 100], [400, 250]]);
    d.setCell(1, 1, 'mid');
    expect(d.getCell(1, 1)).toBe('mid');
    expect(d.getCell(0, 0)).toBe('');
    d.render(rc);
    expect(rc.ctx.calls.some((c) => c.startsWith('fillText("mid"'))).toBe(true);
    d.addRow();
    d.addColumn();
    expect(d.rows).toBe(4);
    expect(d.cols).toBe(4);
    near(d.cellRects(rc)[3][3], [325, 212.5, 75, 37.5]);
    d.setCell(5, 5, 'far');
    expect(d.rows).toBe(6);
    expect(d.cols).toBe(6);
    d.removeRow(0);
    expect(d.rows).toBe(5);
    const s = d.serialize();
    const copy = new Table();
    copy.applySerialized(s);
    expect(copy.getCell(4, 5)).toBe('far');
  });
  it('hit-tests corners, border and inside', () => {
    const d = make<Table>(Table, [[100, 100], [400, 250]]);
    expect(d.hitTest(400, 100, rc)).toEqual({ type: 'point', index: 2 });
    expect(d.hitTest(250, 100, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(250, 175, rc)).toEqual({ type: 'body', part: 'inside' });
    expect(d.hitTest(50, 50, rc)).toBeNull();
    d.movePoint(3, at(80, 300));
    const r = d.rect(rc);
    expect([r.x1, r.y1, r.x2, r.y2].map(Math.round)).toEqual([80, 100, 400, 300]);
  });
});

describe('Arrows', () => {
  it('arrow marks use TradingView default colours and point in their direction', () => {
    expect(new ArrowUp().style.arrowColor).toBe('#089981');
    expect(new ArrowDown().style.arrowColor).toBe('#CC2F3C');
    expect(new ArrowLeft().style.arrowColor).toBe('#2962FF');
    expect(new ArrowRight().style.arrowColor).toBe('#2962FF');
    const up = make<ArrowUp>(ArrowUp, [[200, 200]]);
    expect(up.hitTest(200, 215, rc)).toEqual({ type: 'body' });
    expect(up.hitTest(200, 185, rc)).toBeNull();
    const down = make<ArrowDown>(ArrowDown, [[200, 200]]);
    expect(down.hitTest(200, 185, rc)).toEqual({ type: 'body' });
    expect(down.hitTest(200, 215, rc)).toBeNull();
    const left = make<ArrowLeft>(ArrowLeft, [[200, 200]]);
    expect(left.hitTest(215, 200, rc)).toEqual({ type: 'body' });
    expect(left.hitTest(185, 200, rc)).toBeNull();
    const right = make<ArrowRight>(ArrowRight, [[200, 200]]);
    expect(right.hitTest(185, 200, rc)).toEqual({ type: 'body' });
    expect(right.hitTest(215, 200, rc)).toBeNull();
  });
  it('arrow mark label is drawn beside the glyph and is hit-testable', () => {
    const d = make<ArrowUp>(ArrowUp, [[200, 200]], { text: 'Buy' });
    d.render(rc);
    expect(rc.ctx.calls.some((c) => c.startsWith('fillText("Buy"'))).toBe(true);
    expect(d.hitTest(200, 235, rc)).toEqual({ type: 'body', part: 'text' });
    d.style.showLabel = false;
    d.render(rc);
    expect(d.hitTest(200, 235, rc)).toBeNull();
  });
  it('arrow marker is a filled polygon from tail to head', () => {
    const poly = arrowMarkerPolygon({ x: 100, y: 200 }, { x: 300, y: 200 });
    expect(poly.length).toBe(7);
    expect(poly[3]).toEqual({ x: 300, y: 200 });
    expect(arrowMarkerPolygon({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
    const d = make<ArrowMarker>(ArrowMarker, [[100, 200], [300, 200]], { text: 'go' });
    d.render(rc);
    expect(d.hitTest(200, 200, rc)).toEqual({ type: 'body' });
    expect(d.hitTest(200, 230, rc)).toBeNull();
    expect(d.hitTest(300, 200, rc)).toEqual({ type: 'point', index: 1 });
    const dot = make<ArrowMarker>(ArrowMarker, [[100, 200], [100, 200]]);
    expect(() => dot.render(rc)).not.toThrow();
    expect(dot.polygon(rc)).toEqual([]);
  });
});

describe('bubblePath', () => {
  it('adds a wedge towards an outside tip and none for an inside tip', () => {
    const ctx = mockCtx();
    bubblePath(ctx, 100, 100, 80, 40, 4, { x: 50, y: 200 });
    expect(ctx.calls).toContain('lineTo(50,200)');
    const ctx2 = mockCtx();
    bubblePath(ctx2, 100, 100, 80, 40, 4, { x: 120, y: 120 });
    expect(ctx2.calls.some((c) => c === 'lineTo(120,120)')).toBe(false);
    expect(ctx2.calls.filter((c) => c.startsWith('arcTo')).length).toBe(4);
  });
});
