import { Delegate } from '../util/events';
import { clamp, lowerBound } from '../util/math';
import { dateParts, formatDate, formatTime, MONTHS_SHORT, type DateParts } from '../util/time';
import { addBarsToTime, parseResolution } from '../data/resolution';
import type { ResolutionString } from '../data/types';
import type { TimeScaleOptions, LocalizationOptions } from './options';

export interface LogicalRange { from: number; to: number }
export interface TimeRange { from: number; to: number }

export interface TimeTick {
  index: number;
  time: number;
  x: number;
  weight: number;
  label: string;
}

export const enum TickWeight {
  Second = 10,
  Minute1 = 20,
  Minute5 = 21,
  Minute30 = 22,
  Hour1 = 30,
  Hour3 = 31,
  Hour6 = 32,
  Hour12 = 33,
  Day = 50,
  Month = 60,
  Year = 70,
}

/**
 * Time scale: maps logical bar indices to pixels. Bars are equally spaced (no time gaps),
 * exactly like TradingView. Indices beyond the data are extrapolated by resolution.
 */
export class TimeScale {
  readonly visibleRangeChanged = new Delegate<LogicalRange>();
  readonly optionsChanged = new Delegate<void>();

  private _times: number[] = [];
  private _width = 0;
  private _barSpacing: number;
  private _rightEdgeIndex = 0; // logical index at x = width
  private _resolution: ResolutionString = '1D';
  private _timezone = 'Etc/UTC';
  private _tickCache: { key: string; ticks: TimeTick[] } | null = null;
  private _weightCache = new Map<number, number>();
  private _futureTime: ((lastTime: number, barsAhead: number) => number) | null = null;
  private _pastTime: ((firstTime: number, barsBack: number) => number) | null = null;
  private _sessionBreakCache: number[] | null = null;

  constructor(public options: TimeScaleOptions, public localization: LocalizationOptions) {
    this._barSpacing = options.barSpacing;
    this._rightEdgeIndex = options.rightOffset;
  }

  // ---- data ------------------------------------------------------------
  get times(): number[] { return this._times; }
  get length(): number { return this._times.length; }
  get lastIndex(): number { return this._times.length - 1; }
  get resolution(): ResolutionString { return this._resolution; }
  get timezone(): string { return this._timezone; }
  get width(): number { return this._width; }
  get barSpacing(): number { return this._barSpacing; }
  get rightEdgeIndex(): number { return this._rightEdgeIndex; }

  setTimezone(tz: string): void {
    if (tz === this._timezone) return;
    this._timezone = tz;
    this._weightCache.clear();
    this._tickCache = null;
    this._sessionBreakCache = null;
  }

  setResolution(res: ResolutionString): void {
    this._resolution = res;
    this._weightCache.clear();
    this._tickCache = null;
  }

  setFutureTimeProvider(fn: ((lastTime: number, barsAhead: number) => number) | null, past?: ((firstTime: number, barsBack: number) => number) | null): void {
    this._futureTime = fn;
    this._pastTime = past ?? null;
    this._tickCache = null;
  }

  /** Replace bar times. `prependedCount` indicates how many bars were added to the front (to keep the view stable). */
  setTimes(times: number[], prependedCount = 0, appendedCount = 0): void {
    const wasAtRealtime = this.isAtRealtime();
    const oldLen = this._times.length;
    this._times = times;
    this._weightCache.clear();
    this._tickCache = null;
    this._sessionBreakCache = null;
    if (prependedCount > 0) {
      this._rightEdgeIndex += prependedCount;
    }
    if (appendedCount > 0 && oldLen > 0 && this.options.shiftVisibleRangeOnNewBar && wasAtRealtime) {
      this._rightEdgeIndex += appendedCount;
    }
    if (oldLen === 0 && times.length > 0) {
      this._rightEdgeIndex = this.lastIndex + this.options.rightOffset + 0.5;
    }
    this._constrain();
    this.visibleRangeChanged.fire(this.visibleLogicalRange());
  }

  /** True if last bar is within the right area (auto-shift on new bars). */
  isAtRealtime(): boolean {
    if (this._times.length === 0) return true;
    return this._rightEdgeIndex >= this.lastIndex + 0.5 - 1e-6;
  }

  setWidth(width: number): void {
    if (width === this._width) return;
    const oldWidth = this._width;
    this._width = width;
    this._tickCache = null;
    if (this.options.lockVisibleTimeRangeOnResize && oldWidth > 0 && width > 0) {
      this._barSpacing = clamp(this._barSpacing * (width / oldWidth), this.options.minBarSpacing, this.options.maxBarSpacing);
    }
    this._constrain();
    this.visibleRangeChanged.fire(this.visibleLogicalRange());
  }

  // ---- coordinate conversion -------------------------------------------
  indexToX(index: number): number {
    return this._width - (this._rightEdgeIndex - index) * this._barSpacing;
  }

  xToIndex(x: number): number {
    return this._rightEdgeIndex - (this._width - x) / this._barSpacing;
  }

  /** Nearest integer bar index at pixel x (may be beyond data). */
  xToBarIndex(x: number): number {
    return Math.round(this.xToIndex(x) - 0.5);
  }

  /** Bar center for integer index i is at indexToX(i + 0.5)... we define bar i occupying [i, i+1). */
  barCenterX(index: number): number {
    return this.indexToX(index + 0.5);
  }

  timeToIndex(time: number): number {
    const t = this._times;
    const n = t.length;
    if (n === 0) return 0;
    if (time <= t[0]) {
      if (time === t[0]) return 0;
      return -this._barsBetweenPast(t[0], time);
    }
    if (time >= t[n - 1]) {
      if (time === t[n - 1]) return n - 1;
      return n - 1 + this._barsBetweenFuture(t[n - 1], time);
    }
    const i = lowerBound(t, time);
    if (t[i] === time) return i;
    const t0 = t[i];
    const t1 = t[i + 1];
    return i + (time - t0) / (t1 - t0);
  }

  /** Nearest bar index to given time (clamped to data). */
  timeToNearestBar(time: number): number {
    const idx = this.timeToIndex(time);
    return clamp(Math.round(idx), 0, Math.max(0, this.lastIndex));
  }

  indexToTime(index: number): number {
    const t = this._times;
    const n = t.length;
    if (n === 0) return 0;
    if (index <= 0) {
      if (index === 0) return t[0];
      return this._pastTime ? this._pastTime(t[0], -index) : addBarsToTime(t[0], this._resolution, index);
    }
    if (index >= n - 1) {
      if (index === n - 1) return t[n - 1];
      const ahead = index - (n - 1);
      const whole = Math.floor(ahead);
      const frac = ahead - whole;
      const base = this._futureTime ? this._futureTime(t[n - 1], whole) : addBarsToTime(t[n - 1], this._resolution, whole);
      if (frac === 0) return base;
      const next = this._futureTime ? this._futureTime(t[n - 1], whole + 1) : addBarsToTime(t[n - 1], this._resolution, whole + 1);
      return base + (next - base) * frac;
    }
    const i = Math.floor(index);
    const frac = index - i;
    if (frac === 0) return t[i];
    return t[i] + (t[i + 1] - t[i]) * frac;
  }

  private _barsBetweenFuture(lastTime: number, time: number): number {
    if (this._futureTime) {
      let k = 0;
      let prev = lastTime;
      while (k < 100000) {
        const next = this._futureTime(lastTime, k + 1);
        if (next >= time) return k + (time - prev) / (next - prev);
        prev = next;
        k++;
      }
      return k;
    }
    const sec = parseResolution(this._resolution).seconds;
    return (time - lastTime) / sec;
  }

  private _barsBetweenPast(firstTime: number, time: number): number {
    if (this._pastTime) {
      let k = 0;
      let prev = firstTime;
      while (k < 100000) {
        const next = this._pastTime(firstTime, k + 1);
        if (next <= time) return k + (prev - time) / (prev - next);
        prev = next;
        k++;
      }
      return k;
    }
    const sec = parseResolution(this._resolution).seconds;
    return (firstTime - time) / sec;
  }

  timeToX(time: number): number {
    return this.barCenterX(this.timeToIndex(time));
  }

  xToTime(x: number): number {
    return this.indexToTime(this.xToIndex(x) - 0.5);
  }

  // ---- ranges ------------------------------------------------------------
  visibleLogicalRange(): LogicalRange {
    return { from: this._rightEdgeIndex - this._width / this._barSpacing, to: this._rightEdgeIndex };
  }

  /** Integer bar range that is visible and within data. */
  visibleBars(): { from: number; to: number } | null {
    if (this._times.length === 0 || this._width === 0) return null;
    const r = this.visibleLogicalRange();
    const from = clamp(Math.floor(r.from), 0, this.lastIndex);
    const to = clamp(Math.ceil(r.to), 0, this.lastIndex);
    if (from > to) return null;
    return { from, to };
  }

  visibleTimeRange(): TimeRange | null {
    if (this._times.length === 0) return null;
    const r = this.visibleLogicalRange();
    return { from: this.indexToTime(r.from), to: this.indexToTime(r.to) };
  }

  setVisibleLogicalRange(range: LogicalRange, animate = false): void {
    if (this._width <= 0) return;
    const bars = Math.max(1e-6, range.to - range.from);
    this._barSpacing = clamp(this._width / bars, this.options.minBarSpacing, this.options.maxBarSpacing);
    this._rightEdgeIndex = range.to;
    this._afterChange();
  }

  setVisibleRange(range: TimeRange): void {
    const from = this.timeToIndex(range.from);
    const to = this.timeToIndex(range.to) + 1;
    this.setVisibleLogicalRange({ from, to });
  }

  fitContent(): void {
    if (this._times.length === 0) return;
    this.setVisibleLogicalRange({ from: -1, to: this.lastIndex + 1 + this.options.rightOffset });
  }

  scrollToRealtime(): void {
    if (this._times.length === 0) return;
    this._rightEdgeIndex = this.lastIndex + 0.5 + this.options.rightOffset;
    this._afterChange();
  }

  /** Reset to default zoom + position (TradingView: "Reset chart view", Alt+R). */
  reset(): void {
    this._barSpacing = this.options.barSpacing;
    this.scrollToRealtime();
  }

  scrollBy(dxPixels: number): void {
    if (dxPixels === 0) return;
    this._rightEdgeIndex -= dxPixels / this._barSpacing;
    this._afterChange();
  }

  scrollToIndex(rightEdgeIndex: number): void {
    this._rightEdgeIndex = rightEdgeIndex;
    this._afterChange();
  }

  setBarSpacing(spacing: number, anchorX?: number): void {
    const newSpacing = clamp(spacing, this.options.minBarSpacing, this.options.maxBarSpacing);
    if (newSpacing === this._barSpacing) return;
    const ax = anchorX ?? this._width;
    const anchorIndex = this.xToIndex(ax);
    this._barSpacing = newSpacing;
    // keep index at anchor fixed
    this._rightEdgeIndex = anchorIndex + (this._width - ax) / this._barSpacing;
    this._afterChange();
  }

  zoom(factor: number, anchorX?: number): void {
    this.setBarSpacing(this._barSpacing * factor, anchorX);
  }

  setRightOffset(offset: number): void {
    this.options.rightOffset = offset;
    if (this.isAtRealtime()) this.scrollToRealtime();
  }

  private _afterChange(): void {
    this._constrain();
    this._tickCache = null;
    this.visibleRangeChanged.fire(this.visibleLogicalRange());
  }

  private _constrain(): void {
    if (this._width <= 0) return;
    this._barSpacing = clamp(this._barSpacing, this.options.minBarSpacing, this.options.maxBarSpacing);
    const n = this._times.length;
    if (n === 0) return;
    const visibleBars = this._width / this._barSpacing;
    // cannot scroll so that first bar goes past the right edge (keep >=1 bar visible on the left)
    const minRight = Math.min(0.5 + 2, this.lastIndex + 0.5);
    // cannot scroll so that the last bar goes further left than ~ (keep a couple of bars on screen)
    const maxRight = this.lastIndex + 0.5 + visibleBars - Math.min(3, n);
    if (this.options.fixRightEdge) {
      this._rightEdgeIndex = Math.min(this._rightEdgeIndex, this.lastIndex + 0.5 + this.options.rightOffset);
    }
    if (this.options.fixLeftEdge) {
      const leftEdge = this._rightEdgeIndex - visibleBars;
      if (leftEdge < 0) this._rightEdgeIndex = visibleBars;
    }
    this._rightEdgeIndex = clamp(this._rightEdgeIndex, minRight, Math.max(minRight, maxRight));
  }

  // ---- ticks ---------------------------------------------------------------
  private _weightAt(index: number): number {
    const cached = this._weightCache.get(index);
    if (cached !== undefined) return cached;
    const time = this.indexToTime(index);
    const prevTime = this.indexToTime(index - 1);
    const cur = dateParts(time, this._timezone);
    const prev = dateParts(prevTime, this._timezone);
    const res = parseResolution(this._resolution);
    let w: number;
    if (cur.year !== prev.year) w = TickWeight.Year;
    else if (cur.month !== prev.month) w = TickWeight.Month;
    else if (cur.day !== prev.day) w = TickWeight.Day;
    else if (!res.isIntraday) w = TickWeight.Day;
    else if (cur.hour !== prev.hour) {
      if (cur.hour % 12 === 0) w = TickWeight.Hour12;
      else if (cur.hour % 6 === 0) w = TickWeight.Hour6;
      else if (cur.hour % 3 === 0) w = TickWeight.Hour3;
      else w = TickWeight.Hour1;
    } else if (cur.minute !== prev.minute) {
      if (cur.minute % 30 === 0) w = TickWeight.Minute30;
      else if (cur.minute % 5 === 0) w = TickWeight.Minute5;
      else w = TickWeight.Minute1;
    } else w = TickWeight.Second;
    // Weight also refined: the first bar of the day for intraday charts marks the day
    if (this._weightCache.size > 200000) this._weightCache.clear();
    this._weightCache.set(index, w);
    return w;
  }

  formatTickLabel(time: number, weight: number): string {
    const p = dateParts(time, this._timezone);
    const res = parseResolution(this._resolution);
    if (weight >= TickWeight.Year) return String(p.year);
    if (weight >= TickWeight.Month) return MONTHS_SHORT[p.month - 1];
    if (weight >= TickWeight.Day) return String(p.day);
    if (res.isSeconds || this.options.secondsVisible) return formatTime(p, true);
    return formatTime(p, false);
  }

  /** Detailed label for the crosshair. */
  formatCrosshairTime(time: number): string {
    if (this.localization.timeFormatter) return this.localization.timeFormatter(time);
    const p = dateParts(time, this._timezone);
    const res = parseResolution(this._resolution);
    const date = formatDate(p, this.localization.dateFormat);
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.weekday];
    if (!res.isIntraday) return `${wd} ${date}`;
    return `${wd} ${date}  ${formatTime(p, res.isSeconds || this.options.secondsVisible)}`;
  }

  dateParts(time: number): DateParts {
    return dateParts(time, this._timezone);
  }

  /** Compute visible tick marks with TradingView-like weighting. */
  ticks(minLabelSpacing = 0): TimeTick[] {
    if (this._width <= 0 || this._times.length === 0) return [];
    const r = this.visibleLogicalRange();
    const key = `${r.from.toFixed(3)}|${this._barSpacing.toFixed(4)}|${this._width}|${minLabelSpacing}`;
    if (this._tickCache && this._tickCache.key === key) return this._tickCache.ticks;
    const from = Math.floor(r.from) - 1;
    const to = Math.ceil(r.to) + 1;
    const maxFuture = this.lastIndex + 5000;
    const candidates: TimeTick[] = [];
    const res = parseResolution(this._resolution);
    for (let i = Math.max(from, -5000); i <= Math.min(to, maxFuture); i++) {
      const weight = this._weightAt(i);
      const time = this.indexToTime(i);
      candidates.push({ index: i, time, x: this.barCenterX(i), weight, label: '' });
    }
    // Level-by-level inclusion (highest weights first) subject to minimum spacing.
    const spacing = minLabelSpacing > 0 ? minLabelSpacing : Math.max(50, this._minTickSpacing(res.isIntraday));
    const weights = Array.from(new Set(candidates.map((c) => c.weight))).sort((a, b) => b - a);
    let accepted: TimeTick[] = [];
    for (const w of weights) {
      const level = candidates.filter((c) => c.weight === w);
      const merged = accepted.concat(level).sort((a, b) => a.x - b.x);
      let ok = true;
      for (let k = 1; k < merged.length; k++) {
        if (merged[k].x - merged[k - 1].x < spacing) { ok = false; break; }
      }
      if (!ok) {
        // still allow individual marks of this level that fit (greedy) to avoid empty stretches
        const greedy = accepted.slice();
        for (const c of level) {
          let fits = true;
          for (const a of greedy) if (Math.abs(a.x - c.x) < spacing) { fits = false; break; }
          if (fits) greedy.push(c);
        }
        // Only keep greedy additions if they are consistent (same weight level gap-filling)
        if (w <= TickWeight.Hour12 || w === TickWeight.Day) {
          accepted = greedy.sort((a, b) => a.x - b.x);
        }
        break;
      }
      accepted = merged;
    }
    for (const t of accepted) t.label = this.formatTickLabel(t.time, t.weight);
    this._tickCache = { key, ticks: accepted };
    return accepted;
  }

  private _minTickSpacing(intraday: boolean): number {
    return intraday ? 70 : 60;
  }

  /** Indices at which a new trading day/session starts (for session break lines). */
  sessionBreaks(): number[] {
    if (this._sessionBreakCache) return this._sessionBreakCache;
    const out: number[] = [];
    const res = parseResolution(this._resolution);
    if (res.isIntraday) {
      for (let i = 1; i < this._times.length; i++) {
        const a = dateParts(this._times[i - 1], this._timezone);
        const b = dateParts(this._times[i], this._timezone);
        if (a.day !== b.day || a.month !== b.month || a.year !== b.year) out.push(i);
      }
    }
    this._sessionBreakCache = out;
    return out;
  }
}
