import { plotStyle, type IndicatorDefinition, type IndicatorInput, type IndicatorPlot, type ComputeResult } from '../Indicator';
import { anchorKeyFn } from './movingAverages';

/** Pivot Points Standard (spec §3.75 / §11.11). */

const isNum = (v: number): boolean => v === v && v !== Infinity && v !== -Infinity;

const LEVELS = ['P', 'R1', 'R2', 'R3', 'R4', 'R5', 'S1', 'S2', 'S3', 'S4', 'S5'] as const;
type LevelId = (typeof LEVELS)[number];
const LEVEL_COLORS: Record<LevelId, string> = {
  P: '#FB8C00', R1: '#089981', R2: '#089981', R3: '#089981', R4: '#089981', R5: '#089981',
  S1: '#F23645', S2: '#F23645', S3: '#F23645', S4: '#F23645', S5: '#F23645',
};

const TIMEFRAMES = ['Auto', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly', 'Biyearly', 'Triyearly', 'Quinquennially', 'Decennially'];
const TF_MAP: Record<string, string> = {
  Daily: '1D', Weekly: '1W', Monthly: '1M', Quarterly: '3M', Yearly: '12M', Biyearly: '24M', Triyearly: '36M', Quinquennially: '60M', Decennially: '120M',
};

/** Auto pivot timeframe: ≤ 15-minute charts -> 1D, other intraday -> 1W, daily -> 1M, weekly/monthly -> 12M. */
function autoTimeframe(resolution: string, parse: (r: string) => { isIntraday: boolean; isSeconds: boolean; isDaily: boolean; multiplier: number }): string {
  const r = parse(resolution);
  if (r.isSeconds) return '1D';
  if (r.isIntraday) return r.multiplier <= 15 ? '1D' : '1W';
  if (r.isDaily) return '1M';
  return '12M';
}

function priceDecimals(minMove: number): number {
  if (!(minMove > 0)) return 2;
  return Math.max(0, Math.min(8, Math.round(-Math.log10(minMove))));
}

/** Pivot levels of a period from the previous period's H/L/C (and open/close for DM, current open for Woodie). NaN = level not defined for the type. */
export function pivotLevels(kind: string, H: number, L: number, C: number, prevOpen: number, currOpen: number): Record<LevelId, number> {
  const out = {} as Record<LevelId, number>;
  for (const id of LEVELS) out[id] = NaN;
  const range = H - L;
  switch (kind) {
    case 'Fibonacci': {
      const P = (H + L + C) / 3;
      out.P = P;
      out.R1 = P + 0.382 * range; out.S1 = P - 0.382 * range;
      out.R2 = P + 0.618 * range; out.S2 = P - 0.618 * range;
      out.R3 = P + range; out.S3 = P - range;
      break;
    }
    case 'Woodie': {
      const P = (H + L + 2 * currOpen) / 4;
      out.P = P;
      out.R1 = 2 * P - L; out.S1 = 2 * P - H;
      out.R2 = P + range; out.S2 = P - range;
      out.R3 = H + 2 * (P - L); out.S3 = L - 2 * (H - P);
      out.R4 = out.R3 + range; out.S4 = out.S3 - range;
      break;
    }
    case 'Classic': {
      const P = (H + L + C) / 3;
      out.P = P;
      out.R1 = 2 * P - L; out.S1 = 2 * P - H;
      out.R2 = P + range; out.S2 = P - range;
      out.R3 = P + 2 * range; out.S3 = P - 2 * range;
      out.R4 = P + 3 * range; out.S4 = P - 3 * range;
      break;
    }
    case 'DM': {
      const X = prevOpen === C ? H + L + 2 * C : C > prevOpen ? 2 * H + L + C : 2 * L + H + C;
      out.P = X / 4;
      out.R1 = X / 2 - L; out.S1 = X / 2 - H;
      break;
    }
    case 'Camarilla': {
      out.P = (H + L + C) / 3;
      out.R1 = C + (1.1 * range) / 12; out.S1 = C - (1.1 * range) / 12;
      out.R2 = C + (1.1 * range) / 6; out.S2 = C - (1.1 * range) / 6;
      out.R3 = C + (1.1 * range) / 4; out.S3 = C - (1.1 * range) / 4;
      out.R4 = C + (1.1 * range) / 2; out.S4 = C - (1.1 * range) / 2;
      out.R5 = (H / L) * C; out.S5 = C - (out.R5 - C);
      break;
    }
    default: { // Traditional
      const P = (H + L + C) / 3;
      out.P = P;
      out.R1 = 2 * P - L; out.S1 = 2 * P - H;
      out.R2 = P + range; out.S2 = P - range;
      out.R3 = 2 * P + (H - 2 * L); out.S3 = 2 * P - (2 * H - L);
      out.R4 = 3 * P + (H - 3 * L); out.S4 = 3 * P - (3 * H - L);
      out.R5 = 4 * P + (H - 4 * L); out.S5 = 4 * P - (4 * H - L);
    }
  }
  return out;
}

const levelInputs: IndicatorInput[] = LEVELS.map((id) => ({ id: `show${id}`, name: id, type: 'bool', defval: true, group: 'Levels' }));
const levelPlots: IndicatorPlot[] = [
  ...LEVELS.map((id): IndicatorPlot => ({ id, title: id, style: plotStyle({ type: 'stepLine', color: LEVEL_COLORS[id], showLast: false }) })),
  ...LEVELS.map((id): IndicatorPlot => ({ id: `${id}Label`, title: `${id} Label`, style: plotStyle({ type: 'chars', location: 'absolute', color: LEVEL_COLORS[id], showLast: false }), hideInLegend: true })),
];

export const pivotsIndicators: IndicatorDefinition[] = [
  {
    id: 'Pivot Points Standard', name: 'Pivot Points Standard', shortName: 'Pivots', category: 'Pivots', overlay: true, aliases: ['Pivots', 'Pivot Points'],
    inputs: [
      { id: 'type', name: 'Type', type: 'select', defval: 'Traditional', options: ['Traditional', 'Fibonacci', 'Woodie', 'Classic', 'DM', 'Camarilla'] },
      { id: 'pivotsTimeframe', name: 'Pivots Timeframe', type: 'select', defval: 'Auto', options: TIMEFRAMES },
      { id: 'lookBack', name: 'Number of Pivots Back', type: 'int', defval: 15, min: 1, max: 5000 },
      { id: 'useDailyBased', name: 'Use Daily-based Values', type: 'bool', defval: true },
      { id: 'showLabels', name: 'Show Labels', type: 'bool', defval: true, group: 'Labels' },
      { id: 'showPrices', name: 'Show Prices', type: 'bool', defval: true, group: 'Labels' },
      { id: 'labelsPosition', name: 'Labels Position', type: 'select', defval: 'Left', options: ['Left', 'Right'], group: 'Labels' },
      ...levelInputs,
    ],
    plots: levelPlots,
    precision: 'inherit',
    compute(ctx, inp) {
      const { n, ta, time, open, high, low, close, minMove } = ctx;
      const out: ComputeResult = {};
      const series = {} as Record<LevelId, Float64Array>;
      const labelVals = {} as Record<LevelId, Float64Array>;
      const labelTexts = {} as Record<LevelId, Array<string | null>>;
      for (const id of LEVELS) { series[id] = ta.nanArray(n); labelVals[id] = ta.nanArray(n); labelTexts[id] = new Array(n).fill(null); }
      const tf = inp.pivotsTimeframe === 'Auto' || !TF_MAP[inp.pivotsTimeframe] ? autoTimeframe(ctx.resolution, ta.parseResolution) : TF_MAP[inp.pivotsTimeframe];
      const np = ta.periodChanges(time, anchorKeyFn(tf, ctx.timezone));
      const periods: Array<{ start: number; end: number; o: number; h: number; l: number; c: number }> = [];
      for (let i = 0; i < n; i++) {
        if (np[i] || !periods.length) periods.push({ start: i, end: i, o: open[i], h: high[i], l: low[i], c: close[i] });
        else { const p = periods[periods.length - 1]; p.end = i; if (high[i] > p.h) p.h = high[i]; if (low[i] < p.l) p.l = low[i]; p.c = close[i]; }
      }
      const decimals = priceDecimals(minMove);
      const firstK = Math.max(1, periods.length - Math.max(1, inp.lookBack | 0));
      for (let k = firstK; k < periods.length; k++) {
        const prev = periods[k - 1], cur = periods[k];
        const lv = pivotLevels(inp.type, prev.h, prev.l, prev.c, prev.o, cur.o);
        for (const id of LEVELS) {
          const val = lv[id];
          if (!isNum(val) || !inp[`show${id}`]) continue;
          series[id].fill(val, cur.start, cur.end + 1);
          if (inp.showLabels) {
            const at = inp.labelsPosition === 'Right' ? cur.end : cur.start;
            labelVals[id][at] = val;
            labelTexts[id][at] = inp.showPrices ? `${id} (${val.toFixed(decimals)})` : id;
          }
        }
      }
      for (const id of LEVELS) { out[id] = series[id]; out[`${id}Label`] = { values: labelVals[id], texts: labelTexts[id] }; }
      return out;
    },
  },
];
