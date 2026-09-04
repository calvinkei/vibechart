/**
 * DOM-side helpers shared by the dialogs: style injection, datetime inputs, notes,
 * and the small "emulations" of core hooks that do not exist yet (precision override,
 * indicator interval visibility, drawing default templates).
 */
import type { Chart } from '../../core/Chart';
import type { IndicatorInstance } from '../../indicators/Indicator';
import type { DrawingVisibility } from '../../drawings/Drawing';
import { defaultVisibility } from '../../drawings/Drawing';
import { el, injectStyle } from '../../util/dom';
import { dateParts, partsToTime, resolveTimezone, pad2 } from '../../util/time';
import { readJson, visibleForResolution } from './helpers';
import css from './dialogs.css?inline';

export const DIALOG_STYLE_ID = 'vibechart-dialogs-style';

/** Inject dialogs.css once. `injectStyle` short-circuits after the base stylesheet was injected (global flag), so fall back to a manual append. */
export function injectDialogStyles(): void {
  if (typeof document === 'undefined') return;
  injectStyle(css, DIALOG_STYLE_ID);
  if (!document.getElementById(DIALOG_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = DIALOG_STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }
}

/** Effective chart timezone (IANA). */
export function chartTimezone(chart: Chart): string {
  return resolveTimezone(chart.options.symbol.timezone, chart.symbolInfo?.timezone);
}

/** unix seconds -> "yyyy-MM-ddTHH:mm[:ss]" in tz (for <input type=datetime-local>) */
export function timeToLocalInput(time: number, tz: string, seconds = false): string {
  const p = dateParts(time, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}${seconds ? `:${pad2(p.second)}` : ''}`;
}
/** unix seconds -> "yyyy-MM-dd" in tz */
export function timeToDateInput(time: number, tz: string): string {
  const p = dateParts(time, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}
/** unix seconds -> "HH:mm" in tz */
export function timeToTimeInput(time: number, tz: string): string {
  const p = dateParts(time, tz);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}
/** "yyyy-MM-dd[THH:mm[:ss]]" (+ optional separate "HH:mm") in tz -> unix seconds, or null when invalid */
export function localInputToTime(value: string, tz: string, timeValue?: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  let hour = m[4] ? +m[4] : 0, minute = m[5] ? +m[5] : 0, second = m[6] ? +m[6] : 0;
  if (timeValue) {
    const t = timeValue.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (t) { hour = +t[1]; minute = +t[2]; second = t[3] ? +t[3] : 0; }
  }
  return partsToTime({ year: +m[1], month: +m[2], day: +m[3], hour, minute, second }, tz);
}

export function note(text: string): HTMLElement {
  return el('div', { class: 'vc-dlg-note', text });
}

/** Native date/time input styled like vc-input. */
export function dateTimeInput(type: 'date' | 'time' | 'datetime-local', value: string, onChange: (v: string) => void, opts: { step?: number } = {}): HTMLInputElement {
  const inp = el('input', { class: 'vc-input', type, value });
  if (opts.step !== undefined) inp.step = String(opts.step);
  inp.addEventListener('change', () => onChange(inp.value));
  inp.addEventListener('keydown', (e) => { if (e.key !== 'Escape' && e.key !== 'Enter') e.stopPropagation(); });
  return inp;
}

/** Range slider with a % label (used for transparency/opacity). */
export function rangeInput(value: number, onChange: (v: number) => void, opts: { min?: number; max?: number; step?: number; suffix?: string } = {}): HTMLElement {
  const wrap = el('span', { class: 'vc-dlg-inline' });
  const inp = el('input', { class: 'vc-dlg-range', type: 'range', min: String(opts.min ?? 0), max: String(opts.max ?? 100), step: String(opts.step ?? 1) });
  inp.value = String(value);
  const lab = el('span', { class: 'vc-dlg-range-val', text: `${value}${opts.suffix ?? '%'}` });
  inp.addEventListener('input', () => { lab.textContent = `${inp.value}${opts.suffix ?? '%'}`; onChange(+inp.value); });
  inp.addEventListener('keydown', (e) => e.stopPropagation());
  wrap.appendChild(inp);
  wrap.appendChild(lab);
  return wrap;
}

// ---- emulated core hooks ----------------------------------------------------------------------

/**
 * Precision override. The core derives precision from `symbolInfo.pricescale` and ignores
 * `options.symbol.precision`, so we push the format into the main series / axis / inheriting indicators ourselves.
 */
export function applyPrecision(chart: Chart, p: 'default' | number): void {
  const m = chart.model;
  m.options.symbol.precision = p;
  const ms = m.mainSeries;
  if (p === 'default') ms.setSymbolInfo(chart.symbolInfo);
  else ms.priceFormat = { ...ms.priceFormat, precision: p, minMove: 1, fractional: false };
  m.mainPane.right.setPriceFormat(ms.priceFormat);
  m.mainPane.getPriceScale('left').setPriceFormat(ms.priceFormat);
  for (const ind of m.indicators) if (ind.def.precision === 'inherit' || ind.def.precision === undefined) ind.priceFormat = ms.priceFormat;
  m.invalidate('full');
}

/** Per-instance interval visibility for indicators (not in core): stored on the instance as `visibility`. */
export function indicatorVisibility(inst: IndicatorInstance): DrawingVisibility {
  const anyInst = inst as unknown as { visibility?: DrawingVisibility };
  if (!anyInst.visibility) anyInst.visibility = defaultVisibility();
  return anyInst.visibility;
}

const visibilityHookInstalled = new WeakSet<Chart>();
/** Re-evaluate indicator interval visibility whenever the interval changes (emulation of TV's Visibility tab). */
export function ensureIndicatorVisibilityHook(chart: Chart): void {
  if (visibilityHookInstalled.has(chart)) return;
  visibilityHookInstalled.add(chart);
  chart.subscribe('intervalChanged', () => applyIndicatorVisibility(chart));
}

export function applyIndicatorVisibility(chart: Chart): void {
  const sec = chart.model.resolutionSeconds();
  let changed = false;
  for (const inst of chart.model.indicators) {
    const v = (inst as unknown as { visibility?: DrawingVisibility }).visibility;
    if (!v) continue;
    const show = visibleForResolution(v, sec);
    if (inst.visible !== show) { inst.visible = show; changed = true; }
  }
  if (changed) chart.model.invalidate('full');
}

export const drawingDefaultsKey = (toolId: string): string => `oc.drawingDefaults.${toolId}`;

const defaultsHookInstalled = new WeakSet<Chart>();
/** Apply saved per-tool style templates ('Save as default') to newly created drawings. */
export function installDrawingDefaultsHook(chart: Chart): void {
  if (defaultsHookInstalled.has(chart)) return;
  defaultsHookInstalled.add(chart);
  chart.drawings.created.subscribe((d) => {
    const saved = readJson<Record<string, unknown> | null>(drawingDefaultsKey(d.type), null);
    if (saved && typeof saved === 'object') chart.drawings.updateStyle(d, saved, false);
  });
}
