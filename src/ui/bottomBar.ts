/**
 * Bottom toolbar: date-range buttons (1D 5D 1M 3M 6M YTD 1Y 5Y All) + Go to date on the left;
 * clock (chart timezone) with timezone dropdown and % / log / auto toggles on the right.
 */
import type { Chart } from '../core/Chart';
import { normalizeResolution, parseResolution } from '../data/resolution';
import type { ResolutionString } from '../data/types';
import { el } from '../util/dom';
import { dateParts, formatTime, pad2, partsToTime, tzOffset } from '../util/time';
import { dropdown } from './components';
import { ICONS } from './icons';
import { openDialog } from './dialogs/index';
import { isResolutionSupported } from './topToolbar';
import { altKey, timezoneMenuItems } from './util';

export interface DateRange {
  label: string;
  title: string;
  res: ResolutionString;
  days: number | 'ytd' | 'all';
  /** Hidden first when the bar is too narrow to show every range. */
  secondary?: boolean;
}

/** TradingView bottom-bar ranges and the resolution each one switches to. */
export const DATE_RANGES: DateRange[] = [
  { label: '1D', title: '1 day in 1 minute intervals', res: '1', days: 1 },
  { label: '5D', title: '5 days in 5 minute intervals', res: '5', days: 5, secondary: true },
  { label: '1M', title: '1 month in 30 minute intervals', res: '30', days: 30 },
  { label: '3M', title: '3 months in 1 hour intervals', res: '60', days: 91 },
  { label: '6M', title: '6 months in 2 hour intervals', res: '120', days: 182, secondary: true },
  { label: 'YTD', title: 'Year to date in 1 day intervals', res: '1D', days: 'ytd', secondary: true },
  { label: '1Y', title: '1 year in 1 day intervals', res: '1D', days: 365 },
  { label: '5Y', title: '5 years in 1 week intervals', res: '1W', days: 5 * 365, secondary: true },
  { label: 'All', title: 'All data in 1 month intervals', res: '1M', days: 'all' },
];

/** Closest supported resolution (log-distance in seconds) when `res` is not supported by the symbol. */
export function nearestSupportedResolution(res: ResolutionString, supported?: ResolutionString[] | null): ResolutionString {
  if (isResolutionSupported(res, supported)) return normalizeResolution(res);
  const target = parseResolution(res).seconds;
  let best: ResolutionString | null = null;
  let bestD = Infinity;
  for (const s of supported ?? []) {
    const d = Math.abs(Math.log(parseResolution(s).seconds / target));
    if (d < bestD) { bestD = d; best = s; }
  }
  return best ? normalizeResolution(best) : normalizeResolution(res);
}

/** "UTC", "UTC+8", "UTC-5", "UTC+5:30" */
export function formatUtcOffset(offsetSec: number): string {
  const sign = offsetSec < 0 ? '-' : '+';
  const abs = Math.abs(Math.round(offsetSec));
  const h = Math.floor(abs / 3600);
  const m = Math.round((abs % 3600) / 60);
  if (h === 0 && m === 0) return 'UTC';
  return `UTC${sign}${h}${m ? `:${pad2(m)}` : ''}`;
}

/** Seconds covered by a range ending at `end` (null for "All"). */
export function rangeSpanSeconds(r: DateRange, end: number, tz: string): number | null {
  if (r.days === 'all') return null;
  if (r.days === 'ytd') {
    const p = dateParts(end, tz);
    const start = partsToTime({ year: p.year, month: 1, day: 1 }, tz);
    return Math.max(86400, end - start);
  }
  return r.days * 86400;
}

export interface BottomBar { render(): void; update(): void; destroy(): void }

export function createBottomBar(chart: Chart): BottomBar {
  const host = chart.bottomBarEl;
  const root = chart.root;
  let activeRange: string | null = null;
  let expectedInterval: ResolutionString | null = null;
  let clockEl: HTMLButtonElement | null = null;
  let pctBtn: HTMLButtonElement | null = null;
  let logBtn: HTMLButtonElement | null = null;
  let autoBtn: HTMLButtonElement | null = null;
  let rangeBtns: HTMLButtonElement[] = [];
  let scaleUnsub: (() => void) | null = null;
  const unsubs: Array<() => void> = [];

  const mainScale = () => chart.model.mainPane.mainScale;

  function markRanges(): void {
    for (const b of rangeBtns) b.classList.toggle('vc-active', b.textContent === activeRange);
  }

  async function applyRange(r: DateRange): Promise<void> {
    activeRange = r.label;
    markRanges();
    const res = nearestSupportedResolution(r.res, chart.symbolInfo?.supported_resolutions);
    if (res !== normalizeResolution(chart.interval)) {
      expectedInterval = res;
      await chart.setResolution(res);
    }
    if (activeRange !== r.label) return;
    const bars = chart.model.bars;
    if (!bars.length) return;
    const ts = chart.model.timeScale;
    const end = bars[bars.length - 1].time;
    const span = rangeSpanSeconds(r, end, chart.model.timezone);
    if (span === null) { ts.fitContent(); return; }
    chart.timeScale().setVisibleRange(end - span, end);
  }

  function updateClock(): void {
    if (!clockEl) return;
    const now = Math.floor(Date.now() / 1000);
    const tz = chart.model.timezone;
    const p = dateParts(now, tz);
    clockEl.textContent = `${formatTime(p, true)} (${formatUtcOffset(tzOffset(now, tz))})`;
  }

  function updateScaleButtons(): void {
    const ps = mainScale();
    pctBtn?.classList.toggle('vc-active', ps.mode === 'percentage');
    logBtn?.classList.toggle('vc-active', ps.mode === 'logarithmic');
    autoBtn?.classList.toggle('vc-active', ps.isAutoScale);
  }

  function bindScale(): void {
    scaleUnsub?.();
    scaleUnsub = mainScale().changed.subscribe(updateScaleButtons);
  }

  let leftEl: HTMLElement | null = null;
  /** Drop the secondary ranges when the range row overflows; whatever still overflows scrolls. */
  function relayout(): void {
    if (!leftEl) return;
    host.classList.remove('vc-bb-compact');
    if (leftEl.scrollWidth > leftEl.clientWidth + 1) host.classList.add('vc-bb-compact');
  }
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => relayout()) : null;
  resizeObserver?.observe(host);

  function render(): void {
    host.innerHTML = '';
    rangeBtns = [];
    const o = chart.options;
    const left = el('div', { class: 'vc-bb-left' });
    leftEl = left;
    if (o.navigation.dateRanges) {
      for (const r of DATE_RANGES) {
        const b = el('button', { class: 'vc-range-btn', text: r.label, title: r.title });
        if (r.secondary) b.dataset.prio = '2';
        b.addEventListener('click', () => { void applyRange(r); });
        rangeBtns.push(b);
        left.appendChild(b);
      }
      const go = el('button', { class: 'vc-range-btn vc-goto-btn', html: ICONS.calendar, title: `Go to date (${altKey()}+G)` });
      go.addEventListener('click', () => openDialog(chart, 'goToDate'));
      left.appendChild(go);
      markRanges();
    }
    const right = el('div', { class: 'vc-bb-right' });
    clockEl = el('button', { class: 'vc-range-btn vc-clock-btn', title: 'Time zone' });
    if (o.navigation.timezoneMenu) dropdown(clockEl, root, () => timezoneMenuItems(chart), { align: 'right' });
    else clockEl.style.cursor = 'default';
    right.appendChild(clockEl);
    right.appendChild(el('span', { class: 'vc-sep' }));
    const toggle = (mode: 'percentage' | 'logarithmic') => () => { const ps = mainScale(); ps.setMode(ps.mode === mode ? 'normal' : mode); chart.requestRender('full'); };
    pctBtn = el('button', { class: 'vc-range-btn vc-scale-btn', text: '%', title: `Toggle percentage scale (${altKey()}+P)` });
    pctBtn.addEventListener('click', toggle('percentage'));
    logBtn = el('button', { class: 'vc-range-btn vc-scale-btn', text: 'log', title: `Toggle logarithmic scale (${altKey()}+L)` });
    logBtn.addEventListener('click', toggle('logarithmic'));
    autoBtn = el('button', { class: 'vc-range-btn vc-scale-btn', text: 'auto', title: `Toggle auto scale (${altKey()}+A)` });
    autoBtn.addEventListener('click', () => { const ps = mainScale(); ps.setAutoScale(!ps.isAutoScale); chart.requestRender('full'); });
    right.appendChild(pctBtn);
    right.appendChild(logBtn);
    right.appendChild(autoBtn);
    host.appendChild(left);
    host.appendChild(right);
    updateClock();
    updateScaleButtons();
    bindScale();
    relayout();
  }

  const timer = window.setInterval(updateClock, 1000);
  unsubs.push(chart.subscribe('intervalChanged', (res) => {
    if (expectedInterval && normalizeResolution(res) === expectedInterval) { expectedInterval = null; return; }
    if (activeRange) { activeRange = null; markRanges(); }
  }));
  unsubs.push(chart.subscribe('symbolChanged', () => updateClock()));
  unsubs.push(chart.subscribe('visibleRangeChanged', () => updateScaleButtons()));

  return {
    render,
    update() { updateClock(); updateScaleButtons(); },
    destroy() {
      clearInterval(timer);
      resizeObserver?.disconnect();
      scaleUnsub?.();
      for (const u of unsubs) u();
      host.innerHTML = '';
    },
  };
}
