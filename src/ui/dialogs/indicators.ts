/**
 * "Indicators, Metrics & Strategies" search dialog. Click adds the indicator and keeps the dialog open (like TradingView).
 */
import type { Chart } from '../../core/Chart';
import { listIndicators, searchIndicators, type IndicatorDefinition } from '../../indicators/Indicator';
import { Dialog, escapeHtml } from '../components';
import { el } from '../../util/dom';
import { ICONS } from '../icons';
import { categorizeIndicator, INDICATOR_CATEGORIES, readJson, writeJson } from './helpers';

const FAV_KEY = 'oc.favIndicators';

export function openIndicatorsDialog(chart: Chart): Dialog {
  const favorites = new Set<string>(readJson<string[]>(FAV_KEY, []));
  let query = '';
  let category = 'all';
  let highlight = 0;
  let current: IndicatorDefinition[] = [];

  const dlg = new Dialog({ title: 'Indicators, Metrics & Strategies', container: chart.root, width: 700, className: 'vc-ind-dialog' });

  const searchWrap = el('div', { class: 'vc-dlg-search' });
  searchWrap.appendChild(el('span', { class: 'vc-icon', html: ICONS.search }));
  const input = el('input', { class: 'vc-search-input', type: 'text', placeholder: 'Search', autocomplete: 'off', spellcheck: false });
  searchWrap.appendChild(input);
  dlg.body.appendChild(searchWrap);

  const layout = el('div', { class: 'vc-ind-layout' });
  const cats = el('div', { class: 'vc-ind-cats' });
  const list = el('div', { class: 'vc-ind-list' });
  layout.appendChild(cats);
  layout.appendChild(list);
  dlg.body.appendChild(layout);

  const allDefs = () => listIndicators();
  const extraCats = () => Array.from(new Set(allDefs().map(categorizeIndicator))).filter((c) => !(INDICATOR_CATEGORIES as readonly string[]).includes(c)).sort();

  function renderCats(): void {
    cats.innerHTML = '';
    const item = (id: string, label: string, count?: number) => {
      const row = el('div', { class: `vc-ind-cat ${category === id ? 'vc-active' : ''}`, 'data-id': id });
      row.appendChild(el('span', { text: label }));
      if (count !== undefined) row.appendChild(el('span', { class: 'vc-badge', text: String(count) }));
      row.addEventListener('click', () => { category = id; highlight = 0; renderCats(); renderList(); });
      cats.appendChild(row);
    };
    item('favorites', 'Favorites', favorites.size);
    cats.appendChild(el('div', { class: 'vc-ind-cat-title', text: 'Technicals' }));
    item('all', 'All', allDefs().length);
    const counts = new Map<string, number>();
    for (const d of allDefs()) counts.set(categorizeIndicator(d), (counts.get(categorizeIndicator(d)) ?? 0) + 1);
    for (const c of [...INDICATOR_CATEGORIES, ...extraCats()]) item(c, c, counts.get(c) ?? 0);
  }

  function filtered(): IndicatorDefinition[] {
    let defs = query ? searchIndicators(query) : allDefs();
    if (category === 'favorites') defs = defs.filter((d) => favorites.has(d.id));
    else if (category !== 'all') defs = defs.filter((d) => categorizeIndicator(d) === category);
    return defs;
  }

  function renderList(): void {
    current = filtered();
    list.innerHTML = '';
    if (!current.length) { list.appendChild(el('div', { class: 'vc-ind-empty', text: query ? `No indicators match "${query}"` : 'Nothing here yet' })); return; }
    if (highlight >= current.length) highlight = 0;
    current.forEach((def, i) => {
      const row = el('div', { class: `vc-ind-row ${i === highlight ? 'vc-active' : ''}`, 'data-id': def.id });
      row.innerHTML = `<span class="vc-ind-name">${escapeHtml(def.name)}</span><span class="vc-badge">${escapeHtml(def.shortName)}</span><span class="vc-ind-cat-badge">${escapeHtml(categorizeIndicator(def))}</span>`;
      const star = el('button', { class: `vc-ind-star ${favorites.has(def.id) ? 'vc-active' : ''}`, title: favorites.has(def.id) ? 'Remove from favorites' : 'Add to favorites' });
      star.innerHTML = favorites.has(def.id) ? ICONS.starFilled : ICONS.star;
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        if (favorites.has(def.id)) favorites.delete(def.id); else favorites.add(def.id);
        writeJson(FAV_KEY, Array.from(favorites));
        renderCats(); renderList();
      });
      row.appendChild(star);
      row.addEventListener('mouseenter', () => { highlight = i; list.querySelectorAll('.vc-ind-row').forEach((r) => r.classList.toggle('vc-active', r === row)); });
      row.addEventListener('click', () => add(def, row));
      list.appendChild(row);
    });
  }

  function add(def: IndicatorDefinition, row?: HTMLElement): void {
    const inst = chart.addIndicator(def.id);
    if (!inst) return;
    if (row) { row.classList.remove('vc-dlg-flash'); void row.offsetWidth; row.classList.add('vc-dlg-flash'); }
    input.focus();
  }

  input.addEventListener('input', () => { query = input.value; highlight = 0; renderList(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const def = current[highlight] ?? current[0]; if (def) add(def, list.querySelector(`.vc-ind-row[data-id="${CSS.escape(def.id)}"]`) as HTMLElement | null ?? undefined); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!current.length) return;
      highlight = (highlight + (e.key === 'ArrowDown' ? 1 : -1) + current.length) % current.length;
      list.querySelectorAll('.vc-ind-row').forEach((r, i) => r.classList.toggle('vc-active', i === highlight));
      (list.children[highlight] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape') { dlg.close(); }
    else e.stopPropagation();
  });

  renderCats();
  renderList();
  setTimeout(() => input.focus(), 20);
  return dlg;
}
