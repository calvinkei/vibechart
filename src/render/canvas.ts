import type { LineStyle } from '../core/options';

/** A DPR-aware canvas layer. Coordinates passed to `ctx` are CSS pixels. */
export class CanvasLayer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;
  dpr = 1;

  constructor(className = '') {
    this.canvas = document.createElement('canvas');
    this.canvas.className = className;
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = '0';
    this.canvas.style.top = '0';
    this.canvas.style.display = 'block';
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context not available');
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number): void {
    width = Math.max(0, Math.floor(width));
    height = Math.max(0, Math.floor(height));
    if (this.width === width && this.height === height && this.dpr === dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear(): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  destroy(): void {
    this.canvas.remove();
  }
}

/** Snap a coordinate to the device-pixel grid for crisp thin lines. */
export function crisp(v: number, dpr: number, lineWidth = 1): number {
  const dev = Math.round(v * dpr);
  const lw = Math.round(lineWidth * dpr);
  return lw % 2 === 1 ? (dev + 0.5) / dpr : dev / dpr;
}

export function setLineStyle(ctx: CanvasRenderingContext2D, style: LineStyle | number, lineWidth = 1): void {
  const w = Math.max(1, lineWidth);
  switch (style) {
    case 1: ctx.setLineDash([w, 2 * w]); break; // dotted
    case 2: ctx.setLineDash([4 * w, 3 * w]); break; // dashed
    case 3: ctx.setLineDash([8 * w, 4 * w]); break; // large dashed
    case 4: ctx.setLineDash([w, 4 * w]); break; // sparse dotted
    default: ctx.setLineDash([]);
  }
}

export function drawHorizontalLine(ctx: CanvasRenderingContext2D, y: number, x1: number, x2: number, color: string, width: number, style: LineStyle | number, dpr: number): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  setLineStyle(ctx, style, width);
  const yy = crisp(y, dpr, width);
  ctx.beginPath();
  ctx.moveTo(x1, yy);
  ctx.lineTo(x2, yy);
  ctx.stroke();
  ctx.restore();
}

export function drawVerticalLine(ctx: CanvasRenderingContext2D, x: number, y1: number, y2: number, color: string, width: number, style: LineStyle | number, dpr: number): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  setLineStyle(ctx, style, width);
  const xx = crisp(x, dpr, width);
  ctx.beginPath();
  ctx.moveTo(xx, y1);
  ctx.lineTo(xx, y2);
  ctx.stroke();
  ctx.restore();
}

export function drawLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number, style: LineStyle | number = 0): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  setLineStyle(ctx, style, width);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

export function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

const measureCache = new Map<string, number>();
let measureCacheFont = '';

export function measureText(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  if (measureCacheFont !== font) {
    measureCache.clear();
    measureCacheFont = font;
  }
  let w = measureCache.get(text);
  if (w === undefined) {
    ctx.font = font;
    w = ctx.measureText(text).width;
    if (measureCache.size > 5000) measureCache.clear();
    measureCache.set(text, w);
  }
  return w;
}

export function makeFont(size: number, family: string, weight: string | number = 'normal', style = 'normal'): string {
  return `${style} ${weight} ${size}px ${family}`;
}

/** Draw a label with a background box (used on axes). Returns box rect. */
export function drawLabelBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { font: string; bg: string; color: string; padX?: number; padY?: number; align?: 'left' | 'center' | 'right'; vAlign?: 'top' | 'middle' | 'bottom'; radius?: number; border?: string },
): { x: number; y: number; w: number; h: number } {
  const padX = opts.padX ?? 6;
  const padY = opts.padY ?? 3;
  ctx.font = opts.font;
  const tw = ctx.measureText(text).width;
  const fontSize = parseInt(opts.font.match(/(\d+)px/)?.[1] ?? '12', 10);
  const w = tw + padX * 2;
  const h = fontSize + padY * 2;
  let bx = x;
  if (opts.align === 'center') bx = x - w / 2;
  else if (opts.align === 'right') bx = x - w;
  let by = y;
  if (opts.vAlign === 'middle') by = y - h / 2;
  else if (opts.vAlign === 'bottom') by = y - h;
  ctx.fillStyle = opts.bg;
  if (opts.radius) {
    drawRoundRect(ctx, bx, by, w, h, opts.radius);
    ctx.fill();
    if (opts.border) { ctx.strokeStyle = opts.border; ctx.lineWidth = 1; ctx.stroke(); }
  } else {
    ctx.fillRect(bx, by, w, h);
    if (opts.border) { ctx.strokeStyle = opts.border; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1); }
  }
  ctx.fillStyle = opts.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + padX, by + h / 2 + 0.5);
  return { x: bx, y: by, w, h };
}
