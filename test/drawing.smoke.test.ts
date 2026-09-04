import { describe, it, expect } from 'vitest';
import { makeDrawingContext } from './helpers/mockCanvas';
import { listDrawingTools, registerDrawingTool } from '../src/drawings/Drawing';
import { allBuiltinDrawings } from '../src/drawings/tools/index';

for (const c of allBuiltinDrawings()) registerDrawingTool(c);

describe('all drawing tools render and hit-test without throwing', () => {
  const rc = makeDrawingContext();
  const bars = rc.mainSeries.bars;
  for (const ctor of listDrawingTools()) {
    it(ctor.toolId, () => {
      const d = new ctor();
      const need = Math.max(ctor.pointsCount, 2);
      for (let i = 0; i < need; i++) {
        const b = bars[20 + i * 15];
        d.addPoint({ time: b.time, price: b.close * (1 + (i % 2 ? 0.05 : -0.05)) });
      }
      d.creating = false;
      expect(() => d.render(rc)).not.toThrow();
      expect(() => d.hitTest(100, 100, rc)).not.toThrow();
      expect(() => d.handles(rc)).not.toThrow();
      expect(d.propertyDefs().length).toBeGreaterThan(0);
      const s = d.serialize();
      expect(s.type).toBe(ctor.toolId);
      const copy = new ctor();
      copy.applySerialized(s);
      expect(copy.points.length).toBe(d.points.length);
      expect(() => copy.render(rc)).not.toThrow();
    });
  }
});
