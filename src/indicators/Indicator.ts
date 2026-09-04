import { DataSource, type RenderContext, type LegendItem, type AxisLabel, type HitResult } from '../series/Series';
import type { PriceRange } from '../core/PriceScale';
import type { Bar, PriceFormat, PriceSource, ResolutionString, SymbolInfo } from '../data/types';
import { priceSourceValue } from '../data/types';
import type { LineStyle, LineWidth } from '../core/options';
import * as ta from './ta';
import { strokePolyline, renderHistogram } from '../series/renderers';
import { crisp, setLineStyle } from '../render/canvas';
import { formatPrice } from '../util/format';
import { withAlpha } from '../util/color';
import type { TimeScale } from '../core/TimeScale';
import type { PriceScale } from '../core/PriceScale';

export type InputType = 'int' | 'float' | 'bool' | 'source' | 'select' | 'text' | 'color' | 'resolution' | 'time' | 'symbol' | 'session';

export interface IndicatorInput {
  id: string;
  name: string;
  type: InputType;
  defval: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  group?: string;
  tooltip?: string;
  inline?: string;
}

export type PlotType = 'line' | 'histogram' | 'columns' | 'area' | 'circles' | 'cross' | 'stepLine' | 'shapes' | 'chars' | 'bgcolor' | 'none' | 'band' | 'candles';
export type ShapeStyle = 'arrowUp' | 'arrowDown' | 'triangleUp' | 'triangleDown' | 'circle' | 'cross' | 'xcross' | 'square' | 'diamond' | 'flag' | 'labelUp' | 'labelDown';
export type ShapeLocation = 'aboveBar' | 'belowBar' | 'absolute' | 'top' | 'bottom';

export interface PlotStyle {
  type: PlotType;
  color: string;
  lineWidth: LineWidth;
  lineStyle: LineStyle;
  /** 0..100 */
  transparency: number;
  visible: boolean;
  /** For histogram/columns: base value */
  base?: number;
  /** For shapes/chars */
  shape?: ShapeStyle;
  char?: string;
  location?: ShapeLocation;
  size?: 'tiny' | 'small' | 'normal' | 'large' | 'huge' | 'auto';
  text?: string;
  /** show value on the price axis */
  showLast: boolean;
  /** price line for the last value */
  trackPrice?: boolean;
  /** Offset in bars */
  offset?: number;
  /** For area: fill to this value */
  areaBase?: number;
  /** display precision override */
  title?: string;
}

export interface IndicatorPlot {
  id: string;
  title: string;
  style: PlotStyle;
  /** hide from legend */
  hideInLegend?: boolean;
}

export interface IndicatorBand {
  id: string;
  title: string;
  value: number;
  color: string;
  lineStyle: LineStyle;
  lineWidth: LineWidth;
  visible: boolean;
}

export interface IndicatorFill {
  id: string;
  title: string;
  /** plot id or band id */
  a: string;
  b: string;
  color: string;
  transparency: number;
  visible: boolean;
}

export interface IndicatorContext {
  bars: Bar[];
  n: number;
  time: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  hl2: Float64Array;
  hlc3: Float64Array;
  ohlc4: Float64Array;
  hlcc4: Float64Array;
  resolution: ResolutionString;
  symbolInfo: SymbolInfo | null;
  timezone: string;
  minMove: number;
  source(name: PriceSource | string): Float64Array;
  ta: typeof ta;
  /** Access another indicator's output (by id/plot) — optional advanced usage */
  external?: (indicatorId: string, plotId: string) => Float64Array | null;
}

export interface PlotOutput {
  values: Float64Array;
  /** per-bar color override (null entries fall back to style color) */
  colors?: Array<string | null> | null;
  /** per-bar text for shapes/chars */
  texts?: Array<string | null> | null;
}

export type ComputeResult = Record<string, Float64Array | PlotOutput>;

export interface IndicatorDefinition {
  /** Unique id, e.g. "Relative Strength Index" (TradingView study name for createStudy). */
  id: string;
  name: string;
  shortName: string;
  category?: string;
  description?: string;
  overlay: boolean;
  inputs: IndicatorInput[];
  plots: IndicatorPlot[];
  bands?: IndicatorBand[];
  fills?: IndicatorFill[];
  /** precision: number or 'inherit' (from symbol) */
  precision?: number | 'inherit';
  format?: 'price' | 'volume' | 'percent';
  /** Fixed scale range for the pane, e.g. RSI 0..100 (null = auto) */
  scaleRange?: { min: number; max: number } | null;
  /** Keep the pane's zero visible */
  includeZero?: boolean;
  compute(ctx: IndicatorContext, inputs: Record<string, any>): ComputeResult;
  /** Custom render hook (draw extras like volume profile) */
  customRender?(rc: RenderContext, inst: IndicatorInstance): void;
  /** Aliases for createStudy/search */
  aliases?: string[];
}

export function plotStyle(partial: Partial<PlotStyle> & { color: string }): PlotStyle {
  return {
    type: 'line', lineWidth: 1, lineStyle: 0, transparency: 0, visible: true, showLast: true, trackPrice: false, ...partial,
  };
}

export function inputDefaults(def: IndicatorDefinition): Record<string, any> {
  const out: Record<string, any> = {};
  for (const i of def.inputs) out[i.id] = i.defval;
  return out;
}

function shapeSizePx(size: PlotStyle['size'] | undefined): number {
  switch (size) {
    case 'tiny': return 5; case 'small': return 8; case 'large': return 14; case 'huge': return 18; default: return 10;
  }
}

/** An indicator added to the chart (definition + inputs + style overrides + computed results). */
export class IndicatorInstance extends DataSource {
  inputs: Record<string, any>;
  styles: Record<string, PlotStyle> = {};
  bands: Record<string, IndicatorBand> = {};
  fills: Record<string, IndicatorFill> = {};
  results: Record<string, PlotOutput> = {};
  error: string | null = null;
  computedFor = -1;
  /** last-bar values used for legend when not hovering */
  constructor(readonly def: IndicatorDefinition, inputs?: Record<string, any>, id?: string) {
    super(id);
    this.inputs = { ...inputDefaults(def), ...(inputs || {}) };
    for (const p of def.plots) this.styles[p.id] = { ...p.style };
    for (const b of def.bands || []) this.bands[b.id] = { ...b };
    for (const f of def.fills || []) this.fills[f.id] = { ...f };
    this.title = def.shortName;
    this.paneId = def.overlay ? 'main' : '';
    this.priceScaleId = def.overlay ? 'right' : 'right';
  }

  get name(): string { return this.def.name; }

  /** Legend text: "RSI (14)" style */
  legendTitle(withArgs = true): string {
    const args = this.def.inputs
      .filter((i) => i.type !== 'bool' && i.type !== 'color' && i.type !== 'text')
      .map((i) => String(this.inputs[i.id]));
    return withArgs && args.length ? `${this.def.shortName} (${args.join(', ')})` : this.def.shortName;
  }

  setInputs(inputs: Record<string, any>): void {
    this.inputs = { ...this.inputs, ...inputs };
    this.computedFor = -1;
  }

  compute(ctx: IndicatorContext): void {
    try {
      const res = this.def.compute(ctx, this.inputs);
      const out: Record<string, PlotOutput> = {};
      for (const k of Object.keys(res)) {
        const v = res[k];
        out[k] = v instanceof Float64Array ? { values: v } : v;
      }
      this.results = out;
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
      this.results = {};
      console.error(`[openchart] indicator "${this.def.name}" failed`, e);
    }
    this.computedFor = ctx.n;
  }

  values(plotId: string): Float64Array | null {
    return this.results[plotId]?.values ?? null;
  }

  private _effectiveColor(plotId: string, i: number): string {
    const st = this.styles[plotId];
    const c = this.results[plotId]?.colors?.[i];
    const base = c ?? st.color;
    return st.transparency > 0 ? withAlpha(base, 1 - st.transparency / 100) : base;
  }

  // ---- PriceRangeProvider --------------------------------------------------
  priceRange(from: number, to: number): PriceRange | null {
    if (this.def.scaleRange) return { min: this.def.scaleRange.min, max: this.def.scaleRange.max };
    let min = Infinity, max = -Infinity;
    for (const p of this.def.plots) {
      const st = this.styles[p.id];
      if (!st || !st.visible) continue;
      if (st.type === 'bgcolor' || st.type === 'none' || st.type === 'shapes' || st.type === 'chars') continue;
      const vals = this.results[p.id]?.values;
      if (!vals) continue;
      const off = st.offset ?? 0;
      const a = Math.max(0, from - off), b = Math.min(vals.length - 1, to - off);
      for (let i = a; i <= b; i++) {
        const v = vals[i];
        if (v !== v) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (st.type === 'histogram' || st.type === 'columns' || st.type === 'area') {
        const base = st.base ?? 0;
        if (base < min) min = base;
        if (base > max) max = base;
      }
    }
    if (!this.def.overlay) {
      for (const b of Object.values(this.bands)) {
        if (!b.visible) continue;
        if (b.value < min) min = b.value;
        if (b.value > max) max = b.value;
      }
      if (this.def.includeZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min, max };
  }

  override baseValueAt(index: number): number | null {
    const first = this.def.plots[0];
    if (!first) return null;
    const v = this.results[first.id]?.values?.[index];
    return v !== undefined && v === v ? v : null;
  }

  // ---- render --------------------------------------------------------------
  render(rc: RenderContext): void {
    if (this.error) return;
    const { ctx } = rc;
    // fills first (background)
    for (const f of Object.values(this.fills)) {
      if (!f.visible) continue;
      this._renderFill(rc, f);
    }
    // bgcolor plots
    for (const p of this.def.plots) {
      const st = this.styles[p.id];
      if (st?.visible && st.type === 'bgcolor') this._renderBg(rc, p.id);
    }
    // bands (horizontal lines)
    if (!this.def.overlay) {
      for (const b of Object.values(this.bands)) {
        if (!b.visible) continue;
        const y = crisp(rc.priceScale.priceToY(b.value), rc.dpr, b.lineWidth);
        ctx.save();
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.lineWidth;
        setLineStyle(ctx, b.lineStyle, b.lineWidth);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(rc.width, y);
        ctx.stroke();
        ctx.restore();
      }
    }
    for (const p of this.def.plots) {
      const st = this.styles[p.id];
      if (!st || !st.visible || st.type === 'bgcolor' || st.type === 'none') continue;
      this._renderPlot(rc, p.id, st);
    }
    if (this.def.customRender) this.def.customRender(rc, this);
  }

  private _renderPlot(rc: RenderContext, id: string, st: PlotStyle): void {
    const out = this.results[id];
    if (!out) return;
    const vals = out.values;
    const { ctx, timeScale, priceScale, visible } = rc;
    const off = st.offset ?? 0;
    const from = Math.max(0, visible.from - 1);
    const to = Math.min(vals.length - 1 + off, visible.to + 1);
    const hasColors = !!out.colors;
    switch (st.type) {
      case 'line':
      case 'stepLine': {
        if (!hasColors) {
          const pts: Array<[number, number]> = [];
          let prevY: number | null = null;
          for (let i = from; i <= to; i++) {
            const v = vals[i - off];
            if (v !== v) {
              if (pts.length > 1) strokePolyline(ctx, pts, this._effectiveColor(id, i), st.lineWidth, st.lineStyle);
              pts.length = 0;
              prevY = null;
              continue;
            }
            const x = timeScale.barCenterX(i);
            const y = priceScale.priceToY(v);
            if (st.type === 'stepLine' && prevY !== null) pts.push([x - timeScale.barSpacing / 2, prevY], [x - timeScale.barSpacing / 2, y]);
            pts.push([x, y]);
            prevY = y;
          }
          if (pts.length > 1) strokePolyline(ctx, pts, this._effectiveColor(id, to), st.lineWidth, st.lineStyle);
          else if (pts.length === 1 && vals.length === 1) { /* single point */ }
        } else {
          // per-segment colors
          let px = NaN, py = NaN;
          ctx.save();
          ctx.lineWidth = st.lineWidth;
          ctx.lineJoin = 'round';
          setLineStyle(ctx, st.lineStyle, st.lineWidth);
          for (let i = from; i <= to; i++) {
            const v = vals[i - off];
            if (v !== v) { px = NaN; continue; }
            const x = timeScale.barCenterX(i);
            const y = priceScale.priceToY(v);
            if (px === px) {
              ctx.strokeStyle = this._effectiveColor(id, i);
              ctx.beginPath();
              ctx.moveTo(px, py);
              if (st.type === 'stepLine') { ctx.lineTo(x - timeScale.barSpacing / 2, py); ctx.lineTo(x - timeScale.barSpacing / 2, y); }
              ctx.lineTo(x, y);
              ctx.stroke();
            }
            px = x; py = y;
          }
          ctx.restore();
        }
        break;
      }
      case 'histogram':
      case 'columns': {
        const shifted = off === 0 ? vals : shiftValues(vals, off);
        renderHistogram(rc, shifted, (i) => this._effectiveColor(id, i - off), st.base ?? 0, st.type === 'columns' ? 0.7 : 0.5);
        break;
      }
      case 'area': {
        const pts: Array<[number, number]> = [];
        for (let i = from; i <= to; i++) {
          const v = vals[i - off];
          if (v !== v) continue;
          pts.push([timeScale.barCenterX(i), priceScale.priceToY(v)]);
        }
        if (pts.length < 2) break;
        const baseY = priceScale.priceToY(st.areaBase ?? st.base ?? 0);
        ctx.save();
        ctx.fillStyle = withAlpha(st.color, Math.max(0.05, (1 - st.transparency / 100) * 0.3));
        ctx.beginPath();
        ctx.moveTo(pts[0][0], baseY);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        ctx.lineTo(pts[pts.length - 1][0], baseY);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        strokePolyline(ctx, pts, this._effectiveColor(id, to), st.lineWidth, st.lineStyle);
        break;
      }
      case 'circles':
      case 'cross': {
        ctx.save();
        const r = Math.max(1.5, Math.min(4, timeScale.barSpacing / 3));
        for (let i = from; i <= to; i++) {
          const v = vals[i - off];
          if (v !== v) continue;
          const x = timeScale.barCenterX(i);
          const y = priceScale.priceToY(v);
          const color = this._effectiveColor(id, i);
          if (st.type === 'circles') {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.strokeStyle = color;
            ctx.lineWidth = st.lineWidth;
            ctx.beginPath();
            ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
            ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
            ctx.stroke();
          }
        }
        ctx.restore();
        break;
      }
      case 'shapes':
      case 'chars': {
        this._renderShapes(rc, id, st, from, to);
        break;
      }
      default:
        break;
    }
  }

  private _renderShapes(rc: RenderContext, id: string, st: PlotStyle, from: number, to: number): void {
    const out = this.results[id];
    if (!out) return;
    const vals = out.values;
    const { ctx, timeScale, priceScale } = rc;
    const bars = rc.timeScale.times;
    void bars;
    const size = shapeSizePx(st.size);
    ctx.save();
    ctx.font = `${size + 2}px ${rc.options.layout.fontFamily}`;
    ctx.textAlign = 'center';
    for (let i = from; i <= to; i++) {
      const v = vals[i - (st.offset ?? 0)];
      if (v !== v || v === 0) continue;
      const x = timeScale.barCenterX(i);
      let y: number;
      const loc = st.location ?? 'absolute';
      const main = (rc as any).mainBars as Bar[] | undefined;
      if (loc === 'aboveBar' && main?.[i]) y = priceScale.priceToY(main[i].high) - size;
      else if (loc === 'belowBar' && main?.[i]) y = priceScale.priceToY(main[i].low) + size;
      else if (loc === 'top') y = size;
      else if (loc === 'bottom') y = rc.height - size;
      else y = priceScale.priceToY(v);
      const color = this._effectiveColor(id, i);
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      if (st.type === 'chars') {
        ctx.textBaseline = 'middle';
        ctx.fillText(out.texts?.[i] ?? st.char ?? '•', x, y);
        continue;
      }
      drawShape(ctx, st.shape ?? 'circle', x, y, size);
      const text = out.texts?.[i] ?? st.text;
      if (text) {
        ctx.textBaseline = loc === 'belowBar' || loc === 'bottom' ? 'top' : 'bottom';
        ctx.font = `${Math.max(9, size)}px ${rc.options.layout.fontFamily}`;
        ctx.fillText(text, x, loc === 'belowBar' || loc === 'bottom' ? y + size / 2 + 2 : y - size / 2 - 2);
      }
    }
    ctx.restore();
  }

  private _renderBg(rc: RenderContext, id: string): void {
    const out = this.results[id];
    if (!out) return;
    const { ctx, timeScale, visible, height } = rc;
    const vals = out.values;
    ctx.save();
    for (let i = visible.from; i <= visible.to; i++) {
      const v = vals[i];
      if (v !== v || v === 0) continue;
      const c = out.colors?.[i] ?? this.styles[id].color;
      ctx.fillStyle = withAlpha(c, 1 - (this.styles[id].transparency || 90) / 100);
      const x = timeScale.indexToX(i);
      ctx.fillRect(x, 0, timeScale.barSpacing + 0.5, height);
    }
    ctx.restore();
  }

  private _seriesFor(idOrBand: string): Float64Array | number | null {
    if (this.results[idOrBand]) return this.results[idOrBand].values;
    const b = this.bands[idOrBand];
    if (b) return b.value;
    return null;
  }

  private _renderFill(rc: RenderContext, f: IndicatorFill): void {
    const a = this._seriesFor(f.a);
    const b = this._seriesFor(f.b);
    if (a === null || b === null) return;
    const { ctx, timeScale, priceScale, visible } = rc;
    const from = Math.max(0, visible.from - 1);
    const to = visible.to + 1;
    const top: Array<[number, number]> = [];
    const bot: Array<[number, number]> = [];
    const stA = typeof a !== 'number' ? this.styles[f.a] : null;
    const stB = typeof b !== 'number' ? this.styles[f.b] : null;
    const offA = stA?.offset ?? 0;
    const offB = stB?.offset ?? 0;
    for (let i = from; i <= to; i++) {
      const va = typeof a === 'number' ? a : a[i - offA];
      const vb = typeof b === 'number' ? b : b[i - offB];
      if (va !== va || vb !== vb || va === undefined || vb === undefined) {
        if (top.length > 1) fillBetween(ctx, top, bot, withAlpha(f.color, 1 - f.transparency / 100));
        top.length = 0; bot.length = 0;
        continue;
      }
      const x = timeScale.barCenterX(i);
      top.push([x, priceScale.priceToY(va)]);
      bot.push([x, priceScale.priceToY(vb)]);
    }
    if (top.length > 1) fillBetween(ctx, top, bot, withAlpha(f.color, 1 - f.transparency / 100));
  }

  // ---- legend / axis -------------------------------------------------------
  legendItems(index: number): LegendItem[] {
    const items: LegendItem[] = [];
    if (this.error) return [{ value: 'error', color: '#F23645' }];
    for (const p of this.def.plots) {
      const st = this.styles[p.id];
      if (!st || !st.visible || p.hideInLegend || st.type === 'bgcolor' || st.type === 'none' || st.type === 'shapes' || st.type === 'chars') continue;
      const vals = this.results[p.id]?.values;
      if (!vals) continue;
      const i = index - (st.offset ?? 0);
      const v = vals ? vals[i] : NaN;
      items.push({ value: v === v && v !== undefined ? this.formatValue(v) : '∅', color: this.results[p.id]?.colors?.[i] ?? st.color, label: this.def.plots.length > 1 ? p.title : undefined });
    }
    return items;
  }

  formatValue(v: number): string {
    const fmt = this.effectivePriceFormat();
    return formatPrice(v, fmt);
  }

  effectivePriceFormat(): PriceFormat {
    const base = this.priceFormat ?? { type: 'price', precision: 2, minMove: 1 };
    if (this.def.format === 'volume') return { type: 'volume', precision: 2, minMove: 1 };
    if (typeof this.def.precision === 'number') return { type: 'price', precision: this.def.precision, minMove: 1 };
    return base;
  }

  axisLabels(): AxisLabel[] {
    const out: AxisLabel[] = [];
    for (const p of this.def.plots) {
      const st = this.styles[p.id];
      if (!st || !st.visible || !st.showLast) continue;
      if (st.type === 'bgcolor' || st.type === 'none' || st.type === 'shapes' || st.type === 'chars') continue;
      const vals = this.results[p.id]?.values;
      if (!vals || vals.length === 0) continue;
      const i = vals.length - 1;
      const v = vals[i];
      if (v !== v) continue;
      out.push({ price: v, text: this.formatValue(v), bg: this.results[p.id]?.colors?.[i] ?? st.color, color: '#fff', line: st.trackPrice ? { color: st.color, width: 1, style: 1, visible: true } : undefined });
    }
    return out;
  }

  override hitTest(x: number, y: number, rc: { timeScale: TimeScale; priceScale: PriceScale }): HitResult | null {
    const i = rc.timeScale.xToBarIndex(x);
    let best: HitResult | null = null;
    for (const p of this.def.plots) {
      const st = this.styles[p.id];
      if (!st?.visible) continue;
      const vals = this.results[p.id]?.values;
      if (!vals) continue;
      const v = vals[i - (st.offset ?? 0)];
      if (v !== v || v === undefined) continue;
      const d = Math.abs(rc.priceScale.priceToY(v) - y);
      if (d <= 5 && (!best || d < best.distance)) best = { source: this, distance: d, detail: p.id };
    }
    return best;
  }

  serialize(): SerializedIndicator {
    return {
      id: this.id,
      def: this.def.id,
      inputs: { ...this.inputs },
      styles: JSON.parse(JSON.stringify(this.styles)),
      bands: JSON.parse(JSON.stringify(this.bands)),
      fills: JSON.parse(JSON.stringify(this.fills)),
      visible: this.visible,
      paneId: this.paneId,
      priceScaleId: this.priceScaleId,
    };
  }
}

export interface SerializedIndicator {
  id: string;
  def: string;
  inputs: Record<string, any>;
  styles: Record<string, PlotStyle>;
  bands: Record<string, IndicatorBand>;
  fills: Record<string, IndicatorFill>;
  visible: boolean;
  paneId: string;
  priceScaleId: string;
}

function shiftValues(vals: Float64Array, off: number): Float64Array {
  const out = new Float64Array(vals.length + Math.max(0, off));
  out.fill(NaN);
  for (let i = 0; i < vals.length; i++) {
    const j = i + off;
    if (j >= 0 && j < out.length) out[j] = vals[i];
  }
  return out;
}

function fillBetween(ctx: CanvasRenderingContext2D, top: Array<[number, number]>, bot: Array<[number, number]>, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i < top.length; i++) ctx.lineTo(top[i][0], top[i][1]);
  for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawShape(ctx: CanvasRenderingContext2D, shape: ShapeStyle, x: number, y: number, size: number): void {
  const h = size / 2;
  ctx.beginPath();
  switch (shape) {
    case 'arrowUp':
    case 'triangleUp':
    case 'labelUp':
      ctx.moveTo(x, y - h); ctx.lineTo(x + h, y + h); ctx.lineTo(x - h, y + h); ctx.closePath(); ctx.fill(); break;
    case 'arrowDown':
    case 'triangleDown':
    case 'labelDown':
      ctx.moveTo(x, y + h); ctx.lineTo(x + h, y - h); ctx.lineTo(x - h, y - h); ctx.closePath(); ctx.fill(); break;
    case 'circle':
      ctx.arc(x, y, h, 0, Math.PI * 2); ctx.fill(); break;
    case 'square':
      ctx.rect(x - h, y - h, size, size); ctx.fill(); break;
    case 'diamond':
      ctx.moveTo(x, y - h); ctx.lineTo(x + h, y); ctx.lineTo(x, y + h); ctx.lineTo(x - h, y); ctx.closePath(); ctx.fill(); break;
    case 'cross':
      ctx.lineWidth = 2; ctx.moveTo(x - h, y); ctx.lineTo(x + h, y); ctx.moveTo(x, y - h); ctx.lineTo(x, y + h); ctx.stroke(); break;
    case 'xcross':
      ctx.lineWidth = 2; ctx.moveTo(x - h, y - h); ctx.lineTo(x + h, y + h); ctx.moveTo(x + h, y - h); ctx.lineTo(x - h, y + h); ctx.stroke(); break;
    case 'flag':
      ctx.rect(x - 1, y - h, 2, size); ctx.fill(); ctx.beginPath(); ctx.moveTo(x + 1, y - h); ctx.lineTo(x + h + 2, y - h / 2); ctx.lineTo(x + 1, y); ctx.closePath(); ctx.fill(); break;
  }
}

/** Build an IndicatorContext from bars. */
export function buildIndicatorContext(bars: Bar[], resolution: ResolutionString, symbolInfo: SymbolInfo | null, timezone: string, minMove: number): IndicatorContext {
  const n = bars.length;
  const time = new Float64Array(n), open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n), close = new Float64Array(n), volume = new Float64Array(n);
  const hl2 = new Float64Array(n), hlc3 = new Float64Array(n), ohlc4 = new Float64Array(n), hlcc4 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    time[i] = b.time; open[i] = b.open; high[i] = b.high; low[i] = b.low; close[i] = b.close; volume[i] = b.volume ?? NaN;
    hl2[i] = (b.high + b.low) / 2; hlc3[i] = (b.high + b.low + b.close) / 3; ohlc4[i] = (b.open + b.high + b.low + b.close) / 4; hlcc4[i] = (b.high + b.low + 2 * b.close) / 4;
  }
  const ctx: IndicatorContext = {
    bars, n, time, open, high, low, close, volume, hl2, hlc3, ohlc4, hlcc4, resolution, symbolInfo, timezone, minMove, ta,
    source(name: string) {
      switch (name) {
        case 'open': return open; case 'high': return high; case 'low': return low; case 'close': return close;
        case 'hl2': return hl2; case 'hlc3': return hlc3; case 'ohlc4': return ohlc4; case 'hlcc4': return hlcc4; case 'volume': return volume;
        default: {
          const out = new Float64Array(n);
          for (let i = 0; i < n; i++) out[i] = priceSourceValue(bars[i], name as PriceSource);
          return out;
        }
      }
    },
  };
  return ctx;
}

// ---- registry ----------------------------------------------------------------
const registry = new Map<string, IndicatorDefinition>();
const aliasMap = new Map<string, string>();

export function registerIndicator(def: IndicatorDefinition): void {
  registry.set(def.id, def);
  aliasMap.set(def.id.toLowerCase(), def.id);
  aliasMap.set(def.name.toLowerCase(), def.id);
  aliasMap.set(def.shortName.toLowerCase(), def.id);
  for (const a of def.aliases || []) aliasMap.set(a.toLowerCase(), def.id);
}

export function getIndicator(idOrName: string): IndicatorDefinition | undefined {
  return registry.get(idOrName) ?? registry.get(aliasMap.get(idOrName.toLowerCase()) ?? '');
}

export function listIndicators(): IndicatorDefinition[] {
  return Array.from(registry.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function searchIndicators(query: string): IndicatorDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q) return listIndicators();
  return listIndicators().filter((d) => d.name.toLowerCase().includes(q) || d.shortName.toLowerCase().includes(q) || (d.aliases || []).some((a) => a.toLowerCase().includes(q)) || (d.category || '').toLowerCase().includes(q));
}
