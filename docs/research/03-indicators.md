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
