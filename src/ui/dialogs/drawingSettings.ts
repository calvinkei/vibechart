/**
 * Drawing settings dialog: Style / (Inputs) / (Text) / Coordinates / Visibility + Template menu.
 */
import type { Chart } from '../../core/Chart';
import type { Drawing, DrawingPoint, PropertyDef } from '../../drawings/Drawing';
import { defaultVisibility } from '../../drawings/Drawing';
import { Dialog, renderPropertyForm, formRow, formSection, numberInput, checkbox, showMenu, closeAllMenus } from '../components';
import { el } from '../../util/dom';
import { readJson, writeJson, removeJson, VISIBILITY_BUCKETS } from './helpers';
import { chartTimezone, dateTimeInput, drawingDefaultsKey, localInputToTime, timeToLocalInput, note } from './shared';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const NON_STYLE_GROUPS = new Set(['Text', 'Coordinates', 'Visibility', 'Inputs']);

export function openDrawingSettings(chart: Chart, d: Drawing): Dialog {
  const dm = chart.drawings;
  const model = chart.model;
  const snapshot = { style: clone(d.style), points: d.points.map((p) => ({ ...p })), visibility: { ...d.visibility }, name: d.name };
  const defs = d.propertyDefs();
  const styleDefs = defs.filter((p) => !NON_STYLE_GROUPS.has(p.group ?? 'Style'));
  const inputDefs = defs.filter((p) => p.group === 'Inputs');
  const textDefs = defs.filter((p) => p.group === 'Text');
  const tabs = ['Style', ...(inputDefs.length ? ['Inputs'] : []), ...(textDefs.length ? ['Text'] : []), 'Coordinates', 'Visibility'];

  let undoPushed = false;
  const changeStyle = (patch: Record<string, unknown>) => { dm.updateStyle(d, patch, !undoPushed); undoPushed = true; };
  const notifyChanged = () => { d.onChanged(); dm.changed.fire(); model.invalidate('full'); };

  const dlg = new Dialog({
    title: d.name || d.typeName,
    container: chart.root,
    width: 560,
    className: 'oc-settings-dialog',
    tabs,
    buttons: [
      { label: 'Template ▾', left: true, onClick: (dlg) => openTemplateMenu(dlg) },
      { label: 'Cancel', onClick: () => { restore(); dlg.close(); } },
      { label: 'Ok', primary: true, onClick: () => dlg.close() },
    ],
  });

  function renderGroup(tab: string, list: PropertyDef[]): void {
    const pane = dlg.tab(tab);
    pane.innerHTML = '';
    if (!list.length) { pane.appendChild(note('No options in this group.')); return; }
    renderPropertyForm(pane, list, d.style, (key, value) => { changeStyle({ [key]: value }); pane.dispatchEvent(new Event('oc-change')); });
  }

  function renderCoordinates(): void {
    const pane = dlg.tab('Coordinates');
    pane.innerHTML = '';
    if (!d.points.length) { pane.appendChild(note('This drawing has no anchor points.')); return; }
    const tz = chartTimezone(chart);
    const ts = model.timeScale;
    const precision = model.mainSeries.priceFormat.precision;
    const step = Math.pow(10, -precision);
    const update = (i: number, patch: Partial<DrawingPoint>) => {
      const pts = d.points.map((p) => ({ ...p }));
      pts[i] = { ...pts[i], ...patch };
      dm.updatePoints(d, pts);
    };
    d.points.forEach((p, i) => {
      pane.appendChild(formSection(`Point ${i + 1}`));
      pane.appendChild(formRow('Price', numberInput(+p.price.toFixed(Math.min(8, precision + 2)), (v) => update(i, { price: v }), { step })));
      pane.appendChild(formRow('Date / time', dateTimeInput('datetime-local', timeToLocalInput(p.time, tz, true), (v) => { const t = localInputToTime(v, tz); if (t !== null) update(i, { time: t }); }, { step: 1 })));
      pane.appendChild(formRow('Bar #', numberInput(Math.round(ts.timeToIndex(p.time)), (v) => update(i, { time: ts.indexToTime(v) }), { int: true })));
    });
  }

  function renderVisibility(): void {
    const pane = dlg.tab('Visibility');
    pane.innerHTML = '';
    const v = d.visibility;
    pane.appendChild(note('The drawing is shown only on the selected intervals.'));
    for (const b of VISIBILITY_BUCKETS) {
      const row = el('div', { class: 'oc-vis-row' });
      row.appendChild(checkbox(!!v[b.key], (on) => { (v as any)[b.key] = on; notifyChanged(); }, b.label));
      row.appendChild(el('span', { class: 'oc-vis-label' }));
      row.appendChild(numberInput((v as any)[`${b.key}From`], (n) => { (v as any)[`${b.key}From`] = n; notifyChanged(); }, { min: b.min, max: b.max, int: true }));
      row.appendChild(el('span', { class: 'oc-vis-dash', text: '–' }));
      row.appendChild(numberInput((v as any)[`${b.key}To`], (n) => { (v as any)[`${b.key}To`] = n; notifyChanged(); }, { min: b.min, max: b.max, int: true }));
      pane.appendChild(row);
    }
    const rr = el('div', { class: 'oc-vis-row' });
    rr.appendChild(checkbox(v.ranges, (on) => { v.ranges = on; notifyChanged(); }, 'Ranges'));
    pane.appendChild(rr);
  }

  function renderAll(): void {
    renderGroup('Style', styleDefs);
    if (inputDefs.length) renderGroup('Inputs', inputDefs);
    if (textDefs.length) renderGroup('Text', textDefs);
    renderCoordinates();
    renderVisibility();
  }

  function applyStyle(style: Record<string, unknown>, recordUndo: boolean): void {
    for (const k of Object.keys(d.style)) delete d.style[k];
    dm.updateStyle(d, style, recordUndo);
  }

  function openTemplateMenu(dialog: Dialog): void {
    const btn = dialog.footer?.querySelector('button.oc-left') as HTMLElement | null;
    const r = (btn ?? dialog.el).getBoundingClientRect();
    const c = chart.root.getBoundingClientRect();
    const key = drawingDefaultsKey(d.type);
    const hasSaved = !!readJson<Record<string, unknown> | null>(key, null);
    showMenu(chart.root, r.left - c.left, r.top - c.top - 4, [
      { label: 'Save as default', onClick: () => { writeJson(key, clone(d.style)); } },
      { label: 'Apply defaults', disabled: !hasSaved, onClick: () => { const s = readJson<Record<string, unknown> | null>(key, null); if (s) { changeStyle(s); renderAll(); } } },
      { separator: true },
      { label: 'Reset to defaults', onClick: () => { removeJson(key); applyStyle(d.defaultStyle(), !undoPushed); undoPushed = true; d.visibility = defaultVisibility(); notifyChanged(); renderAll(); } },
    ], { className: 'oc-dlg-menu', minWidth: 180 });
    // the dialog's own mousedown handler stops propagation, so close the menu when the dialog is clicked
    const m = dialog.el;
    const onDown = () => { closeAllMenus(); m.removeEventListener('mousedown', onDown); };
    m.addEventListener('mousedown', onDown);
    // flip above the button (menu is placed below by default)
  }

  function restore(): void {
    applyStyle(snapshot.style, false);
    d.points = snapshot.points.map((p) => ({ ...p }));
    d.visibility = { ...snapshot.visibility };
    d.name = snapshot.name;
    notifyChanged();
  }

  renderAll();
  return dlg;
}
