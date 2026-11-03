import sqlite3, os
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
con = sqlite3.connect(':memory:'); con.execute('create table t(id integer primary key, b blob, s text)'); con.execute("insert into t values (1, zeroblob(20), 'text'), (2, x'00010203040506070809', null), (3, null, null), (4, x'', '')")
b = con.blobopen('t', 'b', 2); print(type(b), len(b), b.tell(), b.read(3), b.tell(), b.read(), b.tell(), b.read(), b.read(5))
b.seek(0); print(b.read(-1), b.seek(2), b.read(0), b.read(2), b.seek(-3, os.SEEK_END), b.read(), b.seek(1), b.seek(2, os.SEEK_CUR), b.tell(), b.seek(10), b.read(), b.seek(0, 2), b.tell())
t(b.seek, 11); t(b.seek, -1); t(b.seek, 1, 2); t(b.seek, -11, 2); t(b.seek, 0, 3); t(b.seek, 0, -1); t(b.seek, 2**31 - 1, 1); t(b.seek, 2**31 - 1, 2); t(b.seek, 2**31); t(b.seek, 'a'); t(b.seek); t(b.seek, 0, 0, 0); t(b.seek, offset=0); t(b.read, 'a'); t(b.read, 1, 2); t(b.read, 2**31); t(b.read, None); t(b.tell, 1)
print(b[0], b[9], b[-1], b[-10], b[2:5], b[:], b[::2], b[1:8:3], b[5:2], b[100:], b[-3:], b[True])
t(lambda: b[10]); t(lambda: b[-11]); t(lambda: b['a']); t(lambda: b[1.0]); t(lambda: b[None]); t(lambda: b[::-1]); t(lambda: b[5:1:-1]); t(lambda: b[2**70]); t(lambda: b[::0]); t(lambda: b[1:2, 3])
b.seek(0); b.write(b'AB'); print(b.tell(), b[:]); b.write(bytearray(b'C')); b.write(memoryview(b'D')); b.write(b''); print(b.tell(), b[:])
b.seek(9); t(b.write, b'XY'); print(b.tell()); b.write(b'Z'); print(b.tell(), b[:]); t(b.write, b'!'); t(b.write, 'str'); t(b.write, 1); t(b.write); t(b.write, b'', b''); t(b.write, data=b'')
b[0] = 97; b[-1] = 122; b[1:3] = b'bc'; b[3:9:2] = b'XYZ'; b[5:5] = b''; print(b[:])
def s(k, v): b[k] = v
t(s, 0, 256); t(s, 0, -1); t(s, 0, 'a'); t(s, 0, b'a'); t(s, 0, 1.0); t(s, 0, 2**70); t(s, 10, 1); t(s, -11, 1); t(s, 'a', 1); t(s, slice(0, 2), b'abc'); t(s, slice(0, 2), b'a'); t(s, slice(0, 2), 'ab'); t(s, slice(0, 2), 5); t(s, slice(None, None, -1), b[:]); t(s, slice(5, 2), b''); t(s, slice(5, 2), b'x'); t(s, 0, True); t(s, None, 1)
def d(k): del b[k]
t(d, 0); t(d, slice(0, 1)); t(d, 'a')
print(con.execute('select b from t where id = 2').fetchone(), con.in_transaction)
t(iter, b); t(lambda: 1 in b); t(bytes, b); t(memoryview, b); t(hash, b) if False else None; t(lambda: b + b''); t(bool, b)
import weakref; w = weakref.ref(b); print(w() is b)
with con.blobopen('t', 'b', 1) as z:
    print(z.read() == bytes(20), len(z)); z[:5] = b'hello'; print(z.__enter__() is z)
t(z.read); t(z.write, b''); t(z.seek, 0); t(z.tell); t(len, z); t(lambda: z[0]); t(s.__call__ if False else (lambda: z.__setitem__(0, 1))); t(z.__enter__); t(z.__exit__, None, None, None); t(z.close); t(z.close)
t(z.__exit__); t(b.__exit__, 1, 2)
r = con.blobopen('t', 'b', 1, readonly=True); print(r.read(5)); t(r.write, b'x'); t(r.__setitem__, 0, 1); r.close()
x = con.blobopen('t', 's', 1); print(x.read()); x.close(); e = con.blobopen('t', 'b', 4); print(len(e), e.read(), e[:], bool(e)); t(lambda: e[0]); t(e.write, b'a'); e.close()
t(con.blobopen, 't', 'b', 3); t(con.blobopen, 't', 'b', 99); t(con.blobopen, 'nope', 'b', 1); t(con.blobopen, 't', 'nope', 1); t(con.blobopen, 't', 'id', 1); t(con.blobopen, 't', 'b', 1, name='nope'); t(con.blobopen, 't', 'b', 1, name='main')
t(con.blobopen); t(con.blobopen, 't', 'b'); t(con.blobopen, 1, 'b', 1); t(con.blobopen, 't', 2, 1); t(con.blobopen, 't', 'b', 'a'); t(con.blobopen, 't', 'b', 1.0); t(con.blobopen, 't', 'b', 2**63); t(con.blobopen, 't', 'b', 1, True); t(con.blobopen, 't', 'b', 1, name=1); t(con.blobopen, 't', 'b', rowid=1); t(con.blobopen, 't\0', 'b', 1); t(con.blobopen, 't', 'b', 1, nope=1)
t(sqlite3.Blob)
def sub():
    class X(sqlite3.Blob): pass
t(sub)
# The row changes under it
g = con.blobopen('t', 'b', 2); con.execute("update t set b = x'ffff' where id = 2"); t(g.read); t(len, g); t(lambda: g[0]); g.close()
try:
    g = con.blobopen('t', 'b', 2); con.execute('delete from t where id = 2'); g.read()
except sqlite3.OperationalError as ex: print(ex.sqlite_errorcode, ex.sqlite_errorname)
# Closing the connection closes them
h = con.blobopen('t', 'b', 1); i = con.blobopen('t', 'b', 1); con.close(); t(h.read); t(h.close); t(i.tell); t(len, i); t(b.read); t(con.blobopen, 't', 'b', 1)
import gc
c2 = sqlite3.connect(':memory:'); c2.execute('create table t(b)'); c2.execute('insert into t values (zeroblob(5))'); k = c2.blobopen('t', 'b', 1); del c2; gc.collect(); print(k.read()); del k; gc.collect()
