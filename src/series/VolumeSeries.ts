import { DataSource, type RenderContext, type LegendItem, type AxisLabel } from './Series';
import type { PriceRange } from '../core/PriceScale';
import type { ChartOptions } from '../core/options';
import type { MainSeries } from './MainSeries';
import { renderHistogram, strokePolyline } from './renderers';
import { formatVolume } from '../util/format';
import { sma } from '../indicators/ta';

/** Built-in volume histogram (overlay at the bottom of the main pane, TradingView default). */
export class VolumeSeries extends DataSource {
  private _values: Float64Array = new Float64Array(0);
  private _ma: Float64Array = new Float64Array(0);
  constructor(private _main: MainSeries, private _options: ChartOptions) {
    super('volume');
    this.priceScaleId = 'volume';
    this.title = 'Volume';
    this.zIndex = -1;
    this.priceFormat = { type: 'volume', precision: 2, minMove: 1 };
  }

  setOptions(o: ChartOptions): void { this._options = o; }

  override onDataChanged(): void {
    const bars = this._main.bars;
    const n = bars.length;
    if (this._values.length !== n) this._values = new Float64Array(n);
    for (let i = 0; i < n; i++) this._values[i] = bars[i].volume ?? NaN;
    this._ma = this._options.volume.showMA ? sma(this._values, this._options.volume.maLength) : new Float64Array(0);
  }

  get values(): Float64Array { return this._values; }

  priceRange(from: number, to: number): PriceRange | null {
    const n = this._values.length;
    if (n === 0) return null;
    from = Math.max(0, from);
    to = Math.min(n - 1, to);
    let max = 0;
    for (let i = from; i <= to; i++) { const v = this._values[i]; if (v > max) max = v; }
    if (max === 0) return null;
    return { min: 0, max };
  }

  render(rc: RenderContext): void {
    if (!this._options.volume.visible) return;
    const bars = this._main.bars;
    const up = this._options.volume.upColor;
    const down = this._options.volume.downColor;
    renderHistogram(rc, this._values, (i) => (bars[i].close >= bars[i].open ? up : down), 0, 0.7);
    if (this._options.volume.showMA && this._ma.length) {
      const pts: Array<[number, number]> = [];
      for (let i = rc.visible.from; i <= rc.visible.to; i++) {
        const v = this._ma[i];
        if (!Number.isFinite(v)) continue;
        pts.push([rc.timeScale.barCenterX(i), rc.priceScale.priceToY(v)]);
      }
      strokePolyline(rc.ctx, pts, this._options.volume.maColor, 1, 0);
    }
  }

  legendItems(index: number): LegendItem[] {
    const v = this._values[index];
    if (!Number.isFinite(v)) return [];
    const b = this._main.bars[index];
    const color = b && b.close >= b.open ? this._options.volume.upColor : this._options.volume.downColor;
    const items: LegendItem[] = [{ value: formatVolume(v, 2), color }];
    if (this._options.volume.showMA && Number.isFinite(this._ma[index])) items.push({ value: formatVolume(this._ma[index], 2), color: this._options.volume.maColor });
    return items;
  }

  axisLabels(): AxisLabel[] { return []; }
}
