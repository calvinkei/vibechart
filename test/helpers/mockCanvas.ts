/** Minimal CanvasRenderingContext2D stub for Node tests: records calls, measures text by length. */
export function mockCtx(): CanvasRenderingContext2D & { calls: string[] } {
  const calls: string[] = [];
  const target: any = { calls, canvas: { width: 800, height: 400 }, font: '12px sans-serif', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, textAlign: 'left', textBaseline: 'alphabetic' };
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      if (prop === 'measureText') return (s: string) => ({ width: String(s).length * 7 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return (...args: unknown[]) => { calls.push(`${prop}(${args.map((a) => (typeof a === 'number' ? Math.round(a * 100) / 100 : JSON.stringify(a))).join(',')})`); };
    },
    set(t, prop: string, v) { t[prop] = v; return true; },
  });
}

import { TimeScale } from '../../src/core/TimeScale';
import { PriceScale } from '../../src/core/PriceScale';
import { defaultOptions } from '../../src/core/options';
import { MainSeries } from '../../src/series/MainSeries';
import type { Bar } from '../../src/data/types';
import type { DrawingRenderContext } from '../../src/drawings/Drawing';

/** Build synthetic daily bars starting 2024-01-01 UTC. */
export function makeBars(n: number, start = 100, stepSec = 86400, t0 = 1704067200): Bar[] {
  const bars: Bar[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = p * (1 + Math.sin(i / 7) * 0.02 + Math.cos(i / 3) * 0.01);
    const h = Math.max(o, c) * 1.01;
    const l = Math.min(o, c) * 0.99;
    bars.push({ time: t0 + i * stepSec, open: o, high: h, low: l, close: c, volume: 1000 + (i % 10) * 100 });
    p = c;
  }
  return bars;
}

/** A ready-to-use DrawingRenderContext over synthetic bars (800x400 pane). */
export function makeDrawingContext(bars: Bar[] = makeBars(200), width = 800, height = 400): DrawingRenderContext & { ctx: ReturnType<typeof mockCtx> } {
  const options = defaultOptions('light');
  const ts = new TimeScale(options.timeScale, options.localization);
  ts.setWidth(width);
  ts.setTimes(bars.map((b) => b.time));
  ts.fitContent();
  const ps = new PriceScale('right', options.rightPriceScale, 'right');
  ps.setHeight(height);
  const main = new MainSeries(options);
  main.setData(bars);
  ps.addProvider(main);
  ps.autoScaleFor(0, bars.length - 1);
  const ctx = mockCtx();
  return {
    ctx, timeScale: ts, priceScale: ps, width, height, dpr: 1, options,
    toPixel: (p) => ({ x: ts.timeToX(p.time), y: ps.priceToY(p.price) }),
    fromPixel: (x, y) => ({ time: ts.xToTime(x), price: ps.yToPrice(y) }),
    priceFormat: main.priceFormat, mainSeries: main, selected: false, hovered: false, creating: false,
    font: '12px sans-serif', fontFamily: 'sans-serif', theme: 'light', paneId: 'main',
  };
}
