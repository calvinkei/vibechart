/**
 * Strategy tester types — mirrors TradingView's strategy() declaration properties, the broker
 * emulator's orders/trades and the Strategy Tester report.
 */

export type Direction = 'long' | 'short';
export type QtyType = 'fixed' | 'cash' | 'percent_of_equity';
export type CommissionType = 'percent' | 'cash_per_contract' | 'cash_per_order';
export type OcaType = 'cancel' | 'reduce' | 'none';

/** strategy() declaration properties and their TradingView defaults (see defaultStrategyProperties). */
export interface StrategyProperties {
  title: string;
  shortTitle: string;
  overlay: boolean;
  /** Starting funds, in account currency. TV default 1,000,000. */
  initialCapital: number;
  /** '' = the chart symbol's currency. */
  currency: string;
  defaultQtyType: QtyType;
  defaultQtyValue: number;
  /** Max concurrent entries in the same direction. 0 = a single entry (TV default). */
  pyramiding: number;
  commissionType: CommissionType;
  commissionValue: number;
  /** Ticks added to market/stop fills against the strategy. */
  slippage: number;
  /** "Verify price for limit orders": limit orders fill only once price exceeds the level by this many ticks. */
  backtestFillLimitsAssumption: number;
  marginLong: number;
  marginShort: number;
  /** Extra order-processing pass at the bar close ("Fill orders on bar close"). */
  processOrdersOnClose: boolean;
  calcOnOrderFills: boolean;
  calcOnEveryTick: boolean;
  closeEntriesRule: 'FIFO' | 'ANY';
  /** Annual risk-free rate (%) for Sharpe/Sortino. TV default 2. */
  riskFreeRate: number;
  useBarMagnifier: boolean;
  fillOrdersOnStandardOhlc: boolean;
}

export function defaultStrategyProperties(): StrategyProperties {
  return {
    title: 'Untitled strategy',
    shortTitle: '',
    overlay: true,
    initialCapital: 1_000_000,
    currency: '',
    defaultQtyType: 'fixed',
    defaultQtyValue: 1,
    pyramiding: 0,
    commissionType: 'percent',
    commissionValue: 0,
    slippage: 0,
    backtestFillLimitsAssumption: 0,
    marginLong: 100,
    marginShort: 100,
    processOrdersOnClose: false,
    calcOnOrderFills: false,
    calcOnEveryTick: false,
    closeEntriesRule: 'FIFO',
    riskFreeRate: 2,
    useBarMagnifier: false,
    fillOrdersOnStandardOhlc: false,
  };
}

/** A bar as the broker sees it (seconds, like the rest of the chart). */
export interface StrategyBar { time: number; open: number; high: number; low: number; close: number; volume: number }

export interface OrderParams {
  qty?: number | null;
  limit?: number | null;
  stop?: number | null;
  ocaName?: string;
  ocaType?: OcaType;
  comment?: string;
}

export interface ExitParams {
  fromEntry?: string;
  qty?: number | null;
  qtyPercent?: number | null;
  /** take-profit distance in ticks / absolute price */
  profit?: number | null;
  limit?: number | null;
  /** stop-loss distance in ticks / absolute price */
  loss?: number | null;
  stop?: number | null;
  trailPrice?: number | null;
  trailPoints?: number | null;
  trailOffset?: number | null;
  ocaName?: string;
  comment?: string;
  commentProfit?: string;
  commentLoss?: string;
  commentTrailing?: string;
}

export type PendingKind = 'entry' | 'order' | 'exit' | 'close';

/** An unfilled order in the broker emulator. */
export interface PendingOrder {
  /** order id: entry id for entry/order, exit id for exit/close */
  id: string;
  kind: PendingKind;
  /** side of the fill: 'long' buys, 'short' sells */
  side: Direction;
  /** null = strategy default size, resolved at fill time (entries/orders only) */
  qty: number | null;
  limit: number | null;
  stop: number | null;
  /** stop-limit orders turn into limit orders once the stop level trades */
  stopHit: boolean;
  ocaName: string;
  ocaType: OcaType;
  comment: string;
  createdBar: number;
  /** exits: which entry (or '' = all open trades of the position) */
  fromEntry: string;
  exitType: 'take_profit' | 'stop_loss' | 'trailing' | null;
  /** qty percent of the applicable trades (exits/close), when qty is null */
  qtyPercent: number | null;
  /** trailing stop state */
  trailActivation: number | null;
  trailOffsetTicks: number | null;
  trailActive: boolean;
  trailStop: number | null;
  /** strategy.entry() reverses an opposite position: the reversal size is added at fill time */
  isEntry: boolean;
}

export interface OpenTrade {
  entryId: string;
  entryComment: string;
  direction: Direction;
  size: number;
  entryBar: number;
  entryTime: number;
  entryPrice: number;
  /** commission charged on the entry fill */
  entryCommission: number;
  /** best/worst intrabar excursions since entry, in currency and % of the entry value */
  runup: number;
  drawdown: number;
  runupPct: number;
  drawdownPct: number;
}

export interface ClosedTrade extends OpenTrade {
  exitId: string;
  exitComment: string;
  exitBar: number;
  exitTime: number;
  exitPrice: number;
  exitCommission: number;
  /** net profit after both commissions */
  profit: number;
  profitPct: number;
  /** running net profit after this trade closed */
  cumProfit: number;
  cumProfitPct: number;
  /** total commission (entry + exit) */
  commission: number;
}

export interface EquityPoint {
  bar: number;
  time: number;
  /** equity at the bar close */
  equity: number;
  /** intrabar extremes of equity (open positions marked at the bar's worst/best price) */
  equityLow: number;
  equityHigh: number;
  netProfit: number;
  openProfit: number;
  /** drawdown from the running equity peak, at the bar close */
  drawdown: number;
  drawdownPct: number;
  /** buy & hold P&L of the initial capital from the first bar */
  buyHold: number;
}

export interface FillEvent {
  bar: number;
  time: number;
  orderId: string;
  kind: PendingKind;
  side: Direction;
  qty: number;
  price: number;
  comment: string;
  /** signed position after the fill */
  position: number;
}

/** Per-column metrics of the report (All / Long / Short). Equity-curve metrics exist only for "All". */
export interface MetricsGroup {
  netProfit: number;
  netProfitPct: number;
  grossProfit: number;
  grossProfitPct: number;
  grossLoss: number;
  grossLossPct: number;
  commission: number;
  openPL: number;
  openPLPct: number;
  totalTrades: number;
  totalOpenTrades: number;
  winningTrades: number;
  losingTrades: number;
  percentProfitable: number;
  avgTrade: number;
  avgTradePct: number;
  avgWinningTrade: number;
  avgWinningTradePct: number;
  avgLosingTrade: number;
  avgLosingTradePct: number;
  ratioAvgWinLoss: number;
  largestWinningTrade: number;
  largestWinningTradePct: number;
  largestLosingTrade: number;
  largestLosingTradePct: number;
  avgBarsInTrades: number;
  avgBarsInWinningTrades: number;
  avgBarsInLosingTrades: number;
  profitFactor: number;
  maxContractsHeld: number;
  /** All-only */
  buyHoldReturn: number | null;
  buyHoldReturnPct: number | null;
  maxRunup: number | null;
  maxRunupPct: number | null;
  maxDrawdown: number | null;
  maxDrawdownPct: number | null;
  sharpe: number | null;
  sortino: number | null;
  marginCalls: number | null;
}

export interface BacktestReport {
  properties: StrategyProperties;
  symbol: string;
  resolution: string;
  currency: string;
  /** tested bar range */
  bars: number;
  firstTime: number;
  lastTime: number;
  trades: ClosedTrade[];
  openTrades: OpenTrade[];
  fills: FillEvent[];
  equity: EquityPoint[];
  /** month-over-month equity returns, as fractions, used for Sharpe/Sortino */
  monthlyReturns: number[];
  all: MetricsGroup;
  long: MetricsGroup;
  short: MetricsGroup;
  marginCalls: number;
}

/** A plot declared by the script via plot()/plotshape()/plotchar()/hline(). */
export interface StrategyPlot {
  id: string;
  title: string;
  type: 'line' | 'histogram' | 'columns' | 'area' | 'circles' | 'cross' | 'stepLine' | 'shapes' | 'chars' | 'hline';
  color: string;
  lineWidth: number;
  lineStyle: number;
  shape?: string;
  char?: string;
  location?: string;
  size?: string;
  text?: string;
  /** hline: constant value */
  value?: number;
  overlay: boolean;
  values: Float64Array;
  colors: Array<string | null> | null;
  texts: Array<string | null> | null;
}

export interface StrategyInputDef {
  id: string;
  title: string;
  type: 'int' | 'float' | 'bool' | 'string' | 'source' | 'select' | 'color';
  defval: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  group?: string;
  tooltip?: string;
}

export interface StrategyError {
  message: string;
  line: number | null;
  column: number | null;
  /** 'syntax' before the first bar, 'runtime' during a bar, 'load' if Python could not start */
  phase: 'load' | 'syntax' | 'runtime';
  bar?: number;
  traceback?: string;
}

export interface StrategyLog { level: 'info' | 'warning' | 'error'; bar: number; time: number; message: string }

/** Output of one Python run (before the report is computed). */
export interface PythonRunOutput {
  properties: StrategyProperties;
  inputs: StrategyInputDef[];
  plots: StrategyPlot[];
  logs: StrategyLog[];
  barsRun: number;
  error: StrategyError | null;
  durationMs: number;
}
