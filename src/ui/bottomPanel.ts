/**
 * Bottom panel (TradingView's Pine Editor / Strategy Tester dock): a tab strip that stays visible
 * below the chart, a resizable body, the Python editor with its toolbar and console, and the
 * Strategy Tester. Created only when the chart has a StrategyController.
 */
import type { Chart } from '../core/Chart';
import { DEFAULT_STRATEGY_SCRIPT, type StrategyController, type StrategyPanelTab } from '../strategy/StrategyEngine';
import { el } from '../util/dom';
import { button, tooltip, dropdown, Dialog, textInput, escapeHtml, type MenuItem } from './components';
import { ICONS } from './icons';
import { createCodeEditor, type CodeEditor } from './codeEditor';
import { createStrategyTester } from './strategyTester';
import { loadPref, savePref, toast, confirmDialog, modKey } from './util';

const SCRIPTS_KEY = 'strategy.scripts';
const CURRENT_KEY = 'strategy.currentName';
const REFERENCE_URL = 'https://github.com/calvinkei/vibechart/blob/main/docs/STRATEGY.md';

export function createBottomPanel(chart: Chart): { destroy(): void } {
  const ctrl = chart.strategy as StrategyController;
  const root = el('div', { class: 'vc-bottom-panel' });
  const resizer = el('div', { class: 'vc-bp-resizer', title: 'Drag to resize' });
  const header = el('div', { class: 'vc-bp-header' });
  const tabsEl = el('div', { class: 'vc-bp-tabs' });
  const actions = el('div', { class: 'vc-bp-actions' });
  const body = el('div', { class: 'vc-bp-body' });
  const editorPane = el('div', { class: 'vc-bp-pane vc-bp-editor' });
  const testerPane = el('div', { class: 'vc-bp-pane vc-bp-tester' });
  body.appendChild(editorPane);
  body.appendChild(testerPane);
  header.appendChild(tabsEl);
  header.appendChild(actions);
  root.appendChild(resizer);
  root.appendChild(header);
  root.appendChild(body);
  chart.root.insertBefore(root, chart.overlayEl);
  const offs: Array<() => void> = [];

  // ---- tab strip -------------------------------------------------------------------------------
  const tabBtns = new Map<StrategyPanelTab, HTMLButtonElement>();
  for (const [id, label] of [['editor', 'Python Editor'], ['tester', 'Strategy Tester']] as Array<[StrategyPanelTab, string]>) {
    const b = el('button', { class: 'vc-bp-tab', text: label });
    b.addEventListener('click', () => { if (ctrl.panel.open && ctrl.panel.tab === id) ctrl.closePanel(); else ctrl.openPanel(id); });
    tabsEl.appendChild(b);
    tabBtns.set(id, b);
  }
  const maxBtn = button('', { icon: 'fullscreen', className: 'vc-icon-btn', onClick: () => ctrl.setPanelMaximized(!ctrl.panel.maximized) });
  tooltip(maxBtn, 'Maximize panel', chart.root);
  const toggleBtn = button('', { icon: 'chevronDown', className: 'vc-icon-btn', onClick: () => ctrl.togglePanel() });
  tooltip(toggleBtn, () => (ctrl.panel.open ? 'Collapse panel' : 'Expand panel'), chart.root);
  actions.appendChild(maxBtn);
  actions.appendChild(toggleBtn);

  // ---- resizing --------------------------------------------------------------------------------
  resizer.addEventListener('mousedown', (e) => {
    if (!ctrl.panel.open || ctrl.panel.maximized) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY, startH = body.offsetHeight;
    const move = (ev: MouseEvent): void => {
      const max = chart.root.clientHeight - header.offsetHeight - 140;
      ctrl.panel.height = Math.max(120, Math.min(max, startH + (startY - ev.clientY)));
      applyLayout();
    };
    const up = (): void => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); ctrl.setPanelHeight(ctrl.panel.height); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  function applyLayout(): void {
    const p = ctrl.panel;
    root.classList.toggle('vc-bp-open', p.open);
    root.classList.toggle('vc-bp-max', p.open && p.maximized);
    // never squeeze the chart below ~160px; the user can still maximize on purpose
    const maxH = Math.max(120, chart.root.clientHeight - header.offsetHeight - 160);
    body.style.height = p.open ? (p.maximized ? `${Math.max(120, chart.root.clientHeight - header.offsetHeight - 2)}px` : `${Math.min(p.height, maxH)}px`) : '0px';
    body.style.display = p.open ? '' : 'none';
    for (const [id, b] of tabBtns) b.classList.toggle('vc-active', p.open && p.tab === id);
    editorPane.style.display = p.tab === 'editor' ? '' : 'none';
    testerPane.style.display = p.tab === 'tester' ? '' : 'none';
    toggleBtn.innerHTML = `<span class="vc-icon" style="width:18px;height:18px">${p.open ? ICONS.chevronDown : ICONS.chevronUp}</span>`;
    maxBtn.style.display = p.open ? '' : 'none';
    maxBtn.classList.toggle('vc-active', p.maximized);
    chart.resize();
    if (p.open && p.tab === 'tester') tester.render();
  }

  // ---- editor pane -----------------------------------------------------------------------------
  const toolbar = el('div', { class: 'vc-ed-toolbar' });
  const scripts = (): Record<string, string> => loadPref<Record<string, string>>(SCRIPTS_KEY, {});
  let currentName = loadPref<string>(CURRENT_KEY, '');
  let savedText: string | null = currentName ? scripts()[currentName] ?? null : null;

  const nameBtn = button('', { className: 'vc-ed-name' });
  nameBtn.appendChild(el('span', { class: 'vc-ed-name-text' }));
  nameBtn.appendChild(el('span', { class: 'vc-icon vc-dd-chevron', html: ICONS.chevronDown }));
  const nameText = (): string => (currentName || 'Untitled strategy') + (savedText !== null && savedText !== ctrl.script ? ' •' : '');
  const refreshName = (): void => { (nameBtn.querySelector('.vc-ed-name-text') as HTMLElement).textContent = nameText(); };
  dropdown(nameBtn, chart.root, (): MenuItem[] => [
    { label: 'New strategy', icon: 'plus', onClick: () => { void newScript(); } },
    { label: 'Rename…', disabled: !currentName, onClick: () => { void saveAs(true); } },
    { label: 'Make a copy…', onClick: () => { void saveAs(false, true); } },
    { label: 'Delete', icon: 'trash', disabled: !currentName, onClick: () => { void deleteScript(); } },
    { separator: true },
    { label: 'Copy code to clipboard', icon: 'copy', onClick: () => { void navigator.clipboard?.writeText(ctrl.script).then(() => toast(chart.root, 'Code copied')); } },
    { label: 'Load example: MA Cross', onClick: () => { void loadExample(); } },
  ]);
  toolbar.appendChild(nameBtn);

  const openBtn = button('Open', { className: 'vc-ed-btn' });
  openBtn.appendChild(el('span', { class: 'vc-icon vc-dd-chevron', html: ICONS.chevronDown }));
  dropdown(openBtn, chart.root, (): MenuItem[] => {
    const names = Object.keys(scripts()).sort();
    if (!names.length) return [{ label: 'No saved scripts', disabled: true }];
    return names.map((n) => ({ label: n, checked: n === currentName, onClick: () => { void openScript(n); } }));
  });
  toolbar.appendChild(openBtn);
  const saveBtn = button('Save', { className: 'vc-ed-btn', onClick: () => { void save(); } });
  tooltip(saveBtn, `Save (${modKey()}+S)`, chart.root);
  toolbar.appendChild(saveBtn);
  toolbar.appendChild(el('span', { class: 'vc-sep' }));
  const runBtn = el('button', { class: 'vc-primary vc-ed-run' });
  runBtn.addEventListener('click', () => { if (ctrl.state === 'running') ctrl.cancel(); else void run(); });
  tooltip(runBtn, () => `${ctrl.state === 'running' ? 'Cancel' : ctrl.isOnChart ? 'Update the strategy on the chart' : 'Add the strategy to the chart'} (${modKey()}+Enter)`, chart.root);
  toolbar.appendChild(runBtn);
  const removeBtn = button('', { icon: 'trash', className: 'vc-icon-btn vc-ed-remove', onClick: () => ctrl.remove() });
  tooltip(removeBtn, 'Remove strategy from chart', chart.root);
  toolbar.appendChild(removeBtn);
  const statusEl = el('span', { class: 'vc-ed-status' });
  toolbar.appendChild(statusEl);
  const right = el('div', { class: 'vc-ed-right' });
  const consoleBtn = button('Console', { className: 'vc-ed-btn', onClick: () => setConsole(!consoleOpen) });
  const consoleBadge = el('span', { class: 'vc-badge', hidden: true });
  consoleBtn.appendChild(consoleBadge);
  right.appendChild(consoleBtn);
  const refBtn = button('', { icon: 'info', className: 'vc-icon-btn', onClick: () => window.open(REFERENCE_URL, '_blank', 'noopener') });
  tooltip(refBtn, 'Python strategy reference', chart.root);
  right.appendChild(refBtn);
  toolbar.appendChild(right);
  editorPane.appendChild(toolbar);

  const editorHost = el('div', { class: 'vc-ed-host' });
  editorPane.appendChild(editorHost);
  const editor: CodeEditor = createCodeEditor({
    value: ctrl.script,
    onChange: (v) => { ctrl.setScript(v); refreshName(); refreshRun(); },
    onRun: () => { void run(); },
    onSave: () => { void save(); },
    placeholder: '# Write your strategy in Python…',
  });
  editorHost.appendChild(editor.el);

  const consoleEl = el('div', { class: 'vc-ed-console' });
  const consoleHead = el('div', { class: 'vc-ed-console-head' });
  consoleHead.appendChild(el('span', { text: 'Console' }));
  const clearBtn = el('button', { class: 'vc-range-btn', text: 'Clear' });
  clearBtn.addEventListener('click', () => { ctrl.logs = []; renderConsole(); });
  consoleHead.appendChild(clearBtn);
  const consoleClose = el('button', { class: 'vc-range-btn', html: ICONS.close, title: 'Hide console' });
  consoleClose.addEventListener('click', () => setConsole(false));
  consoleHead.appendChild(consoleClose);
  consoleEl.appendChild(consoleHead);
  const consoleBody = el('div', { class: 'vc-ed-console-body' });
  consoleEl.appendChild(consoleBody);
  editorPane.appendChild(consoleEl);
  let consoleOpen = false;
  function setConsole(open: boolean): void { consoleOpen = open; consoleEl.style.display = open ? '' : 'none'; consoleBtn.classList.toggle('vc-active', open); }
  setConsole(false);

  function renderConsole(): void {
    const err = ctrl.error;
    const lines: string[] = [];
    if (err) {
      const where = err.line ? `<a data-line="${err.line}">Line ${err.line}${err.column ? `:${err.column}` : ''}</a> ` : '';
      const bar = err.bar !== undefined && err.bar !== null && err.phase === 'runtime' ? `<span class="vc-ed-bar">bar ${err.bar}</span> ` : '';
      lines.push(`<div class="vc-ed-line vc-neg">${bar}${where}${escapeHtml(err.message)}</div>`);
      if (err.traceback && err.phase === 'runtime') lines.push(`<pre class="vc-ed-tb">${escapeHtml(err.traceback)}</pre>`);
    }
    for (const l of ctrl.logs.slice(-500)) lines.push(`<div class="vc-ed-line vc-ed-${l.level}"><span class="vc-ed-bar">bar ${l.bar}</span> ${escapeHtml(l.message)}</div>`);
    if (!lines.length) lines.push('<div class="vc-ed-line vc-ed-muted">No messages. Errors and log.info() output appear here.</div>');
    consoleBody.innerHTML = lines.join('');
    consoleBody.querySelectorAll<HTMLElement>('a[data-line]').forEach((a) => a.addEventListener('click', () => { editor.setError(Number(a.dataset.line), err?.message); editor.focus(); }));
    const count = (err ? 1 : 0) + ctrl.logs.length;
    consoleBadge.hidden = !count;
    consoleBadge.textContent = String(count);
    consoleBadge.classList.toggle('vc-neg', !!err);
    consoleBody.scrollTop = consoleBody.scrollHeight;
  }

  function refreshRun(): void {
    const running = ctrl.state === 'running';
    runBtn.textContent = running ? 'Cancel' : ctrl.isOnChart ? (ctrl.isDirty ? 'Update on chart' : 'Update on chart') : 'Add to chart';
    runBtn.classList.toggle('vc-ed-running', running);
    removeBtn.style.display = ctrl.isOnChart ? '' : 'none';
    statusEl.textContent = running ? (ctrl.progress.total ? `Running… ${Math.round((ctrl.progress.done / ctrl.progress.total) * 100)}%` : ctrl.status || 'Running…') : ctrl.status;
  }

  async function run(): Promise<void> {
    editor.setError(null);
    await ctrl.run();
    if (ctrl.error) { editor.setError(ctrl.error.line, ctrl.error.message); setConsole(true); }
  }

  // ---- script library (localStorage) ---------------------------------------------------------------
  function persist(name: string, text: string): void {
    const all = scripts();
    all[name] = text;
    savePref(SCRIPTS_KEY, all);
    currentName = name;
    savedText = text;
    savePref(CURRENT_KEY, name);
    refreshName();
  }
  async function save(): Promise<void> {
    if (!currentName) { await saveAs(false); return; }
    persist(currentName, ctrl.script);
    toast(chart.root, `Saved "${currentName}"`);
  }
  async function saveAs(rename: boolean, copy = false): Promise<void> {
    const name = await askName(rename ? 'Rename strategy' : copy ? 'Copy strategy' : 'Save strategy', currentName ? (copy ? `${currentName} copy` : currentName) : titleFromScript());
    if (!name) return;
    if (rename && currentName && currentName !== name) {
      const all = scripts();
      delete all[currentName];
      savePref(SCRIPTS_KEY, all);
    }
    persist(name, ctrl.script);
    toast(chart.root, `Saved "${name}"`);
  }
  function titleFromScript(): string {
    const m = /strategy\(\s*["']([^"']+)["']/.exec(ctrl.script);
    return m ? m[1] : 'My strategy';
  }
  function askName(title: string, initial: string): Promise<string | null> {
    return new Promise((resolve) => {
      let value = initial;
      const dlg = new Dialog({
        title, container: chart.root, width: 380,
        buttons: [
          { label: 'Cancel', onClick: (d) => { d.close(); } },
          { label: 'Save', primary: true, onClick: (d) => { const v = value.trim(); if (!v) return; d.close(); resolve(v); } },
        ],
        onClose: () => resolve(null),
      });
      const inp = textInput(initial, (v) => { value = v; }, { placeholder: 'Strategy name' });
      inp.classList.add('vc-ed-name-input');
      inp.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { const v = value.trim(); if (v) { dlg.close(); resolve(v); } } });
      dlg.body.appendChild(inp);
      setTimeout(() => { inp.focus(); (inp as HTMLInputElement).select?.(); }, 0);
    });
  }
  async function confirmDiscard(): Promise<boolean> {
    if (savedText === null ? ctrl.script === DEFAULT_STRATEGY_SCRIPT || !ctrl.script.trim() : savedText === ctrl.script) return true;
    return confirmDialog(chart.root, 'Unsaved changes', 'The current script has unsaved changes. Discard them?', 'Discard');
  }
  async function newScript(): Promise<void> {
    if (!(await confirmDiscard())) return;
    currentName = ''; savedText = null; savePref(CURRENT_KEY, '');
    setScript(DEFAULT_STRATEGY_SCRIPT);
  }
  async function loadExample(): Promise<void> {
    if (!(await confirmDiscard())) return;
    setScript(DEFAULT_STRATEGY_SCRIPT);
  }
  async function openScript(name: string): Promise<void> {
    if (!(await confirmDiscard())) return;
    const text = scripts()[name];
    if (text === undefined) return;
    currentName = name; savedText = text; savePref(CURRENT_KEY, name);
    setScript(text);
  }
  async function deleteScript(): Promise<void> {
    if (!currentName) return;
    if (!(await confirmDialog(chart.root, 'Delete strategy', `Delete "${currentName}"? This cannot be undone.`, 'Delete'))) return;
    const all = scripts();
    delete all[currentName];
    savePref(SCRIPTS_KEY, all);
    currentName = ''; savedText = null; savePref(CURRENT_KEY, '');
    refreshName();
  }
  function setScript(text: string): void {
    ctrl.setScript(text);
    editor.setValue(text);
    editor.setError(null);
    refreshName();
    refreshRun();
  }

  // ---- tester pane -----------------------------------------------------------------------------
  const tester = createStrategyTester(chart, testerPane);

  // ---- wiring ------------------------------------------------------------------------------------
  offs.push(ctrl.events.on('panelChanged', applyLayout));
  offs.push(ctrl.events.on('stateChanged', () => { refreshRun(); renderConsole(); }));
  offs.push(ctrl.events.on('progress', refreshRun));
  offs.push(ctrl.events.on('statusChanged', refreshRun));
  offs.push(ctrl.events.on('onChartChanged', refreshRun));
  offs.push(ctrl.events.on('reportChanged', () => { refreshRun(); if (ctrl.report && ctrl.panel.open) ctrl.setPanelTab('tester'); }));
  offs.push(ctrl.events.on('logsChanged', renderConsole));
  offs.push(ctrl.events.on('errorChanged', (e) => { renderConsole(); if (e) { editor.setError(e.line, e.message); setConsole(true); } }));
  offs.push(ctrl.events.on('scriptChanged', (s) => { if (editor.getValue() !== s) editor.setValue(s); refreshName(); refreshRun(); }));
  offs.push(chart.subscribe('themeChanged', () => { /* CSS variables handle it */ }));
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (ctrl.panel.maximized) applyLayout(); }) : null;
  ro?.observe(chart.root);
  refreshName();
  refreshRun();
  renderConsole();
  applyLayout();

  return {
    destroy() {
      for (const u of offs) u();
      ro?.disconnect();
      tester.destroy();
      editor.destroy();
      root.remove();
    },
  };
}
