import { DataSource, type RenderContext, type LegendItem, type AxisLabel } from './Series';
import type { PriceRange } from '../core/PriceScale';
import type { Bar, Datafeed, ResolutionString, SymbolInfo } from '../data/types';
import { DataLoader } from '../data/DataLoader';
import { Delegate } from '../util/events';
import { strokePolyline, renderCandles, renderBars } from './renderers';
import { formatPrice, formatPercent } from '../util/format';
import type { CandleStyleOptions, BarStyleOptions, LineWidth, LineStyle } from '../core/options';
import type { TimeScale } from '../core/TimeScale';
import type { PriceScale } from '../core/PriceScale';
import { lowerBound } from '../util/math';

export interface CompareStyle {
  type: 'line' | 'area' | 'candles' | 'bars';
  color: string;
  lineWidth: LineWidth;
  lineStyle: LineStyle;
  upColor: string;
  downColor: string;
}

/**
 * A second symbol overlaid on the chart (TradingView "Compare"). Bars are aligned to the
 * main time axis by time (last known value carried forward for missing bars).
 */
export class CompareSeries extends DataSource {
  readonly loader: DataLoader;
  readonly changed = new Delegate<void>();
  symbolInfo: SymbolInfo | null = null;
  style: CompareStyle;
  /** aligned arrays (main bar index space) */
  aligned: Bar[] = [];
  private _mainTimes: number[] = [];
  private _resolution: ResolutionString = '1D';

  constructor(datafeed: Datafeed, readonly symbol: string, style: Partial<CompareStyle> = {}, id?: string) {
    super(id);
    this.loader = new DataLoader(datafeed);
    this.style = { type: 'line', color: '#FF6D00', lineWidth: 2, lineStyle: 0, upColor: '#089981', downColor: '#F23645', ...style };
    this.title = symbol;
    this.zIndex = 2;
    this.loader.symbolResolved.subscribe((info) => { this.symbolInfo = info; this.title = info.name; const precision = Math.max(0, Math.round(Math.log10(Math.max(1, info.pricescale)))); this.priceFormat = { type: 'price', precision, minMove: info.minmov || 1 }; });
    this.loader.barsUpdated.subscribe(() => { this.realign(); this.changed.fire(); });
  }

  load(resolution: ResolutionString, countBack = 300): Promise<void> {
    this._resolution = resolution;
    return this.loader.setSymbol(this.symbol, resolution, countBack);
  }

  /** Called when the main series' times change. */
  setMainTimes(times: number[]): void {
    this._mainTimes = times;
    this.realign();
    // make sure we cover the main history
    if (times.length && this.loader.bars.length && this.loader.bars[0].time > times[0] && this.loader.canLoadMore()) void this.loader.loadMore();
  }

  realign(): void {
    const src = this.loader.bars;
    const times = this._mainTimes;
    const out: Bar[] = new Array(times.length);
    const srcTimes = src.map((b) => b.time);
    for (let i = 0; i < times.length; i++) {
      const j = lowerBound(srcTimes, times[i]);
      out[i] = j >= 0 ? src[j] : { time: times[i], open: NaN, high: NaN, low: NaN, close: NaN };
    }
    this.aligned = out;
  }

  priceRange(from: number, to: number): PriceRange | null {
    let min = Infinity, max = -Infinity;
    const lineLike = this.style.type === 'line' || this.style.type === 'area';
    for (let i = Math.max(0, from); i <= Math.min(this.aligned.length - 1, to); i++) {
      const b = this.aligned[i];
      if (!b || !Number.isFinite(b.close)) continue;
      const lo = lineLike ? b.close : b.low;
      const hi = lineLike ? b.close : b.high;
      if (lo < min) min = lo;
      if (hi > max) max = hi;
    }
    return Number.isFinite(min) ? { min, max } : null;
  }

  override baseValueAt(index: number): number | null {
    const b = this.aligned[Math.max(0, Math.min(this.aligned.length - 1, Math.round(index)))];
    return b && Number.isFinite(b.close) ? b.close : null;
  }

  render(rc: RenderContext): void {
    if (!this.aligned.length) return;
    const st = this.style;
    if (st.type === 'candles') {
      const cs: CandleStyleOptions = { upColor: st.upColor, downColor: st.downColor, bodyVisible: true, borderVisible: true, borderUpColor: st.upColor, borderDownColor: st.downColor, wickVisible: true, wickUpColor: st.upColor, wickDownColor: st.downColor };
      renderCandles(rc, this.aligned, cs);
      return;
    }
    if (st.type === 'bars') {
      const bs: BarStyleOptions = { upColor: st.upColor, downColor: st.downColor, thinBars: true, hlcBars: false, colorBasedOnPrevClose: false };
      renderBars(rc, this.aligned, bs);
      return;
    }
    const pts: Array<[number, number]> = [];
    for (let i = Math.max(0, rc.visible.from - 1); i <= Math.min(this.aligned.length - 1, rc.visible.to + 1); i++) {
      const b = this.aligned[i];
      if (!b || !Number.isFinite(b.close)) continue;
      pts.push([rc.timeScale.barCenterX(i), rc.priceScale.priceToY(b.close)]);
    }
    if (st.type === 'area' && pts.length > 1) {
      const { ctx, height } = rc;
      ctx.save();
      ctx.fillStyle = st.color.startsWith('#') ? `${st.color}22` : st.color;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], height);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[pts.length - 1][0], height);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    strokePolyline(rc.ctx, pts, st.color, st.lineWidth, st.lineStyle);
  }

  legendItems(index: number): LegendItem[] {
    const b = this.aligned[index];
    if (!b || !Number.isFinite(b.close)) return [{ value: '∅' }];
    const fmt = this.priceFormat ?? { type: 'price' as const, precision: 2, minMove: 1 };
    const prev = this.aligned[index - 1];
    const items: LegendItem[] = [{ value: formatPrice(b.close, fmt), color: this.style.color }];
    if (prev && Number.isFinite(prev.close) && prev.close !== 0) items.push({ value: formatPercent(((b.close - prev.close) / prev.close) * 100), color: b.close >= prev.close ? this.style.upColor : this.style.downColor });
    return items;
  }

  axisLabels(): AxisLabel[] {
    for (let i = this.aligned.length - 1; i >= 0; i--) {
      const b = this.aligned[i];
      if (b && Number.isFinite(b.close)) return [{ price: b.close, text: '', bg: this.style.color, color: '#fff' }];
    }
    return [];
  }

  override hitTest(x: number, y: number, rc: { timeScale: TimeScale; priceScale: PriceScale }) {
    const i = rc.timeScale.xToBarIndex(x);
    const b = this.aligned[i];
    if (!b || !Number.isFinite(b.close)) return null;
    const d = Math.abs(rc.priceScale.priceToY(b.close) - y);
    return d <= 5 ? { source: this, distance: d } : null;
  }

  override destroy(): void {
    this.loader.destroy();
  }
}
