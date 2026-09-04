import { describe, it, expect } from 'vitest';
import { buildIntervalGroups, isResolutionSupported, parseCustomInterval, CHART_TYPES, chartTypeInfo } from '../src/ui/topToolbar';
import { DATE_RANGES, nearestSupportedResolution, formatUtcOffset, rangeSpanSeconds } from '../src/ui/bottomBar';
import { groupTools, TOOL_GROUPS } from '../src/ui/leftToolbar';
import { pickColorKeys } from '../src/ui/floatingToolbar';
import { visibilityPreset, bucketFor } from '../src/ui/contextMenus';
import { shortcutSections } from '../src/ui/keyboard';
import { registerDrawingTool, listDrawingTools } from '../src/drawings/Drawing';
import { allBuiltinDrawings } from '../src/drawings/tools/index';
import { DEFAULT_INTERVALS } from '../src/data/resolution';

for (const c of allBuiltinDrawings()) registerDrawingTool(c);

describe('top toolbar models', () => {
  it('groups default intervals like TradingView', () => {
    const groups = buildIntervalGroups(DEFAULT_INTERVALS);
    expect(groups.map((g) => g.group)).toEqual(['SECONDS', 'MINUTES', 'HOURS', 'DAYS']);
    const hours = groups.find((g) => g.group === 'HOURS')!;
    expect(hours.items.map((i) => i.label)).toEqual(['1h', '2h', '3h', '4h']);
    expect(hours.items[0].name).toBe('1 hour');
  });
  it('adds extra (custom) resolutions into the right group without duplicates', () => {
    const groups = buildIntervalGroups(DEFAULT_INTERVALS, ['7', '1h', '1D']);
    const minutes = groups.find((g) => g.group === 'MINUTES')!;
    expect(minutes.items.map((i) => i.res)).toContain('7');
    const hours = groups.find((g) => g.group === 'HOURS')!;
    expect(hours.items.filter((i) => i.res === '60').length).toBe(1);
  });
  it('checks supported resolutions in canonical form', () => {
    expect(isResolutionSupported('1h', ['60', '1D'])).toBe(true);
    expect(isResolutionSupported('5', ['60', '1D'])).toBe(false);
    expect(isResolutionSupported('5', undefined)).toBe(true);
  });
  it('parses custom interval input', () => {
    expect(parseCustomInterval('4h')).toBe('240');
    expect(parseCustomInterval('1D')).toBe('1D');
    expect(parseCustomInterval('15')).toBe('15');
    expect(parseCustomInterval('abc')).toBeNull();
    expect(parseCustomInterval('')).toBeNull();
  });
  it('lists all 18 chart types with icons', () => {
    expect(CHART_TYPES.length).toBe(18);
    expect(new Set(CHART_TYPES.map((c) => c.type)).size).toBe(18);
    expect(chartTypeInfo('pointAndFigure').name).toBe('Point & figure');
  });
});

describe('bottom bar models', () => {
  it('maps ranges to resolutions per the spec table', () => {
    const byLabel = Object.fromEntries(DATE_RANGES.map((r) => [r.label, r.res]));
    expect(byLabel['1D']).toBe('1');
    expect(byLabel['5D']).toBe('5');
    expect(byLabel['1M']).toBe('30');
    expect(byLabel['3M']).toBe('60');
    expect(byLabel['6M']).toBe('120');
    expect(byLabel['5Y']).toBe('1W');
    expect(byLabel['All']).toBe('1M');
  });
  it('falls back to the nearest supported resolution', () => {
    expect(nearestSupportedResolution('120', ['1', '5', '60', '240', '1D'])).toBe('60');
    expect(nearestSupportedResolution('30', ['1', '5', '15', '60'])).toBe('15');
    expect(nearestSupportedResolution('1W', ['1D'])).toBe('1D');
    expect(nearestSupportedResolution('60', ['60'])).toBe('60');
  });
  it('formats UTC offsets', () => {
    expect(formatUtcOffset(0)).toBe('UTC');
    expect(formatUtcOffset(8 * 3600)).toBe('UTC+8');
    expect(formatUtcOffset(-5 * 3600)).toBe('UTC-5');
    expect(formatUtcOffset(5.5 * 3600)).toBe('UTC+5:30');
  });
  it('computes range spans (YTD from Jan 1 in the chart timezone)', () => {
    const feb1 = Date.UTC(2024, 1, 1) / 1000;
    expect(rangeSpanSeconds(DATE_RANGES[0], feb1, 'Etc/UTC')).toBe(86400);
    expect(rangeSpanSeconds(DATE_RANGES.find((r) => r.label === 'YTD')!, feb1, 'Etc/UTC')).toBe(31 * 86400);
    expect(rangeSpanSeconds(DATE_RANGES.find((r) => r.label === 'All')!, feb1, 'Etc/UTC')).toBeNull();
  });
});

describe('left toolbar grouping', () => {
  it('folds registered tools into TradingView groups, dropping empty groups and cursors', () => {
    const grouped = groupTools(listDrawingTools());
    const ids = grouped.map((g) => g.def.id);
    const order = TOOL_GROUPS.map((g) => g.id);
    expect(ids.every((id, i) => i === 0 || order.indexOf(id) > order.indexOf(ids[i - 1]))).toBe(true);
    for (const g of grouped) {
      expect(g.tools.length).toBeGreaterThan(0);
      expect(g.tools.every((t) => String(t.group) !== 'cursor')).toBe(true);
      expect(g.sections.flatMap((s) => s.tools)).toEqual(g.tools);
    }
    const lines = grouped.find((g) => g.def.id === 'lines');
    if (lines) expect(lines.tools.some((t) => t.toolId === 'trend_line')).toBe(true);
  });
});

describe('floating toolbar colour keys', () => {
  it('picks line / fill / text keys from property defs', () => {
    const keys = pickColorKeys([
      { key: 'lineColor', label: 'Line', type: 'color' },
      { key: 'backgroundColor', label: 'Background', type: 'color' },
      { key: 'textColor', label: 'Text', type: 'color' },
      { key: 'lineWidth', label: 'Width', type: 'lineWidth' },
    ]);
    expect(keys).toEqual({ line: 'lineColor', fill: 'backgroundColor', text: 'textColor' });
  });
  it('uses the first colour property when there is no lineColor', () => {
    expect(pickColorKeys([{ key: 'color', label: 'Color', type: 'color' }])).toEqual({ line: 'color', fill: undefined, text: undefined });
    expect(pickColorKeys([{ key: 'fillColor', label: 'Fill', type: 'color' }])).toEqual({ line: undefined, fill: 'fillColor', text: undefined });
  });
});

describe('drawing visibility presets', () => {
  it('buckets resolutions', () => {
    expect(bucketFor(60)).toEqual({ bucket: 'minutes', value: 1 });
    expect(bucketFor(3600 * 4)).toEqual({ bucket: 'hours', value: 4 });
    expect(bucketFor(86400)).toEqual({ bucket: 'days', value: 1 });
  });
  it('"current only" enables just the current bucket at the current value', () => {
    const v = visibilityPreset('current', 3600 * 4);
    expect(v.hours).toBe(true);
    expect(v.hoursFrom).toBe(4);
    expect(v.hoursTo).toBe(4);
    expect(v.minutes).toBe(false);
    expect(v.days).toBe(false);
  });
  it('"current and above" keeps larger buckets on', () => {
    const v = visibilityPreset('above', 60 * 15);
    expect(v.seconds).toBe(false);
    expect(v.minutes).toBe(true);
    expect(v.minutesFrom).toBe(15);
    expect(v.minutesTo).toBe(59);
    expect(v.hours).toBe(true);
    expect(v.months).toBe(true);
  });
  it('"all" resets to defaults', () => {
    const v = visibilityPreset('all', 60);
    expect(v.seconds && v.minutes && v.hours && v.days && v.weeks && v.months).toBe(true);
  });
});

describe('shortcuts help', () => {
  it('lists chart and drawing sections', () => {
    const s = shortcutSections();
    expect(s.map((x) => x.title)).toEqual(['Chart', 'Drawings']);
    expect(s[0].items.some(([label]) => label === 'Go to date')).toBe(true);
  });
});
