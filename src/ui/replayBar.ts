/**
 * Bar Replay toolbar (TradingView-style): pick a start bar, play/pause, step forward, speed, exit.
 * Mounted on demand by the UI (see mount.ts) via `showReplayBar(chart)`.
 */
import type { Chart } from '../core/Chart';
import { el, injectStyle } from '../util/dom';
import { ICONS } from './icons';
import { button, selectInput, tooltip } from './components';

const SPEEDS: Array<{ value: number; label: string }> = [
  { value: 0.1, label: '10x slower' }, { value: 0.33, label: '3x slower' }, { value: 1, label: '1x' },
  { value: 3, label: '3x faster' }, { value: 10, label: '10x faster' },
];

const CSS = `.oc-replay-bar{position:absolute;left:50%;top:8px;transform:translateX(-50%);z-index:40;display:flex;align-items:center;gap:4px;padding:4px 8px;background:var(--oc-bg);border:1px solid var(--oc-border);border-radius:8px;box-shadow:var(--oc-shadow);font-size:12px}.oc-replay-bar .oc-select{height:26px;min-width:90px}.oc-replay-status{color:var(--oc-text2);padding:0 6px;white-space:nowrap}.oc-replay-selecting .oc-pane{cursor:col-resize!important}`;

export function showReplayBar(chart: Chart): { destroy(): void } {
  injectStyle(CSS, 'openchart-replay-style');
  const existing = chart.chartAreaEl.querySelector('.oc-replay-bar');
  if (existing) return { destroy: () => existing.remove() };
  const replay = chart.replay();
  const bar = el('div', { class: 'oc-replay-bar' });
  const status = el('span', { class: 'oc-replay-status', text: 'Click on the chart to select the start bar' });
  const playBtn = button('', { icon: 'play', title: 'Play / Pause' });
  const stepBtn = button('', { icon: 'stepForward', title: 'Forward (one bar)' });
  const speedSel = selectInput(1, SPEEDS, (v) => replay.setSpeed(parseFloat(v)));
  const selectBtn = button('Select bar', { icon: 'handle', title: 'Select a start bar' });
  const exitBtn = button('', { icon: 'close', title: 'Exit replay' });
  tooltip(playBtn, 'Play / Pause', chart.chartAreaEl);
  bar.append(selectBtn, playBtn, stepBtn, speedSel, status, exitBtn);
  chart.chartAreaEl.appendChild(bar);

  let selecting = true;
  const paneClick = (e: MouseEvent): void => {
    if (!selecting) return;
    const paneEl = (e.target as HTMLElement).closest('.oc-pane') as HTMLElement | null;
    if (!paneEl) return;
    const rect = paneEl.getBoundingClientRect();
    const idx = chart.model.timeScale.xToBarIndex(e.clientX - rect.left);
    const clamped = Math.max(0, Math.min(chart.model.bars.length - 1, idx));
    selecting = false;
    chart.chartAreaEl.classList.remove('oc-replay-selecting');
    if (!replay.active) replay.start({ index: clamped });
    else replay.jumpTo(clamped);
    e.stopPropagation();
    e.preventDefault();
  };
  chart.chartAreaEl.addEventListener('click', paneClick, true);
  chart.chartAreaEl.classList.add('oc-replay-selecting');

  selectBtn.addEventListener('click', () => { selecting = true; chart.chartAreaEl.classList.add('oc-replay-selecting'); status.textContent = 'Click on the chart to select the start bar'; });
  playBtn.addEventListener('click', () => { if (!replay.active) return; if (replay.state.playing) replay.pause(); else replay.play(); });
  stepBtn.addEventListener('click', () => replay.stepForward(1));
  const update = (): void => {
    const s = replay.state;
    playBtn.querySelector('.oc-icon')!.innerHTML = s.playing ? ICONS.pause : ICONS.play;
    playBtn.disabled = !s.active;
    stepBtn.disabled = !s.active || s.position >= s.total;
    if (s.active) status.textContent = `Bar ${s.position} of ${s.total}${s.position >= s.total ? ' — end of data' : ''}`;
  };
  const off = replay.changed.subscribe(update);
  update();
  const destroy = (): void => {
    off();
    chart.chartAreaEl.removeEventListener('click', paneClick, true);
    chart.chartAreaEl.classList.remove('oc-replay-selecting');
    if (replay.active) replay.stop();
    bar.remove();
  };
  exitBtn.addEventListener('click', destroy);
  return { destroy };
}
