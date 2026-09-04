# VibeChart architecture

Zero-dependency TradingView-style charting library (TypeScript → ESM/UMD, Canvas 2D).

```
src/
  core/        Chart (widget/DOM/input), ChartModel (state), Pane, TimeScale, PriceScale, views (canvas views), options
  data/        Datafeed types (TradingView IBasicDataFeed compatible), DataLoader (lazy history + realtime), resolution utils, SampleDatafeed
  series/      DataSource base, MainSeries (all chart types), VolumeSeries, renderers (candles/bars/line/area/...), synthetic (HA/Renko/Kagi/LineBreak/PnF/Range)
  indicators/  ta.ts (Pine-like primitives), Indicator.ts (definition + instance + registry), builtins/* (TradingView built-ins)
  drawings/    Drawing.ts (base class + registry), DrawingManager.ts (tool state machine, selection, drag, undo), tools/* (all tools)
  ui/          mount.ts (assembles the UI), topToolbar, leftToolbar (grouped tool flyouts + favourites), floatingToolbar,
               contextMenus, bottomBar (ranges/clock/timezone/%-log-auto), navButtons, keyboard, replayBar, components (menus,
               dialogs, colour picker, form controls), icons, dialogs/* (chart/indicator/drawing settings, indicators search,
               symbol search, object tree, go-to-date, templates), styles.css
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

## Data flow
`DataLoader` (TradingView datafeed contract, bar times normalised to seconds) → `ChartModel.setBars` → `MainSeries.setData` (synthetic types rebuilt here) → `TimeScale.setTimes` (view kept stable on prepend) → indicators recompute (`buildIndicatorContext`) → compare series realign → `invalidate('full')`.
Lazy loading: `TimeScale.visibleRangeChanged` → `Chart._maybeLoadMore` → `DataLoader.requestMoreIfNeeded` (fires when < 100 bars remain to the left).
Realtime: `subscribeBars` ticks update/append the last bar; `ReplayController` buffers them while replay is active.

## UI contract
The UI is mounted through `Chart.uiFactory` (set by `src/ui/index.ts`) and talks to the core only through the public API and
events (`contextMenu`, `openDialog`, `toolChanged`, `drawingSelected`, ...). `openDialog(chart, type, payload)` in
`src/ui/dialogs/index.ts` is the single dialog entry point.

## Tests
`npm test` runs vitest: core scales/format/session/synthetic/loader tests, indicator value tests, drawing geometry tests and a
smoke test that renders every registered drawing tool with a mock canvas (`test/helpers/mockCanvas.ts`).
