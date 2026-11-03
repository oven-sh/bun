import re
import sqlite3
import threading


def in_thread(function):
    out = []

    def run():
        try:
            out.append(("returned", type(function()).__name__))
        except Exception as e:
            out.append((type(e).__name__, re.sub(r"\d+", "N", str(e))))
    thread = threading.Thread(target=run)
    thread.start()
    thread.join()
    return out[0]


def calls(con, cur, blob):
    return dict(
        cursor=lambda: con.cursor(), commit=lambda: con.commit(), rollback=lambda: con.rollback(),
        set_trace_callback=lambda: con.set_trace_callback(None), set_authorizer=lambda: con.set_authorizer(None),
        set_progress_handler=lambda: con.set_progress_handler(None, 1), create_collation=lambda: con.create_collation("foo", None),
        create_function=lambda: con.create_function("f", 0, None), create_aggregate=lambda: con.create_aggregate("g", 0, None),
        create_window_function=lambda: con.create_window_function("w", 0, None),
        setlimit=lambda: con.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, -1), getlimit=lambda: con.getlimit(sqlite3.SQLITE_LIMIT_LENGTH),
        getconfig=lambda: con.getconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE), setconfig=lambda: con.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, False),
        blobopen=lambda: con.blobopen("test", "b", 1), serialize=lambda: con.serialize(), execute=lambda: con.execute("select 1"),
        executemany=lambda: con.executemany("insert into test(name) values (?)", []), executescript=lambda: con.executescript("select 1"),
        iterdump=lambda: list(con.iterdump()), interrupt=lambda: con.interrupt(),
        in_transaction=lambda: con.in_transaction, total_changes=lambda: con.total_changes, isolation_level=lambda: con.isolation_level,
        set_isolation_level_none=lambda: setattr(con, "isolation_level", None), set_isolation_level=lambda: setattr(con, "isolation_level", "DEFERRED"),
        autocommit=lambda: con.autocommit, set_autocommit=lambda: setattr(con, "autocommit", sqlite3.LEGACY_TRANSACTION_CONTROL),
        enter=lambda: con.__enter__(), exit=lambda: con.__exit__(None, None, None), call=lambda: con("select 1"),
        row_factory=lambda: con.row_factory, text_factory=lambda: con.text_factory,
        cur_execute=lambda: cur.execute("select name from test"), cur_executemany=lambda: cur.executemany("insert into test(name) values (?)", []),
        cur_executescript=lambda: cur.executescript("select 1"), fetchone=lambda: cur.fetchone(), fetchmany=lambda: cur.fetchmany(),
        fetchall=lambda: cur.fetchall(), next=lambda: next(cur), iter=lambda: iter(cur), setinputsizes=lambda: cur.setinputsizes(1),
        setoutputsize=lambda: cur.setoutputsize(1), rowcount=lambda: cur.rowcount, description=lambda: cur.description, lastrowid=lambda: cur.lastrowid,
        connection=lambda: cur.connection, arraysize=lambda: cur.arraysize,
        blob_read=lambda: blob.read(), blob_write=lambda: blob.write(b"a"), blob_seek=lambda: blob.seek(0), blob_tell=lambda: blob.tell(),
        blob_len=lambda: len(blob), blob_item=lambda: blob[0], blob_enter=lambda: blob.__enter__(), blob_close=lambda: blob.close(),
        cur_close=lambda: cur.close(), close=lambda: con.close(),
    )


for check in (True, False, 1, 0):
    con = sqlite3.connect(":memory:", check_same_thread=check)
    cur = con.cursor()
    cur.execute("create table test(name text, b blob)")
    cur.execute("insert into test values('blob', zeroblob(1))")
    con.commit()
    cur.execute("select name from test")
    blob = con.blobopen("test", "b", 1)
    print("check_same_thread =", check)
    if check:
        print("  ", "backup", *in_thread(lambda: con.backup(sqlite3.connect(":memory:"))))
    for name, function in calls(con, cur, blob).items():
        print("  ", name, *in_thread(function))
    try:
        blob.close()
        cur.close()
        con.close()
        print("closed")
    except Exception as e:
        print(type(e).__name__, e)

# A connection made in a thread, used in the main one.
made = []
thread = threading.Thread(target=lambda: made.append(sqlite3.connect(":memory:")))
thread.start()
thread.join()
try:
    made[0].execute("select 1")
except Exception as e:
    print(type(e).__name__, re.sub(r"\d+", "N", str(e)))
# Opening it anew makes it this thread's.
made[0].__init__(":memory:")
print(made[0].execute("select 1").fetchall())
made[0].close()
