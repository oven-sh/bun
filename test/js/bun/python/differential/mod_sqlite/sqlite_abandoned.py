# Cursors that are dropped half way do not stand in the way, without any help from gc.collect().
import sqlite3, os, tempfile, shutil
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
def fill(c):
    c.execute('create table t(a)'); c.executemany('insert into t values (?)', [(i,) for i in range(5)]); c.commit()
con = sqlite3.connect(':memory:'); fill(con)
print(con.execute('select * from t').fetchone()); t(con.execute, 'drop table t'); print(con.execute("select count(*) from sqlite_master").fetchone())
fill(con); con.execute('select * from t'); next(con.execute('select a + 1 from t')); t(con.execute, 'drop table t'); con.commit()
# One that is held does stand in the way.
fill(con); held = con.execute('select * from t'); held.fetchone(); t(con.execute, 'drop table t'); held.close(); t(con.execute, 'drop table t'); con.close()
d = tempfile.mkdtemp()
try:
    p = os.path.join(d, 'x.db'); a = sqlite3.connect(p, timeout=0); b = sqlite3.connect(p, timeout=0); fill(a)
    print(a.execute('select * from t').fetchone()); b.execute('insert into t values (9)'); t(b.commit); print(a.execute('select count(*) from t').fetchone())
    a.execute('select * from t').fetchone(); t(b.execute, 'drop table t'); t(b.commit)
    fill(a); held = a.execute('select * from t'); held.fetchone(); b.execute('insert into t values (9)'); t(b.commit); held.fetchall(); t(b.commit)
    # Closing a connection closes it, with cursors left lying about.
    a.execute('pragma journal_mode = wal'); a.execute('insert into t values (10)'); a.commit(); a.execute('select * from t').fetchone(); b.close(); a.close(); print(sorted(os.listdir(d)), open(p, 'rb').read(15))
finally:
    shutil.rmtree(d)
