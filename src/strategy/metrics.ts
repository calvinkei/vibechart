/**
 * Strategy Tester report — the metrics TradingView shows in Overview / Performance /
 * Trades analysis / Risk-performance ratios, computed from the broker's trades and equity curve.
 */
import type { Broker } from './Broker';
import type { BacktestReport, ClosedTrade, EquityPoint, MetricsGroup, OpenTrade } from './types';

function mean(a: number[]): number { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function stdev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
}

/** Calendar-month equity returns (UTC months), as fractions. The first month is measured from the initial capital. */
export function monthlyReturns(curve: EquityPoint[], initialCapital: number): number[] {
  if (!curve.length) return [];
  const out: number[] = [];
  let prevEq = initialCapital;
  let curMonth = -1;
  let lastEq = initialCapital;
  for (const p of curve) {
    const d = new Date(p.time * 1000);
    const m = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (curMonth === -1) curMonth = m;
    if (m !== curMonth) {
      out.push(prevEq > 0 ? lastEq / prevEq - 1 : 0);
      prevEq = lastEq;
      curMonth = m;
    }
    lastEq = p.equity;
  }
  out.push(prevEq > 0 ? lastEq / prevEq - 1 : 0);
  return out;
}

/** SR = (mean monthly return − monthly risk-free rate) / stdev of monthly returns (TradingView's definition). */
export function sharpeRatio(returns: number[], annualRiskFreePct: number): number | null {
  if (returns.length < 2) return null;
  const rf = annualRiskFreePct / 100 / 12;
  const sd = stdev(returns);
  if (sd === 0) return null;
  return (mean(returns) - rf) / sd;
}

/** Like Sharpe, but the denominator is the downside deviation below the risk-free rate. */
export function sortinoRatio(returns: number[], annualRiskFreePct: number): number | null {
  if (returns.length < 2) return null;
  const rf = annualRiskFreePct / 100 / 12;
  const down = returns.map((r) => Math.min(r - rf, 0));
  const dd = Math.sqrt(down.reduce((s, v) => s + v * v, 0) / returns.length);
  if (dd === 0) return null;
  return (mean(returns) - rf) / dd;
}

function group(trades: ClosedTrade[], open: OpenTrade[], initial: number, lastClose: number, contracts: number): MetricsGroup {
  const wins = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit < 0);
  const sum = (a: ClosedTrade[], f: (t: ClosedTrade) => number) => a.reduce((s, t) => s + f(t), 0);
  const net = sum(trades, (t) => t.profit);
  const gp = sum(wins, (t) => t.profit);
  const gl = sum(losses, (t) => t.profit);
  const openPL = lastClose === lastClose ? open.reduce((s, t) => s + (t.direction === 'long' ? 1 : -1) * (lastClose - t.entryPrice) * t.size - t.entryCommission, 0) : 0;
  const largestWin = wins.length ? wins.reduce((a, b) => (b.profit > a.profit ? b : a)) : null;
  const largestLoss = losses.length ? losses.reduce((a, b) => (b.profit < a.profit ? b : a)) : null;
  const bars = (a: ClosedTrade[]) => (a.length ? mean(a.map((t) => t.exitBar - t.entryBar)) : 0);
  const avgWin = wins.length ? gp / wins.length : 0;
  const avgLoss = losses.length ? gl / losses.length : 0;
  const pct = (v: number) => (initial ? (v / initial) * 100 : 0);
  return {
    netProfit: net, netProfitPct: pct(net),
    grossProfit: gp, grossProfitPct: pct(gp),
    grossLoss: gl, grossLossPct: pct(gl),
    commission: sum(trades, (t) => t.commission) + open.reduce((s, t) => s + t.entryCommission, 0),
    openPL, openPLPct: pct(openPL),
    totalTrades: trades.length,
    totalOpenTrades: open.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    percentProfitable: trades.length ? (wins.length / trades.length) * 100 : 0,
    avgTrade: trades.length ? net / trades.length : 0,
    avgTradePct: trades.length ? mean(trades.map((t) => t.profitPct)) : 0,
    avgWinningTrade: avgWin, avgWinningTradePct: wins.length ? mean(wins.map((t) => t.profitPct)) : 0,
    avgLosingTrade: avgLoss, avgLosingTradePct: losses.length ? mean(losses.map((t) => t.profitPct)) : 0,
    ratioAvgWinLoss: avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : wins.length ? Infinity : 0,
    largestWinningTrade: largestWin?.profit ?? 0, largestWinningTradePct: largestWin?.profitPct ?? 0,
    largestLosingTrade: largestLoss?.profit ?? 0, largestLosingTradePct: largestLoss?.profitPct ?? 0,
    avgBarsInTrades: bars(trades), avgBarsInWinningTrades: bars(wins), avgBarsInLosingTrades: bars(losses),
    profitFactor: gl !== 0 ? gp / Math.abs(gl) : gp > 0 ? Infinity : 0,
    maxContractsHeld: contracts,
    buyHoldReturn: null, buyHoldReturnPct: null, maxRunup: null, maxRunupPct: null, maxDrawdown: null, maxDrawdownPct: null,
    sharpe: null, sortino: null, marginCalls: null,
  };
}

export function buildReport(broker: Broker, meta: { symbol: string; resolution: string; currency: string }): BacktestReport {
  const props = broker.props;
  const bars = broker.bars;
  const lastClose = bars.length ? bars[bars.length - 1].close : NaN;
  const trades = broker.closedTrades;
  const open = broker.openTrades;
  const all = group(trades, open, props.initialCapital, lastClose, broker.maxContractsHeld.all);
  const long = group(trades.filter((t) => t.direction === 'long'), open.filter((t) => t.direction === 'long'), props.initialCapital, lastClose, broker.maxContractsHeld.long);
  const short = group(trades.filter((t) => t.direction === 'short'), open.filter((t) => t.direction === 'short'), props.initialCapital, lastClose, broker.maxContractsHeld.short);
  const curve = broker.equityCurve;
  const returns = monthlyReturns(curve, props.initialCapital);
  const last = curve[curve.length - 1];
  all.buyHoldReturn = last ? last.buyHold : 0;
  all.buyHoldReturnPct = props.initialCapital ? ((last ? last.buyHold : 0) / props.initialCapital) * 100 : 0;
  all.maxRunup = broker.maxRunup;
  all.maxRunupPct = broker.maxRunupPct;
  all.maxDrawdown = broker.maxDrawdown;
  all.maxDrawdownPct = broker.maxDrawdownPct;
  all.sharpe = sharpeRatio(returns, props.riskFreeRate);
  all.sortino = sortinoRatio(returns, props.riskFreeRate);
  all.marginCalls = broker.marginCalls;
  return {
    properties: props,
    symbol: meta.symbol,
    resolution: meta.resolution,
    currency: props.currency || meta.currency,
    bars: bars.length,
    firstTime: bars.length ? bars[0].time : 0,
    lastTime: bars.length ? bars[bars.length - 1].time : 0,
    trades, openTrades: open, fills: broker.fills, equity: curve, monthlyReturns: returns,
    all, long, short, marginCalls: broker.marginCalls,
  };
}
