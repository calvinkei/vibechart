/**
 * Object tree: non-modal panel listing the main series, indicators and drawings (z-order, top first)
 * with eye / lock / settings / remove buttons, drag-to-reorder and double-click rename.
 */
import type { Chart } from '../../core/Chart';
import type { Drawing } from '../../drawings/Drawing';
import { Dialog, escapeHtml } from '../components';
import { el } from '../../util/dom';
import { ICONS } from '../icons';
import { parseResolution } from '../../data/resolution';

const openTrees = new WeakMap<Chart, Dialog>();
type OpenDialogFn = (chart: Chart, type: string, payload?: unknown) => void;

export function openObjectTree(chart: Chart, openDialog: OpenDialogFn): Dialog | null {
  const existing = openTrees.get(chart);
  if (existing?.isOpen) { existing.close(); return null; }
  const dm = chart.drawings;
  const model = chart.model;
  const width = 320;
  const unsubs: Array<() => void> = [];
  let pending = false;
  const schedule = () => { if (pending) return; pending = true; queueMicrotask(() => { pending = false; render(); }); };

  const dlg = new Dialog({
    title: 'Object tree',
    container: chart.root,
    width,
    modal: false,
    className: 'oc-object-tree',
    x: Math.max(8, chart.root.clientWidth - width - 8),
    y: Math.min(48, Math.max(8, chart.root.clientHeight - 200)),
    onClose: () => { for (const u of unsubs) u(); openTrees.delete(chart); },
  });
  openTrees.set(chart, dlg);
  unsubs.push(dm.changed.subscribe(schedule), dm.selectionChanged.subscribe(schedule), model.indicatorsChanged.subscribe(schedule));
  unsubs.push(chart.subscribe('symbolChanged', schedule), chart.subscribe('intervalChanged', schedule), chart.subscribe('optionsChanged', schedule));

  const iconBtn = (name: string, title: string, on: boolean, onClick: (e: MouseEvent) => void) => {
    const b = el('button', { class: `oc-tree-btn ${on ? 'oc-on' : ''}`, title, html: ICONS[name] });
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
    return b;
  };

  function render(): void {
    if (!dlg.isOpen) return;
    const body = dlg.body;
    const scrollTop = body.scrollTop;
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'oc-tree-section', text: 'Main chart' }));
    const info = chart.symbolInfo;
    const main = el('div', { class: 'oc-tree-row' });
    main.innerHTML = `<span class="oc-tree-name">${escapeHtml(info?.name ?? chart.symbol)}<span class="oc-tree-sub">${escapeHtml(parseResolution(chart.interval).label.toUpperCase())}${info?.exchange ? ` · ${escapeHtml(info.exchange)}` : ''}</span></span>`;
    const mainActions = el('span', { class: 'oc-tree-actions' });
    mainActions.appendChild(iconBtn('settings', 'Settings', false, () => openDialog(chart, 'chartSettings', 'symbol')));
    main.appendChild(mainActions);
    body.appendChild(main);

    const volRow = el('div', { class: `oc-tree-row ${model.options.volume.visible ? '' : 'oc-hidden'}` });
    volRow.innerHTML = '<span class="oc-tree-name">Volume</span>';
    const volActions = el('span', { class: 'oc-tree-actions' });
    volActions.appendChild(iconBtn(model.options.volume.visible ? 'eye' : 'eyeOff', model.options.volume.visible ? 'Hide' : 'Show', false, () => chart.applyOptions({ volume: { visible: !model.options.volume.visible } })));
    volActions.appendChild(iconBtn('settings', 'Settings', false, () => openDialog(chart, 'chartSettings', 'volume')));
    volRow.appendChild(volActions);
    body.appendChild(volRow);

    for (const inst of model.indicators) {
      const row = el('div', { class: `oc-tree-row ${inst.visible ? '' : 'oc-hidden'}` });
      row.innerHTML = `<span class="oc-tree-name">${escapeHtml(inst.legendTitle(true))}</span>`;
      const actions = el('span', { class: 'oc-tree-actions' });
      actions.appendChild(iconBtn(inst.visible ? 'eye' : 'eyeOff', inst.visible ? 'Hide' : 'Show', false, () => { inst.visible = !inst.visible; model.invalidate('full'); schedule(); }));
      actions.appendChild(iconBtn('settings', 'Settings', false, () => openDialog(chart, 'indicatorSettings', inst)));
      actions.appendChild(iconBtn('trash', 'Remove', false, () => chart.removeIndicator(inst)));
      row.appendChild(actions);
      row.addEventListener('dblclick', () => openDialog(chart, 'indicatorSettings', inst));
      body.appendChild(row);
    }

    body.appendChild(el('div', { class: 'oc-tree-section', text: `Drawings (${dm.drawings.length})` }));
    if (!dm.drawings.length) body.appendChild(el('div', { class: 'oc-tree-empty', text: 'No drawings on the chart.' }));
    const ordered = dm.drawings.slice().reverse(); // top-most first
    ordered.forEach((d, listIndex) => {
      const row = el('div', { class: `oc-tree-row ${dm.selected === d ? 'oc-active' : ''} ${d.visible ? '' : 'oc-hidden'}`, 'data-id': d.id });
      const handle = el('span', { class: 'oc-tree-handle', html: ICONS.dragHandle, title: 'Drag to reorder' });
      handle.addEventListener('mousedown', (e) => startDrag(e, d, listIndex, row));
      row.appendChild(handle);
      const name = el('span', { class: 'oc-tree-name', text: d.name || d.typeName, title: 'Double-click to rename' });
      row.appendChild(name);
      const actions = el('span', { class: 'oc-tree-actions' });
      actions.appendChild(iconBtn(d.visible ? 'eye' : 'eyeOff', d.visible ? 'Hide' : 'Show', false, () => dm.setVisible(d, !d.visible)));
      actions.appendChild(iconBtn(d.locked ? 'lock' : 'unlock', d.locked ? 'Unlock' : 'Lock', d.locked, () => dm.setLocked(d, !d.locked)));
      actions.appendChild(iconBtn('settings', 'Settings', false, () => openDialog(chart, 'drawingSettings', d)));
      actions.appendChild(iconBtn('trash', 'Remove', false, () => dm.remove(d)));
      row.appendChild(actions);
      row.addEventListener('click', () => dm.select(d));
      name.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(d, name); });
      body.appendChild(row);
    });
    body.scrollTop = scrollTop;
  }

  function startRename(d: Drawing, nameEl: HTMLElement): void {
    const inp = el('input', { class: 'oc-tree-rename', value: d.name || d.typeName });
    const finish = (commit: boolean) => {
      if (!inp.isConnected) return;
      if (commit) { const v = inp.value.trim(); d.name = v === d.typeName ? '' : v; dm.changed.fire(); }
      inp.replaceWith(nameEl);
      if (!commit) schedule();
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('mousedown', (e) => e.stopPropagation());
    inp.addEventListener('click', (e) => e.stopPropagation());
    nameEl.replaceWith(inp);
    inp.focus();
    inp.select();
  }

  function startDrag(e: MouseEvent, d: Drawing, fromList: number, row: HTMLElement): void {
    e.preventDefault();
    e.stopPropagation();
    const body = dlg.body;
    let target: { list: number; after: boolean } | null = null;
    row.classList.add('oc-dragging');
    const rows = () => Array.from(body.querySelectorAll<HTMLElement>('.oc-tree-row[data-id]'));
    const clear = () => rows().forEach((r) => r.classList.remove('oc-drop-before', 'oc-drop-after'));
    const move = (ev: MouseEvent) => {
      clear();
      const all = rows();
      target = null;
      for (let i = 0; i < all.length; i++) {
        const r = all[i].getBoundingClientRect();
        if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
          const after = ev.clientY > r.top + r.height / 2;
          target = { list: i, after };
          all[i].classList.add(after ? 'oc-drop-after' : 'oc-drop-before');
          break;
        }
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      clear();
      row.classList.remove('oc-dragging');
      if (!target) return;
      // list index -> array index (list is reversed: 0 = top-most = last in array)
      const n = dm.drawings.length;
      let toList = target.after ? target.list + 1 : target.list;
      if (toList > fromList) toList -= 1;
      toList = Math.max(0, Math.min(n - 1, toList));
      const fromIdx = n - 1 - fromList;
      const toIdx = n - 1 - toList;
      const steps = toIdx - fromIdx;
      for (let i = 0; i < Math.abs(steps); i++) { if (steps > 0) dm.bringForward(d); else dm.sendBackward(d); }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  render();
  return dlg;
}

