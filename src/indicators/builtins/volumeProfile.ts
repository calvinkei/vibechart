/**
 * Volume Profile family (Visible Range, Fixed Range, Session, Periodic, Auto Anchored).
 *
 * TradingView builds these from lower-timeframe bars; here every chart bar's volume is distributed
 * proportionally over the rows its high–low range covers (up/down by close >= open). Everything is
 * drawn by `customRender`; the per-element colors live in `type: 'none'` plots so the Style tab can
 * edit them. Profiles are cached per instance and recomputed only when the visible range / data /
 * inputs change.
 */
import { plotStyle, type IndicatorDefinition, type IndicatorInput, type IndicatorInstance, type IndicatorPlot } from '../Indicator';
import type { RenderContext } from '../../series/Series';
import type { Bar } from '../../data/types';
import { withAlpha } from '../../util/color';
import { formatVolume } from '../../util/format';
import { crisp, setLineStyle } from '../../render/canvas';
import { calendarKeys, findAnchorIndex, ANCHOR_PERIODS } from './volume';

export interface ProfileRow { lo: number; hi: number; up: number; down: number; total: number }

export interface VolumeProfile {
  rows: ProfileRow[];
  bottom: number;
  top: number;
  rowHeight: number;
  /** row indices */
  poc: number;
  vaLow: number;
  vaHigh: number;
  pocPrice: number;
  vah: number;
  val: number;
  total: number;
  maxRow: number;
  from: number;
  to: number;
}

export interface ProfileOptions {
  rowsLayout: 'Number of Rows' | 'Ticks Per Row' | string;
  rowSize: number;
  valueAreaPct: number;
  minTick: number;
}

const MAX_ROWS = 6000;

/** Row grid for a price span. */
function rowGrid(bottom: number, top: number, opts: ProfileOptions): { n: number; rowH: number } {
  const tick = opts.minTick > 0 ? opts.minTick : 0.01;
  const span = top - bottom;
  if (!(span > 0)) return { n: 1, rowH: tick };
  let n: number, rowH: number;
  if (opts.rowsLayout === 'Ticks Per Row') {
    rowH = Math.max(1, Math.round(opts.rowSize)) * tick;
    n = Math.max(1, Math.ceil(span / rowH - 1e-9));
  } else {
    const want = Math.max(1, Math.round(opts.rowSize));
    const ticks = Math.max(1, Math.round(span / want / tick));
    rowH = ticks * tick;
    n = Math.max(1, Math.ceil(span / rowH - 1e-9));
    if (Math.abs(n - want) > 1 && span / want < tick) { n = want; rowH = span / want; }
  }
  if (n > MAX_ROWS) { n = MAX_ROWS; rowH = span / n; }
  return { n, rowH };
}

/** Spread one bar's volume over the rows it covers. */
function addBar(rows: ProfileRow[], bottom: number, rowH: number, b: Bar): void {
  const v = b.volume ?? 0;
  if (!(v > 0)) return;
  const n = rows.length;
  const up = b.close >= b.open;
  const idx = (p: number) => Math.max(0, Math.min(n - 1, Math.floor((p - bottom) / rowH)));
  const lo = b.low, hi = b.high;
  if (!(hi > lo)) {
    const r = rows[idx(lo)];
    if (up) r.up += v; else r.down += v; r.total += v;
    return;
  }
  const rLo = idx(lo), rHi = idx(hi);
  for (let r = rLo; r <= rHi; r++) {
    const rb = bottom + r * rowH, rt = r === n - 1 ? Infinity : rb + rowH;
    const overlap = Math.min(hi, rt) - Math.max(lo, rb);
    if (!(overlap > 0)) continue;
    const share = (v * overlap) / (hi - lo);
    const row = rows[r];
    if (up) row.up += share; else row.down += share;
    row.total += share;
  }
}

function pocOf(rows: ProfileRow[]): number {
  let poc = 0;
  for (let r = 1; r < rows.length; r++) if (rows[r].total > rows[poc].total) poc = r;
  return poc;
}

/** Value area per the Help-Center algorithm: grow from the POC, larger neighbour first, stop before exceeding the target. */
export function valueArea(rows: ProfileRow[], poc: number, pct: number): [number, number] {
  const n = rows.length;
  let total = 0;
  for (const r of rows) total += r.total;
  const target = (pct / 100) * total;
  let lo = poc, hi = poc, acc = rows[poc].total;
  while (acc < target) {
    const above = hi + 1, below = lo - 1;
    const candUp = above < n ? rows[above].total : -1;
    const candDn = below >= 0 ? rows[below].total : -1;
    if (candUp < 0 && candDn < 0) break;
    let pickUp: boolean;
    if (candUp > candDn) pickUp = true;
    else if (candUp < candDn) pickUp = false;
    else pickUp = above - poc <= poc - below; // tie → closer to the POC, equal distance → above
    const vol = pickUp ? candUp : candDn;
    if (acc + vol > target && acc > 0 && vol > 0) break;
    if (pickUp) hi = above; else lo = below;
    acc += vol;
  }
  return [lo, hi];
}

export function computeVolumeProfile(bars: Bar[], from: number, to: number, opts: ProfileOptions): VolumeProfile | null {
  from = Math.max(0, from | 0);
  to = Math.min(bars.length - 1, to | 0);
  if (to < from) return null;
  let top = -Infinity, bottom = Infinity;
  for (let i = from; i <= to; i++) {
    const b = bars[i];
    if (!b || !Number.isFinite(b.high) || !Number.isFinite(b.low)) continue;
    if (b.high > top) top = b.high;
    if (b.low < bottom) bottom = b.low;
  }
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  const { n, rowH } = rowGrid(bottom, top, opts);
  const rows: ProfileRow[] = new Array(n);
  for (let r = 0; r < n; r++) rows[r] = { lo: bottom + r * rowH, hi: bottom + (r + 1) * rowH, up: 0, down: 0, total: 0 };
  for (let i = from; i <= to; i++) if (bars[i]) addBar(rows, bottom, rowH, bars[i]);
  return finishProfile(rows, bottom, top, rowH, opts, from, to);
}

function finishProfile(rows: ProfileRow[], bottom: number, top: number, rowH: number, opts: ProfileOptions, from: number, to: number): VolumeProfile {
  const poc = pocOf(rows);
  const [vaLow, vaHigh] = valueArea(rows, poc, opts.valueAreaPct);
  let total = 0, maxRow = 0;
  for (const r of rows) { total += r.total; if (r.total > maxRow) maxRow = r.total; }
  return {
    rows, bottom, top, rowHeight: rowH, poc, vaLow, vaHigh,
    pocPrice: (rows[poc].lo + rows[poc].hi) / 2, vah: rows[vaHigh].hi, val: rows[vaLow].lo, total, maxRow, from, to,
  };
}

/** Developing POC / VAH / VAL over [from, to] (bar-by-bar, same grid as the full profile). */
export function computeDeveloping(bars: Bar[], p: VolumeProfile, opts: ProfileOptions): { poc: Float64Array; vah: Float64Array; val: Float64Array } {
  const len = p.to - p.from + 1;
  const poc = new Float64Array(len), vah = new Float64Array(len), val = new Float64Array(len);
  const rows: ProfileRow[] = p.rows.map((r) => ({ lo: r.lo, hi: r.hi, up: 0, down: 0, total: 0 }));
  for (let i = p.from; i <= p.to; i++) {
    if (bars[i]) addBar(rows, p.bottom, p.rowHeight, bars[i]);
    const pc = pocOf(rows);
    const [lo, hi] = valueArea(rows, pc, opts.valueAreaPct);
    const k = i - p.from;
    poc[k] = (rows[pc].lo + rows[pc].hi) / 2; vah[k] = rows[hi].hi; val[k] = rows[lo].lo;
  }
  return { poc, vah, val };
}

// ---- rendering ---------------------------------------------------------------------------------

interface DrawStyle {
  width: number;
  placement: 'Right' | 'Left';
  volumeMode: string;
  showValues: boolean;
  extendPoc: boolean;
  extendVA: boolean;
  up: string; down: string; vaUp: string; vaDown: string;
  poc: { color: string; width: number; style: number; visible: boolean };
  vah: { color: string; width: number; style: number; visible: boolean };
  val: { color: string; width: number; style: number; visible: boolean };
  devPoc: { color: string; width: number; style: number; visible: boolean };
  devVah: { color: string; width: number; style: number; visible: boolean };
  devVal: { color: string; width: number; style: number; visible: boolean };
}

function colorOf(inst: IndicatorInstance, id: string, fallback: string): string {
  const st = inst.styles[id];
  if (!st) return fallback;
  return st.transparency > 0 ? withAlpha(st.color, 1 - st.transparency / 100) : st.color;
}
function lineOf(inst: IndicatorInstance, id: string, fallback: string) {
  const st = inst.styles[id];
  return { color: st?.color ?? fallback, width: st?.lineWidth ?? 1, style: st?.lineStyle ?? 0, visible: st?.visible ?? true };
}

function drawStyle(inst: IndicatorInstance): DrawStyle {
  const inp = inst.inputs;
  return {
    width: Math.max(1, Math.min(100, +inp.width || 30)),
    placement: inp.placement === 'Left' ? 'Left' : 'Right',
    volumeMode: inp.volume || 'Up/Down',
    showValues: !!inp.showValues,
    extendPoc: !!inp.extendPoc,
    extendVA: !!inp.extendVA,
    up: colorOf(inst, 'upVol', 'rgba(41,98,255,0.3)'),
    down: colorOf(inst, 'downVol', 'rgba(247,82,95,0.3)'),
    vaUp: colorOf(inst, 'vaUp', 'rgba(41,98,255,0.7)'),
    vaDown: colorOf(inst, 'vaDown', 'rgba(247,82,95,0.7)'),
    poc: lineOf(inst, 'poc', '#FF0000'),
    vah: lineOf(inst, 'vah', '#2962FF'),
    val: lineOf(inst, 'val', '#2962FF'),
    devPoc: lineOf(inst, 'devPoc', '#FF0000'),
    devVah: lineOf(inst, 'devVah', '#2962FF'),
    devVal: lineOf(inst, 'devVal', '#2962FF'),
  };
}

function hline(rc: RenderContext, y: number, x0: number, x1: number, l: { color: string; width: number; style: number }): void {
  const { ctx, dpr } = rc;
  ctx.save();
  ctx.strokeStyle = l.color;
  ctx.lineWidth = l.width;
  setLineStyle(ctx, l.style, l.width);
  const yy = crisp(y, dpr, l.width);
  ctx.beginPath();
  ctx.moveTo(x0, yy);
  ctx.lineTo(x1, yy);
  ctx.stroke();
  ctx.restore();
}

/** Draw a profile inside the pixel box [x0, x1]; `extendTo` = right pane edge for POC/VA extension. */
export function drawProfile(rc: RenderContext, p: VolumeProfile, x0: number, x1: number, st: DrawStyle, allowExtend: boolean): void {
  const { ctx, priceScale, height, width } = rc;
  if (!(x1 > x0) || p.maxRow <= 0) return;
  const boxW = x1 - x0;
  const maxLen = (boxW * st.width) / 100;
  const right = st.placement === 'Right';
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  const n = p.rows.length;
  const values: Array<[number, number, string]> = [];
  for (let r = 0; r < n; r++) {
    const row = p.rows[r];
    if (row.total <= 0) continue;
    const yTop = priceScale.priceToY(row.hi), yBot = priceScale.priceToY(row.lo);
    const top = Math.min(yTop, yBot), h = Math.max(1, Math.abs(yBot - yTop));
    if (top > height || top + h < 0) continue;
    const gap = h > 3 ? 1 : 0;
    const inVA = r >= p.vaLow && r <= p.vaHigh;
    const upC = inVA ? st.vaUp : st.up, dnC = inVA ? st.vaDown : st.down;
    let len: number;
    if (st.volumeMode === 'Up/Down') {
      const lu = (row.up / p.maxRow) * maxLen, ld = (row.down / p.maxRow) * maxLen;
      len = lu + ld;
      if (right) {
        ctx.fillStyle = upC; ctx.fillRect(x1 - lu, top, lu, h - gap);
        ctx.fillStyle = dnC; ctx.fillRect(x1 - lu - ld, top, ld, h - gap);
      } else {
        ctx.fillStyle = upC; ctx.fillRect(x0, top, lu, h - gap);
        ctx.fillStyle = dnC; ctx.fillRect(x0 + lu, top, ld, h - gap);
      }
    } else {
      const vol = st.volumeMode === 'Delta' ? Math.abs(row.up - row.down) : row.total;
      len = (vol / p.maxRow) * maxLen;
      ctx.fillStyle = st.volumeMode === 'Delta' && row.down > row.up ? dnC : upC;
      ctx.fillRect(right ? x1 - len : x0, top, len, h - gap);
    }
    if (st.showValues && h >= 9) values.push([right ? x1 - len - 3 : x0 + len + 3, top + h / 2, formatVolume(st.volumeMode === 'Delta' ? row.up - row.down : row.total, 2)]);
  }
  if (values.length) {
    ctx.font = rc.font;
    ctx.fillStyle = rc.options.layout.textColor;
    ctx.textAlign = right ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    for (const [x, y, t] of values) ctx.fillText(t, x, y);
  }
  const ext = allowExtend ? width : x1;
  if (st.poc.visible) hline(rc, priceScale.priceToY(p.pocPrice), x0, st.extendPoc ? ext : x1, st.poc);
  if (st.vah.visible) hline(rc, priceScale.priceToY(p.vah), x0, st.extendVA ? ext : x1, st.vah);
  if (st.val.visible) hline(rc, priceScale.priceToY(p.val), x0, st.extendVA ? ext : x1, st.val);
  ctx.restore();
}

function drawStep(rc: RenderContext, from: number, vals: Float64Array, l: { color: string; width: number; style: number }): void {
  const { ctx, timeScale, priceScale, visible } = rc;
  ctx.save();
  ctx.strokeStyle = l.color;
  ctx.lineWidth = l.width;
  setLineStyle(ctx, l.style, l.width);
  ctx.beginPath();
  let started = false;
  const a = Math.max(from, visible.from), b = Math.min(from + vals.length - 1, visible.to);
  for (let i = a; i <= b; i++) {
    const v = vals[i - from];
    if (v !== v) continue;
    const y = priceScale.priceToY(v);
    const xl = timeScale.indexToX(i), xr = timeScale.indexToX(i + 1);
    if (!started) { ctx.moveTo(xl, y); started = true; } else ctx.lineTo(xl, y);
    ctx.lineTo(xr, y);
  }
  ctx.stroke();
  ctx.restore();
}

// ---- shared inputs / plots ---------------------------------------------------------------------

function profileInputs(width: number, placement: 'Right' | 'Left'): IndicatorInput[] {
  return [
    { id: 'rowsLayout', name: 'Rows Layout', type: 'select', defval: 'Number of Rows', options: ['Number of Rows', 'Ticks Per Row'] },
    { id: 'rowSize', name: 'Row Size', type: 'int', defval: 24, min: 1, max: 6000 },
    { id: 'volume', name: 'Volume', type: 'select', defval: 'Up/Down', options: ['Total', 'Up/Down', 'Delta'] },
    { id: 'valueArea', name: 'Value Area Volume', type: 'int', defval: 70, min: 0, max: 100 },
    { id: 'extendPoc', name: 'Extend POC Right', type: 'bool', defval: false },
    { id: 'extendVA', name: 'Extend VAH/VAL Right', type: 'bool', defval: false },
    { id: 'width', name: 'Width (% of box)', type: 'int', defval: width, min: 1, max: 100, group: 'Style' },
    { id: 'placement', name: 'Placement', type: 'select', defval: placement, options: ['Right', 'Left'], group: 'Style' },
    { id: 'showValues', name: 'Show values', type: 'bool', defval: false, group: 'Style' },
  ];
}

function stylePlots(developing: boolean): IndicatorPlot[] {
  const none = (id: string, title: string, color: string, extra: Record<string, unknown> = {}) => ({ id, title, style: plotStyle({ type: 'none', color, showLast: false, ...extra }), hideInLegend: true });
  const plots: IndicatorPlot[] = [
    none('upVol', 'Up Volume', '#2962FF', { transparency: 70 }),
    none('downVol', 'Down Volume', '#F7525F', { transparency: 70 }),
    none('vaUp', 'Value Area Up', '#2962FF', { transparency: 30 }),
    none('vaDown', 'Value Area Down', '#F7525F', { transparency: 30 }),
    none('poc', 'POC', '#FF0000'),
    none('vah', 'VAH', '#2962FF'),
    none('val', 'VAL', '#2962FF'),
  ];
  if (developing) {
    plots.push(none('devPoc', 'Developing POC', '#FF0000', { visible: false }));
    plots.push(none('devVah', 'Developing VA High', '#2962FF', { visible: false }));
    plots.push(none('devVal', 'Developing VA Low', '#2962FF', { visible: false }));
  }
  return plots;
}

function minTickOf(rc: RenderContext): number {
  const f = rc.priceScale.priceFormat;
  if (f && f.type === 'price' && f.minMove > 0) return f.minMove / Math.pow(10, Math.max(0, f.precision));
  return 0.01;
}

function optsOf(inst: IndicatorInstance, rc: RenderContext): ProfileOptions {
  return { rowsLayout: inst.inputs.rowsLayout, rowSize: +inst.inputs.rowSize || 24, valueAreaPct: +inst.inputs.valueArea || 70, minTick: minTickOf(rc) };
}

function optsKey(o: ProfileOptions): string { return `${o.rowsLayout}|${o.rowSize}|${o.valueAreaPct}|${o.minTick}`; }

function barsOf(rc: RenderContext): Bar[] | null {
  const bars = (rc as any).mainBars as Bar[] | undefined;
  return bars && bars.length ? bars : null;
}

function lastBarKey(bars: Bar[]): string {
  const b = bars[bars.length - 1];
  return `${bars.length}|${bars[0].time}|${b.time}|${b.close}|${b.volume ?? 0}`;
}

interface SingleCache { key: string; profile: VolumeProfile | null; dev: { poc: Float64Array; vah: Float64Array; val: Float64Array } | null }

/** Compute (cached) and draw one profile over [from, to]. */
function renderSingle(rc: RenderContext, inst: IndicatorInstance, from: number, to: number, cacheId: string, allowExtend: boolean): void {
  const bars = barsOf(rc);
  if (!bars) return;
  from = Math.max(0, from); to = Math.min(bars.length - 1, to);
  if (to < from) return;
  const opts = optsOf(inst, rc);
  const key = `${from}|${to}|${lastBarKey(bars)}|${optsKey(opts)}`;
  const store = inst as unknown as Record<string, SingleCache | undefined>;
  let c = store[cacheId];
  if (!c || c.key !== key) {
    c = { key, profile: computeVolumeProfile(bars, from, to, opts), dev: null };
    store[cacheId] = c;
  }
  if (!c.profile) return;
  const st = drawStyle(inst);
  drawProfile(rc, c.profile, rc.timeScale.indexToX(from), rc.timeScale.indexToX(to + 1), st, allowExtend);
  if ((st.devPoc.visible || st.devVah.visible || st.devVal.visible) && c.profile.rows.length <= 512) {
    if (!c.dev) c.dev = computeDeveloping(bars, c.profile, opts);
    if (st.devPoc.visible) drawStep(rc, from, c.dev.poc, st.devPoc);
    if (st.devVah.visible) drawStep(rc, from, c.dev.vah, st.devVah);
    if (st.devVal.visible) drawStep(rc, from, c.dev.val, st.devVal);
  }
}

interface GroupCache { key: string; starts: Int32Array; profiles: Map<number, VolumeProfile> }

/** Draw one profile per group (session / period) for the groups intersecting the visible range. */
function renderGrouped(rc: RenderContext, inst: IndicatorInstance, keysFn: (times: number[], tz: string) => ArrayLike<number>, cacheId: string): void {
  const bars = barsOf(rc);
  if (!bars) return;
  const n = bars.length;
  const { visible, timeScale } = rc;
  if (visible.to < visible.from) return;
  const tz = timeScale.timezone;
  const opts = optsOf(inst, rc);
  const key = `${n}|${bars[0].time}|${tz}|${optsKey(opts)}|${inst.inputs.periodMult ?? ''}|${inst.inputs.periodUnit ?? ''}`;
  const store = inst as unknown as Record<string, GroupCache | undefined>;
  let c = store[cacheId];
  if (!c || c.key !== key) {
    const times = bars.map((b) => b.time);
    const keys = keysFn(times, tz);
    const starts: number[] = [];
    for (let i = 0; i < n; i++) if (i === 0 || keys[i] !== keys[i - 1]) starts.push(i);
    c = { key, starts: Int32Array.from(starts), profiles: new Map() };
    store[cacheId] = c;
  }
  const starts = c.starts;
  if (starts.length === 0) return;
  // first group whose range intersects the visible range
  let lo = 0, hi = starts.length - 1, g = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= visible.from) { g = mid; lo = mid + 1; } else hi = mid - 1; }
  const st = drawStyle(inst);
  for (; g < starts.length && starts[g] <= visible.to; g++) {
    const s = starts[g], e = g + 1 < starts.length ? starts[g + 1] - 1 : n - 1;
    const isLast = g === starts.length - 1;
    let p = c.profiles.get(s);
    if (!p || isLast) {
      const np = computeVolumeProfile(bars, s, e, opts);
      if (!np) continue;
      p = np;
      if (!isLast) c.profiles.set(s, p);
    }
    drawProfile(rc, p, timeScale.indexToX(s), timeScale.indexToX(e + 1), st, isLast);
  }
}

// ---- definitions -------------------------------------------------------------------------------

export const volumeProfileIndicators: IndicatorDefinition[] = [
  {
    id: 'Volume Profile Visible Range', name: 'Volume Profile Visible Range', shortName: 'VRVP', category: 'Volume Profile', overlay: true, aliases: ['VRVP', 'Visible Range Volume Profile'], format: 'volume', precision: 2,
    inputs: profileInputs(30, 'Right'),
    plots: stylePlots(true),
    compute() { return {}; },
    customRender(rc, inst) { renderSingle(rc, inst, rc.visible.from, rc.visible.to, '__vrvp', true); },
  },
  {
    id: 'Volume Profile Fixed Range', name: 'Volume Profile Fixed Range', shortName: 'FRVP', category: 'Volume Profile', overlay: true, aliases: ['FRVP', 'Fixed Range Volume Profile'], format: 'volume', precision: 2,
    inputs: [
      { id: 'from', name: 'From (time)', type: 'time', defval: null, tooltip: 'Unix seconds of the first bar; empty = first loaded bar' },
      { id: 'to', name: 'To (time)', type: 'time', defval: null, tooltip: 'Unix seconds of the last bar; empty = last loaded bar' },
      { id: 'extendRight', name: 'Extend Right', type: 'bool', defval: false, tooltip: 'Include bars added after "To"' },
      ...profileInputs(30, 'Left'),
    ],
    plots: stylePlots(true),
    compute() { return {}; },
    customRender(rc, inst) {
      const bars = barsOf(rc);
      if (!bars) return;
      const ts = rc.timeScale;
      const fromT = inst.inputs.from, toT = inst.inputs.to;
      const from = fromT == null || !Number.isFinite(+fromT) ? 0 : ts.timeToNearestBar(+fromT);
      const to = inst.inputs.extendRight || toT == null || !Number.isFinite(+toT) ? bars.length - 1 : ts.timeToNearestBar(+toT);
      renderSingle(rc, inst, Math.min(from, to), Math.max(from, to), '__frvp', true);
    },
  },
  {
    id: 'Session Volume Profile', name: 'Session Volume Profile', shortName: 'SVP', category: 'Volume Profile', overlay: true, aliases: ['SVP'], format: 'volume', precision: 2,
    description: 'One profile per trading day (calendar day in the chart timezone). Pre-/post-market splits need session data and are not available.',
    inputs: [
      { id: 'sessions', name: 'Sessions', type: 'select', defval: 'All', options: ['All'], tooltip: 'Only whole-day sessions are supported' },
      ...profileInputs(30, 'Left'),
    ],
    plots: stylePlots(false),
    compute() { return {}; },
    customRender(rc, inst) { renderGrouped(rc, inst, (times, tz) => calendarKeys(times, tz, 'Session'), '__svp'); },
  },
  {
    id: 'Periodic Volume Profile', name: 'Periodic Volume Profile', shortName: 'PVP', category: 'Volume Profile', overlay: true, aliases: ['PVP'], format: 'volume', precision: 2,
    inputs: [
      { id: 'periodMult', name: 'Period', type: 'int', defval: 1, min: 1, max: 1000, inline: 'period' },
      { id: 'periodUnit', name: 'Unit', type: 'select', defval: 'Day', options: ['Bar', 'Minute', 'Hour', 'Day', 'Week', 'Month'], inline: 'period' },
      ...profileInputs(30, 'Left'),
    ],
    plots: stylePlots(false),
    compute() { return {}; },
    customRender(rc, inst) {
      const mult = Math.max(1, +inst.inputs.periodMult || 1);
      const unit = inst.inputs.periodUnit || 'Day';
      renderGrouped(rc, inst, (times, tz) => {
        const n = times.length;
        const out = new Float64Array(n);
        if (unit === 'Bar') { for (let i = 0; i < n; i++) out[i] = Math.floor(i / mult); return out; }
        if (unit === 'Minute') { for (let i = 0; i < n; i++) out[i] = Math.floor(times[i] / (60 * mult)); return out; }
        if (unit === 'Hour') { for (let i = 0; i < n; i++) out[i] = Math.floor(times[i] / (3600 * mult)); return out; }
        const k = calendarKeys(times, tz, unit === 'Week' ? 'Week' : unit === 'Month' ? 'Month' : 'Session');
        const div = unit === 'Week' ? 7 * mult : mult;
        for (let i = 0; i < n; i++) out[i] = Math.floor(k[i] / div);
        return out;
      }, '__pvp');
    },
  },
  {
    id: 'Auto Anchored Volume Profile', name: 'Auto Anchored Volume Profile', shortName: 'AAVP', category: 'Volume Profile', overlay: true, aliases: ['AAVP'], format: 'volume', precision: 2,
    inputs: [
      { id: 'anchor', name: 'Anchor Period', type: 'select', defval: 'Auto', options: ['Auto', 'Highest High', 'Lowest Low', 'Highest Volume', ...ANCHOR_PERIODS] },
      { id: 'length', name: 'Length', type: 'int', defval: 10, min: 1, max: 5000 },
      ...profileInputs(30, 'Left'),
    ],
    plots: stylePlots(true),
    compute() { return {}; },
    customRender(rc, inst) {
      const bars = barsOf(rc);
      if (!bars) return;
      const n = bars.length;
      const ctx = { n, time: Float64Array.from(bars, (b) => b.time), high: Float64Array.from(bars, (b) => b.high), low: Float64Array.from(bars, (b) => b.low), volume: Float64Array.from(bars, (b) => b.volume ?? 0), resolution: rc.timeScale.resolution, timezone: rc.timeScale.timezone };
      const anchorIdx = findAnchorIndex(ctx, inst.inputs.anchor, +inst.inputs.length || 10);
      renderSingle(rc, inst, anchorIdx, n - 1, '__aavp', true);
      // anchor marker
      const x = crisp(rc.timeScale.indexToX(anchorIdx), rc.dpr, 1);
      const c = rc.ctx;
      c.save();
      c.strokeStyle = '#787B86';
      c.lineWidth = 1;
      setLineStyle(c, 2, 1);
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, rc.height);
      c.stroke();
      c.restore();
    },
  },
];
