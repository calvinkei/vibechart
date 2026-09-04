import type { TimeScale } from '../core/TimeScale';
import type { PriceScale, PriceRange, PriceRangeProvider } from '../core/PriceScale';
import type { ChartOptions } from '../core/options';
import type { PriceFormat } from '../data/types';

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  timeScale: TimeScale;
  priceScale: PriceScale;
  width: number;
  height: number;
  dpr: number;
  /** integer bar range visible and within data */
  visible: { from: number; to: number };
  options: ChartOptions;
  font: string;
  hovered?: boolean;
  selected?: boolean;
  /** crosshair bar index (or null) — used for hover markers */
  crosshairIndex: number | null;
}

export interface LegendItem {
  /** label like "O", "H", "RSI" */
  label?: string;
  value: string;
  color?: string;
}

export interface AxisLabel {
  price: number;
  text: string;
  bg: string;
  color: string;
  /** thin line across pane */
  line?: { color: string; width: number; style: number; visible: boolean };
}

export interface HitResult {
  source: DataSource;
  distance: number;
  /** extra info (e.g., point index) */
  detail?: unknown;
}

let sourceSeq = 0;

/** Base for anything drawn in a pane and taking part in autoscale: series, indicators, volume. */
export abstract class DataSource implements PriceRangeProvider {
  readonly id: string;
  visible = true;
  zIndex = 0;
  isMainSeries = false;
  /** id of the price scale this source is attached to ('right', 'left', or an overlay id) */
  priceScaleId = 'right';
  paneId = 'main';
  title = '';
  /** optional per-source price format (indicators) */
  priceFormat: PriceFormat | null = null;

  constructor(id?: string) {
    this.id = id ?? `src_${++sourceSeq}`;
  }

  abstract priceRange(from: number, to: number): PriceRange | null;
  abstract render(rc: RenderContext): void;

  /** Values shown in the legend at bar index (or last). */
  legendItems(_index: number): LegendItem[] { return []; }

  /** Labels drawn on the price axis (last value etc). */
  axisLabels(): AxisLabel[] { return []; }

  /** Base value at index for percentage/indexed scaling. */
  baseValueAt?(index: number): number | null;

  /** Hit-test for hover/selection (pixel coordinates in pane). */
  hitTest(_x: number, _y: number, _rc: { timeScale: TimeScale; priceScale: PriceScale }): HitResult | null { return null; }

  /** Optional per-frame update when data changes */
  onDataChanged(): void {}

  destroy(): void {}
}
