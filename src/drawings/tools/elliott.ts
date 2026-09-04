import { Drawing, P, type DrawingRenderContext, type HitTarget, type PropertyDef, type PixelPoint, HIT_TOLERANCE } from '../Drawing';
import { applyLine, fontFor } from './common';
import { distToSegment } from '../../util/math';
import { labelSides } from './patterns';

/** TradingView's 15 wave degrees, largest → smallest (index = `degree` style value; default 7 = Intermediate). */
export const ELLIOTT_DEGREES = [
  'Supermillennium', 'Millennium', 'Submillennium', 'Grand Supercycle', 'Supercycle', 'Cycle', 'Primary',
  'Intermediate', 'Minor', 'Minute', 'Minuette', 'Subminuette', 'Micro', 'Submicro', 'Minuscule',
];

type Wrap = 'dbracket' | 'bracket' | 'dparen' | 'circle' | 'paren' | 'none';
type Numeral = 'romanUpper' | 'romanLower' | 'arabic';
interface Notation { wrap: Wrap; numeral: Numeral; lower: boolean }

/**
 * Label notation per degree. The middle nine follow standard Elliott notation (spec §H.7); the three
 * largest and three smallest degrees use bracket/double-paren variants (TV's exact glyphs are undocumented).
 */
const NOTATIONS: Notation[] = [
  { wrap: 'dbracket', numeral: 'romanUpper', lower: false }, // Supermillennium  [[I]]
  { wrap: 'bracket', numeral: 'romanUpper', lower: false },  // Millennium       [I]
  { wrap: 'dparen', numeral: 'romanUpper', lower: false },   // Submillennium    ((I))
  { wrap: 'circle', numeral: 'romanUpper', lower: false },   // Grand Supercycle Ⓘ
  { wrap: 'paren', numeral: 'romanUpper', lower: false },    // Supercycle       (I)
  { wrap: 'none', numeral: 'romanUpper', lower: false },     // Cycle            I
  { wrap: 'circle', numeral: 'arabic', lower: false },       // Primary          ①
  { wrap: 'paren', numeral: 'arabic', lower: false },        // Intermediate     (1)
  { wrap: 'none', numeral: 'arabic', lower: false },         // Minor            1
  { wrap: 'circle', numeral: 'romanLower', lower: true },    // Minute           ⓘ
  { wrap: 'paren', numeral: 'romanLower', lower: true },     // Minuette         (i)
  { wrap: 'none', numeral: 'romanLower', lower: true },      // Subminuette      i
  { wrap: 'dparen', numeral: 'arabic', lower: true },        // Micro            ((1))
  { wrap: 'bracket', numeral: 'arabic', lower: true },       // Submicro         [1]
  { wrap: 'dbracket', numeral: 'arabic', lower: true },      // Minuscule        [[1]]
];
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

export interface ElliottLabel { text: string; circled: boolean }

/** Format a raw wave label ('0'…'5', 'A'…'E', 'W','X','Y','Z') in the notation of a degree. */
export function elliottLabel(raw: string, degree: number): ElliottLabel {
  const d = Math.round(Number(degree));
  const n = NOTATIONS[Math.max(0, Math.min(NOTATIONS.length - 1, Number.isFinite(d) ? d : 7))];
  let t = String(raw ?? '');
  if (/^\d$/.test(t)) {
    const v = Number(t);
    if (v > 0 && n.numeral !== 'arabic') t = n.numeral === 'romanUpper' ? ROMAN[v] : ROMAN[v].toLowerCase();
  } else t = n.lower ? t.toLowerCase() : t.toUpperCase();
  switch (n.wrap) {
    case 'paren': return { text: `(${t})`, circled: false };
    case 'dparen': return { text: `((${t}))`, circled: false };
    case 'bracket': return { text: `[${t}]`, circled: false };
    case 'dbracket': return { text: `[[${t}]]`, circled: false };
    case 'circle': return { text: t, circled: true };
    default: return { text: t, circled: false };
  }
}

const DEGREE_OPTIONS = ELLIOTT_DEGREES.map((label, value) => ({ value, label }));

abstract class ElliottWave extends Drawing {
  static override group = 'patterns' as const;

  /** Raw labels per point (before degree notation). */
  abstract waveLabels(): string[];
  protected waveColor(): string { return '#3D85C6'; }

  defaultStyle(): Record<string, any> {
    return { color: this.waveColor(), lineWidth: 2, lineStyle: 0, degree: 7, showWave: true, fontSize: 12, bold: false, italic: false };
  }
  propertyDefs(): PropertyDef[] {
    return [
      P.color('color', 'Color'), P.lineWidth('lineWidth'), P.lineStyle('lineStyle'),
      P.select('degree', 'Degree', DEGREE_OPTIONS), P.bool('showWave', 'Show wave'),
      P.fontSize('fontSize'), P.bool('bold', 'Bold', 'Text'), P.bool('italic', 'Italic', 'Text'),
    ];
  }

  /** Labels in the notation of the selected degree. */
  labelTexts(): ElliottLabel[] { return this.waveLabels().map((l) => elliottLabel(l, this.style.degree)); }

  private _pixels(rc: DrawingRenderContext): PixelPoint[] {
    return this.points.map((p) => rc.toPixel(p)).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }

  render(rc: DrawingRenderContext): void {
    const px = this._pixels(rc);
    if (!px.length) return;
    const { ctx } = rc;
    const s = this.style;
    if (s.showWave && px.length > 1) {
      applyLine(ctx, s.color, s.lineWidth, s.lineStyle);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(px[0].x, px[0].y);
      for (let i = 1; i < px.length; i++) ctx.lineTo(px[i].x, px[i].y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const labels = this.labelTexts();
    const sides = labelSides(px);
    const fs = s.fontSize || 12;
    ctx.font = fontFor(rc, fs, !!s.bold, !!s.italic);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < px.length && i < labels.length; i++) {
      const tw = ctx.measureText(labels[i].text).width;
      const r = Math.max(tw, fs) / 2 + 3;
      const cy = sides[i] === 'above' ? px[i].y - (r + 4) : px[i].y + (r + 4);
      ctx.fillStyle = s.color;
      ctx.fillText(labels[i].text, px[i].x, cy + 0.5);
      if (labels[i].circled) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px[i].x, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  override hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const px = this._pixels(rc);
    for (let i = 0; i < px.length; i++) if (Math.hypot(px[i].x - x, px[i].y - y) <= 7) return { type: 'point', index: i };
    const tol = HIT_TOLERANCE + (this.style.lineWidth || 1) / 2;
    for (let i = 1; i < px.length; i++) if (distToSegment(x, y, px[i - 1].x, px[i - 1].y, px[i].x, px[i].y) <= tol) return { type: 'body' };
    return null;
  }
}

export class ElliottImpulseWave extends ElliottWave {
  static override toolId = 'elliott_impulse_wave';
  static override toolName = 'Elliott Impulse Wave (12345)';
  static override pointsCount = 6;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M2.6 24.5l4-9 .9.4-4 9zM6.6 15.9l3 4 .8-.6-3-4zM9.6 19.5l5-14 .9.3-5 14zM14.6 5.8l3 6 .9-.5-3-6zM17.6 11.5l7-8 .8.7-7 8z"/></svg>';
  waveLabels(): string[] { return ['0', '1', '2', '3', '4', '5']; }
}

export class ElliottCorrectionWave extends ElliottWave {
  static override toolId = 'elliott_correction_wave';
  static override toolName = 'Elliott Correction Wave (ABC)';
  static override pointsCount = 4;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M3.6 4.5l6 12 .9-.4-6-12zM9.6 16.1l4-6 .8.6-4 6zM13.6 10.5l9 13 .8-.6-9-13z"/></svg>';
  waveLabels(): string[] { return ['0', 'A', 'B', 'C']; }
}

export class ElliottTriangleWave extends ElliottWave {
  static override toolId = 'elliott_triangle_wave';
  static override toolName = 'Elliott Triangle Wave (ABCDE)';
  static override pointsCount = 6;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M2.6 22.5l4-16 .9.3-4 16zM6.6 6.8l4 14 .9-.3-4-14zM10.6 20.5l4-12 .9.4-4 12zM14.6 8.8l4 10 .9-.4-4-10zM18.6 18.5l3-7 .9.4-3 7zM21.6 11.8l3 5 .8-.5-3-5z"/></svg>';
  protected override waveColor(): string { return '#FF9800'; }
  waveLabels(): string[] { return ['0', 'A', 'B', 'C', 'D', 'E']; }
}

export class ElliottDoubleComboWave extends ElliottWave {
  static override toolId = 'elliott_double_combo_wave';
  static override toolName = 'Elliott Double Combo Wave (WXY)';
  static override pointsCount = 4;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M3.6 22.5l6-14 .9.4-6 14zM9.6 8.9l5 8 .8-.5-5-8zM14.6 16.5l9-12 .8.6-9 12z"/></svg>';
  protected override waveColor(): string { return '#6AA84F'; }
  waveLabels(): string[] { return ['0', 'W', 'X', 'Y']; }
}

export class ElliottTripleComboWave extends ElliottWave {
  static override toolId = 'elliott_triple_combo_wave';
  static override toolName = 'Elliott Triple Combo Wave (WXYXZ)';
  static override pointsCount = 6;
  static override icon = '<svg viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" d="M2.6 23.5l4-11 .9.4-4 11zM6.6 12.9l3 5 .8-.5-3-5zM9.6 17.5l4-10 .9.4-4 10zM13.6 7.9l3 6 .9-.5-3-6zM16.6 13.5l4-8 .9.4-4 8zM20.6 5.9l4 7 .9-.5-4-7z"/></svg>';
  protected override waveColor(): string { return '#6AA84F'; }
  waveLabels(): string[] { return ['0', 'W', 'X', 'Y', 'X', 'Z']; }
}

export const elliottTools = [ElliottImpulseWave, ElliottCorrectionWave, ElliottTriangleWave, ElliottDoubleComboWave, ElliottTripleComboWave];
