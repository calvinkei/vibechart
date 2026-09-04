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

// ---- oscillator agent additions ----

/** Strict highest: NaN when any value in the window is NaN (use for derived series such as RSI). */
export function highestNa(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (length <= 0) return out;
  for (let i = length - 1; i < n; i++) {
    let m = -Infinity, ok = true;
    for (let k = 0; k < length; k++) { const v = src[i - k]; if (!isNum(v)) { ok = false; break; } if (v > m) m = v; }
    if (ok) out[i] = m;
  }
  return out;
}

/** Strict lowest: NaN when any value in the window is NaN. */
export function lowestNa(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (length <= 0) return out;
  for (let i = length - 1; i < n; i++) {
    let m = Infinity, ok = true;
    for (let k = 0; k < length; k++) { const v = src[i - k]; if (!isNum(v)) { ok = false; break; } if (v < m) m = v; }
    if (ok) out[i] = m;
  }
  return out;
}

/** Stochastic with NaN-propagating windows (Pine semantics when the source itself has a warm-up, e.g. Stochastic RSI). */
export function stochNa(src: Series, high: Series, low: Series, length: number): Float64Array {
  const hh = highestNa(high, length);
  const ll = lowestNa(low, length);
  const n = src.length;
  const out = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (!isNum(hh[i]) || !isNum(ll[i]) || !isNum(src[i])) continue;
    const den = hh[i] - ll[i];
    out[i] = den === 0 ? 0 : (100 * (src[i] - ll[i])) / den;
  }
  return out;
}

/** Percent rank with Pine NaN semantics: NaN when the current value or any of the previous `length` values is NaN. */
export function percentrankNa(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (length <= 0) return out;
  for (let i = length; i < n; i++) {
    const v = src[i];
    if (!isNum(v)) continue;
    let c = 0, ok = true;
    for (let k = 1; k <= length; k++) { const p = src[i - k]; if (!isNum(p)) { ok = false; break; } if (p <= v) c++; }
    if (ok) out[i] = (100 * c) / length;
  }
  return out;
}

/**
 * Rank Correlation Index: Spearman rank correlation between price rank (ascending, ties get the average rank)
 * and bar order over `length` bars, x100. Computed as the Pearson correlation of the two rank vectors.
 */
export function rci(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (length < 2) return out;
  const order: number[] = new Array(length);
  const rank = new Float64Array(length);
  const mean = (length + 1) / 2;
  let sumTT = 0;
  for (let k = 0; k < length; k++) sumTT += (k + 1 - mean) * (k + 1 - mean);
  for (let i = length - 1; i < n; i++) {
    const base = i - length + 1;
    let ok = true;
    for (let k = 0; k < length; k++) { if (!isNum(src[base + k])) { ok = false; break; } order[k] = k; }
    if (!ok) continue;
    order.sort((a, b) => src[base + a] - src[base + b]);
    let p = 0;
    while (p < length) {
      let q = p;
      while (q + 1 < length && src[base + order[q + 1]] === src[base + order[p]]) q++;
      const r = (p + q) / 2 + 1;
      for (let t = p; t <= q; t++) rank[order[t]] = r;
      p = q + 1;
    }
    let sumRT = 0, sumRR = 0;
    for (let k = 0; k < length; k++) {
      const dr = rank[k] - mean, dt = k + 1 - mean;
      sumRT += dr * dt; sumRR += dr * dr;
    }
    out[i] = sumRR === 0 ? 0 : (100 * sumRT) / Math.sqrt(sumRR * sumTT);
  }
  return out;
}

/** Williams' Ultimate Oscillator (7/14/28 by default), 0..100. */
export function ultimateOsc(high: Series, low: Series, close: Series, fast: number, mid: number, slow: number): Float64Array {
  const n = close.length;
  const bp = nanArray(n), trr = nanArray(n);
  for (let i = 1; i < n; i++) {
    const pc = close[i - 1];
    const h = Math.max(high[i], pc), l = Math.min(low[i], pc);
    bp[i] = close[i] - l;
    trr[i] = h - l;
  }
  const b1 = sum(bp, fast), t1 = sum(trr, fast);
  const b2 = sum(bp, mid), t2 = sum(trr, mid);
  const b3 = sum(bp, slow), t3 = sum(trr, slow);
  const out = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (!isNum(b1[i]) || !isNum(b2[i]) || !isNum(b3[i])) continue;
    if (t1[i] === 0 || t2[i] === 0 || t3[i] === 0) continue;
    out[i] = (100 * (4 * (b1[i] / t1[i]) + 2 * (b2[i] / t2[i]) + b3[i] / t3[i])) / 7;
  }
  return out;
}

/** Ehlers Fisher Transform as in the TradingView built-in (value/fish1 recursions with nz seeding). */
export function fisher(src: Series, length: number): { fisher: Float64Array; trigger: Float64Array } {
  const n = src.length;
  const hh = highestNa(src, length), ll = lowestNa(src, length);
  const fish = nanArray(n), trig = nanArray(n);
  let prevValue = NaN, prevFish = NaN;
  for (let i = 0; i < n; i++) {
    let value = NaN;
    if (isNum(hh[i]) && isNum(ll[i])) {
      const ratio = (src[i] - ll[i]) / (hh[i] - ll[i]);
      value = 0.66 * (ratio - 0.5) + 0.67 * (isNum(prevValue) ? prevValue : 0);
      if (value > 0.99) value = 0.999; else if (value < -0.99) value = -0.999;
    }
    let f = NaN;
    if (isNum(value)) f = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * (isNum(prevFish) ? prevFish : 0);
    fish[i] = f;
    if (i > 0) trig[i] = fish[i - 1];
    prevValue = value; prevFish = f;
  }
  return { fisher: fish, trigger: trig };
}

/** Blau's Stochastic Momentum Index: 200 * EMA(EMA(close - mid, d), d) / EMA(EMA(range, d), d), plus its EMA. */
export function smi(high: Series, low: Series, close: Series, kLen: number, dLen: number, emaLen: number): { smi: Float64Array; ema: Float64Array } {
  const n = close.length;
  const hh = highest(high, kLen), ll = lowest(low, kLen);
  const rel = nanArray(n), range = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (!isNum(hh[i]) || !isNum(ll[i])) continue;
    range[i] = hh[i] - ll[i];
    rel[i] = close[i] - (hh[i] + ll[i]) / 2;
  }
  const num = ema(ema(rel, dLen), dLen);
  const den = ema(ema(range, dLen), dLen);
  const out = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (!isNum(num[i]) || !isNum(den[i])) continue;
    out[i] = den[i] === 0 ? 0 : (200 * num[i]) / den[i];
  }
  return { smi: out, ema: ema(out, emaLen) };
}

/** Connors RSI up/down streak: +k after k consecutive rises, -k after k consecutive falls, 0 on an unchanged bar. */
export function updownStreak(src: Series): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const s = src[i], p = i > 0 ? src[i - 1] : NaN;
    const isEqual = s === p;
    const isGrowing = s > p;
    const ud = isEqual ? 0 : isGrowing ? (prev <= 0 ? 1 : prev + 1) : (prev >= 0 ? -1 : prev - 1);
    out[i] = ud;
    prev = ud;
  }
  return out;
}

/** EMA with an explicit alpha seeded from 0 (Pine `e := nz(e[1]) + alpha * (s - nz(e[1]))`), used by the Price Momentum Oscillator. */
export function emaAlphaNz(src: Series, alpha: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    const p = isNum(prev) ? prev : 0;
    const e = p + alpha * (src[i] - p);
    out[i] = e;
    prev = e;
  }
  return out;
}

// ---- volume agent additions ----

/**
 * VWAP plus the volume-weighted standard deviation Pine's `ta.vwap(src, anchor, mult)` reports:
 * variance = Σ(v·src²)/Σv − vwap². `newPeriod` resets the accumulators (index 0 should be a new period).
 */
export function vwapStdev(src: Series, volume: Series, newPeriod: Uint8Array | ((i: number) => boolean)): { vwap: Float64Array; stdev: Float64Array } {
  const n = src.length;
  const vw = nanArray(n), sd = nanArray(n);
  let sv = 0, spv = 0, sppv = 0;
  for (let i = 0; i < n; i++) {
    const np = typeof newPeriod === 'function' ? newPeriod(i) : newPeriod[i] === 1;
    if (np) { sv = 0; spv = 0; sppv = 0; }
    const s = src[i];
    if (!isNum(s)) continue;
    const v = isNum(volume[i]) ? volume[i] : 0;
    sv += v; spv += s * v; sppv += s * s * v;
    if (sv === 0) continue;
    const m = spv / sv;
    vw[i] = m;
    sd[i] = Math.sqrt(Math.max(sppv / sv - m * m, 0));
  }
  return { vwap: vw, stdev: sd };
}

/** Ultimate Oscillator (Pine built-in): 100·(4·avg7 + 2·avg14 + avg28)/7 with avg = Σbp/Σtr. */
export function ultimateOscillatorVol(high: Series, low: Series, close: Series, fast = 7, mid = 14, slow = 28): Float64Array {
  const n = close.length;
  const bp = nanArray(n), trr = nanArray(n);
  for (let i = 0; i < n; i++) {
    const pc = i > 0 ? close[i - 1] : NaN;
    const h = isNum(pc) ? Math.max(high[i], pc) : high[i];
    const l = isNum(pc) ? Math.min(low[i], pc) : low[i];
    bp[i] = close[i] - l;
    trr[i] = h - l;
  }
  const a1 = sum(bp, fast), t1 = sum(trr, fast), a2 = sum(bp, mid), t2 = sum(trr, mid), a3 = sum(bp, slow), t3 = sum(trr, slow);
  const out = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (!isNum(a3[i]) || t1[i] === 0 || t2[i] === 0 || t3[i] === 0) continue;
    out[i] = (100 * (4 * (a1[i] / t1[i]) + 2 * (a2[i] / t2[i]) + a3[i] / t3[i])) / 7;
  }
  return out;
}

/** Ichimoku lines, unshifted (conversion, base, leading span A/B computed on the current bar). */
export function ichimokuLines(high: Series, low: Series, conv = 9, base = 26, span = 52): { conversion: Float64Array; base: Float64Array; leadA: Float64Array; leadB: Float64Array } {
  const n = high.length;
  const donchian = (len: number) => {
    const hh = highest(high, len), ll = lowest(low, len);
    const o = nanArray(n);
    for (let i = 0; i < n; i++) o[i] = (hh[i] + ll[i]) / 2;
    return o;
  };
  const c = donchian(conv), b = donchian(base), lb = donchian(span);
  const la = nanArray(n);
  for (let i = 0; i < n; i++) la[i] = (c[i] + b[i]) / 2;
  return { conversion: c, base: b, leadA: la, leadB: lb };
}

/**
 * For each bar i, the index of the first bar whose time is > time[i] − windowSec (two-pointer, O(n)).
 * If fewer than `minBars` bars fall in the window the window is widened to `minBars` bars.
 */
export function timeWindowStart(time: Series, windowSec: number, minBars = 1): Int32Array {
  const n = time.length;
  const out = new Int32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const lim = time[i] - windowSec;
    while (j < i && time[j] <= lim) j++;
    let s = j;
    if (i - s + 1 < minBars) s = Math.max(0, i - minBars + 1);
    out[i] = s;
  }
  return out;
}

/** Rolling sum over the variable window [start[i], i] (prefix sums; NaN counts as 0). */
export function windowSum(src: Series, start: Int32Array): Float64Array {
  const n = src.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + (isNum(src[i]) ? src[i] : 0);
  const out = nanArray(n);
  for (let i = 0; i < n; i++) out[i] = pre[i + 1] - pre[start[i]];
  return out;
}

/**
 * Bar polarity used by Volume Delta / CVD / Up-Down Volume when no lower-timeframe data is available:
 * close > open → +1, close < open → −1; on a tie compare with the previous close; still tied → inherit
 * the previous bar's polarity (+1 on the very first bar).
 */
export function barPolarity(open: Series, close: Series): Int8Array {
  const n = open.length;
  const out = new Int8Array(n);
  let prev = 1;
  for (let i = 0; i < n; i++) {
    let p: number;
    if (close[i] > open[i]) p = 1;
    else if (close[i] < open[i]) p = -1;
    else if (i > 0 && close[i] > close[i - 1]) p = 1;
    else if (i > 0 && close[i] < close[i - 1]) p = -1;
    else p = prev;
    out[i] = p;
    prev = p;
  }
  return out;
}

/** Shift a series `k` bars to the right (k > 0) or left (k < 0); vacated slots are NaN. */
export function shift(src: Series, k: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  for (let i = 0; i < n; i++) {
    const j = i - k;
    if (j >= 0 && j < n) out[i] = src[j];
  }
  return out;
}

// ---- trend agent additions ----

/** Carry the last non-NaN value forward (Pine `fixnan`). Leading NaNs stay NaN. */
export function fixnan(src: Series): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  let last = NaN;
  for (let i = 0; i < n; i++) { const v = src[i]; if (isNum(v)) last = v; out[i] = last; }
  return out;
}

/** Shift a series by `offset` bars (positive = later / to the right, like Pine `plot(offset=)`). Values pushed past either end are dropped; vacated slots are NaN. */
export function shiftSeriesTrend(src: Series, offset: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (!offset) { for (let i = 0; i < n; i++) out[i] = src[i]; return out; }
  for (let i = 0; i < n; i++) { const j = i + offset; if (j >= 0 && j < n) out[j] = src[i]; }
  return out;
}

/** Aroon Up/Down (0..100): `100 * (highestbars(high, length+1) + length) / length` and the same with lowestbars(low). */
export function aroon(high: Series, low: Series, length: number): { up: Float64Array; down: Float64Array } {
  const n = high.length;
  const up = nanArray(n), down = nanArray(n);
  if (length <= 0) return { up, down };
  const hb = highestBars(high, length + 1), lb = lowestBars(low, length + 1);
  for (let i = 0; i < n; i++) {
    if (isNum(hb[i])) up[i] = (100 * (hb[i] + length)) / length;
    if (isNum(lb[i])) down[i] = (100 * (lb[i] + length)) / length;
  }
  return { up, down };
}

/** Hamming-window weighted MA: w_i = 0.54 - 0.46*cos(2*pi*i/(length-1)), i = 0 (oldest) .. length-1 (newest). */
export function hamming(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (length <= 0) return out;
  if (length === 1) { for (let i = 0; i < n; i++) out[i] = src[i]; return out; }
  const w = new Float64Array(length);
  let norm = 0;
  for (let k = 0; k < length; k++) { w[k] = 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (length - 1)); norm += w[k]; }
  for (let i = length - 1; i < n; i++) {
    let s = 0, ok = true;
    for (let k = 0; k < length; k++) { const v = src[i - length + 1 + k]; if (!isNum(v)) { ok = false; break; } s += v * w[k]; }
    if (ok) out[i] = s / norm;
  }
  return out;
}

/** Kaufman's Adaptive Moving Average (TradingView formula): ER over `erLen`, fast/slow smoothing constants, seeded with the first source value (`nz(kama[1], src)`). */
export function kama(src: Series, erLen: number, fastLen: number, slowLen: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (erLen <= 0) return out;
  const fastSC = 2 / (fastLen + 1), slowSC = 2 / (slowLen + 1);
  const absChange = nanArray(n);
  for (let i = 1; i < n; i++) absChange[i] = Math.abs(src[i] - src[i - 1]);
  const vol = sum(absChange, erLen);
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (!isNum(v)) continue;
    const change = i >= erLen ? Math.abs(v - src[i - erLen]) : NaN;
    const er = isNum(vol[i]) && vol[i] !== 0 && isNum(change) ? change / vol[i] : 0;
    const sc = Math.pow(er * (fastSC - slowSC) + slowSC, 2);
    prev = sc * v + (1 - sc) * (isNum(prev) ? prev : v);
    out[i] = prev;
  }
  return out;
}

/** McGinley Dynamic: seeded with EMA(length), then `mg += (src - mg) / (length * (src / mg)^4)`. */
export function mcginley(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (length <= 0) return out;
  const e = ema(src, length);
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (!isNum(prev)) { if (isNum(e[i])) { prev = e[i]; out[i] = prev; } continue; }
    if (!isNum(v)) continue;
    const r = v / prev;
    const den = length * r * r * r * r;
    prev = den === 0 || !isNum(den) ? prev : prev + (v - prev) / den;
    out[i] = prev;
  }
  return out;
}

/** Exact port of Pine's `ta.sar` reference: bar 0 = NaN, seeded on bar 1 from close vs close[1], with the two-bar low/high clamp. */
export function sarPine(high: Series, low: Series, close: Series, start = 0.02, inc = 0.02, max = 0.2): Float64Array {
  const n = high.length;
  const out = nanArray(n);
  if (n < 2) return out;
  let result = NaN, maxMin = NaN, acceleration = NaN, isBelow = false;
  for (let i = 1; i < n; i++) {
    let isFirstTrendBar = false;
    if (i === 1) {
      if (close[i] > close[i - 1]) { isBelow = true; maxMin = high[i]; result = low[i - 1]; }
      else { isBelow = false; maxMin = low[i]; result = high[i - 1]; }
      isFirstTrendBar = true;
      acceleration = start;
    }
    result = result + acceleration * (maxMin - result);
    if (isBelow) {
      if (result > low[i]) { isFirstTrendBar = true; isBelow = false; result = Math.max(high[i], maxMin); maxMin = low[i]; acceleration = start; }
    } else if (result < high[i]) { isFirstTrendBar = true; isBelow = true; result = Math.min(low[i], maxMin); maxMin = high[i]; acceleration = start; }
    if (!isFirstTrendBar) {
      if (isBelow) { if (high[i] > maxMin) { maxMin = high[i]; acceleration = Math.min(acceleration + inc, max); } }
      else if (low[i] < maxMin) { maxMin = low[i]; acceleration = Math.min(acceleration + inc, max); }
    }
    if (isBelow) { result = Math.min(result, low[i - 1]); if (i > 1) result = Math.min(result, low[i - 2]); }
    else { result = Math.max(result, high[i - 1]); if (i > 1) result = Math.max(result, high[i - 2]); }
    out[i] = result;
  }
  return out;
}

/** Standard error of the linear-regression estimate over `length` bars: sqrt(SSE / (length - 2)) (0 when length == 2). */
export function stderr(src: Series, length: number): Float64Array {
  const n = src.length;
  const out = nanArray(n);
  if (length < 2) return out;
  const sumX = (length * (length - 1)) / 2;
  const sumXX = ((length - 1) * length * (2 * length - 1)) / 6;
  for (let i = length - 1; i < n; i++) {
    let sumY = 0, sumXY = 0, ok = true;
    for (let k = 0; k < length; k++) { const v = src[i - length + 1 + k]; if (!isNum(v)) { ok = false; break; } sumY += v; sumXY += k * v; }
    if (!ok) continue;
    const slope = (length * sumXY - sumX * sumY) / (length * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / length;
    let sse = 0;
    for (let k = 0; k < length; k++) { const d = src[i - length + 1 + k] - (intercept + slope * k); sse += d * d; }
    out[i] = length > 2 ? Math.sqrt(sse / (length - 2)) : 0;
  }
  return out;
}

/** Facts about a TradingView resolution string ("1", "15", "60", "1S", "30S", "1D", "1W", "1M", "3M", "12M"). */
export interface ResolutionInfo {
  multiplier: number;
  unit: 'S' | 'm' | 'D' | 'W' | 'M';
  isSeconds: boolean; isMinutes: boolean; isIntraday: boolean; isDaily: boolean; isWeekly: boolean; isMonthly: boolean; isDWM: boolean;
  /** nominal bar length in seconds */
  seconds: number;
}

export function parseResolution(res: string): ResolutionInfo {
  const m = /^(\d*)\s*([SDWMH]?)$/i.exec((res || '').trim());
  let mult = m && m[1] ? parseInt(m[1], 10) : 1;
  if (!(mult > 0)) mult = 1;
  const u = m ? m[2].toUpperCase() : '';
  let unit: ResolutionInfo['unit'] = 'm';
  if (u === 'S') unit = 'S'; else if (u === 'D') unit = 'D'; else if (u === 'W') unit = 'W'; else if (u === 'M') unit = 'M'; else if (u === 'H') { unit = 'm'; mult *= 60; }
  const per = unit === 'S' ? 1 : unit === 'm' ? 60 : unit === 'D' ? 86400 : unit === 'W' ? 604800 : 2592000;
  return {
    multiplier: mult, unit,
    isSeconds: unit === 'S', isMinutes: unit === 'm', isIntraday: unit === 'S' || unit === 'm',
    isDaily: unit === 'D', isWeekly: unit === 'W', isMonthly: unit === 'M', isDWM: unit === 'D' || unit === 'W' || unit === 'M',
    seconds: mult * per,
  };
}

/** New-period flags (Pine `timeframe.change`): 1 on bar i when `keyOf(time[i])` differs from the previous bar's key; bar 0 is always a new period. */
export function periodChanges(times: Series, keyOf: (t: number) => string | number): Uint8Array {
  const n = times.length;
  const out = new Uint8Array(n);
  let prev: string | number | null = null;
  for (let i = 0; i < n; i++) { const k = keyOf(times[i]); out[i] = prev === null || k !== prev ? 1 : 0; prev = k; }
  return out;
}

export interface ZigZagPivot { bar: number; price: number; isHigh: boolean }

/**
 * Zig Zag engine with TradingView ZigZag-library semantics: legs = floor(depth/2) on each side of ta.pivothigh/low;
 * a same-direction pivot that is more extreme replaces the last pivot; an opposite-direction pivot is added when
 * |price - last| / |last| * 100 >= deviationPct. `projected` is the most extreme opposite price after the last pivot (live leg).
 */
export function zigzag(high: Series, low: Series, deviationPct: number, depth: number): { pivots: ZigZagPivot[]; projected: ZigZagPivot | null } {
  const n = high.length;
  const legs = Math.max(1, Math.floor(depth / 2));
  const ph = pivotHigh(high, legs, legs), pl = pivotLow(low, legs, legs);
  const pivots: ZigZagPivot[] = [];
  const consider = (isHigh: boolean, price: number, bar: number): void => {
    const last = pivots.length ? pivots[pivots.length - 1] : null;
    if (!last) { pivots.push({ bar, price, isHigh }); return; }
    if (last.isHigh === isHigh) {
      if ((isHigh && price > last.price) || (!isHigh && price < last.price)) { last.price = price; last.bar = bar; }
      return;
    }
    const dev = last.price === 0 ? Infinity : (Math.abs(price - last.price) / Math.abs(last.price)) * 100;
    if (dev >= deviationPct) pivots.push({ bar, price, isHigh });
  };
  for (let i = 0; i < n; i++) {
    if (isNum(ph[i])) consider(true, ph[i], i - legs);
    if (isNum(pl[i])) consider(false, pl[i], i - legs);
  }
  let projected: ZigZagPivot | null = null;
  const last = pivots.length ? pivots[pivots.length - 1] : null;
  if (last && last.bar < n - 1) {
    let best = last.isHigh ? Infinity : -Infinity, bestBar = -1;
    for (let i = last.bar + 1; i < n; i++) {
      if (last.isHigh) { if (low[i] < best) { best = low[i]; bestBar = i; } }
      else if (high[i] > best) { best = high[i]; bestBar = i; }
    }
    if (bestBar >= 0) projected = { bar: bestBar, price: best, isHigh: !last.isHigh };
  }
  return { pivots, projected };
}
