import { Drawing, P, HIT_TOLERANCE, type DrawingRenderContext, type FibLevel, type HitTarget, type PixelPoint, type PropertyDef } from '../Drawing';
import { applyLine, drawExtendedLine, lineDistance, drawTextBox, fontFor } from './common';
import { formatPrice } from '../../util/format';
import { withAlpha } from '../../util/color';
import { clamp, clipLineToRect, distToRay, distToSegment } from '../../util/math';

type Handle = PixelPoint & { index: number };

const HANDLE_HIT = 7;

/** Pitchfork levels (TV `linetoolpitchfork` level0..level8; shared by all pitchfork variants). */
export const DEFAULT_PITCHFORK_LEVELS: FibLevel[] = [
  { coeff: 0.25, color: '#FFB74D', visible: false },
  { coeff: 0.382, color: '#81C784', visible: false },
  { coeff: 0.5, color: '#089981', visible: true },
  { coeff: 0.618, color: '#089981', visible: false },
  { coeff: 0.75, color: '#00BCD4', visible: false },
  { coeff: 1, color: '#2962FF', visible: true },
  { coeff: 1.5, color: '#9C27B0', visible: false },
  { coeff: 1.75, color: '#E91E63', visible: false },
  { coeff: 2, color: '#F77C80', visible: false },
];

/** Pitchfan levels: identical except level 0.5 is cyan (TV `linetoolpitchfan`). */
export const DEFAULT_PITCHFAN_LEVELS: FibLevel[] = DEFAULT_PITCHFORK_LEVELS.map((l) => (l.coeff === 0.5 ? { ...l, color: '#00BCD4' } : { ...l }));

/** TV `style` enum: 0 Original, 1 Schiff, 2 Inside, 3 Modified Schiff. */
export const PITCHFORK_STYLE_OPTIONS = [
  { value: 0, label: 'Original' }, { value: 1, label: 'Schiff' }, { value: 3, label: 'Modified Schiff' }, { value: 2, label: 'Inside' },
];

export interface PitchforkGeometry {
  A: PixelPoint; B: PixelPoint; C: PixelPoint;
  /** midpoint of B–C (the median passes through it) */
  M: PixelPoint;
  /** median origin (depends on `style`) */
  O: PixelPoint;
  /** unit median direction O→M */
  unit: PixelPoint;
  /** half channel vector: level c tines start at M ± c·half */
  half: PixelPoint;
  /** |M − O| */
  len: number;
}

function cloneLevels(levels: FibLevel[]): FibLevel[] { return levels.map((l) => ({ ...l })); }
function fmtCoeff(c: number): string { return String(+c.toFixed(3)); }
function mid(a: PixelPoint, b: PixelPoint): PixelPoint { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function alphaOf(transparency: unknown): number { return (100 - clamp(Number(transparency) || 0, 0, 100)) / 100; }

function hitHandle(handles: Handle[], x: number, y: number): HitTarget {
  for (const h of handles) if (Math.hypot(h.x - x, h.y - y) <= HANDLE_HIT) return { type: 'point', index: h.index };
  return null;
}

function visibleLevels(levels: FibLevel[]): FibLevel[] { return levels.filter((l) => l.visible).sort((p, q) => p.coeff - q.coeff); }

/** Position/alignment for a label at the visible end of a ray (or line when `extendBack`) along `unit`. */
function rayLabelPos(rc: DrawingRenderContext, from: PixelPoint, unit: PixelPoint, extendBack: boolean): { x: number; y: number; align: 'left' | 'center' | 'right'; vAlign: 'top' | 'middle' | 'bottom' } | null {
  const seg = clipLineToRect(from.x, from.y, from.x + unit.x, from.y + unit.y, 0, 0, rc.width, rc.height, extendBack, true);
  if (!seg) return null;
  const ex = seg[2], ey = seg[3];
  return {
    x: ex - unit.x * 10, y: ey - unit.y * 10,
    align: ex >= rc.width - 1 ? 'right' : ex <= 1 ? 'left' : 'center',
    vAlign: ey <= 1 ? 'top' : ey >= rc.height - 1 ? 'bottom' : 'middle',
  };
}

function drawPriceBox(rc: DrawingRenderContext, p: PixelPoint, color: string): void {
  drawTextBox(rc.ctx, formatPrice(rc.priceScale.yToPrice(p.y), rc.priceFormat), p.x + 6, p.y, { font: fontFor(rc, 11), color: '#FFFFFF', bg: color, radius: 2, padding: 2, vAlign: 'middle' });
}

function medianProps(): PropertyDef[] {
  return [P.bool('medianVisible', 'Median line'), P.color('medianColor', 'Median color'), P.lineWidth('medianWidth', 'Median width'), P.lineStyle('medianStyle', 'Median style')];
}

function levelProps(): PropertyDef[] {
  return [
    { key: 'levels', label: 'Levels', type: 'fibLevels', group: 'Levels' },
    P.lineWidth('lineWidth', 'Levels width'), P.lineStyle('lineStyle', 'Levels style'),
    P.bool('fillBackground', 'Background'), P.int('transparency', 'Transparency', 0, 100),
    P.bool('showLabels', 'Level labels', 'Text'), P.bool('showPrices', 'Price labels', 'Text'),
  ];
}

// ---------------------------------------------------------------------------------------------
// Pitchfork family
// ---------------------------------------------------------------------------------------------

/**
 * Andrews pitchfork and its variants (TV `linetoolpitchfork`, `linetoolschiffpitchfork`,
 * `linetoolschiffpitchfork2`, `linetoolinsidepitchfork`) — one implementation, `style` selects the variant:
 *   0 Original:        origin A, tines through B and C.
 *   1 Schiff:          origin (A.x, (A.y + B.y) / 2) — shifted vertically to the A–B midpoint price.
 *   3 Modified Schiff: origin midpoint(A, B) — shifted half-way in time and price.
 *   2 Inside:          origin A, half-width channel (tines through the midpoints of A–B and A–C).
 * The median runs from the origin through midpoint(B, C); level c tines start on the B–C line at
 * M ± c·(C − B)/2 and run parallel to the median (extended backwards too when `extendLines`).
 */
export class PitchforkBase extends Drawing {
  static override toolId = 'pitchfork_base';
  static override toolName = 'Pitchfork';
  static override pointsCount = 3;
  static override group = 'pitchfork' as const;

  defaultStyle(): Record<string, any> {
    return {
      style: 0,
      medianVisible: true, medianColor: '#F23645', medianWidth: 2, medianStyle: 0,
      levels: cloneLevels(DEFAULT_PITCHFORK_LEVELS), lineWidth: 2, lineStyle: 0,
      extendLines: false, fillBackground: true, transparency: 80,
      showLabels: false, showPrices: false,
    };
  }

  propertyDefs(): PropertyDef[] {
    return [P.select('style', 'Style', PITCHFORK_STYLE_OPTIONS), ...medianProps(), P.bool('extendLines', 'Extend lines'), ...levelProps()];
  }

  /** Pixel-space geometry (null until all three points exist). */
  geometry(rc: DrawingRenderContext): PitchforkGeometry | null {
    if (this.points.length < 3) return null;
    const A = rc.toPixel(this.points[0]);
    const B = rc.toPixel(this.points[1]);
    const C = rc.toPixel(this.points[2]);
    const M = mid(B, C);
    let O: PixelPoint = A;
    let half: PixelPoint = { x: (C.x - B.x) / 2, y: (C.y - B.y) / 2 };
    switch (Number(this.style.style)) {
      case 1: O = { x: A.x, y: (A.y + B.y) / 2 }; break;
      case 3: O = mid(A, B); break;
      case 2: half = { x: half.x / 2, y: half.y / 2 }; break;
      default: break;
    }
    const dx = M.x - O.x, dy = M.y - O.y;
    const len = Math.hypot(dx, dy);
    const unit = len > 1e-9 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
    return { A, B, C, M, O, unit, half, len };
  }

  /** Start point of the level-`c` tine on the given side (+1 towards C, −1 towards B). */
  tineStart(g: PitchforkGeometry, c: number, side: 1 | -1): PixelPoint {
    return { x: g.M.x + g.half.x * c * side, y: g.M.y + g.half.y * c * side };
  }

  private _renderPreview(rc: DrawingRenderContext): void {
    const { ctx } = rc;
    const A = rc.toPixel(this.points[0]);
    const B = rc.toPixel(this.points[1]);
    applyLine(ctx, this.style.medianColor, 1, 0);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  }

  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    if (this.points.length < 3) { this._renderPreview(rc); return; }
    const g = this.geometry(rc);
    if (!g || g.len < 1e-9) return;
    const { ctx } = rc;
    const s = this.style;
    const ext = !!s.extendLines;
    const levels = visibleLevels(s.levels as FibLevel[]);
    const L = 2 * (rc.width + rc.height) + 4000;
    const along = (p: PixelPoint, t: number): PixelPoint => ({ x: p.x + g.unit.x * t, y: p.y + g.unit.y * t });
    const sides: Array<1 | -1> = [1, -1];
    if (s.fillBackground && levels.length) {
      const alpha = alphaOf(s.transparency);
      const t0 = ext ? -L : 0;
      let prev = 0;
      for (const l of levels) {
        ctx.fillStyle = withAlpha(l.color, alpha);
        for (const side of sides) {
          const S0 = this.tineStart(g, prev, side), S1 = this.tineStart(g, l.coeff, side);
          const a = along(S0, t0), b = along(S0, L), c = along(S1, L), d = along(S1, t0);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
        }
        prev = l.coeff;
      }
    }
    if (s.medianVisible) {
      applyLine(ctx, s.medianColor, s.medianWidth, s.medianStyle);
      drawExtendedLine(rc, g.O, along(g.O, 100), ext, true);
    }
    for (const l of levels) {
      applyLine(ctx, l.color, s.lineWidth, s.lineStyle);
      for (const side of sides) {
        const S = this.tineStart(g, l.coeff, side);
        drawExtendedLine(rc, S, along(S, 100), ext, true);
      }
    }
    if (s.showLabels || s.showPrices) {
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      const font = fontFor(rc, 11);
      if (s.showPrices && s.medianVisible) drawPriceBox(rc, g.M, s.medianColor);
      for (const l of levels) {
        for (const side of sides) {
          const S = this.tineStart(g, l.coeff, side);
          if (s.showPrices) drawPriceBox(rc, S, l.color);
          if (s.showLabels) {
            const pos = rayLabelPos(rc, S, g.unit, ext);
            if (pos) drawTextBox(ctx, fmtCoeff(l.coeff), pos.x, pos.y, { font, color: l.color, align: pos.align, vAlign: pos.vAlign, padding: 2 });
          }
        }
      }
    }
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const hit = hitHandle(this.handles(rc), x, y);
    if (hit) return hit;
    if (this.points.length < 3) {
      const A = rc.toPixel(this.points[0]), B = rc.toPixel(this.points[1]);
      return distToSegment(x, y, A.x, A.y, B.x, B.y) <= HIT_TOLERANCE ? { type: 'body' } : null;
    }
    const g = this.geometry(rc);
    if (!g || g.len < 1e-9) return null;
    const s = this.style;
    const ext = !!s.extendLines;
    const along = (p: PixelPoint): PixelPoint => ({ x: p.x + g.unit.x * 100, y: p.y + g.unit.y * 100 });
    if (s.medianVisible && lineDistance(x, y, g.O, along(g.O), ext, true) <= HIT_TOLERANCE) return { type: 'body' };
    for (const l of visibleLevels(s.levels as FibLevel[])) {
      for (const side of [1, -1] as Array<1 | -1>) {
        const S = this.tineStart(g, l.coeff, side);
        if (lineDistance(x, y, S, along(S), ext, true) <= HIT_TOLERANCE) return { type: 'body' };
      }
    }
    return null;
  }
}

export class Pitchfork extends PitchforkBase {
  static override toolId = 'pitchfork';
  static override toolName = 'Pitchfork';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M3.4 23.6l14-8 .5.9-14 8zM9.4 8.6l14-8 .5.9-14 8zM13.4 24.6l14-8 .5.9-14 8zM17.4 16.6l7-4 .5.9-7 4z"/><path fill="currentColor" d="M4.5 25.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM10.5 10.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM14.5 26.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>';
}

export class SchiffPitchfork extends PitchforkBase {
  static override toolId = 'schiff_pitchfork';
  static override toolName = 'Schiff Pitchfork';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M3.4 17.6l14-8 .5.9-14 8zM9.4 8.6l14-8 .5.9-14 8zM13.4 24.6l14-8 .5.9-14 8zM17.4 16.6l7-4 .5.9-7 4z"/><path fill="currentColor" d="M4.5 25.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM10.5 10.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM14.5 26.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>';
  override defaultStyle(): Record<string, any> { return { ...super.defaultStyle(), style: 1 }; }
}

export class ModifiedSchiffPitchfork extends PitchforkBase {
  static override toolId = 'modified_schiff_pitchfork';
  static override toolName = 'Modified Schiff Pitchfork';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M7.4 17.6l14-8 .5.9-14 8zM9.4 8.6l14-8 .5.9-14 8zM13.4 24.6l14-8 .5.9-14 8zM17.4 16.6l7-4 .5.9-7 4z"/><path fill="currentColor" d="M4.5 25.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM10.5 10.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM14.5 26.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>';
  override defaultStyle(): Record<string, any> { return { ...super.defaultStyle(), style: 3 }; }
}

export class InsidePitchfork extends PitchforkBase {
  static override toolId = 'inside_pitchfork';
  static override toolName = 'Inside Pitchfork';
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M3.4 23.6l14-8 .5.9-14 8zM11.4 12.6l12-7 .5.9-12 7zM15.4 24.6l10-6 .5.9-10 6zM17.4 16.6l7-4 .5.9-7 4z"/><path fill="currentColor" d="M4.5 25.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM10.5 10.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM14.5 26.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>';
  override defaultStyle(): Record<string, any> { return { ...super.defaultStyle(), style: 2 }; }
}

// ---------------------------------------------------------------------------------------------
// Pitchfan
// ---------------------------------------------------------------------------------------------

export interface PitchfanRay {
  /** null for the median ray */
  l: FibLevel | null;
  /** signed coefficient: side·coeff (0 = median), used for angular ordering */
  k: number;
  color: string;
  /** point on the B–C line the ray passes through */
  through: PixelPoint;
  unit: PixelPoint;
}

/**
 * Pitchfan (TV `linetoolpitchfan`): rays from A through the median point M = mid(B, C) and through
 * M ± c·(C − B)/2 for every visible level; fills between adjacent rays.
 */
export class Pitchfan extends Drawing {
  static override toolId = 'pitchfan';
  static override toolName = 'Pitchfan';
  static override pointsCount = 3;
  static override group = 'pitchfork' as const;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M4.2 23.5l19-6 .3 1-19 6zM4.3 23.6l19-11 .5.9-19 11zM4.4 23.7l17-17 .7.7-17 17z"/><path fill="currentColor" d="M6 24a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM23.5 8.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM24.5 19.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>';

  defaultStyle() {
    return {
      medianVisible: true, medianColor: '#F23645', medianWidth: 2, medianStyle: 0,
      levels: cloneLevels(DEFAULT_PITCHFAN_LEVELS), lineWidth: 2, lineStyle: 0,
      fillBackground: true, transparency: 80, showLabels: false, showPrices: false,
    };
  }

  propertyDefs(): PropertyDef[] { return [...medianProps(), ...levelProps()]; }

  /** Rays sorted by angle (side·coeff ascending; the median has k = 0). Degenerate rays (through A) are skipped. */
  rays(rc: DrawingRenderContext): { A: PixelPoint; M: PixelPoint; rays: PitchfanRay[] } | null {
    if (this.points.length < 3) return null;
    const A = rc.toPixel(this.points[0]);
    const B = rc.toPixel(this.points[1]);
    const C = rc.toPixel(this.points[2]);
    const M = mid(B, C);
    const half = { x: (C.x - B.x) / 2, y: (C.y - B.y) / 2 };
    const s = this.style;
    const out: PitchfanRay[] = [];
    const push = (l: FibLevel | null, k: number, color: string, through: PixelPoint) => {
      const dx = through.x - A.x, dy = through.y - A.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return;
      out.push({ l, k, color, through, unit: { x: dx / len, y: dy / len } });
    };
    push(null, 0, s.medianColor, M);
    for (const l of visibleLevels(s.levels as FibLevel[])) {
      push(l, l.coeff, l.color, { x: M.x + half.x * l.coeff, y: M.y + half.y * l.coeff });
      push(l, -l.coeff, l.color, { x: M.x - half.x * l.coeff, y: M.y - half.y * l.coeff });
    }
    out.sort((p, q) => p.k - q.k);
    return { A, M, rays: out };
  }

  render(rc: DrawingRenderContext): void {
    if (this.points.length < 2) return;
    const { ctx } = rc;
    const s = this.style;
    if (this.points.length < 3) {
      const A = rc.toPixel(this.points[0]), B = rc.toPixel(this.points[1]);
      applyLine(ctx, s.medianColor, 1, 0);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      return;
    }
    const f = this.rays(rc);
    if (!f || !f.rays.length) return;
    const { A, rays } = f;
    const L = 2 * (rc.width + rc.height) + 4000;
    const far = (u: PixelPoint): PixelPoint => ({ x: A.x + u.x * L, y: A.y + u.y * L });
    if (s.fillBackground) {
      const alpha = alphaOf(s.transparency);
      for (let i = 1; i < rays.length; i++) {
        const outer = Math.abs(rays[i - 1].k) > Math.abs(rays[i].k) ? rays[i - 1] : rays[i];
        if (!outer.l) continue;
        const p = far(rays[i - 1].unit), q = far(rays[i].unit);
        ctx.fillStyle = withAlpha(outer.color, alpha);
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.closePath(); ctx.fill();
      }
    }
    for (const r of rays) {
      if (r.l) applyLine(ctx, r.color, s.lineWidth, s.lineStyle);
      else { if (!s.medianVisible) continue; applyLine(ctx, s.medianColor, s.medianWidth, s.medianStyle); }
      drawExtendedLine(rc, A, { x: A.x + r.unit.x, y: A.y + r.unit.y }, false, true);
    }
    if (s.showLabels || s.showPrices) {
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      const font = fontFor(rc, 11);
      for (const r of rays) {
        if (!r.l && !s.medianVisible) continue;
        if (s.showPrices) drawPriceBox(rc, r.through, r.color);
        if (s.showLabels && r.l) {
          const pos = rayLabelPos(rc, A, r.unit, false);
          if (pos) drawTextBox(ctx, fmtCoeff(r.l.coeff), pos.x, pos.y, { font, color: r.color, align: pos.align, vAlign: pos.vAlign, padding: 2 });
        }
      }
    }
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    if (this.points.length < 2) return null;
    const hit = hitHandle(this.handles(rc), x, y);
    if (hit) return hit;
    if (this.points.length < 3) {
      const A = rc.toPixel(this.points[0]), B = rc.toPixel(this.points[1]);
      return distToSegment(x, y, A.x, A.y, B.x, B.y) <= HIT_TOLERANCE ? { type: 'body' } : null;
    }
    const f = this.rays(rc);
    if (!f) return null;
    for (const r of f.rays) {
      if (!r.l && !this.style.medianVisible) continue;
      if (distToRay(x, y, f.A.x, f.A.y, f.A.x + r.unit.x, f.A.y + r.unit.y) <= HIT_TOLERANCE) return { type: 'body' };
    }
    return null;
  }
}

export const pitchforkTools = [Pitchfork, SchiffPitchfork, ModifiedSchiffPitchfork, InsidePitchfork, Pitchfan];
