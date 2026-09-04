/**
 * Data & Datafeed types. The Datafeed interface mirrors TradingView's Charting Library
 * `IBasicDataFeed` so existing UDF-style datafeeds can be reused.
 * NOTE: as in TradingView, `Bar.time` supplied by a datafeed is in MILLISECONDS,
 * `PeriodParams.from/to` are in SECONDS. Internally the chart works in seconds.
 */

export interface Bar {
  /** Unix time. Datafeed: milliseconds (TV compatible). Internal: seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type ResolutionString = string; // "1", "5", "15", "60", "240", "1D", "1W", "1M", "1S", "30S"

export type SeriesType =
  | 'bars'
  | 'candles'
  | 'hollowCandles'
  | 'volumeCandles'
  | 'line'
  | 'lineWithMarkers'
  | 'stepLine'
  | 'area'
  | 'hlcArea'
  | 'baseline'
  | 'columns'
  | 'highLow'
  | 'heikinAshi'
  | 'renko'
  | 'lineBreak'
  | 'kagi'
  | 'pointAndFigure'
  | 'rangeBars';

/** TradingView numeric chart-type ids (widget.chart().setChartType). */
export const CHART_TYPE_IDS: Record<number, SeriesType> = {
  0: 'bars', 1: 'candles', 2: 'line', 3: 'area', 4: 'renko', 5: 'kagi', 6: 'pointAndFigure',
  7: 'lineBreak', 8: 'heikinAshi', 9: 'hollowCandles', 10: 'baseline', 12: 'highLow', 13: 'columns',
  14: 'lineWithMarkers', 15: 'stepLine', 16: 'hlcArea', 17: 'volumeCandles', 18: 'rangeBars',
};

export interface SymbolInfo {
  name: string;
  ticker?: string;
  full_name?: string;
  description: string;
  type: string; // stock, crypto, forex, futures, index, ...
  session: string; // "24x7" or "0930-1600"
  session_display?: string;
  timezone: string; // IANA
  exchange: string;
  listed_exchange?: string;
  /** Number of decimal places = log10(pricescale). e.g. 100 => 2 decimals. */
  pricescale: number;
  /** Minimal price movement in units of 1/pricescale. */
  minmov: number;
  minmove2?: number;
  fractional?: boolean;
  has_intraday?: boolean;
  has_seconds?: boolean;
  has_daily?: boolean;
  has_weekly_and_monthly?: boolean;
  has_empty_bars?: boolean;
  intraday_multipliers?: string[];
  seconds_multipliers?: string[];
  daily_multipliers?: string[];
  weekly_multipliers?: string[];
  monthly_multipliers?: string[];
  supported_resolutions: ResolutionString[];
  volume_precision?: number;
  data_status?: 'streaming' | 'endofday' | 'delayed_streaming';
  delay?: number;
  currency_code?: string;
  original_currency_code?: string;
  unit_id?: string;
  format?: 'price' | 'volume';
  logo_urls?: string[];
  exchange_logo?: string;
  visible_plots_set?: 'ohlcv' | 'ohlc' | 'c';
  expired?: boolean;
  expiration_date?: number;
  sector?: string;
  industry?: string;
  [key: string]: unknown;
}

export interface DatafeedConfiguration {
  supported_resolutions?: ResolutionString[];
  supports_marks?: boolean;
  supports_timescale_marks?: boolean;
  supports_time?: boolean;
  exchanges?: Array<{ value: string; name: string; desc: string }>;
  symbols_types?: Array<{ name: string; value: string }>;
  currency_codes?: string[];
  units?: Record<string, Array<{ id: string; name: string; description: string }>>;
}

export interface SearchSymbolResultItem {
  symbol: string;
  full_name?: string;
  description: string;
  exchange: string;
  ticker?: string;
  type: string;
  logo_urls?: string[];
  exchange_logo?: string;
}

export interface PeriodParams {
  /** seconds */
  from: number;
  /** seconds */
  to: number;
  countBack: number;
  firstDataRequest: boolean;
}

export interface HistoryMetadata {
  noData?: boolean;
  /** seconds — next time (older) where data exists */
  nextTime?: number | null;
}

export interface Mark {
  id: string | number;
  time: number; // seconds
  color: string | { border: string; background: string };
  text: string;
  label: string;
  labelFontColor: string;
  minSize: number;
  borderWidth?: number;
  hoveredBorderWidth?: number;
  imageUrl?: string;
  showLabelWhenImageLoaded?: boolean;
}

export interface TimescaleMark {
  id: string | number;
  time: number; // seconds
  color: string;
  label: string;
  tooltip: string[];
  shape?: 'circle' | 'earningUp' | 'earningDown' | 'earning';
  imageUrl?: string;
  showLabelWhenImageLoaded?: boolean;
}

export type OnReadyCallback = (configuration: DatafeedConfiguration) => void;
export type ResolveCallback = (symbolInfo: SymbolInfo) => void;
export type ErrorCallback = (reason: string) => void;
export type HistoryCallback = (bars: Bar[], meta?: HistoryMetadata) => void;
export type SubscribeBarsCallback = (bar: Bar) => void;
export type SearchSymbolsCallback = (items: SearchSymbolResultItem[]) => void;
export type GetMarksCallback = (marks: Mark[]) => void;
export type GetTimescaleMarksCallback = (marks: TimescaleMark[]) => void;
export type ServerTimeCallback = (serverTime: number) => void;

export interface Datafeed {
  onReady(callback: OnReadyCallback): void;
  searchSymbols?(userInput: string, exchange: string, symbolType: string, onResult: SearchSymbolsCallback): void;
  resolveSymbol(symbolName: string, onResolve: ResolveCallback, onError: ErrorCallback, extension?: unknown): void;
  getBars(
    symbolInfo: SymbolInfo,
    resolution: ResolutionString,
    periodParams: PeriodParams,
    onResult: HistoryCallback,
    onError: ErrorCallback,
  ): void;
  subscribeBars(
    symbolInfo: SymbolInfo,
    resolution: ResolutionString,
    onTick: SubscribeBarsCallback,
    listenerGuid: string,
    onResetCacheNeededCallback: () => void,
  ): void;
  unsubscribeBars(listenerGuid: string): void;
  getMarks?(symbolInfo: SymbolInfo, from: number, to: number, onDataCallback: GetMarksCallback, resolution: ResolutionString): void;
  getTimescaleMarks?(symbolInfo: SymbolInfo, from: number, to: number, onDataCallback: GetTimescaleMarksCallback, resolution: ResolutionString): void;
  getServerTime?(callback: ServerTimeCallback): void;
}

/** Price format for a scale/series. */
export interface PriceFormat {
  type: 'price' | 'volume' | 'percent' | 'custom';
  precision: number;
  minMove: number;
  fractional?: boolean;
  minMove2?: number;
  formatter?: (price: number) => string;
}

export type PriceSource = 'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4' | 'hlcc4' | 'volume';

export function priceSourceValue(bar: Bar, src: PriceSource): number {
  switch (src) {
    case 'open': return bar.open;
    case 'high': return bar.high;
    case 'low': return bar.low;
    case 'close': return bar.close;
    case 'hl2': return (bar.high + bar.low) / 2;
    case 'hlc3': return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4': return (bar.open + bar.high + bar.low + bar.close) / 4;
    case 'hlcc4': return (bar.high + bar.low + bar.close + bar.close) / 4;
    case 'volume': return bar.volume ?? NaN;
  }
}
