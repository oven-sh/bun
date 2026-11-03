import sqlite3, os, tempfile, shutil, gc, warnings
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
con = sqlite3.connect(':memory:'); con.executescript("create table t(a integer primary key, b text not null, c real default 1.5); create index ti on t(b); create view v as select a from t; create trigger tr after insert on t begin select 1; end; insert into t(b) values ('x'), ('y''z'), ('€');")
# iterdump
print(list(con.iterdump())); print(list(con.iterdump(filter='t%'))); print(list(con.iterdump(filter='nope'))); t(con.iterdump, 1); t(con.iterdump, nope=1)
c2 = sqlite3.connect(':memory:'); c2.executescript('\n'.join(con.iterdump())); print(c2.execute('select * from t').fetchall()); c2.close()
# backup
dst = sqlite3.connect(':memory:'); print(con.backup(dst), dst.execute('select * from t').fetchall())
prog = []; dst2 = sqlite3.connect(':memory:'); con.backup(dst2, pages=1, progress=lambda *a: prog.append(a)); print(len(prog) > 1, prog[-1][0] == sqlite3.SQLITE_DONE, prog[-1][1], all(len(p) == 3 for p in prog), dst2.execute('select count(*) from t').fetchone())
con.backup(dst2, pages=0); con.backup(dst2, pages=-5, name='main', sleep=0.001); con.backup(target=dst2)
t(con.backup); t(con.backup, 1); t(con.backup, None); t(con.backup, con); t(con.backup, dst, 1); t(con.backup, dst, pages='a'); t(con.backup, dst, progress=5); t(con.backup, dst, name=5); t(con.backup, dst, name='nope'); t(con.backup, dst, sleep='a'); t(con.backup, dst, nope=1); t(con.backup, dst, progress=lambda *a: 1 / 0); t(con.backup, dst, progress=None)
dst.execute('begin'); dst.execute("insert into t(b) values ('q')"); t(con.backup, dst); dst.rollback()
dst2.close(); t(con.backup, dst2); dst.close()
# serialize
data = con.serialize(); print(type(data), data[:15], len(data) % 512, con.serialize(name='main') == data); t(con.serialize, name='nope'); t(con.serialize, 'main'); t(con.serialize, name=1); t(lambda: len(con.serialize(name='temp')))
c3 = sqlite3.connect(':memory:'); print(c3.deserialize(data), c3.execute('select b from t').fetchall()); c3.execute("insert into t(b) values ('new')"); c3.commit(); print(c3.execute('select count(*) from t').fetchone()); c3.deserialize(bytearray(data)); c3.deserialize(memoryview(data), name='main'); print(c3.execute('select count(*) from t').fetchone())
t(c3.deserialize); t(c3.deserialize, 1); t(c3.deserialize, data, 'main');  t(c3.deserialize, data, name=1); t(c3.deserialize, data=data)
c3.deserialize(b'garbage that is not a database at all'); t(c3.execute, 'select * from t'); t(c3.deserialize, b''); t(c3.execute, 'select 1'); t(c3.deserialize, 'text'); c3.close(); t(c3.serialize); t(c3.deserialize, data)
# Limits
print(con.getlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH) > 1000, con.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 50) > 1000, con.getlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH)); t(con.execute, 'select 1 ' + ' ' * 50); t(con.executescript, 'select 1;' + ' ' * 50); t(con, 'select 1' + ' ' * 50); print(con.execute('select 1' + ' ' * 42).fetchone()); con.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 10**6)
print(con.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 2) > 2, con.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, -1)); t(con.execute, 'select ?, ?, ?', (1, 2, 3)); print(con.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 10**9) >= 0, con.getlimit(sqlite3.SQLITE_LIMIT_ATTACHED) < 10**9)
con.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 100); t(con.execute, 'select ?', ('x' * 200,)); t(con.execute, 'select ?', (b'x' * 200,)); t(con.execute('select zeroblob(200)').fetchone) if False else None; con.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 10**8)
t(con.getlimit, 1000); t(con.getlimit, -1); t(con.setlimit, 1000, 1); t(con.getlimit); t(con.getlimit, 'a'); t(con.setlimit, 1); t(con.setlimit, 1, 'a'); t(con.getlimit, 2**40); t(con.getlimit, category=1); t(con.setlimit, 1, 2, 3)
# Configuration
for op in (sqlite3.SQLITE_DBCONFIG_ENABLE_FKEY, sqlite3.SQLITE_DBCONFIG_ENABLE_TRIGGER, sqlite3.SQLITE_DBCONFIG_DEFENSIVE, sqlite3.SQLITE_DBCONFIG_ENABLE_VIEW):
    before = con.getconfig(op); con.setconfig(op, not before); mid = con.getconfig(op); con.setconfig(op, before); print(type(before), mid != before, con.getconfig(op) == before)
con.setconfig(sqlite3.SQLITE_DBCONFIG_ENABLE_FKEY); print(con.getconfig(sqlite3.SQLITE_DBCONFIG_ENABLE_FKEY), con.execute('pragma foreign_keys').fetchone()); con.setconfig(sqlite3.SQLITE_DBCONFIG_ENABLE_FKEY, 0); con.setconfig(sqlite3.SQLITE_DBCONFIG_ENABLE_FKEY, 'yes'); print(con.getconfig(sqlite3.SQLITE_DBCONFIG_ENABLE_FKEY))
t(con.getconfig, -1); t(con.getconfig, 1000); t(con.setconfig, 12345, True); t(con.getconfig); t(con.getconfig, 'a'); t(con.setconfig); t(con.setconfig, 'a'); t(con.setconfig, 1002, True, 1); t(con.getconfig, op=1002)
# Odds and ends
print(sqlite3.complete_statement('select 1;'), sqlite3.complete_statement('select 1'), sqlite3.complete_statement(''), sqlite3.complete_statement("select ';"), sqlite3.complete_statement(statement='create trigger a after insert on b begin select 1; end;'))
t(sqlite3.complete_statement); t(sqlite3.complete_statement, 1); t(sqlite3.complete_statement, 'a\0'); t(sqlite3.complete_statement, 'a', 'b'); t(sqlite3.complete_statement, b'select 1;')
print(con.interrupt()); t(con.interrupt, 1); print(con.execute('select 1').fetchone())
con.create_function('stop', 0, lambda: con.interrupt()); t(con.execute('select stop(), a from t').fetchall)
print(con.total_changes > 0); t(setattr, con, 'total_changes', 1); t(setattr, con, 'in_transaction', 1); t(setattr, con, 'nope', 1); t(lambda: con.nope)
# Recursive use
cur = con.cursor()
def conv(b): cur.execute('select 2'); return b
sqlite3.register_converter('recur', conv); rc = sqlite3.connect(':memory:', detect_types=sqlite3.PARSE_COLNAMES); cur = rc.cursor(); cur.execute('select 1 as "x [recur]"'); t(cur.fetchone)
def conv2(b): cur.close(); return b
sqlite3.register_converter('recur2', conv2); cur.execute('select 1 as "x [recur2]"'); t(cur.fetchone)
def conv3(b): cur.__init__(rc); return b
sqlite3.register_converter('recur3', conv3); cur.execute('select 1 as "x [recur3]"'); t(cur.fetchone)
def gen():
    cur.execute('select 1'); yield (1,)
rc.execute('create table g(a)'); t(cur.executemany, 'insert into g values (?)', gen())
def gen2():
    yield (1,); raise ZeroDivisionError('gen')
t(cur.executemany, 'insert into g values (?)', gen2()); print(cur.rowcount, rc.execute('select count(*) from g').fetchone()); rc.close()
# Closed things
cur = con.cursor(); cur.execute('select 1 union select 2'); print(cur.close(), cur.close())
for f in (cur.fetchone, cur.fetchall, cur.fetchmany, lambda: cur.execute('select 1'), lambda: cur.executemany('x', []), lambda: cur.executescript(''), lambda: next(cur), lambda: list(cur)):
    t(f)
print(cur.description, cur.rowcount, cur.lastrowid, cur.connection is con, cur.arraysize)
live = con.cursor(); live.execute('select 1 union select 2'); live.fetchone(); con.close()
for f in (con.cursor, con.commit, con.rollback, con.interrupt, lambda: con.execute('select 1'), lambda: con.executemany('x', []), lambda: con.executescript(''), lambda: con('select 1'), con.iterdump, lambda: con.in_transaction, lambda: con.total_changes, lambda: con.isolation_level, lambda: con.getlimit(1), lambda: con.getconfig(1002), lambda: con.setconfig(1002), live.fetchone, live.close, lambda: live.execute('select 1'), lambda: next(live)):
    t(f)
print(con.row_factory, con.text_factory, con.Error.__name__, con.close())
# An unclosed connection
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    u = sqlite3.connect(':memory:'); del u; gc.collect()
    print([(x.category.__name__, str(x.message).split(' at ')[0]) for x in w])
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    u = sqlite3.connect(':memory:'); u.close(); del u; gc.collect(); print(len(w))
# A cursor that is dropped lets go of the database
d = tempfile.mkdtemp()
try:
    p = os.path.join(d, 'x.db'); a = sqlite3.connect(p); a.execute('create table t(a)'); a.executemany('insert into t values (?)', [(i,) for i in range(5)]); a.commit()
    c = a.execute('select * from t'); c.fetchone(); del c; gc.collect(); b = sqlite3.connect(p, timeout=0); b.execute('drop table t'); b.commit(); b.close(); a.close()
finally:
    shutil.rmtree(d)
# Errors as objects
for E in (sqlite3.Error, sqlite3.OperationalError):
    e = E('msg', 1); print(e.args, hasattr(e, 'sqlite_errorcode'), str(e), repr(e))
import pickle; print(pickle.loads(pickle.dumps(sqlite3.IntegrityError('x'))).args)
c = sqlite3.connect(':memory:'); t(pickle.dumps, c); t(pickle.dumps, c.cursor()); t(hash, c) if False else None; print(c == c, c != c, bool(c)); c.close()
