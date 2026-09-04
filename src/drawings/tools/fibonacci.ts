import { Drawing, P, type DrawingRenderContext, type HitTarget, type PropertyDef, type FibLevel, type PixelPoint, HIT_TOLERANCE } from '../Drawing';
import { applyLine, drawTextBox, fontFor, lineDistance } from './common';
import { formatPrice } from '../../util/format';
import { withAlpha } from '../../util/color';
import { clipLineToRect, distToRay, distToSegment, pointInRect } from '../../util/math';
import { crisp } from '../../render/canvas';

// ---------------------------------------------------------------------------
// Shared constants / helpers
// ---------------------------------------------------------------------------

/** TradingView web-UI grey used for the 0 / 1 levels and the base trend lines. */
const GREY = '#787B86';
const PHI = (1 + Math.sqrt(5)) / 2;
/** Radii (px) are clamped to this so a degenerate drag never produces gigantic arcs. */
const MAX_RADIUS = 1e5;
const POINT_HIT = 7;

function lv(coeff: number, color: string, visible = true): FibLevel {
  return { coeff, color, visible };
}

export function cloneLevels(levels: FibLevel[]): FibLevel[] {
  return levels.map((l) => ({ ...l }));
}

/** 24-slot table shared by Fib Retracement / Trend-Based Fib Extension / Fib Channel (spec §C.0). */
export const DEFAULT_FIB_LEVELS: FibLevel[] = [
  lv(0, GREY), lv(0.236, '#F23645'), lv(0.382, '#FF9800'), lv(0.5, '#4CAF50'), lv(0.618, '#089981'), lv(0.786, '#00BCD4'),
  lv(1, GREY), lv(1.618, '#2962FF'), lv(2.618, '#F23645'), lv(3.618, '#9C27B0'), lv(4.236, '#E91E63'),
  lv(1.272, '#FF9800', false), lv(1.414, '#F23645', false), lv(2.272, '#FF9800', false), lv(2.414, '#4CAF50', false),
  lv(2, '#089981', false), lv(3, '#00BCD4', false), lv(3.272, GREY, false), lv(3.414, '#2962FF', false), lv(4, '#F23645', false),
  lv(4.272, '#9C27B0', false), lv(4.414, '#E91E63', false), lv(4.618, '#FF9800', false), lv(4.764, '#089981', false),
];

/** Fib Time Zone: Fibonacci numbers (spec §C.4 lists 11 visible; 144…987 are provided hidden). */
export const DEFAULT_FIB_TIME_ZONE_LEVELS: FibLevel[] = [
  lv(0, GREY), lv(1, '#2962FF'), lv(2, '#2962FF'), lv(3, '#2962FF'), lv(5, '#2962FF'), lv(8, '#2962FF'), lv(13, '#2962FF'),
  lv(21, '#2962FF'), lv(34, '#2962FF'), lv(55, '#2962FF'), lv(89, '#2962FF'),
  lv(144, '#2962FF', false), lv(233, '#2962FF', false), lv(377, '#2962FF', false), lv(610, '#2962FF', false), lv(987, '#2962FF', false),
];

/** Trend-Based Fib Time (spec §C.6). */
export const DEFAULT_FIB_TREND_TIME_LEVELS: FibLevel[] = [
  lv(0, GREY), lv(0.382, '#F23645'), lv(0.5, '#81C784', false), lv(0.618, '#4CAF50'), lv(1, '#089981'), lv(1.382, '#00BCD4'),
  lv(1.618, GREY), lv(2, '#2962FF'), lv(2.382, '#E91E63'), lv(2.618, '#9C27B0'), lv(3, '#673AB7'),
];

/** Fib Speed Resistance Fan price/time levels (spec §C.5). */
export const DEFAULT_FIB_FAN_LEVELS: FibLevel[] = [
  lv(0, GREY), lv(0.25, '#FF9800'), lv(0.382, '#00BCD4'), lv(0.5, '#4CAF50'), lv(0.618, '#089981'), lv(0.75, '#2962FF'), lv(1, GREY),
];

/** Fib Circles (spec §C.7). */
export const DEFAULT_FIB_CIRCLE_LEVELS: FibLevel[] = [
  lv(0.236, '#F23645'), lv(0.382, '#FF9800'), lv(0.5, '#089981'), lv(0.618, '#4CAF50'), lv(0.786, '#00BCD4'), lv(1, GREY),
  lv(1.618, '#2962FF'), lv(2.618, '#E91E63'), lv(3.618, '#2962FF'), lv(4.236, '#E91E63'), lv(4.618, '#F23645'),
];

/** Fib Speed Resistance Arcs (spec §C.9). */
export const DEFAULT_FIB_ARC_LEVELS: FibLevel[] = [
  lv(0.236, '#F23645'), lv(0.382, '#FF9800'), lv(0.5, '#089981'), lv(0.618, '#F23645'), lv(0.786, '#00BCD4'), lv(1, GREY),
  lv(1.618, '#2962FF'), lv(2.618, '#E91E63'), lv(3.618, '#2962FF'), lv(4.236, '#E91E63'), lv(4.618, '#F23645'),
];

/** Fib Wedge (spec §C.10). */
export const DEFAULT_FIB_WEDGE_LEVELS: FibLevel[] = [
  lv(0.236, '#F23645'), lv(0.382, '#FF9800'), lv(0.5, '#4CAF50'), lv(0.618, '#089981'), lv(0.786, '#00BCD4'), lv(1, GREY),
  lv(1.618, '#2962FF', false), lv(2.618, '#F23645', false), lv(3.618, '#673AB7', false), lv(4.236, '#E91E63', false), lv(4.618, '#E91E63', false),
];

function trimNum(v: number, decimals: number): string {
  const s = v.toFixed(decimals);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Level label text like TradingView: `0.618` (values) or `61.8%` (percents). */
export function formatCoeff(coeff: number, asPercents = false): string {
  if (!Number.isFinite(coeff)) return '';
  return asPercents ? `${trimNum(coeff * 100, 1)}%` : trimNum(coeff, 3);
}

function visibleLevels(levels: unknown): FibLevel[] {
  if (!Array.isArray(levels)) return [];
  return (levels as FibLevel[]).filter((l) => !!l && l.visible !== false && Number.isFinite(l.coeff));
}

function sortedByCoeff(levels: FibLevel[]): FibLevel[] {
  return levels.slice().sort((a, b) => a.coeff - b.coeff);
}

function alphaFor(transparency: unknown): number {
  const t = Number(transparency);
  return Math.max(0, Math.min(1, (100 - (Number.isFinite(t) ? t : 80)) / 100));
}

function clampRadius(r: number): number {
  return Number.isFinite(r) ? Math.min(MAX_RADIUS, Math.max(0.5, Math.abs(r))) : 0.5;
}

function finite(p: PixelPoint): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function normAngle(a: number): number {
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

function strokeSegment(ctx: CanvasRenderingContext2D, a: PixelPoint, b: PixelPoint, color: string, width: number, style: number): void {
  applyLine(ctx, color, width, style);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Plain level label (TV: small text in the level colour). */
function drawLevelLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, font: string, align: 'left' | 'center' | 'right', vAlign: 'top' | 'middle' | 'bottom'): void {
  if (!text) return;
  ctx.setLineDash([]);
  drawTextBox(ctx, text, x, y, { font, color, align, vAlign, padding: 2 });
}

function nearPoint(pts: PixelPoint[], x: number, y: number): HitTarget {
  for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - x, pts[i].y - y) <= POINT_HIT) return { type: 'point', index: i };
  return null;
}

const LABEL_POS_OPTIONS = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }];
const LABEL_VALIGN_OPTIONS = [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }];

function levelsTableDef(): PropertyDef {
  return { key: 'levels', label: 'Levels', type: 'fibLevels', group: 'Style' };
}
function trendLineDefs(): PropertyDef[] {
  return [P.bool('showTrendLine', 'Trend line'), P.color('trendLineColor', 'Trend line color'), P.lineWidth('trendLineWidth', 'Trend line width'), P.lineStyle('trendLineStyle', 'Trend line style')];
}
function backgroundDefs(): PropertyDef[] {
  return [P.bool('fillBackground', 'Background'), P.int('transparency', 'Transparency', 0, 100)];
}
function labelDefs(withPrices: boolean): PropertyDef[] {
  const defs = [P.bool('showLevels', 'Levels', 'Text'), P.bool('coeffsAsPercents', 'Levels as percents', 'Text')];
  if (withPrices) defs.push(P.bool('showPrices', 'Prices', 'Text'));
  defs.push(P.fontSize('labelFontSize', 'Font size', 'Text'));
  return defs;
}

/** Horizontal level label placement (spec: horzLabelsAlign / vertLabelsAlign). */
function labelAnchor(position: string, x1: number, x2: number, extendLeft: boolean, extendRight: boolean): [number, 'left' | 'center' | 'right'] {
  if (position === 'right') return extendRight ? [x2 - 4, 'right'] : [x2 + 4, 'left'];
  if (position === 'center') return [(x1 + x2) / 2, 'center'];
  return extendLeft ? [x1 + 4, 'left'] : [x1 - 4, 'right'];
}
function labelVAlign(align: string): 'top' | 'middle' | 'bottom' {
  return align === 'top' ? 'bottom' : align === 'bottom' ? 'top' : 'middle';
}

// ---------------------------------------------------------------------------
// Horizontal price-level family: Fib Retracement, Trend-Based Fib Extension
// ---------------------------------------------------------------------------

interface LevelRow { l: FibLevel; price: number; y: number }

abstract class FibPriceLevels extends Drawing {
  static override group = 'fib' as const;

  /** Price of a level coefficient. */
  abstract levelPrice(coeff: number): number;

  defaultStyle(): Record<string, any> {
    return {
      levels: cloneLevels(DEFAULT_FIB_LEVELS), lineWidth: 2, lineStyle: 0, extendLeft: false, extendRight: false,
      showLevels: true, showPrices: true, coeffsAsPercents: false, labelsPosition: 'left', labelsAlign: 'middle', labelFontSize: 11,
      reverse: false, showTrendLine: true, trendLineColor: GREY, trendLineWidth: 2, trendLineStyle: 2,
      fillBackground: true, transparency: 80, fibLevelsBasedOnLogScale: false,
    };
  }

  propertyDefs(): PropertyDef[] {
    return [
      levelsTableDef(), P.lineWidth('lineWidth', 'Levels line width'), P.lineStyle('lineStyle', 'Levels line style'),
      ...trendLineDefs(),
      P.bool('extendLeft', 'Extend lines left'), P.bool('extendRight', 'Extend lines right'), P.bool('reverse', 'Reverse'),
      ...backgroundDefs(), P.bool('fibLevelsBasedOnLogScale', 'Fib levels based on log scale'),
      ...labelDefs(true),
      P.select('labelsPosition', 'Labels position', LABEL_POS_OPTIONS, 'Text'),
      P.select('labelsAlign', 'Labels align', LABEL_VALIGN_OPTIONS, 'Text'),
    ];
  }

  /** Visible levels with their prices and pixel y. */
  levelRows(rc: DrawingRenderContext): LevelRow[] {
    const rows: LevelRow[] = [];
    for (const l of visibleLevels(this.style.levels)) {
      const price = this.levelPrice(l.coeff);
      if (!Number.isFinite(price)) continue;
      const y = rc.priceScale.priceToY(price);
      if (!Number.isFinite(y)) continue;
      rows.push({ l, price, y });
    }
    return rows;
  }

  protected xRange(rc: DrawingRenderContext, px: PixelPoint[]): [number, number] {
    const xs = px.map((p) => p.x).filter((x) => Number.isFinite(x));
    const x1 = this.style.extendLeft ? 0 : Math.min(...xs);
    const x2 = this.style.extendRight ? rc.width : Math.max(...xs);
    return [x1, x2];
  }

  levelText(row: LevelRow, rc: DrawingRenderContext): string {
    const s = this.style;
    const parts: string[] = [];
    if (s.showLevels) parts.push(formatCoeff(row.l.coeff, !!s.coeffsAsPercents));
    if (s.showPrices) parts.push(`(${formatPrice(row.price, rc.priceFormat)})`);
    return parts.join(' ');
  }

  render(rc: DrawingRenderContext): void {
    const n = this.points.length;
    if (!n) return;
    const px = this.points.map((p) => rc.toPixel(p));
    const { ctx } = rc;
    const s = this.style;
    if (s.showTrendLine) for (let i = 1; i < px.length; i++) strokeSegment(ctx, px[i - 1], px[i], s.trendLineColor, s.trendLineWidth, s.trendLineStyle);
    if (n < this.requiredPoints) return;
    const [x1, x2] = this.xRange(rc, px);
    if (!Number.isFinite(x1) || !Number.isFinite(x2)) return;
    const rows = this.levelRows(rc);
    if (s.fillBackground && rows.length > 1) {
      const alpha = alphaFor(s.transparency);
      const sorted = rows.slice().sort((a, b) => a.l.coeff - b.l.coeff);
      for (let i = 1; i < sorted.length; i++) {
        ctx.fillStyle = withAlpha(sorted[i].l.color, alpha);
        const y0 = sorted[i - 1].y, y1 = sorted[i].y;
        ctx.fillRect(x1, Math.min(y0, y1), x2 - x1, Math.abs(y1 - y0));
      }
    }
    const font = fontFor(rc, s.labelFontSize || 11);
    const [lx, align] = labelAnchor(s.labelsPosition, x1, x2, !!s.extendLeft, !!s.extendRight);
    const vAlign = labelVAlign(s.labelsAlign);
    for (const row of rows) {
      applyLine(ctx, row.l.color, s.lineWidth, s.lineStyle);
      const y = crisp(row.y, rc.dpr, s.lineWidth);
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      drawLevelLabel(ctx, this.levelText(row, rc), lx, row.y, row.l.color, font, align, vAlign);
    }
    ctx.setLineDash([]);
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < this.requiredPoints) return null;
    const px = this.points.map((p) => rc.toPixel(p));
    const hp = nearPoint(px, x, y);
    if (hp) return hp;
    const s = this.style;
    const [x1, x2] = this.xRange(rc, px);
    const rows = this.levelRows(rc);
    if (x >= x1 - HIT_TOLERANCE && x <= x2 + HIT_TOLERANCE && rows.length) {
      for (const row of rows) if (Math.abs(row.y - y) <= HIT_TOLERANCE) return { type: 'body' };
      if (rows.length > 1) {
        const ys = rows.map((r) => r.y);
        if (y >= Math.min(...ys) && y <= Math.max(...ys)) return { type: 'body', part: 'inside' };
      }
    }
    if (s.showTrendLine) for (let i = 1; i < px.length; i++) if (distToSegment(x, y, px[i - 1].x, px[i - 1].y, px[i].x, px[i].y) <= HIT_TOLERANCE) return { type: 'body' };
    return null;
  }
}

export class FibRetracement extends FibPriceLevels {
  static override toolId = 'fib_retracement';
  static override toolName = 'Fib Retracement';
  static override pointsCount = 2;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M3 5h22v1H3zM3 11h22v1H3zM3 16h22v1H3zM3 22h22v1H3z"/></svg>';
  levelPrice(coeff: number): number {
    if (!this.points.length) return NaN;
    const p0 = this.points[0].price, p1 = (this.points[1] ?? this.points[0]).price;
    const c = this.style.reverse ? 1 - coeff : coeff;
    if (this.style.fibLevelsBasedOnLogScale && p0 > 0 && p1 > 0) {
      return Math.exp(Math.log(p1) + (Math.log(p0) - Math.log(p1)) * c);
    }
    // level 0 at point 2, level 1 at point 1 (TradingView convention)
    return p1 + (p0 - p1) * c;
  }
}

export class FibExtension extends FibPriceLevels {
  static override toolId = 'fib_extension';
  static override toolName = 'Trend-Based Fib Extension';
  static override pointsCount = 3;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M3 6h9v1H3zM3 11h9v1H3zM16 6h9v1h-9zM16 11h9v1h-9zM16 16h9v1h-9zM16 21h9v1h-9z"/><path fill="currentColor" d="M4.35 22.35l6-6-.7-.7-6 6zM10.35 16.35l4 4-.7.7-4-4z"/></svg>';
  /** Levels are projected from p3 using the p1 → p2 swing: level 0 at p3, level 1 at p3 + (p2 − p1). */
  levelPrice(coeff: number): number {
    const [p1, p2, p3] = this.points;
    if (!p1) return NaN;
    const a = p1.price, b = (p2 ?? p1).price, base = (p3 ?? p2 ?? p1).price;
    const c = this.style.reverse ? -coeff : coeff;
    if (this.style.fibLevelsBasedOnLogScale && a > 0 && b > 0 && base > 0) {
      return Math.exp(Math.log(base) + (Math.log(b) - Math.log(a)) * c);
    }
    return base + (b - a) * c;
  }
}

// ---------------------------------------------------------------------------
// Fib Channel
// ---------------------------------------------------------------------------

export class FibChannel extends Drawing {
  static override toolId = 'fib_channel';
  static override toolName = 'Fib Channel';
  static override pointsCount = 3;
  static override group = 'fib' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M3.35 13.35l10-10-.7-.7-10 10zM3.35 19.35l16-16-.7-.7-16 16zM3.35 25.35l22-22-.7-.7-22 22zM9.35 25.35l16-16-.7-.7-16 16zM15.35 25.35l10-10-.7-.7-10 10z"/></svg>';

  defaultStyle(): Record<string, any> {
    return {
      levels: cloneLevels(DEFAULT_FIB_LEVELS), lineWidth: 2, lineStyle: 0, extendLeft: false, extendRight: false,
      showLevels: true, showPrices: true, coeffsAsPercents: false, labelsPosition: 'left', labelsAlign: 'middle', labelFontSize: 11,
      fillBackground: true, transparency: 80,
    };
  }
  propertyDefs(): PropertyDef[] {
    return [
      levelsTableDef(), P.lineWidth('lineWidth', 'Levels line width'), P.lineStyle('lineStyle', 'Levels line style'),
      P.bool('extendLeft', 'Extend left'), P.bool('extendRight', 'Extend right'),
      ...backgroundDefs(), ...labelDefs(true),
      P.select('labelsPosition', 'Labels position', LABEL_POS_OPTIONS, 'Text'),
      P.select('labelsAlign', 'Labels align', LABEL_VALIGN_OPTIONS, 'Text'),
    ];
  }

  /** Base line (p1→p2) in pixels plus the vertical pixel offset defined by p3. */
  geometry(rc: DrawingRenderContext): { a: PixelPoint; b: PixelPoint; slope: number; offsetY: number } | null {
    if (this.points.length < 2) return null;
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1]);
    if (!finite(a) || !finite(b)) return null;
    const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x);
    let offsetY = 0;
    if (this.points[2]) {
      const c = rc.toPixel(this.points[2]);
      if (finite(c)) offsetY = c.y - (a.y + slope * (c.x - a.x));
    }
    return { a, b, slope, offsetY };
  }

  /** Pixel endpoints (at p1.x / p2.x) of the line for a level coefficient. */
  levelLine(coeff: number, rc: DrawingRenderContext): [PixelPoint, PixelPoint] | null {
    const g = this.geometry(rc);
    if (!g) return null;
    const dy = coeff * g.offsetY;
    return [{ x: g.a.x, y: g.a.y + dy }, { x: g.b.x, y: g.b.y + dy }];
  }

  private _clipped(rc: DrawingRenderContext, p: PixelPoint, q: PixelPoint): [PixelPoint, PixelPoint] | null {
    const s = this.style;
    if (!s.extendLeft && !s.extendRight) return [p, q];
    const pad = 2000;
    const seg = clipLineToRect(p.x, p.y, q.x, q.y, -pad, -pad, rc.width + pad, rc.height + pad, !!s.extendLeft, !!s.extendRight);
    return seg ? [{ x: seg[0], y: seg[1] }, { x: seg[2], y: seg[3] }] : null;
  }

  render(rc: DrawingRenderContext): void {
    const g = this.geometry(rc);
    if (!g) return;
    const { ctx } = rc;
    const s = this.style;
    if (this.points.length < 3) {
      strokeSegment(ctx, g.a, g.b, GREY, s.lineWidth, 2);
      return;
    }
    const levels = sortedByCoeff(visibleLevels(s.levels));
    const lines = levels.map((l) => ({ l, seg: this.levelLine(l.coeff, rc)! }));
    if (s.fillBackground) {
      const alpha = alphaFor(s.transparency);
      for (let i = 1; i < lines.length; i++) {
        const l1 = this._clipped(rc, lines[i - 1].seg[0], lines[i - 1].seg[1]);
        const l2 = this._clipped(rc, lines[i].seg[0], lines[i].seg[1]);
        if (!l1 || !l2) continue;
        ctx.fillStyle = withAlpha(lines[i].l.color, alpha);
        ctx.beginPath();
        ctx.moveTo(l1[0].x, l1[0].y); ctx.lineTo(l1[1].x, l1[1].y); ctx.lineTo(l2[1].x, l2[1].y); ctx.lineTo(l2[0].x, l2[0].y);
        ctx.closePath(); ctx.fill();
      }
    }
    const font = fontFor(rc, s.labelFontSize || 11);
    const left = Math.min(g.a.x, g.b.x), right = Math.max(g.a.x, g.b.x);
    const [lx, align] = labelAnchor(s.labelsPosition, left, right, !!s.extendLeft, !!s.extendRight);
    const vAlign = labelVAlign(s.labelsAlign);
    for (const { l, seg } of lines) {
      const clipped = this._clipped(rc, seg[0], seg[1]);
      if (!clipped) continue;
      strokeSegment(ctx, clipped[0], clipped[1], l.color, s.lineWidth, s.lineStyle);
      if (!s.showLevels && !s.showPrices) continue;
      const ly = seg[0].y + g.slope * (lx - seg[0].x);
      const parts: string[] = [];
      if (s.showLevels) parts.push(formatCoeff(l.coeff, !!s.coeffsAsPercents));
      if (s.showPrices) parts.push(`(${formatPrice(rc.priceScale.yToPrice(ly), rc.priceFormat)})`);
      drawLevelLabel(ctx, parts.join(' '), lx, ly, l.color, font, align, vAlign);
    }
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 3) return null;
    const px = this.points.map((p) => rc.toPixel(p));
    const hp = nearPoint(px, x, y);
    if (hp) return hp;
    const g = this.geometry(rc);
    if (!g) return null;
    const s = this.style;
    const levels = visibleLevels(s.levels);
    for (const l of levels) {
      const seg = this.levelLine(l.coeff, rc);
      if (seg && lineDistance(x, y, seg[0], seg[1], !!s.extendLeft, !!s.extendRight) <= HIT_TOLERANCE) return { type: 'body' };
    }
    if (levels.length > 1) {
      const left = s.extendLeft ? -Infinity : Math.min(g.a.x, g.b.x);
      const right = s.extendRight ? Infinity : Math.max(g.a.x, g.b.x);
      if (x >= left && x <= right) {
        const ys = levels.map((l) => g.a.y + g.slope * (x - g.a.x) + l.coeff * g.offsetY);
        if (y >= Math.min(...ys) && y <= Math.max(...ys)) return { type: 'body', part: 'inside' };
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Vertical (time) level family: Fib Time Zone, Trend-Based Fib Time
// ---------------------------------------------------------------------------

interface TimeLine { l: FibLevel; index: number; x: number }

abstract class FibTimeLevels extends Drawing {
  static override group = 'fib' as const;

  /** Bar index of each visible level (index space => equally spaced like TradingView). */
  abstract lineIndices(rc: DrawingRenderContext): Array<{ l: FibLevel; index: number }>;

  protected timeStyle(levels: FibLevel[], trendWidth: number): Record<string, any> {
    return {
      levels: cloneLevels(levels), lineWidth: 2, lineStyle: 0,
      showTrendLine: true, trendLineColor: GREY, trendLineWidth: trendWidth, trendLineStyle: 2,
      showLevels: true, coeffsAsPercents: false, labelsPosition: 'right', labelsAlign: 'bottom', labelFontSize: 11,
      fillBackground: false, transparency: 80,
    };
  }

  propertyDefs(): PropertyDef[] {
    return [
      levelsTableDef(), P.lineWidth('lineWidth', 'Levels line width'), P.lineStyle('lineStyle', 'Levels line style'),
      ...trendLineDefs(), ...backgroundDefs(), ...labelDefs(false),
      P.select('labelsPosition', 'Labels position', [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }], 'Text'),
      P.select('labelsAlign', 'Labels align', LABEL_VALIGN_OPTIONS, 'Text'),
    ];
  }

  lines(rc: DrawingRenderContext): TimeLine[] {
    const out: TimeLine[] = [];
    for (const { l, index } of this.lineIndices(rc)) {
      if (!Number.isFinite(index)) continue;
      const x = rc.timeScale.barCenterX(index);
      if (Number.isFinite(x)) out.push({ l, index, x });
    }
    return out.sort((p, q) => p.x - q.x);
  }

  render(rc: DrawingRenderContext): void {
    const n = this.points.length;
    if (!n) return;
    const px = this.points.map((p) => rc.toPixel(p));
    const { ctx, width, height } = rc;
    const s = this.style;
    if (s.showTrendLine) for (let i = 1; i < px.length; i++) if (finite(px[i - 1]) && finite(px[i])) strokeSegment(ctx, px[i - 1], px[i], s.trendLineColor, s.trendLineWidth, s.trendLineStyle);
    if (n < this.requiredPoints) return;
    const lines = this.lines(rc);
    if (s.fillBackground) {
      const alpha = alphaFor(s.transparency);
      for (let i = 1; i < lines.length; i++) {
        const x0 = lines[i - 1].x, x1 = lines[i].x;
        if (x1 < -1 || x0 > width + 1) continue;
        ctx.fillStyle = withAlpha(lines[i].l.color, alpha);
        ctx.fillRect(x0, 0, x1 - x0, height);
      }
    }
    const font = fontFor(rc, s.labelFontSize || 11);
    const ly = s.labelsAlign === 'top' ? 3 : s.labelsAlign === 'middle' ? height / 2 : height - 3;
    const vAlign: 'top' | 'middle' | 'bottom' = s.labelsAlign === 'top' ? 'top' : s.labelsAlign === 'middle' ? 'middle' : 'bottom';
    for (const line of lines) {
      if (line.x < -20 || line.x > width + 20) continue;
      applyLine(ctx, line.l.color, s.lineWidth, s.lineStyle);
      const x = crisp(line.x, rc.dpr, s.lineWidth);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      if (s.showLevels) {
        const left = s.labelsPosition === 'left';
        drawLevelLabel(ctx, formatCoeff(line.l.coeff, !!s.coeffsAsPercents), left ? line.x - 3 : line.x + 3, ly, line.l.color, font, left ? 'right' : 'left', vAlign);
      }
    }
    ctx.setLineDash([]);
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < this.requiredPoints) return null;
    const px = this.points.map((p) => rc.toPixel(p));
    const hp = nearPoint(px, x, y);
    if (hp) return hp;
    for (const line of this.lines(rc)) if (Math.abs(line.x - x) <= HIT_TOLERANCE) return { type: 'body' };
    if (this.style.showTrendLine) for (let i = 1; i < px.length; i++) if (distToSegment(x, y, px[i - 1].x, px[i - 1].y, px[i].x, px[i].y) <= HIT_TOLERANCE) return { type: 'body' };
    return null;
  }
}

export class FibTimeZone extends FibTimeLevels {
  static override toolId = 'fib_timezone';
  static override toolName = 'Fib Time Zone';
  static override pointsCount = 2;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4 3h1v22H4zM7 3h1v22H7zM11 3h1v22h-1zM16 3h1v22h-1zM23 3h1v22h-1z"/></svg>';
  defaultStyle(): Record<string, any> { return this.timeStyle(DEFAULT_FIB_TIME_ZONE_LEVELS, 1); }
  /** Bar distance between the two points (fractional while dragging). */
  unit(rc: DrawingRenderContext): number {
    if (this.points.length < 2) return 0;
    const ts = rc.timeScale;
    return ts.timeToIndex(this.points[1].time) - ts.timeToIndex(this.points[0].time);
  }
  lineIndices(rc: DrawingRenderContext): Array<{ l: FibLevel; index: number }> {
    if (!this.points.length) return [];
    const i1 = rc.timeScale.timeToIndex(this.points[0].time);
    const unit = this.unit(rc);
    return visibleLevels(this.style.levels).map((l) => ({ l, index: i1 + l.coeff * unit }));
  }
}

export class FibTrendTime extends FibTimeLevels {
  static override toolId = 'fib_trend_time';
  static override toolName = 'Trend-Based Fib Time';
  static override pointsCount = 3;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M13 3h1v22h-1zM17 3h1v22h-1zM20 3h1v22h-1zM24 3h1v22h-1z"/><path fill="currentColor" d="M3.35 19.35l4-8 .9.45-4 8zM7.35 11.4l3.9 7.8.9-.45-3.9-7.8z"/></svg>';
  defaultStyle(): Record<string, any> { return { ...this.timeStyle(DEFAULT_FIB_TREND_TIME_LEVELS, 2), fillBackground: true }; }
  lineIndices(rc: DrawingRenderContext): Array<{ l: FibLevel; index: number }> {
    const [p1, p2, p3] = this.points;
    if (!p1) return [];
    const ts = rc.timeScale;
    const i1 = ts.timeToIndex(p1.time), i2 = ts.timeToIndex((p2 ?? p1).time), i3 = ts.timeToIndex((p3 ?? p2 ?? p1).time);
    const T = i2 - i1;
    return visibleLevels(this.style.levels).map((l) => ({ l, index: i3 + l.coeff * T }));
  }
}

// ---------------------------------------------------------------------------
// Fib Speed Resistance Fan
// ---------------------------------------------------------------------------

interface FanRay { color: string; target: PixelPoint; angle: number; rel: number }

export class FibSpeedResistFan extends Drawing {
  static override toolId = 'fib_speed_resist_fan';
  static override toolName = 'Fib Speed Resistance Fan';
  static override pointsCount = 2;
  static override group = 'fib' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4 4h1v20H4zM4 23h20v1H4zM4 14h20v1H4zM14 4h1v20h-1z"/><path fill="currentColor" d="M4.35 23.35l19-19-.7-.7-19 19zM4.45 23.9l19-9.5-.45-.9-19 9.5zM4.9 23.45l9.5-19-.9-.45-9.5 19z"/></svg>';

  defaultStyle(): Record<string, any> {
    return {
      hlevels: cloneLevels(DEFAULT_FIB_FAN_LEVELS), vlevels: cloneLevels(DEFAULT_FIB_FAN_LEVELS),
      lineWidth: 2, lineStyle: 0, showGrid: true, gridColor: 'rgba(21, 56, 153, 0.8)', gridWidth: 1, gridStyle: 0,
      fillBackground: true, transparency: 80, reverse: false,
      showTopLabels: true, showBottomLabels: true, showLeftLabels: true, showRightLabels: true, labelFontSize: 11,
    };
  }
  propertyDefs(): PropertyDef[] {
    return [
      { key: 'hlevels', label: 'Price levels', type: 'fibLevels', group: 'Style' },
      { key: 'vlevels', label: 'Time levels', type: 'fibLevels', group: 'Style' },
      P.lineWidth('lineWidth'), P.lineStyle('lineStyle'),
      P.bool('showGrid', 'Grid'), P.color('gridColor', 'Grid color'), P.lineWidth('gridWidth', 'Grid width'), P.lineStyle('gridStyle', 'Grid style'),
      ...backgroundDefs(), P.bool('reverse', 'Reverse'),
      P.bool('showLeftLabels', 'Left labels', 'Text'), P.bool('showRightLabels', 'Right labels', 'Text'), P.bool('showTopLabels', 'Top labels', 'Text'), P.bool('showBottomLabels', 'Bottom labels', 'Text'),
      P.fontSize('labelFontSize', 'Font size', 'Text'),
    ];
  }

  /** Origin (fan apex) and far corner of the box; `reverse` swaps them. */
  box(rc: DrawingRenderContext): { o: PixelPoint; e: PixelPoint } | null {
    if (this.points.length < 2) return null;
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1]);
    if (!finite(a) || !finite(b)) return null;
    return this.style.reverse ? { o: b, e: a } : { o: a, e: b };
  }

  /** Fan rays from the origin through the far-edge level points, sorted by angle. */
  rays(rc: DrawingRenderContext): FanRay[] {
    const bx = this.box(rc);
    if (!bx) return [];
    const { o, e } = bx;
    const w = e.x - o.x, h = e.y - o.y;
    const diag = Math.atan2(h, w);
    const out: FanRay[] = [];
    const push = (color: string, target: PixelPoint) => {
      if (Math.hypot(target.x - o.x, target.y - o.y) < 1e-6) return;
      const angle = Math.atan2(target.y - o.y, target.x - o.x);
      out.push({ color, target, angle, rel: normAngle(angle - diag) });
    };
    for (const l of visibleLevels(this.style.hlevels)) push(l.color, { x: e.x, y: o.y + l.coeff * h });
    for (const l of visibleLevels(this.style.vlevels)) push(l.color, { x: o.x + l.coeff * w, y: e.y });
    out.sort((p, q) => p.rel - q.rel);
    // drop duplicates (the 1.0 price level and the 1.0 time level are the same diagonal)
    return out.filter((r, i) => i === 0 || Math.abs(r.rel - out[i - 1].rel) > 1e-9);
  }

  private _far(rc: DrawingRenderContext, o: PixelPoint, r: FanRay): PixelPoint {
    const R = Math.max(2000, 4 * (rc.width + rc.height));
    return { x: o.x + Math.cos(r.angle) * R, y: o.y + Math.sin(r.angle) * R };
  }

  render(rc: DrawingRenderContext): void {
    const bx = this.box(rc);
    if (!bx) return;
    const { o, e } = bx;
    const { ctx } = rc;
    const s = this.style;
    const w = e.x - o.x, h = e.y - o.y;
    const rays = this.rays(rc);
    if (s.fillBackground && rays.length > 1) {
      const alpha = alphaFor(s.transparency);
      for (let i = 1; i < rays.length; i++) {
        const f1 = this._far(rc, o, rays[i - 1]), f2 = this._far(rc, o, rays[i]);
        ctx.fillStyle = withAlpha(rays[i].color, alpha);
        ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(f1.x, f1.y); ctx.lineTo(f2.x, f2.y); ctx.closePath(); ctx.fill();
      }
    }
    const hl = visibleLevels(s.hlevels), vl = visibleLevels(s.vlevels);
    // grid: mirrored fan from the far corner through the near-edge level points (lattice)
    if (s.showGrid && Math.abs(w) > 0.5 && Math.abs(h) > 0.5) {
      applyLine(ctx, s.gridColor, s.gridWidth, s.gridStyle);
      ctx.beginPath();
      for (const l of hl) { ctx.moveTo(e.x, e.y); ctx.lineTo(o.x, o.y + l.coeff * h); }
      for (const l of vl) { ctx.moveTo(e.x, e.y); ctx.lineTo(o.x + l.coeff * w, o.y); }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // box level lines (horizontal = price levels, vertical = time levels)
    for (const l of hl) {
      const y = crisp(o.y + l.coeff * h, rc.dpr, s.lineWidth);
      applyLine(ctx, l.color, s.lineWidth, s.lineStyle);
      ctx.beginPath(); ctx.moveTo(o.x, y); ctx.lineTo(e.x, y); ctx.stroke();
    }
    for (const l of vl) {
      const x = crisp(o.x + l.coeff * w, rc.dpr, s.lineWidth);
      applyLine(ctx, l.color, s.lineWidth, s.lineStyle);
      ctx.beginPath(); ctx.moveTo(x, o.y); ctx.lineTo(x, e.y); ctx.stroke();
    }
    // fan rays
    for (const r of rays) {
      const far = this._far(rc, o, r);
      strokeSegment(ctx, o, far, r.color, s.lineWidth, s.lineStyle);
    }
    // labels
    const font = fontFor(rc, s.labelFontSize || 11);
    const left = Math.min(o.x, e.x), right = Math.max(o.x, e.x), top = Math.min(o.y, e.y), bottom = Math.max(o.y, e.y);
    for (const l of hl) {
      const y = o.y + l.coeff * h;
      const text = formatCoeff(l.coeff);
      if (s.showLeftLabels) drawLevelLabel(ctx, text, left - 4, y, l.color, font, 'right', 'middle');
      if (s.showRightLabels) drawLevelLabel(ctx, text, right + 4, y, l.color, font, 'left', 'middle');
    }
    for (const l of vl) {
      const x = o.x + l.coeff * w;
      const text = formatCoeff(l.coeff);
      if (s.showTopLabels) drawLevelLabel(ctx, text, x, top - 3, l.color, font, 'center', 'bottom');
      if (s.showBottomLabels) drawLevelLabel(ctx, text, x, bottom + 3, l.color, font, 'center', 'top');
    }
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const px = this.points.map((p) => rc.toPixel(p));
    const hp = nearPoint(px, x, y);
    if (hp) return hp;
    const bx = this.box(rc);
    if (!bx) return null;
    const { o, e } = bx;
    for (const r of this.rays(rc)) if (distToRay(x, y, o.x, o.y, r.target.x, r.target.y) <= HIT_TOLERANCE) return { type: 'body' };
    const w = e.x - o.x, h = e.y - o.y;
    for (const l of visibleLevels(this.style.hlevels)) { const ly = o.y + l.coeff * h; if (distToSegment(x, y, o.x, ly, e.x, ly) <= HIT_TOLERANCE) return { type: 'body' }; }
    for (const l of visibleLevels(this.style.vlevels)) { const lx = o.x + l.coeff * w; if (distToSegment(x, y, lx, o.y, lx, e.y) <= HIT_TOLERANCE) return { type: 'body' }; }
    if (pointInRect(x, y, o.x, o.y, e.x, e.y)) return { type: 'body', part: 'inside' };
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fib Circles
// ---------------------------------------------------------------------------

interface Ring { l: FibLevel; r: number }

function circleStyle(levels: FibLevel[], extra: Record<string, any> = {}): Record<string, any> {
  return {
    levels: cloneLevels(levels), lineWidth: 2, lineStyle: 0,
    showTrendLine: true, trendLineColor: GREY, trendLineWidth: 2, trendLineStyle: 2,
    showLevels: true, coeffsAsPercents: false, labelFontSize: 11, fillBackground: true, transparency: 80, ...extra,
  };
}
function circleDefs(extra: PropertyDef[] = []): PropertyDef[] {
  return [levelsTableDef(), P.lineWidth('lineWidth', 'Levels line width'), P.lineStyle('lineStyle', 'Levels line style'), ...trendLineDefs(), ...extra, ...backgroundDefs(), ...labelDefs(false)];
}

export class FibCircles extends Drawing {
  static override toolId = 'fib_circles';
  static override toolName = 'Fib Circles';
  static override pointsCount = 2;
  static override group = 'fib' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M14 4c5.5 0 10 4.5 10 10s-4.5 10-10 10S4 19.5 4 14 8.5 4 14 4zm0 1c-5 0-9 4-9 9s4 9 9 9 9-4 9-9-4-9-9-9zm0 3c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6 2.7-6 6-6zm0 1c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>';
  defaultStyle(): Record<string, any> { return circleStyle(DEFAULT_FIB_CIRCLE_LEVELS); }
  propertyDefs(): PropertyDef[] { return circleDefs(); }

  /** Centre (p1) and the level-1 radii = |dx|, |dy| of p2 − p1 in pixels (spec §C.7). */
  geometry(rc: DrawingRenderContext): { a: PixelPoint; b: PixelPoint; rx: number; ry: number } | null {
    if (this.points.length < 2) return null;
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1]);
    if (!finite(a) || !finite(b)) return null;
    return { a, b, rx: Math.abs(b.x - a.x), ry: Math.abs(b.y - a.y) };
  }

  rings(rc: DrawingRenderContext): Array<{ l: FibLevel; rx: number; ry: number }> {
    const g = this.geometry(rc);
    if (!g) return [];
    return sortedByCoeff(visibleLevels(this.style.levels)).map((l) => ({ l, rx: clampRadius(l.coeff * g.rx), ry: clampRadius(l.coeff * g.ry) }));
  }

  render(rc: DrawingRenderContext): void {
    const g = this.geometry(rc);
    if (!g) return;
    const { ctx } = rc;
    const s = this.style;
    if (s.showTrendLine) strokeSegment(ctx, g.a, g.b, s.trendLineColor, s.trendLineWidth, s.trendLineStyle);
    if (g.rx < 0.5 && g.ry < 0.5) return;
    const rings = this.rings(rc);
    if (s.fillBackground) {
      const alpha = alphaFor(s.transparency);
      for (let i = 1; i < rings.length; i++) {
        ctx.fillStyle = withAlpha(rings[i].l.color, alpha);
        ctx.beginPath();
        ctx.ellipse(g.a.x, g.a.y, rings[i].rx, rings[i].ry, 0, 0, Math.PI * 2);
        ctx.ellipse(g.a.x, g.a.y, rings[i - 1].rx, rings[i - 1].ry, 0, 0, Math.PI * 2);
        ctx.fill('evenodd');
      }
    }
    const font = fontFor(rc, s.labelFontSize || 11);
    for (const ring of rings) {
      applyLine(ctx, ring.l.color, s.lineWidth, s.lineStyle);
      ctx.beginPath();
      ctx.ellipse(g.a.x, g.a.y, ring.rx, ring.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (s.showLevels) drawLevelLabel(ctx, formatCoeff(ring.l.coeff, !!s.coeffsAsPercents), g.a.x + ring.rx + 3, g.a.y, ring.l.color, font, 'left', 'middle');
    }
    ctx.setLineDash([]);
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const px = this.points.map((p) => rc.toPixel(p));
    const hp = nearPoint(px, x, y);
    if (hp) return hp;
    const g = this.geometry(rc);
    if (!g) return null;
    for (const ring of this.rings(rc)) {
      const nd = Math.hypot((x - g.a.x) / ring.rx, (y - g.a.y) / ring.ry);
      if (Math.abs(nd - 1) * Math.min(ring.rx, ring.ry) <= HIT_TOLERANCE) return { type: 'body' };
    }
    if (this.style.showTrendLine && distToSegment(x, y, g.a.x, g.a.y, g.b.x, g.b.y) <= HIT_TOLERANCE) return { type: 'body' };
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fib Spiral
// ---------------------------------------------------------------------------

export class FibSpiral extends Drawing {
  static override toolId = 'fib_spiral';
  static override toolName = 'Fib Spiral';
  static override pointsCount = 2;
  static override group = 'fib' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M14 13a1 1 0 0 1 1 1c0 .6-.4 1-1 1a2 2 0 0 1-2-2c0-1.7 1.3-3 3-3a4 4 0 0 1 4 4c0 3-2.5 5.5-5.5 5.5A7 7 0 0 1 6.5 12.5C6.5 7.8 10.3 4 15 4a9 9 0 0 1 9 9c0 5.5-4.5 10-10 10v-1c5 0 9-4 9-9a8 8 0 0 0-8-8c-4.1 0-7.5 3.4-7.5 7.5a6 6 0 0 0 6 6c2.5 0 4.5-2 4.5-4.5a3 3 0 0 0-3-3c-1.1 0-2 .9-2 2 0 .6.4 1 1 1z"/></svg>';
  defaultStyle(): Record<string, any> { return { lineColor: '#00BCD4', lineWidth: 1, lineStyle: 0, counterclockwise: false }; }
  propertyDefs(): PropertyDef[] { return [P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'), P.bool('counterclockwise', 'Counterclockwise')]; }

  /** Golden spiral r(t) = r0·φ^(2t/π) around p1, passing through p2 at t = 0. */
  spiralPoints(rc: DrawingRenderContext): PixelPoint[] {
    if (this.points.length < 2) return [];
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1]);
    if (!finite(a) || !finite(b)) return [];
    const r0 = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(r0 >= 1)) return [];
    const theta0 = Math.atan2(b.y - a.y, b.x - a.x);
    const dir = this.style.counterclockwise ? -1 : 1;
    const R = Math.max(2000, 4 * (rc.width + rc.height));
    const tMin = -4 * Math.PI;
    let tMax = (Math.PI / 2) * (Math.log(R / r0) / Math.log(PHI));
    if (!(tMax > tMin + 0.1)) tMax = tMin + Math.PI * 2;
    const maxSteps = 3000;
    const step = Math.max(0.05, (tMax - tMin) / maxSteps);
    const out: PixelPoint[] = [];
    for (let t = tMin; t <= tMax; t += step) {
      const r = Math.min(MAX_RADIUS, r0 * Math.pow(PHI, (2 * t) / Math.PI));
      const ang = theta0 + dir * t;
      out.push({ x: a.x + r * Math.cos(ang), y: a.y + r * Math.sin(ang) });
    }
    return out;
  }

  render(rc: DrawingRenderContext): void {
    const pts = this.spiralPoints(rc);
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
    const pts = this.spiralPoints(rc);
    const tol = HIT_TOLERANCE + (this.style.lineWidth || 1) / 2;
    for (let i = 1; i < pts.length; i++) if (distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= tol) return { type: 'body' };
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fib Speed Resistance Arcs
// ---------------------------------------------------------------------------

export class FibSpeedResistArcs extends Drawing {
  static override toolId = 'fib_speed_resist_arcs';
  static override toolName = 'Fib Speed Resistance Arcs';
  static override pointsCount = 2;
  static override group = 'fib' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4 21h20v1H4z"/><path fill="currentColor" d="M14 5a16 16 0 0 1 16 16h-1A15 15 0 0 0 14 6a15 15 0 0 0-15 15h-1A16 16 0 0 1 14 5zm0 5a11 11 0 0 1 11 11h-1A10 10 0 0 0 14 11 10 10 0 0 0 4 21H3a11 11 0 0 1 11-11zm0 5a6 6 0 0 1 6 6h-1a5 5 0 0 0-10 0H8a6 6 0 0 1 6-6z"/></svg>';
  defaultStyle(): Record<string, any> { return circleStyle(DEFAULT_FIB_ARC_LEVELS, { fullCircles: false }); }
  propertyDefs(): PropertyDef[] { return circleDefs([P.bool('fullCircles', 'Full circles')]); }

  /** Arcs are centred at p2 (end of the trend) with radius coeff·|p2 − p1| (px); half circles face p1. */
  geometry(rc: DrawingRenderContext): { a: PixelPoint; c: PixelPoint; L: number; from: number; to: number } | null {
    if (this.points.length < 2) return null;
    const a = rc.toPixel(this.points[0]);
    const c = rc.toPixel(this.points[1]);
    if (!finite(a) || !finite(c)) return null;
    const L = Math.hypot(c.x - a.x, c.y - a.y);
    if (this.style.fullCircles) return { a, c, L, from: 0, to: Math.PI * 2 };
    return a.y >= c.y ? { a, c, L, from: 0, to: Math.PI } : { a, c, L, from: Math.PI, to: Math.PI * 2 };
  }

  rings(rc: DrawingRenderContext): Ring[] {
    const g = this.geometry(rc);
    if (!g) return [];
    return sortedByCoeff(visibleLevels(this.style.levels)).map((l) => ({ l, r: clampRadius(l.coeff * g.L) }));
  }

  render(rc: DrawingRenderContext): void {
    const g = this.geometry(rc);
    if (!g) return;
    const { ctx } = rc;
    const s = this.style;
    if (s.showTrendLine) strokeSegment(ctx, g.a, g.c, s.trendLineColor, s.trendLineWidth, s.trendLineStyle);
    if (g.L < 1) return;
    const rings = this.rings(rc);
    const full = g.to - g.from >= Math.PI * 2 - 1e-9;
    if (s.fillBackground) {
      const alpha = alphaFor(s.transparency);
      for (let i = 1; i < rings.length; i++) {
        ctx.fillStyle = withAlpha(rings[i].l.color, alpha);
        ctx.beginPath();
        if (full) {
          ctx.arc(g.c.x, g.c.y, rings[i].r, 0, Math.PI * 2);
          ctx.arc(g.c.x, g.c.y, rings[i - 1].r, 0, Math.PI * 2);
          ctx.fill('evenodd');
        } else {
          ctx.arc(g.c.x, g.c.y, rings[i].r, g.from, g.to);
          ctx.arc(g.c.x, g.c.y, rings[i - 1].r, g.to, g.from, true);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    const font = fontFor(rc, s.labelFontSize || 11);
    const mid = (g.from + g.to) / 2;
    for (const ring of rings) {
      applyLine(ctx, ring.l.color, s.lineWidth, s.lineStyle);
      ctx.beginPath();
      ctx.arc(g.c.x, g.c.y, ring.r, g.from, g.to);
      ctx.stroke();
      if (s.showLevels) {
        const lx = g.c.x + Math.cos(mid) * ring.r, ly = g.c.y + Math.sin(mid) * ring.r;
        drawLevelLabel(ctx, formatCoeff(ring.l.coeff, !!s.coeffsAsPercents), lx, ly + (Math.sin(mid) >= 0 ? 2 : -2), ring.l.color, font, 'center', Math.sin(mid) >= 0 ? 'top' : 'bottom');
      }
    }
    ctx.setLineDash([]);
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const px = this.points.map((p) => rc.toPixel(p));
    const hp = nearPoint(px, x, y);
    if (hp) return hp;
    const g = this.geometry(rc);
    if (!g) return null;
    const d = Math.hypot(x - g.c.x, y - g.c.y);
    const full = g.to - g.from >= Math.PI * 2 - 1e-9;
    const onSide = full || (g.from === 0 ? y - g.c.y >= -HIT_TOLERANCE : y - g.c.y <= HIT_TOLERANCE);
    if (onSide) for (const ring of this.rings(rc)) if (Math.abs(d - ring.r) <= HIT_TOLERANCE) return { type: 'body' };
    if (this.style.showTrendLine && distToSegment(x, y, g.a.x, g.a.y, g.c.x, g.c.y) <= HIT_TOLERANCE) return { type: 'body' };
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fib Wedge
// ---------------------------------------------------------------------------

export class FibWedge extends Drawing {
  static override toolId = 'fib_wedge';
  static override toolName = 'Fib Wedge';
  static override pointsCount = 3;
  static override group = 'fib' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4.35 24.35l20-20-.7-.7-20 20zM4.45 24.9l20-10-.45-.9-20 10z"/><path fill="currentColor" d="M4 24a8 8 0 0 1 2.3-5.7l.7.7A7 7 0 0 0 5 24zm0 0a14 14 0 0 1 4.1-9.9l.7.7A13 13 0 0 0 5 24zm0 0a20 20 0 0 1 5.9-14.1l.7.7A19 19 0 0 0 5 24z"/></svg>';
  defaultStyle(): Record<string, any> { return circleStyle(DEFAULT_FIB_WEDGE_LEVELS, { trendLineStyle: 0 }); }
  propertyDefs(): PropertyDef[] { return circleDefs(); }

  /** Apex p1, rays through p2 / p3; arcs have radius coeff·|p2 − p1| (px) inside the sector. */
  geometry(rc: DrawingRenderContext): { a: PixelPoint; b: PixelPoint; c: PixelPoint | null; L: number; thetaB: number; dTheta: number } | null {
    if (this.points.length < 2) return null;
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1]);
    if (!finite(a) || !finite(b)) return null;
    const c = this.points[2] ? rc.toPixel(this.points[2]) : null;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const thetaB = Math.atan2(b.y - a.y, b.x - a.x);
    const dTheta = c && finite(c) ? normAngle(Math.atan2(c.y - a.y, c.x - a.x) - thetaB) : 0;
    return { a, b, c: c && finite(c) ? c : null, L, thetaB, dTheta };
  }

  rings(rc: DrawingRenderContext): Ring[] {
    const g = this.geometry(rc);
    if (!g) return [];
    return sortedByCoeff(visibleLevels(this.style.levels)).map((l) => ({ l, r: clampRadius(l.coeff * g.L) }));
  }

  private _rayEnds(g: NonNullable<ReturnType<FibWedge['geometry']>>, rings: Ring[]): [PixelPoint, PixelPoint] {
    const lc = g.c ? Math.hypot(g.c.x - g.a.x, g.c.y - g.a.y) : g.L;
    const R = Math.max(g.L, lc, ...rings.map((r) => r.r));
    const thetaC = g.thetaB + g.dTheta;
    return [
      { x: g.a.x + Math.cos(g.thetaB) * R, y: g.a.y + Math.sin(g.thetaB) * R },
      { x: g.a.x + Math.cos(thetaC) * R, y: g.a.y + Math.sin(thetaC) * R },
    ];
  }

  render(rc: DrawingRenderContext): void {
    const g = this.geometry(rc);
    if (!g) return;
    const { ctx } = rc;
    const s = this.style;
    if (!g.c) {
      if (s.showTrendLine) strokeSegment(ctx, g.a, g.b, s.trendLineColor, s.trendLineWidth, s.trendLineStyle);
      return;
    }
    const rings = g.L >= 1 ? this.rings(rc) : [];
    const [endB, endC] = this._rayEnds(g, rings);
    const ccw = g.dTheta < 0;
    const thetaC = g.thetaB + g.dTheta;
    if (s.fillBackground && Math.abs(g.dTheta) > 1e-6) {
      const alpha = alphaFor(s.transparency);
      for (let i = 1; i < rings.length; i++) {
        ctx.fillStyle = withAlpha(rings[i].l.color, alpha);
        ctx.beginPath();
        ctx.arc(g.a.x, g.a.y, rings[i].r, g.thetaB, thetaC, ccw);
        ctx.arc(g.a.x, g.a.y, rings[i - 1].r, thetaC, g.thetaB, !ccw);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (s.showTrendLine) {
      strokeSegment(ctx, g.a, endB, s.trendLineColor, s.trendLineWidth, s.trendLineStyle);
      strokeSegment(ctx, g.a, endC, s.trendLineColor, s.trendLineWidth, s.trendLineStyle);
    }
    const font = fontFor(rc, s.labelFontSize || 11);
    const mid = g.thetaB + g.dTheta / 2;
    for (const ring of rings) {
      applyLine(ctx, ring.l.color, s.lineWidth, s.lineStyle);
      ctx.beginPath();
      ctx.arc(g.a.x, g.a.y, ring.r, g.thetaB, thetaC, ccw);
      ctx.stroke();
      if (s.showLevels) {
        const lx = g.a.x + Math.cos(mid) * (ring.r + 3), ly = g.a.y + Math.sin(mid) * (ring.r + 3);
        drawLevelLabel(ctx, formatCoeff(ring.l.coeff, !!s.coeffsAsPercents), lx, ly, ring.l.color, font, Math.cos(mid) >= 0 ? 'left' : 'right', 'middle');
      }
    }
    ctx.setLineDash([]);
  }

  private _inSector(g: NonNullable<ReturnType<FibWedge['geometry']>>, x: number, y: number): boolean {
    const rel = normAngle(Math.atan2(y - g.a.y, x - g.a.x) - g.thetaB);
    const eps = 0.02;
    return g.dTheta >= 0 ? rel >= -eps && rel <= g.dTheta + eps : rel <= eps && rel >= g.dTheta - eps;
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 3) return null;
    const px = this.points.map((p) => rc.toPixel(p));
    const hp = nearPoint(px, x, y);
    if (hp) return hp;
    const g = this.geometry(rc);
    if (!g || !g.c) return null;
    const rings = this.rings(rc);
    const d = Math.hypot(x - g.a.x, y - g.a.y);
    if (this._inSector(g, x, y)) for (const ring of rings) if (Math.abs(d - ring.r) <= HIT_TOLERANCE) return { type: 'body' };
    const [endB, endC] = this._rayEnds(g, rings);
    if (distToSegment(x, y, g.a.x, g.a.y, endB.x, endB.y) <= HIT_TOLERANCE) return { type: 'body' };
    if (distToSegment(x, y, g.a.x, g.a.y, endC.x, endC.y) <= HIT_TOLERANCE) return { type: 'body' };
    return null;
  }
}

export const fibTools = [FibRetracement, FibExtension, FibChannel, FibTimeZone, FibSpeedResistFan, FibTrendTime, FibCircles, FibSpiral, FibSpeedResistArcs, FibWedge];
