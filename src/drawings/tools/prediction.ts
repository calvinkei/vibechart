import { Drawing, P, type DrawingRenderContext, type DrawingPoint, type HitTarget, type PropertyDef, type PixelPoint, HIT_TOLERANCE } from '../Drawing';
import { applyLine, drawTextBox, drawArrowHead, fontFor, LINE_STYLE_OPTIONS } from './common';
import { formatPrice, formatPercent, formatVolume, formatDuration, formatChange } from '../../util/format';
import { withAlpha } from '../../util/color';
import { crisp } from '../../render/canvas';
import { clamp, distToSegment, pointInRect, pointInPolygon } from '../../util/math';
import type { TimeScale } from '../../core/TimeScale';
import type { Bar, PriceSource } from '../../data/types';
import { priceSourceValue } from '../../data/types';

// =====================================================================================
// Shared helpers (also used by measure.ts / volumeProfile.ts and the tests)
// =====================================================================================

/** Minimal price movement of the main series (falls back to the price-format precision). */
export function tickSize(rc: DrawingRenderContext): number {
  const mm = rc.mainSeries.minMove;
  if (Number.isFinite(mm) && mm > 0) return mm;
  return Math.pow(10, -Math.max(0, rc.priceFormat.precision ?? 2));
}

/** Nearest integer bar index for a time (may be outside the data range). */
export function barIndexOf(ts: TimeScale, time: number): number {
  return Math.round(ts.timeToIndex(time));
}

/** Sum of bar volumes for the inclusive index range (clamped to data; NaN volumes count as 0). */
export function volumeBetween(bars: Bar[], i1: number, i2: number): number {
  const n = bars.length;
  if (!n) return 0;
  let a = Math.min(i1, i2), b = Math.max(i1, i2);
  if (b < 0 || a > n - 1) return 0;
  a = clamp(a, 0, n - 1);
  b = clamp(b, 0, n - 1);
  let sum = 0;
  for (let i = a; i <= b; i++) {
    const v = bars[i].volume;
    if (typeof v === 'number' && Number.isFinite(v)) sum += v;
  }
  return sum;
}

export interface RangeStats {
  dp: number;
  pct: number;
  pips: number;
  bars: number;
  seconds: number;
  volume: number;
}

/** Price/bars/time/volume statistics between two drawing points. */
export function rangeStats(rc: DrawingRenderContext, p1: DrawingPoint, p2: DrawingPoint): RangeStats {
  const ts = rc.timeScale;
  const i1 = ts.timeToIndex(p1.time);
  const i2 = ts.timeToIndex(p2.time);
  const dp = p2.price - p1.price;
  const pct = p1.price !== 0 ? (dp / p1.price) * 100 : 0;
  const tick = tickSize(rc);
  const pip = (rc.priceFormat.precision ?? 2) >= 4 ? tick * 10 : tick;
  return {
    dp,
    pct,
    pips: pip > 0 ? dp / pip : 0,
    bars: Math.round(i2 - i1),
    seconds: p2.time - p1.time,
    volume: volumeBetween(rc.mainSeries.bars, Math.round(i1), Math.round(i2)),
  };
}

export interface StatLabelOpts {
  bg: string | null;
  color: string;
  fontSize: number;
  align?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'middle' | 'bottom';
  bold?: boolean;
  italic?: boolean;
  border?: string | null;
}

/** Rounded multi-line stats label (TradingView style). Resets dash/alpha before drawing text. */
export function drawStatLabel(rc: DrawingRenderContext, lines: string[], x: number, y: number, o: StatLabelOpts): { x: number; y: number; w: number; h: number } {
  const { ctx } = rc;
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  return drawTextBox(ctx, lines.join('\n'), x, y, {
    font: fontFor(rc, o.fontSize, o.bold, o.italic),
    color: o.color,
    bg: o.bg,
    border: o.border ?? null,
    radius: 4,
    padding: 5,
    align: o.align ?? 'center',
    vAlign: o.vAlign ?? 'middle',
  });
}

function hitHandles(d: Drawing, x: number, y: number, rc: DrawingRenderContext): HitTarget {
  for (const h of d.handles(rc)) if (Math.hypot(h.x - x, h.y - y) <= 7) return { type: 'point', index: h.index };
  return null;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRICE_SOURCES: Array<{ value: string; label: string }> = [
  { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }, { value: 'close', label: 'Close' },
  { value: 'hl2', label: 'HL2' }, { value: 'hlc3', label: 'HLC3' }, { value: 'ohlc4', label: 'OHLC4' },
];

// =====================================================================================
// I.1 Long / Short position
// =====================================================================================

export interface PositionStats {
  entry: number; target: number; stop: number; tick: number;
  acct: number; riskSize: number; riskPct: number; qty: number;
  profit: number; loss: number; rr: number; openPnl: number | null;
  targetPct: number; stopPct: number; targetTicks: number; stopTicks: number;
}

/**
 * Risk/reward position tool. Points: [0] entry, [1] target (its time is the right edge), [2] stop
 * (same time as the target). Created with ONE click; the target/stop/width defaults are derived
 * from the visible price range on the first render (spec: (H−L)·20 ticks).
 */
abstract class PositionTool extends Drawing {
  static override pointsCount = 1;
  static override group = 'prediction' as const;
  protected abstract get isLong(): boolean;
  private _ts: TimeScale | null = null;
  private _tick = 0;

  defaultStyle(): Record<string, any> {
    return {
      linesColor: '#808080', linesWidth: 1,
      profitBackground: 'rgba(8, 153, 129, 0.2)', profitBackgroundTransparency: 80,
      stopBackground: 'rgba(242, 54, 69, 0.2)', stopBackgroundTransparency: 80,
      fillBackground: true, drawBorder: false, borderColor: '#667B8B',
      labelTextColor: '#FFFFFF', fontSize: 12, fillLabelBackground: true, labelBackgroundColor: '#585858',
      showPriceLabels: true, compact: false, alwaysShowStats: false,
      accountSize: 1000, lotSize: 1, risk: 25, riskDisplayMode: 'percents', leverage: 0, qtyPrecision: 2, pointValue: 1, currency: 'NONE',
    };
  }

  propertyDefs(): PropertyDef[] {
    return [
      P.color('linesColor', 'Lines'), P.lineWidth('linesWidth', 'Lines width'),
      P.color('stopBackground', 'Stop color'), P.int('stopBackgroundTransparency', 'Stop transparency', 0, 100),
      P.color('profitBackground', 'Target color'), P.int('profitBackgroundTransparency', 'Target transparency', 0, 100),
      P.bool('fillBackground', 'Fill background'), P.bool('drawBorder', 'Border'), P.color('borderColor', 'Border color'),
      P.section('Stats'),
      P.color('labelTextColor', 'Text'), P.fontSize('fontSize', 'Font size', 'Style'),
      P.bool('fillLabelBackground', 'Label background'), P.color('labelBackgroundColor', 'Label background color'),
      P.bool('showPriceLabels', 'Price labels'), P.bool('compact', 'Compact stats mode'), P.bool('alwaysShowStats', 'Always show stats'),
      P.number('accountSize', 'Account size', 0, undefined, 1, 'Inputs'),
      P.number('lotSize', 'Lot size', 0, undefined, undefined, 'Inputs'),
      P.number('risk', 'Risk', 0, undefined, undefined, 'Inputs'),
      P.select('riskDisplayMode', 'Risk mode', [{ value: 'percents', label: '%' }, { value: 'money', label: 'Money' }], 'Inputs'),
      P.number('leverage', 'Leverage (0 = off)', 0, undefined, undefined, 'Inputs'),
      P.int('qtyPrecision', 'Qty precision', 0, 8, 'Inputs'),
      P.number('pointValue', 'Point value', 0, undefined, undefined, 'Inputs'),
      P.text('currency', 'Currency', 'Inputs'),
    ];
  }

  override addPoint(p: DrawingPoint): boolean {
    this.points.push(p);
    return this.points.length >= 1;
  }

  /** Fill missing target/stop points from the visible price range (needs a render context). */
  protected ensureLevels(rc: DrawingRenderContext): void {
    this._ts = rc.timeScale;
    this._tick = tickSize(rc);
    if (!this.points.length || this.points.length >= 3) return;
    const ts = rc.timeScale;
    const e = this.points[0];
    const bars = rc.mainSeries.bars;
    const vb = ts.visibleBars();
    let hi = -Infinity, lo = Infinity;
    if (vb) for (let i = vb.from; i <= vb.to; i++) { const b = bars[i]; if (!b) continue; if (b.high > hi) hi = b.high; if (b.low < lo) lo = b.low; }
    let range = hi - lo;
    if (!Number.isFinite(range) || range <= 0) range = Math.abs(e.price) * 0.1 || 1;
    let dist = range * 20 * this._tick;
    if (!(dist > 0) || dist > range) dist = range * 0.2;
    const sign = this.isLong ? 1 : -1;
    const eIdx = ts.timeToIndex(e.time);
    const r = ts.visibleLogicalRange();
    const widthBars = Math.max(3, Math.round(Math.max(1, r.to - r.from) / 8));
    const rightTime = ts.indexToTime(eIdx + widthBars);
    if (!this.points[1]) this.points[1] = { time: rightTime, price: e.price + sign * dist };
    if (!this.points[2]) this.points[2] = { time: this.points[1].time, price: e.price - sign * dist };
  }

  /** Position sizing per the TradingView formulas. */
  stats(rc: DrawingRenderContext): PositionStats {
    this.ensureLevels(rc);
    const s = this.style;
    if (this.points.length < 3) {
      return { entry: 0, target: 0, stop: 0, tick: tickSize(rc), acct: 0, riskSize: 0, riskPct: 0, qty: 0, profit: 0, loss: 0, rr: 0, openPnl: null, targetPct: 0, stopPct: 0, targetTicks: 0, stopTicks: 0 };
    }
    const [e, t, st] = this.points;
    const entry = e.price, target = t.price, stop = st.price;
    const tick = tickSize(rc);
    const pv = Number(s.pointValue) > 0 ? Number(s.pointValue) : 1;
    const lot = Number(s.lotSize) > 0 ? Number(s.lotSize) : 1;
    const acct = Number(s.accountSize) || 0;
    const risk = Number(s.risk) || 0;
    const riskSize = s.riskDisplayMode === 'money' ? risk : (acct * risk) / 100;
    const stopDist = Math.abs(entry - stop);
    const targetDist = Math.abs(target - entry);
    let qty = stopDist > 0 ? riskSize / (stopDist * pv) / lot : 0;
    const lev = Number(s.leverage) || 0;
    if (lev > 0 && entry !== 0) qty = Math.min(qty, ((acct * lev) / Math.abs(entry)) * pv / lot);
    const prec = clamp(Math.round(Number(s.qtyPrecision) || 0), 0, 8);
    qty = Number(qty.toFixed(prec));
    const profit = targetDist * qty * pv * lot;
    const loss = stopDist * qty * pv * lot;
    const rr = stopDist > 0 ? targetDist / stopDist : 0;
    const bars = rc.mainSeries.bars;
    const last = bars[bars.length - 1];
    let openPnl: number | null = null;
    if (last) {
      const lo = Math.min(target, stop), hi = Math.max(target, stop);
      if (last.close >= lo && last.close <= hi) openPnl = (last.close - entry) * (this.isLong ? 1 : -1) * qty * pv * lot;
    }
    return {
      entry, target, stop, tick, acct, riskSize, riskPct: acct > 0 ? (riskSize / acct) * 100 : 0, qty, profit, loss, rr, openPnl,
      targetPct: entry !== 0 ? ((target - entry) / entry) * 100 : 0,
      stopPct: entry !== 0 ? ((stop - entry) / entry) * 100 : 0,
      targetTicks: tick > 0 ? targetDist / tick : 0,
      stopTicks: tick > 0 ? stopDist / tick : 0,
    };
  }

  private _labels(rc: DrawingRenderContext, st: PositionStats): { target: string[]; stop: string[]; entry: string[] } {
    const s = this.style;
    const fmt = rc.priceFormat;
    const cur = s.currency && s.currency !== 'NONE' ? ` ${s.currency}` : '';
    const money = (v: number) => `${v.toFixed(2)}${cur}`;
    const tPct = formatPercent(st.targetPct), sPct = formatPercent(st.stopPct);
    if (s.compact) {
      return {
        target: [`${formatPrice(st.target, fmt)} (${tPct})`, `RR ${st.rr.toFixed(2)}`],
        stop: [`${formatPrice(st.stop, fmt)} (${sPct})`],
        entry: [`Qty: ${st.qty}`],
      };
    }
    const entry: string[] = [];
    if (st.openPnl !== null) entry.push(`Open P&L: ${money(st.openPnl)}`);
    entry.push(`Qty: ${st.qty}, Risk: ${money(st.riskSize)} (${st.riskPct.toFixed(2)}%)`);
    entry.push(`Account at TP: ${money(st.acct + st.profit)}, at SL: ${money(st.acct - st.loss)}`);
    return {
      target: [`Target: ${formatPrice(st.target, fmt)} (${formatChange(st.target - st.entry, fmt)}, ${tPct}, ${Math.round(st.targetTicks)} ticks)`, `Amount: ${money(st.profit)}, Risk/Reward Ratio: ${st.rr.toFixed(2)}`],
      stop: [`Stop: ${formatPrice(st.stop, fmt)} (${formatChange(st.stop - st.entry, fmt)}, ${sPct}, ${Math.round(st.stopTicks)} ticks)`, `Amount: ${money(-st.loss)}`],
      entry,
    };
  }

  private _geom(rc: DrawingRenderContext) {
    const e = rc.toPixel(this.points[0]);
    const t = rc.toPixel(this.points[1]);
    const st = rc.toPixel(this.points[2]);
    const xl = e.x;
    const xr = Math.max(t.x, xl + 1);
    return { e, t, st, xl, xr, top: Math.min(t.y, st.y, e.y), bottom: Math.max(t.y, st.y, e.y) };
  }

  render(rc: DrawingRenderContext): void {
    if (!this.points.length) return;
    this.ensureLevels(rc);
    const { ctx } = rc;
    const s = this.style;
    const g = this._geom(rc);
    const w = g.xr - g.xl;
    if (s.fillBackground) {
      ctx.fillStyle = withAlpha(s.profitBackground, (100 - (Number(s.profitBackgroundTransparency) || 0)) / 100);
      ctx.fillRect(g.xl, Math.min(g.e.y, g.t.y), w, Math.abs(g.t.y - g.e.y));
      ctx.fillStyle = withAlpha(s.stopBackground, (100 - (Number(s.stopBackgroundTransparency) || 0)) / 100);
      ctx.fillRect(g.xl, Math.min(g.e.y, g.st.y), w, Math.abs(g.st.y - g.e.y));
    }
    applyLine(ctx, s.linesColor, s.linesWidth, 0);
    for (const y of [g.t.y, g.e.y, g.st.y]) {
      const yy = crisp(y, rc.dpr, s.linesWidth);
      ctx.beginPath(); ctx.moveTo(g.xl, yy); ctx.lineTo(g.xr, yy); ctx.stroke();
    }
    if (s.drawBorder && w > 1 && g.bottom - g.top > 1) {
      applyLine(ctx, s.borderColor, 1, 0);
      ctx.strokeRect(g.xl + 0.5, g.top + 0.5, w - 1, g.bottom - g.top - 1);
    }
    const st = this.stats(rc);
    const showStats = s.alwaysShowStats || rc.selected || rc.hovered || rc.creating;
    const cx = (g.xl + g.xr) / 2;
    const bg = s.fillLabelBackground ? s.labelBackgroundColor : null;
    const lo: StatLabelOpts = { bg, color: s.labelTextColor, fontSize: s.fontSize };
    if (showStats) {
      const labels = this._labels(rc, st);
      const tAbove = g.t.y <= g.e.y;
      drawStatLabel(rc, labels.target, cx, tAbove ? g.t.y - 3 : g.t.y + 3, { ...lo, vAlign: tAbove ? 'bottom' : 'top' });
      const sAbove = g.st.y < g.e.y;
      drawStatLabel(rc, labels.stop, cx, sAbove ? g.st.y - 3 : g.st.y + 3, { ...lo, vAlign: sAbove ? 'bottom' : 'top' });
      drawStatLabel(rc, labels.entry, cx, g.e.y, { ...lo, vAlign: 'middle' });
    }
    if (s.showPriceLabels) {
      const tags: Array<[number, number, string]> = [[st.target, g.t.y, '#089981'], [st.entry, g.e.y, s.linesColor], [st.stop, g.st.y, '#F23645']];
      for (const [price, y, color] of tags) {
        drawStatLabel(rc, [formatPrice(price, rc.priceFormat)], rc.width - 2, y, { bg: color, color: '#FFFFFF', fontSize: 11, align: 'right', vAlign: 'middle' });
      }
    }
  }

  override handles(rc: DrawingRenderContext): Array<PixelPoint & { index: number }> {
    if (!this.points.length) return [];
    this.ensureLevels(rc);
    const g = this._geom(rc);
    const cx = (g.xl + g.xr) / 2;
    return [
      { x: g.xl, y: g.e.y, index: 0 },
      { x: cx, y: g.t.y, index: 1 },
      { x: cx, y: g.st.y, index: 2 },
      { x: g.xr, y: g.e.y, index: 3 },
    ];
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    this.ensureLevels(rc);
    const h = hitHandles(this, x, y, rc);
    if (h) return h;
    const g = this._geom(rc);
    if (pointInRect(x, y, g.xl - HIT_TOLERANCE, g.top - HIT_TOLERANCE, g.xr + HIT_TOLERANCE, g.bottom + HIT_TOLERANCE)) return { type: 'body' };
    return null;
  }

  override movePoint(index: number, p: DrawingPoint): void {
    if (this.points.length < 3) { if (this.points[index]) this.points[index] = p; return; }
    const [e, t, st] = this.points;
    const tick = this._tick || 0;
    const ts = this._ts;
    if (index === 0) {
      const dPrice = p.price - e.price;
      if (ts) {
        const dIdx = ts.timeToIndex(p.time) - ts.timeToIndex(e.time);
        this.points = this.points.map((q) => ({ time: ts.indexToTime(ts.timeToIndex(q.time) + dIdx), price: q.price + dPrice }));
      } else {
        const dt = p.time - e.time;
        this.points = this.points.map((q) => ({ time: q.time + dt, price: q.price + dPrice }));
      }
      return;
    }
    if (index === 1) {
      const price = this.isLong ? Math.max(e.price + tick, p.price) : Math.min(e.price - tick, p.price);
      this.points[1] = { time: t.time, price };
      return;
    }
    if (index === 2) {
      const price = this.isLong ? Math.min(e.price - tick, p.price) : Math.max(e.price + tick, p.price);
      this.points[2] = { time: st.time, price };
      return;
    }
    if (index === 3) {
      let time = p.time;
      if (ts) {
        const ei = ts.timeToIndex(e.time);
        time = ts.indexToTime(Math.max(Math.round(ei) + 1, Math.round(ts.timeToIndex(p.time))));
      } else if (time <= e.time) time = t.time;
      this.points[1] = { time, price: t.price };
      this.points[2] = { time, price: st.price };
    }
  }
}

export class LongPosition extends PositionTool {
  static override toolId = 'long_position';
  static override toolName = 'Long Position';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M5 5h18v1H5zM5 13h18v1H5zM5 22h18v1H5z"/><path fill="currentColor" opacity=".35" d="M5 6h18v7H5z"/><path fill="currentColor" opacity=".15" d="M5 14h18v8H5z"/></svg>';
  protected get isLong(): boolean { return true; }
}

export class ShortPosition extends PositionTool {
  static override toolId = 'short_position';
  static override toolName = 'Short Position';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M5 5h18v1H5zM5 13h18v1H5zM5 22h18v1H5z"/><path fill="currentColor" opacity=".15" d="M5 6h18v7H5z"/><path fill="currentColor" opacity=".35" d="M5 14h18v8H5z"/></svg>';
  protected get isLong(): boolean { return false; }
}

// =====================================================================================
// I.2 Forecast
// =====================================================================================

export type ForecastState = 'none' | 'pending' | 'success' | 'failure';

export class Forecast extends Drawing {
  static override toolId = 'forecast';
  static override toolName = 'Forecast';
  static override pointsCount = 2;
  static override group = 'prediction' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M6 20l4-4 3 3 8-8 .7.7-8.7 8.7-3-3L6.7 20.7z"/><path fill="currentColor" d="M22 11l-4 0 0-1 5 0 0 5-1 0z"/><path fill="currentColor" d="M8 20a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/></svg>';

  defaultStyle(): Record<string, any> {
    return {
      lineColor: '#2962FF', lineWidth: 2, lineStyle: 2,
      sourceBackColor: '#2962FF', sourceStrokeColor: '#2962FF', sourceTextColor: '#FFFFFF',
      targetBackColor: '#2962FF', targetStrokeColor: '#2962FF', targetTextColor: '#FFFFFF',
      successBackground: '#4CAF50', successTextColor: '#FFFFFF',
      failureBackground: '#F23645', failureTextColor: '#FFFFFF',
      intermediateBackColor: '#EAD289', intermediateTextColor: '#6D4D22',
      centersColor: '#202020', transparency: 10, fontSize: 12,
    };
  }

  propertyDefs(): PropertyDef[] {
    return [
      P.color('lineColor', 'Line'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'),
      P.color('centersColor', 'Markers'), P.int('transparency', 'Transparency', 0, 100),
      P.section('Source'), P.color('sourceBackColor', 'Background'), P.color('sourceStrokeColor', 'Border'), P.color('sourceTextColor', 'Text'),
      P.section('Target'), P.color('targetBackColor', 'Background'), P.color('targetStrokeColor', 'Border'), P.color('targetTextColor', 'Text'),
      P.section('Success'), P.color('successBackground', 'Background'), P.color('successTextColor', 'Text'),
      P.section('Failure'), P.color('failureBackground', 'Background'), P.color('failureTextColor', 'Text'),
      P.section('Pending'), P.color('intermediateBackColor', 'Background'), P.color('intermediateTextColor', 'Text'),
      P.fontSize('fontSize', 'Font size', 'Text'),
    ];
  }

  /** Outcome of the forecast against the loaded bars. */
  state(rc: DrawingRenderContext): ForecastState {
    const bars = rc.mainSeries.bars;
    if (!bars.length || this.points.length < 2 || rc.creating || this.creating) return 'none';
    const [a, b] = this.points;
    const last = bars[bars.length - 1];
    const t1 = Math.max(a.time, b.time);
    if (last.time < t1) return 'pending';
    const ts = rc.timeScale;
    const i0 = clamp(Math.round(ts.timeToIndex(Math.min(a.time, b.time))), 0, bars.length - 1);
    const i1 = clamp(Math.round(ts.timeToIndex(t1)), 0, bars.length - 1);
    const up = b.price >= a.price;
    for (let i = i0; i <= i1; i++) {
      const bar = bars[i];
      if (up ? bar.high >= b.price : bar.low <= b.price) return 'success';
    }
    return 'failure';
  }

  render(rc: DrawingRenderContext): void {
    if (this.points.length < 1) return;
    const { ctx } = rc;
    const s = this.style;
    const p1 = this.points[0];
    const p2 = this.points[1] ?? p1;
    const a = rc.toPixel(p1);
    const b = rc.toPixel(p2);
    applyLine(ctx, s.lineColor, s.lineWidth, s.lineStyle);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    if (b.x !== a.x || b.y !== a.y) drawArrowHead(ctx, a, b, 8 + s.lineWidth * 2);
    ctx.fillStyle = s.centersColor;
    for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
    const alpha = (100 - (Number(s.transparency) || 0)) / 100;
    const st = this.state(rc);
    const fmt = rc.priceFormat;
    const ts = rc.timeScale;
    const rightward = b.x >= a.x;
    // source label
    drawStatLabel(rc, [formatPrice(p1.price, fmt), ts.formatCrosshairTime(p1.time)], rightward ? a.x - 8 : a.x + 8, a.y, {
      bg: withAlpha(s.sourceBackColor, alpha), border: s.sourceStrokeColor, color: s.sourceTextColor, fontSize: s.fontSize, align: rightward ? 'right' : 'left',
    });
    if (this.points.length < 2) return;
    // target label
    const stats = rangeStats(rc, p1, p2);
    let bg = s.targetBackColor, color = s.targetTextColor, border = s.targetStrokeColor;
    if (st === 'pending') { bg = s.intermediateBackColor; color = s.intermediateTextColor; border = s.intermediateBackColor; }
    else if (st === 'success') { bg = s.successBackground; color = s.successTextColor; border = s.successBackground; }
    else if (st === 'failure') { bg = s.failureBackground; color = s.failureTextColor; border = s.failureBackground; }
    const lines = [
      `${formatPrice(p2.price, fmt)} (${formatChange(stats.dp, fmt)}, ${formatPercent(stats.pct)})`,
      `${Math.abs(stats.bars)} bars, ${formatDuration(stats.seconds)}`,
      ts.formatCrosshairTime(p2.time),
    ];
    if (st === 'success') lines.push('Success');
    else if (st === 'failure') lines.push('Failure');
    else if (st === 'pending') lines.push('Pending');
    drawStatLabel(rc, lines, rightward ? b.x + 8 : b.x - 8, b.y, { bg: withAlpha(bg, alpha), border, color, fontSize: s.fontSize, align: rightward ? 'left' : 'right' });
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const h = hitHandles(this, x, y, rc);
    if (h) return h;
    if (this.points.length < 2) return null;
    const a = rc.toPixel(this.points[0]), b = rc.toPixel(this.points[1]);
    return distToSegment(x, y, a.x, a.y, b.x, b.y) <= HIT_TOLERANCE + this.style.lineWidth / 2 ? { type: 'body' } : null;
  }
}

// =====================================================================================
// I.3 Bars pattern
// =====================================================================================

export interface BarsPatternData {
  /** [open, high, low, close] per copied bar, in chart order */
  bars: number[][];
  /** price of points[0] at capture time (offset reference) */
  refPrice: number;
}

export class BarsPattern extends Drawing {
  static override toolId = 'bars_pattern';
  static override toolName = 'Bars Pattern';
  static override pointsCount = 2;
  static override group = 'prediction' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M7 8h1v12H7zM5 11h2v1H5zM8 15h2v1H8zM12 6h1v14h-1zM10 9h2v1h-2zM13 12h2v1h-2zM17 9h1v12h-1zM15 13h2v1h-2zM18 17h2v1h-2zM22 5h1v13h-1zM20 8h2v1h-2zM23 14h2v1h-2z"/></svg>';
  private _bbox: { x1: number; y1: number; x2: number; y2: number } | null = null;

  defaultStyle(): Record<string, any> {
    return { color: '#2962FF', mode: 0, mirrored: false, flipped: false, transparency: 25, pattern: null as BarsPatternData | null };
  }

  propertyDefs(): PropertyDef[] {
    return [
      P.color('color', 'Color'),
      P.select('mode', 'Mode', [
        { value: 0, label: 'Bars' }, { value: 1, label: 'Line' }, { value: 2, label: 'Open close' }, { value: 3, label: 'Line open' },
        { value: 4, label: 'Line HL' }, { value: 5, label: 'Line low' }, { value: 6, label: 'Line HL2' },
      ]),
      P.bool('mirrored', 'Mirrored'), P.bool('flipped', 'Flipped'), P.int('transparency', 'Transparency', 0, 100),
    ];
  }

  private _rangeIndices(rc: DrawingRenderContext): { lo: number; hi: number } | null {
    if (this.points.length < 2) return null;
    const ts = rc.timeScale;
    const bars = rc.mainSeries.bars;
    if (!bars.length) return null;
    const i1 = barIndexOf(ts, this.points[0].time), i2 = barIndexOf(ts, this.points[1].time);
    let lo = Math.min(i1, i2), hi = Math.max(i1, i2);
    if (hi < 0 || lo > bars.length - 1) return null;
    lo = clamp(lo, 0, bars.length - 1);
    hi = clamp(hi, 0, bars.length - 1);
    return { lo, hi };
  }

  /** Bars currently under the two points (used as a live preview while creating). */
  private _livePattern(rc: DrawingRenderContext): { data: BarsPatternData; anchorIdx: number } | null {
    const r = this._rangeIndices(rc);
    if (!r) return null;
    const bars = rc.mainSeries.bars.slice(r.lo, r.hi + 1).map((b) => [b.open, b.high, b.low, b.close]);
    const left = this.points[0].time <= this.points[1].time ? this.points[0] : this.points[1];
    return { data: { bars, refPrice: left.price }, anchorIdx: r.lo };
  }

  /** Snapshot the bars between the points once creation is finished. */
  private _capture(rc: DrawingRenderContext): void {
    const pat = this.style.pattern as BarsPatternData | null;
    if (pat && Array.isArray(pat.bars) && pat.bars.length) return;
    const live = this._livePattern(rc);
    if (!live) return;
    if (this.points[0].time > this.points[1].time) this.points = [this.points[1], this.points[0]];
    this.style.pattern = live.data;
  }

  /** Pattern to draw with its anchor index (index of the first drawn bar). */
  pattern(rc: DrawingRenderContext): { data: BarsPatternData; anchorIdx: number } | null {
    const creating = this.creating || rc.creating;
    if (!creating) this._capture(rc);
    const pat = this.style.pattern as BarsPatternData | null;
    if (!creating && pat && Array.isArray(pat.bars) && pat.bars.length && this.points.length) {
      return { data: pat, anchorIdx: barIndexOf(rc.timeScale, this.points[0].time) };
    }
    return this._livePattern(rc);
  }

  render(rc: DrawingRenderContext): void {
    this._bbox = null;
    if (this.points.length < 2) return;
    const p = this.pattern(rc);
    if (!p || !p.data.bars.length) return;
    const { ctx } = rc;
    const s = this.style;
    const ts = rc.timeScale;
    const ps = rc.priceScale;
    let bars = p.data.bars;
    if (s.flipped) bars = bars.slice().reverse();
    const offset = this.points[0].price - p.data.refPrice;
    const ref = bars[0][0];
    const tf = (v: number) => (s.mirrored ? 2 * ref - v : v) + offset;
    const half = Math.max(1, ts.barSpacing * 0.35);
    const mode = Number(s.mode) || 0;
    let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
    ctx.save();
    ctx.globalAlpha = clamp((100 - (Number(s.transparency) || 0)) / 100, 0, 1);
    applyLine(ctx, s.color, 1, 0);
    ctx.fillStyle = s.color;
    if (mode === 0 || mode === 2) {
      for (let k = 0; k < bars.length; k++) {
        const [o, h, l, c] = bars[k].map(tf);
        const x = ts.barCenterX(p.anchorIdx + k);
        const yo = ps.priceToY(o), yh = ps.priceToY(h), yl = ps.priceToY(l), yc = ps.priceToY(c);
        x1 = Math.min(x1, x - half); x2 = Math.max(x2, x + half);
        y1 = Math.min(y1, yh, yo, yc); y2 = Math.max(y2, yl, yo, yc);
        if (mode === 0) {
          const xx = crisp(x, rc.dpr, 1);
          ctx.beginPath();
          ctx.moveTo(xx, yh); ctx.lineTo(xx, yl);
          ctx.moveTo(x - half, crisp(yo, rc.dpr, 1)); ctx.lineTo(xx, crisp(yo, rc.dpr, 1));
          ctx.moveTo(xx, crisp(yc, rc.dpr, 1)); ctx.lineTo(x + half, crisp(yc, rc.dpr, 1));
          ctx.stroke();
        } else {
          const top = Math.min(yo, yc);
          ctx.fillRect(x - half, top, half * 2, Math.max(1, Math.abs(yc - yo)));
        }
      }
    } else {
      const pick = (b: number[]): number => {
        const [o, h, l, c] = b;
        switch (mode) {
          case 3: return o;
          case 4: return h;
          case 5: return l;
          case 6: return (h + l) / 2;
          default: return c;
        }
      };
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < bars.length; k++) {
        const x = ts.barCenterX(p.anchorIdx + k);
        const y = ps.priceToY(tf(pick(bars[k])));
        x1 = Math.min(x1, x - half); x2 = Math.max(x2, x + half);
        y1 = Math.min(y1, y - 2); y2 = Math.max(y2, y + 2);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    if (Number.isFinite(x1) && Number.isFinite(y1)) this._bbox = { x1, y1, x2, y2 };
  }

  override handles(rc: DrawingRenderContext): Array<PixelPoint & { index: number }> {
    if (!this.points.length) return [];
    const p = this.pattern(rc);
    if (!p || !p.data.bars.length) return super.handles(rc);
    const ts = rc.timeScale;
    const y = rc.toPixel(this.points[0]).y;
    return [
      { x: ts.barCenterX(p.anchorIdx), y, index: 0 },
      { x: ts.barCenterX(p.anchorIdx + p.data.bars.length - 1), y, index: 1 },
    ];
  }

  override movePoint(index: number, p: DrawingPoint): void {
    const cur = this.points[index];
    if (!cur) return;
    const dt = p.time - cur.time, dp = p.price - cur.price;
    this.points = this.points.map((q) => ({ time: q.time + dt, price: q.price + dp }));
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const h = hitHandles(this, x, y, rc);
    if (h) return h;
    const b = this._bbox;
    if (b && pointInRect(x, y, b.x1 - HIT_TOLERANCE, b.y1 - HIT_TOLERANCE, b.x2 + HIT_TOLERANCE, b.y2 + HIT_TOLERANCE)) return { type: 'body' };
    return null;
  }
}

// =====================================================================================
// I.4 Ghost feed
// =====================================================================================

export interface GhostCandle { idx: number; open: number; high: number; low: number; close: number }

export class GhostFeed extends Drawing {
  static override toolId = 'ghost_feed';
  static override toolName = 'Ghost Feed';
  /** 2 = click-per-point creation; `isComplete()` keeps it open until a double-click. */
  static override pointsCount = 2;
  static override group = 'prediction' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" opacity=".5" d="M6 12h3v8H6zM7 10h1v2H7zM7 20h1v2H7zM11 9h3v7h-3zM12 7h1v2h-1zM12 16h1v2h-1zM16 12h3v6h-3zM17 10h1v2h-1zM17 18h1v2h-1zM21 7h3v8h-3zM22 5h1v2h-1zM22 15h1v2h-1z"/></svg>';
  private _cache: { key: string; candles: GhostCandle[] } | null = null;

  defaultStyle(): Record<string, any> {
    return {
      averageHL: 20, variance: 50,
      upColor: '#ACE5DC', downColor: '#FAA1A4', borderUpColor: '#089981', borderDownColor: '#F23645', borderColor: '#378658', wickColor: '#808080',
      drawBorder: true, drawWick: true, transparency: 50,
    };
  }

  propertyDefs(): PropertyDef[] {
    return [
      P.int('averageHL', 'Average HL (ticks)', 1, 100000, 'Inputs'), P.int('variance', 'Variance (ticks)', 0, 100000, 'Inputs'),
      P.color('upColor', 'Up color'), P.color('downColor', 'Down color'),
      P.bool('drawBorder', 'Borders'), P.color('borderUpColor', 'Border up'), P.color('borderDownColor', 'Border down'), P.color('borderColor', 'Border'),
      P.bool('drawWick', 'Wicks'), P.color('wickColor', 'Wick color'), P.int('transparency', 'Transparency', 0, 100),
    ];
  }

  override addPoint(p: DrawingPoint): boolean { this.points.push(p); return false; }
  override isComplete(): boolean { return !this.creating && this.points.length >= 2; }
  override onChanged(): void { this._cache = null; }

  /** Synthetic candles along the path (deterministic per drawing id; cached). */
  candles(rc: DrawingRenderContext): GhostCandle[] {
    const ts = rc.timeScale;
    const tick = tickSize(rc);
    const s = this.style;
    const key = `${this.points.map((p) => `${p.time}:${p.price}`).join('|')}#${s.averageHL}#${s.variance}#${tick}#${ts.length}`;
    if (this._cache && this._cache.key === key) return this._cache.candles;
    const out: GhostCandle[] = [];
    const avgHL = Math.max(0, Number(s.averageHL) || 0) * tick;
    const variance = Math.max(0, Number(s.variance) || 0) * tick;
    const base = hashStr(this.id);
    for (let seg = 0; seg + 1 < this.points.length; seg++) {
      const a = this.points[seg], b = this.points[seg + 1];
      const ia = barIndexOf(ts, a.time), ib = barIndexOf(ts, b.time);
      const n = Math.abs(ib - ia);
      if (n === 0) continue;
      const rand = mulberry32(base + seg * 7919);
      const dir = ib > ia ? 1 : -1;
      let prevClose = a.price;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const lineP = a.price + (b.price - a.price) * t;
        const close = k === n ? b.price : lineP + (rand() - 0.5) * 2 * variance;
        const open = prevClose;
        const body = Math.abs(close - open);
        let range = avgHL * (0.6 + 0.8 * rand());
        if (range < body) range = body * (1 + 0.2 * rand());
        const extra = range - body;
        const up = extra * rand();
        out.push({ idx: ia + dir * k, open, high: Math.max(open, close) + up, low: Math.min(open, close) - (extra - up), close });
        prevClose = close;
      }
    }
    this._cache = { key, candles: out };
    return out;
  }

  render(rc: DrawingRenderContext): void {
    if (this.points.length < 1) return;
    const { ctx } = rc;
    const s = this.style;
    const ts = rc.timeScale;
    const ps = rc.priceScale;
    const candles = this.candles(rc);
    const half = Math.max(1, ts.barSpacing * 0.35);
    ctx.save();
    ctx.globalAlpha = clamp((100 - (Number(s.transparency) || 0)) / 100, 0, 1);
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    for (const c of candles) {
      const x = ts.barCenterX(c.idx);
      const yo = ps.priceToY(c.open), yc = ps.priceToY(c.close), yh = ps.priceToY(c.high), yl = ps.priceToY(c.low);
      const up = c.close >= c.open;
      if (s.drawWick) {
        ctx.strokeStyle = s.wickColor;
        const xx = crisp(x, rc.dpr, 1);
        ctx.beginPath(); ctx.moveTo(xx, yh); ctx.lineTo(xx, yl); ctx.stroke();
      }
      const top = Math.min(yo, yc);
      const h = Math.max(1, Math.abs(yc - yo));
      ctx.fillStyle = up ? s.upColor : s.downColor;
      ctx.fillRect(x - half, top, half * 2, h);
      if (s.drawBorder) {
        ctx.strokeStyle = up ? s.borderUpColor : s.borderDownColor;
        ctx.strokeRect(x - half + 0.5, top + 0.5, Math.max(0, half * 2 - 1), Math.max(0, h - 1));
      }
    }
    ctx.restore();
    if ((rc.creating || this.creating || rc.selected) && this.points.length >= 2) {
      applyLine(ctx, s.borderColor, 1, 2);
      ctx.beginPath();
      this.points.forEach((p, i) => { const px = rc.toPixel(p); if (i === 0) ctx.moveTo(px.x, px.y); else ctx.lineTo(px.x, px.y); });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const h = hitHandles(this, x, y, rc);
    if (h) return h;
    const px = this.points.map((p) => rc.toPixel(p));
    for (let i = 1; i < px.length; i++) if (distToSegment(x, y, px[i - 1].x, px[i - 1].y, px[i].x, px[i].y) <= HIT_TOLERANCE + 2) return { type: 'body' };
    const ts = rc.timeScale, ps = rc.priceScale;
    const half = Math.max(1, ts.barSpacing * 0.35);
    for (const c of this.candles(rc)) {
      const cx = ts.barCenterX(c.idx);
      if (Math.abs(cx - x) <= half + 1 && y >= ps.priceToY(c.high) - 1 && y <= ps.priceToY(c.low) + 1) return { type: 'body' };
    }
    return null;
  }
}

// =====================================================================================
// I.5 Projection ("Sector")
// =====================================================================================

export class Projection extends Drawing {
  static override toolId = 'projection';
  static override toolName = 'Projection';
  static override pointsCount = 3;
  static override group = 'prediction' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" opacity=".35" d="M5 14L23 5v9z"/><path fill="currentColor" opacity=".2" d="M5 14l18 0v9z"/><path fill="currentColor" d="M5 13.5h18v1H5z"/><path fill="currentColor" d="M5.2 14.4l-.4-.9L22.8 4.5l.4.9zM4.8 13.6l.4-.9 18 9-.4.9z"/></svg>';

  defaultStyle(): Record<string, any> {
    return {
      color1: 'rgba(41, 98, 255, 0.2)', color2: 'rgba(156, 39, 176, 0.2)', lineWidth: 2, fillBackground: true, transparency: 80, showCoeffs: true,
      trendlineVisible: true, trendlineColor: '#9C9C9C', trendlineStyle: 0,
      level1Coeff: 1, level1Color: '#808080', level1Visible: true, level1Width: 2, level1Style: 0,
    };
  }

  propertyDefs(): PropertyDef[] {
    return [
      P.color('color1', 'Up color'), P.color('color2', 'Down color'), P.bool('fillBackground', 'Background'), P.int('transparency', 'Transparency', 0, 100),
      P.lineWidth('lineWidth', 'Line width'), P.bool('showCoeffs', 'Show coefficients'),
      P.section('Trend line'), P.bool('trendlineVisible', 'Visible'), P.color('trendlineColor', 'Color'), P.lineStyle('trendlineStyle', 'Style'),
      P.section('Level 1'), P.bool('level1Visible', 'Visible'), P.number('level1Coeff', 'Coefficient', 0, 10, 0.1), P.color('level1Color', 'Color'), P.lineWidth('level1Width', 'Width'), P.lineStyle('level1Style', 'Style'),
    ];
  }

  /** Pixel geometry: trend line a→b, its projection q at the third point's x, wedge edges c (p3) and c2 (mirror of p3 across the line). */
  private _geom(rc: DrawingRenderContext) {
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    const c = rc.toPixel(this.points[2] ?? this.points[1] ?? this.points[0]);
    const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x);
    const q = { x: c.x, y: a.y + slope * (c.x - a.x) };
    const h = c.y - q.y;
    const coeff = Number(this.style.level1Coeff);
    const k = Number.isFinite(coeff) ? coeff : 1;
    const c1 = { x: c.x, y: q.y + k * h };
    const c2 = { x: c.x, y: q.y - k * h };
    return { a, b, c, q, h, c1, c2 };
  }

  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const { ctx } = rc;
    const s = this.style;
    const g = this._geom(rc);
    const alpha = clamp((100 - (Number(s.transparency) || 0)) / 100, 0, 1);
    if (this.points.length >= 3 && s.fillBackground && Math.abs(g.h) > 0.5) {
      const upper = g.c1.y <= g.c2.y ? g.c1 : g.c2;
      const lower = upper === g.c1 ? g.c2 : g.c1;
      ctx.fillStyle = withAlpha(s.color1, alpha);
      ctx.beginPath(); ctx.moveTo(g.a.x, g.a.y); ctx.lineTo(g.q.x, g.q.y); ctx.lineTo(upper.x, upper.y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = withAlpha(s.color2, alpha);
      ctx.beginPath(); ctx.moveTo(g.a.x, g.a.y); ctx.lineTo(g.q.x, g.q.y); ctx.lineTo(lower.x, lower.y); ctx.closePath(); ctx.fill();
    }
    if (s.trendlineVisible) {
      applyLine(ctx, s.trendlineColor, s.lineWidth, s.trendlineStyle);
      ctx.beginPath(); ctx.moveTo(g.a.x, g.a.y); ctx.lineTo(g.b.x, g.b.y); ctx.stroke();
      if (this.points.length >= 3 && Math.abs(g.q.x - g.b.x) > 0.5) {
        applyLine(ctx, s.trendlineColor, 1, 2);
        ctx.beginPath(); ctx.moveTo(g.b.x, g.b.y); ctx.lineTo(g.q.x, g.q.y); ctx.stroke();
      }
    }
    if (this.points.length >= 3 && s.level1Visible) {
      applyLine(ctx, s.level1Color, s.level1Width, s.level1Style);
      for (const e of [g.c1, g.c2]) { ctx.beginPath(); ctx.moveTo(g.a.x, g.a.y); ctx.lineTo(e.x, e.y); ctx.stroke(); }
      ctx.setLineDash([]);
      if (s.showCoeffs) {
        const label = String(Number(s.level1Coeff) || 0);
        const align = g.c.x >= g.a.x ? 'left' : 'right';
        for (const e of [g.c1, g.c2]) drawTextBox(ctx, label, e.x + (align === 'left' ? 4 : -4), e.y, { font: fontFor(rc, 11), color: s.level1Color, align, vAlign: 'middle', padding: 2 });
      }
    }
    ctx.setLineDash([]);
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const h = hitHandles(this, x, y, rc);
    if (h) return h;
    const g = this._geom(rc);
    const tol = HIT_TOLERANCE + this.style.lineWidth / 2;
    if (distToSegment(x, y, g.a.x, g.a.y, g.b.x, g.b.y) <= tol) return { type: 'body' };
    if (this.points.length >= 3) {
      if (distToSegment(x, y, g.a.x, g.a.y, g.c1.x, g.c1.y) <= tol || distToSegment(x, y, g.a.x, g.a.y, g.c2.x, g.c2.y) <= tol) return { type: 'body' };
      if (pointInPolygon(x, y, [g.a, g.c1, g.c2])) return { type: 'body', part: 'inside' };
    }
    return null;
  }
}

// =====================================================================================
// I.6 – I.8 Range tools
// =====================================================================================

const rangeBaseStyle = () => ({
  lineColor: '#2962FF', lineWidth: 2, fillBackground: true, backgroundColor: '#2962FF', backgroundTransparency: 60,
  drawBorder: false, borderColor: '#2962FF', borderWidth: 1,
  fillLabelBackground: true, labelBackgroundColor: '#585858', labelTextColor: '#FFFFFF', fontSize: 12,
  showText: false, text: '', customTextColor: '#2962FF', customFontSize: 12, customBold: false, customItalic: false,
});

function rangeBaseProps(extra: PropertyDef[]): PropertyDef[] {
  return [
    P.color('lineColor', 'Line'), P.lineWidth('lineWidth'),
    P.bool('fillBackground', 'Background'), P.color('backgroundColor', 'Background color'), P.int('backgroundTransparency', 'Background transparency', 0, 100),
    P.bool('drawBorder', 'Border'), P.color('borderColor', 'Border color'), P.lineWidth('borderWidth', 'Border width'),
    ...extra,
    P.section('Label'), P.bool('fillLabelBackground', 'Label background'), P.color('labelBackgroundColor', 'Label background color'), P.color('labelTextColor', 'Label text'), P.fontSize('fontSize', 'Font size', 'Style'),
    P.bool('showText', 'Show text', 'Text'), P.text('text', 'Text'), P.color('customTextColor', 'Text color', 'Text'), P.fontSize('customFontSize'), P.bool('customBold', 'Bold', 'Text'), P.bool('customItalic', 'Italic', 'Text'),
  ];
}

abstract class RangeTool extends Drawing {
  static override pointsCount = 2;
  static override group = 'prediction' as const;

  /** Pixel rectangle spanned by the two points (with tool-specific extension). */
  protected rect(rc: DrawingRenderContext): { x1: number; y1: number; x2: number; y2: number } {
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
  }

  protected fillAndBorder(rc: DrawingRenderContext, r: { x1: number; y1: number; x2: number; y2: number }): void {
    const { ctx } = rc;
    const s = this.style;
    if (s.fillBackground) {
      ctx.fillStyle = withAlpha(s.backgroundColor, clamp((100 - (Number(s.backgroundTransparency) || 0)) / 100, 0, 1));
      ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    }
    if (s.drawBorder) {
      applyLine(ctx, s.borderColor, s.borderWidth, 0);
      ctx.strokeRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    }
  }

  protected label(rc: DrawingRenderContext, lines: string[], x: number, y: number, vAlign: 'top' | 'middle' | 'bottom' = 'middle'): void {
    const s = this.style;
    if (s.showText && s.text) lines = [...lines, String(s.text)];
    if (!lines.length) return;
    drawStatLabel(rc, lines, x, y, { bg: s.fillLabelBackground ? s.labelBackgroundColor : null, color: s.labelTextColor, fontSize: s.fontSize, vAlign });
  }

  protected renderCustomTextOnly(rc: DrawingRenderContext, x: number, y: number): void {
    const s = this.style;
    if (!s.showText || !s.text) return;
    const { ctx } = rc;
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    drawTextBox(ctx, String(s.text), x, y, { font: fontFor(rc, s.customFontSize, s.customBold, s.customItalic), color: s.customTextColor, align: 'center', vAlign: 'top', padding: 2 });
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const h = hitHandles(this, x, y, rc);
    if (h) return h;
    const r = this.rect(rc);
    if (pointInRect(x, y, r.x1 - HIT_TOLERANCE, r.y1 - HIT_TOLERANCE, r.x2 + HIT_TOLERANCE, r.y2 + HIT_TOLERANCE)) return { type: 'body' };
    return null;
  }
}

export class PriceRange extends RangeTool {
  static override toolId = 'price_range';
  static override toolName = 'Price Range';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M13.5 6h1v16h-1z"/><path fill="currentColor" d="M8 5.5h12v1H8zM8 21.5h12v1H8z"/><path fill="currentColor" d="M14 5l3 3.5h-6zM14 23l-3-3.5h6z"/></svg>';
  defaultStyle(): Record<string, any> { return { ...rangeBaseStyle(), extendLeft: false, extendRight: false, showPriceRange: true, showPercentPriceRange: true, showPipsPriceRange: true }; }
  propertyDefs(): PropertyDef[] {
    return rangeBaseProps([P.bool('extendLeft', 'Extend left'), P.bool('extendRight', 'Extend right'), P.section('Stats'), P.bool('showPriceRange', 'Price range'), P.bool('showPercentPriceRange', 'Percent change'), P.bool('showPipsPriceRange', 'Change in pips')]);
  }
  protected override rect(rc: DrawingRenderContext) {
    const r = super.rect(rc);
    if (this.style.extendLeft) r.x1 = -10;
    if (this.style.extendRight) r.x2 = rc.width + 10;
    return r;
  }
  render(rc: DrawingRenderContext): void {
    if (this.points.length < 1) return;
    const { ctx } = rc;
    const s = this.style;
    const r = this.rect(rc);
    this.fillAndBorder(rc, r);
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    const cx = (Math.min(a.x, b.x) + Math.max(a.x, b.x)) / 2;
    applyLine(ctx, s.lineColor, s.lineWidth, 0);
    // top/bottom caps span the box, vertical line with an arrow head toward p2
    for (const y of [r.y1, r.y2]) { const yy = crisp(y, rc.dpr, s.lineWidth); ctx.beginPath(); ctx.moveTo(r.x1, yy); ctx.lineTo(r.x2, yy); ctx.stroke(); }
    if (r.y2 - r.y1 > 1) {
      ctx.beginPath(); ctx.moveTo(cx, a.y); ctx.lineTo(cx, b.y); ctx.stroke();
      drawArrowHead(ctx, { x: cx, y: a.y }, { x: cx, y: b.y }, 6 + s.lineWidth * 2);
    }
    if (this.points.length < 2) return;
    const st = rangeStats(rc, this.points[0], this.points[1]);
    const lines: string[] = [];
    const parts: string[] = [];
    if (s.showPriceRange) parts.push(formatChange(st.dp, rc.priceFormat));
    if (s.showPercentPriceRange) parts.push(`(${formatPercent(st.pct)})`);
    if (parts.length) lines.push(parts.join(' '));
    if (s.showPipsPriceRange) lines.push(`${Math.round(st.pips)} pips`);
    this.label(rc, lines, cx, (r.y1 + r.y2) / 2);
  }
}

export class DateRange extends RangeTool {
  static override toolId = 'date_range';
  static override toolName = 'Date Range';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M6 13.5h16v1H6z"/><path fill="currentColor" d="M5.5 8h1v12h-1zM21.5 8h1v12h-1z"/><path fill="currentColor" d="M5 14l3.5-3v6zM23 14l-3.5 3v-6z"/></svg>';
  defaultStyle(): Record<string, any> { return { ...rangeBaseStyle(), extendTop: false, extendBottom: false, showBarsRange: true, showDateTimeRange: true, showVolume: true }; }
  propertyDefs(): PropertyDef[] {
    return rangeBaseProps([P.bool('extendTop', 'Extend top'), P.bool('extendBottom', 'Extend bottom'), P.section('Stats'), P.bool('showBarsRange', 'Bars range'), P.bool('showDateTimeRange', 'Date/time range'), P.bool('showVolume', 'Volume')]);
  }
  protected override rect(rc: DrawingRenderContext) {
    const r = super.rect(rc);
    if (this.style.extendTop) r.y1 = -10;
    if (this.style.extendBottom) r.y2 = rc.height + 10;
    return r;
  }
  render(rc: DrawingRenderContext): void {
    if (this.points.length < 1) return;
    const { ctx } = rc;
    const s = this.style;
    const r = this.rect(rc);
    this.fillAndBorder(rc, r);
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    const cy = (Math.min(a.y, b.y) + Math.max(a.y, b.y)) / 2;
    applyLine(ctx, s.lineColor, s.lineWidth, 0);
    for (const x of [r.x1, r.x2]) { const xx = crisp(x, rc.dpr, s.lineWidth); ctx.beginPath(); ctx.moveTo(xx, r.y1); ctx.lineTo(xx, r.y2); ctx.stroke(); }
    if (r.x2 - r.x1 > 1) {
      ctx.beginPath(); ctx.moveTo(a.x, cy); ctx.lineTo(b.x, cy); ctx.stroke();
      drawArrowHead(ctx, { x: a.x, y: cy }, { x: b.x, y: cy }, 6 + s.lineWidth * 2);
    }
    if (this.points.length < 2) return;
    const st = rangeStats(rc, this.points[0], this.points[1]);
    const lines: string[] = [];
    if (s.showBarsRange) lines.push(`${st.bars} bars`);
    if (s.showDateTimeRange) lines.push(formatDuration(st.seconds));
    if (s.showVolume) lines.push(`Vol ${formatVolume(st.volume)}`);
    this.label(rc, lines, (r.x1 + r.x2) / 2, cy);
  }
}

export class DateAndPriceRange extends RangeTool {
  static override toolId = 'date_and_price_range';
  static override toolName = 'Date and Price Range';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M5 6h18v16H5zm1 1v14h16V7z"/><path fill="currentColor" d="M8.35 19.35l-.7-.7L18.3 8H14V7h6v6h-1V8.7z"/></svg>';
  defaultStyle(): Record<string, any> { return { ...rangeBaseStyle(), extendTop: false, extendBottom: false, showPriceRange: true, showPercentPriceRange: true, showPipsPriceRange: true, showBarsRange: true, showDateTimeRange: true, showVolume: true }; }
  propertyDefs(): PropertyDef[] {
    return rangeBaseProps([
      P.bool('extendTop', 'Extend top'), P.bool('extendBottom', 'Extend bottom'), P.section('Stats'),
      P.bool('showPriceRange', 'Price range'), P.bool('showPercentPriceRange', 'Percent change'), P.bool('showPipsPriceRange', 'Change in pips'),
      P.bool('showBarsRange', 'Bars range'), P.bool('showDateTimeRange', 'Date/time range'), P.bool('showVolume', 'Volume'),
    ]);
  }
  protected override rect(rc: DrawingRenderContext) {
    const r = super.rect(rc);
    if (this.style.extendTop) r.y1 = -10;
    if (this.style.extendBottom) r.y2 = rc.height + 10;
    return r;
  }
  render(rc: DrawingRenderContext): void {
    if (this.points.length < 1) return;
    const { ctx } = rc;
    const s = this.style;
    const r = this.rect(rc);
    this.fillAndBorder(rc, r);
    const a = rc.toPixel(this.points[0]);
    const b = rc.toPixel(this.points[1] ?? this.points[0]);
    applyLine(ctx, s.lineColor, s.lineWidth, 0);
    if (a.x !== b.x || a.y !== b.y) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      drawArrowHead(ctx, a, b, 6 + s.lineWidth * 2);
    }
    if (this.points.length < 2) return;
    const st = rangeStats(rc, this.points[0], this.points[1]);
    const lines: string[] = [];
    const parts: string[] = [];
    if (s.showPriceRange) parts.push(formatChange(st.dp, rc.priceFormat));
    if (s.showPercentPriceRange) parts.push(`(${formatPercent(st.pct)})`);
    if (s.showPipsPriceRange) parts.push(`${Math.round(st.pips)} pips`);
    if (parts.length) lines.push(parts.join(' '));
    const parts2: string[] = [];
    if (s.showBarsRange) parts2.push(`${st.bars} bars`);
    if (s.showDateTimeRange) parts2.push(formatDuration(st.seconds));
    if (parts2.length) lines.push(parts2.join(', '));
    if (s.showVolume) lines.push(`Vol ${formatVolume(st.volume)}`);
    // label sits outside the box on the p2 side (above when the move is up, below otherwise)
    const up = b.y <= a.y;
    this.label(rc, lines, (r.x1 + r.x2) / 2, up ? r.y1 - 4 : r.y2 + 4, up ? 'bottom' : 'top');
  }
}

// =====================================================================================
// I.11 / B.15 Anchored VWAP
// =====================================================================================

export interface VWAPSeries {
  /** first bar index */
  from: number;
  /** cumulative VWAP per bar from `from` */
  vwap: number[];
  /** volume-weighted standard deviation of the source since the anchor */
  sigma: number[];
}

/** VWAP + volume-weighted σ from bar `from` to bar `to` (inclusive). Bars without volume fall back to a plain average. */
export function computeVWAP(bars: Bar[], from: number, to: number, source: PriceSource = 'hlc3'): VWAPSeries {
  const n = bars.length;
  const out: VWAPSeries = { from, vwap: [], sigma: [] };
  if (!n) return out;
  from = clamp(from, 0, n - 1);
  to = clamp(to, from, n - 1);
  out.from = from;
  let sumPV = 0, sumV = 0, sumP2V = 0, sumP = 0, sumP2 = 0, cnt = 0;
  for (let i = from; i <= to; i++) {
    const b = bars[i];
    const p = priceSourceValue(b, source);
    const v = typeof b.volume === 'number' && Number.isFinite(b.volume) && b.volume > 0 ? b.volume : 0;
    sumPV += p * v; sumV += v; sumP2V += p * p * v;
    sumP += p; sumP2 += p * p; cnt++;
    let mean: number, meanSq: number;
    if (sumV > 0) { mean = sumPV / sumV; meanSq = sumP2V / sumV; }
    else { mean = sumP / cnt; meanSq = sumP2 / cnt; }
    out.vwap.push(mean);
    out.sigma.push(Math.sqrt(Math.max(0, meanSq - mean * mean)));
  }
  return out;
}

export class AnchoredVWAP extends Drawing {
  static override toolId = 'anchored_vwap';
  static override toolName = 'Anchored VWAP';
  static override pointsCount = 1;
  static override group = 'prediction' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M5 20l4-6 4 3 5-8 5 4-.6.8-4.2-3.4-5 8-4-3-3.4 5.1z"/><path fill="currentColor" d="M7 20a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/></svg>';
  private _cache: { key: string; series: VWAPSeries } | null = null;

  defaultStyle(): Record<string, any> {
    return {
      source: 'hlc3', bandsMode: 'stdev', band1Multiplier: 1, band2Multiplier: 2, band3Multiplier: 3,
      band1Visible: true, band2Visible: false, band3Visible: false,
      vwapColor: '#1E88E5', vwapWidth: 1, vwapStyle: 0,
      band1Color: '#4CAF50', band2Color: '#808000', band3Color: '#00897B', bandWidth: 1, bandStyle: 0,
      fillBackground: true, fillColor: '#4CAF50', fillTransparency: 95,
    };
  }

  propertyDefs(): PropertyDef[] {
    return [
      P.select('source', 'Source', PRICE_SOURCES, 'Inputs'),
      P.select('bandsMode', 'Bands calculation mode', [{ value: 'stdev', label: 'Standard Deviation' }, { value: 'percent', label: 'Percentage' }], 'Inputs'),
      P.bool('band1Visible', 'Band 1', 'Inputs'), P.number('band1Multiplier', 'Multiplier 1', 0, undefined, 0.1, 'Inputs'),
      P.bool('band2Visible', 'Band 2', 'Inputs'), P.number('band2Multiplier', 'Multiplier 2', 0, undefined, 0.1, 'Inputs'),
      P.bool('band3Visible', 'Band 3', 'Inputs'), P.number('band3Multiplier', 'Multiplier 3', 0, undefined, 0.1, 'Inputs'),
      P.color('vwapColor', 'VWAP'), P.lineWidth('vwapWidth', 'VWAP width'), P.lineStyle('vwapStyle', 'VWAP style'),
      P.color('band1Color', 'Band 1 color'), P.color('band2Color', 'Band 2 color'), P.color('band3Color', 'Band 3 color'),
      P.lineWidth('bandWidth', 'Bands width'), P.lineStyle('bandStyle', 'Bands style'),
      P.bool('fillBackground', 'Background'), P.color('fillColor', 'Background color'), P.int('fillTransparency', 'Background transparency', 0, 100),
    ];
  }

  override onChanged(): void { this._cache = null; }

  /** Anchor bar index (clamped to the data). */
  anchorIndex(rc: DrawingRenderContext): number {
    const n = rc.mainSeries.bars.length;
    if (!n || !this.points.length) return 0;
    return clamp(barIndexOf(rc.timeScale, this.points[0].time), 0, n - 1);
  }

  series(rc: DrawingRenderContext): VWAPSeries | null {
    const bars = rc.mainSeries.bars;
    if (!bars.length || !this.points.length) return null;
    const from = this.anchorIndex(rc);
    const last = bars[bars.length - 1];
    const key = `${from}:${bars.length}:${this.style.source}:${last.time}:${last.close}:${last.volume ?? ''}`;
    if (this._cache && this._cache.key === key) return this._cache.series;
    const series = computeVWAP(bars, from, bars.length - 1, this.style.source as PriceSource);
    this._cache = { key, series };
    return series;
  }

  private _bands(): Array<{ mult: number; color: string }> {
    const s = this.style;
    const out: Array<{ mult: number; color: string }> = [];
    if (s.band1Visible) out.push({ mult: Number(s.band1Multiplier) || 0, color: s.band1Color });
    if (s.band2Visible) out.push({ mult: Number(s.band2Multiplier) || 0, color: s.band2Color });
    if (s.band3Visible) out.push({ mult: Number(s.band3Multiplier) || 0, color: s.band3Color });
    return out;
  }

  private _band(v: number, sigma: number, mult: number, sign: 1 | -1): number {
    return this.style.bandsMode === 'percent' ? v * (1 + (sign * mult) / 100) : v + sign * mult * sigma;
  }

  render(rc: DrawingRenderContext): void {
    const ser = this.series(rc);
    if (!ser || !ser.vwap.length) return;
    const { ctx } = rc;
    const s = this.style;
    const ts = rc.timeScale, ps = rc.priceScale;
    const xs = ser.vwap.map((_, i) => ts.barCenterX(ser.from + i));
    const bands = this._bands();
    if (s.fillBackground && bands.length) {
      const b = bands[0];
      ctx.fillStyle = withAlpha(s.fillColor, clamp((100 - (Number(s.fillTransparency) || 0)) / 100, 0, 1));
      ctx.beginPath();
      ser.vwap.forEach((v, i) => { const y = ps.priceToY(this._band(v, ser.sigma[i], b.mult, 1)); if (i === 0) ctx.moveTo(xs[i], y); else ctx.lineTo(xs[i], y); });
      for (let i = ser.vwap.length - 1; i >= 0; i--) ctx.lineTo(xs[i], ps.priceToY(this._band(ser.vwap[i], ser.sigma[i], b.mult, -1)));
      ctx.closePath();
      ctx.fill();
    }
    for (const b of bands) {
      applyLine(ctx, b.color, s.bandWidth, s.bandStyle);
      for (const sign of [1, -1] as const) {
        ctx.beginPath();
        ser.vwap.forEach((v, i) => { const y = ps.priceToY(this._band(v, ser.sigma[i], b.mult, sign)); if (i === 0) ctx.moveTo(xs[i], y); else ctx.lineTo(xs[i], y); });
        ctx.stroke();
      }
    }
    applyLine(ctx, s.vwapColor, s.vwapWidth, s.vwapStyle);
    ctx.beginPath();
    ser.vwap.forEach((v, i) => { const y = ps.priceToY(v); if (i === 0) ctx.moveTo(xs[i], y); else ctx.lineTo(xs[i], y); });
    ctx.stroke();
    ctx.setLineDash([]);
    if (rc.selected || rc.hovered || rc.creating) {
      ctx.fillStyle = s.vwapColor;
      ctx.beginPath(); ctx.arc(xs[0], ps.priceToY(ser.vwap[0]), 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  override handles(rc: DrawingRenderContext): Array<PixelPoint & { index: number }> {
    if (!this.points.length) return [];
    const ser = this.series(rc);
    if (!ser || !ser.vwap.length) return super.handles(rc);
    return [{ x: rc.timeScale.barCenterX(ser.from), y: rc.priceScale.priceToY(ser.vwap[0]), index: 0 }];
  }

  override movePoint(index: number, p: DrawingPoint): void {
    if (index === 0 && this.points[0]) this.points[0] = { time: p.time, price: p.price };
    this._cache = null;
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    const h = hitHandles(this, x, y, rc);
    if (h) return h;
    const ser = this.series(rc);
    if (!ser || ser.vwap.length < 2) return null;
    const ts = rc.timeScale, ps = rc.priceScale;
    const tol = HIT_TOLERANCE + this.style.vwapWidth / 2;
    for (let i = 1; i < ser.vwap.length; i++) {
      const x0 = ts.barCenterX(ser.from + i - 1), x1 = ts.barCenterX(ser.from + i);
      if (x < Math.min(x0, x1) - tol || x > Math.max(x0, x1) + tol) continue;
      if (distToSegment(x, y, x0, ps.priceToY(ser.vwap[i - 1]), x1, ps.priceToY(ser.vwap[i])) <= tol) return { type: 'body' };
    }
    return null;
  }
}

export { PRICE_SOURCES };

export const predictionTools = [LongPosition, ShortPosition, Forecast, BarsPattern, GhostFeed, Projection, PriceRange, DateRange, DateAndPriceRange, AnchoredVWAP];
