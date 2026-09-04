import { Delegate } from '../util/events';
import { clamp, niceStep, log10 } from '../util/math';
import { formatPrice, formatPercent } from '../util/format';
import type { PriceFormat } from '../data/types';
import type { PriceScaleOptions, PriceScaleMode } from './options';

export interface PriceRange { min: number; max: number }
export interface PriceTick { price: number; y: number; label: string }

const LOG_OFFSET = 4;
const COORD_OFFSET = 0.0001;

function toLog(price: number): number {
  const m = Math.abs(price);
  if (m < 1e-15) return 0;
  const res = log10(m + COORD_OFFSET) + LOG_OFFSET;
  return price < 0 ? -res : res;
}

function fromLog(v: number): number {
  const m = Math.abs(v);
  if (m < 1e-15) return 0;
  const res = Math.pow(10, m - LOG_OFFSET) - COORD_OFFSET;
  return v < 0 ? -res : res;
}

/** Something that can contribute to auto-scale (series, indicators). */
export interface PriceRangeProvider {
  /** Price range in [fromIndex, toIndex] or null if no data. */
  priceRange(from: number, to: number): PriceRange | null;
  /** Is this the main series (used for percentage/indexed base and scaleSeriesOnly). */
  isMainSeries?: boolean;
  /** Provide base value for percentage/indexed modes (first visible value). */
  baseValueAt?(index: number): number | null;
  visible?: boolean;
}

/**
 * PriceScale: maps prices to Y pixels with support for normal/log/percentage/indexed modes,
 * auto scaling with margins, inversion and manual scale/scroll.
 */
export class PriceScale {
  readonly changed = new Delegate<void>();
  readonly id: string;
  private _height = 0;
  private _range: PriceRange | null = null; // internal (transformed) coordinates
  private _priceFormat: PriceFormat = { type: 'price', precision: 2, minMove: 1 };
  private _base = 1; // base for percentage/indexed modes
  private _providers: PriceRangeProvider[] = [];
  private _tickCache: { key: string; ticks: PriceTick[] } | null = null;
  private _manualRange = false; // set when user scaled/scrolled manually (autoscale off)
  /** left/right/overlay */
  position: 'left' | 'right' | 'overlay';
  /** Extra margins from scaleMargins when overlay (e.g. volume at bottom 20%). */
  overlayMargins: { top: number; bottom: number } | null = null;

  constructor(id: string, public options: PriceScaleOptions, position: 'left' | 'right' | 'overlay') {
    this.id = id;
    this.position = position;
  }

  get height(): number { return this._height; }
  get mode(): PriceScaleMode { return this.options.mode; }
  get inverted(): boolean { return this.options.invertScale; }
  get isAutoScale(): boolean { return this.options.autoScale; }
  get priceFormat(): PriceFormat { return this._priceFormat; }
  get providers(): PriceRangeProvider[] { return this._providers; }
  get isEmpty(): boolean { return this._range === null; }

  setHeight(h: number): void {
    if (h === this._height) return;
    this._height = h;
    this._tickCache = null;
    this.changed.fire();
  }

  setPriceFormat(f: PriceFormat): void {
    this._priceFormat = f;
    this._tickCache = null;
  }

  setMode(mode: PriceScaleMode): void {
    if (mode === this.options.mode) return;
    // convert current range to price then re-transform
    const priceRange = this._range ? { min: this.fromInternal(this._range.min), max: this.fromInternal(this._range.max) } : null;
    this.options.mode = mode;
    if (priceRange) {
      const a = this.toInternal(priceRange.min);
      const b = this.toInternal(priceRange.max);
      this._range = { min: Math.min(a, b), max: Math.max(a, b) };
    }
    this._tickCache = null;
    this.changed.fire();
  }

  setInverted(inv: boolean): void {
    if (inv === this.options.invertScale) return;
    this.options.invertScale = inv;
    this._tickCache = null;
    this.changed.fire();
  }

  setAutoScale(auto: boolean): void {
    this.options.autoScale = auto;
    this._manualRange = !auto;
    this._tickCache = null;
    this.changed.fire();
  }

  addProvider(p: PriceRangeProvider): void {
    if (!this._providers.includes(p)) this._providers.push(p);
  }

  removeProvider(p: PriceRangeProvider): void {
    const i = this._providers.indexOf(p);
    if (i >= 0) this._providers.splice(i, 1);
  }

  // ---- transforms ------------------------------------------------------
  toInternal(price: number): number {
    switch (this.options.mode) {
      case 'logarithmic': return toLog(price);
      case 'percentage': return this._base !== 0 ? ((price - this._base) / this._base) * 100 : 0;
      case 'indexedTo100': return this._base !== 0 ? (price / this._base) * 100 : 0;
      default: return price;
    }
  }

  fromInternal(v: number): number {
    switch (this.options.mode) {
      case 'logarithmic': return fromLog(v);
      case 'percentage': return this._base + (v / 100) * this._base;
      case 'indexedTo100': return (v / 100) * this._base;
      default: return v;
    }
  }

  get base(): number { return this._base; }
  setBase(base: number): void {
    if (base === this._base || !Number.isFinite(base) || base === 0) return;
    this._base = base;
    this._tickCache = null;
  }

  /** Current visible range in price units. */
  priceRange(): PriceRange | null {
    if (!this._range) return null;
    const a = this.fromInternal(this._range.min);
    const b = this.fromInternal(this._range.max);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  internalRange(): PriceRange | null { return this._range; }

  setPriceRange(r: PriceRange, manual = true): void {
    const a = this.toInternal(r.min);
    const b = this.toInternal(r.max);
    this._range = { min: Math.min(a, b), max: Math.max(a, b) };
    if (manual) {
      this.options.autoScale = false;
      this._manualRange = true;
    }
    this._tickCache = null;
    this.changed.fire();
  }

  private _internalToY(v: number): number {
    const r = this._range;
    if (!r || this._height === 0) return 0;
    const span = r.max - r.min || 1;
    const t = (v - r.min) / span; // 0 bottom .. 1 top
    const y = this.options.invertScale ? t * this._height : (1 - t) * this._height;
    return y;
  }

  private _yToInternal(y: number): number {
    const r = this._range;
    if (!r || this._height === 0) return 0;
    const span = r.max - r.min || 1;
    const t = this.options.invertScale ? y / this._height : 1 - y / this._height;
    return r.min + t * span;
  }

  priceToY(price: number): number {
    return this._internalToY(this.toInternal(price));
  }

  yToPrice(y: number): number {
    return this.fromInternal(this._yToInternal(y));
  }

  // ---- auto scale ------------------------------------------------------
  /** Recompute the range from providers for the visible bar range. */
  autoScaleFor(from: number, to: number, mainOnly = false): void {
    if (!this.options.autoScale || this._height <= 0) return;
    let min = Infinity;
    let max = -Infinity;
    // establish base for percentage/indexed modes: first visible value of main series
    if (this.options.mode === 'percentage' || this.options.mode === 'indexedTo100') {
      const main = this._providers.find((p) => p.isMainSeries && p.baseValueAt) ?? this._providers.find((p) => p.baseValueAt);
      if (main && main.baseValueAt) {
        const b = main.baseValueAt(from);
        if (b !== null && b !== 0 && Number.isFinite(b)) this._base = b;
      }
    }
    for (const p of this._providers) {
      if (p.visible === false) continue;
      if (mainOnly && !p.isMainSeries) continue;
      const r = p.priceRange(from, to);
      if (!r) continue;
      if (r.min < min) min = r.min;
      if (r.max > max) max = r.max;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return;
    }
    if (min === max) {
      const pad = Math.abs(min) * 0.01 || 1;
      min -= pad;
      max += pad;
    }
    let iMin = this.toInternal(min);
    let iMax = this.toInternal(max);
    if (iMin > iMax) [iMin, iMax] = [iMax, iMin];
    // margins (in pixels -> internal)
    const mTop = this.overlayMargins ? this.overlayMargins.top : this.options.scaleMargins.top;
    const mBottom = this.overlayMargins ? this.overlayMargins.bottom : this.options.scaleMargins.bottom;
    const usable = Math.max(1e-9, 1 - mTop - mBottom);
    const span = (iMax - iMin) / usable;
    iMin = iMin - span * mBottom;
    iMax = iMax + span * mTop;
    if (!this._range || this._range.min !== iMin || this._range.max !== iMax) {
      this._range = { min: iMin, max: iMax };
      this._tickCache = null;
      this.changed.fire();
    }
  }

  /** Scale the range by factor around a pixel y (axis drag / wheel). */
  scaleAround(y: number, factor: number): void {
    if (!this._range) return;
    const anchor = this._yToInternal(y);
    const r = this._range;
    const min = anchor - (anchor - r.min) * factor;
    const max = anchor + (r.max - anchor) * factor;
    if (max - min < 1e-12) return;
    this._range = { min, max };
    this.options.autoScale = false;
    this._manualRange = true;
    this._tickCache = null;
    this.changed.fire();
  }

  /** Scale by pixel delta from an axis drag (TradingView: drag up = zoom in). */
  scaleByDrag(startY: number, dy: number): void {
    const factor = Math.exp(dy / 200);
    this.scaleAround(startY, factor);
  }

  /** Scroll the range by pixel delta (vertical chart drag when not auto). */
  scrollByPixels(dy: number): void {
    if (!this._range || this._height === 0) return;
    const span = this._range.max - this._range.min;
    const shift = (dy / this._height) * span * (this.options.invertScale ? -1 : 1);
    this._range = { min: this._range.min + shift, max: this._range.max + shift };
    this.options.autoScale = false;
    this._manualRange = true;
    this._tickCache = null;
    this.changed.fire();
  }

  // ---- formatting ------------------------------------------------------
  formatPrice(price: number): string {
    switch (this.options.mode) {
      case 'percentage': return formatPercent(this.toInternal(price), 2);
      case 'indexedTo100': return this.toInternal(price).toFixed(2);
      default: return formatPrice(price, this._priceFormat);
    }
  }

  /** Format a price for an axis tick (may differ from crosshair formatting). */
  formatTick(price: number): string {
    return this.formatPrice(price);
  }

  // ---- ticks -------------------------------------------------------------
  ticks(minSpacing = 40, font?: string): PriceTick[] {
    const r = this._range;
    if (!r || this._height <= 0) return [];
    const key = `${r.min}|${r.max}|${this._height}|${this.options.mode}|${this.options.invertScale}|${minSpacing}|${this._base}`;
    if (this._tickCache && this._tickCache.key === key) return this._tickCache.ticks;
    let ticks: PriceTick[];
    if (this.options.mode === 'logarithmic') ticks = this._logTicks(minSpacing);
    else ticks = this._linearTicks(minSpacing);
    this._tickCache = { key, ticks };
    return ticks;
  }

  private _linearTicks(minSpacing: number): PriceTick[] {
    const r = this._range!;
    const span = r.max - r.min;
    const maxTicks = Math.max(1, Math.floor(this._height / minSpacing));
    let step = niceStep(span / maxTicks);
    // respect minimal price movement in normal mode
    if (this.options.mode === 'normal') {
      const minStep = this._priceFormat.minMove / Math.pow(10, this._priceFormat.precision);
      if (step < minStep) step = minStep;
    }
    const out: PriceTick[] = [];
    const start = Math.ceil(r.min / step) * step;
    const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
    for (let v = start; v <= r.max + step * 1e-6; v += step) {
      const vv = parseFloat(v.toFixed(decimals + 2));
      const y = this._internalToY(vv);
      if (y < -1 || y > this._height + 1) continue;
      out.push({ price: this.fromInternal(vv), y, label: this._labelForInternal(vv) });
      if (out.length > 200) break;
    }
    return out;
  }

  private _labelForInternal(v: number): string {
    switch (this.options.mode) {
      case 'percentage': return formatPercent(v, 2);
      case 'indexedTo100': return v.toFixed(2);
      default: return formatPrice(this.fromInternal(v), this._priceFormat);
    }
  }

  private _logTicks(minSpacing: number): PriceTick[] {
    const pr = this.priceRange();
    if (!pr) return [];
    const out: PriceTick[] = [];
    const minP = Math.max(pr.min, 1e-12);
    const maxP = pr.max;
    if (maxP <= minP) return out;
    const startExp = Math.floor(log10(minP));
    const endExp = Math.ceil(log10(maxP));
    const mults = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    let lastY = Infinity;
    for (let e = startExp; e <= endExp; e++) {
      const base = Math.pow(10, e);
      const decadeTop = base * 10;
      // choose step so spacing at top of decade >= minSpacing
      let step = base;
      for (const m of mults) {
        step = base * m;
        const y1 = this.priceToY(decadeTop - step);
        const y2 = this.priceToY(decadeTop);
        if (Math.abs(y1 - y2) >= minSpacing) break;
      }
      for (let p = base; p < decadeTop - step * 1e-6; p += step) {
        if (p < minP || p > maxP) continue;
        const y = this.priceToY(p);
        if (Math.abs(y - lastY) < minSpacing * 0.9) continue;
        out.push({ price: p, y, label: formatPrice(p, this._priceFormat) });
        lastY = y;
        if (out.length > 300) return out;
      }
    }
    // handle negative / zero ranges crudely by falling back to linear ticks
    if (out.length === 0) return this._linearTicks(minSpacing);
    return out.sort((a, b) => a.y - b.y);
  }
}
