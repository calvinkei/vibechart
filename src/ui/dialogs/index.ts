import type { Chart } from '../../core/Chart';

/**
 * Dialog entry point. Types:
 *  'chartSettings' (payload?: initial tab id: 'symbol'|'statusLine'|'scales'|'appearance'|'trading'|'events'|'volume')
 *  'indicatorSettings' (payload: IndicatorInstance)
 *  'drawingSettings' (payload: Drawing)
 *  'indicators' (indicator search/list)
 *  'symbolSearch'
 *  'objectTree'
 *  'goToDate'
 *  'templates'
 *  'closeAll'
 */
export type DialogType = 'chartSettings' | 'indicatorSettings' | 'drawingSettings' | 'indicators' | 'symbolSearch' | 'objectTree' | 'goToDate' | 'templates' | 'compare' | 'closeAll' | string;

export function openDialog(chart: Chart, type: DialogType, payload?: unknown): void {
  void chart; void type; void payload;
  // implemented in the dialog modules of this folder
}
