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

## Strategies (`src/strategy`)

- `Broker.ts` — the broker emulator: pending orders, TradingView's intrabar fill path, entry/order/exit/close semantics, pyramiding, commission, slippage, margin, risk rules, trades, fills and the equity curve. Driven bar by bar (`beginBar(i)` → script → `endBar(i)`) and never looks ahead.
- `metrics.ts` — `buildReport()` turns the broker state into the Strategy Tester report (All/Long/Short groups, monthly returns, Sharpe/Sortino).
- `prelude.ts` — the Python runtime as a string: `Series` with the `[]` history operator and lazy arithmetic, call-site keyed `ta.*` state, `input.*`, `plot*`, the `strategy` namespace whose commands call the JS `_bridge`, and the `_run` loop.
- `PythonRunner.ts` — `PyodideRunner` loads Pyodide from a CDN on demand, sets the bridge as a Python global per run, runs the script in chunks (yielding to the UI, cancellable) and collects plots/inputs/logs. `PythonRunner` is an interface, so a server-side runner can replace it.
- `StrategyEngine.ts` — `StrategyController`: script/inputs/properties state, runs, builds the report, and shows the strategy on the chart as a dynamic `IndicatorDefinition` (plots through the indicator pipeline, trades via `customRender`). Re-runs when the bar count changes.
- UI: `ui/bottomPanel.ts` (dock, editor toolbar, console, script library in localStorage), `ui/codeEditor.ts` (textarea + highlighted mirror), `ui/strategyTester.ts` (report tabs and equity chart), `ui/dialogs/strategySettings.ts` (Inputs / Properties / Style).

The chart creates the controller only when constructed with `strategy: { enabled: true }` (or `chart.enableStrategy()`), so nothing strategy-related runs otherwise.
