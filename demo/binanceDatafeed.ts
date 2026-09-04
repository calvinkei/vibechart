/**
 * Example live datafeed using Binance public market data (no API key).
 * Implements the TradingView-compatible Datafeed interface consumed by VibeChart.
 */
import type { Bar, Datafeed, DatafeedConfiguration, PeriodParams, ResolutionString, SearchSymbolResultItem, SymbolInfo } from '../src/data/types';

const REST = 'https://api.binance.com/api/v3';
const WS = 'wss://stream.binance.com:9443/ws';

const RES_MAP: Record<string, string> = { '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '120': '2h', '240': '4h', '360': '6h', '480': '8h', '720': '12h', '1D': '1d', '3D': '3d', '1W': '1w', '1M': '1M' };
const SUPPORTED = Object.keys(RES_MAP);

interface Sub { ws: WebSocket; }

export class BinanceDatafeed implements Datafeed {
  private _subs = new Map<string, Sub>();
  private _symbols: Array<{ symbol: string; base: string; quote: string }> | null = null;

  onReady(cb: (c: DatafeedConfiguration) => void): void {
    setTimeout(() => cb({ supported_resolutions: SUPPORTED, supports_marks: false, supports_timescale_marks: false, supports_time: true, exchanges: [{ value: 'BINANCE', name: 'Binance', desc: 'Binance' }], symbols_types: [{ name: 'Crypto', value: 'crypto' }] }), 0);
  }

  private async _loadSymbols(): Promise<Array<{ symbol: string; base: string; quote: string }>> {
    if (this._symbols) return this._symbols;
    const r = await fetch(`${REST}/exchangeInfo`);
    const j = await r.json();
    this._symbols = (j.symbols as any[]).filter((s) => s.status === 'TRADING').map((s) => ({ symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset }));
    return this._symbols;
  }

  searchSymbols(userInput: string, _exchange: string, _type: string, onResult: (r: SearchSymbolResultItem[]) => void): void {
    const q = userInput.trim().toUpperCase();
    this._loadSymbols().then((list) => {
      onResult(list.filter((s) => !q || s.symbol.includes(q)).slice(0, 50).map((s) => ({ symbol: s.symbol, full_name: `BINANCE:${s.symbol}`, description: `${s.base} / ${s.quote}`, exchange: 'BINANCE', ticker: s.symbol, type: 'crypto' })));
    }).catch(() => onResult([]));
  }

  resolveSymbol(name: string, onResolve: (s: SymbolInfo) => void, onError: (e: string) => void): void {
    const sym = (name.includes(':') ? name.split(':')[1] : name).toUpperCase();
    fetch(`${REST}/exchangeInfo?symbol=${sym}`).then((r) => r.json()).then((j) => {
      const s = j.symbols?.[0];
      if (!s) return onError(`Unknown symbol ${sym}`);
      const priceFilter = (s.filters as any[]).find((f) => f.filterType === 'PRICE_FILTER');
      const tick = priceFilter ? parseFloat(priceFilter.tickSize) : 0.01;
      const precision = Math.max(0, Math.round(-Math.log10(tick)));
      onResolve({ name: s.symbol, ticker: s.symbol, full_name: `BINANCE:${s.symbol}`, description: `${s.baseAsset} / ${s.quoteAsset}`, type: 'crypto', session: '24x7', timezone: 'Etc/UTC', exchange: 'BINANCE', listed_exchange: 'BINANCE', minmov: 1, pricescale: Math.pow(10, precision), has_intraday: true, has_daily: true, has_weekly_and_monthly: true, supported_resolutions: SUPPORTED, volume_precision: 3, data_status: 'streaming', currency_code: s.quoteAsset });
    }).catch((e) => onError(String(e)));
  }

  getBars(symbolInfo: SymbolInfo, resolution: ResolutionString, period: PeriodParams, onResult: (bars: Bar[], meta?: { noData?: boolean }) => void, onError: (e: string) => void): void {
    const interval = RES_MAP[resolution] ?? '1h';
    const limit = Math.min(1000, Math.max(1, period.countBack || 500));
    const url = `${REST}/klines?symbol=${symbolInfo.name}&interval=${interval}&endTime=${period.to * 1000 - 1}&limit=${limit}`;
    fetch(url).then((r) => r.json()).then((rows: any[]) => {
      if (!Array.isArray(rows)) return onError('Binance error');
      const bars: Bar[] = rows.map((k) => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
      onResult(bars, { noData: bars.length === 0 });
    }).catch((e) => onError(String(e)));
  }

  subscribeBars(symbolInfo: SymbolInfo, resolution: ResolutionString, onTick: (bar: Bar) => void, guid: string): void {
    const interval = RES_MAP[resolution] ?? '1h';
    const ws = new WebSocket(`${WS}/${symbolInfo.name.toLowerCase()}@kline_${interval}`);
    ws.onmessage = (ev) => {
      try {
        const k = JSON.parse(ev.data).k;
        onTick({ time: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
      } catch { /* ignore */ }
    };
    this._subs.set(guid, { ws });
  }

  unsubscribeBars(guid: string): void {
    const s = this._subs.get(guid);
    if (s) { s.ws.close(); this._subs.delete(guid); }
  }

  getServerTime(cb: (t: number) => void): void {
    fetch(`${REST}/time`).then((r) => r.json()).then((j) => cb(Math.floor(j.serverTime / 1000))).catch(() => cb(Math.floor(Date.now() / 1000)));
  }
}
