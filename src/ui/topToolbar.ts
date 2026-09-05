/**
 * Top toolbar (TradingView header): symbol, compare, intervals (+favorites), chart type (+favorites),
 * indicators, templates, alert/replay; right side: undo/redo, object tree, settings, fullscreen,
 * snapshot, theme.
 */
import type { Chart } from '../core/Chart';
import { DEFAULT_INTERVALS, normalizeResolution, parseResolution } from '../data/resolution';
import type { ResolutionString, SeriesType } from '../data/types';
import { el, downloadDataUrl } from '../util/dom';
import { button, closeAllMenus, dropdown, tooltip, type MenuItem } from './components';
import { ICONS } from './icons';
import { openDialog } from './dialogs/index';
import { altKey, loadPref, menuRow, modKey, toast, toggleInList } from './util';

export const CHART_TYPES: Array<{ type: SeriesType; name: string; icon: string }> = [
  { type: 'bars', name: 'Bars', icon: 'bars' },
  { type: 'candles', name: 'Candles', icon: 'candles' },
  { type: 'hollowCandles', name: 'Hollow candles', icon: 'hollowCandles' },
  { type: 'volumeCandles', name: 'Volume candles', icon: 'volumeCandles' },
  { type: 'line', name: 'Line', icon: 'line' },
  { type: 'lineWithMarkers', name: 'Line with markers', icon: 'lineWithMarkers' },
  { type: 'stepLine', name: 'Step line', icon: 'stepLine' },
  { type: 'area', name: 'Area', icon: 'area' },
  { type: 'hlcArea', name: 'HLC area', icon: 'hlcArea' },
  { type: 'baseline', name: 'Baseline', icon: 'baseline' },
  { type: 'columns', name: 'Columns', icon: 'columns' },
  { type: 'highLow', name: 'High-low', icon: 'highLow' },
  { type: 'heikinAshi', name: 'Heikin Ashi', icon: 'heikinAshi' },
  { type: 'renko', name: 'Renko', icon: 'renko' },
  { type: 'lineBreak', name: 'Line break', icon: 'lineBreak' },
  { type: 'kagi', name: 'Kagi', icon: 'kagi' },
  { type: 'pointAndFigure', name: 'Point & figure', icon: 'pnf' },
  { type: 'rangeBars', name: 'Range', icon: 'rangeBars' },
];

export function chartTypeInfo(type: SeriesType): { type: SeriesType; name: string; icon: string } {
  return CHART_TYPES.find((c) => c.type === type) ?? CHART_TYPES[1];
}

export interface IntervalGroup { group: string; items: Array<{ res: ResolutionString; label: string; name: string }> }

function groupForResolution(res: ResolutionString): string {
  const p = parseResolution(res);
  if (p.isRange) return 'RANGES';
  if (p.isSeconds) return 'SECONDS';
  if (p.isIntraday) return p.value >= 60 ? 'HOURS' : 'MINUTES';
  return 'DAYS';
}

/** Interval menu model: DEFAULT_INTERVALS grouped (SECONDS / MINUTES / HOURS / DAYS) + any extra resolutions. */
export function buildIntervalGroups(intervals: Array<{ res: ResolutionString; group: string }> = DEFAULT_INTERVALS, extra: ResolutionString[] = []): IntervalGroup[] {
  const groups: IntervalGroup[] = [];
  const seen = new Set<string>();
  const add = (res: ResolutionString, group: string) => {
    const key = normalizeResolution(res);
    if (seen.has(key)) return;
    seen.add(key);
    let g = groups.find((x) => x.group === group);
    if (!g) { g = { group, items: [] }; groups.push(g); }
    const p = parseResolution(key);
    g.items.push({ res: key, label: p.label, name: p.name });
  };
  for (const it of intervals) add(it.res, it.group);
  for (const res of extra) add(res, groupForResolution(res));
  for (const g of groups) g.items.sort((a, b) => parseResolution(a.res).seconds - parseResolution(b.res).seconds);
  return groups;
}

export function isResolutionSupported(res: ResolutionString, supported?: ResolutionString[] | null): boolean {
  if (!supported || supported.length === 0) return true;
  const key = normalizeResolution(res);
  return supported.some((s) => normalizeResolution(s) === key);
}

/** Favourite intervals: persisted list (oc.favIntervals) seeded from options.toolbar.favoriteIntervals. */
export function favoriteIntervals(defaults: ResolutionString[]): ResolutionString[] {
  return loadPref<string[]>('favIntervals', defaults).map(normalizeResolution);
}

/** Validate a user typed interval like "1", "5", "60", "1D", "4h", "1w". Returns canonical or null. */
export function parseCustomInterval(input: string): ResolutionString | null {
  const v = input.trim();
  if (!v || !/^\d{0,4}\s*[smhdwr]?$/i.test(v)) return null;
  const norm = normalizeResolution(v);
  return parseResolution(norm).value > 0 ? norm : null;
}

export function createTopToolbar(chart: Chart): { render(): void; updateUndoRedo(): void; destroy(): void } {
  const host = chart.topToolbarEl;
  const root = chart.root;
  let undoBtn: HTMLButtonElement | null = null;
  let redoBtn: HTMLButtonElement | null = null;
  let fsBtn: HTMLButtonElement | null = null;

  const onFullscreen = () => { fsBtn?.classList.toggle('vc-active', document.fullscreenElement === root); };
  document.addEventListener('fullscreenchange', onFullscreen);

  const sep = () => el('div', { class: 'vc-sep' });
  const chevron = () => el('span', { class: 'vc-icon vc-dd-chevron', html: ICONS.chevronDown });
  const iconBtn = (icon: string, title: string, onClick: (e: MouseEvent) => void, className = ''): HTMLButtonElement => {
    const b = button('', { icon, className: `vc-icon-btn ${className}`, onClick });
    tooltip(b, title, root);
    return b;
  };

  // ---- intervals ---------------------------------------------------------------------------
  function intervalMenuItems(): MenuItem[] {
    const items: MenuItem[] = [];
    const supported = chart.symbolInfo?.supported_resolutions;
    const favs = favoriteIntervals(chart.options.toolbar.favoriteIntervals);
    const cur = normalizeResolution(chart.interval);
    // custom interval input row
    const wrap = el('div', { class: 'vc-interval-custom' });
    const input = el('input', { class: 'vc-input', placeholder: 'e.g. 1, 5, 60, 1D', spellcheck: false });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { closeAllMenus(); return; }
      if (e.key !== 'Enter') return;
      const res = parseCustomInterval(input.value);
      if (!res) { toast(root, 'Invalid interval. Try 1, 5, 60, 1D, 1W'); return; }
      if (!isResolutionSupported(res, supported)) { toast(root, `Interval ${parseResolution(res).label} is not supported for this symbol`); return; }
      closeAllMenus();
      void chart.setResolution(res);
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    wrap.appendChild(input);
    items.push({ element: wrap, keepOpen: true });
    setTimeout(() => input.focus(), 0);
    for (const g of buildIntervalGroups(DEFAULT_INTERVALS, [cur, ...favs])) {
      items.push({ separator: true });
      items.push({ title: true, label: g.group });
      for (const it of g.items) {
        items.push({
          element: menuRow({
            label: it.name,
            checked: it.res === cur,
            star: { active: favs.includes(it.res), onToggle: () => { toggleInList('favIntervals', it.res, chart.options.toolbar.favoriteIntervals); render(); } },
          }),
          disabled: !isResolutionSupported(it.res, supported),
          onClick: () => { void chart.setResolution(it.res); },
        });
      }
    }
    return items;
  }

  function renderIntervals(parent: HTMLElement): void {
    const favs = favoriteIntervals(chart.options.toolbar.favoriteIntervals);
    const cur = normalizeResolution(chart.interval);
    const supported = chart.symbolInfo?.supported_resolutions;
    for (const f of favs) {
      const p = parseResolution(f);
      const b = button(p.label, { className: `vc-interval-btn ${f === cur ? 'vc-active' : ''}`, onClick: () => { void chart.setResolution(f); } });
      if (!isResolutionSupported(f, supported)) b.disabled = true;
      tooltip(b, p.name, root);
      parent.appendChild(b);
    }
    const inFavs = favs.includes(cur);
    // The label is always rendered; CSS hides it while the interval is visible as a quick button,
    // and shows it again in compact mode when the quick buttons are gone.
    const dd = button('', { className: `vc-interval-dd ${inFavs ? 'vc-icon-btn vc-in-favs' : 'vc-active'}` });
    dd.appendChild(el('span', { class: 'vc-dd-label', text: parseResolution(cur).label }));
    dd.appendChild(chevron());
    tooltip(dd, `Time interval — ${parseResolution(cur).name}`, root);
    dropdown(dd, root, intervalMenuItems);
    parent.appendChild(dd);
  }

  // ---- chart types --------------------------------------------------------------------------
  function favoriteChartTypes(): string[] { return loadPref<string[]>('favChartTypes', chart.options.toolbar.favoriteChartTypes); }

  function chartTypeMenuItems(): MenuItem[] {
    const favs = favoriteChartTypes();
    return CHART_TYPES.map((ct) => ({
      element: menuRow({
        label: ct.name,
        icon: ct.icon,
        checked: ct.type === chart.chartType,
        star: { active: favs.includes(ct.type), onToggle: () => { toggleInList('favChartTypes', ct.type, chart.options.toolbar.favoriteChartTypes); render(); } },
      }),
      onClick: () => chart.setChartType(ct.type),
    }));
  }

  function renderChartTypes(parent: HTMLElement): void {
    const favs = favoriteChartTypes();
    const cur = chart.chartType;
    for (const f of favs) {
      const info = CHART_TYPES.find((c) => c.type === f);
      if (!info) continue;
      const b = iconBtn(info.icon, info.name, () => chart.setChartType(info.type), `vc-tb-hide-compact ${f === cur ? 'vc-active' : ''}`);
      parent.appendChild(b);
    }
    const info = chartTypeInfo(cur);
    const dd = button('', { icon: info.icon, className: `vc-icon-btn vc-charttype-dd ${favs.includes(cur) ? '' : 'vc-active'}` });
    dd.appendChild(chevron());
    tooltip(dd, `Chart type — ${info.name}`, root);
    dropdown(dd, root, chartTypeMenuItems);
    parent.appendChild(dd);
  }

  // ---- snapshot -------------------------------------------------------------------------------
  function stamp(): string {
    const d = new Date();
    const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
  }
  function snapshotItems(): MenuItem[] {
    const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined';
    return [
      { label: 'Save image', icon: 'camera', onClick: () => { try { downloadDataUrl(chart.takeScreenshot(), `${chart.symbol}_${parseResolution(chart.interval).label}_${stamp()}.png`); } catch (e) { console.error(e); toast(root, 'Screenshot failed'); } } },
      {
        label: 'Copy image', icon: 'copy', disabled: !canCopy, onClick: () => {
          void (async () => {
            try {
              const blob = await (await fetch(chart.takeScreenshot())).blob();
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              toast(root, 'Image copied to clipboard');
            } catch (e) { console.error(e); toast(root, 'Copy failed'); }
          })();
        },
      },
      {
        label: 'Open in new tab', onClick: () => {
          const url = chart.takeScreenshot();
          const w = window.open('', '_blank');
          if (!w) { toast(root, 'Popup blocked'); return; }
          w.document.write(`<title>${chart.symbol} snapshot</title><body style="margin:0;background:#131722"><img src="${url}" style="max-width:100%"></body>`);
          w.document.close();
        },
      },
    ];
  }

  // ---- responsive collapse ----------------------------------------------------------------------
  // Everything that compact/mini mode hides is reachable again from the "More" menu, so a narrow
  // chart loses no capability, only chrome. Items are tagged with the mode that hides them:
  //   vc-tb-hide-compact  quick chart-type favourites, templates, alert, replay
  //   vc-tb-hide-mini     compare and the entire right group
  function moreItems(): MenuItem[] {
    const o = chart.options.toolbar;
    const mini = host.classList.contains('vc-tb-mini');
    const items: MenuItem[] = [];
    if (mini && o.symbolSearch && o.compare) items.push({ label: 'Compare or add symbol', icon: 'compare', onClick: () => openDialog(chart, 'compare') });
    if (o.templates) items.push({ label: 'Indicator templates', icon: 'templates', onClick: () => openDialog(chart, 'templates') });
    if (o.alert) items.push({ label: 'Create alert', icon: 'alert', shortcut: `${altKey()}+A`, onClick: () => toast(root, 'Alerts are not available in this build') });
    if (o.replay) items.push({ label: 'Bar replay', icon: 'replay', onClick: () => chart.events.emit('openDialog', { type: 'replay' }) });
    if (!mini) return items;
    if (items.length) items.push({ separator: true });
    if (o.undoRedo) {
      items.push({ label: 'Undo', icon: 'undo', shortcut: `${modKey()}+Z`, disabled: !chart.drawings.canUndo, onClick: () => chart.undo() });
      items.push({ label: 'Redo', icon: 'redo', shortcut: `${modKey()}+Y`, disabled: !chart.drawings.canRedo, onClick: () => chart.redo() });
      items.push({ separator: true });
    }
    items.push({ label: 'Object tree', icon: 'objectTree', onClick: () => openDialog(chart, 'objectTree') });
    if (o.settings) items.push({ label: 'Chart settings', icon: 'settings', shortcut: `${modKey()}+,`, onClick: () => openDialog(chart, 'chartSettings') });
    if (o.fullscreen) items.push({ label: document.fullscreenElement === root ? 'Exit fullscreen' : 'Fullscreen mode', icon: 'fullscreen', onClick: () => chart.fullscreen() });
    if (o.screenshot) { items.push({ separator: true }); items.push(...snapshotItems()); items.push({ separator: true }); }
    const theme = chart.options.theme;
    items.push({ label: theme === 'dark' ? 'Light theme' : 'Dark theme', icon: theme === 'dark' ? 'light' : 'dark', onClick: () => chart.setTheme(theme === 'dark' ? 'light' : 'dark') });
    return items;
  }

  let leftEl: HTMLElement | null = null;
  /** Start from the full layout and step down until the left group no longer overflows. */
  function relayout(): void {
    if (!leftEl) return;
    host.classList.remove('vc-tb-compact', 'vc-tb-mini');
    const overflowing = () => leftEl!.scrollWidth > leftEl!.clientWidth + 1;
    if (overflowing()) host.classList.add('vc-tb-compact');
    if (overflowing()) host.classList.add('vc-tb-mini');
  }
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => relayout()) : null;
  resizeObserver?.observe(host);

  // ---- render -------------------------------------------------------------------------------------
  function render(): void {
    host.innerHTML = '';
    undoBtn = redoBtn = fsBtn = null;
    const o = chart.options.toolbar;
    const left = el('div', { class: 'vc-tb-group vc-tb-left' });
    const right = el('div', { class: 'vc-tb-group vc-tb-right' });
    leftEl = left;
    const hideMini = (node: HTMLElement): HTMLElement => { node.classList.add('vc-tb-hide-mini'); return node; };

    if (o.symbolSearch) {
      const sym = button(chart.symbol || 'Symbol', { icon: 'search', className: 'vc-symbol-btn', onClick: () => openDialog(chart, 'symbolSearch') });
      tooltip(sym, () => { const i = chart.symbolInfo; return i ? `${i.description}${i.exchange ? ` · ${i.exchange}` : ''} (${modKey()}+K)` : `Symbol search (${modKey()}+K)`; }, root);
      left.appendChild(sym);
      if (o.compare) left.appendChild(iconBtn('compare', 'Compare or add symbol', () => openDialog(chart, 'compare'), 'vc-tb-hide-mini'));
      left.appendChild(sep());
    }
    if (o.intervals) { renderIntervals(left); left.appendChild(sep()); }
    if (o.chartTypes) { renderChartTypes(left); left.appendChild(sep()); }
    if (o.indicators) {
      const b = button('Indicators', { icon: 'fx', className: 'vc-indicators-btn', onClick: () => openDialog(chart, 'indicators') });
      tooltip(b, 'Indicators, metrics & strategies ( / )', root);
      left.appendChild(b);
    }
    if (o.templates) left.appendChild(iconBtn('templates', 'Indicator templates', () => openDialog(chart, 'templates'), 'vc-tb-hide-compact'));
    if (o.alert) left.appendChild(iconBtn('alert', `Create alert (${altKey()}+A)`, () => toast(root, 'Alerts are not available in this build'), 'vc-tb-hide-compact'));
    if (o.replay) left.appendChild(iconBtn('replay', 'Bar replay', () => chart.events.emit('openDialog', { type: 'replay' }), 'vc-tb-hide-compact'));

    if (o.undoRedo) {
      undoBtn = iconBtn('undo', `Undo (${modKey()}+Z)`, () => chart.undo(), 'vc-tb-hide-mini');
      redoBtn = iconBtn('redo', `Redo (${modKey()}+Y)`, () => chart.redo(), 'vc-tb-hide-mini');
      right.appendChild(undoBtn);
      right.appendChild(redoBtn);
      right.appendChild(hideMini(sep()));
      updateUndoRedo();
    }
    right.appendChild(iconBtn('objectTree', 'Object tree', () => openDialog(chart, 'objectTree'), 'vc-tb-hide-mini'));
    if (o.settings) right.appendChild(iconBtn('settings', `Chart settings (${modKey()}+,)`, () => openDialog(chart, 'chartSettings'), 'vc-tb-hide-mini'));
    if (o.fullscreen) {
      fsBtn = iconBtn('fullscreen', 'Fullscreen mode', () => chart.fullscreen(), 'vc-tb-hide-mini');
      right.appendChild(fsBtn);
      onFullscreen();
    }
    if (o.screenshot) {
      const snap = iconBtn('camera', 'Take a snapshot', () => { /* dropdown */ }, 'vc-tb-hide-mini');
      dropdown(snap, root, snapshotItems, { align: 'right' });
      right.appendChild(snap);
    }
    const theme = chart.options.theme;
    right.appendChild(iconBtn(theme === 'dark' ? 'light' : 'dark', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', () => chart.setTheme(theme === 'dark' ? 'light' : 'dark'), 'vc-tb-hide-mini'));
    const more = iconBtn('moreHoriz', 'More', () => { /* dropdown */ }, 'vc-tb-more');
    dropdown(more, root, moreItems, { align: 'right' });
    right.appendChild(more);

    host.appendChild(left);
    host.appendChild(right);
    relayout();
  }

  function updateUndoRedo(): void {
    if (undoBtn) undoBtn.disabled = !chart.drawings.canUndo;
    if (redoBtn) redoBtn.disabled = !chart.drawings.canRedo;
  }

  return {
    render,
    updateUndoRedo,
    destroy() {
      document.removeEventListener('fullscreenchange', onFullscreen);
      resizeObserver?.disconnect();
      host.innerHTML = '';
    },
  };
}
