/**
 * UI module: toolbars, dialogs, context menus. It registers itself as Chart.uiFactory.
 * Extended by src/ui/*.ts (top toolbar, left toolbar, dialogs...).
 */
import { Chart } from '../core/Chart';
import { mountUI } from './mount';

Chart.uiFactory = (chart) => mountUI(chart);

export { mountUI };
