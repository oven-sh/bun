import mmap, os, tempfile, gc, weakref, sys
def t(f):
    try: print(repr(f()))
    except BaseException as x: print(type(x).__name__ + ':', x)
print(sorted(n for n in dir(mmap) if not n.startswith('__')))
print([(n, getattr(mmap, n)) for n in sorted(dir(mmap)) if isinstance(getattr(mmap, n), int)])
print(sorted(n for n in dir(mmap.mmap) if not n.startswith('__')), mmap.mmap.__mro__, mmap.error is OSError)
m = mmap.mmap(-1, 16)
print(repr(m), len(m), m.size(), m.tell(), m.closed, m[:], m[0], m[-1], bytes(m) == bytes(16))
print(m.write(b'hello'), m.tell(), m[:8], m.write_byte(33), m.tell(), m[:8], m.seek(0), m.read(3), m.read_byte(), m.tell(), m.read(), m.tell(), m.read(5), m.read_byte.__name__)
t(m.read_byte); t(lambda: m.write_byte(1)); t(lambda: m.write(b'x')); print(m.write(b''))
print(m.seek(0), m.seek(2, 1), m.seek(-1, 2), m.seek(0, 2), m.seek(16)); t(lambda: m.seek(17)); t(lambda: m.seek(-1)); t(lambda: m.seek(0, 3)); t(lambda: m.seek(1, 2)); t(lambda: m.seek(-17, 2)); t(lambda: m.seek('x')); t(lambda: m.seek(2**70)); t(lambda: m.seek(2**63 - 1, 1))
m.seek(0); m.write(b'ab\ncd\n\nef'); m.seek(0); print(m.readline(), m.readline(), m.readline(), m.readline()[:3], m.readline(), m.tell())
m[0] = 65; m[-1] = 90; print(m[0], m[15], m[:3]); m[1:3] = b'XY'; print(m[:4]); m[0:6:2] = b'123'; print(m[:6]); m[::-1] = bytes(range(16)); print(m[:]); print(m[2:10:3], m[10:2:-3], m[5:5], m[20:30], m[-3:], m[::5])
t(lambda: m[16]); t(lambda: m[-17]); t(lambda: m['a']); t(lambda: m[1.5]); t(lambda: m[2**70]); t(lambda: m[::0])
def s(k, v): m[k] = v
t(lambda: s(16, 1)); t(lambda: s(0, 256)); t(lambda: s(0, -1)); t(lambda: s(0, b'a')); t(lambda: s(0, 'a')); t(lambda: s(0, 1.5)); t(lambda: s('a', 1)); t(lambda: s(slice(0, 2), b'abc')); t(lambda: s(slice(0, 2), 'ab')); t(lambda: s(slice(0, 2), 5)); t(lambda: s(0, 2**70)); t(lambda: s(slice(0, 0), b''))
def d(k): del m[k]
t(lambda: d(0)); t(lambda: d(slice(0, 2))); t(lambda: d('a'))
m[:] = b'abcabcabcabcabca'
print(m.seek(0), m.find(b'abc'), m.find(b'abc', 1), m.find(b'abc', 1, 5), m.find(b'abc', 1, 6), m.find(b'zzz'), m.find(b''), m.find(b'', 16), m.find(b'', 17), m.find(b'b', -1), m.find(b'a', -100), m.find(b'a', 5, -5), m.find(bytearray(b'ca')), m.find(b'c', None, 2), m.find(b'c', None), m.find(b'c', 3, None))
print(m.rfind(b'abc'), m.rfind(b'abc', 0, 11), m.rfind(b'abc', 0, 12), m.rfind(b'zzz'), m.rfind(b''), m.rfind(b'', 3, 7), m.rfind(b'a', -2), m.rfind(b'b'), m.rfind(b'abc', 10))
m.seek(4); print(m.find(b'abc'), m.rfind(b'abc'), m.find(b'a'), m.tell())
t(lambda: m.find('a')); t(lambda: m.find(1)); t(lambda: m.find()); t(lambda: m.find(b'a', 'x')); t(lambda: m.find(b'a', 1, 'x')); t(lambda: m.find(b'a', 1.5)); t(lambda: m.find(b'a', 1, 2, 3)); t(lambda: m.find(view=b'a'))
print(m.move(0, 3, 4), m[:8], m.move(1, 0, 15), m[:], m.move(0, 0, 0), m.move(16, 16, 0)); t(lambda: m.move(0, 0, 17)); t(lambda: m.move(-1, 0, 1)); t(lambda: m.move(0, -1, 1)); t(lambda: m.move(0, 0, -1)); t(lambda: m.move(16, 0, 1)); t(lambda: m.move(0, 1)); t(lambda: m.move('a', 0, 1))
t(lambda: m.read('x')); t(lambda: m.read(1.5)); m.seek(0); print(m.read(None)[:3], m.seek(0), m.read(-1)[:3], m.seek(0), m.read(-5)[:3], m.seek(0), m.read(2**70 if False else 2**62)[:3]); t(lambda: m.read(2**70)); t(lambda: m.read(1, 2))
t(lambda: m.write('x')); t(lambda: m.write(1)); t(lambda: m.write_byte(256)); t(lambda: m.write_byte(-1)); t(lambda: m.write_byte('x')); t(lambda: m.write_byte(b'x')); t(lambda: m.write_byte()); t(lambda: m.write_byte(2**70))
print(list(m)[:3], b'a' in m, b'z' in m, 97 in m, [x for x in m][-1], type(iter(m)).__name__)
print(m.flush(), m.flush(0), m.flush(0, 16), m.flush(0, 0), m.seekable()); t(lambda: m.flush(17)); t(lambda: m.flush(0, 17)); t(lambda: m.flush(-1)); t(lambda: m.flush(0, -2)); t(lambda: m.flush(1)); t(lambda: m.flush(0, 16, 0)); print(m.flush(0, 16, flags=mmap.MS_ASYNC))
print(m.madvise(mmap.MADV_NORMAL), m.madvise(mmap.MADV_WILLNEED, 0), m.madvise(mmap.MADV_NORMAL, 0, 100), m.madvise(mmap.MADV_NORMAL, 0, None)); t(lambda: m.madvise(0, 16)); t(lambda: m.madvise(0, -1)); t(lambda: m.madvise(0, 0, -1)); t(lambda: m.madvise(0, 1, 2**63 - 1)); t(lambda: m.madvise(9999)); t(lambda: m.madvise()); t(lambda: m.madvise('x'))
r = weakref.ref(m); print(r() is m); t(lambda: hash(m) == hash(m)); t(lambda: m == m); t(lambda: m + m); t(lambda: m * 2); t(lambda: m.x); 
def sx(): m.x = 1
t(sx)
with m as mm: print(mm is m, m.closed)
print(m.closed, repr(m)); print(m.close())
for f in [m.read, m.read_byte, m.readline, m.tell, m.size, lambda: m.seek(0), lambda: m.write(b''), lambda: m.write_byte(0), lambda: m.find(b''), lambda: m.rfind(b''), lambda: m.move(0, 0, 0), m.flush, lambda: m.madvise(0), lambda: len(m), lambda: m[0], lambda: m[:], lambda: s(0, 0), lambda: s(slice(0, 0), b''),
          m.__enter__, lambda: memoryview(m), lambda: bytes(m), lambda: m.resize(1), lambda: list(m), m.seekable, lambda: m.__exit__(None, None, None)]: t(f)
# arguments
t(lambda: mmap.mmap(-1, 0)); t(lambda: mmap.mmap(-1, -1)); t(lambda: mmap.mmap(-1, 10, offset=-1)); t(lambda: mmap.mmap('x', 10)); t(lambda: mmap.mmap(-1, 'x')); t(lambda: mmap.mmap(-1, 2**70)); t(lambda: mmap.mmap(2**40, 10))
t(lambda: mmap.mmap(-1, 10, access=9)); t(lambda: mmap.mmap(-1, 10, access=-1)); t(lambda: mmap.mmap(-1, 10, mmap.MAP_PRIVATE, access=mmap.ACCESS_READ)); t(lambda: mmap.mmap(-1, 10, prot=mmap.PROT_READ, access=mmap.ACCESS_WRITE));
t(lambda: mmap.mmap(9999, 10)); t(lambda: mmap.mmap(-1, 10, 0)); t(lambda: mmap.mmap(-1, 10, offset=1)); t(lambda: mmap.mmap(fileno=-1, length=10, flags=mmap.MAP_PRIVATE, prot=mmap.PROT_READ, access=0, offset=0, trackfd=True))
for kw in [dict(access=mmap.ACCESS_READ), dict(access=mmap.ACCESS_WRITE), dict(access=mmap.ACCESS_COPY), dict(access=mmap.ACCESS_DEFAULT), dict(prot=mmap.PROT_READ), dict(prot=mmap.PROT_WRITE), dict(flags=mmap.MAP_PRIVATE), dict(prot=mmap.PROT_READ | mmap.PROT_EXEC)]:
    x = mmap.mmap(-1, 8, **kw); print(repr(x)); t(lambda: x.write(b'a')); t(lambda: memoryview(x).readonly); x.close()
class M(mmap.mmap):
    def extra(self): return len(self) * 2
x = M(-1, 4); x.attr = 1; print(repr(x), x.extra(), x.attr, isinstance(x, mmap.mmap)); x.close(); print(repr(x))
