import { Drawing, P, type DrawingPoint, type DrawingRenderContext, type HitTarget, type PixelPoint, type PropertyDef, type SerializedDrawing } from '../Drawing';
import { fontFor, roundRect, wrapText, TEXT_ALIGN_OPTIONS } from './common';
import { formatPrice } from '../../util/format';
import { distToSegment, pointInRect, clamp } from '../../util/math';
import { svgIcon, POINT_HIT_RADIUS, V_ALIGN_OPTIONS, rectHandles, rectMovePoint, strokeTolerance } from './shapes';

// ---------------------------------------------------------------------------------------------
// Text rendering helpers
// ---------------------------------------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number }
export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

export interface TextLayout { lines: string[]; w: number; h: number; lh: number; pad: number; font: string }

export interface TextBlockOpts {
  font: string;
  color: string;
  bg?: string | null;
  border?: string | null;
  borderWidth?: number;
  radius?: number;
  padding?: number;
  /** alignment of the lines inside the box */
  align?: HAlign;
  /** placement of the box relative to (x, y) */
  anchorH?: HAlign;
  anchorV?: VAlign;
  /** wrap width (text pixels, excluding padding) */
  maxWidth?: number;
  minWidth?: number;
  minHeight?: number;
}

/** Measure a (possibly wrapped) block of text. */
export function layoutText(ctx: CanvasRenderingContext2D, text: string, font: string, o: { padding?: number; maxWidth?: number; minWidth?: number; minHeight?: number } = {}): TextLayout {
  const lines = wrapText(ctx, text, font, o.maxWidth);
  const pad = o.padding ?? 4;
  ctx.font = font;
  const fontSize = parseInt(font.match(/(\d+)px/)?.[1] ?? '12', 10);
  const lh = Math.round(fontSize * 1.3);
  let tw = 0;
  for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width);
  if (o.maxWidth) tw = Math.max(tw, o.maxWidth);
  const w = Math.max(o.minWidth ?? 0, tw + pad * 2);
  const h = Math.max(o.minHeight ?? 0, lines.length * lh + pad * 2);
  return { lines, w, h, lh, pad, font };
}

/** Paint laid-out lines inside a box at (bx, by) with the given alignment. */
export function paintTextLines(ctx: CanvasRenderingContext2D, lay: TextLayout, bx: number, by: number, color: string, align: HAlign = 'left'): void {
  ctx.font = lay.font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.textAlign = align;
  const tx = align === 'center' ? bx + lay.w / 2 : align === 'right' ? bx + lay.w - lay.pad : bx + lay.pad;
  const top = by + (lay.h - lay.lines.length * lay.lh) / 2;
  lay.lines.forEach((l, i) => ctx.fillText(l, tx, top + i * lay.lh));
  ctx.textAlign = 'left';
}

/** Draw a text block (background, border, aligned lines). Returns the box rect. */
export function drawTextBlock(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: TextBlockOpts): Rect {
  const lay = layoutText(ctx, text, o.font, { padding: o.padding, maxWidth: o.maxWidth, minWidth: o.minWidth, minHeight: o.minHeight });
  let bx = x, by = y;
  if (o.anchorH === 'center') bx = x - lay.w / 2; else if (o.anchorH === 'right') bx = x - lay.w;
  if (o.anchorV === 'middle') by = y - lay.h / 2; else if (o.anchorV === 'bottom') by = y - lay.h;
  const r = o.radius ?? 0;
  if (o.bg) {
    ctx.fillStyle = o.bg;
    if (r) { roundRect(ctx, bx, by, lay.w, lay.h, r); ctx.fill(); } else ctx.fillRect(bx, by, lay.w, lay.h);
  }
  if (o.border) {
    const bw = o.borderWidth ?? 1;
    ctx.strokeStyle = o.border;
    ctx.lineWidth = bw;
    ctx.setLineDash([]);
    if (r) { roundRect(ctx, bx + bw / 2, by + bw / 2, lay.w - bw, lay.h - bw, r); ctx.stroke(); } else ctx.strokeRect(bx + bw / 2, by + bw / 2, lay.w - bw, lay.h - bw);
  }
  paintTextLines(ctx, lay, bx, by, o.color, o.align);
  return { x: bx, y: by, w: lay.w, h: lay.h };
}

/**
 * Speech-bubble path: a rounded rect with a wedge on the side facing `tip`
 * (no wedge when the tip is inside the box or the side is too short).
 */
export function bubblePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, tip: PixelPoint | null, half = 6): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  let side: 'top' | 'right' | 'bottom' | 'left' | null = null;
  let bx = 0, by = 0;
  if (tip && !(tip.x >= x && tip.x <= x + w && tip.y >= y && tip.y <= y + h)) {
    const cx = x + w / 2, cy = y + h / 2, dx = tip.x - cx, dy = tip.y - cy;
    const ax = Math.abs(dx) / Math.max(1, w / 2), ay = Math.abs(dy) / Math.max(1, h / 2);
    if (ax >= ay) {
      side = dx < 0 ? 'left' : 'right';
      const t = (w / 2) / Math.max(1e-6, Math.abs(dx));
      by = clamp(cy + dy * t, y + r + half, y + h - r - half);
      if (h < 2 * (r + half)) side = null;
    } else {
      side = dy < 0 ? 'top' : 'bottom';
      const t = (h / 2) / Math.max(1e-6, Math.abs(dy));
      bx = clamp(cx + dx * t, x + r + half, x + w - r - half);
      if (w < 2 * (r + half)) side = null;
    }
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  if (side === 'top') { ctx.lineTo(bx - half, y); ctx.lineTo(tip!.x, tip!.y); ctx.lineTo(bx + half, y); }
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  if (side === 'right') { ctx.lineTo(x + w, by - half); ctx.lineTo(tip!.x, tip!.y); ctx.lineTo(x + w, by + half); }
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  if (side === 'bottom') { ctx.lineTo(bx + half, y + h); ctx.lineTo(tip!.x, tip!.y); ctx.lineTo(bx - half, y + h); }
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  if (side === 'left') { ctx.lineTo(x, by + half); ctx.lineTo(tip!.x, tip!.y); ctx.lineTo(x, by - half); }
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function inRect(x: number, y: number, r: Rect | null): boolean {
  return !!r && pointInRect(x, y, r.x, r.y, r.x + r.w, r.y + r.h);
}

function selectionOutline(ctx: CanvasRenderingContext2D, b: Rect): void {
  ctx.save();
  ctx.strokeStyle = '#2962FF';
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
  ctx.restore();
}

function rectBounds(r: Rect): { x1: number; y1: number; x2: number; y2: number } {
  return { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h };
}

function unionBounds(a: Rect | null, b: Rect | null): { x1: number; y1: number; x2: number; y2: number } | null {
  if (!a && !b) return null;
  if (!a) return rectBounds(b!);
  if (!b) return rectBounds(a);
  return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x + a.w, b.x + b.w), y2: Math.max(a.y + a.h, b.y + b.h) };
}

/**
 * Screen anchoring for "anchored" tools. The drawing still stores one (time, price) point (so
 * the manager's creation/drag protocol works) but renders at a pane-relative position stored
 * as percentages in the style. Body drags are converted to screen deltas, handle drags to an
 * absolute screen position; scrolling/zooming the chart leaves the box where it is.
 */
export class ScreenAnchor {
  private lastPx: PixelPoint | null = null;
  private dirty = false;
  private absolute = false;
  private loaded = false;
  /** Points changed by a body drag / nudge / style edit. */
  markChanged(): void { this.dirty = true; }
  /** The anchor point was placed under the pointer (handle drag). */
  markAbsolute(): void { this.absolute = true; }
  /** The stored percentages are authoritative (deserialized or given explicitly). */
  markLoaded(): void { this.loaded = true; }
  resolve(style: Record<string, any>, kx: string, ky: string, px: PixelPoint, rc: DrawingRenderContext): PixelPoint {
    const W = Math.max(1, rc.width), H = Math.max(1, rc.height);
    const set = (x: number, y: number) => { style[kx] = clamp((x / W) * 100, 0, 100); style[ky] = clamp((y / H) * 100, 0, 100); };
    if (this.absolute || (this.lastPx === null && !this.loaded)) set(px.x, px.y);
    else if (this.dirty && this.lastPx) {
      const dx = px.x - this.lastPx.x, dy = px.y - this.lastPx.y;
      if (dx !== 0 || dy !== 0) set((Number(style[kx]) / 100) * W + dx, (Number(style[ky]) / 100) * H + dy);
    }
    this.lastPx = px;
    this.dirty = false;
    this.absolute = false;
    this.loaded = true;
    return { x: (Number(style[kx]) / 100) * W, y: (Number(style[ky]) / 100) * H };
  }
}

const anchorDefs = (): PropertyDef[] => [
  P.number('anchorX', 'Horizontal position %', 0, 100, 1), P.number('anchorY', 'Vertical position %', 0, 100, 1),
  P.select('hAlign', 'Horizontal anchor', TEXT_ALIGN_OPTIONS), P.select('vAlign', 'Vertical anchor', V_ALIGN_OPTIONS),
];

// ---------------------------------------------------------------------------------------------
// Text / Anchored text
// ---------------------------------------------------------------------------------------------

function textBaseStyle(): Record<string, any> {
  return { text: 'Text', textColor: '#2962FF', fontSize: 14, bold: false, italic: false, textAlign: 'left', showBackground: false, backgroundColor: 'rgba(41, 98, 255, 0.25)', showBorder: false, borderColor: '#707070', wrap: false, wrapWidth: 200 };
}

/** Text-tab defs shared by the text tools; `colorKey` names the text colour property. */
function textDefs(colorKey = 'textColor', withBox = true): PropertyDef[] {
  const defs = [P.text('text', 'Text'), P.color(colorKey, 'Text color', 'Text'), P.fontSize('fontSize'), P.bool('bold', 'Bold', 'Text'), P.bool('italic', 'Italic', 'Text'), P.select('textAlign', 'Alignment', TEXT_ALIGN_OPTIONS, 'Text')];
  if (withBox) defs.push(P.bool('showBackground', 'Background', 'Text'), P.color('backgroundColor', 'Background color', 'Text'), P.bool('showBorder', 'Border', 'Text'), P.color('borderColor', 'Border color', 'Text'));
  defs.push(P.bool('wrap', 'Text wrap', 'Text'), P.int('wrapWidth', 'Wrap width', 50, 2000, 'Text'));
  return defs;
}

function wrapWidth(s: Record<string, any>): number | undefined {
  return s.wrap ? Math.max(20, Number(s.wrapWidth) || 200) : undefined;
}

export class TextTool extends Drawing {
  static override toolId = 'text';
  static override toolName = 'Text';
  static override pointsCount = 1;
  static override group = 'text' as const;
  static override icon = svgIcon('M8 6h12v3h-1V7h-4.5v14H17v1h-6v-1h2.5V7H9v2H8z');
  defaultStyle(): Record<string, any> { return textBaseStyle(); }
  propertyDefs(): PropertyDef[] { return textDefs(); }
  protected _box: Rect | null = null;
  /** Box rect (pixels) from the last render. */
  get box(): Rect | null { return this._box; }
  /** Pixel position the box is anchored to. */
  protected anchorPx(rc: DrawingRenderContext): PixelPoint { return rc.toPixel(this.points[0]); }
  protected boxAnchor(): { h: HAlign; v: VAlign } { return { h: 'left', v: 'top' }; }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = this.anchorPx(rc);
    const s = this.style;
    const { ctx } = rc;
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const a = this.boxAnchor();
    this._box = drawTextBlock(ctx, String(s.text ?? '') || ' ', p.x, p.y, {
      font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.textColor,
      bg: s.showBackground ? s.backgroundColor : null, border: s.showBorder ? s.borderColor : null,
      radius: 2, padding: 4, align: s.textAlign, anchorH: a.h, anchorV: a.v, maxWidth: wrapWidth(s),
    });
    if (rc.selected || rc.hovered) selectionOutline(ctx, this._box);
  }
  override handles(rc: DrawingRenderContext): Array<PixelPoint & { index: number }> {
    if (!this.points.length) return [];
    const p = this.anchorPx(rc);
    return [{ x: p.x, y: p.y, index: 0 }];
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = this.anchorPx(rc);
    if (Math.hypot(p.x - x, p.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: 0 };
    return inRect(x, y, this._box) ? { type: 'body' } : null;
  }
  override bounds(rc: DrawingRenderContext) { return this._box ? rectBounds(this._box) : super.bounds(rc); }
}

export class AnchoredText extends TextTool {
  static override toolId = 'anchored_text';
  static override toolName = 'Anchored Text';
  static override icon = svgIcon('M4 4h5v1H5v4H4zm15 0h5v5h-1V5h-4zM4 19h1v4h4v1H4zm19 0h1v5h-5v-1h4zM9 8h10v3h-1V9h-3.5v11H16v1h-4v-1h1.5V9H10v2H9z');
  private _anchor = new ScreenAnchor();
  constructor(style: Record<string, any> = {}, id?: string) {
    super(style, id);
    if (style.anchorX !== undefined || style.anchorY !== undefined) this._anchor.markLoaded();
  }
  defaultStyle(): Record<string, any> { return { ...textBaseStyle(), anchorX: 5, anchorY: 5, hAlign: 'left', vAlign: 'top' }; }
  propertyDefs(): PropertyDef[] { return [...textDefs(), ...anchorDefs()]; }
  protected override anchorPx(rc: DrawingRenderContext): PixelPoint { return this._anchor.resolve(this.style, 'anchorX', 'anchorY', rc.toPixel(this.points[0]), rc); }
  protected override boxAnchor(): { h: HAlign; v: VAlign } { return { h: this.style.hAlign ?? 'left', v: this.style.vAlign ?? 'top' }; }
  override onChanged(): void { this._anchor.markChanged(); }
  override movePoint(index: number, p: DrawingPoint): void { super.movePoint(index, p); this._anchor.markAbsolute(); }
  override applySerialized(s: SerializedDrawing): void { this._anchor.markLoaded(); super.applySerialized(s); }
}

// ---------------------------------------------------------------------------------------------
// Note / Anchored note / Pin — marker at the point, text popup on hover/selection
// ---------------------------------------------------------------------------------------------

function noteStyle(text: string): Record<string, any> {
  return { text, markerColor: '#2962FF', color: '#FFFFFF', fontSize: 14, bold: false, italic: false, textAlign: 'left', showBackground: true, backgroundColor: 'rgba(41, 98, 255, 0.7)', showBorder: true, borderColor: '#2962FF', wrap: true, wrapWidth: 200, alwaysShowText: false };
}

export class Note extends Drawing {
  static override toolId = 'note';
  static override toolName = 'Note';
  static override pointsCount = 1;
  static override group = 'text' as const;
  static override icon = svgIcon('M6 5h16v13h-5l-3 4-3-4H6zm1 1v11h5.5l2.5 3.3 2.5-3.3H21V6zM9 9h10v1H9zm0 3h7v1H9z');
  defaultStyle(): Record<string, any> { return noteStyle('Note'); }
  propertyDefs(): PropertyDef[] { return [P.color('markerColor', this.markerLabel()), P.bool('alwaysShowText', 'Always show text'), ...textDefs('color')]; }
  protected markerLabel(): string { return 'Marker'; }
  protected _box: Rect | null = null;
  protected _marker: Rect | null = null;
  get box(): Rect | null { return this._box; }
  get markerRect(): Rect | null { return this._marker; }
  protected anchorPx(rc: DrawingRenderContext): PixelPoint { return rc.toPixel(this.points[0]); }
  /** Draw the marker glyph with its bottom at the anchor. Returns its rect. */
  protected drawMarker(ctx: CanvasRenderingContext2D, p: PixelPoint, color: string): Rect {
    const w = 18, h = 15;
    const x = p.x - w / 2, y = p.y - h - 5;
    ctx.fillStyle = color;
    roundRect(ctx, x, y, w, h, 3);
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(p.x - 3, y + h - 0.5); ctx.lineTo(p.x, p.y); ctx.lineTo(p.x + 3, y + h - 0.5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) { const ly = y + 4 + i * 3.5; ctx.moveTo(x + 4, ly); ctx.lineTo(x + w - 4 - (i === 2 ? 4 : 0), ly); }
    ctx.stroke();
    return { x, y, w, h: h + 5 };
  }
  protected popupVisible(rc: DrawingRenderContext): boolean { return !!this.style.alwaysShowText || rc.selected || rc.hovered || rc.creating; }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = this.anchorPx(rc);
    const s = this.style;
    const { ctx } = rc;
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    this._marker = this.drawMarker(ctx, p, s.markerColor);
    if (this.popupVisible(rc) && s.text) {
      this._box = drawTextBlock(ctx, String(s.text), p.x, this._marker.y - 6, {
        font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.color,
        bg: s.showBackground ? s.backgroundColor : null, border: s.showBorder ? s.borderColor : null,
        radius: 4, padding: 6, align: s.textAlign, anchorH: 'center', anchorV: 'bottom', maxWidth: wrapWidth(s),
      });
    } else this._box = null;
  }
  override handles(rc: DrawingRenderContext): Array<PixelPoint & { index: number }> {
    if (!this.points.length) return [];
    const p = this.anchorPx(rc);
    return [{ x: p.x, y: p.y, index: 0 }];
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = this.anchorPx(rc);
    if (Math.hypot(p.x - x, p.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: 0 };
    if (inRect(x, y, this._marker)) return { type: 'body', part: 'marker' };
    if (inRect(x, y, this._box)) return { type: 'body' };
    return null;
  }
  override bounds(rc: DrawingRenderContext) { return unionBounds(this._marker, this._box) ?? super.bounds(rc); }
}

export class AnchoredNote extends Note {
  static override toolId = 'anchored_note';
  static override toolName = 'Anchored Note';
  static override icon = svgIcon('M4 4h5v1H5v4H4zm15 0h5v5h-1V5h-4zM4 19h1v4h4v1H4zm19 0h1v5h-5v-1h4zM8 7h12v10h-4l-2 3-2-3H8zm1 1v8h4.5l1.5 2.2 1.5-2.2H19V8zm2 2h8v1h-8zm0 3h5v1h-5z');
  private _anchor = new ScreenAnchor();
  constructor(style: Record<string, any> = {}, id?: string) {
    super(style, id);
    if (style.anchorX !== undefined || style.anchorY !== undefined) this._anchor.markLoaded();
  }
  defaultStyle(): Record<string, any> { return { ...noteStyle('Note'), anchorX: 5, anchorY: 10 }; }
  propertyDefs(): PropertyDef[] { return [...super.propertyDefs(), P.number('anchorX', 'Horizontal position %', 0, 100, 1), P.number('anchorY', 'Vertical position %', 0, 100, 1)]; }
  protected override anchorPx(rc: DrawingRenderContext): PixelPoint { return this._anchor.resolve(this.style, 'anchorX', 'anchorY', rc.toPixel(this.points[0]), rc); }
  override onChanged(): void { this._anchor.markChanged(); }
  override movePoint(index: number, p: DrawingPoint): void { super.movePoint(index, p); this._anchor.markAbsolute(); }
  override applySerialized(s: SerializedDrawing): void { this._anchor.markLoaded(); super.applySerialized(s); }
}

export class Pin extends Note {
  static override toolId = 'pin';
  static override toolName = 'Pin';
  static override icon = svgIcon('M14 4a6 6 0 0 1 6 6c0 4.5-6 13-6 13s-6-8.5-6-13a6 6 0 0 1 6-6zm0 1a5 5 0 0 0-5 5c0 3.3 3.6 9.2 5 11.2 1.4-2 5-7.9 5-11.2a5 5 0 0 0-5-5zm0 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z');
  defaultStyle(): Record<string, any> { return noteStyle('Pin'); }
  protected override markerLabel(): string { return 'Pin color'; }
  /** Map-pin glyph with its tip at the anchor. */
  protected override drawMarker(ctx: CanvasRenderingContext2D, p: PixelPoint, color: string): Rect {
    const r = 6.5, cy = p.y - 15;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, cy, r, Math.PI * 0.8, Math.PI * 0.2, false);
    ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath(); ctx.arc(p.x, cy, 2.5, 0, Math.PI * 2); ctx.fill();
    return { x: p.x - r - 1, y: cy - r - 1, w: r * 2 + 2, h: p.y - cy + r + 1 };
  }
  /** Pin text is hidden until the pin is hovered/selected (or `alwaysShowText`). */
  protected override popupVisible(rc: DrawingRenderContext): boolean { return !!this.style.alwaysShowText || rc.selected || rc.hovered; }
}

// ---------------------------------------------------------------------------------------------
// Callout (2 points: tip + box) / Comment (1 point bubble) / Price label / Price note
// ---------------------------------------------------------------------------------------------

function plateDefs(withBorderWidth = false): PropertyDef[] {
  const d = [P.color('backgroundColor', 'Background'), P.color('borderColor', 'Border')];
  if (withBorderWidth) d.push(P.lineWidth('lineWidth', 'Border width'));
  return d;
}

/** Shared bubble drawing: box at (bx, by) with a wedge towards `tip`. Returns the box. */
function drawBubble(rc: DrawingRenderContext, s: Record<string, any>, text: string, bx: number, by: number, tip: PixelPoint | null, opts: { padding?: number; radius?: number; minWidth?: number; wedge?: number } = {}): Rect {
  const { ctx } = rc;
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  const lay = layoutText(ctx, text || ' ', fontFor(rc, s.fontSize, s.bold, s.italic), { padding: opts.padding ?? 8, maxWidth: wrapWidth(s), minWidth: opts.minWidth ?? 24, minHeight: 20 });
  bubblePath(ctx, bx, by, lay.w, lay.h, opts.radius ?? 6, tip, opts.wedge ?? 7);
  ctx.fillStyle = s.backgroundColor;
  ctx.fill();
  ctx.strokeStyle = s.borderColor;
  ctx.lineWidth = Math.max(0.5, Number(s.lineWidth) || 1);
  ctx.lineJoin = 'round';
  ctx.stroke();
  paintTextLines(ctx, lay, bx, by, s.color, s.textAlign ?? 'left');
  return { x: bx, y: by, w: lay.w, h: lay.h };
}

export class Callout extends Drawing {
  static override toolId = 'callout';
  static override toolName = 'Callout';
  static override pointsCount = 2;
  static override group = 'text' as const;
  static override icon = svgIcon('M5 6h18v11h-9l-5 5v-5H5zm1 1v9h5v3.6L14.6 16H22V7z');
  defaultStyle(): Record<string, any> { return { text: 'Callout', color: '#FFFFFF', backgroundColor: 'rgba(0, 151, 167, 0.7)', borderColor: '#0097A7', lineWidth: 2, fontSize: 14, bold: false, italic: false, textAlign: 'left', wrap: false, wrapWidth: 200 }; }
  propertyDefs(): PropertyDef[] { return [...plateDefs(true), ...textDefs('color', false)]; }
  private _box: Rect | null = null;
  get box(): Rect | null { return this._box; }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const tip = rc.toPixel(this.points[0]);
    const at = rc.toPixel(this.points[1] ?? this.points[0]);
    const s = this.style;
    const lay = layoutText(rc.ctx, String(s.text ?? '') || ' ', fontFor(rc, s.fontSize, s.bold, s.italic), { padding: 8, maxWidth: wrapWidth(s), minWidth: 24, minHeight: 20 });
    this._box = drawBubble(rc, s, String(s.text ?? ''), at.x - lay.w / 2, at.y - lay.h / 2, this.points.length > 1 ? tip : null);
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const px = this.points.map((p) => rc.toPixel(p));
    for (let i = 0; i < px.length; i++) if (Math.hypot(px[i].x - x, px[i].y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: i };
    if (inRect(x, y, this._box)) return { type: 'body', part: 'inside' };
    if (distToSegment(x, y, px[0].x, px[0].y, px[1].x, px[1].y) <= strokeTolerance(this.style.lineWidth)) return { type: 'body' };
    return null;
  }
  override bounds(rc: DrawingRenderContext) {
    const b = super.bounds(rc);
    if (!b || !this._box) return b;
    const r = rectBounds(this._box);
    return { x1: Math.min(b.x1, r.x1), y1: Math.min(b.y1, r.y1), x2: Math.max(b.x2, r.x2), y2: Math.max(b.y2, r.y2) };
  }
}

export class Comment extends Drawing {
  static override toolId = 'comment';
  static override toolName = 'Comment';
  static override pointsCount = 1;
  static override group = 'text' as const;
  static override icon = svgIcon('M4 6h20v12h-7l-4 4v-4H4zm1 1v10h9v2.6l2.6-2.6H23V7z');
  defaultStyle(): Record<string, any> { return { text: 'Comment', color: '#FFFFFF', backgroundColor: '#2962FF', borderColor: '#2962FF', lineWidth: 1, fontSize: 16, bold: false, italic: false, textAlign: 'left', wrap: false, wrapWidth: 200 }; }
  propertyDefs(): PropertyDef[] { return [...plateDefs(true), ...textDefs('color', false)]; }
  private _box: Rect | null = null;
  get box(): Rect | null { return this._box; }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = rc.toPixel(this.points[0]);
    const s = this.style;
    const lay = layoutText(rc.ctx, String(s.text ?? '') || ' ', fontFor(rc, s.fontSize, s.bold, s.italic), { padding: 8, maxWidth: wrapWidth(s), minWidth: 24, minHeight: 20 });
    this._box = drawBubble(rc, s, String(s.text ?? ''), p.x + 12, p.y - lay.h - 14, p);
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = rc.toPixel(this.points[0]);
    if (Math.hypot(p.x - x, p.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: 0 };
    return inRect(x, y, this._box) ? { type: 'body' } : null;
  }
  override bounds(rc: DrawingRenderContext) { return this._box ? rectBounds(this._box) : super.bounds(rc); }
}

export class PriceLabel extends Drawing {
  static override toolId = 'price_label';
  static override toolName = 'Price Label';
  static override pointsCount = 1;
  static override group = 'text' as const;
  static override icon = svgIcon('M4 9h13l6 5-6 5H4zm1 1v8h11.6l4.8-4-4.8-4z');
  defaultStyle(): Record<string, any> { return { color: '#FFFFFF', backgroundColor: '#2962FF', borderColor: '#2962FF', lineWidth: 1, fontSize: 14, bold: true, italic: false }; }
  propertyDefs(): PropertyDef[] { return [...plateDefs(true), P.color('color', 'Text color', 'Text'), P.fontSize('fontSize'), P.bool('bold', 'Bold', 'Text'), P.bool('italic', 'Italic', 'Text')]; }
  private _box: Rect | null = null;
  get box(): Rect | null { return this._box; }
  /** The label text (the anchor's formatted price). */
  labelText(rc: DrawingRenderContext): string { return this.points.length ? formatPrice(this.points[0].price, rc.priceFormat) : ''; }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = rc.toPixel(this.points[0]);
    const s = this.style;
    const text = this.labelText(rc);
    const lay = layoutText(rc.ctx, text, fontFor(rc, s.fontSize, s.bold, s.italic), { padding: 6, minWidth: 24, minHeight: 20 });
    this._box = drawBubble(rc, { ...s, wrap: false, textAlign: 'center' }, text, p.x + 10, p.y - lay.h - 10, p, { padding: 6, radius: 4, wedge: 5 });
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = rc.toPixel(this.points[0]);
    if (Math.hypot(p.x - x, p.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: 0 };
    return inRect(x, y, this._box) ? { type: 'body' } : null;
  }
  override bounds(rc: DrawingRenderContext) { return this._box ? rectBounds(this._box) : super.bounds(rc); }
}

export class PriceNote extends Drawing {
  static override toolId = 'price_note';
  static override toolName = 'Price Note';
  static override pointsCount = 2;
  static override group = 'text' as const;
  static override icon = svgIcon('M3 14h9v1H3zm10-4h12v9H13zm1 1v7h10v-7z');
  defaultStyle(): Record<string, any> { return { lineColor: '#2962FF', lineWidth: 1, lineStyle: 0, showPrice: true, text: '', color: '#FFFFFF', backgroundColor: '#2962FF', borderColor: '#2962FF', fontSize: 14, bold: true, italic: false, textAlign: 'center', wrap: false, wrapWidth: 200 }; }
  propertyDefs(): PropertyDef[] {
    return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('showPrice', 'Show price'), ...plateDefs(), ...textDefs('color', false)];
  }
  private _box: Rect | null = null;
  get box(): Rect | null { return this._box; }
  labelText(rc: DrawingRenderContext): string {
    if (!this.points.length) return '';
    const price = formatPrice(this.points[0].price, rc.priceFormat);
    const text = String(this.style.text ?? '').trim();
    if (!this.style.showPrice) return text || price;
    return text ? `${price} ${text}` : price;
  }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    const { ctx } = rc;
    const s = this.style;
    ctx.strokeStyle = s.lineColor;
    ctx.lineWidth = Number(s.lineWidth) || 1;
    ctx.setLineDash(s.lineStyle === 2 ? [4, 3] : s.lineStyle === 1 ? [1, 2] : []);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const text = this.labelText(rc);
    const lay = layoutText(ctx, text, fontFor(rc, s.fontSize, s.bold, s.italic), { padding: 6, maxWidth: wrapWidth(s), minWidth: 24, minHeight: 20 });
    const by = b.y <= a.y ? b.y - lay.h : b.y;
    ctx.setLineDash([]);
    this._box = drawBubble(rc, { ...s, lineWidth: 1 }, text, b.x - lay.w / 2, by, null, { padding: 6, radius: 4 });
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const a = rc.toPixel(this.points[0]), b = rc.toPixel(this.points[1]);
    if (Math.hypot(a.x - x, a.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: 0 };
    if (Math.hypot(b.x - x, b.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: 1 };
    if (inRect(x, y, this._box)) return { type: 'body' };
    const tol = strokeTolerance(this.style.lineWidth);
    if (distToSegment(x, y, a.x, a.y, b.x, a.y) <= tol || distToSegment(x, y, b.x, a.y, b.x, b.y) <= tol) return { type: 'body' };
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Signpost (anchor + vertical stem + plate at a pane-relative height)
// ---------------------------------------------------------------------------------------------

export class Signpost extends Drawing {
  static override toolId = 'signpost';
  static override toolName = 'Signpost';
  static override pointsCount = 1;
  static override group = 'text' as const;
  static override icon = svgIcon('M13.5 22V13h1v9zM6 5h16v7H6zm1 1v5h14V6zm7 17.5a1.5 1.5 0 1 1 0 .01z');
  defaultStyle(): Record<string, any> { return { text: 'Signpost', color: '#FFFFFF', plateColor: '#2962FF', lineWidth: 1, fontSize: 12, bold: false, italic: false, textAlign: 'center', showImage: false, emoji: '🙂', platePosition: 25, wrap: false, wrapWidth: 200 }; }
  propertyDefs(): PropertyDef[] {
    return [P.color('plateColor', 'Plate'), P.lineWidth('lineWidth', 'Stem width'), P.number('platePosition', 'Vertical position %', 0, 100, 1), P.bool('showImage', 'Emoji pin'), P.text('emoji', 'Emoji', 'Style'), ...textDefs('color', false)];
  }
  private _plate: Rect | null = null;
  private _scale: { priceToY: (p: number) => number; height: number } | null = null;
  get plate(): Rect | null { return this._plate; }
  plateY(rc: DrawingRenderContext): number { return (clamp(Number(this.style.platePosition) || 0, 0, 100) / 100) * rc.height; }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = rc.toPixel(this.points[0]);
    const { ctx } = rc;
    const s = this.style;
    this._scale = { priceToY: (v) => rc.priceScale.priceToY(v), height: rc.height };
    const py = this.plateY(rc);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = s.plateColor;
    ctx.lineWidth = Number(s.lineWidth) || 1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, py); ctx.stroke();
    if (s.showImage) {
      ctx.fillStyle = s.plateColor;
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.font = `14px ${rc.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(String(s.emoji ?? ''), p.x, p.y + 0.5);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = s.plateColor;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    this._plate = drawTextBlock(ctx, String(s.text ?? '') || ' ', p.x, py, {
      font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.color, bg: s.plateColor, radius: 4, padding: 6,
      align: s.textAlign, anchorH: 'center', anchorV: 'middle', maxWidth: wrapWidth(s), minWidth: 24,
    });
  }
  /** 0 = anchor, 1 = plate (vertical drag only). */
  override handles(rc: DrawingRenderContext): Array<PixelPoint & { index: number }> {
    if (!this.points.length) return [];
    const p = rc.toPixel(this.points[0]);
    return [{ x: p.x, y: p.y, index: 0 }, { x: p.x, y: this.plateY(rc), index: 1 }];
  }
  override movePoint(index: number, p: DrawingPoint): void {
    if (index === 0) { this.points[0] = p; return; }
    if (index === 1 && this._scale && this._scale.height > 0) {
      this.style.platePosition = clamp((this._scale.priceToY(p.price) / this._scale.height) * 100, 0, 100);
    }
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = rc.toPixel(this.points[0]);
    const py = this.plateY(rc);
    if (Math.hypot(p.x - x, p.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: 0 };
    if (Math.hypot(p.x - x, py - y) <= POINT_HIT_RADIUS) return { type: 'point', index: 1 };
    if (inRect(x, y, this._plate)) return { type: 'body', part: 'plate' };
    if (distToSegment(x, y, p.x, p.y, p.x, py) <= strokeTolerance(this.style.lineWidth)) return { type: 'body' };
    return null;
  }
  override bounds(rc: DrawingRenderContext) {
    const b = super.bounds(rc);
    if (!b || !this._plate) return b;
    const r = rectBounds(this._plate);
    return { x1: Math.min(b.x1, r.x1), y1: Math.min(b.y1, r.y1), x2: Math.max(b.x2, r.x2), y2: Math.max(b.y2, r.y2) };
  }
}

// ---------------------------------------------------------------------------------------------
// Flag mark
// ---------------------------------------------------------------------------------------------

export class FlagMark extends Drawing {
  static override toolId = 'flag_mark';
  static override toolName = 'Flag Mark';
  static override pointsCount = 1;
  static override group = 'text' as const;
  static override icon = svgIcon('M7 4h1v20H7zm2 1h12l-3 4 3 4H9z');
  defaultStyle(): Record<string, any> { return { flagColor: '#2962FF' }; }
  propertyDefs(): PropertyDef[] { return [P.color('flagColor', 'Flag')]; }
  /** Glyph rect: pole from the point up 18 px, pennant to the right. */
  glyphRect(p: PixelPoint): Rect { return { x: p.x - 2, y: p.y - 19, w: 17, h: 20 }; }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = rc.toPixel(this.points[0]);
    const { ctx } = rc;
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.style.flagColor;
    ctx.fillRect(p.x - 1, p.y - 18, 2, 18);
    ctx.beginPath(); ctx.moveTo(p.x + 1, p.y - 18); ctx.lineTo(p.x + 14, p.y - 14); ctx.lineTo(p.x + 1, p.y - 9); ctx.closePath(); ctx.fill();
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = rc.toPixel(this.points[0]);
    if (Math.hypot(p.x - x, p.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: 0 };
    return inRect(x, y, this.glyphRect(p)) ? { type: 'body' } : null;
  }
  override bounds(rc: DrawingRenderContext) { return this.points.length ? rectBounds(this.glyphRect(rc.toPixel(this.points[0]))) : null; }
}

// ---------------------------------------------------------------------------------------------
// Table (2 corner points; rows × cols grid; cell text in style.cells[row][col])
// ---------------------------------------------------------------------------------------------

export class Table extends Drawing {
  static override toolId = 'table';
  static override toolName = 'Table';
  static override pointsCount = 2;
  static override group = 'text' as const;
  static override icon = svgIcon('M4 5h20v18H4zm1 1v4h18V6zm0 5v5h8v-5zm9 0v5h9v-5zm-9 6v5h8v-5zm9 0v5h9v-5z');
  defaultStyle(): Record<string, any> {
    return { rows: 3, cols: 3, cells: [], backgroundColor: 'rgba(41, 98, 255, 0.08)', borderColor: '#2962FF', borderWidth: 1, textColor: '#2962FF', fontSize: 12, bold: false, italic: false, textAlign: 'left' };
  }
  propertyDefs(): PropertyDef[] {
    return [P.int('rows', 'Rows', 1, 100), P.int('cols', 'Columns', 1, 50), P.color('backgroundColor', 'Background'), P.color('borderColor', 'Border'), P.lineWidth('borderWidth', 'Border width'),
      P.color('textColor', 'Text color', 'Text'), P.fontSize('fontSize'), P.bool('bold', 'Bold', 'Text'), P.bool('italic', 'Italic', 'Text'), P.select('textAlign', 'Alignment', TEXT_ALIGN_OPTIONS, 'Text')];
  }
  get rows(): number { return clamp(Math.round(Number(this.style.rows) || 1), 1, 100); }
  get cols(): number { return clamp(Math.round(Number(this.style.cols) || 1), 1, 50); }
  getCell(row: number, col: number): string { return String(this.style.cells?.[row]?.[col] ?? ''); }
  setCell(row: number, col: number, text: string): void {
    const cells: string[][] = Array.isArray(this.style.cells) ? this.style.cells : [];
    while (cells.length <= row) cells.push([]);
    if (!Array.isArray(cells[row])) cells[row] = [];
    while (cells[row].length <= col) cells[row].push('');
    cells[row][col] = text;
    this.style.cells = cells;
    if (row >= this.rows) this.style.rows = row + 1;
    if (col >= this.cols) this.style.cols = col + 1;
  }
  addRow(at = this.rows): void {
    const cells: string[][] = Array.isArray(this.style.cells) ? this.style.cells : [];
    if (at < cells.length) cells.splice(at, 0, []);
    this.style.cells = cells;
    this.style.rows = this.rows + 1;
  }
  addColumn(at = this.cols): void {
    const cells: string[][] = Array.isArray(this.style.cells) ? this.style.cells : [];
    for (const row of cells) if (Array.isArray(row) && at < row.length) row.splice(at, 0, '');
    this.style.cells = cells;
    this.style.cols = this.cols + 1;
  }
  removeRow(at: number): void {
    if (this.rows <= 1) return;
    const cells: string[][] = Array.isArray(this.style.cells) ? this.style.cells : [];
    if (at < cells.length) cells.splice(at, 1);
    this.style.cells = cells;
    this.style.rows = this.rows - 1;
  }
  removeColumn(at: number): void {
    if (this.cols <= 1) return;
    const cells: string[][] = Array.isArray(this.style.cells) ? this.style.cells : [];
    for (const row of cells) if (Array.isArray(row) && at < row.length) row.splice(at, 1);
    this.style.cells = cells;
    this.style.cols = this.cols - 1;
  }
  rect(rc: DrawingRenderContext): { x1: number; y1: number; x2: number; y2: number } {
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
  }
  /** Cell rects [row][col] in pixels (equal column widths / row heights). */
  cellRects(rc: DrawingRenderContext): Rect[][] {
    const r = this.rect(rc);
    const rows = this.rows, cols = this.cols;
    const cw = (r.x2 - r.x1) / cols, rh = (r.y2 - r.y1) / rows;
    const out: Rect[][] = [];
    for (let i = 0; i < rows; i++) {
      const row: Rect[] = [];
      for (let j = 0; j < cols; j++) row.push({ x: r.x1 + j * cw, y: r.y1 + i * rh, w: cw, h: rh });
      out.push(row);
    }
    return out;
  }
  cellAtPixel(x: number, y: number, rc: DrawingRenderContext): { row: number; col: number } | null {
    const r = this.rect(rc);
    if (!pointInRect(x, y, r.x1, r.y1, r.x2, r.y2)) return null;
    const cw = (r.x2 - r.x1) / this.cols, rh = (r.y2 - r.y1) / this.rows;
    if (cw <= 0 || rh <= 0) return null;
    return { row: Math.min(this.rows - 1, Math.floor((y - r.y1) / rh)), col: Math.min(this.cols - 1, Math.floor((x - r.x1) / cw)) };
  }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const r = this.rect(rc);
    const { ctx } = rc;
    const s = this.style;
    const w = r.x2 - r.x1, h = r.y2 - r.y1;
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = s.backgroundColor;
    ctx.fillRect(r.x1, r.y1, w, h);
    const bw = Number(s.borderWidth) || 1;
    ctx.strokeStyle = s.borderColor;
    ctx.lineWidth = bw;
    ctx.strokeRect(r.x1, r.y1, w, h);
    const rows = this.rows, cols = this.cols;
    ctx.beginPath();
    for (let j = 1; j < cols; j++) { const x = r.x1 + (w * j) / cols; ctx.moveTo(x, r.y1); ctx.lineTo(x, r.y2); }
    for (let i = 1; i < rows; i++) { const y = r.y1 + (h * i) / rows; ctx.moveTo(r.x1, y); ctx.lineTo(r.x2, y); }
    ctx.stroke();
    if (w < 4 || h < 4) return;
    const cells = this.cellRects(rc);
    ctx.font = fontFor(rc, s.fontSize, s.bold, s.italic);
    ctx.textBaseline = 'middle';
    const align: HAlign = s.textAlign ?? 'left';
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const text = this.getCell(i, j);
        if (!text) continue;
        const c = cells[i][j];
        ctx.save();
        ctx.beginPath(); ctx.rect(c.x, c.y, c.w, c.h); ctx.clip();
        ctx.fillStyle = s.textColor;
        ctx.textAlign = align;
        const tx = align === 'center' ? c.x + c.w / 2 : align === 'right' ? c.x + c.w - 4 : c.x + 4;
        ctx.fillText(text, tx, c.y + c.h / 2);
        ctx.restore();
      }
    }
    ctx.textAlign = 'left';
  }
  override handles(rc: DrawingRenderContext): Array<PixelPoint & { index: number }> {
    if (!this.points.length) return [];
    const a = rc.toPixel(this.points[0]);
    if (this.points.length < 2) return [{ x: a.x, y: a.y, index: 0 }];
    return rectHandles(a, rc.toPixel(this.points[1]));
  }
  override movePoint(index: number, p: DrawingPoint): void { rectMovePoint(this.points, index, p); }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    for (const h of this.handles(rc)) if (Math.hypot(h.x - x, h.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: h.index };
    const r = this.rect(rc);
    const tol = strokeTolerance(this.style.borderWidth);
    if (pointInRect(x, y, r.x1 - tol, r.y1 - tol, r.x2 + tol, r.y2 + tol)) {
      return pointInRect(x, y, r.x1 + tol, r.y1 + tol, r.x2 - tol, r.y2 - tol) ? { type: 'body', part: 'inside' } : { type: 'body' };
    }
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Emoji / Icon (1 point, fixed pixel size, optional rotation)
// ---------------------------------------------------------------------------------------------

export class Emoji extends Drawing {
  static override toolId = 'emoji';
  static override toolName = 'Emoji';
  static override pointsCount = 1;
  static override group = 'text' as const;
  static override icon = svgIcon('M14 4a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 1a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-3.5 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 16h10c-1 3-3.2 4.5-5 4.5S10 19 9 16z');
  defaultStyle(): Record<string, any> { return { emoji: '🙂', size: 40, angle: 0 }; }
  propertyDefs(): PropertyDef[] { return [P.text('emoji', 'Emoji', 'Style'), P.int('size', 'Size', 8, 400), P.number('angle', 'Angle', -180, 180, 1)]; }
  get size(): number { return clamp(Number(this.style.size) || 40, 8, 400); }
  glyphRect(p: PixelPoint): Rect { const s = this.size; return { x: p.x - s / 2, y: p.y - s / 2, w: s, h: s }; }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = rc.toPixel(this.points[0]);
    const { ctx } = rc;
    ctx.save();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.translate(p.x, p.y);
    ctx.rotate(((Number(this.style.angle) || 0) * Math.PI) / 180);
    ctx.font = `${this.size}px ${rc.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    ctx.fillText(String(this.style.emoji ?? ''), 0, 0);
    ctx.restore();
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = rc.toPixel(this.points[0]);
    if (Math.hypot(p.x - x, p.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: 0 };
    return inRect(x, y, this.glyphRect(p)) ? { type: 'body' } : null;
  }
  override bounds(rc: DrawingRenderContext) { return this.points.length ? rectBounds(this.glyphRect(rc.toPixel(this.points[0]))) : null; }
}

/** Built-in icon glyphs drawn with canvas paths, centred at the origin in a `size` box. */
const ICONS: Record<string, (ctx: CanvasRenderingContext2D, size: number) => void> = {
  star(ctx, s) {
    const R = s / 2, r = R * 0.45;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const rad = i % 2 ? r : R; const a = -Math.PI / 2 + (i * Math.PI) / 5; ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); }
    ctx.closePath();
  },
  heart(ctx, s) {
    const h = s / 2;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.9);
    ctx.bezierCurveTo(-h * 1.3, h * 0.1, -h * 0.7, -h * 0.9, 0, -h * 0.35);
    ctx.bezierCurveTo(h * 0.7, -h * 0.9, h * 1.3, h * 0.1, 0, h * 0.9);
    ctx.closePath();
  },
  check(ctx, s) {
    const h = s / 2;
    ctx.beginPath();
    ctx.moveTo(-h * 0.85, h * 0.05); ctx.lineTo(-h * 0.3, h * 0.6); ctx.lineTo(h * 0.85, -h * 0.55); ctx.lineTo(h * 0.65, -h * 0.78); ctx.lineTo(-h * 0.3, h * 0.2); ctx.lineTo(-h * 0.65, -h * 0.18);
    ctx.closePath();
  },
  cross(ctx, s) {
    const h = s / 2, t = h * 0.22;
    ctx.beginPath();
    ctx.moveTo(-h, -h + t); ctx.lineTo(-h + t, -h); ctx.lineTo(0, -t); ctx.lineTo(h - t, -h); ctx.lineTo(h, -h + t); ctx.lineTo(t, 0);
    ctx.lineTo(h, h - t); ctx.lineTo(h - t, h); ctx.lineTo(0, t); ctx.lineTo(-h + t, h); ctx.lineTo(-h, h - t); ctx.lineTo(-t, 0);
    ctx.closePath();
  },
  circle(ctx, s) { ctx.beginPath(); ctx.arc(0, 0, s / 2, 0, Math.PI * 2); },
  square(ctx, s) { ctx.beginPath(); ctx.rect(-s / 2, -s / 2, s, s); },
  diamond(ctx, s) { const h = s / 2; ctx.beginPath(); ctx.moveTo(0, -h); ctx.lineTo(h, 0); ctx.lineTo(0, h); ctx.lineTo(-h, 0); ctx.closePath(); },
  triangle(ctx, s) { const h = s / 2; ctx.beginPath(); ctx.moveTo(0, -h); ctx.lineTo(h, h * 0.8); ctx.lineTo(-h, h * 0.8); ctx.closePath(); },
  bolt(ctx, s) {
    const h = s / 2;
    ctx.beginPath();
    ctx.moveTo(h * 0.2, -h); ctx.lineTo(-h * 0.6, h * 0.1); ctx.lineTo(-h * 0.05, h * 0.1); ctx.lineTo(-h * 0.3, h); ctx.lineTo(h * 0.6, -h * 0.15); ctx.lineTo(h * 0.05, -h * 0.15);
    ctx.closePath();
  },
  flag(ctx, s) {
    const h = s / 2;
    ctx.beginPath();
    ctx.rect(-h * 0.7, -h, h * 0.18, s);
    ctx.moveTo(-h * 0.52, -h); ctx.lineTo(h * 0.8, -h * 0.6); ctx.lineTo(-h * 0.52, -h * 0.2);
    ctx.closePath();
  },
  arrow(ctx, s) {
    const h = s / 2;
    ctx.beginPath();
    ctx.moveTo(-h, -h * 0.3); ctx.lineTo(h * 0.1, -h * 0.3); ctx.lineTo(h * 0.1, -h * 0.7); ctx.lineTo(h, 0); ctx.lineTo(h * 0.1, h * 0.7); ctx.lineTo(h * 0.1, h * 0.3); ctx.lineTo(-h, h * 0.3);
    ctx.closePath();
  },
};
export const ICON_NAMES = Object.keys(ICONS);

export class IconTool extends Drawing {
  static override toolId = 'icon';
  static override toolName = 'Icon';
  static override pointsCount = 1;
  static override group = 'text' as const;
  static override icon = svgIcon('M14 3l3.2 7 7.6.8-5.7 5.1 1.6 7.5L14 19.5l-6.7 3.9 1.6-7.5-5.7-5.1 7.6-.8z');
  defaultStyle(): Record<string, any> { return { icon: 'star', color: '#2962FF', size: 40, angle: 0 }; }
  propertyDefs(): PropertyDef[] { return [P.select('icon', 'Icon', ICON_NAMES.map((n) => ({ value: n, label: n[0].toUpperCase() + n.slice(1) }))), P.color('color', 'Color'), P.int('size', 'Size', 8, 400), P.number('angle', 'Angle', -180, 180, 1)]; }
  get size(): number { return clamp(Number(this.style.size) || 40, 8, 400); }
  glyphRect(p: PixelPoint): Rect { const s = this.size; return { x: p.x - s / 2, y: p.y - s / 2, w: s, h: s }; }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = rc.toPixel(this.points[0]);
    const { ctx } = rc;
    const draw = ICONS[String(this.style.icon)] ?? ICONS.star;
    ctx.save();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.translate(p.x, p.y);
    ctx.rotate(((Number(this.style.angle) || 0) * Math.PI) / 180);
    draw(ctx, this.size);
    ctx.fillStyle = this.style.color;
    ctx.fill();
    ctx.restore();
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = rc.toPixel(this.points[0]);
    if (Math.hypot(p.x - x, p.y - y) <= POINT_HIT_RADIUS) return { type: 'point', index: 0 };
    return inRect(x, y, this.glyphRect(p)) ? { type: 'body' } : null;
  }
  override bounds(rc: DrawingRenderContext) { return this.points.length ? rectBounds(this.glyphRect(rc.toPixel(this.points[0]))) : null; }
}

export const textTools = [TextTool, AnchoredText, Note, AnchoredNote, Pin, Callout, Comment, PriceLabel, PriceNote, Signpost, FlagMark, Table, Emoji, IconTool];
