import { Drawing, P, type DrawingPoint, type DrawingRenderContext, type HitTarget, type PixelPoint, type PropertyDef, HIT_TOLERANCE } from '../Drawing';
import { applyLine, drawArrowHead, drawTextBox, fontFor, TEXT_ALIGN_OPTIONS } from './common';
import { distToSegment, distToLine, pointInPolygon, pointInRect, clipLineToRect, clamp } from '../../util/math';
import { withAlpha, alphaOf } from '../../util/color';

// ---------------------------------------------------------------------------------------------
// Shared helpers (also imported by text.ts and arrows.ts)
// ---------------------------------------------------------------------------------------------

/** Radius (px) around an anchor point that reports a `point` hit. */
export const POINT_HIT_RADIUS = 7;
export const LINE_END_OPTIONS = [{ value: 0, label: 'Normal' }, { value: 1, label: 'Arrow' }];
export const V_ALIGN_OPTIONS = [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }];
const TAU = Math.PI * 2;

/** 28x28 toolbar icon from a single path. */
export function svgIcon(d: string): string {
  return `<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" fill-rule="evenodd" d="${d}"/></svg>`;
}

/** First anchor within `r` px of (x, y) → { type: 'point', index }. */
export function hitPoint(px: PixelPoint[], x: number, y: number, r = POINT_HIT_RADIUS): HitTarget {
  for (let i = 0; i < px.length; i++) if (Math.hypot(px[i].x - x, px[i].y - y) <= r) return { type: 'point', index: i };
  return null;
}

/** Is (x, y) within `tol` of any segment of the polyline (optionally closed)? */
export function nearPolyline(px: PixelPoint[], x: number, y: number, tol: number, closed = false): boolean {
  const n = px.length;
  for (let i = 1; i < n; i++) if (distToSegment(x, y, px[i - 1].x, px[i - 1].y, px[i].x, px[i].y) <= tol) return true;
  if (closed && n > 2 && distToSegment(x, y, px[n - 1].x, px[n - 1].y, px[0].x, px[0].y) <= tol) return true;
  return false;
}

/** beginPath + moveTo/lineTo through the points. */
export function tracePath(ctx: CanvasRenderingContext2D, px: PixelPoint[], closed = false): void {
  ctx.beginPath();
  if (!px.length) return;
  ctx.moveTo(px[0].x, px[0].y);
  for (let i = 1; i < px.length; i++) ctx.lineTo(px[i].x, px[i].y);
  if (closed) ctx.closePath();
}

/** Stroke hit tolerance per spec: max(HIT_TOLERANCE, lineWidth / 2 + 2). */
export function strokeTolerance(lineWidth: number): number {
  return Math.max(HIT_TOLERANCE, (Number(lineWidth) || 1) / 2 + 2);
}

export function quadPoint(a: PixelPoint, c: PixelPoint, b: PixelPoint, t: number): PixelPoint {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

export function cubicPoint(a: PixelPoint, c1: PixelPoint, c2: PixelPoint, b: PixelPoint, t: number): PixelPoint {
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return { x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x, y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y };
}

export function sampleQuad(a: PixelPoint, c: PixelPoint, b: PixelPoint, n = 32): PixelPoint[] {
  const out: PixelPoint[] = [];
  for (let i = 0; i <= n; i++) out.push(quadPoint(a, c, b, i / n));
  return out;
}

export function sampleCubic(a: PixelPoint, c1: PixelPoint, c2: PixelPoint, b: PixelPoint, n = 48): PixelPoint[] {
  const out: PixelPoint[] = [];
  for (let i = 0; i <= n; i++) out.push(cubicPoint(a, c1, c2, b, i / n));
  return out;
}

/** A fill colour derived from a line colour, keeping the alpha of the tool's default fill. */
export function deriveFill(lineColor: string, defaultFill: string): string {
  return withAlpha(lineColor, alphaOf(defaultFill));
}

/** Corner handles of a 2-point rectangle: 0 = p0, 1 = p1, 2 = (p1.x, p0.y), 3 = (p0.x, p1.y). */
export function rectHandles(a: PixelPoint, b: PixelPoint): Array<PixelPoint & { index: number }> {
  return [{ x: a.x, y: a.y, index: 0 }, { x: b.x, y: b.y, index: 1 }, { x: b.x, y: a.y, index: 2 }, { x: a.x, y: b.y, index: 3 }];
}

/** Move one of the four corner handles produced by `rectHandles`. */
export function rectMovePoint(points: DrawingPoint[], index: number, p: DrawingPoint): void {
  if (points.length < 2) { if (points[index]) points[index] = p; return; }
  if (index === 0 || index === 1) { points[index] = p; return; }
  if (index === 2) { points[1] = { time: p.time, price: points[1].price }; points[0] = { time: points[0].time, price: p.price }; }
  if (index === 3) { points[0] = { time: p.time, price: points[0].price }; points[1] = { time: points[1].time, price: p.price }; }
}

/** Common label style for shapes carrying an optional text. */
export function shapeTextStyle(color: string): Record<string, any> {
  return { showText: false, text: '', textColor: color, fontSize: 14, bold: false, italic: false };
}

export function shapeTextDefs(): PropertyDef[] {
  return [P.bool('showText', 'Show text', 'Text'), P.text('text', 'Text'), P.color('textColor', 'Text color', 'Text'), P.fontSize('fontSize'), P.bool('bold', 'Bold', 'Text'), P.bool('italic', 'Italic', 'Text')];
}

/** Draw the optional shape label centred at (x, y). Resets dash/alpha first. */
function drawShapeLabel(rc: DrawingRenderContext, s: Record<string, any>, x: number, y: number, maxWidth?: number): void {
  if (!s.showText || !s.text) return;
  const { ctx } = rc;
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  drawTextBox(ctx, String(s.text), x, y, { font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.textColor, align: 'center', vAlign: 'middle', maxWidth });
}

/**
 * Base for the geometric shapes: group `shapes`, pixel cache, and "fill follows the line colour"
 * (when a caller passes `lineColor` without `fillColor`, e.g. the chart's default drawing colour,
 * the fill is derived from it keeping the default alpha so a shape stays monochrome).
 */
export abstract class Shape extends Drawing {
  static override group = 'shapes' as const;
  constructor(style: Record<string, any> = {}, id?: string) {
    super(style, id);
    if (typeof style.lineColor === 'string' && style.fillColor === undefined) {
      const def = this.defaultStyle().fillColor;
      if (typeof def === 'string') this.style.fillColor = deriveFill(style.lineColor, def);
    }
  }
  /** Pixel points (cached in `_px`). */
  protected px(rc: DrawingRenderContext): PixelPoint[] {
    const px = this.points.map((p) => rc.toPixel(p));
    this._px = px;
    return px;
  }
  protected get filled(): boolean { return !!this.style.fillBackground; }
}

// ---------------------------------------------------------------------------------------------
// Rectangle
// ---------------------------------------------------------------------------------------------

export class Rectangle extends Shape {
  static override toolId = 'rectangle';
  static override toolName = 'Rectangle';
  static override pointsCount = 2;
  static override icon = svgIcon('M5 7h18v14H5zm1 1v12h16V8z');
  defaultStyle(): Record<string, any> {
    return { lineColor: '#9C27B0', lineWidth: 2, lineStyle: 0, fillBackground: true, fillColor: 'rgba(156, 39, 176, 0.2)', extendLeft: false, extendRight: false, showMiddleLine: false, middleLineColor: '#9C27B0', middleLineWidth: 1, middleLineStyle: 2, ...shapeTextStyle('#9C27B0'), textAlign: 'center', textVAlign: 'middle' };
  }
  propertyDefs(): PropertyDef[] {
    return [P.color('lineColor', 'Border'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('fillBackground', 'Background'), P.color('fillColor', 'Background color'),
      P.bool('extendLeft', 'Extend left'), P.bool('extendRight', 'Extend right'),
      P.bool('showMiddleLine', 'Middle line'), P.color('middleLineColor', 'Middle line color'), P.lineWidth('middleLineWidth', 'Middle line width'), P.lineStyle('middleLineStyle', 'Middle line style'),
      ...shapeTextDefs(), P.select('textAlign', 'Alignment', TEXT_ALIGN_OPTIONS, 'Text'), P.select('textVAlign', 'Vertical align', V_ALIGN_OPTIONS, 'Text')];
  }
  /** Un-extended corners in pixels. */
  protected corners(rc: DrawingRenderContext): [PixelPoint, PixelPoint] {
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    this._px = [a, b];
    return [a, b];
  }
  /** Pixel rect honouring extend flags. */
  rect(rc: DrawingRenderContext): { x1: number; y1: number; x2: number; y2: number } {
    const [a, b] = this.corners(rc);
    let x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
    if (this.style.extendLeft) x1 = -10;
    if (this.style.extendRight) x2 = rc.width + 10;
    return { x1, y1: Math.min(a.y, b.y), x2, y2: Math.max(a.y, b.y) };
  }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const { ctx } = rc;
    const s = this.style;
    const r = this.rect(rc);
    const w = r.x2 - r.x1, h = r.y2 - r.y1;
    if (s.fillBackground) { ctx.fillStyle = s.fillColor; ctx.fillRect(r.x1, r.y1, w, h); }
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    ctx.strokeRect(r.x1, r.y1, w, h);
    if (s.showMiddleLine && this.points.length > 1) {
      const y = rc.toPixel({ time: this.points[0].time, price: (this.points[0].price + this.points[1].price) / 2 }).y;
      applyLine(ctx, s.middleLineColor, s.middleLineWidth, s.middleLineStyle);
      ctx.beginPath(); ctx.moveTo(r.x1, y); ctx.lineTo(r.x2, y); ctx.stroke();
    }
    if (s.showText && s.text) {
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      const x = s.textAlign === 'left' ? r.x1 + 4 : s.textAlign === 'right' ? r.x2 - 4 : (r.x1 + r.x2) / 2;
      const y = s.textVAlign === 'top' ? r.y1 + 4 : s.textVAlign === 'bottom' ? r.y2 - 4 : (r.y1 + r.y2) / 2;
      drawTextBox(ctx, String(s.text), x, y, { font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.textColor, align: s.textAlign, vAlign: s.textVAlign, maxWidth: Math.max(40, w - 8) });
    }
  }
  /** 4 corners (0-3) + 4 edge midpoints (4 top, 5 right, 6 bottom, 7 left). */
  override handles(rc: DrawingRenderContext): Array<PixelPoint & { index: number }> {
    if (!this.points.length) return [];
    const [a, b] = this.corners(rc);
    const hs = rectHandles(a, b);
    if (this.points.length < 2) return hs.slice(0, 1);
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    hs.push({ x: mx, y: y1, index: 4 }, { x: x2, y: my, index: 5 }, { x: mx, y: y2, index: 6 }, { x: x1, y: my, index: 7 });
    return hs;
  }
  override movePoint(index: number, p: DrawingPoint): void {
    const pts = this.points;
    if (index < 4) { rectMovePoint(pts, index, p); return; }
    if (pts.length < 2) return;
    const hi = pts[0].price >= pts[1].price ? 0 : 1; // top edge = higher price
    const lo = 1 - hi;
    const ri = pts[0].time >= pts[1].time ? 0 : 1; // right edge = later time
    const le = 1 - ri;
    if (index === 4) pts[hi] = { time: pts[hi].time, price: p.price };
    else if (index === 6) pts[lo] = { time: pts[lo].time, price: p.price };
    else if (index === 5) pts[ri] = { time: p.time, price: pts[ri].price };
    else if (index === 7) pts[le] = { time: p.time, price: pts[le].price };
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    for (const h of this.handles(rc)) if (Math.hypot(h.x - x, h.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: h.index };
    const r = this.rect(rc);
    const tol = strokeTolerance(this.style.lineWidth);
    const onEdge = ((Math.abs(x - r.x1) <= tol || Math.abs(x - r.x2) <= tol) && y >= r.y1 - tol && y <= r.y2 + tol)
      || ((Math.abs(y - r.y1) <= tol || Math.abs(y - r.y2) <= tol) && x >= r.x1 - tol && x <= r.x2 + tol);
    if (onEdge) return { type: 'body' };
    if (this.filled && pointInRect(x, y, r.x1, r.y1, r.x2, r.y2)) return { type: 'body', part: 'inside' };
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Rotated rectangle (3 points: edge p1-p2, width from the perpendicular distance of p3)
// ---------------------------------------------------------------------------------------------

export class RotatedRectangle extends Shape {
  static override toolId = 'rotated_rectangle';
  static override toolName = 'Rotated Rectangle';
  static override pointsCount = 3;
  static override icon = svgIcon('M9.5 4.5L23.5 12l-5 11.5L4.5 16l5-11.5zm.5 1.4l-4.2 9.6 12.7 6.5 4.2-9.6L10 5.9z');
  defaultStyle(): Record<string, any> { return { lineColor: '#4CAF50', lineWidth: 2, lineStyle: 0, fillBackground: true, fillColor: 'rgba(76, 175, 80, 0.2)' }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Border'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('fillBackground', 'Background'), P.color('fillColor', 'Background color')]; }
  /** The 4 corners in pixels (2 while only the first edge exists). */
  corners(rc: DrawingRenderContext): PixelPoint[] {
    const px = this.px(rc);
    if (px.length < 2) return px;
    const a = px[0], b = px[1];
    if (px.length < 3) return [a, b];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const nx = len < 1e-9 ? 0 : -dy / len, ny = len < 1e-9 ? 1 : dx / len;
    const w = (px[2].x - a.x) * nx + (px[2].y - a.y) * ny;
    return [a, b, { x: b.x + nx * w, y: b.y + ny * w }, { x: a.x + nx * w, y: a.y + ny * w }];
  }
  render(rc: DrawingRenderContext): void {
    const c = this.corners(rc);
    if (c.length < 2) return;
    const { ctx } = rc;
    const s = this.style;
    tracePath(ctx, c, c.length > 2);
    if (c.length > 2 && s.fillBackground) { ctx.fillStyle = s.fillColor; ctx.fill(); }
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    ctx.stroke();
  }
  override handles(rc: DrawingRenderContext): Array<PixelPoint & { index: number }> {
    return this.corners(rc).map((p, i) => ({ x: p.x, y: p.y, index: i }));
  }
  override movePoint(index: number, p: DrawingPoint): void {
    if (index <= 1) { this.points[index] = p; return; }
    // both far corners set the width (perpendicular distance from the first edge)
    if (this.points.length >= 3) this.points[2] = p;
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const c = this.corners(rc);
    if (c.length < 2) return null;
    const hp = hitPoint(c, x, y);
    if (hp) return hp;
    if (nearPolyline(c, x, y, strokeTolerance(this.style.lineWidth), c.length > 2)) return { type: 'body' };
    if (c.length > 2 && this.filled && pointInPolygon(x, y, c)) return { type: 'body', part: 'inside' };
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Ellipse (3 points: p1-p2 = one axis, p3 = half-length of the other axis)
// ---------------------------------------------------------------------------------------------

export class Ellipse extends Shape {
  static override toolId = 'ellipse';
  static override toolName = 'Ellipse';
  static override pointsCount = 3;
  static override icon = svgIcon('M14 6c5.5 0 10 3.6 10 8s-4.5 8-10 8S4 18.4 4 14s4.5-8 10-8zm0 1c-5 0-9 3.1-9 7s4 7 9 7 9-3.1 9-7-4-7-9-7z');
  defaultStyle(): Record<string, any> { return { lineColor: '#F23645', lineWidth: 2, lineStyle: 0, fillBackground: true, fillColor: 'rgba(242, 54, 69, 0.2)', ...shapeTextStyle('#F23645') }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Border'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('fillBackground', 'Background'), P.color('fillColor', 'Background color'), ...shapeTextDefs()]; }
  /** Centre, semi-axes and rotation in pixel space. */
  geom(rc: DrawingRenderContext): { cx: number; cy: number; rx: number; ry: number; angle: number; a: PixelPoint; b: PixelPoint } {
    const px = this.px(rc);
    const a = px[0], b = px[1] ?? px[0];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const rx = Math.hypot(b.x - a.x, b.y - a.y) / 2;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const ry = px[2] && rx > 1e-9 ? distToLine(px[2].x, px[2].y, a.x, a.y, b.x, b.y) : (px[2] ? Math.hypot(px[2].x - cx, px[2].y - cy) : 0);
    return { cx, cy, rx, ry, angle, a, b };
  }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const { ctx } = rc;
    const s = this.style;
    const g = this.geom(rc);
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    if (g.rx < 0.5 || g.ry < 0.5) {
      // degenerate: draw the axis while the third point is being placed
      ctx.beginPath(); ctx.moveTo(g.a.x, g.a.y); ctx.lineTo(g.b.x, g.b.y); ctx.stroke();
      return;
    }
    ctx.beginPath();
    ctx.ellipse(g.cx, g.cy, g.rx, g.ry, g.angle, 0, TAU);
    if (s.fillBackground) { ctx.fillStyle = s.fillColor; ctx.fill(); }
    ctx.stroke();
    drawShapeLabel(rc, s, g.cx, g.cy);
  }
  /** 0/1 = major-axis ends, 2/3 = minor-axis ends. */
  override handles(rc: DrawingRenderContext): Array<PixelPoint & { index: number }> {
    const g = this.geom(rc);
    const hs: Array<PixelPoint & { index: number }> = [{ x: g.a.x, y: g.a.y, index: 0 }];
    if (this.points.length > 1) hs.push({ x: g.b.x, y: g.b.y, index: 1 });
    if (this.points.length > 2) {
      const nx = -Math.sin(g.angle), ny = Math.cos(g.angle);
      const p3 = rc.toPixel(this.points[2]);
      const side = (p3.x - g.cx) * nx + (p3.y - g.cy) * ny >= 0 ? 1 : -1;
      hs.push({ x: g.cx + nx * g.ry * side, y: g.cy + ny * g.ry * side, index: 2 }, { x: g.cx - nx * g.ry * side, y: g.cy - ny * g.ry * side, index: 3 });
    }
    return hs;
  }
  override movePoint(index: number, p: DrawingPoint): void {
    if (index <= 1) { this.points[index] = p; return; }
    if (this.points.length >= 3) this.points[2] = p;
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    for (const h of this.handles(rc)) if (Math.hypot(h.x - x, h.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: h.index };
    const g = this.geom(rc);
    const tol = strokeTolerance(this.style.lineWidth);
    if (g.rx < 1 || g.ry < 1) return distToSegment(x, y, g.a.x, g.a.y, g.b.x, g.b.y) <= tol ? { type: 'body' } : null;
    // rotate into the ellipse frame
    const dx = x - g.cx, dy = y - g.cy;
    const cos = Math.cos(g.angle), sin = Math.sin(g.angle);
    const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
    const v = (lx / g.rx) ** 2 + (ly / g.ry) ** 2;
    const rel = tol / Math.min(g.rx, g.ry);
    if (Math.abs(Math.sqrt(v) - 1) <= rel) return { type: 'body' };
    if (v < 1 && this.filled) return { type: 'body', part: 'inside' };
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Circle (2 points: centre + radius point; a true circle in pixel space)
// ---------------------------------------------------------------------------------------------

export class Circle extends Shape {
  static override toolId = 'circle';
  static override toolName = 'Circle';
  static override pointsCount = 2;
  static override icon = svgIcon('M14 4a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 1a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 8.5a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1z');
  defaultStyle(): Record<string, any> { return { lineColor: '#FF9800', lineWidth: 2, lineStyle: 0, fillBackground: true, fillColor: 'rgba(255, 152, 0, 0.2)', ...shapeTextStyle('#FF9800') }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Border'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('fillBackground', 'Background'), P.color('fillColor', 'Background color'), ...shapeTextDefs()]; }
  /** Radius in pixels. */
  radius(rc: DrawingRenderContext): number {
    if (this.points.length < 2) return 0;
    const a = rc.toPixel(this.points[0]), b = rc.toPixel(this.points[1]);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const px = this.px(rc);
    const { ctx } = rc;
    const s = this.style;
    const r = this.radius(rc);
    if (r < 0.5) return;
    ctx.beginPath();
    ctx.arc(px[0].x, px[0].y, r, 0, TAU);
    if (s.fillBackground) { ctx.fillStyle = s.fillColor; ctx.fill(); }
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    ctx.stroke();
    drawShapeLabel(rc, s, px[0].x, px[0].y, Math.max(40, r * 1.6));
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const px = this.px(rc);
    const hp = hitPoint(px, x, y);
    if (hp) return hp;
    const r = this.radius(rc);
    const d = Math.hypot(x - px[0].x, y - px[0].y);
    if (Math.abs(d - r) <= strokeTolerance(this.style.lineWidth)) return { type: 'body' };
    if (d < r && this.filled) return { type: 'body', part: 'inside' };
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Triangle
// ---------------------------------------------------------------------------------------------

export class Triangle extends Shape {
  static override toolId = 'triangle';
  static override toolName = 'Triangle';
  static override pointsCount = 3;
  static override icon = svgIcon('M14 5l10 18H4L14 5zm0 2L5.7 22h16.6L14 7z');
  defaultStyle(): Record<string, any> { return { lineColor: '#089981', lineWidth: 2, lineStyle: 0, fillBackground: true, fillColor: 'rgba(8, 153, 129, 0.2)' }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Border'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('fillBackground', 'Background'), P.color('fillColor', 'Background color')]; }
  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const px = this.px(rc);
    const { ctx } = rc;
    const s = this.style;
    tracePath(ctx, px, px.length >= 3);
    if (px.length >= 3 && s.fillBackground) { ctx.fillStyle = s.fillColor; ctx.fill(); }
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    ctx.stroke();
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const px = this.px(rc);
    const hp = hitPoint(px, x, y);
    if (hp) return hp;
    if (nearPolyline(px, x, y, strokeTolerance(this.style.lineWidth), px.length >= 3)) return { type: 'body' };
    if (px.length >= 3 && this.filled && pointInPolygon(x, y, px)) return { type: 'body', part: 'inside' };
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Arc (3 points: chord endpoints + a point on the arc that sets the bulge)
// ---------------------------------------------------------------------------------------------

type ArcGeom = { line: true; a: PixelPoint; b: PixelPoint } | { line: false; a: PixelPoint; b: PixelPoint; c: PixelPoint; cx: number; cy: number; r: number; start: number; end: number; ccw: boolean };

export class Arc extends Shape {
  static override toolId = 'arc';
  static override toolName = 'Arc';
  static override pointsCount = 3;
  static override icon = svgIcon('M4 20a10.5 10.5 0 0 1 20 0h-1a9.5 9.5 0 0 0-18 0H4z');
  defaultStyle(): Record<string, any> { return { lineColor: '#E91E63', lineWidth: 2, lineStyle: 0, fillBackground: true, fillColor: 'rgba(233, 30, 99, 0.2)' }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('fillBackground', 'Background'), P.color('fillColor', 'Background color')]; }
  /** Circle through the three points and the sweep from p1 to p2 passing through p3. */
  geom(rc: DrawingRenderContext): ArcGeom | null {
    const px = this.px(rc);
    if (px.length < 2) return null;
    const a = px[0], b = px[1], c = px[2];
    if (!c) return { line: true, a, b };
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-6) return { line: true, a, b };
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
    const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
    const r = Math.hypot(a.x - cx, a.y - cy);
    if (!Number.isFinite(r) || r > 1e5) return { line: true, a, b };
    const start = Math.atan2(a.y - cy, a.x - cx), end = Math.atan2(b.y - cy, b.x - cx), tc = Math.atan2(c.y - cy, c.x - cx);
    const d1 = norm(end - start), dc = norm(tc - start);
    return { line: false, a, b, c, cx, cy, r, start, end, ccw: dc > d1 };
  }
  private _onSweep(g: Extract<ArcGeom, { line: false }>, ang: number): boolean {
    const d1 = norm(g.end - g.start), da = norm(ang - g.start);
    return g.ccw ? da >= d1 || da === 0 : da <= d1;
  }
  render(rc: DrawingRenderContext): void {
    const g = this.geom(rc);
    if (!g) return;
    const { ctx } = rc;
    const s = this.style;
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    if (g.line) { ctx.beginPath(); ctx.moveTo(g.a.x, g.a.y); ctx.lineTo(g.b.x, g.b.y); ctx.stroke(); return; }
    if (s.fillBackground) {
      ctx.beginPath(); ctx.arc(g.cx, g.cy, g.r, g.start, g.end, g.ccw); ctx.closePath();
      ctx.fillStyle = s.fillColor; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(g.cx, g.cy, g.r, g.start, g.end, g.ccw); ctx.stroke();
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const g = this.geom(rc);
    if (!g) return null;
    const hp = hitPoint(this._px, x, y);
    if (hp) return hp;
    const tol = strokeTolerance(this.style.lineWidth);
    if (g.line) return distToSegment(x, y, g.a.x, g.a.y, g.b.x, g.b.y) <= tol ? { type: 'body' } : null;
    const d = Math.hypot(x - g.cx, y - g.cy);
    const ang = Math.atan2(y - g.cy, x - g.cx);
    if (Math.abs(d - g.r) <= tol && this._onSweep(g, ang)) return { type: 'body' };
    if (this.filled && d < g.r) {
      const side = (p: PixelPoint) => Math.sign((g.b.x - g.a.x) * (p.y - g.a.y) - (g.b.y - g.a.y) * (p.x - g.a.x));
      if (side({ x, y }) === side(g.c)) return { type: 'body', part: 'inside' };
    }
    return null;
  }
}

function norm(t: number): number { return ((t % TAU) + TAU) % TAU; }

// ---------------------------------------------------------------------------------------------
// Curve (quadratic Bézier, 3 points) and Double curve (cubic Bézier, 4 points)
// Point order: [start, end, control1, (control2)] — the endpoints are placed first.
// ---------------------------------------------------------------------------------------------

abstract class BezierBase extends Shape {
  static override pointsCount = 3;
  defaultStyle(): Record<string, any> {
    return { lineColor: '#2962FF', lineWidth: 2, lineStyle: 0, extendLeft: false, extendRight: false, leftEnd: 0, rightEnd: 0, fillBackground: false, fillColor: 'rgba(41, 98, 255, 0.2)' };
  }
  propertyDefs(): PropertyDef[] {
    return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('extendLeft', 'Extend left'), P.bool('extendRight', 'Extend right'),
      P.select('leftEnd', 'Left end', LINE_END_OPTIONS), P.select('rightEnd', 'Right end', LINE_END_OPTIONS), P.bool('fillBackground', 'Background'), P.color('fillColor', 'Background color')];
  }
  /** Sampled polyline from p1 to p2 and the outward tangent directions at both ends. */
  abstract curve(px: PixelPoint[]): { pts: PixelPoint[]; tanStart: PixelPoint; tanEnd: PixelPoint };
  private _extension(rc: DrawingRenderContext, from: PixelPoint, dir: PixelPoint): [PixelPoint, PixelPoint] | null {
    if (Math.abs(dir.x) < 1e-9 && Math.abs(dir.y) < 1e-9) return null;
    const pad = 2000;
    const seg = clipLineToRect(from.x, from.y, from.x + dir.x, from.y + dir.y, -pad, -pad, rc.width + pad, rc.height + pad, false, true);
    return seg ? [{ x: seg[0], y: seg[1] }, { x: seg[2], y: seg[3] }] : null;
  }
  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const px = this.px(rc);
    const { pts, tanStart, tanEnd } = this.curve(px);
    const { ctx } = rc;
    const s = this.style;
    if (s.fillBackground && pts.length > 2) { tracePath(ctx, pts, true); ctx.fillStyle = s.fillColor; ctx.fill(); }
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    tracePath(ctx, pts);
    ctx.stroke();
    const a = pts[0], b = pts[pts.length - 1];
    for (const [on, from, dir] of [[s.extendLeft, a, tanStart], [s.extendRight, b, tanEnd]] as Array<[boolean, PixelPoint, PixelPoint]>) {
      if (!on) continue;
      const seg = this._extension(rc, from, dir);
      if (seg) { ctx.beginPath(); ctx.moveTo(seg[0].x, seg[0].y); ctx.lineTo(seg[1].x, seg[1].y); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    const size = 8 + s.lineWidth * 2;
    if (s.leftEnd === 1 && !s.extendLeft) drawArrowHead(ctx, { x: a.x - tanStart.x, y: a.y - tanStart.y }, a, size);
    if (s.rightEnd === 1 && !s.extendRight) drawArrowHead(ctx, { x: b.x - tanEnd.x, y: b.y - tanEnd.y }, b, size);
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const px = this.px(rc);
    const hp = hitPoint(px, x, y);
    if (hp) return hp;
    const { pts, tanStart, tanEnd } = this.curve(px);
    const tol = strokeTolerance(this.style.lineWidth);
    if (nearPolyline(pts, x, y, tol)) return { type: 'body' };
    const s = this.style;
    for (const [on, from, dir] of [[s.extendLeft, pts[0], tanStart], [s.extendRight, pts[pts.length - 1], tanEnd]] as Array<[boolean, PixelPoint, PixelPoint]>) {
      if (!on) continue;
      const seg = this._extension(rc, from, dir);
      if (seg && distToSegment(x, y, seg[0].x, seg[0].y, seg[1].x, seg[1].y) <= tol) return { type: 'body' };
    }
    if (this.filled && pts.length > 2 && pointInPolygon(x, y, pts)) return { type: 'body', part: 'inside' };
    return null;
  }
}

export class Curve extends BezierBase {
  static override toolId = 'curve';
  static override toolName = 'Curve';
  static override pointsCount = 3;
  static override icon = svgIcon('M4 22C7 8 14 6 24 6v1C15 7 8 9 5 22H4z');
  curve(px: PixelPoint[]): { pts: PixelPoint[]; tanStart: PixelPoint; tanEnd: PixelPoint } {
    const a = px[0], b = px[1];
    const c = px[2] ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return { pts: sampleQuad(a, c, b), tanStart: { x: a.x - c.x, y: a.y - c.y }, tanEnd: { x: b.x - c.x, y: b.y - c.y } };
  }
}

export class DoubleCurve extends BezierBase {
  static override toolId = 'double_curve';
  static override toolName = 'Double Curve';
  static override pointsCount = 4;
  static override icon = svgIcon('M4 20c6-14 10 8 20-12l.8.6C14.8 29 10.4 6.6 5 20.4L4 20z');
  defaultStyle(): Record<string, any> { return { ...super.defaultStyle(), lineColor: '#673AB7', fillColor: 'rgba(103, 58, 183, 0.2)' }; }
  curve(px: PixelPoint[]): { pts: PixelPoint[]; tanStart: PixelPoint; tanEnd: PixelPoint } {
    const a = px[0], b = px[1];
    const c1 = px[2] ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const c2 = px[3] ?? c1;
    return { pts: sampleCubic(a, c1, c2, b), tanStart: { x: a.x - c1.x, y: a.y - c1.y }, tanEnd: { x: b.x - c2.x, y: b.y - c2.y } };
  }
}

// ---------------------------------------------------------------------------------------------
// Polyline / Path (open-ended: clicks add vertices, double-click finishes)
// ---------------------------------------------------------------------------------------------

/**
 * Open-ended vertex tools. `pointsCount` is 2 so the manager keeps a rubber-band pending point;
 * `isComplete()` stays false while creating so every click adds a vertex until a double-click.
 */
abstract class VertexTool extends Shape {
  static override pointsCount = 2;
  override addPoint(p: DrawingPoint): boolean { this.points.push(p); return false; }
  override isComplete(): boolean { return !this.creating && this.points.length >= 2; }
  protected lineEnds(ctx: CanvasRenderingContext2D, px: PixelPoint[]): void {
    const s = this.style;
    if (px.length < 2) return;
    ctx.setLineDash([]);
    const size = 8 + (Number(s.lineWidth) || 1) * 2;
    if (s.leftEnd === 1) drawArrowHead(ctx, px[1], px[0], size);
    if (s.rightEnd === 1) drawArrowHead(ctx, px[px.length - 2], px[px.length - 1], size);
  }
}

export class Polyline extends VertexTool {
  static override toolId = 'polyline';
  static override toolName = 'Polyline';
  static override icon = svgIcon('M4.5 20.5l7-11 5 7 7-11 .8.6-7.8 12.2-5-7-6.2 9.7z');
  defaultStyle(): Record<string, any> { return { lineColor: '#00BCD4', lineWidth: 2, lineStyle: 0, filled: false, fillColor: 'rgba(0, 188, 212, 0.2)' }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('filled', 'Fill'), P.color('fillColor', 'Background color')]; }
  protected override get filled(): boolean { return !!this.style.filled; }
  /** Clicking the first vertex again closes (and fills) the shape — TradingView behaviour. */
  override isComplete(): boolean {
    if (!this.creating) return this.points.length >= 2;
    const n = this.points.length;
    if (n >= 4 && this._px.length === n) {
      const a = this._px[0], b = this._px[n - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) <= POINT_HIT_RADIUS + 1) { this.points.pop(); this.style.filled = true; return true; }
    }
    return false;
  }
  render(rc: DrawingRenderContext): void {
    const px = this.px(rc);
    if (px.length < 2) return;
    const { ctx } = rc;
    const s = this.style;
    tracePath(ctx, px, this.filled && px.length > 2);
    if (this.filled && px.length > 2) { ctx.fillStyle = s.fillColor; ctx.fill(); }
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    ctx.stroke();
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const px = this.px(rc);
    const hp = hitPoint(px, x, y);
    if (hp) return hp;
    const closed = this.filled && px.length > 2;
    if (nearPolyline(px, x, y, strokeTolerance(this.style.lineWidth), closed)) return { type: 'body' };
    if (closed && pointInPolygon(x, y, px)) return { type: 'body', part: 'inside' };
    return null;
  }
}

export class Path extends VertexTool {
  static override toolId = 'path';
  static override toolName = 'Path';
  static override icon = svgIcon('M4.5 21.5l6-9 5 5 6.7-9.6.8.6L16.4 19l-5-5-6.1 9.1zM23 6v6h-1V7.7l-1.8 2.6-.8-.6L21.3 7H17V6z');
  defaultStyle(): Record<string, any> { return { lineColor: '#2962FF', lineWidth: 2, lineStyle: 0, leftEnd: 0, rightEnd: 1 }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.select('leftEnd', 'Left end', LINE_END_OPTIONS), P.select('rightEnd', 'Right end', LINE_END_OPTIONS)]; }
  render(rc: DrawingRenderContext): void {
    const px = this.px(rc);
    if (px.length < 2) return;
    const { ctx } = rc;
    const s = this.style;
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    tracePath(ctx, px);
    ctx.stroke();
    this.lineEnds(ctx, px);
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const px = this.px(rc);
    const hp = hitPoint(px, x, y);
    if (hp) return hp;
    return nearPolyline(px, x, y, strokeTolerance(this.style.lineWidth)) ? { type: 'body' } : null;
  }
}

// ---------------------------------------------------------------------------------------------
// Brush / Highlighter (freehand: pointsCount 0, points appended while dragging, done on mouse up)
// ---------------------------------------------------------------------------------------------

export class Brush extends Shape {
  static override toolId = 'brush';
  static override toolName = 'Brush';
  static override pointsCount = 0; // freehand
  static override icon = svgIcon('M20.5 4.5l3 3L11 20l-4 1 1-4L20.5 4.5zm0 1.4L9 17.4l-.5 2.1 2.1-.5L22.1 7.5l-1.6-1.6z');
  defaultStyle(): Record<string, any> { return { lineColor: '#00BCD4', lineWidth: 2, lineStyle: 0, smooth: 5, fillBackground: false, fillColor: 'rgba(0, 188, 212, 0.5)', leftEnd: 0, rightEnd: 0 }; }
  propertyDefs(): PropertyDef[] {
    return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.int('smooth', 'Smoothing', 0, 20), P.bool('fillBackground', 'Background'), P.color('fillColor', 'Background color'),
      P.select('leftEnd', 'Left end', LINE_END_OPTIONS), P.select('rightEnd', 'Right end', LINE_END_OPTIONS)];
  }
  override isComplete(): boolean { return this.points.length >= 2 && !this.creating; }
  /** Stroke colour / width (Highlighter overrides with its own keys). */
  protected strokeColor(): string { return this.style.lineColor; }
  protected strokeWidth(): number { return Number(this.style.lineWidth) || 1; }
  protected traceStroke(ctx: CanvasRenderingContext2D, px: PixelPoint[]): void {
    const smooth = Number(this.style.smooth) || 0;
    ctx.beginPath();
    ctx.moveTo(px[0].x, px[0].y);
    if (smooth > 0 && px.length > 2) {
      for (let i = 1; i < px.length - 1; i++) {
        const mx = (px[i].x + px[i + 1].x) / 2, my = (px[i].y + px[i + 1].y) / 2;
        ctx.quadraticCurveTo(px[i].x, px[i].y, mx, my);
      }
      ctx.lineTo(px[px.length - 1].x, px[px.length - 1].y);
    } else for (let i = 1; i < px.length; i++) ctx.lineTo(px[i].x, px[i].y);
  }
  render(rc: DrawingRenderContext): void {
    const px = this.px(rc);
    if (px.length < 2) return;
    const { ctx } = rc;
    const s = this.style;
    if (s.fillBackground && px.length > 2) { this.traceStroke(ctx, px); ctx.closePath(); ctx.fillStyle = s.fillColor; ctx.fill(); }
    applyLine(ctx, this.strokeColor(), this.strokeWidth(), s.lineStyle ?? 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    this.traceStroke(ctx, px);
    ctx.stroke();
    ctx.setLineDash([]);
    const size = 8 + this.strokeWidth() * 2;
    if (s.leftEnd === 1) drawArrowHead(ctx, px[1], px[0], size);
    if (s.rightEnd === 1) drawArrowHead(ctx, px[px.length - 2], px[px.length - 1], size);
  }
  /** Only the first and last samples get handles. */
  override handles(rc: DrawingRenderContext): Array<PixelPoint & { index: number }> {
    if (!this.points.length) return [];
    const a = rc.toPixel(this.points[0]);
    if (this.points.length === 1) return [{ x: a.x, y: a.y, index: 0 }];
    const b = rc.toPixel(this.points[this.points.length - 1]);
    return [{ x: a.x, y: a.y, index: 0 }, { x: b.x, y: b.y, index: this.points.length - 1 }];
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const px = this.px(rc);
    if (nearPolyline(px, x, y, strokeTolerance(this.strokeWidth()))) return { type: 'body' };
    if (this.filled && px.length > 2 && pointInPolygon(x, y, px)) return { type: 'body', part: 'inside' };
    return null;
  }
}

export class Highlighter extends Brush {
  static override toolId = 'highlighter';
  static override toolName = 'Highlighter';
  static override icon = svgIcon('M19 4l5 5-9 9-5-5 9-9zm0 1.4L11.4 13l3.6 3.6L22.6 9 19 5.4zM9.5 14.5l4 4L11 21H6v-2.5l3.5-4z');
  /** Own keys (`color`, `width`) so the chart's default line colour/width never override the marker look. */
  defaultStyle(): Record<string, any> { return { color: 'rgba(242, 54, 69, 0.2)', width: 20, smooth: 5 }; }
  propertyDefs(): PropertyDef[] { return [P.color('color', 'Color'), P.int('width', 'Width', 4, 60), P.int('smooth', 'Smoothing', 0, 20)]; }
  protected override strokeColor(): string { return this.style.color; }
  protected override strokeWidth(): number { return clamp(Number(this.style.width) || 20, 1, 200); }
  protected override get filled(): boolean { return false; }
}

export const shapeTools = [Brush, Highlighter, Rectangle, RotatedRectangle, Ellipse, Circle, Polyline, Path, Triangle, Arc, Curve, DoubleCurve];
