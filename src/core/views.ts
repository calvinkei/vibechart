import { CanvasLayer, crisp, setLineStyle, drawLabelBox, measureText } from '../render/canvas';
import type { ChartModel } from './ChartModel';
import type { Pane } from './Pane';
import type { PriceScale } from './PriceScale';
import type { DrawingManager } from '../drawings/DrawingManager';
import type { RenderContext } from '../series/Series';
import { IndicatorInstance } from '../indicators/Indicator';
import { el } from '../util/dom';
import { parseResolution } from '../data/resolution';
import { contrastText } from '../util/color';

export interface ViewHost {
  model: ChartModel;
  drawings: DrawingManager;
  dpr: number;
  font: string;
  /** widths of the axis columns */
  axisWidths: { left: number; right: number };
  timeAxisHeight: number;
  /** callbacks from legend buttons */
  onLegendAction(action: 'settings' | 'hide' | 'remove' | 'moreMenu' | 'symbol', source: any, ev: MouseEvent): void;
  onPaneAction(action: 'up' | 'down' | 'collapse' | 'maximize' | 'remove', pane: Pane): void;
  isLoading(): boolean;
}

export const TIME_AXIS_HEIGHT = 28;
export const MIN_PRICE_AXIS_WIDTH = 56;

// ---------------------------------------------------------------------------------------------
// PaneView
// ---------------------------------------------------------------------------------------------
export class PaneView {
  readonly el: HTMLDivElement;
  readonly main = new CanvasLayer('vc-canvas-main');
  readonly top = new CanvasLayer('vc-canvas-top');
  readonly legendEl: HTMLDivElement;
  readonly buttonsEl: HTMLDivElement;
  width = 0;
  height = 0;
  private _legendKey = '';

  constructor(readonly host: ViewHost, readonly pane: Pane) {
    this.el = el('div', { class: 'vc-pane', 'data-pane': pane.id });
    this.el.appendChild(this.main.canvas);
    this.el.appendChild(this.top.canvas);
    this.legendEl = el('div', { class: 'vc-legend' });
    this.el.appendChild(this.legendEl);
    this.buttonsEl = el('div', { class: 'vc-pane-buttons' });
    this.el.appendChild(this.buttonsEl);
    this._buildPaneButtons();
  }

  private _buildPaneButtons(): void {
    const mk = (title: string, svg: string, action: 'up' | 'down' | 'collapse' | 'maximize' | 'remove') => {
      const b = el('button', { class: 'vc-pane-btn', title, html: svg });
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); this.host.onPaneAction(action, this.pane); });
      return b;
    };
    this.buttonsEl.appendChild(mk('Move pane up', '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 10l4-4 4 4" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>', 'up'));
    this.buttonsEl.appendChild(mk('Move pane down', '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 6l4 4 4-4" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>', 'down'));
    this.buttonsEl.appendChild(mk('Maximize pane', '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3h10v10H3z" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>', 'maximize'));
    this.buttonsEl.appendChild(mk('Collapse pane', '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 8h10" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>', 'collapse'));
    if (!this.pane.isMain) this.buttonsEl.appendChild(mk('Remove pane', '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>', 'remove'));
  }

  layout(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.el.style.height = `${height}px`;
    this.main.resize(width, height, this.host.dpr);
    this.top.resize(width, height, this.host.dpr);
    this.pane.setHeight(height);
  }

  private _renderContext(ctx: CanvasRenderingContext2D, ps: PriceScale): RenderContext | null {
    const m = this.host.model;
    const vb = m.timeScale.visibleBars();
    if (!vb) return null;
    return {
      ctx, timeScale: m.timeScale, priceScale: ps, width: this.width, height: this.height, dpr: this.host.dpr, visible: vb,
      options: m.options, font: this.host.font, crosshairIndex: m.crosshair.visible ? m.crosshair.index : null,
      ...( { mainBars: m.mainSeries.bars } as any ),
    };
  }

  renderMain(): void {
    const { ctx } = this.main;
    const m = this.host.model;
    const o = m.options;
    const w = this.width, h = this.height;
    const dpr = this.host.dpr;
    this.main.clear();
    // background
    if (o.layout.background.type === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, o.layout.background.topColor ?? o.layout.background.color);
      g.addColorStop(1, o.layout.background.bottomColor ?? o.layout.background.color);
      ctx.fillStyle = g;
    } else ctx.fillStyle = o.layout.background.color;
    ctx.fillRect(0, 0, w, h);
    // grid
    const ts = m.timeScale;
    const mainScale = this.pane.mainScale;
    if (o.grid.vertLines.visible) {
      ctx.save();
      ctx.strokeStyle = o.grid.vertLines.color;
      ctx.lineWidth = 1;
      setLineStyle(ctx, o.grid.vertLines.style);
      ctx.beginPath();
      for (const t of ts.ticks()) {
        const x = crisp(t.x, dpr);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (o.grid.horzLines.visible && !mainScale.isEmpty) {
      ctx.save();
      ctx.strokeStyle = o.grid.horzLines.color;
      ctx.lineWidth = 1;
      setLineStyle(ctx, o.grid.horzLines.style);
      ctx.beginPath();
      for (const t of mainScale.ticks()) {
        const y = crisp(t.y, dpr);
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      ctx.restore();
    }
    // session breaks
    if ((o.sessionBreaks || o.timeScale.sessionBreaks.visible) && this.pane.isMain) {
      const sb = o.timeScale.sessionBreaks;
      const vb = ts.visibleBars();
      if (vb) {
        ctx.save();
        ctx.strokeStyle = sb.color;
        ctx.lineWidth = sb.width;
        setLineStyle(ctx, sb.style, sb.width);
        ctx.beginPath();
        for (const idx of ts.sessionBreaks()) {
          if (idx < vb.from || idx > vb.to) continue;
          const x = crisp(ts.indexToX(idx), dpr);
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    // watermark
    if (this.pane.isMain && o.watermark.visible) this._renderWatermark(ctx);
    // sources
    for (const src of this.pane.sources) {
      if (!src.visible) continue;
      const ps = this.pane.getPriceScale(src.priceScaleId);
      if (ps.isEmpty) continue;
      const rc = this._renderContext(ctx, ps);
      if (!rc) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      try { src.render(rc); } catch (e) { console.error('[vibechart] render failed', e); }
      ctx.restore();
    }
    // price line of main series
    if (this.pane.isMain) {
      const rc = this._renderContext(ctx, mainScale);
      if (rc) m.mainSeries.renderPriceLine(rc);
      // high/low lines
      if (o.symbol.highLowLinesVisible) this._renderHighLowLines(ctx, mainScale);
    }
    // indicator track-price lines
    for (const src of this.pane.sources) {
      if (!(src instanceof IndicatorInstance) || !src.visible) continue;
      const ps = this.pane.getPriceScale(src.priceScaleId);
      for (const lab of src.axisLabels()) {
        if (!lab.line?.visible) continue;
        const y = crisp(ps.priceToY(lab.price), dpr);
        ctx.save();
        ctx.strokeStyle = lab.line.color;
        ctx.lineWidth = lab.line.width;
        setLineStyle(ctx, lab.line.style, lab.line.width);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        ctx.restore();
      }
    }
    // bar marks (datafeed getMarks)
    if (this.pane.isMain && m.marks.length && o.timeScale.marksVisible) this._renderBarMarks(ctx);
    // drawings
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    this.host.drawings.renderPane(ctx, this.pane.id, w, h, dpr, this.host.font);
    ctx.restore();
  }

  private _renderBarMarks(ctx: CanvasRenderingContext2D): void {
    const m = this.host.model;
    const ts = m.timeScale;
    const tr = ts.visibleTimeRange();
    if (!tr) return;
    ctx.save();
    ctx.font = `bold 10px ${m.options.layout.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const r = Math.max(6, Math.min(14, ts.barSpacing * 0.9));
    const y = this.height - r - 4;
    for (const mk of m.marks) {
      if (mk.time < tr.from || mk.time > tr.to) continue;
      const x = ts.timeToX(mk.time);
      const bg = typeof mk.color === 'string' ? mk.color : mk.color.background;
      const border = typeof mk.color === 'string' ? mk.color : mk.color.border;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(r, (mk.minSize || 0) / 2), 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.lineWidth = mk.borderWidth ?? 1;
      ctx.strokeStyle = border;
      ctx.stroke();
      if (mk.label && r >= 7) { ctx.fillStyle = mk.labelFontColor || '#fff'; ctx.fillText(mk.label, x, y + 0.5); }
    }
    ctx.restore();
  }

  private _renderHighLowLines(ctx: CanvasRenderingContext2D, ps: PriceScale): void {
    const m = this.host.model;
    const vb = m.timeScale.visibleBars();
    if (!vb) return;
    const r = m.mainSeries.priceRange(vb.from, vb.to);
    if (!r) return;
    ctx.save();
    ctx.strokeStyle = m.options.layout.textColor;
    ctx.globalAlpha = 0.4;
    setLineStyle(ctx, 1);
    for (const p of [r.min, r.max]) {
      const y = crisp(ps.priceToY(p), this.host.dpr);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.width, y); ctx.stroke();
    }
    ctx.restore();
  }

  private _renderWatermark(ctx: CanvasRenderingContext2D): void {
    const m = this.host.model;
    const o = m.options;
    const info = m.symbolInfo;
    if (!info && !o.watermark.text) return;
    const res = parseResolution(m.resolution);
    const text = o.watermark.text ?? (o.watermark.showInterval ? `${info?.name ?? ''}, ${res.label.toUpperCase()}` : info?.name ?? '');
    ctx.save();
    ctx.fillStyle = o.watermark.color;
    ctx.font = `bold ${o.watermark.fontSize}px ${o.layout.fontFamily}`;
    ctx.textAlign = o.watermark.horzAlign;
    ctx.textBaseline = 'middle';
    const x = o.watermark.horzAlign === 'left' ? 16 : o.watermark.horzAlign === 'right' ? this.width - 16 : this.width / 2;
    const y = o.watermark.vertAlign === 'top' ? o.watermark.fontSize : o.watermark.vertAlign === 'bottom' ? this.height - o.watermark.fontSize : this.height / 2;
    ctx.fillText(text, x, y);
    if (info?.description && o.watermark.showInterval) {
      ctx.font = `${Math.round(o.watermark.fontSize * 0.45)}px ${o.layout.fontFamily}`;
      ctx.fillText(info.description, x, y + o.watermark.fontSize * 0.75);
    }
    ctx.restore();
  }

  renderTop(): void {
    const { ctx } = this.top;
    const m = this.host.model;
    const o = m.options;
    const dpr = this.host.dpr;
    this.top.clear();
    const ch = m.crosshair;
    if (ch.visible && o.crosshair.mode !== 'hidden') {
      const x = crisp(m.timeScale.barCenterX(ch.index), dpr, o.crosshair.vertLine.width);
      if (o.crosshair.vertLine.visible) {
        ctx.save();
        ctx.strokeStyle = o.crosshair.vertLine.color;
        ctx.lineWidth = o.crosshair.vertLine.width;
        setLineStyle(ctx, o.crosshair.vertLine.style, o.crosshair.vertLine.width);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.height); ctx.stroke();
        ctx.restore();
      }
      if (ch.paneId === this.pane.id && o.crosshair.horzLine.visible) {
        const y = crisp(ch.y, dpr, o.crosshair.horzLine.width);
        ctx.save();
        ctx.strokeStyle = o.crosshair.horzLine.color;
        ctx.lineWidth = o.crosshair.horzLine.width;
        setLineStyle(ctx, o.crosshair.horzLine.style, o.crosshair.horzLine.width);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.width, y); ctx.stroke();
        ctx.restore();
      }
    }
    // drawing overlay (creation preview + selection handles)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);
    ctx.clip();
    this.host.drawings.renderOverlay(ctx, this.pane.id, this.width, this.height, dpr, this.host.font);
    ctx.restore();
  }

  // ---- legend (DOM) ---------------------------------------------------------------------
  updateLegend(): void {
    const m = this.host.model;
    const o = m.options.legend;
    if (!o.visible) { this.legendEl.style.display = 'none'; return; }
    this.legendEl.style.display = '';
    const idx = m.legendIndex();
    const parts: string[] = [];
    if (this.pane.isMain) {
      const info = m.symbolInfo;
      const res = parseResolution(m.resolution);
      const title = `${o.showSymbol ? esc(info?.name ?? m.mainSeries.title ?? '') : ''}${o.showSymbolDescription && info?.description ? ` <span class="vc-legend-desc">${esc(info.description)}</span>` : ''}${o.showInterval ? ` <span class="vc-legend-int">${esc(res.label.toUpperCase())}</span>` : ''}${o.showExchange && info?.exchange ? ` <span class="vc-legend-exch">${esc(info.exchange)}</span>` : ''}`;
      const items = o.showOHLC || o.showBarChange || o.showVolume ? m.mainSeries.legendItems(idx).filter((it) => (it.label === 'Vol' ? o.showVolume : it.label ? o.showOHLC : o.showBarChange)) : [];
      const loading = this.host.isLoading() ? '<span class="vc-legend-loading" title="Loading">⟳</span>' : '';
      parts.push(`<div class="vc-legend-row vc-legend-main" data-source="main"><span class="vc-legend-title" data-action="symbol">${title}</span>${loading}<span class="vc-legend-values">${items.map((it) => `<span class="vc-legend-item">${it.label ? `<span class="vc-legend-label">${it.label}</span>` : ''}<span class="vc-legend-value" style="color:${it.color ?? ''}">${esc(it.value)}</span></span>`).join('')}</span>${this._buttons('main', m.mainSeries.visible)}</div>`);
      if (m.options.volume.visible && !m.options.volume.overlay) { /* volume in a separate pane handled below */ }
    }
    for (const src of this.pane.sources) {
      if (!(src instanceof IndicatorInstance)) {
        if (m.compares.includes(src as any)) {
          const items = src.legendItems(idx);
          parts.push(`<div class="vc-legend-row${src.visible ? '' : ' vc-legend-hidden'}" data-source="${src.id}"><span class="vc-legend-title">${esc(src.title)}</span><span class="vc-legend-values">${items.map((it) => `<span class="vc-legend-value" style="color:${it.color ?? ''}">${esc(it.value)}</span>`).join('')}</span>${this._buttons(src.id, src.visible)}</div>`);
          continue;
        }
        if (src === m.volume && this.pane.isMain && m.options.volume.visible && o.showIndicatorTitles) {
          const items = o.showIndicatorValues ? src.legendItems(idx) : [];
          parts.push(`<div class="vc-legend-row" data-source="${src.id}"><span class="vc-legend-title">Volume${m.options.volume.showMA ? ` <span class="vc-legend-args">(${m.options.volume.maLength})</span>` : ''}</span><span class="vc-legend-values">${items.map((it) => `<span class="vc-legend-value" style="color:${it.color ?? ''}">${esc(it.value)}</span>`).join('')}</span>${this._buttons(src.id, src.visible)}</div>`);
        }
        continue;
      }
      if (!o.showIndicatorTitles) continue;
      const items = o.showIndicatorValues ? src.legendItems(idx) : [];
      const title = o.showIndicatorArguments ? src.legendTitle(true) : src.def.shortName;
      parts.push(`<div class="vc-legend-row${src.visible ? '' : ' vc-legend-hidden'}" data-source="${src.id}"><span class="vc-legend-title" title="${esc(src.def.name)}">${esc(title)}</span>${src.error ? `<span class="vc-legend-error" title="${esc(src.error)}">!</span>` : ''}<span class="vc-legend-values">${items.map((it) => `<span class="vc-legend-item">${it.label ? `<span class="vc-legend-label">${esc(it.label)}</span>` : ''}<span class="vc-legend-value" style="color:${it.color ?? ''}">${esc(it.value)}</span></span>`).join('')}</span>${this._buttons(src.id, src.visible)}</div>`);
    }
    const html = parts.join('');
    if (html !== this._legendKey) {
      this._legendKey = html;
      this.legendEl.innerHTML = html;
      // wire buttons
      this.legendEl.querySelectorAll<HTMLElement>('[data-action]').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const row = btn.closest('[data-source]') as HTMLElement | null;
          const sid = row?.dataset.source;
          const source = sid === 'main' ? m.mainSeries : sid === 'volume' ? m.volume : (m.indicators.find((i) => i.id === sid) ?? m.compares.find((c) => c.id === sid));
          this.host.onLegendAction(btn.dataset.action as any, source, e as MouseEvent);
        });
      });
    }
  }

  private _buttons(id: string, visible: boolean): string {
    const eye = visible
      ? '<svg viewBox="0 0 18 18" width="16" height="16"><path fill="currentColor" d="M9 4C5.5 4 2.7 6.3 1.5 9c1.2 2.7 4 5 7.5 5s6.3-2.3 7.5-5C15.3 6.3 12.5 4 9 4zm0 8.3A3.3 3.3 0 1 1 9 5.7a3.3 3.3 0 0 1 0 6.6zM9 7.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z"/></svg>'
      : '<svg viewBox="0 0 18 18" width="16" height="16"><path fill="currentColor" d="M2.5 2.5l13 13-1 1-2.6-2.6C10.9 14.6 10 14.8 9 14.8c-3.5 0-6.3-2.3-7.5-5.8.5-1.3 1.3-2.5 2.3-3.4L1.5 3.5l1-1zM9 3.2c3.5 0 6.3 2.3 7.5 5.8-.4 1.1-1 2-1.7 2.8l-1.4-1.4c.3-.4.6-.9.8-1.4C13.4 6.5 11.4 5.2 9 5.2c-.4 0-.8 0-1.2.1L6.2 3.7c.9-.3 1.8-.5 2.8-.5z"/></svg>';
    return `<span class="vc-legend-buttons">
      <button class="vc-legend-btn" data-action="hide" title="Hide">${eye}</button>
      <button class="vc-legend-btn" data-action="settings" title="Settings"><svg viewBox="0 0 18 18" width="16" height="16"><path fill="currentColor" d="M9 6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm6.3 3.6l1.2.9-1.2 2.1-1.4-.5c-.4.4-.9.7-1.4.9l-.2 1.5H9.7l-.2-1.5c-.5-.2-1-.5-1.4-.9l-1.4.5-1.2-2.1 1.2-.9a4.9 4.9 0 0 1 0-1.7L5.5 7.5l1.2-2.1 1.4.5c.4-.4.9-.7 1.4-.9L9.7 3.5h2.6l.2 1.5c.5.2 1 .5 1.4.9l1.4-.5 1.2 2.1-1.2.9a4.9 4.9 0 0 1 0 1.7z"/></svg></button>
      ${id !== 'main' ? `<button class="vc-legend-btn" data-action="remove" title="Remove"><svg viewBox="0 0 18 18" width="16" height="16"><path fill="currentColor" d="M5 4l8 8-1 1-8-8 1-1zm8 0l1 1-8 8-1-1 8-8z"/></svg></button>` : ''}
      <button class="vc-legend-btn" data-action="moreMenu" title="More"><svg viewBox="0 0 18 18" width="16" height="16"><circle cx="4" cy="9" r="1.5" fill="currentColor"/><circle cx="9" cy="9" r="1.5" fill="currentColor"/><circle cx="14" cy="9" r="1.5" fill="currentColor"/></svg></button>
    </span>`;
  }

  destroy(): void {
    this.main.destroy();
    this.top.destroy();
    this.el.remove();
  }
}

function formatCountdown(sec: number): string {
  const s = Math.floor(sec);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  if (d > 0) return `${d}d ${p(h)}:${p(m)}:${p(ss)}`;
  return `${p(h)}:${p(m)}:${p(ss)}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------------------------
// PriceAxisView
// ---------------------------------------------------------------------------------------------
export class PriceAxisView {
  readonly el: HTMLDivElement;
  readonly layer = new CanvasLayer('vc-canvas-axis');
  width = 0;
  height = 0;

  constructor(readonly host: ViewHost, readonly pane: Pane, readonly side: 'left' | 'right') {
    this.el = el('div', { class: `vc-price-axis vc-price-axis-${side}` });
    this.el.appendChild(this.layer.canvas);
  }

  get scale(): PriceScale { return this.side === 'left' ? this.pane.left : this.pane.right; }

  layout(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.el.style.width = `${width}px`;
    this.el.style.height = `${height}px`;
    this.layer.resize(width, height, this.host.dpr);
  }

  /** Desired width from the labels currently shown. */
  requiredWidth(): number {
    const ps = this.scale;
    if (!ps.options.visible) return 0;
    const ctx = this.layer.ctx;
    let max = 0;
    const font = this.host.font;
    for (const t of ps.ticks(this._minTickSpacing())) max = Math.max(max, measureText(ctx, t.label, font));
    for (const src of this.pane.sources) {
      if (!src.visible || src.priceScaleId !== ps.id) continue;
      for (const lab of src.axisLabels()) max = Math.max(max, measureText(ctx, lab.text || ps.formatPrice(lab.price), font));
    }
    const m = this.host.model;
    if (m.crosshair.visible) max = Math.max(max, measureText(ctx, ps.formatPrice(m.crosshair.price), font));
    return Math.max(MIN_PRICE_AXIS_WIDTH, Math.ceil(max) + 16, ps.options.minimumWidth);
  }

  private _minTickSpacing(): number {
    return Math.max(24, this.host.model.options.layout.fontSize * 3);
  }

  render(): void {
    const { ctx } = this.layer;
    const m = this.host.model;
    const o = m.options;
    const ps = this.scale;
    const w = this.width, h = this.height;
    const dpr = this.host.dpr;
    this.layer.clear();
    if (w === 0) return;
    ctx.fillStyle = o.layout.background.type === 'solid' ? o.layout.background.color : (o.layout.background.bottomColor ?? o.layout.background.color);
    ctx.fillRect(0, 0, w, h);
    const right = this.side === 'right';
    if (ps.options.borderVisible) {
      ctx.strokeStyle = ps.options.borderColor;
      ctx.lineWidth = 1;
      const x = crisp(right ? 0 : w - 1, dpr);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    if (ps.isEmpty) return;
    ctx.font = this.host.font;
    ctx.fillStyle = ps.options.textColor;
    ctx.textBaseline = 'middle';
    ctx.textAlign = right ? 'left' : 'right';
    const tx = right ? 8 : w - 8;
    for (const t of ps.ticks(this._minTickSpacing())) {
      if (t.y < 0 || t.y > h) continue;
      if (ps.options.ticksVisible) {
        ctx.strokeStyle = ps.options.borderColor;
        const y = crisp(t.y, dpr);
        ctx.beginPath();
        if (right) { ctx.moveTo(0, y); ctx.lineTo(4, y); } else { ctx.moveTo(w - 4, y); ctx.lineTo(w, y); }
        ctx.stroke();
      }
      ctx.fillStyle = ps.options.textColor;
      ctx.fillText(t.label, tx, t.y);
    }
    // source labels (last values)
    const labels: Array<{ y: number; text: string; bg: string; color: string; sub?: string }> = [];
    // high/low labels of the visible range (main pane only)
    if (this.pane.isMain && o.symbol.highLowLabelsVisible && ps === this.pane.mainScale) {
      const vb = m.timeScale.visibleBars();
      const r = vb ? m.mainSeries.priceRange(vb.from, vb.to) : null;
      if (r) {
        labels.push({ y: ps.priceToY(r.max), text: ps.formatPrice(r.max), bg: '#787B86', color: '#FFFFFF' });
        labels.push({ y: ps.priceToY(r.min), text: ps.formatPrice(r.min), bg: '#787B86', color: '#FFFFFF' });
      }
    }
    for (const src of this.pane.sources) {
      if (!src.visible) continue;
      const srcScale = this.pane.getPriceScale(src.priceScaleId);
      if (srcScale !== ps) {
        // overlay scales (e.g. volume) have no labels on the axis — except indicators that set showLast
        if (!(src instanceof IndicatorInstance)) continue;
      }
      for (const lab of src.axisLabels()) {
        const y = srcScale.priceToY(lab.price);
        if (y < -10 || y > h + 10) continue;
        let sub: string | undefined;
        if (src === m.mainSeries && o.symbol.countdownVisible && ps === this.pane.mainScale) {
          const cd = m.barCloseCountdown();
          if (cd !== null && cd < 400 * 86400) sub = formatCountdown(cd);
        }
        labels.push({ y, text: lab.text || srcScale.formatPrice(lab.price), bg: lab.bg, color: lab.color || contrastText(lab.bg), sub });
      }
    }
    // avoid overlaps: sort by y and push apart
    labels.sort((a, b) => a.y - b.y);
    const boxH = o.layout.fontSize + 6;
    if (ps.options.alignLabels) {
      for (let i = 1; i < labels.length; i++) {
        if (labels[i].y - labels[i - 1].y < boxH) labels[i].y = labels[i - 1].y + boxH;
      }
    }
    for (const lab of labels) this._drawLabel(ctx, lab.y, lab.text, lab.bg, lab.color, lab.sub);
    // crosshair label
    const ch = m.crosshair;
    if (ch.visible && ch.paneId === this.pane.id && o.crosshair.horzLine.labelVisible && o.crosshair.mode !== 'hidden') {
      const price = ps.yToPrice(ch.y);
      this._drawLabel(ctx, ch.y, ps.formatPrice(price), o.crosshair.horzLine.labelBackgroundColor, o.crosshair.horzLine.labelTextColor ?? '#fff');
    }
  }

  private _drawLabel(ctx: CanvasRenderingContext2D, y: number, text: string, bg: string, color: string, sub?: string): void {
    const o = this.host.model.options;
    const right = this.side === 'right';
    const lineH = o.layout.fontSize + 6;
    const boxH = sub ? lineH * 2 - 2 : lineH;
    const yy = Math.round(y - lineH / 2);
    ctx.save();
    ctx.font = this.host.font;
    const tw = Math.max(ctx.measureText(text).width, sub ? ctx.measureText(sub).width : 0);
    const bw = Math.max(this.width - 1, tw + 12);
    const x = right ? 1 : this.width - bw - 1;
    ctx.fillStyle = bg;
    ctx.fillRect(x, yy, bw, boxH);
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = right ? 'left' : 'right';
    ctx.fillText(text, right ? 8 : this.width - 8, y + 0.5);
    if (sub) {
      ctx.font = this.host.font.replace(/(\d+)px/, (_m, n) => `${Math.max(9, +n - 1)}px`);
      ctx.fillText(sub, right ? 8 : this.width - 8, y + lineH - 2);
    }
    ctx.restore();
  }

  destroy(): void { this.layer.destroy(); this.el.remove(); }
}

// ---------------------------------------------------------------------------------------------
// TimeAxisView
// ---------------------------------------------------------------------------------------------
export class TimeAxisView {
  readonly el: HTMLDivElement;
  readonly layer = new CanvasLayer('vc-canvas-axis');
  width = 0;
  height = TIME_AXIS_HEIGHT;

  constructor(readonly host: ViewHost) {
    this.el = el('div', { class: 'vc-time-axis' });
    this.el.appendChild(this.layer.canvas);
  }

  layout(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.el.style.height = `${height}px`;
    this.el.style.width = `${width}px`;
    this.layer.resize(width, height, this.host.dpr);
  }

  render(): void {
    const { ctx } = this.layer;
    const m = this.host.model;
    const o = m.options;
    const ts = m.timeScale;
    const w = this.width, h = this.height;
    const dpr = this.host.dpr;
    this.layer.clear();
    ctx.fillStyle = o.layout.background.type === 'solid' ? o.layout.background.color : (o.layout.background.bottomColor ?? o.layout.background.color);
    ctx.fillRect(0, 0, w, h);
    if (o.timeScale.borderVisible) {
      ctx.strokeStyle = o.timeScale.borderColor;
      ctx.lineWidth = 1;
      const y = crisp(0, dpr);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.font = this.host.font;
    ctx.fillStyle = o.timeScale.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of ts.ticks()) {
      if (t.x < -30 || t.x > w + 30) continue;
      if (o.timeScale.ticksVisible) {
        ctx.strokeStyle = o.timeScale.borderColor;
        const x = crisp(t.x, dpr);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 4); ctx.stroke();
      }
      const bold = t.weight >= 50;
      ctx.font = bold ? this.host.font.replace('normal', '600') : this.host.font;
      ctx.fillStyle = o.timeScale.textColor;
      ctx.fillText(t.label, t.x, h / 2 + 1);
    }
    // timescale marks (earnings, dividends, splits...)
    if (m.timescaleMarks.length && o.timeScale.marksVisible) {
      const tr = ts.visibleTimeRange();
      if (tr) {
        ctx.save();
        ctx.font = `bold 9px ${o.layout.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const mk of m.timescaleMarks) {
          if (mk.time < tr.from || mk.time > tr.to) continue;
          const x = ts.timeToX(mk.time);
          const hovered = mk === m.hoveredTimescaleMark;
          const rr = hovered ? 8 : 6.5;
          ctx.beginPath();
          if (mk.shape === 'earningUp') { ctx.moveTo(x, h - 4 - rr * 2); ctx.lineTo(x + rr, h - 4); ctx.lineTo(x - rr, h - 4); ctx.closePath(); }
          else if (mk.shape === 'earningDown') { ctx.moveTo(x, h - 4); ctx.lineTo(x + rr, h - 4 - rr * 2); ctx.lineTo(x - rr, h - 4 - rr * 2); ctx.closePath(); }
          else ctx.arc(x, h - 4 - rr, rr, 0, Math.PI * 2);
          ctx.fillStyle = o.layout.background.color;
          ctx.fill();
          ctx.lineWidth = hovered ? 2 : 1.5;
          ctx.strokeStyle = mk.color;
          ctx.stroke();
          if (mk.label) { ctx.fillStyle = mk.color; ctx.fillText(mk.label.slice(0, 1), x, h - 4 - rr + 0.5); }
        }
        ctx.restore();
      }
    }
    // crosshair label
    const ch = m.crosshair;
    if (ch.visible && o.crosshair.vertLine.labelVisible && o.crosshair.mode !== 'hidden') {
      const x = ts.barCenterX(ch.index);
      const text = ts.formatCrosshairTime(ts.indexToTime(ch.index));
      const box = drawLabelBox(ctx, text, x, 2, { font: this.host.font, bg: o.crosshair.vertLine.labelBackgroundColor, color: o.crosshair.vertLine.labelTextColor ?? '#fff', align: 'center', padX: 8, padY: 4 });
      // keep inside
      if (box.x < 0 || box.x + box.w > w) {
        const nx = Math.max(0, Math.min(w - box.w, box.x));
        ctx.clearRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
        ctx.fillStyle = o.layout.background.color;
        ctx.fillRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
        drawLabelBox(ctx, text, nx, 2, { font: this.host.font, bg: o.crosshair.vertLine.labelBackgroundColor, color: o.crosshair.vertLine.labelTextColor ?? '#fff', align: 'left', padX: 8, padY: 4 });
      }
    }
  }

  destroy(): void { this.layer.destroy(); this.el.remove(); }
}
