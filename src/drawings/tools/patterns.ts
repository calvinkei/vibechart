import { Drawing, P, type DrawingRenderContext, type HitTarget, type PropertyDef, type PixelPoint, HIT_TOLERANCE } from '../Drawing';
import { applyLine, drawTextBox, fontFor, roundRect } from './common';
import { withAlpha } from '../../util/color';
import { distToSegment, pointInPolygon } from '../../util/math';
import { crisp } from '../../render/canvas';

// ---------------------------------------------------------------------------
// Shared helpers (also used by elliott.ts)
// ---------------------------------------------------------------------------

const GREY = '#787B86';
const POINT_HIT = 7;

export type LabelSide = 'above' | 'below';

/** Label goes above a local high (smaller pixel y than its neighbours) and below a local low. */
export function labelSides(px: PixelPoint[]): LabelSide[] {
  return px.map((p, i) => {
    const prev = px[i - 1], next = px[i + 1];
    let mean: number;
    if (prev && next) mean = (prev.y + next.y) / 2;
    else if (prev) mean = prev.y;
    else if (next) mean = next.y;
    else return 'above';
    return p.y <= mean ? 'above' : 'below';
  });
}

export interface PointLabelOpts { font: string; bg: string; color: string; offset?: number }

/** Letter label in a filled circle / pill next to an anchor (TradingView pattern labels). Returns its rect. */
export function drawPointLabel(ctx: CanvasRenderingContext2D, text: string, p: PixelPoint, side: LabelSide, o: PointLabelOpts): { x: number; y: number; w: number; h: number } {
  ctx.font = o.font;
  const fs = parseInt(o.font.match(/(\d+)px/)?.[1] ?? '12', 10);
  const tw = ctx.measureText(text).width;
  const h = fs + 6;
  const w = Math.max(h, tw + 8);
  const gap = (o.offset ?? 6) + h / 2;
  const cx = p.x, cy = side === 'above' ? p.y - gap : p.y + gap;
  ctx.setLineDash([]);
  ctx.fillStyle = o.bg;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = o.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 0.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Ratio label on a leg: white text on the pattern colour. */
export function drawRatioLabel(ctx: CanvasRenderingContext2D, text: string, at: PixelPoint, o: { font: string; bg: string; color: string }): { x: number; y: number; w: number; h: number } {
  ctx.setLineDash([]);
  return drawTextBox(ctx, text, at.x, at.y, { font: o.font, color: o.color, bg: o.bg, radius: 3, padding: 2, align: 'center', vAlign: 'middle' });
}

/** |num| / |den| with 3 decimals like TradingView's harmonic ratio labels ('' when undefined). */
export function formatRatio(num: number, den: number): string {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return '';
  return (Math.abs(num) / Math.abs(den)).toFixed(3);
}

function nearPoint(pts: PixelPoint[], x: number, y: number): HitTarget {
  for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - x, pts[i].y - y) <= POINT_HIT) return { type: 'point', index: i };
  return null;
}

function finite(p: PixelPoint): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function alphaFor(transparency: unknown, fallback: number): number {
  const t = Number(transparency);
  return Math.max(0, Math.min(1, (100 - (Number.isFinite(t) ? t : fallback)) / 100));
}

function strokeSegment(ctx: CanvasRenderingContext2D, a: PixelPoint, b: PixelPoint, color: string, width: number, style: number): void {
  applyLine(ctx, color, width, style);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---------------------------------------------------------------------------
// Harmonic / classic pattern base
// ---------------------------------------------------------------------------

export interface RatioLabel { text: string; a: number; b: number }

export abstract class PatternBase extends Drawing {
  static override group = 'patterns' as const;

  /** Per-point letters ('' = no label). */
  abstract pointLabels(): string[];
  /** Solid legs (index pairs); default = consecutive points. */
  legs(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let i = 1; i < this.requiredPoints; i++) out.push([i - 1, i]);
    return out;
  }
  /** Dashed helper lines (index pairs). */
  dashedLegs(): Array<[number, number]> { return []; }
  /** Filled polygons (index lists). */
  fills(): number[][] { return []; }
  /** Ratio labels placed at the midpoint of a–b. */
  ratioLabels(): RatioLabel[] { return []; }
  /** |price[j] − price[i]| / |price[l] − price[k]| as a 3-decimal string. */
  ratio(i: number, j: number, k: number, l: number): string {
    const p = this.points;
    if (!p[i] || !p[j] || !p[k] || !p[l]) return '';
    return formatRatio(p[j].price - p[i].price, p[l].price - p[k].price);
  }

  protected baseStyle(color: string, background: string, transparency: number, fill = true): Record<string, any> {
    return { color, lineWidth: 2, lineStyle: 0, fillBackground: fill, backgroundColor: background, transparency, textColor: '#FFFFFF', fontSize: 12, bold: false, italic: false };
  }
  defaultStyle(): Record<string, any> { return this.baseStyle('#2962FF', '#2962FF', 85); }
  propertyDefs(): PropertyDef[] {
    return [
      P.color('color', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'),
      P.bool('fillBackground', 'Background'), P.color('backgroundColor', 'Background color'), P.int('transparency', 'Transparency', 0, 100),
      P.color('textColor', 'Text color', 'Text'), P.fontSize('fontSize'), P.bool('bold', 'Bold', 'Text'), P.bool('italic', 'Italic', 'Text'),
    ];
  }

  protected pixels(rc: DrawingRenderContext): PixelPoint[] { return this.points.map((p) => rc.toPixel(p)).filter(finite); }
  protected labelFont(rc: DrawingRenderContext): string { return fontFor(rc, this.style.fontSize || 12, !!this.style.bold, !!this.style.italic); }

  protected renderFills(rc: DrawingRenderContext, px: PixelPoint[]): void {
    const s = this.style;
    if (!s.fillBackground) return;
    const { ctx } = rc;
    ctx.fillStyle = withAlpha(s.backgroundColor || s.color, alphaFor(s.transparency, 85));
    for (const poly of this.fills()) {
      if (poly.length < 3 || poly.some((i) => i >= px.length)) continue;
      ctx.beginPath();
      ctx.moveTo(px[poly[0]].x, px[poly[0]].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(px[poly[i]].x, px[poly[i]].y);
      ctx.closePath();
      ctx.fill();
    }
  }

  protected renderLegs(rc: DrawingRenderContext, px: PixelPoint[]): void {
    const { ctx } = rc;
    const s = this.style;
    const draw = (pairs: Array<[number, number]>, style: number) => {
      const valid = pairs.filter(([a, b]) => a < px.length && b < px.length);
      if (!valid.length) return;
      applyLine(ctx, s.color, s.lineWidth, style);
      ctx.beginPath();
      for (const [a, b] of valid) { ctx.moveTo(px[a].x, px[a].y); ctx.lineTo(px[b].x, px[b].y); }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    draw(this.legs(), s.lineStyle);
    draw(this.dashedLegs(), 2);
  }

  protected renderRatios(rc: DrawingRenderContext, px: PixelPoint[]): void {
    const s = this.style;
    const font = fontFor(rc, Math.max(10, (s.fontSize || 12) - 1));
    for (const r of this.ratioLabels()) {
      if (!r.text || r.a >= px.length || r.b >= px.length) continue;
      drawRatioLabel(rc.ctx, r.text, { x: (px[r.a].x + px[r.b].x) / 2, y: (px[r.a].y + px[r.b].y) / 2 }, { font, bg: s.color, color: s.textColor });
    }
  }

  protected renderLabels(rc: DrawingRenderContext, px: PixelPoint[]): void {
    const s = this.style;
    const labels = this.pointLabels();
    const sides = labelSides(px);
    const font = this.labelFont(rc);
    for (let i = 0; i < px.length && i < labels.length; i++) {
      if (!labels[i]) continue;
      drawPointLabel(rc.ctx, labels[i], px[i], sides[i], { font, bg: s.color, color: s.textColor });
    }
  }

  render(rc: DrawingRenderContext): void {
    const px = this.pixels(rc);
    if (!px.length) return;
    this.renderFills(rc, px);
    this.renderLegs(rc, px);
    this.renderRatios(rc, px);
    this.renderLabels(rc, px);
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const px = this.pixels(rc);
    const hp = nearPoint(px, x, y);
    if (hp) return hp;
    const tol = HIT_TOLERANCE + (this.style.lineWidth || 1) / 2;
    for (const [a, b] of [...this.legs(), ...this.dashedLegs()]) {
      if (a >= px.length || b >= px.length) continue;
      if (distToSegment(x, y, px[a].x, px[a].y, px[b].x, px[b].y) <= tol) return { type: 'body' };
    }
    if (this.style.fillBackground) {
      for (const poly of this.fills()) {
        if (poly.length < 3 || poly.some((i) => i >= px.length)) continue;
        if (pointInPolygon(x, y, poly.map((i) => px[i]))) return { type: 'body', part: 'inside' };
      }
    }
    return null;
  }
}

export class XABCDPattern extends PatternBase {
  static override toolId = 'xabcd_pattern';
  static override toolName = 'XABCD Pattern';
  static override pointsCount = 5;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M3.6 22.5l5-16 .9.3-5 16zM8.6 6.5l4 10 .9-.4-4-10zM12.6 16.1l5-11 .9.4-5 11zM17.6 5.1l6 17 .9-.3-6-17z"/><path fill="currentColor" d="M4 24a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM9 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM13 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM24 24a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>';
  pointLabels(): string[] { return ['X', 'A', 'B', 'C', 'D']; }
  override dashedLegs(): Array<[number, number]> { return [[0, 2], [2, 4], [0, 4]]; }
  override fills(): number[][] { return [[0, 1, 2], [2, 3, 4]]; }
  override ratioLabels(): RatioLabel[] {
    return [
      { text: this.ratio(1, 2, 0, 1), a: 0, b: 2 }, // AB / XA on X–B
      { text: this.ratio(2, 3, 1, 2), a: 2, b: 3 }, // BC / AB on the BC leg
      { text: this.ratio(3, 4, 2, 3), a: 2, b: 4 }, // CD / BC on B–D
      { text: this.ratio(1, 4, 0, 1), a: 0, b: 4 }, // AD / XA on X–D
    ];
  }
}

export class CypherPattern extends XABCDPattern {
  static override toolId = 'cypher_pattern';
  static override toolName = 'Cypher Pattern';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M3.6 20.5l5-13 .9.3-5 13zM8.6 7.5l4 9 .9-.4-4-9zM12.6 16.1l5-13 .9.4-5 13zM17.6 3.1l6 19 .9-.3-6-19z"/><path fill="currentColor" d="M4 22a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM9 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM13 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM24 24a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>';
  override ratioLabels(): RatioLabel[] {
    return [
      { text: this.ratio(1, 2, 0, 1), a: 0, b: 2 }, // AB / XA
      { text: this.ratio(0, 3, 0, 1), a: 2, b: 3 }, // XC / XA (C extension of XA)
      { text: this.ratio(3, 4, 2, 3), a: 2, b: 4 }, // CD / BC
      { text: this.ratio(3, 4, 0, 3), a: 0, b: 4 }, // CD / XC (D retracement of XC)
    ];
  }
}

export class ABCDPattern extends PatternBase {
  static override toolId = 'abcd_pattern';
  static override toolName = 'ABCD Pattern';
  static override pointsCount = 4;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4.6 21.5l6-14 .9.4-6 14zM10.6 7.9l6 10 .9-.5-6-10zM16.6 17.5l6-14 .9.4-6 14z"/><path fill="currentColor" d="M5 23a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM11 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM23 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>';
  defaultStyle(): Record<string, any> { return this.baseStyle('#089981', '#089981', 85, false); }
  pointLabels(): string[] { return ['A', 'B', 'C', 'D']; }
  override dashedLegs(): Array<[number, number]> { return [[0, 2], [1, 3]]; }
  override ratioLabels(): RatioLabel[] {
    return [
      { text: this.ratio(1, 2, 0, 1), a: 0, b: 2 }, // BC / AB on A–C
      { text: this.ratio(2, 3, 1, 2), a: 1, b: 3 }, // CD / BC on B–D
    ];
  }
}

function lineIntersection(p1: PixelPoint, p2: PixelPoint, p3: PixelPoint, p4: PixelPoint): PixelPoint | null {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / d;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

export class TrianglePattern extends PatternBase {
  static override toolId = 'triangle_pattern';
  static override toolName = 'Triangle Pattern';
  static override pointsCount = 4;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M3.7 5.6l20 8-.4.9-20-8zM3.7 22.4l20-8-.4-.9-20 8z"/><path fill="currentColor" d="M4.6 6.5l4 14 .9-.3-4-14zM8.6 20.1l5-13 .9.4-5 13z"/></svg>';
  defaultStyle(): Record<string, any> { return this.baseStyle('#673AB7', '#673AB7', 85); }
  pointLabels(): string[] { return ['A', 'B', 'C', 'D']; }

  /** Ends of the A–C and B–D lines extended to the right (their apex, or the pane edge). */
  extensions(rc: DrawingRenderContext, px: PixelPoint[]): [PixelPoint, PixelPoint] | null {
    if (px.length < 4) return null;
    const [a, b, c, d] = px;
    const edge = rc.width + 10;
    const toEdge = (p: PixelPoint, q: PixelPoint): PixelPoint => {
      if (q.x <= p.x) return q;
      const t = (edge - p.x) / (q.x - p.x);
      return t <= 1 ? q : { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) };
    };
    const apex = lineIntersection(a, c, b, d);
    if (apex && Number.isFinite(apex.x) && Number.isFinite(apex.y) && apex.x > Math.max(c.x, d.x) && apex.x <= edge) return [apex, apex];
    return [toEdge(a, c), toEdge(b, d)];
  }

  override render(rc: DrawingRenderContext): void {
    const px = this.pixels(rc);
    if (!px.length) return;
    const { ctx } = rc;
    const s = this.style;
    const ext = this.extensions(rc, px);
    if (ext && s.fillBackground) {
      ctx.fillStyle = withAlpha(s.backgroundColor || s.color, alphaFor(s.transparency, 85));
      ctx.beginPath();
      ctx.moveTo(px[0].x, px[0].y); ctx.lineTo(px[2].x, px[2].y); ctx.lineTo(ext[0].x, ext[0].y);
      ctx.lineTo(ext[1].x, ext[1].y); ctx.lineTo(px[3].x, px[3].y); ctx.lineTo(px[1].x, px[1].y);
      ctx.closePath(); ctx.fill();
    }
    this.renderLegs(rc, px);
    if (ext) {
      strokeSegment(ctx, px[0], ext[0], s.color, s.lineWidth, s.lineStyle);
      strokeSegment(ctx, px[1], ext[1], s.color, s.lineWidth, s.lineStyle);
    }
    this.renderLabels(rc, px);
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const base = super.hitTest(x, y, rc);
    if (base) return base;
    const px = this.pixels(rc);
    const ext = this.extensions(rc, px);
    if (!ext) return null;
    const tol = HIT_TOLERANCE + (this.style.lineWidth || 1) / 2;
    if (distToSegment(x, y, px[0].x, px[0].y, ext[0].x, ext[0].y) <= tol) return { type: 'body' };
    if (distToSegment(x, y, px[1].x, px[1].y, ext[1].x, ext[1].y) <= tol) return { type: 'body' };
    if (this.style.fillBackground && pointInPolygon(x, y, [px[0], px[2], ext[0], ext[1], px[3], px[1]])) return { type: 'body', part: 'inside' };
    return null;
  }
}

export class ThreeDrivesPattern extends PatternBase {
  static override toolId = 'three_drives_pattern';
  static override toolName = 'Three Drives Pattern';
  static override pointsCount = 7;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M2.6 23.5l4-8 .9.4-4 8zM6.6 15.9l3 5 .9-.5-3-5zM9.6 20.5l4-9 .9.4-4 9zM13.6 11.9l3 5 .9-.5-3-5zM16.6 16.5l4-9 .9.4-4 9zM20.6 7.9l3 5 .9-.5-3-5z"/></svg>';
  defaultStyle(): Record<string, any> { return this.baseStyle('#673AB7', 'rgba(149, 40, 204, 0.5)', 50); }
  pointLabels(): string[] { return ['0', '1', 'A', '2', 'B', '3', 'C']; }
  override fills(): number[][] { return [[0, 1, 2], [2, 3, 4], [4, 5, 6]]; }
  override ratioLabels(): RatioLabel[] {
    return [
      { text: this.ratio(1, 2, 0, 1), a: 1, b: 2 }, // A retracement of drive 1
      { text: this.ratio(2, 3, 1, 2), a: 2, b: 3 }, // drive 2 extension
      { text: this.ratio(3, 4, 2, 3), a: 3, b: 4 }, // B retracement of drive 2
      { text: this.ratio(4, 5, 3, 4), a: 4, b: 5 }, // drive 3 extension
      { text: this.ratio(5, 6, 4, 5), a: 5, b: 6 }, // C retracement of drive 3
    ];
  }
}

export class HeadAndShoulders extends PatternBase {
  static override toolId = 'head_and_shoulders';
  static override toolName = 'Head and Shoulders';
  static override pointsCount = 7;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M2.6 21.5l3-8 .9.4-3 8zM5.6 13.9l3 6 .9-.5-3-6zM8.6 19.5l5-15 .9.3-5 15zM13.6 4.8l5 15 .9-.3-5-15zM18.6 19.5l3-6 .9.5-3 6zM21.6 13.9l3 8 .9-.4-3-8z"/><path fill="currentColor" d="M3 19h22v1H3z"/></svg>';
  defaultStyle(): Record<string, any> { return this.baseStyle('#089981', '#089981', 85); }
  pointLabels(): string[] { return ['', 'LS', '', 'H', '', 'RS', '']; }

  /** Neckline through the two valleys (points 3 and 5), spanning the pattern's x-range. */
  neckline(px: PixelPoint[]): [PixelPoint, PixelPoint] | null {
    if (px.length < 5) return null;
    const v1 = px[2], v2 = px[4];
    const slope = v2.x === v1.x ? 0 : (v2.y - v1.y) / (v2.x - v1.x);
    const xs = px.map((p) => p.x);
    const x1 = Math.min(...xs), x2 = Math.max(...xs);
    return [{ x: x1, y: v1.y + slope * (x1 - v1.x) }, { x: x2, y: v1.y + slope * (x2 - v1.x) }];
  }

  private _fillPolygon(px: PixelPoint[]): PixelPoint[] | null {
    if (px.length < 7) return null;
    const v1 = px[2], v2 = px[4];
    const slope = v2.x === v1.x ? 0 : (v2.y - v1.y) / (v2.x - v1.x);
    const at = (x: number): PixelPoint => ({ x, y: v1.y + slope * (x - v1.x) });
    return [at(px[0].x), px[1], px[2], px[3], px[4], px[5], at(px[6].x)];
  }

  override render(rc: DrawingRenderContext): void {
    const px = this.pixels(rc);
    if (!px.length) return;
    const { ctx } = rc;
    const s = this.style;
    const poly = this._fillPolygon(px);
    if (poly && s.fillBackground) {
      ctx.fillStyle = withAlpha(s.backgroundColor || s.color, alphaFor(s.transparency, 85));
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath(); ctx.fill();
    }
    this.renderLegs(rc, px);
    const neck = this.neckline(px);
    if (neck) strokeSegment(ctx, neck[0], neck[1], s.color, s.lineWidth, s.lineStyle);
    this.renderLabels(rc, px);
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const base = super.hitTest(x, y, rc);
    if (base) return base;
    const px = this.pixels(rc);
    const neck = this.neckline(px);
    const tol = HIT_TOLERANCE + (this.style.lineWidth || 1) / 2;
    if (neck && distToSegment(x, y, neck[0].x, neck[0].y, neck[1].x, neck[1].y) <= tol) return { type: 'body' };
    const poly = this._fillPolygon(px);
    if (poly && this.style.fillBackground && pointInPolygon(x, y, poly)) return { type: 'body', part: 'inside' };
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cyclic lines / Time cycles / Sine line
// ---------------------------------------------------------------------------

export class CyclicLines extends Drawing {
  static override toolId = 'cyclic_lines';
  static override toolName = 'Cyclic Lines';
  static override pointsCount = 2;
  static override group = 'patterns' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M5 3h1v22H5zM11 3h1v22h-1zM17 3h1v22h-1zM23 3h1v22h-1z"/><path fill="currentColor" d="M6 14h5v1H6z"/></svg>';
  defaultStyle(): Record<string, any> {
    return { lineColor: '#80CCDB', lineWidth: 1, lineStyle: 0, extendLeft: false, showTrendLine: true, trendLineColor: GREY, trendLineWidth: 1, trendLineStyle: 2 };
  }
  propertyDefs(): PropertyDef[] {
    return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('extendLeft', 'Extend left'),
      P.bool('showTrendLine', 'Trend line'), P.color('trendLineColor', 'Trend line color'), P.lineWidth('trendLineWidth', 'Trend line width'), P.lineStyle('trendLineStyle', 'Trend line style')];
  }

  /** Bar interval between the two points. */
  period(rc: DrawingRenderContext): number {
    if (this.points.length < 2) return 0;
    const ts = rc.timeScale;
    return Math.abs(ts.timeToIndex(this.points[1].time) - ts.timeToIndex(this.points[0].time));
  }

  /** Vertical lines at i0 + k·period (index space), k ≥ 0 (and k < 0 with `extendLeft`), limited to the pane. */
  lines(rc: DrawingRenderContext): Array<{ k: number; index: number; x: number }> {
    if (this.points.length < 2) return [];
    const ts = rc.timeScale;
    const i1 = ts.timeToIndex(this.points[0].time), i2 = ts.timeToIndex(this.points[1].time);
    if (!Number.isFinite(i1) || !Number.isFinite(i2)) return [];
    const i0 = Math.min(i1, i2);
    const step = Math.abs(i2 - i1);
    const x0 = ts.barCenterX(i0);
    const stepPx = step * ts.barSpacing;
    const out: Array<{ k: number; index: number; x: number }> = [];
    if (!(stepPx >= 0.5)) {
      if (x0 >= -20 && x0 <= rc.width + 20) out.push({ k: 0, index: i0, x: x0 });
      return out;
    }
    const kMin = this.style.extendLeft ? Math.max(-500, Math.floor((-20 - x0) / stepPx)) : 0;
    const kMax = Math.min(500, Math.ceil((rc.width + 20 - x0) / stepPx));
    for (let k = kMin; k <= kMax; k++) {
      const index = i0 + k * step;
      const x = ts.barCenterX(index);
      if (x < -20 || x > rc.width + 20) continue;
      out.push({ k, index, x });
    }
    return out;
  }

  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const { ctx, height } = rc;
    const s = this.style;
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    ctx.beginPath();
    for (const line of this.lines(rc)) {
      const x = crisp(line.x, rc.dpr, s.lineWidth);
      ctx.moveTo(x, 0); ctx.lineTo(x, height);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (s.showTrendLine) {
      const a = rc.toPixel(this.points[0]), b = rc.toPixel(this.points[1]);
      if (finite(a) && finite(b)) strokeSegment(ctx, a, b, s.trendLineColor, s.trendLineWidth, s.trendLineStyle);
    }
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const px = this.points.map((p) => rc.toPixel(p));
    const hp = nearPoint(px, x, y);
    if (hp) return hp;
    for (const line of this.lines(rc)) if (Math.abs(line.x - x) <= HIT_TOLERANCE) return { type: 'body' };
    if (this.style.showTrendLine && distToSegment(x, y, px[0].x, px[0].y, px[1].x, px[1].y) <= HIT_TOLERANCE) return { type: 'body' };
    return null;
  }
}

export class TimeCycles extends Drawing {
  static override toolId = 'time_cycles';
  static override toolName = 'Time Cycles';
  static override pointsCount = 2;
  static override group = 'patterns' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M2 20a6 6 0 0 1 12 0h-1a5 5 0 0 0-10 0zm12 0a6 6 0 0 1 12 0h-1a5 5 0 0 0-10 0z"/><path fill="currentColor" d="M2 20h24v1H2z"/></svg>';
  defaultStyle(): Record<string, any> {
    return { lineColor: '#159980', lineWidth: 2, lineStyle: 0, fillBackground: true, backgroundColor: 'rgba(106, 168, 79, 0.5)', transparency: 50 };
  }
  propertyDefs(): PropertyDef[] {
    return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('fillBackground', 'Background'), P.color('backgroundColor', 'Background color'), P.int('transparency', 'Transparency', 0, 100)];
  }

  /** Semicircles of diameter = cycle width repeated to the right from the first point; `up` = arcs bulge upward. */
  arcs(rc: DrawingRenderContext): { up: boolean; cycle: number; items: Array<{ k: number; cx: number; cy: number; r: number }> } {
    const empty = { up: true, cycle: 0, items: [] as Array<{ k: number; cx: number; cy: number; r: number }> };
    if (this.points.length < 2) return empty;
    const a = rc.toPixel(this.points[0]), b = rc.toPixel(this.points[1]);
    if (!finite(a) || !finite(b)) return empty;
    const cycle = Math.abs(b.x - a.x);
    if (!(cycle >= 1)) return empty;
    const x0 = Math.min(a.x, b.x);
    const r = cycle / 2;
    const up = b.y <= a.y;
    const items: Array<{ k: number; cx: number; cy: number; r: number }> = [];
    const kMax = Math.min(300, Math.ceil((rc.width + cycle - x0) / cycle));
    for (let k = 0; k <= kMax; k++) {
      const cx = x0 + (k + 0.5) * cycle;
      if (cx - r > rc.width + 20) break;
      items.push({ k, cx, cy: a.y, r });
    }
    return { up, cycle, items };
  }

  render(rc: DrawingRenderContext): void {
    const { up, items } = this.arcs(rc);
    if (!items.length) return;
    const { ctx } = rc;
    const s = this.style;
    const from = up ? Math.PI : 0, to = up ? Math.PI * 2 : Math.PI;
    if (s.fillBackground) {
      ctx.fillStyle = withAlpha(s.backgroundColor || s.lineColor, alphaFor(s.transparency, 50));
      for (const it of items) {
        if (it.k % 2 !== 0) continue;
        ctx.beginPath();
        ctx.arc(it.cx, it.cy, it.r, from, to);
        ctx.closePath();
        ctx.fill();
      }
    }
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    for (const it of items) {
      ctx.beginPath();
      ctx.arc(it.cx, it.cy, it.r, from, to);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const px = this.points.map((p) => rc.toPixel(p));
    const hp = nearPoint(px, x, y);
    if (hp) return hp;
    const { up, items } = this.arcs(rc);
    const tol = HIT_TOLERANCE + (this.style.lineWidth || 1) / 2;
    for (const it of items) {
      const side = up ? y <= it.cy + tol : y >= it.cy - tol;
      if (!side) continue;
      const d = Math.hypot(x - it.cx, y - it.cy);
      if (Math.abs(d - it.r) <= tol) return { type: 'body' };
      if (this.style.fillBackground && it.k % 2 === 0 && d < it.r) return { type: 'body', part: 'inside' };
    }
    return null;
  }
}

export class SineLine extends Drawing {
  static override toolId = 'sine_line';
  static override toolName = 'Sine Line';
  static override pointsCount = 2;
  static override group = 'patterns' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M2 14.5c3-9 6-9 9 0s6 9 9 0 5-8 6-5l-.9.4c-.6-1.8-2.4-.4-4.2 4.9-3.3 9.9-7.4 9.9-10.7 0S5.6 5 3 14.8z"/></svg>';
  defaultStyle(): Record<string, any> { return { lineColor: '#159980', lineWidth: 2, lineStyle: 0 }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle')]; }

  /** y(x) = mid + (a.y − b.y)/2 · cos(π (x − a.x) / (b.x − a.x)): p1 is a peak/trough, p2 the opposite extreme. */
  curve(rc: DrawingRenderContext): PixelPoint[] {
    if (this.points.length < 2) return [];
    const a = rc.toPixel(this.points[0]), b = rc.toPixel(this.points[1]);
    if (!finite(a) || !finite(b)) return [];
    const half = b.x - a.x;
    if (!(Math.abs(half) >= 1)) return [];
    const mid = (a.y + b.y) / 2, amp = (a.y - b.y) / 2;
    const step = Math.max(2, rc.width / 1500);
    const out: PixelPoint[] = [];
    for (let x = -2; x <= rc.width + 2; x += step) out.push({ x, y: mid + amp * Math.cos((Math.PI * (x - a.x)) / half) });
    return out;
  }

  render(rc: DrawingRenderContext): void {
    const pts = this.curve(rc);
    if (pts.length < 2) return;
    const { ctx } = rc;
    const s = this.style;
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const px = this.points.map((p) => rc.toPixel(p));
    const hp = nearPoint(px, x, y);
    if (hp) return hp;
    const pts = this.curve(rc);
    const tol = HIT_TOLERANCE + (this.style.lineWidth || 1) / 2;
    for (let i = 1; i < pts.length; i++) if (distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= tol) return { type: 'body' };
    return null;
  }
}

export const patternsTools = [XABCDPattern, CypherPattern, ABCDPattern, TrianglePattern, ThreeDrivesPattern, HeadAndShoulders, CyclicLines, TimeCycles, SineLine];
