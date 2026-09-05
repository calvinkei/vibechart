import { Chart, SampleDatafeed, listIndicators, listDrawingTools, DEFAULT_INTERVALS, parseResolution, type SeriesType } from '../src/index';
import { BinanceDatafeed } from './binanceDatafeed';

const params = new URLSearchParams(location.search);
const live = params.get('feed') === 'binance';
const datafeed = live ? new BinanceDatafeed() : new SampleDatafeed();
const chart = new Chart({
  container: '#chart',
  datafeed,
  symbol: live ? 'BTCUSDT' : 'BTCUSD',
  interval: '60',
  initialBars: Math.min(50000, parseInt(params.get('bars') || '300', 10) || 300), // ?bars=20000 for stress testing
  theme: 'light',
  studies: ['Moving Average Exponential', 'Volume'],
  // ?strategy=1 opens the Python editor + Strategy Tester dock (Pyodide is fetched from a CDN on first run)
  strategy: params.has('strategy') ? { enabled: true, open: true, runOnLoad: params.get('strategy') === 'run' } : undefined,
});
(window as any).chart = chart;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const symbolSel = $<HTMLSelectElement>('symbol');
if (live) for (const s of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']) symbolSel.appendChild(new Option(s, s));
else for (const s of SampleDatafeed.symbols()) symbolSel.appendChild(new Option(`${s.name} — ${s.description}`, s.name));
symbolSel.value = live ? 'BTCUSDT' : 'BTCUSD';
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
$('save').onclick = () => { saved = chart.save(); localStorage.setItem('vc-demo', JSON.stringify(saved)); $('status').textContent = 'saved'; };
$('load').onclick = () => { const s = saved ?? JSON.parse(localStorage.getItem('vc-demo') || 'null'); if (s) chart.load(s); };

const feedBtn = document.createElement('button');
feedBtn.textContent = live ? 'Use sample data' : 'Use live Binance data';
feedBtn.onclick = () => { location.search = live ? '' : '?feed=binance'; };
$('controls').appendChild(feedBtn);

chart.subscribe('dataLoaded', ({ bars }) => { $('status').textContent = `${bars} bars`; });
chart.subscribe('error', (e) => { $('status').textContent = `error: ${e}`; });
chart.subscribe('loading', (v) => { if (v) $('status').textContent = 'loading…'; });
