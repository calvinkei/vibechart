import { Drawing, P, type DrawingRenderContext, type HitTarget, type PropertyDef, HIT_TOLERANCE } from '../Drawing';
import { applyLine, drawTextBox, fontFor } from './common';
import { distToSegment, pointInRect } from '../../util/math';

export class Rectangle extends Drawing {
  static override toolId = 'rectangle';
  static override toolName = 'Rectangle';
  static override pointsCount = 2;
  static override group = 'shapes' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M5 7h18v14H5zm1 1v12h16V8z"/></svg>';
  defaultStyle() { return { lineColor: '#2962FF', lineWidth: 1, lineStyle: 0, fillColor: 'rgba(41, 98, 255, 0.2)', extendLeft: false, extendRight: false, showMiddleLine: false, text: '', showText: false, textColor: '#2962FF', fontSize: 14, bold: false, italic: false, textAlign: 'center', textVAlign: 'middle' }; }
  propertyDefs(): PropertyDef[] {
    return [P.color('lineColor', 'Border'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.color('fillColor', 'Background'), P.bool('extendLeft', 'Extend left'), P.bool('extendRight', 'Extend right'), P.bool('showMiddleLine', 'Middle line'),
      P.bool('showText', 'Show text', 'Text'), P.text('text', 'Text'), P.color('textColor', 'Text color', 'Text'), P.fontSize('fontSize'), P.bool('bold', 'Bold', 'Text'), P.bool('italic', 'Italic', 'Text'),
      P.select('textAlign', 'Alignment', [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }], 'Text'),
      P.select('textVAlign', 'Vertical', [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }], 'Text')];
  }
  protected rect(rc: DrawingRenderContext) {
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    let x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
    if (this.style.extendLeft) x1 = -10;
    if (this.style.extendRight) x2 = rc.width + 10;
    return { x1, y1: Math.min(a.y, b.y), x2, y2: Math.max(a.y, b.y) };
  }
  render(rc: DrawingRenderContext): void {
    if (this.points.length < 1) return;
    const { ctx } = rc;
    const s = this.style;
    const r = this.rect(rc);
    ctx.fillStyle = s.fillColor;
    ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    ctx.strokeRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    if (s.showMiddleLine) { ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(r.x1, (r.y1 + r.y2) / 2); ctx.lineTo(r.x2, (r.y1 + r.y2) / 2); ctx.stroke(); }
    if (s.showText && s.text) {
      const x = s.textAlign === 'left' ? r.x1 + 4 : s.textAlign === 'right' ? r.x2 - 4 : (r.x1 + r.x2) / 2;
      const y = s.textVAlign === 'top' ? r.y1 + 4 : s.textVAlign === 'bottom' ? r.y2 - 4 : (r.y1 + r.y2) / 2;
      drawTextBox(ctx, s.text, x, y, { font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.textColor, align: s.textAlign, vAlign: s.textVAlign, maxWidth: Math.max(40, r.x2 - r.x1 - 8) });
    }
  }
  override handles(rc: DrawingRenderContext) {
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    return [{ ...a, index: 0 }, { ...b, index: 1 }, { x: b.x, y: a.y, index: 2 }, { x: a.x, y: b.y, index: 3 }];
  }
  override movePoint(index: number, p: { time: number; price: number }): void {
    if (index === 0 || index === 1) { this.points[index] = p; return; }
    if (index === 2) { this.points[1] = { time: p.time, price: this.points[1].price }; this.points[0] = { time: this.points[0].time, price: p.price }; }
    if (index === 3) { this.points[0] = { time: p.time, price: this.points[0].price }; this.points[1] = { time: this.points[1].time, price: p.price }; }
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    for (const h of this.handles(rc)) if (Math.hypot(h.x - x, h.y - y) <= 7) return { type: 'point', index: h.index };
    const r = this.rect(rc);
    const onEdge = (Math.abs(x - r.x1) <= HIT_TOLERANCE || Math.abs(x - r.x2) <= HIT_TOLERANCE) && y >= r.y1 - HIT_TOLERANCE && y <= r.y2 + HIT_TOLERANCE
      || (Math.abs(y - r.y1) <= HIT_TOLERANCE || Math.abs(y - r.y2) <= HIT_TOLERANCE) && x >= r.x1 - HIT_TOLERANCE && x <= r.x2 + HIT_TOLERANCE;
    if (onEdge) return { type: 'body' };
    if (pointInRect(x, y, r.x1, r.y1, r.x2, r.y2)) return { type: 'body', part: 'inside' };
    return null;
  }
}

export class Ellipse extends Drawing {
  static override toolId = 'ellipse';
  static override toolName = 'Ellipse';
  static override pointsCount = 2;
  static override group = 'shapes' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M14 6c5.5 0 10 3.6 10 8s-4.5 8-10 8S4 18.4 4 14s4.5-8 10-8zm0 1c-5 0-9 3.1-9 7s4 7 9 7 9-3.1 9-7-4-7-9-7z"/></svg>';
  defaultStyle() { return { lineColor: '#2962FF', lineWidth: 1, lineStyle: 0, fillColor: 'rgba(41, 98, 255, 0.2)', text: '', showText: false, textColor: '#2962FF', fontSize: 14, bold: false, italic: false }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Border'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.color('fillColor', 'Background'), P.bool('showText', 'Show text', 'Text'), P.text('text', 'Text'), P.color('textColor', 'Text color', 'Text'), P.fontSize('fontSize'), P.bool('bold', 'Bold', 'Text'), P.bool('italic', 'Italic', 'Text')]; }
  private _geom(rc: DrawingRenderContext) {
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2 };
  }
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const { ctx } = rc;
    const s = this.style;
    const g = this._geom(rc);
    if (g.rx < 0.5 && g.ry < 0.5) return;
    ctx.beginPath();
    ctx.ellipse(g.cx, g.cy, Math.max(0.5, g.rx), Math.max(0.5, g.ry), 0, 0, Math.PI * 2);
    ctx.fillStyle = s.fillColor;
    ctx.fill();
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    ctx.stroke();
    if (s.showText && s.text) drawTextBox(ctx, s.text, g.cx, g.cy, { font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.textColor, align: 'center', vAlign: 'middle' });
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const pts = this.points.map((p) => rc.toPixel(p));
    for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - x, pts[i].y - y) <= 7) return { type: 'point', index: i };
    const g = this._geom(rc);
    if (g.rx < 1 || g.ry < 1) return null;
    const v = ((x - g.cx) / g.rx) ** 2 + ((y - g.cy) / g.ry) ** 2;
    const tol = HIT_TOLERANCE / Math.min(g.rx, g.ry);
    if (Math.abs(Math.sqrt(v) - 1) <= tol) return { type: 'body' };
    if (v < 1) return { type: 'body', part: 'inside' };
    return null;
  }
}

export class Triangle extends Drawing {
  static override toolId = 'triangle';
  static override toolName = 'Triangle';
  static override pointsCount = 3;
  static override group = 'shapes' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M14 5l10 18H4L14 5zm0 2L5.7 22h16.6L14 7z"/></svg>';
  defaultStyle() { return { lineColor: '#2962FF', lineWidth: 1, lineStyle: 0, fillColor: 'rgba(41, 98, 255, 0.2)' }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Border'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.color('fillColor', 'Background')]; }
  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const pts = this.points.map((p) => rc.toPixel(p));
    const { ctx } = rc;
    const s = this.style;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    if (pts.length >= 3) { ctx.fillStyle = s.fillColor; ctx.fill(); }
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    ctx.stroke();
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const pts = this.points.map((p) => rc.toPixel(p));
    for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - x, pts[i].y - y) <= 7) return { type: 'point', index: i };
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= HIT_TOLERANCE) return { type: 'body' };
    }
    return null;
  }
}

export class TextTool extends Drawing {
  static override toolId = 'text';
  static override toolName = 'Text';
  static override pointsCount = 1;
  static override group = 'text' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M8 6h12v3h-1V7h-4.5v14H17v1h-6v-1h2.5V7H9v2H8z"/></svg>';
  defaultStyle() { return { text: 'Text', textColor: '#2962FF', fontSize: 14, bold: false, italic: false, showBackground: false, backgroundColor: 'rgba(41, 98, 255, 0.2)', showBorder: false, borderColor: '#2962FF', wrap: false, wrapWidth: 200 }; }
  propertyDefs(): PropertyDef[] { return [P.text('text', 'Text', 'Style'), P.color('textColor', 'Text color'), P.fontSize('fontSize', 'Font size', 'Style'), P.bool('bold', 'Bold'), P.bool('italic', 'Italic'), P.bool('showBackground', 'Background'), P.color('backgroundColor', 'Background color'), P.bool('showBorder', 'Border'), P.color('borderColor', 'Border color'), P.bool('wrap', 'Text wrap'), P.int('wrapWidth', 'Wrap width', 50, 2000)]; }
  private _box: { x: number; y: number; w: number; h: number } | null = null;
  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const p = rc.toPixel(this.points[0]);
    const s = this.style;
    this._box = drawTextBox(rc.ctx, s.text || ' ', p.x, p.y, { font: fontFor(rc, s.fontSize, s.bold, s.italic), color: s.textColor, bg: s.showBackground ? s.backgroundColor : null, border: s.showBorder ? s.borderColor : null, padding: 4, maxWidth: s.wrap ? s.wrapWidth : undefined });
    if (rc.selected || rc.hovered) {
      rc.ctx.save(); rc.ctx.strokeStyle = '#2962FF'; rc.ctx.setLineDash([3, 3]); rc.ctx.lineWidth = 1;
      rc.ctx.strokeRect(this._box.x - 1, this._box.y - 1, this._box.w + 2, this._box.h + 2); rc.ctx.restore();
    }
  }
  override handles(rc: DrawingRenderContext) { const p = rc.toPixel(this.points[0]); return [{ x: p.x, y: p.y, index: 0 }]; }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const p = rc.toPixel(this.points[0]);
    if (Math.hypot(p.x - x, p.y - y) <= 7) return { type: 'point', index: 0 };
    const b = this._box;
    if (b && pointInRect(x, y, b.x, b.y, b.x + b.w, b.y + b.h)) return { type: 'body' };
    return null;
  }
}

export class Brush extends Drawing {
  static override toolId = 'brush';
  static override toolName = 'Brush';
  static override pointsCount = 0; // freehand
  static override group = 'shapes' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M20.5 4.5l3 3L11 20l-4 1 1-4L20.5 4.5zm0 1.4L9 17.4l-.5 2.1 2.1-.5L22.1 7.5l-1.6-1.6z"/></svg>';
  defaultStyle(): Record<string, any> { return { lineColor: '#2962FF', lineWidth: 2, lineStyle: 0, smooth: 5, fillColor: 'rgba(41, 98, 255, 0)', leftEnd: 0, rightEnd: 0 }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.color('fillColor', 'Background'), P.int('smooth', 'Smoothing', 0, 20)]; }
  override isComplete(): boolean { return this.points.length >= 2 && !this.creating; }
  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const pts = this.points.map((p) => rc.toPixel(p));
    const { ctx } = rc;
    const s = this.style;
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (s.smooth > 0) {
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    } else for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  override handles(rc: DrawingRenderContext) { const a = rc.toPixel(this.points[0]); const b = rc.toPixel(this.points[this.points.length - 1]); return [{ ...a, index: 0 }, { ...b, index: this.points.length - 1 }]; }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const pts = this.points.map((p) => rc.toPixel(p));
    for (let i = 1; i < pts.length; i++) if (distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= HIT_TOLERANCE + this.style.lineWidth) return { type: 'body' };
    return null;
  }
}

export class Highlighter extends Brush {
  static override toolId = 'highlighter';
  static override toolName = 'Highlighter';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M19 4l5 5-9 9-5-5 9-9zm0 1.4L11.4 13l3.6 3.6L22.6 9 19 5.4zM9.5 14.5l4 4L11 21H6v-2.5l3.5-4z"/></svg>';
  defaultStyle(): Record<string, any> { return { lineColor: 'rgba(255, 235, 59, 0.5)', lineWidth: 20, lineStyle: 0, smooth: 5 }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Color'), P.int('lineWidth', 'Width', 4, 60)]; }
}

export class Polyline extends Drawing {
  static override toolId = 'polyline';
  static override toolName = 'Polyline';
  static override pointsCount = 0; // finish on double click
  static override group = 'shapes' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4.5 20.5l7-11 5 7 7-11 .8.6-7.8 12.2-5-7-6.2 9.7z"/></svg>';
  defaultStyle() { return { lineColor: '#2962FF', lineWidth: 2, lineStyle: 0, fillColor: 'rgba(41, 98, 255, 0.2)', filled: false }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('filled', 'Fill'), P.color('fillColor', 'Background')]; }
  override addPoint(p: { time: number; price: number }): boolean { this.points.push(p); return false; }
  override isComplete(): boolean { return false; }
  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const pts = this.points.map((p) => rc.toPixel(p));
    const { ctx } = rc;
    const s = this.style;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    if (s.filled) { ctx.closePath(); ctx.fillStyle = s.fillColor; ctx.fill(); }
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    ctx.stroke();
  }
}

export const shapeTools = [Rectangle, Ellipse, Triangle, TextTool, Brush, Highlighter, Polyline];
