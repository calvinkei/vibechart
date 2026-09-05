# Python strategies

VibeChart has a strategy tester like TradingView's: a **Python Editor** and a **Strategy Tester** in a dock below the chart. You write the strategy in Python with a Pine Script-shaped API, click **Add to chart**, and the chart shows the plots, the trades and a full performance report.

The panel is **off by default**. Nothing is downloaded and no Python runtime exists until you turn it on.

```js
const chart = new Chart({
  container: '#chart',
  datafeed,
  strategy: { enabled: true },        // shows the dock
});
```

Or later: `chart.enableStrategy()`.

## How the script runs

The script is executed **once per bar**, from the first bar to the last, exactly like Pine Script.

- `close`, `open`, `high`, `low`, `volume`, `time` are **series**. `close` is the current bar's close, `close[1]` the previous bar's, `close[n]` n bars back. Out-of-range history is `na`.
- Arithmetic and comparisons on series make new series: `(close - open)[3]` works.
- `ta.*` functions keep their own state **per call site** (the position of the call in the script), like Pine. Call them at the top level of the script every bar; do not put them inside `if` blocks.
- `strategy.entry()`, `strategy.close()` and friends send orders to the broker emulator. Orders fill on the **next bar** (market orders at its open), or at the current close if "Fill orders on bar close" is on.
- A runtime error stops the run and shows the line and bar in the console.

Python runs in the browser through [Pyodide](https://pyodide.org) (MPL-2.0), fetched from jsDelivr on the first run (about 10 MB, cached by the browser). Self-host it with `strategy: { pyodideUrl: 'https://your.cdn/pyodide/v314.0.6/full/' }`, or plug in any runner (for example a server) via `strategy: { runner }` implementing `PythonRunner`.

## A complete example

```python
strategy("MA Cross", overlay=True, initial_capital=100000,
         default_qty_type=strategy.percent_of_equity, default_qty_value=10,
         commission_type=strategy.commission.percent, commission_value=0.1)

fast_len = input.int(9, "Fast length", minval=1)
slow_len = input.int(21, "Slow length", minval=1)
use_stop = input.bool(True, "Use stop loss")
stop_pct = input.float(2.0, "Stop loss %", minval=0.1, step=0.1)

fast = ta.sma(close, fast_len)
slow = ta.sma(close, slow_len)
plot(fast, "Fast", color=color.blue)
plot(slow, "Slow", color=color.orange)

if ta.crossover(fast, slow):
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow):
    strategy.entry("Short", strategy.short)

if use_stop and strategy.position_size != 0:
    px = strategy.position_avg_price
    strategy.exit("Stop", stop=px * (1 - stop_pct / 100) if strategy.position_size > 0 else px * (1 + stop_pct / 100))
```

## Reference

### `strategy(...)` declaration

Call it once at the top. Every parameter and default matches TradingView.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `title` | required | Strategy name |
| `shorttitle` | title | Legend name |
| `overlay` | `True` | Plots on the price chart (`False`: separate pane) |
| `initial_capital` | `1000000` | Starting funds |
| `default_qty_type` | `strategy.fixed` | `strategy.fixed`, `strategy.cash`, `strategy.percent_of_equity` |
| `default_qty_value` | `1` | Order size in those units |
| `pyramiding` | `0` | Extra entries allowed in the same direction (0 = one entry) |
| `commission_type` | `strategy.commission.percent` | `.percent`, `.cash_per_contract`, `.cash_per_order` |
| `commission_value` | `0` | Commission per fill |
| `slippage` | `0` | Ticks against you on market/stop fills |
| `backtest_fill_limits_assumption` | `0` | "Verify price for limit orders": ticks price must exceed a limit level |
| `process_orders_on_close` | `False` | Fill orders at the bar close instead of the next open |
| `close_entries_rule` | `"FIFO"` | `"FIFO"` or `"ANY"` |
| `margin_long`, `margin_short` | `100` | Margin % (100 = own funds only; 0 = unlimited) |
| `risk_free_rate` | `2` | Annual %, for Sharpe/Sortino |
| `currency` | symbol currency | Report currency label |
| `calc_on_order_fills`, `calc_on_every_tick`, `use_bar_magnifier`, `fill_orders_on_standard_ohlc` | `False` | Accepted; historical bars have no intrabar ticks |

Everything above can be overridden in **Strategy settings → Properties** without touching the code.

### Orders

| Function | Notes |
| --- | --- |
| `strategy.entry(id, direction, qty=None, limit=None, stop=None, oca_name=None, oca_type=None, comment=None)` | Market, limit, stop or stop-limit entry. Reverses an opposite position; obeys `pyramiding`. Same `id` while pending = modify. |
| `strategy.order(id, direction, ...)` | Like `entry` but nets against the position and ignores pyramiding. |
| `strategy.exit(id, from_entry="", qty=None, qty_percent=100, profit=None, limit=None, loss=None, stop=None, trail_price=None, trail_points=None, trail_offset=None, comment=None, ...)` | Take-profit / stop-loss bracket (`profit`/`loss` in ticks, `limit`/`stop` as prices) and trailing stop (activation at `trail_price` or `trail_points` ticks, then `trail_offset` ticks behind the best price). One-cancels-other per trade. Waits for a pending entry to fill. |
| `strategy.close(id, comment=None, qty=None, qty_percent=100)` | Market-close the trades opened by entry `id`. |
| `strategy.close_all(comment=None)` | Market-close everything. |
| `strategy.cancel(id)`, `strategy.cancel_all()` | Cancel pending orders. |
| `strategy.default_entry_qty(fill_price)` | Size the default order would have. |

Directions: `strategy.long`, `strategy.short`. OCA: `strategy.oca.cancel`, `.reduce`, `.none`.

Broker rules (same as TradingView's emulator): inside a bar price is assumed to move open → high → low → close when the open is nearer the high, otherwise open → low → high → close; orders trigger in that sequence. Limit orders fill at their price or better (at the open when the bar gaps past them), stop orders at their price or worse plus slippage. Margin is checked at every close; a shortfall liquidates the position and counts as a margin call.

### Risk rules

`strategy.risk.allow_entry_in(strategy.direction.long | .short | .all)`, `strategy.risk.max_position_size(contracts)`, `strategy.risk.max_drawdown(value, strategy.cash | strategy.percent_of_equity)`, `strategy.risk.max_intraday_loss(value, type)`, `strategy.risk.max_cons_loss_days(days)`, `strategy.risk.max_intraday_filled_orders(count)`.

### Strategy state

`strategy.position_size` (signed), `strategy.position_avg_price`, `strategy.position_entry_name`, `strategy.equity`, `strategy.initial_capital`, `strategy.netprofit`, `strategy.openprofit`, `strategy.grossprofit`, `strategy.grossloss`, `strategy.max_drawdown`, `strategy.max_runup` (and `_percent` variants), `strategy.wintrades`, `strategy.losstrades`, `strategy.eventrades`, `strategy.avg_trade`, `strategy.avg_winning_trade`, `strategy.avg_losing_trade`, `strategy.max_contracts_held_all/long/short`.

`strategy.opentrades` and `strategy.closedtrades` are counts that also carry accessors: `strategy.closedtrades.entry_price(i)`, `.exit_price(i)`, `.profit(i)`, `.profit_percent(i)`, `.size(i)`, `.entry_bar_index(i)`, `.exit_bar_index(i)`, `.entry_time(i)`, `.exit_time(i)`, `.entry_id(i)`, `.exit_id(i)`, `.commission(i)`, `.max_runup(i)`, `.max_drawdown(i)`.

### Inputs

`input.int(defval, title, minval, maxval, step, tooltip, group, options)`, `input.float(...)`, `input.bool(defval, title)`, `input.string(defval, title, options=[...])`, `input.source(close, title)`, `input.color(defval, title)`, and plain `input(defval, title)`. Inputs appear in **Strategy settings → Inputs** and in the legend, and changing them re-runs the strategy.

### Plotting

`plot(series, title, color, linewidth, style)` with `plot.style_line`, `style_stepline`, `style_histogram`, `style_columns`, `style_area`, `style_circles`, `style_cross`; `plotshape(cond, title, style=shape.triangleup, location=location.abovebar, color, text, size)`; `plotchar(cond, title, char, location, color, text, size)`; `plotarrow(series)`; `hline(price, title, color, linestyle)`; `bgcolor(color)`.

Colours: `color.red`, `color.green`, `color.blue`, `color.orange`, `color.purple`, `color.teal`, `color.gray`, `color.white`, `color.black`, … `color.new(c, transparency)`, `color.rgb(r, g, b, transparency)`, `color.from_gradient(value, lo, hi, c1, c2)`.

### Technical analysis (`ta.*`)

Moving averages: `sma`, `ema`, `rma`, `wma`, `hma`, `vwma`, `swma`, `alma`. Windows: `highest`, `lowest`, `highestbars`, `lowestbars`, `sum`, `stdev`, `variance`, `dev`, `median`, `percentrank`, `linreg`, `range`, `cum`, `max`, `min`. Momentum: `change`, `mom`, `roc`, `rsi`, `macd`, `stoch`, `cci`, `wpr`, `mfi`, `tsi`, `cmo`, `tr`, `atr`, `bb`, `bbw`, `kc`, `supertrend`, `dmi`, `obv`, `vwap`, `sar`. Conditions: `crossover`, `crossunder`, `cross`, `rising`, `falling`, `barssince`, `valuewhen`, `pivothigh`, `pivotlow`.

Functions that return several values return a tuple: `macd_line, signal, hist = ta.macd(close, 12, 26, 9)`; `basis, upper, lower = ta.bb(close, 20, 2)`; `st, direction = ta.supertrend(3, 10)`.

### Everything else

- `bar_index`, `last_bar_index`, `time` (ms), `year`, `month`, `dayofmonth`, `hour`, `minute`, `dayofweek`
- `barstate.isfirst`, `.islast`, `.isconfirmed`, `.ishistory`
- `syminfo.ticker`, `.mintick`, `.currency`, `.type`, `.description`; `timeframe.period`, `.isintraday`, `.isdaily`, `timeframe.in_seconds()`
- `na`, `na(x)`, `nz(x, y)`, `fixnan(x)`, `math.max/min/abs/round/floor/ceil/sqrt/pow/log/exp/avg/sum`, `str.tostring(x)`, `str.format(fmt, ...)`
- `log.info(msg)`, `log.warning(msg)`, `log.error(msg)` write to the console; `runtime.error(msg)` stops the script
- Ordinary Python (functions, lists, dicts, `math`) works too. Use `float(series)` to get a plain number.

## The panel

- **Python Editor**: script name menu (new, rename, copy, delete, load example), Open (saved scripts, kept in `localStorage`), Save (`⌘/Ctrl+S`), **Add to chart / Update on chart** (`⌘/Ctrl+Enter`), console with errors (click the line number to jump), `log.*` output and broker warnings.
- **Strategy Tester**: Overview (Total P&L, max equity drawdown, total trades, profitable trades, profit factor, equity/drawdown chart with buy & hold and per-trade run-up/drawdown), Performance, Trades analysis, Risk/performance ratios (Sharpe and Sortino on monthly returns, profit factor, margin calls), List of trades (newest first, entry and exit rows, CSV export), Properties.
- The strategy is also a chart object: its legend shows the inputs, the gear opens **Strategy settings**, removing it clears the report. Entries are drawn as labels under the bar, exits above it, with a dashed line coloured by the trade result.
- Everything is saved with `chart.save()` and restored by `chart.load()`.

## API

```ts
const s = chart.strategy;               // StrategyController | null
s.setScript(code); await s.run();       // add / update on chart
s.report                                 // BacktestReport (trades, equity curve, metrics)
s.setInputs({ 'Fast length': 12 });     // re-runs
s.setProperties({ commissionValue: 0.05 });
s.remove(); s.openPanel('tester'); s.closePanel();
s.events.on('reportChanged', (r) => ...);
```

The engine is usable without the UI or a browser: `new Broker(props, bars, symbol)` drives the emulator bar by bar, `buildReport(broker, meta)` computes the report, and `PyodideRunner` (or your own `PythonRunner`) runs scripts.
