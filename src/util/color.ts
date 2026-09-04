/** Color utilities: parse hex/rgb/rgba/hsl, apply alpha, lighten/darken. */
export interface RGBA { r: number; g: number; b: number; a: number }

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  gray: '#808080', grey: '#808080', orange: '#ffa500', yellow: '#ffff00', purple: '#800080',
  transparent: 'rgba(0,0,0,0)',
};

export function parseColor(input: string): RGBA {
  let s = (input || '').trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (h.length === 3 || h.length === 4) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
      return { r, g, b, a };
    }
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  }
  const m2 = s.match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/);
  if (m2) {
    const a = m2[4] !== undefined ? (m2[4].endsWith('%') ? parseFloat(m2[4]) / 100 : +m2[4]) : 1;
    return { r: +m2[1], g: +m2[2], b: +m2[3], a };
  }
  const hsl = s.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (hsl) {
    const { r, g, b } = hslToRgb(+hsl[1], +hsl[2] / 100, +hsl[3] / 100);
    return { r, g, b, a: hsl[4] !== undefined ? +hsl[4] : 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return { h, s, l };
}

export function toRgbaString(c: RGBA): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${+c.a.toFixed(3)})`;
}

export function toHex(c: RGBA, withAlpha = false): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${withAlpha && c.a < 1 ? h(c.a * 255) : ''}`;
}

/** Return color with given alpha (0..1). */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  return toRgbaString({ ...c, a: alpha });
}

/** Multiply alpha of a color by factor. */
export function scaleAlpha(color: string, factor: number): string {
  const c = parseColor(color);
  return toRgbaString({ ...c, a: c.a * factor });
}

export function alphaOf(color: string): number {
  return parseColor(color).a;
}

export function lighten(color: string, amount: number): string {
  const c = parseColor(color);
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
  const rgb = hslToRgb(h, s, Math.min(1, l + amount));
  return toRgbaString({ ...rgb, a: c.a });
}

export function darken(color: string, amount: number): string {
  return lighten(color, -amount);
}

export function isDarkColor(color: string): boolean {
  const c = parseColor(color);
  const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  return lum < 0.5;
}

/** Contrast text color (black/white) for a background. */
export function contrastText(bg: string): string {
  return isDarkColor(bg) ? '#ffffff' : '#131722';
}

/** Blend color over an opaque background. */
export function blend(fg: string, bg: string): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const a = f.a;
  return toRgbaString({ r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a), a: 1 });
}
