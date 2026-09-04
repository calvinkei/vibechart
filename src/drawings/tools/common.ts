import type { DrawingRenderContext, PixelPoint } from '../Drawing';
import { setLineStyle } from '../../render/canvas';
import { clipLineToRect, distToSegment, distToLine, distToRay } from '../../util/math';

export function applyLine(ctx: CanvasRenderingContext2D, color: string, width: number, style: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  setLineStyle(ctx, style, width);
}

/** Draw a segment between a and b, optionally extended to the pane bounds. */
export function drawExtendedLine(rc: DrawingRenderContext, a: PixelPoint, b: PixelPoint, extendLeft: boolean, extendRight: boolean): [PixelPoint, PixelPoint] | null {
  const { ctx, width, height } = rc;
  const pad = 2000;
  const seg = clipLineToRect(a.x, a.y, b.x, b.y, -pad, -pad, width + pad, height + pad, extendLeft, extendRight);
  if (!seg) return null;
  ctx.beginPath();
  ctx.moveTo(seg[0], seg[1]);
  ctx.lineTo(seg[2], seg[3]);
  ctx.stroke();
  return [{ x: seg[0], y: seg[1] }, { x: seg[2], y: seg[3] }];
}

export function lineDistance(x: number, y: number, a: PixelPoint, b: PixelPoint, extendLeft: boolean, extendRight: boolean): number {
  if (extendLeft && extendRight) return distToLine(x, y, a.x, a.y, b.x, b.y);
  if (extendRight) return distToRay(x, y, a.x, a.y, b.x, b.y);
  if (extendLeft) return distToRay(x, y, b.x, b.y, a.x, a.y);
  return distToSegment(x, y, a.x, a.y, b.x, b.y);
}

export function drawArrowHead(ctx: CanvasRenderingContext2D, from: PixelPoint, to: PixelPoint, size = 10): void {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(ang - Math.PI / 6), to.y - size * Math.sin(ang - Math.PI / 6));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(ang + Math.PI / 6), to.y - size * Math.sin(ang + Math.PI / 6));
  ctx.stroke();
}

export interface TextBoxOpts {
  font: string;
  color: string;
  bg?: string | null;
  border?: string | null;
  padding?: number;
  align?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'middle' | 'bottom';
  radius?: number;
  maxWidth?: number;
}

/** Draw (possibly multi-line) text with optional background. Returns rect. */
export function drawTextBox(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: TextBoxOpts): { x: number; y: number; w: number; h: number } {
  const lines = wrapText(ctx, text, o.font, o.maxWidth);
  const pad = o.padding ?? 4;
  ctx.font = o.font;
  const fontSize = parseInt(o.font.match(/(\d+)px/)?.[1] ?? '12', 10);
  const lh = Math.round(fontSize * 1.3);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 0) + pad * 2;
  const h = lines.length * lh + pad * 2;
  let bx = x;
  if (o.align === 'center') bx = x - w / 2;
  else if (o.align === 'right') bx = x - w;
  let by = y;
  if (o.vAlign === 'middle') by = y - h / 2;
  else if (o.vAlign === 'bottom') by = y - h;
  if (o.bg) {
    ctx.fillStyle = o.bg;
    if (o.radius) { roundRect(ctx, bx, by, w, h, o.radius); ctx.fill(); } else ctx.fillRect(bx, by, w, h);
  }
  if (o.border) {
    ctx.strokeStyle = o.border;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    if (o.radius) { roundRect(ctx, bx + 0.5, by + 0.5, w - 1, h - 1, o.radius); ctx.stroke(); } else ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
  }
  ctx.fillStyle = o.color;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad + i * lh));
  return { x: bx, y: by, w, h };
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, font: string, maxWidth?: number): string[] {
  ctx.font = font;
  const paragraphs = String(text ?? '').split('\n');
  if (!maxWidth) return paragraphs;
  const out: string[] = [];
  for (const p of paragraphs) {
    const words = p.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) { out.push(line); line = w; } else line = test;
    }
    out.push(line);
  }
  return out;
}

export function fontFor(rc: DrawingRenderContext, size: number, bold = false, italic = false): string {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${rc.fontFamily}`;
}

export const LINE_STYLE_OPTIONS = [{ value: 0, label: 'Solid' }, { value: 2, label: 'Dashed' }, { value: 1, label: 'Dotted' }];
export const TEXT_ALIGN_OPTIONS = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }];
export const FONT_SIZES = [10, 11, 12, 14, 16, 20, 24, 28, 32, 40];
