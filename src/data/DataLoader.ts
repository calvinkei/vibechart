import type { Bar, Datafeed, DatafeedConfiguration, ResolutionString, SymbolInfo, HistoryMetadata } from './types';
import { parseResolution } from './resolution';
import { Delegate } from '../util/events';
import { uid } from '../util/math';

export interface BarsChange { prepended: number; appended: number; reset: boolean }

/**
 * DataLoader: talks to a TradingView-compatible Datafeed, keeps a merged bar array in SECONDS,
 * lazy-loads older history when asked, subscribes to realtime updates.
 */
export class DataLoader {
  readonly barsUpdated = new Delegate<BarsChange>();
  readonly tick = new Delegate<Bar>();
  readonly symbolResolved = new Delegate<SymbolInfo>();
  readonly error = new Delegate<string>();
  readonly loadingChanged = new Delegate<boolean>();
  readonly ready = new Delegate<DatafeedConfiguration>();

  bars: Bar[] = [];
  symbolInfo: SymbolInfo | null = null;
  resolution: ResolutionString = '1D';
  symbol = '';
  config: DatafeedConfiguration | null = null;
  noMoreHistory = false;
  loading = false;
  /** How many bars to request at once. */
  batchSize = 500;
  private _generation = 0;
  private _guid: string | null = null;
  private _readyPromise: Promise<DatafeedConfiguration>;
  private _nextTime: number | null = null;
  private _pendingMore = false;

  constructor(readonly datafeed: Datafeed) {
    this._readyPromise = new Promise((resolve) => {
      let done = false;
      try {
        datafeed.onReady((cfg) => {
          if (done) return;
          done = true;
          this.config = cfg || {};
          this.ready.fire(this.config);
          resolve(this.config);
        });
      } catch (e) {
        console.error('[openchart] datafeed.onReady threw', e);
        this.config = {};
        resolve(this.config);
      }
    });
  }

  whenReady(): Promise<DatafeedConfiguration> { return this._readyPromise; }

  get firstTime(): number | null { return this.bars.length ? this.bars[0].time : null; }
  get lastTime(): number | null { return this.bars.length ? this.bars[this.bars.length - 1].time : null; }

  private _setLoading(v: boolean): void {
    if (this.loading === v) return;
    this.loading = v;
    this.loadingChanged.fire(v);
  }

  /** Switch symbol and/or resolution. Resets bars and loads the initial history. */
  async setSymbol(symbol: string, resolution: ResolutionString, countBack = 300): Promise<void> {
    await this._readyPromise;
    const gen = ++this._generation;
    this._unsubscribe();
    this.symbol = symbol;
    this.resolution = resolution;
    this.bars = [];
    this.noMoreHistory = false;
    this._nextTime = null;
    this._pendingMore = false;
    this.barsUpdated.fire({ prepended: 0, appended: 0, reset: true });
    this._setLoading(true);
    const info = await new Promise<SymbolInfo | null>((resolve) => {
      try {
        this.datafeed.resolveSymbol(symbol, (si) => resolve(si), (reason) => { this.error.fire(reason); resolve(null); });
      } catch (e) {
        this.error.fire(String(e));
        resolve(null);
      }
    });
    if (gen !== this._generation) return;
    if (!info) { this._setLoading(false); return; }
    this.symbolInfo = info;
    this.symbolResolved.fire(info);
    const now = Math.floor(Date.now() / 1000);
    const res = parseResolution(resolution);
    const span = this._spanForCount(countBack, res.seconds);
    await this._request({ from: now - span, to: now, countBack, firstDataRequest: true }, gen, 'append');
    if (gen !== this._generation) return;
    this._subscribe();
    this._setLoading(false);
  }

  private _spanForCount(count: number, resSeconds: number): number {
    // widen the window for session-based symbols (weekends/gaps): ~x1.6 for intraday, x1.5 for daily
    const factor = resSeconds < 86400 ? 1.7 : 1.5;
    return Math.ceil(count * resSeconds * factor);
  }

  /** Request older history before the first loaded bar. */
  async loadMore(countBack = this.batchSize): Promise<boolean> {
    if (this.noMoreHistory || this.loading || !this.symbolInfo || this.bars.length === 0) return false;
    const gen = this._generation;
    const res = parseResolution(this.resolution);
    const to = this._nextTime ?? this.bars[0].time; // exclusive
    const span = this._spanForCount(countBack, res.seconds);
    this._setLoading(true);
    const ok = await this._request({ from: to - span, to, countBack, firstDataRequest: false }, gen, 'prepend');
    if (gen === this._generation) this._setLoading(false);
    return ok;
  }

  private _request(period: { from: number; to: number; countBack: number; firstDataRequest: boolean }, gen: number, mode: 'append' | 'prepend'): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
      try {
        this.datafeed.getBars(
          this.symbolInfo as SymbolInfo,
          this.resolution,
          period,
          (bars, meta) => {
            if (gen !== this._generation) return finish(false);
            this._onHistory(bars, meta, mode, period);
            finish(true);
          },
          (reason) => {
            if (gen === this._generation) this.error.fire(reason);
            finish(false);
          },
        );
      } catch (e) {
        this.error.fire(String(e));
        finish(false);
      }
    });
  }

  private _onHistory(incoming: Bar[], meta: HistoryMetadata | undefined, mode: 'append' | 'prepend', period: { from: number; to: number }): void {
    const normalized = normalizeBars(incoming);
    if (meta?.noData) {
      if (meta.nextTime) {
        this._nextTime = normalizeTime(meta.nextTime);
      } else {
        this.noMoreHistory = true;
      }
    }
    if (normalized.length === 0) {
      if (!meta?.noData && mode === 'prepend') {
        // Empty result without noData: treat as no more data to prevent infinite loops
        this.noMoreHistory = true;
      }
      if (mode === 'append') this.barsUpdated.fire({ prepended: 0, appended: 0, reset: false });
      return;
    }
    this._nextTime = null;
    if (this.bars.length === 0) {
      this.bars = normalized;
      this.barsUpdated.fire({ prepended: 0, appended: 0, reset: true });
      return;
    }
    const firstExisting = this.bars[0].time;
    const older = normalized.filter((b) => b.time < firstExisting);
    const newer = normalized.filter((b) => b.time > this.bars[this.bars.length - 1].time);
    if (older.length) this.bars = older.concat(this.bars);
    if (newer.length) this.bars = this.bars.concat(newer);
    // overlapping bars: update in place
    for (const b of normalized) {
      if (b.time >= firstExisting && b.time <= this.bars[this.bars.length - 1].time) {
        const idx = findIndexByTime(this.bars, b.time);
        if (idx >= 0) this.bars[idx] = b;
      }
    }
    this.barsUpdated.fire({ prepended: older.length, appended: newer.length, reset: false });
    void period;
  }

  private _subscribe(): void {
    if (!this.symbolInfo) return;
    this._guid = `${this.symbol}_#_${this.resolution}_${uid('s')}`;
    try {
      this.datafeed.subscribeBars(this.symbolInfo, this.resolution, (bar) => this._onTick(bar), this._guid, () => this._resetCache());
    } catch (e) {
      console.error('[openchart] subscribeBars threw', e);
    }
  }

  private _unsubscribe(): void {
    if (this._guid) {
      try { this.datafeed.unsubscribeBars(this._guid); } catch { /* ignore */ }
      this._guid = null;
    }
  }

  private _resetCache(): void {
    // Datafeed asked to refetch everything
    const s = this.symbol;
    const r = this.resolution;
    void this.setSymbol(s, r);
  }

  private _onTick(raw: Bar): void {
    const bar = normalizeBars([raw])[0];
    if (!bar) return;
    const n = this.bars.length;
    if (n === 0) {
      this.bars.push(bar);
      this.barsUpdated.fire({ prepended: 0, appended: 0, reset: true });
      this.tick.fire(bar);
      return;
    }
    const last = this.bars[n - 1];
    if (bar.time === last.time) {
      this.bars[n - 1] = bar;
      this.barsUpdated.fire({ prepended: 0, appended: 0, reset: false });
    } else if (bar.time > last.time) {
      this.bars.push(bar);
      this.barsUpdated.fire({ prepended: 0, appended: 1, reset: false });
    } else {
      // late update to an older bar
      const idx = findIndexByTime(this.bars, bar.time);
      if (idx >= 0) { this.bars[idx] = bar; this.barsUpdated.fire({ prepended: 0, appended: 0, reset: false }); }
    }
    this.tick.fire(bar);
  }

  /** True when the loader may load more history to the left. */
  canLoadMore(): boolean {
    return !this.noMoreHistory && !this.loading && this.bars.length > 0 && !!this.symbolInfo;
  }

  /** Called by the chart when the visible range approaches the left edge. */
  requestMoreIfNeeded(firstVisibleIndex: number, threshold = 100): void {
    if (firstVisibleIndex > threshold) return;
    if (!this.canLoadMore()) return;
    if (this._pendingMore) return;
    this._pendingMore = true;
    void this.loadMore().finally(() => { this._pendingMore = false; });
  }

  destroy(): void {
    this._generation++;
    this._unsubscribe();
    this.bars = [];
  }
}

function normalizeTime(t: number): number {
  // Datafeed times are milliseconds (TradingView). Accept seconds too (heuristic: < 1e11).
  return t > 1e11 ? Math.floor(t / 1000) : Math.floor(t);
}

/** Convert incoming bars (ms) to seconds, sort, dedupe. */
export function normalizeBars(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    if (!b || !Number.isFinite(b.time) || !Number.isFinite(b.close)) continue;
    out.push({
      time: normalizeTime(b.time),
      open: Number.isFinite(b.open) ? b.open : b.close,
      high: Number.isFinite(b.high) ? b.high : b.close,
      low: Number.isFinite(b.low) ? b.low : b.close,
      close: b.close,
      volume: b.volume === undefined || b.volume === null ? undefined : +b.volume,
    });
  }
  out.sort((a, b) => a.time - b.time);
  const dedup: Bar[] = [];
  for (const b of out) {
    if (dedup.length && dedup[dedup.length - 1].time === b.time) dedup[dedup.length - 1] = b;
    else dedup.push(b);
  }
  return dedup;
}

export function findIndexByTime(bars: Bar[], time: number): number {
  let lo = 0, hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = bars[mid].time;
    if (t === time) return mid;
    if (t < time) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}
