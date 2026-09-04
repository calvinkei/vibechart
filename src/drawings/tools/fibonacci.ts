import { Drawing, P, type DrawingRenderContext, type HitTarget, type PropertyDef, type FibLevel, HIT_TOLERANCE } from '../Drawing';
import { applyLine, drawTextBox, fontFor } from './common';
import { formatPrice } from '../../util/format';
import { withAlpha } from '../../util/color';

export const DEFAULT_FIB_LEVELS: FibLevel[] = [
  { coeff: 0, color: '#787B86', visible: true },
  { coeff: 0.236, color: '#F23645', visible: true },
  { coeff: 0.382, color: '#FF9800', visible: true },
  { coeff: 0.5, color: '#4CAF50', visible: true },
  { coeff: 0.618, color: '#089981', visible: true },
  { coeff: 0.786, color: '#00BCD4', visible: true },
  { coeff: 1, color: '#787B86', visible: true },
  { coeff: 1.618, color: '#2962FF', visible: true },
  { coeff: 2.618, color: '#F23645', visible: true },
  { coeff: 3.618, color: '#9C27B0', visible: true },
  { coeff: 4.236, color: '#E91E63', visible: true },
  { coeff: 1.272, color: '#FF9800', visible: false },
  { coeff: 1.414, color: '#4CAF50', visible: false },
  { coeff: 2, color: '#089981', visible: false },
  { coeff: 2.272, color: '#00BCD4', visible: false },
  { coeff: 2.414, color: '#2962FF', visible: false },
  { coeff: 3, color: '#F23645', visible: false },
  { coeff: 3.272, color: '#9C27B0', visible: false },
  { coeff: 3.414, color: '#E91E63', visible: false },
  { coeff: 4, color: '#FF9800', visible: false },
  { coeff: 4.272, color: '#4CAF50', visible: false },
  { coeff: 4.414, color: '#089981', visible: false },
  { coeff: 4.618, color: '#00BCD4', visible: false },
  { coeff: 4.764, color: '#2962FF', visible: false },
];

export class FibRetracement extends Drawing {
  static override toolId = 'fib_retracement';
  static override toolName = 'Fib Retracement';
  static override pointsCount = 2;
  static override group = 'fib' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M3 5h22v1H3zM3 11h22v1H3zM3 16h22v1H3zM3 22h22v1H3z"/></svg>';
  defaultStyle() {
    return { levels: DEFAULT_FIB_LEVELS.map((l) => ({ ...l })), lineWidth: 1, lineStyle: 0, extendLeft: false, extendRight: false, showLevels: true, showPrices: true, labelsPosition: 'left', labelsAlign: 'middle', reverse: false, showTrendLine: true, trendLineColor: '#787B86', trendLineWidth: 1, trendLineStyle: 2, fillBackground: true, transparency: 80, fibLevelsBasedOnLogScale: false, showCoeffs: true };
  }
  propertyDefs(): PropertyDef[] {
    return [
      { key: 'levels', label: 'Levels', type: 'fibLevels', group: 'Style' },
      P.bool('showTrendLine', 'Trend line'), P.color('trendLineColor', 'Trend line color'), P.lineWidth('trendLineWidth', 'Trend line width'), P.lineStyle('trendLineStyle', 'Trend line style'),
      P.lineWidth('lineWidth', 'Levels line width'), P.lineStyle('lineStyle', 'Levels line style'),
      P.bool('extendLeft', 'Extend left'), P.bool('extendRight', 'Extend right'), P.bool('reverse', 'Reverse'),
      P.bool('showPrices', 'Prices'), P.bool('showLevels', 'Levels'), P.bool('showCoeffs', 'Show coefficients'),
      P.select('labelsPosition', 'Labels position', [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]),
      P.select('labelsAlign', 'Labels align', [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]),
      P.bool('fillBackground', 'Background'), P.int('transparency', 'Transparency', 0, 100), P.bool('fibLevelsBasedOnLogScale', 'Fib levels based on log scale'),
    ];
  }
  levelPrice(coeff: number): number {
    const p0 = this.points[0].price, p1 = (this.points[1] ?? this.points[0]).price;
    const c = this.style.reverse ? 1 - coeff : coeff;
    if (this.style.fibLevelsBasedOnLogScale && p0 > 0 && p1 > 0) {
      return Math.exp(Math.log(p1) + (Math.log(p0) - Math.log(p1)) * c);
    }
    // level 0 at point 2, level 1 at point 1 (TradingView convention)
    return p1 + (p0 - p1) * c;
  }
  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1]);
    const { ctx, width } = rc;
    const s = this.style;
    const x1 = s.extendLeft ? 0 : Math.min(a.x, b.x);
    const x2 = s.extendRight ? width : Math.max(a.x, b.x);
    const levels: FibLevel[] = (s.levels as FibLevel[]).filter((l) => l.visible);
    const ys = levels.map((l) => ({ l, y: rc.priceScale.priceToY(this.levelPrice(l.coeff)), price: this.levelPrice(l.coeff) })).sort((p, q) => p.y - q.y);
    if (s.fillBackground) {
      for (let i = 1; i < ys.length; i++) {
        ctx.fillStyle = withAlpha(ys[i].l.color, (100 - s.transparency) / 100);
        ctx.fillRect(x1, ys[i - 1].y, x2 - x1, ys[i].y - ys[i - 1].y);
      }
    }
    if (s.showTrendLine) {
      applyLine(ctx, s.trendLineColor, s.trendLineWidth, s.trendLineStyle);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const font = fontFor(rc, 11);
    for (const { l, y, price } of ys) {
      applyLine(ctx, l.color, s.lineWidth, s.lineStyle);
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      const parts: string[] = [];
      if (s.showLevels) parts.push(s.showCoeffs ? l.coeff.toFixed(3) : `${(l.coeff * 100).toFixed(1)}%`);
      if (s.showPrices) parts.push(`(${formatPrice(price, rc.priceFormat)})`);
      if (!parts.length) continue;
      const lx = s.labelsPosition === 'left' ? x1 - 4 : s.labelsPosition === 'right' ? x2 + 4 : (x1 + x2) / 2;
      const align = s.labelsPosition === 'left' ? 'right' : s.labelsPosition === 'right' ? 'left' : 'center';
      const vAlign = s.labelsAlign === 'top' ? 'bottom' : s.labelsAlign === 'bottom' ? 'top' : 'middle';
      drawTextBox(ctx, parts.join(' '), lx, y, { font, color: l.color, align, vAlign, padding: 2 });
    }
  }
  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const pts = this.points.map((p) => rc.toPixel(p));
    for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - x, pts[i].y - y) <= 7) return { type: 'point', index: i };
    const s = this.style;
    const x1 = s.extendLeft ? 0 : Math.min(pts[0].x, pts[1].x);
    const x2 = s.extendRight ? rc.width : Math.max(pts[0].x, pts[1].x);
    if (x < x1 - HIT_TOLERANCE || x > x2 + HIT_TOLERANCE) return null;
    for (const l of s.levels as FibLevel[]) {
      if (!l.visible) continue;
      if (Math.abs(rc.priceScale.priceToY(this.levelPrice(l.coeff)) - y) <= HIT_TOLERANCE) return { type: 'body' };
    }
    return null;
  }
}

export const fibTools = [FibRetracement];
