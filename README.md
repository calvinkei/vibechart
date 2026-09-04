# VibeChart

[![npm](https://img.shields.io/npm/v/vibechart.svg)](https://www.npmjs.com/package/vibechart)
[![license](https://img.shields.io/npm/l/vibechart.svg)](./LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)

A full-featured, open-source financial charting library in pure TypeScript. Canvas 2D rendering, no React/Vue/framework requirement, **zero runtime dependencies**. Ships ESM, CJS and UMD builds with TypeScript types.

> **18 chart types, 91 drawing tools, 173 built-in indicators**, lazy history loading, realtime updates, multi-pane layouts, compare symbols, bar replay, marks, light/dark themes and a complete trading-terminal UI (toolbars, dialogs, context menus) — in one dependency-free bundle (~198 KB gzipped UMD).

It implements the TradingView datafeed contract, so an existing TradingView `IBasicDataFeed` adapter works unchanged. VibeChart is an independent project and is not affiliated with or endorsed by TradingView.

## Features

- **Chart types (18)**: Bars, Candles, Hollow candles, Volume candles, Line, Line with markers, Step line, Area, HLC area, Baseline, Columns, High-low, Heikin Ashi, Renko, Line break, Kagi, Point & Figure, Range bars (ATR / traditional box sizing).
- **Time scale**: equally spaced bars, scroll (drag, wheel, touch, kinetic), zoom (wheel, pinch, axis drag), right margin, session-aware future extrapolation, TradingView-style tick labels (year/month/day/time), go-to-date, visible-range API, fixed edges.
- **Price scales**: regular / logarithmic / percentage / indexed-to-100, auto scale, invert, axis drag scaling, multiple scales per pane (left/right/overlay), last-price label with countdown, high/low labels, precision control.
- **Panes**: unlimited indicator panes, drag separators, collapse/maximize/move/remove, legends with hover actions.
- **Datafeed**: TradingView `IBasicDataFeed`-compatible interface (`onReady`, `resolveSymbol`, `searchSymbols`, `getBars` with `periodParams`/`countBack`/`noData`/`nextTime`, `subscribeBars`, `unsubscribeBars`) with lazy history loading while scrolling and realtime updates. A deterministic sample datafeed is included for demos/tests.
- **Drawing tools (91)**: the TradingView catalogue — trend line, ray, info line, extended line, trend angle, horizontal/vertical/cross lines, arrows, parallel/disjoint/regression channels, flat top/bottom; Fibonacci retracement, trend-based extension, channel, time zone, speed/resistance fan & arcs, trend-based time, circles, spiral, wedge; Gann box, square, fixed square, fan; pitchfork (original, Schiff, modified Schiff, inside) and pitchfan; rectangle, rotated rectangle, ellipse, circle, triangle, arc, curve, double curve, polyline, path, brush, highlighter; text, anchored text, note, anchored note, pin, callout, comment, price label, price note, signpost, flag, table, emoji, icons, arrow markers; XABCD, Cypher, ABCD, triangle, three drives, head & shoulders, Elliott impulse/correction/triangle/double & triple combo, cyclic lines, time cycles, sine line; long/short position, forecast, bars pattern, ghost feed, projection, price/date/date-price ranges, anchored VWAP, fixed-range & anchored volume profile, measure — with per-tool Style/Text/Coordinates/Visibility dialogs, magnet (weak/strong), lock/hide, undo/redo, clone/copy/paste, templates, object tree, keyboard shortcuts.
- **Indicators (173)**: TradingView's built-in set with the same names, inputs, defaults, colours and levels — moving averages (SMA/EMA/WMA/SMMA/HMA/DEMA/TEMA/VWMA/LSMA/ALMA/KAMA/McGinley, ribbons, crosses, GMMA, TWAP), Bollinger Bands/%B/Width, Keltner, Donchian, Envelope, Ichimoku, Supertrend, Parabolic SAR, ADX/DMI, Aroon, Alligator, Fractals, Zig Zag, Auto Fib, Pivot Points (Traditional/Fibonacci/Woodie/Classic/DM/Camarilla), RSI, Stochastic, Stoch RSI, MACD, CCI, Williams %R, Ultimate/Awesome/Accelerator/Chaikin oscillators, DPO, KST, RVI, Fisher, CMO, BoP, SMI, TSI, Woodies CCI, Connors RSI, Coppock, TRIX, Momentum/ROC/PPO/PMO, ATR, HV, StdDev/StdErr, Mass Index, Choppiness, Chop Zone, Vortex, volume (OBV, A/D, CMF, MFI, EOM, PVT, Klinger, Force Index, Net/Up-Down/Delta/Cumulative Delta, 24h, RVOL), VWAP (session/week/month/… anchors, bands, auto-anchored, rolling), Volume Profile (visible range, fixed range, session, periodic, auto-anchored), 40 candlestick-pattern studies, Technical Ratings, Gaps, Divergence, Median and more — with Inputs/Style/Visibility dialogs and a Pine-like `ta` primitive library.
- **UI**: top toolbar (symbol search, intervals with favorites, chart types, indicators, templates, undo/redo, settings, fullscreen, snapshot), left drawing toolbar with grouped flyouts and favorites, floating drawing toolbar, context menus, chart settings dialog (Symbol/Status line/Scales/Appearance…), bottom bar (date ranges, timezone, %/log/auto), light & dark themes, save/load layouts, screenshots.

## Install

```bash
npm install vibechart
```

No CSS import is needed — styles are inlined in the bundle and injected on first use.

```js
import { Chart, SampleDatafeed } from 'vibechart';
```

CommonJS (`const { Chart } = require('vibechart')`) and a browser `<script>` tag both work:

```html
<script src="https://cdn.jsdelivr.net/npm/vibechart/dist/vibechart.umd.js"></script>
<script>
  const chart = new VibeChart.Chart({ container: '#chart', datafeed: new VibeChart.SampleDatafeed(), symbol: 'BTCUSD' });
</script>
```

| Build | File | Entry |
| --- | --- | --- |
| ESM | `dist/vibechart.mjs` | `import` |
| CommonJS | `dist/vibechart.cjs` | `require` |
| UMD (global `VibeChart`) | `dist/vibechart.umd.js` | `<script>`, CDN |
| Types | `dist/index.d.ts` | TypeScript |

## Develop

```bash
git clone https://github.com/calvinkei/vibechart.git
cd vibechart
npm install
npm run dev      # demo at http://localhost:5180
npm run build    # dist/ (ESM + CJS + UMD + types)
npm test         # 668 unit tests
```

## Usage

```html
<div id="chart" style="height: 600px"></div>
<script type="module">
  import { Chart, SampleDatafeed } from 'vibechart';
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

UMD build exposes `window.VibeChart`.

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
import { registerIndicator, plotStyle, registerDrawingTool, Drawing } from 'vibechart';

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
