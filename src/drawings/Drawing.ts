import type { TimeScale } from '../core/TimeScale';
import type { PriceScale } from '../core/PriceScale';
import type { ChartOptions, LineStyle, LineWidth } from '../core/options';
import type { PriceFormat } from '../data/types';
import type { MainSeries } from '../series/MainSeries';
import { uid, distToSegment } from '../util/math';

export interface DrawingPoint {
  time: number;
  price: number;
}

/** Pixel-space point (pane coordinates). */
export interface PixelPoint { x: number; y: number }

export interface DrawingRenderContext {
  ctx: CanvasRenderingContext2D;
  timeScale: TimeScale;
  priceScale: PriceScale;
  width: number;
  height: number;
  dpr: number;
  options: ChartOptions;
  /** convert a drawing point to pixels */
  toPixel(p: DrawingPoint): PixelPoint;
  /** convert pixels to a drawing point */
  fromPixel(x: number, y: number): DrawingPoint;
  priceFormat: PriceFormat;
  mainSeries: MainSeries;
  /** state flags */
  selected: boolean;
  hovered: boolean;
  /** true while the tool is being placed (preview) */
  creating: boolean;
  font: string;
  fontFamily: string;
  theme: 'light' | 'dark';
  /** pane id being rendered */
  paneId: string;
}

export type PropertyType = 'color' | 'lineWidth' | 'lineStyle' | 'bool' | 'number' | 'int' | 'text' | 'select' | 'fontSize' | 'textAlign' | 'fibLevels' | 'time' | 'price' | 'range' | 'section';

export interface PropertyDef {
  key: string;
  label: string;
  type: PropertyType;
  /** group/tab name: 'Style' | 'Text' | 'Coordinates' | 'Visibility' | custom */
  group?: string;
  options?: Array<{ value: string | number; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  /** show this property only when another boolean property is true */
  dependsOn?: string;
  /** render inline with previous property */
  inline?: boolean;
}

export interface FibLevel {
  coeff: number;
  color: string;
  visible: boolean;
}

export type HitTarget = { type: 'point'; index: number } | { type: 'body'; part?: string } | null;

export interface SerializedDrawing {
  id: string;
  type: string;
  points: DrawingPoint[];
  style: Record<string, unknown>;
  locked: boolean;
  visible: boolean;
  zIndex: number;
  paneId: string;
  name?: string;
  visibility?: DrawingVisibility;
}

export interface DrawingVisibility {
  /** whether the drawing is visible for intervals in these ranges (seconds) */
  seconds: boolean; secondsFrom: number; secondsTo: number;
  minutes: boolean; minutesFrom: number; minutesTo: number;
  hours: boolean; hoursFrom: number; hoursTo: number;
  days: boolean; daysFrom: number; daysTo: number;
  weeks: boolean; weeksFrom: number; weeksTo: number;
  months: boolean; monthsFrom: number; monthsTo: number;
  ranges: boolean;
}

export function defaultVisibility(): DrawingVisibility {
  return { seconds: true, secondsFrom: 1, secondsTo: 59, minutes: true, minutesFrom: 1, minutesTo: 59, hours: true, hoursFrom: 1, hoursTo: 24, days: true, daysFrom: 1, daysTo: 366, weeks: true, weeksFrom: 1, weeksTo: 52, months: true, monthsFrom: 1, monthsTo: 12, ranges: true };
}

export const HANDLE_RADIUS = 5;
export const HIT_TOLERANCE = 4;

/**
 * Base class for all drawing tools. Coordinates are stored as (time, price) so drawings
 * survive scrolling/zooming/resolution changes; rendering converts to pixels each frame.
 */
export abstract class Drawing {
  /** Tool id used in the toolbar/API, e.g. "trend_line". Subclasses override via static. */
  static toolId = 'drawing';
  static toolName = 'Drawing';
  /** Number of anchor points needed to create (0 => freehand / dynamic; use `isComplete`). */
  static pointsCount = 2;
  /** TradingView-like group name for the toolbar */
  static group: 'lines' | 'fib' | 'gann' | 'pitchfork' | 'shapes' | 'text' | 'patterns' | 'prediction' | 'measure' | 'cursor' | 'other' = 'other';
  /** Icon svg */
  static icon = '';

  readonly id: string;
  points: DrawingPoint[] = [];
  style: Record<string, any>;
  locked = false;
  visible = true;
  zIndex = 0;
  paneId = 'main';
  name = '';
  visibility: DrawingVisibility = defaultVisibility();
  /** Set while creating */
  creating = false;
  /** Cached pixel points from the last render */
  protected _px: PixelPoint[] = [];

  constructor(style: Record<string, any> = {}, id?: string) {
    this.id = id ?? uid('dr');
    this.style = { ...this.defaultStyle(), ...style };
  }

  get type(): string { return (this.constructor as typeof Drawing).toolId; }
  get typeName(): string { return (this.constructor as typeof Drawing).toolName; }
  get requiredPoints(): number { return (this.constructor as typeof Drawing).pointsCount; }

  /** Default style for the tool. */
  abstract defaultStyle(): Record<string, any>;
  /** Settings dialog schema. */
  abstract propertyDefs(): PropertyDef[];
  /** Draw the tool; `rc.toPixel` converts points. */
  abstract render(rc: DrawingRenderContext): void;

  /** Called during creation for each click; return true when creation is complete. */
  addPoint(p: DrawingPoint): boolean {
    this.points.push(p);
    return this.points.length >= this.requiredPoints;
  }

  /** Update the last (pending) point during creation mouse-move preview. */
  updatePendingPoint(p: DrawingPoint): void {
    if (this.points.length === 0) return;
    this.points[this.points.length - 1] = p;
  }

  /** Whether creation finished (for freehand/polyline tools this is decided by the tool). */
  isComplete(): boolean { return this.points.length >= this.requiredPoints; }

  /** Handles (draggable points) in pixels. Default: every anchor point. */
  handles(rc: DrawingRenderContext): Array<PixelPoint & { index: number }> {
    return this.points.map((p, i) => ({ ...rc.toPixel(p), index: i }));
  }

  /** Hit-test in pixel space; default tests handles then segments between consecutive points. */
  hitTest(x: number, y: number, rc: DrawingRenderContext): HitTarget {
    const px = this.points.map((p) => rc.toPixel(p));
    for (let i = 0; i < px.length; i++) {
      const dx = px[i].x - x, dy = px[i].y - y;
      if (dx * dx + dy * dy <= (HANDLE_RADIUS + 2) ** 2) return { type: 'point', index: i };
    }
    for (let i = 1; i < px.length; i++) {
      if (distToSegment(x, y, px[i - 1].x, px[i - 1].y, px[i].x, px[i].y) <= HIT_TOLERANCE) return { type: 'body' };
    }
    return null;
  }

  /** Move a single point (drag handle). */
  movePoint(index: number, p: DrawingPoint): void {
    if (this.points[index]) this.points[index] = p;
  }

  /** Move whole drawing by index/price deltas. */
  moveBy(dIndex: number, dPrice: number, ts: TimeScale): void {
    this.points = this.points.map((p) => ({ time: ts.indexToTime(ts.timeToIndex(p.time) + dIndex), price: p.price + dPrice }));
  }

  /** Bounding box in pixels (for selection / object tree). */
  bounds(rc: DrawingRenderContext): { x1: number; y1: number; x2: number; y2: number } | null {
    if (!this.points.length) return null;
    const px = this.points.map((p) => rc.toPixel(p));
    return { x1: Math.min(...px.map((p) => p.x)), y1: Math.min(...px.map((p) => p.y)), x2: Math.max(...px.map((p) => p.x)), y2: Math.max(...px.map((p) => p.y)) };
  }

  /** Called after a point/style change (recompute caches). */
  onChanged(): void {}

  /** Draw selection handles (default rendering). */
  renderHandles(rc: DrawingRenderContext): void {
    const { ctx } = rc;
    const hs = this.handles(rc);
    ctx.save();
    for (const h of hs) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = rc.theme === 'dark' ? '#131722' : '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#2962FF';
      ctx.stroke();
    }
    ctx.restore();
  }

  serialize(): SerializedDrawing {
    return {
      id: this.id,
      type: this.type,
      points: this.points.map((p) => ({ ...p })),
      style: JSON.parse(JSON.stringify(this.style)),
      locked: this.locked,
      visible: this.visible,
      zIndex: this.zIndex,
      paneId: this.paneId,
      name: this.name,
      visibility: { ...this.visibility },
    };
  }

  applySerialized(s: SerializedDrawing): void {
    this.points = s.points.map((p) => ({ ...p }));
    this.style = { ...this.defaultStyle(), ...s.style };
    this.locked = s.locked;
    this.visible = s.visible;
    this.zIndex = s.zIndex;
    this.paneId = s.paneId;
    this.name = s.name ?? '';
    if (s.visibility) this.visibility = { ...defaultVisibility(), ...s.visibility };
    this.onChanged();
  }

  /** Is the drawing visible for the given resolution seconds (Visibility tab)? */
  visibleFor(resSeconds: number, isRange = false): boolean {
    const v = this.visibility;
    if (isRange) return v.ranges;
    if (resSeconds < 60) return v.seconds && resSeconds >= v.secondsFrom && resSeconds <= v.secondsTo;
    if (resSeconds < 3600) { const m = resSeconds / 60; return v.minutes && m >= v.minutesFrom && m <= v.minutesTo; }
    if (resSeconds < 86400) { const h = resSeconds / 3600; return v.hours && h >= v.hoursFrom && h <= v.hoursTo; }
    if (resSeconds < 7 * 86400) { const d = resSeconds / 86400; return v.days && d >= v.daysFrom && d <= v.daysTo; }
    if (resSeconds < 28 * 86400) { const w = resSeconds / (7 * 86400); return v.weeks && w >= v.weeksFrom && w <= v.weeksTo; }
    const mo = resSeconds / (30 * 86400);
    return v.months && mo >= v.monthsFrom && mo <= v.monthsTo;
  }
}

/** Common style property definitions helpers. */
export const P = {
  color: (key: string, label: string, group = 'Style'): PropertyDef => ({ key, label, type: 'color', group }),
  lineWidth: (key: string, label = 'Line width', group = 'Style'): PropertyDef => ({ key, label, type: 'lineWidth', group }),
  lineStyle: (key: string, label = 'Line style', group = 'Style'): PropertyDef => ({ key, label, type: 'lineStyle', group }),
  bool: (key: string, label: string, group = 'Style'): PropertyDef => ({ key, label, type: 'bool', group }),
  number: (key: string, label: string, min?: number, max?: number, step?: number, group = 'Style'): PropertyDef => ({ key, label, type: 'number', min, max, step, group }),
  int: (key: string, label: string, min?: number, max?: number, group = 'Style'): PropertyDef => ({ key, label, type: 'int', min, max, group }),
  text: (key: string, label: string, group = 'Text'): PropertyDef => ({ key, label, type: 'text', group }),
  select: (key: string, label: string, options: Array<{ value: string | number; label: string }>, group = 'Style'): PropertyDef => ({ key, label, type: 'select', options, group }),
  fontSize: (key: string, label = 'Font size', group = 'Text'): PropertyDef => ({ key, label, type: 'fontSize', group }),
  section: (label: string, group = 'Style'): PropertyDef => ({ key: `__section_${label}`, label, type: 'section', group }),
};

export type { LineStyle, LineWidth };

// registry of drawing tool classes
export type DrawingCtor = (new (style?: Record<string, any>, id?: string) => Drawing) & typeof Drawing;
const toolRegistry = new Map<string, DrawingCtor>();

export function registerDrawingTool(ctor: DrawingCtor): void {
  toolRegistry.set(ctor.toolId, ctor);
}

export function getDrawingTool(toolId: string): DrawingCtor | undefined {
  return toolRegistry.get(toolId);
}

export function listDrawingTools(): DrawingCtor[] {
  return Array.from(toolRegistry.values());
}

export function deserializeDrawing(s: SerializedDrawing): Drawing | null {
  const ctor = toolRegistry.get(s.type);
  if (!ctor) return null;
  const d = new ctor({}, s.id);
  d.applySerialized(s);
  return d;
}
