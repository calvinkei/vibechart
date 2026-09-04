import type { PriceFormat } from '../data/types';

/** Format a price with fixed precision, honoring minMove and fractional formats. */
export function formatPrice(price: number, fmt: PriceFormat): string {
  if (!Number.isFinite(price)) return '∅';
  if (fmt.formatter) return fmt.formatter(price);
  if (fmt.type === 'volume') return formatVolume(price, fmt.precision);
  if (fmt.type === 'percent') return `${price.toFixed(fmt.precision)}%`;
  if (fmt.fractional && fmt.minMove > 0) return formatFractional(price, fmt);
  const prec = Math.max(0, Math.min(20, fmt.precision));
  if (fmt.minMove > 0 && prec > 0) {
    const step = fmt.minMove / Math.pow(10, prec);
    price = Math.round(price / step) * step;
  }
  const s = price.toFixed(prec);
  return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}

function formatFractional(price: number, fmt: PriceFormat): string {
  // e.g. minMove 1, pricescale 32 => 1/32 fractions (treasury bonds)
  const denom = Math.round(1 / (fmt.minMove / Math.pow(10, fmt.precision)));
  const sign = price < 0 ? '-' : '';
  price = Math.abs(price);
  const whole = Math.floor(price);
  const frac = Math.round((price - whole) * denom);
  if (fmt.minMove2 && fmt.minMove2 > 0) {
    const sub = Math.round(((price - whole) * denom - Math.floor((price - whole) * denom)) * fmt.minMove2);
    return `${sign}${whole}'${String(Math.floor((price - whole) * denom)).padStart(String(denom).length - 1, '0')}'${sub}`;
  }
  return `${sign}${whole}'${String(frac).padStart(String(denom).length - 1, '0')}`;
}

/** 1234567 -> "1.23M"; TradingView style volume abbreviations. */
export function formatVolume(v: number, precision = 2): string {
  if (!Number.isFinite(v)) return '∅';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const fmt = (n: number, suffix: string) => {
    let s = n.toFixed(precision);
    if (precision > 0) s = s.replace(/\.?0+$/, '');
    return `${sign}${s}${suffix}`;
  };
  if (abs >= 1e12) return fmt(abs / 1e12, 'T');
  if (abs >= 1e9) return fmt(abs / 1e9, 'B');
  if (abs >= 1e6) return fmt(abs / 1e6, 'M');
  if (abs >= 1e3) return fmt(abs / 1e3, 'K');
  return fmt(abs, '');
}

export function formatPercent(v: number, precision = 2, sign = true): string {
  if (!Number.isFinite(v)) return '∅';
  const s = v.toFixed(precision);
  return `${sign && v > 0 ? '+' : ''}${s}%`;
}

export function formatChange(v: number, fmt: PriceFormat): string {
  const s = formatPrice(Math.abs(v), fmt);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

export function priceFormatFromSymbol(pricescale: number, minmov: number, fractional?: boolean, minmove2?: number): PriceFormat {
  const precision = Math.max(0, Math.round(Math.log10(Math.max(1, pricescale))));
  return { type: 'price', precision, minMove: minmov || 1, fractional, minMove2: minmove2 };
}

/** Number formatting with thousands separators for tables. */
export function formatNumber(v: number, precision = 2): string {
  if (!Number.isFinite(v)) return '∅';
  return v.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

/** Turn a numeric value into a compact label like TradingView's price axis. */
export function formatCompact(v: number, precision: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e6) return formatVolume(v, 2);
  return v.toFixed(precision);
}

/** Format elapsed seconds like "3d 4h", "45m", "2w 3d" (used in measurement tools). */
export function formatDuration(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  const sign = seconds < 0 ? '-' : '';
  const units: Array<[number, string]> = [[31536000, 'y'], [2592000, 'mo'], [604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']];
  const parts: string[] = [];
  let rem = s;
  for (const [u, l] of units) {
    if (rem >= u) {
      const n = Math.floor(rem / u);
      parts.push(`${n}${l}`);
      rem -= n * u;
      if (parts.length === 2) break;
    }
  }
  return sign + (parts.length ? parts.join(' ') : '0s');
}
