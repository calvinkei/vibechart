export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function nearlyEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

/** Binary search: index of the last element with key <= value (or -1). */
export function lowerBound(arr: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Binary search: index of the first element with key >= value (or arr.length). */
export function upperBound(arr: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Nice number rounding (1, 2, 2.5, 5, 10 multiples). */
export function niceStep(rough: number, allow25 = true): number {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1;
  const exp = Math.floor(Math.log10(rough));
  const base = Math.pow(10, exp);
  const f = rough / base;
  let nice: number;
  if (f <= 1) nice = 1;
  else if (f <= 2) nice = 2;
  else if (allow25 && f <= 2.5) nice = 2.5;
  else if (f <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

export function roundTo(v: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(v * m) / m;
}

export function log10(v: number): number {
  return Math.log(v) / Math.LN10;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance from point p to segment a-b. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  return distance(px, py, ax + t * dx, ay + t * dy);
}

/** Distance from point to infinite line through a-b. */
export function distToLine(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return distance(px, py, ax, ay);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
}

/** Distance from point to ray starting at a toward b. */
export function distToRay(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  return distance(px, py, ax + t * dx, ay + t * dy);
}

export function pointInRect(px: number, py: number, x1: number, y1: number, x2: number, y2: number): boolean {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

export function pointInPolygon(px: number, py: number, pts: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Intersect line (through a,b) with a rectangle; returns clipped segment endpoints or null. */
export function clipLineToRect(
  ax: number, ay: number, bx: number, by: number,
  left: number, top: number, right: number, bottom: number,
  extendLeft: boolean, extendRight: boolean,
): [number, number, number, number] | null {
  const dx = bx - ax;
  const dy = by - ay;
  // Parametrize p(t) = a + t*(b-a). Segment: t in [0,1]; extended: t in (-inf, +inf)
  let t0 = extendLeft ? -Infinity : 0;
  let t1 = extendRight ? Infinity : 1;
  if (dx === 0 && dy === 0) return null;
  const clip = (p: number, q: number): boolean => {
    // p*t <= q
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, ax - left)) return null;
  if (!clip(dx, right - ax)) return null;
  if (!clip(-dy, ay - top)) return null;
  if (!clip(dy, bottom - ay)) return null;
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}
