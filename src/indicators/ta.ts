/**
 * Technical-analysis primitives mirroring Pine Script's `ta.*` namespace.
 * All functions take/return plain number arrays (NaN = no value), aligned by bar index.
 */

export type Series = ArrayLike<number>;

export function nanArray(n: number): Float64Array {
  const a = new Float64Array(n);
  a.fill(NaN);
  return a;
}

export function isNum(v: number): boolean {
  return v === v && v !== Infinity && v !== -Infinity;
}

export function sma(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (length <= 0) return out;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (isNum(v)) { sum += v; count++; }
    if (i >= length) {
      const old = src[i - length];
      if (isNum(old)) { sum -= old; count--; }
    }
    if (i >= length - 1 && count === length) out[i] = sum / length;
  }
  return out;
}

/** Exponential MA. Pine: alpha = 2/(length+1); first value seeded with SMA of first `length` values. */
export function ema(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (length <= 0) return out;
  const alpha = 2 / (length + 1);
  let prev = NaN;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (!isNum(v)) { continue; }
    if (!isNum(prev)) {
      sum += v; count++;
      if (count === length) { prev = sum / length; out[i] = prev; }
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing (RMA/SMMA). alpha = 1/length; seeded with SMA. */
export function rma(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (length <= 0) return out;
  const alpha = 1 / length;
  let prev = NaN;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (!isNum(v)) continue;
    if (!isNum(prev)) {
      sum += v; count++;
      if (count === length) { prev = sum / length; out[i] = prev; }
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export function wma(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (length <= 0) return out;
  const norm = (length * (length + 1)) / 2;
  for (let i = length - 1; i < n; i++) {
    let sum = 0;
    let ok = true;
    for (let k = 0; k < length; k++) {
      const v = src[i - k];
      if (!isNum(v)) { ok = false; break; }
      sum += v * (length - k);
    }
    if (ok) out[i] = sum / norm;
  }
  return out;
}

export function vwma(src: Series, volume: Series, length: number): Float64Array {
  const n = src.length;
  const pv = new Float64Array(n);
  for (let i = 0; i < n; i++) pv[i] = src[i] * volume[i];
  const a = sma(pv, length);
  const b = sma(volume, length);
  const out = nanArray(n);
  for (let i = 0; i < n; i++) out[i] = a[i] / b[i];
  return out;
}

export function hma(src: Series, length: number): Float64Array {
  const half = wma(src, Math.floor(length / 2));
  const full = wma(src, length);
  const n = src.length;
  const diff = nanArray(n);
  for (let i = 0; i < n; i++) diff[i] = 2 * half[i] - full[i];
  return wma(diff, Math.max(1, Math.floor(Math.sqrt(length))));
}

export function dema(src: Series, length: number): Float64Array {
  const e1 = ema(src, length);
  const e2 = ema(e1, length);
  const out = nanArray(src.length);
  for (let i = 0; i < out.length; i++) out[i] = 2 * e1[i] - e2[i];
  return out;
}

export function tema(src: Series, length: number): Float64Array {
  const e1 = ema(src, length);
  const e2 = ema(e1, length);
  const e3 = ema(e2, length);
  const out = nanArray(src.length);
  for (let i = 0; i < out.length; i++) out[i] = 3 * (e1[i] - e2[i]) + e3[i];
  return out;
}

export function alma(src: Series, length: number, offset = 0.85, sigma = 6): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  const m = offset * (length - 1);
  const s = length / sigma;
  const w = new Float64Array(length);
  let norm = 0;
  for (let k = 0; k < length; k++) {
    w[k] = Math.exp(-((k - m) * (k - m)) / (2 * s * s));
    norm += w[k];
  }
  for (let i = length - 1; i < n; i++) {
    let sum = 0;
    let ok = true;
    for (let k = 0; k < length; k++) {
      const v = src[i - length + 1 + k];
      if (!isNum(v)) { ok = false; break; }
      sum += v * w[k];
    }
    if (ok) out[i] = sum / norm;
  }
  return out;
}

/** Symmetrically weighted MA (Pine ta.swma): weights 1/6, 2/6, 2/6, 1/6 */
export function swma(src: Series): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  for (let i = 3; i < n; i++) {
    out[i] = src[i - 3] / 6 + (src[i - 2] * 2) / 6 + (src[i - 1] * 2) / 6 + src[i] / 6;
  }
  return out;
}

/** Linear regression value (LSMA) at each bar: Pine ta.linreg(src, length, offset). */
export function linreg(src: Series, length: number, offset = 0): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (length <= 1) return out;
  const sumX = (length * (length - 1)) / 2;
  const sumXX = ((length - 1) * length * (2 * length - 1)) / 6;
  for (let i = length - 1; i < n; i++) {
    let sumY = 0;
    let sumXY = 0;
    let ok = true;
    for (let k = 0; k < length; k++) {
      const v = src[i - length + 1 + k];
      if (!isNum(v)) { ok = false; break; }
      sumY += v;
      sumXY += k * v;
    }
    if (!ok) continue;
    const slope = (length * sumXY - sumX * sumY) / (length * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / length;
    out[i] = intercept + slope * (length - 1 - offset);
  }
  return out;
}

export function linregSlope(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  const sumX = (length * (length - 1)) / 2;
  const sumXX = ((length - 1) * length * (2 * length - 1)) / 6;
  for (let i = length - 1; i < n; i++) {
    let sumY = 0, sumXY = 0, ok = true;
    for (let k = 0; k < length; k++) {
      const v = src[i - length + 1 + k];
      if (!isNum(v)) { ok = false; break; }
      sumY += v; sumXY += k * v;
    }
    if (ok) out[i] = (length * sumXY - sumX * sumY) / (length * sumXX - sumX * sumX);
  }
  return out;
}

export function stdev(src: Series, length: number, biased = true): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  const avg = sma(src, length);
  for (let i = length - 1; i < n; i++) {
    if (!isNum(avg[i])) continue;
    let sum = 0;
    let ok = true;
    for (let k = 0; k < length; k++) {
      const v = src[i - k];
      if (!isNum(v)) { ok = false; break; }
      const d = v - avg[i];
      sum += d * d;
    }
    if (ok) out[i] = Math.sqrt(sum / (biased ? length : length - 1));
  }
  return out;
}

export function variance(src: Series, length: number, biased = true): Float64Array {
  const s = stdev(src, length, biased);
  const out = nanArray(src.length);
  for (let i = 0; i < out.length; i++) out[i] = s[i] * s[i];
  return out;
}

/** Mean absolute deviation (Pine ta.dev). */
export function dev(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  const avg = sma(src, length);
  for (let i = length - 1; i < n; i++) {
    if (!isNum(avg[i])) continue;
    let sum = 0;
    for (let k = 0; k < length; k++) sum += Math.abs(src[i - k] - avg[i]);
    out[i] = sum / length;
  }
  return out;
}

export function highest(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  for (let i = length - 1; i < n; i++) {
    let m = -Infinity;
    for (let k = 0; k < length; k++) { const v = src[i - k]; if (isNum(v) && v > m) m = v; }
    if (m !== -Infinity) out[i] = m;
  }
  return out;
}

export function lowest(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  for (let i = length - 1; i < n; i++) {
    let m = Infinity;
    for (let k = 0; k < length; k++) { const v = src[i - k]; if (isNum(v) && v < m) m = v; }
    if (m !== Infinity) out[i] = m;
  }
  return out;
}

/** Bars back to highest value (0 = current bar). */
export function highestBars(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  for (let i = length - 1; i < n; i++) {
    let m = -Infinity, mi = 0;
    for (let k = 0; k < length; k++) { const v = src[i - k]; if (isNum(v) && v > m) { m = v; mi = k; } }
    out[i] = -mi;
  }
  return out;
}

export function lowestBars(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  for (let i = length - 1; i < n; i++) {
    let m = Infinity, mi = 0;
    for (let k = 0; k < length; k++) { const v = src[i - k]; if (isNum(v) && v < m) { m = v; mi = k; } }
    out[i] = -mi;
  }
  return out;
}

export function change(src: Series, length = 1): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  for (let i = length; i < n; i++) out[i] = src[i] - src[i - length];
  return out;
}

export function mom(src: Series, length: number): Float64Array { return change(src, length); }

export function roc(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  for (let i = length; i < n; i++) out[i] = ((src[i] - src[i - length]) / src[i - length]) * 100;
  return out;
}

export function cum(src: Series): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  let s = 0;
  for (let i = 0; i < n; i++) { if (isNum(src[i])) s += src[i]; out[i] = s; }
  return out;
}

export function tr(high: Series, low: Series, close: Series, handleNa = true): Float64Array {
  const n = high.length;
  const out = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) { out[i] = handleNa ? high[i] - low[i] : NaN; continue; }
    const pc = close[i - 1];
    out[i] = Math.max(high[i] - low[i], Math.abs(high[i] - pc), Math.abs(low[i] - pc));
  }
  return out;
}

export function atr(high: Series, low: Series, close: Series, length: number): Float64Array {
  return rma(tr(high, low, close, true), length);
}

export function rsi(src: Series, length: number): Float64Array {
  const n = src.length;
  const up = nanArray(n);
  const down = nanArray(n);
  for (let i = 1; i < n; i++) {
    const d = src[i] - src[i - 1];
    up[i] = Math.max(d, 0);
    down[i] = Math.max(-d, 0);
  }
  const u = rma(up, length);
  const d = rma(down, length);
  const out = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (!isNum(u[i]) || !isNum(d[i])) continue;
    out[i] = d[i] === 0 ? 100 : u[i] === 0 ? 0 : 100 - 100 / (1 + u[i] / d[i]);
  }
  return out;
}

export function stoch(src: Series, high: Series, low: Series, length: number): Float64Array {
  const hh = highest(high, length);
  const ll = lowest(low, length);
  const n = src.length;
  const out = nanArray(n);
  for (let i = 0; i < n; i++) {
    const den = hh[i] - ll[i];
    if (!isNum(hh[i]) || !isNum(ll[i])) continue;
    out[i] = den === 0 ? 0 : (100 * (src[i] - ll[i])) / den;
  }
  return out;
}

export function cci(src: Series, length: number): Float64Array {
  const ma = sma(src, length);
  const md = dev(src, length);
  const n = src.length;
  const out = nanArray(n);
  for (let i = 0; i < n; i++) if (isNum(ma[i]) && md[i] !== 0) out[i] = (src[i] - ma[i]) / (0.015 * md[i]);
  return out;
}

export function mfi(hlc3: Series, volume: Series, length: number): Float64Array {
  const n = hlc3.length;
  const pos = nanArray(n), neg = nanArray(n);
  for (let i = 1; i < n; i++) {
    const d = hlc3[i] - hlc3[i - 1];
    pos[i] = d > 0 ? volume[i] * hlc3[i] : 0;
    neg[i] = d < 0 ? volume[i] * hlc3[i] : 0;
  }
  const p = sum(pos, length);
  const q = sum(neg, length);
  const out = nanArray(n);
  for (let i = 0; i < n; i++) if (isNum(p[i]) && isNum(q[i])) out[i] = 100 - 100 / (1 + p[i] / (q[i] || 1e-12));
  return out;
}

export function sum(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  let s = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (isNum(src[i])) { s += src[i]; count++; }
    if (i >= length && isNum(src[i - length])) { s -= src[i - length]; count--; }
    if (i >= length - 1 && count === length) out[i] = s;
  }
  return out;
}

export function cmo(src: Series, length: number): Float64Array {
  const n = src.length;
  const up = nanArray(n), dn = nanArray(n);
  for (let i = 1; i < n; i++) { const d = src[i] - src[i - 1]; up[i] = d > 0 ? d : 0; dn[i] = d < 0 ? -d : 0; }
  const su = sum(up, length), sd = sum(dn, length);
  const out = nanArray(n);
  for (let i = 0; i < n; i++) if (isNum(su[i])) out[i] = (100 * (su[i] - sd[i])) / ((su[i] + sd[i]) || 1e-12);
  return out;
}

export function wpr(high: Series, low: Series, close: Series, length: number): Float64Array {
  const hh = highest(high, length), ll = lowest(low, length);
  const n = close.length;
  const out = nanArray(n);
  for (let i = 0; i < n; i++) if (isNum(hh[i])) out[i] = ((hh[i] - close[i]) / ((hh[i] - ll[i]) || 1e-12)) * -100;
  return out;
}

export function tsi(src: Series, shortLen: number, longLen: number): Float64Array {
  const n = src.length;
  const pc = change(src, 1);
  const apc = nanArray(n);
  for (let i = 0; i < n; i++) apc[i] = Math.abs(pc[i]);
  const ds = ema(ema(pc, longLen), shortLen);
  const dsa = ema(ema(apc, longLen), shortLen);
  const out = nanArray(n);
  for (let i = 0; i < n; i++) if (isNum(ds[i]) && dsa[i] !== 0) out[i] = (100 * ds[i]) / dsa[i];
  return out;
}

export function cog(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  for (let i = length - 1; i < n; i++) {
    let num = 0, den = 0;
    for (let k = 0; k < length; k++) { num += src[i - k] * (k + 1); den += src[i - k]; }
    out[i] = den === 0 ? NaN : -num / den;
  }
  return out;
}

export function percentrank(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  for (let i = length; i < n; i++) {
    let c = 0;
    for (let k = 1; k <= length; k++) if (src[i - k] <= src[i]) c++;
    out[i] = (c / length) * 100;
  }
  return out;
}

export function correlation(a: Series, b: Series, length: number): Float64Array {
  const n = a.length;
  const out = nanArray(n);
  for (let i = length - 1; i < n; i++) {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    let ok = true;
    for (let k = 0; k < length; k++) {
      const x = a[i - k], y = b[i - k];
      if (!isNum(x) || !isNum(y)) { ok = false; break; }
      sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
    }
    if (!ok) continue;
    const cov = sab / length - (sa / length) * (sb / length);
    const va = saa / length - (sa / length) ** 2;
    const vb = sbb / length - (sb / length) ** 2;
    out[i] = cov / Math.sqrt(va * vb);
  }
  return out;
}

export function crossover(a: Series, b: Series): Uint8Array {
  const n = a.length;
  const out = new Uint8Array(n);
  for (let i = 1; i < n; i++) out[i] = a[i] > b[i] && a[i - 1] <= b[i - 1] ? 1 : 0;
  return out;
}

export function crossunder(a: Series, b: Series): Uint8Array {
  const n = a.length;
  const out = new Uint8Array(n);
  for (let i = 1; i < n; i++) out[i] = a[i] < b[i] && a[i - 1] >= b[i - 1] ? 1 : 0;
  return out;
}

export function pivotHigh(src: Series, left: number, right: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  for (let i = left; i < n - right; i++) {
    const v = src[i];
    let ok = isNum(v);
    for (let k = 1; k <= left && ok; k++) if (!(src[i - k] < v)) ok = false;
    for (let k = 1; k <= right && ok; k++) if (!(src[i + k] < v)) ok = false;
    // Pine's pivothigh: strict on left (>=?) — Pine uses: left bars must be lower, right bars must be lower (strict)
    if (ok) out[i + right] = v; // value becomes known `right` bars later
  }
  return out;
}

export function pivotLow(src: Series, left: number, right: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  for (let i = left; i < n - right; i++) {
    const v = src[i];
    let ok = isNum(v);
    for (let k = 1; k <= left && ok; k++) if (!(src[i - k] > v)) ok = false;
    for (let k = 1; k <= right && ok; k++) if (!(src[i + k] > v)) ok = false;
    if (ok) out[i + right] = v;
  }
  return out;
}

export function sar(high: Series, low: Series, close: Series, start = 0.02, inc = 0.02, max = 0.2): Float64Array {
  const n = high.length;
  const out = nanArray(n);
  if (n < 2) return out;
  let isLong = close[1] >= close[0];
  let af = start;
  let ep = isLong ? high[1] : low[1];
  let psar = isLong ? Math.min(low[0], low[1]) : Math.max(high[0], high[1]);
  out[1] = psar;
  for (let i = 2; i < n; i++) {
    psar = psar + af * (ep - psar);
    if (isLong) {
      psar = Math.min(psar, low[i - 1], low[i - 2]);
      if (high[i] > ep) { ep = high[i]; af = Math.min(af + inc, max); }
      if (low[i] < psar) { isLong = false; psar = ep; ep = low[i]; af = start; }
    } else {
      psar = Math.max(psar, high[i - 1], high[i - 2]);
      if (low[i] < ep) { ep = low[i]; af = Math.min(af + inc, max); }
      if (high[i] > psar) { isLong = true; psar = ep; ep = high[i]; af = start; }
    }
    out[i] = psar;
  }
  return out;
}

export function supertrend(high: Series, low: Series, close: Series, factor: number, atrLen: number): { line: Float64Array; direction: Int8Array } {
  const n = close.length;
  const a = atr(high, low, close, atrLen);
  const line = nanArray(n);
  const direction = new Int8Array(n);
  let prevUpper = NaN, prevLower = NaN, prevDir = 1, prevST = NaN;
  for (let i = 0; i < n; i++) {
    if (!isNum(a[i])) continue;
    const hl2 = (high[i] + low[i]) / 2;
    let upper = hl2 + factor * a[i];
    let lower = hl2 - factor * a[i];
    if (isNum(prevLower) && (lower > prevLower || close[i - 1] < prevLower)) { /* keep */ } else if (isNum(prevLower)) lower = prevLower;
    if (isNum(prevUpper) && (upper < prevUpper || close[i - 1] > prevUpper)) { /* keep */ } else if (isNum(prevUpper)) upper = prevUpper;
    let dir: number;
    if (!isNum(prevST)) dir = 1;
    else if (prevST === prevUpper) dir = close[i] > upper ? -1 : 1;
    else dir = close[i] < lower ? 1 : -1;
    const st = dir === -1 ? lower : upper;
    line[i] = st;
    direction[i] = dir;
    prevUpper = upper; prevLower = lower; prevST = st; prevDir = dir;
  }
  void prevDir;
  return { line, direction };
}

export function dmi(high: Series, low: Series, close: Series, diLen: number, adxLen: number): { plus: Float64Array; minus: Float64Array; adx: Float64Array } {
  const n = high.length;
  const up = nanArray(n), dn = nanArray(n);
  for (let i = 1; i < n; i++) {
    const u = high[i] - high[i - 1];
    const d = low[i - 1] - low[i];
    up[i] = u > d && u > 0 ? u : 0;
    dn[i] = d > u && d > 0 ? d : 0;
  }
  const trur = rma(tr(high, low, close, true), diLen);
  const plus = nanArray(n), minus = nanArray(n);
  const pu = rma(up, diLen), pd = rma(dn, diLen);
  for (let i = 0; i < n; i++) {
    if (!isNum(trur[i]) || trur[i] === 0) continue;
    plus[i] = (100 * pu[i]) / trur[i];
    minus[i] = (100 * pd[i]) / trur[i];
  }
  const dx = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (!isNum(plus[i])) continue;
    const s = plus[i] + minus[i];
    dx[i] = s === 0 ? 0 : (100 * Math.abs(plus[i] - minus[i])) / s;
  }
  return { plus, minus, adx: rma(dx, adxLen) };
}

export function bb(src: Series, length: number, mult: number): { basis: Float64Array; upper: Float64Array; lower: Float64Array } {
  const basis = sma(src, length);
  const sd = stdev(src, length);
  const n = src.length;
  const upper = nanArray(n), lower = nanArray(n);
  for (let i = 0; i < n; i++) { upper[i] = basis[i] + mult * sd[i]; lower[i] = basis[i] - mult * sd[i]; }
  return { basis, upper, lower };
}

export function kc(src: Series, high: Series, low: Series, close: Series, length: number, mult: number, useTrueRange = true): { basis: Float64Array; upper: Float64Array; lower: Float64Array } {
  const basis = ema(src, length);
  const n = src.length;
  const range = nanArray(n);
  if (useTrueRange) { const t = tr(high, low, close, true); for (let i = 0; i < n; i++) range[i] = t[i]; }
  else for (let i = 0; i < n; i++) range[i] = high[i] - low[i];
  const rm = ema(range, length);
  const upper = nanArray(n), lower = nanArray(n);
  for (let i = 0; i < n; i++) { upper[i] = basis[i] + mult * rm[i]; lower[i] = basis[i] - mult * rm[i]; }
  return { basis, upper, lower };
}

export function macd(src: Series, fast: number, slow: number, signal: number, maType: 'EMA' | 'SMA' = 'EMA', sigType: 'EMA' | 'SMA' = 'EMA'): { macd: Float64Array; signal: Float64Array; hist: Float64Array } {
  const f = maType === 'EMA' ? ema(src, fast) : sma(src, fast);
  const s = maType === 'EMA' ? ema(src, slow) : sma(src, slow);
  const n = src.length;
  const m = nanArray(n);
  for (let i = 0; i < n; i++) m[i] = f[i] - s[i];
  const sig = sigType === 'EMA' ? ema(m, signal) : sma(m, signal);
  const hist = nanArray(n);
  for (let i = 0; i < n; i++) hist[i] = m[i] - sig[i];
  return { macd: m, signal: sig, hist };
}

export function obv(close: Series, volume: Series): Float64Array {
  const n = close.length;
  const out = nanArray(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) { const d = close[i] - close[i - 1]; s += d > 0 ? volume[i] : d < 0 ? -volume[i] : 0; }
    out[i] = s;
  }
  return out;
}

export function accdist(high: Series, low: Series, close: Series, volume: Series): Float64Array {
  const n = close.length;
  const out = nanArray(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const hl = high[i] - low[i];
    const mfm = hl === 0 ? 0 : ((close[i] - low[i]) - (high[i] - close[i])) / hl;
    s += mfm * volume[i];
    out[i] = s;
  }
  return out;
}

export function pvt(close: Series, volume: Series): Float64Array {
  const n = close.length;
  const out = nanArray(n);
  let s = 0;
  for (let i = 1; i < n; i++) { s += ((close[i] - close[i - 1]) / close[i - 1]) * volume[i]; out[i] = s; }
  out[0] = 0;
  return out;
}

export function vwap(hlc3: Series, volume: Series, newPeriod: Uint8Array | ((i: number) => boolean)): Float64Array {
  const n = hlc3.length;
  const out = nanArray(n);
  let spv = 0, sv = 0;
  for (let i = 0; i < n; i++) {
    const np = typeof newPeriod === 'function' ? newPeriod(i) : newPeriod[i] === 1;
    if (np) { spv = 0; sv = 0; }
    const v = isNum(volume[i]) ? volume[i] : 0;
    spv += hlc3[i] * v;
    sv += v;
    out[i] = sv === 0 ? NaN : spv / sv;
  }
  return out;
}

export function median(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  const buf: number[] = [];
  for (let i = length - 1; i < n; i++) {
    buf.length = 0;
    for (let k = 0; k < length; k++) buf.push(src[i - k]);
    buf.sort((a, b) => a - b);
    const mid = length >> 1;
    out[i] = length % 2 ? buf[mid] : (buf[mid - 1] + buf[mid]) / 2;
  }
  return out;
}

export function percentileNearestRank(src: Series, length: number, pct: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  const buf: number[] = [];
  for (let i = length - 1; i < n; i++) {
    buf.length = 0;
    for (let k = 0; k < length; k++) buf.push(src[i - k]);
    buf.sort((a, b) => a - b);
    const rank = Math.max(1, Math.ceil((pct / 100) * length));
    out[i] = buf[rank - 1];
  }
  return out;
}

export function percentileLinear(src: Series, length: number, pct: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  const buf: number[] = [];
  for (let i = length - 1; i < n; i++) {
    buf.length = 0;
    for (let k = 0; k < length; k++) buf.push(src[i - k]);
    buf.sort((a, b) => a - b);
    const r = (pct / 100) * (length - 1);
    const lo = Math.floor(r), hi = Math.ceil(r);
    out[i] = buf[lo] + (buf[hi] - buf[lo]) * (r - lo);
  }
  return out;
}

export function barssince(cond: ArrayLike<number | boolean>): Float64Array {
  const n = cond.length;
  const out = nanArray(n);
  let last = -1;
  for (let i = 0; i < n; i++) { if (cond[i]) last = i; out[i] = last < 0 ? NaN : i - last; }
  return out;
}

export function valuewhen(cond: ArrayLike<number | boolean>, src: Series, occurrence = 0): Float64Array {
  const n = cond.length;
  const out = nanArray(n);
  const hist: number[] = [];
  for (let i = 0; i < n; i++) {
    if (cond[i]) hist.push(src[i]);
    const idx = hist.length - 1 - occurrence;
    out[i] = idx >= 0 ? hist[idx] : NaN;
  }
  return out;
}

export function nz(v: number, replacement = 0): number { return isNum(v) ? v : replacement; }

export function maByType(type: string, src: Series, length: number, volume?: Series): Float64Array {
  switch ((type || 'SMA').toUpperCase()) {
    case 'EMA': return ema(src, length);
    case 'SMMA': case 'RMA': case 'SMMA (RMA)': return rma(src, length);
    case 'WMA': return wma(src, length);
    case 'VWMA': return volume ? vwma(src, volume, length) : sma(src, length);
    case 'HMA': return hma(src, length);
    case 'DEMA': return dema(src, length);
    case 'TEMA': return tema(src, length);
    case 'LSMA': return linreg(src, length, 0);
    case 'ALMA': return alma(src, length);
    default: return sma(src, length);
  }
}

export const MA_TYPES = ['SMA', 'EMA', 'SMMA (RMA)', 'WMA', 'VWMA'];
export const MA_TYPES_EXT = ['SMA', 'EMA', 'SMMA (RMA)', 'WMA', 'VWMA', 'HMA', 'DEMA', 'TEMA', 'LSMA', 'ALMA'];
