/**
 * Strategy settings dialog — Inputs (from the script's input.* calls), Properties (the TradingView
 * "Properties" tab: capital, order size, pyramiding, commission, slippage, margin, recalculation and
 * order-fill options) and Style (hands off to the plot style dialog).
 */
import type { Chart } from '../../core/Chart';
import type { StrategyController } from '../../strategy/StrategyEngine';
import { defaultStrategyProperties, type StrategyProperties } from '../../strategy/types';
import { el } from '../../util/dom';
import { Dialog, checkbox, colorButton, formRow, formSection, numberInput, selectInput, textInput } from '../components';
import { note } from './shared';
import { openIndicatorSettings } from './indicatorSettings';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'HKD', 'SGD', 'CNY', 'KRW', 'INR', 'BRL', 'BTC', 'ETH', 'USDT'];
const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];

export function openStrategySettings(chart: Chart, initialTab: 'Inputs' | 'Properties' | 'Style' = 'Inputs'): Dialog {
  const ctrl = chart.strategy as StrategyController;
  const effective: StrategyProperties = { ...defaultStrategyProperties(), ...(ctrl.lastRun?.properties ?? {}), ...ctrl.properties };
  const inputVals: Record<string, unknown> = {};
  for (const d of ctrl.inputDefs) inputVals[d.id] = ctrl.inputs[d.id] ?? d.defval;
  const props: StrategyProperties = { ...effective };
  const cur = effective.currency || chart.symbolInfo?.currency_code || 'USD';

  const dlg = new Dialog({
    title: ctrl.title,
    container: chart.root,
    width: 520,
    className: 'vc-settings-dialog vc-strategy-dialog',
    tabs: ['Inputs', 'Properties', 'Style'],
    buttons: [
      { label: 'Defaults', left: true, onClick: () => { if (dlg.activeTab === 'Inputs') { for (const d of ctrl.inputDefs) inputVals[d.id] = d.defval; renderInputs(); } else if (dlg.activeTab === 'Properties') { ctrl.resetProperties(); dlg.close(); } } },
      { label: 'Cancel', onClick: () => dlg.close() },
      { label: 'Ok', primary: true, onClick: () => { apply(); dlg.close(); } },
    ],
  });

  // ---- Inputs ---------------------------------------------------------------------------------------
  function renderInputs(): void {
    const pane = dlg.tab('Inputs');
    pane.innerHTML = '';
    if (!ctrl.inputDefs.length) { pane.appendChild(note(ctrl.lastRun ? 'This strategy declares no inputs. Use input.int(), input.float(), input.bool(), input.string() or input.source() in the script.' : 'Add the strategy to the chart first; its inputs appear here.')); return; }
    let group = '';
    for (const d of ctrl.inputDefs) {
      if (d.group && d.group !== group) { group = d.group; pane.appendChild(formSection(group)); }
      const set = (v: unknown): void => { inputVals[d.id] = v; };
      const v = inputVals[d.id];
      let control: HTMLElement;
      switch (d.type) {
        case 'int': control = numberInput(Number(v ?? 0), set, { min: d.min, max: d.max, step: d.step ?? 1, int: true }); break;
        case 'float': control = numberInput(Number(v ?? 0), set, { min: d.min, max: d.max, step: d.step ?? 0.01 }); break;
        case 'bool': control = checkbox(!!v, set); break;
        case 'source': control = selectInput(String(v ?? 'close'), SOURCES, set); break;
        case 'select': control = selectInput(String(v ?? ''), d.options ?? [], set); break;
        case 'color': control = colorButton(String(v ?? '#2962FF'), set); break;
        default: control = textInput(String(v ?? ''), set);
      }
      if (d.tooltip) control.title = d.tooltip;
      pane.appendChild(formRow(d.title, control));
    }
  }

  // ---- Properties -------------------------------------------------------------------------------------
  function renderProperties(): void {
    const pane = dlg.tab('Properties');
    pane.innerHTML = '';
    const num = (key: keyof StrategyProperties, opts: { min?: number; max?: number; step?: number; int?: boolean } = {}) =>
      numberInput(Number(props[key]), (v) => { (props as any)[key] = v; }, opts);
    pane.appendChild(formRow('Initial capital', num('initialCapital', { min: 0, step: 1000 })));
    pane.appendChild(formRow('Base currency', selectInput(props.currency || 'default', [{ value: 'default', label: 'Default' }, ...CURRENCIES.map((c) => ({ value: c, label: c }))], (v) => { props.currency = v === 'default' ? '' : v; })));
    const qtyType = selectInput(props.defaultQtyType, [{ value: 'fixed', label: 'Contracts' }, { value: 'cash', label: cur }, { value: 'percent_of_equity', label: '% of equity' }], (v) => { props.defaultQtyType = v as StrategyProperties['defaultQtyType']; });
    pane.appendChild(formRow('Order size', [num('defaultQtyValue', { min: 0, step: 1 }), qtyType]));
    const pyr = num('pyramiding', { min: 0, step: 1, int: true });
    pane.appendChild(formRow('Pyramiding', [pyr, el('span', { class: 'vc-unit', text: 'orders' })]));
    const commType = selectInput(props.commissionType, [{ value: 'percent', label: '%' }, { value: 'cash_per_contract', label: `${cur} per contract` }, { value: 'cash_per_order', label: `${cur} per order` }], (v) => { props.commissionType = v as StrategyProperties['commissionType']; });
    pane.appendChild(formRow('Commission', [num('commissionValue', { min: 0, step: 0.01 }), commType]));
    pane.appendChild(formRow('Verify price for limit orders', [num('backtestFillLimitsAssumption', { min: 0, step: 1, int: true }), el('span', { class: 'vc-unit', text: 'ticks' })]));
    pane.appendChild(formRow('Slippage', [num('slippage', { min: 0, step: 1, int: true }), el('span', { class: 'vc-unit', text: 'ticks' })]));
    pane.appendChild(formRow('Margin for long positions', [num('marginLong', { min: 0, max: 100, step: 1 }), el('span', { class: 'vc-unit', text: '%' })]));
    pane.appendChild(formRow('Margin for short positions', [num('marginShort', { min: 0, max: 100, step: 1 }), el('span', { class: 'vc-unit', text: '%' })]));
    pane.appendChild(formSection('Recalculate'));
    pane.appendChild(formRow('', checkbox(props.calcOnOrderFills, (v) => { props.calcOnOrderFills = v; }, 'After order is filled')));
    pane.appendChild(formRow('', checkbox(props.calcOnEveryTick, (v) => { props.calcOnEveryTick = v; }, 'On every tick')));
    pane.appendChild(formSection('Fill orders'));
    const magnifier = checkbox(props.useBarMagnifier, (v) => { props.useBarMagnifier = v; }, 'Using bar magnifier');
    magnifier.title = 'Needs intrabar data; not available in this build';
    (magnifier.querySelector('input') as HTMLInputElement).disabled = true;
    pane.appendChild(formRow('', magnifier));
    pane.appendChild(formRow('', checkbox(props.processOrdersOnClose, (v) => { props.processOrdersOnClose = v; }, 'On bar close')));
    pane.appendChild(formRow('', checkbox(props.fillOrdersOnStandardOhlc, (v) => { props.fillOrdersOnStandardOhlc = v; }, 'Using standard OHLC')));
    pane.appendChild(formSection('Ratios'));
    pane.appendChild(formRow('Risk-free rate', [num('riskFreeRate', { min: 0, step: 0.1 }), el('span', { class: 'vc-unit', text: '% per year' })]));
    pane.appendChild(note('Values set here override the script\'s strategy() call. "Defaults" removes the overrides.'));
  }

  // ---- Style -----------------------------------------------------------------------------------------
  function renderStyle(): void {
    const pane = dlg.tab('Style');
    pane.innerHTML = '';
    if (!ctrl.instance || !ctrl.isOnChart) { pane.appendChild(note('Add the strategy to the chart to edit its plot styles.')); return; }
    pane.appendChild(note('Plot colours, line widths and visibility use the regular indicator style dialog.'));
    const b = el('button', { class: 'vc-secondary', text: 'Open plot styles…' });
    b.addEventListener('click', () => { const inst = ctrl.instance; dlg.close(); if (inst) openIndicatorSettings(chart, inst); });
    pane.appendChild(b);
  }

  function apply(): void {
    const changedInputs: Record<string, unknown> = {};
    for (const d of ctrl.inputDefs) if (String(inputVals[d.id]) !== String(ctrl.inputs[d.id] ?? d.defval)) changedInputs[d.id] = inputVals[d.id];
    const changedProps: Partial<StrategyProperties> = {};
    for (const k of Object.keys(props) as Array<keyof StrategyProperties>) if (props[k] !== effective[k]) (changedProps as any)[k] = props[k];
    if (Object.keys(changedProps).length) ctrl.properties = { ...ctrl.properties, ...changedProps };
    if (Object.keys(changedInputs).length) ctrl.inputs = { ...ctrl.inputs, ...changedInputs };
    if (ctrl.instance && Object.keys(changedInputs).length) ctrl.instance.setInputs(changedInputs);
    if ((Object.keys(changedProps).length || Object.keys(changedInputs).length) && ctrl.isOnChart) void ctrl.run();
  }

  renderInputs();
  renderProperties();
  renderStyle();
  dlg.setTab(initialTab);
  return dlg;
}
