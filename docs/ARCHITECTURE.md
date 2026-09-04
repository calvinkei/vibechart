# OpenChart architecture

Zero-dependency TradingView-style charting library (TypeScript → ESM/UMD, Canvas 2D).

```
src/
  core/        Chart (widget/DOM/input), ChartModel (state), Pane, TimeScale, PriceScale, views (canvas views), options
  data/        Datafeed types (TradingView IBasicDataFeed compatible), DataLoader (lazy history + realtime), resolution utils, SampleDatafeed
  series/      DataSource base, MainSeries (all chart types), VolumeSeries, renderers (candles/bars/line/area/...), synthetic (HA/Renko/Kagi/LineBreak/PnF/Range)
  indicators/  ta.ts (Pine-like primitives), Indicator.ts (definition + instance + registry), builtins/* (TradingView built-ins)
  drawings/    Drawing.ts (base class + registry), DrawingManager.ts (tool state machine, selection, drag, undo), tools/* (all tools)
  ui/          toolbars, dialogs, menus (pure DOM), styles.css
  util/        math, color, time (Intl based tz), format, dom, events
```

## Coordinate model
* Time scale works in **logical bar indices** (bars equally spaced, no gaps). `indexToX`, `xToIndex`, `timeToIndex` (fractional, extrapolated beyond data), `indexToTime`.
* Price scales map price → y per pane, modes normal/log/percentage/indexed, autoscale from `PriceRangeProvider`s.
* Drawings store `{time, price}` points and convert each frame via `rc.toPixel`.

## Render pipeline
`ChartModel.invalidate(level)` → `Chart._render()` (rAF): layout (pane heights, axis widths) → autoscale → `PaneView.renderMain` (background, grid, sources by zIndex, price line, drawings) → `renderTop` (crosshair, creation preview, handles) → axes → legend DOM.

## Extending
* Indicator: `registerIndicator({ id, name, shortName, overlay, inputs, plots, bands, fills, compute(ctx, inputs) })`.
* Drawing tool: subclass `Drawing`, set static `toolId/toolName/pointsCount/group/icon`, implement `defaultStyle/propertyDefs/render/hitTest`, `registerDrawingTool(Class)`.
* Datafeed: implement `Datafeed` (onReady/resolveSymbol/getBars/subscribeBars/unsubscribeBars) — bar times in ms like TradingView.
