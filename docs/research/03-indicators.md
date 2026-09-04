# 03 — TradingView Built-in "Technicals" Indicators: Implementation Specification

Target: a 1:1 open-source clone of TradingView's built-in indicator library in pure JavaScript.
Research date: 2026-09-04. Sources: TradingView Help Center (built-in indicators folder
`/support/folders/43000587405-built-in-indicators/`), Pine Script v5/v6 reference manual entries for `ta.*`,
the Advanced Charts (charting library) docs (Indicators List, Indicator overrides, `*IndicatorOverrides`
interfaces, plot enums), TradingView-published open-source scripts (Technical Ratings, Rolling VWAP, Volatility
Stop, ZigZag library, `ta` library), and the published Pine source of the built-ins as it appears in the Pine
Editor ("Open > Built-in script...").

## 0. How to read this document

### 0.1 Verification legend

Every indicator section carries a status tag:

| Tag | Meaning |
|---|---|
| `[V]` | Formula / defaults / colors verified from an official TradingView page fetched during this research. |
| `[S]` | Reproduced from the published Pine source of the built-in (visible in the Pine Editor). High confidence, but re-open the built-in in the Pine Editor before shipping to catch drift (TradingView revises built-ins a few times a year). |
| `[F]` | Textbook formula is certain, but TradingView-specific defaults, plot styles or colors could not be verified online. Treat marked values as "best current knowledge — verify". |
| `[N]` | Not implemented in Pine on TradingView (Volume Profile family, VWAP Auto Anchored, chart-pattern scripts). Only the documented behaviour is available. |
| `[D]` | Depends on external data feeds (market breadth, open interest, on-chain, fundamentals). Listed with data requirements only. |

A trailing `(verify)` next to a single value means that one value is uncertain even inside an otherwise verified section.

### 0.2 Naming conventions used below

* **TV name** — title shown in the Indicators dialog and the legend (Pine `indicator(title=...)`).
* **Short name** — Pine `shorttitle`, shown in the legend when the user enables "short titles" and in the status line.
* **Study name (charting library)** — the string accepted by `IChartWidgetApi.createStudy(name, ...)` in the Advanced Charts library. Where TradingView's website and the library use different names, both are given.
* Pane: **overlay** = drawn on the price pane and price scale (`overlay=true`, `is_price_study: true`); **separate** = new pane with its own scale.

### 0.3 Series semantics you must reproduce (Pine execution model)

The built-ins are written in Pine, so the JS port must copy Pine's series semantics or every seeded/recursive indicator will drift:

1. Bar-by-bar left-to-right evaluation; `x[1]` is the value of `x` on the previous bar; `x[n]` beyond the first bar is `na` (NaN).
2. `na` propagates through arithmetic. `nz(x, y)` replaces `na` with `y` (default 0). `fixnan(x)` carries the last non-`na` value forward.
3. Window functions (`ta.sma`, `ta.highest`, `math.sum`, `ta.stdev`, ...) return `na` until `length` bars exist (bar index `length-1`). Exception: some Pine functions "ignore na values and calculate on `length` non-na values" (documented per function below).
4. Recursive functions (`ta.ema`, `ta.rma`, SMMA, McGinley, KAMA, Fisher, SAR, Supertrend) are seeded exactly as described in section 2. Different seeding is the number-one cause of mismatches versus TradingView.
5. Integer division: in Pine `int / int` yields a float, except when both operands are `int` literals/inputs used in an `int` context (`length/2` passed to a function expecting `simple int` is truncated toward zero). The built-in HMA uses `length/2` this way: 9/2 -> 4.
6. `plot(..., offset=k)` shifts the drawn series `k` bars to the right (negative = left) without changing values; `hline` draws a horizontal level; `fill` between two plots or two hlines.
7. `timeframe=""`/`timeframe_gaps=true` in `indicator()` adds the standard "Calculation" input group (Timeframe dropdown + "Wait for timeframe closes" checkbox, default ON). When the indicator timeframe is higher than the chart, values are fetched with `request.security` semantics: with gaps ON the value only appears on the bar where the HTF bar closes; with gaps OFF the last HTF value is repeated.
8. Realtime bar: the last bar recomputes on every tick; historical bars use closed values. This is what "repainting" refers to in TV help texts.
9. `bar_index` starts at 0 on the first bar of the loaded history. Indicators that use `bar_index` (Trend Strength Index, Linear Regression Channel, RCI) depend on absolute history only through window length, not absolute index, except `ta.sar` seeding which uses `bar_index == 1`.

### 0.4 Source options and MA-type option strings

Standard `input.source` dropdown (all built-ins that expose "Source"):

| Option | Definition |
|---|---|
| open, high, low, close | bar OHLC |
| hl2 | (high + low) / 2 |
| hlc3 | (high + low + close) / 3 |
| ohlc4 | (open + high + low + close) / 4 |
| hlcc4 | (high + low + close + close) / 4 |
| (other indicators' plots) | any plot of another indicator on the chart ("indicator on indicator") |

Standard MA-type option strings (exact strings matter, they appear in the legend):

* Bollinger Bands "Basis MA Type": `SMA`, `EMA`, `SMMA (RMA)`, `WMA`, `VWMA` (default `SMA`).
* MACD "Oscillator MA Type" / "Signal Line MA Type": `SMA`, `EMA` (default `EMA`).
* ATR "Smoothing": `RMA`, `SMA`, `EMA`, `WMA` (default `RMA`).
* "Smoothing" section (RSI, CCI, OBV, MFI, Volume, RCI, SMA/EMA/WMA/SMMA/VWMA indicators, ...): "Type" = `None`, `SMA`, `SMA + Bollinger Bands`, `EMA`, `SMMA (RMA)`, `WMA`, `VWMA`; "Length" (14 in oscillators, 5 in the MA family); "BB StdDev" 2.0 (only used with `SMA + Bollinger Bands`). Verified from the Help Center "I see a Smoothing section..." article: default type is `SMA` or `None` depending on the indicator, default length 14, BB StdDev 2.
* Moving-average family older generation (2022-2023 sources): "Smoothing" group with "Method" (`SMA`, `EMA`, `SMMA (RMA)`, `WMA`, `VWMA`, default `SMA`) and "Length" 5; the smoothing line is plotted with `display=display.none` (hidden until the user enables it in Style), color `#f37f20`.

### 0.5 Indicator settings dialog: tabs and Style-tab options

* **Inputs tab** — the `input.*` calls in declaration order, grouped by `group=` (e.g. "RSI Settings", "Smoothing", "Calculation"). `display=display.data_window` inputs do not appear in the legend arguments.
* **Style tab** — one row per plot: visibility checkbox, color swatch (with opacity), line width (1-4), line style (Solid / Dashed / Dotted), plot type dropdown (Line, Step line, Histogram, Cross, Area, Columns, Circles, Line with breaks, Area with breaks, Step line with breaks, Step line with diamonds). One row per `hline` (value, color, width, style) and per `fill` (visible, color/opacity). Then the common block: **Precision** (Default = symbol's price precision, or 0-8 decimals; Pine `precision=` sets the default), **Labels on price scale** (checkbox, default on: the plot's last value is shown as a label on the scale), **Values in status line** (checkbox, default on: values shown next to the legend), and in newer versions **Outputs**/"Show ... in data window". `format=format.price|volume|percent` controls number formatting (volume format abbreviates K/M/B).
* **Visibility tab** — per-timeframe visibility ranges (Ticks, Seconds, Minutes, Hours, Days, Weeks, Months, Ranges) with min/max multipliers.

### 0.6 Legend and status-line format

Legend line = `<title or shorttitle> <input values separated by spaces> <plot values>`. Only inputs without `display=display.data_window` (older Pine: all inputs) are listed, in declaration order, e.g. `RSI 14 close` then `52.31`; `BB 20 SMA close 2` then three values; `MACD 12 26 close 9 EMA EMA` then `hist macd signal`. Boolean inputs show as `true`/`false`; source inputs show the source name (`close`, `hlc3`); string options show the option string. The user can toggle "Indicator titles", "Indicator arguments", "Indicator values" in Chart settings > Status line. Values are colored with the plot color. Plot values use the study precision.

### 0.7 Pane placement and scale behaviour

* `overlay=true` plots on the price pane using the main series scale (`priceScale: "as-series"` in the library). Non-overlay studies open a new pane below the chart with a new right price scale. Users can move/merge panes ("Move to > New pane above/below", "Pin to scale").
* The pane price scale auto-fits **all visible plots and hlines** ("Auto" mode). So RSI panes show a range that always includes 30/70 (because hlines participate in autoscale) but are not hard-clamped to 0-100; if RSI stays within 40-60 the scale tightens to about 30-70. Stochastic shows 20/80, CHOP 38.2/61.8, W%R -20/-80, CCI ±100, Fisher ±1.5, MACD/oscillators include the zero hline. `hline` levels are drawn across the full pane width and participate in autoscale; `fill` between hlines paints the band background.
* Charting library rules (verified): price studies (values in price units) go on the source pane and scale; non-price studies (0-100 etc.) go to a new pane with a new scale; `forceOverlay` puts a non-price study on the price pane without changing its scale. `priceScale` options: `new-right`, `new-left`, `no-scale`, `as-series`.
* "Labels on price scale" draws a colored last-value label per plot on the pane scale.

### 0.8 Plot types, line styles, display flags (charting library enums, verified)

| `LineStudyPlotStyle` | value | Pine equivalent |
|---|---|---|
| Line | 0 | `plot.style_line` |
| Histogram | 1 | `plot.style_histogram` |
| Cross | 3 | `plot.style_cross` |
| Area | 4 | `plot.style_area` |
| Columns | 5 | `plot.style_columns` |
| Circles | 6 | `plot.style_circles` |
| LineWithBreaks | 7 | `plot.style_linebr` |
| AreaWithBreaks | 8 | `plot.style_areabr` |
| StepLine | 9 | `plot.style_stepline` |
| StepLineWithDiamonds | 10 | `plot.style_stepline_diamond` |
| StepLineWithBreaks | 11 | `plot.style_steplinebr` |

`LineStyle`: Solid = 0, Dotted = 1, Dashed = 2 (Pine `hline.style_solid/dotted/dashed`, `line.style_*`).

`StudyPlotDisplayMode` (bit flags, used by `.display` overrides): None = 0, Pane = 1, DataWindow = 2, PriceScale = 4, StatusLine = 8, All = 15 (Pine `display.none/pane/data_window/price_scale/status_line/all`).

Shape plots (`plotshape`): `shape_arrow_down`, `shape_arrow_up`, `shape_circle`, `shape_cross`, `shape_diamond`, `shape_flag`, `shape_label_down`, `shape_label_up`, `shape_square`, `shape_triangle_down`, `shape_triangle_up`, `shape_xcross`; locations `AboveBar`, `BelowBar`, `Top`, `Bottom`, `Absolute`, `AbsoluteUp`, `AbsoluteDown`; sizes `auto`, `tiny`, `small`, `normal`, `large`, `huge`.

`transparency` 0..100 (0 = opaque). Library override keys are `"<study name lowercase>.<plot title lowercase>.<color|linewidth|linestyle|plottype|transparency|visible|display|trackprice>"`, hline keys `"<study>.<hline title>.value|color|linestyle|linewidth|visible"`, fills `"<study>.<fill title>.color|transparency|visible"`, inputs `"<study>.<input title lowercase>"`; palette colors `"<study>.<plot>.color.<index>"`. Colors must be `#RRGGBB`.

### 0.9 Default color palette

Pine built-ins written after 2021 use these hex constants (all seen in built-in sources or verified library defaults):

| Hex | Usage |
|---|---|
| `#2962FF` | primary blue: SMA/EMA/most single-line plots, BB basis, VWAP, %K, +DI, Ichimoku conversion, Alligator jaw, Vortex VI+ |
| `#FF6D00` | orange: MACD signal, %D, -DI, Donchian/Envelope basis, Fisher trigger, SMI EMA |
| `#F23645` | red: BB lower... (see per-indicator), TRIX, UO, KST signal, RVGI signal, down fractal, EFI |
| `#089981` | green/teal: BB upper... (see per-indicator), KST, RVGI, up fractal, Price Oscillator, Std Dev |
| `#7E57C2` | purple: RSI, MFI, W%R, RVI lines and their band fills |
| `#787B86` | gray: all hlines (bands, zero lines) |
| `#B2B5BE` | light gray (labels, `color.silver`) |
| `#26A69A`, `#B2DFDB`, `#FFCDD2`, `#FF5252` | MACD histogram 4-color scheme (strong up, weak up, weak down, strong down) |
| `#22AB94`, `#F7525F` | Volume columns up / down (current); older builds `#26A69A` / `#EF5350` |
| `#43A047`, `#A5D6A7`, `#EF9A9A`, `#B71C1C` | Ichimoku lagging span, lead A, lead B, base line; `#43A047` also DPO, CMF, DEMA, EOM, Klinger signal |
| `#E91E63`, `#66BB6A` | Alligator teeth, lips; `#E91E63` also Vortex VI- |
| `#FB8C00` | Aroon Up |
| `#F50057` | ADX line |
| `#673AB7` | SMMA |
| `#EC407A` | Chaikin Oscillator |
| `#26C6DA`, `#009688`, `#D50000`, `#FFB74D`, `#FDD835` | Chop Zone palette (with `#43A047`, `#A5D6A7`, `#E91E63`, `#FF6D00`) |
| `#f6c309`, `#fb9800`, `#fb6500`, `#f70000` | MA Ribbon 1-4 |
| `#2196F3` | charting-library default blue (library builds use this where Pine uses `#2962FF`) |
| `#000080` | charting-library navy default for Volume/AO/Chop Zone base color |

Pine constant colors (v5/v6): `color.aqua #00BCD4`, `color.black #363A45`, `color.blue #2196F3`, `color.fuchsia #E040FB`, `color.gray #787B86`, `color.green #4CAF50`, `color.lime #00E676`, `color.maroon #880E4F`, `color.navy #311B92`, `color.olive #808000`, `color.orange #FF9800`, `color.purple #9C27B0`, `color.red #F23645`, `color.silver #B2B5BE`, `color.teal #00897B`, `color.white #FFFFFF`, `color.yellow #FFEB3B` (verify `color.green`/`color.red` against the v6 reference; older docs list `#4CAF50`/`#FF5252`).

`color.rgb(r,g,b,transp)` / `color.new(c, transp)` — transparency 0..100 where 100 is invisible. Typical band fills use transparency 90 (`color.rgb(126,87,194,90)` for purple oscillators, `color.rgb(33,150,243,90)` for blue oscillators, 95 for overlay channels).

---

## 1. Master list of the "Technicals" tab (website) and the charting-library study list

### 1.1 Help-Center "Built-in indicators" folder (209 articles, 2026-09) — technical-analysis entries

24-hour Volume; Accumulation Distribution (ADL); Advance/Decline Line; Advance/Decline Ratio; Advance/Decline Ratio (Bars); Arnaud Legoux Moving Average; Aroon Indicator; Aroon Oscillator; Auto Fib Extension; Auto Fib Retracement; Auto key levels; Auto Pitchfork; Auto Trendlines; Average Daily Range (ADR); Average Directional Index (ADX); Average True Range (ATR); Awesome Oscillator (AO); Balance of Power (BOP); BBTrend; Bollinger Bands (BB); Bollinger Bands %b; Bollinger BandWidth (BBW); Bollinger Bars; Bull Bear Power; Chaikin Money Flow (CMF); Chaikin Oscillator; Chande Kroll Stop; Chande Momentum Oscillator (CMO); Chandelier Exit; Chop Zone; Choppiness Index (CHOP); Commodity Channel Index (CCI); Connors RSI (CRSI); Coppock Curve; Correlation Coefficient (CC); Cumulative Volume Delta; Cumulative Volume Index (CVI); Detrended Price Oscillator (DPO); Directional Movement (DMI); Donchian Channels (DC); Double Exponential Moving Average; Ease of Movement (EOM); Elder's Force Index (EFI); Envelope (ENV); Exponential Moving Average; Fisher Transform; Historical Volatility; Hull Moving Average; Ichimoku Cloud; Kaufman's Adaptive Moving Average (KAMA); Keltner Channels (KC); Klinger Oscillator; Know Sure Thing (KST); Least Squares Moving Average; Linear Regression (channel); MA Cross; Mass Index; McGinley Dynamic; Median; Momentum; Money Flow (MFI); Moon Phases; MACD; Moving Average Ribbon; Moving Averages (SMA/WMA/EMA); MovingAvg Cross; MovingAvg2Line Cross; Multi-Time Period Charts; Negative Volume Index (NVI); Net Volume; On Balance Volume (OBV); Open Interest; Parabolic SAR; Percentage Price Oscillator (PPO); Percentage Volume Oscillator (PVO); Performance; Pivot Points High Low; Pivot Points Standard; Positive Volume Index (PVI); Price Momentum Oscillator (PMO); Price Volume Trend (PVT); Pring's Special K; Rank Correlation Index (RCI); Rate of Change (ROC); RCI Ribbon; Relative Strength Index (RSI); Relative Vigor Index; Relative Volatility Index; Relative Volume at Time; Rob Booker (ADX Breakout, Knoxville Divergence, Intraday Pivot Points, Missed Pivot Points, Reversal, Ziv Ghost Pivots); RSI divergence indicator; Seasonality; Simple Moving Average; SMI Ergodic Indicator; SMI Ergodic Oscillator; Smoothed Moving Average; Stochastic; Stochastic Momentum Index (SMI); Stochastic RSI; Supertrend; Technical Ratings; Time Weighted Average Price; Trading Sessions; Trend Strength Index; Triple EMA; TRIX; True Strength Index; Ulcer Index; Ultimate Oscillator (UO); Up/Down Volume; Visible Average Price; Volatility Stop; Volume; Volume Delta; VWAP; Volume-Weighted Moving Average (VWMA); Vortex Indicator; VWAP Auto Anchored; Weighted Moving Average; Williams %R; Williams Alligator; Williams Fractal; Woodies CCI; Zig Zag; plus Volume Profile articles (Visible Range, Fixed Range, Session, Session HD, Periodic, Auto Anchored) and data-feed indicators (crypto on-chain metrics, ETF flows, funding, long/short ratios, dividend yield, analyst forecast, price target, index/mark price, basis, premium).

Also present in the website "Technicals" tab but documented elsewhere or not in Pine: All Candlestick Patterns (and the individual candlestick pattern scripts), Divergence Indicator, Volume Profile family, Session Volume, Anchored VWAP (drawing), Bollinger Bands Strategy / other built-in strategies.

### 1.2 Advanced Charts (charting library) Indicators List — exact `createStudy` names (verified)

52 Week High/Low; Accelerator Oscillator; Accumulation/Distribution; Accumulative Swing Index; Advance/Decline; Arnaud Legoux Moving Average; Aroon; Average Directional Index; Average Price; Average True Range; Awesome Oscillator; Balance of Power; Bollinger Bands; Bollinger Bands %B; Bollinger Bands Width; Chaikin Money Flow; Chaikin Oscillator; Chaikin Volatility; Chande Kroll Stop; Chande Momentum Oscillator; Chop Zone; Choppiness Index; Commodity Channel Index; Connors RSI; Coppock Curve; Correlation Coefficient; Correlation - Log; Detrended Price Oscillator; Directional Movement; Donchian Channels; Double EMA; Ease of Movement; Elder's Force Index; EMA Cross; Envelopes; Fisher Transform; Guppy Multiple Moving Average; Historical Volatility; Hull Moving Average; Ichimoku Cloud; Keltner Channels; Klinger Oscillator; Know Sure Thing; Least Squares Moving Average; Linear Regression Curve; Linear Regression Slope; MA Cross; MA with EMA Cross; Mass Index; McGinley Dynamic; Median Price; Momentum; Money Flow Index; Moving Average; Moving Average Channel; MACD; Moving Average Exponential; Moving Average Weighted; Moving Average Double; Moving Average Triple; Moving Average Adaptive; Moving Average Hamming; Moving Average Multiple; Majority Rule; Net Volume; On Balance Volume; Parabolic SAR; Pivot Points Standard; Price Channel; Price Oscillator; Price Volume Trend; Rank Correlation Index; Rate Of Change; Ratio; Relative Strength Index; Relative Vigor Index; Relative Volatility Index; Standard Error; Standard Error Bands; SMI Ergodic Indicator/Oscillator; Smoothed Moving Average; Standard Deviation; Stochastic; Stochastic RSI; SuperTrend; Spread; TRIX; Triple EMA; True Strength Indicator; Trend Strength Index; Typical Price; Ultimate Oscillator; Volatility Close-to-Close; Volatility Zero Trend Close-to-Close; Volatility O-H-L-C; Volatility Index; VWAP; VWMA; Volume Oscillator; Volume Profile Fixed Range; Volume Profile Visible Range; Vortex Indicator; Volume; Williams %R; Williams Alligator; Williams Fractal; Zig Zag. (Also "Overlay" and "Compare" pseudo-studies.)

Volume-dependent studies the library lets you blacklist when the feed has no volume: Accumulation/Distribution, Chaikin Money Flow, Ease of Movement, Elders Force Index, Klinger Oscillator, Money Flow Index, Net Volume, On Balance Volume, Price Volume Trend, VWAP, Volume Oscillator (plus VWMA, Volume, Volume Profile, Up/Down Volume, CVD, Volume Delta, Relative Volume, 24-hour Volume, Chaikin Oscillator, Accumulation Distribution, Klinger).

---

## 2. Pine `ta.*` primitives — exact definitions, seeding and NaN handling

All JS snippets assume arrays indexed 0..n-1 in chronological order and `NaN` for `na`. `src[i]` in Pine (i bars back) is `src[idx - i]` in JS. "Ignores na" means: the window is the last `length` **non-na** values (the function skips na entries, so the output appears later if the source has na holes). Where the reference says nothing about na, na inside the window makes the result na.

### 2.1 Moving averages

**`ta.sma(source, length)`** [V] — arithmetic mean of the last `length` values.
```
pine_sma(x, y) => sum = 0.0; for i = 0 to y-1: sum := sum + x[i] / y; sum
```
Returns na until `length` values exist. na inside the window -> na (Pine reference: "na values in the source series are ignored"? — for `ta.sma` the reference text says the function *ignores* na; implement as "window of last `length` non-na values" for exact parity on gappy data, and as plain windowed mean otherwise).

**`ta.ema(source, length)`** [V] — `alpha = 2 / (length + 1)`. Reference equivalent:
```
pine_ema(src, length) =>
    alpha = 2 / (length + 1)
    sum = 0.0
    sum := na(sum[1]) ? ta.sma(src, length) : alpha * src + (1 - alpha) * nz(sum[1])
```
Seeding: the first non-na EMA value is the SMA of the first `length` values (appears at bar `length-1`); afterwards recursive. Reference remark: "na values are ignored", `length` must be `simple int`. Note: some third-party sources claim TV seeds `ta.ema` with the first source value; the official reference equivalent uses the SMA seed. Both converge quickly, but use the SMA seed for parity with the reference; if empirical tests on TV show values on bar 0, switch to "first value" seeding.
```js
function ema(src, len){ const a=2/(len+1), out=new Array(src.length).fill(NaN); let prev=NaN;
  for(let i=0;i<src.length;i++){ if(isNaN(prev)){ const s=sma(src,len)[i]; if(!isNaN(s)){prev=s;} out[i]=prev; }
  else { prev=a*src[i]+(1-a)*prev; out[i]=prev; } } return out; }
```

**`ta.rma(source, length)`** [V] — Wilder's smoothing ("relative moving average", the MA used inside RSI/ATR/ADX). `alpha = 1 / length`. Reference equivalent:
```
pine_rma(src, length) =>
    alpha = 1/length
    sum = 0.0
    sum := na(sum[1]) ? ta.sma(src, length) : alpha * src + (1 - alpha) * nz(sum[1])
```
Seed = SMA of first `length` values; then `rma = (prev*(length-1) + src)/length`. This is exactly "Wilder's smoothing" (first value = simple average, then `((prior*(n-1)) + current)/n`).

**`ta.wma(source, length)`** [V] — linearly weighted, newest weight = length.
```
pine_wma(x, y) => norm=0.0; sum=0.0
    for i = 0 to y-1: weight = (y - i) * y; norm += weight; sum += x[i] * weight
    sum / norm
```
(The extra `* y` factor cancels; weights are `length, length-1, ..., 1` from newest to oldest.)

**`ta.vwma(source, length)`** [V] — `ta.sma(source * volume, length) / ta.sma(volume, length)`.

**`ta.swma(source)`** [V] — fixed 4-bar symmetric weights: `x[3]*1/6 + x[2]*2/6 + x[1]*2/6 + x[0]*1/6`.

**`ta.hma(source, length)`** [V] — `ta.wma(2*ta.wma(src, length/2) - ta.wma(src, length), math.round(math.sqrt(length)))`. `length/2` truncates (integer). `length` must be `simple int`.

**`ta.alma(series, length, offset, sigma, floor=false)`** [V] — Gaussian weights:
```
pine_alma(series, windowsize, offset, sigma) =>
    m = offset * (windowsize - 1)          // if floor=true: m = math.floor(m)
    s = windowsize / sigma
    norm = 0.0; sum = 0.0
    for i = 0 to windowsize - 1
        weight = math.exp(-1 * math.pow(i - m, 2) / (2 * math.pow(s, 2)))
        norm := norm + weight
        sum := sum + series[windowsize - i - 1] * weight
    sum / norm
```
Note the indexing: `i = 0` is the **oldest** bar (`series[windowsize-1]`), so `offset=0.85` centres the Gaussian near the newest bars. na anywhere in the window -> na.

**`ta.linreg(source, length, offset)`** [V] — least-squares line through the window; returns `intercept + slope * (length - 1 - offset)` where `slope`/`intercept` come from regressing `source` on `x = 0..length-1` (x=0 oldest). Equivalent JS:
```js
function linreg(src, len, offset, idx){ let sx=0,sy=0,sxx=0,sxy=0; for(let i=0;i<len;i++){ const x=i, y=src[idx-len+1+i]; sx+=x; sy+=y; sxx+=x*x; sxy+=x*y; }
  const slope=(len*sxy-sx*sy)/(len*sxx-sx*sx); const intercept=(sy-slope*sx)/len; return intercept+slope*(len-1-offset); }
```
`offset=0` -> the fitted value at the newest bar (LSMA). Reference: na values ignored.

### 2.2 Volatility / statistics

**`ta.tr` / `ta.tr(handle_na)`** [V] — `math.max(high - low, math.abs(high - close[1]), math.abs(low - close[1]))`. With `handle_na=true`, on the first bar (`close[1]` is na) it returns `high - low`; with `false` it returns na. `ta.atr` uses `ta.tr(true)`.

**`ta.atr(length)`** [V] — `ta.rma(ta.tr(true), length)`:
```
pine_atr(length) =>
    trueRange = na(high[1]) ? high-low : math.max(math.max(high - low, math.abs(high - close[1])), math.abs(low - close[1]))
    ta.rma(trueRange, length)
```

**`ta.stdev(source, length, biased=true)`** [V] — population (÷N) by default; `biased=false` -> sample (÷(N-1)).
```
pine_stdev(src, length) =>
    avg = ta.sma(src, length)
    sumOfSquareDeviations = 0.0
    for i = 0 to length - 1
        sum = src[i] - avg
        sumOfSquareDeviations := sumOfSquareDeviations + sum * sum
    math.sqrt(sumOfSquareDeviations / length)
```
The full reference version also contains `isZero(val, eps)`/`SUM()` helpers that zero out floating-point dust (`|x| < 1e-10` treated as 0). Reference: na ignored, calculates on `length` non-na values.

**`ta.variance(source, length, biased=true)`** [V] — square of the above (population by default).

**`ta.dev(source, length)`** [V] — **mean absolute deviation** (not std dev):
```
pine_dev(source, length) => mean = ta.sma(source, length); sum = 0.0
    for i = 0 to length-1: sum := sum + math.abs(source[i] - mean)
    sum / length
```

**`ta.correlation(source1, source2, length)`** [V] — Pearson r over the window (covariance / (stdev1 * stdev2), population moments). na ignored.

**`ta.percentrank(source, length)`** [V] — percent (0..100) of the previous `length` values that are **less than or equal to** the current value: `100 * count(source[i] <= source[0], i=1..length) / length`. na values inside the window make the result na (reference: "includes na values").

**`ta.percentile_nearest_rank(source, length, percentage)`** [V] — sort the last `length` values ascending; rank `n = ceil(percentage/100 * length)`; return the n-th (1-based) value. na ignored.

**`ta.percentile_linear_interpolation(source, length, percentage)`** [V] — linear interpolation between the two nearest ranks (rank position `r = percentage/100 * (length - 1)` on the ascending sorted window, 0-based; value = `v[floor r] + (r - floor r) * (v[ceil r] - v[floor r])`).

**`ta.median(source, length)`** [V] — median of the window (= `percentile_nearest_rank(..., 50)` for odd windows; for even windows TV's median returns the average of the two middle values (verify)). **`ta.mode(source, length)`** [V] — most frequent value; ties -> smallest value. **`ta.range(source, length)`** [V] — `max - min` of the window. **`ta.cum(source)`** [V] — running total since the first bar. **`ta.change(source, length=1)`** [V] — `source - source[length]` (bool series: true when value changed). **`ta.mom(source, length)`** — `source - source[length]`. **`ta.roc(source, length)`** [V] — `100 * (source - source[length]) / source[length]`.

**`ta.highest(source, length)` / `ta.lowest`** [V] — max/min of window (default source = high / low). **`ta.highestbars(source, length)` / `ta.lowestbars`** [V] — offset (0 or negative) to the bar holding the max/min; 0 = current bar, -k = k bars ago. Tie-breaking: the **most recent** extreme is used (verify with `ta.aroon` parity tests).

**`ta.pivothigh(source=high, leftbars, rightbars)` / `ta.pivotlow`** [V] — returns the pivot price on the bar where it is *confirmed* (i.e. `rightbars` after the pivot bar), otherwise na. Condition for a pivot high at bar p: `source[p] > source[p-i]` for i=1..leftbars **and** `source[p] > source[p+j]` for j=1..rightbars (strict on both sides; verify equality handling: TV treats equal values on the right as not-a-pivot). Plot with `offset=-rightbars` to place it on the pivot bar.

**`ta.crossover(a, b)`** [V] — true on the bar where `a > b` and on the previous bar `a <= b` (na on either bar -> false). **`ta.crossunder`** symmetric. **`ta.cross`** — either direction.

**`ta.barssince(cond)`** [V] — bars since `cond` was last true (0 on the bar it is true); na if never true. **`ta.valuewhen(cond, source, occurrence)`** [V] — value of `source` on the bar of the n-th most recent occurrence (0 = latest) of `cond`.

**`ta.rising(src, len)` / `ta.falling`** — true if `src` strictly increased/decreased on each of the last `len` bars.

### 2.3 Oscillators

**`ta.rsi(source, length)`** [V]:
```
pine_rsi(x, y) =>
    u = math.max(x - x[1], 0)      // upward change
    d = math.max(x[1] - x, 0)      // downward change
    rs = ta.rma(u, y) / ta.rma(d, y)
    res = 100 - 100 / (1 + rs)
```
The RSI built-in guards division: `rsi = down == 0 ? 100 : up == 0 ? 0 : 100 - (100 / (1 + up / down))`.

**`ta.stoch(source, high, low, length)`** [V] — `100 * (source - ta.lowest(low, length)) / (ta.highest(high, length) - ta.lowest(low, length))`.

**`ta.cci(source, length)`** [V] — `(source - ta.sma(source, length)) / (0.015 * ta.dev(source, length))`.

**`ta.mfi(series, length)`** [V]:
```
pine_mfi(src, length) =>
    upper = math.sum(volume * (ta.change(src) <= 0.0 ? 0.0 : src), length)
    lower = math.sum(volume * (ta.change(src) >= 0.0 ? 0.0 : src), length)
    100.0 - (100.0 / (1.0 + upper / lower))
```
(Raw money flow = `src * volume`; a bar with zero change counts in neither sum.)

**`ta.cmo(series, length)`** [V]:
```
f_cmo(src, length) => mom = ta.change(src)
    sm1 = math.sum(mom >= 0 ? mom : 0.0, length)
    sm2 = math.sum(mom >= 0 ? 0.0 : -mom, length)
    100 * (sm1 - sm2) / (sm1 + sm2)
```

**`ta.cog(source, length)`** [V] — `-(sum_{i=0}^{length-1} source[i]*(i+1)) / sum(source, length)` (i=0 newest).

**`ta.tsi(source, short_length, long_length)`** [V] — `100 * ema(ema(change, long), short) / ema(ema(|change|, long), short)`; note the argument order: `ta.tsi(close, 13, 25)` = short 13, long 25 (double smoothing: first the **long** EMA, then the short).

**`ta.wpr(length)`** [V] — `100 * (close - highest(high, length)) / (highest(high, length) - lowest(low, length))` (result in -100..0).

**`ta.dmi(diLength, adxSmoothing)`** [V] — returns `[+DI, -DI, ADX]` (see DMI indicator below for the exact expansion using `ta.rma`).

**`ta.macd(source, fast, slow, signal)`** [V] — `[ema(fast) - ema(slow), ema(macd, signal), macd - signal]`.

**`ta.bb(series, length, mult)`** [V] — `[basis, basis + dev, basis - dev]`, `basis = sma`, `dev = mult * stdev` (population). **`ta.bbw`** — `((basis+dev) - (basis-dev)) / basis` (the reference `f_bbw` returns the ratio; the BBW indicator multiplies by 100).

**`ta.kc(series, length, mult, useTrueRange=true)`** [V] — `basis = ema(series, length)`, `span = useTrueRange ? ta.tr : high - low`, `rangeEma = ema(span, length)`, `[basis, basis + rangeEma*mult, basis - rangeEma*mult]`. **`ta.kcw`** — `(upper - lower) / basis`.

**`ta.sar(start, inc, max)`** [V] — reference equivalent (this is the exact algorithm; note the two-bar lookback clamp):
```
pine_sar(start, inc, max) =>
    var float result = na
    var float maxMin = na
    var float acceleration = na
    var bool isBelow = na
    bool isFirstTrendBar = false
    if bar_index == 1
        if close > close[1]
            isBelow := true;  maxMin := high; result := low[1]
        else
            isBelow := false; maxMin := low;  result := high[1]
        isFirstTrendBar := true
        acceleration := start
    result := result + acceleration * (maxMin - result)
    if isBelow
        if result > low
            isFirstTrendBar := true; isBelow := false
            result := math.max(high, maxMin); maxMin := low; acceleration := start
    else
        if result < high
            isFirstTrendBar := true; isBelow := true
            result := math.min(low, maxMin); maxMin := high; acceleration := start
    if not isFirstTrendBar
        if isBelow
            if high > maxMin
                maxMin := high; acceleration := math.min(acceleration + inc, max)
        else
            if low < maxMin
                maxMin := low; acceleration := math.min(acceleration + inc, max)
    if isBelow
        result := math.min(result, low[1])
        if bar_index > 1
            result := math.min(result, low[2])
    else
        result := math.max(result, high[1])
        if bar_index > 1
            result := math.max(result, high[2])
    result
```
Bar 0 returns na; bar 1 seeds using the direction of `close` vs `close[1]`.

**`ta.supertrend(factor, atrPeriod)`** [V] — reference equivalent (returns `[supertrend, direction]`, direction -1 = up-trend, 1 = down-trend):
```
pine_supertrend(factor, atrPeriod) =>
    src = hl2
    atr = ta.atr(atrPeriod)
    upperBand = src + factor * atr
    lowerBand = src - factor * atr
    prevLowerBand = nz(lowerBand[1])
    prevUpperBand = nz(upperBand[1])
    lowerBand := lowerBand > prevLowerBand or close[1] < prevLowerBand ? lowerBand : prevLowerBand
    upperBand := upperBand < prevUpperBand or close[1] > prevUpperBand ? upperBand : prevUpperBand
    int direction = na
    float superTrend = na
    prevSuperTrend = superTrend[1]
    if na(atr[1])
        direction := 1
    else if prevSuperTrend == prevUpperBand
        direction := close > upperBand ? -1 : 1
    else
        direction := close < lowerBand ? 1 : -1
    superTrend := direction == -1 ? lowerBand : upperBand
    [superTrend, direction]
```

**`ta.vwap(source, anchor, stdev_mult)`** [V] — cumulative since the last bar where `anchor` was true (default anchor = start of session / `timeframe.change("1D")`):
```
sumSrcVol   = isNew ? src*volume          : src*volume + sumSrcVol[1]
sumVol      = isNew ? volume              : volume + sumVol[1]
sumSrcSrcVol= isNew ? volume*src*src      : volume*src*src + sumSrcSrcVol[1]
vwap        = sumSrcVol / sumVol
variance    = max(0, sumSrcSrcVol / sumVol - vwap*vwap)     // volume-weighted population variance of source around VWAP
stdev       = sqrt(variance)
upper = vwap + stdev_mult*stdev ; lower = vwap - stdev_mult*stdev
```
(The band math above is the implementation used by the built-in VWAP indicator before `ta.vwap` gained bands; `ta.vwap` reproduces it.)

### 2.4 Volume primitives (all `series float` variables, cumulative from first bar)

* **`ta.accdist`** [V] — `ta.cum(((close - low) - (high - close)) / (high - low) * volume)`; when `high == low` the term is 0 (division guard: the built-in CMF uses `close==high and close==low or high==low ? 0 : ...`).
* **`ta.obv`** [V] — `ta.cum(math.sign(ta.change(close)) * volume)`.
* **`ta.pvt`** [V] — `ta.cum((ta.change(close) / close[1]) * volume)`.
* **`ta.iii`** [V] — `(2*close - high - low) / ((high - low) * volume)` (per bar, not cumulative).
* **`ta.wad`** [V] — `trueHigh = max(high, close[1])`, `trueLow = min(low, close[1])`, `mom = change(close)`, `gain = mom > 0 ? close - trueLow : mom < 0 ? close - trueHigh : 0`, `ta.cum(gain)`.
* **`ta.wvad`** [V] — `(close - open) / (high - low) * volume` (per bar).
* **`ta.nvi`** [V]:
```
f_nvi() =>
    float ta_nvi = 1.0
    float prevNvi = (nz(ta_nvi[1], 0.0) == 0.0) ? 1.0 : ta_nvi[1]
    if nz(close, 0.0) == 0.0 or nz(close[1], 0.0) == 0.0
        ta_nvi := prevNvi
    else
        ta_nvi := (volume < nz(volume[1], 0.0)) ? prevNvi + ((close - close[1]) / close[1]) * prevNvi : prevNvi
```
* **`ta.pvi`** [V] — same with `volume > nz(volume[1], 0.0)`. (The NVI/PVI *indicators* start at 1000, the `ta.*` variables at 1.0.)

---

## 3. Indicator specifications (alphabetical)

Template per indicator: names -> pane/scale -> inputs -> calculation (Pine-equivalent) -> plots/styles -> notes.
"Calculation group" = the standard `Timeframe` + `Wait for timeframe closes` inputs added by `timeframe=""`, `timeframe_gaps=true`; it is present on every indicator marked "MTF: yes".

---

### 3.1 Accumulation/Distribution `[S]`

* TV title: **Accumulation/Distribution**; short: **Accum/Dist**; library study: `Accumulation/Distribution`. Help-Center title "Accumulation Distribution (ADL)".
* Pane: separate; `format=format.volume`. MTF: yes.
* Inputs: none (besides Calculation group).
* Calculation: `ta.accdist` = cumulative sum of `mfv = ((close - low) - (high - close)) / (high - low) * volume` (0 when `high == low`).
* Plots: `Accumulation/Distribution` line `#2962FF` width 1 (library default `#2196F3`).
* Notes: requires volume; raises "No volume is provided by the data vendor." when cumulative volume is 0 on the last bar (all volume indicators use this guard).

### 3.2 Accumulative Swing Index `[F]` (library) / Wilder's Swing Index

* Library study: `Accumulative Swing Index`; plot title `ASI`. Not a Help-Center built-in on the website; present in the charting library list.
* Pane: separate.
* Inputs: `Limit Move Value` float, default **10** in the library metainfo (min 0.1, max 100000); community/TV desktop versions default 10000. Use 10 for library parity.
* Calculation (Wilder):
```
H_C1 = |high - close[1]|; L_C1 = |low - close[1]|; H_L = |high - low|; C1_O1 = |close[1] - open[1]|
K = max(H_C1, L_C1)
R = H_C1 >= max(L_C1, H_L) ? H_C1 - 0.5*L_C1 + 0.25*C1_O1
  : L_C1 >= max(H_C1, H_L) ? L_C1 - 0.5*H_C1 + 0.25*C1_O1
  :                          H_L + 0.25*C1_O1
SI  = 50 * ((close - close[1] + 0.5*(close - open) + 0.25*(close[1] - open[1])) / R) * K / limitMove
ASI = ta.cum(SI)
```
* Plots: `ASI` line `#2196F3` width 1.
* Notes: first bar SI is na (needs close[1]); `ta.cum` treats na as 0. Division by R=0 (all four prices equal) -> guard to 0.

### 3.3 Advance/Decline (library) and the breadth family `[D]`

* Library study `Advance/Decline`: input `length` (default 10, 1..2000), plot `#2196F3`. Computes a bars-based ratio on the chart symbol (count of bars with close > close[1] divided by count of bars with close < close[1] over `length`), i.e. the website's **Advance/Decline Ratio (Bars)** [V: "counts green bars / red bars over the last N bars"]. Default length on the website: not stated (use 10 for library parity; verify).
* Website **Advance/Decline Line** [D]: cumulative `(advancing issues - declining issues)`; **Advance/Decline Ratio** [D]: `advancing / declining`; **Cumulative Volume Index** [D]: `CVI = CVI[1] + (advancingVolume - decliningVolume)`. These need exchange breadth feeds (TradingView uses `USI:` symbols such as `USI:ADVN`/`USI:DECN`/`USI:UVOL`/`USI:DVOL` for NYSE; exact tickers vary — the built-in scripts request them with `request.security`). Implement only if such feeds exist; otherwise expose them as "data unavailable".
* Plots: single line, blue; A/D Line and CVI are cumulative lines in a separate pane.

### 3.4 Arnaud Legoux Moving Average `[V]` inputs / `[S]` plot

* TV title: **Arnaud Legoux Moving Average**; short: **ALMA**; library study: `Arnaud Legoux Moving Average`.
* Pane: overlay. MTF: yes.
* Inputs: `Source` (source, close); `Window Size` (int, **9**); `Offset` (float, **0.85**, step 0.05, 0..1); `Sigma` (float, **6**).
* Calculation: `ta.alma(source, windowsize, offset, sigma)` (section 2.1, `floor=false`).
* Plots: `ALMA` line `#2962FF` width 1 (library `#2196F3`).

### 3.5 Aroon `[S]`

* TV title: **Aroon**; short: **Aroon**; library study: `Aroon`. (Help Center: "Aroon Indicator".)
* Pane: separate, values 0..100; `format=format.price, precision=2`. MTF: yes.
* Inputs: `Length` (int, **14**, min 1).
* Calculation:
```
upper = 100 * (ta.highestbars(high, length+1) + length) / length   // Aroon Up
lower = 100 * (ta.lowestbars(low,  length+1) + length) / length    // Aroon Down
```
(`highestbars` returns 0 for the current bar, -k for k bars ago; window is `length+1` bars so "days since high" ranges 0..length.)
* Plots: `Aroon Up` line `#FB8C00` (orange); `Aroon Down` line `#2962FF`. Library: `upper` `#FB8C00`, `lower` `#2196F3`.
* Notes: no hlines by default. Scale auto-fits 0..100 because both lines span it.

### 3.6 Aroon Oscillator `[V]` calc / `[F]` defaults

* TV title: **Aroon Oscillator** (Help Center 2025 addition).
* Pane: separate, -100..100. MTF: yes.
* Inputs: `Length` (int, default not stated; use **14**, verify). Calculation group.
* Calculation: `aroonOsc = aroonUp - aroonDown` with the formulas of 3.5.
* Plots: oscillator line color-coded by sign (green above 0, red below; use `#089981` / `#F23645`) with a gradient/area background fill toward zero; hlines at **+90**, **0**, **-90** (`#787B86`).

### 3.7 Average Daily Range (Average Day Range) `[V]` calc / `[F]` defaults

* TV title: **Average Daily Range**; short: **ADR**. Not in the library list.
* Pane: separate (right scale). MTF: yes.
* Inputs: `Length` (int, default not stated on the page; use **14**), Calculation group.
* Calculation (Help Center): `adr = ta.sma(high, length) - ta.sma(low, length)` (average of highs minus average of lows; note: not SMA of `high-low` — identical result since SMA is linear).
* Plots: `ADR` line (single value), default color blue `#2962FF`. Some TV builds also offer ADR bands on the price chart (`source ± adr/2`) — not in the current Help-Center description; omit.

### 3.8 Average Directional Index `[S]`

* TV title: **Average Directional Index**; short: **ADX**; library study: `Average Directional Index`.
* Pane: separate, 0..100; `format=format.price, precision=2`. MTF: yes.
* Inputs: `ADX Smoothing` (int, **14**); `DI Length` (int, **14**).
* Calculation:
```
dirmov(len) =>
    up = ta.change(high)
    down = -ta.change(low)
    plusDM  = na(up)   ? na : (up > down and up > 0     ? up   : 0)
    minusDM = na(down) ? na : (down > up and down > 0   ? down : 0)
    truerange = ta.rma(ta.tr, len)
    plus  = fixnan(100 * ta.rma(plusDM,  len) / truerange)
    minus = fixnan(100 * ta.rma(minusDM, len) / truerange)
    [plus, minus]
adx(dilen, adxlen) =>
    [plus, minus] = dirmov(dilen)
    sum = plus + minus
    100 * ta.rma(math.abs(plus - minus) / (sum == 0 ? 1 : sum), adxlen)
```
* Plots: `ADX` line `#F50057` (library `adx` `#FF5252`).
* Notes: `ta.tr` (not `ta.tr(true)`) -> first bar TR is na, so RMA seeding starts one bar later than ATR. `fixnan` carries forward the last valid DI when TR RMA is 0.

### 3.9 Average True Range `[V]`

* TV title: **Average True Range**; short: **ATR**; library study: `Average True Range`.
* Pane: separate. MTF: yes.
* Inputs: `Length` (int, **14**, min 1); `Smoothing` (select, **RMA** | SMA | EMA | WMA).
* Calculation: `ma_function(ta.tr(true), length)` where `ma_function` dispatches on Smoothing (`ta.rma`, `ta.sma`, `ta.ema`, `ta.wma`).
* Plots: `ATR` line `#B71C1C` (library `#801922`).
* Style extras: Precision default = symbol precision.

### 3.10 Awesome Oscillator `[V]`

* TV title: **Awesome Oscillator**; short: **AO**; library study: `Awesome Oscillator`.
* Pane: separate, zero-centred. MTF: yes.
* Inputs: none (fixed 5/34; the Help-Center Pine shows `lengthAO1=5`, `lengthAO2=34` as inputs with `minval=1` in older versions; the current built-in hides them).
* Calculation: `ao = ta.sma(hl2, 5) - ta.sma(hl2, 34)`; `diff = ao - ao[1]`.
* Plots: `AO` **columns**, color `diff <= 0 ? #F23645 : #089981` (older builds `#F44336` / `#4CAF50`; library base `#000080` with a 2-color palette). Width 1. No hline (zero implied by columns).

### 3.11 Balance of Power `[V]` calc / `[S]` style

* TV title: **Balance of Power**; short: **BOP**; library study: `Balance of Power`.
* Pane: separate, -1..1; `precision=2`. MTF: yes.
* Inputs: none.
* Calculation: `bop = (close - open) / (high - low)` (na when high == low -> guard to 0).
* Plots: `BOP` line `#F23645` (library `#FF5252`); optional zero hline `#787B86` dashed.

### 3.12 Bollinger Bands `[S]`

* TV title: **Bollinger Bands**; short: **BB**; library study: `Bollinger Bands`.
* Pane: overlay. MTF: yes.
* Inputs: `Length` (int, **20**, min 1); `Basis MA Type` (select, **SMA** | EMA | SMMA (RMA) | WMA | VWMA); `Source` (**close**); `StdDev` (float, **2.0**, 0.001..50); `Offset` (int, **0**, -500..500, data-window only).
* Calculation:
```
basis = ma(src, length, maType)
dev   = mult * ta.stdev(src, length)     // population stdev
upper = basis + dev ; lower = basis - dev
```
* Plots (all `offset=offset`): `Basis` line `#2962FF`; `Upper` line `#F23645`; `Lower` line `#089981`; fill `Background` between Upper and Lower `color.rgb(33,150,243,95)` (blue, 95 % transparent).
* Library defaults differ: median `#FF6D00`, upper/lower `#2196F3`, background `#2196F3` @95.
* Legend: `BB 20 SMA close 2` then basis/upper/lower values.

### 3.13 Bollinger Bands %B `[V]`

* TV title: **Bollinger Bands %B**; short: **BB %B**; library study: `Bollinger Bands %B`.
* Pane: separate. MTF: yes.
* Inputs: `Length` **20**; `Source` **close**; `StdDev` **2.0**.
* Calculation: `basis = sma(src,len)`, `dev = mult*stdev`, `upper = basis+dev`, `lower = basis-dev`, `bbr = (src - lower) / (upper - lower)`.
* Plots: `%B` line `#26A69A` (library `plot` `#22AB94`); hlines `Overbought` = **1** and `Oversold` = **0** (`#787B86`, dashed), fill between them `#26A69A` @90 (library `hlines background` `#26A69A` 90).

### 3.14 Bollinger BandWidth `[V]`

* TV title: **Bollinger BandWidth**; short: **BBW**; library study: `Bollinger Bands Width`.
* Pane: separate. MTF: yes.
* Inputs: `Length` **20**; `Source` **close**; `StdDev` **2.0**; `Highest Expansion Length` (int, **125**, verify) ; `Lowest Contraction Length` (int, **125**, verify).
* Calculation: `bbw = (upper - lower) / basis * 100`; `highestExpansion = ta.highest(bbw, expLen)`; `lowestContraction = ta.lowest(bbw, contrLen)`.
* Plots: `Bollinger BandWidth` line `#2962FF` (library `#FF6D00`); `Highest Expansion` line green (`#089981`); `Lowest Contraction` line red (`#F23645`) (colors verify).

### 3.15 Bollinger Bars `[V]` behaviour / `[F]` implementation

* TV title: **Bollinger Bars** (John Bollinger, 2024). Overlay; not in the library.
* Inputs: none documented (only Style colors).
* Rendering: every bar drawn at a fixed width; body colored green (`#089981`) when close > open, red (`#F23645`) when close < open; the wicks (high-to-body-top and body-bottom-to-low) are drawn as **wide blue blocks** (`#2962FF`) of the same width as the body. Implement as a custom bar renderer (Pine uses `plotcandle`/`plotbar` with `bordercolor`/`wickcolor` per component). Intended to be used with the chart series hidden.

### 3.16 BBTrend `[V]` formula / `[F]` defaults

* TV title: **BBTrend**; short: **BBTrend** (John Bollinger, 2024). Separate pane. MTF: yes.
* Inputs: `Short BB Length` (int, **20**); `Long BB Length` (int, **50**); `StdDev` (float, **2.0**) (defaults verify).
* Calculation:
```
[shortUpper, shortMiddle, shortLower] = bb(close, shortLen, mult)
[longUpper,  longMiddle,  longLower ] = bb(close, longLen,  mult)
bbtrend = (math.abs(shortLower - longLower) - math.abs(shortUpper - longUpper)) / shortMiddle * 100
```
* Plots: `BBTrend` **columns**; green when > 0, red when < 0, with intensity: stronger color when moving away from zero, dimmer when moving toward zero. Suggested 4-color scheme `#26A69A` (>0 rising), `#B2DFDB` (>0 falling), `#FF5252` (<0 falling), `#FFCDD2` (<0 rising) (verify exact hex).

### 3.17 Bull Bear Power `[V]` formula / `[F]` style

* TV title: **Bull Bear Power**; short: **BBPower**. Separate pane, zero-centred. MTF: yes.
* Inputs: `Length` (int, **13**).
* Calculation: `ema = ta.ema(close, length)`; `bullPower = high - ema`; `bearPower = low - ema`; `bbp = bullPower + bearPower`.
* Plots: `BBPower` **columns** (verify: may be line), colored by sign (`#089981` / `#F23645`); zero hline `#787B86`.
* Notes: Technical Ratings uses the separate Bull Power / Bear Power values (see 3.86).

### 3.18 Chaikin Money Flow `[S]`

* TV title: **Chaikin Money Flow**; short: **CMF**; library study: `Chaikin Money Flow`.
* Pane: separate, -1..1; `precision=2`. MTF: yes.
* Inputs: `Length` (int, **20**, min 1).
* Calculation:
```
ad = close == high and close == low or high == low ? 0 : ((2*close - low - high) / (high - low)) * volume
mf = math.sum(ad, length) / math.sum(volume, length)
```
* Plots: `MF` line `#43A047`; hline `Zero` = 0 `#787B86` dashed.

### 3.19 Chaikin Oscillator `[S]`

* TV title: **Chaikin Oscillator**; short: **Chaikin Osc**; library study: `Chaikin Oscillator`.
* Pane: separate; `format=format.volume`. MTF: yes.
* Inputs: `Fast Length` (int, **3**); `Slow Length` (int, **10**).
* Calculation: `osc = ta.ema(ta.accdist, fast) - ta.ema(ta.accdist, slow)`.
* Plots: `Chaikin Oscillator` line `#EC407A`; hline 0 `#787B86` dashed.

### 3.20 Chaikin Volatility `[F]` (library only)

* Library study: `Chaikin Volatility`. Separate pane.
* Inputs: `Periods` (int, **10**); `Rate of Change` (int, **10**).
* Calculation: `hl = ta.ema(high - low, periods)`; `cv = (hl - hl[roc]) / hl[roc] * 100`.
* Plots: `plot` line `#AB47BC`; `zero` hline 0 `#787B86` dashed (verified library defaults).

### 3.21 Chande Kroll Stop `[V]` formula / `[S]` style

* TV title: **Chande Kroll Stop**; library study: `Chande Kroll Stop`.
* Pane: overlay.
* Inputs: `ATR Length` p (int, **10**); `ATR Coefficient` x (float, **1**); `Stop Length` q (int, **9**).
* Calculation:
```
first_high_stop = ta.highest(high, p) - x * ta.atr(p)
first_low_stop  = ta.lowest(low,  p) + x * ta.atr(p)
stop_short = ta.highest(first_high_stop, q)
stop_long  = ta.lowest(first_low_stop,  q)
```
* Plots: `Stop Long` line (green/blue) and `Stop Short` line (red/orange). Library: `long` `#2196F3`, `short` `#FF6D00`. Pine build uses `#089981` / `#F23645` (verify).

### 3.22 Chande Momentum Oscillator `[S]`

* TV title: **Chande Momentum Oscillator**; short: **ChandeMO**; library study: `Chande Momentum Oscillator`.
* Pane: separate, -100..100; `precision=2`. MTF: yes.
* Inputs: `Length` (int, **9**, min 1); `Source` (**close**).
* Calculation:
```
momm = ta.change(src)
m1 = momm >= 0 ? momm : 0 ;  m2 = momm >= 0 ? 0 : -momm
sm1 = math.sum(m1, length) ; sm2 = math.sum(m2, length)
chandeMO = 100 * (sm1 - sm2) / (sm1 + sm2)
```
* Plots: `Chande MO` line `#2962FF`; hline `Zero Line` 0 `#787B86` dashed. (Help Center text mentions ±50 as overbought/oversold; no hlines at ±50 in the built-in.)

### 3.23 Chandelier Exit `[V]` formula / `[F]` defaults

* TV title: **Chandelier Exit** (2025 addition). Overlay. MTF: yes.
* Inputs: `Length` (int, **22**), `ATR Length` (int, **22**), `ATR Multiplier` (float, **3.0**) (Help Center gives no defaults; these are the LeBeau standards used by TV's `ta` library `chandelierExit()` — verify).
* Calculation: `longExit = ta.highest(high, length) - atrMult * ta.atr(atrLength)`; `shortExit = ta.lowest(low, length) + atrMult * ta.atr(atrLength)`.
* Plots: `Long Exit` line blue (`#2962FF`); `Short Exit` line orange (`#FF6D00`).

### 3.24 Chop Zone `[S]`

* TV title: **Chop Zone**; short: **Chop Zone**; library study: `Chop Zone`.
* Pane: separate (a strip of unit-height columns); `precision=4`. MTF: yes.
* Inputs: none (fixed).
* Calculation:
```
periods = 30
src = close
pi = math.atan(1) * 4
highestHigh = ta.highest(periods)      // of high
lowestLow   = ta.lowest(periods)       // of low
span = 25 / (highestHigh - lowestLow) * lowestLow
ema34 = ta.ema(src, 34)
x1 = 0, x2 = 1, y1 = 0
y2 = (ema34[1] - ema34) / hlc3 * span
c  = math.sqrt((x2 - x1)*(x2 - x1) + (y2 - y1)*(y2 - y1))
emaAngle_1 = math.round(180 * math.acos((x2 - x1) / c) / pi)
emaAngle   = y2 > 0 ? -emaAngle_1 : emaAngle_1
color =
  emaAngle >= 5                      ? #26C6DA   // turquoise
: emaAngle < 5     and emaAngle >= 3.57  ? #43A047   // dark green
: emaAngle < 3.57  and emaAngle >= 2.14  ? #A5D6A7   // pale green
: emaAngle < 2.14  and emaAngle >= 0.71  ? #009688   // lime/teal
: emaAngle <= -5                     ? #D50000   // dark red
: emaAngle > -5    and emaAngle <= -3.57 ? #E91E63   // red
: emaAngle > -3.57 and emaAngle <= -2.14 ? #FF6D00   // orange
: emaAngle > -2.14 and emaAngle <= -0.71 ? #FFB74D   // light orange
:                                          #FDD835   // yellow (chop)
plot(1, style=plot.style_columns, color=color)
```
* Plots: one `columns` plot of constant value 1 whose color is the zone color. Library base color `#000080` with the palette above.

### 3.25 Choppiness Index `[S]`

* TV title: **Choppiness Index**; short: **CHOP**; library study: `Choppiness Index`.
* Pane: separate, 0..100; `precision=2`. MTF: yes.
* Inputs: `Length` (int, **14**, min 1); `Offset` (int, **0**, -500..500).
* Calculation: `ci = 100 * math.log10(math.sum(ta.atr(1), length) / (ta.highest(length) - ta.lowest(length))) / math.log10(length)`. (`ta.atr(1)` = RMA(1) of TR = TR with `handle_na`.)
* Plots: `CHOP` line `#2962FF` (offset); hlines `Upper Band` **61.8**, `Middle Band` 50 (`#787B86` @50), `Lower Band` **38.2** (`#787B86`, dashed); fill between 61.8/38.2 `color.rgb(33,150,243,90)`.

### 3.26 Commodity Channel Index `[S]`

* TV title: **Commodity Channel Index**; short: **CCI**; library study: `Commodity Channel Index`.
* Pane: separate; `precision=2`. MTF: yes.
* Inputs: `Length` (int, **20**); `Source` (**hlc3**); Smoothing group: `Type` (**None** | SMA | SMA + Bollinger Bands | EMA | SMMA (RMA) | WMA | VWMA), `Length` **14**, `BB StdDev` **2.0**.
* Calculation: `ma = ta.sma(src, length)`; `cci = (src - ma) / (0.015 * ta.dev(src, length))`; smoothing MA = `ma(cci, smLen, type)`, BB = `sma ± stdev(cci, smLen) * bbMult`.
* Plots: `CCI` line `#2962FF`; `CCI-based MA` line yellow (`color.yellow`, hidden when Type = None); BB upper/lower green with green @90 fill; hlines `Upper Band` **100**, `Middle Band` 0 (`#787B86` @50), `Lower Band` **-100** (`#787B86` dashed); fill 100..-100 `color.rgb(33,150,243,90)`.

### 3.27 Connors RSI `[S]`

* TV title: **Connors RSI**; short: **CRSI**; library study: `Connors RSI`.
* Pane: separate, 0..100. MTF: yes.
* Inputs: `RSI Length` **3**; `UpDown Length` **2**; `ROC Length` **100**.
* Calculation:
```
updown(s) =>
    isEqual = s == s[1] ; isGrowing = s > s[1]
    ud = 0.0
    ud := isEqual ? 0 : isGrowing ? (nz(ud[1]) <= 0 ? 1 : nz(ud[1]) + 1) : (nz(ud[1]) >= 0 ? -1 : nz(ud[1]) - 1)
rsi = ta.rsi(close, lenrsi)
updownrsi = ta.rsi(updown(close), lenupdown)
percentrank = ta.percentrank(ta.roc(close, 1), lenroc)
crsi = math.avg(rsi, updownrsi, percentrank)
```
* Plots: `CRSI` line `#2962FF`; hlines `Upper Band` **70**, `Middle Band` 50 (@50), `Lower Band` **30** (`#787B86`); fill 70..30 `color.rgb(33,150,243,90)`. (Help Center describes 90/10 as the classic signal thresholds; the drawn bands are 70/30.)

### 3.28 Coppock Curve `[S]`

* TV title: **Coppock Curve**; library study: `Coppock Curve`.
* Pane: separate, zero-centred. MTF: yes.
* Inputs: `WMA Length` **10**; `Long RoC Length` **14**; `Short RoC Length` **11**; `Source` **close**.
* Calculation: `curve = ta.wma(ta.roc(src, longRoC) + ta.roc(src, shortRoC), wmaLength)`.
* Plots: `Coppock Curve` line `#2962FF`; hline 0 `#787B86` (verify presence).

### 3.29 Correlation Coefficient `[V]` calc / `[S]` inputs

* TV title: **Correlation Coefficient**; short: **CC**; library study: `Correlation Coefficient` (library also has `Correlation - Log`, which correlates `log` returns; plot `#2196F3`).
* Pane: separate, -1..1; `precision=2`.
* Inputs: `Symbol` (symbol input; default `SP:SPX` on TV — verify, library default may be empty/`AAPL`), `Source` (**close**), `Length` (int, **20**).
* Calculation: `other = request.security(sym, timeframe.period, src)`; `r = ta.correlation(src, other, length)` (Pearson using population variance/covariance as documented: `cov = avg(x*y) - avg(x)*avg(y)`, `var = avg(x^2) - avg(x)^2`, `r = cov / sqrt(varX * varY)`).
* Plots: `Correlation` **area** style `#2962FF` (library `plot` plottype `area` `#2196F3`); hlines at **1**, **0**, **-1** (dashed `#787B86`).

### 3.30 Cumulative Volume Delta `[V]` rules / `[S]` structure

* TV title: **Cumulative Volume Delta**; short: **CVD**. Separate pane, candle-style plot. Requires lower-timeframe (intrabar) data (`request.security_lower_tf`); the website script uses the `ta` library's `requestVolumeDelta()`.
* Inputs: `Anchor period` (timeframe select, default **1D** — CVD resets at each new anchor period); `Use custom timeframe` (bool, **false**); `Timeframe` (lower TF used when custom is on, default **1**).
* Auto intrabar timeframe: chart in seconds -> `1S`; minutes/hours -> `1`; daily -> `5`; other (weekly+) -> `60`.
* Intrabar polarity rule (identical for Volume Delta, CVD, Up/Down Volume): if intrabar `close > open` -> positive volume; `close < open` -> negative; if `close == open`: compare with previous intrabar close (`close > close[1]` positive, `<` negative); if still equal, inherit the previous intrabar's polarity (Up/Down Volume treats equal-to-previous as **up**).
* Output per chart bar (candle): `open` = 0 on the first bar of the anchor period, otherwise previous candle's close; `close` = open + delta of this bar; `high`/`low` = running max/min of the cumulative delta inside the bar (the ta-library returns `[openVolume, maxVolume, minVolume, lastVolume]`).
* Plots: `plotcandle` with up color `#089981`/`#26A69A` when close >= open else `#F23645`/`#EF5350` (verify hex; the CVD script uses the standard candle palette), no wick color difference; zero hline optional.
* Notes: "Volume delta" data quality depends on the LTF; with `Use custom timeframe` a lower TF increases precision but shortens history (Pine limits intrabars to 100k).

### 3.31 Cumulative Volume Index `[D]` — see 3.3.

---

### 3.32 Detrended Price Oscillator `[S]`

* TV title: **Detrended Price Oscillator**; short: **DPO**; library study: `Detrended Price Oscillator`.
* Pane: separate, zero-centred; `precision=2`. MTF: yes.
* Inputs: `Length` (int, **21**, min 1); `Centered` (bool, **false**).
* Calculation:
```
barsback = period / 2 + 1                    // integer division: 21 -> 11
ma = ta.sma(close, period)
dpo = isCentered ? close[barsback] - ma : close - ma[barsback]
plot(dpo, offset = isCentered ? -barsback : 0)
```
* Plots: `Detrended Price Oscillator` line `#43A047`; hline `Zero Line` 0 `#787B86` dashed.
* Notes: with Centered on, the plot is shifted `barsback` bars to the left (past), so the last `barsback` bars have no value.

### 3.33 Directional Movement Index `[S]`

* TV title: **Directional Movement Index**; short: **DMI**; library study: `Directional Movement` (library also exposes `DX` and `ADXR` plots: `dx` `#FFA726`, `adxr` `#ab47bc`).
* Pane: separate, 0..100; `precision=4`. MTF: yes.
* Inputs: `ADX Smoothing` (int, **14**, 1..50); `DI Length` (int, **14**, min 1).
* Calculation:
```
up = ta.change(high) ; down = -ta.change(low)
plusDM  = na(up)   ? na : (up > down and up > 0   ? up   : 0)
minusDM = na(down) ? na : (down > up and down > 0 ? down : 0)
trur  = ta.rma(ta.tr, len)
plus  = fixnan(100 * ta.rma(plusDM,  len) / trur)
minus = fixnan(100 * ta.rma(minusDM, len) / trur)
sum   = plus + minus
adx   = 100 * ta.rma(math.abs(plus - minus) / (sum == 0 ? 1 : sum), lensig)
```
* Plots: `ADX` line `#F50057`; `+DI` line `#2962FF`; `-DI` line `#FF6D00`. (Library: `adx` `#F50057`, `+di` `#2196F3`, `-di` `#FF6D00`.)
* `ta.dmi(diLength, adxSmoothing)` returns the same three series; reference example uses DI Length 17 as an example value only.

### 3.34 Divergence Indicator `[S]`

* TV title: **Divergence Indicator**; short: **Divergence**. Separate pane (RSI-based). Not in the library.
* Inputs: `RSI Period` (int, **14**); `Pivot Lookback Right` (int, **5**); `Pivot Lookback Left` (int, **5**); `Max of Lookback Range` (int, **60**); `Min of Lookback Range` (int, **5**); `Plot Bullish` (bool, **true**); `Plot Hidden Bullish` (bool, **false**); `Plot Bearish` (bool, **true**); `Plot Hidden Bearish` (bool, **false**); `Source` for RSI: close.
* Calculation:
```
osc = ta.rsi(close, len)
plFound = not na(ta.pivotlow(osc, lbL, lbR))
phFound = not na(ta.pivothigh(osc, lbL, lbR))
_inRange(cond) => bars = ta.barssince(cond == true); rangeLower <= bars and bars <= rangeUpper
// Regular Bullish: osc Higher Low, price Lower Low
oscHL   = osc[lbR] > ta.valuewhen(plFound, osc[lbR], 1) and _inRange(plFound[1])
priceLL = low[lbR] < ta.valuewhen(plFound, low[lbR], 1)
bullCond = plotBull and priceLL and oscHL and plFound
// Hidden Bullish: osc Lower Low, price Higher Low
oscLL   = osc[lbR] < ta.valuewhen(plFound, osc[lbR], 1) and _inRange(plFound[1])
priceHL = low[lbR] > ta.valuewhen(plFound, low[lbR], 1)
hiddenBullCond = plotHiddenBull and priceHL and oscLL and plFound
// Regular Bearish: osc Lower High, price Higher High
oscLH   = osc[lbR] < ta.valuewhen(phFound, osc[lbR], 1) and _inRange(phFound[1])
priceHH = high[lbR] > ta.valuewhen(phFound, high[lbR], 1)
bearCond = plotBear and priceHH and oscLH and phFound
// Hidden Bearish: osc Higher High, price Lower High
oscHH   = osc[lbR] > ta.valuewhen(phFound, osc[lbR], 1) and _inRange(phFound[1])
priceLH = high[lbR] < ta.valuewhen(phFound, high[lbR], 1)
hiddenBearCond = plotHiddenBear and priceLH and oscHH and phFound
```
* Plots: `RSI` line `#2962FF` (older: `#8D1699`), hlines 70 / 30 (`#787B86`) with fill; `Regular Bullish` line segments (`plot(plFound ? osc[lbR] : na, offset=-lbR, linewidth=2, color = bullCond ? green : transparent)`) and label `" Bull "` (`shape.labelup`, green, white text); `Hidden Bullish` (green @ transparent for line, label `" H Bull "`); `Regular Bearish` (red, label `" Bear "`, `shape.labeldown`); `Hidden Bearish` (label `" H Bear "`). Colors: `bearColor = color.red`, `bullColor = color.green`, `hiddenBullColor = color.new(color.green, 80)`, `hiddenBearColor = color.new(color.red, 80)`, `textColor = color.white`, `noneColor = color.new(color.white, 100)`.
* The **RSI** built-in's "Calculate Divergence" option (3.66) reuses the regular bull/bear logic with fixed 5/5/60/5.

### 3.35 Donchian Channels `[S]`

* TV title: **Donchian Channels**; short: **DC**; library study: `Donchian Channels`.
* Pane: overlay. MTF: yes.
* Inputs: `Length` (int, **20**, min 1); `Offset` (int, **0**).
* Calculation: `lower = ta.lowest(length)` (of low); `upper = ta.highest(length)` (of high); `basis = math.avg(upper, lower)`.
* Plots: `Basis` line `#FF6D00`; `Upper` line `#2962FF`; `Lower` line `#2962FF`; fill `Background` `color.rgb(33,150,243,95)`. Library: basis `#FF6D00`, upper/lower `#2196F3`, bg `#2196F3` @95.

### 3.36 Double EMA `[S]`

* TV title: **Double EMA**; short: **DEMA**; library study: `Double EMA`. Help Center: "Double Exponential Moving Average".
* Pane: overlay. MTF: yes.
* Inputs: `Length` (int, **9**, min 1); `Source` (**close**).
* Calculation: `e1 = ta.ema(src, len)`; `e2 = ta.ema(e1, len)`; `dema = 2*e1 - e2`.
* Plots: `DEMA` line `#43A047`.

### 3.37 Ease of Movement `[S]`

* TV title: **Ease of Movement**; short: **EOM**; library study: `Ease Of Movement`.
* Pane: separate; `format=format.volume`. MTF: yes.
* Inputs: `Length` (int, **14**, min 1); `Divisor` (int, **10000**, min 1).
* Calculation: `eom = ta.sma(div * ta.change(hl2) * (high - low) / volume, length)`.
  (Equivalent to the textbook `distance / boxRatio` with boxRatio = `(volume/div)/(high-low)`; note TV's default divisor is 10 000, the Help-Center prose uses 100 000 000 as an example.)
* Plots: `EOM` line `#43A047`; zero hline `#787B86` dashed.

### 3.38 Elder's Force Index `[S]`

* TV title: **Elder Force Index**; short: **EFI**; library study: `Elder's Force Index`.
* Pane: separate; `format=format.volume`. MTF: yes.
* Inputs: `Length` (int, **13**, min 1).
* Calculation: `efi = ta.ema(ta.change(close) * volume, length)`.
* Plots: `EFI` line `#F23645`; hline `Zero` 0 `#787B86` dashed.

### 3.39 Envelope `[S]`

* TV title: **Envelope**; short: **Env**; library study: `Envelopes`.
* Pane: overlay. MTF: yes.
* Inputs: `Length` (int, **20**, min 1); `Percent` (float, **10.0**); `Source` (**close**); `Exponential` (bool, **false**).
* Calculation: `basis = exponential ? ta.ema(src, len) : ta.sma(src, len)`; `k = percent/100`; `upper = basis*(1+k)`; `lower = basis*(1-k)`.
* Plots: `Basis` `#FF6D00`; `Upper` `#2962FF`; `Lower` `#2962FF`; fill `Background` blue @95. (Library: average `#FF6D00`, upper/lower `#2196F3`, bg @95.)

### 3.40 Moving Average Exponential `[S]`

* TV title: **Moving Average Exponential**; short: **EMA**; library study: `Moving Average Exponential`.
* Pane: overlay. MTF: yes.
* Inputs: `Length` (int, **9**, min 1); `Source` (**close**); `Offset` (int, **0**, -500..500); Smoothing group: older build `Method` **SMA** (SMA/EMA/SMMA (RMA)/WMA/VWMA) + `Length` **5**; current build `Type` **None** (None/SMA/SMA + Bollinger Bands/EMA/SMMA (RMA)/WMA/VWMA), `Length` **5**, `BB StdDev` **2.0**.
* Calculation: `out = ta.ema(src, len)`; `smoothingLine = ma(out, smoothingLength, type)`; BB = `smoothingLine ± ta.stdev(out, smoothingLength) * bbMult`.
* Plots: `EMA` line `#2962FF` (`color.blue` in older source), offset applied; `Smoothing Line` `#f37f20` (old) / `EMA-based MA` yellow (new), hidden by default (`display.none` / only when Type != None); BB lines green with green @90 fill.

### 3.41 EMA Cross `[F]` (library) / MA Cross `[S]` / MA with EMA Cross `[S]`

* **EMA Cross** (library study `EMA Cross`): inputs `Short EMA Length` **9**, `Long EMA Length` **26**; plots `Short` (`short:plot`) `#FF6D00`, `Long` (`long:plot`) `#43A047`, `Crosses` cross-style `#2196F3` width 4 at `ta.cross(short, long) ? short : na`.
* **MA Cross** (TV built-in, overlay): inputs `Short MA Length` **9**, `Long MA Length` **21**; `short = ta.sma(close, 9)`, `long = ta.sma(close, 21)`; plots `Short` line `#FF6D00`, `Long` line `#43A047`, `Crosses` `plot.style_cross`, linewidth 4, `#2962FF` at `ta.cross(short,long) ? short : na`. (Library override lists `long:plot` `#FF6D00` / `short:plot` `#43A047` — swapped relative to the Pine build; follow the Pine build for the website look.)
* **MA with EMA Cross** (library study `MA with EMA Cross`, also a TV built-in): inputs `Length` **9** (verify; single length shared by both averages), `Source` close; `ma = ta.sma`, `ema = ta.ema`; plots `MA` `#FF6D00`, `EMA` `#43A047`, `Crosses` cross `#2196F3`/`#2962FF` width 4.
* **MovingAvg Cross** and **MovingAvg2Line Cross** are built-in *strategies* (Help Center): MovingAvg Cross: `Length` 9, `ConfirmBars` 3 — long when close > SMA for ConfirmBars consecutive bars, short when below; MovingAvg2Line Cross: `Fast MA` 9, `Slow MA` 18 — long/short on fast/slow SMA cross. List only.

### 3.42 Fisher Transform `[S]`

* TV title: **Fisher Transform**; short: **Fisher**; library study: `Fisher Transform`.
* Pane: separate; `precision=2`. MTF: yes.
* Inputs: `Length` (int, **9**, min 1).
* Calculation:
```
round_(val) => val > .99 ? .999 : val < -.99 ? -.999 : val
high_ = ta.highest(hl2, len) ; low_ = ta.lowest(hl2, len)
value = 0.0
value := round_(.66 * ((hl2 - low_) / (high_ - low_) - .5) + .67 * nz(value[1]))
fish1 = 0.0
fish1 := .5 * math.log((1 + value) / (1 - value)) + .5 * nz(fish1[1])
fish2 = fish1[1]
```
* Plots: `Fisher` line `#2962FF`; `Trigger` line `#FF6D00`; hlines at **1.5** and **-1.5** (`#E91E63`), **0.75** and **-0.75** (`#F23645`, verify), **0** (`#787B86`). Library: `fisher` `#2196F3`, `trigger` `#FF6D00`, `level:band` -1.5 `#E91E63` dashed (each level its own band).

### 3.43 Gaps `[V]` rules / `[F]` defaults

* TV title: **Gaps**. Overlay (boxes). Not in the library.
* Inputs: `Close Gaps Partially` (bool, **false**); `Max Number of Gaps` (int, verify default e.g. 500 = Pine `max_boxes_count`); `Minimal Deviation (%)` (float, **30**); `Limit Max Gap Trail Length` (bool, **false**); `Max Gap Trail Length (bars)` (int, **300**); colors `Up Gap` green, `Down Gap` red (semi-transparent boxes; use `color.new(#089981, 75)` / `color.new(#F23645, 75)` (verify)).
* Detection: `avgRange = ta.sma(high - low, 14)`; up gap when `low > high[1]` and `(low - high[1]) / avgRange * 100 >= minDeviation`; down gap when `high < low[1]` and `(low[1] - high) / avgRange * 100 >= minDeviation`. A box spans `[high[1], low]` (up) or `[high, low[1]]` (down) starting at the gap bar and extends right every bar.
* Closing: default — a gap closes (box stops extending) as soon as any later bar's range enters the box; with `Close Gaps Partially` on — the box shrinks to the uncovered remainder and continues until fully covered. With `Limit Max Gap Trail Length` on, boxes older than N bars are closed.

### 3.44 Guppy Multiple Moving Average `[F]` (library only)

* Library study: `Guppy Multiple Moving Average`. Overlay.
* Inputs: trader EMA lengths **3, 5, 8, 10, 12, 15**; investor EMA lengths **30, 35, 40, 45, 50, 60**; source close.
* Plots: `Trader EMA 1..6` lines (library color `#2196F3`? — the fetched interface only showed investor EMAs) and `Investor EMA 1..6` lines `#FF0000` with decreasing transparency 15, 12, 9, 6, 3, 0 (verified pattern).

### 3.45 Historical Volatility `[S]`

* TV title: **Historical Volatility**; short: **HV**; library study: `Historical Volatility`.
* Pane: separate; `precision=2`. MTF: yes.
* Inputs: `Length` (int, **10**, min 1).
* Calculation:
```
annual = 365
per = timeframe.isintraday or timeframe.isdaily and timeframe.multiplier == 1 ? 1 : 7
hv = 100 * ta.stdev(math.log(close / close[1]), length) * math.sqrt(annual / per)
```
(Operator precedence: `isintraday or (isdaily and multiplier == 1)`. So intraday and 1D use `sqrt(365)`; 2D+, weekly, monthly use `sqrt(365/7)`.)
* Plots: `HV` line `#2962FF`.

### 3.46 Hull Moving Average `[S]`

* TV title: **Hull Moving Average**; short: **HMA**; library study: `Hull Moving Average`.
* Pane: overlay. MTF: yes.
* Inputs: `Length` (int, **9**, min 1); `Source` (**close**).
* Calculation (built-in script): `hma = ta.wma(2*ta.wma(src, length/2) - ta.wma(src, length), math.round(math.sqrt(length)))` (`length/2` integer-truncated; older builds used `math.floor(sqrt)` — for 9 both give 3, for 12: round(3.46)=3, floor=3; for 14: round=4, floor=3 -> verify against TV for lengths where they differ).
* Plots: `HMA` line `#2962FF`.

### 3.47 Ichimoku Cloud `[S]`

* TV title: **Ichimoku Cloud**; short: **Ichimoku**; library study: `Ichimoku Cloud`.
* Pane: overlay.
* Inputs: `Conversion Line Length` (int, **9**); `Base Line Length` (int, **26**); `Leading Span B Length` (int, **52**); `Lagging Span` (int, **26**) — this single input is the displacement used for both leading spans (forward) and the lagging span (backward).
* Calculation:
```
donchian(len) => math.avg(ta.lowest(len), ta.highest(len))
conversionLine = donchian(9) ; baseLine = donchian(26)
leadLine1 = math.avg(conversionLine, baseLine) ; leadLine2 = donchian(52)
```
* Plots: `Conversion Line` `#2962FF`; `Base Line` `#B71C1C`; `Lagging Span` = `close` plotted with `offset = -displacement + 1` `#43A047`; `Leading Span A` = leadLine1 with `offset = displacement - 1` `#A5D6A7`; `Leading Span B` = leadLine2 with `offset = displacement - 1` `#EF9A9A`; a hidden helper plot `Leading Span Background` (`display.none`); fill between span A and B: `leadLine1 > leadLine2 ? color.rgb(67,160,71,90) : color.rgb(244,67,54,90)` (green/red @90). Note the fill color is evaluated on the *calculation* bar and drawn at the offset position.
* Library defaults: conversion `#2196F3`, base `#801922`, lagging `#43A047`, lead A `#A5D6A7`, lead B `#FAA1A4`, `plots background` `#000080` @90.
* Offsets: the visible cloud extends 25 bars into the future (`displacement-1`), the lagging span is drawn 25 bars back.

### 3.48 Kaufman's Adaptive Moving Average / Moving Average Adaptive `[V]` formula / `[F]` defaults

* TV title: **Kaufman's Adaptive Moving Average**; short: **KAMA** (Help Center 2025). Library study: `Moving Average Adaptive` (plot `plot 1` `#AB47BC`).
* Pane: overlay. MTF: yes.
* Inputs: `Source` (close); `ER Length` (int, **10**); `Fast Length` (int, **2**); `Slow Length` (int, **30**) (defaults are Kaufman's standards; verify vs TV; the library version uses a single `Length` 10).
* Calculation:
```
change     = math.abs(src - src[erLen])
volatility = math.sum(math.abs(src - src[1]), erLen)
er   = volatility != 0 ? change / volatility : 0
fastSC = 2/(fastLen+1) ; slowSC = 2/(slowLen+1)
sc   = math.pow(er * (fastSC - slowSC) + slowSC, 2)
kama = 0.0 ; kama := sc * src + (1 - sc) * nz(kama[1], src)     // seed = first source value
```
* Plots: `KAMA` line `#2962FF` (library `#AB47BC`).

### 3.49 Keltner Channels `[S]`

* TV title: **Keltner Channels**; short: **KC**; library study: `Keltner Channels`.
* Pane: overlay. MTF: yes.
* Inputs: `Length` (int, **20**, min 1); `Multiplier` (float, **2.0**); `Source` (**close**); `Use Exponential MA` (bool, **true**); `Bands Style` (select, **Average True Range** | True Range | Range); `ATR Length` (int, **10**).
* Calculation:
```
ma = exp ? ta.ema(src, length) : ta.sma(src, length)
rangema = BandsStyle == "True Range" ? ta.tr(true)
        : BandsStyle == "Average True Range" ? ta.atr(atrlength)
        : ta.rma(high - low, length)               // "Range"
upper = ma + rangema * mult ; lower = ma - rangema * mult
```
* Plots: `Upper` `#2962FF`; `Basis` `#2962FF`; `Lower` `#2962FF`; fill `Background` blue @95. (Library: all three `#2196F3`, bg @95.)
* Note: Help Center text lists ATR Length 14 in one place; the source default is 10.

### 3.50 Klinger Oscillator `[S]`

* TV title: **Klinger Oscillator**; library study: `Klinger Oscillator`.
* Pane: separate. MTF: yes.
* Inputs: none (fixed 34 / 55 / 13).
* Calculation (TradingView's simplified version — NOT the textbook volume-force formula):
```
sv  = ta.change(hlc3) >= 0 ? volume : -volume
kvo = ta.ema(sv, 34) - ta.ema(sv, 55)
sig = ta.ema(kvo, 13)
```
* Plots: `Klinger Oscillator` line `#2962FF`; `Signal` line `#43A047`. (Library: `plot` `#2196F3`, `signal` `#43A047`.)
* Notes: Help-Center prose describes Klinger's full Volume Force (`VF = V * |2*(dm/cm) - 1| * trend * 100`); the shipped built-in uses signed volume. Implement the shipped version for parity.

### 3.51 Know Sure Thing `[S]`

* TV title: **Know Sure Thing**; short: **KST**; library study: `Know Sure Thing`.
* Pane: separate; `precision=4`. MTF: yes.
* Inputs: `ROC Length #1..#4` **10, 15, 20, 30**; `SMA Length #1..#4` **10, 10, 10, 15**; `Signal Line Length` **9**.
* Calculation: `smaroc(r, s) = ta.sma(ta.roc(close, r), s)`; `kst = smaroc(10,10) + 2*smaroc(15,10) + 3*smaroc(20,10) + 4*smaroc(30,15)`; `sig = ta.sma(kst, 9)`.
* Plots: `KST` line `#089981`; `Signal` line `#F23645`; hline `Zero` 0 `#787B86` dashed.

### 3.52 Least Squares Moving Average `[V]`

* TV title: **Least Squares Moving Average**; short: **LSMA**; library study: `Least Squares Moving Average`.
* Pane: overlay. MTF: yes (`timeframe_gaps=true`).
* Inputs: `Length` (int, **25**); `Offset` (int, **0**); `Source` (**close**).
* Calculation: `lsma = ta.linreg(src, length, offset)`.
* Plots: `LSMA` line (default color `#2962FF` / library `#2196F3`).
* Verified source (Help Center):
```
//@version=5
indicator(title = "Least Squares Moving Average", shorttitle="LSMA", overlay=true, timeframe="", timeframe_gaps=true)
length = input(title="Length", defval=25)
offset = input(title="Offset", defval=0)
src = input(close, title="Source")
lsma = ta.linreg(src, length, offset)
plot(lsma)
```

### 3.53 Linear Regression Channel `[S]`

* TV title: **Linear Regression Channel**; short: **LinReg**. Help Center article "Linear Regression". Library has the simpler `Linear Regression Curve` (input `Length` 9?, source close, plot `#2196F3` — the curve is `ta.linreg(src, len, 0)` on every bar) and `Linear Regression Slope` (`Length` 14?, plot `#FF5252`; slope = `(linreg(src,len,0) - linreg(src,len,1))`).
* Pane: overlay (drawn with `line`/`linefill`/`label` objects on the **last** bar only).
* Inputs: `Length` (int, **100**, 1..5000); `Source` (**close**); Channel Settings: `Upper Deviation` (bool **true** + float **2.0**), `Lower Deviation` (bool **true** + float **2.0**); Display: `Show Pearson's R` (bool, **true**), `Extend Lines Left` (bool, **false**), `Extend Lines Right` (bool, **true**); Colors: upper channel `color.new(color.blue, 85)`, lower channel `color.new(color.red, 85)` (used as fills; the median line is drawn with the lower color at 0 transparency? verify).
* Calculation (on the last bar, over the last `length` bars):
```
calcSlope(source, length):
    sumX, sumY, sumXSqr, sumXY over i = 0..length-1 with per = i + 1, val = source[i]
    slope = (length*sumXY - sumX*sumY) / (length*sumXSqr - sumX*sumX)
    average = sumY / length
    intercept = average - slope*sumX/length + slope
startPrice = intercept + slope*(length - 1)    // value at the oldest bar of the window
endPrice   = intercept                         // value at the current bar
calcDev(): iterate j = 0..length-1 from oldest to newest with val = intercept + slope*(steps) ...
    upDev  = max over window of (high[j] - val)        // max upward excursion
    dnDev  = max over window of (val - low[j])         // max downward excursion
    stdDev = sqrt( sum (source[j] - val)^2 / (length - 1) )   // residual std dev (÷ periods = length-1)
    pearsonR = dsxy / sqrt(dsxx * dsyy)                // r between source and the fitted line
upper channel = base line + (useUpperDev ? upperMult*stdDev : upDev)
lower channel = base line - (useLowerDev ? lowerMult*stdDev : dnDev)
```
* Drawing: three `line` objects from `bar_index - length + 1` to `bar_index` (extend right/left per inputs), `linefill` between base and upper (upper color) and base and lower (lower color), and a label at the right end showing `Pearson's R: x.xx` when enabled.
* Notes: when "Upper Deviation" is unchecked the upper line hugs the maximum high excursion instead of a σ multiple.

### 3.54 MA Cross / MA with EMA Cross — see 3.41.

### 3.55 Moving Average Ribbon `[S]`

* TV title: **Moving Average Ribbon**; short: **MA Ribbon**. Overlay. MTF: yes.
* Inputs (4 rows, each inline): `MA №1..№4` enable (bool, **true**), `Type` (**SMA** | EMA | SMMA (RMA) | WMA | VWMA), `Source` (**close**), `Length` **20 / 50 / 100 / 200**.
* Plots: `MA №1` `#f6c309`, `MA №2` `#fb9800`, `MA №3` `#fb6500`, `MA №4` `#f70000`, width 1 (verify hex; these are the values in the 2023 source).
* Legend: `MA Ribbon SMA close 20 SMA close 50 ...`.

### 3.56 Majority Rule `[F]` (library only)

* Library study `Majority Rule`: input `Length` **20** (verify); value = 100 * (count of up bars (close > close[1]) in window) / length, or the sign majority; plot `majority rule` line `#FF5252`. (Rarely used; implement as % of rising bars.)

### 3.57 Mass Index `[S]`

* TV title: **Mass Index**; library study: `Mass Index`.
* Pane: separate; `precision=4`. MTF: yes.
* Inputs: `Length` (int, **10**, min 1). (Textbook default is 25; TradingView ships 10.)
* Calculation: `span = high - low`; `mi = math.sum(ta.ema(span, 9) / ta.ema(ta.ema(span, 9), 9), length)`.
* Plots: `Mass Index` line `#2962FF`.

### 3.58 McGinley Dynamic `[S]`

* TV title: **McGinley Dynamic**; library study: `McGinley Dynamic`.
* Pane: overlay. MTF: yes.
* Inputs: `Length` (int, **14**, min 1); `Source` (close).
* Calculation: `mg = 0.0; mg := na(mg[1]) ? ta.ema(src, length) : mg[1] + (src - mg[1]) / (length * math.pow(src / mg[1], 4))` (seeded with the EMA; constant k = 1, not 0.6).
* Plots: `McGinley Dynamic` line `#2962FF`.

### 3.59 Median `[V]` behaviour / `[F]` defaults

* TV title: **Median**. Overlay.
* Inputs: `Median Source` (source, **hl2**); `Median Length` (int, **3**); `ATR Length` (int, **14**); `ATR Multiplier` (float, **2.0**) (verify defaults).
* Calculation: `median = ta.percentile_nearest_rank(src, medLen, 50)`; `ema = ta.ema(src, medLen)` (verify: EMA of the median vs of the source — Help Center says "compared to its EMA for the same length"); `atr = ta.atr(atrLen)`; `upper = median + mult*atr`; `lower = median - mult*atr`.
* Plots: `Median` line (blue `#2962FF`); `EMA` line; cloud fill between median and EMA — green (`#089981` @ ~80) when median > EMA, violet (`#7E57C2`/`#9C27B0` @ ~80) when EMA > median; `Upper`/`Lower` ATR bands (verify colors).

### 3.60 Median Price / Typical Price / Average Price `[F]` (library only)

* `Median Price` = hl2, plot `#FF6D00`; `Typical Price` = hlc3, plot `#FF6D00`; `Average Price` = ohlc4, plot `#2196F3`. All overlay, no inputs.

### 3.61 Momentum `[S]`

* TV title: **Momentum**; short: **Mom**; library study: `Momentum`.
* Pane: separate; `precision=2`. MTF: yes.
* Inputs: `Length` (int, **10**, min 1); `Source` (**close**).
* Calculation: `mom = src - src[length]`.
* Plots: `MOM` line `#2962FF`; hline `Zero` 0 `#787B86` dashed (library: `mom` `#2196F3`, `zero` band).

### 3.62 Money Flow Index `[S]`

* TV title: **Money Flow Index**; short: **MFI**; library study: `Money Flow Index`.
* Pane: separate, 0..100; `precision=2`. MTF: yes.
* Inputs: `Length` (int, **14**, 1..2000); Smoothing group (Type **None**, Length 14, BB StdDev 2) in current builds.
* Calculation: `mf = ta.mfi(hlc3, length)` (source fixed to hlc3).
* Plots: `MF` line `#7E57C2`; hlines `Overbought` **80**, `Oversold` **20** (`#787B86`); fill `color.rgb(126,87,194,90)`. Library: plot `#7E57C2`, limits 80/20, bg `#7E57C2` @90.

### 3.63 Moving Average (Simple) `[S]`

* TV title: **Moving Average Simple** (legend `SMA`); Help Center "Simple Moving Average"; library study: `Moving Average`.
* Pane: overlay. MTF: yes.
* Inputs: `Length` (int, **9**, min 1); `Source` (**close**); `Offset` (int, **0**, -500..500); Smoothing group (`Method`/`Type` SMA→None, `Length` **5**, `BB StdDev` 2 in current build).
* Calculation: `out = ta.sma(src, len)`.
* Plots: `MA` line `#2962FF` (`color.blue`) with `offset`; `Smoothing Line` `#f37f20` hidden by default. Library: `plot` `#2196F3`, `smoothed ma` display 0.
* Library inputs: `length` 9, `source` close, `offset` 0, `smoothingLine` (SMA/EMA/WMA), `smoothingLength` 9.

### 3.64 Moving Average Channel / Double / Triple / Multiple / Hamming `[F]` (library only; defaults from the override interfaces)

* **Moving Average Channel**: inputs `Upper Length` **20**, `Lower Length` **20**, `Upper Source` high, `Lower Source` low, `Offset` 0 (verify); `upper = sma(high, len)`, `lower = sma(low, len)`; plots `upper` `#2196F3`, `lower` `#FF6D00`, `plots background` `#2196F3` @90.
* **Moving Average Double**: two SMAs, lengths **20** and **50** (verify), source close; plots `plot 1` `#FF6D00`, `plot 2` `#2196F3`.
* **Moving Average Triple**: three SMAs, lengths **20, 50, 100** (verify); plots `plot 1` `#FF6D00`, `plot 2` `#2196F3`, `plot 3` `#26C6DA`.
* **Moving Average Multiple**: six SMAs, lengths **5, 10, 20, 30, 50, 100** (verify); plots `plot 1..6` `#9C27B0`, `#FF6D00`, `#43A047`, `#26C6DA`, `#F50057`, `#2196F3`.
* **Moving Average Hamming**: input `Length` **20** (verify), source close; Hamming-window weighted average: `w_i = 0.54 - 0.46 * cos(2*pi*i/(length-1))`, `hma = sum(src[length-1-i]*w_i)/sum(w_i)`; plot `plot 1` `#4CAF50`.
* **Moving Average Adaptive**: see 3.48 (`plot 1` `#AB47BC`).

### 3.65 Moving Average Convergence Divergence `[S]`

* TV title: **Moving Average Convergence Divergence**; short: **MACD**; library study: `MACD`.
* Pane: separate, zero-centred. MTF: yes.
* Inputs: `Fast Length` (int, **12**); `Slow Length` (int, **26**); `Source` (**close**); `Signal Smoothing` (int, **9**, 1..50); `Oscillator MA Type` (**EMA** | SMA); `Signal Line MA Type` (**EMA** | SMA).
* Calculation:
```
fast_ma = oscType == "SMA" ? ta.sma(src, fast) : ta.ema(src, fast)
slow_ma = oscType == "SMA" ? ta.sma(src, slow) : ta.ema(src, slow)
macd   = fast_ma - slow_ma
signal = sigType == "SMA" ? ta.sma(macd, siglen) : ta.ema(macd, siglen)
hist   = macd - signal
```
* Plots (order matters for z-order): hline `Zero Line` 0 `color.new(#787B86, 50)`; `Histogram` **columns** with color `hist >= 0 ? (hist[1] < hist ? #26A69A : #B2DFDB) : (hist[1] < hist ? #FFCDD2 : #FF5252)`; `MACD` line `#2962FF`; `Signal` line `#FF6D00`.
* Library: `histogram` columns `#FF5252` (with a 4-color palette), `macd` `#2196F3`, `signal` `#FF6D00`. Library `createStudy('MACD', ..., {in_0: 12, in_1: 26, in_3: 'close', in_2: 9})`.
* Legend: `MACD 12 26 close 9 EMA EMA` then hist, macd, signal values.
* Alerts: "Rising to falling" (`hist[1] >= 0 and hist < 0`), "Falling to rising".

### 3.66 Multi-Time Period Charts `[V]`

* TV title: **Multi-Time Period Charts**. Overlay boxes. Inputs: `Auto-timeframe` (bool), `Timeframe` (when manual), `Calculation` (**High/Low Range** | Open/Close Range | OHLC | True Range), `Display Heikin Ashi values` (bool), `Use daily-based values` (bool), border/fill colors for up (teal `#089981`) and down (red `#F23645`) bars. Draws one box per HTF bar spanning its chart bars: High/Low -> [low, high]; Open/Close -> [min(o,c), max(o,c)]; OHLC -> two boxes; True Range -> [min(low, prevClose), max(high, prevClose)]. Up when HTF close >= open. Max ~500 boxes.

### 3.67 Moon Phases `[V]`

* TV title: **Moon Phases**. Overlay: circle markers at new moon (dark circle) and full moon (bright circle); bars between phases colored (waxing vs waning). Uses the synodic month (29.530588853 days) from a reference new-moon epoch (2000-01-06 18:14 UTC) to compute phase per bar. Inputs: colors only (verify).

### 3.68 Net Volume `[S]`

* TV title: **Net Volume**; library study: `Net Volume`.
* Pane: separate; `format=format.volume`. MTF: yes.
* Inputs: none.
* Calculation: `nv = math.sign(ta.change(close)) * volume` (equivalently: close > close[1] -> +volume, < -> -volume, = -> 0).
* Plots: `Net Volume` — Help Center describes bars (columns) per period; library default is `line` `#2196F3`. Pine build: line `#2962FF` (verify style).

### 3.69 Negative Volume Index / Positive Volume Index `[V]`

* TV titles: **Negative Volume Index** (short **NVI**), **Positive Volume Index** (short **PVI**) (2025 additions). Separate pane. MTF: yes.
* Inputs: `EMA Length` (int, **255**); Calculation group.
* Calculation: start value **1000**; NVI: `nvi := volume < volume[1] ? nvi[1] + (close - close[1]) / close[1] * nvi[1] : nvi[1]`; PVI: same with `volume > volume[1]`. Signal: `ta.ema(nvi, 255)`.
* Plots: index line (blue `#2962FF`) and EMA line (orange `#FF6D00`) (colors verify).

### 3.70 On Balance Volume `[S]`

* TV title: **On Balance Volume**; short: **OBV**; library study: `On Balance Volume`.
* Pane: separate; `format=format.volume`. MTF: yes.
* Inputs: Smoothing group only (`Type` **None** | SMA | SMA + Bollinger Bands | EMA | SMMA (RMA) | WMA | VWMA; `Length` **14**; `BB StdDev` **2.0**).
* Calculation: `obv = ta.cum(math.sign(ta.change(close)) * volume)` (= `ta.obv`).
* Plots: `OnBalanceVolume` line `#2962FF`; `OBV-based MA` yellow (when enabled); BB lines green with fill @90.

### 3.71 Open Interest `[D]`

* TV title: **Open Interest**. Separate pane, columns colored by change (green when OI rises vs previous bar, red when it falls; verify). Data: `request.security(<ticker>_OI ...)` — available for futures (daily) and crypto perpetuals (intraday). No inputs. Not implementable without an OI feed.

### 3.72 Parabolic SAR `[S]`

* TV title: **Parabolic SAR**; short: **SAR**; library study: `Parabolic SAR`.
* Pane: overlay. MTF: yes.
* Inputs: `Start` (float, **0.02**); `Increment` (float, **0.02**); `Max Value` (float, **0.2**).
* Calculation: `ta.sar(start, increment, maximum)` (section 2.3).
* Plots: `ParabolicSAR` **cross** style `#2962FF` (library `plot` plottype `cross` `#2196F3`). Help Center: "dotted line with cross markers".

### 3.73 Performance `[V]`

* TV title: **Performance**. Table in a separate pane (heat-map). Inputs: `Include chart symbol` (**true**), `Symbol list` (comma-separated), `Timeframe list` (e.g. `1W, 1M, 3M, 6M, YTD, 1Y, 5Y`; periods D/W/M/Y/YTD with multipliers), `Positive color`, `Negative color`, `Color intensity cutoff (%)`, `Table position` (Center/Middle), `Table width (%)` **100**, `Table height (%)` **95**. Cell = `100 * (current - past) / past` where `past` = close of the daily bar at (current daily bar open time minus the period; YTD = Jan 1 00:00 of the current year), taking the most recent bar at or before that time. Cell color opacity scales with |value| up to the cutoff.

### 3.74 Pivot Points High Low `[S]`

* TV title: **Pivot Points High Low**; short: **Pivots HL**. Overlay labels. Not in the library.
* Inputs: `Pivot High` length (int, **10**) and `Pivot Low` length (int, **10**) — bars on each side (left = right = length); newer build: `Pivot High` (bool **true**) + `Length` 10, `Pivot Low` (bool **true**) + `Length` 10.
* Calculation: `ph = ta.pivothigh(high, lenH, lenH)`, `pl = ta.pivotlow(low, lenL, lenL)`; on confirmation draw a label at the pivot bar (`offset=-len`) with the pivot price as text.
* Plots: `plotshape`/`label` — pivot high label above the bar (green-ish `#089981`? older `color.red` for highs), pivot low label below (red `#F23645`? older `color.green` for lows); text = price formatted with symbol precision (verify colors: older Pine used `color.red` for highs and `color.green` for lows; newer uses `#F23645`/`#089981` bordered labels, white text).

### 3.75 Pivot Points Standard `[V]` formulas & auto rules / `[S]` inputs

* TV title: **Pivot Points Standard**; short: **Pivots**; library study: `Pivot Points Standard`.
* Pane: overlay (lines + labels).
* Inputs: `Type` (select, **Traditional** | Fibonacci | Woodie | Classic | DM | Camarilla); `Pivots Timeframe` (select, **Auto** | Daily | Weekly | Monthly | Quarterly | Yearly | Biyearly | Triyearly | Quinquennially | Decennially); `Number of Pivots Back` (int, **15**); `Use Daily-based Values` (bool, **true**); `Show Labels` (bool, **true**); `Show Prices` (bool, **true**); `Labels Position` (**Left** | Right); `Line Width` (int, **1**); per level `P, S1..S5, R1..R5` (bool + color).
* Auto timeframe: chart ≤ 15 min -> **1D**; intraday > 15 min -> **1W**; daily -> **1M**; weekly/monthly -> **12M** (weekly and monthly charts both use yearly pivots).
* `Use Daily-based Values` on: HTF OHLC is requested via `request.security` on the pivot timeframe (built from daily bars, so intraday and daily charts agree); off: HTF OHLC is accumulated from chart bars.
* Formulas (prev = previous pivot period; `curr open` = current period open; all verified):
```
Traditional: P = (H+L+C)/3
  R1 = 2P - L ; S1 = 2P - H ; R2 = P + (H-L) ; S2 = P - (H-L)
  R3 = 2P + (H - 2L) ; S3 = 2P - (2H - L)
  R4 = 3P + (H - 3L) ; S4 = 3P - (3H - L)
  R5 = 4P + (H - 4L) ; S5 = 4P - (4H - L)
Fibonacci: P = (H+L+C)/3 ; R1/S1 = P ± 0.382*(H-L) ; R2/S2 = P ± 0.618*(H-L) ; R3/S3 = P ± (H-L)
Woodie: P = (H + L + 2*currOpen)/4
  R1 = 2P - L ; S1 = 2P - H ; R2 = P + (H-L) ; S2 = P - (H-L)
  R3 = H + 2*(P - L) ; S3 = L - 2*(H - P) ; R4 = R3 + (H-L) ; S4 = S3 - (H-L)
Classic: P = (H+L+C)/3 ; R1 = 2P - L ; S1 = 2P - H ; R2/S2 = P ± (H-L) ; R3/S3 = P ± 2(H-L) ; R4/S4 = P ± 3(H-L)
DM (Demark): X = prevOpen == prevClose ? H + L + 2C : prevClose > prevOpen ? 2H + L + C : 2L + H + C
  P = X/4 ; R1 = X/2 - L ; S1 = X/2 - H
Camarilla: P = (H+L+C)/3
  R1/S1 = C ± 1.1*(H-L)/12 ; R2/S2 = C ± 1.1*(H-L)/6 ; R3/S3 = C ± 1.1*(H-L)/4 ; R4/S4 = C ± 1.1*(H-L)/2
  R5 = (H/L)*C ; S5 = C - (R5 - C)
```
Only Traditional and Camarilla draw S5/R5; Fibonacci draws up to 3; Woodie/Classic up to 4; DM only P/R1/S1.
* Drawing: for each of the last N pivot periods draw horizontal `line`s across the period (from period start to period end; the current period's lines extend to its projected end), plus labels `P`, `R1`… with price when enabled. Max 500 lines. Default colors (verify): `P` `#FB8C00` (orange), `S1..S5` `#F23645`-family reds? and `R1..R5` `#089981`-family greens — the source uses per-level `input.color` with these defaults: P `#FB8C00`, S1/R1 `#F23645`/`#089981`, S2/R2 `#F23645`/`#089981`, S3/R3 `#F23645`/`#089981`, S4/R4 `#F23645`/`#089981`, S5/R5 `#F23645`/`#089981` (hex verify; older source used `color.red` for S and `color.green` for R).
* Library override keys use the same names in lowercase (`pivot points standard.p.color` etc.; the interface is index-typed).

### 3.76 Price Channel `[F]` (library) 

* Library study `Price Channel`: inputs `Length` **20**, `Offset` 0 (verify); `highprice line = highest(high, len)` `#F50057`, `lowprice line = lowest(low, len)` `#F50057`, `centerprice line = avg` `#2196F3`. Equivalent to Donchian without fill.

### 3.77 Price Oscillator (legacy PPO) `[S]` and Percentage Price Oscillator `[V]`

* **Price Oscillator** — TV title **Price Oscillator**, short **PPO**, library study `Price Oscillator`. Separate pane. Inputs: `Short Length` **10**, `Long Length` **21**, `Source` close, `Exponential` (bool, **false**). `short = exponential ? ema : sma`, `ppo = (short - long) / long * 100`. Plot `PPO` line `#089981` (library `#089981`). Zero hline.
* **Percentage Price Oscillator** (newer built-in, Help Center): inputs `Source` close, `Fast Length` **12**, `Slow Length` **26**, `Signal Length` **9**, `Oscillator MA Type` (**EMA** | SMA), `Signal MA Type` (**EMA** | SMA), Calculation group. `ppo = (fastMA - slowMA)/slowMA*100`, `signal = ma(ppo, 9)`, `hist = ppo - signal`. Plots: histogram columns with the MACD 4-color scheme, `PPO` line `#2962FF`, `Signal` line `#FF6D00`, zero line (verify colors — modelled on the MACD built-in).

### 3.78 Percentage Volume Oscillator `[V]`

* TV title: **Percentage Volume Oscillator**; short: **PVO**. Separate pane. Inputs: `Fast Length` **12**, `Slow Length` **26**, `Signal Length` **9** (verify; StockCharts defaults), `Oscillator MA Type` **EMA**|SMA, `Signal MA Type` **EMA**|SMA, Calculation group. `pvo = (fastMA(volume) - slowMA(volume)) / slowMA(volume) * 100`; `signal = ma(pvo)`; `hist = pvo - signal`. Plots as PPO (histogram 4-color, PVO line, signal line, zero line).

### 3.79 Price Volume Trend `[S]`

* TV title: **Price Volume Trend**; short: **PVT**; library study: `Price Volume Trend`.
* Pane: separate; `format=format.volume`. MTF: yes. Inputs: none (Smoothing group in newer builds, verify).
* Calculation: `ta.pvt` = `cum(change(close)/close[1] * volume)`.
* Plots: `PVT` line `#2962FF` (library `pvt` `#2196F3`).

### 3.80 Price Momentum Oscillator `[V]`

* TV title: **Price Momentum Oscillator**; short: **PMO** (2025). Separate pane. Inputs: `Source` close, `Length 1` **35**, `Length 2` **20**, `Signal Length` **10** (Swenlin/DecisionPoint standards; Help Center gives no defaults — verify), Calculation group.
* Calculation (custom-alpha EMA `2/length`, not `2/(length+1)`):
```
roc1 = 100 * ta.change(src) / src[1]                    // one-bar ROC in %
customEma(s, len) => e = 0.0 ; e := nz(e[1]) + (2/len) * (s - nz(e[1]))
pmo = customEma(10 * customEma(roc1, length1), length2)
signal = ta.ema(pmo, signalLength)
```
* Plots: `PMO` line, `Signal` line, zero hline.

### 3.81 Pring's Special K `[V]`

* TV title: **Pring's Special K**; short: **Special K** (2025). Separate pane. Needs ≥ 725 bars.
* Inputs: `Source` close, `Signal Length 1` **100**, `Signal Length 2` **100**, Calculation group.
* Calculation: `sK = sma(roc(10),10)*1 + sma(roc(15),10)*2 + sma(roc(20),10)*3 + sma(roc(30),15)*4 + sma(roc(40),50)*1 + sma(roc(65),65)*2 + sma(roc(75),75)*3 + sma(roc(100),100)*4 + sma(roc(195),130)*1 + sma(roc(265),130)*2 + sma(roc(390),130)*3 + sma(roc(530),195)*4`; `signal = sma(sma(sK, sig1), sig2)`.
* Plots: `Special K` line, `Signal` line, zero hline.

### 3.82 Rank Correlation Index `[V]` calc / `[F]` defaults, RCI Ribbon `[V]`

* TV titles: **Rank Correlation Index** (short **RCI**) and **RCI Ribbon**. Separate pane, -100..100. MTF: yes.
* RCI inputs: `Source` (**close**); `RCI Length` (int, **9**, verify); Smoothing group `Type` **None**, `Length` (14), `BB StdDev` (2). RCI Ribbon inputs: `Source` close, `Short RCI Length` **9**, `Middle RCI Length` **26**, `Long RCI Length` **52** (verify).
* Calculation: Spearman rank correlation between price and bar order over `length` bars, ×100: rank prices ascending (0..N-1), assign average ranks to ties; time rank = bar position; `rci = 100 * (1 - 6 * sum(d_i^2) / (N*(N^2-1)))` with `d_i = priceRank_i - timeRank_i` (tie-adjusted form uses the Pearson correlation of the two rank vectors, as the Help Center states "compute correlation coefficient between price ranks and bar indices").
* Plots: RCI `rci` line blue `#2962FF`; MA yellow; BB green envelope; hlines **+80**, **0**, **-80** (`#787B86`). Ribbon: short blue `#2962FF`, middle red `#F23645`, long green `#089981`; hlines ±80, 0. Library: `rci` `#2196F3`, `zero line` band.

### 3.83 Rate Of Change `[V]`

* TV title: **Rate Of Change**; short: **ROC**; library study: `Rate Of Change`.
* Pane: separate; `precision=2`. MTF: yes.
* Inputs: `Length` (int, **9**, min 1); `Source` (**close**).
* Calculation: `roc = 100 * (src - src[length]) / src[length]`.
* Plots: `ROC` line `#2962FF`; hline `Zero Line` 0 `#787B86` (library `roc` `#2196F3`, `zero line` dashed).

### 3.84 Ratio / Spread / Compare / Overlay `[F]` (library pseudo-studies)

* `Ratio` and `Spread`: input `Symbol`; `plot = close / other` or `close - other`; plot `#800080` width 2 @35 transparency, baseline hidden, positive/negative fills. `Compare`: overlay of another symbol scaled in % (`plot` `#9C27B0` width 2). `Overlay`: another symbol's series drawn with a chart style (default Line = 2), `allowExtendTimeScale` false, `showPriceLine` false.

### 3.85 Relative Strength Index `[S]`

* TV title: **Relative Strength Index**; short: **RSI**; library study: `Relative Strength Index`.
* Pane: separate, 0..100 (auto-fit incl. 30/70); `format=format.price, precision=2`. MTF: yes.
* Inputs — group "RSI Settings": `RSI Length` (int, **14**, min 1); `Source` (**close**); `Calculate Divergence` (bool, **false**, data-window). Group "Smoothing": `Type` (**None** | SMA | SMA + Bollinger Bands | EMA | SMMA (RMA) | WMA | VWMA); `Length` (int, **14**); `BB StdDev` (float, **2.0**, 0.001..50, step 0.5). Group "Calculation": Timeframe, Wait for timeframe closes.
* Calculation:
```
change = ta.change(src)
up   = ta.rma(math.max(change, 0), len)
down = ta.rma(-math.min(change, 0), len)
rsi  = down == 0 ? 100 : up == 0 ? 0 : 100 - (100 / (1 + up / down))
smoothingMA    = enableMA ? ma(rsi, maLen, type) : na
smoothingStDev = isBB ? ta.stdev(rsi, maLen) * bbMult : na
```
* Plots: `RSI` line `#7E57C2`; hlines `RSI Upper Band` **70** (`#787B86`), `RSI Middle Band` 50 (`color.new(#787B86, 50)`), `RSI Lower Band` **30** (`#787B86`); fill `RSI Background Fill` between 70/30 `color.rgb(126,87,194,90)`; gradient fills `Overbought Gradient Fill` (between RSI and an invisible 50 line, from 70 to 100, `color.new(color.green, 0)` at top to transparent) and `Oversold Gradient Fill` (30 down to 0, red); `RSI-based MA` `color.yellow` (only when Type != None); `Upper/Lower Bollinger Band` `color.green` with `Bollinger Bands Background Fill` green @90 (only with "SMA + Bollinger Bands").
* Divergence (when enabled): fixed `lookbackRight = 5`, `lookbackLeft = 5`, `rangeUpper = 60`, `rangeLower = 5`; regular bullish = price lower low & RSI higher low at RSI pivot lows within range; regular bearish = price higher high & RSI lower high. Plots `Regular Bullish` (line width 2, green, drawn at `offset=-5`) + label `" Bull "` (`shape.labelup`, green bg, white text); `Regular Bearish` red + `" Bear "` (`shape.labeldown`). Alerts "Regular Bullish/Bearish Divergence".
* Library defaults: `plot` `#7E57C2`; `upperlimit` 70, `middlelimit` 50, `lowerlimit` 30 (`#787B86`, linestyle 2 = dashed), `hlines background` `#7E57C2` @90, `smoothed ma` hidden.
* Legend: `RSI 14 close` -> value (purple).

### 3.86 RSI divergence indicator — Help-Center article describing 3.34 / the RSI option; no separate script.

### 3.87 Relative Vigor Index `[S]`

* TV title: **Relative Vigor Index**; short: **RVGI**; library study: `Relative Vigor Index`.
* Pane: separate; `precision=4`. MTF: yes.
* Inputs: `Length` (int, **10**, min 1).
* Calculation: `rvi = math.sum(ta.swma(close - open), len) / math.sum(ta.swma(high - low), len)`; `sig = ta.swma(rvi)`.
* Plots: `RVGI` line `#089981`; `Signal` line `#F23645`.

### 3.88 Relative Volatility Index `[S]`

* TV title: **Relative Volatility Index**; short: **RVI**; library study: `Relative Volatility Index`.
* Pane: separate, 0..100; `precision=2`. MTF: yes.
* Inputs: `Length` (int, **10**, min 1); (Help Center also lists `Offset` 0 and Smoothing/Calculation groups in the newest build).
* Calculation:
```
src = close ; len = 14                     // EMA length fixed at 14
stddev = ta.stdev(src, length)
upper = ta.ema(ta.change(src) <= 0 ? 0 : stddev, len)
lower = ta.ema(ta.change(src) >  0 ? 0 : stddev, len)
rvi = upper / (upper + lower) * 100
```
* Plots: `RVI` line `#7E57C2`; hlines `Upper Band` **80**, `Middle Band` 50 (@50), `Lower Band` **20** (`#787B86`); fill `color.rgb(126,87,194,90)`.

### 3.89 Relative Volume at Time `[V]` semantics / `[F]` style

* TV title: **Relative Volume at Time**; short: **RVOL**. Separate pane; `format=format.volume`? (ratio, so price format precision 2).
* Inputs: `Anchor Timeframe` (timeframe, **1D**); `Length` (int, **5** periods); `Calculation Mode` (**Cumulative** | Regular); `Adjust for Current Session`/`Adjust unconfirmed volume` (bool, **true**) (verify names).
* Calculation: for the current bar compute its time offset from the anchor-period start; for each of the last `Length` anchor periods find the bar with the same offset; Cumulative mode: `relVol = cumVolume(sinceAnchor, now) / avg_over_periods(cumVolume(sinceAnchor, sameOffset))`; Regular mode: `relVol = volume / avg(volume at same offset)`. If the anchor TF ≤ chart TF, the period resets every chart bar (regular = volume / SMA(volume, length)).
* Plots: `Relative Volume` **columns**, colored above/below 1 (green `#089981` when ≥ 1, red `#F23645` when < 1 — verify), hline at **1**. Realtime bar note: value is understated until the bar closes unless the adjustment is on.

### 3.90 Rob Booker indicators `[D]`/list only

`Rob Booker - ADX Breakout` (ADX 14 with breakout coloring), `Rob Booker - Knoxville Divergence` (momentum + RSI overbought/oversold divergence lines; inputs: Bars Back 30?, RSI 21?, Momentum 20? — unverified), `Rob Booker Intraday Pivot Points` (60/240/480-minute floor pivots), `Rob Booker Missed Pivot Points` (daily/weekly/monthly pivots not touched), `Rob Booker Reversal` (MACD zero cross + Stochastic %K vs Upper/Lower: red triangle when MACD crosses 0 from above and %K > overbought; green when crosses from below and %K < oversold; inputs Fast MA, Slow MA, KPeriod, Slowing, Stochastic Upper, Stochastic Lower), `Rob Booker Ziv Ghost Pivots` (projected pivots for 4h/next day/next week/next month). Formulas are not published; implement only the Reversal and Intraday Pivots if needed (both are compositions of documented primitives).

### 3.91 Rolling VWAP `[V]` (TradingView open-source script)

* TV title: **Rolling VWAP**; short: **RVWAP**. Overlay. Pine v6.
* Inputs: `Source` (**hlc3**); `Use Auto Time Window` (bool, **true**); `Fixed Time Period` — `Days` (**1**), `Hours` (**0**), `Minutes` (**0**) (used when auto is off; no longer capped at 90 days); `Minimum Bars` (int, **10**); three standard-deviation band toggles + multipliers (**1, 2, 3**; band 1 on by default — verify); `Show time period` (bool) label in the lower-right.
* Auto time window (best current knowledge — verify in the script's `timeStep_translate()`): seconds/1-minute charts -> 1 day... the mapping steps the window up with the chart timeframe (≤1min: 1D; ≤5min: 1W? etc.).
* Calculation: over all bars whose `time` is within `[time - window, time]` (never resets): `rvwap = sum(src*volume) / sum(volume)`; `variance = sum(volume*src^2)/sum(volume) - rvwap^2`; bands `rvwap ± k*sqrt(max(variance,0))`. If fewer than `Minimum Bars` fall in the window, the window is widened to `Minimum Bars` bars. Implemented with the `ConditionalAverages` library `totalForTimeWhen()`.
* Plots: `RVWAP` line (blue `#2962FF`), band pairs (green/olive/teal like the VWAP built-in) with fills @95 (verify).

### 3.92 Seasonality `[V]`

* TV title: **Seasonality**. Table (separate pane) + monthly projection boxes on the chart. Inputs: `Starting Year`, `Positive Color`, `Negative Color`, `Color Intensity Cutoff (%)`, `Table Position` (Center), `Table Width (%)` 100, `Table Height (%)` 95, `Show Averages`, `Show Standard Deviation`, `Show Percent Positive`, `Ignored months` (list of `YYYY-MM`). Rows = years, columns = months; cell = monthly % change; footer rows = mean, stdev, % positive. Chart boxes show each month's average % change as a projection.

### 3.93 SMI Ergodic Indicator / Oscillator `[S]`

* TV titles: **SMI Ergodic Indicator** (short **SMII**) and **SMI Ergodic Oscillator** (short **SMIO**); library study: `SMI Ergodic Indicator/Oscillator` (combined: `indicator` `#2196F3`, `signal` `#FF6D00`, `oscillator` histogram `#FF5252`).
* Pane: separate; `precision=4`. MTF: yes.
* Inputs: `Long Length` (int, **20**); `Short Length` (int, **5**); `Signal Line Length` (int, **5**).
* Calculation: `erg = ta.tsi(close, shortlen, longlen)` (= 100 * ema(ema(change, long), short) / ema(ema(|change|, long), short)); `sig = ta.ema(erg, siglen)`; oscillator: `osc = erg - sig`.
* Plots: Indicator: `Indicator` line `#2962FF`, `Signal` line `#FF6D00`; Oscillator: `Oscillator` histogram `#F23645`/`#FF5252`; zero hline.
* Note: TV's "SMI Ergodic" is Blau's TSI(5,20) with a 5-EMA signal — it is not the Stochastic Momentum Index (3.98).

### 3.94 Smoothed Moving Average `[S]`

* TV title: **Smoothed Moving Average**; short: **SMMA**; library study: `Smoothed Moving Average`.
* Pane: overlay. MTF: yes.
* Inputs: `Length` (int, **7**, min 1); `Source` (**hl2**); Smoothing group in newer builds.
* Calculation: `smma = 0.0; smma := na(smma[1]) ? ta.sma(src, len) : (smma[1] * (len - 1) + src) / len` (identical to `ta.rma`).
* Plots: `SMMA` line `#673AB7`.
* Help-Center prose mentions period 9 and close; the shipped source uses 7 and hl2.

### 3.95 Standard Deviation / Standard Error / Standard Error Bands `[F]` (library only)

* **Standard Deviation**: inputs `Length` **20**, `Source` close; `ta.stdev(src, len)`; plot `#089981`.
* **Standard Error**: inputs `Length` **14** (verify), `Source` close; `se = stdev(residuals of linreg) / sqrt(length)` (standard error of the regression estimate); plot `#FF6D00`.
* **Standard Error Bands**: inputs `Length` **21**, `Source` close, `Standard Error Mult` **2**, `Smoothing` **3**; `basis = sma(linreg(src,len,0), smooth)`, `se = sma(stderr(src,len), smooth)`, `upper = basis + mult*se`, `lower = basis - mult*se`; plots `plot 1` (upper) `#2196F3`, `plot 2` (basis) `#FF6D00`, `plot 3` (lower) `#2196F3`, `background` `#2196F3` @95.

### 3.96 Stochastic `[S]`

* TV title: **Stochastic**; short: **Stoch**; library study: `Stochastic`.
* Pane: separate, 0..100; `precision=2`. MTF: yes.
* Inputs: `%K Length` (int, **14**, min 1); `%K Smoothing` (int, **1**, min 1); `%D Smoothing` (int, **3**, min 1).
* Calculation: `k = ta.sma(ta.stoch(close, high, low, periodK), smoothK)`; `d = ta.sma(k, periodD)`.
* Plots: `%K` line `#2962FF`; `%D` line `#FF6D00`; hlines `Upper Band` **80**, `Middle Band` 50 (@50), `Lower Band` **20** (`#787B86`); fill `Background` `color.rgb(33,150,243,90)`.
* Library: `%k` `#2196F3`, `%d` `#FF6D00`, limits 80/20 dashed, bg `#2196F3` @90; library inputs `%K Length` 14, `%K Smoothing` 1, `%D Smoothing` 3.
* Help-Center prose ("K 14, D 3, Smooth 3") describes the classic slow stochastic; the shipped default is %K Smoothing = 1 (fast %K) — implement 14/1/3.

### 3.97 Stochastic Momentum Index `[V]`

* TV title: **Stochastic Momentum Index**; short: **SMI**. Separate pane, -100..100. MTF: yes.
* Inputs: `%K Length` (int, **10**); `%D Length` (int, **3**); `EMA Length` (int, **3**).
* Calculation:
```
emaEma(s, len) => ta.ema(ta.ema(s, len), len)
highestHigh = ta.highest(lengthK) ; lowestLow = ta.lowest(lengthK)
highestLowestRange = highestHigh - lowestLow
relativeRange = close - (highestHigh + lowestLow) / 2
smi = 200 * (emaEma(relativeRange, lengthD) / emaEma(highestLowestRange, lengthD))
smiEma = ta.ema(smi, lengthEMA)
```
* Plots: `SMI` line `#2962FF`; `SMI-based EMA` line `#FF6D00`; hlines `Overbought Line` **40**, `Oversold Line` **-40**, `Middle Line` 0 (`#787B86`); gradient background fills above 40 (red-ish) and below -40 (green-ish) with opacity control (verify colors).

### 3.98 Stochastic RSI `[S]`

* TV title: **Stochastic RSI**; short: **Stoch RSI**; library study: `Stochastic RSI`.
* Pane: separate, 0..100; `precision=2`. MTF: yes.
* Inputs: `K` (int, **3**); `D` (int, **3**); `RSI Length` (int, **14**); `Stochastic Length` (int, **14**); `RSI Source` (**close**).
* Calculation: `rsi1 = ta.rsi(src, lengthRSI)`; `k = ta.sma(ta.stoch(rsi1, rsi1, rsi1, lengthStoch), smoothK)`; `d = ta.sma(k, smoothD)`.
* Plots: `K` line `#2962FF`; `D` line `#FF6D00`; hlines **80** / 50 / **20** (`#787B86`); fill blue @90. Library: `%k` `#2196F3`, `%d` `#FF6D00`, limits 80/20, bg @90.
* Legend: `Stoch RSI 3 3 14 14 close`.

### 3.99 Supertrend `[S]`

* TV title: **Supertrend**; short: **Supertrend**; library study: `SuperTrend`.
* Pane: overlay. MTF: yes.
* Inputs: `ATR Length` (int, **10**, min 1); `Factor` (float, **3.0**, min 0.01, step 0.01).
* Calculation: `[supertrend, direction] = ta.supertrend(factor, atrPeriod)`; `supertrend := barstate.isfirst ? na : supertrend`.
* Plots: `Up Trend` = `direction < 0 ? supertrend : na`, `plot.style_linebr`, `color.green` (`#4CAF50`; newer builds `#089981`); `Down Trend` = `direction < 0 ? na : supertrend`, linebr, `color.red` (`#F23645`); hidden `Body Middle` = `(open+close)/2` (`display.none`); fills between Body Middle and Up Trend `color.new(color.green, 90)` and Body Middle and Down Trend `color.new(color.red, 90)` with `fillgaps=false`.
* Library variant: `supertrend` line `#000080` width 3 @35 plus `up arrow` (`shape_arrow_up`, `#00FF00`, BelowBar) and `down arrow` (`shape_arrow_down`, `#FF0000`, AboveBar) on flips.
* Alerts: Downtrend to Uptrend (`direction[1] > direction`), Uptrend to Downtrend, Trend Change.

### 3.100 Technical Ratings `[V]`

* TV title: **Technical Ratings**; short: **Ratings**. Separate pane (-1..1) plus optional multi-timeframe table. Open-source script and `TechnicalRating` library (v6, 2024-11 update aligned conditions with the Screener).
* Inputs: `Indicator Timeframe` (timeframe, chart TF; must be ≥ chart TF); `Rating is based on` (**All** | MAs | Oscillators); `Plot confirmed ratings only` (bool); `Show MTF` / additional timeframes for the table; table size/position/colors. (Older script: `Rating Uses` 0/1/2, `Weight of MAs` 50 %, `Repainting`.)
* Components — 15 MAs: SMA 10/20/30/50/100/200, EMA 10/20/30/50/100/200, HMA 9, VWMA 20, Ichimoku (9/26/52); 11 oscillators: RSI 14, Stochastic 14/3/3, CCI 20, ADX 14/14, AO, Momentum 10, MACD 12/26/9, Stochastic RSI 3/3/14/14, Williams %R 14, Bull Bear Power 13, Ultimate Oscillator 7/14/28.
* Per-component vote (+1 buy, 0 neutral, -1 sell):
```
MA (each):        buy MA < close ; sell MA > close ; else 0
Ichimoku:         buy  leadA > leadB and base > leadA and conv > base and close > conv  (verify ordering vs library: 
                  library: buy = leadLine1 > leadLine2 and close > leadLine1 and close < baseLine and close[1] < conversionLine and close > conversionLine; sell symmetric) 
RSI(14):          buy rsi < 30 and rsi > rsi[1] ; sell rsi > 70 and rsi < rsi[1]
Stoch(14,3,3):    buy k < 20 and d < 20 and k > d ; sell k > 80 and d > 80 and k < d
CCI(20):          buy cci < -100 and cci > cci[1] ; sell cci > 100 and cci < cci[1]
ADX(14,14):       buy +DI > -DI and adx > 20 and adx > adx[1] ; sell +DI < -DI and adx > 20 and adx < adx[1]
AO:               buy crossover(ao, 0) or (ao > 0 and ao[1] > 0 and ao > ao[1] and ao[2] > ao[1]) ; sell symmetric
Momentum(10):     buy mom > mom[1] ; sell mom < mom[1]
MACD(12,26,9):    buy macd > signal ; sell macd < signal
StochRSI:         buy downtrend and k < 20 and d < 20 and k > d ; sell uptrend and k > 80 and d > 80 and k < d
W%R(14):          buy r < -80 and r > r[1] ; sell r > -20 and r < r[1]
BBP(13):          buy uptrend and bearPower < 0 and bearPower > bearPower[1] ; sell downtrend and bullPower > 0 and bullPower < bullPower[1]
UO(7,14,28):      buy uo > 70 ; sell uo < 30
```
where up/downtrend for StochRSI and BBP is `close > sma(close, 50)` vs `<` (library uses `ta.sma(close, 50)`; verify).
* Rating: `ratingMA = avg(15 MA votes)`, `ratingOsc = avg(11 osc votes)` (na votes excluded), `ratingAll = avg(ratingMA, ratingOsc)`. Status: `> 0.5` Strong Buy, `0.1..0.5` Buy, `-0.1..0.1` Neutral, `-0.5..-0.1` Sell, `< -0.5` Strong Sell (bounds `strongBound=0.5`, `weakBound=0.1`).
* Plots: `Rating` **columns** colored by status (strong buy `#089981`? / buy lighter green / neutral gray `#787B86` / sell light red / strong sell `#F23645`; the script intensifies color with `countRising` up to 5 consecutive rises) and hlines at **0.5, 0.1, -0.1, -0.5** (`#787B86`); MTF table cells show status text per timeframe.

### 3.101 Time Weighted Average Price `[V]`

* TV title: **Time Weighted Average Price**; short: **TWAP**. Overlay.
* Inputs: `Anchor Period` (**Session** | Week | Month | Quarter | Year | Decade | Century | Earnings | Dividends | Splits); `Source` (**ohlc4**); `Offset` (int, **0**).
* Calculation: on each bar since the anchor start: `sum += src; n += 1; twap = sum / n` (reset when the anchor period changes; `isNewPeriod` as in VWAP 3.114).
* Plots: `TWAP` line `#2962FF` with offset.

### 3.102 Trading Sessions `[V]` behaviour / `[F]` defaults

* TV title: **Trading Sessions**. Overlay boxes; intraday only.
* General inputs: `Show session names`, `Draw session open and close lines` (dashed), `Show tick range` (session high-low in ticks), `Show average price` (dotted line).
* Per session (3 rows): `Show session` (bool), `Displayed name` (Asia / Europe / US — labels "Tokyo", "London", "New York"), `Session time` (`HHMM-HHMM`, 15-min steps), `Session time zone` (`GMT+9`/IANA `Asia/Tokyo` etc.), `Session color` (+opacity). Defaults (verify): Asia `0900-1800 Asia/Tokyo` (or `0000-0900 UTC`), Europe `0800-1630 Europe/London`, US `0930-1600 America/New_York`; colors e.g. purple/blue/orange-ish @ 90 transparency.
* Drawing: a box from the first bar that *opens* inside the session to the last such bar, top = session high, bottom = session low (updated live); overnight sessions (end < start) wrap midnight.

### 3.103 Trend Strength Index `[V]`

* TV title: **Trend Strength Index**; short: **TSI** (collides with True Strength Index's short name); library study: `Trend Strength Index` (plot `#FF5252`).
* Pane: separate, -1..1. MTF: yes.
* Inputs: `Length` (int, **14**, verify); `Bullish Color` (`#089981`), `Bearish Color` (`#F23645`) with transparency.
* Calculation: `tsi = ta.correlation(close, bar_index, length)` (Pearson r of price vs a straight line of slope 1).
* Plots: `Trend Strength Index` line, colored bullish/bearish by sign, gradient fill between the line and 0 in the same color; zero hline.

### 3.104 Triple EMA `[S]`

* TV title: **Triple EMA**; short: **TEMA**; library study: `Triple EMA`.
* Pane: overlay. MTF: yes.
* Inputs: `Length` (int, **9**, min 1); (source fixed close in older build; newer adds `Source`).
* Calculation: `e1 = ema(src,len); e2 = ema(e1,len); e3 = ema(e2,len); tema = 3*(e1 - e2) + e3`.
* Plots: `TEMA` line `#2962FF`.

### 3.105 TRIX `[S]`

* TV title: **TRIX**; library study: `TRIX`.
* Pane: separate; `precision=4`. MTF: yes.
* Inputs: `Length` (int, **18**, min 1).
* Calculation: `trix = 10000 * ta.change(ta.ema(ta.ema(ta.ema(math.log(close), length), length), length))` (log price, ×10 000 — TV's convention).
* Plots: `TRIX` line `#F23645`; hline `Zero` 0 `#787B86`. (Help Center describes a signal line; the shipped built-in has none — library: `trix` `#F23645`, `zero` band.)

### 3.106 True Strength Index `[S]`

* TV title: **True Strength Index**; short: **TSI**; library study: `True Strength Indicator`.
* Pane: separate; `precision=4`. MTF: yes.
* Inputs: `Long Length` (int, **25**); `Short Length` (int, **13**); `Signal Length` (int, **13**).
* Calculation:
```
double_smooth(src, long, short) => ta.ema(ta.ema(src, long), short)
pc = ta.change(close)
tsi = 100 * double_smooth(pc, long, short) / double_smooth(math.abs(pc), long, short)
signal = ta.ema(tsi, signalLen)
```
* Plots: `True Strength Index` line `#2962FF`; `Signal` line `#F23645`; hline `Zero` 0 `#787B86`.

### 3.107 Ulcer Index `[V]`

* TV title: **Ulcer Index** (2025). Separate pane. MTF: yes.
* Inputs: `Source` (close); `Length` (int, **14**, verify); Calculation group.
* Calculation: `hh = ta.highest(src, length)`; `dd = (src - hh) / hh * 100`; `ui = math.sqrt(math.sum(dd*dd, length) / length)`.
* Plots: `Ulcer Index` line (blue).

### 3.108 Ultimate Oscillator `[S]`

* TV title: **Ultimate Oscillator**; short: **UO**; library study: `Ultimate Oscillator`.
* Pane: separate, 0..100; `precision=2`. MTF: yes.
* Inputs: `Fast Length` (int, **7**); `Middle Length` (int, **14**); `Slow Length` (int, **28**).
* Calculation:
```
average(bp, tr_, length) => math.sum(bp, length) / math.sum(tr_, length)
high_ = math.max(high, close[1]) ; low_ = math.min(low, close[1])
bp = close - low_ ; tr_ = high_ - low_
uo = 100 * (4*average(bp,tr_,7) + 2*average(bp,tr_,14) + average(bp,tr_,28)) / 7
```
* Plots: `UO` line `#F23645`. (No hlines by default; library `uo` `#F23645`.)

### 3.109 Up/Down Volume `[V]`

* TV title: **Up/Down Volume**. Separate pane; `format=format.volume`. Uses the `ta` library `requestUpAndDownVolume(lowerTf)`.
* Inputs: `Use custom timeframe` (bool, **false**); `Timeframe` (lower TF, default **1**).
* Auto lower TF: seconds -> `1S`; minutes/hours -> `1`; daily -> `5`; others -> `60`. Up/down classification per intrabar as in 3.30 (equal close/open: compare to previous close, `>=` counts as up).
* Plots: `Up Volume` **columns** above zero (`#089981`); `Down Volume` columns below zero as negative values (`#F23645`); `Delta` = up + down (down negative) drawn as a short "notch" (histogram/columns of small width) in the color of the prevailing side (verify style: `plot.style_columns` with `linewidth`? or `plot.style_histogram`). Zero line.

### 3.110 Visible Average Price `[V]`

* TV title: **Visible Average Price**. Overlay. Input: `Source` (close, verify). `avg = mean of source over the bars currently visible` (uses `chart.left_visible_bar_time`/`chart.right_visible_bar_time`; recomputed on scroll/zoom). Plot `Avg Price` line (blue) + optional price line.

### 3.111 Volatility Stop `[S]`

* TV title: **Volatility Stop**; short: **VStop**. Overlay. Open-source (v6 uses `ta.vStop()` from the `ta` library).
* Inputs: `Length` (int, **20**, min 2); `Source` (**close**); `vStop Multiplier` (float, **2.0**, min 0.25, step 0.25); v6 adds display style (line/circles/diamonds/arrows) and two color themes.
* Calculation:
```
volStop(src, atrlength, atrfactor) =>
    var max = src ; var min = src ; var uptrend = true ; var float stop = na
    atrM = nz(ta.atr(atrlength) * atrfactor, ta.tr)
    max := math.max(max, src) ; min := math.min(min, src)
    stop := nz(uptrend ? math.max(stop, max - atrM) : math.min(stop, min + atrM), src)
    uptrend := src - stop >= 0.0
    if uptrend != uptrend[1] and not barstate.isfirst
        max := src ; min := src
        stop := uptrend ? max - atrM : min + atrM
    [stop, uptrend]
```
* Plots: `Volatility Stop` drawn with `plot.style_cross` (older) / circles, `color = uptrend ? color.green (#089981) : color.red (#F23645)` (verify). The stop never moves against the trend.
* Help-Center prose (stdev × multiple) describes the concept, not the shipped ATR implementation.

### 3.112 Volatility Close-to-Close / Zero Trend Close-to-Close / O-H-L-C / Volatility Index `[F]` (library only)

* `Volatility Close-to-Close`: input `Length` **10**, annualization; `stdev(log(close/close[1]), len) * sqrt(periodsPerYear) * 100`; plot `#2196F3`? (interface fetch failed; use blue).
* `Volatility Zero Trend Close-to-Close`: `sqrt(sum(log(close/close[1])^2, len)/len) * sqrt(ppy) * 100`; plot `#2196F3`.
* `Volatility O-H-L-C`: Garman-Klass estimator `sqrt( avg(0.5*ln(H/L)^2 - (2ln2-1)*ln(C/O)^2, len) ) * sqrt(ppy)*100`; plot `#FF5252`.
* `Volatility Index`: input `Length` 10; `ema(tr, len) / close * 100`-style relative TR; plot `#FF5252`. (All four: verify formulas in the library's `builtin` study metainfo.)

### 3.113 Volume `[S]`

* TV title: **Volume**; short: **Vol**; library study: `Volume`.
* Pane: separate; `format=format.volume`. MTF: yes.
* Inputs: `show MA` (bool, **false**; newer builds label it `MA` with `Length`); `MA Length` (int, **20**); `Color based on previous close` (bool, **false**); newer builds also expose the Smoothing group (`Type` None | SMA | ..., `Length` 20?, `BB StdDev`).
* Calculation: `palette = colorBasedOnPrevClose ? (close[1] > close ? DOWN : UP) : (open > close ? DOWN : UP)`; `ma = ta.sma(volume, length)`.
* Plots: `Volume` **columns** `#22AB94` (up) / `#F7525F` (down) (older builds `#26A69A`/`#EF5350`; the pane is usually overlaid on the price chart at 50 % transparency in the default layout — library `volume.transparency` 50); `Volume MA` line `#2962FF` (library `volume ma:plot` `#2196F3`, hidden by default `display 0`).
* Library override keys: `volume.volume.color.0` (down) / `volume.volume.color.1` (up), `volume.volume ma.visible`, `volume.length`.

### 3.114 Volume Weighted Average Price `[S]`

* TV title: **Volume Weighted Average Price**; short: **VWAP**; library study: `VWAP`.
* Pane: overlay. MTF: yes.
* Inputs — "VWAP Settings": `Hide VWAP on 1D or Above` (bool, **false**); `Anchor Period` (**Session** | Week | Month | Quarter | Year | Decade | Century | Earnings | Dividends | Splits); `Source` (**hlc3**); `Offset` (int, **0**, min 0). "Bands Settings": `Bands Calculation Mode` (**Standard Deviation** | Percentage); `Bands Multiplier #1` (bool **true**, float **1.0**); `#2` (bool **false**, **2.0**); `#3` (bool **false**, **3.0**) (step 0.5, min 0).
* Anchor detection:
```
isNewPeriod = switch anchor
    "Earnings"  => not na(request.earnings(...gaps_on, lookahead_on))
    "Dividends" => not na(request.dividends(...))
    "Splits"    => not na(request.splits(...))
    "Session"   => timeframe.change("D")
    "Week"      => timeframe.change("W")
    "Month"     => timeframe.change("M")
    "Quarter"   => timeframe.change("3M")
    "Year"      => timeframe.change("12M")
    "Decade"    => timeframe.change("12M") and year % 10 == 0
    "Century"   => timeframe.change("12M") and year % 100 == 0
if na(src[1]) and not isEsdAnchor: isNewPeriod := true       // first bar starts a period
```
* Calculation: `[vwap, upper1, _] = ta.vwap(src, isNewPeriod, 1)`; `stdevAbs = upper1 - vwap`; `bandBasis = mode == "Standard Deviation" ? stdevAbs : vwap * 0.01`; `upper_k = vwap + bandBasis * mult_k`, `lower_k = vwap - bandBasis * mult_k`. If `hideonDWM and timeframe.isdwm` everything is na. Runtime error if no volume.
* Plots: `VWAP` line `#2962FF`; `Upper/Lower Band #1` `color.green` with fill `Bands Fill #1` green @95; `#2` `color.olive` @95; `#3` `color.teal` @95 (bands 2/3 hidden unless enabled). Library: `vwap` `#2196F3`.
* Legend: `VWAP Session hlc3 0` (data-window inputs hidden) -> value.

### 3.115 Volume Delta `[V]`

* TV title: **Volume Delta**. Separate pane, candles. Inputs: `Use custom timeframe` (**false**), `Timeframe` (**1**). Auto LTF and polarity rules as in 3.30. Candle: open = 0, close = bar delta, high = max running delta inside the bar, low = min. Colors: positive close `#089981`, negative `#F23645` (verify exact hex; older `#26A69A`/`#EF5350`).

### 3.116 Volume Oscillator `[S]`

* TV title: **Volume Oscillator**; short: **Volume Osc**; library study: `Volume Oscillator`.
* Pane: separate (percent). MTF: yes.
* Inputs: `Short Length` (int, **5**); `Long Length` (int, **10**).
* Calculation: `short = ta.ema(volume, 5)`; `long = ta.ema(volume, 10)`; `osc = 100 * (short - long) / long`.
* Plots: `VolumeOsc` line `#2962FF`; hline 0 `#787B86` dashed.

### 3.117 Volume Weighted Moving Average `[S]`

* TV title: **Volume Weighted Moving Average**; short: **VWMA**; library study: `VWMA`.
* Pane: overlay. MTF: yes.
* Inputs: `Length` (int, **20**, min 1); `Source` (**close**); (Offset in newer builds).
* Calculation: `ta.vwma(src, len)`.
* Plots: `VWMA` line `#2962FF`.

### 3.118 Vortex Indicator `[S]`

* TV title: **Vortex Indicator**; short: **VI**; library study: `Vortex Indicator`.
* Pane: separate; `precision=4`. MTF: yes.
* Inputs: `Period` (int, **14**, min 2).
* Calculation:
```
VMP = math.sum(math.abs(high - low[1]), period)
VMM = math.sum(math.abs(low - high[1]), period)
STR = math.sum(ta.atr(1), period)
VIP = VMP / STR ; VIM = VMM / STR
```
* Plots: `VI +` line `#2962FF`; `VI -` line `#E91E63`.

### 3.119 Moving Average Weighted `[S]`

* TV title: **Moving Average Weighted**; short: **WMA**; library study: `Moving Average Weighted`.
* Pane: overlay. MTF: yes. Inputs: `Length` **9**, `Source` close, `Offset` 0, Smoothing group. Calculation `ta.wma`. Plot `WMA` line `#2962FF`.

### 3.120 Williams %R `[S]`

* TV title: **Williams Percent Range**; short: **Williams %R**; library study: `Williams %R`.
* Pane: separate, -100..0; `precision=2`. MTF: yes.
* Inputs: `Length` (int, **14**); `Source` (**close**).
* Calculation: `max = ta.highest(length)` (high); `min = ta.lowest(length)` (low); `percentR = 100 * (src - max) / (max - min)`.
* Plots: `%R` line `#7E57C2`; hlines `Upper Band` **-20**, `Middle Level` -50 (dotted, @50), `Lower Band` **-80** (`#787B86`); fill `color.rgb(126,87,194,90)`.

### 3.121 Williams Alligator `[S]`

* TV title: **Williams Alligator**; short: **Alligator**; library study: `Williams Alligator`.
* Pane: overlay. MTF: yes.
* Inputs: `Jaw Length` **13**, `Teeth Length` **8**, `Lips Length` **5** (ints, min 1); `Jaw Offset` **8**, `Teeth Offset` **5**, `Lips Offset` **3**.
* Calculation: `smma(src, len)` = `na(prev) ? sma(src,len) : (prev*(len-1) + src)/len` on `hl2` for each line.
* Plots: `Jaw` line `#2962FF` offset 8; `Teeth` line `#E91E63` offset 5; `Lips` line `#66BB6A` offset 3. Library: jaw `#2196F3`, teeth `#E91E63`, lips `#66BB6A`.

### 3.122 Williams Fractal `[S]`

* TV title: **Williams Fractal**; short: **Fractals**; library study: `Williams Fractal`.
* Pane: overlay shapes; `precision=0`.
* Inputs: `Periods` (int, **2**, min 2).
* Calculation (exact tie handling — left side strict, right side allows up to 4 equal highs immediately after the centre bar):
```
n = periods
upflagDownFrontier = true ; upflagUpFrontier0..4 = true
for i = 1 to n
    upflagDownFrontier := upflagDownFrontier and high[n-i] < high[n]                       // n bars to the LEFT? (see note)
    upflagUpFrontier0 := upflagUpFrontier0 and high[n+i] < high[n]
    upflagUpFrontier1 := upflagUpFrontier1 and high[n+1] <= high[n] and high[n+i+1] < high[n]
    upflagUpFrontier2 := upflagUpFrontier2 and high[n+1] <= high[n] and high[n+2] <= high[n] and high[n+i+2] < high[n]
    upflagUpFrontier3 := ... and high[n+3] <= high[n] and high[n+i+3] < high[n]
    upflagUpFrontier4 := ... and high[n+4] <= high[n] and high[n+i+4] < high[n]
flagUpFrontier = upflagUpFrontier0 or ... or upflagUpFrontier4
upFractal = upflagDownFrontier and flagUpFrontier
// downFractal: same with low and > / >=
```
Note on orientation: the script evaluates on the confirming bar; `high[n]` is the candidate centre; `high[n-i]` (i=1..n) are the n newer bars (right side, must be strictly lower); `high[n+i]` are older bars (left side) where runs of equal highs are tolerated (frontier variants 1-4 allow 1-4 equal bars immediately left of the centre, requiring the bar beyond to be strictly lower). Plot with `offset=-n` so the marker sits on the centre bar.
* Plots: `Down Fractals` `shape.triangledown`, `location.belowbar`, `#F23645`, `size.small`, offset -n; `Up Fractals` `shape.triangleup`, `location.abovebar`, `#089981`, offset -n. Library: `down fractals` `#F23645` `shape_triangle_down` BelowBar; `up fractals` `#089981` `shape_triangle_up` AboveBar.

### 3.123 Woodies CCI `[V]` behaviour / `[S]` structure

* TV title: **Woodies CCI**; short: **Woodies CCI**; library study: `Woodies CCI`.
* Pane: separate; `precision=2`. MTF: yes.
* Inputs: `CCI Turbo Length` (int, **6**, 3..14); `CCI 14 Length` (int, **14**, 7..20).
* Calculation: `cciTurbo = ta.cci(close, 6)`; `cci14 = ta.cci(close, 14)` (source close in the built-in; Help Center formula uses typical price). Histogram color state machine on `cci14`: count consecutive bars on the same side of zero; bars 1-4 after a zero cross -> **gray**; bar 5 -> **yellow**; bar ≥ 6 -> **green** if `cci14 > 0`, **red** if `< 0` (implemented as `last5IsUp = cci14 > 0 and cci14[1] > 0 ... [4] > 0` etc.).
* Plots: `CCI 14` **histogram/columns** with the state colors (`color.gray`/`color.yellow`/`color.green`/`color.red` in the source); `CCI Turbo` line `#2962FF`? and `CCI 14` line (white/`#787B86`); hlines at **±100** and **±200** (`#787B86`) plus `0` (verify which hlines exist).

### 3.124 Zig Zag `[S]`

* TV title: **Zig Zag**; short: **Zig Zag**; library study: `Zig Zag` (library inputs `Deviation` 5, `Depth` 10; plot `#2196F3` width 2).
* Pane: overlay (lines + labels, via the `ZigZag` library).
* Inputs: `Price deviation for reversals (%)` (float, **5.0**, 0.00001..100); `Pivot legs` (int, **10**) — split in half (floor) into left/right bars for `ta.pivothigh/low`; `Line color` (`#2962FF`); `Extend to last bar` / `Calculate projected pivots` (bool, **true**); `Display reversal price` (bool, **true**); `Display cumulative volume` (bool, **true**); `Display reversal price change` (bool, **false**) with `Change type` (**Absolute** | Percent) (defaults verify).
* Algorithm (ZigZag library v9): keep the last pivot (price, bar, direction). On each confirmed `ta.pivothigh(high, L, R)`/`ta.pivotlow(low, L, R)`: if same direction as the last pivot and more extreme -> replace the last pivot (move the line end); if opposite direction and `|newPivot - lastPivot| / lastPivot * 100 >= deviation` -> add a new pivot and a new line segment; otherwise ignore. Projected pivot: from the last confirmed pivot, scan forward to the current bar for the most extreme opposite price; draw a **dashed** segment to it (updates live). Labels above highs (green) / below lows (red) show price, cumulative volume between pivots, and price change (abs or %).
* Plots: solid `line` segments (`Line color`, width 2), dashed projection, `label`s (`#089981` for highs, `#F23645` for lows, white text). Max 500 lines/labels.

### 3.125 24-hour Volume `[V]`

* TV title: **24-hour Volume**. Separate pane (line/column of the last-24h turnover in currency). Inputs: `Price Source` (close, used to convert base volume to currency), `Target Currency` (**Default** | USD | EUR | CAD | JPY | GBP | HKD | CNY | NZD | RUB). LTF: chart < 1D -> 1-minute bars; 1D..1W -> 5-minute; > 1W -> 60-minute. Value = sum of `volume * price` over LTF bars that opened in the last 86 400 000 ms. Uses `request.security_lower_tf`; currency conversion via `request.security` FX rates.

### 3.126 Auto Fib Retracement `[V]` inputs / `[F]` defaults

* TV title: **Auto Fib Retracement**; short: **Auto Fib**. Overlay (lines + labels).
* Inputs: `Deviation` (float, **3**), `Depth` (int, **10**), `Extend Lines` (bool, **false**; older: Extend Left/Right), `Reverse` (bool, **false**), `Prices` (bool, **true**), `Levels` (bool, **true**), `Levels Format` (**Values** | Percent), `Labels Position` (**Left** | Right), `Use Upper/Lower deviation` not present; per level: enable + value + color for **0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236** (older builds also 1.272, 1.414, 2, 2.272, 2.414, 3, 3.272, 3.414, 4 disabled by default).
* Algorithm: run the Zig Zag pivot engine with the given deviation/depth; take the last two confirmed pivots (a swing high and a swing low); 0 = the end of the last swing (or start when `Reverse`), 1 = its start; draw horizontal lines at `start + (end - start) * level` from the second pivot's bar to the current bar (extended when enabled); labels show the level (`0.618` or `61.8%`) and price.
* Default colors (same as the Fib Retracement drawing tool, verify): 0 `#787B86`, 0.236 `#F23645`, 0.382 `#FF9800`, 0.5 `#4CAF50`, 0.618 `#089981`, 0.786 `#00BCD4`, 1 `#787B86`, 1.618 `#2962FF`, 2.618 `#F23645`, 3.618 `#9C27B0`, 4.236 `#E91E63`.

### 3.127 Auto Fib Extension `[V]`

* TV title: **Auto Fib Extension**. Overlay. Inputs: `Deviation` (**3**), `Depth` (**10**), `Extend Lines`, `Reverse`, `Prices`, `Levels`, `Levels Format` (Values/Percent), level toggles/colors (0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236 — same palette as 3.126).
* Algorithm: last three Zig Zag pivots P1, P2, P3: P1->P2 = trend leg, P2->P3 = retracement; levels are drawn from P3 at `P3 + (P2 - P1) * level` (extension of the trend leg projected from the retracement end).

### 3.128 Auto Pitchfork `[V]`

* TV title: **Auto Pitchfork**. Overlay. Inputs: `Depth` (int, verify default 10), `Type` (**Original** | Schiff | Modified Schiff | Inside), `Background Transparency` (0-100), `Extend Left` (bool); levels 0.25, 0.382, 0.5, 0.618, 0.75, 1, 1.5, 1.75, 2 (toggle/color/width/style). Three pivots from the Zig Zag engine; median line per type: Original = P1 -> midpoint(P2,P3); Schiff = (x of P1, y = mid(P1,P2)) -> mid(P2,P3); Modified Schiff = mid(P1,P2) -> mid(P2,P3); Inside = mid(P1,P2) -> P3. Parallel lines offset by level × (P3-P2 distance).

### 3.129 Auto Trendlines `[V]`

* TV title: **Auto Trendlines**. Overlay lines. Inputs: `Bars to Breakout` (**3**), `Line Size` (**Both** | Small | Large), `Show Pivots` (bool). Analyses the last 5000 bars: large lines connect alternating pivots with 25/25 left/right bars whose price difference > 5×ATR14; small lines use 5/5 pivots and > 2×ATR14. A candidate must not be crossed by pivots of its size class in its base part; when lines intersect the winner is chosen by touch count (3/3), total length, pivot size, slope. Lines extend until broken (price beyond the line for `Bars to Breakout` bars) but not beyond 2× their base length.

### 3.130 Auto Key Levels `[V]`

* TV title: **Auto key levels**. Overlay levels: per period (Day/Week/Month, current and previous) POC, VAH, VAL (from Periodic Volume Profile defaults: 70 % value area) and OHLC, plus a custom anchor (Custom/Earnings/Split/Dividends). Labels `dPOC, dVAH, dVAL, dO, dH, dL, dC`, `w*`, `m*`, `pd*`, `pw*`, `pm*`. Requires the Volume Profile engine (section 4).

### 3.131 All Candlestick Patterns `[S]` (and the per-pattern scripts)

* TV title: **All Candlestick Patterns**; short: **All Candlestick Patterns**. Overlay labels. Each pattern also exists as its own built-in script with the same detection code.
* Inputs: `Detect Trend Based On` (**SMA50** | SMA50, SMA200 | No detection); `Pattern Type` (**Both** | Bullish | Bearish); per-pattern `bool` toggles (all true); label colors `Bullish` (`#089981`/`#4CAF50`), `Bearish` (`#F23645`/`#F44336`), `Neutral` (gray `#787B86`?), text white.
* Trend: `SMA50`: uptrend = `close > sma(close,50)`; `SMA50, SMA200`: uptrend = `close > sma50 and sma50 > sma200`, downtrend = `close < sma50 and sma50 < sma200`; `No detection`: both true.
* Helper definitions (from the built-in):
```
C_Len = 14                               // EMA length for average body
C_ShadowPercent = 5.0                     // % of body for "has shadow"
C_ShadowEqualsPercent = 100.0
C_DojiBodyPercent = 5.0                   // % of range
C_Factor = 2.0                            // shadow factor
C_BodyHi = max(close, open) ; C_BodyLo = min(close, open) ; C_Body = C_BodyHi - C_BodyLo
C_BodyAvg = ta.ema(C_Body, C_Len)
C_SmallBody = C_Body < C_BodyAvg ; C_LongBody = C_Body > C_BodyAvg
C_UpShadow = high - C_BodyHi ; C_DnShadow = C_BodyLo - low
C_HasUpShadow = C_UpShadow > C_ShadowPercent / 100 * C_Body
C_HasDnShadow = C_DnShadow > C_ShadowPercent / 100 * C_Body
C_WhiteBody = open < close ; C_BlackBody = open > close
C_Range = high - low
C_IsInsideBar = C_BodyHi[1] > C_BodyHi and C_BodyLo[1] < C_BodyLo
C_BodyMiddle = C_Body / 2 + C_BodyLo
C_ShadowEquals = C_UpShadow == C_DnShadow or (abs(C_UpShadow - C_DnShadow) / C_DnShadow * 100) < C_ShadowEqualsPercent and (abs(C_DnShadow - C_UpShadow) / C_UpShadow * 100) < C_ShadowEqualsPercent
C_IsDojiBody = C_Range > 0 and C_Body <= C_Range * C_DojiBodyPercent / 100
C_Doji = C_IsDojiBody and C_ShadowEquals
```
* Patterns (name — direction — one-line condition summary):
  Abandoned Baby (bull/bear: doji gapping away from a long body, then long body gapping back); Dark Cloud Cover (bear: long white, then black opening above prior high closing below prior body middle); Doji (neutral: `C_Doji` and small body); Doji Star (bull/bear: long body then small-body doji gapping in trend direction); Downside Tasuki Gap (bear); Dragonfly Doji (bull: doji body, long lower shadow ≥ factor×body?, no upper shadow: `C_IsDojiBody and C_UpShadow <= C_Body`); Engulfing (bull/bear: body engulfs prior opposite body); Evening Doji Star; Evening Star (bear: long white, small body gapping up, long black closing below white middle); Falling Three Methods (bear: long black, three small white inside, long black closing below); Falling Window (bear: `high < low[1]`); Gravestone Doji (bear: doji, long upper shadow, `C_DnShadow <= C_Body`); Hammer (bull, downtrend: small body, `C_DnShadow >= C_Factor * C_Body`, no upper shadow); Hanging Man (bear, uptrend, same shape); Harami (bull/bear: long body then small opposite body inside); Harami Cross (long body then doji inside); Inverted Hammer (bull, downtrend: small body, `C_UpShadow >= C_Factor*C_Body`, no lower shadow); Kicking (bull/bear: marubozu pair with gap); Long Lower Shadow (bull: `C_DnShadow > C_Range * 75%`); Long Upper Shadow (bear); Marubozu Black / Marubozu White (long body, shadows ≤ 5 % of body); Morning Doji Star; Morning Star (bull); On Neck (bear: long black then white closing at prior low); Piercing (bull: long black then white opening below prior low, closing above prior middle but below prior open); Rising Three Methods (bull); Rising Window (bull: `low > high[1]`); Shooting Star (bear, uptrend: inverted-hammer shape); Spinning Top Black / White (neutral: small body, both shadows ≥ 34 % of range each); Three Black Crows (bear: three long black, each opening within prior body and closing lower); Three White Soldiers (bull); Tri-Star (bull/bear: three dojis); Tweezer Bottom (bull: two bars with equal lows within tolerance, second white) / Tweezer Top (bear); Upside Tasuki Gap (bull).
* Labels: `label.new` above the bar for bearish (`style=label.style_label_down`), below for bullish (`label_up`), text = pattern name (abbreviated, e.g. "BE" / "SS"? — the built-in uses full names), tooltip with description. All patterns raise `alertcondition`s.

### 3.132 52 Week High/Low, Accelerator Oscillator `[F]` (library only)

* `52 Week High/Low`: inputs `high source` (close|high, default close), `low source` (close|low); plots the rolling 52-week (252 daily bars / time-based) high and low as step lines.
* `Accelerator Oscillator`: `ac = ao - sma(ao, 5)`; histogram `#000080` with green/red palette by `ac > ac[1]`.

---

## 4. Non-Pine built-ins (Volume Profile family, VWAP Auto Anchored) `[N]` — documented behaviour

TradingView states these are not written in Pine and have no viewable source. The behaviour below is from the Help-Center articles.

### 4.1 Common Volume Profile engine

* Data: computed from **lower-timeframe bars** of the same symbol. Timeframe selection: try `1, 5, 15, 30, 60, 240, 1D` in order until the profile range contains fewer than **5000** LTF bars; ranges ≤ 5 minutes (or second-based charts) use `1S`; futures/spread charts use one step below the chart TF. Session profiles use a lookup table by chart resolution multiplied by a depth ratio; maximum **6000** histogram rows in total; profiles are aligned to the start of the year.
* Up/Down classification per LTF bar: `close >= open` -> up volume, `close < open` -> down volume. Volume kinds: trade volume (stocks), tick volume (indices/forex/CFD), base or quote volume (crypto).
* Rows: `Rows Layout` = **Number of Rows** (default) | Ticks Per Row; `Row Size` default **24** (verify; older builds 24 for VRVP) — with Number of Rows: `ticksPerRow = (top - bottom) / rows / mintick` rounded so the total row count is closest to the requested one; with Ticks Per Row: each row spans `rowSize` ticks. Each LTF bar's volume is distributed across the rows its range covers (the engine splits volume proportionally over the bar's price span).
* `Volume` = **Total** | Up/Down | Delta (per row: total, split bar, or up-down difference).
* **POC** = row with the highest volume (ties: verify — first/lowest row). **Value Area** (`Value Area Volume` default **70 %**): start with the POC row; repeatedly compare the next row above and the next row below the current VA; add the larger; if adding would exceed the target volume, stop; ties -> the row closer to the POC; equal distance -> the row above. VAH/VAL = top/bottom of the included rows.
* Style: `Width (% of box)` (longest row scaled to this %, default 30 % for VRVP — verify), `Placement` (**Right** | Left), colors+opacity for `Up Volume`, `Down Volume`, `Value Area Up`, `Value Area Down`, `Histogram background`, `POC` line (default `#FF0000`-ish red, width 1), `VAH`/`VAL` lines (blue `#2962FF`?), `Developing POC` / `Developing VA` (step lines, hidden by default: library `developing poc/va high/va low` plottype `step_line`, display 0), `Show values` (volume numbers per row), `Extend POC right`, `Extend VAH/VAL right`.

### 4.2 Variants

| Study | Extra inputs | Range |
|---|---|---|
| Volume Profile Visible Range (VRVP) | Rows Layout, Row Size, Volume, Value Area Volume, Extend POC/VAH/VAL, Width, Placement, Developing POC/VA | bars currently visible; recalculated on scroll/zoom |
| Volume Profile Fixed Range (FRVP) | `#1` / `#2` first/last bar time (coordinates), `Extend Right` (include new bars) | user-defined bar range |
| Session Volume Profile (SVP) | `Sessions` = **All** | Each | Pre-market | Market | Post-market | Custom (+ time and time zone); Extend POC/VAH/VAL Right | one profile per session/day |
| Session Volume Profile HD | same as SVP; row height adapts to zoom (more rows when zoomed in) | per session |
| Periodic Volume Profile (PVP) | `Period` = multiplier + unit (Bar/Minute/Hour/Day/Week/Month) | one profile per period |
| Auto Anchored Volume Profile (AAVP) | `Anchor Period` = **Auto** | Highest High | Lowest Low | Highest Volume | Session | Week | Month | Year | Quarter | Decade | Century | Earnings | Dividends | Splits; `Length` (rolling window for Highest High/Lowest Low/Highest Volume) | from the anchor to the last bar |

Auto anchor rule (AAVP and VWAP Auto Anchored): intraday -> Session; 1D -> Month; 2D-10D -> Quarter; 11D-60D -> Year; > 60D -> Decade.

### 4.3 VWAP Auto Anchored `[N]`

* Inputs: `Anchor Period` (**Auto** | Highest High | Lowest Low | Highest Volume | Session | Week | Month | Year | Quarter | Decade | Century | Earnings | Dividends | Splits); `Length` (rolling window for the HH/LL/HV anchors); `Source` (**hlc3**); `Offset` (**0**); `Bands Calculation Mode` (Standard Deviation | Percentage); `Bands Multiplier #1-3`.
* Calculation: identical to 3.114 but the period starts at the anchor bar (the bar of the highest high/lowest low/highest volume within `Length` bars, or the start of the last calendar period) and only the current period is drawn.
* Plots: `VWAP` line, `Upper/Lower Band #1-3`, background fills, precision — same styling as VWAP.

### 4.4 Chart-pattern scripts `[N]`

The "Chart Patterns" built-ins (Head and Shoulders, Double Top/Bottom, Triangles, Wedges, Flags, Pennants, Rectangles, Cup and Handle, Triple Top/Bottom, Elliott waves, ABCD, Three Drives, Bump and Run...) are not Pine and have no published rules. Out of scope for exact reproduction.

---

## 5. Data-feed-dependent built-ins `[D]` (list only)

Market breadth: Advance/Decline Line, Advance/Decline Ratio, Cumulative Volume Index (need advancing/declining issue and volume counts per exchange). Derivatives: Open Interest, Funding rate, Long/Short Ratio (Accounts), Long Short Accounts %, Top trader long/short accounts/positions (+ratios), Basis, Premium, Index price, Mark price, Liquidation data. Fundamentals/estimates: Dividend Yield, Analyst price forecast, Price target. On-chain (Bitcoin/Ethereum/token metrics, 60+ articles): 1-year active supply, Active addresses, Addresses with balance ≥ X, Average transaction volume, Block height/blocks mined/difficulty/hash rate, Created/Spent UTXOs, ETF balances/flows, Ethereum staking metrics, Held tokens, Large transaction volume, Mean/Median block interval/size/gas/fees/transfer volume/UTXO values, Power-Law Model, Realized market cap, RVT ratio, Receiving/Sending addresses, SOPR, Stock-to-Flow, Supply Equality Ratio, Transaction fees/rate, Transfer count/rate, Total block/transactions size, US spot crypto ETF balances/flows, El Salvador Government balance. Each is a single line/column plot of a `request.security` feed; none are computable from OHLCV.

---

## 6. Appendix A — Consolidated charting-library default styles (verified `*IndicatorOverrides`)

Format: study -> plot: color / plottype / width / extra. `display 15` = All unless noted. Line style 0 = solid, 2 = dashed.

| Study | Plots (default) | Bands / fills |
|---|---|---|
| Accelerator Oscillator | plot `#000080` histogram | — |
| Accumulation/Distribution | plot `#2196F3` line | — |
| Accumulative Swing Index | asi `#2196F3` line; input limit move value 10 | — |
| Advance/Decline | plot `#2196F3`; input length 10 | — |
| Arnaud Legoux Moving Average | plot `#2196F3` | — |
| Aroon | upper `#FB8C00`, lower `#2196F3` | — |
| Average Directional Index | adx `#FF5252` | — |
| Average Price | plot `#2196F3` | — |
| Average True Range | plot `#801922` | — |
| Awesome Oscillator | plot `#000080` histogram (2-color palette) | — |
| Balance of Power | plot `#FF5252` | — |
| Bollinger Bands | median `#FF6D00`, upper `#2196F3`, lower `#2196F3` | plots background `#2196F3` @95 |
| Bollinger Bands %B | plot `#22AB94` | upperlimit 1, lowerlimit 0 (`#787B86` dashed), hlines background `#26A69A` @90 |
| Bollinger Bands Width | plot `#FF6D00` | — |
| Chaikin Money Flow | plot `#43A047` | zero 0 dashed |
| Chaikin Oscillator | plot `#EC407A` | zero 0 dashed |
| Chaikin Volatility | plot `#AB47BC` | zero 0 dashed |
| Chande Kroll Stop | long `#2196F3`, short `#FF6D00` | — |
| Chande Momentum Oscillator | plot `#2196F3` | — |
| Chop Zone | plot `#000080` columns (9-color palette) | — |
| Choppiness Index | plot `#2196F3` | upper 61.8 / lower 38.2 dashed, bg `#2196F3` @90 |
| Commodity Channel Index | plot `#2196F3`; smoothed ma hidden | upper 100 / lower -100 dashed, bg @90 |
| Connors RSI | crsi `#2196F3` | upper 70 / lower 30, bg @90 |
| Coppock Curve | plot `#2196F3` | — |
| Correlation Coefficient | plot `#2196F3` **area** | — |
| Correlation - Log | plot `#2196F3` | — |
| Detrended Price Oscillator | dpo `#43A047` | zero 0 dashed |
| Directional Movement | +di `#2196F3`, -di `#FF6D00`, adx `#F50057`, adxr `#ab47bc`, dx `#FFA726` | — |
| Donchian Channels | basis `#FF6D00`, upper/lower `#2196F3` | bg `#2196F3` @95 |
| Double EMA | plot `#43A047` | — |
| Ease Of Movement | plot `#43A047` | — |
| Elder's Force Index | plot `#F23645` | zero 0 dashed |
| EMA Cross | long:plot `#43A047`, short:plot `#FF6D00`, crosses `#2196F3` cross width 4 | — |
| Envelopes | average `#FF6D00`, upper/lower `#2196F3` | bg @95 |
| Fisher Transform | fisher `#2196F3`, trigger `#FF6D00` | level bands -1.5 (`#E91E63` dashed) … |
| Guppy Multiple Moving Average | investor ema 1-6 `#FF0000` transparency 15,12,9,6,3,0; trader ema 1-6 (blue) | — |
| Historical Volatility | plot `#2196F3` | — |
| Hull Moving Average | plot `#2196F3` | — |
| Ichimoku Cloud | conversion `#2196F3`, base `#801922`, lagging `#43A047`, lead A `#A5D6A7`, lead B `#FAA1A4` | plots background `#000080` @90 |
| Keltner Channels | upper/middle/lower `#2196F3` | bg @95 |
| Klinger Oscillator | plot `#2196F3`, signal `#43A047` | — |
| Know Sure Thing | kst `#089981`, signal `#F23645` | zero 0 dashed |
| Least Squares Moving Average | plot `#2196F3` | — |
| Linear Regression Curve | plot `#2196F3` | — |
| Linear Regression Slope | plot `#FF5252` | — |
| MA Cross | long:plot `#FF6D00`, short:plot `#43A047`, crosses `#2196F3` cross width 4 | — |
| MA with EMA Cross | ma `#FF6D00`, ema `#43A047`, crosses `#2196F3` width 4 | — |
| MACD | histogram `#FF5252` columns, macd `#2196F3`, signal `#FF6D00` | — |
| Majority Rule | majority rule `#FF5252` | — |
| Mass Index | plot `#2196F3` | — |
| McGinley Dynamic | plot `#2196F3` | — |
| Median Price | plot `#FF6D00` | — |
| Momentum | mom `#2196F3` | zero 0 dashed |
| Money Flow Index | plot `#7E57C2` | upper 80 / lower 20, bg `#7E57C2` @90 |
| Moving Average | plot `#2196F3`; smoothed ma hidden | — |
| Moving Average Adaptive | plot 1 `#AB47BC` | — |
| Moving Average Channel | upper `#2196F3`, lower `#FF6D00` | bg @90 |
| Moving Average Double | plot 1 `#FF6D00`, plot 2 `#2196F3` | — |
| Moving Average Exponential | plot `#2196F3`; smoothed ma hidden | — |
| Moving Average Hamming | plot 1 `#4CAF50` | — |
| Moving Average Multiple | plots 1-6 `#9C27B0`, `#FF6D00`, `#43A047`, `#26C6DA`, `#F50057`, `#2196F3` | — |
| Moving Average Triple | plot 1 `#FF6D00`, plot 2 `#2196F3`, plot 3 `#26C6DA` | — |
| Moving Average Weighted | plot `#2196F3` | — |
| Net Volume | plot `#2196F3` | — |
| On Balance Volume | plot `#2196F3`; smoothed ma hidden | — |
| Parabolic SAR | plot `#2196F3` **cross** | — |
| Price Channel | highprice/lowprice `#F50057`, centerprice `#2196F3` | — |
| Price Oscillator | plot `#089981` | — |
| Price Volume Trend | pvt `#2196F3` | — |
| Rank Correlation Index | rci `#2196F3` | zero line dashed |
| Rate Of Change | roc `#2196F3` | zero line dashed |
| Ratio / Spread | plot `#800080` width 2 @35; baseline hidden; positive/negative fills | — |
| Relative Strength Index | plot `#7E57C2`; smoothed ma hidden | upper 70 / middle 50 / lower 30 dashed, bg `#7E57C2` @90 |
| Relative Vigor Index | rvgi `#089981`, signal `#F23645` | — |
| Relative Volatility Index | plot `#7E57C2` | upper 80 / lower 20, bg @90 |
| SMI Ergodic Indicator/Oscillator | indicator `#2196F3`, signal `#FF6D00`, oscillator `#FF5252` histogram | — |
| Smoothed Moving Average | plot `#673AB7` | — |
| Standard Deviation | plot `#089981` | — |
| Standard Error | plot `#FF6D00` | — |
| Standard Error Bands | plot 1 `#2196F3`, plot 2 `#FF6D00`, plot 3 `#2196F3` | background `#2196F3` @95 |
| Stochastic | %k `#2196F3`, %d `#FF6D00` | upper 80 / lower 20 dashed, bg `#2196F3` @90 |
| Stochastic RSI | %k `#2196F3`, %d `#FF6D00` | upper 80 / lower 20, bg @90 |
| SuperTrend | supertrend `#000080` width 3 @35; up arrow `#00FF00` BelowBar; down arrow `#FF0000` AboveBar | — |
| Trend Strength Index | plot `#FF5252` | — |
| Triple EMA | plot `#2196F3` | — |
| TRIX | trix `#F23645` | zero 0 dashed |
| Typical Price | plot `#FF6D00` | — |
| Ultimate Oscillator | uo `#F23645` | — |
| Volatility Index | plot `#FF5252` | — |
| Volatility O-H-L-C | plot `#FF5252` | — |
| Volatility Zero Trend Close-to-Close | plot `#2196F3` | — |
| Volume | volume `#000080` columns @50 (palette color.0 down / color.1 up); volume ma hidden | — |
| Volume Oscillator | plot `#2196F3` | zero 0 dashed |
| Volume Profile Fixed/Visible Range | developing poc / va high / va low step_line hidden | — |
| Vortex Indicator | vi + `#2196F3`, vi - `#E91E63` | — |
| VWAP | vwap `#2196F3` | — |
| VWMA | plot `#2196F3` | — |
| Williams %R | plot `#7E57C2` | upper -20 / lower -80, bg `#7E57C2` @90 |
| Williams Alligator | jaw `#2196F3`, teeth `#E91E63`, lips `#66BB6A` | — |
| Williams Fractal | down fractals `#F23645` triangle_down BelowBar; up fractals `#089981` triangle_up AboveBar | — |
| Zig Zag | plot `#2196F3` width 2 | — |
| Compare | plot `#9C27B0` width 2 | — |
| Overlay | style 2 (Line), showPriceLine false, minTick default | — |

Study metainfo fields used by every built-in (`RawStudyMetaInfo`): `id`, `name`, `description` (= createStudy name), `shortDescription` (legend), `is_price_study`, `is_hidden_study`, `format` (`{type:'price'|'volume'|'percent', precision}` or `inherit`), `plots` (`{id, type: 'line'|'shapes'|'chars'|'colorer'|'bar_colorer'|'bg_colorer'|'ohlc_open/high/low/close'|'ohlc_colorer'|'wick_colorer'|'border_colorer', target?, palette?}`), `defaults.styles` (per plot: `linestyle, linewidth, plottype, trackPrice, transparency, visible, color, display, showLast`), `defaults.inputs`, `defaults.bands`, `defaults.filledAreasStyle`, `defaults.palettes`, `bands` (`{id, name}` horizontal levels), `filledAreas` (`{id, objAId, objBId, type: 'plot_plot'|'plot_band'|'hline_hline', title, isHidden}`), `palettes`, `inputs` (`{id, name, type: 'integer'|'float'|'bool'|'text'|'source'|'symbol'|'resolution'|'session'|'time'|'color', defval, min, max, options}`), `precision`, `scale`/`linkedToSeries`.

---

## 7. Appendix B — Help-Center URL index (verified live 2026-09-04)

Base `https://www.tradingview.com/support/solutions/`:
43000668584 24-hour Volume · 43000501770 Accumulation Distribution · 43000589092 A/D Line · 43000589093 A/D Ratio · 43000644914 A/D Ratio (Bars) · 43000594683 ALMA · 43000501801 Aroon · 43000773004 Aroon Oscillator · 43000612397 Auto Fib Extension · 43000585089 Auto Fib Retracement · 43000783958 Auto key levels · 43000657911 Auto Pitchfork · 43000741165 Auto Trendlines · 43000695003 ADR · 43000589099 ADX · 43000501823 ATR · 43000501826 AO · 43000589100 BOP · 43000726749 BBTrend · 43000501840 BB · 43000501971 BB %b · 43000501972 BBW · 43000742575 Bollinger Bars · 43000717955 Bull Bear Power · 43000501974 CMF · 43000501979 Chaikin Osc · 43000589105 Chande Kroll Stop · 43000589109 CMO · 43000773013 Chandelier Exit · 43000589111 Chop Zone · 43000501980 CHOP · 43000502001 CCI · 43000502017 Connors RSI · 43000589114 Coppock · 43000502022 Correlation Coefficient · 43000725058 CVD · 43000589126 CVI · 43000502246 DPO · 43000502250 DMI · 43000502253 Donchian · 43000589132 DEMA · 43000502256 EOM · 43000502259 EFI · 43000502260 Envelope · 43000592270 EMA · 43000589141 Fisher · 43000675999 Gaps · 43000589145 Historical Volatility · 43000589149 HMA · 43000589152 Ichimoku · 43000773012 KAMA · 43000502266 KC · 43000589157 Klinger · 43000502329 KST · 43000599877 LSMA · 43000644936 Linear Regression · 43000599879 MA Cross · 43000589169 Mass Index · 43000589175 McGinley · 43000644897 Median · 43000589187 Momentum · 43000502348 MFI · 43000599884 Moon Phases · 43000502344 MACD · 43000644913 MA Ribbon · 43000502589 Moving Averages · 43000599885 MovingAvg Cross · 43000599886 MovingAvg2Line Cross · 43000502591 Multi-Time Period Charts · 43000773005 NVI · 43000589192 Net Volume · 43000502593 OBV · 43000685269 Open Interest · 43000502597 Parabolic SAR · 43000502346 PPO · 43000591350 PVO · 43000736064 Performance · 43000589195 Pivot Points High Low · 43000521824 Pivot Points Standard · 43000773006 PVI · 43000773010 PMO · 43000502345 PVT · 43000773011 Pring's Special K · 43000765570 RCI · 43000502343 ROC · 43000765571 RCI Ribbon · 43000502338 RSI · 43000591593 RVGI · 43000594684 Relative Volatility Index · 43000705489 Relative Volume at Time · 43000591333 / 43000591336 / 43000594546 / 43000594678 / 43000599840 / 43000594679 Rob Booker · 43000589127 RSI divergence · 43000723025 Seasonality · 43000696841 SMA · 43000594669 SMI Ergodic Indicator · 43000594671 SMI Ergodic Oscillator · 43000591343 SMMA · 43000502332 Stochastic · 43000707882 SMI · 43000502333 Stoch RSI · 43000634738 Supertrend · 43000614331 Technical Ratings · 43000692939 TWAP · 43000729030 Trading Sessions · 43000730926 Trend Strength Index · 43000591346 Triple EMA · 43000502331 TRIX · 43000592290 TSI · 43000773115 Ulcer Index · 43000502328 UO · 43000672561 Up/Down Volume · 43000678766 Visible Average Price · 43000594676 Volatility Stop · 43000591617 Volume · 43000725057 Volume Delta · 43000502018 VWAP · 43000592293 VWMA · 43000591352 Vortex · 43000652199 VWAP Auto Anchored · 43000594680 WMA · 43000501985 Williams %R · 43000592305 Alligator · 43000591663 Williams Fractal · 43000594673 Woodies CCI · 43000591664 Zig Zag · 43000502040 Volume Profile basics · 43000703076 VRVP · 43000480324 FRVP · 43000703072 SVP · 43000745275 SVP charts · 43000703071 PVP · 43000703077 AAVP · 43000742042 Smoothing section · 43000591555 Timeframe/gaps options · 43000481659 built-in source access.
Charting library: `/charting-library-docs/latest/ui_elements/indicators/Indicators-List/`, `/customization/overrides/indicator-overrides/`, `/api/interfaces/Charting_Library.<Study>IndicatorOverrides/`, `/api/enums/Charting_Library.LineStudyPlotStyle/`, `.LineStyle`, `.MarkLocation`, `.PlotSymbolSize`.

---

## 8. Appendix C — What could not be verified online (implementation risk list)

1. **Exact default hex colors of the current Pine builds** for: Balance of Power, Bull Bear Power, BBTrend, Chande Kroll Stop, Coppock Curve, Correlation Coefficient (default symbol), Fisher hlines, Median, Net Volume plot style, Pivot Points Standard level colors, Relative Volume at Time, Rolling VWAP bands, SMI fills, Technical Ratings column colors, Up/Down Volume delta style, Volatility Stop, Volume Delta/CVD candles, Woodies CCI hlines, Auto Fib level colors, Trading Sessions defaults. All are marked `(verify)` in place; open each built-in in the Pine Editor to confirm.
2. **Defaults** for: Aroon Oscillator length, ADR length, Chandelier Exit (22/22/3), KAMA (10/2/30), PVO (12/26/9), PMO (35/20/10), RCI length (9) and RCI Ribbon (9/26/52), Trend Strength Index length (14), Ulcer Index length (14), Gaps max count, Zig Zag deviation (5 vs 3 in one Help-Center table), MA with EMA Cross length, library-only MA Double/Triple/Multiple/Hamming/Channel lengths, Standard Error length, Majority Rule length, Rolling VWAP auto-window table.
3. **`ta.ema` seeding** (SMA seed per reference vs. first-value seed reported by third parties) — run a parity test on the first `length` bars.
4. **`ta.hma` rounding** (`math.round` per reference vs `math.floor` in the older built-in script).
5. **Percentile/median even-window behaviour**, `highestbars` tie-breaking, `pivothigh` equality handling.
6. **Volume Profile**: default Row Size (24), Width %, POC tie rule, exact volume-splitting across rows for an LTF bar, HD row adaptation; VWAP Auto Anchored anchor-bar search details. Not reproducible bit-for-bit without TradingView's engine; document as best-effort.
7. Formulas that are not published at all: Rob Booker family (except Reversal/Intraday Pivots compositions), Chart Patterns, Auto Trendlines scoring details, Knoxville Divergence internals.

## 9. Appendix D — Implementation checklist for the JS port

1. Implement section 2 primitives with Pine semantics (NaN propagation, SMA-seeded EMA/RMA, population stdev, `dev` = mean absolute deviation, `tr(true)`, `sar` two-bar clamp, `supertrend` band carry-over, `vwap` anchored sums with variance floor at 0).
2. Implement a `study` descriptor per indicator: `{name, shortName, libraryName, overlay, format, precision, inputs[], plots[], hlines[], fills[], compute(bars, inputs) -> series[]}` mirroring section 3, with default style tables from Appendix A (library) and the Pine hex values (website look).
3. Legend renderer: `title + inputs(non data-window) + values` with plot colors; status-line precision from `precision`/`format`.
4. Pane manager: overlay vs new pane; autoscale includes hlines; `offset` shifts drawing; `display.none` plots omitted from legend/pane but present in the data window.
5. Timeframe group: HTF request with "wait for close" gaps ON by default.
6. Volume guard: raise/notify "No volume is provided by the data vendor." when cumulative volume is 0 on the last bar for volume-based studies.
7. Test harness: compare against TradingView exports (Data Window values) for RSI, MACD, BB, Stochastic, ATR, ADX/DMI, Ichimoku, SAR, Supertrend, VWAP, CCI, MFI, W%R, KC, DC, HMA, ALMA, Fisher, CHOP, KST, TRIX, TSI, UO, Vortex, Alligator, Fractals on at least one intraday and one daily symbol, first-500-bar window (seeding) and steady-state window.

---

## 10. Reference JavaScript implementations of the `ta.*` primitives

Conventions: every function takes plain `number[]` series (chronological), returns a `number[]` of the same length with `NaN` where Pine returns `na`. `bars` is `{open, high, low, close, volume, time}` arrays. Helper `isNa = v => v !== v`. These follow the Pine reference equivalents in section 2 line by line; window functions return NaN until `len` values exist and NaN whenever a NaN falls inside the window (the simplest faithful behaviour; add the "skip na" variant only if you need parity on gappy data).

```js
const NA = NaN, isNa = v => v !== v;
const nz = (v, d = 0) => (isNa(v) ? d : v);
const prev = (arr, i, k = 1) => (i - k >= 0 ? arr[i - k] : NA);

// ---- windowed sums ---------------------------------------------------------
function sum(src, len) {                       // math.sum
  const out = new Array(src.length).fill(NA);
  let acc = 0, bad = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i]; if (isNa(v)) bad++; else acc += v;
    if (i >= len) { const o = src[i - len]; if (isNa(o)) bad--; else acc -= o; }
    if (i >= len - 1 && bad === 0) out[i] = acc;
  }
  return out;
}
function sma(src, len) { return sum(src, len).map(v => v / len); }

// ---- recursive averages (SMA-seeded, per Pine reference) --------------------
function seededRecursive(src, len, alpha) {
  const out = new Array(src.length).fill(NA);
  const seed = sma(src, len);
  let s = NA;
  for (let i = 0; i < src.length; i++) {
    if (isNa(s)) { if (!isNa(seed[i])) s = seed[i]; }
    else s = alpha * src[i] + (1 - alpha) * s;
    out[i] = s;
  }
  return out;
}
const ema = (src, len) => seededRecursive(src, len, 2 / (len + 1));
const rma = (src, len) => seededRecursive(src, len, 1 / len);    // Wilder / SMMA

function wma(src, len) {
  const out = new Array(src.length).fill(NA), norm = len * (len + 1) / 2;
  for (let i = len - 1; i < src.length; i++) {
    let s = 0, ok = true;
    for (let k = 0; k < len; k++) { const v = src[i - k]; if (isNa(v)) { ok = false; break; } s += v * (len - k); }
    if (ok) out[i] = s / norm;
  }
  return out;
}
function vwma(src, vol, len) {
  const a = sma(src.map((v, i) => v * vol[i]), len), b = sma(vol, len);
  return a.map((v, i) => v / b[i]);
}
function swma(src) {
  return src.map((_, i) => i < 3 ? NA : src[i-3]/6 + src[i-2]*2/6 + src[i-1]*2/6 + src[i]/6);
}
function hma(src, len) {
  const half = Math.trunc(len / 2), sq = Math.round(Math.sqrt(len));
  const w1 = wma(src, half), w2 = wma(src, len);
  return wma(w1.map((v, i) => 2 * v - w2[i]), sq);
}
function alma(src, len, offset, sigma, floor = false) {
  let m = offset * (len - 1); if (floor) m = Math.floor(m);
  const s = len / sigma, w = [];
  let norm = 0;
  for (let i = 0; i < len; i++) { const wt = Math.exp(-((i - m) ** 2) / (2 * s * s)); w.push(wt); norm += wt; }
  const out = new Array(src.length).fill(NA);
  for (let i = len - 1; i < src.length; i++) {
    let acc = 0, ok = true;
    for (let k = 0; k < len; k++) { const v = src[i - (len - 1 - k)]; if (isNa(v)) { ok = false; break; } acc += v * w[k]; } // k=0 oldest
    if (ok) out[i] = acc / norm;
  }
  return out;
}
function linregAt(src, i, len, offset = 0) {
  if (i < len - 1) return NA;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = 0; k < len; k++) { const x = k, y = src[i - len + 1 + k]; if (isNa(y)) return NA; sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const slope = (len * sxy - sx * sy) / (len * sxx - sx * sx);
  const intercept = (sy - slope * sx) / len;
  return intercept + slope * (len - 1 - offset);
}
const linreg = (src, len, offset = 0) => src.map((_, i) => linregAt(src, i, len, offset));

// ---- statistics ---------------------------------------------------------------
function stdev(src, len, biased = true) {
  const mean = sma(src, len), out = new Array(src.length).fill(NA);
  for (let i = len - 1; i < src.length; i++) {
    if (isNa(mean[i])) continue;
    let ss = 0; for (let k = 0; k < len; k++) { const d = src[i - k] - mean[i]; ss += Math.abs(d) < 1e-10 ? 0 : d * d; }
    out[i] = Math.sqrt(ss / (biased ? len : len - 1));
  }
  return out;
}
const variance = (src, len, biased = true) => stdev(src, len, biased).map(v => v * v);
function dev(src, len) {                          // mean absolute deviation
  const mean = sma(src, len), out = new Array(src.length).fill(NA);
  for (let i = len - 1; i < src.length; i++) {
    if (isNa(mean[i])) continue;
    let s = 0; for (let k = 0; k < len; k++) s += Math.abs(src[i - k] - mean[i]);
    out[i] = s / len;
  }
  return out;
}
function correlation(a, b, len) {
  const out = new Array(a.length).fill(NA);
  for (let i = len - 1; i < a.length; i++) {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, ok = true;
    for (let k = 0; k < len; k++) { const x = a[i - k], y = b[i - k]; if (isNa(x) || isNa(y)) { ok = false; break; }
      sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; }
    if (!ok) continue;
    const cov = sab / len - (sa / len) * (sb / len);
    const va = saa / len - (sa / len) ** 2, vb = sbb / len - (sb / len) ** 2;
    out[i] = va <= 0 || vb <= 0 ? NA : cov / Math.sqrt(va * vb);
  }
  return out;
}
function percentrank(src, len) {
  return src.map((v, i) => { if (i < len || isNa(v)) return NA; let c = 0;
    for (let k = 1; k <= len; k++) { const p = src[i - k]; if (isNa(p)) return NA; if (p <= v) c++; }
    return 100 * c / len; });
}
function windowSorted(src, i, len) {
  if (i < len - 1) return null; const w = [];
  for (let k = 0; k < len; k++) { const v = src[i - k]; if (isNa(v)) return null; w.push(v); }
  return w.sort((x, y) => x - y);
}
const percentileNearestRank = (src, len, pct) => src.map((_, i) => { const w = windowSorted(src, i, len); if (!w) return NA;
  const n = Math.max(1, Math.ceil(pct / 100 * len)); return w[n - 1]; });
const percentileLinear = (src, len, pct) => src.map((_, i) => { const w = windowSorted(src, i, len); if (!w) return NA;
  const r = pct / 100 * (len - 1), lo = Math.floor(r), hi = Math.ceil(r); return w[lo] + (r - lo) * (w[hi] - w[lo]); });
const median = (src, len) => src.map((_, i) => { const w = windowSorted(src, i, len); if (!w) return NA;
  const m = len >> 1; return len % 2 ? w[m] : (w[m - 1] + w[m]) / 2; });
function mode(src, len) { return src.map((_, i) => { const w = windowSorted(src, i, len); if (!w) return NA;
  let best = w[0], bestC = 0, cur = w[0], c = 0;
  for (const v of w) { if (v === cur) c++; else { if (c > bestC) { bestC = c; best = cur; } cur = v; c = 1; } }
  if (c > bestC) best = cur; return best; }); }
const range = (src, len) => src.map((_, i) => { const w = windowSorted(src, i, len); return w ? w[len - 1] - w[0] : NA; });

// ---- highest / lowest ------------------------------------------------------------
function highestBars(src, len) {                   // 0 or negative offset; ties -> most recent
  return src.map((_, i) => { if (i < len - 1) return NA; let best = -Infinity, off = 0;
    for (let k = 0; k < len; k++) { const v = src[i - k]; if (isNa(v)) return NA; if (v > best) { best = v; off = -k; } }
    return off; });
}
function lowestBars(src, len) {
  return src.map((_, i) => { if (i < len - 1) return NA; let best = Infinity, off = 0;
    for (let k = 0; k < len; k++) { const v = src[i - k]; if (isNa(v)) return NA; if (v < best) { best = v; off = -k; } }
    return off; });
}
const highest = (src, len) => highestBars(src, len).map((o, i) => isNa(o) ? NA : src[i + o]);
const lowest  = (src, len) => lowestBars(src, len).map((o, i) => isNa(o) ? NA : src[i + o]);

// ---- change / cum / roc ---------------------------------------------------------
const change = (src, len = 1) => src.map((v, i) => i < len ? NA : v - src[i - len]);
const mom = change;
const roc = (src, len) => src.map((v, i) => i < len ? NA : 100 * (v - src[i - len]) / src[i - len]);
function cum(src) { let s = 0; return src.map(v => (s += nz(v))); }
const crossover  = (a, b) => a.map((v, i) => i > 0 && v > b[i] && a[i - 1] <= b[i - 1]);
const crossunder = (a, b) => a.map((v, i) => i > 0 && v < b[i] && a[i - 1] >= b[i - 1]);
const cross = (a, b) => crossover(a, b).map((c, i) => c || crossunder(a, b)[i]);
function barssince(cond) { let last = -1; return cond.map((c, i) => { if (c) last = i; return last < 0 ? NA : i - last; }); }
function valuewhen(cond, src, occurrence = 0) {
  const hits = []; return cond.map((c, i) => { if (c) hits.push(src[i]); const n = hits.length - 1 - occurrence; return n >= 0 ? hits[n] : NA; });
}

// ---- pivots ----------------------------------------------------------------------
function pivotHigh(src, left, right) {             // value placed on the CONFIRMING bar (p + right)
  return src.map((_, i) => { const p = i - right; if (p - left < 0) return NA; const v = src[p];
    if (isNa(v)) return NA;
    for (let k = 1; k <= left; k++)  if (!(src[p - k] < v)) return NA;
    for (let k = 1; k <= right; k++) if (!(src[p + k] < v)) return NA;   // equality on the right => not a pivot
    return v; });
}
function pivotLow(src, left, right) {
  return src.map((_, i) => { const p = i - right; if (p - left < 0) return NA; const v = src[p];
    if (isNa(v)) return NA;
    for (let k = 1; k <= left; k++)  if (!(src[p - k] > v)) return NA;
    for (let k = 1; k <= right; k++) if (!(src[p + k] > v)) return NA;
    return v; });
}

// ---- true range / ATR ------------------------------------------------------------
function tr(bars, handleNa = false) {
  const { high: h, low: l, close: c } = bars;
  return h.map((_, i) => i === 0 ? (handleNa ? h[0] - l[0] : NA)
    : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
}
const atr = (bars, len) => rma(tr(bars, true), len);

// ---- oscillators -----------------------------------------------------------------
function rsi(src, len) {
  const ch = change(src);
  const up = rma(ch.map(v => isNa(v) ? NA : Math.max(v, 0)), len);
  const dn = rma(ch.map(v => isNa(v) ? NA : Math.max(-v, 0)), len);
  return up.map((u, i) => { const d = dn[i]; if (isNa(u) || isNa(d)) return NA; return d === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / d); });
}
function stoch(src, high, low, len) {
  const hh = highest(high, len), ll = lowest(low, len);
  return src.map((v, i) => 100 * (v - ll[i]) / (hh[i] - ll[i]));
}
function cci(src, len) { const m = sma(src, len), d = dev(src, len); return src.map((v, i) => (v - m[i]) / (0.015 * d[i])); }
function mfi(src, vol, len) {
  const ch = change(src);
  const up = sum(src.map((v, i) => isNa(ch[i]) ? NA : (ch[i] <= 0 ? 0 : v) * vol[i]), len);
  const dn = sum(src.map((v, i) => isNa(ch[i]) ? NA : (ch[i] >= 0 ? 0 : v) * vol[i]), len);
  return up.map((u, i) => 100 - 100 / (1 + u / dn[i]));
}
function cmo(src, len) {
  const m = change(src);
  const s1 = sum(m.map(v => isNa(v) ? NA : (v >= 0 ? v : 0)), len), s2 = sum(m.map(v => isNa(v) ? NA : (v >= 0 ? 0 : -v)), len);
  return s1.map((a, i) => 100 * (a - s2[i]) / (a + s2[i]));
}
function cog(src, len) { const s = sum(src, len); return src.map((_, i) => { if (isNa(s[i])) return NA; let num = 0;
  for (let k = 0; k < len; k++) num += src[i - k] * (k + 1); return -num / s[i]; }); }
function tsi(src, shortLen, longLen) {
  const pc = change(src), ds = ema(ema(pc, longLen), shortLen), da = ema(ema(pc.map(Math.abs), longLen), shortLen);
  return ds.map((v, i) => 100 * v / da[i]);
}
function wpr(bars, len) { const hh = highest(bars.high, len), ll = lowest(bars.low, len);
  return bars.close.map((c, i) => 100 * (c - hh[i]) / (hh[i] - ll[i])); }

function macd(src, fast, slow, sig) { const m = ema(src, fast).map((v, i) => v - ema(src, slow)[i]);
  const s = ema(m, sig); return { macd: m, signal: s, hist: m.map((v, i) => v - s[i]) }; }
function bb(src, len, mult) { const b = sma(src, len), d = stdev(src, len).map(v => v * mult);
  return { basis: b, upper: b.map((v, i) => v + d[i]), lower: b.map((v, i) => v - d[i]) }; }
const bbw = (src, len, mult) => { const { basis, upper, lower } = bb(src, len, mult); return upper.map((u, i) => (u - lower[i]) / basis[i]); };
function kc(bars, src, len, mult, useTR = true) {
  const basis = ema(src, len), span = useTR ? tr(bars) : bars.high.map((h, i) => h - bars.low[i]);
  const re = ema(span, len);
  return { basis, upper: basis.map((b, i) => b + re[i] * mult), lower: basis.map((b, i) => b - re[i] * mult) };
}

// ---- DMI / ADX ------------------------------------------------------------------
function dmi(bars, diLen, adxLen) {
  const up = change(bars.high), down = change(bars.low).map(v => -v);
  const plusDM = up.map((u, i) => isNa(u) ? NA : (u > down[i] && u > 0 ? u : 0));
  const minusDM = down.map((d, i) => isNa(d) ? NA : (d > up[i] && d > 0 ? d : 0));
  const trur = rma(tr(bars, false), diLen);
  const fixnan = arr => { let last = NA; return arr.map(v => (isNa(v) ? last : (last = v))); };
  const plus = fixnan(rma(plusDM, diLen).map((v, i) => 100 * v / trur[i]));
  const minus = fixnan(rma(minusDM, diLen).map((v, i) => 100 * v / trur[i]));
  const dx = plus.map((p, i) => { const s = p + minus[i]; return Math.abs(p - minus[i]) / (s === 0 ? 1 : s); });
  return { plus, minus, adx: rma(dx, adxLen).map(v => 100 * v) };
}

// ---- Parabolic SAR (exact port of pine_sar) ---------------------------------------
function sar(bars, start, inc, max) {
  const { high, low, close } = bars, out = new Array(high.length).fill(NA);
  let result = NA, maxMin = NA, acc = NA, isBelow = false;
  for (let i = 1; i < high.length; i++) {
    let first = false;
    if (i === 1) {
      if (close[1] > close[0]) { isBelow = true; maxMin = high[1]; result = low[0]; }
      else { isBelow = false; maxMin = low[1]; result = high[0]; }
      first = true; acc = start;
    }
    result = result + acc * (maxMin - result);
    if (isBelow) { if (result > low[i]) { first = true; isBelow = false; result = Math.max(high[i], maxMin); maxMin = low[i]; acc = start; } }
    else        { if (result < high[i]) { first = true; isBelow = true;  result = Math.min(low[i], maxMin);  maxMin = high[i]; acc = start; } }
    if (!first) {
      if (isBelow) { if (high[i] > maxMin) { maxMin = high[i]; acc = Math.min(acc + inc, max); } }
      else         { if (low[i] < maxMin)  { maxMin = low[i];  acc = Math.min(acc + inc, max); } }
    }
    if (isBelow) { result = Math.min(result, low[i - 1]); if (i > 1) result = Math.min(result, low[i - 2]); }
    else         { result = Math.max(result, high[i - 1]); if (i > 1) result = Math.max(result, high[i - 2]); }
    out[i] = result;
  }
  return out;
}

// ---- Supertrend (exact port of pine_supertrend) ------------------------------------
function supertrend(bars, factor, atrPeriod) {
  const src = bars.high.map((h, i) => (h + bars.low[i]) / 2), a = atr(bars, atrPeriod), n = src.length;
  const st = new Array(n).fill(NA), dir = new Array(n).fill(NA);
  let prevUpper = 0, prevLower = 0, prevST = NA;
  for (let i = 0; i < n; i++) {
    let upper = src[i] + factor * a[i], lower = src[i] - factor * a[i];
    const c1 = i > 0 ? bars.close[i - 1] : NA;
    lower = (lower > prevLower || c1 < prevLower) ? lower : prevLower;
    upper = (upper < prevUpper || c1 > prevUpper) ? upper : prevUpper;
    let d;
    if (i === 0 || isNa(a[i - 1])) d = 1;
    else if (prevST === prevUpper) d = bars.close[i] > upper ? -1 : 1;
    else d = bars.close[i] < lower ? 1 : -1;
    st[i] = d === -1 ? lower : upper; dir[i] = d;
    prevUpper = isNa(upper) ? 0 : upper; prevLower = isNa(lower) ? 0 : lower; prevST = st[i];
  }
  return { supertrend: st, direction: dir };
}

// ---- anchored VWAP with stdev bands -------------------------------------------------
function vwap(src, vol, isNewPeriod, stdevMult = 1) {
  const n = src.length, v = new Array(n).fill(NA), up = new Array(n).fill(NA), dn = new Array(n).fill(NA);
  let sSV = 0, sV = 0, sSSV = 0;
  for (let i = 0; i < n; i++) {
    if (isNewPeriod[i]) { sSV = 0; sV = 0; sSSV = 0; }
    sSV += src[i] * vol[i]; sV += vol[i]; sSSV += vol[i] * src[i] * src[i];
    const w = sSV / sV, varc = Math.max(0, sSSV / sV - w * w), sd = Math.sqrt(varc);
    v[i] = w; up[i] = w + stdevMult * sd; dn[i] = w - stdevMult * sd;
  }
  return { vwap: v, upper: up, lower: dn };
}

// ---- volume primitives -----------------------------------------------------------
const accdist = b => cum(b.close.map((c, i) => { const r = b.high[i] - b.low[i]; return r === 0 ? 0 : ((c - b.low[i]) - (b.high[i] - c)) / r * b.volume[i]; }));
const obv = b => cum(change(b.close).map((c, i) => isNa(c) ? 0 : Math.sign(c) * b.volume[i]));
const pvt = b => cum(change(b.close).map((c, i) => isNa(c) ? 0 : c / b.close[i - 1] * b.volume[i]));
const wad = b => cum(b.close.map((c, i) => { if (i === 0) return 0; const th = Math.max(b.high[i], b.close[i - 1]), tl = Math.min(b.low[i], b.close[i - 1]);
  const m = c - b.close[i - 1]; return m > 0 ? c - tl : m < 0 ? c - th : 0; }));
const wvad = b => b.close.map((c, i) => (c - b.open[i]) / (b.high[i] - b.low[i]) * b.volume[i]);
const iii = b => b.close.map((c, i) => (2 * c - b.high[i] - b.low[i]) / ((b.high[i] - b.low[i]) * b.volume[i]));
function nvi(b, initial = 1.0) { let x = initial; return b.close.map((c, i) => { if (i === 0) return x;
  const p = isNa(x) || x === 0 ? initial : x; if (!c || !b.close[i - 1]) return (x = p);
  return (x = b.volume[i] < nz(b.volume[i - 1]) ? p + (c - b.close[i - 1]) / b.close[i - 1] * p : p); }); }
function pvi(b, initial = 1.0) { let x = initial; return b.close.map((c, i) => { if (i === 0) return x;
  const p = isNa(x) || x === 0 ? initial : x; if (!c || !b.close[i - 1]) return (x = p);
  return (x = b.volume[i] > nz(b.volume[i - 1]) ? p + (c - b.close[i - 1]) / b.close[i - 1] * p : p); }); }
```

Notes for parity testing:
* `rma`/`ema` produce NaN for the first `len-1` bars, exactly like TradingView's Data Window (RSI 14 first value on bar 14, i.e. the 15th bar, because `change` consumes one bar).
* `dmi` uses `tr(bars,false)` (NaN on bar 0) whereas `atr` uses `tr(bars,true)`; this shifts the DMI seed by one bar relative to ATR — TradingView does the same.
* `stdev` zeroes out |deviation| < 1e-10 as the reference `isZero` helper does; population divisor by default.
* `vwap` resets all three sums on anchor bars; the built-in forces `isNewPeriod=true` on the first bar with a non-na previous source.

---

## 11. Pine-equivalent listings of the core built-ins (port these literally)

These are reconstructions of the published built-in scripts (status `[S]`; open the built-in in the Pine Editor to diff). Comments mark lines whose exact value should be re-checked.

### 11.1 Relative Strength Index

```pine
//@version=6
indicator(title="Relative Strength Index", shorttitle="RSI", format=format.price, precision=2, timeframe="", timeframe_gaps=true)
rsiLengthInput = input.int(14, minval=1, title="RSI Length", group="RSI Settings")
rsiSourceInput = input.source(close, "Source", group="RSI Settings")
calculateDivergence = input.bool(false, title="Calculate Divergence", group="RSI Settings", display = display.data_window,
     tooltip = "Calculating divergences is needed in order for divergence alerts to fire.")

change = ta.change(rsiSourceInput)
up = ta.rma(math.max(change, 0), rsiLengthInput)
down = ta.rma(-math.min(change, 0), rsiLengthInput)
rsi = down == 0 ? 100 : up == 0 ? 0 : 100 - (100 / (1 + up / down))

rsiPlot = plot(rsi, "RSI", color=#7E57C2)
rsiUpperBand = hline(70, "RSI Upper Band", color=#787B86)
midline = hline(50, "RSI Middle Band", color=color.new(#787B86, 50))
rsiLowerBand = hline(30, "RSI Lower Band", color=#787B86)
fill(rsiUpperBand, rsiLowerBand, color=color.rgb(126, 87, 194, 90), title="RSI Background Fill")
midLinePlot = plot(50, color = na, editable = false, display = display.none)
fill(rsiPlot, midLinePlot, 100, 70, top_color = color.new(color.green, 0), bottom_color = color.new(color.green, 100), title = "Overbought Gradient Fill")
fill(rsiPlot, midLinePlot, 30,  0,  top_color = color.new(color.red, 100), bottom_color = color.new(color.red, 0), title = "Oversold Gradient Fill")

// Smoothing MA inputs
GRP = "Smoothing"
TT_BB = "Only applies when 'SMA + Bollinger Bands' is selected. Determines the distance between the SMA and the bands."
maTypeInput = input.string("None", "Type", options = ["None", "SMA", "SMA + Bollinger Bands", "EMA", "SMMA (RMA)", "WMA", "VWMA"], group = GRP, display = display.data_window)
maLengthInput = input.int(14, "Length", group = GRP, display = display.data_window)
bbMultInput = input.float(2.0, "BB StdDev", minval = 0.001, maxval = 50, step = 0.5, tooltip = TT_BB, group = GRP, display = display.data_window)
var enableMA = maTypeInput != "None"
var isBB = maTypeInput == "SMA + Bollinger Bands"

ma(source, length, MAtype) =>
    switch MAtype
        "SMA"                   => ta.sma(source, length)
        "SMA + Bollinger Bands" => ta.sma(source, length)
        "EMA"                   => ta.ema(source, length)
        "SMMA (RMA)"            => ta.rma(source, length)
        "WMA"                   => ta.wma(source, length)
        "VWMA"                  => ta.vwma(source, length)

smoothingMA = enableMA ? ma(rsi, maLengthInput, maTypeInput) : na
smoothingStDev = isBB ? ta.stdev(rsi, maLengthInput) * bbMultInput : na
plot(smoothingMA, "RSI-based MA", color=color.yellow, display = enableMA ? display.all : display.none, editable = enableMA)
bbUpperBand = plot(smoothingMA + smoothingStDev, title = "Upper Bollinger Band", color=color.green, display = isBB ? display.all : display.none, editable = isBB)
bbLowerBand = plot(smoothingMA - smoothingStDev, title = "Lower Bollinger Band", color=color.green, display = isBB ? display.all : display.none, editable = isBB)
fill(bbUpperBand, bbLowerBand, color= isBB ? color.new(color.green, 90) : na, title="Bollinger Bands Background Fill", display = isBB ? display.all : display.none, editable = isBB)

// Divergence
lookbackRight = 5
lookbackLeft = 5
rangeUpper = 60
rangeLower = 5
bearColor = color.red
bullColor = color.green
textColor = color.white
noneColor = color.new(color.white, 100)

_inRange(bool cond) =>
    bars = ta.barssince(cond)
    rangeLower <= bars and bars <= rangeUpper

plFound = false
phFound = false
bullCond = false
bearCond = false
rsiLBR = rsi[lookbackRight]
if calculateDivergence
    plFound := not na(ta.pivotlow(rsi, lookbackLeft, lookbackRight))
    phFound := not na(ta.pivothigh(rsi, lookbackLeft, lookbackRight))
    rsiHL = rsiLBR > ta.valuewhen(plFound, rsiLBR, 1) and _inRange(plFound[1])
    lowLBR = low[lookbackRight]
    priceLL = lowLBR < ta.valuewhen(plFound, lowLBR, 1)
    bullCond := priceLL and rsiHL and plFound
    rsiLH = rsiLBR < ta.valuewhen(phFound, rsiLBR, 1) and _inRange(phFound[1])
    highLBR = high[lookbackRight]
    priceHH = highLBR > ta.valuewhen(phFound, highLBR, 1)
    bearCond := priceHH and rsiLH and phFound

plot(plFound ? rsiLBR : na, offset=-lookbackRight, title="Regular Bullish", linewidth=2, color=(bullCond ? bullColor : noneColor), display = display.pane)
plotshape(bullCond ? rsiLBR : na, offset=-lookbackRight, title="Regular Bullish Label", text=" Bull ", style=shape.labelup, location=location.absolute, color=bullColor, textcolor=textColor, display = display.pane)
plot(phFound ? rsiLBR : na, offset=-lookbackRight, title="Regular Bearish", linewidth=2, color=(bearCond ? bearColor : noneColor), display = display.pane)
plotshape(bearCond ? rsiLBR : na, offset=-lookbackRight, title="Regular Bearish Label", text=" Bear ", style=shape.labeldown, location=location.absolute, color=bearColor, textcolor=textColor, display = display.pane)
alertcondition(bullCond, title='Regular Bullish Divergence', message="Found a new Regular Bullish Divergence, `Pivot Lookback Right` number of bars to the right of the point")
alertcondition(bearCond, title='Regular Bearish Divergence', message='Found a new Regular Bearish Divergence, `Pivot Lookback Right` number of bars to the right of the point')
```

### 11.2 MACD

```pine
//@version=6
indicator(title="Moving Average Convergence Divergence", shorttitle="MACD", timeframe="", timeframe_gaps=true)
fast_length = input(title = "Fast Length", defval = 12)
slow_length = input(title = "Slow Length", defval = 26)
src = input(title = "Source", defval = close)
signal_length = input.int(title = "Signal Smoothing",  minval = 1, maxval = 50, defval = 9, display = display.data_window)
sma_source = input.string(title = "Oscillator MA Type",  defval = "EMA", options = ["SMA", "EMA"], display = display.data_window)
sma_signal = input.string(title = "Signal Line MA Type", defval = "EMA", options = ["SMA", "EMA"], display = display.data_window)
fast_ma = sma_source == "SMA" ? ta.sma(src, fast_length) : ta.ema(src, fast_length)
slow_ma = sma_source == "SMA" ? ta.sma(src, slow_length) : ta.ema(src, slow_length)
macd = fast_ma - slow_ma
signal = sma_signal == "SMA" ? ta.sma(macd, signal_length) : ta.ema(macd, signal_length)
hist = macd - signal
alertcondition(hist[1] >= 0 and hist < 0, title = 'Rising to falling', message = 'The MACD switched from a rising to falling state')
alertcondition(hist[1] <= 0 and hist > 0, title = 'Falling to rising', message = 'The MACD switched from a falling to rising state')
hline(0, "Zero Line", color = color.new(#787B86, 50))
plot(hist, title = "Histogram", style = plot.style_columns, color = (hist >= 0 ? (hist[1] < hist ? #26A69A : #B2DFDB) : (hist[1] < hist ? #FFCDD2 : #FF5252)))
plot(macd,   title = "MACD",   color = #2962FF)
plot(signal, title = "Signal", color = #FF6D00)
```

### 11.3 Bollinger Bands

```pine
//@version=6
indicator(shorttitle="BB", title="Bollinger Bands", overlay=true, timeframe="", timeframe_gaps=true)
length = input.int(20, minval=1)
maType = input.string("SMA", "Basis MA Type", options = ["SMA", "EMA", "SMMA (RMA)", "WMA", "VWMA"])
src = input(close, title="Source")
mult = input.float(2.0, minval=0.001, maxval=50, title="StdDev")
ma(source, length, _type) =>
    switch _type
        "SMA" => ta.sma(source, length)
        "EMA" => ta.ema(source, length)
        "SMMA (RMA)" => ta.rma(source, length)
        "WMA" => ta.wma(source, length)
        "VWMA" => ta.vwma(source, length)
basis = ma(src, length, maType)
dev = mult * ta.stdev(src, length)
upper = basis + dev
lower = basis - dev
offset = input.int(0, "Offset", minval = -500, maxval = 500, display = display.data_window)
plot(basis, "Basis", color=#2962FF, offset = offset)
p1 = plot(upper, "Upper", color=#F23645, offset = offset)
p2 = plot(lower, "Lower", color=#089981, offset = offset)
fill(p1, p2, title = "Background", color=color.rgb(33, 150, 243, 95))
```

### 11.4 Stochastic and Stochastic RSI

```pine
//@version=6
indicator(title="Stochastic", shorttitle="Stoch", format=format.price, precision=2, timeframe="", timeframe_gaps=true)
periodK = input.int(14, title="%K Length", minval=1)
smoothK = input.int(1, title="%K Smoothing", minval=1)
periodD = input.int(3, title="%D Smoothing", minval=1)
k = ta.sma(ta.stoch(close, high, low, periodK), smoothK)
d = ta.sma(k, periodD)
plot(k, title="%K", color=#2962FF)
plot(d, title="%D", color=#FF6D00)
h0 = hline(80, "Upper Band", color=#787B86)
hline(50, "Middle Band", color=color.new(#787B86, 50))
h1 = hline(20, "Lower Band", color=#787B86)
fill(h0, h1, color=color.rgb(33, 150, 243, 90), title="Background")
```
```pine
//@version=6
indicator(title="Stochastic RSI", shorttitle="Stoch RSI", format=format.price, precision=2, timeframe="", timeframe_gaps=true)
smoothK = input.int(3, "K", minval=1)
smoothD = input.int(3, "D", minval=1)
lengthRSI = input.int(14, "RSI Length", minval=1)
lengthStoch = input.int(14, "Stochastic Length", minval=1)
src = input(close, title="RSI Source")
rsi1 = ta.rsi(src, lengthRSI)
k = ta.sma(ta.stoch(rsi1, rsi1, rsi1, lengthStoch), smoothK)
d = ta.sma(k, smoothD)
plot(k, "K", color=#2962FF)
plot(d, "D", color=#FF6D00)
h0 = hline(80, "Upper Band", color=#787B86)
hline(50, "Middle Band", color=color.new(#787B86, 50))
h1 = hline(20, "Lower Band", color=#787B86)
fill(h0, h1, color=color.rgb(33, 150, 243, 90), title="Background")
```

### 11.5 Volume

```pine
//@version=6
indicator(title="Volume", shorttitle="Vol", format=format.volume, timeframe="", timeframe_gaps=true)
showMA = input(false, "show MA")            // newer builds: input.bool(true?, "MA") + Smoothing group — verify
lengthInput = input.int(20, "MA Length")
colorBasedOnPrevClose = input.bool(false, "Color based on previous close")
palette = colorBasedOnPrevClose ? (close[1] > close ? #F7525F : #22AB94) : (open > close ? #F7525F : #22AB94)
plot(volume, "Volume", palette, style = plot.style_columns)
plot(showMA ? ta.sma(volume, lengthInput) : na, "Volume MA", style=plot.style_line, color=#2962FF)
```

### 11.6 VWAP (with anchor detection)

```pine
//@version=6
indicator(title="Volume Weighted Average Price", shorttitle="VWAP", overlay=true, timeframe="", timeframe_gaps=true)
hideonDWM = input(false, title="Hide VWAP on 1D or Above", group="VWAP Settings", display = display.data_window)
var anchor = input.string(defval = "Session", title="Anchor Period",
 options=["Session", "Week", "Month", "Quarter", "Year", "Decade", "Century", "Earnings", "Dividends", "Splits"], group="VWAP Settings")
src = input(title = "Source", defval = hlc3, group="VWAP Settings", display = display.data_window)
offset = input.int(0, title="Offset", group="VWAP Settings", minval=0, display = display.data_window)
BANDS_GROUP = "Bands Settings"
calcModeInput = input.string("Standard Deviation", "Bands Calculation Mode", options = ["Standard Deviation", "Percentage"], group = BANDS_GROUP, display = display.data_window)
showBand_1 = input(true, title = "", group = BANDS_GROUP, inline = "band_1", display = display.data_window)
bandMult_1 = input.float(1.0, title = "Bands Multiplier #1", group = BANDS_GROUP, inline = "band_1", step = 0.5, minval=0, display = display.data_window)
showBand_2 = input(false, title = "", group = BANDS_GROUP, inline = "band_2", display = display.data_window)
bandMult_2 = input.float(2.0, title = "Bands Multiplier #2", group = BANDS_GROUP, inline = "band_2", step = 0.5, minval=0, display = display.data_window)
showBand_3 = input(false, title = "", group = BANDS_GROUP, inline = "band_3", display = display.data_window)
bandMult_3 = input.float(3.0, title = "Bands Multiplier #3", group = BANDS_GROUP, inline = "band_3", step = 0.5, minval=0, display = display.data_window)

if barstate.islast and ta.cum(volume) == 0
    runtime.error("No volume is provided by the data vendor.")

new_earnings = request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_on, barmerge.lookahead_on, ignore_invalid_symbol=true)
new_dividends = request.dividends(syminfo.tickerid, dividends.gross, barmerge.gaps_on, barmerge.lookahead_on, ignore_invalid_symbol=true)
new_split = request.splits(syminfo.tickerid, splits.denominator, barmerge.gaps_on, barmerge.lookahead_on, ignore_invalid_symbol=true)
isNewPeriod = switch anchor
    "Earnings"  => not na(new_earnings)
    "Dividends" => not na(new_dividends)
    "Splits"    => not na(new_split)
    "Session"   => timeframe.change("D")
    "Week"      => timeframe.change("W")
    "Month"     => timeframe.change("M")
    "Quarter"   => timeframe.change("3M")
    "Year"      => timeframe.change("12M")
    "Decade"    => timeframe.change("12M") and year % 10 == 0
    "Century"   => timeframe.change("12M") and year % 100 == 0
    => false
isEsdAnchor = anchor == "Earnings" or anchor == "Dividends" or anchor == "Splits"
if na(src[1]) and not isEsdAnchor
    isNewPeriod := true

float vwapValue = na
float upperBandValue1 = na, float lowerBandValue1 = na   // ... 2, 3
if not (hideonDWM and timeframe.isdwm)
    [_vwap, _stdevUpper, _] = ta.vwap(src, isNewPeriod, 1)
    vwapValue := _vwap
    stdevAbs = _stdevUpper - _vwap
    bandBasis = calcModeInput == "Standard Deviation" ? stdevAbs : _vwap * 0.01
    upperBandValue1 := _vwap + bandBasis * bandMult_1
    lowerBandValue1 := _vwap - bandBasis * bandMult_1
    // ... bands 2 and 3 likewise
plot(vwapValue, title = "VWAP", color = #2962FF, offset = offset)
upperBand_1 = plot(upperBandValue1, title="Upper Band #1", color = color.green, offset = offset, display = showBand_1 ? display.all : display.none, editable = showBand_1)
lowerBand_1 = plot(lowerBandValue1, title="Lower Band #1", color = color.green, offset = offset, display = showBand_1 ? display.all : display.none, editable = showBand_1)
fill(upperBand_1, lowerBand_1, title = "Bands Fill #1", color = color.new(color.green, 95), display = showBand_1 ? display.all : display.none, editable = showBand_1)
// band 2: color.olive ; band 3: color.teal (same pattern)
```

### 11.7 Ichimoku Cloud

```pine
//@version=6
indicator(title="Ichimoku Cloud", shorttitle="Ichimoku", overlay=true)
conversionPeriods = input.int(9, minval=1, title="Conversion Line Length")
basePeriods = input.int(26, minval=1, title="Base Line Length")
laggingSpan2Periods = input.int(52, minval=1, title="Leading Span B Length")
displacement = input.int(26, minval=1, title="Lagging Span")
donchian(len) => math.avg(ta.lowest(len), ta.highest(len))
conversionLine = donchian(conversionPeriods)
baseLine = donchian(basePeriods)
leadLine1 = math.avg(conversionLine, baseLine)
leadLine2 = donchian(laggingSpan2Periods)
plot(conversionLine, color=#2962FF, title="Conversion Line")
plot(baseLine, color=#B71C1C, title="Base Line")
plot(close, offset = -displacement + 1, color=#43A047, title="Lagging Span")
p1 = plot(leadLine1, offset = displacement - 1, color=#A5D6A7, title="Leading Span A")
p2 = plot(leadLine2, offset = displacement - 1, color=#EF9A9A, title="Leading Span B")
plot(leadLine1 > leadLine2 ? leadLine1 : leadLine2, offset = displacement - 1, title = "Leading Span Background", display = display.none)
fill(p1, p2, color = leadLine1 > leadLine2 ? color.rgb(67, 160, 71, 90) : color.rgb(244, 67, 54, 90))
```

### 11.8 Supertrend, Parabolic SAR, DMI, ADX, ATR

```pine
//@version=6
indicator("Supertrend", overlay = true, timeframe = "", timeframe_gaps = true)
atrPeriod = input.int(10,    "ATR Length", minval = 1)
factor =    input.float(3.0, "Factor",      minval = 0.01, step = 0.01)
[supertrend, direction] = ta.supertrend(factor, atrPeriod)
supertrend := barstate.isfirst ? na : supertrend
upTrend =   plot(direction < 0 ? supertrend : na, "Up Trend",   color = color.green, style = plot.style_linebr)
downTrend = plot(direction < 0 ? na : supertrend, "Down Trend", color = color.red,   style = plot.style_linebr)
bodyMiddle = plot(barstate.isfirst ? na : (open + close) / 2, "Body Middle", display = display.none)
fill(bodyMiddle, upTrend,   color.new(color.green, 90), fillgaps = false)
fill(bodyMiddle, downTrend, color.new(color.red,   90), fillgaps = false)
alertcondition(direction[1] > direction, title='Downtrend to Uptrend', message='The Supertrend value switched from Downtrend to Uptrend ')
alertcondition(direction[1] < direction, title='Uptrend to Downtrend', message='The Supertrend value switched from Uptrend to Downtrend')
alertcondition(direction[1] != direction, title='Trend Change', message='The Supertrend value switched from Uptrend to Downtrend or vice versa')
```
```pine
//@version=6
indicator("Parabolic SAR", shorttitle="SAR", overlay=true, timeframe="", timeframe_gaps=true)
start = input(0.02)
increment = input(0.02)
maximum = input(0.2, "Max Value")
out = ta.sar(start, increment, maximum)
plot(out, "ParabolicSAR", style=plot.style_cross, color=#2962FF)
```
```pine
//@version=6
indicator(title="Directional Movement Index", shorttitle="DMI", format=format.price, precision=4, timeframe="", timeframe_gaps=true)
lensig = input.int(14, title="ADX Smoothing", minval=1, maxval=50)
len = input.int(14, minval=1, title="DI Length")
up = ta.change(high)
down = -ta.change(low)
plusDM = na(up) ? na : (up > down and up > 0 ? up : 0)
minusDM = na(down) ? na : (down > up and down > 0 ? down : 0)
trur = ta.rma(ta.tr, len)
plus = fixnan(100 * ta.rma(plusDM, len) / trur)
minus = fixnan(100 * ta.rma(minusDM, len) / trur)
sum = plus + minus
adx = 100 * ta.rma(math.abs(plus - minus) / (sum == 0 ? 1 : sum), lensig)
plot(adx, color=#F50057, title="ADX")
plot(plus, color=#2962FF, title="+DI")
plot(minus, color=#FF6D00, title="-DI")
```
```pine
//@version=6
indicator(title="Average True Range", shorttitle="ATR", overlay=false, timeframe="", timeframe_gaps=true)
length = input.int(title="Length", defval=14, minval=1)
smoothing = input.string(title="Smoothing", defval="RMA", options=["RMA", "SMA", "EMA", "WMA"])
ma_function(source, length) =>
	switch smoothing
		"RMA" => ta.rma(source, length)
		"SMA" => ta.sma(source, length)
		"EMA" => ta.ema(source, length)
		=> ta.wma(source, length)
plot(ma_function(ta.tr(true), length), title = "ATR", color=#B71C1C)
```

### 11.9 Keltner Channels, Donchian, Envelope, Alligator, Fractals

```pine
//@version=6
indicator(title="Keltner Channels", shorttitle="KC", overlay=true, timeframe="", timeframe_gaps=true)
length = input.int(20, minval=1)
mult = input(2.0, "Multiplier")
src = input(close, title="Source")
exp = input(true, "Use Exponential MA", display = display.data_window)
BandsStyle = input.string("Average True Range", options = ["Average True Range", "True Range", "Range"], title="Bands Style", display = display.data_window)
atrlength = input(10, "ATR Length", display = display.data_window)
esma(source, length)=>
	s = ta.sma(source, length)
	e = ta.ema(source, length)
	exp ? e : s
ma = esma(src, length)
rangema = BandsStyle == "True Range" ? ta.tr(true) : BandsStyle == "Average True Range" ? ta.atr(atrlength) : ta.rma(high - low, length)
upper = ma + rangema * mult
lower = ma - rangema * mult
u = plot(upper, color=#2962FF, title="Upper")
plot(ma, color=#2962FF, title="Basis")
l = plot(lower, color=#2962FF, title="Lower")
fill(u, l, color=color.rgb(33, 150, 243, 95), title="Background")
```
```pine
//@version=6
indicator(title="Donchian Channels", shorttitle="DC", overlay=true, timeframe="", timeframe_gaps=true)
length = input.int(20, minval=1)
offset = input.int(0)
lower = ta.lowest(length)
upper = ta.highest(length)
basis = math.avg(upper, lower)
plot(basis, "Basis", color=#FF6D00, offset = offset)
u = plot(upper, "Upper", color=#2962FF, offset = offset)
l = plot(lower, "Lower", color=#2962FF, offset = offset)
fill(u, l, color=color.rgb(33, 150, 243, 95), title="Background")
```
```pine
//@version=6
indicator(title="Envelope", shorttitle="Env", overlay=true, timeframe="", timeframe_gaps=true)
len = input.int(20, title="Length", minval=1)
percent = input(10.0)
src = input(close, title="Source")
exponential = input(false)
basis = exponential ? ta.ema(src, len) : ta.sma(src, len)
k = percent/100.0
upper = basis * (1 + k)
lower = basis * (1 - k)
plot(basis, "Basis", color=#FF6D00)
u = plot(upper, "Upper", color=#2962FF)
l = plot(lower, "Lower", color=#2962FF)
fill(u, l, color=color.rgb(33, 150, 243, 95), title="Background")
```
```pine
//@version=6
indicator(title="Williams Alligator", shorttitle="Alligator", overlay=true, timeframe="", timeframe_gaps=true)
smma(src, length) =>
	smma = 0.0
	smma := na(smma[1]) ? ta.sma(src, length) : (smma[1] * (length - 1) + src) / length
	smma
jawLength = input.int(13, minval=1, title="Jaw Length")
teethLength = input.int(8, minval=1, title="Teeth Length")
lipsLength = input.int(5, minval=1, title="Lips Length")
jawOffset = input(8, title="Jaw Offset")
teethOffset = input(5, title="Teeth Offset")
lipsOffset = input(3, title="Lips Offset")
jaw = smma(hl2, jawLength)
teeth = smma(hl2, teethLength)
lips = smma(hl2, lipsLength)
plot(jaw, "Jaw", offset = jawOffset, color=#2962FF)
plot(teeth, "Teeth", offset = teethOffset, color=#E91E63)
plot(lips, "Lips", offset = lipsOffset, color=#66BB6A)
```
```pine
//@version=6
indicator("Williams Fractal", shorttitle="Fractals", format=format.price, precision=0, overlay=true)
n = input.int(title="Periods", defval=2, minval=2)
// UpFractal
bool upflagDownFrontier = true
bool upflagUpFrontier0 = true
bool upflagUpFrontier1 = true
bool upflagUpFrontier2 = true
bool upflagUpFrontier3 = true
bool upflagUpFrontier4 = true
for i = 1 to n
    upflagDownFrontier := upflagDownFrontier and (high[n-i] < high[n])
    upflagUpFrontier0 := upflagUpFrontier0 and (high[n+i] < high[n])
    upflagUpFrontier1 := upflagUpFrontier1 and (high[n+1] <= high[n] and high[n+i + 1] < high[n])
    upflagUpFrontier2 := upflagUpFrontier2 and (high[n+1] <= high[n] and high[n+2] <= high[n] and high[n+i + 2] < high[n])
    upflagUpFrontier3 := upflagUpFrontier3 and (high[n+1] <= high[n] and high[n+2] <= high[n] and high[n+3] <= high[n] and high[n+i + 3] < high[n])
    upflagUpFrontier4 := upflagUpFrontier4 and (high[n+1] <= high[n] and high[n+2] <= high[n] and high[n+3] <= high[n] and high[n+4] <= high[n] and high[n+i + 4] < high[n])
flagUpFrontier = upflagUpFrontier0 or upflagUpFrontier1 or upflagUpFrontier2 or upflagUpFrontier3 or upflagUpFrontier4
upFractal = (upflagDownFrontier and flagUpFrontier)
// DownFractal (mirror with low, > and >=)
bool downflagDownFrontier = true
bool downflagUpFrontier0 = true
bool downflagUpFrontier1 = true
bool downflagUpFrontier2 = true
bool downflagUpFrontier3 = true
bool downflagUpFrontier4 = true
for i = 1 to n
    downflagDownFrontier := downflagDownFrontier and (low[n-i] > low[n])
    downflagUpFrontier0 := downflagUpFrontier0 and (low[n+i] > low[n])
    downflagUpFrontier1 := downflagUpFrontier1 and (low[n+1] >= low[n] and low[n+i + 1] > low[n])
    downflagUpFrontier2 := downflagUpFrontier2 and (low[n+1] >= low[n] and low[n+2] >= low[n] and low[n+i + 2] > low[n])
    downflagUpFrontier3 := downflagUpFrontier3 and (low[n+1] >= low[n] and low[n+2] >= low[n] and low[n+3] >= low[n] and low[n+i + 3] > low[n])
    downflagUpFrontier4 := downflagUpFrontier4 and (low[n+1] >= low[n] and low[n+2] >= low[n] and low[n+3] >= low[n] and low[n+4] >= low[n] and low[n+i + 4] > low[n])
flagDownFrontier = downflagUpFrontier0 or downflagUpFrontier1 or downflagUpFrontier2 or downflagUpFrontier3 or downflagUpFrontier4
downFractal = (downflagDownFrontier and flagDownFrontier)
plotshape(downFractal, style=shape.triangledown, location=location.belowbar, offset=-n, color=#F23645, size = size.small)
plotshape(upFractal, style=shape.triangleup,   location=location.abovebar, offset=-n, color=#089981, size = size.small)
```

### 11.10 Moving Average (SMA) with the Smoothing group (both generations)

Older generation (2022-2023):
```pine
//@version=5
indicator(title="Moving Average Simple", shorttitle="SMA", overlay=true, timeframe="", timeframe_gaps=true)
len = input.int(9, minval=1, title="Length")
src = input(close, title="Source")
offset = input.int(title="Offset", defval=0, minval=-500, maxval=500, display = display.data_window)
out = ta.sma(src, len)
plot(out, color=color.blue, title="MA", offset=offset)
ma(source, length, _type) =>
    switch _type
        "SMA" => ta.sma(source, length)
        "EMA" => ta.ema(source, length)
        "SMMA (RMA)" => ta.rma(source, length)
        "WMA" => ta.wma(source, length)
        "VWMA" => ta.vwma(source, length)
typeMA = input.string(title = "Method", defval = "SMA", options=["SMA", "EMA", "SMMA (RMA)", "WMA", "VWMA"], group="Smoothing", display = display.data_window)
smoothingLength = input.int(title = "Length", defval = 5, minval = 1, maxval = 100, group="Smoothing", display = display.data_window)
smoothingLine = ma(out, smoothingLength, typeMA)
plot(smoothingLine, title="Smoothing Line", color=#f37f20, offset=offset, display=display.none)
```
Current generation adds `"None"` (default) and `"SMA + Bollinger Bands"` to the Type list, a `BB StdDev` (2.0) input and green BB plots/fill, exactly as in the RSI listing (11.1); the smoothing line is titled "SMA-based MA" and drawn `color.yellow` only when Type != None.

### 11.11 Pivot Points Standard — structure

```pine
//@version=5
indicator("Pivot Points Standard", "Pivots", overlay=true, max_lines_count=500, max_labels_count=500)
kind = input.string("Traditional", "Type", options=["Traditional","Fibonacci","Woodie","Classic","DM","Camarilla"])
pivotTimeFrame = input.string("Auto", "Pivots Timeframe", options=["Auto","Daily","Weekly","Monthly","Quarterly","Yearly","Biyearly","Triyearly","Quinquennially","Decennially"])
lookBack = input.int(15, "Number of Pivots Back", minval=1, maxval=5000)
isDailyBased = input.bool(true, "Use Daily-based Values", tooltip="...")
showLabels = input.bool(true, "Show Labels", group="labels")
showPrices = input.bool(true, "Show Prices", group="labels")
positionLabels = input.string("Left", "Labels Position", options=["Left","Right"], group="labels")
linewidth = input.int(1, "Line Width", minval=1, maxval=100, group="levels")
// per level: input.bool(true, "P") + input.color(...), S1..S5, R1..R5
DAILY="1D", WEEKLY="1W", MONTHLY="1M", QUARTERLY="3M", YEARLY="12M", BIYEARLY="24M", TRIYEARLY="36M", QUINQUENNIALLY="60M", DECENNIALLY="120M"
autoTimeframe() =>
    timeframe.isintraday and timeframe.multiplier <= 15 ? DAILY :
    timeframe.isintraday ? WEEKLY :
    timeframe.isdaily ? MONTHLY : YEARLY          // weekly & monthly -> yearly
resolution = pivotTimeFrame == "Auto" ? autoTimeframe() : mapped string
// HTF OHLC: isDailyBased ? request.security(syminfo.tickerid, resolution, [open,high,low,close] with lookahead)
//                         : accumulate open/high/low/close of chart bars since ta.change(time(resolution))
// On each new period: compute levels from the PREVIOUS period's H/L/C (Woodie uses the current period open),
//   push to arrays, draw line.new(periodStart, level, periodEnd, level, width=linewidth, color=levelColor)
//   and label.new(text = showPrices ? "P (123.45)" : "P", style=label.style_none, textcolor=levelColor,
//   x = positionLabels == "Left" ? periodStart : periodEnd). Keep only the last `lookBack` periods.
```

### 11.12 Zig Zag engine (ZigZag library semantics)

```
state: lastPivot {price, barIndex, isHigh}, pivots[], lines[], labels[]
inputs: devThreshold (%), depth -> L = R = floor(depth / 2) (min 1)
per bar:
  ph = ta.pivothigh(high, L, R) ; pl = ta.pivotlow(low, L, R)      // values on the confirming bar
  candidate = ph (isHigh=true, bar = bar_index - R) or pl (isHigh=false)
  if candidate:
    if lastPivot is null: add pivot
    else if candidate.isHigh == lastPivot.isHigh:
        if (isHigh and price > lastPivot.price) or (!isHigh and price < lastPivot.price): replace lastPivot (move line end + label)
    else:
        dev = abs(price - lastPivot.price) / lastPivot.price * 100
        if dev >= devThreshold: add pivot, draw line lastPivot -> candidate (solid, lineColor), label (price / cum volume / change)
  projection (extend to last bar): from lastPivot scan bars lastPivot.bar+1 .. bar_index for the extreme opposite price
    (if lastPivot.isHigh: lowest low, else highest high); draw a dashed line to it and a label; updates every bar.
cumulative volume label = sum of volume from lastPivot.bar+1 .. pivot.bar ; change label = (price - lastPivot.price) [abs] or /lastPivot.price*100 [%].
labels: highs above (green), lows below (red); text lines: price, volume, change (as enabled).
```

### 11.13 Volume Profile engine — row distribution and value area (pseudo-code)

```
rows: rowsLayout == "Number of Rows" ? N = rowSize, tick = (top - bottom)/N/mintick rounded to make total closest to N
                                     : tick = rowSize, N = ceil((top-bottom)/(tick*mintick))
for each LTF bar in range:
  side = close >= open ? up : down
  covered rows = rows intersecting [low, high]
  each covered row gets volume * (overlap of row with [low,high]) / (high - low)      // proportional split (engine detail — verify)
poc = argmax(total volume per row)                                          // ties: verify
valueArea(target = pct/100 * totalVolume):
  included = {poc}; acc = vol[poc]; above = poc+1; below = poc-1
  while acc < target:
      candUp = above < N ? vol[above] : -1 ; candDn = below >= 0 ? vol[below] : -1
      if candUp < 0 and candDn < 0: break
      pick = candUp > candDn ? up : candUp < candDn ? down
           : (dist(above) < dist(below) ? up : dist(above) > dist(below) ? down : up)   // tie -> closer to POC, equal -> above
      if acc + vol[pick] > target: break        // "if adding would exceed the target, stop"
      include pick; acc += vol[pick]; advance that side
VAH = top of highest included row ; VAL = bottom of lowest included row
render: row length proportional to vol/maxVol * width% of the pane box; up/down split or delta coloring; POC/VAH/VAL horizontal lines (optionally extended right); developing POC/VA as step lines over time.
```
(Help Center wording: "Continue alternating sides, taking the next row on the side just added and the current row on the opposite side" — i.e. after adding a row on one side, the comparison pair is refreshed on that side only.)

### 11.14 Technical Ratings — vote functions (library semantics)

```pine
calcRatingMA(ma, src) => na(ma) or na(src) ? na : (ma == src ? 0 : ma < src ? 1 : -1)
calcRating(buy, sell) => buy ? 1 : sell ? -1 : 0
// MAs
ratingMA = avg of calcRatingMA(x, close) for x in [sma10,sma20,sma30,sma50,sma100,sma200, ema10,...,ema200, hma9, vwma20] + ichimoku vote
ichimoku vote: [conversionLine, baseLine, leadLine1, leadLine2] = ta.ichimoku(9, 26, 52)
   buy  = leadLine1 > leadLine2 and close > leadLine1 and close < baseLine and close[1] < conversionLine and close > conversionLine
   sell = leadLine2 > leadLine1 and close < leadLine2 and close > baseLine and close[1] > conversionLine and close < conversionLine
// Oscillators (each -> calcRating(buy, sell))
rsi:   rsi = ta.rsi(close,14); buy = rsi < 30 and rsi[1] < rsi ; sell = rsi > 70 and rsi[1] > rsi
stoch: k = sma(stoch(close,high,low,14),3), d = sma(k,3); buy = k < 20 and d < 20 and k > d ; sell = k > 80 and d > 80 and k < d
cci:   cci = ta.cci(close? hlc3, 20); buy = cci < -100 and cci > cci[1] ; sell = cci > 100 and cci < cci[1]
adx:   [p, m, adx] = ta.dmi(14,14); buy = adx > 20 and p > m and adx > adx[1]? ; sell = adx > 20 and p < m and adx > adx[1]?   // Help Center: sell requires ADX < previous — verify
ao:    ao = sma(hl2,5)-sma(hl2,34); buy = crossover(ao,0) or (ao > 0 and ao[1] > 0 and ao > ao[1] and ao[2] > ao[1]); sell mirror
mom:   mom = close - close[10]; buy = mom > mom[1] ; sell = mom < mom[1]
macd:  [macd, sig, _] = ta.macd(close,12,26,9); buy = macd > sig ; sell = macd < sig
stochRsi: rsi = ta.rsi(close,14); k = sma(stoch(rsi,rsi,rsi,14),3); d = sma(k,3); downTrend = close < sma(close,50)?; buy = downTrend and k < 20 and d < 20 and k > d; sell = upTrend and k > 80 and d > 80 and k < d
wpr:   r = ta.wpr(14); buy = r < -80 and r > r[1] ; sell = r > -20 and r < r[1]
bbp:   ema13; bull = high - ema13; bear = low - ema13; buy = upTrend and bear < 0 and bear > bear[1] ; sell = downTrend and bull > 0 and bull < bull[1]
uo:    uo = ultimate(7,14,28); buy = uo > 70 ; sell = uo < 30
ratingOsc = avg of the 11 votes ; ratingAll = avg(ratingMA, ratingOsc)
ratingStatus(v, strong=0.5, weak=0.1) => v > strong ? "Strong Buy" : v > weak ? "Buy" : v < -strong ? "Strong Sell" : v < -weak ? "Sell" : "Neutral"
```

---

## 12. Quick-reference matrix (one row per indicator)

Columns: pane (O = overlay on price, S = separate), legend arguments in order (what the status line prints), plot list (type), hlines/fills, number format (`P` = price/precision, `V` = volume, `%` = percent; digits = Pine `precision`), MTF group, status.

| Indicator | Pane | Legend args (defaults) | Plots | Levels / fills | Fmt | MTF | Status |
|---|---|---|---|---|---|---|---|
| 24-hour Volume | S | source, currency | 24h volume (columns/line) | — | V | no | V |
| Accumulation/Distribution | S | — | line | — | V | yes | S |
| Accumulative Swing Index (lib) | S | 10 | line | — | P | — | F |
| Advance/Decline (lib) | S | 10 | line | — | P | — | F |
| ALMA | O | close 9 0.85 6 | line | — | P | yes | V |
| Aroon | S | 14 | Up, Down (lines) | — | P2 | yes | S |
| Aroon Oscillator | S | 14 | line + fill | 90, 0, -90 | P2 | yes | F |
| Average Daily Range | S | 14 | line | — | P | yes | F |
| ADX | S | 14 14 | ADX (line) | — | P2 | yes | S |
| ATR | S | 14 RMA | ATR (line) | — | P | yes | V |
| Awesome Oscillator | S | — | columns (2-color) | — | P | yes | V |
| Balance of Power | S | — | line | 0 | P2 | yes | V |
| Bollinger Bands | O | 20 SMA close 2 | Basis, Upper, Lower + fill | — | P | yes | S |
| BB %B | S | 20 close 2 | %B (line) | 1, 0 + fill | P | yes | V |
| BB Width | S | 20 close 2 125 125 | BBW, Highest Exp., Lowest Contr. | — | P | yes | V |
| Bollinger Bars | O | — | fixed-width bars | — | — | no | V |
| BBTrend | S | 20 50 2 | columns (4-color) | 0 | P2 | yes | F |
| Bull Bear Power | S | 13 | columns/line | 0 | P | yes | F |
| Chaikin Money Flow | S | 20 | line | 0 | P2 | yes | S |
| Chaikin Oscillator | S | 3 10 | line | 0 | V | yes | S |
| Chaikin Volatility (lib) | S | 10 10 | line | 0 | P | — | F |
| Chande Kroll Stop | O | 10 1 9 | Stop Long, Stop Short | — | P | no | V |
| Chande Momentum Osc | S | 9 close | line | 0 | P2 | yes | S |
| Chandelier Exit | O | 22 22 3 | Long Exit, Short Exit | — | P | yes | F |
| Chop Zone | S | — | unit columns (9-color) | — | P4 | yes | S |
| Choppiness Index | S | 14 0 | line | 61.8, 50, 38.2 + fill | P2 | yes | S |
| CCI | S | 20 hlc3 (None 14 2) | CCI (+MA, BB) | 100, 0, -100 + fill | P2 | yes | S |
| Connors RSI | S | 3 2 100 | line | 70, 50, 30 + fill | P2 | yes | S |
| Coppock Curve | S | 10 14 11 close | line | 0 | P | yes | S |
| Correlation Coefficient | S | SP:SPX close 20 | area | 1, 0, -1 | P2 | no | V |
| Cumulative Volume Delta | S | 1D false 1 | candles | 0 | V | no | V |
| Cumulative Volume Index | S | — | line | — | V | — | D |
| Detrended Price Osc | S | 21 false | line | 0 | P2 | yes | S |
| DMI | S | 14 14 | ADX, +DI, -DI | — | P4 | yes | S |
| Divergence Indicator | S | 14 5 5 60 5 true false true false | RSI + segments + labels | 70, 30 | P2 | no | S |
| Donchian Channels | O | 20 0 | Basis, Upper, Lower + fill | — | P | yes | S |
| Double EMA | O | 9 close | line | — | P | yes | S |
| Ease of Movement | S | 14 10000 | line | 0 | V | yes | S |
| Elder Force Index | S | 13 | line | 0 | V | yes | S |
| EMA | O | 9 close 0 (None 5 2) | EMA (+MA, BB) | — | P | yes | S |
| EMA Cross (lib) | O | 9 26 | Short, Long, Crosses | — | P | — | F |
| Envelope | O | 20 10 close false | Basis, Upper, Lower + fill | — | P | yes | S |
| Fisher Transform | S | 9 | Fisher, Trigger | ±1.5, ±0.75, 0 | P2 | yes | S |
| Gaps | O | false 500 30 false 300 | boxes | — | — | no | V |
| Guppy MMA (lib) | O | 3 5 8 10 12 15 30 35 40 45 50 60 | 12 lines | — | P | — | F |
| Historical Volatility | S | 10 | line | — | P2 | yes | S |
| Hull MA | O | 9 close | line | — | P | yes | S |
| Ichimoku Cloud | O | 9 26 52 26 | Conv, Base, Lagging, Lead A, Lead B + cloud | — | P | no | S |
| KAMA / MA Adaptive | O | close 10 2 30 | line | — | P | yes | F |
| Keltner Channels | O | 20 2 close true ATR 10 | Upper, Basis, Lower + fill | — | P | yes | S |
| Klinger Oscillator | S | — | KO, Signal | — | P | yes | S |
| Know Sure Thing | S | 10 15 20 30 10 10 10 15 9 | KST, Signal | 0 | P4 | yes | S |
| LSMA | O | 25 0 close | line | — | P | yes | V |
| Linear Regression Channel | O | 100 close 2 2 | 3 lines + fills + label (last bar) | — | P | no | S |
| Linear Regression Curve (lib) | O | 9 close | line | — | P | — | F |
| Linear Regression Slope (lib) | S | 14 close | line | 0 | P | — | F |
| MA Cross | O | 9 21 | Short, Long, Crosses | — | P | no | S |
| MA Ribbon | O | SMA close 20 SMA close 50 SMA close 100 SMA close 200 | 4 lines | — | P | yes | S |
| MA with EMA Cross | O | 9 | MA, EMA, Crosses | — | P | no | S |
| Majority Rule (lib) | S | 20 | line | — | P | — | F |
| Mass Index | S | 10 | line | — | P4 | yes | S |
| McGinley Dynamic | O | 14 | line | — | P | yes | S |
| Median | O | hl2 3 14 2 | Median, EMA, bands + cloud | — | P | yes | F |
| Median Price / Typical / Average (lib) | O | — | line | — | P | — | F |
| Momentum | S | 10 close | line | 0 | P2 | yes | S |
| Money Flow Index | S | 14 | line | 80, 20 + fill | P2 | yes | S |
| Moving Average (SMA) | O | 9 close 0 (None 5 2) | MA (+MA, BB) | — | P | yes | S |
| MA Channel (lib) | O | 20 20 high low 0 | Upper, Lower + fill | — | P | — | F |
| MA Double / Triple / Multiple (lib) | O | 20 50 / 20 50 100 / 5 10 20 30 50 100 | 2/3/6 lines | — | P | — | F |
| MA Hamming (lib) | O | 20 close | line | — | P | — | F |
| MACD | S | 12 26 close 9 EMA EMA | Histogram (columns 4-color), MACD, Signal | 0 | P | yes | S |
| Moon Phases | O | — | circles + bar colors | — | — | no | V |
| Multi-Time Period Charts | O | auto/TF, calc mode | boxes | — | — | no | V |
| Net Volume | S | — | line/columns | 0 | V | yes | S |
| NVI / PVI | S | 255 | index, EMA | — | P | yes | V |
| On Balance Volume | S | (None 14 2) | OBV (+MA, BB) | — | V | yes | S |
| Open Interest | S | — | columns | — | V | — | D |
| Parabolic SAR | O | 0.02 0.02 0.2 | cross | — | P | yes | S |
| Percentage Price Oscillator | S | close 12 26 9 EMA EMA | hist, PPO, Signal | 0 | P2 | yes | V |
| Percentage Volume Oscillator | S | 12 26 9 EMA EMA | hist, PVO, Signal | 0 | P2 | yes | F |
| Performance | S | symbols, TFs | table | — | % | no | V |
| Pivot Points High Low | O | 10 10 | labels | — | P | no | S |
| Pivot Points Standard | O | Traditional Auto 15 true | lines + labels | — | P | no | V |
| Price Channel (lib) | O | 20 0 | high, low, center | — | P | — | F |
| Price Momentum Oscillator | S | close 35 20 10 | PMO, Signal | 0 | P | yes | F |
| Price Oscillator | S | 10 21 close false | PPO (line) | 0 | P2 | yes | S |
| Price Volume Trend | S | — | line | — | V | yes | S |
| Pring's Special K | S | close 100 100 | Special K, Signal | 0 | P | yes | V |
| Rank Correlation Index | S | close 9 (None 14 2) | RCI (+MA, BB) | 80, 0, -80 | P2 | yes | F |
| RCI Ribbon | S | close 9 26 52 | Short, Middle, Long | 80, 0, -80 | P2 | yes | F |
| Rate of Change | S | 9 close | line | 0 | P2 | yes | V |
| Ratio / Spread (lib) | S | symbol | line + fills | 0 (hidden) | P | — | F |
| RSI | S | 14 close (None 14 2) | RSI (+MA, BB, divergence) | 70, 50, 30 + fill + gradients | P2 | yes | S |
| Relative Vigor Index | S | 10 | RVGI, Signal | — | P4 | yes | S |
| Relative Volatility Index | S | 10 | line | 80, 50, 20 + fill | P2 | yes | S |
| Relative Volume at Time | S | 1D 5 Cumulative true | columns | 1 | P2 | no | F |
| Rolling VWAP | O | hlc3 true 1 0 0 10 | RVWAP + bands + fills | — | P | no | V |
| Seasonality | S | year, colors | table + boxes | — | % | no | V |
| SMI Ergodic Indicator | S | 20 5 5 | Indicator, Signal | 0 | P4 | yes | S |
| SMI Ergodic Oscillator | S | 20 5 5 | histogram | 0 | P4 | yes | S |
| Smoothed MA | O | 7 hl2 | line | — | P | yes | S |
| Standard Deviation (lib) | S | 20 close | line | — | P | — | F |
| Standard Error (lib) | S | 14 close | line | — | P | — | F |
| Standard Error Bands (lib) | O | 21 close 2 3 | upper, basis, lower + fill | — | P | — | F |
| Stochastic | S | 14 1 3 | %K, %D | 80, 50, 20 + fill | P2 | yes | S |
| Stochastic Momentum Index | S | 10 3 3 | SMI, SMI-based EMA | 40, 0, -40 + fills | P2 | yes | V |
| Stochastic RSI | S | 3 3 14 14 close | K, D | 80, 50, 20 + fill | P2 | yes | S |
| Supertrend | O | 10 3 | Up Trend, Down Trend (linebr) + fills | — | P | yes | S |
| Technical Ratings | S | TF All | columns + table | 0.5, 0.1, -0.1, -0.5 | P2 | yes | V |
| TWAP | O | Session ohlc4 0 | line | — | P | no | V |
| Trading Sessions | O | 3 sessions | boxes + lines + labels | — | — | no | V |
| Trend Strength Index | S | 14 | line + gradient fill | 0 | P2 | yes | V |
| Triple EMA | O | 9 | line | — | P | yes | S |
| TRIX | S | 18 | line | 0 | P4 | yes | S |
| True Strength Index | S | 25 13 13 | TSI, Signal | 0 | P4 | yes | S |
| Ulcer Index | S | close 14 | line | — | P | yes | V |
| Ultimate Oscillator | S | 7 14 28 | line | — | P2 | yes | S |
| Up/Down Volume | S | false 1 | Up cols, Down cols, Delta | 0 | V | no | V |
| Visible Average Price | O | close | line | — | P | no | V |
| Volatility Stop | O | 20 close 2 | cross/circles (2-color) | — | P | no | S |
| Volatility C2C / ZTC2C / OHLC / Index (lib) | S | 10 | line | — | P | — | F |
| Volume | S(overlaid) | false 20 false | columns (2-color), MA | — | V | yes | S |
| Volume Delta | S | false 1 | candles | 0 | V | no | V |
| Volume Oscillator | S | 5 10 | line | 0 | P2 | yes | S |
| Volume Profile family | O | rows/VA/… | histogram rows + POC/VAH/VAL | — | V | no | N |
| VWAP | O | Session hlc3 0 | VWAP + 3 band pairs + fills | — | P | yes | S |
| VWAP Auto Anchored | O | Auto hlc3 0 | VWAP + bands | — | P | no | N |
| VWMA | O | 20 close | line | — | P | yes | S |
| Vortex Indicator | S | 14 | VI+, VI- | — | P4 | yes | S |
| Weighted MA | O | 9 close 0 | line | — | P | yes | S |
| Williams %R | S | 14 close | line | -20, -50, -80 + fill | P2 | yes | S |
| Williams Alligator | O | 13 8 5 8 5 3 | Jaw, Teeth, Lips (offset) | — | P | yes | S |
| Williams Fractal | O | 2 | triangles (offset -2) | — | P0 | no | S |
| Woodies CCI | S | 6 14 | histogram (4-color), Turbo, CCI 14 | ±100, ±200, 0 | P2 | yes | F |
| Zig Zag | O | 5 10 true true true false | lines (solid/dashed) + labels | — | P | no | S |
| Auto Fib Retracement | O | 3 10 … | 11 level lines + labels | — | P | no | V |
| Auto Fib Extension | O | 3 10 … | level lines + labels | — | P | no | V |
| Auto Pitchfork | O | 10 Original | median + level lines | — | P | no | V |
| Auto Trendlines | O | 3 Both | lines | — | P | no | V |
| Auto Key Levels | O | D/W/M toggles | level lines + labels | — | P | no | V |
| All Candlestick Patterns | O | SMA50 Both | labels | — | — | no | S |
| 52 Week High/Low (lib) | O | close close | 2 step lines | — | P | — | F |
| Accelerator Oscillator (lib) | S | — | histogram | — | P | — | F |

Totals: 128 rows above; 64 with published-source status `[S]` or verified `[V]` formulas and defaults, 35 `[F]` (formula certain, some defaults/colors to verify), 3 `[N]`, plus the `[D]` data-feed group.

---

## 13. Verification protocol before shipping

1. Open each `[S]`/`[F]` built-in in the TradingView Pine Editor (Open > Built-in script...) and diff inputs/defaults/colors against sections 3 and 11; update the `(verify)` items.
2. Export Data Window values for a 300-bar sample (BTCUSD 1h and AAPL 1D) for every indicator; assert max abs error < 1e-6 after the seeding window and identical NaN masks.
3. For charting-library parity use the Appendix A colors and the `createStudy` names in 1.2; for website parity use the Pine hex values in section 3.
4. Re-run this research when TradingView announces built-in updates (Help-Center folder 43000587405 is the changelog surface: new articles = new/updated built-ins).

---

## 14. Index of indicator sections (name -> section, status tag)

* 3.1 — Accumulation/Distribution `[S]` (line 435)
* 3.2 — Accumulative Swing Index `[F]` (library) / Wilder's Swing Index (line 444)
* 3.3 — Advance/Decline (library) and the breadth family `[D]` (line 462)
* 3.4 — Arnaud Legoux Moving Average `[V]` inputs / `[S]` plot (line 468)
* 3.5 — Aroon `[S]` (line 476)
* 3.6 — Aroon Oscillator `[V]` calc / `[F]` defaults (line 490)
* 3.7 — Average Daily Range (Average Day Range) `[V]` calc / `[F]` defaults (line 498)
* 3.8 — Average Directional Index `[S]` (line 506)
* 3.9 — Average True Range `[V]` (line 530)
* 3.10 — Awesome Oscillator `[V]` (line 539)
* 3.11 — Balance of Power `[V]` calc / `[S]` style (line 547)
* 3.12 — Bollinger Bands `[S]` (line 555)
* 3.13 — Bollinger Bands %B `[V]` (line 570)
* 3.14 — Bollinger BandWidth `[V]` (line 578)
* 3.15 — Bollinger Bars `[V]` behaviour / `[F]` implementation (line 586)
* 3.16 — BBTrend `[V]` formula / `[F]` defaults (line 592)
* 3.17 — Bull Bear Power `[V]` formula / `[F]` style (line 604)
* 3.18 — Chaikin Money Flow `[S]` (line 612)
* 3.19 — Chaikin Oscillator `[S]` (line 624)
* 3.20 — Chaikin Volatility `[F]` (library only) (line 632)
* 3.21 — Chande Kroll Stop `[V]` formula / `[S]` style (line 639)
* 3.22 — Chande Momentum Oscillator `[S]` (line 653)
* 3.23 — Chandelier Exit `[V]` formula / `[F]` defaults (line 667)
* 3.24 — Chop Zone `[S]` (line 674)
* 3.25 — Choppiness Index `[S]` (line 707)
* 3.26 — Commodity Channel Index `[S]` (line 715)
* 3.27 — Connors RSI `[S]` (line 723)
* 3.28 — Coppock Curve `[S]` (line 741)
* 3.29 — Correlation Coefficient `[V]` calc / `[S]` inputs (line 749)
* 3.30 — Cumulative Volume Delta `[V]` rules / `[S]` structure (line 757)
* 3.31 — Cumulative Volume Index `[D]` — see 3.3. (line 767)
* 3.32 — Detrended Price Oscillator `[S]` (line 771)
* 3.33 — Directional Movement Index `[S]` (line 786)
* 3.34 — Divergence Indicator `[S]` (line 805)
* 3.35 — Donchian Channels `[S]` (line 835)
* 3.36 — Double EMA `[S]` (line 843)
* 3.37 — Ease of Movement `[S]` (line 851)
* 3.38 — Elder's Force Index `[S]` (line 860)
* 3.39 — Envelope `[S]` (line 868)
* 3.40 — Moving Average Exponential `[S]` (line 876)
* 3.41 — EMA Cross `[F]` (library) / MA Cross `[S]` / MA with EMA Cross `[S]` (line 884)
* 3.42 — Fisher Transform `[S]` (line 891)
* 3.43 — Gaps `[V]` rules / `[F]` defaults (line 908)
* 3.44 — Guppy Multiple Moving Average `[F]` (library only) (line 915)
* 3.45 — Historical Volatility `[S]` (line 921)
* 3.46 — Hull Moving Average `[S]` (line 935)
* 3.47 — Ichimoku Cloud `[S]` (line 943)
* 3.48 — Kaufman's Adaptive Moving Average / Moving Average Adaptive `[V]` formula / `[F]` defaults (line 958)
* 3.49 — Keltner Channels `[S]` (line 974)
* 3.50 — Klinger Oscillator `[S]` (line 990)
* 3.51 — Know Sure Thing `[S]` (line 1004)
* 3.52 — Least Squares Moving Average `[V]` (line 1012)
* 3.53 — Linear Regression Channel `[S]` (line 1030)
* 3.54 — MA Cross / MA with EMA Cross — see 3.41. (line 1055)
* 3.55 — Moving Average Ribbon `[S]` (line 1057)
* 3.56 — Majority Rule `[F]` (library only) (line 1064)
* 3.57 — Mass Index `[S]` (line 1068)
* 3.58 — McGinley Dynamic `[S]` (line 1076)
* 3.59 — Median `[V]` behaviour / `[F]` defaults (line 1084)
* 3.60 — Median Price / Typical Price / Average Price `[F]` (library only) (line 1091)
* 3.61 — Momentum `[S]` (line 1095)
* 3.62 — Money Flow Index `[S]` (line 1103)
* 3.63 — Moving Average (Simple) `[S]` (line 1111)
* 3.64 — Moving Average Channel / Double / Triple / Multiple / Hamming `[F]` (library only; defaults from the override interfaces) (line 1120)
* 3.65 — Moving Average Convergence Divergence `[S]` (line 1129)
* 3.66 — Multi-Time Period Charts `[V]` (line 1147)
* 3.67 — Moon Phases `[V]` (line 1151)
* 3.68 — Net Volume `[S]` (line 1155)
* 3.69 — Negative Volume Index / Positive Volume Index `[V]` (line 1163)
* 3.70 — On Balance Volume `[S]` (line 1170)
* 3.71 — Open Interest `[D]` (line 1178)
* 3.72 — Parabolic SAR `[S]` (line 1182)
* 3.73 — Performance `[V]` (line 1190)
* 3.74 — Pivot Points High Low `[S]` (line 1194)
* 3.75 — Pivot Points Standard `[V]` formulas & auto rules / `[S]` inputs (line 1201)
* 3.76 — Price Channel `[F]` (library)  (line 1230)
* 3.77 — Price Oscillator (legacy PPO) `[S]` and Percentage Price Oscillator `[V]` (line 1234)
* 3.78 — Percentage Volume Oscillator `[V]` (line 1239)
* 3.79 — Price Volume Trend `[S]` (line 1243)
* 3.80 — Price Momentum Oscillator `[V]` (line 1250)
* 3.81 — Pring's Special K `[V]` (line 1262)
* 3.82 — Rank Correlation Index `[V]` calc / `[F]` defaults, RCI Ribbon `[V]` (line 1269)
* 3.83 — Rate Of Change `[V]` (line 1276)
* 3.84 — Ratio / Spread / Compare / Overlay `[F]` (library pseudo-studies) (line 1284)
* 3.85 — Relative Strength Index `[S]` (line 1288)
* 3.86 — RSI divergence indicator — Help-Center article describing 3.34 / the RSI option; no separate script. (line 1307)
* 3.87 — Relative Vigor Index `[S]` (line 1309)
* 3.88 — Relative Volatility Index `[S]` (line 1317)
* 3.89 — Relative Volume at Time `[V]` semantics / `[F]` style (line 1332)
* 3.90 — Rob Booker indicators `[D]`/list only (line 1339)
* 3.91 — Rolling VWAP `[V]` (TradingView open-source script) (line 1343)
* 3.92 — Seasonality `[V]` (line 1351)
* 3.93 — SMI Ergodic Indicator / Oscillator `[S]` (line 1355)
* 3.94 — Smoothed Moving Average `[S]` (line 1364)
* 3.95 — Standard Deviation / Standard Error / Standard Error Bands `[F]` (library only) (line 1373)
* 3.96 — Stochastic `[S]` (line 1379)
* 3.97 — Stochastic Momentum Index `[V]` (line 1389)
* 3.98 — Stochastic RSI `[S]` (line 1404)
* 3.99 — Supertrend `[S]` (line 1413)
* 3.100 — Technical Ratings `[V]` (line 1423)
* 3.101 — Time Weighted Average Price `[V]` (line 1449)
* 3.102 — Trading Sessions `[V]` behaviour / `[F]` defaults (line 1456)
* 3.103 — Trend Strength Index `[V]` (line 1463)
* 3.104 — Triple EMA `[S]` (line 1471)
* 3.105 — TRIX `[S]` (line 1479)
* 3.106 — True Strength Index `[S]` (line 1487)
* 3.107 — Ulcer Index `[V]` (line 1501)
* 3.108 — Ultimate Oscillator `[S]` (line 1508)
* 3.109 — Up/Down Volume `[V]` (line 1522)
* 3.110 — Visible Average Price `[V]` (line 1529)
* 3.111 — Volatility Stop `[S]` (line 1533)
* 3.112 — Volatility Close-to-Close / Zero Trend Close-to-Close / O-H-L-C / Volatility Index `[F]` (library only) (line 1553)
* 3.113 — Volume `[S]` (line 1560)
* 3.114 — Volume Weighted Average Price `[S]` (line 1569)
* 3.115 — Volume Delta `[V]` (line 1593)
* 3.116 — Volume Oscillator `[S]` (line 1597)
* 3.117 — Volume Weighted Moving Average `[S]` (line 1605)
* 3.118 — Vortex Indicator `[S]` (line 1613)
* 3.119 — Moving Average Weighted `[S]` (line 1627)
* 3.120 — Williams %R `[S]` (line 1632)
* 3.121 — Williams Alligator `[S]` (line 1640)
* 3.122 — Williams Fractal `[S]` (line 1648)
* 3.123 — Woodies CCI `[V]` behaviour / `[S]` structure (line 1671)
* 3.124 — Zig Zag `[S]` (line 1679)
* 3.125 — 24-hour Volume `[V]` (line 1687)
* 3.126 — Auto Fib Retracement `[V]` inputs / `[F]` defaults (line 1691)
* 3.127 — Auto Fib Extension `[V]` (line 1698)
* 3.128 — Auto Pitchfork `[V]` (line 1703)
* 3.129 — Auto Trendlines `[V]` (line 1707)
* 3.130 — Auto Key Levels `[V]` (line 1711)
* 3.131 — All Candlestick Patterns `[S]` (and the per-pattern scripts) (line 1715)
* 3.132 — 52 Week High/Low, Accelerator Oscillator `[F]` (library only) (line 1745)

Status-tag counts across section 3 headings:
* `[V]` (verified online): 49
* `[S]` (published Pine source): 74
* `[F]` (formula certain, defaults to verify): 25
* `[N]`/`[D]` (non-Pine / data-feed): 4

End of document.
