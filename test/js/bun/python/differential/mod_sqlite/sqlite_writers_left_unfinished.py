# A statement that writes and gives rows (PRAGMA journal_mode = wal, INSERT ... RETURNING) whose cursor is dropped unread
# has written all the same, and must not hold back what is written after it, outside a transaction.
import dbm.sqlite3
import os
import shutil
import sqlite3
import tempfile


def t(f, *a, **k):
    try:
        print(repr(f(*a, **k)).split(" at 0x")[0][:200])
    except BaseException as e:
        print(type(e).__name__ + ":", e)


def seen_by_another(path, sql="select a from t order by a"):
    other = sqlite3.connect(path)
    try:
        return other.execute(sql).fetchall()
    finally:
        other.close()


d = tempfile.mkdtemp()
try:
    for autocommit in (True, sqlite3.LEGACY_TRANSACTION_CONTROL):
        for mode in ("wal", "delete", "truncate"):
            p = os.path.join(d, "%s-%s.db" % (mode, autocommit))
            c = sqlite3.connect(p, autocommit=autocommit, isolation_level=None)
            c.execute("pragma journal_mode = " + mode)
            c.execute("create table t(a)")
            c.execute("insert into t values (1)")
            print(mode, autocommit, seen_by_another(p))
            c.execute("insert into t values (2) returning a")
            print(seen_by_another(p))
            c.execute("insert into t values (3)")
            print(seen_by_another(p))
            c.execute("update t set a = a + 10 returning a")
            c.execute("delete from t where a = 11")
            print(seen_by_another(p))
            print(c.execute("insert into t values (4) returning a").fetchone(), seen_by_another(p))
            t(c.execute, "vacuum")
            c.execute("select a from t")
            c.execute("select a from t").fetchone()
            t(c.execute, "vacuum")
            print(seen_by_another(p))
            c.close()

    # A cursor that is held and reads stands in the way of VACUUM.
    p = os.path.join(d, "held.db")
    c = sqlite3.connect(p, autocommit=True)
    c.execute("create table t(a)")
    c.execute("insert into t values (1), (2), (3)")
    held = c.execute("select a from t")
    print(held.fetchone())
    t(c.execute, "vacuum")
    held.close()
    t(c.execute, "vacuum")
    c.close()

    # The rows of a statement that writes, however they are fetched.
    for autocommit in (True, False, sqlite3.LEGACY_TRANSACTION_CONTROL):
        c = sqlite3.connect(":memory:", autocommit=autocommit)
        c.execute("create table t(a integer primary key, b, c)")
        cur = c.cursor()
        print(autocommit, cur.execute("insert into t(b, c) values (?, ?), (?, ?), (?, ?) returning a, b, c", ("x", 1.5, None, b"\0y", 2**62, "")) is cur)
        print(cur.description, cur.rowcount, cur.lastrowid, c.in_transaction)
        print(cur.fetchone(), cur.rowcount)
        print(next(cur), cur.rowcount)
        print(cur.fetchone(), cur.rowcount)
        print(cur.fetchone(), cur.rowcount, cur.fetchall(), cur.fetchmany(3), c.total_changes)
        t(next, cur)
        print(cur.execute("update t set b = 'u' where a > 1 returning a").fetchall(), cur.rowcount)
        print(cur.execute("update t set b = 'v' returning a, b").fetchmany(2), cur.rowcount, cur.fetchmany(2), cur.rowcount)
        print(list(cur.execute("delete from t where a = 2 returning *")), cur.rowcount)
        print(cur.execute("delete from t where a = 99 returning *").fetchall(), cur.rowcount, cur.description)
        print(cur.execute("insert into t(b) values (1) returning a").rowcount, cur.execute("select count(*) from t").fetchall(), cur.rowcount)
        # Executed again, or closed, before the rows are read.
        cur.execute("insert into t(b) values (2), (3) returning a")
        print(cur.fetchone())
        print(cur.execute("select count(*) from t").fetchall())
        cur.execute("insert into t(b) values (4), (5) returning a")
        cur.close()
        t(cur.fetchone)
        print(c.execute("select count(*) from t").fetchall())
        # The same statement in two cursors at a time.
        one = c.execute("insert into t(b) values (6), (7) returning b")
        two = c.execute("insert into t(b) values (6), (7) returning b")
        print(one.fetchone(), two.fetchone(), one.fetchall(), two.fetchall(), one.rowcount, two.rowcount)
        # Factories and converters see the rows when they are fetched.
        cur = c.cursor()
        cur.execute("insert into t(b, c) values ('text', x'00ff') returning b, c, a is not null as yes")
        cur.row_factory = sqlite3.Row
        c.text_factory = bytes
        row = cur.fetchone()
        print(type(row).__name__, row.keys(), tuple(row))
        c.text_factory = str
        cur.row_factory = lambda cursor, row: (cursor is cur, [d[0] for d in cursor.description], row)
        print(cur.execute("insert into t(b) values ('w') returning b").fetchall())
        # Text that cannot be decoded: the error names the column, and the row stays.
        cur.row_factory = None
        cur.execute("insert into t(b) values (cast(x'ff41' as text)), ('good') returning b as name")
        t(cur.fetchone)
        t(cur.fetchone)
        c.text_factory = bytes
        print(cur.fetchall())
        c.text_factory = str
        # A failure is the failure of execute().
        t(cur.execute, "insert into t(a) values (1), (1) returning a")
        print(cur.fetchall(), cur.rowcount)
        t(cur.executemany, "insert into t(b) values (?) returning b", [(1,)])
        print(cur.fetchall(), cur.rowcount)
        t(cur.executemany, "insert into t(b) values (?) returning b", [(1,), (2,)])
        print(cur.fetchall(), cur.rowcount)
        t(cur.executemany, "insert into t(b) values (?) returning b", [])
        print(cur.fetchall(), cur.rowcount)
        if c.in_transaction:
            c.commit()
        # After the connection is closed.
        cur.execute("insert into t(b) values (8), (9) returning b")
        print(cur.fetchone())
        c.close()
        t(cur.fetchone)

    # With converters.
    sqlite3.register_converter("shout", lambda b: b.decode().upper() + "!")
    c = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES, autocommit=True)
    c.execute("create table t(a shout, b integer)")
    print(c.execute("insert into t values ('quiet', 5), (7, 8), (null, 2.5) returning a, b, b as 'c [shout]'").fetchall())
    c.close()

    # PRAGMAs that count as writing.
    p = os.path.join(d, "pragma.db")
    c = sqlite3.connect(p, autocommit=True)
    for sql in ("pragma journal_mode = wal", "pragma journal_mode", "pragma wal_checkpoint", "pragma user_version = 5", "pragma user_version",
                "pragma journal_mode = delete", "pragma incremental_vacuum", "pragma optimize", "pragma integrity_check", "explain insert into x values (1)"):
        cur = c.cursor()
        try:
            cur.execute(sql)
            print(sql, "|", cur.description and [x[0] for x in cur.description], cur.rowcount, cur.fetchall()[:2], cur.rowcount)
        except sqlite3.Error as e:
            print(sql, "|", type(e).__name__, e)
    c.close()

    # dbm.sqlite3 does all of that.
    p = os.path.join(d, "dbm.db")
    db = dbm.sqlite3.open(p, "c")
    db["key"] = "value"
    db["key"] = "other"
    print(seen_by_another(p, "select key, value from Dict"))
    with dbm.sqlite3.open(p, "c") as second:
        print(second[b"key"])
    db["new"] = "x" * 10000
    del db["new"]
    print(seen_by_another(p, "select key from Dict"))
    t(db.reorganize)
    print(db.keys())
    db.close()
finally:
    shutil.rmtree(d)
