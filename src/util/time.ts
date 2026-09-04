/** Timezone-aware date helpers using Intl (no dependencies). */

export interface DateParts {
  year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getDtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
      });
    } catch {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
      });
    }
    dtfCache.set(tz, f);
  }
  return f;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Resolve "exchange" pseudo-timezone to a real one via `exchangeTz`. */
export function resolveTimezone(tz: string | undefined, exchangeTz?: string): string {
  if (!tz || tz === 'exchange') return exchangeTz || 'Etc/UTC';
  if (tz === 'browser' || tz === 'local') {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC'; } catch { return 'Etc/UTC'; }
  }
  return tz;
}

/** Break a unix timestamp (seconds) into local date parts in the given IANA timezone. */
export function dateParts(timeSec: number, tz: string): DateParts {
  const parts = getDtf(tz).formatToParts(new Date(timeSec * 1000));
  const out: DateParts = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, weekday: 4 };
  for (const p of parts) {
    switch (p.type) {
      case 'year': out.year = +p.value; break;
      case 'month': out.month = +p.value; break;
      case 'day': out.day = +p.value; break;
      case 'hour': out.hour = +p.value % 24; break;
      case 'minute': out.minute = +p.value; break;
      case 'second': out.second = +p.value; break;
      case 'weekday': out.weekday = WD[p.value] ?? 0; break;
    }
  }
  return out;
}

/** Offset (seconds) of timezone `tz` from UTC at the given time. */
export function tzOffset(timeSec: number, tz: string): number {
  const p = dateParts(timeSec, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
  return asUtc - Math.floor(timeSec);
}

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export type DateFormat = 'dd MMM yyyy' | 'MMM dd, yyyy' | 'yyyy-MM-dd' | 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy/MM/dd' | 'dd-MM-yyyy' | 'MM-dd-yyyy' | 'dd.MM.yyyy' | 'yy-MM-dd' | 'dd MMM yy';

export function formatDate(p: DateParts, fmt: DateFormat = 'dd MMM yyyy'): string {
  const dd = pad2(p.day);
  const MM = pad2(p.month);
  const MMM = MONTHS_SHORT[p.month - 1];
  const yyyy = String(p.year);
  const yy = yyyy.slice(-2);
  switch (fmt) {
    case 'dd MMM yyyy': return `${dd} ${MMM} ${yyyy}`;
    case 'MMM dd, yyyy': return `${MMM} ${dd}, ${yyyy}`;
    case 'yyyy-MM-dd': return `${yyyy}-${MM}-${dd}`;
    case 'dd/MM/yyyy': return `${dd}/${MM}/${yyyy}`;
    case 'MM/dd/yyyy': return `${MM}/${dd}/${yyyy}`;
    case 'yyyy/MM/dd': return `${yyyy}/${MM}/${dd}`;
    case 'dd-MM-yyyy': return `${dd}-${MM}-${yyyy}`;
    case 'MM-dd-yyyy': return `${MM}-${dd}-${yyyy}`;
    case 'dd.MM.yyyy': return `${dd}.${MM}.${yyyy}`;
    case 'yy-MM-dd': return `${yy}-${MM}-${dd}`;
    case 'dd MMM yy': return `${dd} ${MMM} ${yy}`;
    default: return `${dd} ${MMM} ${yyyy}`;
  }
}

export function formatTime(p: DateParts, withSeconds = false): string {
  return `${pad2(p.hour)}:${pad2(p.minute)}${withSeconds ? `:${pad2(p.second)}` : ''}`;
}

/** Full date-time string used in crosshair label / tooltips, e.g. "Tue 12 Mar '24  14:30". */
export function formatDateTime(timeSec: number, tz: string, opts: { intraday: boolean; seconds?: boolean; dateFormat?: DateFormat; weekday?: boolean }): string {
  const p = dateParts(timeSec, tz);
  const wd = opts.weekday === false ? '' : `${WEEKDAYS_SHORT[p.weekday]} `;
  const date = formatDate(p, opts.dateFormat ?? 'dd MMM yyyy');
  if (!opts.intraday) return `${wd}${date}`;
  return `${wd}${date}  ${formatTime(p, !!opts.seconds)}`;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Convert local (tz) parts to unix seconds. */
export function partsToTime(p: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number }, tz: string): number {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour ?? 0, p.minute ?? 0, p.second ?? 0) / 1000;
  const off = tzOffset(guess, tz);
  const t = guess - off;
  // correct for DST edge
  const off2 = tzOffset(t, tz);
  return off2 === off ? t : guess - off2;
}

/** Common timezone list (subset of TradingView's). */
export const TIMEZONES: Array<{ id: string; name: string }> = [
  { id: 'Etc/UTC', name: 'UTC' },
  { id: 'exchange', name: 'Exchange' },
  { id: 'Pacific/Honolulu', name: 'Honolulu' },
  { id: 'America/Anchorage', name: 'Anchorage' },
  { id: 'America/Los_Angeles', name: 'Los Angeles' },
  { id: 'America/Denver', name: 'Denver' },
  { id: 'America/Chicago', name: 'Chicago' },
  { id: 'America/New_York', name: 'New York' },
  { id: 'America/Toronto', name: 'Toronto' },
  { id: 'America/Mexico_City', name: 'Mexico City' },
  { id: 'America/Bogota', name: 'Bogota' },
  { id: 'America/Lima', name: 'Lima' },
  { id: 'America/Caracas', name: 'Caracas' },
  { id: 'America/Santiago', name: 'Santiago' },
  { id: 'America/Sao_Paulo', name: 'Sao Paulo' },
  { id: 'America/Argentina/Buenos_Aires', name: 'Buenos Aires' },
  { id: 'Atlantic/Reykjavik', name: 'Reykjavik' },
  { id: 'Europe/London', name: 'London' },
  { id: 'Europe/Dublin', name: 'Dublin' },
  { id: 'Europe/Lisbon', name: 'Lisbon' },
  { id: 'Europe/Madrid', name: 'Madrid' },
  { id: 'Europe/Paris', name: 'Paris' },
  { id: 'Europe/Amsterdam', name: 'Amsterdam' },
  { id: 'Europe/Brussels', name: 'Brussels' },
  { id: 'Europe/Zurich', name: 'Zurich' },
  { id: 'Europe/Berlin', name: 'Berlin' },
  { id: 'Europe/Rome', name: 'Rome' },
  { id: 'Europe/Vienna', name: 'Vienna' },
  { id: 'Europe/Copenhagen', name: 'Copenhagen' },
  { id: 'Europe/Oslo', name: 'Oslo' },
  { id: 'Europe/Stockholm', name: 'Stockholm' },
  { id: 'Europe/Warsaw', name: 'Warsaw' },
  { id: 'Europe/Athens', name: 'Athens' },
  { id: 'Europe/Helsinki', name: 'Helsinki' },
  { id: 'Europe/Istanbul', name: 'Istanbul' },
  { id: 'Europe/Moscow', name: 'Moscow' },
  { id: 'Africa/Cairo', name: 'Cairo' },
  { id: 'Africa/Johannesburg', name: 'Johannesburg' },
  { id: 'Africa/Lagos', name: 'Lagos' },
  { id: 'Asia/Tehran', name: 'Tehran' },
  { id: 'Asia/Dubai', name: 'Dubai' },
  { id: 'Asia/Riyadh', name: 'Riyadh' },
  { id: 'Asia/Karachi', name: 'Karachi' },
  { id: 'Asia/Kolkata', name: 'Kolkata' },
  { id: 'Asia/Dhaka', name: 'Dhaka' },
  { id: 'Asia/Bangkok', name: 'Bangkok' },
  { id: 'Asia/Ho_Chi_Minh', name: 'Ho Chi Minh' },
  { id: 'Asia/Jakarta', name: 'Jakarta' },
  { id: 'Asia/Kuala_Lumpur', name: 'Kuala Lumpur' },
  { id: 'Asia/Singapore', name: 'Singapore' },
  { id: 'Asia/Hong_Kong', name: 'Hong Kong' },
  { id: 'Asia/Shanghai', name: 'Shanghai' },
  { id: 'Asia/Taipei', name: 'Taipei' },
  { id: 'Asia/Manila', name: 'Manila' },
  { id: 'Asia/Seoul', name: 'Seoul' },
  { id: 'Asia/Tokyo', name: 'Tokyo' },
  { id: 'Australia/Perth', name: 'Perth' },
  { id: 'Australia/Adelaide', name: 'Adelaide' },
  { id: 'Australia/Brisbane', name: 'Brisbane' },
  { id: 'Australia/Sydney', name: 'Sydney' },
  { id: 'Pacific/Auckland', name: 'Auckland' },
];
