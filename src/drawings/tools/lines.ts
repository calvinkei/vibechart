import { Drawing, P, type DrawingRenderContext, type HitTarget, type PropertyDef, HIT_TOLERANCE } from '../Drawing';
import { applyLine, drawExtendedLine, lineDistance, drawArrowHead, drawTextBox, fontFor, LINE_STYLE_OPTIONS } from './common';
import { formatPrice, formatPercent, formatDuration } from '../../util/format';
import { crisp } from '../../render/canvas';

const baseLineStyle = () => ({ lineColor: '#2962FF', lineWidth: 2, lineStyle: 0, extendLeft: false, extendRight: false, leftEnd: 0, rightEnd: 0, showMiddlePoint: false, showPriceLabels: false, showPriceRange: false, showBarsRange: false, showDateTimeRange: false, showDistance: false, showAngle: false, alwaysShowStats: false, statsPosition: 'middle', text: '', showText: false, textColor: '#2962FF', fontSize: 14, bold: false, italic: false, textAlign: 'left', textVAlign: 'bottom' });

function lineProps(extra: PropertyDef[] = []): PropertyDef[] {
  return [
    P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'),
    P.bool('extendLeft', 'Extend left'), P.bool('extendRight', 'Extend right'),
    P.select('leftEnd', 'Left end', [{ value: 0, label: 'Normal' }, { value: 1, label: 'Arrow' }]),
    P.select('rightEnd', 'Right end', [{ value: 0, label: 'Normal' }, { value: 1, label: 'Arrow' }]),
    P.bool('showMiddlePoint', 'Middle point'),
    P.section('Stats'),
    P.bool('showPriceLabels', 'Price labels'), P.bool('showPriceRange', 'Price range'), P.bool('showBarsRange', 'Bars range'), P.bool('showDateTimeRange', 'Date/time range'), P.bool('showDistance', 'Distance'), P.bool('showAngle', 'Angle'), P.bool('alwaysShowStats', 'Always show stats'),
    P.select('statsPosition', 'Stats position', [{ value: 'left', label: 'Left' }, { value: 'middle', label: 'Middle' }, { value: 'right', label: 'Right' }]),
    ...extra,
    P.bool('showText', 'Show text', 'Text'), P.text('text', 'Text'), P.color('textColor', 'Text color', 'Text'), P.fontSize('fontSize'), P.bool('bold', 'Bold', 'Text'), P.bool('italic', 'Italic', 'Text'),
    P.select('textAlign', 'Alignment', [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }], 'Text'),
    P.select('textVAlign', 'Vertical', [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }], 'Text'),
  ];
}

/** Renders stats (price/bars/date range, angle...) near the line. */
function renderLineStats(rc: DrawingRenderContext, d: Drawing, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const s = d.style;
  const show = s.alwaysShowStats || rc.selected || rc.hovered || rc.creating;
  const anyStat = s.showPriceRange || s.showBarsRange || s.showDateTimeRange || s.showDistance || s.showAngle;
  if (!show || !anyStat || d.points.length < 2) return;
  const p0 = d.points[0], p1 = d.points[1];
  const ts = rc.timeScale;
  const lines: string[] = [];
  const dp = p1.price - p0.price;
  if (s.showPriceRange) lines.push(`${dp >= 0 ? '+' : ''}${formatPrice(dp, rc.priceFormat)} (${formatPercent(p0.price !== 0 ? (dp / p0.price) * 100 : 0)})`);
  const bars = Math.round(ts.timeToIndex(p1.time) - ts.timeToIndex(p0.time));
  if (s.showBarsRange) lines.push(`${bars} bars`);
  if (s.showDateTimeRange) lines.push(formatDuration(p1.time - p0.time));
  if (s.showDistance) lines.push(`${Math.round(Math.hypot(b.x - a.x, b.y - a.y))} px`);
  if (s.showAngle) lines.push(`${Math.round((-Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI)}°`);
  const pos = s.statsPosition === 'left' ? a : s.statsPosition === 'right' ? b : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  drawTextBox(rc.ctx, lines.join('\n'), pos.x + 8, pos.y + 8, { font: fontFor(rc, 11), color: '#fff', bg: s.lineColor, radius: 3, padding: 4 });
}

function renderPriceLabels(rc: DrawingRenderContext, d: Drawing): void {
  if (!d.style.showPriceLabels) return;
  const { ctx } = rc;
  for (const p of d.points) {
    const px = rc.toPixel(p);
    drawTextBox(ctx, formatPrice(p.price, rc.priceFormat), px.x + 6, px.y, { font: fontFor(rc, 11), color: '#fff', bg: d.style.lineColor, radius: 2, padding: 2, vAlign: 'middle' });
  }
}

function renderLineText(rc: DrawingRenderContext, d: Drawing, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const s = d.style;
  if (!s.showText || !s.text) return;
  const ax = s.textAlign === 'left' ? Math.min(a.x, b.x) : s.textAlign === 'right' ? Math.max(a.x, b.x) : (a.x + b.x) / 2;
  const left = a.x <= b.x ? a : b;
  const right = a.x <= b.x ? b : a;
  const t = right.x === left.x ? 0.5 : (ax - left.x) / (right.x - left.x);
  const ay = left.y + (right.y - left.y) * t;
  const va = s.textVAlign;
  drawTextBox(rc.ctx, s.text, ax, va === 'top' ? ay + 6 : va === 'bottom' ? ay - 6 : ay, { font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.textColor, align: s.textAlign, vAlign: va === 'top' ? 'top' : va === 'bottom' ? 'bottom' : 'middle' });
}

export class TrendLine extends Drawing {
  static override toolId = 'trend_line';
  static override toolName = 'Trend Line';
  static override pointsCount = 2;
  static override group = 'lines' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M7.354 21.354l14-14-.707-.707-14 14z"/><path fill="currentColor" d="M22.5 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM8.5 21a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>';
  defaultStyle(): Record<string, any> { return baseLineStyle(); }
  propertyDefs(): PropertyDef[] { return lineProps(); }
  protected extendLeft(): boolean { return !!this.style.extendLeft; }
  protected extendRight(): boolean { return !!this.style.extendRight; }
  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1]);
    const { ctx } = rc;
    const s = this.style;
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    const seg = drawExtendedLine(rc, a, b, this.extendLeft(), this.extendRight());
    ctx.setLineDash([]);
    if (s.leftEnd === 1) drawArrowHead(ctx, b, a, 8 + s.lineWidth * 2);
    if (s.rightEnd === 1) drawArrowHead(ctx, a, b, 8 + s.lineWidth * 2);
    if (s.showMiddlePoint && (rc.selected || rc.hovered)) {
      ctx.beginPath(); ctx.arc((a.x + b.x) / 2, (a.y + b.y) / 2, 3, 0, Math.PI * 2); ctx.fillStyle = s.lineColor; ctx.fill();
    }
    void seg;
    renderPriceLabels(rc, this);
    renderLineText(rc, this, a, b);
    renderLineStats(rc, this, a, b);
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const pts = this.points.map((p) => rc.toPixel(p));
    for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - x, pts[i].y - y) <= 7) return { type: 'point', index: i };
    if (pts.length < 2) return null;
    return lineDistance(x, y, pts[0], pts[1], this.extendLeft(), this.extendRight()) <= HIT_TOLERANCE ? { type: 'body' } : null;
  }
}

export class Ray extends TrendLine {
  static override toolId = 'ray';
  static override toolName = 'Ray';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M8.354 20.354l14-14-.707-.707-14 14z"/><path fill="currentColor" d="M9.5 20a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>';
  defaultStyle(): Record<string, any> { return { ...baseLineStyle(), extendRight: true }; }
  protected override extendRight(): boolean { return true; }
}

export class ExtendedLine extends TrendLine {
  static override toolId = 'extended_line';
  static override toolName = 'Extended Line';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4.354 24.354l20-20-.707-.707-20 20z"/></svg>';
  defaultStyle(): Record<string, any> { return { ...baseLineStyle(), extendLeft: true, extendRight: true }; }
  protected override extendLeft(): boolean { return true; }
  protected override extendRight(): boolean { return true; }
}

export class InfoLine extends TrendLine {
  static override toolId = 'info_line';
  static override toolName = 'Info Line';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M7.354 21.354l14-14-.707-.707-14 14z"/><path fill="currentColor" d="M18 9h5v1h-5zM18 11h5v1h-5z"/></svg>';
  defaultStyle(): Record<string, any> { return { ...baseLineStyle(), showPriceRange: true, showBarsRange: true, showDateTimeRange: true, showDistance: true, showAngle: true, alwaysShowStats: true }; }
}

export class TrendAngle extends TrendLine {
  static override toolId = 'trend_angle';
  static override toolName = 'Trend Angle';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M6 22h16v-1H7.5l13.85-13.85-.7-.7L6 21.3z"/><path fill="currentColor" d="M14 21a8 8 0 0 0-2.34-5.66l-.71.71A7 7 0 0 1 13 21z"/></svg>';
  defaultStyle(): Record<string, any> { return { ...baseLineStyle(), showAngle: true, alwaysShowStats: true }; }
  override render(rc: DrawingRenderContext): void {
    super.render(rc);
    if (this.points.length < 2) return;
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1]);
    const { ctx } = rc;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.save();
    applyLine(ctx, this.style.lineColor, 1, 1);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + 40, a.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(a.x, a.y, 25, Math.min(0, ang), Math.max(0, ang)); ctx.stroke();
    ctx.restore();
  }
}

export class HorizontalLine extends Drawing {
  static override toolId = 'horizontal_line';
  static override toolName = 'Horizontal Line';
  static override pointsCount = 1;
  static override group = 'lines' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4 14h20v1H4z"/><path fill="currentColor" d="M15.5 14.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>';
  defaultStyle() { return { lineColor: '#2962FF', lineWidth: 2, lineStyle: 0, showPrice: true, text: '', showText: false, textColor: '#2962FF', fontSize: 14, bold: false, italic: false, textAlign: 'right', textVAlign: 'top' }; }
  propertyDefs(): PropertyDef[] {
    return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('showPrice', 'Show price'),
      P.bool('showText', 'Show text', 'Text'), P.text('text', 'Text'), P.color('textColor', 'Text color', 'Text'), P.fontSize('fontSize'), P.bool('bold', 'Bold', 'Text'), P.bool('italic', 'Italic', 'Text'),
      P.select('textAlign', 'Alignment', [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }], 'Text'),
      P.select('textVAlign', 'Vertical', [{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }], 'Text')];
  }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = rc.toPixel(this.points[0]);
    const { ctx, width } = rc;
    const s = this.style;
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    const y = crisp(p.y, rc.dpr, s.lineWidth);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    if (s.showPrice) drawTextBox(ctx, formatPrice(this.points[0].price, rc.priceFormat), width - 2, p.y, { font: fontFor(rc, 11), color: '#fff', bg: s.lineColor, radius: 2, padding: 2, align: 'right', vAlign: 'middle' });
    if (s.showText && s.text) {
      const x = s.textAlign === 'left' ? 6 : s.textAlign === 'right' ? width - 6 : width / 2;
      drawTextBox(ctx, s.text, x, s.textVAlign === 'top' ? p.y - 4 : p.y + 4, { font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.textColor, align: s.textAlign, vAlign: s.textVAlign === 'top' ? 'bottom' : 'top' });
    }
  }
  override handles(rc: DrawingRenderContext) { const p = rc.toPixel(this.points[0]); return [{ x: rc.width / 2, y: p.y, index: 0 }]; }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = rc.toPixel(this.points[0]);
    if (Math.abs(p.y - y) > HIT_TOLERANCE) return null;
    return Math.abs(x - rc.width / 2) <= 7 ? { type: 'point', index: 0 } : { type: 'body' };
  }
  override movePoint(index: number, p: { time: number; price: number }): void { this.points[0] = { time: this.points[0].time, price: p.price }; }
}

export class HorizontalRay extends HorizontalLine {
  static override toolId = 'horizontal_ray';
  static override toolName = 'Horizontal Ray';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M9 14h15v1H9z"/><path fill="currentColor" d="M9.5 14.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>';
  override render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = rc.toPixel(this.points[0]);
    const { ctx, width } = rc;
    const s = this.style;
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    const y = crisp(p.y, rc.dpr, s.lineWidth);
    ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(width, y); ctx.stroke();
    if (s.showPrice) drawTextBox(ctx, formatPrice(this.points[0].price, rc.priceFormat), width - 2, p.y, { font: fontFor(rc, 11), color: '#fff', bg: s.lineColor, radius: 2, padding: 2, align: 'right', vAlign: 'middle' });
    if (s.showText && s.text) drawTextBox(ctx, s.text, p.x + 6, s.textVAlign === 'top' ? p.y - 4 : p.y + 4, { font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.textColor, vAlign: s.textVAlign === 'top' ? 'bottom' : 'top' });
  }
  override handles(rc: DrawingRenderContext) { const p = rc.toPixel(this.points[0]); return [{ x: p.x, y: p.y, index: 0 }]; }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = rc.toPixel(this.points[0]);
    if (Math.hypot(p.x - x, p.y - y) <= 7) return { type: 'point', index: 0 };
    if (Math.abs(p.y - y) > HIT_TOLERANCE || x < p.x) return null;
    return { type: 'body' };
  }
  override movePoint(index: number, p: { time: number; price: number }): void { this.points[0] = p; }
}

export class VerticalLine extends Drawing {
  static override toolId = 'vertical_line';
  static override toolName = 'Vertical Line';
  static override pointsCount = 1;
  static override group = 'lines' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M14 4h1v20h-1z"/><path fill="currentColor" d="M16 14a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>';
  defaultStyle() { return { lineColor: '#2962FF', lineWidth: 2, lineStyle: 0, showTime: true, text: '', showText: false, textColor: '#2962FF', fontSize: 14, bold: false, italic: false, textAlign: 'right', textVAlign: 'top', textOrientation: 'horizontal' }; }
  propertyDefs(): PropertyDef[] {
    return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('showTime', 'Show time'),
      P.bool('showText', 'Show text', 'Text'), P.text('text', 'Text'), P.color('textColor', 'Text color', 'Text'), P.fontSize('fontSize'), P.bool('bold', 'Bold', 'Text'), P.bool('italic', 'Italic', 'Text'),
      P.select('textOrientation', 'Orientation', [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }], 'Text')];
  }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = rc.toPixel(this.points[0]);
    const { ctx, height } = rc;
    const s = this.style;
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    const x = crisp(p.x, rc.dpr, s.lineWidth);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    if (s.showTime) drawTextBox(ctx, rc.timeScale.formatCrosshairTime(this.points[0].time), p.x, height - 2, { font: fontFor(rc, 11), color: '#fff', bg: s.lineColor, radius: 2, padding: 2, align: 'center', vAlign: 'bottom' });
    if (s.showText && s.text) {
      if (s.textOrientation === 'vertical') {
        ctx.save(); ctx.translate(p.x - 4, 8); ctx.rotate(Math.PI / 2);
        drawTextBox(ctx, s.text, 0, 0, { font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.textColor, vAlign: 'bottom' });
        ctx.restore();
      } else drawTextBox(ctx, s.text, p.x + 4, 6, { font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.textColor });
    }
  }
  override handles(rc: DrawingRenderContext) { const p = rc.toPixel(this.points[0]); return [{ x: p.x, y: rc.height / 2, index: 0 }]; }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = rc.toPixel(this.points[0]);
    if (Math.abs(p.x - x) > HIT_TOLERANCE) return null;
    return Math.abs(y - rc.height / 2) <= 7 ? { type: 'point', index: 0 } : { type: 'body' };
  }
  override movePoint(index: number, p: { time: number; price: number }): void { this.points[0] = { time: p.time, price: this.points[0].price }; }
}

export class CrossLine extends Drawing {
  static override toolId = 'cross_line';
  static override toolName = 'Cross Line';
  static override pointsCount = 1;
  static override group = 'lines' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M14 4h1v20h-1zM4 14h20v1H4z"/></svg>';
  defaultStyle() { return { lineColor: '#2962FF', lineWidth: 1, lineStyle: 0, showPrice: true, showTime: true }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('showPrice', 'Show price'), P.bool('showTime', 'Show time')]; }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = rc.toPixel(this.points[0]);
    const { ctx, width, height } = rc;
    const s = this.style;
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    const x = crisp(p.x, rc.dpr, s.lineWidth), y = crisp(p.y, rc.dpr, s.lineWidth);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    if (s.showPrice) drawTextBox(ctx, formatPrice(this.points[0].price, rc.priceFormat), width - 2, p.y, { font: fontFor(rc, 11), color: '#fff', bg: s.lineColor, radius: 2, padding: 2, align: 'right', vAlign: 'middle' });
    if (s.showTime) drawTextBox(ctx, rc.timeScale.formatCrosshairTime(this.points[0].time), p.x, height - 2, { font: fontFor(rc, 11), color: '#fff', bg: s.lineColor, radius: 2, padding: 2, align: 'center', vAlign: 'bottom' });
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = rc.toPixel(this.points[0]);
    if (Math.hypot(p.x - x, p.y - y) <= 7) return { type: 'point', index: 0 };
    return Math.abs(p.x - x) <= HIT_TOLERANCE || Math.abs(p.y - y) <= HIT_TOLERANCE ? { type: 'body' } : null;
  }
}

export class Arrow extends TrendLine {
  static override toolId = 'arrow';
  static override toolName = 'Arrow';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M7.354 21.354l13-13-.707-.707-13 13z"/><path fill="currentColor" d="M21 7v6h-1V8.7l-.3.3-.7-.7.3-.3H15V7z"/></svg>';
  defaultStyle(): Record<string, any> { return { ...baseLineStyle(), rightEnd: 1 }; }
}

export class ParallelChannel extends Drawing {
  static override toolId = 'parallel_channel';
  static override toolName = 'Parallel Channel';
  static override pointsCount = 3;
  static override group = 'lines' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M5.354 17.354l12-12-.707-.707-12 12zM10.354 23.354l12-12-.707-.707-12 12z"/></svg>';
  defaultStyle() { return { lineColor: '#2962FF', lineWidth: 2, lineStyle: 0, fillColor: 'rgba(41, 98, 255, 0.2)', showMidline: true, midlineColor: '#2962FF', midlineWidth: 1, midlineStyle: 2, extendLeft: false, extendRight: false }; }
  propertyDefs(): PropertyDef[] {
    return [P.color('lineColor', 'Channel'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.color('fillColor', 'Background'), P.bool('showMidline', 'Middle line'), P.color('midlineColor', 'Middle line color'), P.lineWidth('midlineWidth', 'Middle width'), P.lineStyle('midlineStyle', 'Middle style'), P.bool('extendLeft', 'Extend left'), P.bool('extendRight', 'Extend right')];
  }
  override addPoint(p: { time: number; price: number }): boolean {
    this.points.push(p);
    if (this.points.length === 2) return false;
    return this.points.length >= 3;
  }
  private _lines(rc: DrawingRenderContext) {
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1]);
    const c = this.points[2] ? rc.toPixel(this.points[2]) : { x: a.x, y: a.y + 40 };
    const dy = c.y - a.y;
    // the third point defines the vertical offset of the parallel line at its x position
    const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x);
    const offset = c.y - (a.y + slope * (c.x - a.x));
    void dy;
    return { a, b, a2: { x: a.x, y: a.y + offset }, b2: { x: b.x, y: b.y + offset } };
  }
  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const { ctx } = rc;
    const s = this.style;
    const { a, b, a2, b2 } = this._lines(rc);
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    const l1 = drawExtendedLine(rc, a, b, s.extendLeft, s.extendRight);
    const l2 = this.points.length >= 3 ? drawExtendedLine(rc, a2, b2, s.extendLeft, s.extendRight) : null;
    if (l1 && l2) {
      ctx.fillStyle = s.fillColor;
      ctx.beginPath(); ctx.moveTo(l1[0].x, l1[0].y); ctx.lineTo(l1[1].x, l1[1].y); ctx.lineTo(l2[1].x, l2[1].y); ctx.lineTo(l2[0].x, l2[0].y); ctx.closePath(); ctx.fill();
      if (s.showMidline) {
        applyLine(ctx, s.midlineColor, s.midlineWidth, s.midlineStyle);
        drawExtendedLine(rc, { x: (a.x + a2.x) / 2, y: (a.y + a2.y) / 2 }, { x: (b.x + b2.x) / 2, y: (b.y + b2.y) / 2 }, s.extendLeft, s.extendRight);
      }
    }
  }
  override handles(rc: DrawingRenderContext) {
    if (this.points.length < 3) return super.handles(rc);
    const { a, b, a2, b2 } = this._lines(rc);
    return [{ ...a, index: 0 }, { ...b, index: 1 }, { ...a2, index: 2 }, { ...b2, index: 3 }];
  }
  override movePoint(index: number, p: { time: number; price: number }): void {
    if (index < 3) { this.points[index] = index === 2 ? { time: this.points[0].time, price: p.price } : p; return; }
    // 4th handle: adjust offset via price
    const dPrice = p.price - this.points[1].price;
    this.points[2] = { time: this.points[0].time, price: this.points[0].price + dPrice };
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const hs = this.handles(rc);
    for (const h of hs) if (Math.hypot(h.x - x, h.y - y) <= 7) return { type: 'point', index: h.index };
    const { a, b, a2, b2 } = this._lines(rc);
    const s = this.style;
    if (lineDistance(x, y, a, b, s.extendLeft, s.extendRight) <= HIT_TOLERANCE) return { type: 'body' };
    if (this.points.length >= 3 && lineDistance(x, y, a2, b2, s.extendLeft, s.extendRight) <= HIT_TOLERANCE) return { type: 'body' };
    // inside fill
    if (this.points.length >= 3) {
      const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
      if (x >= minX && x <= maxX) {
        const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x);
        const y1 = a.y + slope * (x - a.x);
        const y2 = a2.y + slope * (x - a2.x);
        if (y >= Math.min(y1, y2) && y <= Math.max(y1, y2)) return { type: 'body' };
      }
    }
    return null;
  }
}

export const lineTools = [TrendLine, Ray, InfoLine, ExtendedLine, TrendAngle, HorizontalLine, HorizontalRay, VerticalLine, CrossLine, Arrow, ParallelChannel];
