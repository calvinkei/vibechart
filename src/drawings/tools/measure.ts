import { Drawing, P, type DrawingRenderContext, type HitTarget, type PropertyDef, HIT_TOLERANCE } from '../Drawing';
import { applyLine, drawArrowHead } from './common';
import { formatPercent, formatVolume, formatDuration, formatChange } from '../../util/format';
import { withAlpha } from '../../util/color';
import { clamp, pointInRect } from '../../util/math';
import { rangeStats, drawStatLabel } from './prediction';

/**
 * J.1 Measure — a Date-and-price-range style box between two points with a stats label
 * (price change Δ/%, bars, elapsed time, volume). Green when p2.price >= p1.price, red otherwise.
 */
export class Measure extends Drawing {
  static override toolId = 'measure';
  static override toolName = 'Measure';
  static override pointsCount = 2;
  static override group = 'measure' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4.3 19.5L19.5 4.3l4.2 4.2L8.5 23.7zm1.4 0l2.8 2.8L22.3 8.5l-2.8-2.8zM9 17l2 2 .7-.7-2-2zM12 14l2 2 .7-.7-2-2zM15 11l2 2 .7-.7-2-2z"/></svg>';

  defaultStyle(): Record<string, any> {
    return {
      upColor: '#089981', downColor: '#F23645', backgroundTransparency: 80, lineWidth: 1,
      labelTextColor: '#FFFFFF', fontSize: 12,
      showPriceRange: true, showBarsRange: true, showDateTimeRange: true, showVolume: true,
    };
  }

  propertyDefs(): PropertyDef[] {
    return [
      P.color('upColor', 'Up color'), P.color('downColor', 'Down color'), P.int('backgroundTransparency', 'Background transparency', 0, 100), P.lineWidth('lineWidth'),
      P.color('labelTextColor', 'Label text'), P.fontSize('fontSize', 'Font size', 'Style'),
      P.section('Stats'), P.bool('showPriceRange', 'Price range'), P.bool('showBarsRange', 'Bars range'), P.bool('showDateTimeRange', 'Date/time range'), P.bool('showVolume', 'Volume'),
    ];
  }

  /** true when the end price is at or above the start price */
  isUp(): boolean {
    return this.points.length < 2 || this.points[1].price >= this.points[0].price;
  }

  private _rect(rc: DrawingRenderContext) {
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    return { a, b, x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
  }

  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    const { ctx } = rc;
    const s = this.style;
    const r = this._rect(rc);
    const color = this.isUp() ? s.upColor : s.downColor;
    const w = r.x2 - r.x1, h = r.y2 - r.y1;
    ctx.fillStyle = withAlpha(color, clamp((100 - (Number(s.backgroundTransparency) || 0)) / 100, 0, 1));
    ctx.fillRect(r.x1, r.y1, w, h);
    applyLine(ctx, color, s.lineWidth, 0);
    ctx.strokeRect(r.x1 + 0.5, r.y1 + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    const cx = (r.x1 + r.x2) / 2, cy = (r.y1 + r.y2) / 2;
    const head = 6 + s.lineWidth * 2;
    if (h > 1) {
      ctx.beginPath(); ctx.moveTo(cx, r.a.y); ctx.lineTo(cx, r.b.y); ctx.stroke();
      drawArrowHead(ctx, { x: cx, y: r.a.y }, { x: cx, y: r.b.y }, head);
    }
    if (w > 1) {
      ctx.beginPath(); ctx.moveTo(r.a.x, cy); ctx.lineTo(r.b.x, cy); ctx.stroke();
      drawArrowHead(ctx, { x: r.a.x, y: cy }, { x: r.b.x, y: cy }, head);
    }
    if (this.points.length < 2) return;
    const st = rangeStats(rc, this.points[0], this.points[1]);
    const lines: string[] = [];
    if (s.showPriceRange) lines.push(`${formatChange(st.dp, rc.priceFormat)} (${formatPercent(st.pct)})`);
    const parts: string[] = [];
    if (s.showBarsRange) parts.push(`${st.bars} bars`);
    if (s.showDateTimeRange) parts.push(formatDuration(st.seconds));
    if (parts.length) lines.push(parts.join(', '));
    if (s.showVolume) lines.push(`Vol ${formatVolume(st.volume)}`);
    if (!lines.length) return;
    const up = this.isUp();
    drawStatLabel(rc, lines, cx, up ? r.y1 - 4 : r.y2 + 4, { bg: color, color: s.labelTextColor, fontSize: s.fontSize, vAlign: up ? 'bottom' : 'top' });
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    for (const h of this.handles(rc)) if (Math.hypot(h.x - x, h.y - y) <= 7) return { type: 'point', index: h.index };
    const r = this._rect(rc);
    if (pointInRect(x, y, r.x1 - HIT_TOLERANCE, r.y1 - HIT_TOLERANCE, r.x2 + HIT_TOLERANCE, r.y2 + HIT_TOLERANCE)) return { type: 'body' };
    return null;
  }
}

export const measureTools = [Measure];
