/**
 * Strategy Tester panel — the TradingView strategy report: Overview (cards + equity/drawdown
 * chart), Performance, Trades analysis, Risk/performance ratios, List of trades, Properties.
 */
import type { Chart } from '../core/Chart';
import type { StrategyController } from '../strategy/StrategyEngine';
import type { BacktestReport, ClosedTrade, MetricsGroup, OpenTrade } from '../strategy/types';
import { el, getDpr, downloadDataUrl } from '../util/dom';
import { formatDateTime } from '../util/time';
import { parseResolution } from '../data/resolution';
import { button, tooltip, checkbox, escapeHtml } from './components';
import { openDialog } from './dialogs/index';

export type TesterTab = 'overview' | 'performance' | 'trades' | 'ratios' | 'list' | 'properties';
const TABS: Array<[TesterTab, string]> = [
  ['overview', 'Overview'], ['performance', 'Performance'], ['trades', 'Trades analysis'], ['ratios', 'Risk/performance ratios'], ['list', 'List of trades'], ['properties', 'Properties'],
];

const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nfq = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });

export function fmtMoney(v: number | null | undefined, currency = '', signed = true): string {
  if (v === null || v === undefined || v !== v) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  const s = `${signed && v > 0 ? '+' : v < 0 ? '−' : ''}${nf2.format(Math.abs(v))}`;
  return currency ? `${s} ${currency}` : s;
}
export function fmtPct(v: number | null | undefined, signed = true): string {
  if (v === null || v === undefined || v !== v) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  return `${signed && v > 0 ? '+' : v < 0 ? '−' : ''}${nf2.format(Math.abs(v))}%`;
}
export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || v !== v) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  return digits === 0 ? nf0.format(v) : new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}
const tone = (v: number | null | undefined): string => (v === null || v === undefined || v !== v || v === 0 ? '' : v > 0 ? 'vc-pos' : 'vc-neg');

interface Row { label: string; kind: 'money' | 'pct' | 'num' | 'int' | 'ratio'; key: keyof MetricsGroup; pctKey?: keyof MetricsGroup; allOnly?: boolean }

const PERFORMANCE_ROWS: Row[] = [
  { label: 'Open P&L', kind: 'money', key: 'openPL', pctKey: 'openPLPct' },
  { label: 'Net profit', kind: 'money', key: 'netProfit', pctKey: 'netProfitPct' },
  { label: 'Gross profit', kind: 'money', key: 'grossProfit', pctKey: 'grossProfitPct' },
  { label: 'Gross loss', kind: 'money', key: 'grossLoss', pctKey: 'grossLossPct' },
  { label: 'Commission paid', kind: 'money', key: 'commission' },
  { label: 'Buy & hold return', kind: 'money', key: 'buyHoldReturn', pctKey: 'buyHoldReturnPct', allOnly: true },
  { label: 'Max equity run-up', kind: 'money', key: 'maxRunup', pctKey: 'maxRunupPct', allOnly: true },
  { label: 'Max equity drawdown', kind: 'money', key: 'maxDrawdown', pctKey: 'maxDrawdownPct', allOnly: true },
  { label: 'Max contracts held', kind: 'num', key: 'maxContractsHeld' },
];
const TRADES_ROWS: Row[] = [
  { label: 'Total trades', kind: 'int', key: 'totalTrades' },
  { label: 'Total open trades', kind: 'int', key: 'totalOpenTrades' },
  { label: 'Winning trades', kind: 'int', key: 'winningTrades' },
  { label: 'Losing trades', kind: 'int', key: 'losingTrades' },
  { label: 'Percent profitable', kind: 'pct', key: 'percentProfitable' },
  { label: 'Avg P&L', kind: 'money', key: 'avgTrade', pctKey: 'avgTradePct' },
  { label: 'Avg winning trade', kind: 'money', key: 'avgWinningTrade', pctKey: 'avgWinningTradePct' },
  { label: 'Avg losing trade', kind: 'money', key: 'avgLosingTrade', pctKey: 'avgLosingTradePct' },
  { label: 'Ratio avg win / avg loss', kind: 'ratio', key: 'ratioAvgWinLoss' },
  { label: 'Largest winning trade', kind: 'money', key: 'largestWinningTrade', pctKey: 'largestWinningTradePct' },
  { label: 'Largest losing trade', kind: 'money', key: 'largestLosingTrade', pctKey: 'largestLosingTradePct' },
  { label: 'Avg # bars in trades', kind: 'num', key: 'avgBarsInTrades' },
  { label: 'Avg # bars in winning trades', kind: 'num', key: 'avgBarsInWinningTrades' },
  { label: 'Avg # bars in losing trades', kind: 'num', key: 'avgBarsInLosingTrades' },
];
const RATIO_ROWS: Row[] = [
  { label: 'Sharpe ratio', kind: 'ratio', key: 'sharpe', allOnly: true },
  { label: 'Sortino ratio', kind: 'ratio', key: 'sortino', allOnly: true },
  { label: 'Profit factor', kind: 'ratio', key: 'profitFactor' },
  { label: 'Margin calls', kind: 'int', key: 'marginCalls', allOnly: true },
];

export function createStrategyTester(chart: Chart, host: HTMLElement): { render(): void; setTab(t: TesterTab): void; destroy(): void } {
  const ctrl = chart.strategy as StrategyController;
  const root = el('div', { class: 'vc-st' });
  host.appendChild(root);
  let tab: TesterTab = 'overview';
  let showBuyHold = true;
  let showExcursions = false;
  let chartCanvas: HTMLCanvasElement | null = null;
  let chartHover: ((e: MouseEvent | null) => void) | null = null;
  const unsub: Array<() => void> = [];

  const currency = (r: BacktestReport) => r.currency || '';
  const tz = () => chart.model.timezone;
  const intraday = () => parseResolution(chart.interval).isIntraday;
  const when = (t: number) => formatDateTime(t, tz(), { intraday: intraday() });

  function header(r: BacktestReport | null): HTMLElement {
    const h = el('div', { class: 'vc-st-header' });
    const left = el('div', { class: 'vc-st-hleft' });
    const title = el('span', { class: 'vc-st-title', text: r ? r.properties.title : ctrl.title });
    left.appendChild(title);
    const gear = button('', { icon: 'settings', className: 'vc-icon-btn vc-st-gear', onClick: () => openDialog(chart, 'strategySettings') });
    tooltip(gear, 'Strategy settings (inputs, properties)', chart.root);
    left.appendChild(gear);
    if (r) {
      left.appendChild(el('span', { class: 'vc-st-sub', text: `${r.symbol} · ${parseResolution(r.resolution).label} · ${r.bars} bars · ${when(r.firstTime)} — ${when(r.lastTime)}` }));
    }
    h.appendChild(left);
    const right = el('div', { class: 'vc-st-hright' });
    const status = el('span', { class: 'vc-st-status' });
    const setStatus = (): void => {
      if (ctrl.state === 'running') status.textContent = ctrl.progress.total ? `Running… ${Math.round((ctrl.progress.done / ctrl.progress.total) * 100)}%` : 'Running…';
      else status.textContent = ctrl.status;
    };
    setStatus();
    unsub.push(ctrl.events.on('progress', setStatus));
    unsub.push(ctrl.events.on('statusChanged', setStatus));
    right.appendChild(status);
    if (r) {
      const exp = button('', { icon: 'copy', className: 'vc-icon-btn', onClick: () => exportCsv(r) });
      tooltip(exp, 'Export list of trades (CSV)', chart.root);
      right.appendChild(exp);
      const rm = button('', { icon: 'trash', className: 'vc-icon-btn', onClick: () => ctrl.remove() });
      tooltip(rm, 'Remove strategy from chart', chart.root);
      right.appendChild(rm);
    }
    h.appendChild(right);
    return h;
  }

  function tabs(): HTMLElement {
    const t = el('div', { class: 'vc-st-tabs' });
    for (const [id, label] of TABS) {
      const b = el('button', { class: `vc-st-tab ${id === tab ? 'vc-active' : ''}`, text: label });
      b.addEventListener('click', () => { tab = id; render(); });
      t.appendChild(b);
    }
    return t;
  }

  function empty(): HTMLElement {
    const e = el('div', { class: 'vc-st-empty' });
    if (ctrl.error) {
      e.appendChild(el('div', { class: 'vc-st-empty-title', text: ctrl.error.phase === 'load' ? 'Python runtime unavailable' : 'The strategy has an error' }));
      e.appendChild(el('div', { class: 'vc-st-empty-text vc-neg', text: `${ctrl.error.line ? `Line ${ctrl.error.line}: ` : ''}${ctrl.error.message}` }));
    } else if (ctrl.state === 'running') {
      e.appendChild(el('div', { class: 'vc-st-empty-title', text: 'Running the strategy…' }));
      e.appendChild(el('div', { class: 'vc-st-empty-text', text: ctrl.status || 'Executing the script bar by bar' }));
    } else {
      e.appendChild(el('div', { class: 'vc-st-empty-title', text: 'No strategy on the chart' }));
      e.appendChild(el('div', { class: 'vc-st-empty-text', text: 'Write a Python strategy in the editor and click "Add to chart" to see its results here.' }));
      const b = el('button', { class: 'vc-primary', text: 'Open Python Editor' });
      b.addEventListener('click', () => ctrl.openPanel('editor'));
      e.appendChild(b);
    }
    return e;
  }

  // ---- Overview ----------------------------------------------------------------------------------
  function overview(r: BacktestReport): HTMLElement {
    const wrap = el('div', { class: 'vc-st-overview' });
    const cards = el('div', { class: 'vc-st-cards' });
    const card = (label: string, value: string, sub: string, cls = ''): void => {
      const c = el('div', { class: 'vc-st-card' });
      c.appendChild(el('div', { class: 'vc-st-card-label', text: label }));
      c.appendChild(el('div', { class: `vc-st-card-value ${cls}`, text: value }));
      if (sub) c.appendChild(el('div', { class: `vc-st-card-sub ${cls}`, text: sub }));
      cards.appendChild(c);
    };
    const a = r.all;
    const total = a.netProfit + a.openPL;
    card('Total P&L', fmtMoney(total, currency(r)), fmtPct(a.netProfitPct + a.openPLPct), tone(total));
    card('Max equity drawdown', fmtMoney(a.maxDrawdown, currency(r), false), fmtPct(a.maxDrawdownPct, false), a.maxDrawdown ? 'vc-neg' : '');
    card('Total trades', fmtNum(a.totalTrades, 0), a.totalOpenTrades ? `${a.totalOpenTrades} open` : '');
    card('Profitable trades', fmtPct(a.percentProfitable, false), `${a.winningTrades} / ${a.totalTrades}`);
    card('Profit factor', fmtNum(a.profitFactor, 3), '', a.profitFactor >= 1 ? 'vc-pos' : a.totalTrades ? 'vc-neg' : '');
    wrap.appendChild(cards);
    const toolbar = el('div', { class: 'vc-st-chart-toolbar' });
    toolbar.appendChild(checkbox(showBuyHold, (v) => { showBuyHold = v; drawChart(r); }, 'Buy & hold equity'));
    toolbar.appendChild(checkbox(showExcursions, (v) => { showExcursions = v; drawChart(r); }, 'Trades run-up & drawdown'));
    toolbar.appendChild(el('span', { class: 'vc-st-legend', html: `<i style="background:#2962FF"></i>Equity <i style="background:#F23645"></i>Drawdown${showBuyHold ? ' <i style="background:#787B86"></i>Buy &amp; hold' : ''}` }));
    wrap.appendChild(toolbar);
    const box = el('div', { class: 'vc-st-chart' });
    chartCanvas = el('canvas');
    box.appendChild(chartCanvas);
    const tip = el('div', { class: 'vc-st-tip', hidden: true });
    box.appendChild(tip);
    wrap.appendChild(box);
    requestAnimationFrame(() => drawChart(r));
    chartCanvas.addEventListener('mousemove', (e) => chartHover?.(e));
    chartCanvas.addEventListener('mouseleave', () => chartHover?.(null));
    chartHover = (e) => {
      if (!e || !chartCanvas || !r.equity.length) { tip.hidden = true; return; }
      const rect = chartCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const padL = 64, padR = 12;
      const w = rect.width - padL - padR;
      const i = Math.max(0, Math.min(r.equity.length - 1, Math.round(((x - padL) / w) * (r.equity.length - 1))));
      const p = r.equity[i];
      tip.hidden = false;
      tip.style.left = `${Math.min(rect.width - 190, Math.max(0, x + 12))}px`;
      tip.innerHTML = `<div>${escapeHtml(when(p.time))}</div><div>Equity <b>${escapeHtml(fmtMoney(p.equity, currency(r), false))}</b></div><div>Net profit <b class="${tone(p.netProfit)}">${escapeHtml(fmtMoney(p.netProfit, currency(r)))}</b></div><div>Drawdown <b class="vc-neg">${escapeHtml(fmtMoney(p.drawdown, currency(r), false))} (${escapeHtml(fmtPct(p.drawdownPct, false))})</b></div>${showBuyHold ? `<div>Buy &amp; hold <b>${escapeHtml(fmtMoney(p.buyHold, currency(r)))}</b></div>` : ''}`;
    };
    return wrap;
  }

  function drawChart(r: BacktestReport): void {
    const c = chartCanvas;
    if (!c || !c.isConnected) return;
    const dpr = getDpr();
    const W = c.parentElement!.clientWidth, H = c.parentElement!.clientHeight;
    if (W < 10 || H < 10) return;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = chart.options.theme === 'dark';
    const text = dark ? '#787B86' : '#787B86', grid = dark ? '#2A2E39' : '#E0E3EB';
    ctx.clearRect(0, 0, W, H);
    const eq = r.equity;
    if (!eq.length) return;
    const padL = 64, padR = 12, padT = 10, padB = 22;
    const ddH = Math.round((H - padT - padB) * 0.28);
    const eqH = H - padT - padB - ddH - 8;
    const w = W - padL - padR;
    const x = (i: number) => padL + (eq.length === 1 ? 0 : (i / (eq.length - 1)) * w);
    let lo = Infinity, hi = -Infinity, maxDd = 0;
    for (const p of eq) {
      lo = Math.min(lo, p.equity, showBuyHold ? r.properties.initialCapital + p.buyHold : Infinity);
      hi = Math.max(hi, p.equity, showBuyHold ? r.properties.initialCapital + p.buyHold : -Infinity);
      maxDd = Math.max(maxDd, p.drawdown);
    }
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.06;
    lo -= pad; hi += pad;
    const y = (v: number) => padT + ((hi - v) / (hi - lo)) * eqH;
    const ddTop = padT + eqH + 8;
    const yDd = (v: number) => ddTop + (maxDd ? (v / maxDd) * ddH : 0);
    // grid + axis labels
    ctx.font = `10px ${chart.options.layout.fontFamily}`;
    ctx.fillStyle = text;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      const yy = Math.round(y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      ctx.fillText(compact(v), padL - 6, yy);
    }
    ctx.fillText(`−${compact(maxDd)}`, padL - 6, ddTop + ddH);
    ctx.fillText('0', padL - 6, ddTop);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const ticks = Math.max(2, Math.min(8, Math.floor(w / 110)));
    for (let k = 0; k < ticks; k++) {
      const i = Math.round(((eq.length - 1) * k) / (ticks - 1));
      ctx.fillText(formatDateTime(eq[i].time, tz(), { intraday: false }), x(i), H - padB + 6);
    }
    // initial capital baseline
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = text;
    const y0 = Math.round(y(r.properties.initialCapital)) + 0.5;
    if (y0 > padT && y0 < padT + eqH) { ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(W - padR, y0); ctx.stroke(); }
    ctx.setLineDash([]);
    // buy & hold
    if (showBuyHold) {
      ctx.strokeStyle = '#787B86';
      ctx.lineWidth = 1;
      ctx.beginPath();
      eq.forEach((p, i) => { const yy = y(r.properties.initialCapital + p.buyHold); i ? ctx.lineTo(x(i), yy) : ctx.moveTo(x(i), yy); });
      ctx.stroke();
    }
    // trade excursions
    if (showExcursions) {
      for (const t of r.trades) {
        const i = t.exitBar;
        const idx = eq.findIndex((p) => p.bar >= i);
        if (idx < 0) continue;
        const xx = x(idx);
        const base = eq[idx].equity - t.profit;
        ctx.strokeStyle = 'rgba(8,153,129,.7)'; ctx.beginPath(); ctx.moveTo(xx, y(base)); ctx.lineTo(xx, y(base + t.runup)); ctx.stroke();
        ctx.strokeStyle = 'rgba(242,54,69,.7)'; ctx.beginPath(); ctx.moveTo(xx, y(base)); ctx.lineTo(xx, y(base - t.drawdown)); ctx.stroke();
      }
    }
    // equity area + line
    ctx.beginPath();
    eq.forEach((p, i) => { i ? ctx.lineTo(x(i), y(p.equity)) : ctx.moveTo(x(i), y(p.equity)); });
    ctx.lineTo(x(eq.length - 1), padT + eqH); ctx.lineTo(x(0), padT + eqH); ctx.closePath();
    ctx.fillStyle = 'rgba(41,98,255,.12)';
    ctx.fill();
    ctx.beginPath();
    eq.forEach((p, i) => { i ? ctx.lineTo(x(i), y(p.equity)) : ctx.moveTo(x(i), y(p.equity)); });
    ctx.strokeStyle = '#2962FF'; ctx.lineWidth = 1.5; ctx.stroke();
    // drawdown columns
    ctx.fillStyle = 'rgba(242,54,69,.55)';
    const bw = Math.max(1, w / eq.length);
    eq.forEach((p, i) => { if (p.drawdown > 0) ctx.fillRect(x(i) - bw / 2, ddTop, bw, yDd(p.drawdown) - ddTop); });
    ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(padL, ddTop + 0.5); ctx.lineTo(W - padR, ddTop + 0.5); ctx.stroke();
  }

  function compact(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
    return nf2.format(v);
  }

  // ---- metric tables -----------------------------------------------------------------------------
  function metricsTable(r: BacktestReport, rows: Row[]): HTMLElement {
    const t = el('table', { class: 'vc-st-table' });
    t.innerHTML = '<thead><tr><th></th><th>All</th><th>Long</th><th>Short</th></tr></thead>';
    const body = el('tbody');
    for (const row of rows) {
      const tr = el('tr');
      tr.appendChild(el('td', { class: 'vc-st-label', text: row.label }));
      for (const g of [r.all, r.long, r.short] as MetricsGroup[]) {
        const td = el('td');
        const v = g[row.key] as number | null;
        if (row.allOnly && g !== r.all) { td.textContent = ''; tr.appendChild(td); continue; }
        const main = row.kind === 'money' ? fmtMoney(v, currency(r), row.key !== 'commission' && row.key !== 'maxDrawdown' && row.key !== 'maxRunup')
          : row.kind === 'pct' ? fmtPct(v, false) : row.kind === 'int' ? fmtNum(v, 0) : row.kind === 'ratio' ? fmtNum(v, 3) : fmtNum(v, 2);
        const cls = row.kind === 'money' && row.key !== 'commission' && row.key !== 'maxDrawdown' && row.key !== 'maxRunup' ? tone(v) : row.key === 'maxDrawdown' && v ? 'vc-neg' : '';
        td.appendChild(el('div', { class: `vc-st-val ${cls}`, text: main }));
        if (row.pctKey) {
          const p = g[row.pctKey] as number | null;
          td.appendChild(el('div', { class: `vc-st-pct ${cls}`, text: fmtPct(p, row.key !== 'maxDrawdown' && row.key !== 'maxRunup') }));
        }
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    t.appendChild(body);
    const wrap = el('div', { class: 'vc-st-scroll' });
    wrap.appendChild(t);
    return wrap;
  }

  // ---- list of trades ------------------------------------------------------------------------------
  function tradesList(r: BacktestReport): HTMLElement {
    const t = el('table', { class: 'vc-st-table vc-st-trades' });
    t.innerHTML = '<thead><tr><th>Trade #</th><th>Type</th><th>Date/Time</th><th>Signal</th><th>Price</th><th>Position size</th><th>Net P&amp;L</th><th>Run-up</th><th>Drawdown</th><th>Cumulative P&amp;L</th></tr></thead>';
    const body = el('tbody');
    const cur = currency(r);
    const lastClose = chart.model.bars.length ? chart.model.bars[chart.model.bars.length - 1].close : NaN;
    const dirWord = (d: 'long' | 'short') => (d === 'long' ? 'long' : 'short');
    const cell = (html: string, cls = '') => { const td = el('td', { class: cls }); td.innerHTML = html; return td; };
    const two = (a: string, b: string, cls = '') => `<div class="vc-st-val ${cls}">${escapeHtml(a)}</div><div class="vc-st-pct ${cls}">${escapeHtml(b)}</div>`;
    let n = r.trades.length + r.openTrades.length;
    const openRows = (t: OpenTrade, idx: number): void => {
      const pl = (t.direction === 'long' ? 1 : -1) * (lastClose - t.entryPrice) * t.size - t.entryCommission;
      const plPct = (pl / (t.entryPrice * t.size)) * 100;
      const tr1 = el('tr', { class: 'vc-st-open' });
      tr1.appendChild(cell(`<div class="vc-st-val">${idx}</div><div class="vc-st-pct">Open</div>`));
      tr1.appendChild(cell(`Entry ${dirWord(t.direction)}`));
      tr1.appendChild(cell(escapeHtml(when(t.entryTime))));
      tr1.appendChild(cell(escapeHtml(t.entryComment || t.entryId)));
      tr1.appendChild(cell(escapeHtml(chart.model.mainPane.mainScale.formatPrice(t.entryPrice))));
      tr1.appendChild(cell(two(nfq.format(t.size), fmtMoney(t.size * t.entryPrice, cur, false))));
      tr1.appendChild(cell(two(fmtMoney(pl, cur), fmtPct(plPct), tone(pl))));
      tr1.appendChild(cell(two(fmtMoney(t.runup, cur, false), fmtPct(t.runupPct, false), 'vc-pos')));
      tr1.appendChild(cell(two(fmtMoney(t.drawdown, cur, false), fmtPct(t.drawdownPct, false), 'vc-neg')));
      tr1.appendChild(cell(''));
      body.appendChild(tr1);
    };
    for (const t of r.openTrades.slice().reverse()) openRows(t, n--);
    for (const t of r.trades.slice().reverse() as ClosedTrade[]) {
      const idx = n--;
      const tr1 = el('tr', { class: 'vc-st-exit' });
      tr1.appendChild(cell(`<div class="vc-st-val">${idx}</div>`));
      tr1.appendChild(cell(`Exit ${dirWord(t.direction)}`));
      tr1.appendChild(cell(escapeHtml(when(t.exitTime))));
      tr1.appendChild(cell(escapeHtml(t.exitComment || t.exitId)));
      tr1.appendChild(cell(escapeHtml(chart.model.mainPane.mainScale.formatPrice(t.exitPrice))));
      tr1.appendChild(cell(two(nfq.format(t.size), fmtMoney(t.size * t.exitPrice, cur, false))));
      tr1.appendChild(cell(two(fmtMoney(t.profit, cur), fmtPct(t.profitPct), tone(t.profit))));
      tr1.appendChild(cell(two(fmtMoney(t.runup, cur, false), fmtPct(t.runupPct, false), 'vc-pos')));
      tr1.appendChild(cell(two(fmtMoney(t.drawdown, cur, false), fmtPct(t.drawdownPct, false), 'vc-neg')));
      tr1.appendChild(cell(two(fmtMoney(t.cumProfit, cur), fmtPct(t.cumProfitPct), tone(t.cumProfit))));
      body.appendChild(tr1);
      const tr2 = el('tr', { class: 'vc-st-entry' });
      tr2.appendChild(cell(''));
      tr2.appendChild(cell(`Entry ${dirWord(t.direction)}`));
      tr2.appendChild(cell(escapeHtml(when(t.entryTime))));
      tr2.appendChild(cell(escapeHtml(t.entryComment || t.entryId)));
      tr2.appendChild(cell(escapeHtml(chart.model.mainPane.mainScale.formatPrice(t.entryPrice))));
      tr2.appendChild(cell(two(nfq.format(t.size), fmtMoney(t.size * t.entryPrice, cur, false))));
      tr2.appendChild(cell('')); tr2.appendChild(cell('')); tr2.appendChild(cell('')); tr2.appendChild(cell(''));
      body.appendChild(tr2);
    }
    if (!r.trades.length && !r.openTrades.length) body.innerHTML = '<tr><td colspan="10" class="vc-st-none">No trades in the tested range.</td></tr>';
    t.appendChild(body);
    const wrap = el('div', { class: 'vc-st-scroll' });
    wrap.appendChild(t);
    return wrap;
  }

  function exportCsv(r: BacktestReport): void {
    const lines = ['Trade #,Type,Date/Time,Signal,Price,Position size,Net P&L,Net P&L %,Run-up,Drawdown,Cumulative P&L'];
    r.trades.forEach((t, i) => {
      const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
      lines.push([i + 1, `Entry ${t.direction}`, q(when(t.entryTime)), q(t.entryComment || t.entryId), t.entryPrice, t.size, '', '', '', '', ''].join(','));
      lines.push([i + 1, `Exit ${t.direction}`, q(when(t.exitTime)), q(t.exitComment || t.exitId), t.exitPrice, t.size, t.profit.toFixed(2), t.profitPct.toFixed(2), t.runup.toFixed(2), t.drawdown.toFixed(2), t.cumProfit.toFixed(2)].join(','));
    });
    downloadDataUrl(`data:text/csv;charset=utf-8,${encodeURIComponent(lines.join('\n'))}`, `${r.properties.title}_${r.symbol}_${r.resolution}_trades.csv`);
  }

  // ---- properties ----------------------------------------------------------------------------------
  function properties(r: BacktestReport): HTMLElement {
    const wrap = el('div', { class: 'vc-st-props vc-st-scroll' });
    const section = (title: string, rows: Array<[string, string]>): void => {
      wrap.appendChild(el('div', { class: 'vc-form-section', text: title }));
      for (const [k, v] of rows) {
        const row = el('div', { class: 'vc-st-prop' });
        row.appendChild(el('span', { class: 'vc-st-prop-k', text: k }));
        row.appendChild(el('span', { class: 'vc-st-prop-v', text: v }));
        wrap.appendChild(row);
      }
    };
    const p = r.properties;
    const info = chart.symbolInfo;
    section('Date range', [['Trading range', `${when(r.firstTime)} — ${when(r.lastTime)}`], ['Backtesting range', `${when(r.firstTime)} — ${when(r.lastTime)}`]]);
    section('Symbol info', [
      ['Symbol', info ? `${info.exchange ? `${info.exchange}:` : ''}${info.name}` : r.symbol], ['Timeframe', parseResolution(r.resolution).name], ['Chart type', chart.chartType],
      ['Currency', r.currency || '—'], ['Tick size', info ? String(info.minmov / info.pricescale) : '—'], ['Point value', '1'],
    ]);
    section('Strategy inputs', ctrl.inputDefs.length ? ctrl.inputDefs.map((d) => [d.title, String(ctrl.inputs[d.id] ?? d.defval)] as [string, string]) : [['—', 'The script declares no inputs']]);
    const qtyType = p.defaultQtyType === 'fixed' ? 'contracts' : p.defaultQtyType === 'cash' ? (r.currency || 'cash') : '% of equity';
    const comm = p.commissionType === 'percent' ? '%' : p.commissionType === 'cash_per_contract' ? `${r.currency || ''} per contract` : `${r.currency || ''} per order`;
    section('Strategy properties', [
      ['Initial capital', `${nf2.format(p.initialCapital)} ${r.currency}`.trim()], ['Base currency', p.currency || 'Default'], ['Order size', `${nfq.format(p.defaultQtyValue)} ${qtyType}`],
      ['Pyramiding', `${p.pyramiding} orders`], ['Commission', `${nfq.format(p.commissionValue)} ${comm}`], ['Verify price for limit orders', `${p.backtestFillLimitsAssumption} ticks`],
      ['Slippage', `${p.slippage} ticks`], ['Margin for long positions', `${p.marginLong}%`], ['Margin for short positions', `${p.marginShort}%`],
      ['Recalculate', [p.calcOnOrderFills ? 'After order is filled' : '', p.calcOnEveryTick ? 'On every tick' : ''].filter(Boolean).join(', ') || 'On bar close'],
      ['Fill orders', [p.useBarMagnifier ? 'Using bar magnifier' : '', p.processOrdersOnClose ? 'On bar close' : '', p.fillOrdersOnStandardOhlc ? 'Using standard OHLC' : ''].filter(Boolean).join(', ') || 'Next bar open'],
      ['Risk-free rate', `${p.riskFreeRate}% per year`],
    ]);
    return wrap;
  }

  function render(): void {
    for (const u of unsub.splice(0)) u();
    root.innerHTML = '';
    chartCanvas = null;
    chartHover = null;
    const r = ctrl.report;
    root.appendChild(header(r));
    if (!r) { root.appendChild(empty()); return; }
    root.appendChild(tabs());
    const body = el('div', { class: 'vc-st-body' });
    switch (tab) {
      case 'overview': body.appendChild(overview(r)); break;
      case 'performance': body.appendChild(metricsTable(r, PERFORMANCE_ROWS)); break;
      case 'trades': body.appendChild(metricsTable(r, TRADES_ROWS)); break;
      case 'ratios': body.appendChild(metricsTable(r, RATIO_ROWS)); break;
      case 'list': body.appendChild(tradesList(r)); break;
      case 'properties': body.appendChild(properties(r)); break;
    }
    root.appendChild(body);
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (ctrl.report && tab === 'overview') drawChart(ctrl.report); }) : null;
  ro?.observe(root);
  const offs = [
    ctrl.events.on('reportChanged', () => render()),
    ctrl.events.on('stateChanged', () => { if (!ctrl.report) render(); }),
    ctrl.events.on('errorChanged', () => { if (!ctrl.report) render(); }),
    chart.subscribe('themeChanged', () => render()),
  ];
  render();
  return {
    render,
    setTab(t) { tab = t; render(); },
    destroy() { for (const u of offs) u(); for (const u of unsub) u(); ro?.disconnect(); root.remove(); },
  };
}
