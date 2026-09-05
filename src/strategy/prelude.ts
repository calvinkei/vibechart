/**
 * The Python side of the strategy runtime. It is executed once per Pyodide instance and gives user
 * scripts a Pine-Script-shaped API: bar-by-bar execution, series with the [] history operator,
 * stateful ta.* functions keyed by call site, input.*, plot*(), and a `strategy` object whose
 * order commands are forwarded to the TypeScript broker through `_bridge`.
 *
 * Kept as a string so the library stays a single dependency-free bundle.
 */
export const PRELUDE = String.raw`
import math as _math
import sys as _sys
import traceback as _traceback
from datetime import datetime as _dt, timezone as _tz

_STRATEGY_FILE = '<strategy>'

class _NA(float):
    """Pine's na: a nan value that is also callable as na(x)."""
    def __new__(cls):
        return float.__new__(cls, 'nan')
    def __call__(self, x=None):
        return _isna(x)
    def __repr__(self):
        return 'na'

def _isna(x):
    if x is None:
        return True
    if isinstance(x, Series):
        x = x[0]
    try:
        return x != x
    except Exception:
        return False

na = _NA()

def _val(x, k=0):
    if isinstance(x, Series):
        return x[k]
    if x is None:
        return float('nan')
    if isinstance(x, bool):
        return x
    return x

class Series:
    """A value with history: s[0] is the current bar, s[1] the previous one. Arithmetic and
    comparisons build lazy series so (a + b)[3] works without storing anything."""
    __slots__ = ()
    def __getitem__(self, k):
        raise NotImplementedError
    @property
    def value(self):
        return self[0]
    def __float__(self):
        v = self[0]
        return float(v) if v is not None else float('nan')
    def __int__(self):
        v = self[0]
        return int(v) if v == v else 0
    def __bool__(self):
        v = self[0]
        if v is None:
            return False
        try:
            return bool(v) and v == v
        except Exception:
            return False
    def __repr__(self):
        return 'Series(%r)' % (self[0],)
    def __str__(self):
        return str(self[0])
    def __format__(self, spec):
        return format(self[0], spec)
    def _bin(self, other, fn):
        return _Lazy(fn, (self, other))
    def _rbin(self, other, fn):
        return _Lazy(fn, (other, self))
    def __add__(self, o): return self._bin(o, _add)
    def __radd__(self, o): return self._rbin(o, _add)
    def __sub__(self, o): return self._bin(o, _sub)
    def __rsub__(self, o): return self._rbin(o, _sub)
    def __mul__(self, o): return self._bin(o, _mul)
    def __rmul__(self, o): return self._rbin(o, _mul)
    def __truediv__(self, o): return self._bin(o, _div)
    def __rtruediv__(self, o): return self._rbin(o, _div)
    def __floordiv__(self, o): return self._bin(o, lambda a, b: a // b)
    def __mod__(self, o): return self._bin(o, lambda a, b: a % b)
    def __pow__(self, o): return self._bin(o, lambda a, b: a ** b)
    def __neg__(self): return _Lazy(lambda a: -a, (self,))
    def __pos__(self): return self
    def __abs__(self): return _Lazy(abs, (self,))
    def __lt__(self, o): return self._bin(o, lambda a, b: a < b)
    def __le__(self, o): return self._bin(o, lambda a, b: a <= b)
    def __gt__(self, o): return self._bin(o, lambda a, b: a > b)
    def __ge__(self, o): return self._bin(o, lambda a, b: a >= b)
    def __eq__(self, o): return self._bin(o, lambda a, b: a == b)
    def __ne__(self, o): return self._bin(o, lambda a, b: a != b)
    __hash__ = object.__hash__
    def __and__(self, o): return self._bin(o, lambda a, b: bool(a) and bool(b))
    def __or__(self, o): return self._bin(o, lambda a, b: bool(a) or bool(b))
    def __invert__(self): return _Lazy(lambda a: not a, (self,))
    def __round__(self, n=None): return round(self[0], n) if n is not None else round(self[0])

def _nanop(fn):
    def g(a, b):
        if a is None or b is None:
            return float('nan')
        if isinstance(a, bool) or isinstance(b, bool):
            return fn(a, b)
        if a != a or b != b:
            return float('nan')
        return fn(a, b)
    return g
_add = _nanop(lambda a, b: a + b)
_sub = _nanop(lambda a, b: a - b)
_mul = _nanop(lambda a, b: a * b)
def _div(a, b):
    if a is None or b is None or a != a or b != b or b == 0:
        return float('nan')
    return a / b

class _Data(Series):
    __slots__ = ('_v',)
    def __init__(self):
        self._v = []
    def push(self, v):
        self._v.append(v)
    def __getitem__(self, k):
        k = int(k)
        i = len(self._v) - 1 - k
        return self._v[i] if 0 <= i < len(self._v) else float('nan')
    def __len__(self):
        return len(self._v)
    def set_last(self, v):
        self._v[-1] = v

class _Const(Series):
    __slots__ = ('_c',)
    def __init__(self, c):
        self._c = c
    def __getitem__(self, k):
        return self._c

class _Lazy(Series):
    __slots__ = ('_fn', '_ops')
    def __init__(self, fn, ops):
        self._fn = fn
        self._ops = ops
    def __getitem__(self, k):
        try:
            return self._fn(*[_val(o, k) for o in self._ops])
        except (TypeError, ValueError, ZeroDivisionError, OverflowError):
            return float('nan')

def _s(x):
    return x if isinstance(x, Series) else _Const(x)

def _f(x):
    """current value as float (nan for None/na)"""
    if isinstance(x, Series):
        x = x[0]
    if x is None:
        return float('nan')
    if isinstance(x, bool):
        return 1.0 if x else 0.0
    return float(x)

def _n(x):
    """current value as int (lengths etc.)"""
    v = _f(x)
    return int(v) if v == v else 0

def _b(x):
    if isinstance(x, Series):
        return bool(x)
    if x is None:
        return False
    try:
        return bool(x) and not (isinstance(x, float) and x != x)
    except Exception:
        return False

def nz(x, replacement=0):
    if isinstance(x, Series) or isinstance(replacement, Series):
        return _Lazy(lambda a, b: b if (a is None or a != a) else a, (x, replacement))
    return replacement if _isna(x) else x

def fixnan(x):
    st = _rt.slot('fixnan')
    v = _f(x)
    if v == v:
        st['last'] = v
    return st.get('last', float('nan'))

# ---- colors -------------------------------------------------------------------------------------
class _Color:
    aqua = '#00BCD4'; black = '#363A45'; blue = '#2962FF'; fuchsia = '#E040FB'; gray = '#787B86'; green = '#4CAF50'
    lime = '#00E676'; maroon = '#880E4F'; navy = '#311B92'; olive = '#808000'; orange = '#FF9800'; purple = '#9C27B0'
    red = '#F23645'; silver = '#B2B5BE'; teal = '#00897B'; white = '#FFFFFF'; yellow = '#FFEB3B'
    @staticmethod
    def new(c, transp=0):
        c = str(c)
        if c.startswith('#') and len(c) == 7:
            r, g, b = int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)
            return 'rgba(%d,%d,%d,%.3f)' % (r, g, b, max(0.0, min(1.0, 1 - transp / 100.0)))
        return c
    @staticmethod
    def rgb(r, g, b, transp=0):
        return 'rgba(%d,%d,%d,%.3f)' % (int(r), int(g), int(b), max(0.0, min(1.0, 1 - transp / 100.0)))
    @staticmethod
    def from_gradient(value, bottom_value, top_value, bottom_color, top_color):
        v = _f(value)
        if v != v:
            return bottom_color
        t = 0.0 if top_value == bottom_value else max(0.0, min(1.0, (v - bottom_value) / (top_value - bottom_value)))
        def hexrgb(c):
            return (int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)) if c.startswith('#') and len(c) == 7 else (0, 0, 0)
        a, b = hexrgb(bottom_color), hexrgb(top_color)
        return '#%02X%02X%02X' % tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
color = _Color()

# ---- plot styles / shapes / locations -------------------------------------------------------------
class _PlotNS:
    style_line = 'line'; style_linebr = 'line'; style_stepline = 'stepLine'; style_stepline_diamond = 'stepLine'
    style_histogram = 'histogram'; style_columns = 'columns'; style_area = 'area'; style_areabr = 'area'
    style_circles = 'circles'; style_cross = 'cross'
    def __call__(self, series, title=None, color=None, linewidth=1, style='line', trackprice=False, histbase=0, offset=0, editable=True, show_last=None, display=None, force_overlay=None):
        return _rt.plot(series, title, color, linewidth, style, offset, force_overlay)
plot = _PlotNS()

class _Shape:
    xcross = 'xcross'; cross = 'cross'; triangleup = 'triangleUp'; triangledown = 'triangleDown'; flag = 'flag'
    circle = 'circle'; arrowup = 'arrowUp'; arrowdown = 'arrowDown'; labelup = 'labelUp'; labeldown = 'labelDown'
    square = 'square'; diamond = 'diamond'
shape = _Shape()

class _Location:
    abovebar = 'aboveBar'; belowbar = 'belowBar'; top = 'top'; bottom = 'bottom'; absolute = 'absolute'
location = _Location()

class _Size:
    auto = 'auto'; tiny = 'tiny'; small = 'small'; normal = 'normal'; large = 'large'; huge = 'huge'
size = _Size()

class _HlineNS:
    style_solid = 0; style_dotted = 1; style_dashed = 2
    def __call__(self, price, title=None, color=None, linestyle=0, linewidth=1, editable=True, display=None):
        return _rt.hline(price, title, color, linestyle, linewidth)
hline = _HlineNS()

def plotshape(series, title=None, style='triangleUp', location='aboveBar', color=None, offset=0, text=None, textcolor=None, editable=True, size='auto', show_last=None, display=None, force_overlay=None):
    return _rt.plotshape(series, title, style, location, color, text, size, force_overlay)

def plotchar(series, title=None, char='*', location='aboveBar', color=None, offset=0, text=None, textcolor=None, editable=True, size='auto', show_last=None, display=None, force_overlay=None):
    return _rt.plotchar(series, title, char, location, color, text, size, force_overlay)

def plotarrow(series, title=None, colorup=None, colordown=None, offset=0, minheight=5, maxheight=100, editable=True, show_last=None, display=None, force_overlay=None):
    v = _f(series)
    cond = v == v and v != 0
    return _rt.plotshape(cond, title or 'Arrow', 'arrowUp' if v > 0 else 'arrowDown', 'belowBar' if v > 0 else 'aboveBar', (colorup or color.green) if v > 0 else (colordown or color.red), None, 'small', force_overlay)

def bgcolor(c, offset=0, editable=True, show_last=None, title=None, display=None, force_overlay=None):
    return _rt.bgcolor(c, title)

def fill(*a, **k):
    return None

def alert(message='', freq=None):
    return None

def alertcondition(condition, title=None, message=None):
    return None

class _Log:
    @staticmethod
    def info(msg, *a):
        _rt.log('info', str(msg) % a if a else str(msg))
    @staticmethod
    def warning(msg, *a):
        _rt.log('warning', str(msg) % a if a else str(msg))
    @staticmethod
    def error(msg, *a):
        _rt.log('error', str(msg) % a if a else str(msg))
log = _Log()

class _Runtime:
    @staticmethod
    def error(msg):
        raise RuntimeError(str(msg))
runtime = _Runtime()

class _Str:
    @staticmethod
    def tostring(x, fmt=None):
        v = _val(x)
        if fmt and isinstance(v, (int, float)):
            try:
                if fmt.startswith('#.'):
                    return ('%%.%df' % (len(fmt) - 2)) % v
            except Exception:
                pass
        if isinstance(v, float) and v == int(v) and abs(v) < 1e15:
            return str(int(v)) if fmt is None else str(v)
        return str(v)
    @staticmethod
    def format(fmt, *args):
        out = str(fmt)
        for i, a in enumerate(args):
            out = out.replace('{%d}' % i, _Str.tostring(a))
        return out
    @staticmethod
    def length(s): return len(str(s))
    @staticmethod
    def contains(s, sub): return str(sub) in str(s)
    @staticmethod
    def upper(s): return str(s).upper()
    @staticmethod
    def lower(s): return str(s).lower()
    @staticmethod
    def tonumber(s):
        try:
            return float(s)
        except Exception:
            return float('nan')
str_ = _Str()

# ---- math namespace (Series-aware) ----------------------------------------------------------------
def _mathfn(fn):
    def g(*args):
        if any(isinstance(a, Series) for a in args):
            return _Lazy(lambda *v: fn(*v), tuple(args))
        return fn(*args)
    return g

class _Math:
    pi = _math.pi; e = _math.e; phi = (1 + 5 ** 0.5) / 2; rphi = 2 / (1 + 5 ** 0.5)
    abs = staticmethod(_mathfn(abs)); sqrt = staticmethod(_mathfn(_math.sqrt)); exp = staticmethod(_mathfn(_math.exp))
    log = staticmethod(_mathfn(_math.log)); log10 = staticmethod(_mathfn(_math.log10)); pow = staticmethod(_mathfn(lambda a, b: a ** b))
    sin = staticmethod(_mathfn(_math.sin)); cos = staticmethod(_mathfn(_math.cos)); tan = staticmethod(_mathfn(_math.tan))
    asin = staticmethod(_mathfn(_math.asin)); acos = staticmethod(_mathfn(_math.acos)); atan = staticmethod(_mathfn(_math.atan))
    floor = staticmethod(_mathfn(_math.floor)); ceil = staticmethod(_mathfn(_math.ceil)); sign = staticmethod(_mathfn(lambda a: (a > 0) - (a < 0)))
    max = staticmethod(_mathfn(lambda *a: max(a))); min = staticmethod(_mathfn(lambda *a: min(a)))
    avg = staticmethod(_mathfn(lambda *a: sum(a) / len(a)))
    @staticmethod
    def round(x, precision=None):
        if isinstance(x, Series):
            return _Lazy(lambda v: round(v, precision) if precision is not None else float(round(v)), (x,))
        return round(x, precision) if precision is not None else float(round(x))
    @staticmethod
    def round_to_mintick(x):
        t = syminfo.mintick
        return _mathfn(lambda v: round(v / t) * t)(x)
    @staticmethod
    def sum(src, length):
        return ta.sum(src, length)
    @staticmethod
    def random(min=0, max=1, seed=None):
        import random as _r
        return _r.uniform(min, max)
math = _Math()

# ---- inputs -----------------------------------------------------------------------------------------
class _Input:
    def __call__(self, defval, title=None, tooltip=None, inline=None, group=None, confirm=False, display=None):
        t = 'bool' if isinstance(defval, bool) else 'int' if isinstance(defval, int) else 'float' if isinstance(defval, float) else 'source' if isinstance(defval, Series) else 'string'
        return _rt.input(t, defval, title, None, None, None, None, tooltip, group)
    def int(self, defval, title=None, minval=None, maxval=None, step=None, tooltip=None, inline=None, group=None, confirm=False, options=None, display=None):
        return _rt.input('int', int(defval), title, minval, maxval, step, options, tooltip, group)
    def float(self, defval, title=None, minval=None, maxval=None, step=None, tooltip=None, inline=None, group=None, confirm=False, options=None, display=None):
        return _rt.input('float', float(defval), title, minval, maxval, step, options, tooltip, group)
    def bool(self, defval, title=None, tooltip=None, inline=None, group=None, confirm=False, display=None):
        return _rt.input('bool', bool(defval), title, None, None, None, None, tooltip, group)
    def string(self, defval, title=None, options=None, tooltip=None, inline=None, group=None, confirm=False, display=None):
        return _rt.input('select' if options else 'string', str(defval), title, None, None, None, options, tooltip, group)
    def source(self, defval, title=None, tooltip=None, inline=None, group=None, display=None):
        return _rt.input('source', defval, title, None, None, None, None, tooltip, group)
    def color(self, defval, title=None, tooltip=None, inline=None, group=None, confirm=False, display=None):
        return _rt.input('color', str(defval), title, None, None, None, None, tooltip, group)
    def timeframe(self, defval, title=None, options=None, tooltip=None, inline=None, group=None, confirm=False, display=None):
        return _rt.input('string', str(defval), title, None, None, None, options, tooltip, group)
    def time(self, defval, title=None, tooltip=None, inline=None, group=None, confirm=False, display=None):
        return _rt.input('int', int(defval), title, None, None, None, None, tooltip, group)
input = _Input()

# ---- strategy namespace ------------------------------------------------------------------------------
class _Commission:
    percent = 'percent'; cash_per_contract = 'cash_per_contract'; cash_per_order = 'cash_per_order'
class _Oca:
    cancel = 'cancel'; reduce = 'reduce'; none = 'none'
class _DirectionNS:
    all = 'all'; long = 'long'; short = 'short'

def _opt(v):
    return None if v is None or (isinstance(v, float) and v != v) else _f(v) if isinstance(v, Series) else v

class _TradesInt(int):
    """strategy.opentrades / strategy.closedtrades: an int that also carries the accessor functions."""
    def __new__(cls, n, kind):
        o = int.__new__(cls, n)
        o._kind = kind
        return o
    def _call(self, name, i):
        return getattr(_bridge, self._kind + '_' + name)(int(i))
    def entry_id(self, i): return self._call('entry_id', i)
    def entry_price(self, i): return self._call('entry_price', i)
    def entry_bar_index(self, i): return int(self._call('entry_bar_index', i))
    def entry_time(self, i): return self._call('entry_time', i)
    def entry_comment(self, i): return self._call('entry_comment', i)
    def size(self, i): return self._call('size', i)
    def profit(self, i): return self._call('profit', i)
    def profit_percent(self, i): return self._call('profit_percent', i)
    def commission(self, i): return self._call('commission', i)
    def max_runup(self, i): return self._call('max_runup', i)
    def max_drawdown(self, i): return self._call('max_drawdown', i)
    def max_runup_percent(self, i): return self._call('max_runup_percent', i)
    def max_drawdown_percent(self, i): return self._call('max_drawdown_percent', i)
    def exit_id(self, i): return self._call('exit_id', i)
    def exit_price(self, i): return self._call('exit_price', i)
    def exit_bar_index(self, i): return int(self._call('exit_bar_index', i))
    def exit_time(self, i): return self._call('exit_time', i)
    def exit_comment(self, i): return self._call('exit_comment', i)
    @property
    def first_index(self): return 0

class _Risk:
    @staticmethod
    def allow_entry_in(value): _bridge.risk_allow_entry_in(str(value))
    @staticmethod
    def max_position_size(contracts): _bridge.risk_max_position_size(_f(contracts))
    @staticmethod
    def max_drawdown(value, type, alert_message=None): _bridge.risk_max_drawdown(_f(value), 'percent' if type == 'percent_of_equity' else 'cash')
    @staticmethod
    def max_intraday_loss(value, type, alert_message=None): _bridge.risk_max_intraday_loss(_f(value), 'percent' if type == 'percent_of_equity' else 'cash')
    @staticmethod
    def max_cons_loss_days(count, alert_message=None): _bridge.risk_max_cons_loss_days(int(count))
    @staticmethod
    def max_intraday_filled_orders(count, alert_message=None): _bridge.risk_max_intraday_filled_orders(int(count))

class _Strategy:
    long = 'long'; short = 'short'
    fixed = 'fixed'; cash = 'cash'; percent_of_equity = 'percent_of_equity'
    commission = _Commission(); oca = _Oca(); direction = _DirectionNS(); risk = _Risk()
    def __call__(self, title, shorttitle=None, overlay=True, format=None, precision=None, scale=None, pyramiding=0, calc_on_order_fills=False, calc_on_every_tick=False,
                 max_bars_back=0, backtest_fill_limits_assumption=0, default_qty_type='fixed', default_qty_value=1, initial_capital=1000000, currency=None,
                 slippage=0, commission_type='percent', commission_value=0, process_orders_on_close=False, close_entries_rule='FIFO', margin_long=100, margin_short=100,
                 risk_free_rate=2, use_bar_magnifier=False, fill_orders_on_standard_ohlc=False, **_ignored):
        _rt.declare(dict(title=str(title), shortTitle=str(shorttitle or ''), overlay=bool(overlay), pyramiding=int(pyramiding), calcOnOrderFills=bool(calc_on_order_fills),
                         calcOnEveryTick=bool(calc_on_every_tick), backtestFillLimitsAssumption=float(backtest_fill_limits_assumption), defaultQtyType=str(default_qty_type),
                         defaultQtyValue=float(default_qty_value), initialCapital=float(initial_capital), currency=str(currency or ''), slippage=float(slippage),
                         commissionType=str(commission_type), commissionValue=float(commission_value), processOrdersOnClose=bool(process_orders_on_close),
                         closeEntriesRule=str(close_entries_rule), marginLong=float(margin_long), marginShort=float(margin_short), riskFreeRate=float(risk_free_rate),
                         useBarMagnifier=bool(use_bar_magnifier), fillOrdersOnStandardOhlc=bool(fill_orders_on_standard_ohlc)))
    # ---- commands ----
    def entry(self, id, direction, qty=None, limit=None, stop=None, oca_name=None, oca_type=None, comment=None, alert_message=None, disable_alert=False):
        _bridge.entry(str(id), str(direction), _opt(qty), _opt(limit), _opt(stop), oca_name or '', oca_type or 'none', comment or '')
    def order(self, id, direction, qty=None, limit=None, stop=None, oca_name=None, oca_type=None, comment=None, alert_message=None, disable_alert=False):
        _bridge.order(str(id), str(direction), _opt(qty), _opt(limit), _opt(stop), oca_name or '', oca_type or 'none', comment or '')
    def exit(self, id, from_entry=None, qty=None, qty_percent=None, profit=None, limit=None, loss=None, stop=None, trail_price=None, trail_points=None, trail_offset=None,
             oca_name=None, comment=None, comment_profit=None, comment_loss=None, comment_trailing=None, alert_message=None, alert_profit=None, alert_loss=None, alert_trailing=None, disable_alert=False):
        _bridge.exit(str(id), from_entry or '', _opt(qty), _opt(qty_percent), _opt(profit), _opt(limit), _opt(loss), _opt(stop), _opt(trail_price), _opt(trail_points), _opt(trail_offset),
                     oca_name or '', comment or '', comment_profit or '', comment_loss or '', comment_trailing or '')
    def close(self, id, comment=None, qty=None, qty_percent=None, alert_message=None, immediately=False, disable_alert=False):
        _bridge.close(str(id), _opt(qty), _opt(qty_percent), comment or '')
    def close_all(self, comment=None, alert_message=None, immediately=False, disable_alert=False):
        _bridge.close_all(comment or '')
    def cancel(self, id): _bridge.cancel(str(id))
    def cancel_all(self): _bridge.cancel_all()
    def default_entry_qty(self, fill_price): return _bridge.default_qty(_f(fill_price))
    def convert_to_account(self, value): return value
    def convert_to_symbol(self, value): return value
    # ---- state ----
    @property
    def position_size(self): return _bridge.position_size()
    @property
    def position_avg_price(self): return _bridge.position_avg_price()
    @property
    def position_entry_name(self): return _bridge.position_entry_name()
    @property
    def equity(self): return _bridge.equity()
    @property
    def initial_capital(self): return _bridge.initial_capital()
    @property
    def netprofit(self): return _bridge.netprofit()
    @property
    def netprofit_percent(self): return _bridge.netprofit() / _bridge.initial_capital() * 100 if _bridge.initial_capital() else 0.0
    @property
    def openprofit(self): return _bridge.openprofit()
    @property
    def openprofit_percent(self): return _bridge.openprofit() / _bridge.initial_capital() * 100 if _bridge.initial_capital() else 0.0
    @property
    def grossprofit(self): return _bridge.grossprofit()
    @property
    def grossloss(self): return _bridge.grossloss()
    @property
    def max_drawdown(self): return _bridge.max_drawdown()
    @property
    def max_drawdown_percent(self): return _bridge.max_drawdown_percent()
    @property
    def max_runup(self): return _bridge.max_runup()
    @property
    def max_runup_percent(self): return _bridge.max_runup_percent()
    @property
    def wintrades(self): return int(_bridge.wintrades())
    @property
    def losstrades(self): return int(_bridge.losstrades())
    @property
    def eventrades(self): return int(_bridge.eventrades())
    @property
    def opentrades(self): return _TradesInt(_bridge.open_count(), 'open')
    @property
    def closedtrades(self): return _TradesInt(_bridge.closed_count(), 'closed')
    @property
    def avg_trade(self): return _bridge.avg_trade()
    @property
    def avg_winning_trade(self): return _bridge.avg_winning_trade()
    @property
    def avg_losing_trade(self): return _bridge.avg_losing_trade()
    @property
    def max_contracts_held_all(self): return _bridge.max_contracts_held('all')
    @property
    def max_contracts_held_long(self): return _bridge.max_contracts_held('long')
    @property
    def max_contracts_held_short(self): return _bridge.max_contracts_held('short')
    @property
    def account_currency(self): return syminfo.currency
strategy = _Strategy()

# ---- bar state / symbol / timeframe -------------------------------------------------------------------
class _BarState:
    @property
    def isfirst(self): return _rt.i == 0
    @property
    def islast(self): return _rt.i == _rt.n - 1
    @property
    def ishistory(self): return True
    @property
    def isrealtime(self): return False
    @property
    def isconfirmed(self): return True
    @property
    def isnew(self): return True
    @property
    def islastconfirmedhistory(self): return _rt.i == _rt.n - 1
barstate = _BarState()

class _SymInfo:
    mintick = 0.01; ticker = ''; tickerid = ''; currency = ''; basecurrency = ''; type = ''; description = ''; timezone = 'UTC'; pointvalue = 1.0
    @property
    def prefix(self): return self.tickerid.split(':')[0] if ':' in self.tickerid else ''
syminfo = _SymInfo()

class _Timeframe:
    period = '1D'; multiplier = 1; isintraday = False; isdaily = True; isweekly = False; ismonthly = False; isseconds = False; isminutes = False; isdwm = True
    @staticmethod
    def in_seconds(tf=None):
        return _rt.tf_seconds
timeframe = _Timeframe()

def _tparts(ms):
    if ms != ms:
        return None
    return _dt.fromtimestamp(ms / 1000.0, _tz.utc)

def _tfield(fn):
    return _Lazy(lambda t: (lambda p: float('nan') if p is None else fn(p))(_tparts(t)), (None,))

# ---- technical analysis (stateful per call site, like Pine) --------------------------------------------
class _TA:
    def _slot(self, name):
        return _rt.slot(name)
    def _out(self, st):
        """each call site owns one output series that receives exactly one value per bar"""
        if 'out' not in st:
            st['out'] = _Data()
        out = st['out']
        while len(out) < _rt.i:
            out.push(float('nan'))
        return out
    def _emit(self, st, v):
        out = self._out(st)
        if len(out) == _rt.i:
            out.push(v)
        else:
            out.set_last(v)
        return out
    # -- moving averages --
    def sma(self, src, length):
        st = self._slot('sma'); n = _n(length); v = _f(src)
        buf = st.setdefault('buf', [])
        if len(buf) < _rt.i + 1:
            buf.append(v)
        else:
            buf[-1] = v
        if n <= 0 or len(buf) < n:
            return self._emit(st, float('nan'))
        w = buf[-n:]
        return self._emit(st, float('nan') if any(x != x for x in w) else sum(w) / n)
    def ema(self, src, length):
        st = self._slot('ema'); n = _n(length); v = _f(src)
        return self._emit(st, self._ema_step(st, v, n, 2.0 / (n + 1) if n > 0 else 1.0))
    def rma(self, src, length):
        st = self._slot('rma'); n = _n(length); v = _f(src)
        return self._emit(st, self._ema_step(st, v, n, 1.0 / n if n > 0 else 1.0))
    def _ema_step(self, st, v, n, alpha):
        """seeded with the SMA of the first n values, Pine style"""
        buf = st.setdefault('buf', [])
        if len(buf) < _rt.i + 1:
            buf.append(v)
        else:
            buf[-1] = v
        if n <= 0 or v != v or len(buf) < n:
            return float('nan')
        prev = st.get('prev')
        if prev is None or prev != prev or st.get('prev_bar') != _rt.i - 1:
            w = buf[-n:]
            cur = float('nan') if any(x != x for x in w) else sum(w) / n
        else:
            cur = alpha * v + (1 - alpha) * prev
        if st.get('prev_bar') != _rt.i:
            st['prev_prev'] = st.get('prev')
        st['prev'] = cur; st['prev_bar'] = _rt.i
        return cur
    def wma(self, src, length):
        st = self._slot('wma'); n = _n(length); v = _f(src)
        buf = st.setdefault('buf', [])
        if len(buf) < _rt.i + 1: buf.append(v)
        else: buf[-1] = v
        if n <= 0 or len(buf) < n: return self._emit(st, float('nan'))
        w = buf[-n:]
        if any(x != x for x in w): return self._emit(st, float('nan'))
        return self._emit(st, sum(x * (k + 1) for k, x in enumerate(w)) / (n * (n + 1) / 2))
    def hma(self, src, length):
        n = _n(length)
        a = self.wma(src, max(1, n // 2)) * 2 - self.wma(src, n)
        return self.wma(a, max(1, int(_math.sqrt(n))))
    def vwma(self, src, length):
        return self.sma(_s(src) * volume, length) / self.sma(volume, length)
    def swma(self, src):
        s = _s(src)
        return s[3] * 1 / 6 + s[2] * 2 / 6 + s[1] * 2 / 6 + s[0] * 1 / 6
    def alma(self, src, length, offset=0.85, sigma=6):
        st = self._slot('alma'); n = _n(length); v = _f(src)
        buf = st.setdefault('buf', [])
        if len(buf) < _rt.i + 1: buf.append(v)
        else: buf[-1] = v
        if n <= 0 or len(buf) < n: return self._emit(st, float('nan'))
        w = buf[-n:]
        m = offset * (n - 1); s = n / sigma
        ws = [_math.exp(-((k - m) ** 2) / (2 * s * s)) for k in range(n)]
        tot = sum(ws)
        return self._emit(st, sum(x * wk for x, wk in zip(w, ws)) / tot if tot else float('nan'))
    # -- window statistics --
    def _window(self, name, src, length):
        st = self._slot(name); n = _n(length); v = _f(src)
        buf = st.setdefault('buf', [])
        if len(buf) < _rt.i + 1: buf.append(v)
        else: buf[-1] = v
        return st, (buf[-n:] if n > 0 and len(buf) >= n else None)
    def highest(self, src, length=None):
        if length is None: src, length = high, src
        st, w = self._window('highest', src, length)
        return self._emit(st, float('nan') if w is None or any(x != x for x in w) else max(w))
    def lowest(self, src, length=None):
        if length is None: src, length = low, src
        st, w = self._window('lowest', src, length)
        return self._emit(st, float('nan') if w is None or any(x != x for x in w) else min(w))
    def highestbars(self, src, length=None):
        if length is None: src, length = high, src
        st, w = self._window('highestbars', src, length)
        if w is None: return self._emit(st, float('nan'))
        m = max(w); k = len(w) - 1 - max(i for i, x in enumerate(w) if x == m)
        return self._emit(st, float(-k))
    def lowestbars(self, src, length=None):
        if length is None: src, length = low, src
        st, w = self._window('lowestbars', src, length)
        if w is None: return self._emit(st, float('nan'))
        m = min(w); k = len(w) - 1 - max(i for i, x in enumerate(w) if x == m)
        return self._emit(st, float(-k))
    def sum(self, src, length):
        st, w = self._window('sum', src, length)
        return self._emit(st, float('nan') if w is None or any(x != x for x in w) else sum(w))
    def stdev(self, src, length, biased=True):
        st, w = self._window('stdev', src, length)
        if w is None or any(x != x for x in w): return self._emit(st, float('nan'))
        m = sum(w) / len(w); n = len(w) if biased else max(1, len(w) - 1)
        return self._emit(st, _math.sqrt(sum((x - m) ** 2 for x in w) / n))
    def variance(self, src, length, biased=True):
        st, w = self._window('variance', src, length)
        if w is None or any(x != x for x in w): return self._emit(st, float('nan'))
        m = sum(w) / len(w); n = len(w) if biased else max(1, len(w) - 1)
        return self._emit(st, sum((x - m) ** 2 for x in w) / n)
    def dev(self, src, length):
        st, w = self._window('dev', src, length)
        if w is None or any(x != x for x in w): return self._emit(st, float('nan'))
        m = sum(w) / len(w)
        return self._emit(st, sum(abs(x - m) for x in w) / len(w))
    def median(self, src, length):
        st, w = self._window('median', src, length)
        if w is None or any(x != x for x in w): return self._emit(st, float('nan'))
        s = sorted(w); k = len(s) // 2
        return self._emit(st, s[k] if len(s) % 2 else (s[k - 1] + s[k]) / 2)
    def percentrank(self, src, length):
        st, w = self._window('percentrank', src, length)
        if w is None or any(x != x for x in w): return self._emit(st, float('nan'))
        cur = w[-1]
        return self._emit(st, 100.0 * sum(1 for x in w[:-1] if x <= cur) / max(1, len(w) - 1))
    def linreg(self, src, length, offset=0):
        st, w = self._window('linreg', src, length)
        if w is None or any(x != x for x in w): return self._emit(st, float('nan'))
        n = len(w); xs = list(range(n)); mx = (n - 1) / 2; my = sum(w) / n
        den = sum((x - mx) ** 2 for x in xs)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, w)) / den if den else 0
        inter = my - slope * mx
        return self._emit(st, inter + slope * (n - 1 - offset))
    def cum(self, src):
        st = self._slot('cum'); v = _f(src)
        if st.get('bar') != _rt.i:
            st['base'] = st.get('total', 0.0); st['bar'] = _rt.i
        st['total'] = st['base'] + (v if v == v else 0.0)
        return self._emit(st, st['total'])
    # -- momentum --
    def change(self, src, length=1):
        s = _s(src); n = _n(length)
        return _Lazy(lambda a, b: a - b, (s, _Lazy(lambda: None, ()) if False else _Shift(s, n)))
    def mom(self, src, length):
        return self.change(src, length)
    def roc(self, src, length):
        s = _s(src); n = _n(length)
        return (s - _Shift(s, n)) / _Shift(s, n) * 100
    def rsi(self, src, length):
        st = self._slot('rsi'); n = _n(length); v = _f(src)
        buf = st.setdefault('buf', [])
        if len(buf) < _rt.i + 1: buf.append(v)
        else: buf[-1] = v
        if len(buf) < 2 or v != v: return self._emit(st, float('nan'))
        d = buf[-1] - buf[-2]
        up = max(d, 0.0); dn = max(-d, 0.0)
        au = self._rma_inner(st, 'au', up, n); ad = self._rma_inner(st, 'ad', dn, n)
        if au != au or ad != ad: return self._emit(st, float('nan'))
        if ad == 0: return self._emit(st, 100.0)
        if au == 0: return self._emit(st, 0.0)
        return self._emit(st, 100 - 100 / (1 + au / ad))
    def _rma_inner(self, st, key, v, n):
        sub = st.setdefault(key, {})
        return self._ema_step(sub, v, n, 1.0 / n if n > 0 else 1.0)
    def macd(self, src, fastlen=12, slowlen=26, siglen=9):
        fast = self.ema(src, fastlen); slow = self.ema(src, slowlen)
        m = fast - slow
        sig = self.ema(m, siglen)
        return m, sig, m - sig
    def stoch(self, src, hi, lo, length):
        hh = self.highest(hi, length); ll = self.lowest(lo, length)
        return (_s(src) - ll) / (hh - ll) * 100
    def cci(self, src, length):
        tp = _s(src); ma = self.sma(tp, length); md = self.dev(tp, length)
        return (tp - ma) / (md * 0.015)
    def wpr(self, length):
        hh = self.highest(high, length); ll = self.lowest(low, length)
        return (hh - close) / (hh - ll) * -100
    def mfi(self, src, length):
        st = self._slot('mfi'); n = _n(length); tp = _f(src); vol = _f(volume)
        prev = st.get('tp', float('nan'))
        if st.get('bar') != _rt.i:
            st['prev_tp'] = st.get('tp', float('nan')); st['bar'] = _rt.i
        st['tp'] = tp
        p = st.get('prev_tp', float('nan'))
        pos = tp * vol if tp > p else 0.0
        neg = tp * vol if tp < p else 0.0
        ps = self._window_sum(st, 'pos', pos, n); ns = self._window_sum(st, 'neg', neg, n)
        if ps != ps or ns != ns: return self._emit(st, float('nan'))
        return self._emit(st, 100.0 if ns == 0 else 100 - 100 / (1 + ps / ns))
    def _window_sum(self, st, key, v, n):
        buf = st.setdefault(key, [])
        if len(buf) < _rt.i + 1: buf.append(v)
        else: buf[-1] = v
        return sum(buf[-n:]) if n > 0 and len(buf) >= n else float('nan')
    def tr(self, handle_na=False):
        c1 = close[1]
        if c1 != c1:
            return _f(high) - _f(low) if handle_na else float('nan')
        return max(_f(high) - _f(low), abs(_f(high) - c1), abs(_f(low) - c1))
    def atr(self, length):
        st = self._slot('atr'); n = _n(length)
        c1 = close[1]
        tr = _f(high) - _f(low) if c1 != c1 else max(_f(high) - _f(low), abs(_f(high) - c1), abs(_f(low) - c1))
        return self._emit(st, self._ema_step(st, tr, n, 1.0 / n if n > 0 else 1.0))
    def bb(self, src, length, mult):
        basis = self.sma(src, length); dev = self.stdev(src, length) * mult
        return basis, basis + dev, basis - dev
    def bbw(self, src, length, mult):
        basis, up, lo = self.bb(src, length, mult)
        return (up - lo) / basis
    def kc(self, src, length, mult, use_true_range=True):
        basis = self.ema(src, length)
        rng = self.atr(length) if use_true_range else self.ema(high - low, length)
        return basis, basis + rng * mult, basis - rng * mult
    def supertrend(self, factor, atr_period):
        st = self._slot('supertrend')
        a = _f(self.atr(atr_period)); src = _f(hl2); c = _f(close)
        if a != a: return self._emit(st, float('nan')), self._emit(st.setdefault('dir', {}), float('nan'))
        up = src - factor * a; dn = src + factor * a
        if st.get('bar') != _rt.i:
            st['p_up'] = st.get('up', float('nan')); st['p_dn'] = st.get('dn', float('nan')); st['p_dir'] = st.get('dirv', 1); st['bar'] = _rt.i
        p_up, p_dn, p_dir = st['p_up'], st['p_dn'], st['p_dir']
        c1 = close[1]
        if p_up == p_up and c1 == c1 and c1 > p_up: up = max(up, p_up)
        if p_dn == p_dn and c1 == c1 and c1 < p_dn: dn = min(dn, p_dn)
        if p_dn != p_dn: d = 1
        elif p_dir == -1 and c > p_dn: d = 1
        elif p_dir == 1 and c < p_up: d = -1
        else: d = p_dir
        st['up'] = up; st['dn'] = dn; st['dirv'] = d
        return self._emit(st, up if d == 1 else dn), self._emit(st.setdefault('dir', {}), float(-d))
    def dmi(self, dilen, adxlen):
        st = self._slot('dmi')
        h1, l1, c1 = high[1], low[1], close[1]
        if h1 != h1:
            return self._emit(st.setdefault('p', {}), float('nan')), self._emit(st.setdefault('m', {}), float('nan')), self._emit(st.setdefault('a', {}), float('nan'))
        upm = _f(high) - h1; dnm = l1 - _f(low)
        plus = upm if upm > dnm and upm > 0 else 0.0
        minus = dnm if dnm > upm and dnm > 0 else 0.0
        tr = max(_f(high) - _f(low), abs(_f(high) - c1), abs(_f(low) - c1))
        n = _n(dilen)
        atr = self._rma_inner(st, 'tr', tr, n); rp = self._rma_inner(st, 'plus', plus, n); rm = self._rma_inner(st, 'minus', minus, n)
        if atr != atr or atr == 0:
            return self._emit(st.setdefault('p', {}), float('nan')), self._emit(st.setdefault('m', {}), float('nan')), self._emit(st.setdefault('a', {}), float('nan'))
        di_p = 100 * rp / atr; di_m = 100 * rm / atr
        dx = abs(di_p - di_m) / (di_p + di_m) * 100 if di_p + di_m else 0.0
        adx = self._rma_inner(st, 'adx', dx, _n(adxlen))
        return self._emit(st.setdefault('p', {}), di_p), self._emit(st.setdefault('m', {}), di_m), self._emit(st.setdefault('a', {}), adx)
    def obv(self):
        st = self._slot('obv'); c1 = close[1]; v = _f(volume)
        if st.get('bar') != _rt.i:
            st['base'] = st.get('total', 0.0); st['bar'] = _rt.i
        d = 0.0 if c1 != c1 else (v if _f(close) > c1 else -v if _f(close) < c1 else 0.0)
        st['total'] = st['base'] + d
        return self._emit(st, st['total'])
    def vwap(self, src=None):
        st = self._slot('vwap'); s = _f(src if src is not None else hlc3); v = _f(volume)
        day = _rt.session_key()
        if st.get('day') != day:
            st['day'] = day; st['pv'] = 0.0; st['vv'] = 0.0; st['bar'] = None
        if st.get('bar') != _rt.i:
            st['bpv'] = st['pv']; st['bvv'] = st['vv']; st['bar'] = _rt.i
        st['pv'] = st['bpv'] + s * v; st['vv'] = st['bvv'] + v
        return self._emit(st, st['pv'] / st['vv'] if st['vv'] else float('nan'))
    def sar(self, start=0.02, inc=0.02, max=0.2):
        st = self._slot('sar'); h = _f(high); l = _f(low)
        if st.get('bar') != _rt.i:
            for k in ('sar', 'ep', 'af', 'up'):
                st['p_' + k] = st.get(k)
            st['bar'] = _rt.i
        if st.get('p_sar') is None:
            if high[1] != high[1]:
                st['sar'] = float('nan'); st['ep'] = None
                return self._emit(st, float('nan'))
            up = _f(close) >= close[1]
            st['up'] = up; st['ep'] = h if up else l; st['af'] = start; st['sar'] = low[1] if up else high[1]
            return self._emit(st, st['sar'])
        up, ep, af, sar = st['p_up'], st['p_ep'], st['p_af'], st['p_sar']
        sar = sar + af * (ep - sar)
        if up:
            if l < sar:
                up = False; sar = ep; ep = l; af = start
            else:
                if h > ep: ep = h; af = min(af + inc, max)
                sar = min(sar, low[1], low[2] if low[2] == low[2] else low[1])
        else:
            if h > sar:
                up = True; sar = ep; ep = h; af = start
            else:
                if l < ep: ep = l; af = min(af + inc, max)
                sar = max(sar, high[1], high[2] if high[2] == high[2] else high[1])
        st['up'] = up; st['ep'] = ep; st['af'] = af; st['sar'] = sar
        return self._emit(st, sar)
    # -- conditions --
    def crossover(self, a, b):
        a = _s(a); b = _s(b)
        return _Lazy(lambda a0, b0, a1, b1: a0 == a0 and b0 == b0 and a1 == a1 and b1 == b1 and a0 > b0 and a1 <= b1, (a, b, _Shift(a, 1), _Shift(b, 1)))
    def crossunder(self, a, b):
        a = _s(a); b = _s(b)
        return _Lazy(lambda a0, b0, a1, b1: a0 == a0 and b0 == b0 and a1 == a1 and b1 == b1 and a0 < b0 and a1 >= b1, (a, b, _Shift(a, 1), _Shift(b, 1)))
    def cross(self, a, b):
        return self.crossover(a, b) | self.crossunder(a, b)
    def rising(self, src, length):
        s = _s(src); n = _n(length)
        return all(_val(s, k) > _val(s, k + 1) for k in range(n))
    def falling(self, src, length):
        s = _s(src); n = _n(length)
        return all(_val(s, k) < _val(s, k + 1) for k in range(n))
    def barssince(self, cond):
        st = self._slot('barssince')
        if _b(cond): st['last'] = _rt.i
        return self._emit(st, float(_rt.i - st['last']) if 'last' in st else float('nan'))
    def valuewhen(self, cond, src, occurrence=0):
        st = self._slot('valuewhen'); hist = st.setdefault('hist', [])
        if st.get('bar') != _rt.i:
            st['n0'] = len(hist); st['bar'] = _rt.i
        del hist[st['n0']:]
        if _b(cond): hist.append(_f(src))
        k = int(occurrence)
        return self._emit(st, hist[-1 - k] if len(hist) > k else float('nan'))
    def pivothigh(self, src, left=None, right=None):
        if right is None: src, left, right = high, src, left
        s = _s(src); L = _n(left); R = _n(right)
        c = s[R]
        if c != c: return float('nan')
        ok = all(s[R + k] < c for k in range(1, L + 1)) and all(s[k] < c for k in range(0, R))
        return c if ok else float('nan')
    def pivotlow(self, src, left=None, right=None):
        if right is None: src, left, right = low, src, left
        s = _s(src); L = _n(left); R = _n(right)
        c = s[R]
        if c != c: return float('nan')
        ok = all(s[R + k] > c for k in range(1, L + 1)) and all(s[k] > c for k in range(0, R))
        return c if ok else float('nan')
    def max(self, src):
        st = self._slot('max'); v = _f(src)
        if st.get('bar') != _rt.i: st['base'] = st.get('m', float('-inf')); st['bar'] = _rt.i
        st['m'] = max(st['base'], v) if v == v else st['base']
        return self._emit(st, st['m'] if st['m'] != float('-inf') else float('nan'))
    def min(self, src):
        st = self._slot('min'); v = _f(src)
        if st.get('bar') != _rt.i: st['base'] = st.get('m', float('inf')); st['bar'] = _rt.i
        st['m'] = min(st['base'], v) if v == v else st['base']
        return self._emit(st, st['m'] if st['m'] != float('inf') else float('nan'))
    def range(self, src, length):
        return self.highest(src, length) - self.lowest(src, length)
    def tsi(self, src, short_length, long_length):
        d = self.change(src, 1)
        a = self.ema(self.ema(d, long_length), short_length)
        b = self.ema(self.ema(abs(d), long_length), short_length)
        return a / b * 100
    def cmo(self, src, length):
        d = self.change(src, 1)
        up = self.sum(_Lazy(lambda x: x if x == x and x > 0 else 0.0, (d,)), length)
        dn = self.sum(_Lazy(lambda x: -x if x == x and x < 0 else 0.0, (d,)), length)
        return (up - dn) / (up + dn) * 100
ta = _TA()

class _Shift(Series):
    """s shifted by n bars: _Shift(s, n)[k] == s[k + n]"""
    __slots__ = ('_s', '_n')
    def __init__(self, s, n):
        self._s = s; self._n = n
    def __getitem__(self, k):
        return self._s[int(k) + self._n]

# ---- runtime -------------------------------------------------------------------------------------------
class _RT:
    def __init__(self):
        self.reset()
    def reset(self):
        self.i = -1; self.n = 0
        self.props = None
        self.inputs = {}; self.input_order = []; self.overrides = {}
        self.plots = {}; self.plot_order = []
        self.logs = []
        self.slots = []; self.slot_i = 0
        self.plot_i = 0; self.input_i = 0
        self.tf_seconds = 86400
        self.declared = False
    def slot(self, name):
        k = self.slot_i; self.slot_i += 1
        if k >= len(self.slots):
            self.slots.append({'name': name})
        st = self.slots[k]
        if st.get('name') != name:
            # the script's call order changed between bars; start this site over
            st.clear(); st['name'] = name
        return st
    def begin_bar(self, i):
        self.i = i
        self.slot_i = 0; self.plot_i = 0; self.input_i = 0
        for k, s in enumerate(_series_data):
            s.push(_cols[k][i])
    def declare(self, props):
        if not self.declared:
            self.props = props; self.declared = True
    def input(self, t, defval, title, minval, maxval, step, options, tooltip, group):
        k = self.input_i; self.input_i += 1
        iid = title or ('input%d' % (k + 1))
        if iid not in self.inputs:
            self.inputs[iid] = dict(id=iid, title=iid, type=t, defval=(_source_name(defval) if t == 'source' else defval), min=minval, max=maxval, step=step, options=list(options) if options else None, tooltip=tooltip, group=group)
            self.input_order.append(iid)
        ov = self.overrides.get(iid)
        if t == 'source':
            if isinstance(ov, str) and ov in _sources: return _sources[ov]
            return defval
        if ov is None:
            return defval
        try:
            if t == 'int': return int(ov)
            if t == 'float': return float(ov)
            if t == 'bool': return bool(ov)
            return ov
        except Exception:
            return defval
    def _plot_rec(self, title, ptype, color_, extra):
        k = self.plot_i; self.plot_i += 1
        pid = 'plot%d' % (k + 1)
        rec = self.plots.get(pid)
        if rec is None:
            rec = dict(id=pid, title=title or ('Plot %d' % (k + 1)), type=ptype, color=color_ or '#2962FF', values=[], colors=None, texts=None)
            rec.update(extra)
            self.plots[pid] = rec; self.plot_order.append(pid)
        vals = rec['values']
        while len(vals) < self.i:
            vals.append(float('nan'))
        return rec
    def _set_val(self, rec, v, c=None, text=None):
        vals = rec['values']
        if len(vals) == self.i: vals.append(v)
        else: vals[self.i] = v
        if c is not None and c != rec['color']:
            if rec['colors'] is None: rec['colors'] = [None] * len(vals)
            while len(rec['colors']) < len(vals): rec['colors'].append(None)
            rec['colors'][self.i] = c
        elif rec['colors'] is not None:
            while len(rec['colors']) < len(vals): rec['colors'].append(None)
        if text is not None:
            if rec['texts'] is None: rec['texts'] = [None] * len(vals)
            while len(rec['texts']) < len(vals): rec['texts'].append(None)
            rec['texts'][self.i] = str(text)
        elif rec['texts'] is not None:
            while len(rec['texts']) < len(vals): rec['texts'].append(None)
    def plot(self, series, title, color_, linewidth, style, offset, force_overlay):
        c = color_ if isinstance(color_, str) else None
        rec = self._plot_rec(title, style or 'line', c, dict(lineWidth=int(linewidth or 1), overlay=force_overlay))
        self._set_val(rec, _f(series), c)
    def hline(self, price, title, color_, linestyle, linewidth):
        c = color_ if isinstance(color_, str) else None
        rec = self._plot_rec(title, 'hline', c or '#787B86', dict(value=_f(price), lineWidth=int(linewidth or 1), lineStyle=int(linestyle or 0)))
        self._set_val(rec, _f(price))
    def plotshape(self, cond, title, style, loc, color_, text, size_, force_overlay):
        c = color_ if isinstance(color_, str) else None
        rec = self._plot_rec(title, 'shapes', c or '#2962FF', dict(shape=style, location=loc, size=size_, text=text, overlay=force_overlay))
        v = _f(cond)
        self._set_val(rec, 1.0 if (v == v and v != 0) else float('nan'), c, text)
    def plotchar(self, cond, title, ch, loc, color_, text, size_, force_overlay):
        c = color_ if isinstance(color_, str) else None
        rec = self._plot_rec(title, 'chars', c or '#2962FF', dict(char=str(ch), location=loc, size=size_, text=text, overlay=force_overlay))
        v = _f(cond)
        self._set_val(rec, 1.0 if (v == v and v != 0) else float('nan'), c, text)
    def bgcolor(self, c, title):
        rec = self._plot_rec(title or 'Background', 'bgcolor', '#2962FF', dict(overlay=None))
        self._set_val(rec, 1.0 if isinstance(c, str) else float('nan'), c if isinstance(c, str) else None)
    def log(self, level, message):
        self.logs.append(dict(level=level, bar=self.i, message=message))
    def session_key(self):
        ms = time[0]
        return int(ms // 86400000) if ms == ms else -1
_rt = _RT()

# bar series (filled by begin_bar)
open = _Data(); high = _Data(); low = _Data(); close = _Data(); volume = _Data(); time = _Data()
_series_data = [open, high, low, close, volume, time]
_cols = [[], [], [], [], [], []]
hl2 = (high + low) / 2
hlc3 = (high + low + close) / 3
ohlc4 = (open + high + low + close) / 4
hlcc4 = (high + low + close + close) / 4
_sources = {'open': open, 'high': high, 'low': low, 'close': close, 'volume': volume, 'hl2': hl2, 'hlc3': hlc3, 'ohlc4': ohlc4, 'hlcc4': hlcc4}
def _source_name(s):
    for k, v in _sources.items():
        if v is s: return k
    return 'close'

class _BarIndex(Series):
    __slots__ = ()
    def __getitem__(self, k):
        return _rt.i - int(k)
bar_index = _BarIndex()
class _LastBarIndex(Series):
    __slots__ = ()
    def __getitem__(self, k):
        return _rt.n - 1
last_bar_index = _LastBarIndex()

def _timefield(fn):
    return _Lazy(lambda t: (lambda p: float('nan') if p is None else float(fn(p)))(_tparts(t)), (time,))
year = _timefield(lambda p: p.year); month = _timefield(lambda p: p.month); dayofmonth = _timefield(lambda p: p.day)
hour = _timefield(lambda p: p.hour); minute = _timefield(lambda p: p.minute); second = _timefield(lambda p: p.second)
dayofweek = _timefield(lambda p: (p.weekday() + 1) % 7 + 1)
weekofyear = _timefield(lambda p: p.isocalendar()[1])
timenow = 0
class _DayOfWeek:
    sunday = 1; monday = 2; tuesday = 3; wednesday = 4; thursday = 5; friday = 6; saturday = 7
dayofweek_const = _DayOfWeek()

def _compile(src):
    try:
        return compile(src, _STRATEGY_FILE, 'exec'), None
    except SyntaxError as e:
        return None, dict(message=(e.msg or 'syntax error'), line=e.lineno, column=e.offset, phase='syntax')

def _error_from(exc):
    tb = exc.__traceback__
    line = None
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == _STRATEGY_FILE:
            line = tb.tb_lineno
        tb = tb.tb_next
    return dict(message='%s: %s' % (type(exc).__name__, exc), line=line, column=None, phase='runtime', bar=_rt.i,
                traceback=''.join(_traceback.format_exception(type(exc), exc, exc.__traceback__))[-4000:])

def _make_globals():
    g = {k: v for k, v in globals().items() if not k.startswith('_') or k in ('__builtins__',)}
    g['str'] = str_
    g['input'] = input
    g['__name__'] = '__strategy__'
    return g

def _setup(cols, symbol, tf, overrides):
    """cols: [open, high, low, close, volume, time_ms] as Python lists"""
    global _cols
    _rt.reset()
    for s in _series_data:
        s._v.clear()
    _cols = [list(c) for c in cols]
    _rt.n = len(_cols[0])
    _rt.overrides = dict(overrides or {})
    _rt.tf_seconds = float(tf.get('seconds', 86400))
    syminfo.mintick = float(symbol.get('mintick', 0.01)); syminfo.ticker = str(symbol.get('ticker', '')); syminfo.tickerid = str(symbol.get('tickerid', syminfo.ticker))
    syminfo.currency = str(symbol.get('currency', '')); syminfo.basecurrency = str(symbol.get('basecurrency', '')); syminfo.type = str(symbol.get('type', ''))
    syminfo.description = str(symbol.get('description', '')); syminfo.timezone = str(symbol.get('timezone', 'UTC'))
    timeframe.period = str(tf.get('period', '1D')); timeframe.multiplier = int(tf.get('multiplier', 1))
    secs = _rt.tf_seconds
    timeframe.isseconds = secs < 60; timeframe.isminutes = 60 <= secs < 86400; timeframe.isintraday = secs < 86400
    timeframe.isdaily = secs == 86400; timeframe.isweekly = secs == 604800; timeframe.ismonthly = secs > 604800; timeframe.isdwm = secs >= 86400

async def _run(src, chunk, yield_cb):
    code, err = _compile(src)
    if err is not None:
        return dict(error=err, bars=0)
    g = _make_globals()
    n = _rt.n
    error = None
    for i in range(n):
        _rt.begin_bar(i)
        _bridge.begin_bar(i)
        try:
            exec(code, g)
        except Exception as e:
            error = _error_from(e)
            break
        if i == 0 and not _rt.declared:
            _rt.declare(dict(title='Untitled strategy'))
        _bridge.end_bar(i)
        if chunk and (i + 1) % chunk == 0 and i + 1 < n:
            cont = await yield_cb(i + 1, n)
            if cont is False:
                return dict(error=dict(message='Cancelled', line=None, column=None, phase='runtime', bar=i), bars=i + 1)
    return dict(error=error, bars=(_rt.i + 1) if error is None else _rt.i)

def _collect():
    plots = []
    for pid in _rt.plot_order:
        r = _rt.plots[pid]
        vals = r['values']
        while len(vals) < _rt.n: vals.append(float('nan'))
        p = dict(r)
        plots.append(p)
    return dict(properties=_rt.props, inputs=[_rt.inputs[k] for k in _rt.input_order], plots=plots, logs=_rt.logs)
`;
