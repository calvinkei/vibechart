/**
 * Mounts the UI chrome (toolbars, context menus, floating toolbar, nav buttons, keyboard) on a Chart.
 * Registered as Chart.uiFactory by ./index.ts.
 */
import type { Chart } from '../core/Chart';
import { showReplayBar } from './replayBar';
import type { Drawing } from '../drawings/Drawing';
import { closeAllMenus } from './components';
import { openDialog } from './dialogs/index';
import { createTopToolbar } from './topToolbar';
import { createLeftToolbar } from './leftToolbar';
import { createFloatingToolbar } from './floatingToolbar';
import { createContextMenus } from './contextMenus';
import { createBottomBar } from './bottomBar';
import { createNavButtons } from './navButtons';
import { createKeyboard } from './keyboard';
import { loadPref, toast } from './util';

/** Apply a saved per-tool default style (oc.drawingDefaults.<toolId>) to freshly created drawings. */
function applyDrawingDefaults(chart: Chart, d: Drawing): void {
  const saved = loadPref<Record<string, unknown> | null>(`drawingDefaults.${d.type}`, null);
  if (!saved || typeof saved !== 'object') return;
  const o = chart.options.drawing;
  // Only untouched styles (exactly what the tool creates) get defaults; clones/pastes keep their own style.
  const fresh = { ...d.defaultStyle(), lineColor: o.defaultLineColor, lineWidth: o.defaultLineWidth, textColor: o.defaultTextColor };
  if (JSON.stringify(d.style) !== JSON.stringify(fresh)) return;
  Object.assign(d.style, saved);
  d.onChanged();
}

export function mountUI(chart: Chart): { destroy(): void } {
  const subs: Array<() => void> = [];
  const top = createTopToolbar(chart);
  const left = createLeftToolbar(chart);
  const bottom = createBottomBar(chart);
  const nav = createNavButtons(chart);
  const floating = createFloatingToolbar(chart);
  const menus = createContextMenus(chart);
  const keys = createKeyboard(chart);

  const syncVisibility = (): void => {
    const t = chart.options.toolbar;
    chart.topToolbarEl.style.display = t.top ? '' : 'none';
    chart.leftToolbarEl.style.display = t.left ? '' : 'none';
    chart.bottomBarEl.style.display = t.bottom ? '' : 'none';
  };
  const renderAll = (): void => {
    syncVisibility();
    top.render();
    left.render();
    bottom.render();
    nav.update();
    floating.reposition();
  };
  renderAll();

  subs.push(chart.subscribe('optionsChanged', renderAll));
  subs.push(chart.subscribe('themeChanged', () => top.render()));
  subs.push(chart.subscribe('symbolChanged', () => { top.render(); bottom.update(); }));
  subs.push(chart.subscribe('intervalChanged', () => top.render()));
  subs.push(chart.subscribe('chartTypeChanged', () => top.render()));
  subs.push(chart.subscribe('toolChanged', () => left.updateState()));
  subs.push(chart.subscribe('visibleRangeChanged', () => floating.reposition()));
  subs.push(chart.subscribe('dataLoaded', () => floating.reposition()));
  subs.push(chart.drawings.changed.subscribe(() => { top.updateUndoRedo(); left.updateState(); floating.onChanged(); }));
  subs.push(chart.drawings.selectionChanged.subscribe((d) => floating.show(d)));
  subs.push(chart.drawings.created.subscribe((d) => applyDrawingDefaults(chart, d)));
  subs.push(chart.subscribe('contextMenu', (e) => menus.show(e)));
  subs.push(chart.subscribe('openDialog', ({ type, payload }) => {
    switch (type) {
      case 'sourceMenu':
        menus.showSourceMenu(payload as { source: import('../series/Series').DataSource; x: number; y: number });
        return;
      case 'closeAll':
        closeAllMenus();
        left.closeFlyout();
        openDialog(chart, 'closeAll');
        return;
      case 'replay': {
        const existing = chart.chartAreaEl.querySelector<HTMLElement>('.oc-replay-bar');
        if (existing) existing.querySelector<HTMLButtonElement>('button[title="Exit replay"]')?.click();
        else showReplayBar(chart);
        return;
      }
      default:
        openDialog(chart, type, payload);
    }
  }));

  return {
    destroy() {
      for (const u of subs) u();
      closeAllMenus();
      keys.destroy();
      menus.destroy();
      floating.destroy();
      nav.destroy();
      bottom.destroy();
      left.destroy();
      top.destroy();
    },
  };
}
