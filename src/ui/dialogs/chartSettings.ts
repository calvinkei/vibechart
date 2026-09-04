/**
 * Chart settings dialog (TradingView "Chart settings"): Symbol / Status line / Scales / Appearance / Trading / Events.
 * Changes apply live; Cancel restores a snapshot; Defaults resets the active tab.
 */
import type { Chart } from '../../core/Chart';
import { Dialog, checkbox, colorButton, numberInput, selectInput, textInput, lineWidthPicker, lineStylePicker, formRow, formSection } from '../components';
import { defaultOptions, cloneDeep, type ChartOptions, type LineStyle, type LineWidth, type PriceScaleMode } from '../../core/options';
import { TIMEZONES, type DateFormat } from '../../util/time';
import type { SeriesType } from '../../data/types';
import { getPath, setPath, PRECISION_OPTIONS, PRICE_SOURCES, parsePrecision, chartTypeLabel, readJson, writeJson, removeJson } from './helpers';
import { applyPrecision, note } from './shared';

export type ChartSettingsTab = 'symbol' | 'statusLine' | 'scales' | 'appearance' | 'trading' | 'events' | 'volume';

const TABS: Array<[ChartSettingsTab, string]> = [['symbol', 'Symbol'], ['statusLine', 'Status line'], ['scales', 'Scales'], ['appearance', 'Appearance'], ['trading', 'Trading'], ['events', 'Events']];
const DATE_FORMATS: DateFormat[] = ['dd MMM yyyy', 'MMM dd, yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy/MM/dd', 'dd-MM-yyyy', 'MM-dd-yyyy', 'dd.MM.yyyy', 'yy-MM-dd', 'dd MMM yy'];
const FONT_SIZE_OPTS = [10, 11, 12, 13, 14, 16, 18, 20].map((n) => ({ value: n, label: `${n}px` }));
const TRADING_KEY = 'oc.tradingSettings';
const EVENTS_KEY = 'oc.eventsSettings';

interface ScaleState { mode: PriceScaleMode; inverted: boolean; auto: boolean }

export function openChartSettings(chart: Chart, initial: ChartSettingsTab = 'symbol'): Dialog {
  const model = chart.model;
  const snapshot = {
    options: cloneDeep(model.options),
    scales: { right: scaleState(chart, 'right'), left: scaleState(chart, 'left') },
    showLast: model.indicators.map((i) => ({ inst: i, flags: Object.fromEntries(Object.entries(i.styles).map(([k, s]) => [k, s.showLast])) })),
    mainPriceFormat: { ...model.mainSeries.priceFormat },
  };

  /** Mutate options in place and push through applyOptions so the chart re-renders (keeps `undefined` keys working). */
  const apply = (path: string, value: unknown) => { setPath(model.options, path, value); chart.applyOptions({}); };
  const get = (path: string) => getPath(model.options, path);

  // ---- small row builders -----------------------------------------------------------------
  const colorRow = (label: string, path: string, opacity = true) => formRow(label, colorButton(String(get(path) ?? '#000000'), (c) => apply(path, c), { opacity }));
  const colorPairRow = (label: string, upPath: string, downPath: string) => formRow(label, [
    colorButton(String(get(upPath) ?? '#089981'), (c) => apply(upPath, c)),
    colorButton(String(get(downPath) ?? '#F23645'), (c) => apply(downPath, c)),
  ]);
  const boolRow = (label: string, path: string, indent = false) => formRow(label, checkbox(!!get(path), (v) => apply(path, v)), { indent });
  const numRow = (label: string, path: string, opts: { min?: number; max?: number; step?: number; int?: boolean } = {}) => formRow(label, numberInput(Number(get(path) ?? 0), (v) => apply(path, v), opts));
  const selRow = (label: string, path: string, options: Array<{ value: string | number; label: string }> | string[], parse: (v: string) => unknown = (v) => v) => formRow(label, selectInput(get(path) ?? '', options, (v) => apply(path, parse(v))));
  const widthRow = (label: string, path: string) => formRow(label, lineWidthPicker(Number(get(path) ?? 1), (v) => apply(path, v as LineWidth)));
  const styleRow = (label: string, path: string) => formRow(label, lineStylePicker(Number(get(path) ?? 0), (v) => apply(path, v as LineStyle)));
  const boolColorRow = (label: string, boolPath: string, colorPath: string) => formRow(label, [checkbox(!!get(boolPath), (v) => apply(boolPath, v)), colorButton(String(get(colorPath) ?? '#787B86'), (c) => apply(colorPath, c))]);
  const sourceRow = (label: string, path: string) => selRow(label, path, PRICE_SOURCES.map((s) => ({ value: s, label: s })));
  const boxMethodRow = (path: string, options: string[], rerender: () => void) => formRow('Box size method', selectInput(String(get(path)), options, (v) => { apply(path, v); rerender(); }));

  const dlg = new Dialog({
    title: 'Chart settings',
    container: chart.root,
    width: 560,
    className: 'oc-settings-dialog',
    tabs: TABS.map((t) => t[1]),
    buttons: [
      { label: 'Defaults', left: true, onClick: () => resetTab(dlg.activeTab) },
      { label: 'Cancel', onClick: () => { restore(); dlg.close(); } },
      { label: 'Ok', primary: true, onClick: () => dlg.close() },
    ],
  });

  // ---- Symbol tab ------------------------------------------------------------------------------
  function renderSymbol(): void {
    const pane = dlg.tab('Symbol');
    pane.innerHTML = '';
    const type = chart.chartType as SeriesType;
    const base = `series.${type}`;
    const rerender = () => renderSymbol();
    pane.appendChild(formSection(chartTypeLabel(type)));
    const candleBody = () => {
      pane.appendChild(formRow('Body', [checkbox(!!get(`${base}.bodyVisible`), (v) => apply(`${base}.bodyVisible`, v)), colorButton(String(get(`${base}.upColor`)), (c) => apply(`${base}.upColor`, c)), colorButton(String(get(`${base}.downColor`)), (c) => apply(`${base}.downColor`, c))]));
      pane.appendChild(formRow('Borders', [checkbox(!!get(`${base}.borderVisible`), (v) => apply(`${base}.borderVisible`, v)), colorButton(String(get(`${base}.borderUpColor`)), (c) => apply(`${base}.borderUpColor`, c)), colorButton(String(get(`${base}.borderDownColor`)), (c) => apply(`${base}.borderDownColor`, c))]));
    };
    const candleWick = (label = 'Wick') => {
      pane.appendChild(formRow(label, [checkbox(!!get(`${base}.wickVisible`), (v) => apply(`${base}.wickVisible`, v)), colorButton(String(get(`${base}.wickUpColor`)), (c) => apply(`${base}.wickUpColor`, c)), colorButton(String(get(`${base}.wickDownColor`)), (c) => apply(`${base}.wickDownColor`, c))]));
    };
    const lineBasics = (colorPath = `${base}.color`, widthPath = `${base}.lineWidth`, stylePath = `${base}.lineStyle`) => {
      pane.appendChild(colorRow('Line', colorPath));
      pane.appendChild(widthRow('Line width', widthPath));
      pane.appendChild(styleRow('Line style', stylePath));
    };
    switch (type) {
      case 'candles': case 'hollowCandles': case 'volumeCandles': case 'heikinAshi':
        candleBody(); candleWick();
        if (type === 'hollowCandles') pane.appendChild(boolRow('Fill down candles only', `${base}.hollowDown`));
        break;
      case 'bars':
        pane.appendChild(colorPairRow('Up / Down color', `${base}.upColor`, `${base}.downColor`));
        pane.appendChild(boolRow('Thin bars', `${base}.thinBars`));
        pane.appendChild(boolRow('HLC bars', `${base}.hlcBars`));
        pane.appendChild(boolRow('Color bars based on previous close', `${base}.colorBasedOnPrevClose`));
        break;
      case 'line': case 'stepLine': case 'lineWithMarkers':
        lineBasics();
        pane.appendChild(sourceRow('Price source', `${base}.priceSource`));
        if (type === 'lineWithMarkers') pane.appendChild(numRow('Marker radius', `${base}.markerRadius`, { min: 1, max: 10, step: 0.5 }));
        pane.appendChild(boolRow('Crosshair marker', `${base}.crosshairMarkerVisible`));
        break;
      case 'area':
        lineBasics(`${base}.lineColor`);
        pane.appendChild(colorPairRow('Fill (top / bottom)', `${base}.topColor`, `${base}.bottomColor`));
        pane.appendChild(sourceRow('Price source', `${base}.priceSource`));
        pane.appendChild(boolRow('Invert filled area', `${base}.invertFilledArea`));
        break;
      case 'hlcArea':
        for (const [k, lab] of [['high', 'High line'], ['low', 'Low line'], ['close', 'Close line']] as const) {
          pane.appendChild(formRow(lab, [colorButton(String(get(`${base}.${k}LineColor`)), (c) => apply(`${base}.${k}LineColor`, c)), lineWidthPicker(Number(get(`${base}.${k}LineWidth`)), (v) => apply(`${base}.${k}LineWidth`, v)), lineStylePicker(Number(get(`${base}.${k}LineStyle`)), (v) => apply(`${base}.${k}LineStyle`, v))]));
        }
        pane.appendChild(colorRow('Fill', `${base}.fillColor`));
        break;
      case 'baseline': {
        const bv = get(`${base}.baseValue`) as { type: 'price' | 'percent'; price?: number; percent?: number };
        const valueInput = numberInput(bv.type === 'price' ? bv.price ?? 0 : bv.percent ?? 50, (v) => {
          const cur = get(`${base}.baseValue`);
          apply(`${base}.baseValue`, cur.type === 'price' ? { type: 'price', price: v } : { type: 'percent', percent: v });
        }, { step: bv.type === 'price' ? 0.01 : 1, min: bv.type === 'price' ? undefined : 0, max: bv.type === 'price' ? undefined : 100 });
        pane.appendChild(formRow('Base level', [selectInput(bv.type, [{ value: 'percent', label: 'Percent' }, { value: 'price', label: 'Price' }], (v) => {
          const cur = get(`${base}.baseValue`);
          apply(`${base}.baseValue`, v === 'price' ? { type: 'price', price: cur.price ?? cur.percent ?? 0 } : { type: 'percent', percent: cur.percent ?? 50 });
          rerender();
        }), valueInput]));
        pane.appendChild(formRow('Top line', [colorButton(String(get(`${base}.topLineColor`)), (c) => apply(`${base}.topLineColor`, c))]));
        pane.appendChild(colorPairRow('Top fill', `${base}.topFillColor1`, `${base}.topFillColor2`));
        pane.appendChild(formRow('Bottom line', [colorButton(String(get(`${base}.bottomLineColor`)), (c) => apply(`${base}.bottomLineColor`, c))]));
        pane.appendChild(colorPairRow('Bottom fill', `${base}.bottomFillColor1`, `${base}.bottomFillColor2`));
        pane.appendChild(widthRow('Line width', `${base}.lineWidth`));
        pane.appendChild(styleRow('Line style', `${base}.lineStyle`));
        pane.appendChild(sourceRow('Price source', `${base}.priceSource`));
        pane.appendChild(formRow('Base line', [checkbox(!!get(`${base}.baseLineVisible`), (v) => apply(`${base}.baseLineVisible`, v)), colorButton(String(get(`${base}.baseLineColor`)), (c) => apply(`${base}.baseLineColor`, c)), lineWidthPicker(Number(get(`${base}.baseLineWidth`)), (v) => apply(`${base}.baseLineWidth`, v)), lineStylePicker(Number(get(`${base}.baseLineStyle`)), (v) => apply(`${base}.baseLineStyle`, v))]));
        break;
      }
      case 'columns':
        pane.appendChild(colorPairRow('Up / Down color', `${base}.upColor`, `${base}.downColor`));
        pane.appendChild(sourceRow('Price source', `${base}.priceSource`));
        pane.appendChild(boolRow('Color based on previous close', `${base}.colorBasedOnPrevClose`));
        break;
      case 'highLow':
        pane.appendChild(colorRow('Body', `${base}.bodyColor`));
        pane.appendChild(boolColorRow('Borders', `${base}.borderVisible`, `${base}.borderColor`));
        pane.appendChild(boolColorRow('Labels', `${base}.showLabels`, `${base}.labelColor`));
        pane.appendChild(numRow('Label font size', `${base}.fontSize`, { min: 8, max: 24, int: true }));
        break;
      case 'renko': {
        pane.appendChild(boxMethodRow(`${base}.boxSizeMethod`, ['ATR', 'Traditional'], rerender));
        if (get(`${base}.boxSizeMethod`) === 'ATR') pane.appendChild(numRow('ATR length', `${base}.atrLength`, { min: 1, max: 500, int: true }));
        else pane.appendChild(numRow('Box size', `${base}.boxSize`, { min: 0, step: 0.01 }));
        pane.appendChild(selRow('Source', `${base}.source`, [{ value: 'close', label: 'Close' }, { value: 'highLow', label: 'High/Low' }]));
        candleBody();
        pane.appendChild(formRow('Wicks', [checkbox(!!get(`${base}.wicks`), (v) => apply(`${base}.wicks`, v)), colorButton(String(get(`${base}.wickUpColor`)), (c) => apply(`${base}.wickUpColor`, c)), colorButton(String(get(`${base}.wickDownColor`)), (c) => apply(`${base}.wickDownColor`, c))]));
        pane.appendChild(boolRow('Show real-time (projection) box', `${base}.showProjection`));
        break;
      }
      case 'kagi':
        pane.appendChild(formRow('Reversal method', selectInput(String(get(`${base}.reversalMethod`)), ['ATR', 'Traditional', 'Percentage'], (v) => { apply(`${base}.reversalMethod`, v); rerender(); })));
        if (get(`${base}.reversalMethod`) === 'ATR') pane.appendChild(numRow('ATR length', `${base}.atrLength`, { min: 1, max: 500, int: true }));
        else pane.appendChild(numRow(get(`${base}.reversalMethod`) === 'Percentage' ? 'Reversal (%)' : 'Reversal amount', `${base}.reversalAmount`, { min: 0, step: 0.01 }));
        pane.appendChild(selRow('Source', `${base}.source`, [{ value: 'close', label: 'Close' }, { value: 'highLow', label: 'High/Low' }]));
        pane.appendChild(colorPairRow('Up / Down color', `${base}.upColor`, `${base}.downColor`));
        pane.appendChild(widthRow('Line width', `${base}.lineWidth`));
        break;
      case 'lineBreak':
        pane.appendChild(numRow('Number of lines', `${base}.numberOfLines`, { min: 1, max: 50, int: true }));
        pane.appendChild(selRow('Source', `${base}.source`, [{ value: 'close', label: 'Close' }, { value: 'highLow', label: 'High/Low' }]));
        candleBody(); candleWick();
        break;
      case 'pointAndFigure': {
        pane.appendChild(boxMethodRow(`${base}.boxSizeMethod`, ['ATR', 'Traditional'], rerender));
        if (get(`${base}.boxSizeMethod`) === 'ATR') pane.appendChild(numRow('ATR length', `${base}.atrLength`, { min: 1, max: 500, int: true }));
        else pane.appendChild(numRow('Box size', `${base}.boxSize`, { min: 0, step: 0.01 }));
        pane.appendChild(numRow('Reversal amount', `${base}.reversalAmount`, { min: 1, max: 20, int: true }));
        pane.appendChild(selRow('Source', `${base}.source`, [{ value: 'close', label: 'Close' }, { value: 'highLow', label: 'High/Low' }]));
        pane.appendChild(boolRow('One step back building', `${base}.oneStepBackBuilding`));
        pane.appendChild(boolRow('Show projection', `${base}.projection`));
        pane.appendChild(colorPairRow('Up / Down color', `${base}.upColor`, `${base}.downColor`));
        pane.appendChild(colorPairRow('Borders', `${base}.borderUpColor`, `${base}.borderDownColor`));
        break;
      }
      case 'rangeBars':
        pane.appendChild(numRow('Range', `${base}.range`, { min: 1, int: true }));
        pane.appendChild(boolRow('Phantom bars', `${base}.phantomBars`));
        candleBody(); candleWick();
        break;
      default:
        pane.appendChild(note(`No style options for chart type "${type}".`));
    }

    pane.appendChild(formSection('Price lines & labels'));
    const plColor = get('symbol.priceLine.color') as string | undefined;
    const plColorBtn = colorButton(plColor ?? '#787B86', (c) => apply('symbol.priceLine.color', c));
    plColorBtn.style.display = plColor ? '' : 'none';
    pane.appendChild(formRow('Last price line', [
      checkbox(!!get('symbol.priceLine.visible'), (v) => apply('symbol.priceLine.visible', v)),
      checkbox(!!plColor, (v) => { apply('symbol.priceLine.color', v ? '#787B86' : undefined); plColorBtn.style.display = v ? '' : 'none'; }, 'Custom color'),
      plColorBtn,
    ]));
    pane.appendChild(formRow('Line width / style', [lineWidthPicker(Number(get('symbol.priceLine.width') ?? 1), (v) => apply('symbol.priceLine.width', v)), lineStylePicker(Number(get('symbol.priceLine.style') ?? 1), (v) => apply('symbol.priceLine.style', v))], { indent: true }));
    pane.appendChild(boolRow('Last value label', 'symbol.lastValueVisible'));
    pane.appendChild(boolRow('High/low labels', 'symbol.highLowLabelsVisible'));
    pane.appendChild(boolRow('High/low lines', 'symbol.highLowLinesVisible'));
    pane.appendChild(boolRow('Countdown to bar close', 'symbol.countdownVisible'));
    pane.appendChild(boolRow('Bid/Ask lines', 'symbol.bidAskVisible'));
    pane.appendChild(boolRow('Pre/post market price', 'symbol.prePostMarketVisible'));
    pane.appendChild(boolRow('Extended hours', 'symbol.extendedHours'));
    pane.appendChild(formRow('Precision', selectInput(String(get('symbol.precision') ?? 'default'), PRECISION_OPTIONS, (v) => applyPrecision(chart, parsePrecision(v)))));
    pane.appendChild(formRow('Timezone', selectInput(String(get('symbol.timezone') ?? 'exchange'), TIMEZONES.map((t) => ({ value: t.id, label: t.name })), (v) => chart.setTimezone(v))));

    const vol = formSection('Volume');
    vol.id = 'oc-settings-volume';
    pane.appendChild(vol);
    pane.appendChild(boolRow('Show volume', 'volume.visible'));
    pane.appendChild(colorPairRow('Up / Down color', 'volume.upColor', 'volume.downColor'));
    pane.appendChild(formRow('Volume MA', [checkbox(!!get('volume.showMA'), (v) => apply('volume.showMA', v)), numberInput(Number(get('volume.maLength') ?? 20), (v) => apply('volume.maLength', v), { min: 1, max: 500, int: true }), colorButton(String(get('volume.maColor')), (c) => apply('volume.maColor', c))]));
    pane.appendChild(formRow('Placement (top margin %)', numberInput(Math.round(Number(get('volume.scaleMargins.top')) * 100), (v) => apply('volume.scaleMargins.top', Math.min(0.95, Math.max(0, v / 100))), { min: 0, max: 95, int: true })));
  }

  // ---- Status line tab -------------------------------------------------------------------------
  function renderStatusLine(): void {
    const pane = dlg.tab('Status line');
    pane.innerHTML = '';
    pane.appendChild(formSection('Symbol'));
    pane.appendChild(boolRow('Show status line', 'legend.visible'));
    pane.appendChild(boolRow('Symbol', 'legend.showSymbol'));
    pane.appendChild(boolRow('Symbol description', 'legend.showSymbolDescription'));
    pane.appendChild(boolRow('Exchange', 'legend.showExchange'));
    pane.appendChild(boolRow('Interval', 'legend.showInterval'));
    pane.appendChild(boolRow('OHLC values', 'legend.showOHLC'));
    pane.appendChild(boolRow('Bar change values', 'legend.showBarChange'));
    pane.appendChild(boolRow('Volume', 'legend.showVolume'));
    pane.appendChild(boolRow('Last day change', 'legend.showLastDayChange'));
    pane.appendChild(formSection('Indicators'));
    pane.appendChild(boolRow('Titles', 'legend.showIndicatorTitles'));
    pane.appendChild(boolRow('Arguments', 'legend.showIndicatorArguments'));
    pane.appendChild(boolRow('Values', 'legend.showIndicatorValues'));
    pane.appendChild(formSection('Values'));
    pane.appendChild(boolRow('Show last bar values when not hovering', 'legend.showValues'));
    pane.appendChild(selRow('Text size', 'legend.fontSize', FONT_SIZE_OPTS, (v) => parseInt(v, 10)));
    pane.appendChild(boolRow('Background', 'legend.background'));
  }

  // ---- Scales tab -----------------------------------------------------------------------------
  function renderScales(): void {
    const pane = dlg.tab('Scales');
    pane.innerHTML = '';
    const right = chart.priceScale('main', 'right');
    pane.appendChild(formSection('Price scale'));
    const pos = get('rightPriceScale.visible') && get('leftPriceScale.visible') ? 'both' : get('leftPriceScale.visible') ? 'left' : get('rightPriceScale.visible') ? 'right' : 'none';
    pane.appendChild(formRow('Labels position', selectInput(pos, [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }, { value: 'both', label: 'Left and right' }, { value: 'none', label: 'Hidden' }], (v) => {
      setPath(model.options, 'rightPriceScale.visible', v === 'right' || v === 'both');
      setPath(model.options, 'leftPriceScale.visible', v === 'left' || v === 'both');
      chart.applyOptions({});
    })));
    pane.appendChild(formRow('Scale mode', selectInput(right.getMode(), [{ value: 'normal', label: 'Regular' }, { value: 'logarithmic', label: 'Logarithmic' }, { value: 'percentage', label: 'Percent' }, { value: 'indexedTo100', label: 'Indexed to 100' }], (v) => { apply('rightPriceScale.mode', v); right.setMode(v as PriceScaleMode); })));
    pane.appendChild(formRow('Auto scale', checkbox(right.isAutoScale(), (v) => { apply('rightPriceScale.autoScale', v); right.setAutoScale(v); })));
    pane.appendChild(formRow('Invert scale', checkbox(right.isInverted(), (v) => { apply('rightPriceScale.invertScale', v); right.setInverted(v); })));
    pane.appendChild(boolRow('Lock price to bar ratio', 'rightPriceScale.lockPriceToBarRatio'));
    pane.appendChild(boolRow('Scale series only', 'rightPriceScale.scaleSeriesOnly'));
    pane.appendChild(boolRow('No overlapping labels', 'rightPriceScale.alignLabels'));
    pane.appendChild(boolRow('Scale border', 'rightPriceScale.borderVisible'));
    pane.appendChild(boolRow('Tick marks', 'rightPriceScale.ticksVisible'));
    pane.appendChild(formRow('Margins (top / bottom %)', [
      numberInput(Math.round(Number(get('rightPriceScale.scaleMargins.top')) * 100), (v) => apply('rightPriceScale.scaleMargins.top', Math.max(0, Math.min(49, v)) / 100), { min: 0, max: 49, int: true }),
      numberInput(Math.round(Number(get('rightPriceScale.scaleMargins.bottom')) * 100), (v) => apply('rightPriceScale.scaleMargins.bottom', Math.max(0, Math.min(49, v)) / 100), { min: 0, max: 49, int: true }),
    ]));

    pane.appendChild(formSection('Price labels'));
    pane.appendChild(boolRow('Symbol last value', 'symbol.lastValueVisible'));
    const anyShowLast = model.indicators.some((i) => Object.values(i.styles).some((s) => s.showLast));
    pane.appendChild(formRow('Indicator last value', checkbox(anyShowLast, (v) => { for (const i of model.indicators) for (const s of Object.values(i.styles)) s.showLast = v; model.invalidate('full'); })));
    pane.appendChild(boolRow('Countdown to bar close', 'symbol.countdownVisible'));
    pane.appendChild(boolRow('High/low labels', 'symbol.highLowLabelsVisible'));
    pane.appendChild(boolRow('Bid/ask labels', 'symbol.bidAskVisible'));
    pane.appendChild(boolRow('Pre/post market price', 'symbol.prePostMarketVisible'));

    pane.appendChild(formSection('Time scale'));
    pane.appendChild(boolRow('Show time scale', 'timeScale.visible'));
    pane.appendChild(boolRow('Show time', 'timeScale.timeVisible'));
    pane.appendChild(boolRow('Show seconds', 'timeScale.secondsVisible'));
    pane.appendChild(boolRow('Tick marks', 'timeScale.ticksVisible'));
    pane.appendChild(boolRow('Scale border', 'timeScale.borderVisible'));
    pane.appendChild(selRow('Date format', 'localization.dateFormat', DATE_FORMATS.map((f) => ({ value: f, label: f }))));
    pane.appendChild(selRow('Time format', 'localization.timeFormat', [{ value: '24h', label: '24 hours' }, { value: '12h', label: '12 hours' }]));
    pane.appendChild(numRow('Right margin (bars)', 'timeScale.rightOffset', { min: 0, max: 500, int: true }));
    pane.appendChild(boolRow('Fix left edge', 'timeScale.fixLeftEdge'));
    pane.appendChild(boolRow('Fix right edge', 'timeScale.fixRightEdge'));
    pane.appendChild(boolRow('Lock visible range on resize', 'timeScale.lockVisibleTimeRangeOnResize'));
    pane.appendChild(boolRow('Right bar stays on scroll', 'timeScale.rightBarStaysOnScroll'));
    pane.appendChild(boolRow('Shift range on new bar', 'timeScale.shiftVisibleRangeOnNewBar'));
    pane.appendChild(formSection('Session breaks'));
    pane.appendChild(formRow('Session breaks', [checkbox(!!get('timeScale.sessionBreaks.visible'), (v) => apply('timeScale.sessionBreaks.visible', v)), colorButton(String(get('timeScale.sessionBreaks.color')), (c) => apply('timeScale.sessionBreaks.color', c)), lineWidthPicker(Number(get('timeScale.sessionBreaks.width') ?? 1), (v) => apply('timeScale.sessionBreaks.width', v)), lineStylePicker(Number(get('timeScale.sessionBreaks.style') ?? 2), (v) => apply('timeScale.sessionBreaks.style', v))]));
  }

  // ---- Appearance tab ----------------------------------------------------------------------------
  function renderAppearance(): void {
    const pane = dlg.tab('Appearance');
    pane.innerHTML = '';
    pane.appendChild(formSection('Background'));
    const bg = get('layout.background') as ChartOptions['layout']['background'];
    const bgControls: HTMLElement[] = [selectInput(bg.type, [{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }], (v) => {
      if (v === 'gradient') apply('layout.background', { type: 'gradient', color: bg.color, topColor: bg.topColor ?? bg.color, bottomColor: bg.bottomColor ?? bg.color });
      else apply('layout.background', { type: 'solid', color: bg.topColor ?? bg.color });
      renderAppearance();
    })];
    if (bg.type === 'gradient') {
      bgControls.push(colorButton(bg.topColor ?? bg.color, (c) => apply('layout.background.topColor', c), { opacity: false }));
      bgControls.push(colorButton(bg.bottomColor ?? bg.color, (c) => apply('layout.background.bottomColor', c), { opacity: false }));
    } else bgControls.push(colorButton(bg.color, (c) => apply('layout.background.color', c), { opacity: false }));
    pane.appendChild(formRow('Background', bgControls));

    pane.appendChild(formSection('Grid lines'));
    const gridMode = get('grid.vertLines.visible') && get('grid.horzLines.visible') ? 'both' : get('grid.vertLines.visible') ? 'vert' : get('grid.horzLines.visible') ? 'horz' : 'none';
    pane.appendChild(formRow('Grid lines', selectInput(gridMode, [{ value: 'both', label: 'Vertical and horizontal' }, { value: 'vert', label: 'Vertical' }, { value: 'horz', label: 'Horizontal' }, { value: 'none', label: 'None' }], (v) => {
      setPath(model.options, 'grid.vertLines.visible', v === 'both' || v === 'vert');
      setPath(model.options, 'grid.horzLines.visible', v === 'both' || v === 'horz');
      chart.applyOptions({});
    })));
    pane.appendChild(formRow('Vertical', [colorButton(String(get('grid.vertLines.color')), (c) => apply('grid.vertLines.color', c)), lineStylePicker(Number(get('grid.vertLines.style') ?? 0), (v) => apply('grid.vertLines.style', v))], { indent: true }));
    pane.appendChild(formRow('Horizontal', [colorButton(String(get('grid.horzLines.color')), (c) => apply('grid.horzLines.color', c)), lineStylePicker(Number(get('grid.horzLines.style') ?? 0), (v) => apply('grid.horzLines.style', v))], { indent: true }));

    pane.appendChild(formSection('Crosshair'));
    pane.appendChild(selRow('Mode', 'crosshair.mode', [{ value: 'normal', label: 'Normal' }, { value: 'magnet', label: 'Magnet' }, { value: 'magnetStrong', label: 'Strong magnet' }, { value: 'hidden', label: 'Hidden' }]));
    const both = (key: string, v: unknown) => { setPath(model.options, `crosshair.vertLine.${key}`, v); setPath(model.options, `crosshair.horzLine.${key}`, v); chart.applyOptions({}); };
    pane.appendChild(formRow('Crosshair', [
      colorButton(String(get('crosshair.vertLine.color')), (c) => both('color', c)),
      lineWidthPicker(Number(get('crosshair.vertLine.width') ?? 1), (v) => both('width', v)),
      lineStylePicker(Number(get('crosshair.vertLine.style') ?? 2), (v) => both('style', v)),
    ]));
    pane.appendChild(formRow('Labels', [checkbox(!!get('crosshair.vertLine.labelVisible'), (v) => both('labelVisible', v)), colorButton(String(get('crosshair.vertLine.labelBackgroundColor')), (c) => both('labelBackgroundColor', c))]));

    pane.appendChild(formSection('Watermark'));
    pane.appendChild(boolColorRow('Watermark', 'watermark.visible', 'watermark.color'));
    pane.appendChild(numRow('Font size', 'watermark.fontSize', { min: 8, max: 200, int: true }));
    pane.appendChild(boolRow('Show interval', 'watermark.showInterval'));
    pane.appendChild(formRow('Custom text', textInput(String(get('watermark.text') ?? ''), (v) => apply('watermark.text', v.trim() ? v : undefined), { placeholder: 'SYMBOL, INTERVAL' })));
    pane.appendChild(formRow('Alignment', [
      selectInput(String(get('watermark.horzAlign')), [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }], (v) => apply('watermark.horzAlign', v)),
      selectInput(String(get('watermark.vertAlign')), [{ value: 'top', label: 'Top' }, { value: 'center', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }], (v) => apply('watermark.vertAlign', v)),
    ]));

    pane.appendChild(formSection('Scales'));
    pane.appendChild(numRow('Text size', 'layout.fontSize', { min: 8, max: 24, int: true }));
    pane.appendChild(formRow('Text color', colorButton(String(get('rightPriceScale.textColor')), (c) => { for (const p of ['rightPriceScale.textColor', 'leftPriceScale.textColor', 'timeScale.textColor', 'layout.textColor']) setPath(model.options, p, c); chart.applyOptions({}); })));
    pane.appendChild(formRow('Lines color', colorButton(String(get('rightPriceScale.borderColor')), (c) => { for (const p of ['rightPriceScale.borderColor', 'leftPriceScale.borderColor', 'timeScale.borderColor']) setPath(model.options, p, c); chart.applyOptions({}); })));
    pane.appendChild(colorRow('Pane separators', 'layout.paneSeparatorColor'));

    pane.appendChild(formSection('Buttons'));
    pane.appendChild(boolRow('Navigation buttons', 'navigation.scrollButtons'));
    pane.appendChild(boolRow('Pane buttons', 'navigation.showPaneButtons'));
    pane.appendChild(boolRow('Date ranges bar', 'navigation.dateRanges'));
    pane.appendChild(boolRow('Timezone menu', 'navigation.timezoneMenu'));
  }

  // ---- Trading / Events (placeholders persisted in localStorage) ------------------------------
  function renderLocalToggles(tabName: string, key: string, items: Array<[string, string, boolean]>, text: string): void {
    const pane = dlg.tab(tabName);
    pane.innerHTML = '';
    pane.appendChild(note(text));
    const state = { ...Object.fromEntries(items.map(([k, , d]) => [k, d])), ...readJson<Record<string, boolean>>(key, {}) };
    for (const [k, label] of items) pane.appendChild(formRow(label, checkbox(!!state[k], (v) => { state[k] = v; writeJson(key, state); })));
  }
  const TRADING_ITEMS: Array<[string, string, boolean]> = [['buySellButtons', 'Buy/Sell buttons', true], ['instantOrders', 'Instant orders placement', false], ['positions', 'Positions', true], ['orders', 'Orders', true], ['executions', 'Executions', true], ['executionLabels', 'Execution labels', false], ['notifications', 'Notifications', true]];
  const EVENTS_ITEMS: Array<[string, string, boolean]> = [['dividends', 'Dividends', true], ['splits', 'Splits', true], ['earnings', 'Earnings', true], ['news', 'Latest news', false]];
  function renderTrading(): void { renderLocalToggles('Trading', TRADING_KEY, TRADING_ITEMS, 'Trading is not available in this build. These switches are stored for later and have no effect yet.'); }
  function renderEvents(): void {
    renderLocalToggles('Events', EVENTS_KEY, EVENTS_ITEMS, 'Event markers need a datafeed with getMarks(). The switches below are stored for later; "Show marks" is applied to the time scale now.');
    dlg.tab('Events').appendChild(boolRow('Show marks on time scale', 'timeScale.marksVisible'));
  }

  function renderAll(): void { renderSymbol(); renderStatusLine(); renderScales(); renderAppearance(); renderTrading(); renderEvents(); }

  // ---- Defaults / Cancel -----------------------------------------------------------------------
  function resetTab(tabName: string): void {
    const d = defaultOptions(model.options.theme);
    const o = model.options;
    const key = TABS.find((t) => t[1] === tabName)?.[0];
    switch (key) {
      case 'symbol': {
        const type = chart.chartType as SeriesType;
        (o.series as any)[type] = cloneDeep((d.series as any)[type]);
        o.symbol = cloneDeep(d.symbol);
        o.volume = cloneDeep(d.volume);
        chart.applyOptions({});
        chart.setTimezone(o.symbol.timezone);
        applyPrecision(chart, 'default');
        break;
      }
      case 'statusLine': o.legend = cloneDeep(d.legend); chart.applyOptions({}); break;
      case 'scales': {
        o.rightPriceScale = cloneDeep(d.rightPriceScale);
        o.leftPriceScale = cloneDeep(d.leftPriceScale);
        o.timeScale = { ...cloneDeep(d.timeScale), barSpacing: o.timeScale.barSpacing };
        o.localization = { ...o.localization, dateFormat: d.localization.dateFormat, timeFormat: d.localization.timeFormat };
        o.sessionBreaks = d.sessionBreaks;
        o.symbol.lastValueVisible = d.symbol.lastValueVisible; o.symbol.countdownVisible = d.symbol.countdownVisible; o.symbol.highLowLabelsVisible = d.symbol.highLowLabelsVisible; o.symbol.bidAskVisible = d.symbol.bidAskVisible; o.symbol.prePostMarketVisible = d.symbol.prePostMarketVisible;
        chart.applyOptions({});
        for (const id of ['right', 'left'] as const) { const ps = chart.priceScale('main', id); ps.setMode('normal'); ps.setInverted(false); ps.setAutoScale(true); }
        for (const i of model.indicators) for (const [pid, s] of Object.entries(i.styles)) s.showLast = i.def.plots.find((p) => p.id === pid)?.style.showLast ?? true;
        model.invalidate('full');
        break;
      }
      case 'appearance':
        o.layout = cloneDeep(d.layout); o.grid = cloneDeep(d.grid); o.crosshair = cloneDeep(d.crosshair); o.watermark = cloneDeep(d.watermark); o.navigation = cloneDeep(d.navigation);
        o.rightPriceScale.textColor = d.rightPriceScale.textColor; o.leftPriceScale.textColor = d.leftPriceScale.textColor; o.timeScale.textColor = d.timeScale.textColor;
        o.rightPriceScale.borderColor = d.rightPriceScale.borderColor; o.leftPriceScale.borderColor = d.leftPriceScale.borderColor; o.timeScale.borderColor = d.timeScale.borderColor;
        chart.applyOptions({});
        break;
      case 'trading': removeJson(TRADING_KEY); break;
      case 'events': removeJson(EVENTS_KEY); o.timeScale.marksVisible = d.timeScale.marksVisible; chart.applyOptions({}); break;
    }
    renderAll();
  }

  function restore(): void {
    model.options = cloneDeep(snapshot.options);
    chart.applyOptions({});
    for (const id of ['right', 'left'] as const) {
      const ps = chart.priceScale('main', id);
      const s = snapshot.scales[id];
      ps.setMode(s.mode); ps.setInverted(s.inverted); ps.setAutoScale(s.auto);
    }
    chart.setTimezone(snapshot.options.symbol.timezone);
    const p = snapshot.options.symbol.precision;
    if (p === 'default') { model.mainSeries.priceFormat = { ...snapshot.mainPriceFormat }; applyPrecision(chart, 'default'); } else applyPrecision(chart, p);
    for (const { inst, flags } of snapshot.showLast) for (const [k, v] of Object.entries(flags)) if (inst.styles[k]) inst.styles[k].showLast = v;
    model.invalidate('full');
  }

  renderAll();
  const initialTab = initial === 'volume' ? 'Symbol' : (TABS.find((t) => t[0] === initial)?.[1] ?? 'Symbol');
  dlg.setTab(initialTab);
  if (initial === 'volume') setTimeout(() => document.getElementById('oc-settings-volume')?.scrollIntoView({ block: 'start' }), 0);
  return dlg;
}

function scaleState(chart: Chart, id: 'right' | 'left'): ScaleState {
  const ps = chart.priceScale('main', id);
  return { mode: ps.getMode(), inverted: ps.isInverted(), auto: ps.isAutoScale() };
}
