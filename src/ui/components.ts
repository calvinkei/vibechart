/**
 * Reusable DOM widgets: menus, dialogs, color picker, form controls, tooltips.
 * Pure DOM, no framework. Styles live in styles.css (vc-* classes).
 */
import { el, placeFloating } from '../util/dom';
import { COLOR_SWATCHES } from '../core/options';
import { parseColor, toHex, toRgbaString } from '../util/color';
import type { PropertyDef, FibLevel } from '../drawings/Drawing';
import { ICONS } from './icons';

// ---------------------------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------------------------
export interface MenuItem {
  label?: string;
  icon?: string; // ICONS key or raw svg
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  /** Section title (non-clickable) */
  title?: boolean;
  submenu?: MenuItem[];
  onClick?: (ev: MouseEvent) => void;
  keepOpen?: boolean;
  color?: string;
  /** custom element rendered instead of label */
  element?: HTMLElement;
}

interface OpenMenu { el: HTMLElement; close(): void; parent?: OpenMenu }
const openMenus: OpenMenu[] = [];

export function closeAllMenus(): void {
  for (const m of openMenus.slice()) m.close();
}

function iconHtml(name?: string): string {
  if (!name) return '';
  const svg = ICONS[name] ?? (name.startsWith('<svg') ? name : '');
  return svg ? `<span class="vc-icon" style="width:18px;height:18px">${svg}</span>` : '';
}

export function showMenu(container: HTMLElement, x: number, y: number, items: MenuItem[], opts: { parent?: OpenMenu; anchor?: HTMLElement; minWidth?: number; className?: string } = {}): OpenMenu {
  if (!opts.parent) closeAllMenus();
  const menu = el('div', { class: `vc-menu ${opts.className ?? ''}` });
  if (opts.minWidth) menu.style.minWidth = `${opts.minWidth}px`;
  let sub: OpenMenu | null = null;
  const handle: OpenMenu = {
    el: menu,
    parent: opts.parent,
    close() {
      sub?.close();
      menu.remove();
      const i = openMenus.indexOf(handle);
      if (i >= 0) openMenus.splice(i, 1);
      if (openMenus.length === 0) {
        document.removeEventListener('mousedown', onDoc, true);
        document.removeEventListener('keydown', onKey, true);
      }
    },
  };
  for (const it of items) {
    if (it.separator) { menu.appendChild(el('div', { class: 'vc-menu-sep' })); continue; }
    if (it.title) { menu.appendChild(el('div', { class: 'vc-menu-title', text: it.label ?? '' })); continue; }
    const row = el('div', { class: `vc-menu-item ${it.disabled ? 'vc-disabled' : ''}` });
    if (it.element) row.appendChild(it.element);
    else {
      row.innerHTML = `${it.checked !== undefined ? `<span class="vc-check">${it.checked ? '✓' : ''}</span>` : ''}${iconHtml(it.icon)}<span class="vc-menu-label"${it.color ? ` style="color:${it.color}"` : ''}>${escapeHtml(it.label ?? '')}</span>${it.shortcut ? `<span class="vc-shortcut">${escapeHtml(it.shortcut)}</span>` : ''}${it.submenu ? '<span class="vc-shortcut">›</span>' : ''}`;
    }
    row.addEventListener('mousedown', (e) => e.stopPropagation());
    if (it.submenu) {
      row.addEventListener('mouseenter', () => {
        sub?.close();
        const r = row.getBoundingClientRect();
        const c = container.getBoundingClientRect();
        sub = showMenu(container, r.right - c.left, r.top - c.top, it.submenu!, { parent: handle });
      });
    } else {
      row.addEventListener('mouseenter', () => { sub?.close(); sub = null; });
      row.addEventListener('click', (e) => {
        if (it.disabled) return;
        it.onClick?.(e);
        if (!it.keepOpen) closeAllMenus();
      });
    }
    menu.appendChild(row);
  }
  container.appendChild(menu);
  placeFloating(menu, x, y, container);
  openMenus.push(handle);
  if (openMenus.length === 1) {
    setTimeout(() => {
      document.addEventListener('mousedown', onDoc, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  }
  return handle;
}

function onDoc(e: MouseEvent): void {
  if (openMenus.some((m) => m.el.contains(e.target as Node))) return;
  closeAllMenus();
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeAllMenus();
}

/** Attach a dropdown menu to a button. */
export function dropdown(button: HTMLElement, container: HTMLElement, items: () => MenuItem[], opts: { align?: 'left' | 'right' } = {}): void {
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openMenus.length && openMenus[0].el.dataset.owner === button.dataset.uid) { closeAllMenus(); return; }
    const r = button.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const m = showMenu(container, r.left - c.left, r.bottom - c.top + 2, items(), { anchor: button });
    if (!button.dataset.uid) button.dataset.uid = String(Math.random());
    m.el.dataset.owner = button.dataset.uid;
    if (opts.align === 'right') {
      m.el.style.left = `${Math.max(4, r.right - c.left - m.el.offsetWidth)}px`;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------------------------
let tipEl: HTMLElement | null = null;
let tipTimer = 0;
export function tooltip(target: HTMLElement, text: string | (() => string), container?: HTMLElement): void {
  target.addEventListener('mouseenter', () => {
    clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => {
      const t = typeof text === 'function' ? text() : text;
      if (!t) return;
      tipEl?.remove();
      tipEl = el('div', { class: 'vc-tooltip', text: t });
      const host = container ?? document.body;
      host.appendChild(tipEl);
      const r = target.getBoundingClientRect();
      const c = host === document.body ? { left: -window.scrollX, top: -window.scrollY } : host.getBoundingClientRect();
      tipEl.style.left = `${r.left - c.left}px`;
      tipEl.style.top = `${r.bottom - c.top + 4}px`;
    }, 400);
  });
  const hide = () => { clearTimeout(tipTimer); tipEl?.remove(); tipEl = null; };
  target.addEventListener('mouseleave', hide);
  target.addEventListener('mousedown', hide);
}

// ---------------------------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------------------------
export interface DialogButton { label: string; primary?: boolean; onClick: (dlg: Dialog) => void; left?: boolean }
export interface DialogOptions {
  title: string;
  container: HTMLElement;
  width?: number;
  tabs?: string[];
  buttons?: DialogButton[];
  onClose?: () => void;
  modal?: boolean;
  className?: string;
  /** initial position (relative to container); default centered */
  x?: number;
  y?: number;
}

const openDialogs: Dialog[] = [];
export function closeAllDialogs(): void { for (const d of openDialogs.slice()) d.close(); }

export class Dialog {
  readonly el: HTMLDivElement;
  readonly backdrop: HTMLDivElement | null;
  readonly body: HTMLDivElement;
  readonly header: HTMLDivElement;
  readonly footer: HTMLDivElement | null;
  private _tabs = new Map<string, HTMLDivElement>();
  private _tabButtons = new Map<string, HTMLButtonElement>();
  private _closed = false;
  activeTab = '';

  constructor(readonly opts: DialogOptions) {
    this.el = el('div', { class: `vc-dialog ${opts.className ?? ''}` });
    if (opts.width) this.el.style.width = `${opts.width}px`;
    this.header = el('div', { class: 'vc-dialog-header' }, [el('span', { text: opts.title })]);
    const closeBtn = el('button', { class: 'vc-dialog-close', html: ICONS.close, title: 'Close' });
    closeBtn.style.width = '28px';
    closeBtn.addEventListener('click', () => this.close());
    this.header.appendChild(closeBtn);
    this.el.appendChild(this.header);
    if (opts.tabs?.length) {
      const tabs = el('div', { class: 'vc-tabs' });
      for (const t of opts.tabs) {
        const b = el('button', { class: 'vc-tab', text: t });
        b.addEventListener('click', () => this.setTab(t));
        tabs.appendChild(b);
        this._tabButtons.set(t, b);
      }
      this.el.appendChild(tabs);
    }
    this.body = el('div', { class: 'vc-dialog-body' });
    this.el.appendChild(this.body);
    if (opts.tabs?.length) {
      for (const t of opts.tabs) {
        const pane = el('div', { class: 'vc-tab-pane' });
        pane.style.display = 'none';
        this.body.appendChild(pane);
        this._tabs.set(t, pane);
      }
    }
    if (opts.buttons?.length) {
      this.footer = el('div', { class: 'vc-dialog-footer' });
      for (const b of opts.buttons) {
        const btn = el('button', { class: b.primary ? 'vc-primary' : 'vc-secondary', text: b.label });
        if (b.left) btn.classList.add('vc-left');
        btn.addEventListener('click', () => b.onClick(this));
        this.footer.appendChild(btn);
      }
      this.el.appendChild(this.footer);
    } else this.footer = null;
    if (opts.modal !== false) {
      this.backdrop = el('div', { class: 'vc-dialog-backdrop' });
      this.backdrop.style.position = 'absolute';
      this.backdrop.addEventListener('mousedown', (e) => { if (e.target === this.backdrop) this.close(); });
      this.backdrop.appendChild(this.el);
      opts.container.appendChild(this.backdrop);
    } else {
      this.backdrop = null;
      this.el.style.position = 'absolute';
      this.el.style.zIndex = '1000';
      opts.container.appendChild(this.el);
      const cw = opts.container.clientWidth, ch = opts.container.clientHeight;
      this.el.style.left = `${opts.x ?? Math.max(0, (cw - this.el.offsetWidth) / 2)}px`;
      this.el.style.top = `${opts.y ?? Math.max(0, (ch - this.el.offsetHeight) / 2)}px`;
    }
    this._makeDraggable();
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
    this.el.tabIndex = -1;
    openDialogs.push(this);
    if (opts.tabs?.length) this.setTab(opts.tabs[0]);
    setTimeout(() => this.el.focus(), 0);
  }

  tab(name: string): HTMLDivElement { return this._tabs.get(name) ?? this.body; }

  setTab(name: string): void {
    this.activeTab = name;
    for (const [n, pane] of this._tabs) pane.style.display = n === name ? '' : 'none';
    for (const [n, b] of this._tabButtons) b.classList.toggle('vc-active', n === name);
  }

  private _makeDraggable(): void {
    let start: { x: number; y: number; left: number; top: number } | null = null;
    this.header.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const target = this.el;
      const r = target.getBoundingClientRect();
      const pr = (this.backdrop ?? this.opts.container).getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left - pr.left, top: r.top - pr.top };
      if (this.backdrop) { this.backdrop.style.display = 'block'; target.style.position = 'absolute'; }
      target.style.left = `${start.left}px`;
      target.style.top = `${start.top}px`;
      target.style.margin = '0';
      const move = (ev: MouseEvent) => {
        if (!start) return;
        target.style.left = `${start.left + ev.clientX - start.x}px`;
        target.style.top = `${start.top + ev.clientY - start.y}px`;
      };
      const up = () => { start = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      e.preventDefault();
    });
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    (this.backdrop ?? this.el).remove();
    const i = openDialogs.indexOf(this);
    if (i >= 0) openDialogs.splice(i, 1);
    this.opts.onClose?.();
  }

  get isOpen(): boolean { return !this._closed; }
}

// ---------------------------------------------------------------------------------------------
// Color picker
// ---------------------------------------------------------------------------------------------
let colorPopup: HTMLElement | null = null;
function closeColorPopup(): void { colorPopup?.remove(); colorPopup = null; document.removeEventListener('mousedown', onColorDoc, true); }
function onColorDoc(e: MouseEvent): void { if (colorPopup && !colorPopup.contains(e.target as Node)) closeColorPopup(); }

export function showColorPicker(anchor: HTMLElement, current: string, onChange: (color: string) => void, opts: { opacity?: boolean; container?: HTMLElement } = {}): void {
  closeColorPopup();
  const container = opts.container ?? anchor.closest('.vc-root') as HTMLElement ?? document.body;
  const popup = el('div', { class: 'vc-color-popup' });
  const cur = parseColor(current);
  let alpha = cur.a;
  let rgb = { r: cur.r, g: cur.g, b: cur.b };
  const emit = () => onChange(alpha >= 1 ? toHex({ ...rgb, a: 1 }) : toRgbaString({ ...rgb, a: alpha }));
  const grid = el('div', { class: 'vc-swatches' });
  for (const sw of COLOR_SWATCHES) {
    const c = el('div', { class: 'vc-swatch', title: sw });
    c.style.background = sw;
    if (toHex({ ...rgb, a: 1 }).toUpperCase() === sw.toUpperCase()) c.classList.add('vc-active');
    c.addEventListener('click', () => {
      const p = parseColor(sw);
      rgb = { r: p.r, g: p.g, b: p.b };
      grid.querySelectorAll('.vc-swatch').forEach((x) => x.classList.remove('vc-active'));
      c.classList.add('vc-active');
      emit();
    });
    grid.appendChild(c);
  }
  popup.appendChild(grid);
  const row = el('div', { class: 'vc-opacity' });
  const native = el('input', { type: 'color', value: toHex({ ...rgb, a: 1 }), title: 'Custom color' });
  native.style.width = '28px';
  native.style.height = '24px';
  native.addEventListener('input', () => { const p = parseColor(native.value); rgb = { r: p.r, g: p.g, b: p.b }; emit(); });
  const hex = el('input', { class: 'vc-input', value: toHex({ ...rgb, a: 1 }) });
  hex.style.width = '84px';
  hex.addEventListener('change', () => { const p = parseColor(hex.value); rgb = { r: p.r, g: p.g, b: p.b }; native.value = toHex({ ...rgb, a: 1 }); emit(); });
  row.appendChild(native);
  row.appendChild(hex);
  popup.appendChild(row);
  if (opts.opacity !== false) {
    const orow = el('div', { class: 'vc-opacity' });
    const label = el('span', { text: 'Opacity' });
    const range = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(alpha * 100)) });
    const val = el('span', { text: `${Math.round(alpha * 100)}%` });
    range.addEventListener('input', () => { alpha = +range.value / 100; val.textContent = `${range.value}%`; emit(); });
    orow.appendChild(label); orow.appendChild(range); orow.appendChild(val);
    popup.appendChild(orow);
  }
  popup.addEventListener('mousedown', (e) => e.stopPropagation());
  container.appendChild(popup);
  const r = anchor.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  placeFloating(popup, r.left - c.left, r.bottom - c.top + 4, container);
  colorPopup = popup;
  setTimeout(() => document.addEventListener('mousedown', onColorDoc, true), 0);
}

export function colorButton(value: string, onChange: (c: string) => void, opts: { opacity?: boolean } = {}): HTMLButtonElement {
  const btn = el('button', { class: 'vc-color-btn', title: value });
  const inner = el('span');
  inner.style.background = value;
  btn.appendChild(inner);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    showColorPicker(btn, value, (c) => { value = c; inner.style.background = c; btn.title = c; onChange(c); }, opts);
  });
  return btn;
}

// ---------------------------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------------------------
export function numberInput(value: number, onChange: (v: number) => void, opts: { min?: number; max?: number; step?: number; int?: boolean } = {}): HTMLInputElement {
  const inp = el('input', { class: 'vc-input', type: 'number', value: String(value) });
  if (opts.min !== undefined) inp.min = String(opts.min);
  if (opts.max !== undefined) inp.max = String(opts.max);
  inp.step = String(opts.step ?? (opts.int ? 1 : 'any'));
  const commit = () => {
    let v = opts.int ? parseInt(inp.value, 10) : parseFloat(inp.value);
    if (!Number.isFinite(v)) return;
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    onChange(v);
  };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); e.stopPropagation(); });
  return inp;
}

export function textInput(value: string, onChange: (v: string) => void, opts: { placeholder?: string; multiline?: boolean } = {}): HTMLInputElement | HTMLTextAreaElement {
  if (opts.multiline) {
    const ta = el('textarea', { class: 'vc-textarea', placeholder: opts.placeholder ?? '' });
    ta.value = value;
    ta.addEventListener('input', () => onChange(ta.value));
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    return ta;
  }
  const inp = el('input', { class: 'vc-input', type: 'text', value, placeholder: opts.placeholder ?? '' });
  inp.addEventListener('input', () => onChange(inp.value));
  inp.addEventListener('keydown', (e) => e.stopPropagation());
  return inp;
}

export function selectInput(value: string | number, options: Array<{ value: string | number; label: string }> | string[], onChange: (v: string) => void): HTMLSelectElement {
  const sel = el('select', { class: 'vc-select' });
  for (const o of options) {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    sel.appendChild(new Option(opt.label, String(opt.value), false, String(opt.value) === String(value)));
  }
  sel.addEventListener('change', () => onChange(sel.value));
  sel.addEventListener('keydown', (e) => e.stopPropagation());
  return sel;
}

export function checkbox(value: boolean, onChange: (v: boolean) => void, label?: string): HTMLElement {
  const inp = el('input', { class: 'vc-checkbox', type: 'checkbox' });
  inp.checked = value;
  inp.addEventListener('change', () => onChange(inp.checked));
  if (!label) return inp;
  return el('label', { style: 'display:inline-flex;align-items:center;gap:6px;cursor:pointer' }, [inp, label]);
}

export function lineWidthPicker(value: number, onChange: (v: number) => void): HTMLElement {
  const wrap = el('div', { style: 'display:inline-flex;gap:4px' });
  const btns: HTMLElement[] = [];
  for (const w of [1, 2, 3, 4]) {
    const b = el('button', { class: `vc-linewidth-opt ${w === value ? 'vc-active' : ''}`, title: `${w}px` });
    b.innerHTML = `<svg width="22" height="12" viewBox="0 0 22 12"><path d="M1 6h20" stroke="currentColor" stroke-width="${w}"/></svg>`;
    b.addEventListener('click', () => { btns.forEach((x) => x.classList.remove('vc-active')); b.classList.add('vc-active'); onChange(w); });
    btns.push(b);
    wrap.appendChild(b);
  }
  return wrap;
}

export function lineStylePicker(value: number, onChange: (v: number) => void): HTMLElement {
  const wrap = el('div', { style: 'display:inline-flex;gap:4px' });
  const btns: HTMLElement[] = [];
  const styles: Array<[number, string, string]> = [[0, 'Solid', ''], [2, 'Dashed', '6,3'], [1, 'Dotted', '2,3']];
  for (const [v, title, dash] of styles) {
    const b = el('button', { class: `vc-linestyle-opt ${v === value ? 'vc-active' : ''}`, title });
    b.innerHTML = `<svg width="22" height="12" viewBox="0 0 22 12"><path d="M1 6h20" stroke="currentColor" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
    b.addEventListener('click', () => { btns.forEach((x) => x.classList.remove('vc-active')); b.classList.add('vc-active'); onChange(v); });
    btns.push(b);
    wrap.appendChild(b);
  }
  return wrap;
}

export const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40];

export function formRow(label: string, control: HTMLElement | HTMLElement[], opts: { indent?: boolean } = {}): HTMLDivElement {
  const row = el('div', { class: 'vc-form-row' });
  const lab = el('label', { text: label });
  if (opts.indent) lab.style.paddingLeft = '20px';
  row.appendChild(lab);
  const ctl = el('div', { class: 'vc-control' });
  for (const c of Array.isArray(control) ? control : [control]) ctl.appendChild(c);
  row.appendChild(ctl);
  return row;
}

export function formSection(title: string): HTMLDivElement {
  return el('div', { class: 'vc-form-section', text: title });
}

/** Editor for a FibLevel[] table (checkbox + coefficient + color). */
export function fibLevelsEditor(levels: FibLevel[], onChange: (levels: FibLevel[]) => void): HTMLElement {
  const wrap = el('div', { style: 'display:grid;grid-template-columns:repeat(2, 1fr);gap:2px 16px' });
  const render = () => {
    wrap.innerHTML = '';
    levels.forEach((lv, i) => {
      const row = el('div', { style: 'display:flex;align-items:center;gap:6px;padding:2px 0' });
      row.appendChild(checkbox(lv.visible, (v) => { levels[i].visible = v; onChange(levels); }));
      const num = numberInput(lv.coeff, (v) => { levels[i].coeff = v; onChange(levels); }, { step: 0.001 });
      num.style.width = '76px';
      row.appendChild(num);
      row.appendChild(colorButton(lv.color, (c) => { levels[i].color = c; onChange(levels); }));
      wrap.appendChild(row);
    });
  };
  render();
  return wrap;
}

/** Build a control for a generic PropertyDef against a style object. */
export function propertyControl(def: PropertyDef, get: () => any, set: (v: any) => void): HTMLElement | null {
  switch (def.type) {
    case 'color': return colorButton(String(get() ?? '#2962FF'), set);
    case 'lineWidth': return lineWidthPicker(Number(get() ?? 1), set);
    case 'lineStyle': return lineStylePicker(Number(get() ?? 0), set);
    case 'bool': return checkbox(!!get(), set);
    case 'number': return numberInput(Number(get() ?? 0), set, { min: def.min, max: def.max, step: def.step });
    case 'int': return numberInput(Number(get() ?? 0), set, { min: def.min, max: def.max, int: true });
    case 'text': return textInput(String(get() ?? ''), set, { multiline: true });
    case 'select': return selectInput(get() ?? '', def.options ?? [], (v) => {
      const opt = (def.options ?? []).find((o) => String(o.value) === v);
      set(opt && typeof opt.value === 'number' ? opt.value : v);
    });
    case 'fontSize': return selectInput(Number(get() ?? 14), FONT_SIZES.map((n) => ({ value: n, label: String(n) })), (v) => set(parseInt(v, 10)));
    case 'textAlign': return selectInput(String(get() ?? 'left'), [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }], set);
    case 'fibLevels': return fibLevelsEditor((get() as FibLevel[]) ?? [], (lv) => set(lv));
    case 'section': return null;
    default: return textInput(String(get() ?? ''), set);
  }
}

/** Render a list of PropertyDefs (one group) into a container as form rows. */
export function renderPropertyForm(container: HTMLElement, defs: PropertyDef[], style: Record<string, any>, onChange: (key: string, value: any) => void): void {
  for (const def of defs) {
    if (def.type === 'section') { container.appendChild(formSection(def.label)); continue; }
    const ctl = propertyControl(def, () => style[def.key], (v) => { style[def.key] = v; onChange(def.key, v); });
    if (!ctl) continue;
    if (def.type === 'fibLevels') { container.appendChild(formSection(def.label)); container.appendChild(ctl); continue; }
    const row = formRow(def.label, ctl);
    if (def.dependsOn) {
      const update = () => { row.style.display = style[def.dependsOn!] ? '' : 'none'; };
      update();
      container.addEventListener('vc-change', update);
    }
    container.appendChild(row);
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function button(label: string, opts: { icon?: string; title?: string; className?: string; onClick?: (e: MouseEvent) => void; iconSize?: number } = {}): HTMLButtonElement {
  const b = el('button', { class: `vc-btn ${opts.className ?? ''}`, title: opts.title ?? '' });
  if (opts.icon) {
    const sp = el('span', { class: 'vc-icon' });
    sp.style.width = sp.style.height = `${opts.iconSize ?? 18}px`;
    sp.innerHTML = ICONS[opts.icon] ?? opts.icon;
    b.appendChild(sp);
  }
  if (label) b.appendChild(el('span', { text: label }));
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  b.addEventListener('mousedown', (e) => e.stopPropagation());
  return b;
}
