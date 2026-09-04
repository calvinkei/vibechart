/**
 * "Go to" dialog: jump to a date/time (chart timezone) or set a custom visible range.
 */
import type { Chart } from '../../core/Chart';
import { Dialog } from '../components';
import { el } from '../../util/dom';
import { parseResolution } from '../../data/resolution';
import { chartTimezone, dateTimeInput, localInputToTime, timeToDateInput, timeToTimeInput, note } from './shared';

export function openGoToDate(chart: Chart): Dialog {
  const tz = chartTimezone(chart);
  const intraday = parseResolution(chart.interval).isIntraday;
  const bars = chart.bars();
  const last = bars.length ? bars[bars.length - 1].time : Math.floor(Date.now() / 1000);
  const range = chart.timeScale().getVisibleRange();
  const from0 = range?.from ?? (bars.length ? bars[Math.max(0, bars.length - 100)].time : last - 30 * 86400);
  const to0 = range?.to ?? last;

  const dlg = new Dialog({
    title: 'Go to',
    container: chart.root,
    width: 400,
    tabs: ['Date', 'Custom range'],
    buttons: [
      { label: 'Cancel', onClick: (d) => d.close() },
      { label: 'Go', primary: true, onClick: () => go() },
    ],
  });

  let date = timeToDateInput(last, tz);
  let time = timeToTimeInput(last, tz);
  let from = timeToDateInput(from0, tz);
  let to = timeToDateInput(to0, tz);

  const datePane = dlg.tab('Date');
  const rowD = el('div', { class: 'vc-goto-row' });
  rowD.appendChild(el('label', { text: 'Date' }));
  rowD.appendChild(withEnter(dateTimeInput('date', date, (v) => { date = v; })));
  datePane.appendChild(rowD);
  if (intraday) {
    const rowT = el('div', { class: 'vc-goto-row' });
    rowT.appendChild(el('label', { text: 'Time' }));
    rowT.appendChild(withEnter(dateTimeInput('time', time, (v) => { time = v; }, { step: 60 })));
    datePane.appendChild(rowT);
  }
  datePane.appendChild(note(`Times are in the chart timezone (${tz}).`));

  const rangePane = dlg.tab('Custom range');
  const rowF = el('div', { class: 'vc-goto-row' });
  rowF.appendChild(el('label', { text: 'From' }));
  rowF.appendChild(withEnter(dateTimeInput('date', from, (v) => { from = v; })));
  rangePane.appendChild(rowF);
  const rowTo = el('div', { class: 'vc-goto-row' });
  rowTo.appendChild(el('label', { text: 'To' }));
  rowTo.appendChild(withEnter(dateTimeInput('date', to, (v) => { to = v; })));
  rangePane.appendChild(rowTo);

  function withEnter(inp: HTMLInputElement): HTMLInputElement {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.dispatchEvent(new Event('change')); go(); } });
    return inp;
  }

  function go(): void {
    if (dlg.activeTab === 'Date') {
      const t = localInputToTime(date, tz, intraday ? time : undefined);
      if (t === null) return;
      chart.timeScale().goToDate(t);
    } else {
      const a = localInputToTime(from, tz);
      const b = localInputToTime(to, tz);
      if (a === null || b === null) return;
      const lo = Math.min(a, b), hi = Math.max(a, b) + 86399;
      chart.timeScale().setVisibleRange(lo, hi);
    }
    dlg.close();
  }

  setTimeout(() => (datePane.querySelector('input') as HTMLInputElement | null)?.focus(), 20);
  return dlg;
}
