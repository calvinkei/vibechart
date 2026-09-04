# OpenChart

An open-source, dependency-free clone of the TradingView Charting Library. Pure TypeScript compiled to plain JavaScript (ESM + UMD), Canvas 2D rendering, no React/Vue/framework dependencies, **zero runtime dependencies**.

> Status: active development. Chart engine, chart types, drawing tools, indicators, lazy loading and the TradingView-style UI are all implemented in this repository — see the feature matrix below.

## Features

- **Chart types (18)**: Bars, Candles, Hollow candles, Volume candles, Line, Line with markers, Step line, Area, HLC area, Baseline, Columns, High-low, Heikin Ashi, Renko, Line break, Kagi, Point & Figure, Range bars (ATR / traditional box sizing).
- **Time scale**: equally spaced bars, scroll (drag, wheel, touch, kinetic), zoom (wheel, pinch, axis drag), right margin, session-aware future extrapolation, TradingView-style tick labels (year/month/day/time), go-to-date, visible-range API, fixed edges.
- **Price scales**: regular / logarithmic / percentage / indexed-to-100, auto scale, invert, axis drag scaling, multiple scales per pane (left/right/overlay), last-price label with countdown, high/low labels, precision control.
- **Panes**: unlimited indicator panes, drag separators, collapse/maximize/move/remove, legends with hover actions.
- **Datafeed**: TradingView `IBasicDataFeed`-compatible interface (`onReady`, `resolveSymbol`, `searchSymbols`, `getBars` with `periodParams`/`countBack`/`noData`/`nextTime`, `subscribeBars`, `unsubscribeBars`) with lazy history loading while scrolling and realtime updates. A deterministic sample datafeed is included for demos/tests.
- **Drawing tools**: the full TradingView catalogue — trend lines/rays/channels, Fibonacci (retracement, extension, channel, time zone, fans, arcs, circles, spiral, wedge), Gann (box, square, fan), pitchforks, shapes, text/notes/callouts, patterns (XABCD, Elliott waves, head & shoulders…), positions (long/short), forecast, ranges, anchored VWAP, volume profile, measure — with per-tool style dialogs, magnet, lock/hide, undo/redo, clone, templates, object tree, keyboard shortcuts.
- **Indicators**: TradingView's built-in set (moving averages, Bollinger, RSI, MACD, Stochastic, Ichimoku, Supertrend, ADX, Volume, VWAP, volume profile, pivots, candlestick patterns and many more) with the same inputs/defaults, Inputs/Style/Visibility dialogs, and a Pine-like `ta` primitive library.
- **UI**: top toolbar (symbol search, intervals with favorites, chart types, indicators, templates, undo/redo, settings, fullscreen, snapshot), left drawing toolbar with grouped flyouts and favorites, floating drawing toolbar, context menus, chart settings dialog (Symbol/Status line/Scales/Appearance…), bottom bar (date ranges, timezone, %/log/auto), light & dark themes, save/load layouts, screenshots.

## Install / build

```bash
npm install
npm run dev      # demo at http://localhost:5180
npm run build    # dist/openchart.js (ESM), dist/openchart.umd.js, dist/index.d.ts
npm test
```

## Usage

```html
<div id="chart" style="height: 600px"></div>
<script type="module">
  import { Chart, SampleDatafeed } from './dist/openchart.js';
  const chart = new Chart({
    container: '#chart',
    datafeed: new SampleDatafeed(),   // or your own TradingView-compatible datafeed
    symbol: 'BTCUSD',
    interval: '60',
    theme: 'dark',
    studies: ['Moving Average Exponential', 'Relative Strength Index'],
  });
  chart.setChartType('heikinAshi');
  chart.createShape([{ time: 1700000000, price: 42000 }, { time: 1700360000, price: 43000 }], { shape: 'trend_line' });
</script>
```

UMD build exposes `window.OpenChart`.

### Datafeed

Implement the TradingView datafeed contract (bar `time` in **milliseconds**, `periodParams.from/to` in seconds):

```ts
const datafeed = {
  onReady(cb) { cb({ supported_resolutions: ['1', '5', '60', '1D'] }); },
  resolveSymbol(name, onResolve, onError) { onResolve({ name, description: name, type: 'crypto', session: '24x7', timezone: 'Etc/UTC', exchange: 'X', minmov: 1, pricescale: 100, has_intraday: true, supported_resolutions: ['1', '5', '60', '1D'] }); },
  getBars(symbolInfo, resolution, { from, to, countBack, firstDataRequest }, onResult, onError) { /* fetch, then */ onResult(bars, { noData: bars.length === 0 }); },
  subscribeBars(symbolInfo, resolution, onTick, guid, onResetCache) { /* push realtime bars via onTick */ },
  unsubscribeBars(guid) {},
};
```

## API overview

| Area | Methods |
|---|---|
| Symbol / interval | `setSymbol(symbol, interval?)`, `setResolution(interval)`, `symbolInfo`, `chartType`, `setChartType(type or TV numeric id)` |
| Options / theme | `applyOptions(partial)`, `setTheme('light'|'dark')`, `setTimezone(tz)`, `options` |
| Indicators | `addIndicator(name, inputs?, {overlay, paneId})`, `createStudy(name, forceOverlay, lock, inputs)`, `removeIndicator`, `getIndicators()`, `removeAllIndicators()` |
| Drawings | `setTool(toolId)`, `createShape(point, {shape, overrides})`, `createMultipointShape(points, …)`, `getAllShapes()`, `getShapeById(id)`, `removeEntity(id)`, `removeAllShapes()`, `undo()`, `redo()`, `drawings` (manager) |
| Scales | `timeScale().setVisibleRange/getVisibleRange/scrollToRealtime/fitContent/zoomIn/zoomOut/goToDate`, `priceScale(paneId, id).setMode/setInverted/setAutoScale`, `resetView()` |
| Persistence | `save()` → JSON, `load(json)`, `takeScreenshot()` → PNG data URL |
| Events | `subscribe('ready'|'symbolChanged'|'intervalChanged'|'chartTypeChanged'|'crosshairMoved'|'visibleRangeChanged'|'drawingCreated'|'drawingSelected'|'indicatorAdded'|'dataLoaded'|'loading'|'error'|…, fn)` |

## Extending

```ts
import { registerIndicator, plotStyle, registerDrawingTool, Drawing } from 'openchart';

registerIndicator({
  id: 'My Indicator', name: 'My Indicator', shortName: 'MYI', overlay: true,
  inputs: [{ id: 'length', name: 'Length', type: 'int', defval: 20 }],
  plots: [{ id: 'v', title: 'Value', style: plotStyle({ color: '#FF6D00' }) }],
  compute: (ctx, inp) => ({ v: ctx.ta.sma(ctx.close, inp.length) }),
});
```

See `docs/ARCHITECTURE.md` and the research specs in `docs/research/` (a detailed inventory of TradingView's behaviour that this project mirrors).

## License

MIT
