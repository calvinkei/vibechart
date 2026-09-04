import type { Bar } from '../data/types';
import type { RenderContext } from './Series';
import type { CandleStyleOptions, BarStyleOptions, LineStyleOptions, AreaStyleOptions, BaselineStyleOptions, ColumnStyleOptions, HighLowStyleOptions, HLCAreaStyleOptions } from '../core/options';
import { setLineStyle, crisp } from '../render/canvas';
import { priceSourceValue } from '../data/types';

export interface OHLCArrays {
  open: Float64Array; high: Float64Array; low: Float64Array; close: Float64Array; volume: Float64Array;
}

export function toArrays(bars: Bar[]): OHLCArrays {
  const n = bars.length;
  const open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n), close = new Float64Array(n), volume = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    open[i] = b.open; high[i] = b.high; low[i] = b.low; close[i] = b.close; volume[i] = b.volume ?? NaN;
  }
  return { open, high, low, close, volume };
}

function bodyWidth(barSpacing: number): number {
  // TradingView-like: candles take ~ 70-80% of bar spacing, min 1px, and become 1px thin below ~3px spacing
  if (barSpacing < 2.5) return Math.max(1, Math.floor(barSpacing));
  let w = Math.floor(barSpacing * 0.7);
  if (w % 2 === 0) w = Math.max(1, w - 1); // odd width => centered on crisp pixel
  return Math.max(1, w);
}

function upDown(bars: Bar[], i: number, basedOnPrev: boolean): boolean {
  const b = bars[i];
  if (basedOnPrev && i > 0) return b.close >= bars[i - 1].close;
  return b.close >= b.open;
}

export function renderCandles(rc: RenderContext, bars: Bar[], st: CandleStyleOptions, mode: 'solid' | 'hollow' = 'solid'): void {
  const { ctx, timeScale, priceScale, visible, dpr } = rc;
  const bs = timeScale.barSpacing;
  const bw = bodyWidth(bs);
  const half = Math.floor(bw / 2);
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = visible.from; i <= visible.to; i++) {
    const b = bars[i];
    if (!b || !Number.isFinite(b.close)) continue;
    const up = b.close >= b.open;
    // For hollow candles, color by comparison with previous close (TV): up if close > prev close
    const prevUp = mode === 'hollow' && i > 0 ? b.close >= bars[i - 1].close : up;
    const color = prevUp ? st.upColor : st.downColor;
    const border = prevUp ? st.borderUpColor : st.borderDownColor;
    const wick = prevUp ? st.wickUpColor : st.wickDownColor;
    const xc = Math.round(timeScale.barCenterX(i) * dpr) / dpr;
    const yO = priceScale.priceToY(b.open);
    const yC = priceScale.priceToY(b.close);
    const yH = priceScale.priceToY(b.high);
    const yL = priceScale.priceToY(b.low);
    let top = Math.min(yO, yC);
    let bottom = Math.max(yO, yC);
    if (bottom - top < 1) { bottom = top + 1; }
    // wick
    if (st.wickVisible) {
      ctx.strokeStyle = wick;
      ctx.beginPath();
      const wx = crisp(xc, dpr, 1);
      ctx.moveTo(wx, yH);
      ctx.lineTo(wx, top);
      ctx.moveTo(wx, bottom);
      ctx.lineTo(wx, yL);
      ctx.stroke();
    }
    const left = Math.round((xc - half) * dpr) / dpr;
    const w = bw;
    const hollow = mode === 'hollow' && up; // hollow when close >= open
    if (bw <= 1) {
      ctx.fillStyle = hollow ? border : color;
      ctx.fillRect(left, top, 1, bottom - top);
      continue;
    }
    if (st.bodyVisible && !hollow) {
      ctx.fillStyle = color;
      ctx.fillRect(left, top, w, bottom - top);
    }
    if (st.borderVisible || hollow) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      const lx = crisp(left, dpr, 1);
      const ty = crisp(top, dpr, 1);
      const bh = Math.max(1, Math.round(bottom - top));
      ctx.strokeRect(lx, ty, Math.max(1, w - 1), bh);
    }
  }
  ctx.restore();
}

export function renderBars(rc: RenderContext, bars: Bar[], st: BarStyleOptions): void {
  const { ctx, timeScale, priceScale, visible, dpr } = rc;
  const bs = timeScale.barSpacing;
  const thin = st.thinBars || bs < 6;
  const lw = thin ? 1 : Math.max(1, Math.floor(bs * 0.3));
  const tick = Math.max(1, Math.floor(bs * 0.35));
  ctx.save();
  ctx.lineWidth = lw;
  for (let i = visible.from; i <= visible.to; i++) {
    const b = bars[i];
    if (!b) continue;
    const up = upDown(bars, i, st.colorBasedOnPrevClose);
    ctx.strokeStyle = up ? st.upColor : st.downColor;
    const xc = crisp(timeScale.barCenterX(i), dpr, lw);
    const yO = crisp(priceScale.priceToY(b.open), dpr, lw);
    const yC = crisp(priceScale.priceToY(b.close), dpr, lw);
    const yH = priceScale.priceToY(b.high);
    const yL = priceScale.priceToY(b.low);
    ctx.beginPath();
    ctx.moveTo(xc, yH);
    ctx.lineTo(xc, yL);
    if (!st.hlcBars) {
      ctx.moveTo(xc - tick, yO);
      ctx.lineTo(xc, yO);
    }
    ctx.moveTo(xc, yC);
    ctx.lineTo(xc + tick, yC);
    ctx.stroke();
  }
  ctx.restore();
}

/** Build a path of the line across the visible range using priceSource. */
function buildLinePoints(rc: RenderContext, bars: Bar[], source: LineStyleOptions['priceSource'], step: boolean): Array<[number, number]> {
  const { timeScale, priceScale, visible } = rc;
  const pts: Array<[number, number]> = [];
  const from = Math.max(0, visible.from - 1);
  const to = Math.min(bars.length - 1, visible.to + 1);
  for (let i = from; i <= to; i++) {
    const b = bars[i];
    if (!b) continue;
    const v = priceSourceValue(b, source);
    if (!Number.isFinite(v)) continue;
    const x = timeScale.barCenterX(i);
    const y = priceScale.priceToY(v);
    if (step && pts.length) {
      const prev = pts[pts.length - 1];
      pts.push([x - timeScale.barSpacing / 2, prev[1]]);
      pts.push([x - timeScale.barSpacing / 2, y]);
    }
    pts.push([x, y]);
  }
  return pts;
}

export function strokePolyline(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, color: string, width: number, style: number, curved = false): void {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  setLineStyle(ctx, style, width);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (curved) {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
    }
  } else {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.stroke();
  ctx.restore();
}

export function renderLine(rc: RenderContext, bars: Bar[], st: LineStyleOptions): void {
  const pts = buildLinePoints(rc, bars, st.priceSource, st.lineType === 'step');
  strokePolyline(rc.ctx, pts, st.color, st.lineWidth, st.lineStyle, st.lineType === 'curved');
  if (st.lineType === 'markers') {
    const { ctx } = rc;
    const r = st.markerRadius;
    if (rc.timeScale.barSpacing >= r * 2 + 2) {
      ctx.save();
      ctx.fillStyle = st.color;
      const step = 1;
      for (let i = 0; i < pts.length; i += step) {
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  if (st.crosshairMarkerVisible && rc.crosshairIndex !== null) {
    const i = rc.crosshairIndex;
    const b = bars[i];
    if (b) {
      const v = priceSourceValue(b, st.priceSource);
      const { ctx } = rc;
      ctx.save();
      ctx.fillStyle = st.color;
      ctx.beginPath();
      ctx.arc(rc.timeScale.barCenterX(i), rc.priceScale.priceToY(v), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

export function renderArea(rc: RenderContext, bars: Bar[], st: AreaStyleOptions): void {
  const pts = buildLinePoints(rc, bars, st.priceSource, false);
  if (pts.length < 2) return;
  const { ctx, height } = rc;
  ctx.save();
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, st.invertFilledArea ? st.bottomColor : st.topColor);
  grad.addColorStop(1, st.invertFilledArea ? st.topColor : st.bottomColor);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], st.invertFilledArea ? 0 : height);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(pts[pts.length - 1][0], st.invertFilledArea ? 0 : height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  strokePolyline(ctx, pts, st.lineColor, st.lineWidth, st.lineStyle);
}

export function renderHLCArea(rc: RenderContext, bars: Bar[], st: HLCAreaStyleOptions): void {
  const hi = buildLinePoints(rc, bars, 'high', false);
  const lo = buildLinePoints(rc, bars, 'low', false);
  const cl = buildLinePoints(rc, bars, 'close', false);
  if (hi.length < 2) return;
  const { ctx } = rc;
  ctx.save();
  ctx.fillStyle = st.fillColor;
  ctx.beginPath();
  ctx.moveTo(hi[0][0], hi[0][1]);
  for (const [x, y] of hi) ctx.lineTo(x, y);
  for (let i = lo.length - 1; i >= 0; i--) ctx.lineTo(lo[i][0], lo[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  strokePolyline(ctx, hi, st.highLineColor, st.highLineWidth, st.highLineStyle);
  strokePolyline(ctx, lo, st.lowLineColor, st.lowLineWidth, st.lowLineStyle);
  strokePolyline(ctx, cl, st.closeLineColor, st.closeLineWidth, st.closeLineStyle);
}

export function renderBaseline(rc: RenderContext, bars: Bar[], st: BaselineStyleOptions): void {
  const pts = buildLinePoints(rc, bars, st.priceSource, false);
  if (pts.length < 2) return;
  const { ctx, height, priceScale } = rc;
  let baseY: number;
  if (st.baseValue.type === 'price') baseY = priceScale.priceToY(st.baseValue.price);
  else baseY = (height * st.baseValue.percent) / 100;
  baseY = Math.max(0, Math.min(height, baseY));
  ctx.save();
  // top part
  ctx.beginPath();
  ctx.rect(0, 0, rc.width, baseY);
  ctx.clip();
  const gTop = ctx.createLinearGradient(0, 0, 0, baseY);
  gTop.addColorStop(0, st.topFillColor1);
  gTop.addColorStop(1, st.topFillColor2);
  ctx.fillStyle = gTop;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], baseY);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(pts[pts.length - 1][0], baseY);
  ctx.closePath();
  ctx.fill();
  strokePolyline(ctx, pts, st.topLineColor, st.lineWidth, st.lineStyle);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, baseY, rc.width, height - baseY);
  ctx.clip();
  const gBot = ctx.createLinearGradient(0, baseY, 0, height);
  gBot.addColorStop(0, st.bottomFillColor1);
  gBot.addColorStop(1, st.bottomFillColor2);
  ctx.fillStyle = gBot;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], baseY);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(pts[pts.length - 1][0], baseY);
  ctx.closePath();
  ctx.fill();
  strokePolyline(ctx, pts, st.bottomLineColor, st.lineWidth, st.lineStyle);
  ctx.restore();
  if (st.baseLineVisible) {
    ctx.save();
    ctx.strokeStyle = st.baseLineColor;
    ctx.lineWidth = st.baseLineWidth;
    setLineStyle(ctx, st.baseLineStyle, st.baseLineWidth);
    const y = crisp(baseY, rc.dpr, st.baseLineWidth);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(rc.width, y);
    ctx.stroke();
    ctx.restore();
  }
}

export function renderColumns(rc: RenderContext, bars: Bar[], st: ColumnStyleOptions): void {
  const { ctx, timeScale, priceScale, visible, dpr, height } = rc;
  const bw = bodyWidth(timeScale.barSpacing);
  const half = Math.floor(bw / 2);
  const zeroY = Math.min(height, Math.max(0, priceScale.priceToY(0)));
  ctx.save();
  for (let i = visible.from; i <= visible.to; i++) {
    const b = bars[i];
    if (!b) continue;
    const v = priceSourceValue(b, st.priceSource);
    if (!Number.isFinite(v)) continue;
    const up = upDown(bars, i, st.colorBasedOnPrevClose);
    ctx.fillStyle = up ? st.upColor : st.downColor;
    const xc = Math.round(timeScale.barCenterX(i) * dpr) / dpr;
    const y = priceScale.priceToY(v);
    const top = Math.min(y, zeroY);
    const h = Math.max(1, Math.abs(zeroY - y));
    ctx.fillRect(Math.round((xc - half) * dpr) / dpr, top, bw, h);
  }
  ctx.restore();
}

/** Histogram used by volume/indicators; values aligned with bar indices; colors per bar. */
export function renderHistogram(rc: RenderContext, values: ArrayLike<number>, colorAt: (i: number) => string, base = 0, widthRatio = 0.7): void {
  const { ctx, timeScale, priceScale, visible, dpr, height } = rc;
  const bs = timeScale.barSpacing;
  let bw = bs < 2.5 ? Math.max(1, Math.floor(bs)) : Math.max(1, Math.floor(bs * widthRatio));
  if (bw > 1 && bw % 2 === 0) bw -= 1;
  const half = Math.floor(bw / 2);
  const zeroY = Math.min(height, Math.max(0, priceScale.priceToY(base)));
  ctx.save();
  for (let i = visible.from; i <= visible.to; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    ctx.fillStyle = colorAt(i);
    const xc = Math.round(timeScale.barCenterX(i) * dpr) / dpr;
    const y = priceScale.priceToY(v);
    const top = Math.min(y, zeroY);
    const h = Math.max(1, Math.abs(zeroY - y));
    ctx.fillRect(Math.round((xc - half) * dpr) / dpr, top, bw, h);
  }
  ctx.restore();
}

export function renderHighLow(rc: RenderContext, bars: Bar[], st: HighLowStyleOptions): void {
  const { ctx, timeScale, priceScale, visible, dpr } = rc;
  const bw = bodyWidth(timeScale.barSpacing);
  const half = Math.floor(bw / 2);
  ctx.save();
  ctx.font = `${st.fontSize}px ${rc.options.layout.fontFamily}`;
  ctx.textAlign = 'center';
  for (let i = visible.from; i <= visible.to; i++) {
    const b = bars[i];
    if (!b) continue;
    const xc = Math.round(timeScale.barCenterX(i) * dpr) / dpr;
    const yH = priceScale.priceToY(b.high);
    const yL = priceScale.priceToY(b.low);
    const left = Math.round((xc - half) * dpr) / dpr;
    ctx.fillStyle = st.bodyColor;
    ctx.fillRect(left, yH, bw, Math.max(1, yL - yH));
    if (st.borderVisible && bw > 2) {
      ctx.strokeStyle = st.borderColor;
      ctx.strokeRect(crisp(left, dpr), crisp(yH, dpr), bw - 1, Math.max(1, yL - yH));
    }
    if (st.showLabels && timeScale.barSpacing > 30) {
      ctx.fillStyle = st.labelColor;
      ctx.textBaseline = 'bottom';
      ctx.fillText(rc.priceScale.formatPrice(b.high), xc, yH - 2);
      ctx.textBaseline = 'top';
      ctx.fillText(rc.priceScale.formatPrice(b.low), xc, yL + 2);
    }
  }
  ctx.restore();
}
