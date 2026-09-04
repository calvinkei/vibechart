import { Drawing, P, HIT_TOLERANCE, type DrawingPoint, type DrawingRenderContext, type FibLevel, type HitTarget, type PixelPoint, type PropertyDef } from '../Drawing';
import { applyLine, drawExtendedLine, drawTextBox, fontFor } from './common';
import { formatPrice } from '../../util/format';
import { withAlpha } from '../../util/color';
import { clamp, clipLineToRect, distToRay, distToSegment, pointInRect } from '../../util/math';
import { crisp } from '../../render/canvas';

type Handle = PixelPoint & { index: number };

const HANDLE_HIT = 7;
const LABEL_GREY = '#787B86';

/** Gann box price/time levels (TV `linetoolgannsquare` hlevel/vlevel defaults). */
export const GANN_BOX_LEVELS: FibLevel[] = [
  { coeff: 0, color: '#808080', visible: true },
  { coeff: 0.25, color: '#FF9800', visible: true },
  { coeff: 0.382, color: '#00BCD4', visible: true },
  { coeff: 0.5, color: '#4CAF50', visible: true },
  { coeff: 0.618, color: '#089981', visible: true },
  { coeff: 0.75, color: '#2962FF', visible: true },
  { coeff: 1, color: '#808080', visible: true },
];

/** Gann square grid levels 0..5 (TV `linetoolganncomplex` / `linetoolgannfixed` levels). */
export const GANN_SQUARE_LEVELS: FibLevel[] = [
  { coeff: 0, color: '#808080', visible: true },
  { coeff: 1, color: '#FF9800', visible: true },
  { coeff: 2, color: '#00BCD4', visible: true },
  { coeff: 3, color: '#4CAF50', visible: true },
  { coeff: 4, color: '#089981', visible: true },
  { coeff: 5, color: '#808080', visible: true },
];

/** A level defined by an (x, y) ratio in grid units; `coeff` mirrors it for the generic level editor. */
export interface GannRatioLevel extends FibLevel { x: number; y: number }

const fanRatio = (x: number, y: number, color: string, visible: boolean): GannRatioLevel => ({ x, y, coeff: x / y, color, visible });
const arcRatio = (x: number, y: number, color: string): GannRatioLevel => ({ x, y, coeff: Math.hypot(x, y), color, visible: true });

/** Gann square fan lines `x:y` (TV fanlines defaults; coeff = x/y). */
export const GANN_SQUARE_FANS: GannRatioLevel[] = [
  fanRatio(8, 1, '#B39DDB', false), fanRatio(5, 1, '#F23645', false), fanRatio(4, 1, '#808080', false), fanRatio(3, 1, '#FF9800', false),
  fanRatio(2, 1, '#00BCD4', true), fanRatio(1, 1, '#4CAF50', true), fanRatio(1, 2, '#089981', true),
  fanRatio(1, 3, '#089981', false), fanRatio(1, 4, '#2962FF', false), fanRatio(1, 5, '#9575CD', false), fanRatio(1, 8, '#B39DDB', false),
];

/** Gann square arcs through grid point (x, y) (TV arcs defaults; coeff = radius in grid units). */
export const GANN_SQUARE_ARCS: GannRatioLevel[] = [
  arcRatio(1, 0, '#FF9800'), arcRatio(1, 1, '#FF9800'), arcRatio(1.5, 0, '#FF9800'),
  arcRatio(2, 0, '#00BCD4'), arcRatio(2, 1, '#00BCD4'), arcRatio(3, 0, '#4CAF50'), arcRatio(3, 1, '#4CAF50'),
  arcRatio(4, 0, '#089981'), arcRatio(4, 1, '#089981'), arcRatio(5, 0, '#2962FF'), arcRatio(5, 1, '#2962FF'),
];

/** Gann fan angle `coeff1 x coeff2` (price units per time units); `coeff` = coeff1/coeff2 = slope factor vs the 1x1 line. */
export interface GannFanLevel extends FibLevel { coeff1: number; coeff2: number }

const fanLevel = (coeff1: number, coeff2: number, color: string): GannFanLevel => ({ coeff1, coeff2, coeff: coeff1 / coeff2, color, visible: true });

/** Gann fan defaults (TV `linetoolgannfan` level1..level9). */
export const GANN_FAN_LEVELS: GannFanLevel[] = [
  fanLevel(1, 8, '#FF9800'), fanLevel(1, 4, '#089981'), fanLevel(1, 3, '#4CAF50'), fanLevel(1, 2, '#089981'), fanLevel(1, 1, '#00BCD4'),
  fanLevel(2, 1, '#2962FF'), fanLevel(3, 1, '#9C27B0'), fanLevel(4, 1, '#E91E63'), fanLevel(8, 1, '#F23645'),
];

function cloneLevels<T extends FibLevel>(levels: T[]): T[] { return levels.map((l) => ({ ...l })); }

function fmtCoeff(c: number): string { return String(+c.toFixed(3)); }

function hitHandle(handles: Handle[], x: number, y: number): HitTarget {
  for (const h of handles) if (Math.hypot(h.x - x, h.y - y) <= HANDLE_HIT) return { type: 'point', index: h.index };
  return null;
}

function alphaOf(transparency: unknown): number { return (100 - clamp(Number(transparency) || 0, 0, 100)) / 100; }

/** Grid-unit vector of a ratio level (falls back to coeff:1 when x/y were not provided). */
function ratioVec(l: GannRatioLevel): { x: number; y: number } {
  return typeof l.x === 'number' && typeof l.y === 'number' ? { x: l.x, y: l.y } : { x: l.coeff, y: 1 };
}

function arcRadius(l: GannRatioLevel): number {
  return typeof l.x === 'number' && typeof l.y === 'number' ? Math.hypot(l.x, l.y) : l.coeff;
}

function fanFactor(l: GannFanLevel): number {
  return typeof l.coeff1 === 'number' && typeof l.coeff2 === 'number' && l.coeff2 !== 0 ? l.coeff1 / l.coeff2 : l.coeff;
}

function fanLabel(l: GannFanLevel): string {
  if (typeof l.coeff1 === 'number' && typeof l.coeff2 === 'number') return `${l.coeff1}/${l.coeff2}`;
  const f = fanFactor(l);
  return f >= 1 ? `${fmtCoeff(f)}/1` : `1/${fmtCoeff(1 / f)}`;
}

/** Start/end canvas angles sweeping the quadrant that contains the box (cellW/cellH signed). */
function arcSweep(cellW: number, cellH: number): [number, number] {
  if (cellW >= 0 && cellH >= 0) return [0, Math.PI / 2];
  if (cellW >= 0) return [1.5 * Math.PI, 2 * Math.PI];
  if (cellH >= 0) return [Math.PI / 2, Math.PI];
  return [Math.PI, 1.5 * Math.PI];
}

/** Position/alignment for a label at the visible end of a ray from `from` along `unit`. */
function rayLabelPos(rc: DrawingRenderContext, from: PixelPoint, unit: PixelPoint): { x: number; y: number; align: 'left' | 'center' | 'right'; vAlign: 'top' | 'middle' | 'bottom' } | null {
  const seg = clipLineToRect(from.x, from.y, from.x + unit.x, from.y + unit.y, 0, 0, rc.width, rc.height, false, true);
  if (!seg) return null;
  const ex = seg[2], ey = seg[3];
  return {
    x: ex - unit.x * 10, y: ey - unit.y * 10,
    align: ex >= rc.width - 1 ? 'right' : ex <= 1 ? 'left' : 'center',
    vAlign: ey <= 1 ? 'top' : ey >= rc.height - 1 ? 'bottom' : 'middle',
  };
}

// ---------------------------------------------------------------------------------------------
// Gann box
// ---------------------------------------------------------------------------------------------

interface BoxLevel<T> { l: FibLevel; pos: number; extra: T }

/**
 * Gann Box (TV `linetoolgannsquare`): rectangle p1–p2 with horizontal price levels and vertical time
 * levels at fib/gann coefficients, per-level fills, side labels, optional corner angles and reverse.
 */
export class GannBox extends Drawing {
  static override toolId = 'gann_box';
  static override toolName = 'Gann Box';
  static override pointsCount = 2;
  static override group = 'gann' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4 4h20v20H4zm1 1v18h18V5z"/><path fill="currentColor" d="M5 10h18v1H5zM5 17h18v1H5zM10 5h1v18h-1zM17 5h1v18h-1z"/></svg>';

  defaultStyle() {
    return {
      lineWidth: 2, lineStyle: 0,
      hLevels: cloneLevels(GANN_BOX_LEVELS), vLevels: cloneLevels(GANN_BOX_LEVELS),
      showFans: false, fansColor: '#9C9C9C',
      fillHorzBackground: true, horzTransparency: 80, fillVertBackground: true, vertTransparency: 80,
      showTopLabels: true, showBottomLabels: true, showLeftLabels: true, showRightLabels: true,
      reverse: false,
    };
  }

  propertyDefs(): PropertyDef[] {
    return [
      { key: 'hLevels', label: 'Price levels', type: 'fibLevels', group: 'Levels' },
      { key: 'vLevels', label: 'Time levels', type: 'fibLevels', group: 'Levels' },
      P.lineWidth('lineWidth'), P.lineStyle('lineStyle'),
      P.bool('showFans', 'Angles'), P.color('fansColor', 'Angles color'),
      P.bool('fillHorzBackground', 'Price levels background'), P.int('horzTransparency', 'Price levels transparency', 0, 100),
      P.bool('fillVertBackground', 'Time levels background'), P.int('vertTransparency', 'Time levels transparency', 0, 100),
      P.bool('reverse', 'Reverse'),
      P.bool('showLeftLabels', 'Left labels', 'Text'), P.bool('showRightLabels', 'Right labels', 'Text'),
      P.bool('showTopLabels', 'Top labels', 'Text'), P.bool('showBottomLabels', 'Bottom labels', 'Text'),
    ];
  }

  private _geom(rc: DrawingRenderContext) {
    const p0 = this.points[0];
    const p1 = this.points[1] ?? p0;
    const a = rc.toPixel(p0);
    const b = rc.toPixel(p1);
    const rev = !!this.style.reverse;
    const c = (v: number) => (rev ? 1 - v : v);
    const hs: Array<BoxLevel<number>> = (this.style.hLevels as FibLevel[]).filter((l) => l.visible)
      .map((l) => { const price = p0.price + (p1.price - p0.price) * c(l.coeff); return { l, pos: rc.priceScale.priceToY(price), extra: price }; })
      .sort((p, q) => p.l.coeff - q.l.coeff);
    const vs: Array<BoxLevel<null>> = (this.style.vLevels as FibLevel[]).filter((l) => l.visible)
      .map((l) => ({ l, pos: a.x + (b.x - a.x) * c(l.coeff), extra: null }))
      .sort((p, q) => p.l.coeff - q.l.coeff);
    return { a, b, hs, vs, left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
  }

  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const { ctx, dpr } = rc;
    const s = this.style;
    const g = this._geom(rc);
    const w = g.right - g.left, h = g.bottom - g.top;
    if (s.fillHorzBackground && w > 0) {
      const alpha = alphaOf(s.horzTransparency);
      for (let i = 1; i < g.hs.length; i++) {
        ctx.fillStyle = withAlpha(g.hs[i].l.color, alpha);
        ctx.fillRect(g.left, Math.min(g.hs[i - 1].pos, g.hs[i].pos), w, Math.abs(g.hs[i].pos - g.hs[i - 1].pos));
      }
    }
    if (s.fillVertBackground && h > 0) {
      const alpha = alphaOf(s.vertTransparency);
      for (let i = 1; i < g.vs.length; i++) {
        ctx.fillStyle = withAlpha(g.vs[i].l.color, alpha);
        ctx.fillRect(Math.min(g.vs[i - 1].pos, g.vs[i].pos), g.top, Math.abs(g.vs[i].pos - g.vs[i - 1].pos), h);
      }
    }
    for (const o of g.hs) {
      applyLine(ctx, o.l.color, s.lineWidth, s.lineStyle);
      const y = crisp(o.pos, dpr, s.lineWidth);
      ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.right, y); ctx.stroke();
    }
    for (const o of g.vs) {
      applyLine(ctx, o.l.color, s.lineWidth, s.lineStyle);
      const x = crisp(o.pos, dpr, s.lineWidth);
      ctx.beginPath(); ctx.moveTo(x, g.top); ctx.lineTo(x, g.bottom); ctx.stroke();
    }
    if (s.showFans && w > 0 && h > 0) {
      const { left: L, right: R, top: T, bottom: B } = g;
      const mx = (L + R) / 2, my = (T + B) / 2;
      const segs: Array<[number, number, number, number]> = [
        [L, T, R, B], [R, T, L, B],
        [L, T, R, my], [L, T, mx, B], [R, T, L, my], [R, T, mx, B],
        [L, B, R, my], [L, B, mx, T], [R, B, L, my], [R, B, mx, T],
      ];
      applyLine(ctx, s.fansColor, 1, s.lineStyle);
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of segs) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    const font = fontFor(rc, 11);
    for (const o of g.hs) {
      const txt = fmtCoeff(o.l.coeff);
      if (s.showLeftLabels) drawTextBox(ctx, txt, g.left - 4, o.pos, { font, color: o.l.color, align: 'right', vAlign: 'middle', padding: 2 });
      if (s.showRightLabels) drawTextBox(ctx, txt, g.right + 4, o.pos, { font, color: o.l.color, align: 'left', vAlign: 'middle', padding: 2 });
    }
    for (const o of g.vs) {
      const txt = fmtCoeff(o.l.coeff);
      if (s.showTopLabels) drawTextBox(ctx, txt, o.pos, g.top - 4, { font, color: o.l.color, align: 'center', vAlign: 'bottom', padding: 2 });
      if (s.showBottomLabels) drawTextBox(ctx, txt, o.pos, g.bottom + 4, { font, color: o.l.color, align: 'center', vAlign: 'top', padding: 2 });
    }
  }

  override handles(rc: DrawingRenderContext): Handle[] {
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    return [{ ...a, index: 0 }, { ...b, index: 1 }, { x: b.x, y: a.y, index: 2 }, { x: a.x, y: b.y, index: 3 }];
  }

  override movePoint(index: number, p: DrawingPoint): void {
    if (this.points.length < 2) { if (this.points[index]) this.points[index] = p; return; }
    if (index === 0 || index === 1) { this.points[index] = p; return; }
    if (index === 2) { this.points[1] = { time: p.time, price: this.points[1].price }; this.points[0] = { time: this.points[0].time, price: p.price }; }
    if (index === 3) { this.points[0] = { time: p.time, price: this.points[0].price }; this.points[1] = { time: this.points[1].time, price: p.price }; }
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const hit = hitHandle(this.handles(rc), x, y);
    if (hit) return hit;
    const g = this._geom(rc);
    const t = HIT_TOLERANCE;
    if (x >= g.left - t && x <= g.right + t) for (const o of g.hs) if (Math.abs(o.pos - y) <= t) return { type: 'body' };
    if (y >= g.top - t && y <= g.bottom + t) for (const o of g.vs) if (Math.abs(o.pos - x) <= t) return { type: 'body' };
    if (pointInRect(x, y, g.left, g.top, g.right, g.bottom)) return { type: 'body', part: 'inside' };
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Gann square / Gann square fixed
// ---------------------------------------------------------------------------------------------

export interface GannSquareGeometry {
  /** origin corner (fans/arcs emanate from here) and far corner, pixels */
  o: PixelPoint; f: PixelPoint;
  /** signed grid cell size in pixels (box = 5×5 cells) */
  cellW: number; cellH: number;
  originPrice: number; farPrice: number;
  /** pixel position of a grid coefficient (0..5) on each axis */
  levelX(c: number): number; levelY(c: number): number;
  left: number; right: number; top: number; bottom: number;
}

/** Shared implementation of Gann Square (free price/bar ratio) and Gann Square Fixed (screen-square). */
export class GannSquareBase extends Drawing {
  static override toolId = 'gann_square_base';
  static override toolName = 'Gann Square';
  static override pointsCount = 2;
  static override group = 'gann' as const;

  /** Fixed variant: the box is kept square on screen (side = bar distance), the price side is derived. */
  protected fixed(): boolean { return false; }

  defaultStyle(): Record<string, any> {
    return {
      levels: cloneLevels(GANN_SQUARE_LEVELS), lineWidth: 2, lineStyle: 0,
      showFans: true, fanLines: cloneLevels(GANN_SQUARE_FANS),
      showArcs: true, arcs: cloneLevels(GANN_SQUARE_ARCS), fillArcsBackground: true, arcsTransparency: 80,
      fillBackground: false, transparency: 80, reverse: false,
      showLabels: true, labelsFontSize: 12, labelsBold: false, labelsItalic: false,
    };
  }

  propertyDefs(): PropertyDef[] {
    return [
      { key: 'levels', label: 'Levels', type: 'fibLevels', group: 'Levels' },
      { key: 'fanLines', label: 'Fans', type: 'fibLevels', group: 'Levels' },
      { key: 'arcs', label: 'Arcs', type: 'fibLevels', group: 'Levels' },
      P.lineWidth('lineWidth'), P.lineStyle('lineStyle'),
      P.bool('showFans', 'Fans'), P.bool('showArcs', 'Arcs'),
      P.bool('fillArcsBackground', 'Arcs background'), P.int('arcsTransparency', 'Arcs transparency', 0, 100),
      P.bool('fillBackground', 'Levels background'), P.int('transparency', 'Levels transparency', 0, 100),
      P.bool('reverse', 'Reverse'),
      P.bool('showLabels', 'Labels', 'Text'), P.fontSize('labelsFontSize', 'Font size'), P.bool('labelsBold', 'Bold', 'Text'), P.bool('labelsItalic', 'Italic', 'Text'),
    ];
  }

  /** Anchor corners in pixels: a = first point; b = second point (snapped to a screen square when fixed). */
  protected corners(rc: DrawingRenderContext): { a: PixelPoint; b: PixelPoint } {
    const a = rc.toPixel(this.points[0]);
    let b = rc.toPixel(this.points[1] ?? this.points[0]);
    if (this.fixed()) {
      const dx = b.x - a.x, dy = b.y - a.y;
      b = { x: b.x, y: a.y + (dy < 0 ? -1 : 1) * Math.abs(dx) };
    }
    return { a, b };
  }

  geometry(rc: DrawingRenderContext): GannSquareGeometry | null {
    if (!this.points.length) return null;
    const { a, b } = this.corners(rc);
    const p0 = this.points[0];
    const p1 = this.points[1] ?? p0;
    const fixed = this.fixed();
    let o = a, f = b;
    let originPrice = p0.price;
    let farPrice = fixed ? rc.priceScale.yToPrice(b.y) : p1.price;
    if (this.style.reverse) { o = b; f = a; const t = originPrice; originPrice = farPrice; farPrice = t; }
    const cellW = (f.x - o.x) / 5;
    const cellH = (f.y - o.y) / 5;
    const ps = rc.priceScale;
    return {
      o, f, cellW, cellH, originPrice, farPrice,
      levelX: (c) => o.x + cellW * c,
      levelY: (c) => (fixed ? o.y + cellH * c : ps.priceToY(originPrice + (farPrice - originPrice) * (c / 5))),
      left: Math.min(o.x, f.x), right: Math.max(o.x, f.x), top: Math.min(o.y, f.y), bottom: Math.max(o.y, f.y),
    };
  }

  private _visibleLevels(): FibLevel[] { return (this.style.levels as FibLevel[]).filter((l) => l.visible).sort((p, q) => p.coeff - q.coeff); }
  private _visibleFans(): GannRatioLevel[] { return (this.style.fanLines as GannRatioLevel[]).filter((l) => l.visible); }
  private _visibleArcs(): Array<{ l: GannRatioLevel; r: number }> {
    return (this.style.arcs as GannRatioLevel[]).filter((l) => l.visible).map((l) => ({ l, r: arcRadius(l) })).filter((o) => o.r > 0).sort((p, q) => p.r - q.r);
  }

  private _fanSegment(g: GannSquareGeometry, l: GannRatioLevel): [number, number, number, number] | null {
    const v = ratioVec(l);
    const tx = g.o.x + v.x * g.cellW, ty = g.o.y + v.y * g.cellH;
    return clipLineToRect(g.o.x, g.o.y, tx, ty, g.left, g.top, g.right, g.bottom, false, true);
  }

  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const g = this.geometry(rc);
    if (!g || Math.abs(g.cellW) < 0.2 || Math.abs(g.cellH) < 0.2) return;
    const { ctx, dpr } = rc;
    const s = this.style;
    const levels = this._visibleLevels();
    const arcs = s.showArcs ? this._visibleArcs() : [];
    const [start, end] = arcSweep(g.cellW, g.cellH);
    const rx = Math.abs(g.cellW), ry = Math.abs(g.cellH);
    if (s.fillBackground) {
      const alpha = alphaOf(s.transparency);
      for (let i = 1; i < levels.length; i++) {
        const y0 = g.levelY(levels[i - 1].coeff), y1 = g.levelY(levels[i].coeff);
        ctx.fillStyle = withAlpha(levels[i].color, alpha);
        ctx.fillRect(g.left, Math.min(y0, y1), g.right - g.left, Math.abs(y1 - y0));
      }
    }
    if (s.fillArcsBackground && arcs.length) {
      const alpha = alphaOf(s.arcsTransparency);
      let prev = 0;
      for (const { l, r } of arcs) {
        ctx.fillStyle = withAlpha(l.color, alpha);
        ctx.beginPath();
        ctx.ellipse(g.o.x, g.o.y, r * rx, r * ry, 0, start, end, false);
        if (prev > 0) ctx.ellipse(g.o.x, g.o.y, prev * rx, prev * ry, 0, end, start, true);
        else ctx.lineTo(g.o.x, g.o.y);
        ctx.closePath();
        ctx.fill();
        prev = r;
      }
    }
    for (const l of levels) {
      applyLine(ctx, l.color, s.lineWidth, s.lineStyle);
      const x = crisp(g.levelX(l.coeff), dpr, s.lineWidth);
      const y = crisp(g.levelY(l.coeff), dpr, s.lineWidth);
      ctx.beginPath();
      ctx.moveTo(x, g.top); ctx.lineTo(x, g.bottom);
      ctx.moveTo(g.left, y); ctx.lineTo(g.right, y);
      ctx.stroke();
    }
    if (s.showFans) {
      for (const l of this._visibleFans()) {
        const seg = this._fanSegment(g, l);
        if (!seg) continue;
        applyLine(ctx, l.color, s.lineWidth, s.lineStyle);
        ctx.beginPath(); ctx.moveTo(seg[0], seg[1]); ctx.lineTo(seg[2], seg[3]); ctx.stroke();
      }
    }
    for (const { l, r } of arcs) {
      applyLine(ctx, l.color, s.lineWidth, s.lineStyle);
      ctx.beginPath();
      ctx.ellipse(g.o.x, g.o.y, r * rx, r * ry, 0, start, end, false);
      ctx.stroke();
    }
    if (s.showLabels) this._drawLabels(rc, g);
  }

  /** Bars range, price range and price/bar ratio at the box corners. */
  private _drawLabels(rc: DrawingRenderContext, g: GannSquareGeometry): void {
    const { ctx, timeScale: ts } = rc;
    const s = this.style;
    const p0 = this.points[0], p1 = this.points[1];
    const bars = Math.abs(Math.round(ts.timeToIndex(p1.time) - ts.timeToIndex(p0.time)));
    const range = Math.abs(g.farPrice - g.originPrice);
    const ratio = bars > 0 ? range / bars : 0;
    const font = fontFor(rc, s.labelsFontSize, s.labelsBold, s.labelsItalic);
    const sx = g.f.x >= g.o.x ? 1 : -1;
    const sy = g.f.y >= g.o.y ? 1 : -1;
    const hAlign = sx > 0 ? 'left' : 'right';
    const vAlign = sy > 0 ? 'top' : 'bottom';
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    drawTextBox(ctx, `${bars} bars`, g.f.x + 4 * sx, g.o.y, { font, color: LABEL_GREY, align: hAlign, vAlign: 'middle', padding: 2 });
    drawTextBox(ctx, formatPrice(range, rc.priceFormat), g.o.x, g.f.y + 4 * sy, { font, color: LABEL_GREY, align: 'center', vAlign, padding: 2 });
    drawTextBox(ctx, `${formatPrice(ratio, rc.priceFormat)}/bar`, g.f.x + 4 * sx, g.f.y + 4 * sy, { font, color: LABEL_GREY, align: hAlign, vAlign, padding: 2 });
  }

  override handles(rc: DrawingRenderContext): Handle[] {
    if (this.points.length < 2) return super.handles(rc);
    const { a, b } = this.corners(rc);
    return [{ ...a, index: 0 }, { ...b, index: 1 }];
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const hit = hitHandle(this.handles(rc), x, y);
    if (hit) return hit;
    const g = this.geometry(rc);
    if (!g) return null;
    const t = HIT_TOLERANCE;
    const s = this.style;
    for (const l of this._visibleLevels()) {
      const lx = g.levelX(l.coeff), ly = g.levelY(l.coeff);
      if (Math.abs(lx - x) <= t && y >= g.top - t && y <= g.bottom + t) return { type: 'body' };
      if (Math.abs(ly - y) <= t && x >= g.left - t && x <= g.right + t) return { type: 'body' };
    }
    if (s.showFans) {
      for (const l of this._visibleFans()) {
        const seg = this._fanSegment(g, l);
        if (seg && distToSegment(x, y, seg[0], seg[1], seg[2], seg[3]) <= t) return { type: 'body' };
      }
    }
    if (s.showArcs) {
      const rx = Math.abs(g.cellW), ry = Math.abs(g.cellH);
      const inQuadrant = (x - g.o.x) * Math.sign(g.cellW || 1) >= -t && (y - g.o.y) * Math.sign(g.cellH || 1) >= -t;
      if (inQuadrant && rx > 0 && ry > 0) {
        for (const { r } of this._visibleArcs()) {
          const d = Math.hypot((x - g.o.x) / (r * rx), (y - g.o.y) / (r * ry));
          if (Math.abs(d - 1) * Math.min(r * rx, r * ry) <= t) return { type: 'body' };
        }
      }
    }
    if (pointInRect(x, y, g.left, g.top, g.right, g.bottom)) return { type: 'body', part: 'inside' };
    return null;
  }
}

/** Gann Square (TV `linetoolganncomplex`): the second point freely sets width (bars) and height (price). */
export class GannSquare extends GannSquareBase {
  static override toolId = 'gann_square';
  static override toolName = 'Gann Square';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4 4h20v20H4zm1 1v18h18V5z"/><path fill="currentColor" d="M5.35 23.35l18-18-.7-.7-18 18z"/><path fill="currentColor" d="M5 14a9 9 0 0 1 9 9h-1a8 8 0 0 0-8-8zM5 8a15 15 0 0 1 15 15h-1A14 14 0 0 0 5 9z"/></svg>';
}

/** Gann Square Fixed (TV `linetoolgannfixed`): the box is kept square on screen; the second point sets the bar span and orientation. */
export class GannSquareFixed extends GannSquareBase {
  static override toolId = 'gann_square_fixed';
  static override toolName = 'Gann Square Fixed';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4 4h20v20H4zm1 1v18h18V5z"/><path fill="currentColor" d="M5.35 23.35l18-18-.7-.7-18 18z"/><path fill="currentColor" d="M5 14a9 9 0 0 1 9 9h-1a8 8 0 0 0-8-8z"/><path fill="currentColor" d="M20 4h4v4h-4z"/></svg>';
  protected override fixed(): boolean { return true; }
  override defaultStyle(): Record<string, any> { return { ...super.defaultStyle(), showLabels: false }; }
}

// ---------------------------------------------------------------------------------------------
// Gann fan
// ---------------------------------------------------------------------------------------------

export interface GannFanRay { l: GannFanLevel; factor: number; slope: number; unit: PixelPoint }

/**
 * Gann Fan (TV `linetoolgannfan`): nine rays from p1; p2 defines the 1x1 line (screen-space slope s),
 * ray `a x b` has slope s·a/b. Labels at the visible ray ends, fills between adjacent rays.
 */
export class GannFan extends Drawing {
  static override toolId = 'gann_fan';
  static override toolName = 'Gann Fan';
  static override pointsCount = 2;
  static override group = 'gann' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4.2 23.5l19-4 .2 1-19 4zM4.3 23.6l19-10 .5.9-19 10zM4.4 23.7l18-17 .7.7-18 17zM4.5 23.8l9-19 .9.4-9 19z"/><path fill="currentColor" d="M6 24a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>';

  defaultStyle() {
    return { levels: cloneLevels(GANN_FAN_LEVELS), lineWidth: 2, lineStyle: 0, showLabels: true, fillBackground: true, transparency: 80 };
  }

  propertyDefs(): PropertyDef[] {
    return [
      { key: 'levels', label: 'Levels', type: 'fibLevels', group: 'Levels' },
      P.lineWidth('lineWidth'), P.lineStyle('lineStyle'),
      P.bool('showLabels', 'Labels'), P.bool('fillBackground', 'Background'), P.int('transparency', 'Transparency', 0, 100),
    ];
  }

  /** Fan geometry in screen space: origin, x-direction sign, 1x1 slope and the visible rays (flattest first). */
  fan(rc: DrawingRenderContext): { a: PixelPoint; sx: number; slope: number; rays: GannFanRay[] } {
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    let dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) < 0.5) dx = dx < 0 ? -0.5 : 0.5;
    const slope = dy / dx;
    const sx = dx < 0 ? -1 : 1;
    const rays = (this.style.levels as GannFanLevel[]).filter((l) => l.visible).map((l) => {
      const factor = fanFactor(l);
      const sl = slope * factor;
      const len = Math.hypot(1, sl);
      return { l, factor, slope: sl, unit: { x: sx / len, y: (sl * sx) / len } };
    }).sort((p, q) => p.factor - q.factor);
    return { a, sx, slope, rays };
  }

  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const { ctx } = rc;
    const s = this.style;
    const { a, rays } = this.fan(rc);
    if (!rays.length) return;
    const L = 2 * (rc.width + rc.height) + 4000;
    const far = (u: PixelPoint): PixelPoint => ({ x: a.x + u.x * L, y: a.y + u.y * L });
    if (s.fillBackground) {
      const alpha = alphaOf(s.transparency);
      for (let i = 1; i < rays.length; i++) {
        const p = far(rays[i - 1].unit), q = far(rays[i].unit);
        ctx.fillStyle = withAlpha(rays[i].l.color, alpha);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.closePath(); ctx.fill();
      }
    }
    for (const r of rays) {
      applyLine(ctx, r.l.color, s.lineWidth, s.lineStyle);
      drawExtendedLine(rc, a, { x: a.x + r.unit.x, y: a.y + r.unit.y }, false, true);
    }
    if (s.showLabels) {
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      const font = fontFor(rc, 11);
      for (const r of rays) {
        const pos = rayLabelPos(rc, a, r.unit);
        if (pos) drawTextBox(ctx, fanLabel(r.l), pos.x, pos.y, { font, color: r.l.color, align: pos.align, vAlign: pos.vAlign, padding: 2 });
      }
    }
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const hit = hitHandle(this.handles(rc), x, y);
    if (hit) return hit;
    const { a, sx, rays } = this.fan(rc);
    for (const r of rays) if (distToRay(x, y, a.x, a.y, a.x + r.unit.x, a.y + r.unit.y) <= HIT_TOLERANCE) return { type: 'body' };
    if (this.style.fillBackground && rays.length >= 2) {
      const vx = (x - a.x) * sx, vy = (y - a.y) * sx;
      if (vx > 0) {
        const sl = vy / vx;
        const lo = Math.min(rays[0].slope, rays[rays.length - 1].slope);
        const hi = Math.max(rays[0].slope, rays[rays.length - 1].slope);
        if (sl >= lo && sl <= hi) return { type: 'body', part: 'inside' };
      }
    }
    return null;
  }
}

export const gannTools = [GannBox, GannSquareFixed, GannSquare, GannFan];
