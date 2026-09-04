/**
 * "Others" built-ins: Technical Ratings, Gaps, Divergence Indicator, Median, Majority Rule, Performance,
 * Visible Average Price and the bars-based Advance/Decline. (Trend Strength Index and TWAP live in the trend /
 * moving-average modules.)
 *
 * Skipped on purpose (see the module report): Correlation Coefficient (needs a second symbol's bars),
 * Rob Booker family (formulas unpublished), Auto Trendlines (pattern engine, not Pine), Standard Error (volatility module).
 */
import { plotStyle, type IndicatorDefinition, type IndicatorContext, type IndicatorInstance, type ComputeResult } from '../Indicator';
import type { RenderContext } from '../../series/Series';
import type { Bar } from '../../data/types';
import { priceSourceValue, type PriceSource } from '../../data/types';
import { withAlpha } from '../../util/color';
import { dateParts, partsToTime } from '../../util/time';
import { drawLabelBox } from '../../render/canvas';
import * as ta from '../ta';
import { SOURCES } from './volume';

const GRAY = '#787B86';
const BLUE = '#2962FF';
const UP = '#089981';
const DOWN = '#F23645';

// ---- Technical Ratings ---------------------------------------------------------------------------

function voteOf(buy: boolean, sell: boolean): number { return buy ? 1 : sell ? -1 : 0; }

/** Average of the non-NaN votes; NaN when there are none. */
function avgVotes(votes: Float64Array[], i: number): number {
  let s = 0, c = 0;
  for (const v of votes) { const x = v[i]; if (x === x) { s += x; c++; } }
  return c ? s / c : NaN;
}

export function technicalRatings(ctx: IndicatorContext): { ma: Float64Array; osc: Float64Array; all: Float64Array } {
  const n = ctx.n;
  const c = ctx.close, h = ctx.high, l = ctx.low;
  const maVotes: Float64Array[] = [];
  const maVote = (ma: Float64Array) => {
    const v = ta.nanArray(n);
    for (let i = 0; i < n; i++) if (ta.isNum(ma[i]) && ta.isNum(c[i])) v[i] = ma[i] === c[i] ? 0 : ma[i] < c[i] ? 1 : -1;
    maVotes.push(v);
  };
  for (const len of [10, 20, 30, 50, 100, 200]) maVote(ta.sma(c, len));
  for (const len of [10, 20, 30, 50, 100, 200]) maVote(ta.ema(c, len));
  maVote(ta.hma(c, 9));
  maVote(ta.vwma(c, ctx.volume, 20));
  {
    const ic = ta.ichimokuLines(h, l, 9, 26, 52);
    const v = ta.nanArray(n);
    for (let i = 1; i < n; i++) {
      if (!ta.isNum(ic.leadA[i]) || !ta.isNum(ic.leadB[i]) || !ta.isNum(ic.base[i]) || !ta.isNum(ic.conversion[i])) continue;
      const buy = ic.leadA[i] > ic.leadB[i] && c[i] > ic.leadA[i] && c[i] < ic.base[i] && c[i - 1] < ic.conversion[i] && c[i] > ic.conversion[i];
      const sell = ic.leadB[i] > ic.leadA[i] && c[i] < ic.leadB[i] && c[i] > ic.base[i] && c[i - 1] > ic.conversion[i] && c[i] < ic.conversion[i];
      v[i] = voteOf(buy, sell);
    }
    maVotes.push(v);
  }
  const oscVotes: Float64Array[] = [];
  const osc = (fn: (i: number) => number | null) => {
    const v = ta.nanArray(n);
    for (let i = 1; i < n; i++) { const r = fn(i); if (r !== null) v[i] = r; }
    oscVotes.push(v);
  };
  const sma50 = ta.sma(c, 50);
  const rsi = ta.rsi(c, 14);
  osc((i) => (ta.isNum(rsi[i]) && ta.isNum(rsi[i - 1]) ? voteOf(rsi[i] < 30 && rsi[i - 1] < rsi[i], rsi[i] > 70 && rsi[i - 1] > rsi[i]) : null));
  const k = ta.sma(ta.stoch(c, h, l, 14), 3), d = ta.sma(k, 3);
  osc((i) => (ta.isNum(k[i]) && ta.isNum(d[i]) ? voteOf(k[i] < 20 && d[i] < 20 && k[i] > d[i], k[i] > 80 && d[i] > 80 && k[i] < d[i]) : null));
  const cci = ta.cci(ctx.hlc3, 20);
  osc((i) => (ta.isNum(cci[i]) && ta.isNum(cci[i - 1]) ? voteOf(cci[i] < -100 && cci[i] > cci[i - 1], cci[i] > 100 && cci[i] < cci[i - 1]) : null));
  const dmi = ta.dmi(h, l, c, 14, 14);
  osc((i) => (ta.isNum(dmi.adx[i]) && ta.isNum(dmi.adx[i - 1]) ? voteOf(dmi.adx[i] > 20 && dmi.plus[i] > dmi.minus[i] && dmi.adx[i] > dmi.adx[i - 1], dmi.adx[i] > 20 && dmi.plus[i] < dmi.minus[i] && dmi.adx[i] < dmi.adx[i - 1]) : null));
  const ao5 = ta.sma(ctx.hl2, 5), ao34 = ta.sma(ctx.hl2, 34);
  const ao = ta.nanArray(n);
  for (let i = 0; i < n; i++) ao[i] = ao5[i] - ao34[i];
  osc((i) => {
    if (!ta.isNum(ao[i]) || !ta.isNum(ao[i - 1])) return null;
    const a2 = i >= 2 ? ao[i - 2] : NaN;
    const buy = (ao[i] > 0 && ao[i - 1] <= 0) || (ao[i] > 0 && ao[i - 1] > 0 && ao[i] > ao[i - 1] && a2 > ao[i - 1]);
    const sell = (ao[i] < 0 && ao[i - 1] >= 0) || (ao[i] < 0 && ao[i - 1] < 0 && ao[i] < ao[i - 1] && a2 < ao[i - 1]);
    return voteOf(buy, sell);
  });
  const mom = ta.mom(c, 10);
  osc((i) => (ta.isNum(mom[i]) && ta.isNum(mom[i - 1]) ? voteOf(mom[i] > mom[i - 1], mom[i] < mom[i - 1]) : null));
  const macd = ta.macd(c, 12, 26, 9);
  osc((i) => (ta.isNum(macd.macd[i]) && ta.isNum(macd.signal[i]) ? voteOf(macd.macd[i] > macd.signal[i], macd.macd[i] < macd.signal[i]) : null));
  const sk = ta.sma(ta.stoch(rsi, rsi, rsi, 14), 3), sd = ta.sma(sk, 3);
  osc((i) => {
    if (!ta.isNum(sk[i]) || !ta.isNum(sd[i]) || !ta.isNum(sma50[i])) return null;
    const dn = c[i] < sma50[i], up = c[i] > sma50[i];
    return voteOf(dn && sk[i] < 20 && sd[i] < 20 && sk[i] > sd[i], up && sk[i] > 80 && sd[i] > 80 && sk[i] < sd[i]);
  });
  const wpr = ta.wpr(h, l, c, 14);
  osc((i) => (ta.isNum(wpr[i]) && ta.isNum(wpr[i - 1]) ? voteOf(wpr[i] < -80 && wpr[i] > wpr[i - 1], wpr[i] > -20 && wpr[i] < wpr[i - 1]) : null));
  const e13 = ta.ema(c, 13);
  osc((i) => {
    if (!ta.isNum(e13[i]) || !ta.isNum(e13[i - 1]) || !ta.isNum(sma50[i])) return null;
    const bull = h[i] - e13[i], bear = l[i] - e13[i], pBull = h[i - 1] - e13[i - 1], pBear = l[i - 1] - e13[i - 1];
    const up = c[i] > sma50[i], dn = c[i] < sma50[i];
    return voteOf(up && bear < 0 && bear > pBear, dn && bull > 0 && bull < pBull);
  });
  const uo = ta.ultimateOscillatorVol(h, l, c, 7, 14, 28);
  osc((i) => (ta.isNum(uo[i]) ? voteOf(uo[i] > 70, uo[i] < 30) : null));
  const ma = ta.nanArray(n), os = ta.nanArray(n), all = ta.nanArray(n);
  for (let i = 0; i < n; i++) {
    ma[i] = avgVotes(maVotes, i);
    os[i] = avgVotes(oscVotes, i);
    all[i] = ma[i] === ma[i] && os[i] === os[i] ? (ma[i] + os[i]) / 2 : ma[i] === ma[i] ? ma[i] : os[i];
  }
  return { ma, osc: os, all };
}

export function ratingStatus(v: number): 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell' {
  return v > 0.5 ? 'Strong Buy' : v > 0.1 ? 'Buy' : v < -0.5 ? 'Strong Sell' : v < -0.1 ? 'Sell' : 'Neutral';
}

const RATING_COLORS: Record<string, string> = { 'Strong Buy': UP, Buy: 'rgba(8,153,129,0.5)', Neutral: GRAY, Sell: 'rgba(242,54,69,0.5)', 'Strong Sell': DOWN };

// ---- Gaps ------------------------------------------------------------------------------------------

interface Gap { start: number; end: number; top: number; bottom: number; up: boolean }

function detectGaps(ctx: IndicatorContext, inp: Record<string, any>): Gap[] {
  const n = ctx.n;
  const range = ta.nanArray(n);
  for (let i = 0; i < n; i++) range[i] = ctx.high[i] - ctx.low[i];
  const avgRange = ta.sma(range, 14);
  const minDev = +inp.minDeviation || 0;
  const maxGaps = Math.max(1, inp.maxGaps | 0 || 500);
  const partial = !!inp.closePartially;
  const limit = !!inp.limitTrail;
  const maxTrail = Math.max(1, inp.maxTrail | 0 || 300);
  const gaps: Gap[] = [];
  const open: Gap[] = [];
  for (let i = 1; i < n; i++) {
    const hi = ctx.high[i], lo = ctx.low[i];
    for (let k = open.length - 1; k >= 0; k--) {
      const g = open[k];
      let closed = false;
      if (lo < g.top && hi > g.bottom) {
        if (!partial) closed = true;
        else if (g.up) { g.top = Math.max(g.bottom, lo); if (lo <= g.bottom) closed = true; }
        else { g.bottom = Math.min(g.top, hi); if (hi >= g.top) closed = true; }
      }
      if (!closed && limit && i - g.start >= maxTrail) closed = true;
      if (closed) { g.end = i; open.splice(k, 1); }
    }
    const ar = avgRange[i];
    if (!(ar > 0)) continue;
    const ph = ctx.high[i - 1], pl = ctx.low[i - 1];
    let g: Gap | null = null;
    if (lo > ph && ((lo - ph) / ar) * 100 >= minDev) g = { start: i, end: -1, top: lo, bottom: ph, up: true };
    else if (hi < pl && ((pl - hi) / ar) * 100 >= minDev) g = { start: i, end: -1, top: pl, bottom: hi, up: false };
    if (g) {
      gaps.push(g); open.push(g);
      if (gaps.length > maxGaps) { const old = gaps.shift()!; const j = open.indexOf(old); if (j >= 0) open.splice(j, 1); }
    }
  }
  return gaps;
}

function gapsFromResults(inst: IndicatorInstance): Gap[] {
  const store = inst as unknown as { __gapsFor?: unknown; __gaps?: Gap[] };
  if (store.__gapsFor === inst.results && store.__gaps) return store.__gaps;
  const top = inst.results.gapTop?.values, bottom = inst.results.gapBottom?.values, end = inst.results.gapEnd?.values, dir = inst.results.gapDir?.values;
  const out: Gap[] = [];
  if (top && bottom && end && dir) {
    for (let i = 0; i < top.length; i++) if (top[i] === top[i]) out.push({ start: i, end: end[i] === end[i] ? end[i] : -1, top: top[i], bottom: bottom[i], up: dir[i] > 0 });
  }
  store.__gapsFor = inst.results;
  store.__gaps = out;
  return out;
}

// ---- Divergence Indicator ----------------------------------------------------------------------------

function divergence(ctx: IndicatorContext, inp: Record<string, any>): ComputeResult {
  const n = ctx.n;
  const lbR = Math.max(1, inp.lbR | 0), lbL = Math.max(1, inp.lbL | 0);
  const rangeUpper = inp.rangeUpper | 0, rangeLower = inp.rangeLower | 0;
  const osc = ta.rsi(ctx.close, Math.max(1, inp.length | 0));
  const pl = ta.pivotLow(osc, lbL, lbR), ph = ta.pivotHigh(osc, lbL, lbR);
  const none = 'rgba(255,255,255,0)';
  const bullC = '#4CAF50', bearC = '#F23645', hBullC = 'rgba(76,175,80,0.2)', hBearC = 'rgba(242,54,69,0.2)';
  const mkLine = () => ({ values: ta.nanArray(n), colors: new Array<string | null>(n).fill(none) });
  const mkLabel = () => ({ values: ta.nanArray(n), texts: new Array<string | null>(n).fill(null) });
  const bullLine = mkLine(), hBullLine = mkLine(), bearLine = mkLine(), hBearLine = mkLine();
  const bullLbl = mkLabel(), hBullLbl = mkLabel(), bearLbl = mkLabel(), hBearLbl = mkLabel();
  const fillSeg = (line: { values: Float64Array; colors: Array<string | null> }, a: number, b: number, va: number, vb: number, color: string | null) => {
    for (let j = a; j <= b; j++) {
      line.values[j] = va + ((vb - va) * (j - a)) / Math.max(1, b - a);
      if (j > a && color) line.colors[j] = color;
    }
  };
  // pivot lows
  let prev = -1, prevOsc = NaN, prevLow = NaN;
  for (let i = 0; i < n; i++) {
    if (!ta.isNum(pl[i])) continue;
    const p = i - lbR;
    const o = osc[p], lo = ctx.low[p];
    if (prev >= 0) {
      const bars = i - prev - 1;
      const inRange = rangeLower <= bars && bars <= rangeUpper;
      const bull = !!inp.plotBull && lo < prevLow && o > prevOsc && inRange;
      const hidden = !!inp.plotHiddenBull && lo > prevLow && o < prevOsc && inRange;
      const pp = prev - lbR;
      fillSeg(bullLine, pp, p, prevOsc, o, bull ? bullC : null);
      fillSeg(hBullLine, pp, p, prevOsc, o, hidden ? hBullC : null);
      if (bull) { bullLbl.values[p] = o || 1e-9; bullLbl.texts[p] = ' Bull '; }
      if (hidden) { hBullLbl.values[p] = o || 1e-9; hBullLbl.texts[p] = ' H Bull '; }
    } else { bullLine.values[p] = o; hBullLine.values[p] = o; }
    prev = i; prevOsc = o; prevLow = lo;
  }
  prev = -1; prevOsc = NaN;
  let prevHigh = NaN;
  for (let i = 0; i < n; i++) {
    if (!ta.isNum(ph[i])) continue;
    const p = i - lbR;
    const o = osc[p], hi = ctx.high[p];
    if (prev >= 0) {
      const bars = i - prev - 1;
      const inRange = rangeLower <= bars && bars <= rangeUpper;
      const bear = !!inp.plotBear && hi > prevHigh && o < prevOsc && inRange;
      const hidden = !!inp.plotHiddenBear && hi < prevHigh && o > prevOsc && inRange;
      const pp = prev - lbR;
      fillSeg(bearLine, pp, p, prevOsc, o, bear ? bearC : null);
      fillSeg(hBearLine, pp, p, prevOsc, o, hidden ? hBearC : null);
      if (bear) { bearLbl.values[p] = o || 1e-9; bearLbl.texts[p] = ' Bear '; }
      if (hidden) { hBearLbl.values[p] = o || 1e-9; hBearLbl.texts[p] = ' H Bear '; }
    } else { bearLine.values[p] = o; hBearLine.values[p] = o; }
    prev = i; prevOsc = o; prevHigh = hi;
  }
  return { rsi: osc, bullLine, bullLabel: bullLbl, hiddenBullLine: hBullLine, hiddenBullLabel: hBullLbl, bearLine, bearLabel: bearLbl, hiddenBearLine: hBearLine, hiddenBearLabel: hBearLbl };
}

// ---- Performance -------------------------------------------------------------------------------------

interface Period { label: string; unit: 'D' | 'W' | 'M' | 'Y' | 'YTD'; mult: number }

function parsePeriods(s: string): Period[] {
  const out: Period[] = [];
  for (const raw of String(s || '').split(',')) {
    const t = raw.trim().toUpperCase();
    if (!t) continue;
    if (t === 'YTD') { out.push({ label: 'YTD', unit: 'YTD', mult: 0 }); continue; }
    const m = t.match(/^(\d+)([DWMY])$/);
    if (m) out.push({ label: t, unit: m[2] as Period['unit'], mult: +m[1] });
  }
  return out;
}

/** Unix time of `period` before `t` (calendar arithmetic in tz; YTD = Jan 1 of the current year). */
function periodStart(t: number, p: Period, tz: string): number {
  const d = dateParts(t, tz);
  if (p.unit === 'YTD') return partsToTime({ year: d.year, month: 1, day: 1 }, tz);
  if (p.unit === 'D') return t - p.mult * 86400;
  if (p.unit === 'W') return t - p.mult * 7 * 86400;
  let year = d.year, month = d.month;
  if (p.unit === 'M') { month -= p.mult; while (month < 1) { month += 12; year--; } }
  else year -= p.mult;
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return partsToTime({ year, month, day: Math.min(d.day, dim), hour: d.hour, minute: d.minute, second: d.second }, tz);
}

/** Index of the last bar with time <= t (or -1). */
function lastBarAtOrBefore(time: Float64Array, t: number): number {
  let lo = 0, hi = time.length - 1, r = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (time[mid] <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return r;
}

// ---- helpers for the customRender-only studies ------------------------------------------------------

function mainBarsOf(rc: RenderContext): Bar[] | null {
  const bars = (rc as any).mainBars as Bar[] | undefined;
  return bars && bars.length ? bars : null;
}

// ---- definitions -------------------------------------------------------------------------------------

export const miscIndicators: IndicatorDefinition[] = [
  {
    id: 'Technical Ratings', name: 'Technical Ratings', shortName: 'Ratings', category: 'Others', overlay: false, aliases: ['Ratings'], precision: 2, includeZero: true,
    inputs: [
      { id: 'basedOn', name: 'Rating is based on', type: 'select', defval: 'All', options: ['All', 'MAs', 'Oscillators'] },
      { id: 'confirmedOnly', name: 'Plot confirmed ratings only', type: 'bool', defval: false },
    ],
    plots: [{ id: 'rating', title: 'Rating', style: plotStyle({ type: 'columns', color: GRAY }) }],
    bands: [
      { id: 'strongBuy', title: 'Strong Buy', value: 0.5, color: GRAY, lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'buy', title: 'Buy', value: 0.1, color: GRAY, lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'sell', title: 'Sell', value: -0.1, color: GRAY, lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'strongSell', title: 'Strong Sell', value: -0.5, color: GRAY, lineStyle: 2, lineWidth: 1, visible: true },
    ],
    scaleRange: { min: -1, max: 1 },
    compute(ctx, inp) {
      const r = technicalRatings(ctx);
      const src = inp.basedOn === 'MAs' ? r.ma : inp.basedOn === 'Oscillators' ? r.osc : r.all;
      const values = Float64Array.from(src);
      if (inp.confirmedOnly && ctx.n > 0) values[ctx.n - 1] = NaN;
      const colors: Array<string | null> = new Array(ctx.n);
      for (let i = 0; i < ctx.n; i++) colors[i] = values[i] === values[i] ? RATING_COLORS[ratingStatus(values[i])] : null;
      return { rating: { values, colors } };
    },
  },
  {
    id: 'Gaps', name: 'Gaps', shortName: 'Gaps', category: 'Others', overlay: true, precision: 'inherit',
    inputs: [
      { id: 'closePartially', name: 'Close Gaps Partially', type: 'bool', defval: false },
      { id: 'maxGaps', name: 'Max Number of Gaps', type: 'int', defval: 500, min: 1, max: 5000 },
      { id: 'minDeviation', name: 'Minimal Deviation (%)', type: 'float', defval: 30, min: 0, step: 1 },
      { id: 'limitTrail', name: 'Limit Max Gap Trail Length', type: 'bool', defval: false },
      { id: 'maxTrail', name: 'Max Gap Trail Length (bars)', type: 'int', defval: 300, min: 1 },
    ],
    plots: [
      { id: 'upGap', title: 'Up Gap', style: plotStyle({ type: 'none', color: UP, transparency: 75, showLast: false }), hideInLegend: true },
      { id: 'downGap', title: 'Down Gap', style: plotStyle({ type: 'none', color: DOWN, transparency: 75, showLast: false }), hideInLegend: true },
      { id: 'gapTop', title: 'Gap Top', style: plotStyle({ type: 'none', color: GRAY, showLast: false, visible: false }), hideInLegend: true },
      { id: 'gapBottom', title: 'Gap Bottom', style: plotStyle({ type: 'none', color: GRAY, showLast: false, visible: false }), hideInLegend: true },
      { id: 'gapEnd', title: 'Gap End', style: plotStyle({ type: 'none', color: GRAY, showLast: false, visible: false }), hideInLegend: true },
      { id: 'gapDir', title: 'Gap Direction', style: plotStyle({ type: 'none', color: GRAY, showLast: false, visible: false }), hideInLegend: true },
    ],
    compute(ctx, inp) {
      const n = ctx.n;
      const gapTop = ta.nanArray(n), gapBottom = ta.nanArray(n), gapEnd = ta.nanArray(n), gapDir = ta.nanArray(n);
      for (const g of detectGaps(ctx, inp)) { gapTop[g.start] = g.top; gapBottom[g.start] = g.bottom; gapEnd[g.start] = g.end >= 0 ? g.end : NaN; gapDir[g.start] = g.up ? 1 : -1; }
      return { upGap: ta.nanArray(n), downGap: ta.nanArray(n), gapTop, gapBottom, gapEnd, gapDir };
    },
    customRender(rc, inst) {
      const gaps = gapsFromResults(inst);
      if (!gaps.length) return;
      const { ctx, timeScale, priceScale, visible, width } = rc;
      const n = inst.results.gapTop?.values.length ?? 0;
      ctx.save();
      for (const g of gaps) {
        const endIdx = g.end >= 0 ? g.end : n - 1;
        if (g.start > visible.to || endIdx < visible.from) continue;
        const st = inst.styles[g.up ? 'upGap' : 'downGap'];
        if (!st || !st.visible) continue;
        const x0 = timeScale.indexToX(g.start);
        const x1 = g.end >= 0 ? timeScale.indexToX(g.end + 1) : Math.max(timeScale.indexToX(n), width);
        const y0 = priceScale.priceToY(g.top), y1 = priceScale.priceToY(g.bottom);
        const top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
        ctx.fillStyle = withAlpha(st.color, 1 - st.transparency / 100);
        ctx.fillRect(x0, top, x1 - x0, h);
        ctx.strokeStyle = withAlpha(st.color, Math.min(1, 2 * (1 - st.transparency / 100)));
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, top + 0.5, Math.max(0, x1 - x0 - 1), Math.max(0, h - 1));
      }
      ctx.restore();
    },
  },
  {
    id: 'Divergence Indicator', name: 'Divergence Indicator', shortName: 'Divergence', category: 'Others', overlay: false, aliases: ['Divergence', 'RSI Divergence'], precision: 2,
    inputs: [
      { id: 'length', name: 'RSI Period', type: 'int', defval: 14, min: 1 },
      { id: 'lbR', name: 'Pivot Lookback Right', type: 'int', defval: 5, min: 1 },
      { id: 'lbL', name: 'Pivot Lookback Left', type: 'int', defval: 5, min: 1 },
      { id: 'rangeUpper', name: 'Max of Lookback Range', type: 'int', defval: 60, min: 1 },
      { id: 'rangeLower', name: 'Min of Lookback Range', type: 'int', defval: 5, min: 0 },
      { id: 'plotBull', name: 'Plot Bullish', type: 'bool', defval: true },
      { id: 'plotHiddenBull', name: 'Plot Hidden Bullish', type: 'bool', defval: false },
      { id: 'plotBear', name: 'Plot Bearish', type: 'bool', defval: true },
      { id: 'plotHiddenBear', name: 'Plot Hidden Bearish', type: 'bool', defval: false },
    ],
    plots: [
      { id: 'rsi', title: 'RSI', style: plotStyle({ color: BLUE }) },
      { id: 'bullLine', title: 'Regular Bullish', style: plotStyle({ color: '#4CAF50', lineWidth: 2, showLast: false }), hideInLegend: true },
      { id: 'bullLabel', title: 'Regular Bullish Label', style: plotStyle({ type: 'shapes', shape: 'labelUp', location: 'absolute', color: '#4CAF50', size: 'small', showLast: false }), hideInLegend: true },
      { id: 'hiddenBullLine', title: 'Hidden Bullish', style: plotStyle({ color: '#4CAF50', lineWidth: 2, showLast: false }), hideInLegend: true },
      { id: 'hiddenBullLabel', title: 'Hidden Bullish Label', style: plotStyle({ type: 'shapes', shape: 'labelUp', location: 'absolute', color: '#4CAF50', transparency: 80, size: 'small', showLast: false }), hideInLegend: true },
      { id: 'bearLine', title: 'Regular Bearish', style: plotStyle({ color: DOWN, lineWidth: 2, showLast: false }), hideInLegend: true },
      { id: 'bearLabel', title: 'Regular Bearish Label', style: plotStyle({ type: 'shapes', shape: 'labelDown', location: 'absolute', color: DOWN, size: 'small', showLast: false }), hideInLegend: true },
      { id: 'hiddenBearLine', title: 'Hidden Bearish', style: plotStyle({ color: DOWN, lineWidth: 2, showLast: false }), hideInLegend: true },
      { id: 'hiddenBearLabel', title: 'Hidden Bearish Label', style: plotStyle({ type: 'shapes', shape: 'labelDown', location: 'absolute', color: DOWN, transparency: 80, size: 'small', showLast: false }), hideInLegend: true },
    ],
    bands: [
      { id: 'upper', title: 'Upper Band', value: 70, color: GRAY, lineStyle: 2, lineWidth: 1, visible: true },
      { id: 'lower', title: 'Lower Band', value: 30, color: GRAY, lineStyle: 2, lineWidth: 1, visible: true },
    ],
    fills: [{ id: 'bg', title: 'Background', a: 'upper', b: 'lower', color: BLUE, transparency: 90, visible: true }],
    compute(ctx, inp) { return divergence(ctx, inp); },
  },
  {
    id: 'Median', name: 'Median', shortName: 'Median', category: 'Others', overlay: true, precision: 'inherit',
    inputs: [
      { id: 'source', name: 'Median Source', type: 'source', defval: 'hl2', options: SOURCES },
      { id: 'length', name: 'Median Length', type: 'int', defval: 3, min: 1 },
      { id: 'atrLength', name: 'ATR Length', type: 'int', defval: 14, min: 1 },
      { id: 'mult', name: 'ATR Multiplier', type: 'float', defval: 2, min: 0, step: 0.1 },
    ],
    plots: [
      { id: 'median', title: 'Median', style: plotStyle({ color: BLUE }) },
      { id: 'ema', title: 'EMA', style: plotStyle({ color: '#FF6D00' }) },
      { id: 'upper', title: 'Upper', style: plotStyle({ color: GRAY, lineStyle: 2 }) },
      { id: 'lower', title: 'Lower', style: plotStyle({ color: GRAY, lineStyle: 2 }) },
      { id: 'emaBelow', title: 'EMA (bull cloud helper)', style: plotStyle({ color: UP, visible: false, showLast: false }), hideInLegend: true },
      { id: 'emaAbove', title: 'EMA (bear cloud helper)', style: plotStyle({ color: '#7E57C2', visible: false, showLast: false }), hideInLegend: true },
    ],
    fills: [
      { id: 'cloudUp', title: 'Cloud (median above EMA)', a: 'median', b: 'emaBelow', color: UP, transparency: 80, visible: true },
      { id: 'cloudDown', title: 'Cloud (EMA above median)', a: 'median', b: 'emaAbove', color: '#7E57C2', transparency: 80, visible: true },
    ],
    compute(ctx, inp) {
      const n = ctx.n;
      const src = ctx.source(inp.source);
      const len = Math.max(1, inp.length | 0);
      const median = ta.percentileNearestRank(src, len, 50);
      const ema = ta.ema(src, len);
      const atr = ta.atr(ctx.high, ctx.low, ctx.close, Math.max(1, inp.atrLength | 0));
      const upper = ta.nanArray(n), lower = ta.nanArray(n), emaBelow = ta.nanArray(n), emaAbove = ta.nanArray(n);
      for (let i = 0; i < n; i++) {
        upper[i] = median[i] + inp.mult * atr[i];
        lower[i] = median[i] - inp.mult * atr[i];
        if (median[i] > ema[i]) emaBelow[i] = ema[i]; else emaAbove[i] = ema[i];
      }
      return { median, ema, upper, lower, emaBelow, emaAbove };
    },
  },
  {
    id: 'Majority Rule', name: 'Majority Rule', shortName: 'Majority Rule', category: 'Others', overlay: false, precision: 2,
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 20, min: 1 }],
    plots: [{ id: 'mr', title: 'majority rule', style: plotStyle({ color: '#FF5252' }) }],
    bands: [{ id: 'mid', title: 'Middle', value: 50, color: GRAY, lineStyle: 2, lineWidth: 1, visible: true }],
    compute(ctx, inp) {
      const n = ctx.n;
      const up = ta.nanArray(n);
      for (let i = 1; i < n; i++) up[i] = ctx.close[i] > ctx.close[i - 1] ? 1 : 0;
      const s = ta.sum(up, inp.length);
      const mr = ta.nanArray(n);
      for (let i = 0; i < n; i++) if (ta.isNum(s[i])) mr[i] = (100 * s[i]) / inp.length;
      return { mr };
    },
  },
  {
    id: 'Performance', name: 'Performance', shortName: 'Performance', category: 'Others', overlay: false, precision: 2,
    description: 'Period returns of the chart symbol as a heat-map row (TradingView also lists other symbols; a symbol list needs a datafeed and is not supported).',
    inputs: [
      { id: 'includeSymbol', name: 'Include chart symbol', type: 'bool', defval: true },
      { id: 'symbols', name: 'Symbol list', type: 'text', defval: '', tooltip: 'Not supported: additional symbols need datafeed access' },
      { id: 'timeframes', name: 'Timeframe list', type: 'text', defval: '1W, 1M, 3M, 6M, YTD, 1Y, 5Y' },
      { id: 'positiveColor', name: 'Positive color', type: 'color', defval: UP },
      { id: 'negativeColor', name: 'Negative color', type: 'color', defval: DOWN },
      { id: 'cutoff', name: 'Color intensity cutoff (%)', type: 'float', defval: 10, min: 0.1 },
      { id: 'tableWidth', name: 'Table width (%)', type: 'int', defval: 100, min: 10, max: 100 },
      { id: 'tableHeight', name: 'Table height (%)', type: 'int', defval: 95, min: 10, max: 100 },
    ],
    plots: [],
    compute(ctx, inp) {
      const periods = parsePeriods(inp.timeframes);
      const values = new Float64Array(periods.length).fill(NaN);
      const texts: Array<string | null> = periods.map((p) => p.label);
      const n = ctx.n;
      if (n > 0 && inp.includeSymbol !== false) {
        const last = n - 1, tLast = ctx.time[last], cLast = ctx.close[last];
        periods.forEach((p, k) => {
          const j = lastBarAtOrBefore(ctx.time, periodStart(tLast, p, ctx.timezone));
          if (j >= 0 && j < last && ctx.close[j] !== 0) values[k] = (100 * (cLast - ctx.close[j])) / ctx.close[j];
        });
      }
      return { table: { values, texts } };
    },
    customRender(rc, inst) {
      const t = inst.results.table;
      if (!t || !t.values.length) return;
      const { ctx, width, height } = rc;
      const inp = inst.inputs;
      const cols = t.values.length;
      const tw = (width * Math.max(10, Math.min(100, +inp.tableWidth || 100))) / 100;
      const th = Math.min(height, (height * Math.max(10, Math.min(100, +inp.tableHeight || 95))) / 100);
      const x0 = (width - tw) / 2, y0 = (height - th) / 2;
      const cw = tw / cols;
      const cutoff = Math.max(0.1, +inp.cutoff || 10);
      ctx.save();
      ctx.textAlign = 'center';
      for (let k = 0; k < cols; k++) {
        const v = t.values[k];
        const x = x0 + k * cw;
        const alpha = v === v ? Math.max(0.08, Math.min(1, Math.abs(v) / cutoff)) : 0.08;
        ctx.fillStyle = withAlpha(v !== v ? GRAY : v >= 0 ? inp.positiveColor || UP : inp.negativeColor || DOWN, alpha);
        ctx.fillRect(x + 1, y0 + 1, cw - 2, th - 2);
        ctx.fillStyle = rc.options.layout.textColor;
        ctx.font = rc.font;
        ctx.textBaseline = 'bottom';
        ctx.fillText(t.texts?.[k] ?? '', x + cw / 2, y0 + th / 2 - 2);
        ctx.textBaseline = 'top';
        ctx.font = `bold ${rc.font}`;
        ctx.fillText(v === v ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '∅', x + cw / 2, y0 + th / 2 + 2);
      }
      ctx.restore();
    },
  },
  {
    id: 'Visible Average Price', name: 'Visible Average Price', shortName: 'Visible Avg', category: 'Others', overlay: true, precision: 'inherit',
    inputs: [{ id: 'source', name: 'Source', type: 'source', defval: 'close', options: SOURCES }],
    plots: [{ id: 'avg', title: 'Avg Price', style: plotStyle({ type: 'none', color: BLUE, lineStyle: 0, showLast: false }), hideInLegend: true }],
    compute() { return {}; },
    customRender(rc, inst) {
      const bars = mainBarsOf(rc);
      if (!bars) return;
      const { visible, ctx, width, priceScale, dpr } = rc;
      const src = (inst.inputs.source || 'close') as PriceSource;
      let s = 0, c = 0;
      for (let i = Math.max(0, visible.from); i <= Math.min(bars.length - 1, visible.to); i++) {
        const v = priceSourceValue(bars[i], src);
        if (Number.isFinite(v)) { s += v; c++; }
      }
      if (!c) return;
      const avg = s / c;
      const st = inst.styles.avg;
      if (!st || !st.visible) return;
      const y = Math.round(priceScale.priceToY(avg) * dpr) / dpr + 0.5 / dpr;
      ctx.save();
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.lineWidth;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      drawLabelBox(ctx, `Avg ${priceScale.formatPrice(avg)}`, width - 4, y, { font: rc.font, bg: st.color, color: '#fff', align: 'right', vAlign: 'middle', radius: 2 });
      ctx.restore();
    },
  },
  {
    id: 'Advance/Decline', name: 'Advance/Decline', shortName: 'A/D', category: 'Others', overlay: false, aliases: ['Advance Decline', 'Advance/Decline Ratio (Bars)'], precision: 2,
    description: 'Charting-library study: up bars / down bars over the last N bars of the chart symbol (not the exchange-breadth A/D line).',
    inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 10, min: 1, max: 2000 }],
    plots: [{ id: 'ad', title: 'Advance/Decline', style: plotStyle({ color: '#2196F3' }) }],
    compute(ctx, inp) {
      const n = ctx.n;
      const up = ta.nanArray(n), dn = ta.nanArray(n);
      for (let i = 1; i < n; i++) { up[i] = ctx.close[i] > ctx.close[i - 1] ? 1 : 0; dn[i] = ctx.close[i] < ctx.close[i - 1] ? 1 : 0; }
      const su = ta.sum(up, inp.length), sd = ta.sum(dn, inp.length);
      const ad = ta.nanArray(n);
      for (let i = 0; i < n; i++) if (ta.isNum(su[i]) && sd[i] > 0) ad[i] = su[i] / sd[i];
      return { ad };
    },
  },
];
