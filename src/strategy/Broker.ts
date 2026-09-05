/**
 * Broker emulator — a TypeScript port of the rules TradingView documents for its strategy tester:
 *
 * - Orders placed on bar i fill no earlier than bar i+1 (market orders at its open) unless
 *   processOrdersOnClose is set, which adds an extra pass at bar i's close.
 * - Inside a bar the emulator assumes price walks open → high → low → close when the open is
 *   closer to the high, and open → low → high → close otherwise; price orders trigger in the order
 *   that walk reaches their levels, so a take-profit and a stop-loss on the same bar resolve the
 *   way TradingView resolves them.
 * - Limit orders fill at their price or better (or at the open when the bar gaps past them);
 *   stop orders at their price or worse, plus slippage. "Verify price for limit orders" delays a
 *   limit fill until price exceeds the level by N ticks.
 * - strategy.entry() reverses an opposite position and obeys pyramiding; strategy.order() nets.
 * - strategy.exit() brackets are one-cancels-other per trade; trailing stops activate at a price or
 *   a tick distance and then ratchet by trail_offset ticks.
 * - Equity = initial capital + net profit + open profit; drawdown/run-up use intrabar extremes.
 *
 * The broker is driven bar by bar (beginBar → script → endBar) by the Python runtime and never
 * looks ahead, so a script sees exactly the state Pine Script would see.
 */
import {
  defaultStrategyProperties, type ClosedTrade, type Direction, type EquityPoint, type ExitParams, type FillEvent,
  type OpenTrade, type OrderParams, type PendingKind, type PendingOrder, type StrategyBar, type StrategyLog,
  type StrategyProperties,
} from './types';

interface TradeRec extends OpenTrade { key: number }
interface ExitOrder extends PendingOrder { tradeKey: number; entryBasis: number }
interface DeferredExit { id: string; params: ExitParams; bar: number }

const sign = (d: Direction): 1 | -1 => (d === 'long' ? 1 : -1);
const other = (d: Direction): Direction => (d === 'long' ? 'short' : 'long');
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface BrokerSymbol { minTick: number; ticker: string; currency: string }

export class Broker {
  readonly props: StrategyProperties;
  readonly bars: StrategyBar[];
  readonly minTick: number;
  pending: PendingOrder[] = [];
  closedTrades: ClosedTrade[] = [];
  fills: FillEvent[] = [];
  equityCurve: EquityPoint[] = [];
  logs: StrategyLog[] = [];
  position = 0;
  realized = 0;
  commissionPaid = 0;
  grossProfit = 0;
  grossLoss = 0;
  peakEquity: number;
  troughEquity: number;
  maxDrawdown = 0;
  maxDrawdownPct = 0;
  maxRunup = 0;
  maxRunupPct = 0;
  maxContractsHeld = { all: 0, long: 0, short: 0 };
  marginCalls = 0;
  halted = false;
  currentBar = -1;

  private _open: TradeRec[] = [];
  private _tradeSeq = 0;
  private _deferredExits: DeferredExit[] = [];
  private _closeCandidates: number[] = [];
  private _lastClose = NaN;
  private _firstClose = NaN;
  // risk rules
  private _allowEntryIn: 'all' | Direction = 'all';
  private _maxPositionSize = Infinity;
  private _riskMaxDrawdown: { value: number; type: 'cash' | 'percent' } | null = null;
  private _riskMaxIntradayLoss: { value: number; type: 'cash' | 'percent' } | null = null;
  private _riskMaxConsLossDays: number | null = null;
  private _riskMaxIntradayFilledOrders: number | null = null;
  private _day = -1;
  private _dayStartEquity = 0;
  private _dayFills = 0;
  private _dayHalted = false;
  private _consLossDays = 0;
  private _prevDayEquity = NaN;

  constructor(props: Partial<StrategyProperties>, bars: StrategyBar[], symbol: BrokerSymbol) {
    this.props = { ...defaultStrategyProperties(), ...props };
    this.bars = bars;
    this.minTick = symbol.minTick > 0 ? symbol.minTick : 0.01;
    this.peakEquity = this.props.initialCapital;
    this.troughEquity = this.props.initialCapital;
    this._dayStartEquity = this.props.initialCapital;
  }

  get openTrades(): OpenTrade[] { return this._open; }

  // ---- per-bar driving -------------------------------------------------------------------------

  /** Fill orders created before bar i against bar i, then update per-trade excursions. */
  beginBar(i: number): void {
    this.currentBar = i;
    const bar = this.bars[i];
    if (!bar) return;
    if (i === 0) this._firstClose = bar.close;
    this._rollDay(bar);
    this._processBar(i, bar, (o) => o.createdBar < i, false);
    this._updateExcursions(bar);
  }

  /** After the script ran on bar i: optional on-close order pass, risk rules, equity snapshot. */
  endBar(i: number): void {
    const bar = this.bars[i];
    if (!bar) return;
    if (this.props.processOrdersOnClose) this._processBar(i, bar, (o) => o.createdBar === i, true);
    this._updateExcursions(bar);
    this._lastClose = bar.close;
    this._checkMargin(i, bar);
    this._snapshot(i, bar);
    this._checkRiskRules(i, bar);
  }

  // ---- script commands ---------------------------------------------------------------------------

  entry(id: string, direction: Direction, p: OrderParams = {}): void {
    if (this.halted || this._dayHalted) return;
    if (this._allowEntryIn !== 'all' && this._allowEntryIn !== direction) {
      // Entries in a disallowed direction only close the opposite position (TradingView rule).
      if (this.position !== 0 && (this.position > 0 ? 'long' : 'short') !== direction) this.closeAll(p.comment ?? '');
      return;
    }
    const same = this._open.filter((t) => t.direction === direction).length;
    const sameDirPosition = this.position !== 0 && (this.position > 0 ? 'long' : 'short') === direction;
    if (sameDirPosition && same >= Math.max(1, this.props.pyramiding)) return; // pyramiding limit
    this._place({ id, kind: 'entry', side: direction, isEntry: true, ...this._orderFields(p) });
  }

  order(id: string, direction: Direction, p: OrderParams = {}): void {
    if (this.halted || this._dayHalted) return;
    this._place({ id, kind: 'order', side: direction, isEntry: false, ...this._orderFields(p) });
  }

  exit(id: string, p: ExitParams = {}): void {
    if (this.halted) return;
    const hasLevel = isNum(p.profit) || isNum(p.limit) || isNum(p.loss) || isNum(p.stop) || isNum(p.trailPrice) || isNum(p.trailPoints);
    if (!hasLevel) return;
    const from = p.fromEntry ?? '';
    const targets = this._open.filter((t) => !from || t.entryId === from);
    const entryPending = this.pending.some((o) => (o.kind === 'entry' || o.kind === 'order') && (!from || o.id === from));
    if (!targets.length) {
      // TradingView waits for the entry to fill before creating its exit orders.
      if (entryPending) this._deferredExits = [...this._deferredExits.filter((d) => d.id !== id), { id, params: p, bar: this.currentBar }];
      return;
    }
    for (const t of targets) this._upsertExitOrders(id, t, p);
    if (entryPending) this._deferredExits = [...this._deferredExits.filter((d) => d.id !== id), { id, params: p, bar: this.currentBar }];
  }

  close(id: string, p: { qty?: number | null; qtyPercent?: number | null; comment?: string } = {}): void {
    if (!this._open.some((t) => t.entryId === id)) return;
    this.pending = this.pending.filter((o) => !(o.kind === 'close' && o.id === `close:${id}`));
    this.pending.push(this._blank({ id: `close:${id}`, kind: 'close', side: 'short', fromEntry: id, qty: isNum(p.qty) ? p.qty : null, qtyPercent: isNum(p.qtyPercent) ? p.qtyPercent : 100, comment: p.comment ?? '' }));
  }

  closeAll(comment = ''): void {
    if (!this._open.length) return;
    this.pending = this.pending.filter((o) => o.kind !== 'close' || o.id !== 'close:*');
    this.pending.push(this._blank({ id: 'close:*', kind: 'close', side: 'short', fromEntry: '', qtyPercent: 100, comment }));
  }

  cancel(id: string): void {
    this.pending = this.pending.filter((o) => o.id !== id);
    this._deferredExits = this._deferredExits.filter((d) => d.id !== id);
  }

  cancelAll(): void { this.pending = []; this._deferredExits = []; }

  // ---- risk rules (strategy.risk.*) -----------------------------------------------------------------
  riskAllowEntryIn(dir: 'all' | Direction): void { this._allowEntryIn = dir; }
  riskMaxPositionSize(contracts: number): void { this._maxPositionSize = Math.max(0, contracts); }
  riskMaxDrawdown(value: number, type: 'cash' | 'percent'): void { this._riskMaxDrawdown = { value, type }; }
  riskMaxIntradayLoss(value: number, type: 'cash' | 'percent'): void { this._riskMaxIntradayLoss = { value, type }; }
  riskMaxConsLossDays(days: number): void { this._riskMaxConsLossDays = days; }
  riskMaxIntradayFilledOrders(count: number): void { this._riskMaxIntradayFilledOrders = count; }

  // ---- state for the script ----------------------------------------------------------------------
  get openProfit(): number {
    const px = this._lastClose;
    if (px !== px) return 0;
    let s = 0;
    for (const t of this._open) s += sign(t.direction) * (px - t.entryPrice) * t.size - t.entryCommission;
    return s;
  }
  get equity(): number { return this.props.initialCapital + this.realized + this.openProfit; }
  get netProfit(): number { return this.realized; }
  get positionAvgPrice(): number {
    if (!this._open.length) return NaN;
    let v = 0, q = 0;
    for (const t of this._open) { v += t.entryPrice * t.size; q += t.size; }
    return q ? v / q : NaN;
  }
  get positionEntryName(): string { return this._open.length ? this._open[0].entryId : ''; }
  get winTrades(): number { return this.closedTrades.filter((t) => t.profit > 0).length; }
  get lossTrades(): number { return this.closedTrades.filter((t) => t.profit < 0).length; }
  get evenTrades(): number { return this.closedTrades.filter((t) => t.profit === 0).length; }
  get currentDrawdown(): number { return Math.max(0, this.peakEquity - this.equity); }

  /** Default order size for a fill at `price`, per default_qty_type / default_qty_value. */
  defaultQty(price: number): number {
    const p = this.props;
    switch (p.defaultQtyType) {
      case 'cash': return price > 0 ? p.defaultQtyValue / price : 0;
      case 'percent_of_equity': return price > 0 ? (this.equity * p.defaultQtyValue) / 100 / price : 0;
      default: return p.defaultQtyValue;
    }
  }

  log(level: StrategyLog['level'], message: string): void {
    const bar = this.bars[Math.max(0, this.currentBar)];
    this.logs.push({ level, bar: this.currentBar, time: bar ? bar.time : 0, message });
  }

  // ---- internals: order placement ------------------------------------------------------------------

  private _orderFields(p: OrderParams): Pick<PendingOrder, 'qty' | 'limit' | 'stop' | 'ocaName' | 'ocaType' | 'comment'> {
    return {
      qty: isNum(p.qty) && p.qty > 0 ? p.qty : null,
      limit: isNum(p.limit) ? p.limit : null,
      stop: isNum(p.stop) ? p.stop : null,
      ocaName: p.ocaName ?? '',
      ocaType: p.ocaType ?? 'none',
      comment: p.comment ?? '',
    };
  }

  private _blank(partial: Partial<PendingOrder> & { id: string; kind: PendingKind; side: Direction }): PendingOrder {
    return {
      qty: null, limit: null, stop: null, stopHit: false, ocaName: '', ocaType: 'none', comment: '', createdBar: this.currentBar,
      fromEntry: '', exitType: null, qtyPercent: null, trailActivation: null, trailOffsetTicks: null, trailActive: false, trailStop: null,
      isEntry: false, ...partial,
    };
  }

  private _place(o: Omit<PendingOrder, 'createdBar' | 'stopHit' | 'fromEntry' | 'exitType' | 'qtyPercent' | 'trailActivation' | 'trailOffsetTicks' | 'trailActive' | 'trailStop'>): void {
    // A pending order with the same id is modified, not duplicated.
    this.pending = this.pending.filter((p) => !((p.kind === 'entry' || p.kind === 'order') && p.id === o.id));
    this.pending.push(this._blank(o));
  }

  /** Create or refresh the take-profit / stop-loss / trailing orders of one strategy.exit() call for one trade. */
  private _upsertExitOrders(id: string, t: TradeRec, p: ExitParams): void {
    const tick = this.minTick;
    const s = sign(t.direction);
    const qty = isNum(p.qty) && p.qty > 0 ? Math.min(p.qty, t.size) : (t.size * (isNum(p.qtyPercent) ? p.qtyPercent : 100)) / 100;
    const limit = isNum(p.limit) ? p.limit : isNum(p.profit) ? t.entryPrice + s * p.profit * tick : null;
    const stop = isNum(p.stop) ? p.stop : isNum(p.loss) ? t.entryPrice - s * p.loss * tick : null;
    const trailAct = isNum(p.trailPrice) ? p.trailPrice : isNum(p.trailPoints) ? t.entryPrice + s * p.trailPoints * tick : null;
    const trailOffset = isNum(p.trailOffset) ? p.trailOffset : null;
    const oca = `exit:${id}:${t.key}`;
    const existing = this.pending.filter((o): o is ExitOrder => o.kind === 'exit' && o.id === id && (o as ExitOrder).tradeKey === t.key);
    this.pending = this.pending.filter((o) => !existing.includes(o as ExitOrder));
    const side = other(t.direction);
    const mk = (exitType: ExitOrder['exitType'], fields: Partial<ExitOrder>): ExitOrder => {
      const prev = existing.find((o) => o.exitType === exitType);
      return {
        ...this._blank({ id, kind: 'exit', side }), ...fields, exitType, tradeKey: t.key, entryBasis: t.entryPrice, fromEntry: t.entryId, qty,
        ocaName: oca, ocaType: 'cancel', comment: p.comment ?? '',
        // trailing state survives the per-bar re-issue of the same strategy.exit() call
        trailActive: prev?.trailActive ?? false, trailStop: prev?.trailStop ?? null,
        createdBar: prev ? prev.createdBar : this.currentBar,
      } as ExitOrder;
    };
    if (limit !== null) this.pending.push(mk('take_profit', { limit, comment: p.commentProfit ?? p.comment ?? '' }));
    if (stop !== null) this.pending.push(mk('stop_loss', { stop, comment: p.commentLoss ?? p.comment ?? '' }));
    if (trailAct !== null && trailOffset !== null) this.pending.push(mk('trailing', { trailActivation: trailAct, trailOffsetTicks: trailOffset, comment: p.commentTrailing ?? p.comment ?? '' }));
  }

  // ---- internals: bar processing --------------------------------------------------------------------

  /**
   * Walk bar i's assumed intrabar path and fill every eligible order in the order the path reaches it.
   * `atCloseOnly` is the process_orders_on_close pass: only the close price is examined.
   */
  private _processBar(i: number, bar: StrategyBar, eligible: (o: PendingOrder) => boolean, atCloseOnly: boolean): void {
    const path: number[] = atCloseOnly
      ? [bar.close]
      : (bar.high - bar.open < bar.open - bar.low ? [bar.open, bar.high, bar.low, bar.close] : [bar.open, bar.low, bar.high, bar.close]);
    // point 0: everything already satisfied by the first price fills at that price (gaps).
    this._fillAtPrice(i, bar, path[0], path[0], eligible, atCloseOnly);
    for (let k = 1; k < path.length; k++) {
      const from = path[k - 1], to = path[k];
      if (from === to) continue;
      const rising = to > from;
      // trailing stops ratchet along favourable moves before the next reversal can hit them
      for (const o of this.pending) {
        if (o.kind !== 'exit' || o.exitType !== 'trailing' || !eligible(o)) continue;
        const t = this._open.find((x) => x.key === (o as ExitOrder).tradeKey);
        if (!t) continue;
        const favourable = t.direction === 'long' ? rising : !rising;
        if (!favourable) continue;
        const act = o.trailActivation!;
        const reached = t.direction === 'long' ? to >= act : to <= act;
        if (!o.trailActive && reached) o.trailActive = true;
        if (o.trailActive) {
          const cand = t.direction === 'long' ? to - o.trailOffsetTicks! * this.minTick : to + o.trailOffsetTicks! * this.minTick;
          o.trailStop = o.trailStop === null ? cand : t.direction === 'long' ? Math.max(o.trailStop, cand) : Math.min(o.trailStop, cand);
        }
      }
      // orders whose level lies inside this segment trigger in the order the segment reaches them
      let guard = 0;
      while (guard++ < 200) {
        let best: { o: PendingOrder; level: number } | null = null;
        for (const o of this.pending) {
          if (!eligible(o)) continue;
          const lvl = this._triggerLevel(o, rising);
          if (lvl === null) continue;
          const inside = rising ? lvl > from && lvl <= to : lvl < from && lvl >= to;
          if (!inside) continue;
          if (!best || (rising ? lvl < best.level : lvl > best.level)) best = { o, level: lvl };
        }
        if (!best) break;
        this._fillAtPrice(i, bar, best.level, best.level, (o) => o === best!.o, atCloseOnly);
        if (this.pending.includes(best.o)) {
          // stop-limit: the stop traded but the limit did not; keep walking
          if (best.o.stopHit && best.o.limit !== null) continue;
          break;
        }
      }
    }
  }

  /** Price level at which an order triggers when price moves in the given direction, or null. */
  private _triggerLevel(o: PendingOrder, rising: boolean): number | null {
    const buy = o.side === 'long';
    const tick = this.minTick;
    if (o.kind === 'exit' && o.exitType === 'trailing') {
      if (!o.trailActive || o.trailStop === null) return null;
      // a long's trailing stop is a sell stop (hit on a falling move), a short's is a buy stop
      return buy === rising ? o.trailStop : null;
    }
    if (o.stop !== null && !o.stopHit) {
      // buy stops trigger on the way up, sell stops on the way down
      return buy === rising ? o.stop : null;
    }
    if (o.limit !== null) {
      const k = this.props.backtestFillLimitsAssumption * tick;
      // buy limits trigger on the way down, sell limits on the way up
      if (buy !== rising) return buy ? o.limit - k : o.limit + k;
      return null;
    }
    return null; // market orders fill at the first price
  }

  /** Fill every order in `pick` that is satisfied at `price`. */
  private _fillAtPrice(i: number, bar: StrategyBar, price: number, _level: number, pick: (o: PendingOrder) => boolean, atCloseOnly: boolean): void {
    let guard = 0;
    while (guard++ < 500) {
      const o = this.pending.find((x) => pick(x) && this._satisfiedAt(x, price));
      if (!o) return;
      if (o.stop !== null && o.limit !== null && !o.stopHit) {
        // stop-limit: the stop level traded; it is now a limit order (re-checked on the next pass)
        o.stopHit = true;
        if (!this._satisfiedAt(o, price)) continue;
      }
      this._fill(i, bar, o, this._fillPrice(o, price), atCloseOnly);
    }
  }

  private _satisfiedAt(o: PendingOrder, price: number): boolean {
    const buy = o.side === 'long';
    if (o.kind === 'exit' && o.exitType === 'trailing') return o.trailActive && o.trailStop !== null && (buy ? price >= o.trailStop : price <= o.trailStop);
    if (o.stop !== null && !o.stopHit) return buy ? price >= o.stop : price <= o.stop;
    if (o.limit !== null) {
      const k = this.props.backtestFillLimitsAssumption * this.minTick;
      return buy ? price <= o.limit - k : price >= o.limit + k;
    }
    return true;
  }

  /** Limit orders fill at their limit (or better at a gap); market/stop fills take slippage. */
  private _fillPrice(o: PendingOrder, price: number): number {
    const buy = o.side === 'long';
    const isLimit = o.limit !== null && (o.stop === null || o.stopHit);
    const trailing = o.kind === 'exit' && o.exitType === 'trailing';
    if (isLimit && !trailing) return buy ? Math.min(price, o.limit!) : Math.max(price, o.limit!);
    const slip = this.props.slippage * this.minTick;
    return buy ? price + slip : price - slip;
  }

  private _fill(i: number, bar: StrategyBar, o: PendingOrder, price: number, _atClose: boolean): void {
    this.pending = this.pending.filter((x) => x !== o);
    if (this._riskMaxIntradayFilledOrders !== null && this._dayFills >= this._riskMaxIntradayFilledOrders) {
      this._dayHalted = true;
      return;
    }
    let qty: number;
    let closes = 0;
    if (o.kind === 'exit' || o.kind === 'close') {
      const targets = o.kind === 'exit'
        ? this._open.filter((t) => t.key === (o as ExitOrder).tradeKey)
        : this._open.filter((t) => !o.fromEntry || t.entryId === o.fromEntry);
      if (!targets.length) return;
      const total = targets.reduce((s, t) => s + t.size, 0);
      qty = o.qty !== null ? Math.min(o.qty, total) : (total * (o.qtyPercent ?? 100)) / 100;
      if (qty <= 0) return;
      closes = this._closeTrades(i, bar, targets, qty, price, o);
      this._afterFill(i, bar, o, closes, price, 0);
      return;
    }
    // entries / orders
    const posDir: Direction | null = this.position === 0 ? null : this.position > 0 ? 'long' : 'short';
    const opposite = posDir !== null && posDir !== o.side;
    let openQty = o.qty ?? this.defaultQty(price);
    if (o.isEntry && posDir === o.side && this._open.filter((t) => t.direction === o.side).length >= Math.max(1, this.props.pyramiding)) return;
    if (opposite) {
      if (o.isEntry) {
        // strategy.entry() reverses: close the whole opposite position, then open the new one
        closes = this._closeTrades(i, bar, this._open.slice(), Math.abs(this.position), price, o);
      } else {
        // strategy.order() nets against the position
        const reduce = Math.min(openQty, Math.abs(this.position));
        closes = this._closeTrades(i, bar, this._open.slice(), reduce, price, o);
        openQty -= reduce;
      }
    }
    if (openQty > 0) {
      const cap = this._maxOpenQty(o.side, price);
      if (openQty > cap) {
        if (cap <= 0) {
          if (o.isEntry) this.log('warning', `Order "${o.id}" not filled: not enough funds for the position at ${price}`);
          this._afterFill(i, bar, o, closes, price, 0);
          return;
        }
        openQty = cap;
      }
      openQty = Math.round(openQty * 1e8) / 1e8;
      const commission = this._commission(openQty, price);
      this.commissionPaid += commission;
      const t: TradeRec = {
        key: ++this._tradeSeq, entryId: o.id, entryComment: o.comment, direction: o.side, size: openQty, entryBar: i, entryTime: bar.time,
        entryPrice: price, entryCommission: commission, runup: 0, drawdown: 0, runupPct: 0, drawdownPct: 0,
      };
      this._open.push(t);
      this.position += sign(o.side) * openQty;
      this._trackContracts();
      // exits requested while this entry was pending materialise now
      for (const d of this._deferredExits) if (!d.params.fromEntry || d.params.fromEntry === o.id) this._upsertExitOrders(d.id, t, d.params);
      this._deferredExits = this._deferredExits.filter((d) => d.params.fromEntry && d.params.fromEntry !== o.id);
    }
    this._afterFill(i, bar, o, closes, price, openQty);
  }

  private _afterFill(i: number, bar: StrategyBar, o: PendingOrder, closedQty: number, price: number, openedQty: number): void {
    const qty = closedQty + openedQty;
    if (qty > 0) {
      this.fills.push({ bar: i, time: bar.time, orderId: o.id, kind: o.kind, side: o.side, qty, price, comment: o.comment, position: this.position });
      this._dayFills++;
    }
    // one-cancels-other groups
    if (o.ocaName) {
      for (const p of this.pending.slice()) {
        if (p === o || p.ocaName !== o.ocaName) continue;
        if (o.ocaType === 'cancel' || p.ocaType === 'cancel') this.pending = this.pending.filter((x) => x !== p);
        else if (o.ocaType === 'reduce' || p.ocaType === 'reduce') {
          if (p.qty !== null) { p.qty -= qty; if (p.qty <= 0) this.pending = this.pending.filter((x) => x !== p); }
        }
      }
    }
    // exits bound to trades that no longer exist are dropped
    this.pending = this.pending.filter((p) => p.kind !== 'exit' || this._open.some((t) => t.key === (p as ExitOrder).tradeKey));
    if (!this._open.length) this.pending = this.pending.filter((p) => p.kind !== 'close');
  }

  /** Close `qty` contracts out of `targets` (FIFO), returning the quantity actually closed. */
  private _closeTrades(i: number, bar: StrategyBar, targets: TradeRec[], qty: number, price: number, o: PendingOrder): number {
    let left = qty;
    let closed = 0;
    const list = this.props.closeEntriesRule === 'FIFO' ? targets.slice().sort((a, b) => a.key - b.key) : targets;
    for (const t of list) {
      if (left <= 1e-12) break;
      const part = Math.min(t.size, left);
      const frac = part / t.size;
      const exitCommission = this._commission(part, price);
      this.commissionPaid += exitCommission;
      const entryCommission = t.entryCommission * frac;
      const gross = sign(t.direction) * (price - t.entryPrice) * part;
      const profit = gross - entryCommission - exitCommission;
      this.realized += profit;
      if (profit > 0) this.grossProfit += profit; else this.grossLoss += profit;
      const entryValue = t.entryPrice * part;
      const ct: ClosedTrade = {
        entryId: t.entryId, entryComment: t.entryComment, direction: t.direction, size: part, entryBar: t.entryBar, entryTime: t.entryTime,
        entryPrice: t.entryPrice, entryCommission, runup: t.runup * frac, drawdown: t.drawdown * frac, runupPct: t.runupPct, drawdownPct: t.drawdownPct,
        exitId: o.kind === 'close' ? (o.fromEntry ? `Close entry(s) order ${o.fromEntry}` : 'Close position order') : o.id,
        exitComment: o.comment, exitBar: i, exitTime: bar.time, exitPrice: price, exitCommission, profit,
        profitPct: entryValue ? (profit / entryValue) * 100 : 0, cumProfit: this.realized, cumProfitPct: (this.realized / this.props.initialCapital) * 100,
        commission: entryCommission + exitCommission,
      };
      // the exit bar's excursion counts for the closed trade too
      const exRun = sign(t.direction) * ((t.direction === 'long' ? bar.high : bar.low) - t.entryPrice) * part;
      const exDd = sign(t.direction) * (t.entryPrice - (t.direction === 'long' ? bar.low : bar.high)) * part;
      ct.runup = Math.max(ct.runup, exRun, 0);
      ct.drawdown = Math.max(ct.drawdown, exDd, 0);
      ct.runupPct = entryValue ? (ct.runup / entryValue) * 100 : 0;
      ct.drawdownPct = entryValue ? (ct.drawdown / entryValue) * 100 : 0;
      this.closedTrades.push(ct);
      t.size -= part;
      t.entryCommission -= entryCommission;
      t.runup -= t.runup * frac;
      t.drawdown -= t.drawdown * frac;
      this.position -= sign(t.direction) * part;
      left -= part;
      closed += part;
      if (t.size <= 1e-12) this._open = this._open.filter((x) => x !== t);
    }
    if (Math.abs(this.position) < 1e-9) this.position = 0;
    return closed;
  }

  private _commission(qty: number, price: number): number {
    const p = this.props;
    if (!p.commissionValue) return 0;
    switch (p.commissionType) {
      case 'cash_per_contract': return qty * p.commissionValue;
      case 'cash_per_order': return p.commissionValue;
      default: return (Math.abs(qty * price) * p.commissionValue) / 100;
    }
  }

  /** Largest quantity that margin and strategy.risk.max_position_size allow to open at `price`. */
  private _maxOpenQty(side: Direction, price: number): number {
    let cap = Infinity;
    const margin = side === 'long' ? this.props.marginLong : this.props.marginShort;
    if (margin > 0 && price > 0) {
      const used = this._open.reduce((s, t) => s + t.size * t.entryPrice * ((t.direction === 'long' ? this.props.marginLong : this.props.marginShort) / 100), 0);
      cap = Math.max(0, (this.equity - used) / (price * (margin / 100)));
    }
    if (Number.isFinite(this._maxPositionSize)) cap = Math.min(cap, Math.max(0, this._maxPositionSize - Math.abs(this.position)));
    return cap;
  }

  private _trackContracts(): void {
    const abs = Math.abs(this.position);
    this.maxContractsHeld.all = Math.max(this.maxContractsHeld.all, abs);
    if (this.position > 0) this.maxContractsHeld.long = Math.max(this.maxContractsHeld.long, abs);
    if (this.position < 0) this.maxContractsHeld.short = Math.max(this.maxContractsHeld.short, abs);
  }

  private _updateExcursions(bar: StrategyBar): void {
    for (const t of this._open) {
      const s = sign(t.direction);
      const best = t.direction === 'long' ? bar.high : bar.low;
      const worst = t.direction === 'long' ? bar.low : bar.high;
      const run = s * (best - t.entryPrice) * t.size;
      const dd = s * (t.entryPrice - worst) * t.size;
      if (run > t.runup) t.runup = run;
      if (dd > t.drawdown) t.drawdown = dd;
      const ev = t.entryPrice * t.size;
      t.runupPct = ev ? (t.runup / ev) * 100 : 0;
      t.drawdownPct = ev ? (t.drawdown / ev) * 100 : 0;
    }
  }

  /** Margin call: when the position's margin requirement exceeds equity, the position is liquidated at the close. */
  private _checkMargin(i: number, bar: StrategyBar): void {
    if (this.position === 0) return;
    const dir: Direction = this.position > 0 ? 'long' : 'short';
    const margin = dir === 'long' ? this.props.marginLong : this.props.marginShort;
    if (margin <= 0) return;
    const required = Math.abs(this.position) * bar.close * (margin / 100);
    if (this.equity >= required && this.equity > 0) return;
    this.marginCalls++;
    this.log('warning', `Margin call on bar ${i}: position liquidated at ${bar.close}`);
    const o = this._blank({ id: 'Margin call', kind: 'close', side: other(dir), fromEntry: '', qtyPercent: 100, comment: 'Margin call' });
    this._closeTrades(i, bar, this._open.slice(), Math.abs(this.position), bar.close, o);
    this.fills.push({ bar: i, time: bar.time, orderId: 'Margin call', kind: 'close', side: other(dir), qty: Math.abs(this.position), price: bar.close, comment: 'Margin call', position: 0 });
    this.pending = this.pending.filter((p) => p.kind !== 'exit' && p.kind !== 'close');
  }

  private _snapshot(i: number, bar: StrategyBar): void {
    const base = this.props.initialCapital + this.realized;
    let lo = 0, hi = 0, open = 0;
    for (const t of this._open) {
      const s = sign(t.direction);
      open += s * (bar.close - t.entryPrice) * t.size - t.entryCommission;
      lo += s * ((t.direction === 'long' ? bar.low : bar.high) - t.entryPrice) * t.size - t.entryCommission;
      hi += s * ((t.direction === 'long' ? bar.high : bar.low) - t.entryPrice) * t.size - t.entryCommission;
    }
    const equity = base + open, equityLow = base + lo, equityHigh = base + hi;
    // Intrabar equity extremes are applied in the order the assumed price path reaches them
    // (same rule as order fills), so a run-up or drawdown never spans a move that could not happen.
    const applyHigh = (): void => {
      if (equityHigh > this.peakEquity) this.peakEquity = equityHigh;
      const runup = equityHigh - this.troughEquity;
      if (runup > this.maxRunup) { this.maxRunup = runup; this.maxRunupPct = this.troughEquity > 0 ? (runup / this.troughEquity) * 100 : 0; }
    };
    const applyLow = (): void => {
      if (equityLow < this.troughEquity) this.troughEquity = equityLow;
      const dd = this.peakEquity - equityLow;
      if (dd > this.maxDrawdown) { this.maxDrawdown = dd; this.maxDrawdownPct = this.peakEquity > 0 ? (dd / this.peakEquity) * 100 : 0; }
    };
    const lowFirst = !(bar.high - bar.open < bar.open - bar.low);
    if (this._open.length && (this._open[0].direction === 'long') !== lowFirst) { applyHigh(); applyLow(); }
    else { applyLow(); applyHigh(); }
    const ddNow = Math.max(0, this.peakEquity - equity);
    this.equityCurve.push({
      bar: i, time: bar.time, equity, equityLow, equityHigh, netProfit: this.realized, openProfit: open,
      drawdown: ddNow, drawdownPct: this.peakEquity > 0 ? (ddNow / this.peakEquity) * 100 : 0,
      buyHold: this._firstClose > 0 ? this.props.initialCapital * (bar.close / this._firstClose - 1) : 0,
    });
  }

  private _rollDay(bar: StrategyBar): void {
    const day = Math.floor(bar.time / 86400);
    if (day === this._day) return;
    if (this._day >= 0) {
      const eq = this.equity;
      if (this._prevDayEquity === this._prevDayEquity) this._consLossDays = eq < this._prevDayEquity ? this._consLossDays + 1 : 0;
      this._prevDayEquity = eq;
      if (this._riskMaxConsLossDays !== null && this._consLossDays >= this._riskMaxConsLossDays && !this.halted) {
        this.halted = true;
        this.log('warning', `strategy.risk.max_cons_loss_days: ${this._consLossDays} consecutive losing days, trading stopped`);
        this.pending = [];
      }
    }
    this._day = day;
    this._dayStartEquity = this.equity;
    this._dayFills = 0;
    this._dayHalted = false;
  }

  private _checkRiskRules(i: number, bar: StrategyBar): void {
    if (this.halted) return;
    const liquidate = (reason: string): void => {
      this.log('warning', reason);
      this.pending = [];
      if (this.position !== 0) {
        const dir: Direction = this.position > 0 ? 'long' : 'short';
        const o = this._blank({ id: 'Risk rule', kind: 'close', side: other(dir), fromEntry: '', qtyPercent: 100, comment: reason });
        const q = Math.abs(this.position);
        this._closeTrades(i, bar, this._open.slice(), q, bar.close, o);
        this.fills.push({ bar: i, time: bar.time, orderId: 'Risk rule', kind: 'close', side: other(dir), qty: q, price: bar.close, comment: reason, position: 0 });
      }
    };
    if (this._riskMaxDrawdown) {
      const r = this._riskMaxDrawdown;
      const limit = r.type === 'cash' ? r.value : (r.value / 100) * this.peakEquity;
      if (this.currentDrawdown >= limit && limit > 0) { this.halted = true; liquidate('strategy.risk.max_drawdown reached: trading stopped'); return; }
    }
    if (this._riskMaxIntradayLoss && !this._dayHalted) {
      const r = this._riskMaxIntradayLoss;
      const loss = this._dayStartEquity - this.equity;
      const limit = r.type === 'cash' ? r.value : (r.value / 100) * this._dayStartEquity;
      if (loss >= limit && limit > 0) { this._dayHalted = true; liquidate('strategy.risk.max_intraday_loss reached: no more trades today'); }
    }
  }
}
