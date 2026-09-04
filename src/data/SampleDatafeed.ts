import type { Bar, Datafeed, DatafeedConfiguration, PeriodParams, ResolutionString, SearchSymbolResultItem, SymbolInfo } from './types';
import { parseResolution } from './resolution';
import { dateParts } from '../util/time';

/**
 * A deterministic synthetic datafeed (no network) for demos and tests.
 * Prices are a smooth deterministic function of (symbol, time) so any resolution is consistent.
 */

interface SampleSymbol extends SymbolInfo {
  basePrice: number;
  volatility: number;
  baseVolume: number;
}

const SYMBOLS: SampleSymbol[] = [
  { name: 'BTCUSD', ticker: 'BTCUSD', description: 'Bitcoin / U.S. Dollar', type: 'crypto', session: '24x7', timezone: 'Etc/UTC', exchange: 'SAMPLE', listed_exchange: 'SAMPLE', minmov: 1, pricescale: 100, has_intraday: true, has_seconds: true, has_daily: true, has_weekly_and_monthly: true, supported_resolutions: ['1S', '5S', '15S', '30S', '1', '3', '5', '15', '30', '60', '120', '240', '1D', '1W', '1M'], volume_precision: 3, data_status: 'streaming', currency_code: 'USD', basePrice: 42000, volatility: 0.6, baseVolume: 120 },
  { name: 'ETHUSD', ticker: 'ETHUSD', description: 'Ethereum / U.S. Dollar', type: 'crypto', session: '24x7', timezone: 'Etc/UTC', exchange: 'SAMPLE', listed_exchange: 'SAMPLE', minmov: 1, pricescale: 100, has_intraday: true, has_seconds: true, has_daily: true, has_weekly_and_monthly: true, supported_resolutions: ['1S', '5S', '15S', '30S', '1', '3', '5', '15', '30', '60', '120', '240', '1D', '1W', '1M'], volume_precision: 3, data_status: 'streaming', currency_code: 'USD', basePrice: 2300, volatility: 0.75, baseVolume: 900 },
  { name: 'AAPL', ticker: 'AAPL', description: 'Apple Inc.', type: 'stock', session: '0930-1600', timezone: 'America/New_York', exchange: 'SAMPLE', listed_exchange: 'NASDAQ', minmov: 1, pricescale: 100, has_intraday: true, has_daily: true, has_weekly_and_monthly: true, supported_resolutions: ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M'], volume_precision: 0, data_status: 'streaming', currency_code: 'USD', basePrice: 185, volatility: 0.28, baseVolume: 6e5 },
  { name: 'TSLA', ticker: 'TSLA', description: 'Tesla, Inc.', type: 'stock', session: '0930-1600', timezone: 'America/New_York', exchange: 'SAMPLE', listed_exchange: 'NASDAQ', minmov: 1, pricescale: 100, has_intraday: true, has_daily: true, has_weekly_and_monthly: true, supported_resolutions: ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M'], volume_precision: 0, data_status: 'streaming', currency_code: 'USD', basePrice: 245, volatility: 0.55, baseVolume: 1.2e6 },
  { name: 'EURUSD', ticker: 'EURUSD', description: 'Euro / U.S. Dollar', type: 'forex', session: '24x5', timezone: 'Etc/UTC', exchange: 'SAMPLE', listed_exchange: 'FX', minmov: 1, pricescale: 100000, has_intraday: true, has_daily: true, has_weekly_and_monthly: true, supported_resolutions: ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M'], volume_precision: 0, data_status: 'streaming', currency_code: 'USD', basePrice: 1.085, volatility: 0.08, baseVolume: 4000 },
  { name: 'ES1!', ticker: 'ES1!', description: 'E-mini S&P 500 Futures', type: 'futures', session: '1700-1600', timezone: 'America/Chicago', exchange: 'SAMPLE', listed_exchange: 'CME', minmov: 25, pricescale: 100, has_intraday: true, has_daily: true, has_weekly_and_monthly: true, supported_resolutions: ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M'], volume_precision: 0, data_status: 'streaming', currency_code: 'USD', basePrice: 5200, volatility: 0.16, baseVolume: 30000 },
];

function hash(x: number, seed: number): number {
  let h = Math.imul((x | 0) ^ seed, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296; // [0,1)
}

function smooth(t: number): number { return t * t * (3 - 2 * t); }

/** 1D value noise with smooth interpolation. */
function noise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(i, seed);
  const b = hash(i + 1, seed);
  return a + (b - a) * smooth(f);
}

function symbolSeed(name: string): number {
  let s = 7;
  for (let i = 0; i < name.length; i++) s = (Math.imul(s, 31) + name.charCodeAt(i)) | 0;
  return s;
}

/** Deterministic log-price for a symbol at a given time (seconds). */
export function samplePrice(sym: SampleSymbol, time: number): number {
  const seed = symbolSeed(sym.name);
  const vol = sym.volatility;
  // multi-octave value noise on log price, each octave a different period (seconds)
  const octaves: Array<[number, number]> = [[365 * 86400 * 4, 1.2], [365 * 86400, 0.7], [90 * 86400, 0.45], [20 * 86400, 0.3], [4 * 86400, 0.18], [86400, 0.12], [4 * 3600, 0.07], [3600, 0.045], [600, 0.025], [60, 0.012], [10, 0.006]];
  let v = 0;
  let k = 0;
  for (const [period, amp] of octaves) {
    v += (noise(time / period, seed + k * 101) - 0.5) * 2 * amp * vol;
    k++;
  }
  // gentle long-term drift
  const years = (time - 1262304000) / (365 * 86400);
  v += years * 0.06;
  return sym.basePrice * Math.exp(v);
}

function inSession(sym: SampleSymbol, time: number, res: ReturnType<typeof parseResolution>): boolean {
  if (sym.session === '24x7') return true;
  const p = dateParts(res.isIntraday ? time : time + 43200, res.isIntraday ? sym.timezone : 'Etc/UTC');
  if (sym.session === '24x5') {
    if (!res.isIntraday) return p.weekday >= 1 && p.weekday <= 5;
    // Sunday 22:00 -> Friday 22:00 UTC approx
    if (p.weekday === 6) return false;
    if (p.weekday === 0 && p.hour < 22) return false;
    if (p.weekday === 5 && p.hour >= 22) return false;
    return true;
  }
  if (!res.isIntraday) return p.weekday >= 1 && p.weekday <= 5;
  const [a, b] = sym.session.split('-');
  const start = parseInt(a.slice(0, 2), 10) * 60 + parseInt(a.slice(2), 10);
  const end = parseInt(b.slice(0, 2), 10) * 60 + parseInt(b.slice(2), 10);
  const m = p.hour * 60 + p.minute;
  if (start < end) {
    if (p.weekday === 0 || p.weekday === 6) return false;
    return m >= start && m < end;
  }
  // overnight session (futures): Sun 17:00 -> Fri 16:00
  if (p.weekday === 6) return false;
  if (p.weekday === 0) return m >= start;
  if (p.weekday === 5) return m < end;
  return m >= start || m < end;
}

/** Start of the bar containing `t` (aligned), for the symbol timezone. */
function alignBar(sym: SampleSymbol, t: number, res: ReturnType<typeof parseResolution>): number {
  if (res.isIntraday) return Math.floor(t / res.seconds) * res.seconds;
  const p = dateParts(t, sym.timezone);
  if (res.isDaily) {
    const dayStart = Date.UTC(p.year, p.month - 1, p.day) / 1000;
    return dayStart; // treat as UTC midnight for simplicity of daily alignment
  }
  if (res.isWeekly) {
    const dow = (p.weekday + 6) % 7;
    return Date.UTC(p.year, p.month - 1, p.day - dow) / 1000;
  }
  return Date.UTC(p.year, p.month - 1, 1) / 1000;
}

function nextBar(sym: SampleSymbol, t: number, res: ReturnType<typeof parseResolution>): number {
  if (res.isIntraday) return t + res.seconds;
  const d = new Date(t * 1000);
  if (res.isDaily) return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + res.value) / 1000;
  if (res.isWeekly) return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 7 * res.value) / 1000;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + res.value, 1) / 1000;
}

export function sampleBar(sym: SampleSymbol, t: number, res: ReturnType<typeof parseResolution>, tEnd: number): Bar {
  const seed = symbolSeed(sym.name);
  const open = samplePrice(sym, t);
  const close = samplePrice(sym, tEnd);
  // sample intermediate points for high/low
  const steps = 6;
  let high = Math.max(open, close);
  let low = Math.min(open, close);
  for (let k = 1; k < steps; k++) {
    const v = samplePrice(sym, t + ((tEnd - t) * k) / steps);
    if (v > high) high = v;
    if (v < low) low = v;
  }
  const spread = (high - low) * 0.15 + open * 0.0005 * Math.sqrt(res.seconds / 60) * sym.volatility;
  high += spread * hash(t, seed + 1);
  low -= spread * hash(t, seed + 2);
  const r = Math.pow(10, Math.log10(sym.pricescale));
  const round = (v: number) => Math.round(v * r) / r;
  const volBase = sym.baseVolume * Math.sqrt(res.seconds / 60);
  const volume = Math.round(volBase * (0.4 + hash(t, seed + 3) * 1.6) * (1 + Math.abs(close - open) / open * 40));
  return { time: t * 1000, open: round(open), high: round(high), low: round(low), close: round(close), volume };
}

export class SampleDatafeed implements Datafeed {
  private _subs = new Map<string, number>();
  /** realtime update interval ms */
  tickInterval = 1000;
  /** simulate latency ms */
  latency = 60;

  onReady(cb: (c: DatafeedConfiguration) => void): void {
    setTimeout(() => cb({
      supported_resolutions: ['1S', '5S', '15S', '30S', '1', '3', '5', '15', '30', '60', '120', '240', '1D', '1W', '1M'],
      supports_marks: true,
      supports_timescale_marks: true,
      supports_time: true,
      exchanges: [{ value: '', name: 'All Exchanges', desc: '' }, { value: 'SAMPLE', name: 'SAMPLE', desc: 'Sample exchange' }],
      symbols_types: [{ name: 'All types', value: '' }, { name: 'Crypto', value: 'crypto' }, { name: 'Stock', value: 'stock' }, { name: 'Forex', value: 'forex' }, { name: 'Futures', value: 'futures' }],
    }), 0);
  }

  searchSymbols(userInput: string, exchange: string, symbolType: string, onResult: (r: SearchSymbolResultItem[]) => void): void {
    const q = userInput.trim().toUpperCase();
    const out = SYMBOLS.filter((s) => (!q || s.name.includes(q) || s.description.toUpperCase().includes(q)) && (!exchange || s.exchange === exchange) && (!symbolType || s.type === symbolType))
      .map((s) => ({ symbol: s.name, full_name: `${s.exchange}:${s.name}`, description: s.description, exchange: s.exchange, ticker: s.name, type: s.type }));
    setTimeout(() => onResult(out), this.latency);
  }

  resolveSymbol(symbolName: string, onResolve: (s: SymbolInfo) => void, onError: (r: string) => void): void {
    const name = symbolName.includes(':') ? symbolName.split(':')[1] : symbolName;
    const sym = SYMBOLS.find((s) => s.name.toUpperCase() === name.toUpperCase());
    setTimeout(() => {
      if (!sym) return onError(`Unknown symbol: ${symbolName}`);
      const { basePrice, volatility, baseVolume, ...info } = sym;
      void basePrice; void volatility; void baseVolume;
      onResolve({ ...info, full_name: `${sym.exchange}:${sym.name}` });
    }, this.latency);
  }

  getBars(symbolInfo: SymbolInfo, resolution: ResolutionString, period: PeriodParams, onResult: (bars: Bar[], meta?: { noData?: boolean; nextTime?: number }) => void, onError: (r: string) => void): void {
    const sym = SYMBOLS.find((s) => s.name === symbolInfo.name);
    if (!sym) return onError('Unknown symbol');
    const res = parseResolution(resolution);
    const HISTORY_START = 1262304000; // 2010-01-01
    setTimeout(() => {
      const bars: Bar[] = [];
      const to = Math.min(period.to, Math.floor(Date.now() / 1000));
      let t = alignBar(sym, to, res);
      if (t >= to) t = alignBar(sym, t - 1, res);
      const want = Math.max(period.countBack || 0, 1);
      let guard = 0;
      // walk backwards until we have `countBack` bars (or hit period.from when countBack is 0)
      while (bars.length < want && guard++ < 2_000_000) {
        if (t < HISTORY_START) break;
        if (inSession(sym, t, res)) {
          bars.push(sampleBar(sym, t, res, nextBar(sym, t, res)));
        }
        t = alignBar(sym, t - 1, res);
        if (!period.countBack && t < period.from) break;
      }
      bars.reverse();
      if (bars.length === 0) return onResult([], { noData: true });
      onResult(bars, { noData: false });
    }, this.latency);
  }

  subscribeBars(symbolInfo: SymbolInfo, resolution: ResolutionString, onTick: (bar: Bar) => void, guid: string): void {
    const sym = SYMBOLS.find((s) => s.name === symbolInfo.name);
    if (!sym) return;
    const res = parseResolution(resolution);
    const seed = symbolSeed(sym.name) + 999;
    let lastBar: Bar | null = null;
    const id = window.setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const t = alignBar(sym, now, res);
      if (!inSession(sym, t, res)) return;
      if (!lastBar || lastBar.time !== t * 1000) {
        lastBar = sampleBar(sym, t, res, nextBar(sym, t, res));
        // start the bar at its open with no range yet
        lastBar = { ...lastBar, high: lastBar.open, low: lastBar.open, close: lastBar.open, volume: 0 };
      }
      // wander the close
      const r = Math.pow(10, Math.log10(sym.pricescale));
      const step = lastBar.open * 0.0004 * sym.volatility * (hash(now, seed) - 0.5) * 2;
      const close = Math.round((lastBar.close + step) * r) / r;
      lastBar = { ...lastBar, close, high: Math.max(lastBar.high, close), low: Math.min(lastBar.low, close), volume: (lastBar.volume ?? 0) + Math.round(sym.baseVolume * 0.02 * hash(now, seed + 1)) };
      onTick(lastBar);
    }, this.tickInterval);
    this._subs.set(guid, id);
  }

  unsubscribeBars(guid: string): void {
    const id = this._subs.get(guid);
    if (id !== undefined) { clearInterval(id); this._subs.delete(guid); }
  }

  getMarks(symbolInfo: SymbolInfo, from: number, to: number, onData: (marks: import('./types').Mark[]) => void, _resolution: ResolutionString): void {
    // sample: a mark every ~20 trading days on stocks (earnings-like), every 30 days on others
    const out: import('./types').Mark[] = [];
    const step = symbolInfo.type === 'stock' ? 28 * 86400 : 30 * 86400;
    let t = Math.ceil(from / step) * step;
    let k = 0;
    while (t <= to && k++ < 200) {
      out.push({ id: `m_${symbolInfo.name}_${t}`, time: t, color: k % 2 ? 'red' : 'blue', text: `Sample mark at ${new Date(t * 1000).toDateString()}`, label: k % 2 ? 'D' : 'A', labelFontColor: '#fff', minSize: 14 });
      t += step;
    }
    setTimeout(() => onData(out), this.latency);
  }

  getTimescaleMarks(symbolInfo: SymbolInfo, from: number, to: number, onData: (marks: import('./types').TimescaleMark[]) => void, _resolution: ResolutionString): void {
    const out: import('./types').TimescaleMark[] = [];
    if (symbolInfo.type !== 'stock') return void setTimeout(() => onData(out), this.latency);
    const step = 91 * 86400; // quarterly earnings
    let t = Math.ceil(from / step) * step;
    let k = 0;
    while (t <= to && k++ < 100) {
      out.push({ id: `e_${symbolInfo.name}_${t}`, time: t, color: k % 2 ? '#089981' : '#F23645', label: 'E', tooltip: [`${symbolInfo.name} earnings`, new Date(t * 1000).toDateString(), 'EPS: sample'], shape: k % 2 ? 'earningUp' : 'earningDown' });
      t += step;
    }
    setTimeout(() => onData(out), this.latency);
  }

  getServerTime(cb: (t: number) => void): void { cb(Math.floor(Date.now() / 1000)); }

  static symbols(): SampleSymbol[] { return SYMBOLS; }
}
