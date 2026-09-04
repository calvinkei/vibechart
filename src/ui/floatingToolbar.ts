/**
 * Floating drawing toolbar shown near the selected drawing: colours, line width/style, template,
 * lock, hide, settings, clone, remove, "more" menu. Draggable by its grip.
 */
import type { Chart } from '../core/Chart';
import type { Drawing, PropertyDef } from '../drawings/Drawing';
import { el } from '../util/dom';
import { button, colorButton, dropdown, tooltip, type MenuItem } from './components';
import { ICONS } from './icons';
import { openDialog } from './dialogs/index';
import { drawingMenuItems, drawingTemplateItems } from './contextMenus';

export interface ColorKeys { line?: string; fill?: string; text?: string }

/** Pick the style keys used by the quick colour buttons from a drawing's property schema. */
export function pickColorKeys(defs: PropertyDef[]): ColorKeys {
  const colors = defs.filter((d) => d.type === 'color');
  const find = (re: RegExp, exclude: string[] = []) => colors.find((c) => re.test(c.key) && !exclude.includes(c.key))?.key;
  const text = find(/text|font/i);
  const fill = find(/fill|background|^bg/i, text ? [text] : []);
  const used = [text, fill].filter((k): k is string => !!k);
  const line = colors.find((c) => c.key === 'lineColor')?.key ?? colors.find((c) => c.key === 'color')?.key ?? colors.find((c) => !used.includes(c.key))?.key;
  return { line: line && !used.includes(line) ? line : undefined, fill, text };
}

const LINE_STYLES: Array<{ value: number; label: string; dash: string }> = [
  { value: 0, label: 'Solid', dash: '' },
  { value: 2, label: 'Dashed', dash: '6,3' },
  { value: 1, label: 'Dotted', dash: '2,3' },
];

function lineSvg(width: number, dash = ''): string {
  return `<svg viewBox="0 0 28 28" width="100%" height="100%"><path d="M4 14h20" stroke="currentColor" stroke-width="${width}" fill="none"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
}

export interface FloatingToolbar {
  show(d: Drawing | null): void;
  onChanged(): void;
  reposition(): void;
  destroy(): void;
}

export function createFloatingToolbar(chart: Chart): FloatingToolbar {
  const root = chart.root;
  const area = chart.chartAreaEl;
  const bar = el('div', { class: 'oc-floating-toolbar' });
  bar.hidden = true;
  area.appendChild(bar);
  let current: Drawing | null = null;
  let lastKey = '';
  let manualPos: { left: number; top: number } | null = null;
  const measureCtx = document.createElement('canvas').getContext('2d');

  bar.addEventListener('mousedown', (e) => e.stopPropagation());

  function styleKey(d: Drawing): string {
    return `${d.id}|${JSON.stringify(d.style)}|${d.locked}|${d.visible}`;
  }

  // ---- drag by grip ------------------------------------------------------------------------------
  function makeGrip(): HTMLElement {
    const grip = el('span', { class: 'oc-ft-grip', html: ICONS.dragHandle, title: 'Drag to move' });
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const start = { x: e.clientX, y: e.clientY, left: bar.offsetLeft, top: bar.offsetTop };
      const move = (ev: MouseEvent) => {
        manualPos = clampPos(start.left + ev.clientX - start.x, start.top + ev.clientY - start.y);
        bar.style.left = `${manualPos.left}px`;
        bar.style.top = `${manualPos.top}px`;
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    return grip;
  }

  function clampPos(left: number, top: number): { left: number; top: number } {
    const w = bar.offsetWidth, h = bar.offsetHeight;
    return {
      left: Math.max(4, Math.min(area.clientWidth - w - 4, left)),
      top: Math.max(4, Math.min(area.clientHeight - h - 4, top)),
    };
  }

  // ---- build -------------------------------------------------------------------------------------
  function build(d: Drawing): void {
    bar.innerHTML = '';
    const dm = chart.drawings;
    const defs = d.propertyDefs();
    const keys = pickColorKeys(defs);
    const widthKey = defs.find((p) => p.type === 'lineWidth')?.key;
    const styleKeyName = defs.find((p) => p.type === 'lineStyle')?.key;
    const update = (patch: Record<string, unknown>) => dm.updateStyle(d, patch);
    const iconBtn = (icon: string, title: string, onClick: () => void, active = false) => {
      const b = button('', { icon, className: active ? 'oc-active' : '', onClick });
      tooltip(b, title, root);
      return b;
    };
    const sep = () => el('span', { class: 'oc-sep' });

    bar.appendChild(makeGrip());

    // template
    const tpl = iconBtn('templates', 'Template', () => { /* dropdown */ });
    dropdown(tpl, root, () => drawingTemplateItems(chart, d));
    bar.appendChild(tpl);
    bar.appendChild(sep());

    // colours
    const colorCtl = (key: string, title: string) => {
      const b = colorButton(String(d.style[key] ?? '#2962FF'), (c) => update({ [key]: c }));
      tooltip(b, title, root);
      bar.appendChild(b);
    };
    if (keys.line) colorCtl(keys.line, 'Color');
    if (keys.fill) colorCtl(keys.fill, 'Background color');
    if (keys.text) colorCtl(keys.text, 'Text color');

    // line width
    if (widthKey) {
      const cur = Number(d.style[widthKey] ?? 1);
      const b = iconBtn(lineSvg(cur), 'Line width', () => { /* dropdown */ });
      dropdown(b, root, () => [1, 2, 3, 4].map((w) => ({ label: `${w}px`, icon: lineSvg(w), checked: w === Number(d.style[widthKey]), onClick: () => update({ [widthKey]: w }) }) as MenuItem));
      bar.appendChild(b);
    }
    // line style
    if (styleKeyName) {
      const cur = Number(d.style[styleKeyName] ?? 0);
      const curDef = LINE_STYLES.find((s) => s.value === cur) ?? LINE_STYLES[0];
      const b = iconBtn(lineSvg(2, curDef.dash), 'Line style', () => { /* dropdown */ });
      dropdown(b, root, () => LINE_STYLES.map((s) => ({ label: s.label, icon: lineSvg(2, s.dash), checked: s.value === Number(d.style[styleKeyName]), onClick: () => update({ [styleKeyName]: s.value }) }) as MenuItem));
      bar.appendChild(b);
    }
    if (keys.line || keys.fill || keys.text || widthKey || styleKeyName) bar.appendChild(sep());

    // actions
    bar.appendChild(iconBtn('settings', 'Settings', () => openDialog(chart, 'drawingSettings', d)));
    bar.appendChild(iconBtn(d.locked ? 'lock' : 'unlock', d.locked ? 'Unlock' : 'Lock', () => dm.setLocked(d, !d.locked), d.locked));
    bar.appendChild(iconBtn('eyeOff', 'Hide', () => { dm.setVisible(d, false); dm.select(null); }));
    bar.appendChild(iconBtn('clone', 'Clone', () => dm.clone(d)));
    const del = iconBtn('trash', 'Remove', () => dm.remove(d));
    del.disabled = d.locked;
    bar.appendChild(del);
    const more = iconBtn('moreHoriz', 'More', () => { /* dropdown */ });
    dropdown(more, root, () => drawingMenuItems(chart, d), { align: 'right' });
    bar.appendChild(more);
  }

  // ---- position -------------------------------------------------------------------------------------
  function reposition(): void {
    const d = current;
    if (!d || bar.hidden) return;
    if (manualPos) {
      const p = clampPos(manualPos.left, manualPos.top);
      bar.style.left = `${p.left}px`;
      bar.style.top = `${p.top}px`;
      return;
    }
    const entry = chart.paneElements().find((p) => p.pane.id === d.paneId);
    if (!entry || !measureCtx) return;
    const paneRect = entry.el.getBoundingClientRect();
    const areaRect = area.getBoundingClientRect();
    const ts = chart.model.timeScale;
    const font = `normal ${chart.options.layout.fontSize}px ${chart.options.layout.fontFamily}`;
    const rc = chart.drawings.renderContext(measureCtx, d.paneId, ts.width, entry.pane.height, 1, font, d);
    if (!rc) return;
    let b: { x1: number; y1: number; x2: number; y2: number } | null = null;
    try { b = d.bounds(rc); } catch { b = null; }
    if (!b) return;
    const w = bar.offsetWidth, h = bar.offsetHeight;
    const ox = paneRect.left - areaRect.left;
    const oy = paneRect.top - areaRect.top;
    const x1 = Math.max(0, Math.min(ts.width, b.x1));
    const x2 = Math.max(0, Math.min(ts.width, b.x2));
    let left = ox + (x1 + x2) / 2 - w / 2;
    let top = oy + b.y1 - h - 12;
    if (top < 4) top = oy + b.y2 + 12;
    if (top + h > area.clientHeight - 4) top = Math.max(4, area.clientHeight - h - 4);
    left = Math.max(4, Math.min(area.clientWidth - w - 4, left));
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
  }

  function show(d: Drawing | null): void {
    current = d;
    if (!d || !d.visible || chart.drawings.hideAll) {
      bar.hidden = true;
      lastKey = '';
      return;
    }
    build(d);
    lastKey = styleKey(d);
    bar.hidden = false;
    reposition();
  }

  function onChanged(): void {
    const d = current;
    if (!d) return;
    if (!chart.drawings.drawings.includes(d) || chart.drawings.hideAll || !d.visible) { show(chart.drawings.selected && chart.drawings.selected.visible ? chart.drawings.selected : null); return; }
    const key = styleKey(d);
    if (key !== lastKey) { build(d); lastKey = key; }
    reposition();
  }

  return {
    show,
    onChanged,
    reposition,
    destroy() { bar.remove(); current = null; },
  };
}
