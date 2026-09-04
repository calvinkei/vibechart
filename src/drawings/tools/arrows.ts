import { Drawing, P, type DrawingRenderContext, type HitTarget, type PixelPoint, type PropertyDef } from '../Drawing';
import { drawTextBox, fontFor } from './common';
import { pointInPolygon, pointInRect, clamp } from '../../util/math';
import { svgIcon, hitPoint, POINT_HIT_RADIUS, tracePath } from './shapes';

type Rect = { x: number; y: number; w: number; h: number };

function inRect(x: number, y: number, r: Rect | null): boolean {
  return !!r && pointInRect(x, y, r.x, r.y, r.x + r.w, r.y + r.h);
}

/** Thick filled arrow polygon from tail `a` to head `b` (pixel space). Empty when degenerate. */
export function arrowMarkerPolygon(a: PixelPoint, b: PixelPoint): PixelPoint[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return [];
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const headLen = clamp(L * 0.35, 6, 26);
  const headHalf = headLen * 0.55;
  const shaftHalf = Math.max(2, headHalf * 0.42);
  const base = { x: b.x - ux * headLen, y: b.y - uy * headLen };
  return [
    { x: a.x + nx * shaftHalf, y: a.y + ny * shaftHalf },
    { x: base.x + nx * shaftHalf, y: base.y + ny * shaftHalf },
    { x: base.x + nx * headHalf, y: base.y + ny * headHalf },
    { x: b.x, y: b.y },
    { x: base.x - nx * headHalf, y: base.y - ny * headHalf },
    { x: base.x - nx * shaftHalf, y: base.y - ny * shaftHalf },
    { x: a.x - nx * shaftHalf, y: a.y - ny * shaftHalf },
  ];
}

// ---------------------------------------------------------------------------------------------
// Arrow marker (2 points: tail → head), thick filled arrow with an optional text signature
// ---------------------------------------------------------------------------------------------

export class ArrowMarker extends Drawing {
  static override toolId = 'arrow_marker';
  static override toolName = 'Arrow Marker';
  static override pointsCount = 2;
  static override group = 'shapes' as const;
  static override icon = svgIcon('M5 15.5v-3h11V8l7 6-7 6v-4.5z');
  defaultStyle(): Record<string, any> { return { backgroundColor: '#1E53E5', text: '', textColor: '#1E53E5', fontSize: 16, bold: true, italic: false }; }
  propertyDefs(): PropertyDef[] {
    return [P.color('backgroundColor', 'Arrow'), P.text('text', 'Text'), P.color('textColor', 'Text color', 'Text'), P.fontSize('fontSize'), P.bool('bold', 'Bold', 'Text'), P.bool('italic', 'Italic', 'Text')];
  }
  private _label: Rect | null = null;
  polygon(rc: DrawingRenderContext): PixelPoint[] {
    if (this.points.length < 2) return [];
    return arrowMarkerPolygon(rc.toPixel(this.points[0]), rc.toPixel(this.points[1]));
  }
  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const a = rc.toPixel(this.points[0]), b = rc.toPixel(this.points[1]);
    const poly = arrowMarkerPolygon(a, b);
    const { ctx } = rc;
    const s = this.style;
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    this._label = null;
    if (!poly.length) { ctx.fillStyle = s.backgroundColor; ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fill(); return; }
    tracePath(ctx, poly, true);
    ctx.fillStyle = s.backgroundColor;
    ctx.fill();
    if (s.text) {
      // signature beside the shaft midpoint, on the upper side of the arrow
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      let nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
      if (ny > 0) { nx = -nx; ny = -ny; }
      const mx = (a.x + b.x) / 2 + nx * 14, my = (a.y + b.y) / 2 + ny * 14;
      this._label = drawTextBox(ctx, String(s.text), mx, my, { font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.textColor, align: 'center', vAlign: 'middle', padding: 2 });
    }
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const px = this.points.map((p) => rc.toPixel(p));
    const hp = hitPoint(px, x, y);
    if (hp) return hp;
    const poly = arrowMarkerPolygon(px[0], px[1]);
    if (poly.length && pointInPolygon(x, y, poly)) return { type: 'body' };
    if (inRect(x, y, this._label)) return { type: 'body', part: 'text' };
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Arrow marks up / down / left / right (1 point, fixed-size glyph with the tip at the point)
// ---------------------------------------------------------------------------------------------

export type ArrowDirection = 'up' | 'down' | 'left' | 'right';

/** Unit glyph pointing up: tip at the origin, body 22 px long. */
const UP_GLYPH: Array<[number, number]> = [[0, 0], [-8, 10], [-3.5, 10], [-3.5, 22], [3.5, 22], [3.5, 10], [8, 10]];

export function arrowMarkPolygon(p: PixelPoint, dir: ArrowDirection): PixelPoint[] {
  return UP_GLYPH.map(([x, y]) => {
    let X = x, Y = y;
    if (dir === 'down') Y = -y;
    else if (dir === 'left') { X = y; Y = x; }
    else if (dir === 'right') { X = -y; Y = x; }
    return { x: p.x + X, y: p.y + Y };
  });
}

export abstract class ArrowMark extends Drawing {
  static override pointsCount = 1;
  static override group = 'shapes' as const;
  protected abstract dir(): ArrowDirection;
  protected abstract baseColor(): string;
  defaultStyle(): Record<string, any> {
    const c = this.baseColor();
    return { arrowColor: c, showLabel: true, text: '', color: c, fontSize: 14, bold: false, italic: false };
  }
  propertyDefs(): PropertyDef[] {
    return [P.color('arrowColor', 'Arrow'), P.bool('showLabel', 'Show label', 'Text'), P.text('text', 'Text'), P.color('color', 'Text color', 'Text'), P.fontSize('fontSize'), P.bool('bold', 'Bold', 'Text'), P.bool('italic', 'Italic', 'Text')];
  }
  private _label: Rect | null = null;
  polygon(rc: DrawingRenderContext): PixelPoint[] { return this.points.length ? arrowMarkPolygon(rc.toPixel(this.points[0]), this.dir()) : []; }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = rc.toPixel(this.points[0]);
    const { ctx } = rc;
    const s = this.style;
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    tracePath(ctx, arrowMarkPolygon(p, this.dir()), true);
    ctx.fillStyle = s.arrowColor;
    ctx.fill();
    this._label = null;
    if (s.showLabel && s.text) {
      const font = fontFor(rc, s.fontSize, s.bold, s.italic);
      const d = this.dir();
      const o = { font, color: s.color, padding: 2 } as const;
      if (d === 'up') this._label = drawTextBox(ctx, String(s.text), p.x, p.y + 25, { ...o, align: 'center', vAlign: 'top' });
      else if (d === 'down') this._label = drawTextBox(ctx, String(s.text), p.x, p.y - 25, { ...o, align: 'center', vAlign: 'bottom' });
      else if (d === 'left') this._label = drawTextBox(ctx, String(s.text), p.x + 25, p.y, { ...o, align: 'left', vAlign: 'middle' });
      else this._label = drawTextBox(ctx, String(s.text), p.x - 25, p.y, { ...o, align: 'right', vAlign: 'middle' });
    }
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = rc.toPixel(this.points[0]);
    if (Math.hypot(p.x - x, p.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: 0 };
    if (pointInPolygon(x, y, arrowMarkPolygon(p, this.dir()))) return { type: 'body' };
    if (inRect(x, y, this._label)) return { type: 'body', part: 'text' };
    return null;
  }
  override bounds(rc: DrawingRenderContext) {
    if (!this.points.length) return null;
    const poly = this.polygon(rc);
    const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y);
    let b = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    if (this._label) b = { x1: Math.min(b.x1, this._label.x), y1: Math.min(b.y1, this._label.y), x2: Math.max(b.x2, this._label.x + this._label.w), y2: Math.max(b.y2, this._label.y + this._label.h) };
    return b;
  }
}

export class ArrowUp extends ArrowMark {
  static override toolId = 'arrow_up';
  static override toolName = 'Arrow Up';
  static override icon = svgIcon('M14 4l8 9h-4.5v10h-7V13H6z');
  protected dir(): ArrowDirection { return 'up'; }
  protected baseColor(): string { return '#089981'; }
}

export class ArrowDown extends ArrowMark {
  static override toolId = 'arrow_down';
  static override toolName = 'Arrow Down';
  static override icon = svgIcon('M14 24l-8-9h4.5V5h7v10H22z');
  protected dir(): ArrowDirection { return 'down'; }
  protected baseColor(): string { return '#CC2F3C'; }
}

export class ArrowLeft extends ArrowMark {
  static override toolId = 'arrow_left';
  static override toolName = 'Arrow Left';
  static override icon = svgIcon('M4 14l9-8v4.5h10v7H13V22z');
  protected dir(): ArrowDirection { return 'left'; }
  protected baseColor(): string { return '#2962FF'; }
}

export class ArrowRight extends ArrowMark {
  static override toolId = 'arrow_right';
  static override toolName = 'Arrow Right';
  static override icon = svgIcon('M24 14l-9 8v-4.5H5v-7h10V6z');
  protected dir(): ArrowDirection { return 'right'; }
  protected baseColor(): string { return '#2962FF'; }
}

export const arrowsTools = [ArrowMarker, ArrowUp, ArrowDown, ArrowLeft, ArrowRight];
