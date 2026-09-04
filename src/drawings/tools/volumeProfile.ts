import { Drawing, P, type DrawingRenderContext, type DrawingPoint, type HitTarget, type PropertyDef, type PixelPoint, HIT_TOLERANCE } from '../Drawing';
import { applyLine, drawTextBox, fontFor } from './common';
import { formatVolume } from '../../util/format';
import { crisp } from '../../render/canvas';
import { clamp, pointInRect } from '../../util/math';
import type { Bar } from '../../data/types';
import { tickSize, barIndexOf } from './prediction';

// =====================================================================================
// Profile computation (pure; exported for tests)
// =====================================================================================

export interface ProfileRow {
  lo: number;
  hi: number;
  up: number;
  down: number;
  total: number;
  inVA: boolean;
}

export interface VolumeProfileResult {
  rows: ProfileRow[];
  /** inclusive bar index range actually used */
  from: number;
  to: number;
  top: number;
  bottom: number;
  rowHeight: number;
  /** index of the point-of-control row (highest total volume) */
  poc: number;
  /** inclusive value-area row indices */
  vaLow: number;
  vaHigh: number;
  /** value-area high/low prices */
  vah: number;
  val: number;
  maxTotal: number;
  totalVolume: number;
}

export interface VolumeProfileOptions {
  rowsLayout: 'rows' | 'ticks';
  /** number of rows (layout 'rows') or ticks per row (layout 'ticks') */
  rowSize: number;
  tick: number;
  /** value-area percentage (0..100) */
  valueArea: number;
  maxRows?: number;
}

/**
 * Horizontal volume profile for bars[from..to]. Each bar's volume is spread over the price rows its
 * low..high range covers (proportionally to the overlap) and split into up (close >= open) / down.
 */
export function computeVolumeProfile(bars: Bar[], from: number, to: number, opts: VolumeProfileOptions): VolumeProfileResult | null {
  const n = bars.length;
  if (!n) return null;
  let a = Math.min(from, to), b = Math.max(from, to);
  if (b < 0 || a > n - 1) return null;
  a = clamp(a, 0, n - 1);
  b = clamp(b, 0, n - 1);
  let top = -Infinity, bottom = Infinity;
  for (let i = a; i <= b; i++) {
    const bar = bars[i];
    if (bar.high > top) top = bar.high;
    if (bar.low < bottom) bottom = bar.low;
  }
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  const tick = Number.isFinite(opts.tick) && opts.tick > 0 ? opts.tick : 0.01;
  if (top <= bottom) top = bottom + tick;
  const maxRows = opts.maxRows ?? 2000;
  let rowsCount: number;
  if (opts.rowsLayout === 'ticks') {
    const rh = Math.max(tick, (Number(opts.rowSize) || 1) * tick);
    rowsCount = clamp(Math.ceil((top - bottom) / rh - 1e-9), 1, maxRows);
  } else {
    rowsCount = clamp(Math.round(Number(opts.rowSize) || 24), 1, maxRows);
  }
  const rowH = (top - bottom) / rowsCount;
  const rows: ProfileRow[] = [];
  for (let k = 0; k < rowsCount; k++) rows.push({ lo: bottom + k * rowH, hi: k === rowsCount - 1 ? top : bottom + (k + 1) * rowH, up: 0, down: 0, total: 0, inVA: false });
  let totalVolume = 0;
  for (let i = a; i <= b; i++) {
    const bar = bars[i];
    const v = typeof bar.volume === 'number' && Number.isFinite(bar.volume) && bar.volume > 0 ? bar.volume : 0;
    if (!v) continue;
    totalVolume += v;
    const isUp = bar.close >= bar.open;
    const lo = Math.min(bar.low, bar.high), hi = Math.max(bar.low, bar.high);
    const add = (k: number, amt: number) => { const r = rows[k]; if (isUp) r.up += amt; else r.down += amt; r.total += amt; };
    if (hi - lo <= 0) { add(clamp(Math.floor((lo - bottom) / rowH), 0, rowsCount - 1), v); continue; }
    const k0 = clamp(Math.floor((lo - bottom) / rowH), 0, rowsCount - 1);
    const k1 = clamp(Math.ceil((hi - bottom) / rowH), 0, rowsCount - 1);
    for (let k = k0; k <= k1; k++) {
      const r = rows[k];
      const ov = Math.min(hi, r.hi) - Math.max(lo, r.lo);
      if (ov <= 0) continue;
      add(k, (v * ov) / (hi - lo));
    }
  }
  let poc = 0, maxTotal = 0;
  for (let k = 0; k < rows.length; k++) if (rows[k].total > maxTotal) { maxTotal = rows[k].total; poc = k; }
  // value area: expand from the POC, adding the larger of the two-row groups above / below
  const target = (totalVolume * clamp(Number(opts.valueArea) || 0, 0, 100)) / 100;
  let vaLow = poc, vaHigh = poc, acc = rows[poc].total;
  const last = rows.length - 1;
  while (acc < target) {
    const canUp = vaHigh < last, canDn = vaLow > 0;
    if (!canUp && !canDn) break;
    const upVol = canUp ? rows[vaHigh + 1].total + (vaHigh + 2 <= last ? rows[vaHigh + 2].total : 0) : -1;
    const dnVol = canDn ? rows[vaLow - 1].total + (vaLow - 2 >= 0 ? rows[vaLow - 2].total : 0) : -1;
    if (upVol >= dnVol) { const steps = Math.min(2, last - vaHigh); for (let s = 0; s < steps; s++) { vaHigh++; acc += rows[vaHigh].total; } }
    else { const steps = Math.min(2, vaLow); for (let s = 0; s < steps; s++) { vaLow--; acc += rows[vaLow].total; } }
  }
  for (let k = vaLow; k <= vaHigh; k++) rows[k].inVA = true;
  return { rows, from: a, to: b, top, bottom, rowHeight: rowH, poc, vaLow, vaHigh, vah: rows[vaHigh].hi, val: rows[vaLow].lo, maxTotal, totalVolume };
}

// =====================================================================================
// Drawings
// =====================================================================================

abstract class VolumeProfileBase extends Drawing {
  static override group = 'prediction' as const;
  private _cache: { key: string; profile: VolumeProfileResult | null } | null = null;

  /** Inclusive bar index range of the profile (may be partly outside the data). */
  abstract range(rc: DrawingRenderContext): { from: number; to: number } | null;

  defaultStyle(): Record<string, any> {
    return {
      rowsLayout: 'rows', rowSize: 24, volumeMode: 'updown', valueArea: 70, extendRight: false, widthPercent: 100,
      upColor: 'rgba(8, 153, 129, 0.45)', downColor: 'rgba(242, 54, 69, 0.45)', totalColor: 'rgba(41, 98, 255, 0.45)',
      vaUpColor: 'rgba(8, 153, 129, 0.85)', vaDownColor: 'rgba(242, 54, 69, 0.85)', vaTotalColor: 'rgba(41, 98, 255, 0.85)',
      showPoc: true, pocColor: '#F23645', pocWidth: 1,
      showValueArea: true, vaLineColor: '#2962FF', vaLineStyle: 2,
      showValues: false, valuesColor: '#787B86', fontSize: 10,
      showBox: true, boxColor: 'rgba(120, 123, 134, 0.08)', borderColor: 'rgba(120, 123, 134, 0.6)',
    };
  }

  propertyDefs(): PropertyDef[] {
    return [
      P.select('rowsLayout', 'Rows layout', [{ value: 'rows', label: 'Number of rows' }, { value: 'ticks', label: 'Ticks per row' }], 'Inputs'),
      P.int('rowSize', 'Row size', 1, 2000, 'Inputs'),
      P.select('volumeMode', 'Volume', [{ value: 'updown', label: 'Up/Down' }, { value: 'total', label: 'Total' }, { value: 'delta', label: 'Delta' }], 'Inputs'),
      P.number('valueArea', 'Value area volume %', 0, 100, 1, 'Inputs'),
      P.bool('extendRight', 'Extend right', 'Inputs'),
      P.int('widthPercent', 'Width %', 1, 100),
      P.color('upColor', 'Up volume'), P.color('downColor', 'Down volume'), P.color('totalColor', 'Total volume'),
      P.color('vaUpColor', 'Value area up'), P.color('vaDownColor', 'Value area down'), P.color('vaTotalColor', 'Value area total'),
      P.bool('showPoc', 'POC'), P.color('pocColor', 'POC color'), P.lineWidth('pocWidth', 'POC width'),
      P.bool('showValueArea', 'VAH / VAL lines'), P.color('vaLineColor', 'VA line color'), P.lineStyle('vaLineStyle', 'VA line style'),
      P.bool('showValues', 'Values'), P.color('valuesColor', 'Values color'), P.fontSize('fontSize', 'Font size', 'Style'),
      P.bool('showBox', 'Background'), P.color('boxColor', 'Background color'), P.color('borderColor', 'Border color'),
    ];
  }

  override onChanged(): void { this._cache = null; }

  /** Computed profile (cached by range, rows settings and the bar set). */
  profile(rc: DrawingRenderContext): VolumeProfileResult | null {
    const r = this.range(rc);
    const bars = rc.mainSeries.bars;
    if (!r || !bars.length) return null;
    const s = this.style;
    const last = bars[bars.length - 1];
    const tick = tickSize(rc);
    const key = `${r.from}:${r.to}:${s.rowsLayout}:${s.rowSize}:${s.valueArea}:${bars.length}:${last.time}:${last.close}:${last.volume ?? ''}:${tick}`;
    if (this._cache && this._cache.key === key) return this._cache.profile;
    const profile = computeVolumeProfile(bars, r.from, r.to, {
      rowsLayout: s.rowsLayout === 'ticks' ? 'ticks' : 'rows',
      rowSize: Number(s.rowSize) || 24,
      tick,
      valueArea: clamp(Number(s.valueArea) || 0, 0, 100),
    });
    this._cache = { key, profile };
    return profile;
  }

  /** Pixel box of the profile: x from the left edge of the first bar to the right edge of the last one. */
  protected box(rc: DrawingRenderContext): { x1: number; x2: number; y1: number; y2: number; profile: VolumeProfileResult | null } | null {
    const r = this.range(rc);
    if (!r || !this.points.length) return null;
    const ts = rc.timeScale;
    const from = Math.min(r.from, r.to), to = Math.max(r.from, r.to);
    const x1 = ts.indexToX(from), x2 = ts.indexToX(to + 1);
    const profile = this.profile(rc);
    const py = rc.toPixel(this.points[0]).y;
    const y1 = profile ? rc.priceScale.priceToY(profile.top) : py - 20;
    const y2 = profile ? rc.priceScale.priceToY(profile.bottom) : py + 20;
    return { x1: Math.min(x1, x2), x2: Math.max(x1, x2), y1: Math.min(y1, y2), y2: Math.max(y1, y2), profile };
  }

  render(rc: DrawingRenderContext): void {
    const b = this.box(rc);
    if (!b) return;
    const { ctx } = rc;
    const s = this.style;
    const ps = rc.priceScale;
    if (s.showBox) { ctx.fillStyle = s.boxColor; ctx.fillRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); }
    applyLine(ctx, s.borderColor, 1, 2);
    for (const x of [b.x1, b.x2]) { const xx = crisp(x, rc.dpr, 1); ctx.beginPath(); ctx.moveTo(xx, b.y1); ctx.lineTo(xx, b.y2); ctx.stroke(); }
    ctx.setLineDash([]);
    const prof = b.profile;
    if (!prof) return;
    const maxW = Math.max(0, (b.x2 - b.x1) * clamp(Number(s.widthPercent) || 100, 1, 100) / 100);
    const scale = prof.maxTotal > 0 ? maxW / prof.maxTotal : 0;
    const mode = s.volumeMode;
    const fontSize = Number(s.fontSize) || 10;
    const font = fontFor(rc, fontSize);
    for (const row of prof.rows) {
      const ya = ps.priceToY(row.hi), yb = ps.priceToY(row.lo);
      const top = Math.min(ya, yb);
      let h = Math.abs(yb - ya);
      const gap = h > 3 ? 1 : 0;
      h = Math.max(1, h - gap);
      const upC = row.inVA ? s.vaUpColor : s.upColor;
      const dnC = row.inVA ? s.vaDownColor : s.downColor;
      const totC = row.inVA ? s.vaTotalColor : s.totalColor;
      let wTotal = 0;
      if (mode === 'total') {
        wTotal = row.total * scale;
        if (wTotal > 0) { ctx.fillStyle = totC; ctx.fillRect(b.x1, top, wTotal, h); }
      } else if (mode === 'delta') {
        const d = row.up - row.down;
        wTotal = Math.abs(d) * scale;
        if (wTotal > 0) { ctx.fillStyle = d >= 0 ? upC : dnC; ctx.fillRect(b.x1, top, wTotal, h); }
      } else {
        const wUp = row.up * scale, wDn = row.down * scale;
        if (wUp > 0) { ctx.fillStyle = upC; ctx.fillRect(b.x1, top, wUp, h); }
        if (wDn > 0) { ctx.fillStyle = dnC; ctx.fillRect(b.x1 + wUp, top, wDn, h); }
        wTotal = wUp + wDn;
      }
      if (s.showValues && h >= fontSize && row.total > 0) {
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        drawTextBox(ctx, formatVolume(mode === 'delta' ? row.up - row.down : row.total), b.x1 + wTotal + 3, top + h / 2, { font, color: s.valuesColor, vAlign: 'middle', padding: 1 });
      }
    }
    if (s.showPoc && prof.rows.length) {
      const pr = prof.rows[prof.poc];
      applyLine(ctx, s.pocColor, s.pocWidth, 0);
      const y = crisp(ps.priceToY((pr.lo + pr.hi) / 2), rc.dpr, s.pocWidth);
      ctx.beginPath(); ctx.moveTo(b.x1, y); ctx.lineTo(b.x2, y); ctx.stroke();
    }
    if (s.showValueArea && prof.rows.length) {
      applyLine(ctx, s.vaLineColor, 1, s.vaLineStyle);
      for (const p of [prof.vah, prof.val]) { const y = crisp(ps.priceToY(p), rc.dpr, 1); ctx.beginPath(); ctx.moveTo(b.x1, y); ctx.lineTo(b.x2, y); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  override handles(rc: DrawingRenderContext): Array<PixelPoint & { index: number }> {
    const b = this.box(rc);
    if (!b) return [];
    const midY = (b.y1 + b.y2) / 2;
    const out: Array<PixelPoint & { index: number }> = [{ x: b.x1, y: midY, index: 0 }];
    if (this.points.length >= 2) out.push({ x: b.x2, y: midY, index: 1 });
    return out;
  }

  override movePoint(index: number, p: DrawingPoint): void {
    if (!this.points[index]) return;
    this.points[index] = { time: p.time, price: p.price };
    this._cache = null;
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (!this.points.length) return null;
    for (const h of this.handles(rc)) if (Math.hypot(h.x - x, h.y - y) <= 7) return { type: 'point', index: h.index };
    const b = this.box(rc);
    if (b && pointInRect(x, y, b.x1 - HIT_TOLERANCE, b.y1 - HIT_TOLERANCE, b.x2 + HIT_TOLERANCE, b.y2 + HIT_TOLERANCE)) return { type: 'body' };
    return null;
  }
}

export class FixedRangeVolumeProfile extends VolumeProfileBase {
  static override toolId = 'fixed_range_volume_profile';
  static override toolName = 'Fixed Range Volume Profile';
  static override pointsCount = 2;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M5 4h1v20H5zM22 4h1v20h-1z"/><path fill="currentColor" opacity=".6" d="M7 7h9v2H7zM7 10h13v2H7zM7 13h6v2H7zM7 16h11v2H7zM7 19h8v2H7z"/></svg>';

  range(rc: DrawingRenderContext): { from: number; to: number } | null {
    if (!this.points.length) return null;
    const ts = rc.timeScale;
    const from = barIndexOf(ts, this.points[0].time);
    const to = this.style.extendRight ? ts.lastIndex : barIndexOf(ts, (this.points[1] ?? this.points[0]).time);
    return { from, to };
  }
}

export class AnchoredVolumeProfile extends VolumeProfileBase {
  static override toolId = 'anchored_volume_profile';
  static override toolName = 'Anchored Volume Profile';
  static override pointsCount = 1;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M5 4h1v20H5z"/><path fill="currentColor" d="M7.5 14a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/><path fill="currentColor" opacity=".6" d="M8 7h9v2H8zM8 10h14v2H8zM8 13h6v2H8zM8 16h12v2H8zM8 19h8v2H8z"/></svg>';

  range(rc: DrawingRenderContext): { from: number; to: number } | null {
    if (!this.points.length) return null;
    const ts = rc.timeScale;
    return { from: barIndexOf(ts, this.points[0].time), to: ts.lastIndex };
  }
}

export const volumeProfileTools = [FixedRangeVolumeProfile, AnchoredVolumeProfile];
