/**
 * Right-click context menus: chart pane, price axis, time axis, drawing, and the legend "More"
 * (source) menu for indicators / volume / main series.
 */
import type { Chart, ChartEvents } from '../core/Chart';
import type { PriceScale } from '../core/PriceScale';
import type { DateFormat } from '../util/time';
import { DEFAULT_INTERVALS, normalizeResolution, parseResolution } from '../data/resolution';
import { deserializeDrawing, defaultVisibility, getDrawingTool, type Drawing, type DrawingVisibility, type SerializedDrawing } from '../drawings/Drawing';
import { IndicatorInstance } from '../indicators/Indicator';
import type { DataSource } from '../series/Series';
import { formatPrice } from '../util/format';
import { showMenu, type MenuItem } from './components';
import { openDialog } from './dialogs/index';
import { CHART_TYPES } from './topToolbar';
import { altKey, confirmDialog, loadPref, modKey, savePref, timezoneMenuItems, toast } from './util';

// ---- UI drawing clipboard (menu Copy / Paste; mirrored from Ctrl+C by keyboard.ts) ------------------
let clipboard: SerializedDrawing | null = null;
export function getClipboard(): SerializedDrawing | null { return clipboard; }
export function setClipboard(s: SerializedDrawing | null): void { clipboard = s; }

/** Paste the UI clipboard at a pane position (or slightly offset from the original). */
export function pasteDrawing(chart: Chart, at?: { x: number; y: number; paneId: string }): Drawing | null {
  if (!clipboard) return null;
  const copy = deserializeDrawing({ ...clipboard, id: undefined as unknown as string });
  if (!copy) return null;
  const ts = chart.model.timeScale;
  if (at && copy.points.length) {
    copy.paneId = at.paneId;
    const target = chart.drawings.pointAt(at.x, at.y, at.paneId, false);
    const dIndex = ts.timeToIndex(target.time) - ts.timeToIndex(copy.points[0].time);
    const dPrice = target.price - copy.points[0].price;
    copy.moveBy(dIndex, dPrice, ts);
  } else copy.moveBy(5, 0, ts);
  return chart.drawings.add(copy, { select: true });
}

// ---- drawing visibility presets -----------------------------------------------------------------------
type Bucket = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months';
const BUCKETS: Bucket[] = ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months'];
const BUCKET_MAX: Record<Bucket, number> = { seconds: 59, minutes: 59, hours: 24, days: 366, weeks: 52, months: 12 };

export function bucketFor(resSeconds: number): { bucket: Bucket; value: number } {
  if (resSeconds < 60) return { bucket: 'seconds', value: resSeconds };
  if (resSeconds < 3600) return { bucket: 'minutes', value: resSeconds / 60 };
  if (resSeconds < 86400) return { bucket: 'hours', value: resSeconds / 3600 };
  if (resSeconds < 7 * 86400) return { bucket: 'days', value: resSeconds / 86400 };
  if (resSeconds < 28 * 86400) return { bucket: 'weeks', value: resSeconds / (7 * 86400) };
  return { bucket: 'months', value: Math.max(1, Math.round(resSeconds / (30 * 86400))) };
}

/** Build a visibility object for a preset relative to the current resolution (seconds). */
export function visibilityPreset(preset: 'current' | 'above' | 'below' | 'all', resSeconds: number): DrawingVisibility {
  const v = defaultVisibility();
  if (preset === 'all') return v;
  const { bucket, value } = bucketFor(resSeconds);
  const ci = BUCKETS.indexOf(bucket);
  const val = Math.max(1, Math.round(value));
  for (let i = 0; i < BUCKETS.length; i++) {
    const b = BUCKETS[i];
    const on = preset === 'current' ? i === ci : preset === 'above' ? i >= ci : i <= ci;
    (v as unknown as Record<string, unknown>)[b] = on;
    if (i === ci) {
      (v as unknown as Record<string, number>)[`${b}From`] = preset === 'below' ? 1 : val;
      (v as unknown as Record<string, number>)[`${b}To`] = preset === 'above' ? BUCKET_MAX[b] : val;
    }
  }
  return v;
}

// ---- drawing templates (defaults per tool) ----------------------------------------------------------
export function drawingTemplateItems(chart: Chart, d: Drawing): MenuItem[] {
  const key = `drawingDefaults.${d.type}`;
  const saved = loadPref<Record<string, unknown> | null>(key, null);
  return [
    { label: 'Save as default', onClick: () => { const s: Record<string, unknown> = { ...d.style }; delete s.text; savePref(key, s); toast(chart.root, `Saved as default for ${d.typeName}`); } },
    { label: 'Apply default', disabled: !saved, onClick: () => { if (saved) chart.drawings.updateStyle(d, saved); } },
    { label: 'Apply factory defaults', onClick: () => chart.drawings.updateStyle(d, d.defaultStyle()) },
    { separator: true },
    { label: 'Clear saved default', disabled: !saved, onClick: () => { savePref(key, null); toast(chart.root, 'Default cleared'); } },
  ];
}

// ---- drawing menu -----------------------------------------------------------------------------------------
export function drawingMenuItems(chart: Chart, d: Drawing): MenuItem[] {
  const dm = chart.drawings;
  const res = chart.model.resolutionSeconds();
  const applyVisibility = (preset: 'current' | 'above' | 'below' | 'all') => {
    dm.updateStyle(d, {}); // records undo snapshot (pre-change) and re-renders
    d.visibility = visibilityPreset(preset, res);
    chart.requestRender('full');
  };
  const items: MenuItem[] = [
    { label: 'Clone', icon: 'clone', onClick: () => dm.clone(d) },
    { label: 'Copy', icon: 'copy', shortcut: `${modKey()}+C`, onClick: () => { setClipboard(d.serialize()); toast(chart.root, 'Drawing copied'); } },
    { separator: true },
    { label: d.locked ? 'Unlock' : 'Lock', icon: d.locked ? 'unlock' : 'lock', checked: d.locked, onClick: () => dm.setLocked(d, !d.locked) },
    { label: 'Hide', icon: 'eyeOff', onClick: () => { dm.setVisible(d, false); dm.select(null); } },
    {
      label: 'Visual order', icon: 'bringToFront', submenu: [
        { label: 'Bring to front', icon: 'bringToFront', onClick: () => dm.bringToFront(d) },
        { label: 'Send to back', icon: 'sendToBack', onClick: () => dm.sendToBack(d) },
        { label: 'Bring forward', icon: 'bringForward', onClick: () => dm.bringForward(d) },
        { label: 'Send backward', icon: 'sendBackward', onClick: () => dm.sendBackward(d) },
      ],
    },
    {
      label: 'Visibility on intervals', icon: 'eye', submenu: [
        { label: 'Current interval only', onClick: () => applyVisibility('current') },
        { label: 'Current and above', onClick: () => applyVisibility('above') },
        { label: 'Current and below', onClick: () => applyVisibility('below') },
        { label: 'All intervals', onClick: () => applyVisibility('all') },
        { separator: true },
        { label: 'Settings…', onClick: () => openDialog(chart, 'drawingSettings', d) },
      ],
    },
    { label: 'Template', icon: 'templates', submenu: drawingTemplateItems(chart, d) },
    { separator: true },
    { label: 'Settings…', icon: 'settings', onClick: () => openDialog(chart, 'drawingSettings', d) },
    { label: 'Remove', icon: 'trash', shortcut: 'Del', disabled: d.locked, onClick: () => dm.remove(d) },
  ];
  return items;
}

// ---- pane menu ------------------------------------------------------------------------------------------------
export function intervalSubmenu(chart: Chart): MenuItem[] {
  const cur = normalizeResolution(chart.interval);
  const supported = chart.symbolInfo?.supported_resolutions;
  const ok = (res: string) => !supported || supported.length === 0 || supported.some((s) => normalizeResolution(s) === normalizeResolution(res));
  const items: MenuItem[] = [];
  let group = '';
  for (const it of DEFAULT_INTERVALS) {
    if (it.group !== group) { group = it.group; items.push({ title: true, label: group }); }
    const p = parseResolution(it.res);
    items.push({ label: p.name, checked: normalizeResolution(it.res) === cur, disabled: !ok(it.res), onClick: () => { void chart.setResolution(it.res); } });
  }
  return items;
}

export function chartTypeSubmenu(chart: Chart): MenuItem[] {
  return CHART_TYPES.map((c) => ({ label: c.name, icon: c.icon, checked: chart.chartType === c.type, onClick: () => chart.setChartType(c.type) }));
}

export function paneMenuItems(chart: Chart, ctx: { paneId: string; x: number; y: number }): MenuItem[] {
  const m = chart.model;
  const pane = m.getPane(ctx.paneId) ?? m.mainPane;
  const ps = pane.mainScale;
  const ch = m.crosshair;
  const price = ch.visible && ch.paneId === pane.id ? ch.price : ps.yToPrice(ctx.y);
  const time = ch.visible ? ch.time : m.timeScale.xToTime(ctx.x);
  const formatted = Number.isFinite(price) ? formatPrice(price, ps.priceFormat) : null;
  const hl = getDrawingTool('horizontal_line');
  const dm = chart.drawings;
  const hasDrawings = dm.drawings.length > 0;
  const hasIndicators = m.indicators.length > 0;
  return [
    { label: 'Reset chart view', icon: 'reset', shortcut: `${altKey()}+R`, onClick: () => chart.resetView() },
    { separator: true },
    { label: formatted ? `Copy price ${formatted}` : 'Copy price', icon: 'copy', disabled: !formatted, onClick: () => { void navigator.clipboard?.writeText(formatted ?? ''); toast(chart.root, `Copied ${formatted}`); } },
    { label: 'Paste', shortcut: `${modKey()}+V`, disabled: !getClipboard(), onClick: () => pasteDrawing(chart, { x: ctx.x, y: ctx.y, paneId: pane.id }) },
    { separator: true },
    { label: formatted ? `Draw horizontal line at ${formatted}` : 'Draw horizontal line here', icon: hl?.icon || 'minus', disabled: !hl || !formatted, onClick: () => { const d = chart.createShape({ time, price }, { shape: 'horizontal_line', paneId: pane.id }); if (d) dm.select(d); } },
    { label: formatted ? `Add alert at ${formatted}` : 'Add alert', icon: 'alert', disabled: true },
    { separator: true },
    { label: 'Hide all drawings', icon: 'eyeOff', checked: dm.hideAll, shortcut: `${modKey()}+${altKey()}+H`, onClick: () => dm.setHideAll(!dm.hideAll) },
    { label: 'Lock all drawings', icon: 'lock', checked: dm.lockAll, onClick: () => dm.setLockAll(!dm.lockAll) },
    { label: 'Remove drawings', icon: 'trash', disabled: !hasDrawings, onClick: () => { void confirmDialog(chart.root, 'Remove drawings', `Remove all ${dm.drawings.length} drawings from the chart?`, 'Remove').then((ok) => { if (ok) dm.removeAll(); }); } },
    { label: 'Remove indicators', disabled: !hasIndicators, onClick: () => { void confirmDialog(chart.root, 'Remove indicators', `Remove all ${m.indicators.length} indicators from the chart?`, 'Remove').then((ok) => { if (ok) chart.removeAllIndicators(); }); } },
    { label: 'Object tree', icon: 'objectTree', onClick: () => openDialog(chart, 'objectTree') },
    { separator: true },
    { label: 'Change symbol…', icon: 'search', shortcut: `${modKey()}+K`, onClick: () => openDialog(chart, 'symbolSearch') },
    { label: 'Change interval', submenu: intervalSubmenu(chart) },
    { label: 'Change chart type', submenu: chartTypeSubmenu(chart) },
    { label: 'Add indicator…', icon: 'fx', shortcut: '/', onClick: () => openDialog(chart, 'indicators') },
    { separator: true },
    { label: 'Settings…', icon: 'settings', shortcut: `${modKey()}+,`, onClick: () => openDialog(chart, 'chartSettings') },
  ];
}

// ---- price axis menu ---------------------------------------------------------------------------------------------
function scaleOptionKey(ps: PriceScale): 'rightPriceScale' | 'leftPriceScale' | null {
  if (ps.position === 'left') return 'leftPriceScale';
  if (ps.position === 'right') return 'rightPriceScale';
  return null;
}

export function priceAxisMenuItems(chart: Chart, paneId: string | null): MenuItem[] {
  const m = chart.model;
  const pane = (paneId && m.getPane(paneId)) || m.mainPane;
  const ps = pane.mainScale;
  const rerender = () => chart.requestRender('full');
  const setMode = (mode: 'normal' | 'logarithmic' | 'percentage' | 'indexedTo100') => { ps.setMode(mode); rerender(); };
  const optKey = scaleOptionKey(ps);
  const sym = m.options.symbol;
  const indShowLast = m.indicators.length === 0 || m.indicators.some((i) => Object.values(i.styles).some((s) => s.showLast));
  const toggleIndicatorLast = () => { const v = !indShowLast; for (const i of m.indicators) for (const s of Object.values(i.styles)) s.showLast = v; rerender(); };
  return [
    { label: 'Reset price scale', icon: 'reset', onClick: () => { ps.setAutoScale(true); rerender(); } },
    { label: 'Auto (fits data to screen)', checked: ps.isAutoScale, shortcut: `${altKey()}+A`, onClick: () => { ps.setAutoScale(!ps.isAutoScale); rerender(); } },
    { label: 'Lock price to bar ratio', checked: ps.options.lockPriceToBarRatio, disabled: !optKey, onClick: () => { if (optKey) chart.applyOptions({ [optKey]: { lockPriceToBarRatio: !ps.options.lockPriceToBarRatio } }); } },
    { label: 'Scale price chart only', checked: ps.options.scaleSeriesOnly, disabled: !optKey, onClick: () => { if (optKey) chart.applyOptions({ [optKey]: { scaleSeriesOnly: !ps.options.scaleSeriesOnly } }); } },
    { label: 'Invert scale', checked: ps.inverted, shortcut: `${altKey()}+I`, onClick: () => { ps.setInverted(!ps.inverted); rerender(); } },
    { separator: true },
    { label: 'Regular', checked: ps.mode === 'normal', onClick: () => setMode('normal') },
    { label: 'Percent', checked: ps.mode === 'percentage', shortcut: `${altKey()}+P`, onClick: () => setMode('percentage') },
    { label: 'Indexed to 100', checked: ps.mode === 'indexedTo100', onClick: () => setMode('indexedTo100') },
    { label: 'Logarithmic', checked: ps.mode === 'logarithmic', shortcut: `${altKey()}+L`, onClick: () => setMode('logarithmic') },
    { separator: true },
    {
      label: 'Labels', submenu: [
        { label: 'Symbol name label', checked: m.options.legend.showSymbol, onClick: () => chart.applyOptions({ legend: { showSymbol: !m.options.legend.showSymbol } }) },
        { label: 'Symbol last price value', checked: sym.lastValueVisible, onClick: () => chart.applyOptions({ symbol: { lastValueVisible: !sym.lastValueVisible } }) },
        { label: 'Indicator last value', checked: indShowLast, disabled: m.indicators.length === 0, onClick: toggleIndicatorLast },
        { label: 'High and low labels', checked: sym.highLowLabelsVisible, onClick: () => chart.applyOptions({ symbol: { highLowLabelsVisible: !sym.highLowLabelsVisible } }) },
        { label: 'Countdown to bar close', checked: sym.countdownVisible, onClick: () => chart.applyOptions({ symbol: { countdownVisible: !sym.countdownVisible } }) },
        { label: 'Bid and ask labels', checked: sym.bidAskVisible, onClick: () => chart.applyOptions({ symbol: { bidAskVisible: !sym.bidAskVisible } }) },
        { label: 'Pre/post market price', checked: sym.prePostMarketVisible, onClick: () => chart.applyOptions({ symbol: { prePostMarketVisible: !sym.prePostMarketVisible } }) },
      ],
    },
    {
      label: 'Lines', submenu: [
        { label: 'Symbol price line', checked: sym.priceLine.visible, onClick: () => chart.applyOptions({ symbol: { priceLine: { visible: !sym.priceLine.visible } } }) },
        { label: 'High and low lines', checked: sym.highLowLinesVisible, onClick: () => chart.applyOptions({ symbol: { highLowLinesVisible: !sym.highLowLinesVisible } }) },
      ],
    },
    { separator: true },
    { label: 'Settings…', icon: 'settings', onClick: () => openDialog(chart, 'chartSettings', 'scales') },
  ];
}

// ---- time axis menu ----------------------------------------------------------------------------------------------
const DATE_FORMATS: DateFormat[] = ['dd MMM yyyy', 'MMM dd, yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy/MM/dd', 'dd-MM-yyyy', 'MM-dd-yyyy', 'dd.MM.yyyy', 'yy-MM-dd', 'dd MMM yy'];

export function timeAxisMenuItems(chart: Chart): MenuItem[] {
  const o = chart.options;
  return [
    { label: 'Reset time scale', icon: 'reset', onClick: () => chart.model.timeScale.reset() },
    { label: 'Go to date…', icon: 'goToDate', shortcut: `${altKey()}+G`, onClick: () => openDialog(chart, 'goToDate') },
    { separator: true },
    { label: 'Timezone', icon: 'calendar', submenu: timezoneMenuItems(chart) },
    { label: 'Date format', submenu: DATE_FORMATS.map((f) => ({ label: f, checked: o.localization.dateFormat === f, onClick: () => chart.applyOptions({ localization: { dateFormat: f } }) })) },
    { label: 'Time format', submenu: (['24h', '12h'] as const).map((f) => ({ label: f === '24h' ? '24 hours' : '12 hours', checked: o.localization.timeFormat === f, onClick: () => chart.applyOptions({ localization: { timeFormat: f } }) })) },
    { separator: true },
    { label: 'Show session breaks', checked: o.sessionBreaks, onClick: () => chart.applyOptions({ sessionBreaks: !o.sessionBreaks }) },
    { label: 'Show time', checked: o.timeScale.timeVisible, onClick: () => chart.applyOptions({ timeScale: { timeVisible: !o.timeScale.timeVisible } }) },
    { label: 'Show seconds', checked: o.timeScale.secondsVisible, onClick: () => chart.applyOptions({ timeScale: { secondsVisible: !o.timeScale.secondsVisible } }) },
    { separator: true },
    { label: 'Settings…', icon: 'settings', onClick: () => openDialog(chart, 'chartSettings', 'scales') },
  ];
}

// ---- legend "More" (source) menu -------------------------------------------------------------------------------
export function pinIndicatorToScale(chart: Chart, inst: IndicatorInstance, target: 'right' | 'left' | 'none'): void {
  const m = chart.model;
  const pane = m.paneOf(inst);
  if (!pane) return;
  pane.removeSource(inst);
  const id = target === 'none' ? inst.id : target;
  inst.priceScaleId = id;
  if (target === 'none') {
    const ps = pane.getPriceScale(id);
    ps.overlayMargins = { top: 0.1, bottom: 0.1 };
    ps.position = 'overlay';
  }
  if (target === 'left' && !m.options.leftPriceScale.visible) chart.applyOptions({ leftPriceScale: { visible: true } });
  pane.addSource(inst);
  m.indicatorsChanged.fire();
  chart.requestRender('layout');
}

export function sourceMenuItems(chart: Chart, source: DataSource): MenuItem[] {
  const m = chart.model;
  const rerender = () => chart.requestRender('full');
  if (source instanceof IndicatorInstance) {
    const inst = source;
    const pane = m.paneOf(inst);
    const others = m.panes.filter((p) => p !== pane);
    const scaleId = inst.priceScaleId;
    const reorder = (front: boolean) => {
      if (!pane) return;
      const zs = pane.sources.map((s) => s.zIndex);
      inst.zIndex = front ? Math.max(...zs) + 1 : Math.min(...zs) - 1;
      pane.sortSources();
      rerender();
    };
    return [
      {
        label: 'Move to', submenu: [
          { label: 'Main chart', disabled: pane?.isMain, onClick: () => m.moveIndicator(inst, 'main') },
          { label: 'New pane below', onClick: () => m.moveIndicator(inst, 'new') },
          ...(others.length ? [{ separator: true } as MenuItem] : []),
          ...others.map((p, i) => ({ label: p.isMain ? 'Main chart' : `Pane ${m.panes.indexOf(p) + 1}${i === 0 && !p.isMain ? '' : ''}`, onClick: () => m.moveIndicator(inst, p.id) })).filter((it) => it.label !== 'Main chart'),
        ],
      },
      {
        label: 'Pin to scale', submenu: [
          { label: 'Right', checked: scaleId === 'right', onClick: () => pinIndicatorToScale(chart, inst, 'right') },
          { label: 'Left', checked: scaleId === 'left', onClick: () => pinIndicatorToScale(chart, inst, 'left') },
          { label: 'No scale (fullscreen)', checked: scaleId !== 'right' && scaleId !== 'left', onClick: () => pinIndicatorToScale(chart, inst, 'none') },
        ],
      },
      {
        label: 'Visual order', submenu: [
          { label: 'Bring to front', icon: 'bringToFront', onClick: () => reorder(true) },
          { label: 'Send to back', icon: 'sendToBack', onClick: () => reorder(false) },
        ],
      },
      { separator: true },
      { label: inst.visible ? 'Hide' : 'Show', icon: inst.visible ? 'eyeOff' : 'eye', onClick: () => { inst.visible = !inst.visible; rerender(); } },
      { label: 'Settings…', icon: 'settings', onClick: () => openDialog(chart, 'indicatorSettings', inst) },
      { label: 'Remove', icon: 'trash', onClick: () => chart.removeIndicator(inst) },
    ];
  }
  if (source === m.volume) {
    const vis = m.options.volume.visible;
    return [
      { label: vis ? 'Hide' : 'Show', icon: vis ? 'eyeOff' : 'eye', onClick: () => { chart.applyOptions({ volume: { visible: !vis } }); } },
      { label: 'Settings…', icon: 'settings', onClick: () => openDialog(chart, 'chartSettings', 'volume') },
      { label: 'Remove', icon: 'trash', onClick: () => chart.applyOptions({ volume: { visible: false } }) },
    ];
  }
  // main series
  return [
    { label: 'Change symbol…', icon: 'search', shortcut: `${modKey()}+K`, onClick: () => openDialog(chart, 'symbolSearch') },
    { label: 'Change interval', submenu: intervalSubmenu(chart) },
    { label: 'Change chart type', submenu: chartTypeSubmenu(chart) },
    { separator: true },
    { label: source.visible ? 'Hide' : 'Show', icon: source.visible ? 'eyeOff' : 'eye', onClick: () => { source.visible = !source.visible; rerender(); } },
    { label: 'Settings…', icon: 'settings', onClick: () => openDialog(chart, 'chartSettings', 'symbol') },
  ];
}

// ---- controller ---------------------------------------------------------------------------------------------------------
export interface ContextMenus {
  show(evt: ChartEvents['contextMenu']): void;
  showSourceMenu(payload: { source: DataSource; x: number; y: number }): void;
  destroy(): void;
}

export function createContextMenus(chart: Chart): ContextMenus {
  const root = chart.root;
  let last: { x: number; y: number; type: string; target: EventTarget | null } | null = null;
  const track = (e: MouseEvent) => { last = { x: e.clientX, y: e.clientY, type: e.type, target: e.target }; };
  root.addEventListener('mousedown', track, true);
  root.addEventListener('contextmenu', track, true);
  root.addEventListener('click', track, true);

  /** Convert to root-relative coordinates. Prefers the real pointer position captured from the DOM event. */
  function rootPoint(evt: ChartEvents['contextMenu']): { x: number; y: number } {
    const rr = root.getBoundingClientRect();
    if (last) return { x: last.x - rr.left, y: last.y - rr.top };
    const paneEl = chart.paneElements().find((p) => p.pane.id === (evt.paneId ?? 'main'))?.el;
    const pr = paneEl ? paneEl.getBoundingClientRect() : rr;
    return { x: pr.left - rr.left + evt.x, y: pr.top - rr.top + evt.y };
  }

  function show(evt: ChartEvents['contextMenu']): void {
    // The legend "More" button emits a pane contextMenu followed by a sourceMenu; skip the pane menu.
    if (last && last.type === 'click' && (last.target as HTMLElement | null)?.closest?.('.vc-legend')) return;
    const p = rootPoint(evt);
    let items: MenuItem[];
    switch (evt.target) {
      case 'drawing': items = evt.drawing ? drawingMenuItems(chart, evt.drawing) : []; break;
      case 'priceAxis': items = priceAxisMenuItems(chart, evt.paneId); break;
      case 'timeAxis': items = timeAxisMenuItems(chart); break;
      default: items = paneMenuItems(chart, { paneId: evt.paneId ?? 'main', x: evt.x, y: evt.y }); break;
    }
    if (!items.length) return;
    showMenu(root, p.x, p.y, items, { minWidth: 220 });
  }

  function showSourceMenu(payload: { source: DataSource; x: number; y: number }): void {
    const rr = root.getBoundingClientRect();
    const ar = chart.chartAreaEl.getBoundingClientRect();
    const x = last ? last.x - rr.left : ar.left - rr.left + payload.x;
    const y = last ? last.y - rr.top : ar.top - rr.top + payload.y;
    showMenu(root, x, y, sourceMenuItems(chart, payload.source), { minWidth: 200 });
  }

  return {
    show,
    showSourceMenu,
    destroy() {
      root.removeEventListener('mousedown', track, true);
      root.removeEventListener('contextmenu', track, true);
      root.removeEventListener('click', track, true);
    },
  };
}
