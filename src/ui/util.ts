/**
 * Small helpers shared by the UI chrome modules: persisted preferences (localStorage, `oc.` prefix),
 * toasts, confirm dialog, platform key names, shared menu builders.
 */
import type { Chart } from '../core/Chart';
import { el, isMac } from '../util/dom';
import { TIMEZONES } from '../util/time';
import { Dialog, type MenuItem } from './components';
import { ICONS } from './icons';

const PREFIX = 'oc.';

export function loadPref<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === undefined || value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, quota) */
  }
}

/** Toggle `value` inside a persisted string list; returns the new list. */
export function toggleInList(key: string, value: string, fallback: string[] = []): string[] {
  const list = loadPref<string[]>(key, fallback).slice();
  const i = list.indexOf(value);
  if (i >= 0) list.splice(i, 1);
  else list.push(value);
  savePref(key, list);
  return list;
}

export function modKey(): string { return isMac() ? '⌘' : 'Ctrl'; }
export function altKey(): string { return isMac() ? '⌥' : 'Alt'; }
export function shiftKey(): string { return isMac() ? '⇧' : 'Shift'; }

let toastTimer = 0;
/** Small transient message at the bottom of the chart root. */
export function toast(root: HTMLElement, text: string, ms = 2500): void {
  root.querySelector('.oc-toast')?.remove();
  const t = el('div', { class: 'oc-toast', text });
  root.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), ms);
}

/** Simple OK / Cancel confirmation using the shared Dialog widget. */
export function confirmDialog(container: HTMLElement, title: string, message: string, okLabel = 'OK'): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v); } };
    const dlg = new Dialog({
      title,
      container,
      width: 380,
      className: 'oc-confirm',
      buttons: [
        { label: 'Cancel', onClick: (d) => { finish(false); d.close(); } },
        { label: okLabel, primary: true, onClick: (d) => { finish(true); d.close(); } },
      ],
      onClose: () => finish(false),
    });
    dlg.body.appendChild(el('div', { class: 'oc-confirm-text', text: message }));
  });
}

/** Timezone submenu items (shared by the time-axis menu and the bottom bar). */
export function timezoneMenuItems(chart: Chart): MenuItem[] {
  const current = chart.model.options.symbol.timezone || 'exchange';
  const exchangeTz = chart.symbolInfo?.timezone;
  return TIMEZONES.map((tz) => ({
    label: tz.id === 'exchange' ? `Exchange${exchangeTz ? ` (${exchangeTz})` : ''}` : tz.name,
    checked: tz.id === current,
    onClick: () => chart.setTimezone(tz.id),
  }));
}

/** A menu row element: [check] [icon] label [shortcut] [★]. Used for rows that need a favourite star. */
export function menuRow(opts: { label: string; icon?: string; checked?: boolean; shortcut?: string; star?: { active: boolean; onToggle: (active: boolean) => void } }): HTMLElement {
  const row = el('span', { class: 'oc-menu-row' });
  if (opts.checked !== undefined) row.appendChild(el('span', { class: 'oc-check', text: opts.checked ? '✓' : '' }));
  if (opts.icon) {
    const svg = ICONS[opts.icon] ?? (opts.icon.startsWith('<svg') ? opts.icon : '');
    if (svg) row.appendChild(el('span', { class: 'oc-icon', style: 'width:18px;height:18px', html: svg }));
  }
  row.appendChild(el('span', { class: 'oc-menu-label', text: opts.label }));
  if (opts.shortcut) row.appendChild(el('span', { class: 'oc-shortcut', text: opts.shortcut }));
  if (opts.star) {
    let active = opts.star.active;
    const star = el('span', { class: `oc-fav ${active ? 'oc-active' : ''}`, html: ICONS[active ? 'starFilled' : 'star'], title: active ? 'Remove from favorites' : 'Add to favorites' });
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      active = !active;
      star.classList.toggle('oc-active', active);
      star.innerHTML = ICONS[active ? 'starFilled' : 'star'];
      opts.star!.onToggle(active);
    });
    star.addEventListener('mousedown', (e) => e.stopPropagation());
    row.appendChild(star);
  }
  return row;
}
