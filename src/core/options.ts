import type { PriceSource, SeriesType } from '../data/types';
import type { DateFormat } from '../util/time';

export type LineStyle = 0 | 1 | 2 | 3 | 4; // solid, dotted, dashed, large dashed, sparse dotted
export const LineStyle = { Solid: 0 as LineStyle, Dotted: 1 as LineStyle, Dashed: 2 as LineStyle, LargeDashed: 3 as LineStyle, SparseDotted: 4 as LineStyle };
export type LineWidth = 1 | 2 | 3 | 4;

export type PriceScaleMode = 'normal' | 'logarithmic' | 'percentage' | 'indexedTo100';
export type CrosshairMode = 'normal' | 'magnet' | 'magnetStrong' | 'hidden';
export type ThemeName = 'light' | 'dark';

export interface Background {
  type: 'solid' | 'gradient';
  color: string;
  topColor?: string;
  bottomColor?: string;
}

export interface GridLineOptions { color: string; style: LineStyle; visible: boolean }

export interface CrosshairLineOptions {
  color: string;
  width: LineWidth;
  style: LineStyle;
  visible: boolean;
  labelVisible: boolean;
  labelBackgroundColor: string;
  labelTextColor?: string;
}

export interface CrosshairOptions {
  mode: CrosshairMode;
  vertLine: CrosshairLineOptions;
  horzLine: CrosshairLineOptions;
}

export interface PriceScaleOptions {
  visible: boolean;
  mode: PriceScaleMode;
  invertScale: boolean;
  autoScale: boolean;
  alignLabels: boolean;
  borderVisible: boolean;
  borderColor: string;
  textColor: string;
  scaleMargins: { top: number; bottom: number };
  entireTextOnly: boolean;
  ticksVisible: boolean;
  minimumWidth: number;
  /** Lock price to bar ratio (when zooming time, price scale zooms proportionally). */
  lockPriceToBarRatio: boolean;
  /** Only scale using the main series (ignore indicators) */
  scaleSeriesOnly: boolean;
}

export interface TimeScaleOptions {
  visible: boolean;
  barSpacing: number;
  minBarSpacing: number;
  maxBarSpacing: number;
  rightOffset: number;
  timeVisible: boolean;
  secondsVisible: boolean;
  borderVisible: boolean;
  borderColor: string;
  textColor: string;
  fixLeftEdge: boolean;
  fixRightEdge: boolean;
  lockVisibleTimeRangeOnResize: boolean;
  rightBarStaysOnScroll: boolean;
  shiftVisibleRangeOnNewBar: boolean;
  allowShiftVisibleRangeOnWhitespaceReplacement: boolean;
  ticksVisible: boolean;
  uniformDistribution: boolean;
  minimumHeight: number;
  sessionBreaks: { visible: boolean; color: string; style: LineStyle; width: LineWidth };
  /** Show marks (events) row */
  marksVisible: boolean;
}

export interface WatermarkOptions {
  visible: boolean;
  color: string;
  fontSize: number;
  /** Custom text; defaults to "SYMBOL, INTERVAL" */
  text?: string;
  showInterval: boolean;
  horzAlign: 'left' | 'center' | 'right';
  vertAlign: 'top' | 'center' | 'bottom';
}

export interface LegendOptions {
  visible: boolean;
  showSymbol: boolean;
  showSymbolDescription: boolean;
  showInterval: boolean;
  showOHLC: boolean;
  showBarChange: boolean;
  showVolume: boolean;
  showLastDayChange: boolean;
  showIndicatorTitles: boolean;
  showIndicatorArguments: boolean;
  showIndicatorValues: boolean;
  showExchange: boolean;
  /** Show values of last bar when not hovering, TV: "Values" */
  showValues: boolean;
  fontSize: number;
  background: boolean;
}

export interface PriceLineOptions {
  visible: boolean;
  color?: string; // undefined => series up/down color
  width: LineWidth;
  style: LineStyle;
}

export interface CandleStyleOptions {
  upColor: string;
  downColor: string;
  bodyVisible: boolean;
  borderVisible: boolean;
  borderUpColor: string;
  borderDownColor: string;
  wickVisible: boolean;
  wickUpColor: string;
  wickDownColor: string;
  /** Hollow candles: bodies filled only for down closes vs previous close */
  hollowDown?: boolean;
}

export interface BarStyleOptions {
  upColor: string;
  downColor: string;
  thinBars: boolean;
  hlcBars: boolean;
  /** Color bars based on previous close (TV: "Color bars based on previous close") */
  colorBasedOnPrevClose: boolean;
}

export interface LineStyleOptions {
  color: string;
  lineWidth: LineWidth;
  lineStyle: LineStyle;
  priceSource: PriceSource;
  /** line, stepLine or markers */
  lineType: 'simple' | 'step' | 'markers' | 'curved';
  markerRadius: number;
  crosshairMarkerVisible: boolean;
}

export interface AreaStyleOptions {
  lineColor: string;
  topColor: string;
  bottomColor: string;
  lineWidth: LineWidth;
  lineStyle: LineStyle;
  priceSource: PriceSource;
  invertFilledArea: boolean;
}

export interface HLCAreaStyleOptions {
  highLineColor: string;
  lowLineColor: string;
  closeLineColor: string;
  highLineWidth: LineWidth;
  lowLineWidth: LineWidth;
  closeLineWidth: LineWidth;
  highLineStyle: LineStyle;
  lowLineStyle: LineStyle;
  closeLineStyle: LineStyle;
  fillColor: string;
}

export interface BaselineStyleOptions {
  baseValue: { type: 'price'; price: number } | { type: 'percent'; percent: number };
  topLineColor: string;
  topFillColor1: string;
  topFillColor2: string;
  bottomLineColor: string;
  bottomFillColor1: string;
  bottomFillColor2: string;
  lineWidth: LineWidth;
  lineStyle: LineStyle;
  priceSource: PriceSource;
  baseLineVisible: boolean;
  baseLineColor: string;
  baseLineWidth: LineWidth;
  baseLineStyle: LineStyle;
}

export interface ColumnStyleOptions {
  upColor: string;
  downColor: string;
  priceSource: PriceSource;
  colorBasedOnPrevClose: boolean;
}

export interface HighLowStyleOptions {
  bodyColor: string;
  borderColor: string;
  borderVisible: boolean;
  showLabels: boolean;
  labelColor: string;
  fontSize: number;
}

export interface RenkoStyleOptions extends CandleStyleOptions {
  boxSizeMethod: 'ATR' | 'Traditional';
  atrLength: number;
  boxSize: number;
  source: 'close' | 'highLow';
  wicks: boolean;
  /** show real-time (projection) box */
  showProjection: boolean;
}

export interface KagiStyleOptions {
  upColor: string;
  downColor: string;
  lineWidth: LineWidth;
  reversalMethod: 'ATR' | 'Traditional' | 'Percentage';
  atrLength: number;
  reversalAmount: number;
  source: 'close' | 'highLow';
}

export interface LineBreakStyleOptions extends CandleStyleOptions {
  numberOfLines: number;
  source: 'close' | 'highLow';
}

export interface PnFStyleOptions {
  upColor: string;
  downColor: string;
  borderUpColor: string;
  borderDownColor: string;
  boxSizeMethod: 'ATR' | 'Traditional';
  atrLength: number;
  boxSize: number;
  reversalAmount: number;
  source: 'close' | 'highLow';
  oneStepBackBuilding: boolean;
  projection: boolean;
}

export interface RangeStyleOptions extends CandleStyleOptions {
  range: number;
  phantomBars: boolean;
}

export interface SeriesStyleOptions {
  candles: CandleStyleOptions;
  hollowCandles: CandleStyleOptions;
  volumeCandles: CandleStyleOptions;
  heikinAshi: CandleStyleOptions;
  bars: BarStyleOptions;
  line: LineStyleOptions;
  lineWithMarkers: LineStyleOptions;
  stepLine: LineStyleOptions;
  area: AreaStyleOptions;
  hlcArea: HLCAreaStyleOptions;
  baseline: BaselineStyleOptions;
  columns: ColumnStyleOptions;
  highLow: HighLowStyleOptions;
  renko: RenkoStyleOptions;
  kagi: KagiStyleOptions;
  lineBreak: LineBreakStyleOptions;
  pointAndFigure: PnFStyleOptions;
  rangeBars: RangeStyleOptions;
}

export interface SymbolTabOptions {
  /** Last value line */
  priceLine: PriceLineOptions;
  lastValueVisible: boolean;
  /** high/low price labels on scale */
  highLowLabelsVisible: boolean;
  highLowLinesVisible: boolean;
  /** Countdown to bar close on scale */
  countdownVisible: boolean;
  /** pre/post market prices/bid-ask lines */
  bidAskVisible: boolean;
  prePostMarketVisible: boolean;
  /** precision: 'default' or number of decimals */
  precision: 'default' | number;
  /** timezone: 'exchange' | IANA */
  timezone: string;
  /** Show extended hours */
  extendedHours: boolean;
  /** Real-time bar close countdown & price change in the symbol label */
  averageClosePrice: boolean;
}

export interface VolumeOptions {
  visible: boolean;
  upColor: string;
  downColor: string;
  showMA: boolean;
  maLength: number;
  maColor: string;
  overlay: boolean;
  scaleMargins: { top: number; bottom: number };
}

export interface NavigationOptions {
  scrollButtons: boolean; // scroll to realtime & reset buttons
  dateRanges: boolean; // 1D 5D 1M 3M 6M YTD 1Y 5Y ALL bottom bar
  timezoneMenu: boolean;
  showPaneButtons: boolean;
}

export interface HandleScrollOptions { mouseWheel: boolean; pressedMouseMove: boolean; horzTouchDrag: boolean; vertTouchDrag: boolean }
export interface HandleScaleOptions {
  mouseWheel: boolean;
  pinch: boolean;
  axisPressedMouseMove: { time: boolean; price: boolean };
  axisDoubleClickReset: { time: boolean; price: boolean };
}
export interface KineticScrollOptions { touch: boolean; mouse: boolean }

export interface LocalizationOptions {
  locale: string;
  dateFormat: DateFormat;
  timeFormat: '24h' | '12h';
  priceFormatter?: (p: number) => string;
  timeFormatter?: (t: number) => string;
}

export interface ToolbarOptions {
  top: boolean;
  left: boolean;
  bottom: boolean;
  symbolSearch: boolean;
  intervals: boolean;
  chartTypes: boolean;
  indicators: boolean;
  undoRedo: boolean;
  settings: boolean;
  fullscreen: boolean;
  screenshot: boolean;
  replay: boolean;
  templates: boolean;
  compare: boolean;
  alert: boolean;
  /** favorite intervals shown in the toolbar */
  favoriteIntervals: string[];
  favoriteChartTypes: SeriesType[];
}

export interface DrawingOptions {
  magnet: 'none' | 'weak' | 'strong';
  stayInDrawingMode: boolean;
  lockAll: boolean;
  hideAll: boolean;
  /** Default style for new drawings */
  defaultLineColor: string;
  defaultLineWidth: LineWidth;
  defaultTextColor: string;
  defaultFillColor: string;
}

export interface ChartOptions {
  width: number | 'auto';
  height: number | 'auto';
  autoSize: boolean;
  theme: ThemeName;
  layout: {
    background: Background;
    textColor: string;
    fontSize: number;
    fontFamily: string;
    paneSeparatorColor: string;
    paneSeparatorHoverColor: string;
    /** padding right of the price scale etc. */
    attributionLogo: boolean;
  };
  grid: { vertLines: GridLineOptions; horzLines: GridLineOptions };
  crosshair: CrosshairOptions;
  rightPriceScale: PriceScaleOptions;
  leftPriceScale: PriceScaleOptions;
  timeScale: TimeScaleOptions;
  watermark: WatermarkOptions;
  legend: LegendOptions;
  symbol: SymbolTabOptions;
  series: SeriesStyleOptions;
  volume: VolumeOptions;
  navigation: NavigationOptions;
  handleScroll: HandleScrollOptions;
  handleScale: HandleScaleOptions;
  kineticScroll: KineticScrollOptions;
  localization: LocalizationOptions;
  toolbar: ToolbarOptions;
  drawing: DrawingOptions;
  /** Show session breaks lines */
  sessionBreaks: boolean;
  /** Indicator default colors palette */
  palette: string[];
  /** Custom CSS class added to the root */
  className: string;
}

export type DeepPartial<T> = { [P in keyof T]?: T[P] extends object ? (T[P] extends Function ? T[P] : DeepPartial<T[P]>) : T[P] };

// TradingView default palette
export const TV = {
  blue: '#2962FF',
  green: '#089981',
  red: '#F23645',
  orange: '#FF6D00',
  purple: '#7E57C2',
  gray: '#787B86',
  lightGray: '#B2B5BE',
  darkGray: '#434651',
  teal: '#26A69A',
  pink: '#EF5350',
  yellow: '#FFEB3B',
  amber: '#FF9800',
  cyan: '#00BCD4',
  lime: '#8BC34A',
  indigo: '#3F51B5',
  brown: '#795548',
  black: '#000000',
  white: '#FFFFFF',
  textDark: '#131722',
  textLight: '#D1D4DC',
  bgLight: '#FFFFFF',
  bgDark: '#131722',
  gridLight: '#F0F3FA',
  gridDark: '#1E222D',
  borderLight: '#E0E3EB',
  borderDark: '#2A2E39',
};

/** TradingView-ish indicator palette (used cyclically for MA ribbons etc). */
export const INDICATOR_PALETTE = ['#2962FF', '#FF6D00', '#F23645', '#089981', '#7E57C2', '#00BCD4', '#FF9800', '#E91E63', '#4CAF50', '#9C27B0', '#3F51B5', '#795548'];

/** The color-picker swatch grid used by TradingView (19 hues x 7 shades approximated). */
export const COLOR_SWATCHES: string[] = [
  '#FFFFFF', '#D1D4DC', '#B2B5BE', '#9598A1', '#787B86', '#5D606B', '#434651', '#2A2E39', '#131722', '#000000',
  '#F23645', '#FF9800', '#FFEB3B', '#4CAF50', '#089981', '#00BCD4', '#2962FF', '#673AB7', '#9C27B0', '#E91E63',
  '#FCCBCD', '#FFE0B2', '#FFF9C4', '#C8E6C9', '#ACE5DC', '#B2EBF2', '#BBD9FB', '#D1C4E9', '#E1BEE7', '#F8BBD0',
  '#FAA1A4', '#FFCC80', '#FFF59D', '#A5D6A7', '#70CCBD', '#80DEEA', '#90BFF9', '#B39DDB', '#CE93D8', '#F48FB1',
  '#F77C80', '#FFB74D', '#FFF176', '#81C784', '#42BDA8', '#4DD0E1', '#5B9CF6', '#9575CD', '#BA68C8', '#F06292',
  '#F7525F', '#FFA726', '#FFEE58', '#66BB6A', '#22AB94', '#26C6DA', '#3179F5', '#7E57C2', '#AB47BC', '#EC407A',
  '#B22833', '#F57C00', '#FBC02D', '#388E3C', '#056656', '#0097A7', '#1848CC', '#512DA8', '#7B1FA2', '#C2185B',
  '#801922', '#E65100', '#F57F17', '#1B5E20', '#00332A', '#006064', '#0C3299', '#311B92', '#4A148C', '#880E4F',
];

const priceScaleDefaults = (theme: ThemeName): PriceScaleOptions => ({
  visible: true,
  mode: 'normal',
  invertScale: false,
  autoScale: true,
  alignLabels: true,
  borderVisible: true,
  borderColor: theme === 'dark' ? TV.borderDark : TV.borderLight,
  textColor: theme === 'dark' ? TV.textLight : TV.textDark,
  scaleMargins: { top: 0.1, bottom: 0.08 },
  entireTextOnly: false,
  ticksVisible: false,
  minimumWidth: 0,
  lockPriceToBarRatio: false,
  scaleSeriesOnly: false,
});

const candleDefaults = (): CandleStyleOptions => ({
  upColor: TV.green, downColor: TV.red, bodyVisible: true, borderVisible: true,
  borderUpColor: TV.green, borderDownColor: TV.red, wickVisible: true, wickUpColor: TV.green, wickDownColor: TV.red,
});

const lineDefaults = (type: LineStyleOptions['lineType']): LineStyleOptions => ({
  color: TV.blue, lineWidth: 2, lineStyle: 0, priceSource: 'close', lineType: type, markerRadius: 3, crosshairMarkerVisible: true,
});

export function defaultOptions(theme: ThemeName = 'light'): ChartOptions {
  const dark = theme === 'dark';
  const text = dark ? TV.textLight : TV.textDark;
  const grid = dark ? TV.gridDark : TV.gridLight;
  const border = dark ? TV.borderDark : TV.borderLight;
  return {
    width: 'auto',
    height: 'auto',
    autoSize: true,
    theme,
    layout: {
      background: { type: 'solid', color: dark ? TV.bgDark : TV.bgLight },
      textColor: text,
      fontSize: 12,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
      paneSeparatorColor: border,
      paneSeparatorHoverColor: TV.blue,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: grid, style: 0, visible: true },
      horzLines: { color: grid, style: 0, visible: true },
    },
    crosshair: {
      mode: 'normal',
      vertLine: { color: dark ? '#9598A1' : '#9598A1', width: 1, style: 2, visible: true, labelVisible: true, labelBackgroundColor: dark ? '#363A45' : '#131722', labelTextColor: '#FFFFFF' },
      horzLine: { color: dark ? '#9598A1' : '#9598A1', width: 1, style: 2, visible: true, labelVisible: true, labelBackgroundColor: dark ? '#363A45' : '#131722', labelTextColor: '#FFFFFF' },
    },
    rightPriceScale: priceScaleDefaults(theme),
    leftPriceScale: { ...priceScaleDefaults(theme), visible: false },
    timeScale: {
      visible: true,
      barSpacing: 6,
      minBarSpacing: 0.5,
      maxBarSpacing: 50,
      rightOffset: 10,
      timeVisible: true,
      secondsVisible: false,
      borderVisible: true,
      borderColor: border,
      textColor: text,
      fixLeftEdge: false,
      fixRightEdge: false,
      lockVisibleTimeRangeOnResize: false,
      rightBarStaysOnScroll: false,
      shiftVisibleRangeOnNewBar: true,
      allowShiftVisibleRangeOnWhitespaceReplacement: false,
      ticksVisible: false,
      uniformDistribution: false,
      minimumHeight: 0,
      sessionBreaks: { visible: false, color: dark ? '#2A2E39' : '#E0E3EB', style: 2, width: 1 },
      marksVisible: true,
    },
    watermark: {
      visible: true,
      color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      fontSize: 46,
      showInterval: true,
      horzAlign: 'center',
      vertAlign: 'center',
    },
    legend: {
      visible: true,
      showSymbol: true,
      showSymbolDescription: false,
      showInterval: true,
      showOHLC: true,
      showBarChange: true,
      showVolume: true,
      showLastDayChange: false,
      showIndicatorTitles: true,
      showIndicatorArguments: true,
      showIndicatorValues: true,
      showExchange: true,
      showValues: true,
      fontSize: 12,
      background: false,
    },
    symbol: {
      priceLine: { visible: true, width: 1, style: 1 },
      lastValueVisible: true,
      highLowLabelsVisible: false,
      highLowLinesVisible: false,
      countdownVisible: true,
      bidAskVisible: false,
      prePostMarketVisible: false,
      precision: 'default',
      timezone: 'exchange',
      extendedHours: false,
      averageClosePrice: false,
    },
    series: {
      candles: candleDefaults(),
      hollowCandles: candleDefaults(),
      volumeCandles: candleDefaults(),
      heikinAshi: candleDefaults(),
      bars: { upColor: TV.green, downColor: TV.red, thinBars: true, hlcBars: false, colorBasedOnPrevClose: false },
      line: lineDefaults('simple'),
      lineWithMarkers: lineDefaults('markers'),
      stepLine: lineDefaults('step'),
      area: { lineColor: TV.blue, topColor: 'rgba(41, 98, 255, 0.28)', bottomColor: 'rgba(41, 98, 255, 0.05)', lineWidth: 2, lineStyle: 0, priceSource: 'close', invertFilledArea: false },
      hlcArea: { highLineColor: TV.green, lowLineColor: TV.red, closeLineColor: TV.blue, highLineWidth: 2, lowLineWidth: 2, closeLineWidth: 2, highLineStyle: 0, lowLineStyle: 0, closeLineStyle: 0, fillColor: 'rgba(41, 98, 255, 0.2)' },
      baseline: {
        baseValue: { type: 'percent', percent: 50 },
        topLineColor: TV.green, topFillColor1: 'rgba(8, 153, 129, 0.28)', topFillColor2: 'rgba(8, 153, 129, 0.05)',
        bottomLineColor: TV.red, bottomFillColor1: 'rgba(242, 54, 69, 0.05)', bottomFillColor2: 'rgba(242, 54, 69, 0.28)',
        lineWidth: 2, lineStyle: 0, priceSource: 'close', baseLineVisible: true, baseLineColor: '#B2B5BE', baseLineWidth: 1, baseLineStyle: 0,
      },
      columns: { upColor: TV.green, downColor: TV.red, priceSource: 'close', colorBasedOnPrevClose: true },
      highLow: { bodyColor: TV.blue, borderColor: TV.blue, borderVisible: true, showLabels: true, labelColor: text, fontSize: 10 },
      renko: { ...candleDefaults(), wickUpColor: TV.green, wickDownColor: TV.red, boxSizeMethod: 'ATR', atrLength: 14, boxSize: 1, source: 'close', wicks: true, showProjection: true },
      kagi: { upColor: TV.green, downColor: TV.red, lineWidth: 2, reversalMethod: 'ATR', atrLength: 14, reversalAmount: 1, source: 'close' },
      lineBreak: { ...candleDefaults(), numberOfLines: 3, source: 'close' },
      pointAndFigure: { upColor: TV.green, downColor: TV.red, borderUpColor: TV.green, borderDownColor: TV.red, boxSizeMethod: 'ATR', atrLength: 14, boxSize: 1, reversalAmount: 3, source: 'close', oneStepBackBuilding: false, projection: true },
      rangeBars: { ...candleDefaults(), range: 10, phantomBars: false },
    },
    volume: {
      visible: true,
      upColor: 'rgba(8, 153, 129, 0.5)',
      downColor: 'rgba(242, 54, 69, 0.5)',
      showMA: false,
      maLength: 20,
      maColor: TV.blue,
      overlay: true,
      scaleMargins: { top: 0.8, bottom: 0 },
    },
    navigation: { scrollButtons: true, dateRanges: true, timezoneMenu: true, showPaneButtons: true },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true } },
    kineticScroll: { touch: true, mouse: false },
    localization: { locale: 'en', dateFormat: 'dd MMM yyyy', timeFormat: '24h' },
    toolbar: {
      top: true, left: true, bottom: true, symbolSearch: true, intervals: true, chartTypes: true, indicators: true, undoRedo: true,
      settings: true, fullscreen: true, screenshot: true, replay: true, templates: true, compare: true, alert: false,
      favoriteIntervals: ['1', '5', '15', '60', '240', '1D', '1W'],
      favoriteChartTypes: [],
    },
    drawing: {
      magnet: 'none', stayInDrawingMode: false, lockAll: false, hideAll: false,
      defaultLineColor: TV.blue, defaultLineWidth: 2, defaultTextColor: TV.blue, defaultFillColor: 'rgba(41, 98, 255, 0.2)',
    },
    sessionBreaks: false,
    palette: INDICATOR_PALETTE,
    className: '',
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** Deep merge `src` into a clone of `dst` (arrays replaced, not merged). */
export function mergeOptions<T>(dst: T, src: DeepPartial<T> | undefined): T {
  if (!src) return cloneDeep(dst);
  const out: any = cloneDeep(dst);
  for (const key of Object.keys(src)) {
    const sv = (src as any)[key];
    if (sv === undefined) continue;
    if (isPlainObject(sv) && isPlainObject(out[key])) out[key] = mergeOptions(out[key], sv);
    else out[key] = isPlainObject(sv) ? cloneDeep(sv) : Array.isArray(sv) ? sv.slice() : sv;
  }
  return out;
}

export function cloneDeep<T>(v: T): T {
  if (Array.isArray(v)) return v.map(cloneDeep) as any;
  if (isPlainObject(v)) {
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = cloneDeep((v as any)[k]);
    return o;
  }
  return v;
}

/** Apply a theme to an options object, only touching colors that still hold the other theme's defaults. */
export function applyTheme(opts: ChartOptions, theme: ThemeName): ChartOptions {
  const fresh = defaultOptions(theme);
  const out = cloneDeep(opts);
  out.theme = theme;
  out.layout.background = fresh.layout.background;
  out.layout.textColor = fresh.layout.textColor;
  out.layout.paneSeparatorColor = fresh.layout.paneSeparatorColor;
  out.grid = fresh.grid;
  out.crosshair.vertLine.labelBackgroundColor = fresh.crosshair.vertLine.labelBackgroundColor;
  out.crosshair.horzLine.labelBackgroundColor = fresh.crosshair.horzLine.labelBackgroundColor;
  out.rightPriceScale.borderColor = fresh.rightPriceScale.borderColor;
  out.rightPriceScale.textColor = fresh.rightPriceScale.textColor;
  out.leftPriceScale.borderColor = fresh.leftPriceScale.borderColor;
  out.leftPriceScale.textColor = fresh.leftPriceScale.textColor;
  out.timeScale.borderColor = fresh.timeScale.borderColor;
  out.timeScale.textColor = fresh.timeScale.textColor;
  out.timeScale.sessionBreaks.color = fresh.timeScale.sessionBreaks.color;
  out.watermark.color = fresh.watermark.color;
  out.series.highLow.labelColor = fresh.series.highLow.labelColor;
  return out;
}
