/**
 * Indicator templates: save the current indicator set under a name (localStorage 'oc.templates'),
 * apply, delete, plus a few built-in "default" templates.
 */
import type { Chart } from '../../core/Chart';
import { getIndicator, type SerializedIndicator } from '../../indicators/Indicator';
import { Dialog, button, textInput, formSection } from '../components';
import { el } from '../../util/dom';
import { readJson, writeJson } from './helpers';
import { note } from './shared';

export interface IndicatorTemplate { name: string; indicators: SerializedIndicator[]; createdAt: number }
const KEY = 'oc.templates';

type PresetItem = { def: string; inputs?: Record<string, any> };
const PRESETS: Array<{ name: string; items: PresetItem[] }> = [
  { name: 'Empty (remove all indicators)', items: [] },
  { name: 'Volume + EMA 20/50', items: [{ def: 'Moving Average Exponential', inputs: { length: 20 } }, { def: 'Moving Average Exponential', inputs: { length: 50 } }, { def: 'Volume' }] },
  { name: 'Bollinger Bands + Volume', items: [{ def: 'Bollinger Bands' }, { def: 'Volume' }] },
  { name: 'RSI + MACD', items: [{ def: 'Relative Strength Index' }, { def: 'MACD' }] },
];

export function loadTemplates(): IndicatorTemplate[] { return readJson<IndicatorTemplate[]>(KEY, []).filter((t) => t && typeof t.name === 'string' && Array.isArray(t.indicators)); }
export function saveTemplates(list: IndicatorTemplate[]): void { writeJson(KEY, list); }

/** Replace all indicators with the serialized list (mirrors Chart.load()). */
export function applyIndicatorTemplate(chart: Chart, indicators: SerializedIndicator[]): void {
  const m = chart.model;
  chart.removeAllIndicators();
  for (const s of indicators) {
    if (!getIndicator(s.def)) continue;
    const inst = chart.addIndicator(s.def, s.inputs, { paneId: s.paneId === 'main' ? 'main' : s.paneId || undefined, priceScaleId: s.priceScaleId });
    if (!inst) continue;
    if (s.styles) inst.styles = { ...inst.styles, ...s.styles };
    if (s.bands) inst.bands = { ...inst.bands, ...s.bands };
    if (s.fills) inst.fills = { ...inst.fills, ...s.fills };
    if (s.visible !== undefined) inst.visible = s.visible;
  }
  m.invalidate('layout');
}

export function openTemplates(chart: Chart): Dialog {
  const dlg = new Dialog({
    title: 'Indicator templates',
    container: chart.root,
    width: 460,
    buttons: [{ label: 'Close', primary: true, onClick: (d) => d.close() }],
  });
  let name = '';

  function render(): void {
    const body = dlg.body;
    body.innerHTML = '';
    body.appendChild(formSection('Save current indicators as template'));
    const save = el('div', { class: 'vc-tpl-save' });
    const nameInput = textInput(name, (v) => { name = v; }, { placeholder: 'Template name' });
    nameInput.addEventListener('keydown', (e: Event) => { if ((e as KeyboardEvent).key === 'Enter') doSave(); });
    save.appendChild(nameInput);
    save.appendChild(button('Save', { className: 'vc-secondary', onClick: () => doSave() }));
    body.appendChild(save);
    body.appendChild(note(`${chart.model.indicators.length} indicator${chart.model.indicators.length === 1 ? '' : 's'} on the chart now. Saving an existing name overwrites it.`));

    body.appendChild(formSection('Default templates'));
    for (const p of PRESETS) {
      const available = p.items.filter((it) => getIndicator(it.def));
      const row = el('div', { class: 'vc-tpl-row' });
      row.appendChild(el('span', { class: 'vc-tpl-name', text: p.name }));
      row.appendChild(el('span', { class: 'vc-tpl-meta', text: p.items.length ? `${available.length}/${p.items.length}` : '' }));
      row.appendChild(button('Apply', { className: 'vc-secondary', onClick: () => { applyIndicatorTemplate(chart, available.map((it) => ({ id: '', def: it.def, inputs: it.inputs ?? {}, styles: {}, bands: {}, fills: {}, visible: true, paneId: '', priceScaleId: 'right' }))); render(); } }));
      body.appendChild(row);
    }

    body.appendChild(formSection('My templates'));
    const list = loadTemplates();
    if (!list.length) body.appendChild(el('div', { class: 'vc-tree-empty', text: 'No saved templates yet.' }));
    for (const t of list) {
      const row = el('div', { class: 'vc-tpl-row' });
      row.appendChild(el('span', { class: 'vc-tpl-name', text: t.name, title: t.indicators.map((i) => i.def).join(', ') }));
      row.appendChild(el('span', { class: 'vc-tpl-meta', text: `${t.indicators.length} ind.` }));
      row.appendChild(button('Apply', { className: 'vc-secondary', onClick: () => { applyIndicatorTemplate(chart, t.indicators); render(); } }));
      row.appendChild(button('', { icon: 'trash', title: 'Delete', onClick: () => { saveTemplates(loadTemplates().filter((x) => x.name !== t.name)); render(); } }));
      body.appendChild(row);
    }
  }

  function doSave(): void {
    const n = name.trim();
    if (!n) return;
    const list = loadTemplates().filter((t) => t.name !== n);
    list.unshift({ name: n, indicators: chart.model.serializeIndicators(), createdAt: Date.now() });
    saveTemplates(list);
    name = '';
    render();
  }

  render();
  return dlg;
}
