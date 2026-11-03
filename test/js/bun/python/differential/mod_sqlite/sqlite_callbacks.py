import sqlite3, sys, io, contextlib
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
con = sqlite3.connect(':memory:'); con.execute('create table t(a, b)'); con.executemany('insert into t values (?, ?)', [(i, 'x%d' % (i % 3)) for i in range(10)])
q = lambda sql, *p: con.execute(sql, p).fetchall()
con.setlimit(sqlite3.SQLITE_LIMIT_FUNCTION_ARG, 100)   # The most SQLite allows depends on its version.
# Functions
con.create_function('double', 1, lambda x: x * 2); print(q('select double(4), double(1.5), double(?), double(x\'41\')', 'ab'))
con.create_function('types', -1, lambda *a: ','.join(type(x).__name__ for x in a)); print(q("select types(), types(1, 1.0, 'a', x'00', null), types(2.0), types(9007199254740993)"))
for name, v in (('r_none', None), ('r_int', 2**62), ('r_neg', -5), ('r_bool', True), ('r_float', 2.0), ('r_float2', 1.25), ('r_str', 'h\xe9\U0001f600'), ('r_empty', ''), ('r_nul', 'a\0b'), ('r_bytes', b'\0\xff'), ('r_ba', bytearray(b'ba')), ('r_mv', memoryview(b'mv')), ('r_eb', b'')):
    con.create_function(name, 0, lambda v=v: v); print(name, q('select %s(), typeof(%s())' % (name, name)))
for name, v in (('b_big', 2**63), ('b_obj', object()), ('b_list', [1]), ('b_sur', '\ud800'), ('b_cplx', 1j)):
    con.create_function(name, 0, lambda v=v: v); t(q, 'select %s()' % name)
def boom(*a): raise ZeroDivisionError('boom')
con.create_function('boom', 0, boom); t(q, 'select boom()')
def mem(): raise MemoryError
def ovf(): raise OverflowError
con.create_function('mem', 0, mem); t(q, 'select mem()'); con.create_function('ovf', 0, ovf); t(q, 'select ovf()')
con.create_function('two', 2, lambda a, b: a + b); print(q('select two(1, 2)')); t(q, 'select two(1)'); con.create_function('two', 1, lambda a: -a); print(q('select two(1, 2), two(5), TWO(6)')); con.create_function('TWO', 1, lambda a: a * 100); print(q('select two(5)'))
con.create_function('det', 1, lambda x: x, deterministic=True); print(q('select det(3)')); con.execute('create index i on t(det(a))'); t(con.execute, 'create index j on t(double(a))')
con.create_function('notcallable', 0, 5); t(q, 'select notcallable()'); con.create_function('wrongargs', 1, lambda: 1); t(q, 'select wrongargs(1)')
con.create_function('f\xfc', 0, lambda: 'unicode name'); print(q('select f\xfc()'))
t(con.create_function); t(con.create_function, 'a'); t(con.create_function, 'a', 1); t(con.create_function, 1, 1, len); t(con.create_function, 'a', 'b', len); t(con.create_function, 'a', -2, len); t(con.create_function, 'a', 1000, len); t(con.create_function, 'a', 1, len, True); t(con.create_function, 'a', 1, func=len); t(con.create_function, name='a', narg=1, func=len); t(con.create_function, 'a\0b', 1, len); t(con.create_function, 'a', 2**40, len); t(con.create_function, 'a', 1, len, nope=1); t(con.create_function, 'a', 1, len, deterministic=1, x=2); t(con.create_function, 'x' * 300, 1, len)
# A function that uses the connection
con.create_function('nested', 0, lambda: con.execute('select count(*) from t').fetchone()[0]); print(q('select nested()'))
# Aggregates
class Sum:
    def __init__(self): self.s = 0
    def step(self, v): self.s += v
    def finalize(self): return self.s
con.create_aggregate('mysum', 1, Sum); print(q('select mysum(a) from t'), q('select b, mysum(a) from t group by b order by b'), q('select mysum(a) from t where a > 100'), q('select mysum(a), mysum(a * 2) from t'))
class Cat:
    def __init__(self): self.p = []
    def step(self, *a): self.p.append(a)
    def finalize(self): return repr(self.p)
con.create_aggregate('cat', -1, Cat); print(q("select cat(a, b) from t where a < 2"), q('select cat() from t where a < 2'))
class BadInit:
    def __init__(self): 1 / 0
    def step(self, v): pass
    def finalize(self): return 1
class NoStep:
    def finalize(self): return 1
class BadStep:
    def step(self, v): 1 / 0
    def finalize(self): return 1
class NoFinal:
    def step(self, v): pass
class BadFinal:
    def step(self, v): pass
    def finalize(self): 1 / 0
class BadResult:
    def step(self, v): pass
    def finalize(self): return object()
for C in (BadInit, NoStep, BadStep, NoFinal, BadFinal, BadResult):
    con.create_aggregate('agg', 1, C); t(q, 'select agg(a) from t'); t(q, 'select agg(a) from t where a > 100')
t(con.create_aggregate); t(con.create_aggregate, 'a', 1); t(con.create_aggregate, 1, 1, Sum); t(con.create_aggregate, 'a', 'x', Sum); t(con.create_aggregate, 'a', -2, Sum); t(con.create_aggregate, 'a', 1, Sum, 1); t(con.create_aggregate, 'a', 1, aggregate_class=Sum); t(con.create_aggregate, 'a', 500, Sum)
# Window functions
class WinSum:
    def __init__(self): self.c = 0
    def step(self, v): self.c += v
    def inverse(self, v): self.c -= v
    def value(self): return self.c
    def finalize(self): return self.c
con.create_window_function('wsum', 1, WinSum); print(q('select a, wsum(a) over (order by a rows between 1 preceding and 1 following) from t'), q('select wsum(a) from t'))
class NoInverse(WinSum): inverse = property()
class BadInverse(WinSum):
    def inverse(self, v): 1 / 0
class NoValue(WinSum): value = property()
class BadValue(WinSum):
    def value(self): 1 / 0
class BadValueResult(WinSum):
    def value(self): return object()
for C in (NoInverse, BadInverse, NoValue, BadValue, BadValueResult, BadInit, BadStep):
    con.create_window_function('w', 1, C); t(q, 'select w(a) over (order by a rows between 1 preceding and 1 following) from t')
con.create_window_function('wsum', 1, None); t(q, 'select wsum(a) over () from t'); t(con.create_window_function, 'nothere', 1, None)
t(con.create_window_function); t(con.create_window_function, 'a', 1); t(con.create_window_function, 1, 1, WinSum); t(con.create_window_function, 'a', -2, WinSum); t(con.create_window_function, 'a', 1, WinSum, 2); t(con.create_window_function, 'a' * 300, 1, WinSum)
# Collations
con.create_collation('rev', lambda a, b: (a < b) - (a > b)); print(q('select b from t group by b order by b collate rev'), q("select 'a' < 'b' collate rev, 'a' = 'a' collate REV"))
con.create_collation('big', lambda a, b: 2**70 if a > b else -2**70 if a < b else 0); print(q('select b from t group by b order by b collate big'))
con.create_collation('odd', lambda a, b: 'x'); print(len(q('select b from t order by b collate odd'))); con.create_collation('flt', lambda a, b: 1.5); print(len(q('select b from t order by b collate flt')))
con.create_collation('bad', lambda a, b: 1 / 0); t(q, 'select b from t order by b collate bad')
con.create_collation('rev', None); t(q, 'select b from t order by b collate rev'); con.create_collation('never', None)
con.create_collation('\xfcni', lambda a, b: 0); print(len(q('select b from t order by b collate \xfcni')))
t(con.create_collation); t(con.create_collation, 'a'); t(con.create_collation, 1, len); t(con.create_collation, 'a', 5); t(con.create_collation, 'a', len, 1); t(con.create_collation, 'a', callback=len); t(con.create_collation, 'a\0', len)
c1 = con.execute('select b from t order by b collate big'); t(con.create_collation, 'big', None); c1.fetchall()
# The authorizer
log = []
def auth(*a): log.append(a); return sqlite3.SQLITE_OK
con.set_authorizer(auth); q('select a from t where b = ?', 'x1'); print(log[:4]); log.clear()
con.set_authorizer(lambda action, a1, a2, db, src: sqlite3.SQLITE_DENY if a2 == 'b' else sqlite3.SQLITE_OK); print(q('select a from t limit 1')); t(q, 'select b from t')
con.set_authorizer(lambda action, a1, a2, db, src: sqlite3.SQLITE_IGNORE if a2 == 'b' else sqlite3.SQLITE_OK); print(q('select a, b from t limit 2'))
for r in (lambda *a: 1 / 0, lambda *a: 'x', lambda *a: None, lambda *a: 2**40, lambda *a: 1.0, lambda *a: 77, lambda: 0, lambda *a: True):
    con.set_authorizer(r); t(q, 'select a + 1 from t limit 1')
con.set_authorizer(None); print(q('select b from t limit 1'))
t(con.set_authorizer); t(con.set_authorizer, 1, 2); t(con.set_authorizer, authorizer_callback=None); con.set_authorizer(5); t(q, 'select 1'); con.set_authorizer(None)
# The progress handler
n = [0]
def prog(): n[0] += 1; return 0
con.set_progress_handler(prog, 1); q('select count(*) from t a, t b, t c'); print(n[0] > 10); con.set_progress_handler(None, 1); n[0] = 0; q('select count(*) from t a, t b'); print(n[0])
con.set_progress_handler(lambda: 1, 1); t(q, 'select count(*) from t a, t b, t c'); con.set_progress_handler(lambda: 1 / 0, 1); t(q, 'select count(*) from t a, t b, t c'); con.set_progress_handler(lambda: '', 1); print(q('select 1')); con.set_progress_handler(prog, 0); n[0] = 0; q('select count(*) from t a, t b'); print(n[0]); con.set_progress_handler(prog, -5); q('select count(*) from t a, t b'); print(n[0])
class BadBool:
    def __bool__(self): raise ZeroDivisionError('bool')
con.set_progress_handler(BadBool, 1); t(q, 'select count(*) from t a, t b'); con.set_progress_handler(None, 0)
t(con.set_progress_handler); t(con.set_progress_handler, prog); t(con.set_progress_handler, prog, 'a'); t(con.set_progress_handler, prog, n=1); t(con.set_progress_handler, progress_handler=prog, n=1); t(con.set_progress_handler, prog, 1, 2); con.set_progress_handler(None, n=1)
# Tracing
tr = []
con.set_trace_callback(tr.append); q('select ?, ?', 1, 'it''s'); con.execute('insert into t values (?, ?)', (100, None)); con.commit(); con.executescript('select 1; select 2;'); print(tr); tr.clear()
con.set_trace_callback(None); q('select 3'); print(tr); con.set_trace_callback(lambda s: 1 / 0); print(q('select 4')); con.set_trace_callback(None)
t(con.set_trace_callback); t(con.set_trace_callback, 1, 2); t(con.set_trace_callback, trace_callback=None)
# Tracebacks of callbacks
err = io.StringIO()
sqlite3.enable_callback_tracebacks(True)
hooked = []
old = sys.unraisablehook; sys.unraisablehook = lambda u: hooked.append((u.exc_type.__name__, str(u.exc_value), u.err_msg.split(' <')[0] if u.err_msg else None, u.object))
t(q, 'select boom()'); con.set_trace_callback(lambda s: 1 / 0); q('select 5'); con.set_trace_callback(None); con.create_aggregate('agg', 1, BadStep); t(q, 'select agg(a) from t'); con.set_authorizer(lambda *a: 1 / 0); t(q, 'select 6'); con.set_authorizer(None)
sys.unraisablehook = old; print(hooked)
sqlite3.enable_callback_tracebacks(False); t(sqlite3.enable_callback_tracebacks); t(sqlite3.enable_callback_tracebacks, 'a'); t(sqlite3.enable_callback_tracebacks, 1, 2); t(sqlite3.enable_callback_tracebacks, enable=1)
# Callbacks outlive the names for them
import gc
def make():
    c = sqlite3.connect(':memory:'); c.create_function('f', 0, lambda: 'alive'); c.create_aggregate('g', 1, Sum); c.create_collation('k', lambda a, b: 0); c.set_trace_callback(lambda s: None); return c
c = make(); gc.collect(); print(c.execute("select f(), g(1), 'a' = 'b' collate k").fetchone()); c.close()
con.close(); t(con.create_function, 'a', 1, len); t(con.create_aggregate, 'a', 1, Sum); t(con.create_collation, 'a', len); t(con.set_authorizer, None); t(con.set_progress_handler, None, 1); t(con.set_trace_callback, None); t(con.create_window_function, 'a', 1, None)
# Callbacks that pull the rug
c = sqlite3.connect(':memory:'); seen = []
def tr1(s_): seen.append(s_); c.set_trace_callback(None); 1 / 0
c.set_trace_callback(tr1); print(c.execute('select 1').fetchone(), c.execute('select 2').fetchone(), seen)
def au(*a): c.set_authorizer(None); return sqlite3.SQLITE_OK
c.set_authorizer(au); print(c.execute('select 3').fetchone())
def pr(): c.set_progress_handler(None, 0); return 0
c.set_progress_handler(pr, 1); print(c.execute('select 4').fetchone())
c.create_function('redef', 0, lambda: c.create_function('redef', 0, lambda: 2)); t(lambda: c.execute('select redef()').fetchone()); c.close()
