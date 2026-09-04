import type { Bar } from '../data/types';
import { atr } from '../indicators/ta';
import type { RenkoStyleOptions, KagiStyleOptions, LineBreakStyleOptions, PnFStyleOptions, RangeStyleOptions } from '../core/options';

/** A synthetic bar carries the raw-bar index range it was built from. */
export interface SyntheticBar extends Bar {
  rawFrom: number;
  rawTo: number;
  /** direction for kagi/pnf columns: 1 up, -1 down */
  dir?: number;
  /** kagi: thick (yang) line */
  thick?: boolean;
  /** PnF: number of boxes */
  boxes?: number;
  /** renko: projection (not yet completed) */
  projection?: boolean;
}

export function heikinAshi(bars: Bar[]): Bar[] {
  const out: Bar[] = new Array(bars.length);
  let prevOpen = NaN;
  let prevClose = NaN;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 || !Number.isFinite(prevOpen) ? (b.open + b.close) / 2 : (prevOpen + prevClose) / 2;
    const high = Math.max(b.high, open, close);
    const low = Math.min(b.low, open, close);
    out[i] = { time: b.time, open, high, low, close, volume: b.volume };
    prevOpen = open;
    prevClose = close;
  }
  return out;
}

function boxSizeFor(bars: Bar[], method: 'ATR' | 'Traditional', atrLength: number, boxSize: number, minMove: number): number {
  if (method === 'Traditional') return Math.max(boxSize, minMove);
  const n = bars.length;
  const h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n);
  for (let i = 0; i < n; i++) { h[i] = bars[i].high; l[i] = bars[i].low; c[i] = bars[i].close; }
  const a = atr(h, l, c, atrLength);
  let v = NaN;
  for (let i = n - 1; i >= 0; i--) if (Number.isFinite(a[i])) { v = a[i]; break; }
  if (!Number.isFinite(v) || v <= 0) {
    // fallback: 1% of last close
    v = (bars[n - 1]?.close ?? 1) * 0.01;
  }
  // round to minMove multiples
  if (minMove > 0) v = Math.max(minMove, Math.round(v / minMove) * minMove);
  return v;
}

export function renko(bars: Bar[], st: RenkoStyleOptions, minMove: number): SyntheticBar[] {
  const out: SyntheticBar[] = [];
  if (bars.length === 0) return out;
  const box = boxSizeFor(bars, st.boxSizeMethod, st.atrLength, st.boxSize, minMove);
  if (!(box > 0)) return out;
  const useHL = st.source === 'highLow';
  // start: first close aligned to box
  let base = Math.floor(bars[0].close / box) * box;
  let top = base + box;
  let bottom = base;
  let dir = 0;
  let rawFrom = 0;
  let wickHigh = -Infinity;
  let wickLow = Infinity;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const hi = useHL ? b.high : b.close;
    const lo = useHL ? b.low : b.close;
    wickHigh = Math.max(wickHigh, b.high);
    wickLow = Math.min(wickLow, b.low);
    let moved = true;
    while (moved) {
      moved = false;
      if (dir >= 0) {
        // up bricks
        if (hi >= top + box) {
          const o = top;
          const c = top + box;
          out.push({ time: b.time, open: o, close: c, high: Math.max(c, st.wicks ? Math.min(wickHigh, c) : c), low: st.wicks ? Math.min(wickLow, o) : o, volume: b.volume, rawFrom, rawTo: i, dir: 1 });
          bottom = o; top = c; dir = 1; rawFrom = i; wickHigh = -Infinity; wickLow = Infinity; moved = true; continue;
        }
        if (dir === 1 && lo <= bottom - box) {
          // reversal down needs 2 boxes from top: brick from bottom to bottom-box
          const o = bottom;
          const c = bottom - box;
          out.push({ time: b.time, open: o, close: c, high: st.wicks ? Math.max(wickHigh, o) : o, low: st.wicks ? Math.min(wickLow, c) : c, volume: b.volume, rawFrom, rawTo: i, dir: -1 });
          top = o; bottom = c; dir = -1; rawFrom = i; wickHigh = -Infinity; wickLow = Infinity; moved = true; continue;
        }
        if (dir === 0 && lo <= bottom - box) {
          const o = bottom;
          const c = bottom - box;
          out.push({ time: b.time, open: o, close: c, high: st.wicks ? Math.max(wickHigh, o) : o, low: st.wicks ? Math.min(wickLow, c) : c, volume: b.volume, rawFrom, rawTo: i, dir: -1 });
          top = o; bottom = c; dir = -1; rawFrom = i; wickHigh = -Infinity; wickLow = Infinity; moved = true; continue;
        }
      } else {
        if (lo <= bottom - box) {
          const o = bottom;
          const c = bottom - box;
          out.push({ time: b.time, open: o, close: c, high: st.wicks ? Math.max(wickHigh, o) : o, low: st.wicks ? Math.min(wickLow, c) : c, volume: b.volume, rawFrom, rawTo: i, dir: -1 });
          top = o; bottom = c; rawFrom = i; wickHigh = -Infinity; wickLow = Infinity; moved = true; continue;
        }
        if (hi >= top + box) {
          const o = top;
          const c = top + box;
          out.push({ time: b.time, open: o, close: c, high: st.wicks ? Math.max(wickHigh, c) : c, low: st.wicks ? Math.min(wickLow, o) : o, volume: b.volume, rawFrom, rawTo: i, dir: 1 });
          bottom = o; top = c; dir = 1; rawFrom = i; wickHigh = -Infinity; wickLow = Infinity; moved = true; continue;
        }
      }
    }
  }
  if (st.showProjection && bars.length) {
    const last = bars[bars.length - 1];
    const c = last.close;
    if (dir >= 0 && c > top) out.push({ time: last.time, open: top, close: c, high: c, low: top, rawFrom, rawTo: bars.length - 1, dir: 1, projection: true });
    else if (dir <= 0 && c < bottom) out.push({ time: last.time, open: bottom, close: c, high: bottom, low: c, rawFrom, rawTo: bars.length - 1, dir: -1, projection: true });
    else if (dir === 1 && c < bottom) out.push({ time: last.time, open: bottom, close: c, high: bottom, low: c, rawFrom, rawTo: bars.length - 1, dir: -1, projection: true });
    else if (dir === -1 && c > top) out.push({ time: last.time, open: top, close: c, high: c, low: top, rawFrom, rawTo: bars.length - 1, dir: 1, projection: true });
  }
  return out;
}

export function lineBreak(bars: Bar[], st: LineBreakStyleOptions): SyntheticBar[] {
  const out: SyntheticBar[] = [];
  if (bars.length === 0) return out;
  const n = Math.max(1, st.numberOfLines);
  const useHL = st.source === 'highLow';
  out.push({ ...bars[0], open: bars[0].open, close: bars[0].close, high: Math.max(bars[0].open, bars[0].close), low: Math.min(bars[0].open, bars[0].close), rawFrom: 0, rawTo: 0, dir: bars[0].close >= bars[0].open ? 1 : -1 });
  let rawFrom = 1;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const lastN = out.slice(-n);
    const hi = Math.max(...lastN.map((x) => Math.max(x.open, x.close)));
    const lo = Math.min(...lastN.map((x) => Math.min(x.open, x.close)));
    const last = out[out.length - 1];
    const price = useHL ? { up: b.high, down: b.low } : { up: b.close, down: b.close };
    if (price.up > hi) {
      const o = Math.max(last.open, last.close);
      out.push({ time: b.time, open: o, close: b.close, high: b.close, low: o, volume: b.volume, rawFrom, rawTo: i, dir: 1 });
      rawFrom = i + 1;
    } else if (price.down < lo) {
      const o = Math.min(last.open, last.close);
      out.push({ time: b.time, open: o, close: b.close, high: o, low: b.close, volume: b.volume, rawFrom, rawTo: i, dir: -1 });
      rawFrom = i + 1;
    }
  }
  return out;
}

export function kagi(bars: Bar[], st: KagiStyleOptions, minMove: number): SyntheticBar[] {
  const out: SyntheticBar[] = [];
  if (bars.length === 0) return out;
  let reversal: number;
  if (st.reversalMethod === 'ATR') reversal = boxSizeFor(bars, 'ATR', st.atrLength, st.reversalAmount, minMove);
  else if (st.reversalMethod === 'Percentage') reversal = -1; // computed dynamically
  else reversal = Math.max(st.reversalAmount, minMove);
  const useHL = st.source === 'highLow';
  const rev = (price: number) => (reversal < 0 ? price * (st.reversalAmount / 100) : reversal);
  let dir = 0;
  let start = bars[0].close;
  let cur = bars[0].close;
  let rawFrom = 0;
  let prevShoulder = -Infinity;
  let prevWaist = Infinity;
  let thick = true;
  const push = (i: number, from: number, to: number, d: number, th: boolean) => {
    out.push({ time: bars[i].time, open: from, close: to, high: Math.max(from, to), low: Math.min(from, to), volume: bars[i].volume, rawFrom, rawTo: i, dir: d, thick: th });
  };
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const hi = useHL ? b.high : b.close;
    const lo = useHL ? b.low : b.close;
    if (dir === 0) {
      if (hi >= start + rev(start)) { dir = 1; cur = hi; push(i, start, cur, 1, true); rawFrom = i; }
      else if (lo <= start - rev(start)) { dir = -1; cur = lo; push(i, start, cur, -1, false); rawFrom = i; }
      continue;
    }
    if (dir === 1) {
      if (hi > cur) {
        // extend current line
        cur = hi;
        const last = out[out.length - 1];
        if (!thick && cur > prevShoulder) thick = true;
        last.close = cur; last.high = cur; last.rawTo = i; last.time = b.time; last.thick = thick;
      } else if (lo <= cur - rev(cur)) {
        prevShoulder = cur;
        dir = -1;
        const from = cur;
        cur = lo;
        if (thick && cur < prevWaist) thick = false;
        push(i, from, cur, -1, thick);
        rawFrom = i;
      }
    } else {
      if (lo < cur) {
        cur = lo;
        const last = out[out.length - 1];
        if (thick && cur < prevWaist) thick = false;
        last.close = cur; last.low = cur; last.rawTo = i; last.time = b.time; last.thick = thick;
      } else if (hi >= cur + rev(cur)) {
        prevWaist = cur;
        dir = 1;
        const from = cur;
        cur = hi;
        if (!thick && cur > prevShoulder) thick = true;
        push(i, from, cur, 1, thick);
        rawFrom = i;
      }
    }
  }
  return out;
}

export function pointAndFigure(bars: Bar[], st: PnFStyleOptions, minMove: number): SyntheticBar[] {
  const out: SyntheticBar[] = [];
  if (bars.length === 0) return out;
  const box = boxSizeFor(bars, st.boxSizeMethod, st.atrLength, st.boxSize, minMove);
  if (!(box > 0)) return out;
  const rev = Math.max(1, st.reversalAmount) * box;
  const useHL = st.source === 'highLow';
  let dir = 0;
  let colTop = Math.floor(bars[0].close / box) * box; // top of column (price)
  let colBottom = colTop;
  let rawFrom = 0;
  let curBar: SyntheticBar | null = null;
  const newColumn = (i: number, d: number, from: number, to: number) => {
    curBar = { time: bars[i].time, open: from, close: to, high: Math.max(from, to), low: Math.min(from, to), volume: bars[i].volume, rawFrom, rawTo: i, dir: d, boxes: Math.round(Math.abs(to - from) / box) };
    out.push(curBar);
    rawFrom = i;
  };
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const hi = useHL ? b.high : b.close;
    const lo = useHL ? b.low : b.close;
    if (dir === 0) {
      if (hi >= colTop + box) { dir = 1; colTop = Math.floor(hi / box) * box; newColumn(i, 1, colBottom, colTop); }
      else if (lo <= colBottom - box) { dir = -1; colBottom = Math.ceil(lo / box) * box; newColumn(i, -1, colTop, colBottom); }
      continue;
    }
    if (dir === 1) {
      if (hi >= colTop + box) {
        colTop = Math.floor(hi / box) * box;
        curBar!.close = colTop; curBar!.high = colTop; curBar!.rawTo = i; curBar!.time = b.time; curBar!.boxes = Math.round((colTop - curBar!.open) / box);
      } else if (lo <= colTop - rev) {
        dir = -1;
        const from = colTop - box;
        colBottom = Math.ceil(lo / box) * box;
        newColumn(i, -1, from, colBottom);
      }
    } else {
      if (lo <= colBottom - box) {
        colBottom = Math.ceil(lo / box) * box;
        curBar!.close = colBottom; curBar!.low = colBottom; curBar!.rawTo = i; curBar!.time = b.time; curBar!.boxes = Math.round((curBar!.open - colBottom) / box);
      } else if (hi >= colBottom + rev) {
        dir = 1;
        const from = colBottom + box;
        colTop = Math.floor(hi / box) * box;
        newColumn(i, 1, from, colTop);
      }
    }
  }
  return out;
}

export function rangeBars(bars: Bar[], st: RangeStyleOptions, minMove: number): SyntheticBar[] {
  const out: SyntheticBar[] = [];
  if (bars.length === 0) return out;
  const range = Math.max(minMove, st.range * minMove);
  let cur: SyntheticBar | null = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    // walk the bar's path: open -> (high/low) -> close
    const path = b.close >= b.open ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close];
    for (const p of path) {
      if (!cur) { cur = { time: b.time, open: p, high: p, low: p, close: p, volume: 0, rawFrom: i, rawTo: i }; out.push(cur); }
      let price = p;
      let guard = 0;
      while (guard++ < 10000) {
        const hi = Math.max(cur.high, price);
        const lo = Math.min(cur.low, price);
        if (hi - lo <= range + 1e-12) { cur.high = hi; cur.low = lo; cur.close = price; cur.rawTo = i; cur.time = b.time; break; }
        // bar completes at boundary
        if (price > cur.high) {
          const closeAt: number = cur.low + range;
          cur.high = closeAt; cur.close = closeAt; cur.rawTo = i; cur.time = b.time;
          cur = { time: b.time, open: closeAt, high: closeAt, low: closeAt, close: closeAt, volume: 0, rawFrom: i, rawTo: i };
          out.push(cur);
        } else {
          const closeAt: number = cur.high - range;
          cur.low = closeAt; cur.close = closeAt; cur.rawTo = i; cur.time = b.time;
          cur = { time: b.time, open: closeAt, high: closeAt, low: closeAt, close: closeAt, volume: 0, rawFrom: i, rawTo: i };
          out.push(cur);
        }
      }
    }
    if (cur) cur.volume = (cur.volume ?? 0) + (b.volume ?? 0);
  }
  return out;
}
