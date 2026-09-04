/**
 * Floating navigation buttons at the bottom-right of the chart area (TradingView "control bar"):
 * zoom out / zoom in / reset view, plus "scroll to the most recent bar" when scrolled away.
 */
import type { Chart } from '../core/Chart';
import { TIME_AXIS_HEIGHT } from '../core/views';
import { el } from '../util/dom';
import { ICONS } from './icons';
import { altKey } from './util';

export interface NavButtons { update(): void; destroy(): void }

export function createNavButtons(chart: Chart): NavButtons {
  const wrap = el('div', { class: 'vc-nav-buttons' });
  const mk = (icon: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = el('button', { class: 'vc-nav-btn', html: ICONS[icon], title });
    b.addEventListener('click', onClick);
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    return b;
  };
  const zoomOut = mk('zoomOut', 'Zoom out (−)', () => chart.timeScale().zoomOut());
  const zoomIn = mk('zoomIn', 'Zoom in (+)', () => chart.timeScale().zoomIn());
  const reset = mk('reset', `Reset chart view (${altKey()}+R)`, () => chart.resetView());
  const realtime = mk('scrollRight', 'Scroll to the most recent bar (End)', () => chart.model.timeScale.scrollToRealtime());
  realtime.classList.add('vc-nav-realtime');
  wrap.appendChild(zoomOut);
  wrap.appendChild(zoomIn);
  wrap.appendChild(reset);
  wrap.appendChild(realtime);
  chart.chartAreaEl.appendChild(wrap);

  function update(): void {
    const o = chart.options;
    wrap.style.display = o.navigation.scrollButtons ? '' : 'none';
    const at = chart.model.timeScale.isAtRealtime();
    realtime.hidden = at;
    wrap.classList.toggle('vc-nav-show', !at);
    wrap.style.right = `${chart.axisWidths().right + 10}px`;
    wrap.style.bottom = `${(o.timeScale.visible ? TIME_AXIS_HEIGHT : 0) + 10}px`;
  }

  const unsubs = [
    chart.subscribe('visibleRangeChanged', update),
    chart.subscribe('dataLoaded', update),
    chart.subscribe('optionsChanged', update),
  ];
  update();

  return {
    update,
    destroy() { for (const u of unsubs) u(); wrap.remove(); },
  };
}
