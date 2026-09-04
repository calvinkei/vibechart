import { describe, it, expect } from 'vitest';
import { getPath, setPath, bucketFor, visibleForResolution, categorizeIndicator, parsePrecision, VISIBILITY_BUCKETS } from '../src/ui/dialogs/helpers';
import { defaultVisibility } from '../src/drawings/Drawing';

describe('dialog helpers', () => {
  it('getPath/setPath read and write dotted paths', () => {
    const o: any = { a: { b: 1 } };
    expect(getPath(o, 'a.b')).toBe(1);
    expect(getPath(o, 'a.x.y')).toBeUndefined();
    setPath(o, 'a.c.d', 5);
    expect(o.a.c.d).toBe(5);
    setPath(o, 'a.b', undefined);
    expect('b' in o.a).toBe(true);
    expect(o.a.b).toBeUndefined();
  });

  it('bucketFor maps resolutions to TradingView buckets', () => {
    expect(bucketFor(30)).toEqual({ key: 'seconds', value: 30 });
    expect(bucketFor(60)).toEqual({ key: 'minutes', value: 1 });
    expect(bucketFor(3600 * 4)).toEqual({ key: 'hours', value: 4 });
    expect(bucketFor(86400)).toEqual({ key: 'days', value: 1 });
    expect(bucketFor(7 * 86400)).toEqual({ key: 'weeks', value: 1 });
    expect(bucketFor(30 * 86400)).toEqual({ key: 'months', value: 1 });
    expect(VISIBILITY_BUCKETS.map((b) => b.key)).toEqual(['seconds', 'minutes', 'hours', 'days', 'weeks', 'months']);
  });

  it('visibleForResolution honours bucket toggles and ranges', () => {
    const v = defaultVisibility();
    expect(visibleForResolution(v, 3600)).toBe(true);
    v.hours = false;
    expect(visibleForResolution(v, 3600)).toBe(false);
    expect(visibleForResolution(v, 60)).toBe(true);
    v.minutesFrom = 5;
    expect(visibleForResolution(v, 60)).toBe(false);
    expect(visibleForResolution(v, 300)).toBe(true);
    v.ranges = false;
    expect(visibleForResolution(v, 60, true)).toBe(false);
  });

  it('categorizeIndicator uses explicit category, else a name-based guess', () => {
    expect(categorizeIndicator({ id: 'x', name: 'Whatever', category: 'Volume' })).toBe('Volume');
    expect(categorizeIndicator({ id: 'Moving Average Exponential', name: 'Moving Average Exponential' })).toBe('Moving Averages');
    expect(categorizeIndicator({ id: 'Relative Strength Index', name: 'Relative Strength Index' })).toBe('Oscillators');
    expect(categorizeIndicator({ id: 'Average True Range', name: 'Average True Range' })).toBe('Volatility');
    expect(categorizeIndicator({ id: 'On Balance Volume', name: 'On Balance Volume' })).toBe('Volume');
    expect(categorizeIndicator({ id: 'Volume Profile Visible Range', name: 'Volume Profile Visible Range' })).toBe('Volume Profile');
    expect(categorizeIndicator({ id: 'Engulfing', name: 'Engulfing - Bullish' })).toBe('Candlestick Patterns');
    expect(categorizeIndicator({ id: 'Something Odd', name: 'Something Odd' })).toBe('Others');
  });

  it('parsePrecision clamps and defaults', () => {
    expect(parsePrecision('default')).toBe('default');
    expect(parsePrecision('3')).toBe(3);
    expect(parsePrecision('12')).toBe(8);
    expect(parsePrecision('abc')).toBe('default');
  });
});
