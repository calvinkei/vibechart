import { Chart, SampleDatafeed, listIndicators, listDrawingTools, DEFAULT_INTERVALS, parseResolution, type SeriesType } from '../src/index';

const datafeed = new SampleDatafeed();
const chart = new Chart({
  container: '#chart',
  datafeed,
  symbol: 'BTCUSD',
  interval: '60',
  theme: 'light',
  studies: ['Moving Average Exponential', 'Volume'],
});
(window as any).chart = chart;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const symbolSel = $<HTMLSelectElement>('symbol');
for (const s of SampleDatafeed.symbols()) symbolSel.appendChild(new Option(`${s.name} — ${s.description}`, s.name));
symbolSel.value = 'BTCUSD';
symbolSel.onchange = () => chart.setSymbol(symbolSel.value);

const intervalSel = $<HTMLSelectElement>('interval');
for (const i of DEFAULT_INTERVALS) intervalSel.appendChild(new Option(parseResolution(i.res).name, i.res));
intervalSel.value = '60';
intervalSel.onchange = () => chart.setResolution(intervalSel.value);

const typeSel = $<HTMLSelectElement>('type');
const types: SeriesType[] = ['candles', 'hollowCandles', 'volumeCandles', 'bars', 'line', 'lineWithMarkers', 'stepLine', 'area', 'hlcArea', 'baseline', 'columns', 'highLow', 'heikinAshi', 'renko', 'lineBreak', 'kagi', 'pointAndFigure', 'rangeBars'];
for (const t of types) typeSel.appendChild(new Option(t, t));
typeSel.onchange = () => chart.setChartType(typeSel.value as SeriesType);

const indSel = $<HTMLSelectElement>('indicator');
for (const d of listIndicators()) indSel.appendChild(new Option(d.name, d.id));
$('addInd').onclick = () => chart.addIndicator(indSel.value);

const toolSel = $<HTMLSelectElement>('tool');
for (const t of listDrawingTools()) toolSel.appendChild(new Option(t.toolName, t.toolId));
toolSel.onchange = () => chart.setTool(toolSel.value || null);
chart.subscribe('toolChanged', (t) => { toolSel.value = t ?? ''; });

let theme: 'light' | 'dark' = 'light';
$('theme').onclick = () => { theme = theme === 'light' ? 'dark' : 'light'; chart.setTheme(theme); document.body.classList.toggle('dark', theme === 'dark'); };
$('log').onclick = () => { const ps = chart.priceScale(); ps.setMode(ps.getMode() === 'logarithmic' ? 'normal' : 'logarithmic'); };
$('pct').onclick = () => { const ps = chart.priceScale(); ps.setMode(ps.getMode() === 'percentage' ? 'normal' : 'percentage'); };
$('reset').onclick = () => chart.resetView();
$('shot').onclick = () => { const url = chart.takeScreenshot(); const w = window.open(); if (w) w.document.write(`<img src="${url}" style="max-width:100%">`); };
let saved: any = null;
$('save').onclick = () => { saved = chart.save(); localStorage.setItem('oc-demo', JSON.stringify(saved)); $('status').textContent = 'saved'; };
$('load').onclick = () => { const s = saved ?? JSON.parse(localStorage.getItem('oc-demo') || 'null'); if (s) chart.load(s); };

chart.subscribe('dataLoaded', ({ bars }) => { $('status').textContent = `${bars} bars`; });
chart.subscribe('error', (e) => { $('status').textContent = `error: ${e}`; });
chart.subscribe('loading', (v) => { if (v) $('status').textContent = 'loading…'; });
