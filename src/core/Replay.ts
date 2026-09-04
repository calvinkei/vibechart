import type { ChartModel } from './ChartModel';
import type { Bar } from '../data/types';
import { Delegate } from '../util/events';

export interface ReplayState {
  active: boolean;
  playing: boolean;
  /** number of bars currently shown */
  position: number;
  total: number;
  /** bars per second */
  speed: number;
}

/**
 * Bar replay (TradingView "Replay"): freezes the loaded history at a chosen bar and steps forward.
 * Realtime updates are buffered while active.
 */
export class ReplayController {
  readonly changed = new Delegate<ReplayState>();
  private _full: Bar[] = [];
  private _pos = 0;
  private _playing = false;
  private _speed = 1;
  private _timer = 0;
  private _active = false;
  /** Called when replay needs the full bar array (chart supplies loader.bars). */
  constructor(private readonly model: ChartModel, private readonly getFullBars: () => Bar[], private readonly restore: (bars: Bar[]) => void) {}

  get state(): ReplayState {
    return { active: this._active, playing: this._playing, position: this._pos, total: this._full.length, speed: this._speed };
  }
  get active(): boolean { return this._active; }

  /** Start replay at a bar time (or index). */
  start(at: { time?: number; index?: number } = {}): void {
    this._full = this.getFullBars().slice();
    if (!this._full.length) return;
    let idx = at.index ?? (at.time !== undefined ? this._full.findIndex((b) => b.time >= at.time!) : Math.max(1, Math.floor(this._full.length * 0.7)));
    if (idx < 0) idx = this._full.length - 1;
    this._pos = Math.max(1, Math.min(this._full.length, idx + 1));
    this._active = true;
    this._apply();
  }

  private _apply(): void {
    this.model.setBars(this._full.slice(0, this._pos), { prepended: 0, appended: 0, reset: false });
    this.changed.fire(this.state);
  }

  stepForward(n = 1): void {
    if (!this._active) return;
    if (this._pos >= this._full.length) { this.pause(); return; }
    this._pos = Math.min(this._full.length, this._pos + n);
    this.model.setBars(this._full.slice(0, this._pos), { prepended: 0, appended: n, reset: false });
    this.changed.fire(this.state);
  }

  /** Jump to a bar index/time (restarts from there). */
  jumpTo(index: number): void {
    if (!this._active) return;
    this._pos = Math.max(1, Math.min(this._full.length, index + 1));
    this._apply();
  }

  play(): void {
    if (!this._active || this._playing) return;
    this._playing = true;
    this._schedule();
    this.changed.fire(this.state);
  }

  private _schedule(): void {
    clearInterval(this._timer);
    this._timer = window.setInterval(() => {
      if (!this._playing) return;
      this.stepForward(1);
      if (this._pos >= this._full.length) this.pause();
    }, Math.max(20, 1000 / this._speed));
  }

  pause(): void {
    if (!this._playing) return;
    this._playing = false;
    clearInterval(this._timer);
    this.changed.fire(this.state);
  }

  setSpeed(barsPerSecond: number): void {
    this._speed = Math.max(0.1, barsPerSecond);
    if (this._playing) this._schedule();
    this.changed.fire(this.state);
  }

  /** Feed realtime data while active (buffered into the full array). */
  onRealtimeBars(bars: Bar[]): void {
    if (!this._active) return;
    this._full = bars.slice();
    this.changed.fire(this.state);
  }

  stop(): void {
    if (!this._active) return;
    this.pause();
    this._active = false;
    this.restore(this.getFullBars());
    this.changed.fire(this.state);
  }

  destroy(): void {
    clearInterval(this._timer);
  }
}
