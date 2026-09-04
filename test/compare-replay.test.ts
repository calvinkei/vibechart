import { describe, it, expect } from 'vitest';
import { ChartModel } from '../src/core/ChartModel';
import { defaultOptions } from '../src/core/options';
import { ReplayController } from '../src/core/Replay';
import { CompareSeries } from '../src/series/CompareSeries';
import { makeBars } from './helpers/mockCanvas';
import type { Bar, Datafeed } from '../src/data/types';

function feedFor(bars: Bar[]): Datafeed {
  const ms = bars.map((b) => ({ ...b, time: b.time * 1000 }));
  return {
    onReady: (cb) => setTimeout(() => cb({}), 0),
    resolveSymbol: (name, ok) => setTimeout(() => ok({ name, description: name, type: 'stock', session: '24x7', timezone: 'Etc/UTC', exchange: 'X', minmov: 1, pricescale: 100, supported_resolutions: ['1D'] }), 0),
    getBars: (_s, _r, p, ok) => setTimeout(() => { const slice = ms.filter((b) => b.time < p.to * 1000).slice(-p.countBack); ok(slice, { noData: slice.length === 0 }); }, 0),
    subscribeBars: () => {},
    unsubscribeBars: () => {},
  };
}

describe('CompareSeries', () => {
  it('aligns compare bars to the main time axis and carries values forward', async () => {
    const main = makeBars(50);
    // compare has every other bar
    const other = main.filter((_, i) => i % 2 === 0).map((b) => ({ ...b, close: b.close * 2 }));
    const cs = new CompareSeries(feedFor(other), 'OTHER');
    await cs.load('1D', 100);
    cs.setMainTimes(main.map((b) => b.time));
    expect(cs.aligned.length).toBe(50);
    expect(cs.aligned[10].close).toBeCloseTo(main[10].close * 2, 9);
    expect(cs.aligned[11].close).toBeCloseTo(main[10].close * 2, 9); // carried forward
    const r = cs.priceRange(0, 49)!;
    expect(r.min).toBeGreaterThan(0);
    expect(cs.legendItems(10)[0].value).toBe((main[10].close * 2).toFixed(2));
    cs.destroy();
  });
  it('model.addCompare switches the main scale to percentage by default', async () => {
    const model = new ChartModel(defaultOptions());
    model.setResolution('1D');
    const main = makeBars(30);
    model.setBars(main, { prepended: 0, appended: 0, reset: true });
    const cs = model.addCompare(feedFor(main), 'X');
    expect(model.mainPane.right.mode).toBe('percentage');
    expect(model.mainPane.sources).toContain(cs);
    model.removeCompare(cs);
    expect(model.compares.length).toBe(0);
    expect(model.mainPane.right.mode).toBe('normal');
  });
});

describe('ReplayController', () => {
  it('truncates bars, steps forward and restores', () => {
    const model = new ChartModel(defaultOptions());
    model.setResolution('1D');
    const bars = makeBars(100);
    model.setBars(bars, { prepended: 0, appended: 0, reset: true });
    let full = bars;
    const replay = new ReplayController(model, () => full, (b) => model.setBars(b, { prepended: 0, appended: 0, reset: false }));
    replay.start({ index: 49 });
    expect(replay.state.active).toBe(true);
    expect(model.bars.length).toBe(50);
    replay.stepForward(3);
    expect(model.bars.length).toBe(53);
    replay.jumpTo(9);
    expect(model.bars.length).toBe(10);
    // realtime data arriving while replaying is buffered, not shown
    full = bars.concat([{ ...bars[99], time: bars[99].time + 86400 }]);
    replay.onRealtimeBars(full);
    expect(model.bars.length).toBe(10);
    replay.stop();
    expect(model.bars.length).toBe(101);
    expect(replay.state.active).toBe(false);
    replay.destroy();
  });
});
