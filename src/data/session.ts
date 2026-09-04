import { dateParts } from '../util/time';
import { parseResolution } from './resolution';
import type { ResolutionString } from './types';

interface Segment { start: number; end: number; days: Set<number> } // minutes of day; days: 0=Sun..6=Sat

/**
 * Trading session calendar built from a TradingView session string
 * ("24x7", "0930-1600", "0930-1600:23456", "1700-1600:23456", "0900-1230,1330-1600").
 * Used to extrapolate bar times beyond the data (right margin) without weekend gaps.
 */
export class SessionCalendar {
  readonly always: boolean;
  private _segments: Segment[] = [];
  private _futureCache: { base: number; res: string; times: number[] } | null = null;
  private _pastCache: { base: number; res: string; times: number[] } | null = null;

  constructor(readonly session: string, readonly timezone: string) {
    const s = (session || '24x7').trim();
    this.always = s === '24x7' || s === '';
    if (!this.always) this._segments = parseSession(s);
  }

  /** Is the given time (seconds) inside a trading session? */
  inSession(time: number): boolean {
    if (this.always) return true;
    const p = dateParts(time, this.timezone);
    const m = p.hour * 60 + p.minute;
    for (const seg of this._segments) {
      if (seg.start < seg.end) {
        if (seg.days.has(p.weekday) && m >= seg.start && m < seg.end) return true;
      } else {
        // overnight: [start, 24h) on day d, [0, end) on day d+1
        if (seg.days.has(p.weekday) && m >= seg.start) return true;
        if (seg.days.has((p.weekday + 6) % 7) && m < seg.end) return true;
      }
    }
    return false;
  }

  /** Does the given day (any time in it) have a session? */
  dayHasSession(time: number): boolean {
    if (this.always) return true;
    // Daily+ bars are stamped at UTC midnight of the trading day (TradingView convention)
    const p = dateParts(time + 43200, 'Etc/UTC');
    for (const seg of this._segments) if (seg.days.has(p.weekday)) return true;
    return false;
  }

  /** Next bar open time after `time` for a resolution. */
  nextBarTime(time: number, resolution: ResolutionString): number {
    const r = parseResolution(resolution);
    if (r.isIntraday) {
      let t = time + r.seconds;
      let guard = 0;
      while (!this.inSession(t) && guard++ < 20000) t += r.seconds;
      return t;
    }
    if (r.isDaily) {
      let t = time + r.value * 86400;
      let guard = 0;
      while (!this.dayHasSession(t) && guard++ < 60) t += 86400;
      return t;
    }
    if (r.isWeekly) return time + r.value * 7 * 86400;
    // monthly
    const d = new Date(time * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + r.value, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()) / 1000;
  }

  prevBarTime(time: number, resolution: ResolutionString): number {
    const r = parseResolution(resolution);
    if (r.isIntraday) {
      let t = time - r.seconds;
      let guard = 0;
      while (!this.inSession(t) && guard++ < 20000) t -= r.seconds;
      return t;
    }
    if (r.isDaily) {
      let t = time - r.value * 86400;
      let guard = 0;
      while (!this.dayHasSession(t) && guard++ < 60) t -= 86400;
      return t;
    }
    if (r.isWeekly) return time - r.value * 7 * 86400;
    const d = new Date(time * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - r.value, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()) / 1000;
  }

  /** Time of the bar `barsAhead` bars after `lastTime` (memoized). */
  futureTime(lastTime: number, barsAhead: number, resolution: ResolutionString): number {
    if (barsAhead <= 0) return lastTime;
    let c = this._futureCache;
    if (!c || c.base !== lastTime || c.res !== resolution) c = this._futureCache = { base: lastTime, res: resolution, times: [lastTime] };
    while (c.times.length <= barsAhead) c.times.push(this.nextBarTime(c.times[c.times.length - 1], resolution));
    return c.times[barsAhead];
  }

  pastTime(firstTime: number, barsBack: number, resolution: ResolutionString): number {
    if (barsBack <= 0) return firstTime;
    let c = this._pastCache;
    if (!c || c.base !== firstTime || c.res !== resolution) c = this._pastCache = { base: firstTime, res: resolution, times: [firstTime] };
    while (c.times.length <= barsBack) c.times.push(this.prevBarTime(c.times[c.times.length - 1], resolution));
    return c.times[barsBack];
  }
}

function parseSession(s: string): Segment[] {
  const out: Segment[] = [];
  // sessions may be separated by ';' for different day groups in extended format; handle ',' and '|' too
  for (const chunk of s.split(/[;|]/)) {
    const [times, daysPart] = chunk.split(':');
    const days = new Set<number>();
    if (daysPart) for (const ch of daysPart) { const d = parseInt(ch, 10); if (d >= 1 && d <= 7) days.add(d - 1); }
    else for (const d of [1, 2, 3, 4, 5]) days.add(d);
    for (const seg of times.split(',')) {
      const m = seg.trim().match(/^(\d{2})(\d{2})-(\d{2})(\d{2})$/);
      if (!m) continue;
      const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      let end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
      if (end === 0) end = 24 * 60;
      out.push({ start, end, days });
    }
  }
  return out;
}
