/**
 * Symbol Search dialog (also used for "Compare"). Uses datafeed.searchSymbols with a 200 ms debounce.
 */
import type { Chart } from '../../core/Chart';
import type { SearchSymbolResultItem } from '../../data/types';
import { Dialog, escapeHtml, selectInput } from '../components';
import { el } from '../../util/dom';
import { ICONS } from '../icons';
import { debounce } from './helpers';

export type SymbolSearchMode = 'symbol' | 'compare';

export function openSymbolSearch(chart: Chart, mode: SymbolSearchMode = 'symbol'): Dialog {
  const dlg = new Dialog({ title: mode === 'compare' ? 'Compare symbol' : 'Symbol Search', container: chart.root, width: 620, className: 'vc-sym-dialog' });
  let exchange = '';
  let symbolType = '';
  let results: SearchSymbolResultItem[] = [];
  let highlight = 0;
  const canSearch = typeof chart.datafeed.searchSymbols === 'function';

  const searchWrap = el('div', { class: 'vc-dlg-search' });
  searchWrap.appendChild(el('span', { class: 'vc-icon', html: ICONS.search }));
  const input = el('input', { class: 'vc-search-input', type: 'text', placeholder: mode === 'compare' ? 'Add symbol to compare' : 'Search symbol', autocomplete: 'off', spellcheck: false });
  input.style.textTransform = 'uppercase';
  searchWrap.appendChild(input);
  dlg.body.appendChild(searchWrap);

  if (mode === 'compare') {
    const radios = el('div', { class: 'vc-sym-radios' });
    for (const [v, label] of [['percent', 'Same % scale'], ['scale', 'New price scale'], ['pane', 'New pane']]) {
      const lab = el('label');
      const r = el('input', { type: 'radio', name: 'vc-compare-mode', value: v });
      r.checked = v === 'percent';
      lab.appendChild(r);
      lab.appendChild(document.createTextNode(label));
      radios.appendChild(lab);
    }
    dlg.body.appendChild(radios);
  }

  const filters = el('div', { class: 'vc-sym-filters' });
  const exchangeSel = selectInput('', [{ value: '', label: 'All exchanges' }], (v) => { exchange = v; runSearch(); });
  const typeSel = selectInput('', [{ value: '', label: 'All types' }], (v) => { symbolType = v; runSearch(); });
  filters.appendChild(typeSel);
  filters.appendChild(exchangeSel);
  dlg.body.appendChild(filters);

  const list = el('div', { class: 'vc-sym-list' });
  dlg.body.appendChild(list);
  const status = el('div', { class: 'vc-sym-status' });
  dlg.body.appendChild(status);

  const fillSelect = (sel: HTMLSelectElement, opts: Array<{ value: string; label: string }>) => {
    const cur = sel.value;
    sel.innerHTML = '';
    for (const o of opts) sel.appendChild(new Option(o.label, o.value, false, o.value === cur));
  };
  const applyConfig = () => {
    const cfg = chart.loader.config;
    if (!cfg) return;
    fillSelect(exchangeSel, [{ value: '', label: 'All exchanges' }, ...(cfg.exchanges ?? []).filter((e) => e.value !== '').map((e) => ({ value: e.value, label: e.name || e.value }))]);
    fillSelect(typeSel, [{ value: '', label: 'All types' }, ...(cfg.symbols_types ?? []).filter((t) => t.value !== '').map((t) => ({ value: t.value, label: t.name || t.value }))]);
  };
  applyConfig();
  if (!chart.loader.config) void chart.loader.whenReady().then(() => { if (dlg.isOpen) applyConfig(); });

  function setStatus(text: string): void { status.textContent = text; }

  function renderList(): void {
    list.innerHTML = '';
    if (!results.length) {
      list.appendChild(el('div', { class: 'vc-ind-empty', text: canSearch ? (input.value ? 'No symbols found' : 'Type to search') : 'Type a symbol and press Enter' }));
      return;
    }
    if (highlight >= results.length) highlight = 0;
    results.forEach((it, i) => {
      const row = el('div', { class: `vc-sym-row ${i === highlight ? 'vc-active' : ''}` });
      row.innerHTML = `<span class="vc-sym-name">${escapeHtml(it.symbol)}</span><span class="vc-sym-desc">${escapeHtml(it.description ?? '')}</span><span class="vc-sym-type">${escapeHtml(it.type ?? '')}</span><span class="vc-sym-exch">${escapeHtml(it.exchange ?? '')}</span>`;
      row.addEventListener('mouseenter', () => { highlight = i; list.querySelectorAll('.vc-sym-row').forEach((r) => r.classList.toggle('vc-active', r === row)); });
      row.addEventListener('click', () => choose(it));
      list.appendChild(row);
    });
  }

  function choose(item: SearchSymbolResultItem | string): void {
    const name = typeof item === 'string' ? item : (item.ticker ?? item.full_name ?? item.symbol);
    if (mode === 'compare') {
      setStatus(`Compare/overlay is not supported by this build yet (${name}).`);
      return;
    }
    void chart.setSymbol(name);
    dlg.close();
  }

  const runSearch = debounce(() => {
    if (!canSearch) { results = []; renderList(); return; }
    const q = input.value.trim();
    setStatus('Searching…');
    try {
      chart.datafeed.searchSymbols!(q, exchange, symbolType, (items) => {
        if (!dlg.isOpen) return;
        results = Array.isArray(items) ? items : [];
        highlight = 0;
        renderList();
        setStatus(results.length ? `${results.length} symbol${results.length === 1 ? '' : 's'}` : '');
      });
    } catch (e) {
      setStatus(`Search failed: ${(e as Error).message}`);
    }
  }, 200);

  input.addEventListener('input', () => runSearch());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const it = results[highlight] ?? results[0];
      if (it) choose(it);
      else if (input.value.trim()) choose(input.value.trim().toUpperCase());
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      highlight = (highlight + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      list.querySelectorAll('.vc-sym-row').forEach((r, i) => r.classList.toggle('vc-active', i === highlight));
      (list.children[highlight] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape') dlg.close();
    else e.stopPropagation();
  });

  if (mode === 'compare') setStatus('Compare/overlay is not supported by this build yet.');
  renderList();
  if (canSearch) runSearch();
  setTimeout(() => input.focus(), 20);
  return dlg;
}
