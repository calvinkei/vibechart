/**
 * StrategyController — owns the Python script, runs it through a PythonRunner against the chart's
 * bars, turns the result into a Strategy Tester report, and shows the strategy on the chart as a
 * dynamic indicator (plots through the normal indicator pipeline, trade markers via customRender).
 */
import type { Chart } from '../core/Chart';
import type { IndicatorDefinition, IndicatorInput, IndicatorInstance, IndicatorPlot, PlotOutput, IndicatorContext, ComputeResult } from '../indicators/Indicator';
import { plotStyle } from '../indicators/Indicator';
import type { RenderContext } from '../series/Series';
import type { Bar } from '../data/types';
import { parseResolution } from '../data/resolution';
import { Emitter } from '../util/events';
import { drawLabelBox } from '../render/canvas';
import { buildReport } from './metrics';
import { PyodideRunner, type PythonRunner, type PythonRunResult } from './PythonRunner';
import type { BacktestReport, PythonRunOutput, StrategyError, StrategyInputDef, StrategyLog, StrategyPlot, StrategyProperties } from './types';

export interface StrategyOptions {
  /** Create the strategy panel. Off by default: no Python runtime is loaded unless this is true. */
  enabled?: boolean;
  /** Show the panel right away (default: same as enabled). */
  open?: boolean;
  /** Initial script text (default: a moving-average crossover example). */
  script?: string;
  /** Pyodide index URL, e.g. a self-hosted copy. */
  pyodideUrl?: string;
  /** Custom runner (e.g. server-side Python). */
  runner?: PythonRunner;
  /** Properties-tab overrides applied on top of the script's strategy() call. */
  properties?: Partial<StrategyProperties>;
  /** Input overrides by input title. */
  inputs?: Record<string, unknown>;
  /** Re-run automatically when new bars arrive or the symbol/interval changes (default true). */
  autoRun?: boolean;
  /** Run the initial script as soon as data is available (default false — like TradingView, the user clicks "Add to chart"). */
  runOnLoad?: boolean;
  /** Initial panel height in px (default 300). */
  panelHeight?: number;
}

export type StrategyState = 'idle' | 'loading' | 'running' | 'done' | 'error';

export interface StrategyEvents extends Record<string, unknown> {
  stateChanged: StrategyState;
  progress: { done: number; total: number };
  reportChanged: BacktestReport | null;
  scriptChanged: string;
  logsChanged: StrategyLog[];
  errorChanged: StrategyError | null;
  statusChanged: string;
  panelChanged: { open: boolean; tab: StrategyPanelTab; height: number; maximized: boolean };
  onChartChanged: boolean;
}

export type StrategyPanelTab = 'editor' | 'tester';

export interface SavedStrategy {
  script: string;
  inputs: Record<string, unknown>;
  properties: Partial<StrategyProperties>;
  onChart: boolean;
  panel: { open: boolean; tab: StrategyPanelTab; height: number };
}

export const DEFAULT_STRATEGY_SCRIPT = `# VibeChart strategy — Python with a Pine Script-shaped API.
# The script runs once per bar; close[1] is the previous bar, ta.* keep their own state.
strategy("MA Cross", overlay=True, initial_capital=100000,
         default_qty_type=strategy.percent_of_equity, default_qty_value=10,
         commission_type=strategy.commission.percent, commission_value=0.1)

fast_len = input.int(9, "Fast length", minval=1)
slow_len = input.int(21, "Slow length", minval=1)

fast = ta.sma(close, fast_len)
slow = ta.sma(close, slow_len)

plot(fast, "Fast", color=color.blue)
plot(slow, "Slow", color=color.orange)

if ta.crossover(fast, slow):
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow):
    strategy.entry("Short", strategy.short)
`;

const LONG_COLOR = '#2962FF';
const SHORT_COLOR = '#F23645';
const PROFIT_COLOR = '#089981';
const LOSS_COLOR = '#F23645';

let seq = 0;

export class StrategyController {
  readonly events = new Emitter<StrategyEvents>();
  script: string;
  inputs: Record<string, unknown>;
  properties: Partial<StrategyProperties>;
  state: StrategyState = 'idle';
  status = '';
  progress = { done: 0, total: 0 };
  report: BacktestReport | null = null;
  error: StrategyError | null = null;
  logs: StrategyLog[] = [];
  lastRun: PythonRunOutput | null = null;
  inputDefs: StrategyInputDef[] = [];
  /** the chart source (plots + trade markers) while the strategy is on the chart */
  instance: IndicatorInstance | null = null;
  panel: { open: boolean; tab: StrategyPanelTab; height: number; maximized: boolean };
  autoRun: boolean;
  readonly runner: PythonRunner;
  /** script text that produced the current chart instance ("Update on chart" is offered when it differs) */
  runScript: string | null = null;

  private _chart: Chart;
  private _cancel: { cancelled: boolean } | null = null;
  private _cache: Record<string, PlotOutput> = {};
  private _cacheN = 0;
  private _plotKey = '';
  private _rerunTimer = 0;
  private _subs: Array<() => void> = [];
  private _destroyed = false;
  private _pendingRun: Promise<BacktestReport | null> | null = null;

  constructor(chart: Chart, opts: StrategyOptions = {}) {
    this._chart = chart;
    this.script = opts.script ?? DEFAULT_STRATEGY_SCRIPT;
    this.inputs = { ...(opts.inputs ?? {}) };
    this.properties = { ...(opts.properties ?? {}) };
    this.autoRun = opts.autoRun ?? true;
    this.panel = { open: opts.open ?? opts.enabled ?? false, tab: 'editor', height: opts.panelHeight ?? 300, maximized: false };
    this.runner = opts.runner ?? new PyodideRunner({ indexURL: opts.pyodideUrl, onStatus: (s) => this._setStatus(s) });
    this._subs.push(chart.subscribe('dataLoaded', () => this._onData()));
    this._subs.push(chart.subscribe('symbolChanged', () => this._onData()));
    this._subs.push(chart.subscribe('intervalChanged', () => this._onData()));
    // removed through the legend / object tree: the report goes with it, like TradingView
    this._subs.push(chart.subscribe('indicatorRemoved', (inst) => { if (inst === this.instance) this.remove(); }));
    if (opts.runOnLoad) {
      const once = chart.subscribe('dataLoaded', () => { once(); void this.run(); });
      this._subs.push(once);
    }
  }

  get isOnChart(): boolean { return this.instance !== null && this._chart.model.indicators.includes(this.instance); }
  get isDirty(): boolean { return this.runScript !== null && this.runScript !== this.script; }
  get title(): string { return this.lastRun?.properties.title || 'Strategy'; }

  setScript(script: string): void {
    if (script === this.script) return;
    this.script = script;
    this.events.emit('scriptChanged', script);
  }

  setInputs(partial: Record<string, unknown>): void {
    this.inputs = { ...this.inputs, ...partial };
    if (this.instance) this.instance.setInputs(partial);
    if (this.isOnChart) void this.run();
  }

  setProperties(partial: Partial<StrategyProperties>): void {
    this.properties = { ...this.properties, ...partial };
    if (this.isOnChart) void this.run();
  }

  resetProperties(): void {
    this.properties = {};
    if (this.isOnChart) void this.run();
  }

  openPanel(tab?: StrategyPanelTab): void { this.panel.open = true; if (tab) this.panel.tab = tab; this._emitPanel(); }
  closePanel(): void { this.panel.open = false; this._emitPanel(); }
  togglePanel(): void { this.panel.open = !this.panel.open; this._emitPanel(); }
  setPanelTab(tab: StrategyPanelTab): void { this.panel.tab = tab; this._emitPanel(); }
  setPanelHeight(h: number): void { this.panel.height = Math.max(120, Math.round(h)); this._emitPanel(); }
  setPanelMaximized(m: boolean): void { this.panel.maximized = m; this._emitPanel(); }
  private _emitPanel(): void { this.events.emit('panelChanged', { ...this.panel }); }

  cancel(): void {
    if (this._cancel) this._cancel.cancelled = true;
  }

  /** "Add to chart" / "Update on chart": run the script and show plots, trades and the report. */
  run(): Promise<BacktestReport | null> {
    this.cancel();
    const p = this._run();
    this._pendingRun = p;
    return p;
  }

  private async _run(): Promise<BacktestReport | null> {
    const chart = this._chart;
    const bars = chart.model.bars;
    const script = this.script;
    if (!bars.length) {
      this._setError({ message: 'No data loaded yet', line: null, column: null, phase: 'load' });
      return null;
    }
    const cancel = { cancelled: false };
    this._cancel = cancel;
    this._setState('running');
    this.progress = { done: 0, total: bars.length };
    const info = chart.symbolInfo;
    const res = parseResolution(chart.interval);
    let out: PythonRunResult;
    try {
      out = await this.runner.run({
        script,
        bars: bars.map((b: Bar) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 })),
        symbol: {
          minTick: info ? info.minmov / info.pricescale : 0.01, ticker: info?.name ?? chart.symbol, tickerid: info?.ticker ?? info?.name ?? chart.symbol,
          currency: info?.currency_code ?? '', type: info?.type ?? '', description: info?.description ?? '', timezone: chart.model.timezone,
        },
        resolution: { period: chart.interval, seconds: res.seconds, multiplier: res.value },
        inputs: this.inputs,
        properties: this.properties,
        onProgress: (done, total) => { this.progress = { done, total }; this.events.emit('progress', this.progress); },
        cancel,
        chunk: 500,
      });
    } catch (e) {
      if (cancel.cancelled) return null;
      this._setError({ message: (e as Error).message, line: null, column: null, phase: 'load' });
      return null;
    }
    if (cancel.cancelled || this._destroyed) return null;
    this._cancel = null;
    this.lastRun = out;
    this.inputDefs = out.inputs;
    this.logs = out.logs;
    this.events.emit('logsChanged', this.logs);
    if (out.error) {
      // like TradingView: a script that fails to compile or run is not on the chart
      this._removeInstance();
      this.report = null;
      this.events.emit('reportChanged', null);
      this._setError(out.error);
      return null;
    }
    this.runScript = script;
    const report = out.broker ? buildReport(out.broker, { symbol: chart.symbol, resolution: chart.interval, currency: info?.currency_code ?? '' }) : null;
    this.report = report;
    this._applyToChart(out);
    this.error = null;
    this.events.emit('errorChanged', null);
    this.events.emit('reportChanged', report);
    this._setState('done');
    this._setStatus(`${out.barsRun} bars · ${out.durationMs} ms · ${this.runner.name}`);
    return report;
  }

  /** Remove the strategy from the chart and forget its report (the script stays in the editor). */
  remove(): void {
    this.cancel();
    this._removeInstance();
    this.report = null;
    this.runScript = null;
    this.events.emit('reportChanged', null);
    this._setState('idle');
  }

  save(): SavedStrategy {
    return { script: this.script, inputs: { ...this.inputs }, properties: { ...this.properties }, onChart: this.isOnChart, panel: { open: this.panel.open, tab: this.panel.tab, height: this.panel.height } };
  }

  load(s: SavedStrategy): void {
    this.setScript(s.script);
    this.inputs = { ...(s.inputs ?? {}) };
    this.properties = { ...(s.properties ?? {}) };
    if (s.panel) { this.panel.open = s.panel.open; this.panel.tab = s.panel.tab; this.panel.height = s.panel.height; this._emitPanel(); }
    if (s.onChart) {
      // chart.load() reloads the symbol, so the run waits for that data (the current bars belong to the old layout)
      const off = this._chart.subscribe('dataLoaded', () => { off(); void this.run(); });
      this._subs.push(off);
    }
  }

  destroy(): void {
    this._destroyed = true;
    this.cancel();
    clearTimeout(this._rerunTimer);
    for (const u of this._subs) u();
    this._removeInstance();
  }

  // ---- chart integration ---------------------------------------------------------------------------

  /** Re-run when the bar count changes (new bar, older history, symbol/interval), not on every tick of the last bar. */
  private _onData(): void {
    if (!this.isOnChart || !this.autoRun) return;
    if (this._chart.model.bars.length === this._cacheN && this.state !== 'error') return;
    clearTimeout(this._rerunTimer);
    this._rerunTimer = window.setTimeout(() => { if (this.isOnChart && this._chart.model.bars.length !== this._cacheN) void this.run(); }, 150);
  }

  private _applyToChart(out: PythonRunOutput): void {
    const key = out.plots.map((p) => `${p.id}:${p.type}:${p.title}`).join('|') + `#${out.properties.overlay}`;
    const inputsKey = out.inputs.map((i) => `${i.id}:${i.type}`).join('|');
    const n = this._chart.model.bars.length;
    this._cache = {};
    for (const p of out.plots) {
      if (p.type === 'hline') continue;
      this._cache[p.id] = { values: p.values, colors: p.colors, texts: p.texts };
    }
    this._cacheN = n;
    const fullKey = `${key}//${inputsKey}`;
    if (this.instance && this.isOnChart && this._plotKey === fullKey) {
      this._chart.model.recomputeIndicator(this.instance);
      this._chart.requestRender('full');
      return;
    }
    this._removeInstance();
    this._plotKey = fullKey;
    const def = this._definition(out);
    const inst = this._chart.model.addIndicator(def, { ...this._inputDefaults(out.inputs), ...this.inputs }, { overlay: out.properties.overlay });
    this.instance = inst;
    this.events.emit('onChartChanged', true);
    this._chart.requestRender('full');
  }

  private _removeInstance(): void {
    if (this.instance && this._chart.model.indicators.includes(this.instance)) {
      this._chart.model.removeIndicator(this.instance);
      this.events.emit('onChartChanged', false);
    }
    this.instance = null;
    this._plotKey = '';
  }

  private _inputDefaults(defs: StrategyInputDef[]): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    for (const d of defs) o[d.id] = d.defval;
    return o;
  }

  /** The dynamic IndicatorDefinition that carries the last run's plots and draws the trades. */
  private _definition(out: PythonRunOutput): IndicatorDefinition {
    const props = out.properties;
    const plots: IndicatorPlot[] = [];
    const bands: IndicatorDefinition['bands'] = [];
    for (const p of out.plots) {
      if (p.type === 'hline') {
        bands.push({ id: p.id, title: p.title, value: p.value ?? NaN, color: p.color, lineStyle: p.lineStyle as 0, lineWidth: p.lineWidth as 1, visible: true });
        continue;
      }
      plots.push({
        id: p.id, title: p.title,
        style: plotStyle({
          type: p.type as IndicatorPlot['style']['type'], color: p.color, lineWidth: Math.min(4, Math.max(1, p.lineWidth)) as 1 | 2 | 3 | 4, lineStyle: p.lineStyle as 0,
          shape: p.shape as IndicatorPlot['style']['shape'], char: p.char, location: p.location as IndicatorPlot['style']['location'], size: p.size as IndicatorPlot['style']['size'], text: p.text,
          showLast: p.type === 'line' || p.type === 'stepLine' || p.type === 'area',
        }),
      });
    }
    const inputs: IndicatorInput[] = out.inputs.map((i) => ({
      id: i.id, name: i.title, type: i.type === 'string' ? 'text' : i.type, defval: i.defval, min: i.min, max: i.max, step: i.step, options: i.options, group: i.group, tooltip: i.tooltip,
    }));
    const self = this;
    return {
      id: `strategy:${props.title}:${++seq}`,
      name: props.title,
      shortName: props.shortTitle || props.title,
      category: 'Strategies',
      overlay: props.overlay,
      inputs,
      plots,
      bands,
      precision: 'inherit',
      compute(ctx: IndicatorContext, inputs: Record<string, any>): ComputeResult {
        self._onCompute(ctx, inputs);
        const res: ComputeResult = {};
        for (const [id, out] of Object.entries(self._cache)) res[id] = self._fit(out, ctx.n);
        return res;
      },
      customRender(rc: RenderContext) { self._renderTrades(rc); },
    };
  }

  /** compute() is synchronous; it serves the cache and schedules a real re-run when inputs or data changed. */
  private _onCompute(ctx: IndicatorContext, inputs: Record<string, any>): void {
    let changed = false;
    for (const d of this.inputDefs) {
      const v = inputs[d.id];
      const cur = this.inputs[d.id] ?? d.defval;
      if (v !== undefined && String(v) !== String(cur)) { this.inputs[d.id] = v; changed = true; }
    }
    if (changed || (ctx.n !== this._cacheN && this.autoRun)) {
      clearTimeout(this._rerunTimer);
      this._rerunTimer = window.setTimeout(() => { if (this.isOnChart) void this.run(); }, 100);
    }
  }

  private _fit(out: PlotOutput, n: number): PlotOutput {
    if (out.values.length === n) return out;
    const values = new Float64Array(n).fill(NaN);
    values.set(out.values.subarray(0, Math.min(n, out.values.length)));
    const colors = out.colors ? out.colors.slice(0, n) : null;
    const texts = out.texts ? out.texts.slice(0, n) : null;
    return { values, colors, texts };
  }

  // ---- trade markers -----------------------------------------------------------------------------

  private _renderTrades(rc: RenderContext): void {
    const report = this.report;
    if (!report) return;
    const { ctx, timeScale, priceScale } = rc;
    const bars = (rc as unknown as { mainBars?: Bar[] }).mainBars ?? this._chart.model.bars;
    const from = rc.visible.from, to = rc.visible.to;
    const font = `${Math.max(9, rc.options.layout.fontSize - 1)}px ${rc.options.layout.fontFamily}`;
    ctx.save();
    // entry → exit lines, coloured by outcome (drawn first so labels sit on top)
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    for (const t of report.trades) {
      if (t.exitBar < from || t.entryBar > to) continue;
      ctx.strokeStyle = t.profit >= 0 ? PROFIT_COLOR : LOSS_COLOR;
      ctx.beginPath();
      ctx.moveTo(timeScale.barCenterX(t.entryBar), priceScale.priceToY(t.entryPrice));
      ctx.lineTo(timeScale.barCenterX(t.exitBar), priceScale.priceToY(t.exitPrice));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // one label per bar and side; several fills on the same bar are joined
    const labels = new Map<string, { bar: number; above: boolean; color: string; texts: string[] }>();
    for (const f of report.fills) {
      if (f.bar < from || f.bar > to) continue;
      const isBuy = f.side === 'long';
      const above = !isBuy; // buys sit under the bar, sells over it (TradingView)
      const key = `${f.bar}:${above ? 'a' : 'b'}`;
      const text = f.comment || f.orderId;
      const color = isBuy ? LONG_COLOR : SHORT_COLOR;
      const cur = labels.get(key);
      if (cur) cur.texts.push(text);
      else labels.set(key, { bar: f.bar, above, color, texts: [text] });
    }
    for (const l of labels.values()) {
      const bar = bars[l.bar];
      if (!bar) continue;
      const x = timeScale.barCenterX(l.bar);
      const y = priceScale.priceToY(l.above ? bar.high : bar.low);
      const tip = 6;
      const ty = l.above ? y - tip : y + tip;
      // arrow tip pointing at the bar
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5, ty);
      ctx.lineTo(x + 5, ty);
      ctx.closePath();
      ctx.fill();
      drawLabelBox(ctx, l.texts.join(' · '), x, ty, { font, bg: l.color, color: '#FFFFFF', align: 'center', vAlign: l.above ? 'bottom' : 'top', padX: 5, padY: 2, radius: 3 });
    }
    ctx.restore();
  }

  // ---- state helpers -------------------------------------------------------------------------------
  private _setState(s: StrategyState): void { this.state = s; this.events.emit('stateChanged', s); }
  private _setStatus(s: string): void { this.status = s; this.events.emit('statusChanged', s); }
  private _setError(e: StrategyError): void {
    this.error = e;
    this.events.emit('errorChanged', e);
    this._setState('error');
    this._setStatus('');
  }
}
