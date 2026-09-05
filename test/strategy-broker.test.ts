import { describe, it, expect } from 'vitest';
import { Broker } from '../src/strategy/Broker';
import { buildReport, monthlyReturns, sharpeRatio, sortinoRatio } from '../src/strategy/metrics';
import type { StrategyBar, StrategyProperties } from '../src/strategy/types';

const DAY = 86400;
function bars(ohlc: Array<[number, number, number, number]>, start = 1_700_000_000): StrategyBar[] {
  return ohlc.map(([o, h, l, c], i) => ({ time: start + i * DAY, open: o, high: h, low: l, close: c, volume: 1000 }));
}
const SYM = { minTick: 0.01, ticker: 'TEST', currency: 'USD' };

/** Drive the broker like the Python runtime does: beginBar → script(i) → endBar. */
function run(b: Broker, script: (i: number, b: Broker) => void): void {
  for (let i = 0; i < b.bars.length; i++) {
    b.beginBar(i);
    script(i, b);
    b.endBar(i);
  }
}

describe('Broker: order timing and fills', () => {
  it('market entries fill at the next bar open; strategy.close exits at the following open', () => {
    const b = new Broker({ initialCapital: 10000 }, bars([[10, 11, 9, 10], [12, 13, 11, 12.5], [13, 14, 12, 13], [15, 16, 14, 15], [15, 15, 15, 15]]), SYM);
    run(b, (i, br) => {
      if (i === 0) br.entry('Long', 'long', { qty: 2 });
      if (i === 2) br.close('Long');
    });
    expect(b.fills.map((f) => [f.bar, f.kind, f.price, f.qty])).toEqual([[1, 'entry', 12, 2], [3, 'close', 15, 2]]);
    expect(b.closedTrades).toHaveLength(1);
    const t = b.closedTrades[0];
    expect(t.entryPrice).toBe(12);
    expect(t.exitPrice).toBe(15);
    expect(t.profit).toBeCloseTo(6, 9);
    expect(t.exitId).toBe('Close entry(s) order Long');
    expect(b.position).toBe(0);
    expect(b.equity).toBeCloseTo(10006, 9);
  });

  it('process_orders_on_close fills market orders at the same bar close', () => {
    const b = new Broker({ processOrdersOnClose: true }, bars([[10, 11, 9, 10.5], [12, 13, 11, 12]]), SYM);
    run(b, (i, br) => { if (i === 0) br.entry('L', 'long'); });
    expect(b.fills[0]).toMatchObject({ bar: 0, price: 10.5 });
  });

  it('limit orders fill at the limit price, or better at a gap, and respect verify-price ticks', () => {
    // buy limit 9.5 placed on bar 0; bar 1 trades 10 → 8 → 11
    const b = new Broker({}, bars([[10, 10, 10, 10], [10, 11, 8, 10.5]]), SYM);
    run(b, (i, br) => { if (i === 0) br.entry('L', 'long', { limit: 9.5 }); });
    expect(b.fills[0]).toMatchObject({ bar: 1, price: 9.5 });
    // gap below the limit: fills at the open (better)
    const g = new Broker({}, bars([[10, 10, 10, 10], [9, 9.5, 8.5, 9]]), SYM);
    run(g, (i, br) => { if (i === 0) br.entry('L', 'long', { limit: 9.5 }); });
    expect(g.fills[0]).toMatchObject({ price: 9 });
    // verify price for limit orders: 60 ticks (0.60) beyond the level required; low 9.0 is only 50 ticks past 9.5
    const v = new Broker({ backtestFillLimitsAssumption: 60 }, bars([[10, 10, 10, 10], [10, 11, 9, 10.5]]), SYM);
    run(v, (i, br) => { if (i === 0) br.entry('L', 'long', { limit: 9.5 }); });
    expect(v.fills).toHaveLength(0);
  });

  it('stop orders fill at the stop (plus slippage) and stop-limit converts to a limit', () => {
    const b = new Broker({ slippage: 2 }, bars([[10, 10, 10, 10], [10, 12, 9, 11]]), SYM);
    run(b, (i, br) => { if (i === 0) br.entry('L', 'long', { stop: 11 }); });
    expect(b.fills[0].price).toBeCloseTo(11.02, 9);
    // stop 11 / limit 11.2: bar 1 is open→low→high→close (open closer to low): after the stop trades at 11 the limit is met immediately
    const sl = new Broker({}, bars([[10, 10, 10, 10], [10, 12, 9, 11]]), SYM);
    run(sl, (i, br) => { if (i === 0) br.entry('L', 'long', { stop: 11, limit: 11.2 }); });
    expect(sl.fills[0].price).toBeCloseTo(11, 9);
  });

  it('intrabar path: with the open nearer the high, price walks open→high→low→close so a stop-loss above the entry fills before a take-profit below', () => {
    // short entry filled at bar 1 open 10; exit bracket: profit 100 ticks (limit 9), loss 50 ticks (stop 10.5)
    // bar 2: open 10.4 (closer to high 10.6 than low 8.5) → path 10.4→10.6→8.5→9 → the stop (10.5) is hit first
    const b = new Broker({}, bars([[10, 10, 10, 10], [10, 10.2, 9.8, 10], [10.4, 10.6, 8.5, 9]]), SYM);
    run(b, (i, br) => {
      if (i === 0) br.entry('S', 'short');
      if (i === 1) br.exit('X', { fromEntry: 'S', profit: 100, loss: 50 });
    });
    expect(b.closedTrades).toHaveLength(1);
    expect(b.closedTrades[0].exitPrice).toBeCloseTo(10.5, 9);
    expect(b.pending).toHaveLength(0); // sibling take-profit cancelled (OCA)
    // same bracket, but a bar whose open is nearer the low walks open→low→high: the take-profit fills first
    const c = new Broker({}, bars([[10, 10, 10, 10], [10, 10.2, 9.8, 10], [10.1, 12, 8.5, 9]]), SYM);
    run(c, (i, br) => {
      if (i === 0) br.entry('S', 'short');
      if (i === 1) br.exit('X', { fromEntry: 'S', profit: 100, loss: 50 });
    });
    expect(c.closedTrades[0].exitPrice).toBeCloseTo(9, 9);
  });

  it('trailing stop activates at trail_points and ratchets by trail_offset', () => {
    // long at 10 (bar 1 open). trail_points 100 ticks → activates at 11; offset 50 ticks → stop = high − 0.5
    const b = new Broker({}, bars([[10, 10, 10, 10], [10, 10.5, 9.9, 10.2], [10.2, 11.5, 10.1, 11.4], [11.4, 12.4, 11.3, 12], [12, 12.1, 11.2, 11.3]]), SYM);
    run(b, (i, br) => {
      if (i === 0) br.entry('L', 'long');
      if (i >= 1) br.exit('T', { fromEntry: 'L', trailPoints: 100, trailOffset: 50 });
    });
    expect(b.closedTrades).toHaveLength(1);
    // after bar 3 the stop sits at 12.4 − 0.5 = 11.9; bar 4 walks 12→12.1→11.2 and hits it
    expect(b.closedTrades[0].exitPrice).toBeCloseTo(11.9, 9);
    expect(b.closedTrades[0].exitBar).toBe(4);
  });
});

describe('Broker: position semantics', () => {
  it('strategy.entry reverses an opposite position and honours pyramiding', () => {
    const b = new Broker({ pyramiding: 0 }, bars([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10, 10, 10], [12, 12, 12, 12], [12, 12, 12, 12]]), SYM);
    run(b, (i, br) => {
      if (i === 0) br.entry('L', 'long', { qty: 3 });
      if (i === 1) br.entry('L2', 'long', { qty: 3 }); // rejected: pyramiding 0
      if (i === 2) br.entry('S', 'short', { qty: 2 }); // reversal: sells 5
    });
    expect(b.fills.map((f) => [f.bar, f.side, f.qty])).toEqual([[1, 'long', 3], [3, 'short', 5]]);
    expect(b.position).toBe(-2);
    expect(b.closedTrades[0]).toMatchObject({ entryId: 'L', exitId: 'S', size: 3, exitPrice: 12 });
    expect(b.closedTrades[0].profit).toBeCloseTo(6, 9);
  });

  it('strategy.order nets against the position instead of reversing', () => {
    const b = new Broker({}, bars([[10, 10, 10, 10], [10, 10, 10, 10], [11, 11, 11, 11], [11, 11, 11, 11]]), SYM);
    run(b, (i, br) => {
      if (i === 0) br.order('L', 'long', { qty: 5 });
      if (i === 1) br.order('S', 'short', { qty: 2 });
    });
    expect(b.position).toBe(3);
    expect(b.closedTrades[0]).toMatchObject({ size: 2, exitPrice: 11 });
  });

  it('pyramiding > 0 allows stacked entries and FIFO closes the oldest first', () => {
    const b = new Broker({ pyramiding: 3 }, bars([[10, 10, 10, 10], [10, 10, 10, 10], [11, 11, 11, 11], [12, 12, 12, 12], [13, 13, 13, 13]]), SYM);
    run(b, (i, br) => {
      if (i === 0 || i === 1) br.entry('L', 'long', { qty: 1 });
      if (i === 3) br.close('L', { qty: 1 });
    });
    expect(b.openTrades.length + b.closedTrades.length).toBe(2);
    expect(b.closedTrades[0]).toMatchObject({ entryPrice: 10, exitPrice: 13, size: 1 });
    expect(b.openTrades[0].entryPrice).toBe(11);
  });

  it('default quantity honours fixed / cash / percent_of_equity and margin caps the size', () => {
    const fixed = new Broker({ defaultQtyValue: 4 }, bars([[10, 10, 10, 10], [10, 10, 10, 10]]), SYM);
    run(fixed, (i, br) => { if (i === 0) br.entry('L', 'long'); });
    expect(fixed.fills[0].qty).toBe(4);
    const cash = new Broker({ defaultQtyType: 'cash', defaultQtyValue: 500 }, bars([[10, 10, 10, 10], [20, 20, 20, 20]]), SYM);
    run(cash, (i, br) => { if (i === 0) br.entry('L', 'long'); });
    expect(cash.fills[0].qty).toBe(25);
    const pct = new Broker({ initialCapital: 10000, defaultQtyType: 'percent_of_equity', defaultQtyValue: 50 }, bars([[10, 10, 10, 10], [25, 25, 25, 25]]), SYM);
    run(pct, (i, br) => { if (i === 0) br.entry('L', 'long'); });
    expect(pct.fills[0].qty).toBe(200);
    // 100 % margin: cannot buy more than equity / price
    const capped = new Broker({ initialCapital: 1000, defaultQtyValue: 500 }, bars([[10, 10, 10, 10], [10, 10, 10, 10]]), SYM);
    run(capped, (i, br) => { if (i === 0) br.entry('L', 'long'); });
    expect(capped.fills[0].qty).toBe(100);
  });

  it('commission is charged per fill and deducted from trade profit', () => {
    const b = new Broker({ commissionType: 'percent', commissionValue: 1 }, bars([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10, 10, 10], [12, 12, 12, 12]]), SYM);
    run(b, (i, br) => { if (i === 0) br.entry('L', 'long', { qty: 10 }); if (i === 2) br.close('L'); });
    const t = b.closedTrades[0];
    expect(t.commission).toBeCloseTo(1 + 1.2, 9);
    expect(t.profit).toBeCloseTo(20 - 2.2, 9);
    expect(b.commissionPaid).toBeCloseTo(2.2, 9);
    const perOrder = new Broker({ commissionType: 'cash_per_order', commissionValue: 5 }, bars([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10, 10, 10], [12, 12, 12, 12]]), SYM);
    run(perOrder, (i, br) => { if (i === 0) br.entry('L', 'long', { qty: 10 }); if (i === 2) br.close('L'); });
    expect(perOrder.closedTrades[0].commission).toBe(10);
  });

  it('risk rules: allow_entry_in blocks the other side, max_drawdown halts the strategy', () => {
    const b = new Broker({}, bars([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10, 10, 10], [10, 10, 10, 10]]), SYM);
    b.riskAllowEntryIn('long');
    run(b, (i, br) => { if (i === 0) br.entry('S', 'short'); });
    expect(b.fills).toHaveLength(0);
    const d = new Broker({ initialCapital: 1000 }, bars([[10, 10, 10, 10], [10, 10, 10, 10], [5, 5, 5, 5], [5, 5, 5, 5], [5, 5, 5, 5]]), SYM);
    d.riskMaxDrawdown(30, 'percent');
    run(d, (i, br) => { if (i === 0) br.entry('L', 'long', { qty: 100 }); if (i === 3) br.entry('L', 'long', { qty: 1 }); });
    expect(d.halted).toBe(true);
    expect(d.position).toBe(0); // liquidated at bar 2 close
    expect(d.fills.filter((f) => f.bar > 2)).toHaveLength(0);
  });
});

describe('Broker: equity curve and report metrics', () => {
  it('tracks equity, max drawdown/run-up with intrabar extremes, and per-trade excursions', () => {
    const b = new Broker({ initialCapital: 1000 }, bars([[10, 10, 10, 10], [10, 10, 10, 10], [10, 14, 8, 12], [12, 12, 6, 7], [7, 7, 7, 7]]), SYM);
    run(b, (i, br) => { if (i === 0) br.entry('L', 'long', { qty: 10 }); if (i === 3) br.close('L'); });
    // bar 2 (open nearer the low → walks open→low→high): equity 980 then 1040 → run-up 60
    // bar 3 (open nearer the high → walks open→high→low): 1020 then 960 → drawdown from the 1040 peak = 80
    expect(b.maxRunup).toBeCloseTo(60, 9);
    expect(b.maxDrawdown).toBeCloseTo(80, 9);
    expect(b.maxDrawdownPct).toBeCloseTo((80 / 1040) * 100, 9);
    const t = b.closedTrades[0];
    expect(t.runup).toBeCloseTo(40, 9);
    expect(t.drawdown).toBeCloseTo(40, 9);
    expect(t.exitPrice).toBe(7);
    expect(t.profit).toBeCloseTo(-30, 9);
    const eq = b.equityCurve;
    expect(eq[2].equity).toBeCloseTo(1020, 9);
    expect(eq[4].equity).toBeCloseTo(970, 9);
  });

  it('buildReport fills the TradingView performance summary', () => {
    const b = new Broker({ initialCapital: 1000 }, bars([
      [10, 10, 10, 10], [10, 10, 10, 10], [12, 12, 12, 12], [12, 12, 12, 12], [11, 11, 11, 11], [11, 11, 11, 11], [11, 11, 11, 11], [14, 14, 14, 14],
    ]), SYM);
    run(b, (i, br) => {
      if (i === 0) br.entry('L', 'long', { qty: 10 }); // fills 10 @ bar1, closed @ bar3 → +20
      if (i === 2) br.close('L');
      if (i === 3) br.entry('S', 'short', { qty: 10 }); // fills @ bar4 11, closed @ bar7 14 → −30
      if (i === 6) br.close('S');
    });
    const r = buildReport(b, { symbol: 'TEST', resolution: '1D', currency: 'USD' });
    expect(r.all.totalTrades).toBe(2);
    expect(r.all.winningTrades).toBe(1);
    expect(r.all.losingTrades).toBe(1);
    expect(r.all.netProfit).toBeCloseTo(-10, 9);
    expect(r.all.netProfitPct).toBeCloseTo(-1, 9);
    expect(r.all.grossProfit).toBeCloseTo(20, 9);
    expect(r.all.grossLoss).toBeCloseTo(-30, 9);
    expect(r.all.profitFactor).toBeCloseTo(20 / 30, 9);
    expect(r.all.percentProfitable).toBe(50);
    expect(r.all.avgTrade).toBeCloseTo(-5, 9);
    expect(r.all.ratioAvgWinLoss).toBeCloseTo(20 / 30, 9);
    expect(r.all.largestWinningTrade).toBeCloseTo(20, 9);
    expect(r.all.largestLosingTrade).toBeCloseTo(-30, 9);
    expect(r.all.avgBarsInTrades).toBe(2.5);
    expect(r.all.maxContractsHeld).toBe(10);
    expect(r.long.netProfit).toBeCloseTo(20, 9);
    expect(r.short.netProfit).toBeCloseTo(-30, 9);
    expect(r.long.totalTrades).toBe(1);
    expect(r.all.buyHoldReturn).toBeCloseTo(1000 * (14 / 10 - 1), 9);
    expect(r.long.buyHoldReturn).toBeNull();
    expect(r.all.maxDrawdown).toBeCloseTo(30, 9);
    expect(r.trades[1].cumProfit).toBeCloseTo(-10, 9);
  });

  it('monthly returns, Sharpe and Sortino follow TradingView definitions', () => {
    const start = Date.UTC(2024, 0, 15) / 1000;
    const pts = [];
    const equities = [1000, 1050, 1100, 1000, 1200];
    for (let m = 0; m < equities.length; m++) pts.push({ bar: m, time: start + m * 31 * DAY, equity: equities[m], equityLow: 0, equityHigh: 0, netProfit: 0, openProfit: 0, drawdown: 0, drawdownPct: 0, buyHold: 0 });
    const r = monthlyReturns(pts as any, 1000);
    expect(r).toHaveLength(5);
    expect(r[0]).toBeCloseTo(0, 9); // first month: 1000 → 1000
    expect(r[1]).toBeCloseTo(0.05, 9);
    expect(r[3]).toBeCloseTo(1000 / 1100 - 1, 9);
    const rf = 0.02 / 12;
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, v) => a + (v - mean) ** 2, 0) / r.length);
    expect(sharpeRatio(r, 2)).toBeCloseTo((mean - rf) / sd, 9);
    const dd = Math.sqrt(r.reduce((a, v) => a + Math.min(v - rf, 0) ** 2, 0) / r.length);
    expect(sortinoRatio(r, 2)).toBeCloseTo((mean - rf) / dd, 9);
    expect(sharpeRatio([0.1], 2)).toBeNull();
  });
});

describe('Broker: defaults', () => {
  it('uses TradingView defaults for unspecified properties', () => {
    const b = new Broker({}, [], SYM);
    const p: StrategyProperties = b.props;
    expect(p.initialCapital).toBe(1_000_000);
    expect(p.pyramiding).toBe(0);
    expect(p.defaultQtyType).toBe('fixed');
    expect(p.defaultQtyValue).toBe(1);
    expect(p.commissionType).toBe('percent');
    expect(p.commissionValue).toBe(0);
    expect(p.marginLong).toBe(100);
    expect(p.riskFreeRate).toBe(2);
    expect(p.closeEntriesRule).toBe('FIFO');
  });
});
