import type { Chart } from '../../core/Chart';
import { IndicatorInstance } from '../../indicators/Indicator';
import { Drawing } from '../../drawings/Drawing';
import { closeAllDialogs, type Dialog } from '../components';
import { injectDialogStyles, installDrawingDefaultsHook, ensureIndicatorVisibilityHook } from './shared';
import { openChartSettings, type ChartSettingsTab } from './chartSettings';
import { openIndicatorSettings } from './indicatorSettings';
import { openStrategySettings } from './strategySettings';
import { openDrawingSettings } from './drawingSettings';
import { openIndicatorsDialog } from './indicators';
import { openSymbolSearch } from './symbolSearch';
import { openObjectTree } from './objectTree';
import { openGoToDate } from './goToDate';
import { openTemplates } from './templates';

/**
 * Dialog entry point. Types:
 *  'chartSettings' (payload?: initial tab id: 'symbol'|'statusLine'|'scales'|'appearance'|'trading'|'events'|'volume')
 *  'indicatorSettings' (payload: IndicatorInstance)
 *  'drawingSettings' (payload: Drawing)
 *  'indicators' (indicator search/list)
 *  'symbolSearch'
 *  'compare' (symbol search in compare mode)
 *  'objectTree' (non-modal, toggles)
 *  'goToDate'
 *  'templates'
 *  'closeAll'
 */
export type DialogType = 'chartSettings' | 'indicatorSettings' | 'drawingSettings' | 'indicators' | 'symbolSearch' | 'objectTree' | 'goToDate' | 'templates' | 'compare' | 'strategySettings' | 'closeAll' | string;

const CHART_TABS = new Set<string>(['symbol', 'statusLine', 'scales', 'appearance', 'trading', 'events', 'volume']);
/** Modal dialogs we opened (only one modal at a time, like TradingView). */
const modals = new Set<Dialog>();

function track(dlg: Dialog | null): void {
  if (!dlg || !dlg.backdrop) return;
  modals.add(dlg);
  const prev = dlg.opts.onClose;
  dlg.opts.onClose = () => { modals.delete(dlg); prev?.(); };
}
function closeModals(): void { for (const d of Array.from(modals)) d.close(); modals.clear(); }

export function openDialog(chart: Chart, type: DialogType, payload?: unknown): void {
  injectDialogStyles();
  installDrawingDefaultsHook(chart);
  ensureIndicatorVisibilityHook(chart);
  switch (type) {
    case 'chartSettings': {
      closeModals();
      const tab = typeof payload === 'string' && CHART_TABS.has(payload) ? (payload as ChartSettingsTab) : 'symbol';
      track(openChartSettings(chart, tab));
      break;
    }
    case 'indicatorSettings':
      if (payload instanceof IndicatorInstance) {
        closeModals();
        // the strategy's chart source opens the strategy dialog (inputs + properties), like TradingView
        track(chart.strategy && chart.strategy.instance === payload ? openStrategySettings(chart) : openIndicatorSettings(chart, payload));
      }
      break;
    case 'strategySettings':
      if (chart.strategy) { closeModals(); track(openStrategySettings(chart, payload === 'Properties' || payload === 'Style' ? payload : 'Inputs')); }
      break;
    case 'drawingSettings':
      if (payload instanceof Drawing) { closeModals(); track(openDrawingSettings(chart, payload)); }
      break;
    case 'indicators': closeModals(); track(openIndicatorsDialog(chart)); break;
    case 'symbolSearch': closeModals(); track(openSymbolSearch(chart, 'symbol')); break;
    case 'compare': closeModals(); track(openSymbolSearch(chart, 'compare')); break;
    case 'objectTree': openObjectTree(chart, openDialog); break;
    case 'goToDate': closeModals(); track(openGoToDate(chart)); break;
    case 'templates': closeModals(); track(openTemplates(chart)); break;
    case 'closeAll': closeAllDialogs(); modals.clear(); break;
    default: break; // unknown types (e.g. 'sourceMenu') are handled by the menus module
  }
}

export { openChartSettings, openIndicatorSettings, openDrawingSettings, openIndicatorsDialog, openSymbolSearch, openObjectTree, openGoToDate, openTemplates, openStrategySettings };

// Debug/test hook (harmless in production): window.ocOpenDialog(chart, type, payload)
if (typeof window !== 'undefined') (window as any).ocOpenDialog = openDialog;
