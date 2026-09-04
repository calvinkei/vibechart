import { TimeScale } from './TimeScale';
import { Pane } from './Pane';
import type { PriceScale } from './PriceScale';
import { MainSeries, isSyntheticTimeType } from '../series/MainSeries';
import { VolumeSeries } from '../series/VolumeSeries';
import type { DataSource } from '../series/Series';
import { IndicatorInstance, buildIndicatorContext, getIndicator, type IndicatorContext, type IndicatorDefinition, type SerializedIndicator } from '../indicators/Indicator';
import type { ChartOptions, ThemeName } from './options';
import { applyTheme, cloneDeep, mergeOptions, type DeepPartial } from './options';
import type { Bar, SeriesType, SymbolInfo, ResolutionString, Mark, TimescaleMark } from '../data/types';
import { Delegate } from '../util/events';
import { resolveTimezone } from '../util/time';
import { parseResolution } from '../data/resolution';
import { SessionCalendar } from '../data/session';
import { CompareSeries, type CompareStyle } from '../series/CompareSeries';
import type { Datafeed } from '../data/types';

export interface CrosshairState {
  visible: boolean;
  paneId: string | null;
  x: number;
  y: number;
  /** integer bar index under cursor (may be outside data) */
  index: number;
  time: number;
  price: number;
  /** id of the price scale used for `price` */
  priceScaleId: string;
}

export type InvalidateLevel = 'cursor' | 'light' | 'full' | 'layout';

/**
 * ChartModel holds everything that is not DOM: options, time scale, panes, series, indicators,
 * crosshair state. Views subscribe to `invalidated` to redraw.
 */
export class ChartModel {
  options: ChartOptions;
  readonly timeScale: TimeScale;
  readonly mainSeries: MainSeries;
  readonly volume: VolumeSeries;
  panes: Pane[] = [];
  indicators: IndicatorInstance[] = [];
  crosshair: CrosshairState = { visible: false, paneId: null, x: 0, y: 0, index: 0, time: 0, price: 0, priceScaleId: 'right' };
  resolution: ResolutionString = '1D';
  symbolInfo: SymbolInfo | null = null;
  timezone = 'Etc/UTC';
  calendar: SessionCalendar | null = null;
  compares: CompareSeries[] = [];
  marks: Mark[] = [];
  timescaleMarks: TimescaleMark[] = [];
  /** hovered timescale mark (for tooltip) */
  hoveredTimescaleMark: TimescaleMark | null = null;
  readonly comparesChanged = new Delegate<void>();

  readonly invalidated = new Delegate<InvalidateLevel>();
  readonly indicatorsChanged = new Delegate<void>();
  readonly panesChanged = new Delegate<void>();
  readonly chartTypeChanged = new Delegate<SeriesType>();
  readonly crosshairMoved = new Delegate<CrosshairState>();
  readonly optionsChanged = new Delegate<ChartOptions>();
  readonly dataChanged = new Delegate<void>();

  private _indicatorCtx: IndicatorContext | null = null;

  constructor(options: ChartOptions) {
    this.options = options;
    this.timeScale = new TimeScale(options.timeScale, options.localization);
    this.mainSeries = new MainSeries(options);
    this.volume = new VolumeSeries(this.mainSeries, options);
    const main = new Pane(options, 'main', true);
    main.weight = 3;
    this.panes.push(main);
    main.addSource(this.mainSeries);
    // Volume overlay scale (bottom 20% of the main pane) like TradingView default
    const vs = main.getPriceScale('volume');
    vs.overlayMargins = { top: options.volume.scaleMargins.top, bottom: options.volume.scaleMargins.bottom };
    vs.setPriceFormat({ type: 'volume', precision: 2, minMove: 1 });
    main.addSource(this.volume);
    this.volume.visible = options.volume.visible;
    this.mainSeries.barsChanged.subscribe((evt) => this._onBarsChanged(evt));
  }

  // ---- options -------------------------------------------------------------
  applyOptions(partial: DeepPartial<ChartOptions>): void {
    this.options = mergeOptions(this.options, partial);
    this._pushOptions();
  }

  setTheme(theme: ThemeName): void {
    this.options = applyTheme(this.options, theme);
    this._pushOptions();
  }

  private _pushOptions(): void {
    const o = this.options;
    this.timeScale.options = o.timeScale;
    this.timeScale.localization = o.localization;
    this.mainSeries.setOptions(o);
    this.volume.setOptions(o);
    this.volume.visible = o.volume.visible;
    for (const p of this.panes) {
      p.options = o;
      // keep per-scale mode/invert but refresh colors & margins
      for (const ps of p.priceScales.values()) {
        const base = ps.position === 'left' ? o.leftPriceScale : o.rightPriceScale;
        ps.options = { ...cloneDeep(base), mode: ps.options.mode, invertScale: ps.options.invertScale, autoScale: ps.options.autoScale, visible: ps.position === 'overlay' ? false : base.visible };
        if (ps.id === 'volume') ps.overlayMargins = { top: o.volume.scaleMargins.top, bottom: o.volume.scaleMargins.bottom };
      }
    }
    this._applyPrecision();
    this.mainPane.right.setPriceFormat(this.mainSeries.priceFormat);
    for (const ind of this.indicators) if (ind.def.precision === 'inherit' || ind.def.precision === undefined) ind.priceFormat = this.mainSeries.priceFormat;
    this.mainSeries.rebuild(false, { prepended: 0, appended: 0, reset: false });
    this.volume.onDataChanged();
    this.optionsChanged.fire(o);
    this.invalidate('layout');
  }

  // ---- symbol / data ---------------------------------------------------------
  setSymbolInfo(info: SymbolInfo | null): void {
    this.symbolInfo = info;
    this.mainSeries.setSymbolInfo(info);
    this.timezone = resolveTimezone(this.options.symbol.timezone, info?.timezone);
    this.timeScale.setTimezone(this.timezone);
    this._applyPrecision();
    this.mainPane.right.setPriceFormat(this.mainSeries.priceFormat);
    for (const ind of this.indicators) if (ind.def.precision === 'inherit' || ind.def.precision === undefined) ind.priceFormat = this.mainSeries.priceFormat;
    this.calendar = info ? new SessionCalendar(info.session, info.timezone || 'Etc/UTC') : null;
    this._wireCalendar();
    this.invalidate('full');
  }

  private _applyPrecision(): void {
    const p = this.options.symbol.precision;
    if (typeof p === 'number' && p >= 0) {
      this.mainSeries.priceFormat = { ...this.mainSeries.priceFormat, precision: p, minMove: 1 };
    } else if (this.symbolInfo) {
      this.mainSeries.setSymbolInfo(this.symbolInfo);
    }
  }

  private _wireCalendar(): void {
    const cal = this.calendar;
    if (!cal) { this.timeScale.setFutureTimeProvider(null, null); return; }
    const self = this;
    this.timeScale.setFutureTimeProvider(
      (last, ahead) => cal.futureTime(last, ahead, self.resolution),
      (first, back) => cal.pastTime(first, back, self.resolution),
    );
  }

  /** Seconds until the current (last) bar closes, or null. */
  barCloseCountdown(now = Date.now() / 1000): number | null {
    const last = this.mainSeries.rawBars[this.mainSeries.rawBars.length - 1];
    if (!last) return null;
    const next = this.calendar ? this.calendar.nextBarTime(last.time, this.resolution) : last.time + this.resolutionSeconds();
    return Math.max(0, next - now);
  }

  setTimezone(tz: string): void {
    this.options.symbol.timezone = tz;
    this.timezone = resolveTimezone(tz, this.symbolInfo?.timezone);
    this.timeScale.setTimezone(this.timezone);
    this.invalidate('full');
  }

  setResolution(res: ResolutionString): void {
    this.resolution = res;
    this.timeScale.setResolution(res);
    this._wireCalendar();
    this.invalidate('full');
  }

  setBars(bars: Bar[], change: { prepended: number; appended: number; reset: boolean }): void {
    this.mainSeries.setData(bars, change);
  }

  private _onBarsChanged(evt: { prepended: number; appended: number; reset: boolean }): void {
    const times = this.mainSeries.bars.map((b) => b.time);
    if (evt.reset) this.timeScale.setTimes(times, 0, 0);
    else this.timeScale.setTimes(times, evt.prepended, evt.appended);
    this.volume.onDataChanged();
    this._indicatorCtx = null;
    this.recomputeIndicators();
    for (const c of this.compares) c.setMainTimes(times);
    this.dataChanged.fire();
    this.invalidate('full');
  }

  get bars(): Bar[] { return this.mainSeries.bars; }
  get mainPane(): Pane { return this.panes[0]; }

  setChartType(type: SeriesType): void {
    const wasSynthetic = isSyntheticTimeType(this.mainSeries.type);
    this.mainSeries.setType(type);
    if (wasSynthetic !== isSyntheticTimeType(type)) this.timeScale.scrollToRealtime();
    this.chartTypeChanged.fire(type);
    this.invalidate('full');
  }

  // ---- panes -----------------------------------------------------------------
  getPane(id: string): Pane | undefined { return this.panes.find((p) => p.id === id); }

  paneOf(src: DataSource): Pane | undefined { return this.panes.find((p) => p.sources.includes(src)); }

  addPane(id?: string): Pane {
    const p = new Pane(this.options, id);
    p.weight = 1;
    this.panes.push(p);
    this.panesChanged.fire();
    this.invalidate('layout');
    return p;
  }

  removePane(pane: Pane): void {
    if (pane.isMain) return;
    for (const src of pane.sources.slice()) {
      if (src instanceof IndicatorInstance) this.removeIndicator(src, false);
    }
    const i = this.panes.indexOf(pane);
    if (i >= 0) this.panes.splice(i, 1);
    this.panesChanged.fire();
    this.invalidate('layout');
  }

  movePane(pane: Pane, dir: -1 | 1): void {
    const i = this.panes.indexOf(pane);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.panes.length) return;
    [this.panes[i], this.panes[j]] = [this.panes[j], this.panes[i]];
    this.panesChanged.fire();
    this.invalidate('layout');
  }

  /** Remove empty non-main panes. */
  pruneEmptyPanes(): void {
    const before = this.panes.length;
    this.panes = this.panes.filter((p) => p.isMain || !p.isEmpty);
    if (this.panes.length !== before) { this.panesChanged.fire(); this.invalidate('layout'); }
  }

  // ---- indicators ------------------------------------------------------------
  indicatorContext(): IndicatorContext {
    if (!this._indicatorCtx) {
      this._indicatorCtx = buildIndicatorContext(this.mainSeries.bars, this.resolution, this.symbolInfo, this.timezone, this.mainSeries.minMove);
      const self = this;
      this._indicatorCtx.external = (indicatorId: string, plotId: string) => {
        const ind = self.indicators.find((x) => x.id === indicatorId);
        return ind ? ind.values(plotId) : null;
      };
    }
    return this._indicatorCtx;
  }

  addIndicator(defOrId: IndicatorDefinition | string, inputs?: Record<string, any>, opts: { paneId?: string; priceScaleId?: string; id?: string; overlay?: boolean } = {}): IndicatorInstance | null {
    const def = typeof defOrId === 'string' ? getIndicator(defOrId) : defOrId;
    if (!def) { console.warn(`[vibechart] unknown indicator: ${String(defOrId)}`); return null; }
    const inst = new IndicatorInstance(def, inputs, opts.id);
    if (def.precision === 'inherit' || def.precision === undefined) inst.priceFormat = this.mainSeries.priceFormat;
    else inst.priceFormat = { type: def.format === 'volume' ? 'volume' : 'price', precision: def.precision, minMove: 1 };
    const overlay = opts.overlay ?? def.overlay;
    let pane: Pane;
    if (opts.paneId) pane = this.getPane(opts.paneId) ?? this.addPane(opts.paneId);
    else if (overlay) pane = this.mainPane;
    else pane = this.addPane();
    if (overlay && pane.isMain) inst.priceScaleId = opts.priceScaleId ?? (def.scaleRange || def.format === 'volume' ? inst.id : 'right');
    else inst.priceScaleId = opts.priceScaleId ?? 'right';
    if (inst.priceScaleId !== 'right' && inst.priceScaleId !== 'left') {
      const ps = pane.getPriceScale(inst.priceScaleId);
      ps.overlayMargins = def.format === 'volume' ? { top: 0.8, bottom: 0 } : { top: 0.1, bottom: 0.1 };
      ps.position = 'overlay';
    }
    inst.zIndex = overlay ? 1 : 0;
    this.indicators.push(inst);
    pane.addSource(inst);
    inst.compute(this.indicatorContext());
    this.indicatorsChanged.fire();
    this.invalidate('layout');
    return inst;
  }

  removeIndicator(inst: IndicatorInstance, prune = true): void {
    const pane = this.paneOf(inst);
    pane?.removeSource(inst);
    const i = this.indicators.indexOf(inst);
    if (i >= 0) this.indicators.splice(i, 1);
    if (prune) this.pruneEmptyPanes();
    this.indicatorsChanged.fire();
    this.invalidate('layout');
  }

  moveIndicator(inst: IndicatorInstance, target: 'main' | 'new' | string): void {
    const from = this.paneOf(inst);
    from?.removeSource(inst);
    let pane: Pane;
    if (target === 'main') pane = this.mainPane;
    else if (target === 'new') pane = this.addPane();
    else pane = this.getPane(target) ?? this.addPane(target);
    inst.priceScaleId = pane.isMain && (inst.def.scaleRange || inst.def.format === 'volume') ? inst.id : 'right';
    if (inst.priceScaleId !== 'right') { const ps = pane.getPriceScale(inst.priceScaleId); ps.overlayMargins = { top: 0.1, bottom: 0.1 }; ps.position = 'overlay'; }
    pane.addSource(inst);
    this.pruneEmptyPanes();
    this.indicatorsChanged.fire();
    this.invalidate('layout');
  }

  recomputeIndicators(): void {
    if (this.indicators.length === 0) return;
    const ctx = this.indicatorContext();
    for (const ind of this.indicators) ind.compute(ctx);
  }

  recomputeIndicator(inst: IndicatorInstance): void {
    inst.compute(this.indicatorContext());
    this.invalidate('full');
  }

  serializeIndicators(): SerializedIndicator[] {
    return this.indicators.map((i) => i.serialize());
  }

  // ---- compare symbols ----------------------------------------------------------
  addCompare(datafeed: Datafeed, symbol: string, opts: { style?: Partial<CompareStyle>; scale?: 'percent' | 'sameScale' | 'newScale' | 'newPane'; id?: string } = {}): CompareSeries {
    const cs = new CompareSeries(datafeed, symbol, opts.style, opts.id);
    const mode = opts.scale ?? 'percent';
    let pane: Pane = this.mainPane;
    if (mode === 'newPane') { pane = this.addPane(); cs.priceScaleId = 'right'; }
    else if (mode === 'newScale') { cs.priceScaleId = cs.id; const ps = pane.getPriceScale(cs.id); ps.position = 'overlay'; ps.overlayMargins = { top: 0.1, bottom: 0.1 }; }
    else {
      cs.priceScaleId = 'right';
      if (mode === 'percent') this.mainPane.right.setMode('percentage');
    }
    this.compares.push(cs);
    pane.addSource(cs);
    cs.changed.subscribe(() => this.invalidate('full'));
    cs.setMainTimes(this.mainSeries.bars.map((b) => b.time));
    void cs.load(this.resolution, Math.max(300, this.mainSeries.bars.length));
    this.comparesChanged.fire();
    this.invalidate('layout');
    return cs;
  }

  removeCompare(cs: CompareSeries): void {
    const pane = this.paneOf(cs);
    pane?.removeSource(cs);
    const i = this.compares.indexOf(cs);
    if (i >= 0) this.compares.splice(i, 1);
    cs.destroy();
    this.pruneEmptyPanes();
    if (this.compares.length === 0 && this.mainPane.right.mode === 'percentage') this.mainPane.right.setMode('normal');
    this.comparesChanged.fire();
    this.invalidate('layout');
  }

  /** Reload compare symbols after a resolution change. */
  reloadCompares(): void {
    for (const c of this.compares) void c.load(this.resolution, Math.max(300, this.mainSeries.bars.length));
  }

  // ---- scales ------------------------------------------------------------------
  priceScaleFor(src: DataSource): PriceScale | null {
    const pane = this.paneOf(src);
    return pane ? pane.getPriceScale(src.priceScaleId) : null;
  }

  /** Autoscale all panes for the current visible range. */
  autoScaleAll(): void {
    const vb = this.timeScale.visibleBars();
    if (!vb) return;
    for (const p of this.panes) p.autoScale(vb.from, vb.to);
  }

  resetPriceScales(): void {
    for (const p of this.panes) for (const ps of p.priceScales.values()) ps.setAutoScale(true);
    this.autoScaleAll();
    this.invalidate('full');
  }

  // ---- crosshair ------------------------------------------------------------------
  setCrosshair(state: Partial<CrosshairState> & { visible: boolean }): void {
    this.crosshair = { ...this.crosshair, ...state };
    this.crosshairMoved.fire(this.crosshair);
    this.invalidate('cursor');
  }

  clearCrosshair(): void {
    if (!this.crosshair.visible) return;
    this.crosshair = { ...this.crosshair, visible: false };
    this.crosshairMoved.fire(this.crosshair);
    this.invalidate('cursor');
  }

  invalidate(level: InvalidateLevel = 'full'): void {
    this.invalidated.fire(level);
  }

  setMarks(marks: Mark[], tsMarks: TimescaleMark[]): void {
    this.marks = marks.slice().sort((a, b) => a.time - b.time);
    this.timescaleMarks = tsMarks.slice().sort((a, b) => a.time - b.time);
    this.invalidate('full');
  }

  /** Index used for legend values: crosshair bar or last bar. */
  legendIndex(): number {
    const n = this.mainSeries.bars.length;
    if (n === 0) return 0;
    if (this.crosshair.visible) return Math.max(0, Math.min(n - 1, this.crosshair.index));
    return n - 1;
  }

  resolutionSeconds(): number { return parseResolution(this.resolution).seconds; }

  destroy(): void {
    for (const ind of this.indicators) ind.destroy();
    this.indicators = [];
    for (const c of this.compares) c.destroy();
    this.compares = [];
  }
}
