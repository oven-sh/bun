import sqlite3, datetime, warnings, gc
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
con = sqlite3.connect(':memory:'); con.execute('create table t(a, "B c", d)'); con.execute("insert into t values (1, 'two', 3.0)")
# Row
con.row_factory = sqlite3.Row
cur = con.execute('select a, "B c", d, a as A2 from t'); r = cur.fetchone()
print(type(r), len(r), r.keys(), tuple(r), list(r), r[0], r[-1], r[1:3], r[::-1], r['a'], r['A'], r['b C'], r['a2'], dict(r), 'a' in r, 1 in r)
t(lambda: r[4]); t(lambda: r[-5]); t(lambda: r['nope']); t(lambda: r[1.0]); t(lambda: r[None]); t(lambda: r[2**70]); t(lambda: r[b'a']); t(lambda: r['\xe9'])
t(lambda: r); r2 = con.execute('select a, "B c", d, a as A2 from t').fetchone(); r3 = con.execute('select a, "B c", d, a as x from t').fetchone(); r4 = con.execute('select 2 as a, "B c", d, a as A2 from t').fetchone()
print(r == r2, r != r2, hash(r) == hash(r2), r == r3, r != r3, r == r4, r != r4, r == tuple(r), r != tuple(r), r == 1, {r: 1}[r2])
t(lambda: r < r2); t(lambda: r <= r2); print(r.__lt__(r2), r.__eq__(5), r.__ne__(r2))
def si(): r[0] = 1
t(si)
def sx(): r.x = 1
t(sx)
a, b, c, d = r; print(a, b, c, d, [x for x in reversed(tuple(r))], iter(r).__class__.__name__)
t(sqlite3.Row); t(sqlite3.Row, cur); t(sqlite3.Row, 1, ()); t(sqlite3.Row, cur, []); t(sqlite3.Row, cur, (1,), 2); t(sqlite3.Row, cursor=cur, data=()); t(lambda: sqlite3.Row(cur, (1, 2)).keys()); t(lambda: sqlite3.Row(con.cursor(), (1, 2)).keys()); t(lambda: sqlite3.Row(con.cursor(), (1, 2))['a']); t(lambda: tuple(sqlite3.Row(cur, (1,)))); t(lambda: sqlite3.Row(cur, (1,))['d'])
class MyRow(sqlite3.Row):
    def first(self): return self[0]
con.row_factory = MyRow; m = con.execute('select 5 as five').fetchone(); print(type(m).__name__, m.first(), m['FIVE'], m == con.execute('select 5 as five').fetchone()); m.extra = 1; print(m.extra)
import pickle, copy
t(pickle.dumps, r); t(lambda: tuple(copy.copy(m)) if False else None)
# Other row factories
con.row_factory = lambda cursor, row: {d[0]: v for d, v in zip(cursor.description, row)}
print(con.execute('select a, d from t').fetchall(), con.cursor().row_factory is con.row_factory)
con.row_factory = None; cur = con.cursor(); print(cur.row_factory); cur.row_factory = lambda c, row: list(row); print(cur.execute('select a, d from t').fetchone(), cur.execute('select a from t').fetchmany(2), cur.execute('select a from t').fetchall(), next(cur.execute('select 1')))
cur.row_factory = lambda c, row: 1 / 0; t(cur.execute('select 1').fetchone); cur.row_factory = 5; t(cur.execute('select 1').fetchone); cur.row_factory = None
def dr(o): del o.row_factory
t(dr, cur); t(dr, con)
def dt(): del con.text_factory
t(dt)
# text_factory
con.execute("insert into t values ('h\xe9', x'ff41', null)")
for f in (str, bytes, bytearray, lambda b: b.decode('latin-1'), lambda b: len(b), sqlite3.OptimizedUnicode if hasattr(sqlite3, 'OptimizedUnicode') else str):
    con.text_factory = f; print(con.execute("select a, typeof(a), '' from t where a = 'h\xe9'").fetchone())
con.text_factory = str
t(con.execute("select cast(x'ff41' as text) as bad").fetchone); t(con.execute("select cast(x'e9' || zeroblob(0) as text) as \"n\xe4me\"").fetchone)
con.text_factory = lambda b: 1 / 0; t(con.execute("select 'x'").fetchone); con.text_factory = 5; t(con.execute("select 'x'").fetchone); con.text_factory = str
class S(str): pass
con.text_factory = S; t(con.execute("select 'x'").fetchone); con.text_factory = str

# Adapters
class Point:
    def __init__(self, x, y): self.x, self.y = x, y
    def __repr__(self): return 'Point(%r, %r)' % (self.x, self.y)
t(con.execute, 'select ?', (Point(1, 2),))
sqlite3.register_adapter(Point, lambda p: '%g;%g' % (p.x, p.y)); print(con.execute('select ?', (Point(1, 2.5),)).fetchone(), con.execute('select :p', {'p': Point(3, 4)}).fetchone(), sqlite3.adapt(Point(5, 6)), len(sqlite3.adapters) >= 1, (Point, sqlite3.PrepareProtocol) in sqlite3.adapters)
class Conform:
    def __conform__(self, protocol): return 'conformed' if protocol is sqlite3.PrepareProtocol else None
class ConformNone:
    def __conform__(self, protocol): return None
class ConformTypeError:
    def __conform__(self, protocol): raise TypeError('x')
class ConformError:
    def __conform__(self, protocol): raise ZeroDivisionError('conform')
print(con.execute('select ?', (Conform(),)).fetchone(), sqlite3.adapt(Conform())); t(con.execute, 'select ?', (ConformNone(),)); t(con.execute, 'select ?', (ConformTypeError(),)); t(con.execute, 'select ?', (ConformError(),))
t(sqlite3.adapt, object()); t(sqlite3.adapt, object(), sqlite3.PrepareProtocol, 'alt'); t(sqlite3.adapt, 1); t(sqlite3.adapt, 'a', int); t(sqlite3.adapt, 1, None, 2); t(sqlite3.adapt); t(sqlite3.adapt, 1, 2, 3, 4); t(sqlite3.adapt, obj=1)
class Proto:
    @staticmethod
    def __adapt__(obj): return ('adapted', obj)
t(sqlite3.adapt, 5, Proto)
sqlite3.register_adapter(Point, lambda p: 1 / 0); t(con.execute, 'select ?', (Point(1, 2),)); sqlite3.register_adapter(Point, lambda p: object()); t(con.execute, 'select ?', (Point(1, 2),))
t(sqlite3.register_adapter); t(sqlite3.register_adapter, 1); t(sqlite3.register_adapter, 1, 2); t(sqlite3.register_adapter, [], 2)
# Converters
sqlite3.register_adapter(Point, lambda p: '%g;%g' % (p.x, p.y))
sqlite3.register_converter('point', lambda b: Point(*map(float, b.split(b';')))); print(sorted(k for k in sqlite3.converters if k == 'POINT'))
for detect in (0, sqlite3.PARSE_DECLTYPES, sqlite3.PARSE_COLNAMES, sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES):
    c = sqlite3.connect(':memory:', detect_types=detect); c.execute('create table p(a point, b Point(3, 4), c "point x", d text, e)'); c.execute('insert into p values (?, ?, ?, ?, ?)', (Point(1, 2), Point(3, 4), Point(5, 6), '7;8', None))
    cur = c.execute('select a, b, c, d, e, a as "x [point]", d as "y [POINT]", d as "z[point]", d as "[point]", d as "w [nope]", a as "v [", e as "n [point]" from p'); print(detect, cur.fetchone()); print([d[0] for d in cur.description]); c.close()
sqlite3.register_converter('boom', lambda b: 1 / 0); c = sqlite3.connect(':memory:', detect_types=sqlite3.PARSE_COLNAMES); t(c.execute('select 1 as "x [boom]"').fetchone); t(c.execute('select null as "x [boom]"').fetchone); t(lambda: c.execute('select 1.5 as "x [point2]", x\'41\' as "y [raw]"').fetchone())
sqlite3.register_converter('raw', lambda b: b); print(c.execute('select 1.5 as "a [raw]", 7 as "b [raw]", \'t\' as "c [RAW]", x\'00\' as "d [Raw]"').fetchone()); c.close()
t(sqlite3.register_converter); t(sqlite3.register_converter, 1, 2); t(sqlite3.register_converter, 'a'); t(sqlite3.register_converter, 'x', 5)
# The default adapters and converters, which are deprecated
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    c = sqlite3.connect(':memory:', detect_types=sqlite3.PARSE_DECLTYPES); c.execute('create table d(a date, b timestamp)'); c.execute('insert into d values (?, ?)', (datetime.date(2020, 1, 2), datetime.datetime(2020, 1, 2, 3, 4, 5, 6)))
    print(c.execute('select a, b from d').fetchone(), c.execute('select cast(a as text), cast(b as text) from d').fetchone(), sorted({(x.category.__name__, str(x.message)[:40]) for x in w})); c.close()
# An adapter for a basic type
sqlite3.register_adapter(int, lambda i: i + 1000); print(con.execute('select ?, ?', (1, 'a')).fetchone()); del sqlite3.adapters[(int, sqlite3.PrepareProtocol)]; print(con.execute('select ?', (1,)).fetchone())

# Factories and subclasses
class MyCursor(sqlite3.Cursor):
    def __init__(self, *a, **k):
        super().__init__(*a, **k); self.mine = True
    def one(self, sql): return self.execute(sql).fetchone()[0]
mc = con.cursor(MyCursor); print(type(mc).__name__, mc.mine, mc.one('select 42'), con.cursor(factory=MyCursor).one('select 43'), isinstance(mc, sqlite3.Cursor))
t(con.cursor, 5); t(con.cursor, lambda c: 5); t(con.cursor, lambda c: None); t(con.cursor, dict); t(con.cursor, MyCursor, 1); t(con.cursor, nope=1); t(con.cursor, lambda c: 1 / 0); t(con.cursor, None)
class NoInit(sqlite3.Cursor):
    def __init__(self, con): pass
n = NoInit(con); t(n.execute, 'select 1'); t(n.fetchone); t(n.close); t(lambda: n.connection); t(lambda: n.description); t(lambda: n.rowcount); t(lambda: n.arraysize); t(next, n)
t(sqlite3.Cursor); t(sqlite3.Cursor, 1); t(sqlite3.Cursor, con, 1); t(sqlite3.Cursor, connection=con); t(sqlite3.Cursor, con)
cc = sqlite3.Cursor(con); cc.execute('select 1 union select 2'); cc.__init__(con); print(cc.fetchone(), cc.description)
class MyCon(sqlite3.Connection):
    def __init__(self, *a, **k):
        super().__init__(*a, **k); self.tag = 'mine'
    def q(self, sql): return self.execute(sql).fetchall()
mcn = sqlite3.connect(':memory:', factory=MyCon); print(type(mcn).__name__, mcn.tag, mcn.q('select 1'), isinstance(mcn, sqlite3.Connection)); mcn.close()
mcn = MyCon(':memory:', isolation_level=None); print(mcn.isolation_level); mcn.close()
class NoInitCon(sqlite3.Connection):
    def __init__(self, *a): pass
nc = NoInitCon(':memory:')
for f in (nc.cursor, nc.commit, nc.rollback, nc.close, nc.interrupt, lambda: nc.execute('select 1'), lambda: nc.in_transaction, lambda: nc.isolation_level, lambda: nc.total_changes, lambda: nc.autocommit, lambda: nc('select 1'), nc.__enter__, lambda: nc.Error, nc.iterdump, lambda: nc.getlimit(1)):
    t(f)
# __init__ again opens anew
c = sqlite3.connect(':memory:'); c.execute('create table z(a)'); cu = c.cursor(); c.__init__(':memory:'); t(c.execute, 'select * from z'); t(cu.execute, 'select 1'); c.close()
# A statement
st = con('select 1'); print(type(st).__name__, type(st).__module__, type(st).__mro__); t(type(st)); t(con); t(con, 1); t(con, 'select 1', 2); t(con, sql='select 1'); t(con, 'nonsense'); t(con, 'select 1; select 2')
# The cache of statements
for size in (0, 1, 2, 128, -5):
    c = sqlite3.connect(':memory:', cached_statements=size); print(size, [c.execute('select %d' % (i % 3)).fetchone()[0] for i in range(9)])
    a = c.execute('select 1 union select 2'); b = c.execute('select 1 union select 2'); print(a.fetchone(), b.fetchone(), a.fetchone(), b.fetchall(), a.fetchone()); c.close()
con.close()
p = sqlite3.PrepareProtocol(); print(type(p).__name__); t(sqlite3.PrepareProtocol, 1, x=2)
def subp():
    class X(sqlite3.PrepareProtocol): pass
t(subp)
