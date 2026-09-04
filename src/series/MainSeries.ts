import { DataSource, type RenderContext, type LegendItem, type AxisLabel, type HitResult } from './Series';
import type { Bar, PriceFormat, SeriesType, SymbolInfo } from '../data/types';
import type { PriceRange } from '../core/PriceScale';
import type { ChartOptions, SeriesStyleOptions } from '../core/options';
import { priceSourceValue } from '../data/types';
import { renderCandles, renderBars, renderLine, renderArea, renderBaseline, renderColumns, renderHighLow, renderHLCArea } from './renderers';
import { heikinAshi, renko, lineBreak, kagi, pointAndFigure, rangeBars, type SyntheticBar } from './synthetic';
import { Delegate } from '../util/events';
import { formatChange, formatPercent, formatPrice, formatVolume } from '../util/format';
import { crisp, setLineStyle } from '../render/canvas';
import type { TimeScale } from '../core/TimeScale';
import type { PriceScale } from '../core/PriceScale';

const SYNTHETIC: Set<SeriesType> = new Set(['heikinAshi', 'renko', 'lineBreak', 'kagi', 'pointAndFigure', 'rangeBars']);

export function isSyntheticType(t: SeriesType): boolean { return SYNTHETIC.has(t); }
export function isSyntheticTimeType(t: SeriesType): boolean { return t !== 'heikinAshi' && SYNTHETIC.has(t); }

/** The symbol (main) series. */
export class MainSeries extends DataSource {
  override isMainSeries = true;
  readonly barsChanged = new Delegate<{ prepended: number; appended: number; reset: boolean }>();
  type: SeriesType = 'candles';
  rawBars: Bar[] = [];
  bars: Bar[] = [];
  symbolInfo: SymbolInfo | null = null;
  override priceFormat: PriceFormat = { type: 'price', precision: 2, minMove: 1 };
  private _high: Float64Array = new Float64Array(0);
  private _low: Float64Array = new Float64Array(0);
  private _styles: SeriesStyleOptions;
  private _options: ChartOptions;

  constructor(options: ChartOptions) {
    super('main');
    this._options = options;
    this._styles = options.series;
    this.title = '';
  }

  get styles(): SeriesStyleOptions { return this._styles; }
  setOptions(options: ChartOptions): void {
    this._options = options;
    this._styles = options.series;
  }

  get minMove(): number {
    return this.priceFormat.minMove / Math.pow(10, this.priceFormat.precision);
  }

  setSymbolInfo(info: SymbolInfo | null): void {
    this.symbolInfo = info;
    if (info) {
      const precision = Math.max(0, Math.round(Math.log10(Math.max(1, info.pricescale))));
      this.priceFormat = { type: info.format === 'volume' ? 'volume' : 'price', precision, minMove: info.minmov || 1, fractional: info.fractional, minMove2: info.minmove2 };
      this.title = info.name;
    }
  }

  setType(type: SeriesType): void {
    if (type === this.type) return;
    this.type = type;
    this.rebuild(true);
  }

  /** Replace raw bars (seconds). */
  setData(bars: Bar[], change: { prepended: number; appended: number; reset: boolean } = { prepended: 0, appended: 0, reset: true }): void {
    this.rawBars = bars;
    this.rebuild(change.reset, change);
  }

  /** Update (or append) the last raw bar from a realtime tick. */
  updateLast(bar: Bar): 'update' | 'append' {
    const n = this.rawBars.length;
    if (n > 0 && this.rawBars[n - 1].time === bar.time) {
      this.rawBars[n - 1] = bar;
      this.rebuild(false, { prepended: 0, appended: 0, reset: false });
      return 'update';
    }
    this.rawBars.push(bar);
    this.rebuild(false, { prepended: 0, appended: 1, reset: false });
    return 'append';
  }

  rebuild(reset = false, change?: { prepended: number; appended: number; reset: boolean }): void {
    const raw = this.rawBars;
    const prevLen = this.bars.length;
    let bars: Bar[];
    const st = this._styles;
    switch (this.type) {
      case 'heikinAshi': bars = heikinAshi(raw); break;
      case 'renko': bars = renko(raw, st.renko, this.minMove); break;
      case 'lineBreak': bars = lineBreak(raw, st.lineBreak); break;
      case 'kagi': bars = kagi(raw, st.kagi, this.minMove); break;
      case 'pointAndFigure': bars = pointAndFigure(raw, st.pointAndFigure, this.minMove); break;
      case 'rangeBars': bars = rangeBars(raw, st.rangeBars, this.minMove); break;
      default: bars = raw;
    }
    this.bars = bars;
    const n = bars.length;
    if (this._high.length !== n) {
      this._high = new Float64Array(n);
      this._low = new Float64Array(n);
    }
    for (let i = 0; i < n; i++) {
      this._high[i] = bars[i].high;
      this._low[i] = bars[i].low;
    }
    let evt = change ?? { prepended: 0, appended: 0, reset };
    if (isSyntheticTimeType(this.type)) {
      // synthetic time axis: number of bars is not preserved; approximate as reset unless only the tail changed
      const appended = Math.max(0, n - prevLen);
      evt = { prepended: 0, appended: change && change.reset === false && change.prepended === 0 ? appended : 0, reset: reset || (change?.prepended ?? 0) > 0 };
    }
    this.barsChanged.fire(evt);
  }

  get times(): number[] {
    return this.bars.map((b) => b.time);
  }

  // ---- PriceRangeProvider --------------------------------------------
  priceRange(from: number, to: number): PriceRange | null {
    const n = this.bars.length;
    if (n === 0) return null;
    from = Math.max(0, from);
    to = Math.min(n - 1, to);
    if (from > to) return null;
    let min = Infinity;
    let max = -Infinity;
    const lineLike = this.type === 'line' || this.type === 'lineWithMarkers' || this.type === 'stepLine' || this.type === 'area' || this.type === 'baseline' || this.type === 'columns';
    if (lineLike) {
      const src = this._lineSource();
      for (let i = from; i <= to; i++) {
        const v = priceSourceValue(this.bars[i], src);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (this.type === 'columns') { min = Math.min(min, 0); max = Math.max(max, 0); }
    } else {
      for (let i = from; i <= to; i++) {
        const h = this._high[i];
        const l = this._low[i];
        if (h > max) max = h;
        if (l < min) min = l;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min, max };
  }

  private _lineSource() {
    switch (this.type) {
      case 'line': return this._styles.line.priceSource;
      case 'lineWithMarkers': return this._styles.lineWithMarkers.priceSource;
      case 'stepLine': return this._styles.stepLine.priceSource;
      case 'area': return this._styles.area.priceSource;
      case 'baseline': return this._styles.baseline.priceSource;
      case 'columns': return this._styles.columns.priceSource;
      default: return 'close' as const;
    }
  }

  override baseValueAt(index: number): number | null {
    const b = this.bars[Math.max(0, Math.min(this.bars.length - 1, Math.round(index)))];
    if (!b) return null;
    return b.close;
  }

  // ---- render ------------------------------------------------------------
  render(rc: RenderContext): void {
    const st = this._styles;
    const bars = this.bars;
    if (bars.length === 0) return;
    switch (this.type) {
      case 'candles': renderCandles(rc, bars, st.candles); break;
      case 'hollowCandles': renderCandles(rc, bars, st.hollowCandles, 'hollow'); break;
      case 'volumeCandles': this._renderVolumeCandles(rc); break;
      case 'heikinAshi': renderCandles(rc, bars, st.heikinAshi); break;
      case 'bars': renderBars(rc, bars, st.bars); break;
      case 'line': renderLine(rc, bars, st.line); break;
      case 'lineWithMarkers': renderLine(rc, bars, st.lineWithMarkers); break;
      case 'stepLine': renderLine(rc, bars, st.stepLine); break;
      case 'area': renderArea(rc, bars, st.area); break;
      case 'hlcArea': renderHLCArea(rc, bars, st.hlcArea); break;
      case 'baseline': renderBaseline(rc, bars, st.baseline); break;
      case 'columns': renderColumns(rc, bars, st.columns); break;
      case 'highLow': renderHighLow(rc, bars, st.highLow); break;
      case 'renko': renderCandles(rc, bars, { ...st.renko, wickVisible: st.renko.wicks }); break;
      case 'lineBreak': renderCandles(rc, bars, { ...st.lineBreak, wickVisible: false }); break;
      case 'rangeBars': renderCandles(rc, bars, st.rangeBars); break;
      case 'kagi': this._renderKagi(rc); break;
      case 'pointAndFigure': this._renderPnF(rc); break;
    }
  }

  private _renderVolumeCandles(rc: RenderContext): void {
    // candle width proportional to volume (TradingView "Volume candles")
    const { ctx, timeScale, priceScale, visible, dpr } = rc;
    const st = this._styles.volumeCandles;
    const bars = this.bars;
    let maxV = 0;
    for (let i = visible.from; i <= visible.to; i++) maxV = Math.max(maxV, bars[i]?.volume ?? 0);
    const bs = timeScale.barSpacing;
    ctx.save();
    for (let i = visible.from; i <= visible.to; i++) {
      const b = bars[i];
      if (!b) continue;
      const up = b.close >= b.open;
      const ratio = maxV > 0 ? Math.max(0.15, (b.volume ?? 0) / maxV) : 1;
      const w = Math.max(1, Math.floor(bs * 0.9 * ratio));
      const xc = timeScale.barCenterX(i);
      const yO = priceScale.priceToY(b.open), yC = priceScale.priceToY(b.close);
      const top = Math.min(yO, yC), bottom = Math.max(yO, yC);
      ctx.strokeStyle = up ? st.wickUpColor : st.wickDownColor;
      ctx.beginPath();
      const wx = crisp(xc, dpr);
      ctx.moveTo(wx, priceScale.priceToY(b.high));
      ctx.lineTo(wx, priceScale.priceToY(b.low));
      ctx.stroke();
      ctx.fillStyle = up ? st.upColor : st.downColor;
      ctx.fillRect(Math.round(xc - w / 2), top, w, Math.max(1, bottom - top));
    }
    ctx.restore();
  }

  private _renderKagi(rc: RenderContext): void {
    const { ctx, timeScale, priceScale, visible } = rc;
    const st = this._styles.kagi;
    const bars = this.bars as SyntheticBar[];
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    for (let i = Math.max(0, visible.from - 1); i <= visible.to; i++) {
      const b = bars[i];
      if (!b) continue;
      const x = timeScale.barCenterX(i);
      const yFrom = priceScale.priceToY(b.open);
      const yTo = priceScale.priceToY(b.close);
      const thick = b.thick !== false;
      ctx.lineWidth = thick ? st.lineWidth + 2 : st.lineWidth;
      ctx.strokeStyle = thick ? st.upColor : st.downColor;
      ctx.beginPath();
      ctx.moveTo(x, yFrom);
      ctx.lineTo(x, yTo);
      ctx.stroke();
      // horizontal connector to the next line
      const nb = bars[i + 1];
      if (nb) {
        const nx = timeScale.barCenterX(i + 1);
        const nthick = nb.thick !== false;
        ctx.lineWidth = nthick ? st.lineWidth + 2 : st.lineWidth;
        ctx.strokeStyle = nthick ? st.upColor : st.downColor;
        ctx.beginPath();
        ctx.moveTo(x, yTo);
        ctx.lineTo(nx, yTo);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private _renderPnF(rc: RenderContext): void {
    const { ctx, timeScale, priceScale, visible } = rc;
    const st = this._styles.pointAndFigure;
    const bars = this.bars as SyntheticBar[];
    const bs = timeScale.barSpacing;
    const w = Math.max(2, bs * 0.8);
    ctx.save();
    ctx.lineWidth = Math.max(1, Math.min(2, bs / 6));
    for (let i = visible.from; i <= visible.to; i++) {
      const b = bars[i];
      if (!b) continue;
      const boxes = Math.max(1, b.boxes ?? 1);
      const box = Math.abs(b.close - b.open) / boxes;
      const x = timeScale.barCenterX(i);
      const up = (b.dir ?? 1) > 0;
      ctx.strokeStyle = up ? st.upColor : st.downColor;
      for (let k = 0; k < boxes; k++) {
        const p0 = up ? b.open + k * box : b.open - (k + 1) * box;
        const p1 = p0 + box;
        const y0 = priceScale.priceToY(p1);
        const y1 = priceScale.priceToY(p0);
        const h = y1 - y0;
        if (h < 2 || w < 3) {
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
          continue;
        }
        ctx.beginPath();
        if (up) {
          ctx.moveTo(x - w / 2, y0); ctx.lineTo(x + w / 2, y1);
          ctx.moveTo(x + w / 2, y0); ctx.lineTo(x - w / 2, y1);
        } else {
          ctx.ellipse(x, (y0 + y1) / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---- legend / axis -------------------------------------------------------
  legendItems(index: number): LegendItem[] {
    const bars = this.bars;
    if (bars.length === 0) return [];
    const i = Math.max(0, Math.min(bars.length - 1, index));
    const b = bars[i];
    const prev = bars[i - 1];
    const up = b.close >= b.open;
    const color = this._upDownColor(up);
    const f = this.priceFormat;
    const items: LegendItem[] = [
      { label: 'O', value: formatPrice(b.open, f), color },
      { label: 'H', value: formatPrice(b.high, f), color },
      { label: 'L', value: formatPrice(b.low, f), color },
      { label: 'C', value: formatPrice(b.close, f), color },
    ];
    const opts = this._options.legend;
    if (opts.showBarChange) {
      const ref = prev ? prev.close : b.open;
      const ch = b.close - ref;
      const pct = ref !== 0 ? (ch / ref) * 100 : 0;
      items.push({ value: `${formatChange(ch, f)} (${formatPercent(pct, 2)})`, color: ch >= 0 ? this._upDownColor(true) : this._upDownColor(false) });
    }
    if (opts.showVolume && Number.isFinite(b.volume ?? NaN)) {
      items.push({ label: 'Vol', value: formatVolume(b.volume as number, 2), color: up ? this._options.volume.upColor : this._options.volume.downColor });
    }
    return items;
  }

  private _upDownColor(up: boolean): string {
    const st = this._styles;
    switch (this.type) {
      case 'bars': return up ? st.bars.upColor : st.bars.downColor;
      case 'line': case 'stepLine': case 'lineWithMarkers': return st.line.color;
      case 'area': return st.area.lineColor;
      case 'baseline': return up ? st.baseline.topLineColor : st.baseline.bottomLineColor;
      case 'columns': return up ? st.columns.upColor : st.columns.downColor;
      case 'hollowCandles': return up ? st.hollowCandles.upColor : st.hollowCandles.downColor;
      case 'heikinAshi': return up ? st.heikinAshi.upColor : st.heikinAshi.downColor;
      case 'renko': return up ? st.renko.upColor : st.renko.downColor;
      case 'kagi': return up ? st.kagi.upColor : st.kagi.downColor;
      case 'lineBreak': return up ? st.lineBreak.upColor : st.lineBreak.downColor;
      case 'pointAndFigure': return up ? st.pointAndFigure.upColor : st.pointAndFigure.downColor;
      case 'rangeBars': return up ? st.rangeBars.upColor : st.rangeBars.downColor;
      case 'highLow': return st.highLow.bodyColor;
      case 'hlcArea': return st.hlcArea.closeLineColor;
      default: return up ? st.candles.upColor : st.candles.downColor;
    }
  }

  lastBar(): Bar | null {
    return this.bars.length ? this.bars[this.bars.length - 1] : null;
  }

  axisLabels(): AxisLabel[] {
    const b = this.lastBar();
    if (!b || !this._options.symbol.lastValueVisible) return [];
    const prev = this.bars[this.bars.length - 2];
    const up = prev ? b.close >= prev.close : b.close >= b.open;
    const bg = this._upDownColor(up);
    const pl = this._options.symbol.priceLine;
    return [{ price: b.close, text: '', bg, color: '#ffffff', line: { color: pl.color ?? bg, width: pl.width, style: pl.style, visible: pl.visible } }];
  }

  override hitTest(x: number, y: number, rc: { timeScale: TimeScale; priceScale: PriceScale }): HitResult | null {
    const i = rc.timeScale.xToBarIndex(x);
    const b = this.bars[i];
    if (!b) return null;
    const yH = rc.priceScale.priceToY(b.high);
    const yL = rc.priceScale.priceToY(b.low);
    if (y >= yH - 3 && y <= yL + 3) return { source: this, distance: 0, detail: i };
    return null;
  }

  /** Draw the last-price horizontal line inside the pane. */
  renderPriceLine(rc: RenderContext): void {
    const b = this.lastBar();
    if (!b) return;
    const pl = this._options.symbol.priceLine;
    if (!pl.visible) return;
    const prev = this.bars[this.bars.length - 2];
    const up = prev ? b.close >= prev.close : b.close >= b.open;
    const color = pl.color ?? this._upDownColor(up);
    const y = crisp(rc.priceScale.priceToY(b.close), rc.dpr, pl.width);
    const { ctx } = rc;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = pl.width;
    setLineStyle(ctx, pl.style, pl.width);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(rc.width, y);
    ctx.stroke();
    ctx.restore();
  }
}
