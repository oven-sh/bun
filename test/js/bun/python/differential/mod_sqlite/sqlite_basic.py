import sqlite3, _sqlite3
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
names = sorted(n for n in dir(_sqlite3) if not n.startswith('__'))
print([n for n in names if not n.startswith('SQLITE_')])
print({n: getattr(_sqlite3, n) for n in names if n.startswith('SQLITE_') and n != 'SQLITE_KEYWORDS'})
print(type(_sqlite3.SQLITE_KEYWORDS), 'SELECT' in _sqlite3.SQLITE_KEYWORDS, len(_sqlite3.SQLITE_KEYWORDS) > 100, _sqlite3.PARSE_DECLTYPES, _sqlite3.PARSE_COLNAMES, _sqlite3.LEGACY_TRANSACTION_CONTROL, type(_sqlite3.sqlite_version), sorted(k[0].__name__ for k in _sqlite3.adapters), sorted(_sqlite3.converters))
for n in ('Warning', 'Error', 'InterfaceError', 'DatabaseError', 'DataError', 'OperationalError', 'IntegrityError', 'InternalError', 'ProgrammingError', 'NotSupportedError'):
    E = getattr(sqlite3, n); print(n, E.__mro__, E.__module__, E.__qualname__)
for T in (sqlite3.Connection, sqlite3.Cursor, sqlite3.Row, sqlite3.Blob, sqlite3.PrepareProtocol):
    print(T, T.__mro__, T.__module__, T.__doc__, sorted((n, type(v).__name__) for n, v in T.__dict__.items() if n not in ('__doc__', '__module__', '__new__', '__weakref__')))
print(sqlite3.apilevel, sqlite3.paramstyle, sqlite3.threadsafety in (0, 1, 3), sqlite3.sqlite_version_info >= (3, 15, 2))

con = sqlite3.connect(':memory:')
print(type(con), con.isolation_level, con.autocommit, con.in_transaction, con.total_changes, con.row_factory, con.text_factory, con.__text_signature__)
cur = con.cursor()
print(type(cur), cur.connection is con, cur.description, cur.lastrowid, cur.rowcount, cur.arraysize, cur.row_factory)
print(cur.execute('create table t(a integer primary key, b text, c real, d blob, e)') is cur, cur.description, cur.rowcount, cur.lastrowid)
print(cur.execute('insert into t values (?, ?, ?, ?, ?)', (1, 'one', 1.5, b'\x00\x01', None)).rowcount, cur.lastrowid, con.in_transaction, con.total_changes)
print(cur.execute('insert into t(b, c, d, e) values (:b, :c, :d, :e)', {'b': 'two', 'c': 2.0, 'd': bytearray(b'xy'), 'e': 2**62, 'unused': 1}).rowcount, cur.lastrowid)
print(cur.executemany('insert into t(b) values (?)', [('three',), ('four',), ['five']]).rowcount, cur.lastrowid)
print(cur.executemany('insert into t(b) values (?)', iter([('six',)])).rowcount, cur.executemany('insert into t(b) values (?)', (x for x in [])).rowcount)
print(cur.execute('select * from t order by a').description)
print(cur.rowcount, cur.fetchone(), cur.fetchone(), cur.fetchmany(), cur.fetchmany(2), cur.fetchmany(size=1), cur.fetchall(), cur.fetchone(), cur.fetchmany(5), cur.fetchall())
print([type(x).__name__ for x in cur.execute('select * from t where a = 1').fetchone()], [type(x).__name__ for x in cur.execute('select * from t where a = 2').fetchone()])
print(list(cur.execute('select a, b from t where a > ?', (4,))), [r for r in con.execute('select count(*), sum(a), avg(a), max(b), null, 1.0, 2.5, x\'00ff\', \'\', x\'\' from t')])
cur.arraysize = 3; print(cur.arraysize, len(cur.execute('select a from t').fetchmany()), cur.fetchmany(0), len(cur.fetchmany(100)))
print(cur.execute('update t set e = 1 where a < 4').rowcount, cur.execute('delete from t where a = 7').rowcount, cur.execute('delete from t where a = 700').rowcount, cur.execute('replace into t(a, b) values (1, ?)', ('uno',)).rowcount, cur.execute('select 1').rowcount, cur.execute('  /* c */ -- d\n insert into t(b) values (1)').rowcount)
print(next(cur.execute('select 7')), iter(cur) is cur); t(next, cur)
# Values
for v in (0, 1, -1, 2**31, -2**31 - 1, 2**53, 2**53 + 1, 2**63 - 1, -2**63, True, False, 0.0, -0.0, 1.0, 1e300, float('inf'), -float('inf'), 3.14, '', 'a', 'h\xe9llo', '€\U0001f600', 'nul\0in', b'', b'\0', bytes(range(256)), bytearray(b'ba'), memoryview(b'mv'), None):
    r = con.execute('select ?, typeof(?)', (v, v)).fetchone(); print(repr(v)[:40].split(' at ')[0], repr(r)[:90], type(r[0]).__name__)
print(con.execute('select ?', (float('nan'),)).fetchone())
t(con.execute, 'select ?', (2**63,)); t(con.execute, 'select ?', (-2**63 - 1,)); t(con.execute, 'select ?', (object(),)); t(con.execute, 'select ?', ([1],)); t(con.execute, 'select ?', ({},)); t(con.execute, 'select ?', (1j,)); t(con.execute, 'select ?', ('\ud800',)); t(con.execute, 'select :a', {'a': object()})
class MyInt(int): pass
class MyStr(str): pass
class MyFloat(float): pass
class MyBytes(bytes): pass
print(con.execute('select ?, ?, ?, ?', (MyInt(5), MyStr('s'), MyFloat(2.5), MyBytes(b'b'))).fetchone())
# Parameters
t(con.execute, 'select ?'); t(con.execute, 'select ?', ()); t(con.execute, 'select ?', (1, 2)); t(con.execute, 'select ?, ?', [1]); t(con.execute, 'select 1', (1,)); t(con.execute, 'select :a', (1,)); t(con.execute, 'select :a, ?', (1, 2)); t(con.execute, 'select ?', {'a': 1}); t(con.execute, 'select :a', {}); t(con.execute, 'select :a', {'b': 1})
t(con.execute, 'select ?', 5); t(con.execute, 'select ?', None); t(con.execute, 'select ?', {1}); t(con.execute, 'select ?', 'a'); t(con.execute, 'select ?, ?', 'ab'); t(con.execute, 'select ?', b'a'); t(con.execute, 'select ?', range(1)); t(lambda: con.execute('select ?1, ?2, ?1', (1, 2)).fetchone()); t(lambda: con.execute('select @a, $b, :c', {'a': 1, 'b': 2, 'c': 3}).fetchone())
class Seq:
    def __len__(self): return 2
    def __getitem__(self, i): return i * 10
class BadLen:
    def __len__(self): raise ZeroDivisionError('len')
    def __getitem__(self, i): return i
class BadItem:
    def __len__(self): return 1
    def __getitem__(self, i): raise ZeroDivisionError('item')
class D(dict):
    def __missing__(self, k): return 'missing ' + k
t(lambda: con.execute('select ?, ?', Seq()).fetchone()); t(con.execute, 'select ?', BadLen()); t(con.execute, 'select ?', BadItem()); t(lambda: con.execute('select :x', D()).fetchone())
import collections
t(lambda: con.execute('select :x', collections.UserDict(x=1)).fetchone()); t(lambda: con.execute('select :x', collections.OrderedDict(x=1)).fetchone()); t(lambda: con.execute('select ?', collections.deque([4])).fetchone())
# Wrong calls
t(con.execute); t(con.execute, 1); t(con.execute, b'select 1'); t(con.execute, 'select 1', (), 3); t(con.execute, sql='select 1'); t(cur.execute); t(cur.execute, None); t(cur.executemany, 'select 1'); t(cur.executemany, 1, []); t(cur.executemany, 'insert into t(b) values (?)', 5); t(cur.executemany, 'insert into t(b) values (?)', [5]); t(cur.executemany, 'select 1', []); t(cur.executemany, 'select ?', [(1,)])
t(con.execute, 'select 1; select 2'); t(con.execute, 'select 1;'); t(con.execute, 'select 1; -- c'); t(con.execute, 'select 1; /* c */  '); t(con.execute, ''); t(con.execute, '   '); t(con.execute, '-- only'); t(con.execute, 'selec 1'); t(con.execute, 'select * from nope'); t(con.execute, 'select 1\0'); t(con.execute, 'select \ud800'); t(con.execute, 'select nope(1)')
t(lambda: con.execute('').fetchall()); t(lambda: con.execute('').description)
t(cur.fetchmany, -1); t(cur.fetchmany, 'a'); t(cur.fetchmany, 2**32); t(cur.fetchmany, 2**32 - 1); t(cur.fetchmany, 1.0); t(cur.fetchmany, 1, 2); t(cur.fetchmany, None); t(cur.fetchone, 1); t(cur.fetchall, 1)
def sa(v):
    cur.arraysize = v
t(sa, -1); t(sa, 'a'); t(sa, 2**32); t(sa, 1.5); t(sa, 0); print(cur.arraysize)
def da(): del cur.arraysize
t(da)
for a in ('connection', 'description', 'lastrowid', 'rowcount'):
    t(setattr, cur, a, 1); t(delattr, cur, a)
t(cur.setinputsizes, 1); t(cur.setinputsizes); t(cur.setoutputsize, 1); t(cur.setoutputsize, 1, 2); t(cur.setoutputsize)
try:
    con.execute('insert into t(a) values (1)')
except sqlite3.IntegrityError as e:
    print(type(e).__name__, e, e.args, e.sqlite_errorcode, e.sqlite_errorname, e.sqlite_errorcode == sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY)
try:
    con.execute('select * from nope')
except sqlite3.OperationalError as e:
    print(e.sqlite_errorcode, e.sqlite_errorname, isinstance(e, sqlite3.DatabaseError), isinstance(e, sqlite3.Error))
print(con.Error is sqlite3.Error, con.Warning is sqlite3.Warning, con.ProgrammingError is sqlite3.ProgrammingError, con.NotSupportedError is sqlite3.NotSupportedError)
t(setattr, con, 'Error', 1)
con.close(); con.close()
