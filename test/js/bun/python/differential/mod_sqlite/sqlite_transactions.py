import sqlite3, os, tempfile, shutil
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
def count(c): return c.execute('select count(*) from t').fetchone()[0]
con = sqlite3.connect(':memory:'); con.execute('create table t(a)')
print(con.in_transaction); con.execute('insert into t values (1)'); print(con.in_transaction, count(con)); con.rollback(); print(con.in_transaction, count(con))
con.execute('insert into t values (1)'); con.commit(); print(con.in_transaction, count(con)); con.commit(); con.rollback()
con.execute('select 1'); print(con.in_transaction); con.execute('create table u(a)'); print(con.in_transaction); con.execute('update t set a = 2'); print(con.in_transaction); con.execute('drop table u'); print(con.in_transaction); con.rollback(); print(con.execute('select a from t').fetchall(), con.execute("select name from sqlite_master order by 1").fetchall())
for level in ('', 'DEFERRED', 'IMMEDIATE', 'EXCLUSIVE', 'deferred', 'Immediate', None):
    con.isolation_level = level; print(repr(con.isolation_level), end=' '); con.execute('insert into t values (5)'); print(con.in_transaction, end=' '); con.rollback(); print(count(con))
def sl(v): con.isolation_level = v
t(sl, 'nope'); t(sl, 1); t(sl, b''); t(sl, 'DEFERRED\0'); t(sl, 'BEGIN'); print(repr(con.isolation_level))
def dl(): del con.isolation_level
t(dl)
con.isolation_level = ''; con.execute('insert into t values (9)'); print(con.in_transaction); con.isolation_level = None; print(con.in_transaction, count(con))
con.execute('begin'); print(con.in_transaction); con.execute('insert into t values (10)'); con.execute('rollback'); print(con.in_transaction, count(con))
t(sqlite3.connect, ':memory:', isolation_level='x'); t(sqlite3.connect, ':memory:', isolation_level=5); t(lambda: sqlite3.connect(':memory:', isolation_level=None).isolation_level); t(lambda: sqlite3.connect(':memory:', isolation_level='exclusive').isolation_level)
con.close()

# The context manager
con = sqlite3.connect(':memory:'); con.execute('create table t(a unique)')
with con as c:
    print(c is con); con.execute('insert into t values (1)')
print(con.in_transaction, count(con))
try:
    with con:
        con.execute('insert into t values (2)'); con.execute('insert into t values (1)')
except sqlite3.IntegrityError as e:
    print('IntegrityError', e)
print(con.in_transaction, count(con))
try:
    with con:
        con.execute('insert into t values (3)'); raise KeyError('x')
except KeyError: print('KeyError', count(con))
t(con.__exit__); t(con.__exit__, None, None); t(con.__exit__, None, None, None); t(con.__exit__, 1, None, None); t(con.__enter__, 1)
con.close(); t(con.__enter__); t(con.__exit__, None, None, None)

# executescript commits first, in the legacy mode
con = sqlite3.connect(':memory:'); con.execute('create table t(a)'); con.execute('insert into t values (1)'); print(con.in_transaction)
cur = con.executescript('insert into t values (2); insert into t values (3); -- comment\n select 1; /* x */'); print(type(cur).__name__, con.in_transaction, count(con)); con.rollback(); print(count(con))
print(con.cursor().executescript('') is not None, con.executescript('  ;;  ').fetchall(), con.executescript('begin; insert into t values (4);').connection is con, con.in_transaction); con.rollback(); print(count(con))
t(con.executescript, 'insert into t values (5); nonsense; insert into t values (6)'); print(count(con))
t(con.executescript); t(con.executescript, 1); t(con.executescript, b'select 1'); t(con.executescript, 'select 1\0'); t(con.executescript, 'select \ud800'); t(con.cursor().executescript, 1); t(con.cursor().executescript, None); t(con.executescript, 'select 1', 2)
con.close()

# autocommit
for mode in (True, False, sqlite3.LEGACY_TRANSACTION_CONTROL, -1):
    con = sqlite3.connect(':memory:', autocommit=mode); print(mode, con.autocommit, con.in_transaction, repr(con.isolation_level))
    con.execute('create table t(a)'); con.execute('insert into t values (1)'); print(con.in_transaction); con.rollback(); print(con.in_transaction); t(count, con); con.commit(); print(con.in_transaction)
    con.close()
t(sqlite3.connect, ':memory:', autocommit=1); t(sqlite3.connect, ':memory:', autocommit=0); t(sqlite3.connect, ':memory:', autocommit='a'); t(sqlite3.connect, ':memory:', autocommit=None); t(sqlite3.connect, ':memory:', autocommit=-2); t(sqlite3.connect, ':memory:', autocommit=2**70)
con = sqlite3.connect(':memory:', autocommit=False); con.execute('create table t(a)'); con.commit(); con.execute('insert into t values (1)')
con.autocommit = True; print(con.autocommit, con.in_transaction, count(con)); con.autocommit = False; print(con.autocommit, con.in_transaction); con.autocommit = False; con.autocommit = sqlite3.LEGACY_TRANSACTION_CONTROL; print(con.autocommit, con.in_transaction); con.commit()
def sa(v): con.autocommit = v
t(sa, 1); t(sa, None); print(con.autocommit)
def da(): del con.autocommit
t(da)
con.autocommit = False
with con: con.execute('insert into t values (2)')
print(con.in_transaction, count(con)); con.executescript('insert into t values (3)'); con.rollback(); print(count(con))
con.close(); t(lambda: con.autocommit); t(sa, True)

# Two connections to a file
d = tempfile.mkdtemp()
try:
    p = os.path.join(d, 'x.db')
    a = sqlite3.connect(p, timeout=0); b = sqlite3.connect(p, timeout=0.01)
    a.execute('create table t(a)'); a.execute('insert into t values (1)'); print(count(b)); a.commit(); print(count(b))
    a.execute('insert into t values (2)'); t(b.execute, 'insert into t values (3)')
    try: b.execute('insert into t values (3)')
    except sqlite3.OperationalError as e: print(e.sqlite_errorcode, e.sqlite_errorname)
    a.commit(); b.execute('insert into t values (3)'); b.commit(); print(count(a))
    # With autocommit=False, close() rolls back.
    c = sqlite3.connect(p, autocommit=False); c.execute('insert into t values (4)'); c.close(); print(count(a))
    c = sqlite3.connect(p); c.execute('insert into t values (4)'); c.close(); print(count(a))
    a.close(); b.close()
    for path in (p.encode(), __import__('pathlib').Path(p)):
        c = sqlite3.connect(path); print(count(c)); c.close()
    c = sqlite3.connect('file:' + p + '?mode=ro', uri=True); print(count(c)); t(c.execute, 'insert into t values (9)'); c.close()
    t(sqlite3.connect, 'file:' + p + '.nope?mode=ro', uri=True); t(sqlite3.connect, os.path.join(d, 'no', 'such', 'dir.db')); t(sqlite3.connect, d)
    try: sqlite3.connect(d)
    except sqlite3.OperationalError as e: print(e.sqlite_errorcode, e.sqlite_errorname)
    c = sqlite3.connect(database=p); c.close()
finally:
    shutil.rmtree(d)
t(sqlite3.connect); t(sqlite3.connect, 1); t(sqlite3.connect, None); t(sqlite3.connect, ':memory:', 5); t(sqlite3.connect, ':memory:', 1, 2); t(sqlite3.connect, 'a\0b'); t(sqlite3.connect, b'a\0b'); t(sqlite3.connect, ':memory:', timeout='a'); t(sqlite3.connect, ':memory:', detect_types='a'); t(sqlite3.connect, ':memory:', cached_statements='a'); t(sqlite3.connect, ':memory:', nope=1); t(sqlite3.connect, ':memory:', database='x'); t(sqlite3.Connection); t(sqlite3.Connection, ':memory:', 5); t(sqlite3.connect, ':memory:', factory=5); t(sqlite3.connect, ':memory:', factory=dict)
t(lambda: sqlite3.connect(':memory:', timeout=1, detect_types=3, check_same_thread=False, cached_statements=0, uri=False).execute('select 1').fetchone())
