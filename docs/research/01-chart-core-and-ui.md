# TradingView Chart Core & UI — Feature Inventory (Spec for a 1:1 JS clone)

Research document 01. Scope: the chart engine and UI of the TradingView Advanced Charts / Trading Platform library (docs version 32.1.0, fetched 2026-09-04) and the tradingview.com "Supercharts" UI that is built on the same engine. Indicators (built-in study math) and the individual drawing tools' geometry are covered only where they touch the chart core; the drawing-tool name lists and override property names are included in full because the API needs them.

Sources used (all fetched during this research; see Appendix G for the URL list):

* `charting_library.d.ts` v32.1.0 (extracted from the official `charting-library-context.txt` LLM context bundle, 1.1 MB). All `@default` values quoted below come from this file unless stated otherwise.
* The Markdown docs embedded in the same bundle (UI elements, Connecting data, Customization, Saving/loading, Shortcuts, Widget Constructor, Datafeed pages).
* TradingView Help Center articles (chart types, Renko/Kagi/PnF/Line Break/Range, Heikin Ashi, Bar Replay, price scale, sessions, settings dialog, magnet mode, layouts, shortcuts).
* Lightweight Charts v5 `typings.d.ts` and selected source files (`time-scale.ts`, `price-scale.ts`, `price-scale-conversions.ts`, `tick-marks.ts`, `time-scale-point-weight-generator.ts`, `default-tick-mark-formatter.ts`, `price-tick-mark-builder.ts`, `magnet.ts`, `kinetic-animation.ts`, `mouse-event-handler.ts`, `chart-widget.ts`). Lightweight Charts is TradingView's open-source engine; where the Advanced Charts docs do not state a behavior precisely, the Lightweight Charts implementation is used as the concrete reference and is labelled **[LWC]**.

Conventions:

* **[TV-lib]** = documented for the Advanced Charts / Trading Platform library. **[TV.com]** = tradingview.com website only (not in the library). **[LWC]** = Lightweight Charts implementation detail. **[GUESS]** = not found in any document; inferred or remembered; verify before relying on it.
* Colors are given exactly as in the source. `LineStyle` numeric values: `0 = Solid`, `1 = Dotted`, `2 = Dashed` (`3 = LargeDashed` exists in Lightweight Charts and old wiki tables).
* All times are Unix timestamps in **seconds** in the public API, except `Bar.time` and `HistoryMetadata.nextTime`, which are **milliseconds**.

---

## 0. Product boundaries that shape the spec

* The library docs state (FAQ, "Unsupported features"): *Pine Script, Alerts, Strategy Tester, Bar Replay, Screener, Hot lists, Calendars, Heatmap, TradingView data, Range Bars, Chart Patterns, Chats* are **not** in Advanced Charts or Trading Platform. They exist only on tradingview.com. They are still described here (Sections 9 and 10) because the clone is meant to match tradingview.com.
* Introduction page: Advanced Charts = "13+ chart types", "100+ indicators", "110+ drawing tools"; Trading Platform adds multi-chart layouts (up to 8 charts), "professional chart types (Renko, Kagi, Point-and-Figure, Line Break)", trading from the chart, widget bar (Watchlist, Details, News), Order Ticket, DOM.
* `supportedChartTypes()` (widget) returns a readonly watched `ChartStyle[]` for the active chart; the set shrinks when `visible_plots_set` is `"c"` (line-based styles only) and when a symbol/resolution cannot feed a style.

---

## 1. CHART TYPES

### 1.1 Enumerations (exact numeric ids)

`ChartStyle` (used by `mainSeriesProperties.style`, `setChartType`, `chartType()`):

| Name | Value | UI name | Notes |
|---|---|---|---|
| Bar | 0 | Bars | |
| Candle | 1 | Candles | default style |
| Line | 2 | Line | |
| Area | 3 | Area | |
| Renko | 4 | Renko | Trading Platform only |
| Kagi | 5 | Kagi | Trading Platform only |
| PnF | 6 | Point & figure | Trading Platform only |
| LineBreak | 7 | Line break | Trading Platform only |
| HeikinAshi | 8 | Heikin Ashi | |
| HollowCandle | 9 | Hollow candles | |
| Baseline | 10 | Baseline | |
| HiLo | 12 | High-low | needs featureset `chart_style_hilo` |
| Column | 13 | Columns | |
| LineWithMarkers | 14 | Line with markers | |
| Stepline | 15 | Step line | |
| HLCArea | 16 | HLC area | |
| VolCandle | 19 | Volume candles | |
| HLCBars | 21 | HLC bars | |

(11, 17, 18, 20 are unused/reserved.) `SeriesType` is the same enum with slightly different member names (`Bars`, `Candles`, `HeikenAshi`, `HollowCandles`, `PointAndFigure`, ...). Range bars have **no** value in the library enum (tradingview.com only).

`ChartTypeFavorites` (names accepted in `favorites.chartTypes`): `"Area" | "Bars" | "Candles" | "Heiken Ashi" | "Hollow Candles" | "Line" | "Line Break" | "Baseline" | "LineWithMarkers" | "Stepline" | "Columns" | "High-low"` (Trading Platform adds Renko/Kagi/PnF via `TradingTerminalChartTypeFavorites`).

`PriceSource` (for line-based styles): `"open" | "high" | "low" | "close"`.

Style property groups (`mainSeriesProperties.<group>`): Line → `lineStyle`, Baseline → `baselineStyle`, Stepline → `steplineStyle`, Bars → `barStyle`, Candles → `candleStyle`, Volume candles → `volCandlesStyle`, Area → `areaStyle`, HLC Area → `hlcAreaStyle`, HLC bars → `hlcBarsStyle`, Line with markers → `lineWithMarkersStyle`, Hollow candles → `hollowCandleStyle`, Heikin Ashi → `haStyle`, Columns → `columnStyle`, High-low → `hiloStyle`, Renko → `renkoStyle`, Line Break → `pbStyle`, Kagi → `kagiStyle`, Point & Figure → `pnfStyle`. Runtime change: `getSeries().setChartStyleProperties(ChartStyle, partialPrefs)` / `chartStyleProperties(ChartStyle)`; the preference interfaces are in `SeriesPreferencesMap`.

tradingview.com families (help center "Chart types available"): Line charts (Line, Line with markers, Step line, Area, HLC area, Baseline); Bar charts (Bars, High-low, Range bars); Japanese (Candles, Hollow candles, Volume candles, Heikin Ashi); Price-based (Renko, Line break, Kagi, Point & figure, Range); Indicator-based (Volume footprint, Session volume profile, TPO — TV.com only); Columns.

### 1.2 Time-based styles — drawing rules and style options

All time-based styles put exactly one element per bar slot; the slot width is `barSpacing` px (Section 2). Body width for candles/bars is derived from bar spacing (LWC: roughly `barSpacing * 0.8` rounded to an odd pixel width, min 1 px; **[GUESS]** for the TV library, which additionally switches to 1-px "thin" bars automatically when spacing is small).

**Bars (0).** A vertical line from low to high; a left tick at open, a right tick at close.
`barStyle.upColor "#089981"`, `barStyle.downColor "#F23645"`, `barStyle.barColorsOnPrevClose false` (when true, up/down colour is decided by close vs previous close instead of close vs open), `barStyle.dontDrawOpen false` (hide the open tick), `barStyle.thinBars true` (1 px sticks; when false the bar/ticks are drawn thicker as spacing allows). [LWC equivalents: `openVisible true`, `thinBars true`.]

**HLC bars (21).** Bars without the open tick, one colour: `hlcBarsStyle.color`, `hlcBarsStyle.thinBars` (interface `HLCBarsStylePreferences { color; thinBars }`).

**Candles (1).** Body from open to close, wick from low to high through the body centre.
`candleStyle.upColor "#089981"`, `downColor "#F23645"`, `drawWick true`, `drawBorder true`, `borderColor "#378658"`, `borderUpColor "#089981"`, `borderDownColor "#F23645"`, `wickColor "#737375"`, `wickUpColor "#089981"`, `wickDownColor "#F23645"`, `barColorsOnPrevClose false`, `drawBody true`. When `drawBody` is false only borders/wicks are drawn. Doji (open == close) draws a 1-px horizontal body line. [LWC defaults for comparison: up `#26a69a`, down `#ef5350`, border `#378658`, wick `#737375`.]

**Hollow candles (9).** Same geometry as candles, but fill and colour are decided separately (help center):
* Fill: **hollow** if `close > open`, **filled** if `close < open`.
* Colour: **green** if `close > previousClose`, **red** if `close < previousClose`.
* Four cases, most to least bullish: green hollow (close > open and > prev close), green filled (close < open but > prev close), red hollow (close > open but < prev close), red filled (close < open and < prev close).
Style: `hollowCandleStyle.upColor "#089981"`, `downColor "#F23645"`, `drawWick true`, `drawBorder true`, `borderColor "#378658"`, `borderUpColor "#089981"`, `borderDownColor "#F23645"`, `wickColor "#737375"`, `wickUpColor "#089981"`, `wickDownColor "#F23645"`, `drawBody true` (no `barColorsOnPrevClose` — the prev-close rule is built in).

**Volume candles (19).** Candles whose **width** is proportional to the bar's volume ("the greater the trading volume during the formation period, the wider the candle"; the exact scaling formula and min/max widths are not documented). Style keys identical to `candleStyle` under `volCandlesStyle` (`upColor "#089981"`, `downColor "#F23645"`, `drawWick`, `drawBorder`, `borderColor "#378658"`, `borderUpColor`, `borderDownColor`, `wickColor "#737375"`, `wickUpColor`, `wickDownColor`, `barColorsOnPrevClose false`, `drawBody true`). Uses `CandleStylePreferences`.

**Heikin Ashi (8).** Synthetic OHLC, one HA bar per source bar, "tied to the time scale the same way regular charts are". Formulas (help center):
* `haClose = (open + high + low + close) / 4` of the current bar.
* `haOpen = (haOpen[prev] + haClose[prev]) / 2`.
* `haHigh = max(high, haOpen, haClose)`.
* `haLow  = min(low, haOpen, haClose)`.
* First bar seed: **[GUESS]** `haOpen = (open + close) / 2` (the standard convention; TV does not document it).
* The current candle is "calculated with a delay" because `haOpen` depends on the previous candle.
Style: `haStyle.*` same keys as candles (`upColor "#089981"`, `downColor "#F23645"`, `drawWick`, `drawBorder`, `borderColor "#378658"`, `borderUpColor`, `borderDownColor`, `wickColor "#737375"`, `wickUpColor`, `wickDownColor`, `barColorsOnPrevClose false`, `drawBody true`) plus `showRealLastPrice` (UI: "Real prices on price scale" — the last-price label/line shows the real close instead of the HA close). The d.ts note: Heikin Ashi emits both series bars and a projection (`IProjectionStudyResult.deferUntilBars`), i.e. the in-progress HA bar is rendered as a projection until the source bar closes.

**Line (2).** Straight segments joining `priceSource` values (default close). `lineStyle.color "#2962FF"`, `linestyle 0 (Solid)`, `linewidth 2`, `priceSource "close"`. `LineStylePreferences` also exposes `colorType?: "solid"|"gradient"`, `gradientStartColor`, `gradientEndColor` (line gradient). The last point has a "pulse" animation on real-time updates; disable with featureset `disable_pulse_animation`.

**Line with markers (14).** Line plus a circular marker on every data point. `lineWithMarkersStyle.color "#2962FF"`, `linestyle 0`, `linewidth 2`, `priceSource "close"`. Marker radius is not documented (**[GUESS]** ≈ linewidth + 2 px; markers are hidden when bar spacing is too small).

**Step line (15).** Horizontal segment at each value, vertical riser at the next bar ("staircase"). `steplineStyle.color "#2962FF"`, `linestyle 0`, `linewidth 2`, `priceSource "close"`.

**Area (3).** Line plus vertical gradient fill down to the bottom of the pane. `areaStyle.color1 "rgba(41, 98, 255, 0.28)"` (top of gradient), `color2 "#2962FF"` (bottom), `linecolor "#2962FF"`, `linestyle 0`, `linewidth 2`, `priceSource "close"`, `transparency 100`. (`AreaStylePreferences { color1; color2; linecolor; linestyle; linewidth; transparency }`.)

**HLC area (16).** Three lines (high, low, close) and two fills: high→close and close→low. `hlcAreaStyle.highLineColor "#089981"`, `highLineStyle 0`, `highLineWidth 2`, `lowLineColor "#F23645"`, `lowLineStyle 0`, `lowLineWidth 2`, `closeLineColor "#868993"`, `closeLineStyle 0`, `closeLineWidth 2`, `highCloseFillColor "rgba(8, 153, 129, 0.2)"`, `closeLowFillColor "rgba(242, 54, 69, 0.2)"`; preferences also have `highLineVisible`, `lowLineVisible`. Help-center use: a narrowing high–low band signals a possible reversal.

**Baseline (10).** A horizontal base level; the line above it is coloured "top", below it "bottom", with two-colour gradient fills toward the base. `baselineStyle.baselineColor "#758696"`, `topFillColor1 "rgba(8, 153, 129, 0.28)"`, `topFillColor2 "rgba(8, 153, 129, 0.05)"`, `bottomFillColor1 "rgba(242, 54, 69, 0.05)"`, `bottomFillColor2 "rgba(242, 54, 69, 0.28)"`, `topLineColor "#089981"`, `bottomLineColor "#F23645"`, `topLineWidth 2`, `bottomLineWidth 2`, `priceSource "close"`, `transparency 50`, `baseLevelPercentage 50` (base level as a percent of the pane height; the user drags the base line to change it; `topLineStyle`/`bottomLineStyle` also exist in `BaselineStylePreferences`). [LWC: `baseValue {type:'price', price:0}`, `relativeGradient false`.]

**Columns (13).** A vertical column per bar from a baseline to `priceSource`. `columnStyle.upColor "rgba(8, 153, 129, 0.5)"`, `downColor "rgba(242, 54, 69, 0.5)"`, `barColorsOnPrevClose true` (up/down by comparing with the previous value), `priceSource "close"`; `ColumnStylePreferences.baselinePosition: ColumnStyleBaselinePosition` (where columns start; values not listed in the d.ts excerpt — **[GUESS]** bottom / zero / middle).

**High-low (12).** A box from low to high per bar (no open/close), optional high/low labels. `hiloStyle.color "#2962FF"`, `showBorders true`, `borderColor "#2962FF"`, `showLabels true`, `labelColor "#2962FF"`, `drawBody`. Gated by featureset `chart_style_hilo` (off by default); `chart_style_hilo_last_price` enables the last-price line/label for this style.

### 1.3 Price-based ("Japanese"/synthetic) styles

Common facts (help center + docs):
* They are built sequentially from the chart's resolution bars ("the chart's timeframe determines the finest level of detail": a 30-minute Renko uses 30-minute closes/OHLC; smaller timeframes give more accurate bricks).
* "Projection" elements: while the current source bar is open, the not-yet-confirmed bricks/lines/boxes are drawn in the `*ColorProjection` colours; they are "locked in" only when the source bar closes (`IProjectionStudyResult { bars, price, boxSize, reversalAmount, projectionTime }`). The legend shows the effective box size / reversal amount.
* Not available on tick intervals (BETA note). Countdown-to-close is not shown for these styles (no fixed time interval). Bar Replay does not support them. Timestamps: the docs warn that these charts "process data points in sequence", so bar time is not shifted per bar; misaligned datafeed timestamps break them.
* Box size methods: **ATR** (default look-back length **14**, ATR computed on the regular chart and used as the box), **Traditional** (absolute value, "commonly ~1/20 of the instrument price"), **Percentage (LTP)** (default **1 %** of the most recent close, rounded to the tick size; repaints as the last price moves). ATR-based charts recalculate as history/real-time changes.

**Renko (4).** Bricks of equal height (`boxSize`). Rules (help center "Understanding Renko charts"): a new brick is added only when price moves at least one box beyond the previous brick's top (up) or bottom (down); "bricks always have their corners touching" and "there can never be more than one brick in any vertical column". A reversal requires a move of **two boxes** from the last brick's extreme (one to cross the previous brick, one to form the new one). `Source`: `Close` (only closes can create bricks) or `OHLC`/`High-Low` (highs/lows can). Wicks (help center "What do Renko wicks mean?"): drawn from actual prices; a **high wick appears only on a down brick**, a **low wick only on an up brick**, showing a move that went ≥ 1 box but < 2 boxes against the trend without reversing; enabled by default and toggled in Settings → Symbol. Bricks formed inside one source bar occupy consecutive slots (**[GUESS]** each gets the same time label). Style overrides: `renkoStyle.upColor "#089981"`, `downColor "#F23645"`, `borderUpColor "#089981"`, `borderDownColor "#F23645"`, `upColorProjection "#a9dcc3"`, `downColorProjection "#f5a6ae"`, `borderUpColorProjection "#a9dcc3"`, `borderDownColorProjection "#f5a6ae"`, `wickUpColor "#089981"`, `wickDownColor "#F23645"`. Inputs (Settings → Symbol on TV.com): Box size assignment method (ATR/Traditional/Percentage), ATR length (14), Box size, Percentage (1), Source (Close/OHLC), Wicks on/off. Troubleshooting: "if the Renko chart is not displayed, most likely you have chosen a box that is too large"; bricks recalculate because the boundary between higher- and lower-timeframe data used for calculation shifts over time.

**Line break (7, `pbStyle`).** "Number of lines" default **3**. Each new close is compared with the last N lines: a new **up** line only when `close > max(high of last N lines)`; a new **down** line only when `close < min(low of last N lines)`; otherwise no line (price inside the range) — three outcomes: same-colour line (trend extends: close beyond the last line's own extreme), reversal line (colour flips, requires breaking N lines), or nothing. Style: `pbStyle.upColor "#089981"`, `downColor "#F23645"`, `borderUpColor "#089981"`, `borderDownColor "#F23645"`, `upColorProjection "#a9dcc3"`, `downColorProjection "#f5a6ae"`, `borderUpColorProjection "#a9dcc3"`, `borderDownColorProjection "#f5a6ae"`. Inputs: Number of lines (3), Source (Close).

**Kagi (5).** A continuous line: vertical segments for price movement, short horizontal connectors ("shoulders" when an up line turns down, "waists" when a down line turns up"). Direction reverses only when price moves against the current direction by the **reversal amount** (ATR 14 / Traditional / Percentage 1 %). Line thickness: **yang (thick)** when price rises above the previous shoulder, **yin (thin)** when it falls below the previous waist (help center: "green for up and red for down"). Style: `kagiStyle.upColor "#089981"`, `downColor "#F23645"`, `upColorProjection "#a9dcc3"`, `downColorProjection "#f5a6ae"`. Inputs: Reversal amount method, ATR length, Reversal amount, Percentage, Source.

**Point & figure (6).** Columns of X (rising) and O (falling); columns alternate, never two X columns in a row. Box size (ATR/Traditional/Percentage); **reversal amount** (default **3** boxes) = how many boxes price must move against the column to start a new column; Source: `Close` (default) or `High/Low`; "One step back building" = the 1-box-reversal construction method (when reversal amount is 1, an X and an O can share a column). Time is not used for horizontal placement (one column per index slot). Style: `pnfStyle.upColor "#089981"`, `downColor "#F23645"`, `upColorProjection "#a9dcc3"`, `downColorProjection "#f5a6ae"`; TV.com also exposes "Projected up/down bars" colours and X/O rendering.

**Range bars (TV.com only, `range` interval).** Not time-based: a bar opens at `Open`; its `High–Low` grows as price moves; when `High − Low` reaches the range value (1 range = 1 minimum tick; user chooses e.g. `10R`, `100R`) the bar closes and a new one opens; within the range only `Close` updates. "Phantom bars" option fills untraded gaps with virtual bars. Bar or candle rendering with normal bar/candle style options plus projection colours. Ranges are chosen via the interval menu (Ranges: 1, 10, 100, 1000) not the chart-type menu.

### 1.4 Type-independent series options (`mainSeriesProperties.*`)

| Property | Default | Meaning |
|---|---|---|
| `style` | `ChartStyle.Candle` (1) | Active style |
| `visible` | `true` | Hide the main series (`getSeries().setVisible`) |
| `showPriceLine` | `true` | Last-value horizontal line |
| `priceLineWidth` | `1` | |
| `priceLineColor` | `""` | empty = colour of last bar (up/down) |
| `showPrevClosePriceLine` | `false` | Previous close line |
| `prevClosePriceLineWidth` | `1` | |
| `prevClosePriceLineColor` | `"#555555"` | |
| `showCountdown` | `false` | Countdown to bar close on price scale (needs `getServerTime`) |
| `sessionId` | `"regular"` | `"regular"` or `"extended"` |
| `minTick` | `"default"` | override price format, e.g. `"10000,1,false"` |
| `bidAsk.visible` | `false` | bid/ask lines (Trading Platform quotes) |
| `bidAsk.lineStyle` | `LineStyle.Dotted` | |
| `bidAsk.lineWidth` | `1` | |
| `bidAsk.bidLineColor` | `"#2962FF"` | |
| `bidAsk.askLineColor` | `"#F7525F"` | |
| `highLowAvgPrice.highLowPriceLinesVisible` | `false` | high/low of visible range lines |
| `highLowAvgPrice.highLowPriceLabelsVisible` | `false` | labels on scale |
| `highLowAvgPrice.averageClosePriceLineVisible` | `false` | needs featureset `show_average_close_price_line_and_label` |
| `highLowAvgPrice.averageClosePriceLabelVisible` | `false` | |
| `highLowAvgPrice.highLowPriceLinesColor` | `""` | |
| `highLowAvgPrice.highLowPriceLinesWidth` | `1` | |
| `highLowAvgPrice.averagePriceLineColor` | `""` | |
| `highLowAvgPrice.averagePriceLineWidth` | `1` | |
| `statusViewStyle.showExchange` | `true` | legend |
| `statusViewStyle.showInterval` | `true` | legend |
| `statusViewStyle.symbolTextSource` | `"description"` | `"ticker" \| "description" \| "ticker-and-description" \| "long-description"` |
| `priceAxisProperties.percentage` | `false` | scale mode |
| `priceAxisProperties.indexedTo100` | `false` | |
| `priceAxisProperties.log` | `false` | |
| `priceAxisProperties.isInverted` | `false` | |
| `priceAxisProperties.alignLabels` | `true` | prevent label overlap on the scale |

`minTick` accepted values: `"default"` or `"<priceScale>,<minMove>,<frac>"` from the set `{1,10,100,1000,10000,100000,1000000,10000000,100000000} × minMove 1 × frac false` and `{2,4,8,16,32,64,128,320} × minMove 1 × frac true` (UI: Settings → Symbol → Precision).

### 1.5 Chart-type menu behaviour (top toolbar)

* Dropdown lists the styles above (grouped on TV.com: Bars/Candles/Hollow/Volume candles/Line/Line with markers/Step line/Area/HLC area/Baseline/Columns/High-low/Heikin Ashi/Renko/Line break/Kagi/Point & figure/Range), each with a star to favourite (`items_favoriting`); favourites appear as toolbar buttons.
* Featureset `header_chart_type` shows/hides the button. `onChartTypeChanged()` fires with the new `SeriesType`. `setChartType()` returns a promise and throws if the new type cannot load data.
* Switching to a line-based style when `visible_plots_set` is `"c"` is forced; OHLC styles are disabled in the menu for close-only symbols.

---

## 2. TIME SCALE

### 2.1 Model: index space, bar spacing, right offset

* The time scale is an **index scale**, not a time scale: bar `i` is drawn at `x = width - (rightOffset + (baseIndex - i)) * barSpacing` (LWC `indexToCoordinate`). Bars are therefore equally spaced regardless of real time; there are no gaps for nights, weekends or holidays ("the library hides periods with no trading activity to keep the chart continuous"). Whitespace is only inserted when `has_empty_bars` is true (empty bars inside the session) or featureset `inactivity_gaps` is enabled ("inactivity gaps are displayed only within the trading session").
* **Bar spacing** (glossary: "a number of pixels between each data point on the chart. Smaller values show more data"). Defaults [LWC]: `barSpacing 6`, `minBarSpacing 0.5`, `maxBarSpacing 0` (0 = "half of the chart width", i.e. at most zoom-in until 2 bars fill the pane; `MinVisibleBarsCount = 2`). TV-lib exposes `time_scale.min_bar_spacing` in the widget constructor ("should be greater than 0"; warns that tiny values force heavy calculations) and `ITimeScaleApi.setBarSpacing/barSpacing()`. Featureset `low_density_bars` (off): "allows zooming in to one bar in the viewport".
* **Right offset / right margin**: distance in bars between the last bar and the right edge (future/projection area). [LWC default `rightOffset 0`; `rightOffsetPixels` optional and takes precedence.] TV-lib: `ITimeScaleApi.defaultRightOffset(): IWatchedValue<number>` (bars), `defaultRightOffsetPercentage()` (percent of width), `usePercentageRightOffset()` (default `false`), `rightOffset()/setRightOffset(bars)`. UI: Settings → Canvas → Margins → "Right margin" (bars; percent option when featureset `show_percent_option_for_right_margin`; field hidden by disabling `chart_property_page_right_margin_editor`). **[GUESS]** the TV default is 10 bars (value seen in saved-layout JSON `timeScale.rightOffset`), and `lock_visible_time_range_when_adjusting_percentage_right_margin` keeps the visible range fixed while the percent margin changes.
* **Scroll limits** [LWC]: past: `rightOffset >= firstIndex - baseIndex - 1 + min(2, count)` (you can drag until only 2 bars remain visible at the right); future: `rightOffset <= width/barSpacing - min(2, count)` (until only 2 bars remain at the left edge). Featureset `fix_left_edge` (off) "prevents scrolling to the left of the first historical bar" (LWC `fixLeftEdge`: min offset uses `width/barSpacing`). LWC also has `fixRightEdge` (no future scrolling).
* `lock_visible_time_range_on_resize` (off): keep the visible time range when the container is resized (otherwise bar spacing is kept and more/fewer bars are shown).
* `shift_visible_range_on_new_bar` (on): when a new bar arrives and the last bar is visible, the chart shifts left by one slot so the newest bar stays at the same screen position; "if disabled, adding a new bar zooms the chart out preserving the first visible point". [LWC: `shiftVisibleRangeOnNewBar true`, `allowShiftVisibleRangeOnWhitespaceReplacement false`.]
* `right_bar_stays_on_scroll` (**on** in TV-lib): "the bar under the mouse cursor stays in the same place if this feature is disabled". I.e. by default zooming keeps the **rightmost bar/right offset** anchored; when disabled the bar under the cursor is the zoom anchor. [LWC default is the opposite: `rightBarStaysOnScroll false`.]

### 2.2 Scrolling

| Input | Behaviour | Source |
|---|---|---|
| Left-button drag on the pane | pans horizontally (`pressed_mouse_move_scroll`, on). LWC: `scrollTo(x)`: `rightOffset = start + (startX - x)/barSpacing`, clamped by the limits above. Vertical drag on a pane with auto-scale off pans the price scale (`scrollPriceTo`; ignored while auto-scale is on). | TV-lib/LWC |
| Horizontal mouse wheel / trackpad `deltaX` | scroll (`mouse_wheel_scroll`, on). LWC: `scrollChart(deltaX * -80)` px per 100 units of wheel delta, after a speed adjustment for wheel-delta modes. | LWC |
| `Shift` + wheel | move chart left/right | TV shortcuts |
| `←` / `→` | move 1 bar left/right; `Ctrl+←/→` move further | TV shortcuts |
| Touch horizontal drag | scroll (`horz_touch_drag_scroll`, on) | TV-lib |
| Kinetic (inertial) scroll | [LWC] `kineticScroll.touch true`, `kineticScroll.mouse false`; kinetic animation starts only if the last movement was < 50 ms ago (`MaxStartDelay 50`), stops within 1 px of the target (`EpsilonDistance 1`), default animation 400 ms for programmatic `scrollToOffsetAnimated`. TV.com shows the same inertia on touch. | LWC |
| Navigation buttons | bottom-right: **scroll to the most recent bar** (appears when the last bar is off-screen), zoom in / zoom out, and **reset** (control_bar featureset, on; Settings → Canvas → Buttons → navigation buttons visibility `alwaysOn / visibleOnMouseOver / alwaysOff` via `navigationButtonsVisibility()`); `show_zoom_and_move_buttons_on_touch` (off) shows zoom/move buttons on touch devices while the time scale is pressed. | TV-lib |
| API | `scrollPosition()`, `defaultScrollPosition()` (older API), `ITimeScaleApi.setRightOffset`, `setVisibleRange`, `executeActionById("timeScaleReset")` | TV-lib |

`setScrollEnabled(false)` / `setZoomEnabled(false)` disable interaction per chart; featuresets `chart_scroll`, `chart_zoom` do it globally. `rightOffsetChanged()` and `barSpacingChanged()` subscriptions report scroll/zoom.

### 2.3 Zooming

| Input | Behaviour |
|---|---|
| Mouse wheel (vertical delta) over the pane | zoom (`mouse_wheel_scale`, on). LWC: `zoomScale = sign(dy) * min(1, |dy|)` with `dy = -(adj * event.deltaY / 100)`; `newBarSpacing = barSpacing + zoomScale * barSpacing / 10` (≈ 10 % per notch), clamped to [min,max]; anchor = cursor x unless `rightBarStaysOnScroll`. |
| `Ctrl` + wheel | "Zoom in focused area" (TV shortcut) |
| `Ctrl+↑` / `Ctrl+↓` | zoom in / out |
| Drag on the **time axis** | stretch/squeeze (`axis_pressed_mouse_move_scale`, on). LWC `scaleTo(x)`: `barSpacing = startBarSpacing * (width - x) / (width - startX)`, i.e. the right edge is the fixed point. |
| Double-click the time axis | reset time scale (LWC `axisDoubleClickReset.time true`). TV action `timeScaleReset`. |
| Pinch (two fingers) | zoom (`pinch_scale`, on) |
| Zoom buttons / `zoomOut()` | `canZoomOut()`/`canZoomOutWV()`; zoom-out button disabled when at min spacing |
| "Zoom in" tool (left toolbar) | drag a rectangle; the chart zooms to that time range (`selectLineTool("zoom")`) |
| Drag-to-zoom on the time axis | see axis drag above; TV.com also supports drawing a range on the time axis with the zoom tool |

Reset chart: `Alt+R` = `executeActionById("chartReset")` — resets both scales to defaults (auto-scale on, default bar spacing/right offset, scroll to the latest bar). `timeScaleReset` resets only the time scale.

### 2.4 Visible range API and time frames

* `getVisibleRange(): { from, to }` (seconds; includes the empty right margin as future time). `getVisibleBarsRange(): { from, to } | null` returns only real bar times (includes Renko-style projection bars, excludes future slots).
* `setVisibleRange({ from, to? }, { applyDefaultRightMargin?, percentRightMargin?, rejectByTimeout? })` → Promise. If the range cannot fit (small screen) "`to` is considered more prior than `from`" and as much data as possible is rendered; the docs suggest lowering `min_bar_spacing`. LWC `setVisibleRange` sets `barSpacing = (width - pixelOffset)/length` and `rightOffset = range.right - baseIndex`.
* `onVisibleRangeChanged()` subscription with `{from,to}`; `timeframe_interval` widget event fires with `RangeOptions {val, res}` when the bottom toolbar or `setTimeFrame` changes the range.
* `setTimeFrame({ val: { type: 'period-back', value: '12M' } | { type: 'time-range', from, to }, res: '1W' })`. Widget option `timeframe: '3M'` or `{ from, to }` (when a range object is given the chart still requests data up to now so the user can scroll forward). `onIntervalChanged()` callback receives `(interval, { timeframe? })` and may **set** `timeframe` to force a range when the resolution changes.
* **Time-frame toolbar** (bottom-left, featureset `timeframes_toolbar`, on). Defaults and the resolution each one switches to:

| Button | Resolution |
|---|---|
| 5Y | W |
| 1Y | W |
| 6M | 120 |
| 3M | 60 |
| 1M | 30 |
| 5D | 5 |
| 1D | 1 |

Clicking one (1) changes the resolution and (2) scales the bars horizontally so the whole period fits. Custom list via `time_frames: [{ text: "50y", resolution: "6M", description: "50 Years", title?: "50y" }]`; `text` must match `\d+(y|m|d)`; buttons whose resolution the symbol does not support are hidden. tradingview.com shows `1D 5D 1M 3M 6M YTD 1Y 5Y All` ("1D" = one trading day at 1-minute bars; "All" = all history at monthly bars; YTD = year-to-date).
* **Go to date** (`go_to_date` featureset, on; `Alt+G`; also the "Go to" button on the bottom toolbar on TV.com with a Date tab and a "Custom range" tab): scrolls so that the chosen bar is visible (TV.com centres it and flashes the bar with a vertical marker). `requestSelectBar()` puts the chart into bar-selection mode (crosshair only, resolves with the clicked bar time; `cancelSelectBar()`, `isSelectBarRequested()`).
* `barTimeToEndOfPeriod(unixTime)` / `endOfPeriodToBarTime(unixTime)` convert between a bar's start time and its end-of-period time; featureset `end_of_period_timescale_marks` (off) makes time-scale labels show the bar's **end** time instead of its start.

### 2.5 Time-axis labels (tick marks)

TV-lib exposes only `custom_formatters.tickMarkFormatter(date: Date /*UTC*/, tickMarkType: "Year" | "Month" | "DayOfMonth" | "Time" | "TimeWithSeconds" | "TimeWithMilliseconds")` and Settings → Scales → "Date format" (`DateFormat` union: `"qq 'yy" | "qq yyyy" | "dd MMM 'yy" | "MMM 'yy" | "MMM dd, yyyy" | "MMM d, yyyy" | "MMM yyyy" | "MMM dd" | "dd MMM" | "yyyy-MM-dd" | "yy-MM-dd" | "yy/MM/dd" | "yyyy/MM/dd" | "dd-MM-yyyy" | "dd-MM-yy" | "dd/MM/yy" | "dd/MM/yyyy" | "MM/dd/yy" | "MM/dd/yyyy"`, watched value `dateFormat()`) and "Time hours format" (`"24-hours" | "12-hours"`, `timeHoursFormat()`; featuresets `scales_date_format`, `scales_time_hours_format`). The crosshair time label and the Go-to/date labels use the date format; axis tick labels use the algorithm below. The exact algorithm is the Lightweight Charts one [LWC]:

1. **Weight per point.** For each bar compare with the previous bar (UTC): different year → `Year` (weight 70 in LWC), different month → `Month` (60), different day → `Day` (50); otherwise the largest intraday divisor that changed: 12h (45), 6h (44), 3h (43), 1h (42), 30 min (41), 5 min (40), 1 min (30), 1 s (20), else `LessThanSecond` (19). The first point's weight is guessed by extrapolating the average spacing backwards.
2. **Selection.** `maxLabelWidth = (fontSize + 4) * 5 / 8 * tickMarkMaxCharacterLength(8)` px; `indexPerLabel = round(maxLabelWidth / barSpacing)`. Marks are chosen by descending weight; a mark of lower weight is kept only if it is at least `maxIndexesPerMark = ceil(maxLabelWidth / barSpacing)` bars from already-placed marks on both sides (`TickMarks.build`). With `uniformDistribution` a weight level is used all-or-nothing.
3. **Formatting** (`defaultTickMarkFormatter`, using the chart locale): `Year → "2024"` (`year: numeric`), `Month → "Jan"` (`month: short`), `DayOfMonth → "17"`, `Time → "09:30"` (24 h, 2-digit), `TimeWithSeconds → "09:30:15"`. Which type is used for a mark: year-start marks → Year, month-start → Month, day-start → DayOfMonth, else Time/TimeWithSeconds (seconds when `secondsVisible` and resolution < 1 min). `allowBoldLabels true` renders the higher-weight (year/month) labels bold; `ticksVisible false` (small tick lines under labels off by default); `timeVisible` false for daily+ (only dates shown) and true for intraday.
4. **Edge handling.** Labels near the edges are shifted inward instead of being clipped when scrolling past them is impossible (`needAlignCoordinate`); TV-lib featureset `cropped_tick_marks` (on) "shows partially visible price labels on the price axis" (the analogous behaviour on the price scale).

tradingview.com behaviour matches: e.g. on a 1D chart the axis shows `2023`, `Feb`, `Mar`... and day numbers in between as spacing allows; on intraday charts it shows `09:30`, `10:00`, and day/month labels at session boundaries; the label of a new day/month/year is bold.

### 2.6 Time zones

* Widget `timezone: "exchange" | Timezone` (default `"Etc/UTC"` when omitted — the docs say "default chart time zone"; `"exchange"` uses the symbol's exchange time zone). Override `"timezone"` in `overrides`/`applyOverrides({ timezone: "Europe/Belgrade" })`; API `getTimezoneApi(): { getTimezone(): TimezoneInfo, setTimezone(id, {disableUndo?}), availableTimezones(), onTimezoneChanged() }`.
* UI: bottom toolbar time zone dropdown (featureset `timezone_menu`, on) and Settings → Symbol → Timezone. tradingview.com lists "Exchange" first, then UTC and the city list.
* Supported ids: `Etc/UTC` + the `CustomTimezones` union (see Appendix D: Africa/Cairo … US/Mountain, 100+). `custom_timezones: [{ id, alias, title }]` adds entries aliased to a built-in zone or a GMT zone `Etc/GMT±H[:MM]` (POSIX sign convention: `Etc/GMT+2` is 2 h **behind** UTC).
* The time zone only changes how times are **displayed**; bar alignment is governed by the symbol's exchange `timezone` + `session`. DST is handled by the library.

### 2.7 Sessions, holidays, corrections and bar alignment

Symbol `session` strings (exchange time zone):
* `24x7` (00:00→00:00 every day incl. weekend); intraday `0930-1600` (Mon–Fri); `0000-0000` = intraday full day.
* Overnight: start > end (`1600-0930`) or start == end (`1700-1700`) starts the previous day; `F` suffix = previous day (`1700F-2200`), `Fn` = n days back (`1900F3-1900`, n ≤ 6); values > 2400 (`0930-2730`) span midnight without being "overnight".
* Multiple sessions per day: comma (`0930-1400,1430-1700`). Day-specific: `:n` with 1 = Sunday … 7 = Saturday, `|` separates alternatives (`0900-1400:2|0900-1630`). First day of week: `1;0900-1630` (Sunday) or `…;6`.
* Session history: `SESSION#YYYYMMDD/SESSION` (switch takes effect on the first day of the week of the new session).
* `session_display`: what the UI shows/aligns labels to (e.g. session `0900-HHMM`, display `0915-HHMM` gives bars at 09:15, 10:00, 11:00 …).
* `session_holidays: "20181105,20181107"` (days with no bars), `corrections: "1000-1845:20181113;1000-1400:20181114"` (per-day session overrides, higher priority than holidays; multiple dates comma-separated latest first).
* **Bar timestamp rule**: the first bar of a session starts at the session open; following bars are `open + k * resolution` (session end is non-inclusive: `0930-1630` at 60 min → `09:30 … 15:30`). Bars outside the session are **ignored**; bars with a time that is not on the grid are **shifted to the nearest expected (earlier) slot** ("Library shifts bar time"); `disable_resolution_rebuild` shows times exactly as given and disables resolution building. Daily/weekly/monthly bars must be **00:00:00 UTC of the trading day** ("not the beginning of the session"; do not convert by time zone). Real-time updates must use the bar **start** time.
* Extended sessions: `subsessions: [{ id: "regular"|"extended"|"premarket"|"postmarket", session, description, "session-correction"?, "session-display"? }]`, `subsession_id` = currently displayed (`"regular"` or `"extended"`), `symbolInfo.session` must equal the displayed subsession's session. Enable with featureset `pre_post_market_sessions`; default via `mainSeriesProperties.sessionId`; switching (bottom-toolbar dropdown or Settings → Symbol → Session, or `applyOverrides`) makes the library call `resolveSymbol(name, …, { session })` again and reload all data. Pre/post market areas are shaded: overrides `backgrounds.preMarket.color "rgba(200,0,0,0.08)"` (example), `backgrounds.postMarket.color "rgba(0,0,200,0.08)"` (example), `backgrounds.outOfSession.color` (user-editable in Chart settings). Extended sessions are visible only on intraday resolutions. TV.com additionally has a **24h** session for BOATS US stocks and an **ETH/RTH toggle button** in the bottom-right (hidden if the symbol has no extended data).
* **Session breaks**: Settings → Scales/Appearance "Session breaks" toggles vertical dashed lines at session starts (override key **[GUESS]** `paneProperties.vertGridProperties`-adjacent; TV.com setting name "Session breaks" with colour/style/width). Market status pop-up in the legend shows the session timeline in the exchange time zone.

### 2.8 Resolutions (intervals)

Format (`ResolutionString`): ticks `xT`, seconds `xS`, minutes `x` (hours are minutes: `60`, `120`, `240`), days `xD`, weeks `xW`, months `xM` (years as months: `12M`); the number may be omitted when it is 1 (`D`, `W`, `M`). Resolution-to-seconds: `T` has none; `S` ×1; plain ×60; `D` ×86400; `W` ×604800; `M` = calendar month (variable). Featuresets: `seconds_resolution` (off), `tick_resolution` (off), `custom_resolutions` (off, "Add custom interval…" in the menu), `show_interval_dialog_on_key_press` (on, typing digits/`,` opens the interval dialog; typing `2h` is accepted in the UI but the API expects `120`).

Availability logic (d.ts): `resolutionAvailable = resolution.isIntraday ? has_intraday && supported_resolutions(r) : supported_resolutions(r)`; `supported_resolutions: []` disables all; `undefined` allows everything in `DatafeedConfiguration.supported_resolutions` plus custom ones. Unsupported resolutions are greyed in the menu; if the new symbol does not support the current resolution the library switches to the first available one.

Building resolutions: the library builds larger intervals from the ones listed in `seconds_multipliers`, `intraday_multipliers`, `daily_multipliers (["1"])`, `weekly_multipliers (['1'])`, `monthly_multipliers (['1'])` (e.g. 5 min from 1 min, 2W from 1W, 3D from 1D). It **cannot** build daily/weekly/monthly from intraday, nor seconds+ from ticks (except `build_seconds_from_ticks`, Trading Platform). If `has_weekly_and_monthly` is false it builds weeks/months from daily bars. Alignment of built bars: weekly bars start on the session's first day of week; monthly on the first trading day of the month; daily bars are keyed by trading day at 00:00 UTC.

tradingview.com interval menu groups: Ticks (1, 10, 100, 1000), Seconds (1, 5, 10, 15, 30, 45), Minutes (1, 2, 3, 5, 10, 15, 30, 45), Hours (1, 2, 3, 4), Days (1D, 1W, 1M, 3M, 6M, 12M), Ranges (1, 10, 100, 1000); favourites via star; typed input up to 1440 minutes; custom intervals like "2.5 hours" or "205 minutes" or "82 days".

### 2.9 Data loading (Datafeed API) — how history is requested

Sequence on first open: `onReady(cb)` → `resolveSymbol(name, onResolve, onError, extension?)` (called twice when `name != ticker`) → `getBars(symbolInfo, resolution, periodParams, onResult, onError)` repeatedly → `subscribeBars(...)`. On symbol switch: `resolveSymbol` → `getBars` → `subscribeBars` for the new dataset, then `unsubscribeBars` for the old one after ~5 s.

`PeriodParams { from: number /*s, leftmost*/, to: number /*s, rightmost, exclusive*/, countBack: number, firstDataRequest: boolean }`.
* The library computes how many bars fill the viewport (+ extra history that indicators need, e.g. MA length) and requests `countBack` bars ending at `to`. "It is more important to pass the required number of bars than to match the `[from, to)` range": return **all** bars in the range and, if fewer than `countBack`, extend **earlier** until `countBack` is reached; never truncate a range with more than `countBack` bars; return at least 2 bars; do not include the bar at `to` again.
* If the response has fewer bars than needed, `getBars` is called again for the remainder (debug log example: 329 → 157, then 172 → 169, then 3 → 2, then 2). When there is no more history, respond `onResult([], { noData: true })` — otherwise infinite requests. Legacy alternative: `{ noData: true, nextTime: <ms> }` where `nextTime` is the time of the closest available bar **in the past** so the next request targets it.
* `firstDataRequest` is true for the first request of a dataset. Featureset `determine_first_data_request_size_using_visible_range` (off) sizes the first request from the visible bar count; `request_only_visible_range_on_reset` (off) re-requests only the visible range after `resetData()`.
* Lazy loading: as the user scrolls left, more `getBars` calls are issued for older ranges ("The library caches historical data. Therefore, you do not need to implement a client-side cache"); `onDataLoaded()` fires after each load. Indicators that need deep history (VWAP, pivots) appear only after the user scrolls enough data in.
* Bars must be ascending and unique in time ("Assertion failed: data must have unique times"), prices numeric. `Bar { time: ms, open, high, low, close, volume? }`. Single-price feeds: set O=H=L=C or `visible_plots_set: "c"`.
* Real time: `subscribeBars(symbolInfo, resolution, onTick, listenerGuid, onResetCacheNeededCallback)`; call `onTick(bar)` with the **complete current bar**; a bar with the same `time` as the last bar **replaces it entirely** (no field merge); a newer time appends a new bar; an older time throws *putToCacheNewBar: time violation*. A new bar is not pre-created at period end; it appears with the first tick of the new period. A dataset = symbol + resolution + currency + chart type; identical datasets share one subscription. `unsubscribeBars(listenerGuid)` is called ~5 s after the subscription is no longer needed (keep sending until then).
* Cache reset: `onResetCacheNeededCallback()` (from `subscribeBars`) or `widget.resetCache()` clears cached bars for the dataset/all; then call `chart.resetData()` to re-request (used for reconnection and for changing historical data). `widget.subscribe('onTick', bar)` fires on each last-bar update.
* `getServerTime(cb)` (when `supports_time`) returns Unix seconds once; used for the countdown and for aligning "now". `getMarks`/`getTimescaleMarks` (Section 8.10). `searchSymbols(userInput, exchange, symbolType, onResult)` / `searchSymbolsPaginated(options, onResult)`.
* UDF adapter endpoints: `/config`, `/symbol_info?group=`, `/search?query&type&exchange&limit`, `/symbols?symbol=`, `/history?symbol&from&to&resolution&countback` → `{ s: "ok"|"no_data"|"error", t[], o[], h[], l[], c[], v[], nextTime?, errmsg? }`, `/marks`, `/timescale_marks`, `/time`, `/quotes?symbols=`; `UDFCompatibleDatafeed(url, updateFrequency = 10000 ms, limitedServerResponse?)`. Default config when `/config` is missing: `supported_resolutions ['1','5','15','30','60','1D','1W','1M']`, `supports_group_request true`, others false.

### 2.10 `LibrarySymbolInfo` fields (complete)

| Field | Type / default | Meaning |
|---|---|---|
| `name` | string, required | Symbol name within the exchange, shown to users; may repeat; used for requests unless `ticker` given |
| `ticker` | string? | Unique id used in all data requests; avoid `:` unless `EXCHANGE:SYMBOL` |
| `base_name` | string[]? | Base symbols for spreads (`['NASDAQ:AAPL','NASDAQ:MSFT']`) |
| `description` | string, required | Legend title |
| `long_description` | string? | Longer description (featureset `symbol_info_long_description`) |
| `type` | `SymbolType` string | `stock, index, forex, futures, bitcoin, crypto, undefined, expression, spread, cfd, economic, equity, dr, bond, right, warrant, fund, structured, commodity, fundamental, spot, swap, option, ndf` |
| `session` | string, required | trading hours (Section 2.7) |
| `session_display` | string? | hours shown in UI |
| `session_holidays` | string? | `YYYYMMDD,...` |
| `corrections` | string? | `SESSION:YYYYMMDD;...` |
| `exchange` | string, required | current (proxy) exchange, shown in legend |
| `listed_exchange` | string, required | real listing exchange |
| `timezone` | `Timezone`, required | exchange time zone (OlsonDB) |
| `format` | `"price" \| "volume"`, required | price-scale label formatting |
| `pricescale` | number, required | `10^n` decimals or `2^n` fractions |
| `minmov` | number, required | tick = `minmov / pricescale` |
| `fractional` | boolean, false | fractional display `x'y` |
| `minmove2` | number? | fraction of a fraction (`x'y'z`), or `10` on forex/cfd to show **pips** |
| `variable_tick_size` | string? | `'0.01 10 0.02 25 0.05'` = tick 0.01 up to 10, 0.02 up to 25, 0.05 above |
| `has_intraday` | boolean, false | intraday data available |
| `supported_resolutions` | ResolutionString[]? | per-symbol list |
| `intraday_multipliers` | string[]? default `[]` | minute resolutions the feed provides |
| `has_seconds` | boolean, false | |
| `has_ticks` | boolean, false | |
| `seconds_multipliers` | string[]? | |
| `build_seconds_from_ticks` | boolean, false | Trading Platform |
| `has_daily` | boolean, **true** | |
| `daily_multipliers` | string[] `["1"]` | |
| `has_weekly_and_monthly` | boolean, false | if false weeks/months are built from daily |
| `weekly_multipliers` | `['1']` | |
| `monthly_multipliers` | `['1']` | |
| `has_empty_bars` | boolean, false | fill gaps inside the session with empty bars (incompatible with `disable_resolution_rebuild`) |
| `visible_plots_set` | `"ohlcv" \| "ohlc" \| "c" \| "hlc"`, `'ohlcv'` | which values exist; `"c"` restricts to line styles and hides Volume |
| `volume_precision` | number, 0 | decimals for volume |
| `data_status` | `"streaming" \| "endofday" \| "delayed_streaming"` | legend "D" icon / "Data is delayed" (featureset `display_data_mode`) |
| `delay` | number | 0 realtime, -1 end-of-day, else seconds |
| `expired` | boolean, false | expired futures |
| `expiration_date` | number? | Unix s; data requested from there |
| `sector`, `industry` | string? | Security Info dialog |
| `currency_code` / `original_currency_code` | string? | currency shown on scale / Security Info; conversion via `currency_codes` |
| `unit_id` / `original_unit_id` / `unit_conversion_types` | | unit conversion |
| `subsession_id`, `subsessions` | | extended sessions |
| `price_source_id`, `price_sources: [{id,name}]` | | legend price-source label (featureset `symbol_info_price_source`) |
| `logo_urls` | `[url]` or `[url,url]` | symbol logo (two = overlapping circles, e.g. forex flags); featureset `show_symbol_logos` |
| `exchange_logo` | string? | featureset `show_exchange_logos` |
| `library_custom_fields` | Record | passthrough (readable via `symbolExt()`) |

Price format examples: tick 0.01 → `minmov 1, pricescale 100`; tick 0.0125 → `125 / 10000`; tick 0.25 (ES) → `25 / 100`; 1/32 → `minmov 1, pricescale 32, fractional true`; 1/4 of 1/32 (ZB) → `minmov 1, pricescale 128, minmove2 4, fractional true` → displayed `119'16'2` = 119 + 16.25/32. `format: "volume"` formats in K/M/B/T.

---

## 3. PRICE SCALE

### 3.1 Modes

`PriceScaleMode`: `Normal = 0`, `Log = 1`, `Percentage = 2`, `IndexedTo100 = 3`. Set at start with overrides `mainSeriesProperties.priceAxisProperties.{log|percentage|indexedTo100|isInverted}` (all `false`), at runtime only with `IPriceScaleApi.setMode(mode)` (not via `applyOverrides`). UI: price-scale context menu / settings gear ("Auto (fits data to screen)", "Regular", "Percent", "Indexed to 100", "Logarithmic", "Invert scale"), shortcuts `Alt+L` (log), `Alt+P` (percent), `Alt+I` (invert). tradingview.com also shows small "auto", "log" toggle buttons at the bottom of the price scale ("A" / "L" glyphs; the settings button below the scale is replaced by a letter per scale when there are several scales — click the letter to open that scale's settings).

Conversions [LWC `price-scale-conversions.ts`] — `baseValue` = first visible value of the series:
* Percentage: `toPercent(v) = 100 * (v - base) / base` (sign-flipped if `base < 0`); inverse `fromPercent(p) = p/100 * base + base`.
* Indexed to 100: `toIndexed(v) = 100 * (v - base) / base + 100`; inverse `(v - 100)/100 * base + base`. Help center: "the first value on the chart is set to 100 … we add the percentage change of each symbol relative to the first value".
* Logarithmic: `toLog(p) = sign(p) * (log10(|p| + coordOffset) + logicalOffset)` with default `logicalOffset 4`, `coordOffset 0.0001`; for ranges smaller than 1 the formula adapts: `digits = ceil(|log10(range)|)`, `logicalOffset = 4 + digits`, `coordOffset = 10^-logicalOffset`. Prices whose `|p| < 1e-15` map to 0. The formula is recomputed on autoscale when the raw range changes (`logFormulaForPriceRange`).
* Modes percentage/indexed disable manual **scaling** and **dragging** of the scale (`startScale`/`startScroll` return early) — the scale is always auto in those modes [LWC]. Switching mode converts the current range and, if conversion is impossible, re-enables auto scale.
* In percentage/indexed modes all series/indicators on that scale are plotted relative to their own first visible value (used by "Compare" to overlay symbols; Compare dialog offers "Same % scale").

### 3.2 Auto scale, margins, lock, "scale series only"

* **Auto** (default on): the visible price range is recomputed from the visible bars of every visible source attached to the scale (`autoscaleInfo(left,right)`), merged, converted to the mode, then margins applied. A degenerate range (min == max) is extended by ±`5 * minMove`. Empty scale defaults to [-0.5, 0.5]. Sources may add pixel margins (`marginAbove/Below`, e.g. for markers). Edge tick marks may add padding (`ensureEdgeTickMarksVisible`).
* **Margins**: TV `paneProperties.topMargin 10` (%), `paneProperties.bottomMargin 8` (%) ("pane auto scaling top/bottom margin percentage"; Settings → Canvas → Margins top/bottom). [LWC `scaleMargins {top:0.2, bottom:0.1}`.] Internal height = `height - topMargin% * height - bottomMargin% * height - extra margins`; inverted scales swap them.
* Any manual scale drag turns auto off (`setMode({autoScale:false})`); the "Auto" button/menu item or a **double-click on the price scale** turns it back on (LWC `axisDoubleClickReset.price true`); `Alt+R` resets everything; context-menu "Reset price scale" appears only when the scale is in a non-default state (not for left/right move or log).
* Featureset `axis_pressed_mouse_move_scale` (on) enables drag-to-scale on both axes.
* **Lock** (`isLocked()/setLocked()`; UI "Lock scale" in the price-scale menu): prevents the scale from changing when auto-scale or scrolling would move it (**[GUESS]** exact semantics: fixes the current visible price range until unlocked).
* **Lock price to bar ratio** (`getPriceToBarRatio()`, `setPriceToBarRatio(ratio, {disableUndo?})`, `isPriceToBarRatioLocked()`, `setPriceToBarRatioLocked(bool)`; UI: price-scale context menu and Settings → Scales and lines): keeps the price-per-pixel to bars-per-pixel ratio constant, so horizontal zoom also rescales price (used to keep angles of trend lines constant). When locked, zooming with the wheel changes both scales.
* **Scale price chart only** (`scalesProperties.scaleSeriesOnly false`, action `scaleSeriesOnly`): auto-scale considers only the main series and ignores Compare series/indicators on the same scale; drag-scaling likewise only scales the series. Help center: "will disable scaling of indicators or other chart elements".
* **Invert scale** (`setInverted`, `isInverted`, `Alt+I`): price increases downward; labels, drag direction and margins flip.
* `setVisiblePriceRange({from,to})` / `getVisiblePriceRange()` set an explicit range (turns auto off).
* Vertical **drag inside the pane** (not on the axis) pans the price range only when auto-scale is off (LWC `scrollPriceTo` returns if auto). On TV.com the same applies (dragging the chart body vertically after you disabled auto-scale).

### 3.3 Dragging and double-click on the axis

* Drag on the axis [LWC `scaleTo`]: with `s = startY` measured from the bottom, `k = (s + (h-1)*0.2) / (y + (h-1)*0.2)`, clamped to `k >= 0.1`, and the snapshot range is scaled around its centre by `k`. Dragging **down** expands the range (zooms out), dragging **up** compresses. Auto-scale is switched off on the first move.
* Double-click on the axis → auto scale on (reset). Right-click → price-scale context menu. Hover shows the axis highlight colour when a drawing is being placed (`scalesProperties.axisHighlightColor "rgba(41, 98, 255, 0.25)"`).
* Touch: single-finger drag on the axis scales; long press opens the context menu (mobile docs).

### 3.4 Labels on the scale

Override defaults (`scalesProperties.*`):

| Property | Default | UI name (Settings → Scales and lines) |
|---|---|---|
| `showSeriesLastValue` | `true` | Symbol last value label (action `showSeriesLastValue`) |
| `seriesLastValueMode` | `LastValueAccordingToScale (1)` | `0 = LastPriceAndPercentageValue` shows price + % change in the label |
| `showStudyLastValue` | `true` | Indicator last value label (action `showStudyLastValue`) |
| `showSymbolLabels` | `false` | Symbol name label next to the last value (action `showSymbolLabelsAction`) |
| `showStudyPlotLabels` | `false` | Indicator name labels (action `showStudyPlotNamesAction`) |
| `showBidAskLabels` | `false` | Bid/ask labels (Trading Platform quotes) |
| `showPrePostMarketPriceLabel` | `true` | Pre/post-market price label (featureset `pre_post_market_price_line`, needs quote `rtc`) |
| `showPriceScaleCrosshairLabel` | `true` | crosshair price label |
| `showTimeScaleCrosshairLabel` | `true` | crosshair time label |
| `crosshairLabelBgColorLight` | `"#131722"` | |
| `crosshairLabelBgColorDark` | `"#363A45"` | |
| `axisLineToolLabelBackgroundColorCommon` | `"#2962FF"` | label of a selected drawing on the axis |
| `axisLineToolLabelBackgroundColorActive` | `"#143EB3"` | while the drawing is being dragged |
| `lineColor` | `"rgba(42, 46, 57, 0)"` | axis border line |
| `textColor` | `"#131722"` | axis text |
| `fontSize` | `12` | axis font size (Settings → Canvas → Scales → Text size) |
| `mainSeriesProperties.priceAxisProperties.alignLabels` | `true` | "No overlapping labels": labels are pushed apart vertically instead of overlapping |
| `mainSeriesProperties.highLowAvgPrice.highLowPriceLabelsVisible` | `false` | High/low labels of the visible range ("Indicator values / High and low price labels") |
| `mainSeriesProperties.highLowAvgPrice.averageClosePriceLabelVisible` | `false` | average close label |

Additional facts:
* The **last price label** is a rectangle with the price text, background = series up/down colour (or `priceLineColor`), text white; with `seriesLastValueMode 0` it shows two lines (price and %). It is drawn at the last bar's close even when scrolled off-screen ("global last bar value"); featureset `hide_price_scale_global_last_bar_value` (off) hides it when the last bar is outside the visible range; `hide_last_na_study_output` hides N/A indicator outputs; `use_last_visible_bar_value_in_legend` affects the legend only.
* **Countdown to bar close**: rendered as `hh:mm:ss` (or `d h:m`) under the price in the last-price label; toggle `mainSeriesProperties.showCountdown` (`false`), price-scale menu "Countdown to bar close" (action `showCountdown`, featureset `countdown` on); requires `supports_time` + `getServerTime`. Help center: not shown for Renko/Kagi/PnF/Line Break/Range, hidden when the market is closed on intraday charts (no bar waiting to close), hidden on delayed symbols for intervals shorter than the delay, wrong if the PC clock is off.
* The price scale also hosts labels for: indicator plots (`trackprice`/last value per plot, colour = plot colour), Compare series (`auto_enable_symbol_labels` on: symbol name labels appear automatically when comparing), drawings' price labels (horizontal line "Show price" label; when a drawing is selected its anchor prices are shown with `axisLineToolLabelBackgroundColorCommon`), orders/positions (Trading Platform), bid/ask, pre/post-market, alerts (TV.com).
* Featureset `cropped_tick_marks` (on): partially visible tick labels at the top/bottom are still drawn (cropped) instead of hidden; LWC `entireTextOnly false` is the same idea.
* Currency/unit: `pricescale_currency`, `pricescale_unit` featuresets show Currency/Unit menus in Settings → Scales; `currency_code` shown on the scale; `currencyAndUnitVisibility()` watched value (`alwaysOn / visibleOnMouseOver / alwaysOff`).
* Exchange label on the scale: hidden by `hide_object_tree_and_price_scale_exchange_label`.

### 3.5 Tick marks and price formatting on the axis

* Tick density [LWC]: `tickMarkHeight = ceil(fontSize * tickMarkDensity(2.5))`; `maxTickSpan = (high - low) * tickMarkHeight / scaleHeight`; the tick span is the minimum produced by three `PriceTickSpanCalculator`s with base `minMove` and multipliers `[2, 2.5, 2]`, `[2, 2, 2.5]`, `[2.5, 2, 2]` (yielding "nice" steps 1, 2, 5, 10 … × tick size). Marks are placed at `logical = high - (high mod span) - k*span`; in log mode marks closer than `tickMarkHeight` px are skipped. Labels are formatted with the symbol's price formatter (`priceFormatter().format(price)`), i.e. `pricescale/minmov/fractional/minmove2/variable_tick_size` rules; in percent mode `"12.34%"`; volume format K/M/B/T.
* Grid: horizontal grid lines are drawn at every tick mark (`paneProperties.horzGridProperties.*`), vertical grid lines at every time tick mark.
* `custom_formatters.priceFormatterFactory(symbolInfo, minTick)` overrides formatting; `numeric_formatting: { decimal_sign, grouping_separator }` (default `.` / none) changes separators everywhere (scale, legend, dialogs).
* `INumberFormatter` returned by `priceFormatter()`/`mainSeriesPriceFormatter()` has `format(value)` and optional `formatChange(price, prevPrice)`.

### 3.6 Multiple price scales and placement

* A pane can have **up to 8 price scales**, left and/or right; only one is shown on mobile. `priceScaleSelectionStrategyName: "left" | "right" | "auto"` (default `'auto'` = spread new scales evenly) decides where the main series' scale (and new scales) go. Users move a scale with the context-menu "Move scale to left/right"; API `getSeries().changePriceScale("new-left" | "new-right" | "no-scale" | <entityId>)`.
* Indicator/series scale assignment (`StudyPriceScale`): `new-left`, `new-right`, `no-scale` (overlay, no axis — "No Scale" mode), `as-series` (attach to the main series' scale; falls back to a new scale if the pane has no series). If the 8-scale limit is hit, `new-*` degrades to No Scale. UI: series/indicator context menu "Pin to scale" → *Pinned to right scale (A)*, *Pinned to left scale*, *New right scale*, *New left scale*, *No scale (fullscreen)*; Compare dialog: *Same % scale*, *New price scale*, *New pane*.
* Scales are lettered (A, B, …) when more than one exists; the letter button below the scale opens its settings (`main_series_scale_menu` featureset shows/hides that button). `IPaneApi.getLeftPriceScales()/getRightPriceScales()/getMainSourcePriceScale()/getPriceScaleById(id)`, `IPriceScaleApi.getStudies()`, `hasMainSeries()`.
* `hide_price_scale_if_all_sources_hidden` (off) hides a scale when everything attached to it is hidden; `clear_price_scale_on_error_or_empty_bars` (on) clears the scale when the main series errors/has no bars.
* Price-scale width = widest label + padding; scales on the same side across panes share one width (aligned) [LWC: `optimalWidth` computed across panes; `minimumWidth 0`].

### 3.7 Price-scale context menu (right-click on the axis)

Items observed on tradingview.com / library (`scales_context_menu` featureset): **Reset price scale** (only when non-default) · **Auto (fits data to screen)** ✓ · **Lock scale** · **Scale price chart only** · **Invert scale** · **Regular / Percent / Indexed to 100 / Logarithmic** (radio) · **Merge all scales into one** (Right / Left) · **Move scale to left / right** · **Labels** submenu (Symbol last price value, Symbol name label, Indicator last value, Indicator name label, Bid and ask labels, High and low labels, Countdown to bar close, Pre/post market price label, Plus button (Trading Platform)) · **Lines** submenu (Symbol price line, Bid and ask lines, High and low lines, Average close price line, Previous close price line, Pre/post market price line) · **Lock price to bar ratio** · **Text size** (currency/unit when enabled). The exact set/ordering is **[GUESS]** reconstructed from the actions (`showCountdown`, `showSeriesLastValue`, `showSymbolLabelsAction`, `showStudyLastValue`, `showStudyPlotNamesAction`, `scaleSeriesOnly`, `addPlusButton`, `scalesProperties`) and the help center.

### 3.8 The "plus" button

`chart_crosshair_menu` (on, Trading Platform): hovering the price scale shows a **+** button that follows the cursor with the exact value; clicking opens a menu for quick trading (buy/sell limit/stop at that price) — empty unless the Broker API is implemented. Event `onPlusClick({ symbol, price, clientX, clientY, ... })`; action `addPlusButton` toggles the feature. On tradingview.com the same button offers **"Add alert at <price>"**, **"Add horizontal line"** and quick orders. Alerts themselves are TV.com-only (Section 10).

### 3.9 Lines drawn from the price scale

* **Price line** (`showPriceLine true`, width 1, colour = last bar colour): dashed horizontal line at the last close across the pane (LWC `priceLineStyle Dashed`, `priceLineSource LastBar`).
* **Previous close line** (`showPrevClosePriceLine false`, `#555555`, width 1).
* **High/low lines** of the visible range (`highLowPriceLinesVisible false`), **average close line** (needs featureset).
* **Bid/ask lines** (`bidAsk.visible false`, dotted, `#2962FF` bid / `#F7525F` ask; Trading Platform quotes).
* **Pre/post-market price line** (`pre_post_market_price_line`, quote `rtc`): shown only while the chart displays the regular session during pre/post hours.
* All of these have matching labels on the scale (see 3.4).

---

## 4. PANES

* A **pane** is "an area on the chart where a series or indicator is displayed". The chart is a vertical stack of panes sharing one time scale; each pane has its own price scales (left/right, up to 8), legend, and background.
* **Placement of new indicators** (Indicator placement page): *price* indicators (values in the price range, e.g. MA, Bollinger; `is_price_study`) go on the source's pane and scale; *non-price* indicators (e.g. Stochastic 0–100) go on a **new pane below** with a new price scale. `createStudy(name, forceOverlay=true)` puts a non-price indicator on the source pane (does not change its scale). Volume: `create_volume_indicator_by_default` (on) + `volume_force_overlay` (on) → Volume is added as an **overlay on the main pane** in "No scale" mode at the bottom; `volumePaneSize` override (`PaneSize.Tiny|Small|Medium|Large`, default `Large`) controls how much of the pane height the volume histogram occupies when overlaid; `create_volume_indicator_by_default_once` prevents re-adding after a symbol/resolution change.
* **Move to** context-menu (indicator legend or right-click): *Existing pane above*, *New pane above*, *Existing pane below*, *New pane below*; API `IStudyApi/ISeriesApi.mergeUp/mergeDown/unmergeUp/unmergeDown`. `linkedToSeries` indicators cannot be moved. `panes_order_changed` and `panes_height_changed` widget events.
* **Separators**: a horizontal bar between panes; drag to resize adjacent panes (`paneProperties.separatorColor "#EBEBEB"`; user-editable in Settings → Canvas → "Pane separator" colour/opacity, visible only when there is more than one pane). [LWC: `layout.panes.enableResize true`, `separatorColor '#E0E3EB'`, `separatorHoverColor 'rgba(178,181,189,0.2)'`.] Minimum pane height is not documented (**[GUESS]** ~30–40 px; LWC clamps so that every pane keeps at least a few px).
* **Pane buttons** (hover the top-right corner of a pane; visibility via Settings → Canvas → Buttons → "Pane buttons" and `paneButtonsVisibility()` watched value `alwaysOn / visibleOnMouseOver / alwaysOff`): **move up**, **move down**, **collapse/restore**, **maximize/restore**, **delete pane** (removes all sources in it). Keyboard: **double-click a pane to toggle maximize**, **Ctrl + double-click to toggle collapse**. API: `IPaneApi.getHeight/setHeight/moveTo(index)/paneIndex/collapse/restore/isCollapsed/setMaximized/isMaximized`; `getAllPanesHeight()/setAllPanesHeight([...])`; `maximizeChart()/restoreChart()/isMaximized()` for the whole chart in multi-chart layouts (`Alt+Enter`, or the "Maximize chart" button bottom-right).
* Each pane draws its own **legend** (top-left) listing the sources on that pane; the main pane's legend also carries the symbol row. Crosshair vertical line is shared by all panes; the horizontal line and price label appear only in the hovered pane.
* Drawings belong to a pane (`ownerStudyId` attaches a drawing to an indicator's pane; drawings follow the indicator when it moves and are deleted with it). Drawing groups must be within one pane.
* TV.com: pane height is stored in the layout; "Collapse" keeps a slim header; maximised pane hides the others until restored.

---

## 5. CROSSHAIR & LEGEND

### 5.1 Crosshair

* Cursor tools (left toolbar, top group): **Cross** (default), **Dot**, **Arrow**, **Eraser** (TV.com also *Demonstration* and *Magic*). Only Cross and Dot show crosshair lines; Arrow shows the pointer only; Eraser deletes drawings on click (`Eraser + Ctrl` = partially erase). `selectLineTool("cursor" | "dot" | "arrow_cursor" | "eraser")`.
* Style overrides: `paneProperties.crossHairProperties.color "#9598A1"`, `.style LineStyle.Dashed (2)`, `.width 1`, `.transparency 0` (only applied when the colour is hex). [LWC defaults: `#9598A1`, `LargeDashed`, width 1, label bg `#131722`.] Settings → Canvas → Crosshair: colour, opacity, thickness, style.
* Axis labels: time label under the vertical line (date format setting) and price label beside the horizontal line (`showPriceScaleCrosshairLabel`/`showTimeScaleCrosshairLabel`, bg `crosshairLabelBgColorLight/Dark`).
* **Magnet** modes (left toolbar magnet button; `magnetEnabled(): IWatchedValue<boolean>`, `magnetMode(): IWatchedValue<number>`): *Weak magnet* "pulls the drawing points to chart values (bars) when you are drawing near them", *Strong magnet* "regardless of the distance". Snaps to **OHLC** of the bar under the cursor (LWC `CrosshairMode.MagnetOHLC` semantics: candidates = O/H/L/C of every visible non-overlay series at that index, nearest in pixels wins; `Magnet` = close/value only; `Normal` = free; `Hidden` = no crosshair). Hold **Ctrl/Cmd** while drawing or dragging a point to temporarily invert the magnet state. Icon is blue when on, white when off. Magnet affects drawing points, not the crosshair display (**[GUESS]** the crosshair itself is free-moving in TV.com).
* Crosshair follows the mouse over any pane; `crossHairMoved()` subscription gives `{ time, price, userTime?, entityValues?: Record<EntityId, {…}> (main series id '_seriesId'), offsetX?, offsetY? }`; `onHoveredSourceChanged()` gives the hovered series/study id. Trading Platform multi-chart: `crosshairSync()` mirrors the crosshair time across charts; `display_legend_on_all_charts` shows legends on all charts when synced.
* Touch/mobile: long press enters **tracking mode** (crosshair shown, legend shows OHLC and indicator values); single tap exits (LWC `trackingMode.exitMode OnNextTap`; alternative `OnTouchEnd`). `long_press_floating_tooltip` (on) shows a floating tooltip on long press. Double tap enables "line movement mode" for a drawing.
* Accessibility: `aria_crosshair_price_description` announces the price under the crosshair; keyboard navigation with `Alt+Z` (or `Tab` with `accessible_keyboard_shortcuts`).

### 5.2 Legend (status line)

Position: top-left of every pane; cannot be moved. Content for the main series row:
1. **Symbol title** (`statusViewStyle.symbolTextSource`: description | ticker | ticker-and-description | long-description; `use_symbol_name_for_header_toolbar` affects the header), optional **logo** (`show_symbol_logo_in_legend` + `show_symbol_logos` + `logo_urls`), **exchange** (`statusViewStyle.showExchange true`), **interval** (`showInterval true`; the interval is an in-place dropdown to change resolution unless `legend_inplace_edit` is disabled; `hide_resolution_in_legend` removes it; in-place symbol change unless `disable_legend_inplace_symbol_change`), **market status icon** (open/pre/post/night/closed/holiday — `MarketStatus` enum `market | pre_market | post_market | night | out_of_session | holiday`; click opens the Market Status pop-up with the session timeline; `display_market_status` on), **delayed data "D" icon** (`display_data_mode` + `data_status`), custom status items (`customSymbolStatus()`), price source (`symbol_info_price_source`).
2. **OHLC values** (`showSeriesOHLC true`, rendered as `O 123.45 H … L … C …`, coloured up/down), **bar change** (`showBarChange true`, e.g. `+1.23 (+0.98%)`; `legend_bar_change_colors_based_on_value` colours it by sign), **volume** (`showVolume false`), **last day change** (`showLastDayChange false`, Trading Platform quotes `ch/chp`), mobile close-only (`showSeriesLegendCloseOnMobile true`, `always_show_legend_values_on_mobile`).
3. **Values shown when not hovering**: the **last bar** (rightmost bar in data); with `use_last_visible_bar_value_in_legend` the rightmost *visible* bar; on mobile outside tracking mode only close/change/% (from quotes).
Indicator rows: **title** (`showStudyTitles true`), **arguments/inputs** in parentheses (`showStudyArguments true`; booleans hidden unless `dont_show_boolean_study_arguments`; symbol inputs hidden when equal to the main symbol unless `always_show_study_symbol_input_values_in_legend`/`hide_main_series_symbol_from_indicator_legend`), **values** per plot coloured by plot colour (`showStudyValues true`; `N/A` or `∅` for missing — `use_na_string_for_not_available_values`), unresolved symbols (`hide_unresolved_symbols_in_legend`).
Hover buttons (per row, `edit_buttons_in_legend` on): **eye** (show/hide, `show_hide_button_in_legend`), **settings gear** (`format_button_in_legend`; opens the properties dialog), **source code** `{}` (TV.com, Pine), **delete ×** (`delete_button_in_legend`), **more "…"** menu (Visual order, Pin to scale, Move to, Copy, Paste, Add indicator on…, Add financial metric…, Alert…, Source code, Remove). Right-click on the legend = legend context menu (`legend_context_menu`). Left-click the eye icon of the main series hides the series (`seriesHide`/`studyHide` actions). Collapse: a small +/- ("`object_tree_legend_mode`: Show object tree button in the legend at a small width"; TV.com has a collapse arrow that hides indicator rows).
Style: `paneProperties.legendProperties.showBackground true`, `backgroundTransparency 50` (semi-transparent plate behind text), `legend_widget` featureset hides the whole legend; `snapshot` option `legendMode: "horizontal" | "vertical"`, `hideStudiesFromLegend`, `hideResolution`.
tradingview.com Status line settings tab (help center): Symbol → Logo, Title, Chart values (OHLC), Bar change values, Volume, Last day change; Indicators → Titles, Arguments, Values; Buttons → Show; also "Open market status" toggle.

---

## 6. UI CHROME

### 6.1 Top toolbar (header widget)

Left to right (library + TV.com). Each item has a featureset that hides it; `header_widget` hides the whole bar; `header_widget_buttons_mode: "fullsize" | "compact" | "adaptive"` (default adaptive: full-size when width allows, icons on small windows); `header_in_fullscreen_mode` keeps it in fullscreen; `toolbar_bg` sets its colour.

| # | Element | Behaviour | Featureset / API |
|---|---|---|---|
| 1 | **Symbol search** button (shows current symbol; logo when `show_symbol_logos`) | opens the Symbol Search dialog; typing letters anywhere on the chart opens it pre-filled (`symbol_search_hot_key`, on) | `header_symbol_search`; action `symbolSearch`; `closePopupsAndDialogs()` |
| 2 | **Compare / Add symbol** (+) | opens the Compare dialog (Section 6.9) | `header_compare`; action `compareOrAdd`; events `compare_add`, `add_compare` |
| 3 | **Interval** selector (text like `1D`) + favourite interval buttons | dropdown grouped by unit with stars; typing digits/`,` opens the interval dialog | `header_resolutions`, `items_favoriting`, `custom_resolutions`; action `changeInterval` |
| 4 | **Chart type** dropdown + favourite type buttons | Section 1.5 | `header_chart_type` |
| 5 | **Indicators** (fx icon) | opens the Indicators dialog (`/` shortcut, `insert_indicator_dialog_shortcut`) | `header_indicators`; action `insertIndicator`; event `indicators_dialog` |
| 6 | **Indicator templates** | save/load study templates; event `load_study_template` | `study_templates` (off) |
| 7 | **Alert** (TV.com) / **Bar Replay** (TV.com) | Section 10 / 9 | not in library |
| 8 | **Undo / Redo** | `Ctrl+Z` / `Ctrl+Y`; `undoRedoState()`; events `undo`, `redo`, `undo_redo_state_changed` | `header_undo_redo`; actions `undo`, `redo` |
| 9 | **Layout selector** (Trading Platform) | 1–8 charts grid; `layout()/setLayout(LayoutType)`; `layout_about_to_be_changed`, `layout_changed` | `header_layouttoggle` |
| 10 | **Save layout / Load layout** (cloud icon, name) | `Ctrl+S` (`save_shortcut`), `.` loads; Save-as dialog; autosave | `header_saveload`, `confirm_overwrite_if_chart_layout_with_name_exists` |
| 11 | **Quick search** (TV.com/Trading Platform, `Ctrl+K`) | command palette: drawings, chart features ("add/insert/change/open …"), settings, symbols, recent searches | `header_quick_search` |
| 12 | **Chart settings** (gear) | opens Chart settings dialog | `header_settings`; action `chartProperties` |
| 13 | **Fullscreen** | `startFullscreen()/exitFullscreen()`; `side_toolbar_in_fullscreen_mode` | `header_fullscreen_button` |
| 14 | **Snapshot** (camera) | menu: Download image, Copy image (+ Copy link, Open in new tab, Tweet image when `snapshot_url`); `Alt+S` copies the link; `takeScreenshot()` → `onScreenshotReady(url)`; `takeClientScreenshot(opts)` → canvas | `header_screenshot` |
| 15 | Custom buttons/dropdowns | `createButton({align:'left'|'right', useTradingViewStyle, text?, title?, onClick?})`, `removeButton`, `createDropdown({title, items:[{title,onSelect}], tooltip?, icon?, align?})` after `headerReady()` | |
| 16 | TV.com extras | Trade, Publish idea, Data type switcher, Quick search | |

### 6.2 Left (drawing) toolbar

Featureset `left_toolbar` (on); hidden at first launch with `hide_left_toolbar_by_default`; toggled with action `drawingToolbarAction` (event `toggle_sidebar(isHidden)`); `show_object_tree` adds the Object tree button. Groups (top→bottom), each button opens a flyout listing tools with a ★ favourite toggle; favourited tools appear in a **floating favourites toolbar** on the chart (draggable) and the group button shows the last-used tool:

1. **Cursors**: Cross, Dot, Arrow, Eraser (TV.com: + Demonstration, Magic).
2. **Trend line tools**: Trend line, Ray, Info line, Extended line, Trend angle, Horizontal line, Horizontal ray, Vertical line, Cross line, Parallel channel, Regression trend, Flat top/bottom, Disjoint channel, Anchored VWAP (TV.com also Arrow).
3. **Gann and Fibonacci**: Fib retracement, Trend-based Fib extension, Fib channel, Fib time zone, Fib speed resistance fan, Trend-based Fib time, Fib circles, Fib spiral, Fib speed resistance arcs, Fib wedge, Pitchfan, Gann box, Gann square fixed, Gann square, Gann fan, Pitchfork, Schiff pitchfork, Modified Schiff pitchfork, Inside pitchfork.
4. **Patterns**: XABCD, Cypher, ABCD, Triangle pattern, Three drives, Head and shoulders, Elliott impulse (12345), Elliott correction (ABC), Elliott triangle (ABCDE), Elliott double combo (WXY), Elliott triple combo (WXYXZ), Cyclic lines, Time cycles, Sine line.
5. **Prediction and measurement**: Long position, Short position, Forecast (Position forecast), Date range, Price range, Date and price range, Bars pattern, Ghost feed, Projection, Fixed range volume profile, Anchored volume profile.
6. **Geometric shapes**: Brush, Highlighter, Rectangle, Rotated rectangle, Circle, Ellipse, Triangle, Arc, Curve, Double curve, Path, Polyline, Arrow, Arrow marker, Arrow mark up/down/left/right.
7. **Annotation**: Text, Anchored text, Note, Anchored note, Price label, Price note, Signpost, Callout, Comment, Flag mark, Table (TV.com).
8. **Icons / Stickers / Emojis** (font-icon group "Font Icons" in `drawings_access`; icons are hex code points, Twemoji v13 emojis, sticker names like `"dislike"`).
9. **Measure** (ruler; also `Shift+click-drag` anywhere): shows price change, %, bars count and elapsed time between two points.
10. **Zoom in** (drag a box to zoom) and **Zoom out**.
11. **Magnet** (weak/strong submenu; toggle).
12. **Stay in drawing mode** (`stayInDrawingModeAction`; TV.com "Keep drawing tool selected"): after finishing a drawing the tool stays active instead of reverting to the cursor.
13. **Lock all drawings** (`lockAllDrawingTools(): IWatchedValue<boolean>`; TV.com also has "Removal of locked drawings" preference).
14. **Hide** menu: Hide drawings, Hide indicators, Hide positions & orders (Trading Platform), Hide all (`hideAllDrawingTools()`, `Ctrl+Alt+H`; action `hideAllMarks` toggles marks).
15. **Sync drawings** (TV.com/Trading Platform: "Sync drawings to all charts" in layout, "New drawings sync globally"; `drawOnAllChartsEnabled()`).
16. **Remove** menu: Remove drawings, Remove indicators, Remove drawings & indicators (`paneRemoveAllStudiesDrawingTools`, `removeAllShapes()`, `removeAllStudies()`).
17. **Object tree** button (bottom; TV.com places Object tree + Data window in the right panel).

`selectLineTool(name, options?)` / `selectedLineTool()` mirror clicking a tool; event `onSelectedLineToolChanged`. Drawing creation needs 1–N clicks depending on the tool (an error `Wrong points count for "…". Required "n"` is thrown by the API when the count is wrong). `drawings_access: { type: "black" | "white", tools: [{ name: "Trendline", grayed?: true }] }` hides or greys tools (greyed ones fire `onGrayedObjectClicked`).

### 6.3 Floating drawing toolbar (appears when a drawing is selected)

Reconstructed from the docs (drawing templates on the floating toolbar, `lineToggleLock`, `lineHide`) and TV.com: a horizontal floating bar near the top of the chart with: **Templates** (save/apply drawing templates, Trading Platform `drawing_templates`) · **Colour** (line), **Background colour** and **Text colour** pickers with opacity · **Line width** (1/2/3/4) · **Line style** (solid/dotted/dashed) · tool-specific toggles (extend left/right, arrows at ends, show stats, levels visibility) · **Text** button for text-bearing tools · **Coordinates**/**Settings** (opens the drawing's properties dialog) · **Alert on this drawing** (TV.com) · **Lock** (`lineToggleLock`) · **Hide** (`lineHide`) · **Visual order** (bring to front/back, `bringToFront/sendToBack/bringForward/sendBackward` on `[id]`) · **Clone** · **Delete**. `Ctrl+drag` clones, `Ctrl+click` multi-selects, arrow keys nudge the selection, `Ctrl+C/Ctrl+V` copy/paste (`datasource_copypaste`). The bar can be dragged to another position (TV.com).

### 6.4 Context menus (right-click)

Featuresets: `context_menus` (all), `pane_context_menu`, `scales_context_menu`, `legend_context_menu`. Menus are addressable in `context_menu.items_processor(items, actionsFactory, params: CreateContextMenuParams { menuName, detail?: { type: "series" | "study" | "shape" | "groupOfShapes" | "position" | "order" | "priceScale", id, paneIndex?, chartIndex? } })` and `renderer_factory`; `onContextMenu((unixTime, price) => ContextMenuItem[] /* { position: "top"|"bottom", text, click }, "-" = separator, "-Paste" removes an item */)`. `ActionDescription { text, separator?, shortcut?, tooltip?, checked?, checkable?, enabled?, externalLink?, icon(svg string)? }`.

Default **chart-pane** menu on tradingview.com (**[GUESS]** ordering): Reset chart view (`Alt+R`) · Add alert on <symbol> at <price> · Trade (Trading Platform) · Add horizontal line at <price> · Add indicator on <price>? / Add symbol · Copy price / Copy chart image · Paste (`Ctrl+V`) · Lock vertical cursor line by time · Hide marks on bars · Drawings sync · Remove drawings/indicators · Object tree · Settings… (`chartProperties`). **Price-scale** menu: Section 3.7. **Time-scale** menu: Reset time scale · Lock price to bar ratio? · Show weekday · Date format… · Time hours format · Go to date… · Timezone submenu · Session breaks (**[GUESS]**). **Drawing** menu: Clone · Copy · Template · Visual order (Bring to front / Send to back / Bring forward / Send backward) · Lock · Hide · Sync to all charts · Add alert · Settings… · Remove. **Indicator/legend** menu: as in 5.2 plus Add indicator on … , Pin to scale, Move to, Apply to entire layout (`applyToEntireLayout()`).

### 6.5 Keyboard shortcuts (complete library list + TV.com extras)

macOS uses ⌘/⌥/⇧ for Ctrl/Alt/Shift.

**Chart**: Open Quick Search `Ctrl+K` · Open indicators `/` · Load chart layout `.` · Save chart layout `Ctrl+S` · Undo `Ctrl+Z` · Redo `Ctrl+Y` · Change symbol: start typing a symbol name · Change interval: digit or `,` · Move chart 1 bar left/right `←`/`→` · Move chart left/right `Shift + wheel` · Zoom in `Ctrl+↑` · Zoom out `Ctrl+↓` · Move further left/right `Ctrl+←` / `Ctrl+→` · Toggle maximize pane: double-click the pane · Toggle collapse pane: `Ctrl` + double-click the pane · Go to date `Alt+G` · Take snapshot (URL to clipboard) `Alt+S` · Reset chart `Alt+R` · Invert series scale `Alt+I` · Toggle logarithmic scale `Alt+L` · Toggle percent scale `Alt+P` · Zoom in focused area `Ctrl + wheel` · Start keyboard navigation `Alt+Z` (or `Tab` with `accessible_keyboard_shortcuts`).

**Indicators and drawings**: Partially erase drawing: Eraser + `Ctrl` · Gann box fixed increments: hold `Shift` · Measure tool: hold `Shift` + click · Copy selected object `Ctrl+C` · Paste `Ctrl+V` · Temporarily toggle magnet: `Ctrl` + move a point · Hide all drawings `Ctrl+Alt+H` · Clone a drawing `Ctrl` + drag · Select multiple: hold `Ctrl` + click · Move drawing horizontally/vertically: drag + `Shift` · Move selected drawing `←/→/↑/↓` · Draw Trend line `Alt+T` · Horizontal line `Alt+H` · Vertical line `Alt+V` · Cross line `Alt+C` · Fib retracement `Alt+F` · Rectangle `Alt+Shift+R` · Square: Rectangle + `Shift` · Circle: Ellipse + `Shift` · 45° angle or horizontal: Trend line/Channel + `Shift`.

**Trading Platform**: Switch between charts `Tab` (or `Shift+→`), reverse `Shift+Tab` (or `Shift+←`) · Toggle maximize chart `Alt+Enter` or `Alt`+click · Add symbol to watchlist `Alt+W` · Watchlist: next `↓`/`Space`, previous `↑`/`Shift+Space`, select all `Ctrl+A`, select next/prev `Shift+↓`/`Shift+↑` · Trading: market buy `Shift+B`, market sell `Shift+S`, limit order: click DOM cell, limit buy `Shift+Alt+B`, limit sell `Shift+Alt+S`, stop order `Ctrl`+click DOM cell, centre DOM `Shift+Alt+C`.

**tradingview.com only**: Create alert `Alt+A` · Bar Replay play/pause `Shift+↓`, step forward `Shift+→` · Delete selected `Delete`/`Backspace` · Escape cancels the current drawing · `Esc` closes dialogs · Pine editor `Ctrl+Shift+P`/`F1` command palette. `onShortcut(["alt", 81], cb)` registers custom shortcuts (key codes; string form `"alt+q"` deprecated); `insert_indicator_dialog_shortcut` and `save_shortcut` featuresets disable `/` and `Ctrl+S`.

### 6.6 Chart settings dialog

Opened by the gear, `chartProperties`/`scalesProperties` actions, double-clicking the chart background (TV.com), or the legend gear. Featuresets: `property_pages` (all pages), `show_chart_property_page`, `chart_property_page_scales`, `chart_property_page_trading`, `chart_property_page_right_margin_editor`. Event `edit_object_dialog({ objectType, scriptTitle })`. Tabs (TV.com "How to configure your Supercharts"; the library has the same tabs minus Alerts/Events):

* **Symbol** — per chart type: Candles: *Color bars based on previous close*, *Body* (up/down colours), *Borders* (up/down), *Wick* (up/down); Bars: *Thin bars*, *HLC bars* (hide open); Line/Area/Baseline: line colour/width/style, *Price source* (open/high/low/close), fills, baseline level; Heikin Ashi: *Real prices on price scale*; Renko/Kagi/PnF/Line break: box size method/ATR length/box size/percentage/reversal amount/source/wicks/number of lines and projection colours; High-low: body/borders/labels; Columns: colours, baseline position; then *Last price line* (colour/width), *Previous close price line*, *Bid/Ask lines*, *High/low price lines*, *Average close price line*, *Session* (Regular / Extended / 24h) with *Electronic trading hours background* colour, *Adjust data for dividends*, *Back-adjustment* (futures), *Precision* (Default or the `minTick` list), *Timezone*.
* **Status line** — *Symbol* (Logo, Title source, Chart values/OHLC, Bar change values, Volume, Last day change), *Open market status*, *Indicators* (Titles, Arguments, Values), *Buttons* visibility.
* **Scales and lines** — *Price scale*: Currency, Unit, Scales mode (Auto/Regular/Percent/Indexed/Log), Lock price to bar ratio, Scales position (left/right/merge); *Price labels and lines*: No overlapping labels, Plus button, Countdown to bar close, Symbol last price value (with "Price and percentage" mode), Symbol name label, Indicator last value, Indicator name label, Bid/ask labels, High/low labels, Pre/post market price; *Time scale*: Show weekday, Date format, Time format (24/12 h), "Lock/keep chart position when interval changes" (TV.com), Session breaks.
* **Canvas** (older name "Appearance") — *Chart basic styles*: Background (solid/gradient + colours), Grid lines (Vertical and horizontal / Vertical / Horizontal / None; colour & opacity), Pane separator (colour), Crosshair (colour, opacity, width, style), Watermark (on/off, colour); *Scales*: Text size, Text colour, Lines colour; *Buttons*: Navigation buttons (Show always / Show on mouse over / Hide), Pane buttons (same); *Margins*: Top (%), Bottom (%), Right (bars or %).
* **Trading** (Trading Platform) — Buy/Sell buttons, Instant orders placement, Play sound for executions, Notifications (Rejection only / All events); Positions (P&L visibility & unit money/ticks/percent), Reverse button on hover, Orders visibility, Bracket P&L unit, Executions (arrows; "red for sell, blue for buy"), Execution labels, Extend lines left, Label alignment (right/left/center), Line width, Include in screenshots (`snapshot_trading_drawings`).
* **Alerts** (TV.com) — alert line colour, "Only active alerts", volume, auto-hide notifications (20 s default).
* **Events** (TV.com) — Ideas (green/red/orange markers), Dividends, Splits, Earnings (+ break line), News (purple) shown on the time scale; latest news notifications.
* **Template** dropdown (Trading Platform `chart_template_storage`): save/apply named colour sets (`ChartTemplateContent { chartProperties: { paneProperties, scalesProperties }, mainSourceProperties, version }`), "Save as default", "Reset to defaults".

### 6.7 Indicator settings dialog

Opened by double-clicking an indicator plot, the legend gear, or `showPropertiesDialog(id)`; event `study_properties(id)`, `study_properties_changed(id)`, `study_dialog_save_defaults(id)`. Tabs: **Inputs** (typed inputs from `getStudyInputs`: integer/float/bool/text/source/symbol/session/time/resolution/color; symbol inputs open a symbol search with spread operators when `studies_symbol_search_spread_operators`), **Style** (per plot: visible checkbox, colour, opacity, line width, plot type — `line, histogram, cross, area, columns, circles, line_with_breaks, area_with_breaks, step_line, step_line_with_breaks` — plus bands/filled areas/palettes; *Precision* (Default or 0–8), *Labels on price scale*, *Values in status line*, and TV.com *Output values as percentages*), **Visibility** (checkboxes per interval class: Ticks, Seconds (range), Minutes (range), Hours (range), Days, Weeks, Months, Ranges — the indicator is drawn only on selected intervals). Footer: **Defaults ▾** (Save as default, Reset settings), **Templates**, OK/Cancel. `IStudyApi.setInputValues`, `getStyleValues`, `applyOverrides` (per-study overrides like `"plot.color"`), `studies_overrides` for defaults (`"volume.volume.color.0"`, `"bollinger bands.median.color"`, `"<name>.<plot>.linewidth"`, `"<name>.<input name>"`), `getStudyStyles` for metadata.

### 6.8 Drawing settings dialog

Tabs: **Style** (colours/line width/style/fill/opacity/font/bold/italic/text alignment/levels table for Fib/Gann/pitchfork with per-level visible+coefficient+colour, extend lines, stats options, labels), **Text** (for text-bearing tools), **Coordinates** (each anchor point as Price + Bar # / time; editable), **Visibility** (same interval classes as indicators, default all). Footer: Template ▾ (Save as, Apply defaults, Reset), OK/Cancel. `ILineDataSourceApi.getProperties()/setProperties(props, saveDefaults?)`, `getPoints()/setPoints()`, `setUserEditEnabled`, `setSelectionEnabled`, `setSavingEnabled`, `setShowInObjectsTreeEnabled`, `getAnchoredPosition/setAnchoredPosition` (anchored shapes), `bringToFront/sendToBack`, `getPriceScaleId`, `getPaneIndex`.

### 6.9 Other dialogs

* **Object tree** (left toolbar in Advanced Charts, right widget bar `paneObjectTree` action in Trading Platform; `show_object_tree`): tree of Main series → indicators → drawings (+ groups) per pane; per-item eye (hide), lock, delete; drag to reorder z-order; select; group drawings; shows exchange (hidden by `hide_object_tree_and_price_scale_exchange_label`; "undefined" appears if `exchange`/`listed_exchange` are missing). TV.com combines it with the **Data window** tab (a table of every source's values at the crosshair bar: date/time, OHLC, change, volume, each indicator plot value, colour swatches; `widgetbarApi.isPageVisible('data_window')`; shortcut `Alt+D` on TV.com).
* **Indicators dialog** (`insertIndicator`, `/`): search box; left rail with categories — TV.com: *Favorites, My scripts, Technicals, Financials, Community (Editors' picks, Top, Trending…), Invite-only, Candlestick patterns* (library: built-in list of ~100 indicators, `studies_access` blacklist/whitelist, `study_count_limit` with "limit exceeded" dialog, `checkLimit` in `createStudy`). Click adds the indicator immediately (dialog stays open); star to favourite; `indicators_dialog` event.
* **Compare / Add symbol** dialog (`compareOrAdd`): symbol search plus radio for scale: **Same % scale** (both on one scale in Percentage mode), **New price scale**, **New pane**; `compare_symbols` widget option provides a suggested list (`{symbol, title}`); spread operators (`compare_symbol_search_spread_operators`). Programmatic: `createStudy('Overlay', true, false, { symbol: 'IBM' })` (supports extend time scale + logos) or `createStudy('Compare', false, false, { source: 'open', symbol })`. Compare series are drawn as lines by default (Overlay can use candles/bars/line via its style input), get their own legend row with the symbol logo (`show_symbol_logo_for_compare_studies`), and symbol name labels on the scale (`auto_enable_symbol_labels`). Overlay overrides: `overlay.symbol`, `overlay.extendtimescale`; Compare: `compare.symbol`, `compare.source`, `compare.plot.*`.
* **Symbol search** dialog: text box with uppercase forcing (`uppercase_instrument_names` on), filters *All types / symbol types* and *All exchanges / exchanges* from `DatafeedConfiguration.symbols_types/exchanges`, results list (symbol, description, exchange, type, logos, grouping of futures roots via `symbols_grouping` regex), pagination via `searchSymbolsPaginated`, spread operators (`show_spread_operators`, `hide_exponentiation_spread_operator`, `hide_reciprocal_spread_operator`), arbitrary text entry (`allow_arbitrary_symbol_search_input`), throttle `symbol_search_request_delay` ms, name override `symbol_search_complete(symbol, item) => Promise<{symbol,name}>`. `resolveSymbol` failing with `"unknown_symbol"` shows the ghost icon (`hide_image_invalid_symbol`).
* **Symbol Info / Security info** (`showSymbolInfoDialog` action; legend menu item; featureset `symbol_info`): shows description, exchange, listed exchange, symbol type, sector, industry, currency, session (display), timezone, price format (pricescale/minmov/tick), plus `additional_symbol_info_fields: [{ title, propertyName }]` read from the symbol info.
* **Go to date** dialog (`Alt+G`): date (and time on intraday) picker; TV.com adds a "Custom range" tab (two dates) used by the bottom "Go to" button.
* **Load / Save layout** dialogs (`showLoadChartDialog()`, `showSaveAsChartDialog()`): list with name, symbol, interval, modified date, delete; rename; autosave toggle (TV.com).
* **Notice/confirm dialogs**: `showNoticeDialog({title, body, callback})`, `showConfirmDialog(...)`; `constraint_dialogs_movement` keeps dialogs inside the chart; `popup_hints` shows hint bubbles (e.g. "hold Shift to measure").
* **Market status** pop-up (legend icon): timeline of subsessions in exchange time, status text ("Market closed", "Pre-market", …), custom sections via `customSymbolStatus().symbol(id).setVisible/setColor/setIcon/setTooltip/setDropDownContent([...])`.

---

## 7. APPEARANCE OPTIONS

### 7.1 Pane background, grid, separators

| Override | Default | Notes |
|---|---|---|
| `paneProperties.backgroundType` | `'solid'` (light) / `'gradient'` (dark theme) | `"solid" \| "gradient"` |
| `paneProperties.background` | `'#ffffff'` | solid colour (dark theme default **[GUESS]** `#131722`) |
| `paneProperties.backgroundGradientStartColor` | `'#ffffff'` | top |
| `paneProperties.backgroundGradientEndColor` | `'#ffffff'` | bottom |
| `paneProperties.vertGridProperties.color` | `'rgba(42, 46, 57, 0.06)'` | |
| `paneProperties.vertGridProperties.style` | `LineStyle.Solid` | |
| `paneProperties.horzGridProperties.color` | `'rgba(42, 46, 57, 0.06)'` | |
| `paneProperties.horzGridProperties.style` | `LineStyle.Solid` | |
| `paneProperties.gridLinesMode` | `"both"` | `"both" \| "vert" \| "horz" \| "none"` |
| `paneProperties.separatorColor` | `'#EBEBEB'` | |
| `paneProperties.crossHairProperties.*` | see 5.1 | |
| `paneProperties.topMargin` / `bottomMargin` | `10` / `8` (%) | auto-scale margins |
| `paneProperties.legendProperties.*` | see 5.2 | |
| `backgrounds.preMarket.color`, `backgrounds.postMarket.color`, `backgrounds.outOfSession.color` | (theme) | extended-hours shading |

Grid lines are drawn under all series at every price tick and time tick. Background gradient runs top→bottom over each pane [LWC `ColorType.VerticalGradient`].

### 7.2 Scales, watermark, buttons

* Scales text/lines: `scalesProperties.textColor '#131722'`, `lineColor 'rgba(42, 46, 57, 0)'`, `fontSize 12`; Settings → Canvas → Scales (Text size, Text colour, Lines colour). `custom_font_family` sets the chart font (CSS `font-family` string).
* **Watermark**: centred large text with **ticker** on one line and **interval, description** below (default: "symbol ticker, interval, and description"); off by default in the library (user enables it in Settings → Canvas → Watermark; `settings_adapter.initialSettings.symbolWatermark = '{"visibility":"true","color":"rgba(244, 67, 54, 0.25)"}'`). API `widget.watermark(): IWatermarkApi { color(), visibility() (deprecated), tickerVisibility(), intervalVisibility(), descriptionVisibility(), customVisibility(), setContentProvider(fn|null), provider() }`; a provider returns `WatermarkLine[] { text, fontSize, lineHeight, vertOffset }`. TV.com default watermark colour is a light grey at low opacity.
* **Navigation buttons** (bottom-right of the main pane): zoom in, zoom out, scroll left, scroll right / "go to realtime" arrow, reset; `navigationButtonsVisibility()` (`alwaysOn / visibleOnMouseOver / alwaysOff`), featureset `control_bar`. **Pane buttons** visibility likewise.
* **TradingView logo** (attribution, required in the free library): bottom-left of the last pane; `move_logo_to_main_pane` puts it on the main pane; `adaptive_logo` shows "Chart by TradingView" text on small screens.
* Chart border: `border_around_the_chart` (2 px padding), `remove_library_container_border` (0 px border, 1 px padding). `no_min_chart_width` disables the min width.

### 7.3 Bottom toolbar

Left: **time-frame buttons** (2.4) and **Go to** (date/custom range on TV.com). Right: **time** (current time in the chart's time zone, `custom_formatters.timeFormatter`) + **time zone dropdown** (`timezone_menu`), **session toggle** (Regular/Extended/24h when subsessions exist), then the scale mode toggles **% / log / auto** (TV.com shows `%`, `log`, `auto` text buttons; the library shows the settings gear/letters below the price scale). Featureset `timeframes_toolbar` hides the left part.

### 7.4 Session breaks, extended hours, events on the time axis

* **Session breaks**: vertical lines at each session start (Settings → Scales/Appearance "Session breaks"; TV.com default on for intraday, colour theme grey, dashed). Override key not present in `ChartPropertiesOverrides` (**[GUESS]** stored under `paneProperties`/`mainSeriesProperties` as a user setting).
* **Extended hours** shading: pre-market and post-market bars get a tinted background across the pane height (Section 2.7); the tint can be edited or removed in Settings → Symbol ("Electronic trading hours background").
* **Time-scale marks** (`getTimescaleMarks`): small labelled shapes drawn **on the time axis** above the labels — `shape: "circle" | "earningUp" | "earningDown" | "earning"` (the earnings shapes are triangles/up-down glyphs used by TV.com for earnings beat/miss), `color`, `label` (1–2 chars), `labelFontColor`, `imageUrl` (image inside the mark), tooltip lines on hover; click → `onTimescaleMarkClick(id)`. tradingview.com renders **Events** this way: earnings (E), dividends (D), splits (S), news (N, purple) and ideas markers, configured in Settings → Events. Not shown on small (mobile) screens.
* **Bar marks** (`getMarks`): circles attached to bars, drawn at the bottom of the main pane under the bar (TV.com: below the low of the bar), max 10 per bar, `color` = `"red" | "green" | "blue" | "yellow"` or `{ border, background }`, `text` tooltip (plain text; Trading Platform custom web component via `customTooltip`), `label` (1 char; 2 with `two_character_bar_marks_labels`), `labelFontColor`, `minSize` px, `borderWidth`, `hoveredBorderWidth`, `imageUrl` + `showLabelWhenImageLoaded`; tooltip on hover (or pinned on click with `pin_bar_mark_tooltips_on_click`); `onMarkClick(id)`; `clearMarks(ClearMarksMode.All|BarMarks|TimeScaleMarks)`, `refreshMarks()`; `hideAllMarks` action. Marks are requested for the visible range on every scroll/zoom (`supports_marks`, `supports_timescale_marks`).

### 7.5 Themes

* `theme: "light" | "dark"` (default `light`); `changeTheme(name, { disableUndo })` (returns a promise; re-apply overrides after it), `getTheme()`, event `chart_theme_changed(themeName, isStandardTheme, onlyActiveChart)`. Only two themes exist; the theme is stored in the saved layout (a dark layout loaded in light mode keeps a dark background until `changeTheme` is called again).
* **Custom themes API** (`custom_themes: { light: CustomThemeColors, dark: CustomThemeColors }`, `customThemes().applyCustomThemes()/resetCustomThemes()`, featureset `library_custom_color_themes`): palette of 7 colours × 19 shades (lightest→darkest) + `white`/`black`: `color1` blue (`#2962ff` at index 9), `color2` grey (`#787b86`), `color3` red (`#f23645`), `color4` green (`#089981`), `color5` orange (`#ff9800`), `color6` purple (`#9c27b0`), `color7` yellow (`#ffeb3b`). These are the TradingView brand colours used by every UI element; cannot change Account Manager blue/red, Market Status green/orange/blue, Details green.
* **CSS colour themes** (legacy): CSS custom properties `--tv-color-platform-background`, `--tv-color-pane-background`, `--tv-color-toolbar-button-background-hover/-expanded/-active/-active-hover`, `--tv-color-toolbar-button-text/-hover/-active/-active-hover`, `--tv-color-item-active-text`, `--tv-color-toolbar-toggle-button-background-active/-hover`, `--tv-color-toolbar-divider-background`, `--tv-color-toolbar-save-layout-loader`, `--tv-color-bar-mark-background-color`, `--tv-color-popup-background`, `--tv-color-popup-element-text/-hover`, `--tv-color-popup-element-background-hover`, `--tv-color-popup-element-divider-background`, `--tv-color-popup-element-secondary-text`, `--tv-color-popup-element-hint-text`, `--tv-color-popup-element-text-active`, `--tv-color-popup-element-background-active`, `--tv-color-popup-element-toolbox-text/-hover/-active-hover`, `--tv-color-popup-element-toolbox-background-hover/-active-hover`; set with `custom_css_url` or `setCSSCustomProperty()/getCSSCustomPropertyValue()`.
* Dark-theme chart defaults (**[GUESS]**, from TV.com): background `#131722`, gradient `#131722`→`#1e222d`? (TV uses solid in v32 light; gradient in dark), grid `rgba(42,46,57,0.06)` is light-theme; dark uses `#363a45`-ish lines, text `#B2B5BE`, up `#089981`, down `#F23645` (same in both).
* Customization precedence (docs "Customization precedence"): defaults < theme < `overrides` (Widget Constructor) < `custom_themes` < saved chart layout < user settings (`settings_adapter`/localStorage) < `settings_overrides` < `applyOverrides` at runtime (**[GUESS]** on the exact order; the docs state that `settings_overrides` replaces saved settings and that `overrides` do not affect values already saved to settings).

---

## 8. SAVE/LOAD AND API SURFACE

### 8.1 Chart layout save/load

* A **chart layout** = one chart (Advanced Charts) or a group of charts (Trading Platform) with drawings, indicators, chart settings (colours/styles), symbol/interval, panes; **the visible time range is not saved** ("the library is designed to always display the most recent data"). User settings (Section 8.4) are stored separately.
* Low-level: `widget.save(options?: { includeDrawings?: boolean }): Promise<object>` / `widget.save(cb, options)`; `widget.load(state, extendedData?: { uid, name, description })`; `saved_data` (+ `saved_data_meta_info`) in the constructor to start from a layout. The JSON is documented as opaque ("treat state objects as black boxes"). Observed structure (**[GUESS]**, from real saved layouts): `{ layout: "s"|"2h"|…, charts: [{ panes: [{ sources: [{ type: "MainSeries"|"Study"|"LineTool…", id, zorder, state: {...}, points?, ownerSource? }], leftAxisesState, rightAxisesState, overlayPriceScales, mainSourceId, stretchFactor }], timeScale: { rightOffset, barSpacing, scrollDisabled, scaleDisabled }, chartProperties: { paneProperties, scalesProperties, chartEventsSourceProperties, tradingProperties, priceScaleSelectionStrategyName }, sessions, version, timezone, shouldBeSavedEvenIfHidden, linkingGroup, lineToolsGroups }], symbolLock, intervalLock, trackTimeMode, dateRangeLock, crosshairLock, layoutsSizes }`.
* High-level (buttons/dialogs): REST storage `charts_storage_url` + `charts_storage_api_version ("1.0"|"1.1")` + `client_id` + `user_id`: `GET/POST/DELETE charts?client&user[&chart]` with body `{ name, content, symbol, resolution }` and responses `{ status, id }` / `{ status, data: { id, name, content, symbol, resolution, timestamp } }`, list `{ status, data: [ChartMetaInfo{ id, name, symbol, resolution, timestamp }] }`; `study_templates?client&user` (v1.1+), `drawing_templates`, `drawings?...&chart&layout` (separate drawings storage). Or `save_load_adapter: IExternalSaveLoadAdapter { getAllCharts, removeChart, saveChart(ChartData{ id?, name, symbol, resolution, content, timestamp }) => id, getChartContent(id) => content, getAllStudyTemplates, removeStudyTemplate, saveStudyTemplate({name, content}), getStudyTemplateContent, getDrawingTemplates(toolName), loadDrawingTemplate, removeDrawingTemplate, saveDrawingTemplate(toolName, templateName, content), getChartTemplateContent, getAllChartTemplates, saveChartTemplate(name, ChartTemplateContent), removeChartTemplate, saveLineToolsAndGroups(layoutId, chartId, state, context{ sharingMode: "NotShared"|"SharedInLayout"|"GloballyShared", symbol, requestId }), loadLineToolsAndGroups(layoutId, chartId, requestType: "allLineTools"|"mainSeriesLineTools"|"lineToolsWithoutSymbol"|"studiesLineTools", context{ symbol, seriesSourceId, sharingMode }) }`. Methods: `getSavedCharts()`, `loadChartFromServer(record)`, `saveChartToServer({ chartName?, defaultChartName? })`, `removeChartFromServer(id)`, `load_last_chart: true` (the `symbol` option overrides the saved symbol), `auto_save_delay` (s) + `onAutoSaveNeeded` event (fires on any undoable change), `chart_load_requested(savedData)`, `chart_loaded`.
* Separate drawings storage (`saveload_separate_drawings_storage`): `getLineToolsState(): LineToolsAndGroupsState { sources: Map<id, LineToolState{ id, symbol?, ownerSource, groupId?, currencyId?, unitId?, state } | null>, groups: Map<id, LineToolsGroupState{ id, name, symbol } | null>, symbol? }` (null = tombstone/deleted), `applyLineToolsState(state)`, `reloadLineToolsFromServer()`.
* Undo/redo: every user action is undoable (`UndoRedoState { enableUndo, undoText, enableRedo, redoText }`, `clearUndoHistory()`; API calls accept `{ disableUndo }`).

### 8.2 Templates

* **Indicator (study) templates**: `createStudyTemplate({ saveSymbol?, saveInterval? }): object`, `applyStudyTemplate(obj)`; header button via `study_templates`; all indicator settings except **precision** are saved; REST `study_templates`.
* **Drawing templates** (Trading Platform, `drawing_templates` on): per-tool named property sets from the floating toolbar.
* **Chart templates** (Trading Platform, `chart_template_storage`): colour sets for the main series/pane/scales; `loadChartTemplate(name)`.
* **Chart layouts** on TV.com: also *Make a copy*, *Rename*, *Share (copy link)*, autosave; multi-chart sync toggles: `symbolSync()`, `intervalSync()`, `crosshairSync()`, `timeSync()`, `dateRangeSync()`; drawings sync modes (disabled / layout / global).

### 8.3 Widget constructor options (complete, `ChartingLibraryWidgetOptions`)

`container` (id or element, required) · `datafeed` (required, `IBasicDataFeed` [+ `IDatafeedQuotesApi`]) · `interval` (required, `ResolutionString`) · `symbol` · `locale` (required, `LanguageCode`: ar, zh, ca_ES, en, fr, de, he_IL, id_ID, it, ja, ko, pl, pt, ru, es, sv, th, tr, vi, ms_MY, zh_TW) · `library_path` · `nonce` (CSP) · `auto_save_delay` (s) · `autosize` (false) · `fullscreen` (false) · `width`/`height` · `debug` (false) · `disabled_features[]` / `enabled_features[]` · `drawings_access` / `studies_access` (`{ type: "black"|"white", tools: [{ name, grayed? }] }`; use "Font Icons" for the icon group) · `numeric_formatting { decimal_sign, grouping_separator }` · `saved_data` / `saved_data_meta_info` · `study_count_limit` (min 2) · `symbol_search_request_delay` (ms) · `timeframe` (`'3M'` or `{from,to}`) · `timezone` (`"exchange"` or id) · `toolbar_bg` · `charts_storage_url` / `charts_storage_api_version` / `client_id` / `user_id` / `load_last_chart` / `save_load_adapter` · `studies_overrides` · `custom_formatters { timeFormatter, dateFormatter, tickMarkFormatter, priceFormatterFactory, studyFormatterFactory }` · `overrides` · `snapshot_url` · `time_frames[]` · `custom_css_url` · `custom_font_family` · `favorites { intervals, indicators (titles), chartTypes, drawingTools (DrawingToolIdentifier e.g. 'LineToolBrush') }` (localStorage favourites win unless `use_localstorage_for_settings` is disabled) · `loading_screen { backgroundColor, foregroundColor }` · `settings_adapter { initialSettings, setValue, removeValue }` · `theme` · `compare_symbols[]` · `custom_indicators_getter(PineJS)` · `additional_symbol_info_fields[]` · `header_widget_buttons_mode` · `context_menu { items_processor, renderer_factory }` · `time_scale { min_bar_spacing }` · `custom_translate_function(original, singular, translated) => string|null` · `symbol_search_complete` · `settings_overrides` · `custom_timezones[]` · `custom_chart_description_function` · `custom_themes` · `image_storage_adapter` (experimental, image drawing) · `workers { enabled }` (off-main-thread calculations). Trading Platform adds `trading_customization { order, position, brokerOrder, brokerPosition }`, `broker_factory`, `broker_config`, `widgetbar`, `custom_js_urls`, etc.

### 8.4 User settings

Stored in `localStorage` (`use_localstorage_for_settings`, on; `save_chart_properties_to_local_storage`) or via `settings_adapter`. They include: resolution, chart style, order ticket type/qty, Trading tab settings, Account Manager summary row, right/bottom widget bar state, watchlist, favourites, watermark, and chart properties "saved as default". `settings_overrides` forces values regardless of storage.

### 8.5 Chart API (`IChartWidgetApi`) — complete method list

Events: `onDataLoaded()`, `onSymbolChanged() → (LibrarySymbolInfo)`, `onIntervalChanged() → (interval, {timeframe?})`, `onVisibleRangeChanged() → ({from,to})`, `onChartTypeChanged() → (SeriesType)`, `dataReady(): Promise<boolean>` (or deprecated callback form), `crossHairMoved() → (CrossHairMovedEventParams)`, `onHoveredSourceChanged() → (EntityId|null)`.
State: `setVisibleRange(range, options)`, `setSymbol(symbol, { dataReady?, doNotActivateChart? } | cb): Promise<boolean>`, `setResolution(res, options|cb): Promise<boolean>`, `setChartType(type): Promise<void>`, `resetData()`, `executeActionById(ChartActionId)`, `getCheckableActionState(id)`, `refreshMarks()`, `clearMarks(mode?)`, `symbol()`, `symbolExt()`, `resolution()`, `getVisibleRange()`, `getVisibleBarsRange()`, `priceFormatter()`, `chartType()`, `getTimezoneApi()`, `getPanes()`, `getTimeScale()`, `exportData(options)`, `setDragExportEnabled(bool)`, `canZoomOut()`, `canZoomOutWV()`, `zoomOut()`, `setZoomEnabled(bool)`, `setScrollEnabled(bool)`, `barTimeToEndOfPeriod()`, `endOfPeriodToBarTime()`, `applyOverrides(props)`, `isSelectBarRequested()`, `requestSelectBar(): Promise<number>`, `cancelSelectBar()`, `loadChartTemplate(name)`, `marketStatus(): IWatchedValueReadonly<MarketStatus|null>`, `setTimeFrame(RangeOptions)`, `getLineToolsState()`, `applyLineToolsState()`, `reloadLineToolsFromServer()`, `inactivityGaps(): IWatchedValue<boolean>`, `getPriceToBarRatio()/setPriceToBarRatio()/isPriceToBarRatioLocked()/setPriceToBarRatioLocked()`, `getAllPanesHeight()/setAllPanesHeight()`, `maximizeChart()/isMaximized()/restoreChart()`.
Entities: `getAllShapes(): EntityInfo[]`, `getAllStudies()`, `createStudy(name, forceOverlay?, lock?, inputs?, overrides?, { checkLimit?, priceScale?, allowChangeCurrency?, allowChangeUnit?, disableUndo? }): Promise<EntityId|null>`, `getStudyById(id): IStudyApi`, `getSeries(): ISeriesApi`, `createShape(point, options): Promise<EntityId>`, `createMultipointShape(points, options)`, `createAnchoredShape({x,y}, options)`, `getShapeById(id): ILineDataSourceApi`, `removeEntity(id, {disableUndo?})`, `removeAllShapes()`, `removeAllStudies()`, `selection(): ISelectionApi { add, set, remove, contains, allSources, allItems, isEmpty, clear, onChanged, canBeAddedToSelection }`, `showPropertiesDialog(id)`, `createStudyTemplate()`, `applyStudyTemplate()`, `availableZOrderOperations(ids)`, `sendToBack(ids)`, `bringToFront(ids)`, `bringForward(ids)`, `sendBackward(ids)`, `shapesGroupController(): IShapesGroupControllerApi { createGroupFromSelection, removeGroup, groups, shapesInGroup, excludeShapeFromGroup, addShapeToGroup, availableZOrderOperations, bringToFront, sendToBack, bringForward, sendBackward, insertAfter, insertBefore, … }`, `createOrderLine()`, `createPositionLine()`, `createExecutionShape()` (Trading Platform from v29).

`ExportDataOptions { from?, to?, includeTime (true), includeUserTime (false), includeSeries (true), includeDisplayedValues (false), includedStudies: string[] | "all", includeOffsetStudyValues?, includeOHLCValuesForSingleValuePlots?, includeHiddenStudies (false) }` → `ExportedData { schema: FieldDescriptor[], data: Float64Array[], displayedData: string[][] }`. Drag-to-export: `chart_drag_export` + `setDragExportEnabled(true)` + `dragstart` event with `DragStartParams { preventDefault, hoveredSourceId, exportData, setData(format, data), setDragImage(el, x, y), keys }`.

`ChartActionId` (complete): `addPlusButton, chartProperties, compareOrAdd, scalesProperties, paneObjectTree, insertIndicator, symbolSearch, changeInterval, timeScaleReset, chartReset, seriesHide, studyHide, lineToggleLock, lineHide, scaleSeriesOnly, drawingToolbarAction, stayInDrawingModeAction, hideAllMarks, showCountdown, showSeriesLastValue, showSymbolLabelsAction, showStudyLastValue, showStudyPlotNamesAction, undo, redo, paneRemoveAllStudiesDrawingTools, showSymbolInfoDialog`.

### 8.6 Widget API (`IChartingLibraryWidget`) — complete method list

`headerReady()`, `chartReady()` (`onChartReady` deprecated), `onGrayedObjectClicked(cb)`, `onShortcut(keys, cb)`, `subscribe/unsubscribe(event, cb)`, `chart(index?)`, `activeChart()`, `activeChartIndex()`, `setActiveChart(i)`, `chartsCount()`, `unloadUnusedCharts()`, `layout()/setLayout()`, `layoutName()`, `resetLayoutSizes()`, `setLayoutSizes()`, `getLanguage()`, `setSymbol()` (deprecated), `remove()`, `closePopupsAndDialogs()`, `selectLineTool(tool, {icon}|{emoji})`, `selectedLineTool()`, `save()`, `load()`, `getSavedCharts()`, `loadChartFromServer()`, `saveChartToServer()`, `removeChartFromServer()`, `onContextMenu(cb)`, `createButton()`, `removeButton()`, `createDropdown()`, `showNoticeDialog()`, `showConfirmDialog()`, `showLoadChartDialog()`, `showSaveAsChartDialog()`, `symbolInterval()`, `mainSeriesPriceFormatter()`, `getIntervals()`, `getStudiesList()`, `getStudyInputs(name)`, `getStudyStyles(name)`, `addCustomCSSFile(url)`, `addCustomJSFile(url)` (TP), `applyOverrides()`, `applyStudiesOverrides()`, `applyTradingCustomization()`, `watchList()`, `news()`, `widgetbar()`, `changeTheme()`, `getTheme()`, `takeScreenshot()`, `takeClientScreenshot({ backgroundColor, borderColor, font?, fontSize, legendMode, hideResolution, hideStudiesFromLegend })`, `lockAllDrawingTools()`, `hideAllDrawingTools()`, `magnetEnabled()`, `magnetMode()`, `symbolSync()`, `intervalSync()`, `crosshairSync()`, `timeSync()`, `dateRangeSync()`, `startFullscreen()`, `exitFullscreen()`, `undoRedoState()`, `navigationButtonsVisibility()`, `paneButtonsVisibility()`, `dateFormat()`, `timeHoursFormat()`, `currencyAndUnitVisibility()`, `setDebugMode()`, `drawOnAllChartsEnabled()`, `clearUndoHistory()`, `supportedChartTypes()`, `watermark()`, `customSymbolStatus()`, `setCSSCustomProperty()`, `getCSSCustomPropertyValue()`, `customThemes()`, `resetCache()`.

Widget events (`SubscribeEventsMap`, complete): `toggle_sidebar(isHidden)`, `indicators_dialog`, `toggle_header(isHidden)`, `edit_object_dialog({objectType, scriptTitle})`, `chart_load_requested(savedData)`, `chart_loaded`, `mouse_down(MouseEventParams)`, `mouse_up`, `drawing({label, value})`, `study({label, value})`, `undo`, `redo`, `undo_redo_state_changed(state)`, `reset_scales`, `compare_add`, `add_compare`, `load_study_template`, `onTick(bar)`, `onAutoSaveNeeded`, `onScreenshotReady(url)`, `onMarkClick(id)`, `onPlusClick({symbol, price, clientX…})`, `onTimescaleMarkClick(id)`, `onSelectedLineToolChanged`, `layout_about_to_be_changed(type)`, `layout_changed`, `activeChartChanged(index)`, `series_event("price_scale_changed")`, `study_event(id, "create"|"remove"|"price_scale_changed"|"paste_study")`, `drawing_event(id, "click"|"move"|"remove"|"hide"|"show"|"create"|"properties_changed"|"points_changed")`, `study_properties_changed(id)`, `series_properties_changed(id)`, `panes_height_changed`, `panes_order_changed`, `widgetbar_visibility_changed(isVisible)`, `study_dialog_save_defaults(id)`, `timeframe_interval(RangeOptions)`, `dragstart(DragStartParams)`, `dragend`, `chart_theme_changed(themeName, isStandardTheme, onlyActiveChart)`.

### 8.7 Drawings API: shape names and points

Points: `TimePoint { time }` (vertical line), `PricedPoint { time, price }`, `StickedPoint { time, channel: "open"|"high"|"low"|"close" }` (snaps to a bar value), `PositionPercents { x, y }` (anchored, 0–1 of chart width/height). Times must be bar times; otherwise the drawing is moved to the nearest bar (and stays there after resolution changes). `createShape` accepts single-point shapes only: `"arrow_up" | "arrow_down" | "flag" | "vertical_line" | "horizontal_line" | "long_position" | "short_position" | "icon" | "emoji" | "sticker" | "text" | "anchored_text" | "note" | "anchored_note"` (plus `ownerStudyId`). `createAnchoredShape` accepts `"anchored_text" | "anchored_note"`. `createMultipointShape` accepts every `SupportedLineTools` name except `cursor, dot, arrow_cursor, eraser, measure, zoom`. Options (`CreateShapeOptionsBase`): `text?, lock?, disableSelection?, disableSave?, disableUndo?, overrides?, zOrder?: "top"|"bottom", showInObjectsTree?, ownerStudyId?, filled?, icon? (hex number), emoji?`.

`SupportedLineTools` (complete, 105 names): `text, anchored_text, note, anchored_note, signpost, double_curve, arc, icon, emoji, sticker, arrow_up, arrow_down, arrow_left, arrow_right, price_label, price_note, arrow_marker, flag, vertical_line, horizontal_line, cross_line, horizontal_ray, trend_line, info_line, trend_angle, arrow, ray, extended, parallel_channel, disjoint_angle, flat_bottom, anchored_vwap, pitchfork, schiff_pitchfork_modified, schiff_pitchfork, balloon, comment, inside_pitchfork, pitchfan, gannbox, gannbox_square, gannbox_fixed, gannbox_fan, fib_retracement, fib_trend_ext, fib_speed_resist_fan, fib_timezone, fib_trend_time, fib_circles, fib_spiral, fib_speed_resist_arcs, fib_channel, xabcd_pattern, cypher_pattern, abcd_pattern, callout, text_note, triangle_pattern, 3divers_pattern, head_and_shoulders, fib_wedge, elliott_impulse_wave, elliott_triangle_wave, elliott_triple_combo, elliott_correction, elliott_double_combo, cyclic_lines, time_cycles, sine_line, long_position, short_position, forecast, date_range, price_range, date_and_price_range, bars_pattern, ghost_feed, projection, rectangle, rotated_rectangle, circle, ellipse, triangle, polyline, path, curve, cursor, dot, arrow_cursor, eraser, measure, zoom, brush, highlighter, regression_trend, fixed_range_volume_profile, table`.

Point counts per tool are not listed in the docs ("check the number of required points in the Settings dialog"). Known/observed counts (**[GUESS]** where not obvious): 1 point — vertical_line, horizontal_line, horizontal_ray, cross_line, text, note, callout(2: anchor+text), price_label, price_note, arrow_marker, arrow_mark_*, flag, icon, emoji, sticker, signpost, balloon/comment, long_position/short_position (1 point + derived levels), anchored_vwap; 2 points — trend_line, info_line, trend_angle, arrow, ray, extended, rectangle, ellipse(2/3), circle, arc(3), fib_retracement, fib_trend_ext(3), fib_timezone, fib_trend_time(3), fib_circles, fib_spiral, fib_speed_resist_arcs, fib_speed_resist_fan, fib_wedge(3), fib_channel(3), gannbox, gannbox_square, gannbox_fixed(1–2), gannbox_fan, date_range, price_range, date_and_price_range, bars_pattern, ghost_feed, projection(3), regression_trend, fixed_range_volume_profile, sine_line, cyclic_lines, time_cycles, path/polyline/brush (N points), double_curve(3), curve(3), parallel_channel(3), disjoint_angle(4), flat_bottom(3), pitchfork/schiff*/inside_pitchfork/pitchfan(3), triangle(3), rotated_rectangle(3), xabcd_pattern(5), cypher_pattern(5), abcd_pattern(4), triangle_pattern(4), 3divers_pattern(7), head_and_shoulders(7), elliott_impulse_wave(6), elliott_triangle_wave(6), elliott_triple_combo(6), elliott_correction(4), elliott_double_combo(4), forecast(2).

Override property names per tool: Appendix B (86 `*LineToolOverrides` interfaces, e.g. `linetooltrendline.linecolor`); common vocabulary: `linecolor, linestyle (0/1/2), linewidth (1–4), extendLeft, extendRight, leftEnd/rightEnd (0 normal, 1 arrow), showPriceLabels, showBarsRange, showDateTimeRange, showDistance, showAngle, showPercentPriceRange, showPipsPriceRange, showPriceRange, showMiddlePoint, alwaysShowStats, statsPosition, textcolor, fontsize, bold, italic, horzLabelsAlign (left/center/right), vertLabelsAlign (top/middle/bottom), backgroundColor, fillBackground, transparency (0–100), levelN.{visible,color,coeff,linewidth,linestyle,text}`.

### 8.8 Trading primitives (order/position/execution lines)

Trading Platform only since v29. `createOrderLine(): Promise<IOrderLineAdapter>` — a horizontal line at `price` with a **text body** box, a **quantity** box and a **cancel (×)** button at the right end; draggable when `setEditable(true)` (`onMove` after drop, `onMoving` during); buttons appear only when a callback is attached (`onModify`, `onCancel`); setters (chainable): `setPrice, setText, setTooltip, setModifyTooltip, setCancelTooltip, setQuantity(string), setEditable, setCancellable, setExtendLeft, setLineLength(n, "pixel"|"percentage")` (negative pixel length measures from the left), `setLineStyle(0|1|2), setLineWidth, setBodyFont, setQuantityFont, setLineColor, setBodyBorderColor, setBodyBackgroundColor, setBodyTextColor, setQuantityBorderColor, setQuantityBackgroundColor, setQuantityTextColor, setCancelButtonBorderColor, setCancelButtonBackgroundColor, setCancelButtonIconColor`, `remove()` (+ matching getters). `createPositionLine(): IPositionLineAdapter` — same look with **reverse** and **close** buttons (`onReverse`, `onClose`, `onModify`), tooltips `setProtectTooltip/setReverseTooltip/setCloseTooltip`, colours for reverse/close buttons, `bodyTextPositive/Negative/NeutralColor` overrides for P&L text. `createExecutionShape(): IExecutionLineAdapter` — a buy/sell **arrow** at (`time`, `price`) with text: `setPrice, setTime, setDirection("buy"|"sell"), setText, setTooltip, setArrowColor, setArrowHeight, setArrowSpacing, setFont, setTextColor`, `remove()`; arrows cannot be moved by the user. Defaults come from `linetoolorder.*`/`linetoolposition.*`/`linetoolexecution.*` overrides (Appendix B) and `trading_customization`. Broker-API lines follow `tradingProperties.*` overrides (`showPositions, positionPL.visibility/display, bracketsPL.*, showOrders, showExecutions, showExecutionsLabels, showReverse, extendLeft, lineLength, horizontalAlignment, lineWidth`).

### 8.9 Screenshots

`takeScreenshot()` posts a PNG (`multipart/form-data`, field `preparedImage`) to `snapshot_url` and fires `onScreenshotReady(url)`; the snapshot menu items *Copy link / Open in new tab / Tweet image* need the server. `takeClientScreenshot(options)` returns an `HTMLCanvasElement` (default *Download image* / *Copy image*). Custom menu items are not supported (hide items with CSS `div[data-name="tweet-chart-image"]` etc.). `snapshot_trading_drawings` includes orders/positions.

### 8.10 Marks API

`getMarks(symbolInfo, from, to, onDataCallback, resolution)` / `getTimescaleMarks(...)` called for the visible range (call the callback once); UDF `/marks`, `/timescale_marks`. See 7.4 for rendering. `refreshMarks()` re-requests; `clearMarks()`.

### 8.11 Featuresets (complete list with defaults)

**On by default**: `context_menus, legend_context_menu, pane_context_menu, scales_context_menu, edit_buttons_in_legend, legend_inplace_edit, delete_button_in_legend, format_button_in_legend, show_hide_button_in_legend, header_widget, header_chart_type, header_compare, header_fullscreen_button, header_indicators, header_resolutions, show_interval_dialog_on_key_press, header_screenshot, header_settings, header_symbol_search, header_undo_redo, header_quick_search, header_saveload, symbol_search_hot_key, use_localstorage_for_settings, save_chart_properties_to_local_storage, adaptive_logo, border_around_the_chart, chart_property_page_right_margin_editor, chart_property_page_scales, clear_price_scale_on_error_or_empty_bars, control_bar, countdown, display_market_status, go_to_date, hide_main_series_symbol_from_indicator_legend, items_favoriting, left_toolbar, legend_widget, main_series_scale_menu, object_tree_legend_mode, property_pages, popup_hints, remove_library_container_border, scales_date_format, scales_time_hours_format, show_chart_property_page, show_right_widgets_panel_by_default, show_symbol_logo_for_compare_studies, show_symbol_logo_in_legend, show_object_tree, source_selection_markers, symbol_info, timeframes_toolbar, timezone_menu, auto_enable_symbol_labels, axis_pressed_mouse_move_scale, chart_scroll, chart_zoom, create_volume_indicator_by_default, create_volume_indicator_by_default_once, constraint_dialogs_movement, cropped_tick_marks, datasource_copypaste, horz_touch_drag_scroll, insert_indicator_dialog_shortcut, library_custom_color_themes, long_press_floating_tooltip, mouse_wheel_scale, mouse_wheel_scroll, pinch_scale, pressed_mouse_move_scroll, right_bar_stays_on_scroll, save_shortcut, shift_visible_range_on_new_bar, uppercase_instrument_names, vert_touch_drag_scroll, volume_force_overlay` + Trading Platform: `add_to_watchlist, buy_sell_buttons, broker_button, chart_crosshair_menu, chart_property_page_trading, drawing_templates, header_layouttoggle, multiple_watchlists, open_account_manager, order_info, order_panel, order_panel_close_button, order_panel_undock, prefer_symbol_name_over_fullname, right_toolbar, show_symbol_logo_in_account_manager, show_symbol_logo_in_close_position_dialog, show_symbol_logo_in_cancel_order_dialog, show_trading_notifications_history, support_multicharts, trading_account_manager, trading_notifications, watchlist_context_menu, watchlist_import_export, watchlist_sections, prefer_quote_short_name, watchlist_cross_tab_sync`.

**Off by default**: `allow_arbitrary_symbol_search_input, always_show_legend_values_on_mobile, chart_style_hilo, chart_style_hilo_last_price, compare_symbol_search_spread_operators, display_data_mode, display_legend_on_all_charts, dont_show_boolean_study_arguments, hide_image_invalid_symbol, hide_last_na_study_output, hide_left_toolbar_by_default, hide_price_scale_global_last_bar_value, hide_exponentiation_spread_operator, hide_reciprocal_spread_operator, hide_object_tree_and_price_scale_exchange_label, hide_resolution_in_legend, hide_unresolved_symbols_in_legend, pricescale_currency, pricescale_unit, pre_post_market_sessions, show_average_close_price_line_and_label, show_exchange_logos, show_symbol_logos, show_percent_option_for_right_margin, show_zoom_and_move_buttons_on_touch, snapshot_trading_drawings, studies_symbol_search_spread_operators, symbol_info_long_description, symbol_info_price_source, use_na_string_for_not_available_values, use_symbol_name_for_header_toolbar, always_show_study_symbol_input_values_in_legend, move_logo_to_main_pane, accessible_keyboard_shortcuts, aria_crosshair_price_description, aria_detailed_chart_descriptions, chart_drag_export, charting_library_debug_mode, confirm_overwrite_if_chart_layout_with_name_exists, custom_resolutions, determine_first_data_request_size_using_visible_range, disable_legend_inplace_resolution_change, disable_legend_inplace_symbol_change, disable_pulse_animation, disable_resolution_rebuild, end_of_period_timescale_marks, fix_left_edge, header_in_fullscreen_mode, hide_price_scale_if_all_sources_hidden, inactivity_gaps, iframe_loading_compatibility_mode, iframe_loading_same_origin, keep_selected_group_on_tool_creation, legend_bar_change_colors_based_on_value, lock_visible_time_range_on_resize, lock_visible_time_range_when_adjusting_percentage_right_margin, low_density_bars, no_min_chart_width, pin_bar_mark_tooltips_on_click, pre_post_market_price_line, request_only_visible_range_on_reset, saveload_separate_drawings_storage, seconds_resolution, secondary_series_extend_time_scale, side_toolbar_in_fullscreen_mode, studies_extend_time_scale, study_templates, study_symbol_ticker_description, study_overlay_compare_legend_option, tick_resolution, two_character_bar_marks_labels, use_last_visible_bar_value_in_legend` + Trading Platform: `always_pass_called_order_to_modify, chart_hide_close_position_button, chart_hide_close_order_button, chart_template_storage, dom_widget, static_dom, hide_right_toolbar, hide_right_toolbar_tabs, keep_object_tree_widget_in_right_toolbar, legend_last_day_change, show_buy_sell_buttons_on_unsupported_resolution, show_dom_first_time, show_last_price_and_change_only_in_series_legend, show_order_panel_on_start`.

---

## 9. BAR REPLAY (tradingview.com only)

Not available in the library (FAQ "Unsupported features"; `Status.Replay = 11` exists in the d.ts as a series status). Behaviour on tradingview.com (help center "Bar Replay: how and why to test a strategy in the past", "How do I turn Bar Replay on?"):

1. **Start**: click the **Bar Replay** button (rewind icon ⏪) in the top toolbar. A replay toolbar appears (top of the chart) and the chart enters **start-point selection mode**: a blue vertical line with a scissors icon follows the cursor; click a bar to cut history there (all later bars are hidden). Alternatives in the toolbar's "Select bar" menu: *first available day*, *random bar*, or *Jump to…* a date.
2. **Toolbar controls**: **Play/Pause** (`Shift+↓`) — autoplay adds one bar per tick at the chosen **speed** (a speed dropdown: from very slow to very fast; the docs say "adjust the speed before or during replay"; TV.com offers steps such as 10×, 3×, 1×, 0.3×, 0.1× bars per second **[GUESS]** on exact labels), **Step forward** (`Shift+→`, adds exactly one bar), **Go to / Select bar** (change the start point during replay), **Jump to real-time** (exit and return to live data), **Real-time / Exit (×)**.
3. During replay: the chart shows only bars up to the replay cursor; indicators recalculate on the replayed data; drawings work as annotations; alerts cannot be created and server alerts keep using live data; trading orders execute on real-time data; regression trend and fixed-range volume profile are inactive. Unsupported: Renko, Kagi, PnF, Range, Line Break, Volume Footprint, TPO, spread charts, tick-based charts.
4. **Multi-chart replay**: choose "current chart" or "all charts"; charts are time-synchronised (a weekly chart waits for seven daily bars).
5. Switching interval/symbol during replay keeps the replay time; historical intraday depth depends on plan (e.g. 1-second bars from 2022-08-17, 1-minute from 2000-01-03 for AAPL). Exiting **saves the session** (symbol, interval, last bar time — not chart style) so it can be resumed.
6. Legend shows a "Replay" status; the time scale shows the replay cursor as a vertical line; bars to the right are empty (future) space.

Implementation hint for the clone: replay = a datafeed wrapper that truncates history at `t0` and emits bars from the hidden tail on a timer, with `resetCache()` + `resetData()` when the cut point changes.

---

## 10. OTHER NOTABLE BEHAVIOURS

* **Alerts on chart (TV.com)**: `Alt+A` / "Create alert" button / right-click "Add alert on <symbol> at <price>" / the price-scale **+** button; alert dialog: condition (symbol or indicator plot or drawing; *Crossing, Crossing Up, Crossing Down, Greater Than, Less Than, Entering Channel, Exiting Channel, Inside Channel, Outside Channel, Moving Up, Moving Down, Moving Up %, Moving Down %*), trigger (*Only once / Once per bar / Once per bar close / Every time*), expiration, name, message, notifications. Active price alerts are drawn as a horizontal line with a bell label on the price scale; drag the label to change the level; Settings → Alerts controls line colour/only-active/volume/auto-hide (20 s).
* **Event marks (TV.com)**: earnings/dividends/splits/news/ideas glyphs on the time scale (Settings → Events), the same rendering as `TimescaleMark` with shapes `earning`, `earningUp`, `earningDown`, `circle`; earnings can add a vertical "earnings break line".
* **Volume overlay defaults**: Volume study (`volume.*` overrides): plot `volume.volume` (histogram; `color`, palette indexes `volume.volume.color.0` = down, `.1` = up — TV default red/green at 50 % transparency, **[GUESS]** on the exact alpha), `volume.volume.transparency`, `volume.show ma` (false), `volume.ma length` (20 **[GUESS]**), `volume.volume ma:plot.*`, `volume.smoothed ma.*`, `volume.smoothing line`, `volume.smoothing length`, `volume.color based on previous close` (false), `volume.other symbol`. Overlaid at the bottom of the main pane with its own hidden scale (`volumePaneSize` Large) and a legend row "Vol" + value; hidden for `visible_plots_set: "ohlc"` / `"c"`.
* **Auto-scale while scrolling**: with auto on, the price range re-fits the visible bars on every scroll/zoom (recalculated per pane from `autoscaleInfo(visibleBars)`); when off, the price range is frozen and drag-panning vertically is enabled.
* **Symbol change**: header button shows the new symbol; the legend, watermark, scales and studies reload (`onSymbolChanged`); TV.com animates the header symbol text; `setSymbol` resolves when data is loaded (`dataReady`). If the new symbol lacks the current resolution the first available one is chosen; `Status` values seen in the legend: `Resolving, Loading, Ready, InvalidSymbol, Snapshot, EOD, Pulse (live), Delayed, DelayedStreaming, NoBars, Replay, Error, CalculationError, UnsupportedResolution`.
* **Quick trading / Buy-Sell buttons** (Trading Platform): legend shows Buy/Sell buttons with bid/ask (`buy_sell_buttons`), Broker button, order ticket; not part of the chart core.
* **Touch gestures** (mobile docs): single-finger drag pans; drag on an axis scales it; **pinch** zooms (`pinch_scale`); **long press** opens axis context menus and enters crosshair tracking mode (legend shows OHLC); single tap exits; **double tap** a line drawing to enter "line movement mode" then drag vertically; only one price scale on mobile; zoom/move buttons appear when the time scale is pressed (`show_zoom_and_move_buttons_on_touch`); legend shows only close/change/% outside tracking mode (values from quotes on Trading Platform). Kinetic (fling) scrolling on touch [LWC].
* **Accessibility**: keyboard navigation (`Alt+Z`/`Tab`), ARIA descriptions (`custom_chart_description_function`, `aria_detailed_chart_descriptions`), colour/contrast notes.
* **Performance**: `workers.enabled` moves indicator calculations to a worker; LWC conflation options exist for very dense data (`enableConflation`).
* **Multi-chart layouts (Trading Platform)**: up to 8 charts (`LayoutType` such as `"s", "2h", "2v", "3h", "3v", "3s", "4", "6", "8", …`), sync toggles, `drawOnAllChartsEnabled`, per-chart `applyOverrides`, `unloadUnusedCharts`, `setLayoutSizes`, `maximizeChart` (`Alt+Enter`).
* **Localization**: 21 locales; `custom_translate_function`; RTL support.
* **Session/timezone edge cases**: DST handled; bars outside the session dropped; intraday bars aligned to session open; daily bars at 00:00 UTC of the trading day; "Japanese charts show incorrect time" = misaligned datafeed timestamps.

---

## 11. GAPS — things not found in any document

* Exact pixel geometry (candle body width vs bar spacing, wick width, minimum body width, marker radius, Volume-candle width scaling) — only Lightweight Charts source can be used as a reference implementation.
* Default `rightOffset` (bars) of the TV library (10 seen in saved layouts, not documented); min pane height; exact Bar Replay speed labels; exact ordering/wording of the pane/time-scale context menus; the override key for "Session breaks"; dark-theme pane defaults; Renko slot/time labelling for multiple bricks per bar; Heikin Ashi first-bar seed; PnF/Kagi/Line Break projection rendering details.
* TV.com-only features have no API docs: alerts dialog fields, Events tab internals, "Lock cursor by time", "Show weekday" on the axis, snapshot "Tweet"/share flows.
* Per-drawing default values are not in the current typings (`*LineToolOverrides` list names only); Appendix C reproduces the **old (v1.x) wiki defaults**, which are likely stale (colours changed to the 2021 palette).

---

## APPENDIX A — Lightweight Charts v5 defaults used as engine reference [LWC]

```
timeScale: rightOffset 0, barSpacing 6, minBarSpacing 0.5, maxBarSpacing 0 (=width/2),
  fixLeftEdge false, fixRightEdge false, lockVisibleTimeRangeOnResize false,
  rightBarStaysOnScroll false, borderVisible true, borderColor '#2B2B43', visible true,
  timeVisible false, secondsVisible true, shiftVisibleRangeOnNewBar true,
  allowShiftVisibleRangeOnWhitespaceReplacement false, ticksVisible false,
  tickMarkMaxCharacterLength 8 (default), uniformDistribution false, minimumHeight 0,
  allowBoldLabels true, ignoreWhitespaceIndices false
priceScale (right visible, left hidden): autoScale true, mode Normal, invertScale false,
  alignLabels true, scaleMargins {top 0.2, bottom 0.1}, borderVisible true, borderColor '#2B2B43',
  entireTextOnly false, ticksVisible false, minimumWidth 0, ensureEdgeTickMarksVisible false,
  tickMarkDensity 2.5
crosshair: mode Magnet; vertLine/horzLine {color '#9598A1', width 1, style LargeDashed,
  visible true, labelVisible true, labelBackgroundColor '#131722'}
grid: vertLines/horzLines {color '#D6DCDE', style Solid, visible true}
layout: background solid '#FFFFFF', textColor '#191919', fontSize 12,
  fontFamily -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif,
  panes {enableResize true, separatorColor '#E0E3EB', separatorHoverColor 'rgba(178,181,189,0.2)'},
  attributionLogo true
handleScroll {mouseWheel, pressedMouseMove, horzTouchDrag, vertTouchDrag: all true}
handleScale {mouseWheel true, pinch true, axisPressedMouseMove {time true, price true},
  axisDoubleClickReset {time true, price true}}
kineticScroll {mouse false, touch true}; trackingMode.exitMode OnNextTap
localization: locale navigator.language, dateFormat "dd MMM 'yy"
series common: lastValueVisible true, priceLineVisible true, priceLineSource LastBar,
  priceLineWidth 1, priceLineStyle Dashed, priceFormat {type 'price', precision 2, minMove 0.01},
  baseLineVisible true, baseLineColor '#B2B5BE', baseLineWidth 1, baseLineStyle Solid
candlestick: upColor '#26a69a', downColor '#ef5350', wickVisible true, borderVisible true,
  borderColor '#378658', wickColor '#737375' (+ per-direction border/wick colours)
bar: upColor '#26a69a', downColor '#ef5350', openVisible true, thinBars true
area: topColor 'rgba(46,220,135,0.4)', bottomColor 'rgba(40,221,100,0)', lineColor '#33D778',
  lineWidth 3, lineType Simple|WithSteps|Curved, crosshairMarkerRadius 4
baseline: baseValue {type 'price', price 0}, topLineColor 'rgba(38,166,154,1)', bottomLineColor
  'rgba(239,83,80,1)', fills 0.28/0.05 alpha, lineWidth 3
mouse-event constants: click cancelled after 5 px manhattan move; double-click within 5 px
  (mouse) / 30 px (touch); kinetic MaxStartDelay 50 ms, EpsilonDistance 1 px; default animated
  scroll 400 ms
```


## APPENDIX B — Drawing override property names per tool (`*LineToolOverrides`, v32.1.0)

Use as `overrides: { "<key>": value }` in the Widget Constructor / `applyOverrides`, or without the `linetoolXXX.` prefix inside `createShape`/`createMultipointShape` `overrides` and `setProperties`. Value vocabulary: `linestyle 0|1|2`, `linewidth 1–4`, colours as `#rrggbb`/`rgba()`, `transparency 0–100`, alignments `left|center|right` / `top|middle|bottom`, `leftEnd/rightEnd 0|1`. Icons/stickers/emojis cannot be styled via constructor overrides (use the Drawings API `overrides` parameter with `size`, `color`, `angle`, `sticker`, `emoji`).

* **`linetoolabcd`** (6 keys): `bold`, `color`, `fontsize`, `italic`, `linewidth`, `textcolor`
* **`linetoolanchoredvp`** (13 keys): `graphics.hhists.histBars2.colors.0`, `graphics.hhists.histBars2.colors.1`, `graphics.hhists.histBars2.valuesColor`, `graphics.hhists.histBarsVA.colors.0`, `graphics.hhists.histBarsVA.colors.1`, `graphics.hhists.histBarsVA.valuesColor`, `graphics.horizlines.pocLines.color`, `graphics.horizlines.vahLines.color`, `graphics.horizlines.valLines.color`, `graphics.polygons.histBoxBg.color`, `styles.developingPoc.color`, `styles.developingVAHigh.color`, `styles.developingVALow.color`
* **`linetoolanchoredvwap`** (65 keys): `areaBackground.backgroundColor`, `areaBackground.fillBackground`, `areaBackground.transparency`, `filledAreasStyle.Background_1.color`, `filledAreasStyle.Background_1.transparency`, `filledAreasStyle.Background_1.visible`, `inputs.Bands Calculation Mode`, `inputs.bands_multiplier`, `inputs.bands_multiplier_2`, `inputs.bands_multiplier_3`, `inputs.calculate_stDev`, `inputs.calculate_stDev_2`, `inputs.calculate_stDev_3`, `inputs.source`, `inputs.start_time`, `precision`, `styles.LowerBand.color`, `styles.LowerBand.display`, `styles.LowerBand.linestyle`, `styles.LowerBand.linewidth`, `styles.LowerBand.plottype`, `styles.LowerBand.trackPrice`, `styles.LowerBand.transparency`, `styles.LowerBand_2.color`, `styles.LowerBand_2.display`, `styles.LowerBand_2.linestyle`, `styles.LowerBand_2.linewidth`, `styles.LowerBand_2.plottype`, `styles.LowerBand_2.trackPrice`, `styles.LowerBand_2.transparency`, `styles.LowerBand_3.color`, `styles.LowerBand_3.display`, `styles.LowerBand_3.linestyle`, `styles.LowerBand_3.linewidth`, `styles.LowerBand_3.plottype`, `styles.LowerBand_3.trackPrice`, `styles.LowerBand_3.transparency`, `styles.UpperBand.color`, `styles.UpperBand.display`, `styles.UpperBand.linestyle`, `styles.UpperBand.linewidth`, `styles.UpperBand.plottype`, `styles.UpperBand.trackPrice`, `styles.UpperBand.transparency`, `styles.UpperBand_2.color`, `styles.UpperBand_2.display`, `styles.UpperBand_2.linestyle`, `styles.UpperBand_2.linewidth`, `styles.UpperBand_2.plottype`, `styles.UpperBand_2.trackPrice`, `styles.UpperBand_2.transparency`, `styles.UpperBand_3.color`, `styles.UpperBand_3.display`, `styles.UpperBand_3.linestyle`, `styles.UpperBand_3.linewidth`, `styles.UpperBand_3.plottype`, `styles.UpperBand_3.trackPrice`, `styles.UpperBand_3.transparency`, `styles.VWAP.color`, `styles.VWAP.display`, `styles.VWAP.linestyle`, `styles.VWAP.linewidth`, `styles.VWAP.plottype`, `styles.VWAP.trackPrice`, `styles.VWAP.transparency`
* **`linetoolarc`** (5 keys): `backgroundColor`, `color`, `fillBackground`, `linewidth`, `transparency`
* **`linetoolarrow`** (24 keys): `alwaysShowStats`, `bold`, `extendLeft`, `extendRight`, `fontsize`, `horzLabelsAlign`, `italic`, `leftEnd`, `linecolor`, `linestyle`, `linewidth`, `rightEnd`, `showAngle`, `showBarsRange`, `showDateTimeRange`, `showDistance`, `showMiddlePoint`, `showPercentPriceRange`, `showPipsPriceRange`, `showPriceLabels`, `showPriceRange`, `statsPosition`, `textcolor`, `vertLabelsAlign`
* **`linetoolarrowmarkdown`** (6 keys): `arrowColor`, `bold`, `color`, `fontsize`, `italic`, `showLabel`
* **`linetoolarrowmarker`** (5 keys): `backgroundColor`, `bold`, `fontsize`, `italic`, `textColor`
* **`linetoolarrowmarkleft`** (6 keys): `arrowColor`, `bold`, `color`, `fontsize`, `italic`, `showLabel`
* **`linetoolarrowmarkright`** (6 keys): `arrowColor`, `bold`, `color`, `fontsize`, `italic`, `showLabel`
* **`linetoolarrowmarkup`** (6 keys): `arrowColor`, `bold`, `color`, `fontsize`, `italic`, `showLabel`
* **`linetoolballoon`** (5 keys): `backgroundColor`, `borderColor`, `color`, `fontsize`, `transparency`
* **`linetoolbarspattern`** (4 keys): `color`, `flipped`, `mirrored`, `mode`
* **`linetoolbeziercubic`** (10 keys): `backgroundColor`, `extendLeft`, `extendRight`, `fillBackground`, `leftEnd`, `linecolor`, `linestyle`, `linewidth`, `rightEnd`, `transparency`
* **`linetoolbezierquadro`** (10 keys): `backgroundColor`, `extendLeft`, `extendRight`, `fillBackground`, `leftEnd`, `linecolor`, `linestyle`, `linewidth`, `rightEnd`, `transparency`
* **`linetoolbrush`** (8 keys): `backgroundColor`, `fillBackground`, `leftEnd`, `linecolor`, `linewidth`, `rightEnd`, `smooth`, `transparency`
* **`linetoolcallout`** (10 keys): `backgroundColor`, `bold`, `bordercolor`, `color`, `fontsize`, `italic`, `linewidth`, `transparency`, `wordWrap`, `wordWrapWidth`
* **`linetoolcircle`** (8 keys): `backgroundColor`, `bold`, `color`, `fillBackground`, `fontSize`, `italic`, `linewidth`, `textColor`
* **`linetoolcomment`** (5 keys): `backgroundColor`, `borderColor`, `color`, `fontsize`, `transparency`
* **`linetoolcrossline`** (5 keys): `linecolor`, `linestyle`, `linewidth`, `showPrice`, `showTime`
* **`linetoolcypherpattern`** (9 keys): `backgroundColor`, `bold`, `color`, `fillBackground`, `fontsize`, `italic`, `linewidth`, `textcolor`, `transparency`
* **`linetooldateandpricerange`** (26 keys): `backgroundColor`, `backgroundTransparency`, `borderColor`, `borderWidth`, `customText.bold`, `customText.color`, `customText.fontsize`, `customText.italic`, `customText.visible`, `drawBorder`, `extendBottom`, `extendTop`, `fillBackground`, `fillLabelBackground`, `fontsize`, `labelBackgroundColor`, `linecolor`, `linewidth`, `shadow`, `showBarsRange`, `showDateTimeRange`, `showPercentPriceRange`, `showPipsPriceRange`, `showPriceRange`, `showVolume`, `textColor`
* **`linetooldaterange`** (20 keys): `backgroundColor`, `backgroundTransparency`, `customText.bold`, `customText.color`, `customText.fontsize`, `customText.italic`, `customText.visible`, `extendBottom`, `extendTop`, `fillBackground`, `fillLabelBackground`, `fontsize`, `labelBackgroundColor`, `linecolor`, `linewidth`, `shadow`, `showBarsRange`, `showDateTimeRange`, `showVolume`, `textColor`
* **`linetooldisjointangle`** (25 keys): `backgroundColor`, `bold`, `extendLeft`, `extendRight`, `fillBackground`, `fontsize`, `italic`, `labelBold`, `labelFontSize`, `labelHorzAlign`, `labelItalic`, `labelTextColor`, `labelVertAlign`, `labelVisible`, `leftEnd`, `linecolor`, `linestyle`, `linewidth`, `rightEnd`, `showBarsRange`, `showDateTimeRange`, `showPriceRange`, `showPrices`, `textcolor`, `transparency`
* **`linetoolelliottcorrection`** (4 keys): `color`, `degree`, `linewidth`, `showWave`
* **`linetoolelliottdoublecombo`** (4 keys): `color`, `degree`, `linewidth`, `showWave`
* **`linetoolelliottimpulse`** (4 keys): `color`, `degree`, `linewidth`, `showWave`
* **`linetoolelliotttriangle`** (4 keys): `color`, `degree`, `linewidth`, `showWave`
* **`linetoolelliotttriplecombo`** (4 keys): `color`, `degree`, `linewidth`, `showWave`
* **`linetoolellipse`** (9 keys): `backgroundColor`, `bold`, `color`, `fillBackground`, `fontSize`, `italic`, `linewidth`, `textColor`, `transparency`
* **`linetoolemoji`** (2 keys): `angle`, `size`
* **`linetoolexecution`** (13 keys): `arrowBuyColor`, `arrowHeight`, `arrowSellColor`, `arrowSpacing`, `direction`, `fontBold`, `fontFamily`, `fontItalic`, `fontSize`, `text`, `textColor`, `textTransparency`, `tooltip`
* **`linetoolextended`** (24 keys): `alwaysShowStats`, `bold`, `extendLeft`, `extendRight`, `fontsize`, `horzLabelsAlign`, `italic`, `leftEnd`, `linecolor`, `linestyle`, `linewidth`, `rightEnd`, `showAngle`, `showBarsRange`, `showDateTimeRange`, `showDistance`, `showMiddlePoint`, `showPercentPriceRange`, `showPipsPriceRange`, `showPriceLabels`, `showPriceRange`, `statsPosition`, `textcolor`, `vertLabelsAlign`
* **`linetoolfibchannel`** (84 keys): `coeffsAsPercents`, `extendLeft`, `extendRight`, `fillBackground`, `horzLabelsAlign`, `labelFontSize`, `levelN.coeff`, `levelN.color`, `levelN.visible`, `levelsStyle.linestyle`, `levelsStyle.linewidth`, `showCoeffs`, `showPrices`, `transparency`, `vertLabelsAlign`
* **`linetoolfibcircles`** (63 keys): `coeffsAsPercents`, `fillBackground`, `levelN.coeff`, `levelN.color`, `levelN.linestyle`, `levelN.linewidth`, `levelN.visible`, `showCoeffs`, `transparency`, `trendline.color`, `trendline.linestyle`, `trendline.linewidth`, `trendline.visible`
* **`linetoolfibretracement`** (117 keys): `coeffsAsPercents`, `extendLines`, `extendLinesLeft`, `fibLevelsBasedOnLogScale`, `fillBackground`, `horzLabelsAlign`, `horzTextAlign`, `labelFontSize`, `levelN.coeff`, `levelN.color`, `levelN.text`, `levelN.visible`, `levelsStyle.linestyle`, `levelsStyle.linewidth`, `reverse`, `showCoeffs`, `showPrices`, `showText`, `transparency`, `trendline.color`, `trendline.linestyle`, `trendline.linewidth`, `trendline.visible`, `vertLabelsAlign`, `vertTextAlign`
* **`linetoolfibspeedresistancearcs`** (63 keys): `fillBackground`, `fullCircles`, `levelN.coeff`, `levelN.color`, `levelN.linestyle`, `levelN.linewidth`, `levelN.visible`, `showCoeffs`, `transparency`, `trendline.color`, `trendline.linestyle`, `trendline.linewidth`, `trendline.visible`
* **`linetoolfibspeedresistancefan`** (55 keys): `fillBackground`, `grid.color`, `grid.linestyle`, `grid.linewidth`, `grid.visible`, `hlevelN.coeff`, `hlevelN.color`, `hlevelN.visible`, `linestyle`, `linewidth`, `reverse`, `showBottomLabels`, `showLeftLabels`, `showRightLabels`, `showTopLabels`, `transparency`, `vlevelN.coeff`, `vlevelN.color`, `vlevelN.visible`
* **`linetoolfibtimezone`** (64 keys): `fillBackground`, `horzLabelsAlign`, `levelN.coeff`, `levelN.color`, `levelN.linestyle`, `levelN.linewidth`, `levelN.visible`, `showLabels`, `transparency`, `trendline.color`, `trendline.linestyle`, `trendline.linewidth`, `trendline.visible`, `vertLabelsAlign`
* **`linetoolfibwedge`** (62 keys): `fillBackground`, `levelN.coeff`, `levelN.color`, `levelN.linestyle`, `levelN.linewidth`, `levelN.visible`, `showCoeffs`, `transparency`, `trendline.color`, `trendline.linestyle`, `trendline.linewidth`, `trendline.visible`
* **`linetool5pointspattern`** (9 keys): `backgroundColor`, `bold`, `color`, `fillBackground`, `fontsize`, `italic`, `linewidth`, `textcolor`, `transparency`
* **`linetoolflagmark`** (1 keys): `flagColor`
* **`linetoolflatbottom`** (25 keys): `backgroundColor`, `bold`, `extendLeft`, `extendRight`, `fillBackground`, `fontsize`, `italic`, `labelBold`, `labelFontSize`, `labelHorzAlign`, `labelItalic`, `labelTextColor`, `labelVertAlign`, `labelVisible`, `leftEnd`, `linecolor`, `linestyle`, `linewidth`, `rightEnd`, `showBarsRange`, `showDateTimeRange`, `showPriceRange`, `showPrices`, `textcolor`, `transparency`
* **`linetoolganncomplex`** (137 keys): `arcs.N.color`, `arcs.N.visible`, `arcs.N.width`, `arcs.N.x`, `arcs.N.y`, `arcsBackground.fillBackground`, `arcsBackground.transparency`, `fanlines.N.color`, `fanlines.N.visible`, `fanlines.N.width`, `fanlines.N.x`, `fanlines.N.y`, `fillBackground`, `labelsStyle.bold`, `labelsStyle.fontSize`, `labelsStyle.italic`, `levels.N.color`, `levels.N.visible`, `levels.N.width`, `reverse`, `scaleRatio`, `showLabels`
* **`linetoolgannfan`** (58 keys): `fillBackground`, `levelN.coeff1`, `levelN.coeff2`, `levelN.color`, `levelN.linestyle`, `levelN.linewidth`, `levelN.visible`, `linewidth`, `showLabels`, `transparency`
* **`linetoolgannfixed`** (132 keys): `arcs.N.color`, `arcs.N.visible`, `arcs.N.width`, `arcs.N.x`, `arcs.N.y`, `arcsBackground.fillBackground`, `arcsBackground.transparency`, `fanlines.N.color`, `fanlines.N.visible`, `fanlines.N.width`, `fanlines.N.x`, `fanlines.N.y`, `fillBackground`, `levels.N.color`, `levels.N.visible`, `levels.N.width`, `reverse`
* **`linetoolgannsquare`** (56 keys): `color`, `fans.color`, `fans.visible`, `fillHorzBackground`, `fillVertBackground`, `hlevelN.coeff`, `hlevelN.color`, `hlevelN.visible`, `horzTransparency`, `linestyle`, `linewidth`, `reverse`, `showBottomLabels`, `showLeftLabels`, `showRightLabels`, `showTopLabels`, `vertTransparency`, `vlevelN.coeff`, `vlevelN.color`, `vlevelN.visible`
* **`linetoolghostfeed`** (11 keys): `averageHL`, `candleStyle.borderColor`, `candleStyle.borderDownColor`, `candleStyle.borderUpColor`, `candleStyle.downColor`, `candleStyle.drawBorder`, `candleStyle.drawWick`, `candleStyle.upColor`, `candleStyle.wickColor`, `transparency`, `variance`
* **`linetoolheadandshoulders`** (9 keys): `backgroundColor`, `bold`, `color`, `fillBackground`, `fontsize`, `italic`, `linewidth`, `textcolor`, `transparency`
* **`linetoolhighlighter`** (4 keys): `linecolor`, `smooth`, `transparency`, `width`
* **`linetoolhorzline`** (10 keys): `bold`, `fontsize`, `horzLabelsAlign`, `italic`, `linecolor`, `linestyle`, `linewidth`, `showPrice`, `textcolor`, `vertLabelsAlign`
* **`linetoolhorzray`** (10 keys): `bold`, `fontsize`, `horzLabelsAlign`, `italic`, `linecolor`, `linestyle`, `linewidth`, `showPrice`, `textcolor`, `vertLabelsAlign`
* **`linetoolicon`** (3 keys): `angle`, `color`, `size`
* **`linetoolimage`** (4 keys): `angle`, `cssHeight`, `cssWidth`, `transparency`
* **`linetoolinfoline`** (24 keys): `alwaysShowStats`, `bold`, `extendLeft`, `extendRight`, `fontsize`, `horzLabelsAlign`, `italic`, `leftEnd`, `linecolor`, `linestyle`, `linewidth`, `rightEnd`, `showAngle`, `showBarsRange`, `showDateTimeRange`, `showDistance`, `showMiddlePoint`, `showPercentPriceRange`, `showPipsPriceRange`, `showPriceLabels`, `showPriceRange`, `statsPosition`, `textcolor`, `vertLabelsAlign`
* **`linetoolinsidepitchfork`** (53 keys): `extendLines`, `fillBackground`, `levelN.coeff`, `levelN.color`, `levelN.linestyle`, `levelN.linewidth`, `levelN.visible`, `median.color`, `median.linestyle`, `median.linewidth`, `median.visible`, `style`, `transparency`
* **`linetoolorder`** (55 keys): `bodyBackgroundColor`, `bodyBackgroundTransparency`, `bodyBorderActiveBuyColor`, `bodyBorderActiveSellColor`, `bodyBorderInactiveBuyColor`, `bodyBorderInactiveSellColor`, `bodyFontBold`, `bodyFontFamily`, `bodyFontItalic`, `bodyFontSize`, `bodyTextActiveBuyColor`, `bodyTextActiveLimitColor`, `bodyTextActiveSellColor`, `bodyTextActiveStopColor`, `bodyTextInactiveBuyColor`, `bodyTextInactiveLimitColor`, `bodyTextInactiveSellColor`, `bodyTextInactiveStopColor`, `cancelButtonBackgroundColor`, `cancelButtonBackgroundTransparency`, `cancelButtonBorderActiveBuyColor`, `cancelButtonBorderActiveSellColor`, `cancelButtonBorderInactiveBuyColor`, `cancelButtonBorderInactiveSellColor`, `cancelButtonIconActiveBuyColor`, `cancelButtonIconActiveSellColor`, `cancelButtonIconInactiveBuyColor`, `cancelButtonIconInactiveSellColor`, `cancelTooltip`, `extendLeft`, `lineActiveBuyColor`, `lineActiveSellColor`, `lineColor`, `lineInactiveBuyColor`, `lineInactiveSellColor`, `lineLength`, `lineLengthUnit`, `lineStyle`, `lineWidth`, `modifyTooltip`, `quantityBackgroundActiveBuyColor`, `quantityBackgroundActiveSellColor`, `quantityBackgroundInactiveBuyColor`, `quantityBackgroundInactiveSellColor`, `quantityBorderActiveBuyColor`, `quantityBorderActiveSellColor`, `quantityBorderInactiveBuyColor`, `quantityBorderInactiveSellColor`, `quantityFontBold`, `quantityFontFamily`, `quantityFontItalic`, `quantityFontSize`, `quantityTextColor`, `quantityTextTransparency`, `tooltip`
* **`linetoolparallelchannel`** (19 keys): `backgroundColor`, `extendLeft`, `extendRight`, `fillBackground`, `labelBold`, `labelFontSize`, `labelHorzAlign`, `labelItalic`, `labelTextColor`, `labelVertAlign`, `labelVisible`, `linecolor`, `linestyle`, `linewidth`, `midlinecolor`, `midlinestyle`, `midlinewidth`, `showMidline`, `transparency`
* **`linetoolpath`** (5 keys): `leftEnd`, `lineColor`, `lineStyle`, `lineWidth`, `rightEnd`
* **`linetoolpitchfan`** (51 keys): `fillBackground`, `levelN.coeff`, `levelN.color`, `levelN.linestyle`, `levelN.linewidth`, `levelN.visible`, `median.color`, `median.linestyle`, `median.linewidth`, `median.visible`, `transparency`
* **`linetoolpitchfork`** (53 keys): `extendLines`, `fillBackground`, `levelN.coeff`, `levelN.color`, `levelN.linestyle`, `levelN.linewidth`, `levelN.visible`, `median.color`, `median.linestyle`, `median.linewidth`, `median.visible`, `style`, `transparency`
* **`linetoolpolyline`** (7 keys): `backgroundColor`, `fillBackground`, `filled`, `linecolor`, `linestyle`, `linewidth`, `transparency`
* **`linetoolposition`** (44 keys): `bodyBackgroundColor`, `bodyBackgroundTransparency`, `bodyBorderBuyColor`, `bodyBorderSellColor`, `bodyFontBold`, `bodyFontFamily`, `bodyFontItalic`, `bodyFontSize`, `bodyTextNegativeColor`, `bodyTextNeutralColor`, `bodyTextPositiveColor`, `closeButtonBackgroundColor`, `closeButtonBackgroundTransparency`, `closeButtonBorderBuyColor`, `closeButtonBorderSellColor`, `closeButtonIconBuyColor`, `closeButtonIconSellColor`, `closeTooltip`, `extendLeft`, `lineBuyColor`, `lineLength`, `lineLengthUnit`, `lineSellColor`, `lineStyle`, `lineWidth`, `protectTooltip`, `quantityBackgroundBuyColor`, `quantityBackgroundSellColor`, `quantityBorderBuyColor`, `quantityBorderSellColor`, `quantityFontBold`, `quantityFontFamily`, `quantityFontItalic`, `quantityFontSize`, `quantityTextColor`, `quantityTextTransparency`, `reverseButtonBackgroundColor`, `reverseButtonBackgroundTransparency`, `reverseButtonBorderBuyColor`, `reverseButtonBorderSellColor`, `reverseButtonIconBuyColor`, `reverseButtonIconSellColor`, `reverseTooltip`, `tooltip`
* **`linetoolprediction`** (16 keys): `centersColor`, `failureBackground`, `failureTextColor`, `intermediateBackColor`, `intermediateTextColor`, `linecolor`, `linewidth`, `sourceBackColor`, `sourceStrokeColor`, `sourceTextColor`, `successBackground`, `successTextColor`, `targetBackColor`, `targetStrokeColor`, `targetTextColor`, `transparency`
* **`linetoolpricelabel`** (6 keys): `backgroundColor`, `borderColor`, `color`, `fontsize`, `fontWeight`, `transparency`
* **`linetoolprojection`** (14 keys): `color1`, `color2`, `fillBackground`, `levelN.coeff`, `levelN.color`, `levelN.linestyle`, `levelN.linewidth`, `levelN.visible`, `linewidth`, `showCoeffs`, `transparency`, `trendline.color`, `trendline.linestyle`, `trendline.visible`
* **`linetoolray`** (24 keys): `alwaysShowStats`, `bold`, `extendLeft`, `extendRight`, `fontsize`, `horzLabelsAlign`, `italic`, `leftEnd`, `linecolor`, `linestyle`, `linewidth`, `rightEnd`, `showAngle`, `showBarsRange`, `showDateTimeRange`, `showDistance`, `showMiddlePoint`, `showPercentPriceRange`, `showPipsPriceRange`, `showPriceLabels`, `showPriceRange`, `statsPosition`, `textcolor`, `vertLabelsAlign`
* **`linetoolregressiontrend`** (25 keys): `inputs.first bar time`, `inputs.last bar time`, `inputs.lower diviation`, `inputs.source`, `inputs.upper diviation`, `inputs.use lower diviation`, `inputs.use upper diviation`, `linestyle`, `linewidth`, `precision`, `styles.baseLine.color`, `styles.baseLine.display`, `styles.baseLine.linestyle`, `styles.baseLine.linewidth`, `styles.downLine.color`, `styles.downLine.display`, `styles.downLine.linestyle`, `styles.downLine.linewidth`, `styles.extendLines`, `styles.showPearsons`, `styles.transparency`, `styles.upLine.color`, `styles.upLine.display`, `styles.upLine.linestyle`, `styles.upLine.linewidth`
* **`linetoolriskrewardlong`** (21 keys): `accountSize`, `alwaysShowStats`, `borderColor`, `compact`, `currency`, `drawBorder`, `fillBackground`, `fillLabelBackground`, `fontsize`, `labelBackgroundColor`, `linecolor`, `linewidth`, `lotSize`, `profitBackground`, `profitBackgroundTransparency`, `risk`, `riskDisplayMode`, `showPriceLabels`, `stopBackground`, `stopBackgroundTransparency`, `textcolor`
* **`linetoolriskrewardshort`** (21 keys): `accountSize`, `alwaysShowStats`, `borderColor`, `compact`, `currency`, `drawBorder`, `fillBackground`, `fillLabelBackground`, `fontsize`, `labelBackgroundColor`, `linecolor`, `linewidth`, `lotSize`, `profitBackground`, `profitBackgroundTransparency`, `risk`, `riskDisplayMode`, `showPriceLabels`, `stopBackground`, `stopBackgroundTransparency`, `textcolor`
* **`linetoolrotatedrectangle`** (5 keys): `backgroundColor`, `color`, `fillBackground`, `linewidth`, `transparency`
* **`linetoolschiffpitchfork2`** (53 keys): `extendLines`, `fillBackground`, `levelN.coeff`, `levelN.color`, `levelN.linestyle`, `levelN.linewidth`, `levelN.visible`, `median.color`, `median.linestyle`, `median.linewidth`, `median.visible`, `style`, `transparency`
* **`linetoolschiffpitchfork`** (53 keys): `extendLines`, `fillBackground`, `levelN.coeff`, `levelN.color`, `levelN.linestyle`, `levelN.linewidth`, `levelN.visible`, `median.color`, `median.linestyle`, `median.linewidth`, `median.visible`, `style`, `transparency`
* **`linetoolsignpost`** (6 keys): `bold`, `emoji`, `fontSize`, `italic`, `plateColor`, `showImage`
* **`linetoolsineline`** (3 keys): `linecolor`, `linestyle`, `linewidth`
* **`linetoolsticker`** (2 keys): `angle`, `size`
* **`linetooltext`** (12 keys): `backgroundColor`, `backgroundTransparency`, `bold`, `borderColor`, `color`, `drawBorder`, `fillBackground`, `fixedSize`, `fontsize`, `italic`, `wordWrap`, `wordWrapWidth`
* **`linetooltextabsolute`** (12 keys): `backgroundColor`, `backgroundTransparency`, `bold`, `borderColor`, `color`, `drawBorder`, `fillBackground`, `fixedSize`, `fontsize`, `italic`, `wordWrap`, `wordWrapWidth`
* **`linetoolthreedrivers`** (9 keys): `backgroundColor`, `bold`, `color`, `fillBackground`, `fontsize`, `italic`, `linewidth`, `textcolor`, `transparency`
* **`linetooltimecycles`** (6 keys): `backgroundColor`, `fillBackground`, `linecolor`, `linestyle`, `linewidth`, `transparency`
* **`linetooltrendangle`** (16 keys): `alwaysShowStats`, `bold`, `extendLeft`, `extendRight`, `fontsize`, `italic`, `linecolor`, `linestyle`, `linewidth`, `showBarsRange`, `showMiddlePoint`, `showPercentPriceRange`, `showPipsPriceRange`, `showPriceLabels`, `showPriceRange`, `statsPosition`
* **`linetooltrendbasedfibextension`** (117 keys): `coeffsAsPercents`, `extendLines`, `extendLinesLeft`, `fibLevelsBasedOnLogScale`, `fillBackground`, `horzLabelsAlign`, `horzTextAlign`, `labelFontSize`, `levelN.coeff`, `levelN.color`, `levelN.text`, `levelN.visible`, `levelsStyle.linestyle`, `levelsStyle.linewidth`, `reverse`, `showCoeffs`, `showPrices`, `showText`, `transparency`, `trendline.color`, `trendline.linestyle`, `trendline.linewidth`, `trendline.visible`, `vertLabelsAlign`, `vertTextAlign`
* **`linetooltrendbasedfibtime`** (64 keys): `fillBackground`, `horzLabelsAlign`, `levelN.coeff`, `levelN.color`, `levelN.linestyle`, `levelN.linewidth`, `levelN.visible`, `showCoeffs`, `transparency`, `trendline.color`, `trendline.linestyle`, `trendline.linewidth`, `trendline.visible`, `vertLabelsAlign`
* **`linetooltrendline`** (24 keys): `alwaysShowStats`, `bold`, `extendLeft`, `extendRight`, `fontsize`, `horzLabelsAlign`, `italic`, `leftEnd`, `linecolor`, `linestyle`, `linewidth`, `rightEnd`, `showAngle`, `showBarsRange`, `showDateTimeRange`, `showDistance`, `showMiddlePoint`, `showPercentPriceRange`, `showPipsPriceRange`, `showPriceLabels`, `showPriceRange`, `statsPosition`, `textcolor`, `vertLabelsAlign`
* **`linetooltriangle`** (5 keys): `backgroundColor`, `color`, `fillBackground`, `linewidth`, `transparency`
* **`linetooltrianglepattern`** (9 keys): `backgroundColor`, `bold`, `color`, `fillBackground`, `fontsize`, `italic`, `linewidth`, `textcolor`, `transparency`
* **`linetoolvertline`** (12 keys): `bold`, `extendLine`, `fontsize`, `horzLabelsAlign`, `italic`, `linecolor`, `linestyle`, `linewidth`, `showTime`, `textcolor`, `textOrientation`, `vertLabelsAlign`

## APPENDIX D — Supported time zone ids (`Timezone` = `"Etc/UTC" | CustomTimezones`)

`Etc/UTC`, `exchange` (widget option only), `Africa/Cairo`, `Africa/Casablanca`, `Africa/Johannesburg`, `Africa/Lagos`, `Africa/Nairobi`, `Africa/Tunis`, `America/Anchorage`, `America/Argentina/Buenos_Aires`, `America/Bogota`, `America/Caracas`, `America/Chicago`, `America/El_Salvador`, `America/Halifax`, `America/Juneau`, `America/Lima`, `America/Los_Angeles`, `America/Mexico_City`, `America/New_York`, `America/Phoenix`, `America/Santiago`, `America/Sao_Paulo`, `America/Toronto`, `America/Vancouver`, `Asia/Almaty`, `Asia/Ashkhabad`, `Asia/Bahrain`, `Asia/Bangkok`, `Asia/Chongqing`, `Asia/Colombo`, `Asia/Dhaka`, `Asia/Dubai`, `Asia/Ho_Chi_Minh`, `Asia/Hong_Kong`, `Asia/Jakarta`, `Asia/Jerusalem`, `Asia/Kabul`, `Asia/Karachi`, `Asia/Kathmandu`, `Asia/Kolkata`, `Asia/Kuala_Lumpur`, `Asia/Kuwait`, `Asia/Manila`, `Asia/Muscat`, `Asia/Nicosia`, `Asia/Qatar`, `Asia/Riyadh`, `Asia/Seoul`, `Asia/Shanghai`, `Asia/Singapore`, `Asia/Taipei`, `Asia/Tehran`, `Asia/Tokyo`, `Asia/Yangon`, `Atlantic/Azores`, `Atlantic/Reykjavik`, `Australia/Adelaide`, `Australia/Brisbane`, `Australia/Perth`, `Australia/Sydney`, `Europe/Amsterdam`, `Europe/Athens`, `Europe/Belgrade`, `Europe/Berlin`, `Europe/Bratislava`, `Europe/Brussels`, `Europe/Bucharest`, `Europe/Budapest`, `Europe/Copenhagen`, `Europe/Dublin`, `Europe/Helsinki`, `Europe/Istanbul`, `Europe/Lisbon`, `Europe/Ljubljana`, `Europe/London`, `Europe/Luxembourg`, `Europe/Madrid`, `Europe/Malta`, `Europe/Moscow`, `Europe/Oslo`, `Europe/Paris`, `Europe/Prague`, `Europe/Riga`, `Europe/Rome`, `Europe/Sofia`, `Europe/Stockholm`, `Europe/Tallinn`, `Europe/Vienna`, `Europe/Vilnius`, `Europe/Warsaw`, `Europe/Zagreb`, `Europe/Zurich`, `Pacific/Auckland`, `Pacific/Chatham`, `Pacific/Fakaofo`, `Pacific/Honolulu`, `Pacific/Norfolk`, `US/Mountain`.

## APPENDIX C — Legacy (v1.x wiki) default drawing properties by `createMultipointShape` shape name

Caveat: these values come from the old public GitHub wiki of the Charting Library (2017–2020). Property *names* are still valid; several default *colours* have since changed to the current palette (`#2962FF` blue, `#089981` green, `#F23645` red). Use them as a starting point only.

You can create more than 50 different shapes using [createMultipointShape(points, options)]. They are listed in the table below along with their default properties that can be changed using `overrides`.

| shape             | backgroundColor | backgroundTransparency | bold  | borderColor | color   | drawBorder | fillBackground | fixedSize | font    | fontsize | italic | text    | wordWrap | wordWrapWidth | markerColor | textColor | linewidth | transparency | fontWeight |
|-------------------|-----------------|------------------------|-------|-------------|---------|------------|----------------|-----------|---------|----------|--------|---------|----------|---------------|-------------|-----------|-----------|--------------|------------|
| text              | #9BBED5         | 70                     | FALSE | #667B8B     | #667B8B | FALSE      | FALSE          | TRUE      | Verdana | 20       | FALSE  | Text    | FALSE    | 400           |             |           |           |              |            |
| anchored_text     | #9BBED5         | 70                     | FALSE | #667B8B     | #667B8B | FALSE      | FALSE          | TRUE      | Verdana | 20       | FALSE  | Text    | FALSE    | 400           |             |           |           |              |            |
| note              | #FFFFFF         | 0                      | FALSE |             |         |            |                | TRUE      | Arial   | 12       | FALSE  | Text    |          |               | #2E66FF     | #000000   |           |              |            |
| anchored_note     | #FFFFFF         | 0                      | FALSE |             |         |            |                | TRUE      | Arial   | 12       | FALSE  | Text    |          |               | #2E66FF     | #000000   |           |              |            |
| callout           | #991515         |                        | FALSE | #991515     | #FFFFFF |            |                |           | Verdana | 12       | FALSE  | Text    | FALSE    | 400           |             |           | 2         | 50           |            |
| balloon           | #fffece         |                        |       | #8c8c8c     | #667b8b |            |                |           | Arial   | 12       |        | Comment |          |               |             |           |           | 30           | bold       |

| shape       | backgroundColor | borderColor | color   | font    | fontsize | text | transparency | fontWeight | textColor
|-------------|-----------------|-------------|---------|---------|----------|------|--------------|------------|-----------
| arrow_up    |                 |             | #787878 | Verdana | 20       | text |              |            |
| arrow_down  |                 |             | #787878 | Verdana | 20       | text |              |            |
| arrow_left  |                 |             | #787878 | Verdana | 20       | text |              |            |
| arrow_right |                 |             | #787878 | Verdana | 20       | text |              |            |
| price_label | #ffffff         | #8c8c8c     | #667b8b | Arial   | 11       |      | 30           | bold       |
| arrow_marker| #1E88E5         |             |         | Arial   | 16       |      |              | bold       | #1E88E5
| flag        |                 |             |         |         |          |      |              |            |

| shape              | backgroundColor | bold  | color   | fillBackground | font    | fontsize | italic | linewidth | textcolor | transparency |
|--------------------|-----------------|-------|---------|----------------|---------|----------|--------|-----------|-----------|--------------|
| xabcd_pattern      | #CC2895         | FALSE | #CC2895 | TRUE           | Verdana | 12       | FALSE  | 1         | #FFFFFF   | 50           |
| abcd_pattern       |                 | FALSE | #009B00 |                | Verdana | 12       | FALSE  | 2         | #FFFFFF   |              |
| triangle_pattern   | #9528CC         | FALSE | #9528FF | TRUE           | Verdana | 12       | FALSE  | 1         | #FFFFFF   | 50           |
| 3divers_pattern    | #9528CC         | FALSE | #9528FF | TRUE           | Verdana | 12       | FALSE  | 2         | #FFFFFF   | 50           |
| head_and_shoulders | #45A82F         | FALSE | #45682F | TRUE           | Verdana | 12       | FALSE  | 2         | #FFFFFF   | 50           |
| cypher_pattern     | #CC2895         | FALSE | #CC2895 | TRUE           | Verdana | 12       | FALSE  | 1         | #FFFFFF   | 50           |

| shape                 | backgroundColor | color   | degree | extendLeft | extendRight | fillBackground | filled | leftEnd | linecolor | linestyle | linewidth | rightEnd | showWave | transparency | trendline.linecolor |
|-----------------------|-----------------|---------|--------|------------|-------------|----------------|--------|---------|-----------|-----------|-----------|----------|----------|--------------|---------------------|
| elliott_impulse_wave  |                 | #3d85c6 | 7      |            |             |                |        |         |           |           | 1         |          | TRUE     |              |                     |
| elliott_triangle_wave |                 | #ff9800 | 7      |            |             |                |        |         |           |           | 1         |          | TRUE     |              |                     |
| elliott_triple_combo  |                 | #6aa84f | 7      |            |             |                |        |         |           |           | 1         |          | TRUE     |              |                     |
| elliott_correction    |                 | #3d85c6 | 7      |            |             |                |        |         |           |           | 1         |          | TRUE     |              |                     |
| elliott_double_combo  |                 | #6aa84f | 7      |            |             |                |        |         |           |           | 1         |          | TRUE     |              |                     |
| cyclic_lines          |                 |         |        |            |             |                |        |         | #80CCDB   | 0         | 1         |          |          |              | #808080             |
| time_cycles           | #6AA84F         |         |        |            |             | TRUE           |        |         | #159980   | 0         | 1         |          |          | 50           |                     |
| sine_line             |                 |         |        |            |             |                |        |         | #159980   | 0         | 1         |          |          |              |                     |
| rectangle             | #153899         | #153899 |        |            |             | TRUE           |        |         |           |           | 1         |          |          | 50           |                     |
| rotated_rectangle     | #8e7cc3         | #9800ff |        |            |             | TRUE           |        |         |           |           | 1         |          |          | 50           |                     |
| ellipse               | #999915         | #999915 |        |            |             | TRUE           |        |         |           |           | 1         |          |          | 50           |                     |
| triangle              | #991515         | #991515 |        |            |             | TRUE           |        |         |           |           | 1         |          |          | 50           |                     |
| polyline              | #153899         |         |        |            |             | TRUE           | FALSE  |         | #353535   | 0         | 2         |          |          | 50           |                     |
| path                  |                 |         |        |            |             |                |        | 0       | #2196f3   | 0         | 2         | 1        |          |              |                     |
| curve                 | #153899         |         |        | FALSE      | FALSE       | FALSE          |        | 0       | #159980   | 0         | 1         | 0        |          | 50           |                     |
| double_curve          | #153899         |         |        | FALSE      | FALSE       | FALSE          |        | 0       | #159980   | 0         | 1         | 0        |          | 50           |                     |
| arc                   | #999915         | #999915 |        |            |             | TRUE           |        |         |           |           | 1         |          |          | 50           |                     |

| shape            | backgroundColor | bold  | extendLeft | extendRight | fillBackground | font    | fontsize | horzLabelsAlign | italic | leftEnd | linecolor | linestyle | linewidth | rightEnd | showAngle | showBarsRange | showDateTimeRange | showDistance | showLabel | showPrice | showPriceRange | showPrices | textcolor | transparency | vertLabelsAlign | showTime | showMidline | midlinecolor | midlinestyle | midlinewidth |
|------------------|-----------------|-------|------------|-------------|----------------|---------|----------|-----------------|--------|---------|-----------|-----------|-----------|----------|-----------|---------------|-------------------|--------------|-----------|-----------|----------------|------------|-----------|--------------|-----------------|----------|-------------|--------------|--------------|--------------|
| vertical_line    |                 |       |            |             |                |         |          |                 |        |         | #80CCDB   | 0         | 1         |          |           |               |                   |              |           |           |                |            |           |              |                 | TRUE     |             |              |              |              |
| horizontal_line  |                 | TRUE  |            |             |                | Verdana | 12       | center          | FALSE  |         | #80CCDB   | 0         | 1         |          |           |               |                   |              | FALSE     | TRUE      |                |            | #157760   |              | top             |          |             |              |              |              |
| cross_line       |                 |       |            |             |                |         |          |                 |        |         | #06A0E3   | 0         | 1         |          |           |               |                   |              | FALSE     | TRUE      |                |            |           |              |                 |          |             |              |              |              |
| horizontal_ray   |                 | TRUE  |            |             |                | Verdana | 12       | center          | FALSE  |         | #80CCDB   | 0         | 1         |          |           |               |                   |              | FALSE     | TRUE      |                |            | #157760   |              | top             |          |             |              |              |              |
| trend_line       |                 | FALSE | FALSE      | FALSE       |                | Verdana | 12       |                 | FALSE  | 0       | #159980   | 0         | 1         | 0        | FALSE     | FALSE         | FALSE             | FALSE        |           |           | FALSE          |            | #157760   |              |                 |          |             |              |              |              |
| trend_infoline   |                 | FALSE | FALSE      | FALSE       |                | Verdana | 12       |                 | FALSE  | 0       | #159980   | 0         | 1         | 0        | TRUE      | TRUE          | TRUE              | TRUE         |           |           | TRUE           |            | #157760   |              |                 |          |             |              |              |              |
| trend_angle      |                 | TRUE  | FALSE      | FALSE       |                | Verdana | 12       |                 | FALSE  |         | #159980   | 0         | 1         |          |           | FALSE         |                   |              |           |           | FALSE          |            | #157760   |              |                 |          |             |              |              |              |
| arrow            |                 | FALSE | FALSE      | FALSE       |                | Verdana | 12       |                 | FALSE  | 0       | #6F88C6   | 0         | 2         | 1        | FALSE     | FALSE         | FALSE             | FALSE        |           |           | FALSE          |            | #157760   |              |                 |          |             |              |              |              |
| ray              |                 | FALSE | FALSE      | TRUE        |                | Verdana | 12       |                 | FALSE  | 0       | #159980   | 0         | 1         | 0        | FALSE     | FALSE         | FALSE             | FALSE        |           |           | FALSE          |            | #157760   |              |                 |          |             |              |              |              |
| extended         |                 | FALSE | TRUE       | TRUE        |                | Verdana | 12       |                 | FALSE  | 0       | #159980   | 0         | 1         | 0        | FALSE     | FALSE         | FALSE             | FALSE        |           |           | FALSE          |            | #157760   |              |                 |          |             |              |              |              |
| parallel_channel | #b4a7d6         |       | FALSE      | FALSE       | TRUE           |         |          |                 |        |         | #773499   | 0         | 1         |          |           |               |                   |              |           |           |                |            |           | 50           |                 |          | FALSE       | #773499      | 2            | 1            |
| disjoint_angle   | #6AA84F         | FALSE | FALSE      | FALSE       | TRUE           | Verdana | 12       |                 | FALSE  | 0       | #129f5c   | 0         | 2         | 0        |           | FALSE         | FALSE             |              |           |           | FALSE          | FALSE      | #129f5c   | 50           |                 |          |             |              |              |              |
| flat_bottom      | #153899         | FALSE | FALSE      | FALSE       | TRUE           | Verdana | 12       |                 | FALSE  | 0       | #4985e7   | 0         | 2         | 0        |           | FALSE         | FALSE             |              |           |           | FALSE          | FALSE      | #4985e7   | 50           |                 |          |             |              |              |              |
| fib_spiral       |                 |       |            |             |                |         |          |                 |        |         | #159980   | 0         | 1         |          |           |               |                   |              |           |           |                |            |           |              |                 |          |             |              |              |              |

| shape             | fillBackground | transparency | style | median.visible | median.color | median.linewidth | median.linestyle | level0.visible | level0.color | level0.linewidth | level0.linestyle | level0.coeff | level1.visible | level1.color | level1.linewidth | level1.linestyle | level1.coeff | level2.visible | level2.color | level2.linewidth | level2.linestyle | level2.coeff | level3.visible | level3.color | level3.linewidth | level3.linestyle | level3.coeff | level4.visible | level4.color | level4.linewidth | level4.linestyle | level4.coeff | level5.visible | level5.color | level5.linewidth | level5.linestyle | level5.coeff | level6.visible | level6.color | level6.linewidth | level6.linestyle | level6.coeff | level7.visible | level7.color | level7.linewidth | level7.linestyle | level7.coeff | level8.visible | level8.color | level8.linewidth | level8.linestyle | level8.coeff |
|-------------------|----------------|--------------|-------|----------------|--------------|------------------|------------------|----------------|--------------|------------------|------------------|--------------|----------------|--------------|------------------|------------------|--------------|----------------|--------------|------------------|------------------|--------------|----------------|--------------|------------------|------------------|--------------|----------------|--------------|------------------|------------------|--------------|----------------|--------------|------------------|------------------|--------------|----------------|--------------|------------------|------------------|--------------|----------------|--------------|------------------|------------------|--------------|----------------|--------------|------------------|------------------|--------------|
| pitchfork         | TRUE           | 80           | 0     | TRUE           | #A50000      | 1                | 0                | FALSE          | #A06B00      | 1                | 0                | 0.25         | FALSE          | #699E00      | 1                | 0                | 0.382        | TRUE           | #009B00      | 1                | 0                | 0.5          | FALSE          | #009965      | 1                | 0                | 0.618        | FALSE          | #006599      | 1                | 0                | 0.75         | TRUE           | #000099      | 1                | 0                | 1            | FALSE          | #660099      | 1                | 0                | 1.5          | FALSE          | #990066      | 1                | 0                | 1.75         | FALSE          | #A50000      | 1                | 0                | 2            |
| schiff_pitchfork_modified  | TRUE           | 80           | 1     | TRUE           | #A50000      | 1                | 0                | FALSE          | #A06B00      | 1                | 0                | 0.25         | FALSE          | #699E00      | 1                | 0                | 0.382        | TRUE           | #009B00      | 1                | 0                | 0.5          | FALSE          | #009965      | 1                | 0                | 0.618        | FALSE          | #006599      | 1                | 0                | 0.75         | TRUE           | #000099      | 1                | 0                | 1            | FALSE          | #660099      | 1                | 0                | 1.5          | FALSE          | #990066      | 1                | 0                | 1.75         | FALSE          | #A50000      | 1                | 0                | 2            |
| schiff_pitchfork  | TRUE           | 80           | 3     | TRUE           | #A50000      | 1                | 0                | FALSE          | #A06B00      | 1                | 0                | 0.25         | FALSE          | #699E00      | 1                | 0                | 0.382        | TRUE           | #009B00      | 1                | 0                | 0.5          | FALSE          | #009965      | 1                | 0                | 0.618        | FALSE          | #006599      | 1                | 0                | 0.75         | TRUE           | #000099      | 1                | 0                | 1            | FALSE          | #660099      | 1                | 0                | 1.5          | FALSE          | #990066      | 1                | 0                | 1.75         | FALSE          | #A50000      | 1                | 0                | 2            |
| inside_pitchfork  | TRUE           | 80           | 2     | TRUE           | #A50000      | 1                | 0                | FALSE          | #A06B00      | 1                | 0                | 0.25         | FALSE          | #699E00      | 1                | 0                | 0.382        | TRUE           | #009B00      | 1                | 0                | 0.5          | FALSE          | #009965      | 1                | 0                | 0.618        | FALSE          | #006599      | 1                | 0                | 0.75         | TRUE           | #000099      | 1                | 0                | 1            | FALSE          | #660099      | 1                | 0                | 1.5          | FALSE          | #990066      | 1                | 0                | 1.75         | FALSE          | #A50000      | 1                | 0                | 2            |
| pitchfan          | TRUE           | 80           |       | TRUE           | #A50000      | 1                | 0                | FALSE          | #A06B00      | 1                | 0                | 0.25         | FALSE          | #699E00      | 1                | 0                | 0.382        | TRUE           | #009B00      | 1                | 0                | 0.5          | FALSE          | #009965      | 1                | 0                | 0.618        | FALSE          | #006599      | 1                | 0                | 0.75         | TRUE           | #000099      | 1                | 0                | 1            | FALSE          | #660099      | 1                | 0                | 1.5          | FALSE          | #990066      | 1                | 0                | 1.75         | FALSE          | #A50000      | 1                | 0                | 2            |

| shape          | fillBackground | arcsBackground.fillBackground | arcsBackground.transparency | levels.0.width | levels.0.color | levels.0.visible | levels.1.width | levels.1.color | levels.1.visible | levels.2.width | levels.2.color | levels.2.visible | levels.3.width | levels.3.color | levels.3.visible | levels.4.width | levels.4.color | levels.4.visible | levels.5.width | levels.5.color | levels.5.visible | fanlines.0.width | fanlines.0.color | fanlines.0.visible | fanlines.0.x | fanlines.0.y | fanlines.1.width | fanlines.1.color | fanlines.1.visible | fanlines.1.x | fanlines.1.y | fanlines.2.width | fanlines.2.color | fanlines.2.visible | fanlines.2.x | fanlines.2.y | fanlines.3.width | fanlines.3.color | fanlines.3.visible | fanlines.3.x | fanlines.3.y | fanlines.4.width | fanlines.4.color | fanlines.4.visible | fanlines.4.x | fanlines.4.y | fanlines.5.width | fanlines.5.color | fanlines.5.visible | fanlines.5.x | fanlines.5.y | fanlines.6.width | fanlines.6.color | fanlines.6.visible | fanlines.6.x | fanlines.6.y | fanlines.7.width | fanlines.7.color | fanlines.7.visible | fanlines.7.x | fanlines.7.y | fanlines.8.width | fanlines.8.color | fanlines.8.visible | fanlines.8.x | fanlines.8.y | fanlines.9.width | fanlines.9.color | fanlines.9.visible | fanlines.9.x | fanlines.9.y | fanlines.10.width | fanlines.10.color | fanlines.10.visible | fanlines.10.x | fanlines.10.y | arcs.0.width | arcs.0.color | arcs.0.visible | arcs.0.x | arcs.0.y | arcs.1.width | arcs.1.color | arcs.1.visible | arcs.1.x | arcs.1.y | arcs.2.width | arcs.2.color | arcs.2.visible | arcs.2.x | arcs.2.y | arcs.3.width | arcs.3.color | arcs.3.visible | arcs.3.x | arcs.3.y | arcs.4.width | arcs.4.color | arcs.4.visible | arcs.4.x | arcs.4.y | arcs.5.width | arcs.5.color | arcs.5.visible | arcs.5.x | arcs.5.y | arcs.6.width | arcs.6.color | arcs.6.visible | arcs.6.x | arcs.6.y | arcs.7.width | arcs.7.color | arcs.7.visible | arcs.7.x | arcs.7.y | arcs.8.width | arcs.8.color | arcs.8.visible | arcs.8.x | arcs.8.y | arcs.9.width | arcs.9.color | arcs.9.visible | arcs.9.x | arcs.9.y | arcs.10.width | arcs.10.color | arcs.10.visible | arcs.10.x | arcs.10.y |
|----------------|----------------|-------------------------------|-----------------------------|----------------|----------------|------------------|----------------|----------------|------------------|----------------|----------------|------------------|----------------|----------------|------------------|----------------|----------------|------------------|----------------|----------------|------------------|------------------|------------------|--------------------|--------------|--------------|------------------|------------------|--------------------|--------------|--------------|------------------|------------------|--------------------|--------------|--------------|------------------|------------------|--------------------|--------------|--------------|------------------|------------------|--------------------|--------------|--------------|------------------|------------------|--------------------|--------------|--------------|------------------|------------------|--------------------|--------------|--------------|------------------|------------------|--------------------|--------------|--------------|------------------|------------------|--------------------|--------------|--------------|------------------|------------------|--------------------|--------------|--------------|-------------------|-------------------|---------------------|---------------|---------------|--------------|--------------|----------------|----------|----------|--------------|--------------|----------------|----------|----------|--------------|--------------|----------------|----------|----------|--------------|--------------|----------------|----------|----------|--------------|--------------|----------------|----------|----------|--------------|--------------|----------------|----------|----------|--------------|--------------|----------------|----------|----------|--------------|--------------|----------------|----------|----------|--------------|--------------|----------------|----------|----------|--------------|--------------|----------------|----------|----------|---------------|---------------|-----------------|-----------|-----------|
| gannbox_square | FALSE          | TRUE                          | 50                          | 1              | #808080        | TRUE             | 1              | #A06B00        | TRUE             | 1              | #699E00        | TRUE             | 1              | #009B00        | TRUE             | 1              | #009965        | TRUE             | 1              | #808080        | TRUE             | 1                | #A500FF          | FALSE              | 8            | 1            | 1                | #A50000          | FALSE              | 5            | 1            | 1                | #808080          | FALSE              | 4            | 1            | 1                | #A06B00          | FALSE              | 3            | 1            | 1                | #699E00          | TRUE               | 2            | 1            | 1                | #009B00          | TRUE               | 1            | 1            | 1                | #009965          | TRUE               | 1            | 2            | 1                | #009965          | FALSE              | 1            | 3            | 1                | #000099          | FALSE              | 1            | 4            | 1                | #660099          | FALSE              | 1            | 5            | 1                 | #A500FF           | FALSE               | 1             | 8             | 1            | #A06B00      | TRUE           | 1        | 0        | 1            | #A06B00      | TRUE           | 1        | 1        | 1            | #A06B00      | TRUE           | 1.5      | 0        | 1            | #699E00      | TRUE           | 2        | 0        | 1            | #699E00      | TRUE           | 2        | 1        | 1            | #009B00      | TRUE           | 3        | 0        | 1            | #009B00      | TRUE           | 3        | 1        | 1            | #009965      | TRUE           | 4        | 0        | 1            | #009965      | TRUE           | 4        | 1        | 1            | #000099      | TRUE           | 5        | 0        | 1             | #000099       | TRUE            | 5         | 1         |

| shape       | showLabels | font    | fillBackground | transparency | level1.visible | level1.color | level1.linewidth | level1.linestyle | level1.coeff1 | level1.coeff2 | level2.visible | level2.color | level2.linewidth | level2.linestyle | level2.coeff1 | level2.coeff2 | level3.visible | level3.color | level3.linewidth | level3.linestyle | level3.coeff1 | level3.coeff2 | level4.visible | level4.color | level4.linewidth | level4.linestyle | level4.coeff1 | level4.coeff2 | level5.visible | level5.color | level5.linewidth | level5.linestyle | level5.coeff1 | level5.coeff2 | level6.visible | level6.color | level6.linewidth | level6.linestyle | level6.coeff1 | level6.coeff2 | level7.visible | level7.color | level7.linewidth | level7.linestyle | level7.coeff1 | level7.coeff2 | level8.visible | level8.color | level8.linewidth | level8.linestyle | level8.coeff1 | level8.coeff2 | level9.visible | level9.color | level9.linewidth | level9.linestyle | level9.coeff1 | level9.coeff2 |
|-------------|------------|---------|----------------|--------------|----------------|--------------|------------------|------------------|---------------|---------------|----------------|--------------|------------------|------------------|---------------|---------------|----------------|--------------|------------------|------------------|---------------|---------------|----------------|--------------|------------------|------------------|---------------|---------------|----------------|--------------|------------------|------------------|---------------|---------------|----------------|--------------|------------------|------------------|---------------|---------------|----------------|--------------|------------------|------------------|---------------|---------------|----------------|--------------|------------------|------------------|---------------|---------------|----------------|--------------|------------------|------------------|---------------|---------------|
| gannbox_fan | TRUE       | Verdana | TRUE           | 80           | TRUE           | #A06B00      | 1                | 0                | 1             | 8             | TRUE           | #699E00      | 1                | 0                | 1             | 4             | TRUE           | #009B00      | 1                | 0                | 1             | 3             | TRUE           | #009965      | 1                | 0                | 1             | 2             | TRUE           | #808080      | 1                | 0                | 1             | 1             | TRUE           | #006599      | 1                | 0                | 2             | 1             | TRUE           | #000099      | 1                | 0                | 3             | 1             | TRUE           | #660099      | 1                | 0                | 4             | 1             | TRUE           | #A50000      | 1                | 0                | 8             | 1             |

| shape                | color   | linewidth | linestyle | font    | showTopLabels | showBottomLabels | showLeftLabels | showRightLabels | fillHorzBackground | horzTransparency | fillVertBackground | vertTransparency | hlevel1.color | hlevel1.coeff | hlevel1.visible | hlevel2.color | hlevel2.coeff | hlevel2.visible | hlevel3.color | hlevel3.coeff | hlevel3.visible | hlevel4.color | hlevel4.coeff | hlevel4.visible | hlevel5.color | hlevel5.coeff | hlevel5.visible | hlevel6.color | hlevel6.coeff | hlevel6.visible | hlevel7.color | hlevel7.coeff | hlevel7.visible | vlevel1.color | vlevel1.coeff | vlevel1.visible | vlevel2.color | vlevel2.coeff | vlevel2.visible | vlevel3.color | vlevel3.coeff | vlevel3.visible | vlevel4.color | vlevel4.coeff | vlevel4.visible | vlevel5.color | vlevel5.coeff | vlevel5.visible | vlevel6.color | vlevel6.coeff | vlevel6.visible | vlevel7.color | vlevel7.coeff | vlevel7.visible | fillBackground | transparency | snapTo45Degrees | grid.color | grid.linewidth | grid.linestyle | grid.visible |
|----------------------|---------|-----------|-----------|---------|---------------|------------------|----------------|-----------------|--------------------|------------------|--------------------|------------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|----------------|--------------|-----------------|------------|----------------|----------------|--------------|
| gannbox              | #153899 | 1         | 0         | Verdana | TRUE          | TRUE             | TRUE           | TRUE            | TRUE               | 80               | TRUE               | 80               | #808080       | 0             | TRUE            | #A06B00       | 0.25          | TRUE            | #699E00       | 0.382         | TRUE            | #009B00       | 0.5           | TRUE            | #009965       | 0.618         | TRUE            | #006599       | 0.75          | TRUE            | #808080       | 1             | TRUE            | #808080       | 0             | TRUE            | #A06B00       | 0.25          | TRUE            | #699E00       | 0.382         | TRUE            | #009B00       | 0.5           | TRUE            | #009965       | 0.618         | TRUE            | #006599       | 0.75          | TRUE            | #808080       | 1             | TRUE            |                |              |                 |            |                |                |              |
| fib_speed_resist_fan |         | 1         | 0         | Verdana | TRUE          | TRUE             | TRUE           | TRUE            |                    |                  |                    |                  | #808080       | 0             | TRUE            | #A06B00       | 0.25          | TRUE            | #699E00       | 0.382         | TRUE            | #009B00       | 0.5           | TRUE            | #009965       | 0.618         | TRUE            | #006599       | 0.75          | TRUE            | #808080       | 1             | TRUE            | #808080       | 0             | TRUE            | #A06B00       | 0.25          | TRUE            | #699E00       | 0.382         | TRUE            | #009B00       | 0.5           | TRUE            | #009965       | 0.618         | TRUE            | #006599       | 0.75          | TRUE            | #808080       | 1             | TRUE            | TRUE           | 80           | TRUE            | #808080    | 1              | 0              | TRUE         |

| shape                 | showCoeffs | showPrices | font    | fillBackground | transparency | extendLines | horzLabelsAlign | vertLabelsAlign | reverse | coeffsAsPercents | trendline.visible | trendline.color | trendline.linewidth | trendline.linestyle | levelsStyle.linewidth | levelsStyle.linestyle | level1.visible | level1.color | level1.coeff | level2.visible | level2.color | level2.coeff | level3.visible | level3.color | level3.coeff | level4.visible | level4.color | level4.coeff | level5.visible | level5.color | level5.coeff | level6.visible | level6.color | level6.coeff | level7.visible | level7.color | level7.coeff | level8.visible | level8.color | level8.coeff | level9.visible | level9.color | level9.coeff | level10.visible | level10.color | level10.coeff | level11.visible | level11.color | level11.coeff | level12.visible | level12.color | level12.coeff | level13.visible | level13.color | level13.coeff | level16.visible | level16.color | level16.coeff | level14.visible | level14.color | level14.coeff | level15.visible | level15.color | level15.coeff | level17.visible | level17.color | level17.coeff | level18.visible | level18.color | level18.coeff | level19.visible | level19.color | level19.coeff | level20.visible | level20.color | level20.coeff | level21.visible | level21.color | level21.coeff | level22.visible | level22.color | level22.coeff | level23.visible | level23.color | level23.coeff | level24.visible | level24.color | level24.coeff | baselinecolor | linecolor | linewidth | linestyle | showLabels | level1.linewidth | level1.linestyle | level2.linewidth | level2.linestyle | level3.linewidth | level3.linestyle | level4.linewidth | level4.linestyle | level5.linewidth | level5.linestyle | level6.linewidth | level6.linestyle | level7.linewidth | level7.linestyle | level8.linewidth | level8.linestyle | level9.linewidth | level9.linestyle | level10.linewidth | level10.linestyle | level11.linewidth | level11.linestyle | fullCircles | extendLeft | extendRight |
|-----------------------|------------|------------|---------|----------------|--------------|-------------|-----------------|-----------------|---------|------------------|-------------------|-----------------|---------------------|---------------------|-----------------------|-----------------------|----------------|--------------|--------------|----------------|--------------|--------------|----------------|--------------|--------------|----------------|--------------|--------------|----------------|--------------|--------------|----------------|--------------|--------------|----------------|--------------|--------------|----------------|--------------|--------------|----------------|--------------|--------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|-----------------|---------------|---------------|---------------|-----------|-----------|-----------|------------|------------------|------------------|------------------|------------------|------------------|------------------|------------------|------------------|------------------|------------------|------------------|------------------|------------------|------------------|------------------|------------------|------------------|------------------|-------------------|-------------------|-------------------|-------------------|-------------|------------|-------------|
| fib_retracement       | TRUE       | TRUE       | Verdana | TRUE           | 80           | FALSE       | left            | middle          | FALSE   | FALSE            | TRUE              | #808080         | 1                   | 2                   | 1                     | 0                     | TRUE           | #808080      | 0            | TRUE           | #CC2828      | 0.236        | TRUE           | #95CC28      | 0.382        | TRUE           | #28CC28      | 0.5          | TRUE           | #28CC95      | 0.618        | TRUE           | #2895CC      | 0.764        | TRUE           | #808080      | 1            | TRUE           | #2828CC      | 1.618        | TRUE           | #CC2828      | 2.618        | TRUE            | #9528CC       | 3.618         | TRUE            | #CC2895       | 4.236         | FALSE           | #95CC28       | 1.272         | FALSE           | #CC2828       | 1.414         | FALSE           | #28CC95       | 2             | FALSE           | #95CC28       | 2.272         | FALSE           | #28CC28       | 2.414         | FALSE           | #2895CC       | 3             | FALSE           | #808080       | 3.272         | FALSE           | #2828CC       | 3.414         | FALSE           | #CC2828       | 4             | FALSE           | #9528CC       | 4.272         | FALSE           | #CC2895       | 4.414         | FALSE           | #95CC28       | 4.618         | FALSE           | #28CC95       | 4.764         |               |           |           |           |            |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                   |                   |                   |                   |             |            |             |
| fib_trend_ext         | TRUE       | TRUE       | Verdana | TRUE           | 80           | FALSE       | left            | middle          | FALSE   | FALSE            | TRUE              | #808080         | 1                   | 2                   | 1                     | 0                     | TRUE           | #808080      | 0            | TRUE           | #CC2828      | 0.236        | TRUE           | #95CC28      | 0.382        | TRUE           | #28CC28      | 0.5          | TRUE           | #28CC95      | 0.618        | TRUE           | #2895CC      | 0.764        | TRUE           | #808080      | 1            | TRUE           | #2828CC      | 1.618        | TRUE           | #CC2828      | 2.618        | TRUE            | #9528CC       | 3.618         | TRUE            | #CC2895       | 4.236         | FALSE           | #95CC28       | 1.272         | FALSE           | #CC2828       | 1.414         | FALSE           | #28CC95       | 2             | FALSE           | #95CC28       | 2.272         | FALSE           | #28CC28       | 2.414         | FALSE           | #2895CC       | 3             | FALSE           | #808080       | 3.272         | FALSE           | #2828CC       | 3.414         | FALSE           | #CC2828       | 4             | FALSE           | #9528CC       | 4.272         | FALSE           | #CC2895       | 4.414         | FALSE           | #95CC28       | 4.618         | FALSE           | #28CC95       | 4.764         |               |           |           |           |            |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                   |                   |                   |                   |             |            |             |
| fib_timezone          |            |            | Verdana | FALSE          | 80           |             | right           | bottom          |         |                  | TRUE              | #808080         | 1                   | 2                   |                       |                       | TRUE           | #808080      | 0            | TRUE           | #0055DB      | 1            | TRUE           | #0055DB      | 2            | TRUE           | #0055DB      | 3            | TRUE           | #0055DB      | 5            | TRUE           | #0055DB      | 8            | TRUE           | #0055DB      | 13           | TRUE           | #0055DB      | 21           | TRUE           | #0055DB      | 34           | TRUE            | #0055DB       | 55            | TRUE            | #0055DB       | 89            |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               | #808080       | #0055DB   | 1         | 0         | TRUE       | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                 | 0                 | 1                 | 0                 |             |            |             |
| fib_trend_time        | TRUE       |            | Verdana | TRUE           | 80           |             | right           | bottom          |         |                  | TRUE              | #808080         | 1                   | 2                   |                       |                       | TRUE           | #808080      | 0            | TRUE           | #CC2828      | 0.382        | FALSE          | #95CC28      | 0.5          | TRUE           | #28CC28      | 0.618        | TRUE           | #28CC95      | 1            | TRUE           | #2895CC      | 1.382        | TRUE           | #808080      | 1.618        | TRUE           | #2828CC      | 2            | TRUE           | #CC2828      | 2.382        | TRUE            | #9528CC       | 2.618         | TRUE            | #CC2895       | 3             |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |               |           |           |           |            | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                 | 0                 | 1                 | 0                 |             |            |             |
| fib_circles           | TRUE       |            | Verdana | TRUE           | 80           |             |                 |                 |         | FALSE            | TRUE              | #808080         | 1                   | 2                   |                       |                       | TRUE           | #CC2828      | 0.236        | TRUE           | #95CC28      | 0.382        | TRUE           | #28CC28      | 0.5          | TRUE           | #28CC95      | 0.618        | TRUE           | #2895CC      | 0.764        | TRUE           | #808080      | 1            | TRUE           | #2828CC      | 1.618        | TRUE           | #CC2828      | 2.618        | TRUE           | #9528CC      | 3.618        | TRUE            | #CC2895       | 4.236         | TRUE            | #CC2895       | 4.618         |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |               |           |           |           |            | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                 | 0                 | 1                 | 0                 |             |            |             |
| fib_speed_resist_arcs | TRUE       |            | Verdana | TRUE           | 80           |             |                 |                 |         |                  | TRUE              | #808080         | 1                   | 2                   |                       |                       | TRUE           | #CC2828      | 0.236        | TRUE           | #95CC28      | 0.382        | TRUE           | #28CC28      | 0.5          | TRUE           | #28CC95      | 0.618        | TRUE           | #2895CC      | 0.764        | TRUE           | #808080      | 1            | TRUE           | #2828CC      | 1.618        | TRUE           | #CC2828      | 2.618        | TRUE           | #9528CC      | 3.618        | TRUE            | #CC2895       | 4.236         | TRUE            | #CC2895       | 4.618         |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |               |           |           |           |            | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                 | 0                 | 1                 | 0                 | FALSE       |            |             |
| fib_wedge             | TRUE       |            | Verdana | TRUE           | 80           |             |                 |                 |         |                  | TRUE              | #808080         | 1                   | 0                   |                       |                       | TRUE           | #CC2828      | 0.236        | TRUE           | #95CC28      | 0.382        | TRUE           | #28CC28      | 0.5          | TRUE           | #28CC95      | 0.618        | TRUE           | #2895CC      | 0.764        | TRUE           | #808080      | 1            | FALSE          | #2828CC      | 1.618        | FALSE          | #CC2828      | 2.618        | FALSE          | #9528CC      | 3.618        | FALSE           | #CC2895       | 4.236         | FALSE           | #CC2895       | 4.618         |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |                 |               |               |               |           |           |           |            | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                | 0                | 1                 | 0                 | 1                 | 0                 |             |            |             |
| fib_channel           | TRUE       | TRUE       | Verdana | TRUE           | 80           |             | left            | middle          |         | FALSE            |                   |                 |                     |                     | 1                     | 0                     | TRUE           | #808080      | 0            | TRUE           | #CC2828      | 0.236        | TRUE           | #95CC28      | 0.382        | TRUE           | #28CC28      | 0.5          | TRUE           | #28CC95      | 0.618        | TRUE           | #2895CC      | 0.764        | TRUE           | #808080      | 1            | TRUE           | #2828CC      | 1.618        | TRUE           | #CC2828      | 2.618        | TRUE            | #9528CC       | 3.618         | TRUE            | #CC2895       | 4.236         | FALSE           | #95CC28       | 1.272         | FALSE           | #CC2828       | 1.414         | FALSE           | #28CC95       | 2             | FALSE           | #95CC28       | 2.272         | FALSE           | #28CC28       | 2.414         | FALSE           | #2895CC       | 3             | FALSE           | #808080       | 3.272         | FALSE           | #2828CC       | 3.414         | FALSE           | #CC2828       | 4             | FALSE           | #9528CC       | 4.272         | FALSE           | #CC2895       | 4.414         | FALSE           | #95CC28       | 4.618         | FALSE           | #28CC95       | 4.764         |               |           |           |           |            |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                  |                   |                   |                   |                   |             | FALSE      | FALSE       |

| shape                 | borderColor | drawBorder | fillBackground | fillLabelBackground | font    | fontsize | labelBackgroundColor | linecolor | linewidth | profitBackground | profitBackgroundTransparency | stopBackground | stopBackgroundTransparency | textcolor | backgroundColor | backgroundTransparency |
|-----------------------|-------------|------------|----------------|---------------------|---------|----------|----------------------|-----------|-----------|------------------|------------------------------|----------------|----------------------------|-----------|-----------------|------------------------|
| date_range            | #667B8B     | FALSE      | TRUE           | TRUE                | Verdana | 12       | #000000              | #585858   | 1         |                  |                              |                |                            | #FFFFFF   | #BADAFF         | 60                     |
| price_range           | #667B8B     | FALSE      | TRUE           | TRUE                | Verdana | 12       | #000000              | #585858   | 1         |                  |                              |                |                            | #FFFFFF   | #BADAFF         | 60                     |
| date_and_price_range  | #667B8B     | FALSE      | TRUE           | TRUE                | Verdana | 12       | #000000              | #585858   | 1         |                  |                              |                |                            | #FFFFFF   | #BADAFF         | 60                     |

| shape                 | borderColor | drawBorder | fillBackground | fillLabelBackground | font    | fontsize | labelBackgroundColor | linecolor | linewidth | profitLevel                                               | profitBackground | profitBackgroundTransparency | stopLevel                                                 | stopBackground | stopBackgroundTransparency | textcolor | backgroundColor | backgroundTransparency | risk | accountSize|
|-----------------------|-------------|------------|----------------|---------------------|---------|----------|----------------------|-----------|-----------|-----------------------------------------------------------|------------------|------------------------------|-----------------------------------------------------------|----------------|----------------------------|-----------|-----------------|------------------------|------|------------|
| long_position         | #667B8B     | FALSE      | TRUE           | TRUE                | Verdana | 12       | #585858              | #585858   | 1         | (Visible bars' high price - Visible bars' low price) * 20 | #00A000          | 80                           | (Visible bars' high price - Visible bars' low price) * 20 | #FF0000        | 80                         | white     |                 |                        | 25   | 1000       |
| short_position        | #667B8B     | FALSE      | TRUE           | TRUE                | Verdana | 12       | #585858              | #585858   | 1         | (Visible bars' high price - Visible bars' low price) * 20 | #00A000          | 80                           | (Visible bars' high price - Visible bars' low price) * 20 | #FF0000        | 80                         | white     |                 |                        | 25   | 1000       |

| shape      | showCoeffs | font    | fillBackground | transparency | color1  | color2  | linewidth | trendline.visible | trendline.color | trendline.linestyle | level1.color | level1.visible | level1.linewidth | level1.linestyle | level1.coeff |
|------------|------------|---------|----------------|--------------|---------|---------|-----------|-------------------|-----------------|---------------------|--------------|----------------|------------------|------------------|--------------|
| projection | TRUE       | Verdana | TRUE           | 80           | #008000 | #FF0000 | 1         | TRUE              | #808080         | 0                   | #808080      | TRUE           | 1                | 0                | 1            |

| shape    | linecolor | linewidth | centersColor | failureBackground | failureTextColor | intermediateBackColor | intermediateTextColor | sourceBackColor | sourceStrokeColor | sourceTextColor | successBackground | successTextColor | targetBackColor | targetStrokeColor | targetTextColor | transparency |
|----------|-----------|-----------|--------------|-------------------|------------------|-----------------------|-----------------------|-----------------|-------------------|-----------------|-------------------|------------------|-----------------|-------------------|-----------------|--------------|
| forecast | #1c73db   | 2         | #202020      | #e74545           | #ffffff          | #ead289               | #6d4d22               | #f1f1f1         | #6e6e6e           | #6e6e6e         | #36a02a           | #ffffff          | #0b6fde         | #2fa8ff           | #ffffff         | 10           |

| shape      | averageHL | variance | transparency | candleStyle.upColor | candleStyle.downColor | candleStyle.drawWick | candleStyle.drawBorder | candleStyle.borderColor | candleStyle.borderUpColor | candleStyle.borderDownColor | candleStyle.wickColor |
|------------|-----------|----------|--------------|---------------------|-----------------------|----------------------|------------------------|-------------------------|---------------------------|-----------------------------|-----------------------|
| ghost_feed | 20        | 50       | 50           | #6BA583             | #D75442               | TRUE                 | TRUE                   | #378658                 | #225437                   | #5B1A13                     | #737375               |

| shape      | color   | size | angle ([rad](https://en.wikipedia.org/wiki/Radian)) | scale | icon*   |
|------------|---------|------|-------------|-------|---------|
| icon       | #3d85c6 | 40   | 1.571       | 1     | 0x263A  |

<!-- markdownlint-disable no-inline-html -->

<nowiki />* icon can be one of the following values:
![images/icons.png](images/icons.png)

<!-- markdownlint-enable no-inline-html -->

| shape        | color   | flipped | mirrored | mode |
|--------------|---------|---------|----------|------|
| bars_pattern | #5091CC | FALSE   | FALSE    | 0    |

| shape       | color     |
|-------------|-----------|
| highlighter | #ec407a26 |

| shape      | showLabel  | horzLabelsAlign | vertLabelsAlign | textcolor | fontsize | bold  | italic |
|------------|------------|-----------------|-----------------|-----------|----------|------ |--------|
| price_note | FALSE      | center          | bottom          | #2196f3   | 14       | FALSE | FALSE  |

Possible values of some properties:

* `linestyle`: `[0 (solid), 1 (dotted), 2 (dashed), 3 (large dashed)]`
* `linewidth`: `[1, 2, 3, 4]`
* `horzLabelsAlign`: `["center", "left", "right"]`
* `vertLabelsAlign`: `["top", "middle", "bottom"]`
* `leftEnd`, `rightEnd`: `[0 (Normal), 1 (Arrow)]`
* `bars_pattern` - `mode`: `[0 (HL Bars, 1 (Line-Close), 2 (OC Bars), 3 (Line-Open), 4 (Line-High), 5 (Line-Low), 6 (Line-HL/2)]`



## APPENDIX E — `ChartPropertiesOverrides` (every key, type, default; v32.1.0)

Keys are passed to `overrides` in the Widget Constructor or to `applyOverrides()`. Colours in the dark theme differ where noted in the docs (background type gradient). `tradingProperties.*` and `volumePaneSize` have no documented defaults except `volumePaneSize = PaneSize.Large`.

| key | type | default |
|---|---|---|
| `timezone` | TimezoneId | (widget `timezone` option) |
| `priceScaleSelectionStrategyName` | "left" | "right" |
| `paneProperties.backgroundType` | ColorTypes | 'solid' |
| `paneProperties.background` | string | '#ffffff' |
| `paneProperties.backgroundGradientStartColor` | string | '#ffffff' |
| `paneProperties.backgroundGradientEndColor` | string | '#ffffff' |
| `paneProperties.vertGridProperties.color` | string | 'rgba(42, 46, 57, 0.06)' |
| `paneProperties.vertGridProperties.style` | OverrideLineStyle | LineStyle.Solid |
| `paneProperties.horzGridProperties.color` | string | 'rgba(42, 46, 57, 0.06)' |
| `paneProperties.horzGridProperties.style` | OverrideLineStyle | LineStyle.Solid |
| `paneProperties.gridLinesMode` | GridLinesMode | "both" |
| `paneProperties.crossHairProperties.color` | string | '#9598A1' |
| `paneProperties.crossHairProperties.style` | OverrideLineStyle | LineStyle.Dashed |
| `paneProperties.crossHairProperties.transparency` | number | 0 |
| `paneProperties.crossHairProperties.width` | number | 1 |
| `paneProperties.topMargin` | number | 10 |
| `paneProperties.bottomMargin` | number | 8 |
| `paneProperties.separatorColor` | string | '#EBEBEB' |
| `paneProperties.legendProperties.showStudyArguments` | boolean | true |
| `paneProperties.legendProperties.showStudyTitles` | boolean | true |
| `paneProperties.legendProperties.showStudyValues` | boolean | true |
| `paneProperties.legendProperties.showSeriesTitle` | boolean | true |
| `paneProperties.legendProperties.showSeriesOHLC` | boolean | true |
| `paneProperties.legendProperties.showLastDayChange` | boolean | false |
| `paneProperties.legendProperties.showBarChange` | boolean | true |
| `paneProperties.legendProperties.showSeriesLegendCloseOnMobile` | boolean | true |
| `paneProperties.legendProperties.showVolume` | boolean | false |
| `paneProperties.legendProperties.showBackground` | boolean | true |
| `paneProperties.legendProperties.backgroundTransparency` | number | 50 |
| `scalesProperties.lineColor` | string | 'rgba(42, 46, 57, 0)' |
| `scalesProperties.textColor` | string | '#131722' |
| `scalesProperties.fontSize` | number | 12 |
| `scalesProperties.showSeriesLastValue` | boolean | true |
| `scalesProperties.seriesLastValueMode` | OverridePriceAxisLastValueMode | PriceAxisLastValueMode.LastValueAccordingToScale |
| `scalesProperties.showStudyLastValue` | boolean | true |
| `scalesProperties.showSymbolLabels` | boolean | false |
| `scalesProperties.showStudyPlotLabels` | boolean | false |
| `scalesProperties.showBidAskLabels` | boolean | false |
| `scalesProperties.showPrePostMarketPriceLabel` | boolean | true |
| `scalesProperties.axisHighlightColor` | string | 'rgba(41, 98, 255, 0.25)' |
| `scalesProperties.axisLineToolLabelBackgroundColorCommon` | string | '#2962FF' |
| `scalesProperties.axisLineToolLabelBackgroundColorActive` | string | '#143EB3' |
| `scalesProperties.showPriceScaleCrosshairLabel` | boolean | true |
| `scalesProperties.showTimeScaleCrosshairLabel` | boolean | true |
| `scalesProperties.crosshairLabelBgColorLight` | string | '#131722' |
| `scalesProperties.crosshairLabelBgColorDark` | string | '#363A45' |
| `scalesProperties.scaleSeriesOnly` | boolean | false |
| `mainSeriesProperties.style` | ChartStyle | ChartStyle.Candle |
| `mainSeriesProperties.showCountdown` | boolean | false |
| `mainSeriesProperties.bidAsk.visible` | boolean | false |
| `mainSeriesProperties.bidAsk.lineStyle` | OverrideLineStyle | LineStyle.Dotted |
| `mainSeriesProperties.bidAsk.lineWidth` | number | 1 |
| `mainSeriesProperties.bidAsk.bidLineColor` | string | '#2962FF' |
| `mainSeriesProperties.bidAsk.askLineColor` | string | '#F7525F' |
| `mainSeriesProperties.highLowAvgPrice.highLowPriceLinesVisible` | boolean | false |
| `mainSeriesProperties.highLowAvgPrice.highLowPriceLabelsVisible` | boolean | false |
| `mainSeriesProperties.highLowAvgPrice.averageClosePriceLineVisible` | boolean | false |
| `mainSeriesProperties.highLowAvgPrice.averageClosePriceLabelVisible` | boolean | false |
| `mainSeriesProperties.highLowAvgPrice.highLowPriceLinesColor` | string | "" |
| `mainSeriesProperties.highLowAvgPrice.highLowPriceLinesWidth` | number | 1 |
| `mainSeriesProperties.highLowAvgPrice.averagePriceLineColor` | string | "" |
| `mainSeriesProperties.highLowAvgPrice.averagePriceLineWidth` | number | 1 |
| `mainSeriesProperties.visible` | boolean | true |
| `mainSeriesProperties.sessionId` | "regular" | "extended" |
| `mainSeriesProperties.showPriceLine` | boolean | true |
| `mainSeriesProperties.priceLineWidth` | number | 1 |
| `mainSeriesProperties.priceLineColor` | string | "" |
| `mainSeriesProperties.showPrevClosePriceLine` | boolean | false |
| `mainSeriesProperties.prevClosePriceLineWidth` | number | 1 |
| `mainSeriesProperties.prevClosePriceLineColor` | string | "#555555" |
| `mainSeriesProperties.minTick` | string | "default" |
| `mainSeriesProperties.statusViewStyle.showExchange` | boolean | true |
| `mainSeriesProperties.statusViewStyle.showInterval` | boolean | true |
| `mainSeriesProperties.statusViewStyle.symbolTextSource` | SeriesStatusViewSymbolTextSource | "description" |
| `mainSeriesProperties.candleStyle.upColor` | string | "#089981" |
| `mainSeriesProperties.candleStyle.downColor` | string | "#F23645" |
| `mainSeriesProperties.candleStyle.drawWick` | boolean | true |
| `mainSeriesProperties.candleStyle.drawBorder` | boolean | true |
| `mainSeriesProperties.candleStyle.borderColor` | string | "#378658" |
| `mainSeriesProperties.candleStyle.borderUpColor` | string | "#089981" |
| `mainSeriesProperties.candleStyle.borderDownColor` | string | "#F23645" |
| `mainSeriesProperties.candleStyle.wickColor` | string | "#737375" |
| `mainSeriesProperties.candleStyle.wickUpColor` | string | "#089981" |
| `mainSeriesProperties.candleStyle.wickDownColor` | string | "#F23645" |
| `mainSeriesProperties.candleStyle.barColorsOnPrevClose` | boolean | false |
| `mainSeriesProperties.candleStyle.drawBody` | boolean | true |
| `mainSeriesProperties.volCandlesStyle.upColor` | string | "#089981" |
| `mainSeriesProperties.volCandlesStyle.downColor` | string | "#F23645" |
| `mainSeriesProperties.volCandlesStyle.drawWick` | boolean | true |
| `mainSeriesProperties.volCandlesStyle.drawBorder` | boolean | true |
| `mainSeriesProperties.volCandlesStyle.borderColor` | string | "#378658" |
| `mainSeriesProperties.volCandlesStyle.borderUpColor` | string | "#089981" |
| `mainSeriesProperties.volCandlesStyle.borderDownColor` | string | "#F23645" |
| `mainSeriesProperties.volCandlesStyle.wickColor` | string | "#737375" |
| `mainSeriesProperties.volCandlesStyle.wickUpColor` | string | "#089981" |
| `mainSeriesProperties.volCandlesStyle.wickDownColor` | string | "#F23645" |
| `mainSeriesProperties.volCandlesStyle.barColorsOnPrevClose` | boolean | false |
| `mainSeriesProperties.volCandlesStyle.drawBody` | boolean | true |
| `mainSeriesProperties.hollowCandleStyle.upColor` | string | "#089981" |
| `mainSeriesProperties.hollowCandleStyle.downColor` | string | "#F23645" |
| `mainSeriesProperties.hollowCandleStyle.drawWick` | boolean | true |
| `mainSeriesProperties.hollowCandleStyle.drawBorder` | boolean | true |
| `mainSeriesProperties.hollowCandleStyle.borderColor` | string | "#378658" |
| `mainSeriesProperties.hollowCandleStyle.borderUpColor` | string | "#089981" |
| `mainSeriesProperties.hollowCandleStyle.borderDownColor` | string | "#F23645" |
| `mainSeriesProperties.hollowCandleStyle.wickColor` | string | "#737375" |
| `mainSeriesProperties.hollowCandleStyle.wickUpColor` | string | "#089981" |
| `mainSeriesProperties.hollowCandleStyle.wickDownColor` | string | "#F23645" |
| `mainSeriesProperties.hollowCandleStyle.drawBody` | boolean | true |
| `mainSeriesProperties.haStyle.upColor` | string | "#089981" |
| `mainSeriesProperties.haStyle.downColor` | string | "#F23645" |
| `mainSeriesProperties.haStyle.drawWick` | boolean | true |
| `mainSeriesProperties.haStyle.drawBorder` | boolean | true |
| `mainSeriesProperties.haStyle.borderColor` | string | "#378658" |
| `mainSeriesProperties.haStyle.borderUpColor` | string | "#089981" |
| `mainSeriesProperties.haStyle.borderDownColor` | string | "#F23645" |
| `mainSeriesProperties.haStyle.wickColor` | string | "#737375" |
| `mainSeriesProperties.haStyle.wickUpColor` | string | "#089981" |
| `mainSeriesProperties.haStyle.wickDownColor` | string | "#F23645" |
| `mainSeriesProperties.haStyle.barColorsOnPrevClose` | boolean | false |
| `mainSeriesProperties.haStyle.drawBody` | boolean | true |
| `mainSeriesProperties.barStyle.upColor` | string | "#089981" |
| `mainSeriesProperties.barStyle.downColor` | string | "#F23645" |
| `mainSeriesProperties.barStyle.barColorsOnPrevClose` | boolean | false |
| `mainSeriesProperties.barStyle.dontDrawOpen` | boolean | false |
| `mainSeriesProperties.barStyle.thinBars` | boolean | true |
| `mainSeriesProperties.hiloStyle.color` | string | "#2962FF" |
| `mainSeriesProperties.hiloStyle.showBorders` | boolean | true |
| `mainSeriesProperties.hiloStyle.borderColor` | string | "#2962FF" |
| `mainSeriesProperties.hiloStyle.showLabels` | boolean | true |
| `mainSeriesProperties.hiloStyle.labelColor` | string | "#2962FF" |
| `mainSeriesProperties.columnStyle.upColor` | string | "rgba(8, 153, 129, 0.5)" |
| `mainSeriesProperties.columnStyle.downColor` | string | "rgba(242, 54, 69, 0.5)" |
| `mainSeriesProperties.columnStyle.barColorsOnPrevClose` | boolean | true |
| `mainSeriesProperties.columnStyle.priceSource` | PriceSource | "close" |
| `mainSeriesProperties.lineStyle.color` | string | "#2962FF" |
| `mainSeriesProperties.lineStyle.linestyle` | OverrideLineStyle | LineStyle.Solid |
| `mainSeriesProperties.lineStyle.linewidth` | number | 2 |
| `mainSeriesProperties.lineStyle.priceSource` | PriceSource | "close" |
| `mainSeriesProperties.steplineStyle.color` | string | "#2962FF" |
| `mainSeriesProperties.steplineStyle.linestyle` | OverrideLineStyle | LineStyle.Solid |
| `mainSeriesProperties.steplineStyle.linewidth` | number | 2 |
| `mainSeriesProperties.steplineStyle.priceSource` | PriceSource | "close" |
| `mainSeriesProperties.areaStyle.color1` | string | "rgba(41, 98, 255, 0.28)" |
| `mainSeriesProperties.areaStyle.color2` | string | "#2962FF" |
| `mainSeriesProperties.areaStyle.linecolor` | string | "#2962FF" |
| `mainSeriesProperties.areaStyle.linestyle` | OverrideLineStyle | LineStyle.Solid |
| `mainSeriesProperties.areaStyle.linewidth` | number | 2 |
| `mainSeriesProperties.areaStyle.priceSource` | PriceSource | "close" |
| `mainSeriesProperties.areaStyle.transparency` | number | 100 |
| `mainSeriesProperties.hlcAreaStyle.closeLineColor` | string | "#868993" |
| `mainSeriesProperties.hlcAreaStyle.closeLineStyle` | OverrideLineStyle | LineStyle.Solid |
| `mainSeriesProperties.hlcAreaStyle.closeLineWidth` | number | 2 |
| `mainSeriesProperties.hlcAreaStyle.closeLowFillColor` | string | "rgba(242, 54, 69, 0.2)" |
| `mainSeriesProperties.hlcAreaStyle.highCloseFillColor` | string | "rgba(8, 153, 129, 0.2)" |
| `mainSeriesProperties.hlcAreaStyle.highLineColor` | string | "#089981" |
| `mainSeriesProperties.hlcAreaStyle.highLineStyle` | OverrideLineStyle | LineStyle.Solid |
| `mainSeriesProperties.hlcAreaStyle.highLineWidth` | number | 2 |
| `mainSeriesProperties.hlcAreaStyle.lowLineColor` | string | "#F23645" |
| `mainSeriesProperties.hlcAreaStyle.lowLineStyle` | OverrideLineStyle | LineStyle.Solid |
| `mainSeriesProperties.hlcAreaStyle.lowLineWidth` | number | 2 |
| `mainSeriesProperties.priceAxisProperties.percentage` | boolean | false |
| `mainSeriesProperties.priceAxisProperties.indexedTo100` | boolean | false |
| `mainSeriesProperties.priceAxisProperties.log` | boolean | false |
| `mainSeriesProperties.priceAxisProperties.isInverted` | boolean | false |
| `mainSeriesProperties.priceAxisProperties.alignLabels` | boolean | true |
| `mainSeriesProperties.renkoStyle.upColor` | string | "#089981" |
| `mainSeriesProperties.renkoStyle.downColor` | string | "#F23645" |
| `mainSeriesProperties.renkoStyle.borderUpColor` | string | "#089981" |
| `mainSeriesProperties.renkoStyle.borderDownColor` | string | "#F23645" |
| `mainSeriesProperties.renkoStyle.upColorProjection` | string | "#a9dcc3" |
| `mainSeriesProperties.renkoStyle.downColorProjection` | string | "#f5a6ae" |
| `mainSeriesProperties.renkoStyle.borderUpColorProjection` | string | "#a9dcc3" |
| `mainSeriesProperties.renkoStyle.borderDownColorProjection` | string | "#f5a6ae" |
| `mainSeriesProperties.renkoStyle.wickUpColor` | string | "#089981" |
| `mainSeriesProperties.renkoStyle.wickDownColor` | string | "#F23645" |
| `mainSeriesProperties.pbStyle.upColor` | string | "#089981" |
| `mainSeriesProperties.pbStyle.downColor` | string | "#F23645" |
| `mainSeriesProperties.pbStyle.borderUpColor` | string | "#089981" |
| `mainSeriesProperties.pbStyle.borderDownColor` | string | "#F23645" |
| `mainSeriesProperties.pbStyle.upColorProjection` | string | "#a9dcc3" |
| `mainSeriesProperties.pbStyle.downColorProjection` | string | "#f5a6ae" |
| `mainSeriesProperties.pbStyle.borderUpColorProjection` | string | "#a9dcc3" |
| `mainSeriesProperties.pbStyle.borderDownColorProjection` | string | "#f5a6ae" |
| `mainSeriesProperties.kagiStyle.upColor` | string | "#089981" |
| `mainSeriesProperties.kagiStyle.downColor` | string | "#F23645" |
| `mainSeriesProperties.kagiStyle.upColorProjection` | string | "#a9dcc3" |
| `mainSeriesProperties.kagiStyle.downColorProjection` | string | "#f5a6ae" |
| `mainSeriesProperties.pnfStyle.upColor` | string | "#089981" |
| `mainSeriesProperties.pnfStyle.downColor` | string | "#F23645" |
| `mainSeriesProperties.pnfStyle.upColorProjection` | string | "#a9dcc3" |
| `mainSeriesProperties.pnfStyle.downColorProjection` | string | "#f5a6ae" |
| `mainSeriesProperties.baselineStyle.baselineColor` | string | "#758696" |
| `mainSeriesProperties.baselineStyle.topFillColor1` | string | "rgba(8, 153, 129, 0.28)" |
| `mainSeriesProperties.baselineStyle.topFillColor2` | string | "rgba(8, 153, 129, 0.05)" |
| `mainSeriesProperties.baselineStyle.bottomFillColor1` | string | "rgba(242, 54, 69, 0.05)" |
| `mainSeriesProperties.baselineStyle.bottomFillColor2` | string | "rgba(242, 54, 69, 0.28)" |
| `mainSeriesProperties.baselineStyle.topLineColor` | string | "#089981" |
| `mainSeriesProperties.baselineStyle.bottomLineColor` | string | "#F23645" |
| `mainSeriesProperties.baselineStyle.topLineWidth` | number | 2 |
| `mainSeriesProperties.baselineStyle.bottomLineWidth` | number | 2 |
| `mainSeriesProperties.baselineStyle.priceSource` | PriceSource | "close" |
| `mainSeriesProperties.baselineStyle.transparency` | number | 50 |
| `mainSeriesProperties.baselineStyle.baseLevelPercentage` | number | 50 |
| `mainSeriesProperties.lineWithMarkersStyle.color` | string | '#2962FF' |
| `mainSeriesProperties.lineWithMarkersStyle.linestyle` | OverrideLineStyle | LineStyle.Solid |
| `mainSeriesProperties.lineWithMarkersStyle.linewidth` | number | 2 |
| `mainSeriesProperties.lineWithMarkersStyle.priceSource` | string | 'close' |
| `tradingProperties.showPositions` | boolean |  |
| `tradingProperties.positionPL.visibility` | boolean |  |
| `tradingProperties.positionPL.display` | PlDisplay |  |
| `tradingProperties.bracketsPL.visibility` | boolean |  |
| `tradingProperties.bracketsPL.display` | PlDisplay |  |
| `tradingProperties.positionAndBracketsPL` | boolean |  |
| `tradingProperties.showOrders` | boolean |  |
| `tradingProperties.showExecutions` | boolean |  |
| `tradingProperties.showExecutionsLabels` | boolean |  |
| `tradingProperties.showReverse` | boolean |  |
| `tradingProperties.extendLeft` | boolean |  |
| `tradingProperties.lineLength` | number |  |
| `tradingProperties.horizontalAlignment` | TradedGroupHorizontalAlignment |  |
| `tradingProperties.lineWidth` | number |  |
| `volumePaneSize` | PaneSize | PaneSize.Large |

## APPENDIX F — Built-in indicator names (`createStudy` / `getStudiesList()`, v32.1.0)

Special series-like studies: `Overlay` (compare symbol; inputs `symbol`, `extendtimescale`), `Compare` (inputs `symbol`, `source`), `Volume` (added by default; see Section 10). Names are the English UI titles; `studies_overrides` keys use the lower-case title (e.g. `"bollinger bands.median.color"`). Volume-based indicators to blacklist for feeds without volume: Accumulation/Distribution, Chaikin Money Flow, Ease of Movement, Elders Force Index, Klinger Oscillator, Money Flow Index, Net Volume, On Balance Volume, Price Volume Trend, VWAP, Volume Oscillator.

* `52 Week High/Low` · `Accelerator Oscillator` · `Accumulation/Distribution` · `Accumulative Swing Index`
* `Advance/Decline` · `Arnaud Legoux Moving Average` · `Aroon` · `Average Directional Index`
* `Average Price` · `Average True Range` · `Awesome Oscillator` · `Balance of Power`
* `Bollinger Bands` · `Bollinger Bands %B` · `Bollinger Bands Width` · `Chaikin Money Flow`
* `Chaikin Oscillator` · `Chaikin Volatility` · `Chande Kroll Stop` · `Chande Momentum Oscillator`
* `Chop Zone` · `Choppiness Index` · `Commodity Channel Index` · `Connors RSI`
* `Coppock Curve` · `Correlation Coefficient` · `Correlation - Log` · `Detrended Price Oscillator`
* `Directional Movement` · `Donchian Channels` · `Double EMA` · `Ease of Movement`
* `Elder's Force Index` · `EMA Cross` · `Envelopes` · `Fisher Transform`
* `Guppy Multiple Moving Average` · `Historical Volatility` · `Hull Moving Average` · `Ichimoku Cloud`
* `Keltner Channels` · `Klinger Oscillator` · `Know Sure Thing` · `Least Squares Moving Average`
* `Linear Regression Curve` · `Linear Regression Slope` · `MA Cross` · `MA with EMA Cross`
* `Mass Index` · `McGinley Dynamic` · `Median Price` · `Momentum`
* `Money Flow Index` · `Moving Average` · `Moving Average Channel` · `MACD`
* `Moving Average Exponential` · `Moving Average Weighted` · `Moving Average Double` · `Moving Average Triple`
* `Moving Average Adaptive` · `Moving Average Hamming` · `Moving Average Multiple` · `Majority Rule`
* `Net Volume` · `On Balance Volume` · `Parabolic SAR` · `Pivot Points Standard`
* `Price Channel` · `Price Oscillator` · `Price Volume Trend` · `Rank Correlation Index`
* `Rate Of Change` · `Ratio` · `Relative Strength Index` · `Relative Vigor Index`
* `Relative Volatility Index` · `Standard Error` · `Standard Error Bands` · `SMI Ergodic Indicator/Oscillator`
* `Smoothed Moving Average` · `Standard Deviation` · `Stochastic` · `Stochastic RSI`
* `SuperTrend` · `Spread` · `TRIX` · `Triple EMA`
* `True Strength Indicator` · `Trend Strength Index` · `Typical Price` · `Ultimate Oscillator`
* `Volatility Close-to-Close` · `Volatility Zero Trend Close-to-Close` · `Volatility O-H-L-C` · `Volatility Index`
* `VWAP` · `VWMA` · `Volume Oscillator` · `Volume Profile Fixed Range`
* `Volume Profile Visible Range` · `Vortex Indicator` · `Volume` · `Williams %R`
* `Williams Alligator` · `Williams Fractal` · `Zig Zag`

## APPENDIX G — Sources

Advanced Charts docs (v32.1.0 context bundle `https://www.tradingview.com/charting-library-docs/charting-library-context.txt`, and pages under `https://www.tradingview.com/charting-library-docs/latest/`): `ui_elements/Chart`, `ui_elements/Price-Scale`, `ui_elements/Time-Scale`, `ui_elements/Legend`, `ui_elements/Resolution`, `ui_elements/Marks`, `ui_elements/Symbol-Search`, `ui_elements/timezones`, `ui_elements/watermarks`, `ui_elements/Snapshots`, `ui_elements/market-status`, `ui_elements/context-menu`, `ui_elements/object-tree/`, `ui_elements/Toolbars`, `ui_elements/drawings/Drawings-List`, `ui_elements/drawings/drawings-api`, `ui_elements/indicators/`, `ui_elements/indicators/indicator-placement`, `ui_elements/indicators/Indicators-List`, `configuration/Shortcuts`, `configuration/Widget-Constructor`, `configuration/events-and-subscriptions`, `configuration/widget-methods`, `connecting_data/Symbology`, `connecting_data/UDF`, `connecting_data/datafeed-api/required-methods`, `connecting_data/datafeed-api/additional-methods`, `connecting_data/datafeed-api/datafeed-subscriptions`, `connecting_data/Datafeed-Issues`, `connecting_data/time-and-sessions/*` (Trading-Sessions, Extended-Sessions, configure-datafeed-resolutions), `customization/Featuresets`, `customization/overrides/*` (Overrides, chart-overrides, Drawings-Overrides, indicator-overrides, trading-overrides), `customization/styles/*` (custom-themes, CSS-Color-Themes), `customization/theme`, `saving_loading/*`, `trading_terminal/Trading-Primitives`, `mobile_specifics`, `resources/Frequently-Asked-Questions`, `resources/glossary`, API pages for `ChartPropertiesOverrides`, `ChartingLibraryWidgetOptions`, `IChartWidgetApi`, `IChartingLibraryWidget`, `ITimeScaleApi`, `IPriceScaleApi`, `IPaneApi`, `ISeriesApi`, `IStudyApi`, `ILineDataSourceApi`, `SubscribeEventsMap`, `LibrarySymbolInfo`, `Mark`, `TimescaleMark`, `IOrderLineAdapter`, `IPositionLineAdapter`, `IExecutionLineAdapter`, `ChartStyle`, `PriceScaleMode`, `CreateShapeOptions`, `ExportDataOptions`.

TradingView Help Center (`https://www.tradingview.com/support/solutions/…`): 43000703407 chart types, 43000502284 Renko, 43000481040 Renko wicks, 43000474305 / 43000480330 Renko issues, 43000502276 Point & Figure, 43000502272 Kagi, 43000502273 Line Break, 43000474007 Range charts, 43000758617 advanced intraday chart types, 43000711502 tick intervals, 43000619436 Heikin Ashi, 43000745270 hollow candles, 43000724995 volume candles, 43000709062 HLC area, 43000712747 & 43000474024 Bar Replay, 43000748166 chart settings, 43000762826 autoscale, 43000542381 invert scale, 43000476233 countdown, 43000790593 24h sessions, 43000502023 extended hours, 43000722509 & 43000472715 magnet mode, 43000703396 drawing tools, 43000482911 go to date, 43000746464 getting started, 43000747934 & 43000543883 intervals, 43000746975 & 43000692404 layouts, 43000539711 legend buttons, 43000484608 hide drawings, 43000516996 range tools, 43000481234 maximize chart, 43000659671 quick search, 43000662392 favourites, 43000520149 alerts, 43000480679 data limits.

Lightweight Charts: `https://tradingview.github.io/lightweight-charts/docs/` (time-scale, price-scale, series-types, API interfaces) and `https://github.com/tradingview/lightweight-charts/tree/master/src` (files listed at the top).
