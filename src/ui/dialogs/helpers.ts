/**
 * Pure helpers for the dialogs (no DOM). Kept separate so they can be unit-tested headlessly.
 */
import type { DrawingVisibility } from '../../drawings/Drawing';

/** Read a dotted path from an object. */
export function getPath(obj: unknown, path: string): any {
  return path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Write a dotted path into an object (creating intermediate objects). Returns `obj`. */
export function setPath<T extends object>(obj: T, path: string, value: unknown): T {
  const parts = path.split('.');
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

// ---- interval visibility buckets (shared by drawings and indicators) ----------------------
export type BucketKey = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months';
export interface VisibilityBucket { key: BucketKey; label: string; min: number; max: number }

/** TradingView buckets: Seconds 1–59, Minutes 1–59, Hours 1–24, Days 1–366, Weeks 1–52, Months 1–12 (+ Ranges). */
export const VISIBILITY_BUCKETS: VisibilityBucket[] = [
  { key: 'seconds', label: 'Seconds', min: 1, max: 59 },
  { key: 'minutes', label: 'Minutes', min: 1, max: 59 },
  { key: 'hours', label: 'Hours', min: 1, max: 24 },
  { key: 'days', label: 'Days', min: 1, max: 366 },
  { key: 'weeks', label: 'Weeks', min: 1, max: 52 },
  { key: 'months', label: 'Months', min: 1, max: 12 },
];

/** Which bucket a resolution (in seconds) belongs to, and its value inside that bucket. */
export function bucketFor(resSeconds: number): { key: BucketKey; value: number } {
  if (resSeconds < 60) return { key: 'seconds', value: resSeconds };
  if (resSeconds < 3600) return { key: 'minutes', value: resSeconds / 60 };
  if (resSeconds < 86400) return { key: 'hours', value: resSeconds / 3600 };
  if (resSeconds < 7 * 86400) return { key: 'days', value: resSeconds / 86400 };
  if (resSeconds < 28 * 86400) return { key: 'weeks', value: resSeconds / (7 * 86400) };
  return { key: 'months', value: resSeconds / (30 * 86400) };
}

/** Same rule as Drawing.visibleFor(), usable for indicators too. */
export function visibleForResolution(v: DrawingVisibility, resSeconds: number, isRange = false): boolean {
  if (isRange) return v.ranges;
  const b = bucketFor(resSeconds);
  const on = v[b.key];
  const from = (v as any)[`${b.key}From`] as number;
  const to = (v as any)[`${b.key}To`] as number;
  return !!on && b.value >= from && b.value <= to;
}

// ---- indicator categories --------------------------------------------------------------------
export const INDICATOR_CATEGORIES = ['Moving Averages', 'Oscillators', 'Trend', 'Volatility', 'Volume', 'Volume Profile', 'Candlestick Patterns', 'Others'] as const;

const CAT_RULES: Array<[RegExp, string]> = [
  [/volume profile|\bvpvr\b|\bvpfr\b|\bvpsv\b|visible range/, 'Volume Profile'],
  [/pattern|doji|engulfing|hammer|harami|marubozu|morning star|evening star|shooting star|three (white|black)|piercing|dark cloud|tweezer|kicking|abandoned|spinning top|hanging man|inverted hammer|belt hold|breakaway|tri-star/, 'Candlestick Patterns'],
  [/moving average|\bma\b|\bema\b|\bsma\b|\bwma\b|\bvwma\b|\bdema\b|\btema\b|\bhma\b|hull|\balma\b|\bmcginley\b|least squares|ribbon|\bvwap\b|\bkama\b|\bt3\b|\bsmma\b|\brma\b/, 'Moving Averages'],
  [/volume|\bobv\b|on balance|money flow|accumulation|chaikin|ease of movement|klinger|price volume|elder.?s force|net volume|\bpvt\b|\bvwap\b/, 'Volume'],
  [/rsi|stoch|macd|momentum|oscillator|\bcci\b|williams|rate of change|\broc\b|awesome|ultimate|\btrix\b|\btsi\b|fisher|relative vigor|coppock|know sure|detrended|\bsmi\b|chande|balance of power|schaff|connors|elder|woodies|\bcmo\b|\bppo\b|relative strength|\brvi\b|\bbbp\b|bull bear|\bkst\b/, 'Oscillators'],
  [/\batr\b|true range|bollinger|keltner|donchian|envelope|volatility|standard deviation|choppiness|historical|mass index|\bband|\bbb\b|\bkc\b|\bdc\b|stop|chandelier/, 'Volatility'],
  [/\badx\b|directional|aroon|ichimoku|parabolic|\bsar\b|supertrend|trend|zig ?zag|pivot|regression|vortex|fractal|median|price channel|alligator|gator|advance|arnaud|correlation|\bdpo\b|\bdmi\b|cloud|linear|hilbert|\bma cross\b|cross|williams %r/, 'Trend'],
];

/** Category for an indicator: explicit `category` when present, else a name-based guess. */
export function categorizeIndicator(def: { id: string; name: string; category?: string }): string {
  if (def.category) return def.category;
  const n = `${def.name} ${def.id}`.toLowerCase();
  for (const [re, cat] of CAT_RULES) if (re.test(n)) return cat;
  return 'Others';
}

// ---- misc ---------------------------------------------------------------------------------------
export const PRICE_SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'] as const;

export const PRECISION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'default', label: 'Default' },
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: n === 0 ? '0 (1)' : `${n} (1/${Math.pow(10, n)})` })),
];

/** Parse a precision select value ("default" | "0".."8") */
export function parsePrecision(v: string): 'default' | number {
  if (v === 'default' || v === '') return 'default';
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(8, n)) : 'default';
}

export function chartTypeLabel(type: string): string {
  const map: Record<string, string> = {
    bars: 'Bars', candles: 'Candles', hollowCandles: 'Hollow candles', volumeCandles: 'Volume candles', line: 'Line', lineWithMarkers: 'Line with markers', stepLine: 'Step line',
    area: 'Area', hlcArea: 'HLC area', baseline: 'Baseline', columns: 'Columns', highLow: 'High-low', heikinAshi: 'Heikin Ashi', renko: 'Renko', lineBreak: 'Line break', kagi: 'Kagi',
    pointAndFigure: 'Point & figure', rangeBars: 'Range',
  };
  return map[type] ?? type;
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

export function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore quota / privacy errors */ }
}

export function removeJson(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/** Simple debounce. */
export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t = 0;
  return ((...args: any[]) => { clearTimeout(t); t = window.setTimeout(() => fn(...args), ms); }) as T;
}
