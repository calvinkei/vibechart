/**
 * Runs a Python strategy script against a bar array with Pyodide, driving the TypeScript Broker
 * bar by bar. Pyodide (MPL-2.0) is fetched from a CDN the first time a strategy runs, so the
 * library itself stays dependency-free and nothing is downloaded unless the panel is used.
 */
import { Broker, type BrokerSymbol } from './Broker';
import { PRELUDE } from './prelude';
import type { Direction, PythonRunOutput, StrategyError, StrategyInputDef, StrategyPlot, StrategyProperties, StrategyBar } from './types';

export interface PythonJob {
  script: string;
  bars: StrategyBar[];
  symbol: BrokerSymbol & { tickerid?: string; type?: string; description?: string; timezone?: string; basecurrency?: string };
  /** resolution string ("60", "1D") and its length in seconds */
  resolution: { period: string; seconds: number; multiplier: number };
  inputs: Record<string, unknown>;
  /** Properties-tab overrides; win over the script's strategy() call */
  properties: Partial<StrategyProperties>;
  onProgress?: (done: number, total: number) => void;
  /** flip to true to abort at the next chunk boundary */
  cancel?: { cancelled: boolean };
  /** bars per chunk between UI yields */
  chunk?: number;
}

export interface PythonRunResult extends PythonRunOutput { broker: Broker | null }

export interface PythonRunner {
  /** Human readable name for the status line ("Pyodide 314"). */
  readonly name: string;
  run(job: PythonJob): Promise<PythonRunResult>;
  /** Preload the runtime (optional). */
  warmup?(): Promise<void>;
}

/** The JS side of the bridge the Python prelude calls into. */
function makeBridge(job: PythonJob, getBroker: () => Broker, ensureBroker: () => Broker): Record<string, (...a: any[]) => unknown> {
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const dir = (d: unknown): Direction => (d === 'short' ? 'short' : 'long');
  const open = (i: number) => getBroker().openTrades[i];
  const closed = (i: number) => getBroker().closedTrades[i];
  const orNaN = (v: number | undefined) => (v === undefined ? NaN : v);
  const b = getBroker;
  return {
    begin_bar: (i: number) => { if (i > 0) ensureBroker().beginBar(i); },
    end_bar: (i: number) => { const br = ensureBroker(); if (i === 0) br.beginBar(0); br.endBar(i); },
    entry: (id: string, d: unknown, qty: unknown, limit: unknown, stop: unknown, ocaName: string, ocaType: string, comment: string) =>
      ensureBroker().entry(id, dir(d), { qty: num(qty), limit: num(limit), stop: num(stop), ocaName, ocaType: ocaType as any, comment }),
    order: (id: string, d: unknown, qty: unknown, limit: unknown, stop: unknown, ocaName: string, ocaType: string, comment: string) =>
      ensureBroker().order(id, dir(d), { qty: num(qty), limit: num(limit), stop: num(stop), ocaName, ocaType: ocaType as any, comment }),
    exit: (id: string, fromEntry: string, qty: unknown, qtyPercent: unknown, profit: unknown, limit: unknown, loss: unknown, stop: unknown, trailPrice: unknown, trailPoints: unknown, trailOffset: unknown, ocaName: string, comment: string, commentProfit: string, commentLoss: string, commentTrailing: string) =>
      ensureBroker().exit(id, {
        fromEntry, qty: num(qty), qtyPercent: num(qtyPercent), profit: num(profit), limit: num(limit), loss: num(loss), stop: num(stop),
        trailPrice: num(trailPrice), trailPoints: num(trailPoints), trailOffset: num(trailOffset), ocaName, comment,
        commentProfit: commentProfit || undefined, commentLoss: commentLoss || undefined, commentTrailing: commentTrailing || undefined,
      }),
    close: (id: string, qty: unknown, qtyPercent: unknown, comment: string) => ensureBroker().close(id, { qty: num(qty), qtyPercent: num(qtyPercent), comment }),
    close_all: (comment: string) => ensureBroker().closeAll(comment),
    cancel: (id: string) => ensureBroker().cancel(id),
    cancel_all: () => ensureBroker().cancelAll(),
    default_qty: (price: number) => ensureBroker().defaultQty(price),
    risk_allow_entry_in: (v: string) => ensureBroker().riskAllowEntryIn(v === 'long' || v === 'short' ? v : 'all'),
    risk_max_position_size: (v: number) => ensureBroker().riskMaxPositionSize(v),
    risk_max_drawdown: (v: number, t: string) => ensureBroker().riskMaxDrawdown(v, t === 'percent' ? 'percent' : 'cash'),
    risk_max_intraday_loss: (v: number, t: string) => ensureBroker().riskMaxIntradayLoss(v, t === 'percent' ? 'percent' : 'cash'),
    risk_max_cons_loss_days: (v: number) => ensureBroker().riskMaxConsLossDays(v),
    risk_max_intraday_filled_orders: (v: number) => ensureBroker().riskMaxIntradayFilledOrders(v),
    // state
    position_size: () => b().position,
    position_avg_price: () => b().positionAvgPrice,
    position_entry_name: () => b().positionEntryName,
    equity: () => b().equity,
    initial_capital: () => b().props.initialCapital,
    netprofit: () => b().netProfit,
    openprofit: () => b().openProfit,
    grossprofit: () => b().grossProfit,
    grossloss: () => b().grossLoss,
    max_drawdown: () => b().maxDrawdown,
    max_drawdown_percent: () => b().maxDrawdownPct,
    max_runup: () => b().maxRunup,
    max_runup_percent: () => b().maxRunupPct,
    wintrades: () => b().winTrades,
    losstrades: () => b().lossTrades,
    eventrades: () => b().evenTrades,
    open_count: () => b().openTrades.length,
    closed_count: () => b().closedTrades.length,
    avg_trade: () => { const t = b().closedTrades; return t.length ? b().netProfit / t.length : 0; },
    avg_winning_trade: () => { const w = b().closedTrades.filter((t) => t.profit > 0); return w.length ? w.reduce((s, t) => s + t.profit, 0) / w.length : 0; },
    avg_losing_trade: () => { const l = b().closedTrades.filter((t) => t.profit < 0); return l.length ? l.reduce((s, t) => s + t.profit, 0) / l.length : 0; },
    max_contracts_held: (k: 'all' | 'long' | 'short') => b().maxContractsHeld[k] ?? 0,
    // open trade accessors
    open_entry_id: (i: number) => open(i)?.entryId ?? '',
    open_entry_price: (i: number) => orNaN(open(i)?.entryPrice),
    open_entry_bar_index: (i: number) => open(i)?.entryBar ?? -1,
    open_entry_time: (i: number) => (open(i) ? open(i).entryTime * 1000 : NaN),
    open_entry_comment: (i: number) => open(i)?.entryComment ?? '',
    open_size: (i: number) => { const t = open(i); return t ? (t.direction === 'long' ? t.size : -t.size) : NaN; },
    open_profit: (i: number) => { const t = open(i); if (!t) return NaN; const px = b().bars[b().currentBar]?.close ?? NaN; return (t.direction === 'long' ? 1 : -1) * (px - t.entryPrice) * t.size - t.entryCommission; },
    open_profit_percent: (i: number) => { const t = open(i); if (!t) return NaN; const px = b().bars[b().currentBar]?.close ?? NaN; const p = (t.direction === 'long' ? 1 : -1) * (px - t.entryPrice) * t.size - t.entryCommission; return (p / (t.entryPrice * t.size)) * 100; },
    open_commission: (i: number) => orNaN(open(i)?.entryCommission),
    open_max_runup: (i: number) => orNaN(open(i)?.runup),
    open_max_drawdown: (i: number) => orNaN(open(i)?.drawdown),
    open_max_runup_percent: (i: number) => orNaN(open(i)?.runupPct),
    open_max_drawdown_percent: (i: number) => orNaN(open(i)?.drawdownPct),
    open_exit_id: () => '', open_exit_price: () => NaN, open_exit_bar_index: () => -1, open_exit_time: () => NaN, open_exit_comment: () => '',
    // closed trade accessors
    closed_entry_id: (i: number) => closed(i)?.entryId ?? '',
    closed_entry_price: (i: number) => orNaN(closed(i)?.entryPrice),
    closed_entry_bar_index: (i: number) => closed(i)?.entryBar ?? -1,
    closed_entry_time: (i: number) => (closed(i) ? closed(i).entryTime * 1000 : NaN),
    closed_entry_comment: (i: number) => closed(i)?.entryComment ?? '',
    closed_size: (i: number) => { const t = closed(i); return t ? (t.direction === 'long' ? t.size : -t.size) : NaN; },
    closed_profit: (i: number) => orNaN(closed(i)?.profit),
    closed_profit_percent: (i: number) => orNaN(closed(i)?.profitPct),
    closed_commission: (i: number) => orNaN(closed(i)?.commission),
    closed_max_runup: (i: number) => orNaN(closed(i)?.runup),
    closed_max_drawdown: (i: number) => orNaN(closed(i)?.drawdown),
    closed_max_runup_percent: (i: number) => orNaN(closed(i)?.runupPct),
    closed_max_drawdown_percent: (i: number) => orNaN(closed(i)?.drawdownPct),
    closed_exit_id: (i: number) => closed(i)?.exitId ?? '',
    closed_exit_price: (i: number) => orNaN(closed(i)?.exitPrice),
    closed_exit_bar_index: (i: number) => closed(i)?.exitBar ?? -1,
    closed_exit_time: (i: number) => (closed(i) ? closed(i).exitTime * 1000 : NaN),
    closed_exit_comment: (i: number) => closed(i)?.exitComment ?? '',
  };
}

/** Runs scripts in Pyodide loaded from a CDN (or a self-hosted `indexURL`). */
export class PyodideRunner implements PythonRunner {
  static DEFAULT_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/';
  readonly name: string;
  private _indexURL: string;
  private _py: Promise<any> | null = null;
  private _queue: Promise<unknown> = Promise.resolve();
  onStatus: ((status: string) => void) | null = null;

  constructor(opts: { indexURL?: string; onStatus?: (s: string) => void } = {}) {
    this._indexURL = (opts.indexURL ?? PyodideRunner.DEFAULT_INDEX_URL).replace(/\/?$/, '/');
    this.onStatus = opts.onStatus ?? null;
    const m = /\/v(\d+(?:\.\d+)*)\//.exec(this._indexURL);
    this.name = m ? `Pyodide ${m[1]}` : 'Pyodide';
  }

  async warmup(): Promise<void> { await this._load(); }

  private _load(): Promise<any> {
    if (this._py) return this._py;
    this._py = (async () => {
      const g = globalThis as any;
      if (typeof g.loadPyodide !== 'function') {
        this.onStatus?.('Loading Python runtime…');
        await new Promise<void>((resolve, reject) => {
          if (typeof document === 'undefined') { reject(new Error('Pyodide needs a browser environment (or pass a custom runner)')); return; }
          const s = document.createElement('script');
          s.src = `${this._indexURL}pyodide.js`;
          s.async = true;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error(`Could not load ${s.src}. Check the network / CSP, or pass strategy.pyodideUrl.`));
          document.head.appendChild(s);
        });
      }
      this.onStatus?.('Starting Python…');
      const py = await g.loadPyodide({ indexURL: this._indexURL });
      py.runPython(PRELUDE);
      this.onStatus?.('');
      return py;
    })();
    this._py.catch(() => { this._py = null; });
    return this._py;
  }

  run(job: PythonJob): Promise<PythonRunResult> {
    // one script at a time per interpreter; later runs wait for earlier ones (which may be cancelled)
    const p = this._queue.then(() => this._run(job));
    this._queue = p.catch(() => undefined);
    return p;
  }

  private async _run(job: PythonJob): Promise<PythonRunResult> {
    const t0 = Date.now();
    let py: any;
    try {
      py = await this._load();
    } catch (e) {
      return this._failed({ message: (e as Error).message, line: null, column: null, phase: 'load' }, t0, null);
    }
    let broker: Broker | null = null;
    let declared: Partial<StrategyProperties> | null = null;
    const ensureBroker = (): Broker => {
      if (!broker) broker = new Broker({ ...(declared ?? {}), ...job.properties }, job.bars, job.symbol);
      return broker;
    };
    // The prelude reads the global `_bridge` on every call, so a plain global is replaced cleanly per
    // run. (A registered module would be cached by Python's import system and a later run would keep
    // talking to the previous run's broker.)
    const bridge = makeBridge(job, ensureBroker, ensureBroker);
    py.globals.set('_bridge', bridge);
    const cols = [
      job.bars.map((b) => b.open), job.bars.map((b) => b.high), job.bars.map((b) => b.low), job.bars.map((b) => b.close),
      job.bars.map((b) => b.volume), job.bars.map((b) => b.time * 1000),
    ];
    const toPy = (v: unknown) => py.toPy(v);
    py.globals.get('_setup')(toPy(cols), toPy({
      mintick: job.symbol.minTick, ticker: job.symbol.ticker, tickerid: job.symbol.tickerid ?? job.symbol.ticker, currency: job.symbol.currency,
      basecurrency: job.symbol.basecurrency ?? '', type: job.symbol.type ?? '', description: job.symbol.description ?? '', timezone: job.symbol.timezone ?? 'UTC',
    }), toPy(job.resolution), toPy(job.inputs ?? {}));
    // the strategy() declaration reaches the broker before the first end_bar creates it
    const rt = py.globals.get('_rt');
    const origDeclare = rt.declare;
    rt.declare = (props: any) => {
      origDeclare(props);
      const d = props.toJs ? props.toJs({ dict_converter: Object.fromEntries }) : props;
      declared = d as Partial<StrategyProperties>;
      if (props.destroy) props.destroy();
    };
    const yieldCb = (done: number, total: number): Promise<boolean> => new Promise((resolve) => {
      job.onProgress?.(done, total);
      setTimeout(() => resolve(!job.cancel?.cancelled), 0);
    });
    let runRes: any;
    try {
      runRes = await py.globals.get('_run')(job.script, job.chunk ?? 250, yieldCb);
    } catch (e) {
      rt.declare = origDeclare;
      return this._failed({ message: (e as Error).message, line: null, column: null, phase: 'runtime' }, t0, broker);
    }
    rt.declare = origDeclare;
    const res = runRes.toJs({ dict_converter: Object.fromEntries });
    runRes.destroy?.();
    const collected = py.globals.get('_collect')();
    const out = collected.toJs({ dict_converter: Object.fromEntries });
    collected.destroy?.();
    const props: StrategyProperties = { ...ensureBroker().props };
    const plots: StrategyPlot[] = (out.plots as any[]).map((p) => ({
      id: p.id, title: p.title, type: p.type, color: p.color, lineWidth: p.lineWidth ?? 1, lineStyle: p.lineStyle ?? 0,
      shape: p.shape, char: p.char, location: p.location, size: p.size, text: p.text ?? undefined, value: p.value,
      overlay: p.overlay === undefined || p.overlay === null ? props.overlay : !!p.overlay,
      values: Float64Array.from(p.values as number[]), colors: p.colors ?? null, texts: p.texts ?? null,
    }));
    const inputs: StrategyInputDef[] = (out.inputs as any[]).map((i) => ({
      id: i.id, title: i.title, type: i.type, defval: i.defval, min: i.min ?? undefined, max: i.max ?? undefined, step: i.step ?? undefined,
      options: i.options ?? undefined, group: i.group ?? undefined, tooltip: i.tooltip ?? undefined,
    }));
    const logs = (out.logs as any[]).map((l) => ({ level: l.level, bar: l.bar, time: job.bars[l.bar]?.time ?? 0, message: l.message }));
    const brokerLogs = broker ? (broker as Broker).logs : [];
    const error: StrategyError | null = res.error ? { ...(res.error as StrategyError) } : null;
    return { properties: props, inputs, plots, logs: [...brokerLogs, ...logs].sort((a, b) => a.bar - b.bar), barsRun: res.bars ?? 0, error, durationMs: Date.now() - t0, broker };
  }

  private _failed(error: StrategyError, t0: number, broker: Broker | null): PythonRunResult {
    return { properties: broker ? broker.props : ({} as StrategyProperties), inputs: [], plots: [], logs: [], barsRun: 0, error, durationMs: Date.now() - t0, broker };
  }
}
