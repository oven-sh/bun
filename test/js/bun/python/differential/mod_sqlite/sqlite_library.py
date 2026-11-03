# What else in the standard library stands on sqlite3.
import sqlite3, os, tempfile, shutil, dbm, shelve, io, contextlib, sys
print(sorted(n for n in dir(sqlite3) if not n.startswith('_') and not n.startswith('SQLITE_')))
print(bytes(sqlite3.Binary(b'x')), sqlite3.Date(2020, 1, 2), sqlite3.Time(1, 2, 3), sqlite3.Timestamp(2020, 1, 2, 3, 4, 5), sqlite3.DateFromTicks(0).year, sqlite3.dbapi2.connect is sqlite3.connect)
import collections.abc
print(issubclass(sqlite3.Row, collections.abc.Sequence), isinstance(sqlite3.connect(':memory:').execute('select 1').fetchone(), tuple))
d = tempfile.mkdtemp()
try:
    import dbm.sqlite3
    p = os.path.join(d, 'k.db')
    with dbm.sqlite3.open(p, 'c') as db:
        db[b'a'] = b'1'; db['b'] = '2'; print(db[b'a'], db['b'], sorted(db.keys()), len(db), b'a' in db, db.get(b'z', b'd')); del db['a']; print(sorted(db))
    print(dbm.whichdb(p))
    with dbm.open(p, 'r') as db: print(db[b'b'])
    with shelve.open(os.path.join(d, 'shelf')) as s:
        s['x'] = [1, 2, {'y': 3}]; s['z'] = 'w'
    with shelve.open(os.path.join(d, 'shelf')) as s: print(sorted(s.items()))
    # python -m sqlite3
    from sqlite3.__main__ import main
    out = io.StringIO()
    with contextlib.redirect_stdout(out): main([os.path.join(d, 'cli.db'), "create table t(a); insert into t values (1), (2); "]) if False else main([os.path.join(d, 'cli.db'), 'select 1, 2'])
    print(out.getvalue())
finally:
    shutil.rmtree(d)
con = sqlite3.connect(':memory:')
con.executescript('''create table person(id integer primary key, name text, age int); create table pet(id integer primary key, owner references person(id), name);''')
con.executemany('insert into person(name, age) values (?, ?)', [('Ann', 30), ('Bob', 25), ('Cid', 35)]); con.executemany('insert into pet(owner, name) values (?, ?)', [(1, 'Rex'), (1, 'Tom'), (3, 'Zed')])
print(con.execute('select p.name, count(q.id), group_concat(q.name, \'/\') from person p left join pet q on q.owner = p.id group by p.id order by p.age desc').fetchall())
print(con.execute("with recursive c(x) as (select 1 union all select x + 1 from c where x < 5) select sum(x), json_group_array(x) from c").fetchone(), con.execute("select json_extract('{\"a\": [1, 2, {\"b\": 3}]}', '$.a[2].b'), upper('abc'), round(2.567, 1), abs(-3), coalesce(null, 'd'), substr('hello', 2, 3), 7 / 2, 7 / 2.0, 7 % 3, 'a' || 'b', printf('%05d', 42), sqrt(16.0)").fetchone())
con.execute('create virtual table f using fts5(body)'); con.executemany('insert into f values (?)', [('the quick brown fox',), ('lazy dogs sleep',), ('quick thinking',)]); print(con.execute("select body from f where f match 'quick' order by rowid").fetchall())
con.close()
