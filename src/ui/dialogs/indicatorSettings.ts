/**
 * Indicator settings dialog: Inputs / Style / Visibility (TradingView parity).
 * Inputs preview live (recompute), styles invalidate, Cancel restores a snapshot.
 */
import type { Chart } from '../../core/Chart';
import { IndicatorInstance, inputDefaults, type IndicatorInput, type PlotStyle, type PlotType } from '../../indicators/Indicator';
import { Dialog, checkbox, colorButton, numberInput, selectInput, textInput, lineWidthPicker, lineStylePicker, formRow, formSection } from '../components';
import { el } from '../../util/dom';
import { DEFAULT_INTERVALS, parseResolution } from '../../data/resolution';
import type { LineStyle, LineWidth } from '../../core/options';
import { defaultVisibility, type DrawingVisibility } from '../../drawings/Drawing';
import { PRICE_SOURCES, PRECISION_OPTIONS, parsePrecision, VISIBILITY_BUCKETS } from './helpers';
import { chartTimezone, dateTimeInput, ensureIndicatorVisibilityHook, indicatorVisibility, applyIndicatorVisibility, localInputToTime, timeToLocalInput, rangeInput, note } from './shared';

const LINE_LIKE: PlotType[] = ['line', 'stepLine', 'histogram', 'columns', 'area', 'circles', 'cross'];
const PLOT_TYPE_OPTS: Array<{ value: PlotType; label: string }> = [
  { value: 'line', label: 'Line' }, { value: 'stepLine', label: 'Step line' }, { value: 'histogram', label: 'Histogram' }, { value: 'columns', label: 'Columns' },
  { value: 'area', label: 'Area' }, { value: 'circles', label: 'Circles' }, { value: 'cross', label: 'Cross' },
];
const SHAPE_OPTS = ['arrowUp', 'arrowDown', 'triangleUp', 'triangleDown', 'circle', 'cross', 'xcross', 'square', 'diamond', 'flag', 'labelUp', 'labelDown'];
const SIZE_OPTS = ['tiny', 'small', 'normal', 'large', 'huge'];

type InstExtras = { visibility?: DrawingVisibility; __legendValues?: boolean; __precision?: 'default' | number };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function openIndicatorSettings(chart: Chart, inst: IndicatorInstance): Dialog {
  ensureIndicatorVisibilityHook(chart);
  const model = chart.model;
  const def = inst.def;
  const ext = inst as unknown as InstExtras;
  const snapshot = {
    inputs: { ...inst.inputs },
    styles: clone(inst.styles), bands: clone(inst.bands), fills: clone(inst.fills),
    visible: inst.visible,
    visibility: clone(indicatorVisibility(inst)),
    legendValues: ext.__legendValues !== false,
    precision: ext.__precision ?? 'default',
    priceFormat: inst.priceFormat ? { ...inst.priceFormat } : null,
  };
  const recompute = () => model.recomputeIndicator(inst);
  const redraw = () => model.invalidate('full');

  const dlg = new Dialog({
    title: def.name,
    container: chart.root,
    width: 560,
    className: 'vc-settings-dialog',
    tabs: ['Inputs', 'Style', 'Visibility'],
    buttons: [
      { label: 'Defaults', left: true, onClick: () => { resetDefaults(); renderAll(); } },
      { label: 'Cancel', onClick: () => { restore(); dlg.close(); } },
      { label: 'Ok', primary: true, onClick: () => dlg.close() },
    ],
  });

  // ---- Inputs --------------------------------------------------------------------------------
  function inputControl(inp: IndicatorInput): HTMLElement {
    const cur = inst.inputs[inp.id];
    const set = (v: unknown) => { inst.setInputs({ [inp.id]: v }); recompute(); };
    switch (inp.type) {
      case 'int': return numberInput(Number(cur ?? inp.defval ?? 0), set, { min: inp.min, max: inp.max, step: inp.step ?? 1, int: true });
      case 'float': return numberInput(Number(cur ?? inp.defval ?? 0), set, { min: inp.min, max: inp.max, step: inp.step ?? 0.01 });
      case 'bool': return checkbox(!!cur, set);
      case 'source': return selectInput(String(cur ?? 'close'), PRICE_SOURCES.map((s) => ({ value: s, label: s })), set);
      case 'select': return selectInput(String(cur ?? ''), inp.options ?? [], set);
      case 'color': return colorButton(String(cur ?? '#2962FF'), set);
      case 'resolution': return selectInput(String(cur ?? ''), [{ value: '', label: 'Same as chart' }, ...DEFAULT_INTERVALS.map((i) => ({ value: i.res, label: parseResolution(i.res).name }))], set);
      case 'time': {
        const tz = chartTimezone(chart);
        const t = Number(cur) > 1e11 ? Number(cur) / 1000 : Number(cur) || Math.floor(Date.now() / 1000);
        return dateTimeInput('datetime-local', timeToLocalInput(t, tz), (v) => { const s = localInputToTime(v, tz); if (s !== null) set(s); });
      }
      default: return textInput(String(cur ?? ''), set);
    }
  }
  function renderInputs(): void {
    const pane = dlg.tab('Inputs');
    pane.innerHTML = '';
    if (!def.inputs.length) { pane.appendChild(note('This indicator has no inputs.')); return; }
    let group: string | undefined;
    for (const inp of def.inputs) {
      if (inp.group !== group) { group = inp.group; if (group) pane.appendChild(formSection(group)); }
      const row = formRow(inp.name, inputControl(inp));
      if (inp.tooltip) row.title = inp.tooltip;
      pane.appendChild(row);
    }
  }

  // ---- Style -----------------------------------------------------------------------------------
  function plotRow(pid: string, title: string, st: PlotStyle): HTMLElement {
    const row = el('div', { class: 'vc-plot-row' });
    const head = el('span', { class: 'vc-plot-title' });
    head.appendChild(checkbox(st.visible, (v) => { st.visible = v; redraw(); }));
    head.appendChild(el('span', { text: title }));
    row.appendChild(head);
    if (LINE_LIKE.includes(st.type)) row.appendChild(selectInput(st.type, PLOT_TYPE_OPTS, (v) => { st.type = v as PlotType; redraw(); renderStyle(); }));
    if (st.type === 'shapes' || st.type === 'chars') {
      if (st.type === 'shapes') row.appendChild(selectInput(st.shape ?? 'circle', SHAPE_OPTS, (v) => { st.shape = v as PlotStyle['shape']; redraw(); }));
      else { const ch = textInput(st.char ?? '•', (v) => { st.char = v; redraw(); }); ch.style.width = '48px'; row.appendChild(ch); }
      row.appendChild(selectInput(st.size ?? 'normal', SIZE_OPTS, (v) => { st.size = v as PlotStyle['size']; redraw(); }));
    }
    row.appendChild(colorButton(st.color, (c) => { st.color = c; redraw(); }));
    if (st.type === 'line' || st.type === 'stepLine' || st.type === 'area' || st.type === 'cross') {
      row.appendChild(lineWidthPicker(st.lineWidth, (v) => { st.lineWidth = v as LineWidth; redraw(); }));
      row.appendChild(lineStylePicker(st.lineStyle, (v) => { st.lineStyle = v as LineStyle; redraw(); }));
    }
    if (st.type !== 'none') row.appendChild(rangeInput(st.transparency, (v) => { st.transparency = v; redraw(); }));
    if (st.type === 'histogram' || st.type === 'columns' || st.type === 'area') {
      const base = numberInput(st.base ?? 0, (v) => { st.base = v; redraw(); }, { step: 0.01 });
      base.title = 'Base value';
      row.appendChild(base);
    }
    return row;
  }
  function renderStyle(): void {
    const pane = dlg.tab('Style');
    pane.innerHTML = '';
    const plots = def.plots.filter((p) => inst.styles[p.id]);
    if (plots.length) {
      pane.appendChild(formSection('Plots'));
      for (const p of plots) pane.appendChild(plotRow(p.id, p.title, inst.styles[p.id]));
    }
    const bands = Object.values(inst.bands);
    if (bands.length) {
      pane.appendChild(formSection('Bands'));
      for (const b of bands) {
        const row = el('div', { class: 'vc-plot-row' });
        const head = el('span', { class: 'vc-plot-title' });
        head.appendChild(checkbox(b.visible, (v) => { b.visible = v; redraw(); }));
        head.appendChild(el('span', { text: b.title }));
        row.appendChild(head);
        row.appendChild(numberInput(b.value, (v) => { b.value = v; redraw(); }, { step: 0.01 }));
        row.appendChild(colorButton(b.color, (c) => { b.color = c; redraw(); }));
        row.appendChild(lineWidthPicker(b.lineWidth, (v) => { b.lineWidth = v as LineWidth; redraw(); }));
        row.appendChild(lineStylePicker(b.lineStyle, (v) => { b.lineStyle = v as LineStyle; redraw(); }));
        pane.appendChild(row);
      }
    }
    const fills = Object.values(inst.fills);
    if (fills.length) {
      pane.appendChild(formSection('Fills'));
      for (const f of fills) {
        const row = el('div', { class: 'vc-plot-row' });
        const head = el('span', { class: 'vc-plot-title' });
        head.appendChild(checkbox(f.visible, (v) => { f.visible = v; redraw(); }));
        head.appendChild(el('span', { text: f.title }));
        row.appendChild(head);
        row.appendChild(colorButton(f.color, (c) => { f.color = c; redraw(); }));
        row.appendChild(rangeInput(f.transparency, (v) => { f.transparency = v; redraw(); }));
        pane.appendChild(row);
      }
    }
    pane.appendChild(formSection('Outputs'));
    pane.appendChild(formRow('Precision', selectInput(String(ext.__precision ?? 'default'), PRECISION_OPTIONS, (v) => setPrecision(parsePrecision(v)))));
    const anyShowLast = Object.values(inst.styles).some((s) => s.showLast);
    pane.appendChild(formRow('Labels on price scale', checkbox(anyShowLast, (v) => { for (const s of Object.values(inst.styles)) s.showLast = v; redraw(); })));
    pane.appendChild(formRow('Values in status line', checkbox(ext.__legendValues !== false, (v) => setLegendValues(v))));
  }

  /** Precision override emulation: shadow `effectivePriceFormat` on the instance. */
  function setPrecision(p: 'default' | number): void {
    ext.__precision = p;
    const own = Object.prototype.hasOwnProperty.call(inst, 'effectivePriceFormat');
    if (p === 'default') { if (own) delete (inst as any).effectivePriceFormat; }
    else {
      const base = inst.effectivePriceFormat();
      const fmt = { ...base, precision: p, minMove: 1 };
      (inst as any).effectivePriceFormat = () => fmt;
    }
    redraw();
  }
  /** "Values in status line" emulation: shadow `legendItems` with an empty list. */
  function setLegendValues(on: boolean): void {
    ext.__legendValues = on;
    if (on) delete (inst as any).legendItems;
    else (inst as any).legendItems = () => [];
    redraw();
  }

  // ---- Visibility ------------------------------------------------------------------------------
  function renderVisibility(): void {
    const pane = dlg.tab('Visibility');
    pane.innerHTML = '';
    const v = indicatorVisibility(inst);
    const commit = () => applyIndicatorVisibility(chart);
    pane.appendChild(note('The indicator is drawn only on the selected intervals.'));
    for (const b of VISIBILITY_BUCKETS) {
      const row = el('div', { class: 'vc-vis-row' });
      row.appendChild(checkbox(!!v[b.key], (on) => { (v as any)[b.key] = on; commit(); }, b.label));
      row.appendChild(el('span', { class: 'vc-vis-label' }));
      row.appendChild(numberInput((v as any)[`${b.key}From`], (n) => { (v as any)[`${b.key}From`] = n; commit(); }, { min: b.min, max: b.max, int: true }));
      row.appendChild(el('span', { class: 'vc-vis-dash', text: '–' }));
      row.appendChild(numberInput((v as any)[`${b.key}To`], (n) => { (v as any)[`${b.key}To`] = n; commit(); }, { min: b.min, max: b.max, int: true }));
      pane.appendChild(row);
    }
    const rr = el('div', { class: 'vc-vis-row' });
    rr.appendChild(checkbox(v.ranges, (on) => { v.ranges = on; commit(); }, 'Ranges'));
    pane.appendChild(rr);
  }

  function renderAll(): void { renderInputs(); renderStyle(); renderVisibility(); }

  function resetDefaults(): void {
    inst.inputs = inputDefaults(def);
    inst.computedFor = -1;
    for (const p of def.plots) inst.styles[p.id] = { ...p.style };
    for (const b of def.bands || []) inst.bands[b.id] = { ...b };
    for (const f of def.fills || []) inst.fills[f.id] = { ...f };
    ext.visibility = defaultVisibility();
    setPrecision('default');
    setLegendValues(true);
    inst.visible = true;
    recompute();
  }

  function restore(): void {
    inst.inputs = { ...snapshot.inputs };
    inst.computedFor = -1;
    inst.styles = clone(snapshot.styles);
    inst.bands = clone(snapshot.bands);
    inst.fills = clone(snapshot.fills);
    inst.visible = snapshot.visible;
    ext.visibility = clone(snapshot.visibility);
    setPrecision(snapshot.precision);
    setLegendValues(snapshot.legendValues);
    inst.priceFormat = snapshot.priceFormat ? { ...snapshot.priceFormat } : null;
    recompute();
  }

  renderAll();
  return dlg;
}
