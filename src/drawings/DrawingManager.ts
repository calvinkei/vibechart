import type { ChartModel } from '../core/ChartModel';
import type { Pane } from '../core/Pane';
import { Drawing, getDrawingTool, deserializeDrawing, type DrawingPoint, type DrawingRenderContext, type HitTarget, type SerializedDrawing, type ScaleContext, type DrawingCtor } from './Drawing';
import { Delegate } from '../util/events';
import type { PriceScale } from '../core/PriceScale';

export interface DrawingHit { drawing: Drawing; target: HitTarget }

export interface PointerInfo {
  x: number;
  y: number;
  paneId: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  button: number;
}

type DragState =
  | { kind: 'point'; drawing: Drawing; index: number; startPoints: DrawingPoint[] }
  | { kind: 'body'; drawing: Drawing; startX: number; startY: number; startPoints: DrawingPoint[]; startIndex: number; startPrice: number }
  | null;

/**
 * DrawingManager: owns drawings, tool creation state machine, selection/hover, dragging,
 * magnet snapping, keyboard shortcuts, clipboard and undo/redo.
 */
export class DrawingManager {
  drawings: Drawing[] = [];
  selected: Drawing | null = null;
  hovered: Drawing | null = null;
  hoverTarget: HitTarget = null;
  activeTool: string | null = null;
  creating: Drawing | null = null;
  /** magnet mode */
  get magnet(): 'none' | 'weak' | 'strong' { return this.model.options.drawing.magnet; }
  set magnet(m: 'none' | 'weak' | 'strong') { this.model.options.drawing.magnet = m; this.changed.fire(); }
  get stayInDrawingMode(): boolean { return this.model.options.drawing.stayInDrawingMode; }
  set stayInDrawingMode(v: boolean) { this.model.options.drawing.stayInDrawingMode = v; this.changed.fire(); }
  get lockAll(): boolean { return this.model.options.drawing.lockAll; }
  get hideAll(): boolean { return this.model.options.drawing.hideAll; }

  readonly changed = new Delegate<void>();
  readonly selectionChanged = new Delegate<Drawing | null>();
  readonly toolChanged = new Delegate<string | null>();
  readonly editRequested = new Delegate<Drawing>();
  readonly created = new Delegate<Drawing>();
  readonly removed = new Delegate<Drawing>();
  readonly contextMenuRequested = new Delegate<{ drawing: Drawing; x: number; y: number }>();

  private _drag: DragState = null;
  private _undo: string[] = [];
  private _redo: string[] = [];
  private _clipboard: SerializedDrawing | null = null;
  get clipboard(): SerializedDrawing | null { return this._clipboard; }
  /** Copy the selected drawing to the internal clipboard (Ctrl/Cmd+C). */
  copySelected(): boolean { if (!this.selected) return false; this._clipboard = this.selected.serialize(); return true; }
  private _lastPointer: PointerInfo | null = null;
  private _pressPos: { x: number; y: number } | null = null;
  private _moved = false;
  private _freehandActive = false;

  constructor(readonly model: ChartModel) {}

  // ---- coordinate helpers ---------------------------------------------------
  private _pane(paneId: string): Pane | undefined { return this.model.getPane(paneId); }

  /** Primary price scale for a pane (the one drawings anchor to). */
  scaleFor(paneId: string): PriceScale | null {
    const pane = this._pane(paneId);
    return pane ? pane.mainScale : null;
  }

  pointAt(x: number, y: number, paneId: string, applyMagnet = true): DrawingPoint {
    const ts = this.model.timeScale;
    const ps = this.scaleFor(paneId);
    const idx = ts.xToIndex(x) - 0.5;
    let time = ts.indexToTime(idx);
    let price = ps ? ps.yToPrice(y) : 0;
    if (applyMagnet && this.magnet !== 'none' && paneId === 'main' && ps) {
      const bi = Math.round(idx);
      const bar = this.model.bars[bi];
      if (bar) {
        const candidates = [bar.open, bar.high, bar.low, bar.close];
        let best = price;
        let bestD = Infinity;
        for (const c of candidates) {
          const d = Math.abs(ps.priceToY(c) - y);
          if (d < bestD) { bestD = d; best = c; }
        }
        const threshold = this.magnet === 'strong' ? Infinity : 12;
        if (bestD <= threshold) {
          price = best;
          time = ts.indexToTime(bi);
        }
      }
    }
    return { time, price };
  }

  scaleContext(paneId: string): ScaleContext {
    const pane = this._pane(paneId);
    return { timeScale: this.model.timeScale, priceScale: pane ? pane.mainScale : null, paneHeight: pane?.height ?? 0, paneWidth: this.model.timeScale.width };
  }

  renderContext(ctx: CanvasRenderingContext2D, paneId: string, width: number, height: number, dpr: number, font: string, drawing: Drawing | null, creating = false): DrawingRenderContext | null {
    const ps = this.scaleFor(paneId);
    if (!ps) return null;
    const ts = this.model.timeScale;
    const model = this.model;
    return {
      ctx, timeScale: ts, priceScale: ps, width, height, dpr, options: model.options,
      toPixel: (p) => ({ x: ts.timeToX(p.time), y: ps.priceToY(p.price) }),
      fromPixel: (x, y) => ({ time: ts.xToTime(x), price: ps.yToPrice(y) }),
      priceFormat: model.mainSeries.priceFormat,
      mainSeries: model.mainSeries,
      selected: drawing === this.selected && drawing !== null,
      hovered: drawing === this.hovered && drawing !== null,
      creating,
      font,
      fontFamily: model.options.layout.fontFamily,
      theme: model.options.theme,
      paneId,
    };
  }

  // ---- rendering ---------------------------------------------------------------
  /** Draw all completed drawings of a pane. */
  renderPane(ctx: CanvasRenderingContext2D, paneId: string, width: number, height: number, dpr: number, font: string): void {
    if (this.hideAll) return;
    const resSec = this.model.resolutionSeconds();
    for (const d of this.drawings) {
      if (d.paneId !== paneId || !d.visible || d === this.creating) continue;
      if (!d.visibleFor(resSec)) continue;
      const rc = this.renderContext(ctx, paneId, width, height, dpr, font, d);
      if (!rc) continue;
      ctx.save();
      try { d.render(rc); } catch (e) { console.error('[openchart] drawing render failed', e); }
      ctx.restore();
    }
  }

  /** Draw the in-progress drawing and selection handles (top layer). */
  renderOverlay(ctx: CanvasRenderingContext2D, paneId: string, width: number, height: number, dpr: number, font: string): void {
    if (this.creating && this.creating.paneId === paneId) {
      const rc = this.renderContext(ctx, paneId, width, height, dpr, font, this.creating, true);
      if (rc) {
        ctx.save();
        try { this.creating.render(rc); this.creating.renderHandles(rc); } catch (e) { console.error(e); }
        ctx.restore();
      }
    }
    const sel = this.selected;
    if (sel && sel.paneId === paneId && sel.visible && !this.hideAll) {
      const rc = this.renderContext(ctx, paneId, width, height, dpr, font, sel);
      if (rc) { ctx.save(); sel.renderHandles(rc); ctx.restore(); }
    } else if (this.hovered && this.hovered !== sel && this.hovered.paneId === paneId && this.hovered.visible && !this.hideAll) {
      const rc = this.renderContext(ctx, paneId, width, height, dpr, font, this.hovered);
      if (rc) { ctx.save(); ctx.globalAlpha = 0.6; this.hovered.renderHandles(rc); ctx.restore(); }
    }
  }

  // ---- tool state ---------------------------------------------------------------
  setTool(toolId: string | null): void {
    if (this.creating) this.cancelCreation();
    this.activeTool = toolId;
    this.toolChanged.fire(toolId);
    this.model.invalidate('cursor');
  }

  cancelCreation(): void {
    if (this.creating) {
      this.creating = null;
      this.model.invalidate('cursor');
    }
    this._freehandActive = false;
  }

  private _finishCreation(): void {
    const d = this.creating;
    if (!d) return;
    d.creating = false;
    this.creating = null;
    this._pushUndo();
    this.drawings.push(d);
    d.zIndex = this.drawings.length;
    d.onChanged();
    this.created.fire(d);
    this.changed.fire();
    this.select(d);
    if (!this.stayInDrawingMode) this.setTool(null);
    this.model.invalidate('full');
  }

  hitTest(x: number, y: number, paneId: string): DrawingHit | null {
    if (this.hideAll) return null;
    const rc = this._rcFor(paneId);
    if (!rc) return null;
    const resSec = this.model.resolutionSeconds();
    // top-most first
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (d.paneId !== paneId || !d.visible || !d.visibleFor(resSec)) continue;
      const t = d.hitTest(x, y, rc);
      if (t) return { drawing: d, target: t };
    }
    return null;
  }

  private _measureCtx: CanvasRenderingContext2D | null = null;
  private _rcFor(paneId: string): DrawingRenderContext | null {
    if (!this._measureCtx) this._measureCtx = document.createElement('canvas').getContext('2d');
    if (!this._measureCtx) return null;
    return this.renderContext(this._measureCtx, paneId, this.model.timeScale.width, this._pane(paneId)?.height ?? 0, 1, '12px sans-serif', null);
  }

  // ---- pointer handlers (return true if consumed) ---------------------------------------
  onPointerDown(p: PointerInfo): boolean {
    this._lastPointer = p;
    this._pressPos = { x: p.x, y: p.y };
    this._moved = false;
    if (p.button === 2) {
      const hit = this.hitTest(p.x, p.y, p.paneId);
      if (hit) { this.select(hit.drawing); this.contextMenuRequested.fire({ drawing: hit.drawing, x: p.x, y: p.y }); return true; }
      return false;
    }
    if (this.activeTool) {
      return this._handleToolClick(p);
    }
    const hit = this.hitTest(p.x, p.y, p.paneId);
    if (hit) {
      this.select(hit.drawing);
      if (!hit.drawing.locked && !this.lockAll) {
        const start = hit.drawing.points.map((q) => ({ ...q }));
        if (hit.target && hit.target.type === 'point') this._drag = { kind: 'point', drawing: hit.drawing, index: hit.target.index, startPoints: start };
        else {
          const pt = this.pointAt(p.x, p.y, p.paneId, false);
          this._drag = { kind: 'body', drawing: hit.drawing, startX: p.x, startY: p.y, startPoints: start, startIndex: this.model.timeScale.timeToIndex(pt.time), startPrice: pt.price };
        }
      }
      return true;
    }
    if (this.selected) this.select(null);
    return false;
  }

  private _handleToolClick(p: PointerInfo): boolean {
    const ctor = getDrawingTool(this.activeTool!);
    if (!ctor) { this.setTool(null); return false; }
    const point = this.pointAt(p.x, p.y, p.paneId, true);
    if (!this.creating) {
      const d = new ctor(this._defaultStyleFor(ctor));
      d.creating = true;
      d.paneId = p.paneId;
      this.creating = d;
      const done = d.addPoint(point, this.scaleContext(p.paneId));
      if (ctor.pointsCount === 0) {
        // freehand: keep adding points on move until mouse up
        this._freehandActive = true;
        return true;
      }
      if (done) { this._finishCreation(); return true; }
      // add a pending point that follows the mouse
      d.addPoint({ ...point }, this.scaleContext(p.paneId));
      this.model.invalidate('cursor');
      return true;
    }
    // subsequent click confirms the pending point
    const d = this.creating;
    d.updatePendingPoint(this._constrained(point, p), this.scaleContext(p.paneId));
    if (d.isComplete()) { this._finishCreation(); return true; }
    d.addPoint({ ...point }, this.scaleContext(p.paneId));
    this.model.invalidate('cursor');
    return true;
  }

  /**
   * Style overrides applied to new drawings: only the chart-level defaults the user changed from the
   * built-in defaults (so every tool keeps its TradingView colours), plus saved per-tool templates.
   */
  private _defaultStyleFor(ctor: DrawingCtor): Record<string, any> {
    const o = this.model.options.drawing;
    const out: Record<string, any> = {};
    const probe = new ctor().defaultStyle();
    if (o.defaultLineColor !== '#2962FF' && 'lineColor' in probe) out.lineColor = o.defaultLineColor;
    if (o.defaultLineWidth !== 2 && 'lineWidth' in probe) out.lineWidth = o.defaultLineWidth;
    if (o.defaultTextColor !== '#2962FF' && 'textColor' in probe) out.textColor = o.defaultTextColor;
    const tpl = this.templates.get(ctor.toolId);
    if (tpl) Object.assign(out, tpl);
    return out;
  }

  /** Per-tool default style templates (toolId -> style patch). */
  readonly templates = new Map<string, Record<string, any>>();
  setTemplate(toolId: string, style: Record<string, any> | null): void {
    if (style) this.templates.set(toolId, { ...style }); else this.templates.delete(toolId);
  }

  /** Shift-constrain the pending point to 45° increments relative to the previous point. */
  private _constrained(point: DrawingPoint, p: PointerInfo): DrawingPoint {
    const d = this.creating;
    if (!d || !p.shiftKey || d.points.length < 2) return point;
    const rc = this._rcFor(p.paneId);
    if (!rc) return point;
    const prev = rc.toPixel(d.points[d.points.length - 2]);
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const ang = Math.atan2(dy, dx);
    const snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = prev.x + Math.cos(snapped) * len;
    const ny = prev.y + Math.sin(snapped) * len;
    return rc.fromPixel(nx, ny);
  }

  onPointerMove(p: PointerInfo): boolean {
    this._lastPointer = p;
    if (this._pressPos && (Math.abs(p.x - this._pressPos.x) > 2 || Math.abs(p.y - this._pressPos.y) > 2)) this._moved = true;
    if (this.creating) {
      const d = this.creating;
      if (this._freehandActive) {
        d.addPoint(this.pointAt(p.x, p.y, p.paneId, false), this.scaleContext(p.paneId));
      } else {
        d.updatePendingPoint(this._constrained(this.pointAt(p.x, p.y, p.paneId, true), p), this.scaleContext(p.paneId));
      }
      this.model.invalidate('cursor');
      return true;
    }
    if (this._drag) {
      const dr = this._drag;
      if (dr.kind === 'point') {
        dr.drawing.movePoint(dr.index, this.pointAt(p.x, p.y, dr.drawing.paneId, true), this.scaleContext(dr.drawing.paneId));
      } else {
        const ts = this.model.timeScale;
        const pt = this.pointAt(p.x, p.y, dr.drawing.paneId, false);
        const dIndex = ts.timeToIndex(pt.time) - dr.startIndex;
        const dPrice = pt.price - dr.startPrice;
        dr.drawing.points = dr.startPoints.map((q) => ({ time: ts.indexToTime(ts.timeToIndex(q.time) + dIndex), price: q.price + dPrice }));
      }
      dr.drawing.onChanged();
      this.changed.fire();
      this.model.invalidate('full');
      return true;
    }
    if (this.activeTool) return true;
    // hover
    const hit = this.hitTest(p.x, p.y, p.paneId);
    const newHovered = hit ? hit.drawing : null;
    if (newHovered !== this.hovered || (hit?.target?.type !== this.hoverTarget?.type)) {
      this.hovered = newHovered;
      this.hoverTarget = hit ? hit.target : null;
      this.model.invalidate('cursor');
    }
    return !!hit;
  }

  onPointerUp(p: PointerInfo): boolean {
    this._lastPointer = p;
    if (this._freehandActive && this.creating) {
      this._freehandActive = false;
      if (this.creating.points.length < 2) { this.cancelCreation(); return true; }
      this._finishCreation();
      return true;
    }
    if (this._drag) {
      if (this._moved) this._pushUndoBefore(this._drag.drawing, this._drag.startPoints);
      this._drag = null;
      this._pressPos = null;
      return true;
    }
    this._pressPos = null;
    return false;
  }

  onDoubleClick(p: PointerInfo): boolean {
    if (this.creating) {
      // polyline/path tools finish on double click
      const d = this.creating;
      if (d.requiredPoints === 0 || !d.isComplete()) {
        // drop the pending duplicate point
        if (d.points.length > 1) d.points.pop();
        if (d.points.length >= 2) this._finishCreation();
        else this.cancelCreation();
        return true;
      }
    }
    const hit = this.hitTest(p.x, p.y, p.paneId);
    if (hit) { this.select(hit.drawing); this.editRequested.fire(hit.drawing); return true; }
    return false;
  }

  onKeyDown(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (this.creating) { this.cancelCreation(); return true; }
      if (this.activeTool) { this.setTool(null); return true; }
      if (this.selected) { this.select(null); return true; }
      return false;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      if (!this.selected.locked) this.remove(this.selected);
      return true;
    }
    if (mod && e.key.toLowerCase() === 'z') { if (e.shiftKey) this.redo(); else this.undo(); return true; }
    if (mod && e.key.toLowerCase() === 'y') { this.redo(); return true; }
    if (mod && e.key.toLowerCase() === 'c' && this.selected) { this._clipboard = this.selected.serialize(); return true; }
    if (mod && e.key.toLowerCase() === 'v' && this._clipboard) { this.paste(); return true; }
    if (mod && e.key.toLowerCase() === 'a') { return false; }
    if (this.selected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && !this.selected.locked) {
      const ts = this.model.timeScale;
      const ps = this.scaleFor(this.selected.paneId);
      const step = e.shiftKey ? 10 : 1;
      let dIndex = 0, dPrice = 0;
      if (e.key === 'ArrowLeft') dIndex = -step;
      if (e.key === 'ArrowRight') dIndex = step;
      if (ps && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const y0 = ps.priceToY(this.selected.points[0]?.price ?? 0);
        const y1 = y0 + (e.key === 'ArrowUp' ? -step : step);
        dPrice = ps.yToPrice(y1) - ps.yToPrice(y0);
      }
      this._pushUndo();
      this.selected.moveBy(dIndex, dPrice, ts);
      this.selected.onChanged();
      this.changed.fire();
      this.model.invalidate('full');
      return true;
    }
    return false;
  }

  // ---- selection / mutation ----------------------------------------------------------
  select(d: Drawing | null): void {
    if (this.selected === d) return;
    this.selected = d;
    this.selectionChanged.fire(d);
    this.model.invalidate('cursor');
  }

  add(d: Drawing, opts: { select?: boolean; undo?: boolean } = {}): Drawing {
    if (opts.undo !== false) this._pushUndo();
    d.creating = false;
    this.drawings.push(d);
    d.zIndex = this.drawings.length;
    d.onChanged();
    this.created.fire(d);
    this.changed.fire();
    if (opts.select) this.select(d);
    this.model.invalidate('full');
    return d;
  }

  remove(d: Drawing, undo = true): void {
    const i = this.drawings.indexOf(d);
    if (i < 0) return;
    if (undo) this._pushUndo();
    this.drawings.splice(i, 1);
    if (this.selected === d) this.select(null);
    if (this.hovered === d) this.hovered = null;
    this.removed.fire(d);
    this.changed.fire();
    this.model.invalidate('full');
  }

  removeAll(): void {
    if (this.drawings.length === 0) return;
    this._pushUndo();
    const all = this.drawings.slice();
    this.drawings = [];
    this.select(null);
    for (const d of all) this.removed.fire(d);
    this.changed.fire();
    this.model.invalidate('full');
  }

  getById(id: string): Drawing | undefined { return this.drawings.find((d) => d.id === id); }

  clone(d: Drawing): Drawing | null {
    const s = d.serialize();
    s.id = '';
    const copy = deserializeDrawing({ ...s, id: undefined as any });
    if (!copy) return null;
    // offset a bit
    copy.moveBy(5, 0, this.model.timeScale);
    copy.name = d.name ? `${d.name} copy` : '';
    return this.add(copy, { select: true });
  }

  paste(): void {
    if (!this._clipboard) return;
    const copy = deserializeDrawing({ ...this._clipboard, id: undefined as any });
    if (!copy) return;
    if (this._lastPointer) {
      // place at the pointer keeping shape
      const rc = this._rcFor(copy.paneId);
      if (rc && copy.points.length) {
        const first = rc.toPixel(copy.points[0]);
        const target = this.pointAt(this._lastPointer.x, this._lastPointer.y, copy.paneId, false);
        const ts = this.model.timeScale;
        const dIndex = ts.timeToIndex(target.time) - ts.timeToIndex(copy.points[0].time);
        const dPrice = target.price - copy.points[0].price;
        void first;
        copy.moveBy(dIndex, dPrice, ts);
      }
    } else copy.moveBy(5, 0, this.model.timeScale);
    this.add(copy, { select: true });
  }

  setLocked(d: Drawing, locked: boolean): void { d.locked = locked; this.changed.fire(); this.model.invalidate('cursor'); }
  setVisible(d: Drawing, visible: boolean): void { d.visible = visible; this.changed.fire(); this.model.invalidate('full'); }
  setLockAll(v: boolean): void { this.model.options.drawing.lockAll = v; this.changed.fire(); }
  setHideAll(v: boolean): void { this.model.options.drawing.hideAll = v; this.changed.fire(); this.model.invalidate('full'); }

  bringToFront(d: Drawing): void { this._reorder(d, this.drawings.length - 1); }
  sendToBack(d: Drawing): void { this._reorder(d, 0); }
  bringForward(d: Drawing): void { this._reorder(d, Math.min(this.drawings.length - 1, this.drawings.indexOf(d) + 1)); }
  sendBackward(d: Drawing): void { this._reorder(d, Math.max(0, this.drawings.indexOf(d) - 1)); }

  private _reorder(d: Drawing, to: number): void {
    const i = this.drawings.indexOf(d);
    if (i < 0) return;
    this._pushUndo();
    this.drawings.splice(i, 1);
    this.drawings.splice(to, 0, d);
    this.drawings.forEach((x, k) => (x.zIndex = k + 1));
    this.changed.fire();
    this.model.invalidate('full');
  }

  /** Update style properties and record undo. */
  updateStyle(d: Drawing, patch: Record<string, unknown>, recordUndo = true): void {
    if (recordUndo) this._pushUndo();
    Object.assign(d.style, patch);
    d.onChanged();
    this.changed.fire();
    this.model.invalidate('full');
  }

  updatePoints(d: Drawing, points: DrawingPoint[]): void {
    this._pushUndo();
    d.points = points.map((p) => ({ ...p }));
    d.onChanged();
    this.changed.fire();
    this.model.invalidate('full');
  }

  // ---- undo / redo ------------------------------------------------------------------------
  private _snapshot(): string { return JSON.stringify(this.drawings.map((d) => d.serialize())); }

  private _pushUndo(): void {
    this._undo.push(this._snapshot());
    if (this._undo.length > 100) this._undo.shift();
    this._redo = [];
  }

  private _pushUndoBefore(d: Drawing, startPoints: DrawingPoint[]): void {
    // record the state before the drag as an undo step
    const current = d.points;
    d.points = startPoints;
    const snap = this._snapshot();
    d.points = current;
    this._undo.push(snap);
    if (this._undo.length > 100) this._undo.shift();
    this._redo = [];
  }

  get canUndo(): boolean { return this._undo.length > 0; }
  get canRedo(): boolean { return this._redo.length > 0; }

  undo(): void {
    const snap = this._undo.pop();
    if (snap === undefined) return;
    this._redo.push(this._snapshot());
    this._restore(snap);
  }

  redo(): void {
    const snap = this._redo.pop();
    if (snap === undefined) return;
    this._undo.push(this._snapshot());
    this._restore(snap);
  }

  private _restore(snap: string): void {
    const list = JSON.parse(snap) as SerializedDrawing[];
    const selId = this.selected?.id;
    this.drawings = list.map((s) => deserializeDrawing(s)).filter((d): d is Drawing => !!d);
    this.selected = this.drawings.find((d) => d.id === selId) ?? null;
    this.hovered = null;
    this.selectionChanged.fire(this.selected);
    this.changed.fire();
    this.model.invalidate('full');
  }

  // ---- persistence ------------------------------------------------------------------------
  serialize(): SerializedDrawing[] { return this.drawings.map((d) => d.serialize()); }

  load(list: SerializedDrawing[]): void {
    this.drawings = list.map((s) => deserializeDrawing(s)).filter((d): d is Drawing => !!d);
    this.select(null);
    this.changed.fire();
    this.model.invalidate('full');
  }

  get isDragging(): boolean { return this._drag !== null; }
  get cursor(): string {
    if (this.activeTool) return 'crosshair';
    if (this._drag) return this._drag.kind === 'point' ? 'grabbing' : 'move';
    if (this.hovered) return this.hoverTarget?.type === 'point' ? 'grab' : 'pointer';
    return '';
  }
}
