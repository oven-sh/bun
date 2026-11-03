import enum, sys
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
class F(enum.IntFlag):  # inspect.BufferFlags
    SIMPLE = 0x0
    WRITABLE = 0x1
    FORMAT = 0x4
    ND = 0x8
    STRIDES = 0x10 | ND
    C_CONTIGUOUS = 0x20 | STRIDES
    F_CONTIGUOUS = 0x40 | STRIDES
    ANY_CONTIGUOUS = 0x80 | STRIDES
    INDIRECT = 0x100 | STRIDES
    CONTIG = ND | WRITABLE
    CONTIG_RO = ND
    STRIDED = STRIDES | WRITABLE
    STRIDED_RO = STRIDES
    RECORDS = STRIDES | WRITABLE | FORMAT
    RECORDS_RO = STRIDES | FORMAT
    FULL = INDIRECT | WRITABLE | FORMAT
    FULL_RO = INDIRECT | FORMAT
    READ = 0x100
    WRITE = 0x200
print([(f.name, int(f)) for f in F])
log = []
class A:
    def __init__(self, data): self.data = data
    def __buffer__(self, flags):
        log.append(('buffer', flags))
        return memoryview(self.data)
a = A(b'hello')
m = memoryview(a)
print(log, m.tobytes(), type(m.obj).__name__, m.obj is a, m.readonly, m.format, m.shape, bytes(a), bytearray(a), log)
t(lambda: type(m.obj)())
log.clear()
print(b'x' + a, b'-'.join([a, a]), b'hello' == bytearray(b'hello'), bytearray(b'hello') == a, a == bytearray(b'hello'), b'hello'.startswith(a), b'say hello'.find(a), int.from_bytes(a, 'big'), bytes(a).hex(), log)
t(lambda: a == b'hello'); t(lambda: memoryview(b'hello') == a); t(lambda: len(a)); t(lambda: hash(memoryview(a)) == hash(b'hello'))
for bad in (42, b'hello', None, bytearray(b'x'), [1]):
    class Bad:
        def __buffer__(self, flags): return bad
    t(lambda: memoryview(Bad())); t(lambda: bytes(Bad())); t(lambda: b'' + Bad()); t(lambda: b''.join([Bad()])); t(lambda: bytearray(b'a') == Bad())
class Arity:
    def __buffer__(self): return memoryview(b'x')
t(lambda: memoryview(Arity()))
class Raises:
    def __buffer__(self, flags): raise KeyError('nope')
t(lambda: memoryview(Raises())); t(lambda: bytes(Raises())); t(lambda: b'' + Raises()); t(lambda: bytearray(b'a') == Raises()); t(lambda: memoryview(b'a') == Raises()); t(lambda: b'abc'.find(Raises()))
class NoneBuffer:
    __buffer__ = None
t(lambda: memoryview(NoneBuffer()))
class Inst: pass
i = Inst(); i.__buffer__ = lambda flags: memoryview(b'x')
t(lambda: memoryview(i))
class Released:
    def __buffer__(self, flags):
        v = memoryview(b'abc'); v.release(); return v
t(lambda: memoryview(Released()))

# __release_buffer__
class W:
    def __init__(self):
        self.held = False; self.ba = bytearray(b'hello'); self.mv = None
    def __buffer__(self, flags):
        if self.held: raise TypeError('already held')
        self.held = True
        self.mv = memoryview(self.ba)
        return self.mv
    def __release_buffer__(self, buffer):
        print('release', buffer is self.mv, buffer.tobytes())
        self.held = False
w = W()
with memoryview(w) as m:
    print(w.held, m.tobytes(), m.readonly)
    t(lambda: memoryview(w))
    t(lambda: w.mv.release())
    m[0] = 72
    s = m[1:3]
print(w.held, w.ba)
s.release()
print(w.held)
print(bytes(w), w.held)
w.mv.release(); w.ba.append(33); print(w.ba)

# flags
class P:
    def __init__(self, data, mutable): self._data = bytearray(data); self._mutable = mutable
    def __buffer__(self, flags):
        print('flags', flags, F(flags))
        if flags & F.WRITABLE:
            if not self._mutable: raise RuntimeError('not mutable')
            return memoryview(self._data)
        return memoryview(bytes(self._data))
mu = P(b'hello', True); im = P(b'hello', False)
with memoryview._from_flags(mu, F.WRITABLE) as mv:
    mv[0] = 120; print(mv.tobytes(), mv.readonly, mv.format, mv.shape, mv.strides)
with memoryview._from_flags(mu, F.SIMPLE) as mv:
    print(mv.tobytes(), mv.readonly)
t(lambda: memoryview._from_flags(im, F.WRITABLE))
t(lambda: memoryview(im).readonly)
for fl in (F.SIMPLE, F.WRITABLE, F.FORMAT, F.ND, F.STRIDES, F.C_CONTIGUOUS, F.F_CONTIGUOUS, F.ANY_CONTIGUOUS, F.INDIRECT, F.CONTIG, F.CONTIG_RO, F.STRIDED, F.STRIDED_RO, F.RECORDS, F.RECORDS_RO, F.FULL, F.FULL_RO, F.READ, F.WRITE):
    for src in (b'abcd', bytearray(b'abcd')):
        def f():
            v = memoryview._from_flags(src, fl)
            return (fl.name, type(src).__name__, v.readonly, v.format, v.itemsize, v.ndim, v.shape, v.strides, v.obj is src)
        t(f) if fl not in (F.READ, F.WRITE) else print(fl.name)
t(lambda: memoryview._from_flags(b'a')); t(lambda: memoryview._from_flags(b'a', 'x')); t(lambda: memoryview._from_flags(b'a', 2 ** 40)); t(lambda: memoryview._from_flags(1, 0)); t(lambda: memoryview._from_flags(object=b'a', flags=0).tobytes()); t(lambda: memoryview._from_flags(memoryview(b'a'), F.WRITABLE).readonly)

# __buffer__ of the built-in types
ba = bytearray(b'hello')
mv = ba.__buffer__(0)
print(type(mv).__name__, mv.tobytes(), mv.obj is ba, mv.readonly, mv.format)
t(lambda: ba.append(1))
print(ba.__release_buffer__(mv))
t(lambda: mv.tobytes()); t(lambda: ba.__release_buffer__(mv)); ba.append(1); print(ba)
t(lambda: ba.__buffer__(sys.maxsize + 1)); t(lambda: ba.__buffer__(2 ** 31)); t(lambda: ba.__buffer__(-2 ** 31 - 1)); t(lambda: ba.__buffer__('a')); t(lambda: ba.__buffer__(1.0));
t(lambda: ba.__release_buffer__(1)); t(lambda: ba.__release_buffer__(memoryview(b'x'))); t(lambda: ba.__release_buffer__(memoryview(bytearray(b'x'))))
t(lambda: b'abc'.__buffer__(0).tobytes()); t(lambda: b'abc'.__buffer__(F.WRITABLE)); t(lambda: b'abc'.__buffer__(F.FULL_RO).obj); t(lambda: hasattr(b'', '__release_buffer__')); t(lambda: hasattr('', '__buffer__'))
v = memoryview(b'abcd')
v2 = v.__buffer__(F.FULL_RO)
print(v2.obj is v, v2.tobytes(), v2.format, v2.shape)
t(lambda: v.release())
v3 = v.__buffer__(0)
t(lambda: v.release())
print(v.__release_buffer__(v2)); t(lambda: v.release()); t(lambda: v2.tobytes()); v3.release(); t(lambda: v.release()); t(lambda: v.__buffer__(0))
h = memoryview(b'abcdefgh').cast('h')
for fl in (F.SIMPLE, F.FORMAT, F.ND, F.STRIDES, F.ND | F.FORMAT, F.FULL_RO, F.WRITABLE, F.C_CONTIGUOUS, F.F_CONTIGUOUS, F.ANY_CONTIGUOUS):
    def f():
        x = h.__buffer__(fl)
        return (int(fl), x.format, x.itemsize, x.ndim, x.shape, x.strides, x.nbytes, x.tolist())
    t(f)
for name, x in (('rev', memoryview(b'abcdefgh')[::-1]), ('2d', memoryview(b'abcdefgh').cast('B', (2, 4))), ('2drev', memoryview(b'abcdefgh').cast('B', (2, 4))[::-1]), ('0d', memoryview(b'a').cast('B', ()))):
    for fl in (F.SIMPLE, F.ND, F.STRIDES, F.FULL_RO, F.C_CONTIGUOUS, F.F_CONTIGUOUS, F.ANY_CONTIGUOUS, F.CONTIG_RO):
        def f():
            y = x.__buffer__(fl)
            return (name, int(fl), y.format, y.itemsize, y.ndim, y.shape, y.strides, y.nbytes, y.tobytes())
        t(f)
