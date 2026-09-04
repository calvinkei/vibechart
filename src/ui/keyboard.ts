/**
 * Extra keyboard shortcuts on top of the core ones (Alt+G go to date, Ctrl+Alt+H hide drawings,
 * Alt+Shift+R rectangle, "?" shortcuts help) and the shortcuts help dialog.
 */
import type { Chart } from '../core/Chart';
import { getDrawingTool } from '../drawings/Drawing';
import { el, isMac } from '../util/dom';
import { Dialog } from './components';
import { openDialog } from './dialogs/index';
import { getClipboard, pasteDrawing, setClipboard } from './contextMenus';

export interface ShortcutSection { title: string; items: Array<[string, string]> }

export function shortcutSections(): ShortcutSection[] {
  const mod = isMac() ? '⌘' : 'Ctrl';
  const alt = isMac() ? '⌥' : 'Alt';
  return [
    {
      title: 'Chart', items: [
        ['Symbol search', `${mod} + K`], ['Indicators', '/'], ['Chart settings', `${mod} + ,`], ['Go to date', `${alt} + G`],
        ['Reset chart view', `${alt} + R`], ['Invert scale', `${alt} + I`], ['Logarithmic scale', `${alt} + L`], ['Percent scale', `${alt} + P`], ['Auto scale', `${alt} + A`],
        ['Scroll left / right', '← / →'], ['Scroll one screen', 'Shift + ← / →'], ['Zoom in / out', '+ / −'], ['Fit all data', 'Home'], ['Go to realtime', 'End'],
        ['Keyboard shortcuts', '?'], ['Close dialogs / cancel', 'Esc'],
      ],
    },
    {
      title: 'Drawings', items: [
        ['Trend line', `${alt} + T`], ['Horizontal line', `${alt} + H`], ['Vertical line', `${alt} + V`], ['Cross line', `${alt} + J`], ['Fib retracement', `${alt} + F`], ['Parallel channel', `${alt} + C`], ['Rectangle', `${alt} + Shift + R`],
        ['Undo / Redo', `${mod} + Z / ${mod} + Y`], ['Copy / Paste drawing', `${mod} + C / ${mod} + V`], ['Delete selected', 'Del / Backspace'], ['Nudge selected', '← → ↑ ↓ (Shift ×10)'],
        ['Constrain angle (45°)', 'Shift while drawing'], ['Hide all drawings', `${mod} + ${alt} + H`], ['Cancel drawing', 'Esc'],
      ],
    },
  ];
}

export function showShortcutsDialog(chart: Chart): Dialog {
  const dlg = new Dialog({ title: 'Keyboard shortcuts', container: chart.root, width: 640, className: 'oc-shortcuts-dialog' });
  const grid = el('div', { class: 'oc-shortcuts' });
  for (const s of shortcutSections()) {
    const col = el('div', { class: 'oc-shortcuts-col' });
    col.appendChild(el('h4', { text: s.title }));
    for (const [label, keys] of s.items) col.appendChild(el('div', { class: 'oc-shortcut-row' }, [el('span', { text: label }), el('kbd', { class: 'oc-kbd', text: keys })]));
    grid.appendChild(col);
  }
  dlg.body.appendChild(grid);
  return dlg;
}

export function createKeyboard(chart: Chart): { destroy(): void } {
  const root = chart.root;
  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const mod = isMac() ? e.metaKey : e.ctrlKey;
    if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyG') { openDialog(chart, 'goToDate'); e.preventDefault(); return; }
    if (mod && e.altKey && e.code === 'KeyH') { chart.drawings.setHideAll(!chart.drawings.hideAll); e.preventDefault(); return; }
    if (e.altKey && e.shiftKey && e.code === 'KeyR' && getDrawingTool('rectangle')) { chart.setTool('rectangle'); e.preventDefault(); return; }
    if (!mod && !e.altKey && (e.key === '?' || (e.shiftKey && e.code === 'Slash'))) { showShortcutsDialog(chart); e.preventDefault(); return; }
    // mirror the core's Ctrl+C into the UI clipboard so menu "Paste" works
    if (mod && e.code === 'KeyC' && chart.drawings.selected) setClipboard(chart.drawings.selected.serialize());
    // Ctrl+V: the core handles its own clipboard (and calls preventDefault); fall back to the UI clipboard
    if (mod && e.code === 'KeyV' && !e.defaultPrevented && getClipboard()) { pasteDrawing(chart); e.preventDefault(); }
  };
  root.addEventListener('keydown', onKey);
  return { destroy() { root.removeEventListener('keydown', onKey); } };
}
