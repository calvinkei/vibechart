/**
 * Runs the Python prelude under real CPython (python3.12+) with a fake bridge, so the scripting
 * layer is tested without a browser or Pyodide. Skipped when no suitable python is installed.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRELUDE } from '../src/strategy/prelude';

function findPython(): string | null {
  for (const p of ['python3.13', 'python3.12', 'python3']) {
    const r = spawnSync(p, ['-c', 'import sys; print(sys.version_info[:2] >= (3, 10))'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === 'True') return p;
  }
  return null;
}

const PY = findPython();

const HARNESS = String.raw`
import json, sys, types, asyncio
prelude = open(sys.argv[1]).read()
script = open(sys.argv[2]).read()
calls = []
class Bridge:
    def __init__(self):
        self.pos = 0.0
    def begin_bar(self, i): calls.append(('begin', i))
    def end_bar(self, i): calls.append(('end', i))
    def entry(self, *a): calls.append(('entry',) + a)
    def order(self, *a): calls.append(('order',) + a)
    def exit(self, *a): calls.append(('exit',) + a)
    def close(self, *a): calls.append(('close',) + a)
    def close_all(self, *a): calls.append(('close_all',) + a)
    def cancel(self, *a): calls.append(('cancel',) + a)
    def cancel_all(self, *a): calls.append(('cancel_all',))
    def default_qty(self, p): return 1.0
    def position_size(self): return self.pos
    def equity(self): return 1000000.0
    def initial_capital(self): return 1000000.0
    def netprofit(self): return 0.0
    def openprofit(self): return 0.0
    def open_count(self): return 0
    def closed_count(self): return 0
    def __getattr__(self, name):
        return lambda *a: 0.0
mod = types.ModuleType('_vc_bridge')
b = Bridge()
for k in dir(b):
    if not k.startswith('__'): setattr(mod, k, getattr(b, k))
mod.__getattr__ = lambda name: (lambda *a: 0.0)
sys.modules['_vc_bridge'] = mod
g = {}
exec(prelude, g)
g['_bridge'] = mod
n = 60
import math
closes = [100 + 10 * math.sin(i / 5.0) + i * 0.1 for i in range(n)]
cols = [[c - 0.5 for c in closes], [c + 1 for c in closes], [c - 1 for c in closes], closes, [1000 + i for i in range(n)], [1700000000000 + i * 3600000 for i in range(n)]]
g['_setup'](cols, {'mintick': 0.01, 'ticker': 'TEST', 'currency': 'USD'}, {'period': '60', 'seconds': 3600, 'multiplier': 60}, json.loads(sys.argv[3]) if len(sys.argv) > 3 else {})
res = asyncio.run(g['_run'](script, 0, None))
out = g['_collect']()
def clean(v):
    # NaN is not JSON; the real bridge hands Float64Arrays to JS so this only matters for the harness
    if isinstance(v, float) and v != v: return None
    if isinstance(v, dict): return {k: clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)): return [clean(x) for x in v]
    return v
print(json.dumps(clean({'res': res, 'out': out, 'calls': calls[:400], 'closes': closes}), default=str))
`;

function runScript(script: string, overrides: Record<string, unknown> = {}): any {
  const dir = mkdtempSync(join(tmpdir(), 'vc-py-'));
  writeFileSync(join(dir, 'prelude.py'), PRELUDE);
  writeFileSync(join(dir, 'script.py'), script);
  writeFileSync(join(dir, 'harness.py'), HARNESS);
  const out = execFileSync(PY!, [join(dir, 'harness.py'), join(dir, 'prelude.py'), join(dir, 'script.py'), JSON.stringify(overrides)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

describe.skipIf(!PY)('python strategy prelude (CPython)', () => {
  it('runs bar by bar, keeps series history and drives the bridge in order', () => {
    const r = runScript(`
strategy("Test", overlay=True, initial_capital=50000, pyramiding=2)
prev = close[1]
if bar_index == 5:
    log.info("close5=%s prev=%s" % (close, prev))
if bar_index == 10:
    strategy.entry("Long", strategy.long, qty=2, comment="go")
if bar_index == 20:
    strategy.close("Long")
`);
    expect(r.res.error).toBeNull();
    expect(r.res.bars).toBe(60);
    expect(r.out.properties.initialCapital).toBe(50000);
    expect(r.out.properties.pyramiding).toBe(2);
    const log = r.out.logs.find((l: any) => l.bar === 5);
    expect(log.message).toContain(`close5=${r.closes[5]}`);
    expect(log.message).toContain(`prev=${r.closes[4]}`);
    const entry = r.calls.find((c: any) => c[0] === 'entry');
    expect(entry).toEqual(['entry', 'Long', 'long', 2.0, null, null, '', 'none', 'go']);
    const close = r.calls.find((c: any) => c[0] === 'close');
    expect(close).toEqual(['close', 'Long', null, null, '']);
    // begin/end bracket every bar
    const order = r.calls.filter((c: any) => c[0] === 'begin' || c[0] === 'end').slice(0, 4);
    expect(order).toEqual([['begin', 0], ['end', 0], ['begin', 1], ['end', 1]]);
  });

  it('ta.sma/ema/crossover match reference values and are stateful per call site', () => {
    const r = runScript(`
strategy("TA")
fast = ta.sma(close, 3)
slow = ta.sma(close, 5)
e = ta.ema(close, 4)
plot(fast, "fast")
plot(slow, "slow")
plot(e, "ema")
if ta.crossover(fast, slow):
    strategy.entry("L", strategy.long)
if ta.crossunder(fast, slow):
    strategy.entry("S", strategy.short)
`);
    expect(r.res.error).toBeNull();
    const closes: number[] = r.closes;
    const sma = (n: number, i: number) => (i < n - 1 ? NaN : closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n);
    const fast = r.out.plots[0].values as (number | null)[];
    const slow = r.out.plots[1].values as (number | null)[];
    const ema = r.out.plots[2].values as (number | null)[];
    expect(fast[1]).toBeNull(); // nan → null through the harness
    expect(fast[10]).toBeCloseTo(sma(3, 10), 9);
    expect(slow[30]).toBeCloseTo(sma(5, 30), 9);
    // EMA seeded with SMA(4) at bar 3, then alpha = 2/5
    let ref = sma(4, 3);
    for (let i = 4; i <= 25; i++) ref = 0.4 * closes[i] + 0.6 * ref;
    expect(ema[25]).toBeCloseTo(ref, 9);
    // crossovers: every fast/slow cross generates exactly one entry in the right direction
    const entries = r.calls.filter((c: any) => c[0] === 'entry');
    expect(entries.length).toBeGreaterThan(2);
    for (const e of entries) expect(['L', 'S']).toContain(e[1]);
    let expected = 0;
    for (let i = 5; i < closes.length; i++) {
      const f0 = sma(3, i), s0 = sma(5, i), f1 = sma(3, i - 1), s1 = sma(5, i - 1);
      if ((f0 > s0 && f1 <= s1) || (f0 < s0 && f1 >= s1)) expected++;
    }
    expect(entries.length).toBe(expected);
  });

  it('inputs register with defaults and accept overrides; plots keep per-bar colors', () => {
    const r = runScript(`
strategy("Inputs")
length = input.int(9, "Length", minval=1, maxval=50)
mult = input.float(2.0, "Mult")
flag = input.bool(True, "Flag")
src = input.source(close, "Source")
mode = input.string("A", "Mode", options=["A", "B"])
plot(ta.sma(src, length) * mult, "x", color=color.red if flag else color.green)
plotshape(bar_index % 10 == 0, "dots", style=shape.circle, location=location.belowbar, color=color.blue, text="t")
hline(100, "level")
`, { Length: 3, Flag: false, Source: 'open', Mode: 'B' });
    expect(r.res.error).toBeNull();
    const ids = r.out.inputs.map((i: any) => i.id);
    expect(ids).toEqual(['Length', 'Mult', 'Flag', 'Source', 'Mode']);
    expect(r.out.inputs[0]).toMatchObject({ type: 'int', defval: 9, min: 1, max: 50 });
    expect(r.out.inputs[3]).toMatchObject({ type: 'source', defval: 'close' });
    expect(r.out.inputs[4]).toMatchObject({ type: 'select', options: ['A', 'B'] });
    const x = r.out.plots[0];
    expect(x.color).toBe('#4CAF50'); // flag overridden to false → green
    // override Length=3 and Source=open: value at bar 10 = sma(open,3)*2
    const opens: number[] = r.closes.map((c: number) => c - 0.5);
    const ref = (opens[8] + opens[9] + opens[10]) / 3 * 2;
    expect(x.values[10]).toBeCloseTo(ref, 9);
    const dots = r.out.plots[1];
    expect(dots.type).toBe('shapes');
    expect(dots.values[10]).toBe(1);
    expect(dots.values[11]).toBeNull();
    expect(dots.texts[10]).toBe('t');
    expect(r.out.plots[2]).toMatchObject({ type: 'hline', value: 100 });
  });

  it('reports syntax errors and runtime errors with the script line number', () => {
    const syn = runScript(`strategy("x")\nif close > 1\n    pass\n`);
    expect(syn.res.error.phase).toBe('syntax');
    expect(syn.res.error.line).toBe(2);
    const rt = runScript(`strategy("x")\nx = 1\nif bar_index == 3:\n    y = undefined_name + 1\n`);
    expect(rt.res.error.phase).toBe('runtime');
    expect(rt.res.error.line).toBe(4);
    expect(rt.res.error.bar).toBe(3);
    expect(rt.res.error.message).toContain('NameError');
    expect(rt.res.bars).toBe(3);
  });

  it('strategy.exit and risk rules forward their arguments; math/nz/na helpers work on series', () => {
    const r = runScript(`
strategy("Exit", default_qty_type=strategy.percent_of_equity, default_qty_value=10, commission_type=strategy.commission.percent, commission_value=0.1)
strategy.risk.allow_entry_in(strategy.direction.long)
strategy.risk.max_drawdown(20, strategy.percent_of_equity)
atr = ta.atr(14)
if bar_index == 15:
    strategy.entry("Long", strategy.long)
    strategy.exit("TP/SL", "Long", profit=100, loss=50, trail_points=80, trail_offset=20)
v = nz(close[100], -1)
m = math.max(close, open)
h = ta.highest(high, 5)
if bar_index == 30:
    log.info("v=%s m=%s h=%s na=%s" % (v, float(m), float(h), na(close[100])))
`);
    expect(r.res.error).toBeNull();
    expect(r.out.properties).toMatchObject({ defaultQtyType: 'percent_of_equity', defaultQtyValue: 10, commissionType: 'percent', commissionValue: 0.1 });
    const ex = r.calls.find((c: any) => c[0] === 'exit');
    expect(ex.slice(0, 12)).toEqual(['exit', 'TP/SL', 'Long', null, null, 100.0, null, 50.0, null, null, 80.0, 20.0]);
    expect(r.calls.find((c: any) => c[0] === 'entry')[3]).toBeNull(); // default qty
    const log = r.out.logs.find((l: any) => l.bar === 30).message;
    expect(log).toContain('v=-1');
    expect(log).toContain(`m=${r.closes[30]}`);
    const highs: number[] = r.closes.map((c: number) => c + 1);
    expect(log).toContain(`h=${Math.max(...highs.slice(26, 31))}`);
    expect(log).toContain('na=True');
  });
});
