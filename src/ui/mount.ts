import type { Chart } from '../core/Chart';

/** Placeholder mount: replaced by the full UI implementation (toolbars, dialogs, menus). */
export function mountUI(chart: Chart): { destroy(): void } {
  void chart;
  return { destroy() { /* nothing yet */ } };
}
