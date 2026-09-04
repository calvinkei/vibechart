/**
 * Left (drawing) toolbar: cursors, grouped drawing tools with flyouts + favourites, measure,
 * zoom, magnet, stay-in-drawing-mode, lock/hide all, remove menu, object tree.
 */
import type { Chart } from '../core/Chart';
import type { CrosshairMode } from '../core/options';
import { getDrawingTool, listDrawingTools, type DrawingCtor } from '../drawings/Drawing';
import { el, placeFloating } from '../util/dom';
import { button, closeAllMenus, showMenu, tooltip, type MenuItem } from './components';
import { ICONS } from './icons';
import { openDialog } from './dialogs/index';
import { altKey, confirmDialog, loadPref, menuRow, modKey, savePref, toast, toggleInList } from './util';

export type CursorMode = 'cross' | 'dot' | 'arrow' | 'eraser';
export const CURSORS: Array<{ id: CursorMode; name: string; icon: string }> = [
  { id: 'cross', name: 'Cross', icon: 'crossCursor' },
  { id: 'dot', name: 'Dot', icon: 'dot' },
  { id: 'arrow', name: 'Arrow', icon: 'arrowCursor' },
  { id: 'eraser', name: 'Eraser', icon: 'eraser' },
];

export interface ToolGroupDef { id: string; title: string; groups: string[]; sections?: Record<string, string> }

/** TradingView left-toolbar groups (top → bottom). `groups` are Drawing.group values folded into the button. */
export const TOOL_GROUPS: ToolGroupDef[] = [
  { id: 'lines', title: 'Trend line tools', groups: ['lines'] },
  { id: 'fib', title: 'Gann and Fibonacci tools', groups: ['fib', 'gann', 'pitchfork'], sections: { fib: 'Fibonacci', gann: 'Gann', pitchfork: 'Pitchfork' } },
  { id: 'shapes', title: 'Geometric shapes', groups: ['shapes', 'arrows'] },
  { id: 'text', title: 'Annotation tools', groups: ['text'] },
  { id: 'patterns', title: 'Patterns', groups: ['patterns'] },
  { id: 'prediction', title: 'Prediction and measurement tools', groups: ['prediction', 'measure'] },
  { id: 'other', title: 'Other tools', groups: ['other'] },
];

/** Keyboard shortcuts implemented by the chart core (shown in flyouts). */
export const TOOL_HOTKEYS: Record<string, string> = {
  trend_line: 'Alt+T', horizontal_line: 'Alt+H', vertical_line: 'Alt+V', cross_line: 'Alt+J', fib_retracement: 'Alt+F', parallel_channel: 'Alt+C', rectangle: 'Alt+Shift+R',
};

export interface GroupedTools { def: ToolGroupDef; tools: DrawingCtor[]; sections: Array<{ title: string | null; tools: DrawingCtor[] }> }

/** Fold registered tools into toolbar groups (empty groups are dropped, cursors excluded, unknown groups → "Other tools"). */
export function groupTools(tools: DrawingCtor[]): GroupedTools[] {
  const out: GroupedTools[] = [];
  const assigned = new Set<DrawingCtor>();
  for (const def of TOOL_GROUPS) {
    const sections: GroupedTools['sections'] = [];
    for (const g of def.groups) {
      const list = tools.filter((t) => String(t.group) === g && !assigned.has(t));
      if (!list.length) continue;
      for (const t of list) assigned.add(t);
      sections.push({ title: def.sections?.[g] ?? null, tools: list });
    }
    if (sections.length) out.push({ def, tools: sections.flatMap((s) => s.tools), sections });
  }
  const rest = tools.filter((t) => !assigned.has(t) && String(t.group) !== 'cursor');
  if (rest.length) {
    const other = out.find((o) => o.def.id === 'other');
    if (other) { other.tools.push(...rest); other.sections.push({ title: null, tools: rest }); }
    else out.push({ def: TOOL_GROUPS[TOOL_GROUPS.length - 1], tools: rest, sections: [{ title: null, tools: rest }] });
  }
  return out;
}

function hotkeyLabel(toolId: string): string | undefined {
  const h = TOOL_HOTKEYS[toolId];
  return h ? h.replace('Alt', altKey()).replace('Shift', '⇧') : undefined;
}

const DOT_CURSOR_ICON = ICONS.dot;

export interface LeftToolbar {
  render(): void;
  updateState(): void;
  closeFlyout(): void;
  cursorMode(): CursorMode;
  destroy(): void;
}

export function createLeftToolbar(chart: Chart): LeftToolbar {
  const host = chart.leftToolbarEl;
  const root = chart.root;
  let cursor: CursorMode = 'cross';
  let savedCrosshair: CrosshairMode = chart.options.crosshair.mode === 'hidden' ? 'normal' : chart.options.crosshair.mode;
  let flyout: { el: HTMLElement; id: string } | null = null;
  let flyoutTimer = 0;
  let grouped: GroupedTools[] = [];

  // element refs refreshed by render()
  let cursorBtn: HTMLButtonElement | null = null;
  const groupBtns = new Map<string, { btn: HTMLButtonElement; g: GroupedTools }>();
  const favBtns = new Map<string, HTMLButtonElement>();
  let magnetBtn: HTMLButtonElement | null = null;
  let stayBtn: HTMLButtonElement | null = null;
  let lockBtn: HTMLButtonElement | null = null;
  let hideBtn: HTMLButtonElement | null = null;
  let favHost: HTMLElement | null = null;

  const unsubs: Array<() => void> = [];

  // ---- flyout ---------------------------------------------------------------------------------------
  function closeFlyout(): void {
    clearTimeout(flyoutTimer);
    if (!flyout) return;
    flyout.el.remove();
    flyout = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onDocKey, true);
  }
  function onDocDown(e: MouseEvent): void { if (flyout && !flyout.el.contains(e.target as Node)) closeFlyout(); }
  function onDocKey(e: KeyboardEvent): void { if (e.key === 'Escape') closeFlyout(); }
  function scheduleClose(): void { clearTimeout(flyoutTimer); flyoutTimer = window.setTimeout(closeFlyout, 350); }

  function showFlyout(id: string, anchor: HTMLElement, content: () => HTMLElement[]): void {
    clearTimeout(flyoutTimer);
    if (flyout?.id === id) return;
    closeFlyout();
    closeAllMenus();
    const fl = el('div', { class: 'vc-tool-flyout' });
    for (const n of content()) fl.appendChild(n);
    fl.addEventListener('mouseenter', () => clearTimeout(flyoutTimer));
    fl.addEventListener('mouseleave', scheduleClose);
    fl.addEventListener('mousedown', (e) => e.stopPropagation());
    root.appendChild(fl);
    const r = anchor.getBoundingClientRect();
    const c = root.getBoundingClientRect();
    placeFloating(fl, r.right - c.left + 2, r.top - c.top, root);
    flyout = { el: fl, id };
    setTimeout(() => { if (flyout?.el === fl) { document.addEventListener('mousedown', onDocDown, true); document.addEventListener('keydown', onDocKey, true); } }, 0);
  }

  function flyoutItem(opts: { label: string; icon: string; active: boolean; shortcut?: string; star?: { active: boolean; onToggle: () => void }; onClick: () => void }): HTMLElement {
    const row = el('div', { class: `vc-menu-item ${opts.active ? 'vc-active' : ''}` });
    row.appendChild(menuRow({ label: opts.label, icon: opts.icon, shortcut: opts.shortcut, star: opts.star ? { active: opts.star.active, onToggle: opts.star.onToggle } : undefined }));
    row.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick(); });
    return row;
  }

  // ---- cursor ---------------------------------------------------------------------------------------
  function setCursor(mode: CursorMode): void {
    const prev = cursor;
    cursor = mode;
    if (chart.activeTool) chart.setTool(null);
    root.classList.remove('vc-cursor-dot', 'vc-cursor-arrow', 'vc-cursor-eraser');
    if (mode !== 'cross') root.classList.add(`vc-cursor-${mode}`);
    if (mode === 'arrow' && prev !== 'arrow') {
      savedCrosshair = chart.options.crosshair.mode === 'hidden' ? 'normal' : chart.options.crosshair.mode;
      chart.applyOptions({ crosshair: { mode: 'hidden' } });
    } else if (prev === 'arrow' && mode !== 'arrow') {
      chart.applyOptions({ crosshair: { mode: savedCrosshair } });
    }
    closeFlyout();
    updateState();
  }

  // eraser: remove whatever gets selected while the eraser cursor is active
  unsubs.push(chart.drawings.selectionChanged.subscribe((d) => {
    if (cursor !== 'eraser' || !d || d.locked || chart.drawings.lockAll) return;
    setTimeout(() => { if (chart.drawings.drawings.includes(d)) chart.drawings.remove(d); }, 0);
  }));
  unsubs.push(chart.drawings.toolChanged.subscribe((t) => { if (t && cursor === 'eraser') setCursor('cross'); }));

  // ---- tools ----------------------------------------------------------------------------------------
  function lastToolOf(g: GroupedTools): DrawingCtor {
    const id = loadPref<string | null>(`lastTool.${g.def.id}`, null);
    return (id && g.tools.find((t) => t.toolId === id)) || g.tools[0];
  }
  function activateTool(toolId: string, groupId?: string): void {
    if (groupId) savePref(`lastTool.${groupId}`, toolId);
    closeFlyout();
    closeAllMenus();
    chart.setTool(chart.activeTool === toolId ? null : toolId);
  }

  function groupFlyoutContent(g: GroupedTools): HTMLElement[] {
    const favs = loadPref<string[]>('favTools', []);
    const nodes: HTMLElement[] = [];
    for (const s of g.sections) {
      if (s.title) nodes.push(el('div', { class: 'vc-menu-title', text: s.title }));
      for (const t of s.tools) {
        nodes.push(flyoutItem({
          label: t.toolName, icon: t.icon || 'dot', active: chart.activeTool === t.toolId, shortcut: hotkeyLabel(t.toolId),
          star: { active: favs.includes(t.toolId), onToggle: () => { toggleInList('favTools', t.toolId); renderFavorites(); } },
          onClick: () => activateTool(t.toolId, g.def.id),
        }));
      }
    }
    return nodes;
  }

  function toolButton(g: GroupedTools): HTMLElement {
    const wrap = el('div', { class: 'vc-tool-group' });
    const last = lastToolOf(g);
    const btn = button('', { icon: last.icon || 'dot', className: 'vc-tool-btn', onClick: () => activateTool(lastToolOf(g).toolId, g.def.id) });
    tooltip(btn, () => `${lastToolOf(g).toolName} — ${g.def.title}`, root);
    const arrow = el('div', { class: 'vc-tool-arrow-zone', title: g.def.title }, [el('span', { class: 'vc-tool-arrow' })]);
    const open = () => showFlyout(g.def.id, btn, () => groupFlyoutContent(g));
    arrow.addEventListener('mouseenter', open);
    arrow.addEventListener('mousedown', (e) => e.stopPropagation());
    arrow.addEventListener('click', (e) => { e.stopPropagation(); if (flyout?.id === g.def.id) closeFlyout(); else open(); });
    wrap.appendChild(btn);
    wrap.appendChild(arrow);
    wrap.addEventListener('mouseenter', () => clearTimeout(flyoutTimer));
    wrap.addEventListener('mouseleave', scheduleClose);
    groupBtns.set(g.def.id, { btn, g });
    return wrap;
  }

  function renderFavorites(): void {
    if (!favHost) return;
    favHost.innerHTML = '';
    favBtns.clear();
    const favs = loadPref<string[]>('favTools', []).map((id) => getDrawingTool(id)).filter((t): t is DrawingCtor => !!t);
    if (!favs.length) { favHost.style.display = 'none'; return; }
    favHost.style.display = '';
    favHost.appendChild(el('div', { class: 'vc-sep-h' }));
    for (const t of favs) {
      const b = button('', { icon: t.icon || 'dot', className: 'vc-tool-btn vc-fav-tool', onClick: () => activateTool(t.toolId, String(t.group)) });
      tooltip(b, `${t.toolName} (favorite)`, root);
      favBtns.set(t.toolId, b);
      favHost.appendChild(b);
    }
    updateState();
  }

  // ---- utility buttons -------------------------------------------------------------------------------
  function magnetItems(): MenuItem[] {
    const dm = chart.drawings;
    const cur = dm.magnet;
    return [
      { label: 'Weak magnet', icon: 'magnet', checked: cur === 'weak', onClick: () => { savePref('magnetMode', 'weak'); dm.magnet = 'weak'; updateState(); } },
      { label: 'Strong magnet', icon: 'magnet', checked: cur === 'strong', onClick: () => { savePref('magnetMode', 'strong'); dm.magnet = 'strong'; updateState(); } },
      { separator: true },
      { label: 'Off', checked: cur === 'none', onClick: () => { dm.magnet = 'none'; updateState(); } },
    ];
  }

  function removeItems(): MenuItem[] {
    const dm = chart.drawings;
    const m = chart.model;
    const ask = (title: string, msg: string, fn: () => void) => { void confirmDialog(root, title, msg, 'Remove').then((ok) => { if (ok) fn(); }); };
    return [
      { label: 'Remove all drawings', icon: 'trash', disabled: dm.drawings.length === 0, onClick: () => ask('Remove drawings', `Remove all ${dm.drawings.length} drawings?`, () => dm.removeAll()) },
      { label: 'Remove all indicators', disabled: m.indicators.length === 0, onClick: () => ask('Remove indicators', `Remove all ${m.indicators.length} indicators?`, () => chart.removeAllIndicators()) },
      { label: 'Remove drawings & indicators', disabled: dm.drawings.length === 0 && m.indicators.length === 0, onClick: () => ask('Remove drawings & indicators', 'Remove all drawings and indicators from the chart?', () => { dm.removeAll(); chart.removeAllIndicators(); }) },
    ];
  }

  function menuAt(anchor: HTMLElement, items: MenuItem[]): void {
    closeFlyout();
    const r = anchor.getBoundingClientRect();
    const c = root.getBoundingClientRect();
    showMenu(root, r.right - c.left + 2, r.top - c.top, items, { minWidth: 180 });
  }

  function withArrow(btn: HTMLButtonElement, items: () => MenuItem[]): HTMLElement {
    const wrap = el('div', { class: 'vc-tool-group' });
    const arrow = el('div', { class: 'vc-tool-arrow-zone' }, [el('span', { class: 'vc-tool-arrow' })]);
    arrow.addEventListener('mousedown', (e) => e.stopPropagation());
    arrow.addEventListener('click', (e) => { e.stopPropagation(); menuAt(btn, items()); });
    wrap.appendChild(btn);
    wrap.appendChild(arrow);
    return wrap;
  }

  // ---- render ----------------------------------------------------------------------------------------
  function render(): void {
    closeFlyout();
    host.innerHTML = '';
    groupBtns.clear();
    favBtns.clear();
    const dm = chart.drawings;
    const inner = el('div', { class: 'vc-left-toolbar-inner' });
    const sepH = () => el('div', { class: 'vc-sep-h' });

    // cursors
    {
      const wrap = el('div', { class: 'vc-tool-group' });
      const cur = CURSORS.find((c) => c.id === cursor) ?? CURSORS[0];
      cursorBtn = button('', { icon: cur.icon, className: 'vc-tool-btn vc-cursor-btn', onClick: () => { if (chart.activeTool) chart.setTool(null); else setCursor(cursor); } });
      tooltip(cursorBtn, () => `${(CURSORS.find((c) => c.id === cursor) ?? CURSORS[0]).name} cursor`, root);
      const arrow = el('div', { class: 'vc-tool-arrow-zone' }, [el('span', { class: 'vc-tool-arrow' })]);
      const open = () => showFlyout('cursors', cursorBtn!, () => CURSORS.map((c) => flyoutItem({ label: c.name, icon: c.icon, active: c.id === cursor && !chart.activeTool, onClick: () => setCursor(c.id) })));
      arrow.addEventListener('mouseenter', open);
      arrow.addEventListener('mousedown', (e) => e.stopPropagation());
      arrow.addEventListener('click', (e) => { e.stopPropagation(); if (flyout?.id === 'cursors') closeFlyout(); else open(); });
      wrap.appendChild(cursorBtn);
      wrap.appendChild(arrow);
      wrap.addEventListener('mouseenter', () => clearTimeout(flyoutTimer));
      wrap.addEventListener('mouseleave', scheduleClose);
      inner.appendChild(wrap);
    }
    inner.appendChild(sepH());

    // tool groups
    grouped = groupTools(listDrawingTools());
    for (const g of grouped) inner.appendChild(toolButton(g));

    // favorites
    favHost = el('div', { class: 'vc-tool-favs' });
    inner.appendChild(favHost);
    renderFavorites();
    inner.appendChild(sepH());

    // measure / zoom
    const measure = button('', { icon: 'measure', className: 'vc-tool-btn', onClick: () => { if (getDrawingTool('measure')) activateTool('measure'); else toast(root, 'Measure tool is not available in this build'); } });
    tooltip(measure, `Measure (${'⇧'} + drag)`, root);
    inner.appendChild(measure);
    const zi = button('', { icon: 'zoomIn', className: 'vc-tool-btn', onClick: () => chart.timeScale().zoomIn() });
    tooltip(zi, 'Zoom in (+)', root);
    const zo = button('', { icon: 'zoomOut', className: 'vc-tool-btn', onClick: () => chart.timeScale().zoomOut() });
    tooltip(zo, 'Zoom out (−)', root);
    inner.appendChild(zi);
    inner.appendChild(zo);
    inner.appendChild(sepH());

    // magnet
    magnetBtn = button('', { icon: 'magnet', className: 'vc-tool-btn', onClick: () => { dm.magnet = dm.magnet === 'none' ? loadPref<'weak' | 'strong'>('magnetMode', 'weak') : 'none'; updateState(); } });
    tooltip(magnetBtn, () => `Magnet mode — ${dm.magnet === 'none' ? 'off' : dm.magnet}`, root);
    inner.appendChild(withArrow(magnetBtn, magnetItems));
    // stay in drawing mode
    stayBtn = button('', { icon: 'pencil', className: 'vc-tool-btn', onClick: () => { dm.stayInDrawingMode = !dm.stayInDrawingMode; updateState(); } });
    tooltip(stayBtn, 'Stay in drawing mode', root);
    inner.appendChild(stayBtn);
    // lock all
    lockBtn = button('', { icon: 'lock', className: 'vc-tool-btn', onClick: () => { dm.setLockAll(!dm.lockAll); updateState(); } });
    tooltip(lockBtn, 'Lock all drawings', root);
    inner.appendChild(lockBtn);
    // hide all
    hideBtn = button('', { icon: 'eyeOff', className: 'vc-tool-btn', onClick: () => { dm.setHideAll(!dm.hideAll); updateState(); } });
    tooltip(hideBtn, `Hide all drawings (${modKey()}+${altKey()}+H)`, root);
    inner.appendChild(hideBtn);
    // remove
    const rm = button('', { icon: 'trash', className: 'vc-tool-btn', onClick: () => menuAt(rm, removeItems()) });
    tooltip(rm, 'Remove drawings / indicators', root);
    inner.appendChild(rm);

    inner.appendChild(el('div', { class: 'vc-spacer' }));
    const tree = button('', { icon: 'objectTree', className: 'vc-tool-btn', onClick: () => openDialog(chart, 'objectTree') });
    tooltip(tree, 'Object tree', root);
    inner.appendChild(tree);

    host.appendChild(inner);
    updateState();
  }

  function setIcon(btn: HTMLElement, svg: string): void {
    const ic = btn.querySelector('.vc-icon');
    if (ic && ic.innerHTML !== svg) ic.innerHTML = svg;
  }

  function updateState(): void {
    const active = chart.activeTool;
    const dm = chart.drawings;
    if (cursorBtn) {
      const cur = CURSORS.find((c) => c.id === cursor) ?? CURSORS[0];
      setIcon(cursorBtn, cur.id === 'dot' ? DOT_CURSOR_ICON : ICONS[cur.icon]);
      cursorBtn.classList.toggle('vc-active', !active);
    }
    for (const { btn, g } of groupBtns.values()) {
      const t = active ? g.tools.find((x) => x.toolId === active) : undefined;
      if (t) savePref(`lastTool.${g.def.id}`, t.toolId);
      const show = t ?? lastToolOf(g);
      setIcon(btn, show.icon || ICONS.dot);
      btn.classList.toggle('vc-active', !!t);
    }
    for (const [id, b] of favBtns) b.classList.toggle('vc-active', active === id);
    if (flyout) {
      for (const row of Array.from(flyout.el.querySelectorAll<HTMLElement>('.vc-menu-item'))) {
        const label = row.querySelector('.vc-menu-label')?.textContent;
        const t = label ? grouped.flatMap((g) => g.tools).find((x) => x.toolName === label) : undefined;
        if (t) row.classList.toggle('vc-active', t.toolId === active);
      }
    }
    magnetBtn?.classList.toggle('vc-active', dm.magnet !== 'none');
    stayBtn?.classList.toggle('vc-active', dm.stayInDrawingMode);
    lockBtn?.classList.toggle('vc-active', dm.lockAll);
    hideBtn?.classList.toggle('vc-active', dm.hideAll);
  }

  return {
    render,
    updateState,
    closeFlyout,
    cursorMode: () => cursor,
    destroy() {
      closeFlyout();
      for (const u of unsubs) u();
      root.classList.remove('vc-cursor-dot', 'vc-cursor-arrow', 'vc-cursor-eraser');
      host.innerHTML = '';
    },
  };
}
