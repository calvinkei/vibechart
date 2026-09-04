import { Drawing, P, HIT_TOLERANCE, type DrawingPoint, type DrawingRenderContext, type HitTarget, type PixelPoint, type PropertyDef } from '../Drawing';
import { applyLine, drawExtendedLine, lineDistance, drawArrowHead, drawTextBox, fontFor } from './common';
import { formatPrice, formatPercent, formatDuration } from '../../util/format';
import { withAlpha } from '../../util/color';
import { clamp, clipLineToRect, pointInPolygon } from '../../util/math';
import { priceSourceValue, type PriceSource } from '../../data/types';

type Handle = PixelPoint & { index: number };

const HANDLE_HIT = 7;
const H_ALIGN_OPTIONS = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }];
const V_ALIGN_OPTIONS = [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }];
const LINE_END_OPTIONS = [{ value: 0, label: 'Normal' }, { value: 1, label: 'Arrow' }];

function hitHandle(handles: Handle[], x: number, y: number): HitTarget {
  for (const h of handles) if (Math.hypot(h.x - x, h.y - y) <= HANDLE_HIT) return { type: 'point', index: h.index };
  return null;
}

/** Endpoints of a (possibly extended) line clipped to a padded pane rect, without drawing. */
function clippedSegment(rc: DrawingRenderContext, a: PixelPoint, b: PixelPoint, extendLeft: boolean, extendRight: boolean): [PixelPoint, PixelPoint] | null {
  const pad = 2000;
  const seg = clipLineToRect(a.x, a.y, b.x, b.y, -pad, -pad, rc.width + pad, rc.height + pad, extendLeft, extendRight);
  return seg ? [{ x: seg[0], y: seg[1] }, { x: seg[2], y: seg[3] }] : null;
}

function strokeSegment(ctx: CanvasRenderingContext2D, a: PixelPoint, b: PixelPoint): void {
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

function fillQuad(ctx: CanvasRenderingContext2D, a: PixelPoint, b: PixelPoint, c: PixelPoint, d: PixelPoint, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
}

/** Small price box (white text on the line colour) next to a point. */
function drawPriceLabel(rc: DrawingRenderContext, x: number, y: number, price: number, bg: string): void {
  const { ctx } = rc;
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  drawTextBox(ctx, formatPrice(price, rc.priceFormat), x + 6, y, { font: fontFor(rc, 11), color: '#FFFFFF', bg, radius: 2, padding: 2, vAlign: 'middle' });
}

/** Price / bars / date range stats of p0→p1, drawn under the middle of the a→b line. */
function drawRangeStats(rc: DrawingRenderContext, d: Drawing, p0: DrawingPoint, p1: DrawingPoint, a: PixelPoint, b: PixelPoint): void {
  const s = d.style;
  const lines: string[] = [];
  const dp = p1.price - p0.price;
  if (s.showPriceRange) lines.push(`${dp >= 0 ? '+' : ''}${formatPrice(dp, rc.priceFormat)} (${formatPercent(p0.price !== 0 ? (dp / p0.price) * 100 : 0)})`);
  if (s.showBarsRange) lines.push(`${Math.round(rc.timeScale.timeToIndex(p1.time) - rc.timeScale.timeToIndex(p0.time))} bars`);
  if (s.showDateTimeRange) lines.push(formatDuration(p1.time - p0.time));
  if (!lines.length) return;
  const { ctx } = rc;
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  drawTextBox(ctx, lines.join('\n'), (a.x + b.x) / 2, (a.y + b.y) / 2 + 8, { font: fontFor(rc, s.fontSize, s.bold, s.italic), color: '#FFFFFF', bg: s.lineColor, radius: 3, padding: 4, align: 'center' });
}

/** Free text label positioned along the a→b line (Text tab). */
function drawChannelLabel(rc: DrawingRenderContext, d: Drawing, a: PixelPoint, b: PixelPoint): void {
  const s = d.style;
  if (!s.labelVisible || !s.labelText) return;
  const left = a.x <= b.x ? a : b;
  const right = a.x <= b.x ? b : a;
  const ax = s.labelHorzAlign === 'left' ? left.x : s.labelHorzAlign === 'right' ? right.x : (left.x + right.x) / 2;
  const t = right.x === left.x ? 0.5 : (ax - left.x) / (right.x - left.x);
  const ay = left.y + (right.y - left.y) * t;
  const va = s.labelVertAlign;
  const { ctx } = rc;
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  drawTextBox(ctx, s.labelText, ax, va === 'top' ? ay + 6 : va === 'bottom' ? ay - 6 : ay, { font: fontFor(rc, s.labelFontSize, s.labelBold, s.labelItalic), color: s.labelTextColor, align: s.labelHorzAlign, vAlign: va === 'top' ? 'top' : va === 'bottom' ? 'bottom' : 'middle' });
}

function channelStatsProps(): PropertyDef[] {
  return [
    P.section('Stats'),
    P.bool('showPrices', 'Prices'), P.bool('showPriceRange', 'Price range'), P.bool('showBarsRange', 'Bars range'), P.bool('showDateTimeRange', 'Date/time range'),
    P.fontSize('fontSize', 'Stats font size', 'Style'), P.bool('bold', 'Stats bold'), P.bool('italic', 'Stats italic'),
  ];
}

function channelTextProps(): PropertyDef[] {
  return [
    P.bool('labelVisible', 'Show text', 'Text'), P.text('labelText', 'Text'), P.color('labelTextColor', 'Text color', 'Text'), P.fontSize('labelFontSize'),
    P.bool('labelBold', 'Bold', 'Text'), P.bool('labelItalic', 'Italic', 'Text'),
    P.select('labelHorzAlign', 'Alignment', H_ALIGN_OPTIONS, 'Text'), P.select('labelVertAlign', 'Vertical', V_ALIGN_OPTIONS, 'Text'),
  ];
}

/** Style shared by Flat top/bottom and Disjoint channel (TV `linetoolflatbottom` / `linetooldisjointangle`). */
function channelBaseStyle(color: string, background: string) {
  return {
    lineColor: color, lineWidth: 2, lineStyle: 0, extendLeft: false, extendRight: false, leftEnd: 0, rightEnd: 0,
    fillBackground: true, backgroundColor: background,
    showPrices: false, showPriceRange: false, showBarsRange: false, showDateTimeRange: false, fontSize: 12, bold: false, italic: false,
    labelVisible: false, labelText: '', labelTextColor: color, labelFontSize: 14, labelBold: false, labelItalic: false, labelHorzAlign: 'left', labelVertAlign: 'bottom',
  };
}

function channelBaseProps(): PropertyDef[] {
  return [
    P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'),
    P.bool('extendLeft', 'Extend left'), P.bool('extendRight', 'Extend right'),
    P.select('leftEnd', 'Left end', LINE_END_OPTIONS), P.select('rightEnd', 'Right end', LINE_END_OPTIONS),
    P.bool('fillBackground', 'Background'), P.color('backgroundColor', 'Background color'),
    ...channelStatsProps(), ...channelTextProps(),
  ];
}

// ---------------------------------------------------------------------------------------------
// Regression trend
// ---------------------------------------------------------------------------------------------

export interface RegressionStats {
  /** first / last bar index of the range (inclusive) */
  i0: number; i1: number; n: number;
  /** OLS line: value(k) = intercept + slope * k, k = 0..n-1 relative to i0 */
  slope: number; intercept: number;
  /** standard deviation of residuals */
  sigma: number;
  /** |Pearson correlation coefficient| */
  r: number;
}

const SOURCE_OPTIONS = [
  { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }, { value: 'close', label: 'Close' },
  { value: 'hl2', label: 'HL2' }, { value: 'hlc3', label: 'HLC3' }, { value: 'ohlc4', label: 'OHLC4' },
];

interface RegressionLines { xA: number; xB: number; b0: PixelPoint; b1: PixelPoint; u0: PixelPoint; u1: PixelPoint; l0: PixelPoint; l1: PixelPoint }

/**
 * Regression Trend (TV `linetoolregressiontrend`): linear regression of `source` over the bars between
 * the two anchors, with ±k·σ channel lines, Pearson's R label and channel fills.
 */
export class RegressionTrend extends Drawing {
  static override toolId = 'regression_trend';
  static override toolName = 'Regression Trend';
  static override pointsCount = 2;
  static override group = 'lines' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M3.5 17l20-10 .5.9-20 10zM3.5 25l20-10 .5.9-20 10zM3.5 21l4-2 .5.9-4 2zM9.5 18l4-2 .5.9-4 2zM15.5 15l4-2 .5.9-4 2zM21.5 12l2-1 .5.9-2 1z"/></svg>';

  private _cacheKey = '';
  private _cache: RegressionStats | null = null;

  defaultStyle() {
    return {
      source: 'close', upperDeviation: 2, lowerDeviation: -2, useUpperDeviation: true, useLowerDeviation: true,
      showBaseLine: true, baseLineColor: 'rgba(242, 54, 69, 0.3)', baseLineWidth: 1, baseLineStyle: 2,
      showUpLine: true, upLineColor: 'rgba(41, 98, 255, 0.3)', upLineWidth: 2, upLineStyle: 0,
      showDownLine: true, downLineColor: 'rgba(41, 98, 255, 0.3)', downLineWidth: 2, downLineStyle: 0,
      extendLines: false, showPearsons: true, fillBackground: true, transparency: 70,
    };
  }

  propertyDefs(): PropertyDef[] {
    return [
      P.select('source', 'Source', SOURCE_OPTIONS, 'Inputs'),
      P.bool('useUpperDeviation', 'Use upper deviation', 'Inputs'), P.number('upperDeviation', 'Upper deviation', -10, 10, 0.1, 'Inputs'),
      P.bool('useLowerDeviation', 'Use lower deviation', 'Inputs'), P.number('lowerDeviation', 'Lower deviation', -10, 10, 0.1, 'Inputs'),
      P.section('Base'),
      P.bool('showBaseLine', 'Base line'), P.color('baseLineColor', 'Base color'), P.lineWidth('baseLineWidth', 'Base width'), P.lineStyle('baseLineStyle', 'Base style'),
      P.section('Up'),
      P.bool('showUpLine', 'Up line'), P.color('upLineColor', 'Up color'), P.lineWidth('upLineWidth', 'Up width'), P.lineStyle('upLineStyle', 'Up style'),
      P.section('Down'),
      P.bool('showDownLine', 'Down line'), P.color('downLineColor', 'Down color'), P.lineWidth('downLineWidth', 'Down width'), P.lineStyle('downLineStyle', 'Down style'),
      P.section('Options'),
      P.bool('extendLines', 'Extend lines'), P.bool('showPearsons', "Pearson's R"), P.bool('fillBackground', 'Background'), P.int('transparency', 'Transparency', 0, 100),
    ];
  }

  override onChanged(): void { this._cacheKey = ''; this._cache = null; }

  /** Bar index range [i0, i1] covered by the two anchors, clamped to the data. */
  barRange(rc: DrawingRenderContext): [number, number] | null {
    const bars = rc.mainSeries.bars;
    if (this.points.length < 2 || !bars.length) return null;
    const ts = rc.timeScale;
    let i0 = Math.round(ts.timeToIndex(this.points[0].time));
    let i1 = Math.round(ts.timeToIndex(this.points[1].time));
    if (i0 > i1) { const t = i0; i0 = i1; i1 = t; }
    return [clamp(i0, 0, bars.length - 1), clamp(i1, 0, bars.length - 1)];
  }

  /** Linear regression over the anchored bar range (cached by range, source and bar count). */
  regression(rc: DrawingRenderContext): RegressionStats | null {
    const range = this.barRange(rc);
    if (!range) return null;
    const bars = rc.mainSeries.bars;
    const [i0, i1] = range;
    const src = String(this.style.source ?? 'close') as PriceSource;
    const last = bars[bars.length - 1];
    const key = `${i0}|${i1}|${bars.length}|${src}|${last.time}|${last.close}`;
    if (this._cache && this._cacheKey === key) return this._cache;
    const n = i1 - i0 + 1;
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    for (let k = 0; k < n; k++) {
      const y = priceSourceValue(bars[i0 + k], src);
      sx += k; sy += y; sxx += k * k; sxy += k * y; syy += y * y;
    }
    const mx = sx / n, my = sy / n;
    const vx = sxx / n - mx * mx;
    const vy = syy / n - my * my;
    const cov = sxy / n - mx * my;
    const slope = vx > 0 ? cov / vx : 0;
    const intercept = my - slope * mx;
    let ss = 0;
    for (let k = 0; k < n; k++) {
      const res = priceSourceValue(bars[i0 + k], src) - (intercept + slope * k);
      ss += res * res;
    }
    const sigma = Math.sqrt(ss / n);
    const r = vx > 0 && vy > 0 ? Math.min(1, Math.abs(cov / Math.sqrt(vx * vy))) : 0;
    const res: RegressionStats = { i0, i1, n, slope, intercept, sigma, r };
    if (!Number.isFinite(slope) || !Number.isFinite(intercept)) { res.slope = 0; res.intercept = my; res.sigma = 0; res.r = 0; }
    this._cacheKey = key;
    this._cache = res;
    return res;
  }

  private _lines(rc: DrawingRenderContext, reg: RegressionStats): RegressionLines {
    const { timeScale: ts, priceScale: ps } = rc;
    const s = this.style;
    const xA = ts.indexToX(reg.i0 + 0.5);
    const xB = ts.indexToX(reg.i1 + 0.5);
    const base0 = reg.intercept;
    const base1 = reg.intercept + reg.slope * (reg.n - 1);
    const up = s.useUpperDeviation ? (Number(s.upperDeviation) || 0) * reg.sigma : 0;
    const dn = s.useLowerDeviation ? (Number(s.lowerDeviation) || 0) * reg.sigma : 0;
    const line = (off: number): [PixelPoint, PixelPoint] => [{ x: xA, y: ps.priceToY(base0 + off) }, { x: xB, y: ps.priceToY(base1 + off) }];
    const [b0, b1] = line(0);
    const [u0, u1] = line(up);
    const [l0, l1] = line(dn);
    return { xA, xB, b0, b1, u0, u1, l0, l1 };
  }

  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const reg = this.regression(rc);
    if (!reg) return;
    const { ctx } = rc;
    const s = this.style;
    const g = this._lines(rc, reg);
    const ext = !!s.extendLines;
    const degenerate = Math.abs(g.xB - g.xA) < 0.5;
    const seg = (a: PixelPoint, b: PixelPoint): [PixelPoint, PixelPoint] => (degenerate ? [a, b] : clippedSegment(rc, a, b, false, ext) ?? [a, b]);
    const showUp = !!s.useUpperDeviation && !!s.showUpLine;
    const showDown = !!s.useLowerDeviation && !!s.showDownLine;
    if (s.fillBackground && !degenerate) {
      const alpha = (100 - clamp(Number(s.transparency) || 0, 0, 100)) / 100;
      const [bA, bB] = seg(g.b0, g.b1);
      if (showUp) { const [uA, uB] = seg(g.u0, g.u1); fillQuad(ctx, bA, bB, uB, uA, withAlpha(s.upLineColor, alpha)); }
      if (showDown) { const [lA, lB] = seg(g.l0, g.l1); fillQuad(ctx, bA, bB, lB, lA, withAlpha(s.downLineColor, alpha)); }
    }
    if (!degenerate) {
      if (s.showBaseLine) { applyLine(ctx, s.baseLineColor, s.baseLineWidth, s.baseLineStyle); drawExtendedLine(rc, g.b0, g.b1, false, ext); }
      if (showUp) { applyLine(ctx, s.upLineColor, s.upLineWidth, s.upLineStyle); drawExtendedLine(rc, g.u0, g.u1, false, ext); }
      if (showDown) { applyLine(ctx, s.downLineColor, s.downLineWidth, s.downLineStyle); drawExtendedLine(rc, g.l0, g.l1, false, ext); }
    }
    if (s.showPearsons) {
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      drawTextBox(ctx, `Pearson's R: ${reg.r.toFixed(2)}`, g.xA + 4, g.b0.y - 4, { font: fontFor(rc, 12), color: rc.theme === 'dark' ? '#B2B5BE' : '#131722', vAlign: 'bottom', padding: 2 });
    }
  }

  override handles(rc: DrawingRenderContext): Handle[] {
    const reg = this.regression(rc);
    if (!reg) return super.handles(rc);
    const { timeScale: ts, priceScale: ps } = rc;
    const last = rc.mainSeries.bars.length - 1;
    return this.points.slice(0, 2).map((p, i) => {
      const idx = clamp(Math.round(ts.timeToIndex(p.time)), 0, last);
      return { x: ts.indexToX(idx + 0.5), y: ps.priceToY(reg.intercept + reg.slope * (idx - reg.i0)), index: i };
    });
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const hit = hitHandle(this.handles(rc), x, y);
    if (hit) return hit;
    const reg = this.regression(rc);
    if (!reg) return null;
    const s = this.style;
    const g = this._lines(rc, reg);
    const ext = !!s.extendLines;
    const showUp = !!s.useUpperDeviation && !!s.showUpLine;
    const showDown = !!s.useLowerDeviation && !!s.showDownLine;
    if (s.showBaseLine && lineDistance(x, y, g.b0, g.b1, false, ext) <= HIT_TOLERANCE) return { type: 'body' };
    if (showUp && lineDistance(x, y, g.u0, g.u1, false, ext) <= HIT_TOLERANCE) return { type: 'body' };
    if (showDown && lineDistance(x, y, g.l0, g.l1, false, ext) <= HIT_TOLERANCE) return { type: 'body' };
    if (s.fillBackground && (showUp || showDown) && x >= g.xA && (ext || x <= g.xB)) {
      const t = g.xB === g.xA ? 0 : (x - g.xA) / (g.xB - g.xA);
      const yB = g.b0.y + (g.b1.y - g.b0.y) * t;
      const yU = showUp ? g.u0.y + (g.u1.y - g.u0.y) * t : yB;
      const yL = showDown ? g.l0.y + (g.l1.y - g.l0.y) * t : yB;
      if (y >= Math.min(yU, yL, yB) && y <= Math.max(yU, yL, yB)) return { type: 'body', part: 'inside' };
    }
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Flat top / bottom
// ---------------------------------------------------------------------------------------------

/**
 * Flat Top/Bottom (TV `linetoolflatbottom`): a sloped line p1→p2 plus a horizontal line at p3's price
 * spanning the same time range, filled in between. Four handles: both ends of each line.
 */
export class FlatTopBottom extends Drawing {
  static override toolId = 'flat_top_bottom';
  static override toolName = 'Flat Top/Bottom';
  static override pointsCount = 3;
  static override group = 'lines' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4 21h20v1H4zM4.35 15.35l18-8-.4-.9-18 8z"/><path fill="currentColor" d="M5.5 16.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM23.5 8.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>';

  defaultStyle() { return channelBaseStyle('#FF9800', 'rgba(255, 152, 0, 0.2)'); }
  propertyDefs(): PropertyDef[] { return channelBaseProps(); }

  private _geom(rc: DrawingRenderContext) {
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    const yFlat = this.points[2] ? rc.priceScale.priceToY(this.points[2].price) : b.y;
    return { a, b, f1: { x: a.x, y: yFlat }, f2: { x: b.x, y: yFlat } };
  }

  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const { ctx } = rc;
    const s = this.style;
    const g = this._geom(rc);
    const hasFlat = this.points.length >= 3;
    const eL = !!s.extendLeft, eR = !!s.extendRight;
    const l1 = clippedSegment(rc, g.a, g.b, eL, eR);
    const l2 = hasFlat ? clippedSegment(rc, g.f1, g.f2, eL, eR) : null;
    if (s.fillBackground && l1 && l2) fillQuad(ctx, l1[0], l1[1], l2[1], l2[0], s.backgroundColor);
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    if (l1) strokeSegment(ctx, l1[0], l1[1]);
    if (l2) strokeSegment(ctx, l2[0], l2[1]);
    ctx.setLineDash([]);
    const size = 8 + s.lineWidth * 2;
    if (s.leftEnd === 1 && !eL) { drawArrowHead(ctx, g.b, g.a, size); if (l2) drawArrowHead(ctx, g.f2, g.f1, size); }
    if (s.rightEnd === 1 && !eR) { drawArrowHead(ctx, g.a, g.b, size); if (l2) drawArrowHead(ctx, g.f1, g.f2, size); }
    if (s.showPrices) {
      drawPriceLabel(rc, g.a.x, g.a.y, this.points[0].price, s.lineColor);
      drawPriceLabel(rc, g.b.x, g.b.y, this.points[1].price, s.lineColor);
      if (hasFlat) drawPriceLabel(rc, g.f2.x, g.f2.y, this.points[2].price, s.lineColor);
    }
    drawRangeStats(rc, this, this.points[0], this.points[1], g.a, g.b);
    drawChannelLabel(rc, this, g.a, g.b);
  }

  override handles(rc: DrawingRenderContext): Handle[] {
    if (this.points.length < 3) return super.handles(rc);
    const g = this._geom(rc);
    return [{ ...g.a, index: 0 }, { ...g.b, index: 1 }, { ...g.f1, index: 2 }, { ...g.f2, index: 3 }];
  }

  override movePoint(index: number, p: DrawingPoint): void {
    if (index < 2) { if (this.points[index]) this.points[index] = p; return; }
    if (this.points[2]) this.points[2] = { time: this.points[2].time, price: p.price };
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const hit = hitHandle(this.handles(rc), x, y);
    if (hit) return hit;
    const s = this.style;
    const g = this._geom(rc);
    const eL = !!s.extendLeft, eR = !!s.extendRight;
    const hasFlat = this.points.length >= 3;
    if (lineDistance(x, y, g.a, g.b, eL, eR) <= HIT_TOLERANCE) return { type: 'body' };
    if (hasFlat && lineDistance(x, y, g.f1, g.f2, eL, eR) <= HIT_TOLERANCE) return { type: 'body' };
    if (hasFlat && s.fillBackground && g.b.x !== g.a.x) {
      const leftIsA = g.a.x <= g.b.x;
      const minX = (leftIsA ? eL : eR) ? -Infinity : Math.min(g.a.x, g.b.x);
      const maxX = (leftIsA ? eR : eL) ? Infinity : Math.max(g.a.x, g.b.x);
      if (x >= minX && x <= maxX) {
        const ySlope = g.a.y + ((g.b.y - g.a.y) * (x - g.a.x)) / (g.b.x - g.a.x);
        if (y >= Math.min(ySlope, g.f1.y) && y <= Math.max(ySlope, g.f1.y)) return { type: 'body', part: 'inside' };
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Disjoint channel
// ---------------------------------------------------------------------------------------------

/**
 * Disjoint Channel (TV `linetooldisjointangle`): two independent lines sharing the p1–p2 time range.
 * Created with 3 clicks (the 3rd click sets a parallel second line through the pointer); the model
 * stores 4 points — p3 = (p1.time, offset price), p4 = (p2.time, offset price) — so all four ends can
 * be dragged independently afterwards.
 */
export class DisjointChannel extends Drawing {
  static override toolId = 'disjoint_channel';
  static override toolName = 'Disjoint Channel';
  static override pointsCount = 3;
  static override group = 'lines' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4.35 13.35l18-8-.4-.9-18 8zM4.2 22.9l18-4 .2 1-18 4z"/><path fill="currentColor" d="M5.5 14.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM23.5 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM5.5 24.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM23.5 20.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>';

  defaultStyle() { return channelBaseStyle('#089981', 'rgba(8, 153, 129, 0.2)'); }
  propertyDefs(): PropertyDef[] { return channelBaseProps(); }

  /** Creation: the 3rd point spawns the parallel second line (points 3 and 4). */
  override addPoint(p: DrawingPoint): boolean {
    this.points.push(p);
    if (this.points.length === 3) this._syncSecondLine(p);
    return this.points.length >= 4;
  }

  /** While placing the 3rd click, the pointer defines the parallel offset of line 2. */
  override updatePendingPoint(p: DrawingPoint): void {
    if (this.points.length >= 4) { this._syncSecondLine(p); return; }
    super.updatePendingPoint(p);
  }

  override isComplete(): boolean { return this.points.length >= 4; }

  /** Price of line 1 at `time` (linear in time; only used while constructing the second line). */
  private _line1PriceAt(time: number): number {
    const [p1, p2] = this.points;
    const span = p2.time - p1.time;
    const t = span === 0 ? 0 : (time - p1.time) / span;
    return p1.price + (p2.price - p1.price) * t;
  }

  private _syncSecondLine(p: DrawingPoint): void {
    const [p1, p2] = this.points;
    const off = p.price - this._line1PriceAt(p.time);
    this.points[2] = { time: p1.time, price: p1.price + off };
    this.points[3] = { time: p2.time, price: p2.price + off };
  }

  /** Materialise the 4th point when the drawing was loaded with only 3 (parallel second line). */
  private _ensureFour(): void {
    if (this.points.length !== 3) return;
    const [p1, p2, p3] = this.points;
    const off = p3.price - this._line1PriceAt(p3.time);
    this.points[3] = { time: p2.time, price: p2.price + off };
  }

  private _lines(rc: DrawingRenderContext): { a: PixelPoint; b: PixelPoint; c: PixelPoint | null; d: PixelPoint | null } {
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    if (this.points.length >= 4) return { a, b, c: rc.toPixel(this.points[2]), d: rc.toPixel(this.points[3]) };
    if (this.points.length === 3) {
      const p = rc.toPixel(this.points[2]);
      const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x);
      const off = p.y - (a.y + slope * (p.x - a.x));
      return { a, b, c: { x: a.x, y: a.y + off }, d: { x: b.x, y: b.y + off } };
    }
    return { a, b, c: null, d: null };
  }

  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const { ctx } = rc;
    const s = this.style;
    const g = this._lines(rc);
    const eL = !!s.extendLeft, eR = !!s.extendRight;
    const l1 = clippedSegment(rc, g.a, g.b, eL, eR);
    const l2 = g.c && g.d ? clippedSegment(rc, g.c, g.d, eL, eR) : null;
    if (s.fillBackground && l1 && l2) fillQuad(ctx, l1[0], l1[1], l2[1], l2[0], s.backgroundColor);
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    if (l1) strokeSegment(ctx, l1[0], l1[1]);
    if (l2) strokeSegment(ctx, l2[0], l2[1]);
    ctx.setLineDash([]);
    const size = 8 + s.lineWidth * 2;
    if (s.leftEnd === 1 && !eL) { drawArrowHead(ctx, g.b, g.a, size); if (g.c && g.d) drawArrowHead(ctx, g.d, g.c, size); }
    if (s.rightEnd === 1 && !eR) { drawArrowHead(ctx, g.a, g.b, size); if (g.c && g.d) drawArrowHead(ctx, g.c, g.d, size); }
    if (s.showPrices) {
      drawPriceLabel(rc, g.a.x, g.a.y, this.points[0].price, s.lineColor);
      drawPriceLabel(rc, g.b.x, g.b.y, this.points[1].price, s.lineColor);
      if (g.c && g.d) {
        drawPriceLabel(rc, g.c.x, g.c.y, rc.priceScale.yToPrice(g.c.y), s.lineColor);
        drawPriceLabel(rc, g.d.x, g.d.y, rc.priceScale.yToPrice(g.d.y), s.lineColor);
      }
    }
    drawRangeStats(rc, this, this.points[0], this.points[1], g.a, g.b);
    drawChannelLabel(rc, this, g.a, g.b);
  }

  override handles(rc: DrawingRenderContext): Handle[] {
    const g = this._lines(rc);
    if (!g.c || !g.d) return super.handles(rc);
    return [{ ...g.a, index: 0 }, { ...g.b, index: 1 }, { ...g.c, index: 2 }, { ...g.d, index: 3 }];
  }

  override movePoint(index: number, p: DrawingPoint): void {
    if (index >= 2) this._ensureFour();
    if (this.points[index]) this.points[index] = p;
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const hit = hitHandle(this.handles(rc), x, y);
    if (hit) return hit;
    const s = this.style;
    const g = this._lines(rc);
    const eL = !!s.extendLeft, eR = !!s.extendRight;
    if (lineDistance(x, y, g.a, g.b, eL, eR) <= HIT_TOLERANCE) return { type: 'body' };
    if (g.c && g.d && lineDistance(x, y, g.c, g.d, eL, eR) <= HIT_TOLERANCE) return { type: 'body' };
    if (g.c && g.d && s.fillBackground) {
      const l1 = clippedSegment(rc, g.a, g.b, eL, eR);
      const l2 = clippedSegment(rc, g.c, g.d, eL, eR);
      if (l1 && l2 && pointInPolygon(x, y, [l1[0], l1[1], l2[1], l2[0]])) return { type: 'body', part: 'inside' };
    }
    return null;
  }
}

export const channelsTools = [RegressionTrend, FlatTopBottom, DisjointChannel];
