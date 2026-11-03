# What the callbacks, converters and factories run comes back to the connection, the cursor or the blob that is calling them.
# (Only what CPython survives. What it crashes on is in test/js/bun/python/host-modules.test.ts.)
import sqlite3, gc
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
def fresh(**k):
    con = sqlite3.connect(':memory:', **k); con.execute('create table t(x, y)')
    con.executemany('insert into t values(?, ?)', [(i, str(i)) for i in range(5)]); con.commit()
    return con

# close() in a converter, with a column still to come
con = fresh(detect_types=sqlite3.PARSE_COLNAMES)
def conv(b): con.close(); return b
sqlite3.register_converter('c', conv)
cur = con.execute('select 1 as "a [c]", 2 as "b [c]"'); t(cur.fetchall); t(cur.fetchall); t(con.execute, 'select 1')

# in the text factory
con = fresh()
def tf(b): con.close(); return b
con.text_factory = tf
cur = con.execute('select y, y from t'); t(cur.fetchall); t(cur.fetchall)

# in the row factory: the row is there
con = fresh()
def rf(c, r): con.close(); return r
con.row_factory = rf
cur = con.execute('select x, y from t'); t(cur.fetchone); t(cur.fetchone)

# in a function, while the next row is made: the row before it is still handed out
con = fresh(); n = 0
def f(x):
    global n
    n += 1
    if n == 3: con.close()
    return x
con.create_function('f', 1, f)
cur = con.execute('select f(x) from t'); t(cur.fetchone); t(cur.fetchone); t(cur.fetchone); t(cur.fetchone)

# in the trace callback of a commit
con = fresh(); con.execute('insert into t values(9, 9)')
con.set_trace_callback(lambda s: con.close()); t(con.commit); t(con.commit)

# __init__() again in a converter: the settings are the new ones from the next column on, and the cursor reads on
con = fresh(detect_types=sqlite3.PARSE_COLNAMES)
def conv(b): con.__init__(':memory:'); return b
sqlite3.register_converter('c', conv)
cur = con.execute('select x as "a [c]", y as "b [c]" from t'); t(cur.fetchone); t(cur.fetchone); t(con.execute('select 1').fetchall); t(cur.fetchall)

# __init__() again in a function, which is called again after that, and nothing but SQLite knows it
con = fresh()
def f(x): con.__init__(':memory:'); gc.collect(); return x
con.create_function('f', 1, f); del f
t(con.execute('select sum(f(x)) from t').fetchall); t(con.execute('select 1').fetchall); t(con.execute, 'select f(1)')

# The statement that is running is pushed out of the cache.
con = fresh(cached_statements=1)
def f(x):
    for i in range(3): con.execute('select %d' % i).fetchall()
    gc.collect(); return x
con.create_function('f', 1, f); t(con.execute('select f(x) from t').fetchall)

# finalize() of an aggregate, called because the cursor is closed, closes the connection.
class W:
    def step(self, x): pass
    def inverse(self, x): pass
    def value(self): return 1
    def finalize(self): print('finalize'); con.close(); return 1
con = fresh(); con.create_window_function('w', 1, W)
cur = con.execute('select w(x) over (order by x rows between 1 preceding and 1 following) from t'); t(cur.fetchone); t(cur.close); t(con.execute, 'select 1')

# A cursor that is dropped in the middle of a window function: finalize() is called, and can do what it likes.
class W:
    def __init__(self): self.n = 0
    def step(self, x): self.n += x
    def inverse(self, x): self.n -= x
    def value(self): return self.n
    def finalize(self): print('finalize', [i for i in range(3)], con.execute('select 7').fetchone()); return self.n
con = fresh(); con.create_window_function('w', 1, W)
cur = con.execute('select w(x) over (order by x rows between 1 preceding and 1 following) from t'); t(cur.fetchone); del cur; gc.collect(); print('collected')
t(con.execute, 'drop table t'); con.close()
# The same with the connection gone as well.
def abandon():
    global con
    con = fresh(); con.create_window_function('w', 1, W)
    c = con.execute('select w(x) over (order by x rows between 1 preceding and 1 following) from t'); t(c.fetchone)
abandon(); gc.collect(); print('collected'); con.close()

# A frame of one row: value() after step() and inverse().
con = fresh(); con.create_window_function('w', 1, W)
t(con.execute('select w(x) over (order by x rows between 1 following and 2 following) from t where x = 0').fetchall); con.close()

# Blobs: __index__() closes the blob, or the connection.
def blob():
    con = fresh(); con.execute('create table b(v)'); con.execute('insert into b values(zeroblob(10))')
    return con, con.blobopen('b', 'v', 1)
class I:
    def __init__(self, what): self.what = what
    def __index__(self): self.what.close(); return 1
con, b = blob(); t(lambda: b[I(con)])
con, b = blob(); t(lambda: b[I(b)])
con, b = blob(); t(lambda: b[I(b):5])
con, b = blob(); t(lambda: b[I(con):5])
con, b = blob(); t(b.__setitem__, slice(I(b), 3), b'ab')
con, b = blob(); t(b.__setitem__, I(b), 1)
con, b = blob(); t(b.read, I(b))
con, b = blob(); t(b.seek, I(b))

# Layouts
class P: pass
for base in sqlite3.Cursor, sqlite3.Connection, sqlite3.Row:
    class C(base): pass
    p = P(); t(setattr, p, '__class__', C); print(type(p).__name__)
    class D(base): pass
    t(lambda: type('X', (C, D), {}).__mro__[1:3])
for bases in (sqlite3.Row, sqlite3.Cursor), (sqlite3.Connection, sqlite3.Cursor), (sqlite3.Connection, sqlite3.Row), (sqlite3.Cursor, dict), (sqlite3.Row, Exception), (sqlite3.Cursor, P):
    t(lambda: type('X', bases, {}).__name__)
class C1(sqlite3.Cursor): pass
class C2(sqlite3.Cursor): pass
con = fresh(); c = C1(con); c.__class__ = C2; print(type(c).__name__, c.execute('select 1').fetchall())
t(setattr, c, '__class__', sqlite3.Cursor); t(setattr, con.cursor(), '__class__', C1); t(sqlite3.Row.__new__, C1)
