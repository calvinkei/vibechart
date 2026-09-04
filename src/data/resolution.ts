import type { ResolutionString } from './types';

export type ResolutionUnit = 'S' | 'm' | 'H' | 'D' | 'W' | 'M' | 'R';

export interface ParsedResolution {
  value: number;
  unit: ResolutionUnit;
  /** Nominal seconds per bar (months ≈ 30d, weeks 7d). */
  seconds: number;
  isIntraday: boolean;
  isSeconds: boolean;
  isDaily: boolean;
  isWeekly: boolean;
  isMonthly: boolean;
  isRange: boolean;
  label: string; // "1m" "5m" "1H" "4H" "D" "W" "M"
  /** Human name like TradingView menu: "1 minute", "1 hour", "1 day". */
  name: string;
}

const cache = new Map<string, ParsedResolution>();

export function parseResolution(res: ResolutionString): ParsedResolution {
  const key = String(res).trim();
  const hit = cache.get(key);
  if (hit) return hit;
  const m = key.toUpperCase().match(/^(\d*)\s*([SDWMHTR]?)$/);
  let value = 1;
  let unit: ResolutionUnit = 'm';
  if (m) {
    value = m[1] ? parseInt(m[1], 10) : 1;
    const u = m[2];
    if (u === 'S') unit = 'S';
    else if (u === 'D') unit = 'D';
    else if (u === 'W') unit = 'W';
    else if (u === 'M') unit = 'M';
    else if (u === 'H') unit = 'H';
    else if (u === 'R') unit = 'R';
    else unit = 'm'; // plain number = minutes (TV convention)
  }
  if (unit === 'H') {
    // normalize to minutes (TV uses "60", "240")
    value = value * 60;
    unit = 'm';
  }
  let seconds = 60;
  switch (unit) {
    case 'S': seconds = value; break;
    case 'm': seconds = value * 60; break;
    case 'D': seconds = value * 86400; break;
    case 'W': seconds = value * 7 * 86400; break;
    case 'M': seconds = value * 30 * 86400; break;
    case 'R': seconds = 60; break;
    default: seconds = value * 60;
  }
  let label: string;
  if (unit === 'm') {
    if (value % 60 === 0 && value >= 60) label = `${value / 60}h`;
    else label = `${value}m`;
  } else if (unit === 'S') label = `${value}s`;
  else if (unit === 'R') label = `${value}R`;
  else label = value === 1 ? unit : `${value}${unit}`;
  const nameUnit: Record<ResolutionUnit, string> = { S: 'second', m: 'minute', H: 'hour', D: 'day', W: 'week', M: 'month', R: 'range' };
  let name: string;
  if (unit === 'm' && value % 60 === 0 && value >= 60) {
    const h = value / 60;
    name = `${h} hour${h > 1 ? 's' : ''}`;
  } else name = `${value} ${nameUnit[unit]}${value > 1 ? 's' : ''}`;
  const parsed: ParsedResolution = {
    value,
    unit,
    seconds,
    isIntraday: unit === 'm' || unit === 'S',
    isSeconds: unit === 'S',
    isDaily: unit === 'D',
    isWeekly: unit === 'W',
    isMonthly: unit === 'M',
    isRange: unit === 'R',
    label,
    name,
  };
  cache.set(key, parsed);
  return parsed;
}

export function resolutionToSeconds(res: ResolutionString): number {
  return parseResolution(res).seconds;
}

/** Normalize user input like "1h", "4H", "1d", "60" into TV canonical form ("60", "240", "1D"). */
export function normalizeResolution(res: string): ResolutionString {
  const p = parseResolution(res);
  switch (p.unit) {
    case 'S': return `${p.value}S`;
    case 'm': return `${p.value}`;
    case 'D': return `${p.value}D`;
    case 'W': return `${p.value}W`;
    case 'M': return `${p.value}M`;
    case 'R': return `${p.value}R`;
    default: return `${p.value}`;
  }
}

/** Default interval menu (TradingView style). */
export const DEFAULT_INTERVALS: Array<{ res: ResolutionString; group: string }> = [
  { res: '1S', group: 'SECONDS' }, { res: '5S', group: 'SECONDS' }, { res: '10S', group: 'SECONDS' }, { res: '15S', group: 'SECONDS' }, { res: '30S', group: 'SECONDS' },
  { res: '1', group: 'MINUTES' }, { res: '2', group: 'MINUTES' }, { res: '3', group: 'MINUTES' }, { res: '5', group: 'MINUTES' }, { res: '10', group: 'MINUTES' }, { res: '15', group: 'MINUTES' }, { res: '30', group: 'MINUTES' }, { res: '45', group: 'MINUTES' },
  { res: '60', group: 'HOURS' }, { res: '120', group: 'HOURS' }, { res: '180', group: 'HOURS' }, { res: '240', group: 'HOURS' },
  { res: '1D', group: 'DAYS' }, { res: '1W', group: 'DAYS' }, { res: '1M', group: 'DAYS' }, { res: '3M', group: 'DAYS' }, { res: '6M', group: 'DAYS' }, { res: '12M', group: 'DAYS' },
];

/**
 * Compute the start time (seconds) of the bar that contains `time` for the given resolution,
 * aligned in the given timezone for daily and above (weeks start Monday, months on the 1st).
 */
export function alignTimeToResolution(time: number, res: ResolutionString, tzOffsetSeconds = 0): number {
  const p = parseResolution(res);
  if (p.isIntraday) return Math.floor(time / p.seconds) * p.seconds;
  const local = time + tzOffsetSeconds;
  const d = new Date(local * 1000);
  if (p.isDaily) {
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
    // multi-day: align relative to epoch days
    const days = Math.floor(dayStart / 86400);
    return (days - (days % p.value)) * 86400 - tzOffsetSeconds;
  }
  if (p.isWeekly) {
    const dow = (d.getUTCDay() + 6) % 7; // Monday=0
    const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) / 1000;
    const EPOCH_MONDAY = 345600; // 1970-01-05
    const weekIndex = Math.floor((monday - EPOCH_MONDAY) / 604800);
    const aligned = (weekIndex - (((weekIndex % p.value) + p.value) % p.value)) * 604800 + EPOCH_MONDAY;
    return aligned - tzOffsetSeconds;
  }
  if (p.isMonthly) {
    const months = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const aligned = months - (months % p.value);
    return Date.UTC(Math.floor(aligned / 12), aligned % 12, 1) / 1000 - tzOffsetSeconds;
  }
  return time;
}

/** Add n bars worth of time to `time` for calendar-based resolutions (used for future extrapolation). */
export function addBarsToTime(time: number, res: ResolutionString, n: number, tzOffsetSeconds = 0): number {
  const p = parseResolution(res);
  if (p.isIntraday || p.isRange) return time + n * p.seconds;
  if (p.isDaily) return time + n * p.value * 86400;
  if (p.isWeekly) return time + n * p.value * 7 * 86400;
  // monthly
  const local = time + tzOffsetSeconds;
  const d = new Date(local * 1000);
  const months = d.getUTCFullYear() * 12 + d.getUTCMonth() + n * p.value;
  return Date.UTC(Math.floor(months / 12), months % 12, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) / 1000 - tzOffsetSeconds;
}
