import { ChartModel, type InvalidateLevel, type CrosshairState } from './ChartModel';
import { Pane } from './Pane';
import { PaneView, PriceAxisView, TimeAxisView, TIME_AXIS_HEIGHT, type ViewHost } from './views';
import { defaultOptions, mergeOptions, type ChartOptions, type DeepPartial, type ThemeName, type PriceScaleMode } from './options';
import { DataLoader } from '../data/DataLoader';
import type { Bar, Datafeed, ResolutionString, SeriesType, SymbolInfo } from '../data/types';
import { CHART_TYPE_IDS } from '../data/types';
import { normalizeResolution } from '../data/resolution';
import { DrawingManager } from '../drawings/DrawingManager';
import type { Drawing, DrawingPoint, SerializedDrawing } from '../drawings/Drawing';
import { getDrawingTool } from '../drawings/Drawing';
import { IndicatorInstance, type IndicatorDefinition, type SerializedIndicator } from '../indicators/Indicator';
import type { DataSource } from '../series/Series';
import { Emitter } from '../util/events';
import { el, getDpr, injectStyle, isMac } from '../util/dom';
import { clamp } from '../util/math';
import { SampleDatafeed } from '../data/SampleDatafeed';
import baseCss from '../ui/styles.css?inline';

export interface ChartConstructorOptions extends Omit<DeepPartial<ChartOptions>, 'symbol'> {
  /** Symbol settings tab overrides (ChartOptions.symbol) */
  symbolSettings?: DeepPartial<ChartOptions['symbol']>;
  container: HTMLElement | string;
  datafeed?: Datafeed;
  symbol?: string;
  interval?: ResolutionString;
  chartType?: SeriesType | number;
  /** Initial indicators: names or [name, inputs] */
  studies?: Array<string | [string, Record<string, any>]>;
  /** Saved layout to load */
  savedData?: SavedChart;
  /** Disable built-in UI (toolbars/dialogs) */
  disableUI?: boolean;
  /** number of bars to request initially */
  initialBars?: number;
}

export interface SavedChart {
  version: 1;
  symbol: string;
  interval: ResolutionString;
  chartType: SeriesType;
  options: DeepPartial<ChartOptions>;
  indicators: SerializedIndicator[];
  drawings: SerializedDrawing[];
  panes: Array<{ id: string; weight: number; collapsed: boolean; scales: Record<string, { mode: PriceScaleMode; invert: boolean; auto: boolean }> }>;
  timeScale: { barSpacing: number; rightOffset: number };
}

export interface ChartEvents extends Record<string, unknown> {
  ready: void;
  symbolChanged: SymbolInfo;
  intervalChanged: ResolutionString;
  chartTypeChanged: SeriesType;
  crosshairMoved: CrosshairState;
  visibleRangeChanged: { from: number; to: number };
  drawingCreated: Drawing;
  drawingRemoved: Drawing;
  drawingSelected: Drawing | null;
  indicatorAdded: IndicatorInstance;
  indicatorRemoved: IndicatorInstance;
  dataLoaded: { bars: number };
  loading: boolean;
  error: string;
  themeChanged: ThemeName;
  contextMenu: { x: number; y: number; paneId: string | null; target: 'pane' | 'priceAxis' | 'timeAxis' | 'drawing'; drawing?: Drawing };
  openDialog: { type: string; payload?: unknown };
  optionsChanged: ChartOptions;
  toolChanged: string | null;
}

interface PaneRow {
  pane: Pane;
  row: HTMLDivElement;
  view: PaneView;
  left: PriceAxisView;
  right: PriceAxisView;
  separator: HTMLDivElement | null;
}

type DragMode =
  | { kind: 'scroll'; lastX: number; lastY: number; startX: number; startY: number; paneId: string; vx: number; lastT: number; moved: boolean }
  | { kind: 'priceScale'; paneId: string; side: 'left' | 'right'; startY: number; lastY: number }
  | { kind: 'timeScale'; startX: number; lastX: number; startSpacing: number }
  | { kind: 'separator'; index: number; startY: number; startHeights: number[] }
  | { kind: 'drawing' }
  | null;

/**
 * Chart: the widget. Creates DOM, wires interaction, owns the model + datafeed loader.
 */
export class Chart {
  readonly container: HTMLElement;
  readonly root: HTMLDivElement;
  readonly topToolbarEl: HTMLDivElement;
  readonly bodyEl: HTMLDivElement;
  readonly leftToolbarEl: HTMLDivElement;
  readonly chartAreaEl: HTMLDivElement;
  readonly panesEl: HTMLDivElement;
  readonly bottomBarEl: HTMLDivElement;
  readonly overlayEl: HTMLDivElement;
  readonly model: ChartModel;
  readonly drawings: DrawingManager;
  readonly events = new Emitter<ChartEvents>();
  loader: DataLoader;
  datafeed: Datafeed;

  private _rows: PaneRow[] = [];
  private _timeAxis: TimeAxisView;
  private _timeRow: HTMLDivElement;
  private _axisWidths = { left: 0, right: 0 };
  private _pendingLevel: InvalidateLevel | null = null;
  private _raf = 0;
  private _drag: DragMode = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _destroyed = false;
  private _kineticRaf = 0;
  private _touch: { pinchDist: number; pinchX: number } | null = null;
  private _dpr = 1;
  private _width = 0;
  private _height = 0;
  private _ui: { destroy(): void } | null = null;
  private _symbol = '';
  private _interval: ResolutionString = '1D';
  private _needsLayout = true;
  private _hoveredPaneId: string | null = null;
  private _initialBars = 300;

  constructor(opts: ChartConstructorOptions) {
    const container = typeof opts.container === 'string' ? document.querySelector<HTMLElement>(opts.container) : opts.container;
    if (!container) throw new Error('[openchart] container not found');
    this.container = container;
    const { container: _c, datafeed, symbol, interval, chartType, studies, savedData, disableUI, initialBars, symbolSettings, ...optionOverrides } = opts;
    if (symbolSettings) (optionOverrides as any).symbol = symbolSettings;
    void _c;
    const theme = (optionOverrides.theme as ThemeName) || 'light';
    const options = mergeOptions(defaultOptions(theme), optionOverrides as DeepPartial<ChartOptions>);
    this.model = new ChartModel(options);
    this.drawings = new DrawingManager(this.model);
    this.datafeed = datafeed ?? new SampleDatafeed();
    this.loader = new DataLoader(this.datafeed);
    this._initialBars = initialBars ?? 300;
    injectStyle(baseCss);

    // DOM
    this.root = el('div', { class: `oc-root oc-theme-${theme} ${options.className}` });
    this.topToolbarEl = el('div', { class: 'oc-top-toolbar' });
    this.bodyEl = el('div', { class: 'oc-body' });
    this.leftToolbarEl = el('div', { class: 'oc-left-toolbar' });
    this.chartAreaEl = el('div', { class: 'oc-chart-area', tabindex: '0' });
    this.panesEl = el('div', { class: 'oc-panes' });
    this.bottomBarEl = el('div', { class: 'oc-bottom-bar' });
    this.overlayEl = el('div', { class: 'oc-overlay' });
    this._timeAxis = new TimeAxisView(this._host());
    this._timeRow = el('div', { class: 'oc-time-row' });
    this._timeRow.appendChild(el('div', { class: 'oc-axis-spacer oc-axis-spacer-left' }));
    this._timeRow.appendChild(this._timeAxis.el);
    this._timeRow.appendChild(el('div', { class: 'oc-axis-spacer oc-axis-spacer-right' }));
    this.chartAreaEl.appendChild(this.panesEl);
    this.chartAreaEl.appendChild(this._timeRow);
    this.bodyEl.appendChild(this.leftToolbarEl);
    this.bodyEl.appendChild(this.chartAreaEl);
    this.root.appendChild(this.topToolbarEl);
    this.root.appendChild(this.bodyEl);
    this.root.appendChild(this.bottomBarEl);
    this.root.appendChild(this.overlayEl);
    container.appendChild(this.root);
    if (!options.toolbar.top) this.topToolbarEl.style.display = 'none';
    if (!options.toolbar.left) this.leftToolbarEl.style.display = 'none';
    if (!options.toolbar.bottom) this.bottomBarEl.style.display = 'none';

    this._bindModel();
    this._bindLoader();
    this._bindInput();
    this._syncPanes();
    this._observeResize();

    if (chartType !== undefined) this.setChartType(chartType);
    if (savedData) this.load(savedData);
    else {
      this._symbol = symbol ?? 'BTCUSD';
      this._interval = normalizeResolution(interval ?? '1D');
      this.model.setResolution(this._interval);
      void this._loadSymbol(this._symbol, this._interval);
      if (studies) for (const s of studies) Array.isArray(s) ? this.addIndicator(s[0], s[1]) : this.addIndicator(s);
    }
    if (!disableUI) {
      // UI is mounted lazily by the ui module if it is registered (see ui/index.ts)
      queueMicrotask(() => { if (!this._destroyed && Chart.uiFactory) this._ui = Chart.uiFactory(this); });
    }
    this._invalidate('layout');
  }

  /** Set by the UI module to mount toolbars/dialogs. */
  static uiFactory: ((chart: Chart) => { destroy(): void }) | null = null;

  // ---- host for views ----------------------------------------------------------
  private _host(): ViewHost {
    const self = this;
    return {
      get model() { return self.model; },
      get drawings() { return self.drawings; },
      get dpr() { return self._dpr; },
      get font() { return `normal ${self.model.options.layout.fontSize}px ${self.model.options.layout.fontFamily}`; },
      get axisWidths() { return self._axisWidths; },
      get timeAxisHeight() { return TIME_AXIS_HEIGHT; },
      onLegendAction: (action, source, ev) => self._onLegendAction(action, source, ev),
      onPaneAction: (action, pane) => self._onPaneAction(action, pane),
      isLoading: () => self.loader.loading,
    };
  }

  // ---- model / loader wiring -----------------------------------------------------
  private _bindModel(): void {
    const m = this.model;
    m.invalidated.subscribe((level) => this._invalidate(level));
    m.panesChanged.subscribe(() => { this._syncPanes(); this._invalidate('layout'); });
    m.indicatorsChanged.subscribe(() => { this._syncPanes(); this._invalidate('layout'); });
    m.chartTypeChanged.subscribe((t) => this.events.emit('chartTypeChanged', t));
    m.crosshairMoved.subscribe((c) => this.events.emit('crosshairMoved', c));
    m.optionsChanged.subscribe((o) => { this.root.className = `oc-root oc-theme-${o.theme} ${o.className}`; this.events.emit('optionsChanged', o); });
    m.timeScale.visibleRangeChanged.subscribe((r) => {
      this.events.emit('visibleRangeChanged', r);
      this._maybeLoadMore();
      this._invalidate('full');
    });
    this.drawings.created.subscribe((d) => this.events.emit('drawingCreated', d));
    this.drawings.removed.subscribe((d) => this.events.emit('drawingRemoved', d));
    this.drawings.selectionChanged.subscribe((d) => this.events.emit('drawingSelected', d));
    this.drawings.toolChanged.subscribe((t) => { this.events.emit('toolChanged', t); this._updateCursor(); });
    this.drawings.editRequested.subscribe((d) => this.events.emit('openDialog', { type: 'drawingSettings', payload: d }));
    this.drawings.contextMenuRequested.subscribe(({ drawing, x, y }) => this.events.emit('contextMenu', { x, y, paneId: drawing.paneId, target: 'drawing', drawing }));
  }

  private _bindLoader(): void {
    const l = this.loader;
    l.symbolResolved.subscribe((info) => { this.model.setSymbolInfo(info); this.events.emit('symbolChanged', info); });
    l.barsUpdated.subscribe((change) => {
      this.model.setBars(l.bars, change);
      if (change.reset) this._afterInitialLoad();
      this.events.emit('dataLoaded', { bars: l.bars.length });
      this._maybeLoadMore();
    });
    l.loadingChanged.subscribe((v) => { this.events.emit('loading', v); this._invalidate('light'); });
    l.error.subscribe((e) => this.events.emit('error', e));
  }

  private _afterInitialLoad(): void {
    this.model.timeScale.scrollToRealtime();
    this.model.autoScaleAll();
    this._invalidate('full');
    this.events.emit('ready', undefined);
  }

  private _maybeLoadMore(): void {
    const ts = this.model.timeScale;
    if (ts.length === 0) return;
    const r = ts.visibleLogicalRange();
    // request when fewer than ~100 bars remain to the left of the viewport (or the viewport shows the start)
    this.loader.requestMoreIfNeeded(r.from, 100);
  }

  private async _loadSymbol(symbol: string, interval: ResolutionString): Promise<void> {
    await this.loader.setSymbol(symbol, interval, this._initialBars);
  }

  // ---- public API: symbol / interval / type -------------------------------------------
  get symbol(): string { return this._symbol; }
  get interval(): ResolutionString { return this._interval; }
  get symbolInfo(): SymbolInfo | null { return this.model.symbolInfo; }
  get chartType(): SeriesType { return this.model.mainSeries.type; }
  get options(): ChartOptions { return this.model.options; }

  setSymbol(symbol: string, interval?: ResolutionString): Promise<void> {
    this._symbol = symbol;
    if (interval) this._interval = normalizeResolution(interval);
    this.model.setResolution(this._interval);
    this.events.emit('intervalChanged', this._interval);
    return this._loadSymbol(symbol, this._interval);
  }

  setResolution(interval: ResolutionString): Promise<void> {
    this._interval = normalizeResolution(interval);
    this.model.setResolution(this._interval);
    this.events.emit('intervalChanged', this._interval);
    return this._loadSymbol(this._symbol, this._interval);
  }

  setChartType(type: SeriesType | number): void {
    const t = typeof type === 'number' ? CHART_TYPE_IDS[type] : type;
    if (!t) return;
    this.model.setChartType(t);
  }

  setTheme(theme: ThemeName): void {
    this.model.setTheme(theme);
    this.events.emit('themeChanged', theme);
  }

  applyOptions(partial: DeepPartial<ChartOptions>): void {
    this.model.applyOptions(partial);
  }

  setTimezone(tz: string): void { this.model.setTimezone(tz); }

  // ---- indicators -----------------------------------------------------------------------
  addIndicator(defOrId: IndicatorDefinition | string, inputs?: Record<string, any>, opts?: { paneId?: string; overlay?: boolean; priceScaleId?: string; id?: string }): IndicatorInstance | null {
    const inst = this.model.addIndicator(defOrId, inputs, opts);
    if (inst) this.events.emit('indicatorAdded', inst);
    return inst;
  }
  /** TradingView-compatible alias. */
  createStudy(name: string, forceOverlay?: boolean, _lock?: boolean, inputs?: Record<string, any>): IndicatorInstance | null {
    return this.addIndicator(name, inputs, forceOverlay ? { overlay: true } : undefined);
  }
  removeIndicator(inst: IndicatorInstance | string): void {
    const i = typeof inst === 'string' ? this.model.indicators.find((x) => x.id === inst) : inst;
    if (!i) return;
    this.model.removeIndicator(i);
    this.events.emit('indicatorRemoved', i);
  }
  getIndicators(): IndicatorInstance[] { return this.model.indicators.slice(); }
  removeAllIndicators(): void { for (const i of this.model.indicators.slice()) this.removeIndicator(i); }

  // ---- drawings -----------------------------------------------------------------------------
  setTool(toolId: string | null): void { this.drawings.setTool(toolId); }
  get activeTool(): string | null { return this.drawings.activeTool; }
  /** TradingView-like createShape / createMultipointShape */
  createShape(point: DrawingPoint | DrawingPoint[], options: { shape: string; overrides?: Record<string, unknown>; text?: string; lock?: boolean; disableSelection?: boolean; paneId?: string }): Drawing | null {
    const ctor = getDrawingTool(options.shape);
    if (!ctor) { console.warn(`[openchart] unknown shape: ${options.shape}`); return null; }
    const d = new ctor({ ...(options.overrides || {}), ...(options.text !== undefined ? { text: options.text } : {}) });
    d.points = (Array.isArray(point) ? point : [point]).map((p) => ({ time: p.time > 1e11 ? Math.floor(p.time / 1000) : p.time, price: p.price }));
    while (d.points.length < d.requiredPoints && d.points.length > 0) d.points.push({ ...d.points[d.points.length - 1] });
    d.locked = !!options.lock;
    d.paneId = options.paneId ?? 'main';
    this.drawings.add(d, { select: false });
    return d;
  }
  createMultipointShape(points: DrawingPoint[], options: { shape: string; overrides?: Record<string, unknown>; text?: string; lock?: boolean; paneId?: string }): Drawing | null {
    return this.createShape(points, options);
  }
  getAllShapes(): Array<{ id: string; name: string }> { return this.drawings.drawings.map((d) => ({ id: d.id, name: d.type })); }
  getShapeById(id: string): Drawing | undefined { return this.drawings.getById(id); }
  removeEntity(id: string): void { const d = this.drawings.getById(id); if (d) this.drawings.remove(d); }
  removeAllShapes(): void { this.drawings.removeAll(); }
  selectDrawing(d: Drawing | null): void { this.drawings.select(d); }
  undo(): void { this.drawings.undo(); }
  redo(): void { this.drawings.redo(); }

  // ---- time scale API --------------------------------------------------------------------------
  timeScale() {
    const ts = this.model.timeScale;
    return {
      setVisibleRange: (from: number, to: number) => { ts.setVisibleRange({ from, to }); },
      getVisibleRange: () => ts.visibleTimeRange(),
      setVisibleLogicalRange: (from: number, to: number) => ts.setVisibleLogicalRange({ from, to }),
      getVisibleLogicalRange: () => ts.visibleLogicalRange(),
      scrollToRealtime: () => ts.scrollToRealtime(),
      scrollToPosition: (bars: number) => ts.scrollToIndex(ts.lastIndex + 0.5 + bars),
      fitContent: () => ts.fitContent(),
      zoomIn: () => ts.zoom(1.25),
      zoomOut: () => ts.zoom(0.8),
      reset: () => ts.reset(),
      barSpacing: () => ts.barSpacing,
      setBarSpacing: (s: number) => ts.setBarSpacing(s),
      timeToCoordinate: (t: number) => ts.timeToX(t),
      coordinateToTime: (x: number) => ts.xToTime(x),
      goToDate: (time: number) => {
        const idx = ts.timeToIndex(time);
        const half = ts.width / ts.barSpacing / 2;
        ts.scrollToIndex(idx + half);
      },
    };
  }

  priceScale(paneId = 'main', id: 'left' | 'right' | string = 'right') {
    const pane = this.model.getPane(paneId) ?? this.model.mainPane;
    const ps = pane.getPriceScale(id);
    return {
      setMode: (mode: PriceScaleMode) => { ps.setMode(mode); this._invalidate('full'); },
      getMode: () => ps.mode,
      setInverted: (v: boolean) => { ps.setInverted(v); this._invalidate('full'); },
      isInverted: () => ps.inverted,
      setAutoScale: (v: boolean) => { ps.setAutoScale(v); this._invalidate('full'); },
      isAutoScale: () => ps.isAutoScale,
      priceToCoordinate: (p: number) => ps.priceToY(p),
      coordinateToPrice: (y: number) => ps.yToPrice(y),
      setVisible: (v: boolean) => { ps.options.visible = v; this._invalidate('layout'); },
      raw: ps,
    };
  }

  /** Reset zoom/scroll/scales (Alt+R). */
  resetView(): void {
    this.model.timeScale.reset();
    this.model.resetPriceScales();
  }

  // ---- misc API ----------------------------------------------------------------------------------
  subscribe<K extends keyof ChartEvents>(event: K, fn: (p: ChartEvents[K]) => void): () => void { return this.events.on(event, fn); }
  unsubscribe<K extends keyof ChartEvents>(event: K, fn: (p: ChartEvents[K]) => void): void { this.events.off(event, fn); }

  bars(): Bar[] { return this.model.bars; }

  /** Export visible chart as PNG data URL. */
  takeScreenshot(): string {
    const canvas = document.createElement('canvas');
    const w = this._width - (this.leftToolbarEl.offsetWidth || 0);
    const rect = this.chartAreaEl.getBoundingClientRect();
    canvas.width = Math.round(rect.width * this._dpr);
    canvas.height = Math.round(rect.height * this._dpr);
    void w;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = this.model.options.layout.background.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const draw = (c: HTMLCanvasElement) => {
      const r = c.getBoundingClientRect();
      ctx.drawImage(c, Math.round((r.left - rect.left) * this._dpr), Math.round((r.top - rect.top) * this._dpr), c.width, c.height);
    };
    for (const row of this._rows) { draw(row.left.layer.canvas); draw(row.view.main.canvas); draw(row.view.top.canvas); draw(row.right.layer.canvas); }
    draw(this._timeAxis.layer.canvas);
    // legend text
    ctx.font = `${this.model.options.layout.fontSize * this._dpr}px ${this.model.options.layout.fontFamily}`;
    ctx.fillStyle = this.model.options.layout.textColor;
    for (const row of this._rows) {
      const r = row.view.legendEl.getBoundingClientRect();
      const lines = Array.from(row.view.legendEl.querySelectorAll('.oc-legend-row')).map((n) => (n as HTMLElement).innerText.replace(/\s+/g, ' ').trim());
      lines.forEach((line, i) => ctx.fillText(line, Math.round((r.left - rect.left + 6) * this._dpr), Math.round((r.top - rect.top + 14 + i * 18) * this._dpr)));
    }
    return canvas.toDataURL('image/png');
  }

  save(): SavedChart {
    const m = this.model;
    return {
      version: 1,
      symbol: this._symbol,
      interval: this._interval,
      chartType: m.mainSeries.type,
      options: JSON.parse(JSON.stringify(m.options)),
      indicators: m.serializeIndicators(),
      drawings: this.drawings.serialize(),
      panes: m.panes.map((p) => ({ id: p.id, weight: p.weight, collapsed: p.collapsed, scales: Object.fromEntries(Array.from(p.priceScales.entries()).map(([id, ps]) => [id, { mode: ps.mode, invert: ps.inverted, auto: ps.isAutoScale }])) })),
      timeScale: { barSpacing: m.timeScale.barSpacing, rightOffset: m.options.timeScale.rightOffset },
    };
  }

  load(data: SavedChart): void {
    const m = this.model;
    this.removeAllIndicators();
    this.drawings.load([]);
    m.applyOptions(data.options || {});
    this._symbol = data.symbol;
    this._interval = data.interval;
    m.setResolution(this._interval);
    m.setChartType(data.chartType);
    void this._loadSymbol(this._symbol, this._interval);
    for (const s of data.indicators || []) {
      const inst = m.addIndicator(s.def, s.inputs, { paneId: s.paneId === 'main' ? 'main' : s.paneId, id: s.id, priceScaleId: s.priceScaleId });
      if (inst) {
        inst.styles = { ...inst.styles, ...s.styles };
        inst.bands = { ...inst.bands, ...s.bands };
        inst.fills = { ...inst.fills, ...s.fills };
        inst.visible = s.visible;
      }
    }
    for (const p of data.panes || []) {
      const pane = m.getPane(p.id);
      if (!pane) continue;
      pane.weight = p.weight;
      pane.collapsed = p.collapsed;
      for (const [id, s] of Object.entries(p.scales || {})) {
        const ps = pane.getPriceScale(id);
        ps.setMode(s.mode); ps.setInverted(s.invert); ps.setAutoScale(s.auto);
      }
    }
    this.drawings.load(data.drawings || []);
    if (data.timeScale) m.timeScale.setBarSpacing(data.timeScale.barSpacing);
    this._syncPanes();
    this._invalidate('layout');
  }

  fullscreen(): void {
    if (document.fullscreenElement === this.root) void document.exitFullscreen();
    else void this.root.requestFullscreen?.();
  }

  resize(): void { this._onResize(); }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._resizeObserver?.disconnect();
    cancelAnimationFrame(this._raf);
    cancelAnimationFrame(this._kineticRaf);
    this._ui?.destroy();
    this.loader.destroy();
    this.model.destroy();
    for (const r of this._rows) { r.view.destroy(); r.left.destroy(); r.right.destroy(); r.row.remove(); r.separator?.remove(); }
    this.root.remove();
    this.events.clear();
  }
  remove(): void { this.destroy(); }

  // ---- layout ---------------------------------------------------------------------------------
  private _observeResize(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._onResize());
      this._resizeObserver.observe(this.container);
      this._resizeObserver.observe(this.chartAreaEl);
    }
    window.addEventListener('resize', this._onWindowResize);
    this._onResize();
  }

  private _onWindowResize = (): void => { this._dpr = getDpr(); this._onResize(); };

  private _onResize(): void {
    const o = this.model.options;
    if (typeof o.width === 'number') this.root.style.width = `${o.width}px`;
    if (typeof o.height === 'number') this.root.style.height = `${o.height}px`;
    this._dpr = getDpr();
    const w = this.chartAreaEl.clientWidth;
    const h = this.chartAreaEl.clientHeight;
    if (w === this._width && h === this._height && !this._needsLayout) return;
    this._width = w;
    this._height = h;
    this._invalidate('layout');
  }

  private _syncPanes(): void {
    const m = this.model;
    const existing = new Map(this._rows.map((r) => [r.pane.id, r]));
    const rows: PaneRow[] = [];
    for (const pane of m.panes) {
      let r = existing.get(pane.id);
      if (!r) {
        const row = el('div', { class: 'oc-pane-row', 'data-pane': pane.id });
        const view = new PaneView(this._host(), pane);
        const left = new PriceAxisView(this._host(), pane, 'left');
        const right = new PriceAxisView(this._host(), pane, 'right');
        row.appendChild(left.el);
        row.appendChild(view.el);
        row.appendChild(right.el);
        r = { pane, row, view, left, right, separator: null };
        this._bindPaneEvents(r);
      }
      rows.push(r);
      existing.delete(pane.id);
    }
    for (const r of existing.values()) { r.view.destroy(); r.left.destroy(); r.right.destroy(); r.row.remove(); r.separator?.remove(); }
    // rebuild DOM order
    this.panesEl.innerHTML = '';
    rows.forEach((r, i) => {
      if (i > 0) {
        const sep = el('div', { class: 'oc-pane-separator' }, [el('div', { class: 'oc-pane-separator-line' })]);
        this._bindSeparator(sep, i);
        r.separator = sep;
        this.panesEl.appendChild(sep);
      } else r.separator = null;
      this.panesEl.appendChild(r.row);
    });
    this._rows = rows;
    this._needsLayout = true;
  }

  private _layout(): void {
    const m = this.model;
    const w = this.chartAreaEl.clientWidth;
    const h = this.chartAreaEl.clientHeight;
    this._width = w;
    this._height = h;
    const timeH = m.options.timeScale.visible ? TIME_AXIS_HEIGHT : 0;
    const sepH = 1;
    const availableH = Math.max(0, h - timeH - sepH * Math.max(0, this._rows.length - 1));
    // pane heights by weight (collapsed = fixed small height, maximized = all)
    const maximized = this._rows.find((r) => r.pane.maximized);
    const heights: number[] = [];
    if (maximized) {
      for (const r of this._rows) heights.push(r === maximized ? availableH - 0 : 0);
    } else {
      const collapsedH = 28;
      const collapsedCount = this._rows.filter((r) => r.pane.collapsed).length;
      const totalWeight = this._rows.filter((r) => !r.pane.collapsed).reduce((s, r) => s + r.pane.weight, 0) || 1;
      const rest = Math.max(0, availableH - collapsedCount * collapsedH);
      let used = 0;
      this._rows.forEach((r, i) => {
        let hh = r.pane.collapsed ? collapsedH : Math.floor((rest * r.pane.weight) / totalWeight);
        if (i === this._rows.length - 1) hh = Math.max(0, availableH - used);
        heights.push(hh);
        used += hh;
      });
    }
    // axis widths: max required across panes (needs current ticks, so compute after setting heights)
    this._rows.forEach((r, i) => r.pane.setHeight(heights[i]));
    // ensure scales have ranges for width measurement
    m.autoScaleAll();
    let left = 0, right = 0;
    for (const r of this._rows) {
      left = Math.max(left, r.left.requiredWidth());
      right = Math.max(right, r.right.requiredWidth());
    }
    if (!m.options.leftPriceScale.visible) left = 0;
    if (!m.options.rightPriceScale.visible) right = 0;
    // hysteresis to avoid jitter
    if (Math.abs(left - this._axisWidths.left) < 10 && left <= this._axisWidths.left) left = this._axisWidths.left;
    if (Math.abs(right - this._axisWidths.right) < 10 && right <= this._axisWidths.right) right = this._axisWidths.right;
    this._axisWidths = { left, right };
    const paneW = Math.max(0, w - left - right);
    m.timeScale.setWidth(paneW);
    this._rows.forEach((r, i) => {
      r.row.style.height = `${heights[i]}px`;
      r.row.style.display = heights[i] === 0 ? 'none' : '';
      if (r.separator) r.separator.style.display = maximized ? 'none' : '';
      r.left.layout(left, heights[i]);
      r.view.layout(paneW, heights[i]);
      r.right.layout(right, heights[i]);
      r.view.el.classList.toggle('oc-pane-collapsed', r.pane.collapsed);
    });
    const spacers = this._timeRow.querySelectorAll<HTMLElement>('.oc-axis-spacer');
    spacers[0].style.width = `${left}px`;
    spacers[1].style.width = `${right}px`;
    this._timeRow.style.display = timeH ? '' : 'none';
    this._timeAxis.layout(paneW, timeH);
    this._needsLayout = false;
  }

  // ---- rendering ---------------------------------------------------------------------------------
  private _invalidate(level: InvalidateLevel): void {
    const order: InvalidateLevel[] = ['cursor', 'light', 'full', 'layout'];
    if (!this._pendingLevel || order.indexOf(level) > order.indexOf(this._pendingLevel)) this._pendingLevel = level;
    if (level === 'layout') this._needsLayout = true;
    if (!this._raf) this._raf = requestAnimationFrame(() => this._render());
  }

  private _render(): void {
    this._raf = 0;
    if (this._destroyed) return;
    const level = this._pendingLevel ?? 'full';
    this._pendingLevel = null;
    const m = this.model;
    if (level === 'layout' || this._needsLayout) this._layout();
    if (level === 'full' || level === 'layout') {
      m.autoScaleAll();
      // axis width may change when the price range changes
      let left = 0, right = 0;
      for (const r of this._rows) { left = Math.max(left, r.left.requiredWidth()); right = Math.max(right, r.right.requiredWidth()); }
      if (!m.options.leftPriceScale.visible) left = 0;
      if (!m.options.rightPriceScale.visible) right = 0;
      if (left > this._axisWidths.left || right > this._axisWidths.right || left < this._axisWidths.left - 14 || right < this._axisWidths.right - 14) {
        this._layout();
        m.autoScaleAll();
      }
    }
    if (level !== 'cursor') {
      for (const r of this._rows) r.view.renderMain();
    }
    for (const r of this._rows) {
      r.view.renderTop();
      r.left.render();
      r.right.render();
      r.view.updateLegend();
    }
    this._timeAxis.render();
    this._updateCursor();
  }

  private _updateCursor(): void {
    const c = this.drawings.cursor;
    for (const r of this._rows) r.view.el.style.cursor = c || (this._drag?.kind === 'scroll' && this._drag.moved ? 'grabbing' : 'crosshair');
  }

  // ---- input -------------------------------------------------------------------------------------
  private _bindInput(): void {
    const area = this.chartAreaEl;
    area.addEventListener('keydown', (e) => this._onKeyDown(e));
    area.addEventListener('contextmenu', (e) => e.preventDefault());
    // time axis interactions
    const ta = this._timeAxis.el;
    ta.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.model.options.handleScale.axisPressedMouseMove.time) return;
      e.preventDefault();
      this._drag = { kind: 'timeScale', startX: e.clientX, lastX: e.clientX, startSpacing: this.model.timeScale.barSpacing };
      this._captureMouse();
    });
    ta.addEventListener('dblclick', () => { if (this.model.options.handleScale.axisDoubleClickReset.time) { this.model.timeScale.reset(); } });
    ta.addEventListener('wheel', (e) => { e.preventDefault(); this.model.timeScale.zoom(e.deltaY < 0 ? 1.1 : 0.9, this._width / 2); }, { passive: false });
    ta.addEventListener('contextmenu', (e) => { e.preventDefault(); const r = ta.getBoundingClientRect(); this.events.emit('contextMenu', { x: e.clientX - r.left, y: e.clientY - r.top, paneId: null, target: 'timeAxis' }); });
    ta.style.cursor = 'ew-resize';
    area.addEventListener('mouseleave', () => { if (!this._drag) { this.model.clearCrosshair(); this._hoveredPaneId = null; } });
    area.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    // touch
    area.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    area.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    area.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
  }

  private _bindPaneEvents(r: PaneRow): void {
    const pv = r.view;
    const paneEl = pv.el;
    const pointer = (e: MouseEvent) => {
      const rect = paneEl.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, paneId: r.pane.id, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, button: e.button };
    };
    paneEl.addEventListener('mousedown', (e) => {
      this.chartAreaEl.focus({ preventScroll: true });
      const p = pointer(e);
      if (this.drawings.onPointerDown(p)) { this._drag = { kind: 'drawing' }; this._captureMouse(); e.preventDefault(); this._invalidate('cursor'); return; }
      if (e.button === 2) { this.events.emit('contextMenu', { x: p.x, y: p.y, paneId: r.pane.id, target: 'pane' }); return; }
      if (e.button !== 0) return;
      if (!this.model.options.handleScroll.pressedMouseMove) return;
      e.preventDefault();
      this._stopKinetic();
      this._drag = { kind: 'scroll', lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY, paneId: r.pane.id, vx: 0, lastT: performance.now(), moved: false };
      this._captureMouse();
    });
    paneEl.addEventListener('mousemove', (e) => {
      if (this._drag) return; // handled by window listener
      const p = pointer(e);
      this._hoveredPaneId = r.pane.id;
      this.drawings.onPointerMove(p);
      this._updateCrosshair(p.x, p.y, r.pane.id);
      this._updateCursor();
    });
    paneEl.addEventListener('dblclick', (e) => {
      const p = pointer(e);
      if (this.drawings.onDoubleClick(p)) return;
    });
    paneEl.addEventListener('contextmenu', (e) => e.preventDefault());
    // price axis
    for (const side of ['left', 'right'] as const) {
      const ax = side === 'left' ? r.left : r.right;
      ax.el.style.cursor = 'ns-resize';
      ax.el.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || !this.model.options.handleScale.axisPressedMouseMove.price) return;
        e.preventDefault();
        this._drag = { kind: 'priceScale', paneId: r.pane.id, side, startY: e.clientY, lastY: e.clientY };
        this._captureMouse();
      });
      ax.el.addEventListener('dblclick', () => { if (this.model.options.handleScale.axisDoubleClickReset.price) { ax.scale.setAutoScale(true); this._invalidate('full'); } });
      ax.el.addEventListener('wheel', (e) => { e.preventDefault(); const rect = ax.el.getBoundingClientRect(); ax.scale.scaleAround(e.clientY - rect.top, e.deltaY < 0 ? 0.9 : 1.1); this._invalidate('full'); }, { passive: false });
      ax.el.addEventListener('contextmenu', (e) => { e.preventDefault(); const rect = ax.el.getBoundingClientRect(); this.events.emit('contextMenu', { x: e.clientX - rect.left, y: e.clientY - rect.top, paneId: r.pane.id, target: 'priceAxis' }); });
    }
  }

  private _bindSeparator(sep: HTMLDivElement, index: number): void {
    sep.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this._drag = { kind: 'separator', index, startY: e.clientY, startHeights: this._rows.map((r) => r.pane.height) };
      this._captureMouse();
    });
    sep.addEventListener('dblclick', () => {
      // reset weights
      for (const r of this._rows) r.pane.weight = r.pane.isMain ? 3 : 1;
      this._invalidate('layout');
    });
  }

  private _captureMouse(): void {
    const move = (e: MouseEvent) => this._onDragMove(e);
    const up = (e: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      this._onDragEnd(e);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  private _onDragMove(e: MouseEvent): void {
    const d = this._drag;
    if (!d) return;
    const m = this.model;
    switch (d.kind) {
      case 'scroll': {
        const dx = e.clientX - d.lastX;
        const dy = e.clientY - d.lastY;
        const now = performance.now();
        const dt = Math.max(1, now - d.lastT);
        d.vx = 0.7 * d.vx + 0.3 * (dx / dt);
        d.lastT = now;
        d.lastX = e.clientX;
        d.lastY = e.clientY;
        if (Math.abs(e.clientX - d.startX) > 2 || Math.abs(e.clientY - d.startY) > 2) d.moved = true;
        if (dx !== 0) m.timeScale.scrollBy(dx);
        if (dy !== 0 && m.options.handleScroll.pressedMouseMove) {
          const pane = m.getPane(d.paneId);
          if (pane) {
            const ps = pane.mainScale;
            if (!ps.isAutoScale) ps.scrollByPixels(dy);
            else if (Math.abs(e.clientY - d.startY) > 30) { ps.setAutoScale(false); ps.scrollByPixels(dy); }
          }
        }
        const row = this._rows.find((r) => r.pane.id === d.paneId);
        if (row) {
          const rect = row.view.el.getBoundingClientRect();
          this._updateCrosshair(e.clientX - rect.left, e.clientY - rect.top, d.paneId);
        }
        this._updateCursor();
        this._invalidate('full');
        break;
      }
      case 'priceScale': {
        const pane = m.getPane(d.paneId);
        if (!pane) return;
        const ps = d.side === 'left' ? pane.left : pane.right;
        const dy = e.clientY - d.lastY;
        d.lastY = e.clientY;
        const row = this._rows.find((r) => r.pane.id === d.paneId);
        const rect = row?.view.el.getBoundingClientRect();
        const centerY = rect ? rect.height / 2 : 0;
        ps.scaleAround(centerY, Math.exp(dy / 150));
        this._invalidate('full');
        break;
      }
      case 'timeScale': {
        const dx = e.clientX - d.startX;
        const factor = Math.exp(-dx / 200);
        m.timeScale.setBarSpacing(d.startSpacing * factor, this._width);
        this._invalidate('full');
        break;
      }
      case 'separator': {
        const dy = e.clientY - d.startY;
        const above = this._rows[d.index - 1];
        const below = this._rows[d.index];
        const hA = Math.max(30, d.startHeights[d.index - 1] + dy);
        const hB = Math.max(30, d.startHeights[d.index] - dy);
        const total = d.startHeights[d.index - 1] + d.startHeights[d.index];
        const a = clamp(hA, 30, total - 30);
        const b = total - a;
        void hB;
        const unit = (above.pane.weight + below.pane.weight) / total;
        above.pane.weight = a * unit;
        below.pane.weight = b * unit;
        this._invalidate('layout');
        break;
      }
      case 'drawing': {
        const paneId = this.drawings.creating?.paneId ?? this.drawings.selected?.paneId ?? this._hoveredPaneId ?? 'main';
        const row = this._rows.find((r) => r.pane.id === paneId);
        if (!row) return;
        const rect = row.view.el.getBoundingClientRect();
        const p = { x: e.clientX - rect.left, y: e.clientY - rect.top, paneId, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, button: e.button };
        this.drawings.onPointerMove(p);
        this._updateCrosshair(p.x, p.y, paneId);
        break;
      }
    }
  }

  private _onDragEnd(e: MouseEvent): void {
    const d = this._drag;
    this._drag = null;
    if (!d) return;
    if (d.kind === 'scroll') {
      if (this.model.options.kineticScroll.mouse && Math.abs(d.vx) > 0.2) this._startKinetic(d.vx);
      this._updateCursor();
    } else if (d.kind === 'drawing') {
      const paneId = this.drawings.creating?.paneId ?? this.drawings.selected?.paneId ?? this._hoveredPaneId ?? 'main';
      const row = this._rows.find((r) => r.pane.id === paneId);
      const rect = row ? row.view.el.getBoundingClientRect() : { left: 0, top: 0 };
      this.drawings.onPointerUp({ x: e.clientX - rect.left, y: e.clientY - rect.top, paneId, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, button: e.button });
      this._updateCursor();
    }
    this._invalidate('full');
  }

  private _startKinetic(vx: number): void {
    const ts = this.model.timeScale;
    let v = vx; // px per ms
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      ts.scrollBy(v * dt);
      v *= Math.pow(0.995, dt);
      if (Math.abs(v) > 0.02) this._kineticRaf = requestAnimationFrame(step);
      else this._kineticRaf = 0;
    };
    this._kineticRaf = requestAnimationFrame(step);
  }

  private _stopKinetic(): void {
    if (this._kineticRaf) { cancelAnimationFrame(this._kineticRaf); this._kineticRaf = 0; }
  }

  private _onWheel(e: WheelEvent): void {
    const o = this.model.options;
    const ts = this.model.timeScale;
    const target = e.target as HTMLElement;
    if (target.closest('.oc-price-axis') || target.closest('.oc-time-axis')) return;
    const rect = this.panesEl.getBoundingClientRect();
    const x = e.clientX - rect.left - this._axisWidths.left;
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; } else if (e.deltaMode === 2) { dx *= 100; dy *= 100; }
    if (e.shiftKey && dx === 0) { dx = dy; dy = 0; }
    if (Math.abs(dx) > Math.abs(dy)) {
      if (!o.handleScroll.mouseWheel) return;
      e.preventDefault();
      this._stopKinetic();
      ts.scrollBy(-dx);
      return;
    }
    if (!o.handleScale.mouseWheel) return;
    e.preventDefault();
    if (dy === 0) return;
    const factor = Math.exp(-dy / 200);
    ts.zoom(factor, x);
    // update crosshair under cursor
    if (this._hoveredPaneId) {
      const row = this._rows.find((r) => r.pane.id === this._hoveredPaneId);
      if (row) { const rr = row.view.el.getBoundingClientRect(); this._updateCrosshair(e.clientX - rr.left, e.clientY - rr.top, this._hoveredPaneId); }
    }
  }

  private _onTouchStart(e: TouchEvent): void {
    const o = this.model.options;
    if (e.touches.length === 2 && o.handleScale.pinch) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const rect = this.panesEl.getBoundingClientRect();
      this._touch = { pinchDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), pinchX: (a.clientX + b.clientX) / 2 - rect.left - this._axisWidths.left };
      e.preventDefault();
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const target = t.target as HTMLElement;
      const paneEl = target.closest('.oc-pane') as HTMLElement | null;
      if (!paneEl) return;
      const paneId = paneEl.dataset.pane!;
      const rect = paneEl.getBoundingClientRect();
      const p = { x: t.clientX - rect.left, y: t.clientY - rect.top, paneId, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, button: 0 };
      if (this.drawings.onPointerDown(p)) { this._drag = { kind: 'drawing' }; e.preventDefault(); return; }
      this._stopKinetic();
      this._drag = { kind: 'scroll', lastX: t.clientX, lastY: t.clientY, startX: t.clientX, startY: t.clientY, paneId, vx: 0, lastT: performance.now(), moved: false };
      this._updateCrosshair(p.x, p.y, paneId);
    }
  }

  private _onTouchMove(e: TouchEvent): void {
    if (e.touches.length === 2 && this._touch) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const factor = dist / this._touch.pinchDist;
      this._touch.pinchDist = dist;
      this.model.timeScale.zoom(factor, this._touch.pinchX);
      e.preventDefault();
      return;
    }
    const d = this._drag;
    if (!d || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (d.kind === 'scroll') {
      if (!this.model.options.handleScroll.horzTouchDrag) return;
      const dx = t.clientX - d.lastX;
      const now = performance.now();
      const dt = Math.max(1, now - d.lastT);
      d.vx = 0.7 * d.vx + 0.3 * (dx / dt);
      d.lastT = now; d.lastX = t.clientX; d.lastY = t.clientY; d.moved = true;
      this.model.timeScale.scrollBy(dx);
      const row = this._rows.find((r) => r.pane.id === d.paneId);
      if (row) { const rect = row.view.el.getBoundingClientRect(); this._updateCrosshair(t.clientX - rect.left, t.clientY - rect.top, d.paneId); }
      e.preventDefault();
    } else if (d.kind === 'drawing') {
      const paneId = this.drawings.creating?.paneId ?? this.drawings.selected?.paneId ?? 'main';
      const row = this._rows.find((r) => r.pane.id === paneId);
      if (!row) return;
      const rect = row.view.el.getBoundingClientRect();
      this.drawings.onPointerMove({ x: t.clientX - rect.left, y: t.clientY - rect.top, paneId, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, button: 0 });
      e.preventDefault();
    }
  }

  private _onTouchEnd(e: TouchEvent): void {
    if (e.touches.length < 2) this._touch = null;
    const d = this._drag;
    if (!d) return;
    if (e.touches.length === 0) {
      this._drag = null;
      if (d.kind === 'scroll' && this.model.options.kineticScroll.touch && Math.abs(d.vx) > 0.2) this._startKinetic(d.vx);
      if (d.kind === 'drawing') {
        const paneId = this.drawings.creating?.paneId ?? this.drawings.selected?.paneId ?? 'main';
        const t = e.changedTouches[0];
        const row = this._rows.find((r) => r.pane.id === paneId);
        const rect = row ? row.view.el.getBoundingClientRect() : { left: 0, top: 0 };
        this.drawings.onPointerUp({ x: t.clientX - rect.left, y: t.clientY - rect.top, paneId, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, button: 0 });
      }
      this._invalidate('full');
    }
  }

  private _updateCrosshair(x: number, y: number, paneId: string): void {
    const m = this.model;
    const ts = m.timeScale;
    const pane = m.getPane(paneId);
    if (!pane || ts.length === 0) return;
    const index = ts.xToBarIndex(x);
    const ps = pane.mainScale;
    const price = ps.yToPrice(y);
    m.setCrosshair({ visible: true, paneId, x, y, index, time: ts.indexToTime(index), price, priceScaleId: ps.id });
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if (this.drawings.onKeyDown(e)) { e.preventDefault(); return; }
    const ts = this.model.timeScale;
    const mod = isMac() ? e.metaKey : e.ctrlKey;
    switch (e.key) {
      case 'ArrowLeft': ts.scrollBy(e.shiftKey ? ts.width / 2 : ts.barSpacing * 5); e.preventDefault(); break;
      case 'ArrowRight': ts.scrollBy(e.shiftKey ? -ts.width / 2 : -ts.barSpacing * 5); e.preventDefault(); break;
      case '+': case '=': ts.zoom(1.25, ts.width / 2); e.preventDefault(); break;
      case '-': case '_': ts.zoom(0.8, ts.width / 2); e.preventDefault(); break;
      case 'Home': ts.fitContent(); e.preventDefault(); break;
      case 'End': ts.scrollToRealtime(); e.preventDefault(); break;
      case 'r': case 'R': if (e.altKey) { this.resetView(); e.preventDefault(); } break;
      case 'i': case 'I': if (e.altKey) { this.model.mainPane.right.setInverted(!this.model.mainPane.right.inverted); this._invalidate('full'); e.preventDefault(); } break;
      case 'l': case 'L': if (e.altKey) { const ps = this.model.mainPane.right; ps.setMode(ps.mode === 'logarithmic' ? 'normal' : 'logarithmic'); this._invalidate('full'); e.preventDefault(); } break;
      case 'p': case 'P': if (e.altKey) { const ps = this.model.mainPane.right; ps.setMode(ps.mode === 'percentage' ? 'normal' : 'percentage'); this._invalidate('full'); e.preventDefault(); } break;
      case 'a': case 'A': if (e.altKey) { this.model.resetPriceScales(); e.preventDefault(); } break;
      case 'h': case 'H': if (e.altKey) { this.setTool('horizontal_line'); e.preventDefault(); } break;
      case 't': case 'T': if (e.altKey) { this.setTool('trend_line'); e.preventDefault(); } break;
      case 'v': case 'V': if (e.altKey) { this.setTool('vertical_line'); e.preventDefault(); } break;
      case 'f': case 'F': if (e.altKey) { this.setTool('fib_retracement'); e.preventDefault(); } break;
      case 'j': case 'J': if (e.altKey) { this.setTool('cross_line'); e.preventDefault(); } break;
      case 'c': case 'C': if (e.altKey) { this.setTool('parallel_channel'); e.preventDefault(); } break;
      case 'k': case 'K': if (mod) { this.events.emit('openDialog', { type: 'symbolSearch' }); e.preventDefault(); } break;
      case '/': this.events.emit('openDialog', { type: 'indicators' }); e.preventDefault(); break;
      case ',': if (mod) { this.events.emit('openDialog', { type: 'chartSettings' }); e.preventDefault(); } break;
      case 'Escape': this.events.emit('openDialog', { type: 'closeAll' }); break;
    }
  }

  // ---- legend / pane callbacks -------------------------------------------------------------------
  private _onLegendAction(action: 'settings' | 'hide' | 'remove' | 'moreMenu' | 'symbol', source: DataSource | undefined, ev: MouseEvent): void {
    if (!source) return;
    const m = this.model;
    switch (action) {
      case 'hide':
        if (source === m.volume) { m.options.volume.visible = !m.options.volume.visible; m.volume.visible = m.options.volume.visible; }
        else source.visible = !source.visible;
        this._invalidate('full');
        break;
      case 'remove':
        if (source instanceof IndicatorInstance) this.removeIndicator(source);
        else if (source === m.volume) { m.options.volume.visible = false; m.volume.visible = false; this._invalidate('full'); }
        break;
      case 'settings':
        if (source instanceof IndicatorInstance) this.events.emit('openDialog', { type: 'indicatorSettings', payload: source });
        else if (source === m.volume) this.events.emit('openDialog', { type: 'chartSettings', payload: 'volume' });
        else this.events.emit('openDialog', { type: 'chartSettings', payload: 'symbol' });
        break;
      case 'moreMenu': {
        const rect = this.chartAreaEl.getBoundingClientRect();
        this.events.emit('contextMenu', { x: ev.clientX - rect.left, y: ev.clientY - rect.top, paneId: source.paneId, target: 'pane' });
        this.events.emit('openDialog', { type: 'sourceMenu', payload: { source, x: ev.clientX - rect.left, y: ev.clientY - rect.top } });
        break;
      }
      case 'symbol':
        this.events.emit('openDialog', { type: 'symbolSearch' });
        break;
    }
  }

  private _onPaneAction(action: 'up' | 'down' | 'collapse' | 'maximize' | 'remove', pane: Pane): void {
    const m = this.model;
    switch (action) {
      case 'up': m.movePane(pane, -1); break;
      case 'down': m.movePane(pane, 1); break;
      case 'collapse': pane.collapsed = !pane.collapsed; pane.maximized = false; this._invalidate('layout'); break;
      case 'maximize': pane.maximized = !pane.maximized; pane.collapsed = false; for (const p of m.panes) if (p !== pane) p.maximized = false; this._invalidate('layout'); break;
      case 'remove': m.removePane(pane); break;
    }
  }

  /** Programmatic access to pane DOM (for UI module). */
  paneElements(): Array<{ pane: Pane; el: HTMLElement }> { return this._rows.map((r) => ({ pane: r.pane, el: r.view.el })); }
  axisWidths(): { left: number; right: number } { return this._axisWidths; }
  hoveredPaneId(): string | null { return this._hoveredPaneId; }
  requestRender(level: InvalidateLevel = 'full'): void { this._invalidate(level); }
}
