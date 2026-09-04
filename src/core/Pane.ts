import { PriceScale } from './PriceScale';
import type { DataSource } from '../series/Series';
import type { ChartOptions } from './options';
import { cloneDeep } from './options';

let paneSeq = 0;

/** A pane holds data sources and their price scales. The first pane is the main (symbol) pane. */
export class Pane {
  readonly id: string;
  sources: DataSource[] = [];
  priceScales = new Map<string, PriceScale>();
  /** relative weight for layout */
  weight = 1;
  /** computed pixel height */
  height = 0;
  collapsed = false;
  maximized = false;
  constructor(public options: ChartOptions, id?: string, public isMain = false) {
    this.id = id ?? `pane_${++paneSeq}`;
    this.priceScales.set('right', new PriceScale('right', cloneDeep(options.rightPriceScale), 'right'));
    this.priceScales.set('left', new PriceScale('left', cloneDeep(options.leftPriceScale), 'left'));
  }

  get right(): PriceScale { return this.priceScales.get('right')!; }
  get left(): PriceScale { return this.priceScales.get('left')!; }

  getPriceScale(id: string, create = true): PriceScale {
    let ps = this.priceScales.get(id);
    if (!ps && create) {
      ps = new PriceScale(id, cloneDeep(this.options.rightPriceScale), 'overlay');
      ps.setHeight(this.height);
      this.priceScales.set(id, ps);
    }
    return ps!;
  }

  addSource(src: DataSource): void {
    if (this.sources.includes(src)) return;
    this.sources.push(src);
    src.paneId = this.id;
    const ps = this.getPriceScale(src.priceScaleId);
    ps.addProvider(src);
    if (src.priceFormat && (ps.position === 'overlay' || ps.providers.length === 1)) ps.setPriceFormat(src.priceFormat);
    this.sortSources();
  }

  removeSource(src: DataSource): void {
    const i = this.sources.indexOf(src);
    if (i >= 0) this.sources.splice(i, 1);
    for (const ps of this.priceScales.values()) ps.removeProvider(src);
    // remove empty overlay scales
    for (const [id, ps] of Array.from(this.priceScales.entries())) {
      if (ps.position === 'overlay' && ps.providers.length === 0) this.priceScales.delete(id);
    }
  }

  sortSources(): void {
    this.sources.sort((a, b) => a.zIndex - b.zIndex);
  }

  setHeight(h: number): void {
    this.height = h;
    for (const ps of this.priceScales.values()) ps.setHeight(h);
  }

  /** Auto-scale all scales for the visible bar range. */
  autoScale(from: number, to: number): void {
    for (const ps of this.priceScales.values()) {
      ps.autoScaleFor(from, to, ps.options.scaleSeriesOnly);
    }
  }

  get isEmpty(): boolean { return this.sources.length === 0; }

  /** Main (labelled) price scale of this pane: right by default. */
  get mainScale(): PriceScale {
    if (this.right.providers.length > 0 || this.left.providers.length === 0) return this.right;
    return this.left;
  }
}
