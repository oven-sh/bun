def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
def attrs(m):
    return (m.nbytes, m.readonly, m.itemsize, m.format, m.ndim, m.shape, m.strides, m.suboffsets, m.c_contiguous, m.f_contiguous, m.contiguous)
class I:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
data = bytes(range(24))
for shape in ((24,), [24], (2, 12), [4, 6], (2, 3, 4), (1, 24), (24, 1), (1, 1, 24, 1), (2, 2, 2, 3), (True, 24)):
    m = memoryview(data).cast('B', shape)
    print(attrs(m), len(m), m.tolist(), m.tobytes() == data, m.tobytes('F'), m.tobytes('A') == data, m.hex() == data.hex())
for shape in ((2, 3), [3, 2], (6,), (1, 6), (2, 1, 3)):
    m = memoryview(data).cast('i', shape)
    print(attrs(m), len(m), m.tolist(), m.tobytes('F').hex())
for shape in ((), []):
    for f, n in (('B', 1), ('i', 4), ('d', 8), ('Zd', 16), ('c', 1), ('?', 1)):
        m = memoryview(bytes(range(65, 65 + n))).cast(f, shape)
        print(attrs(m), m.tolist(), m[()], m[...] is m, m.tobytes(), m.hex(), m == m, bytes(m))
z = memoryview(b'A').cast('B', ())
t(lambda: len(z)); t(lambda: z[0]); t(lambda: z[:]); t(lambda: iter(z)); t(lambda: list(z)); t(lambda: z[(0,)]); t(lambda: z.index(65)); t(lambda: z.count(65)); t(lambda: z['a']); t(lambda: z[None]); t(lambda: hash(z) == hash(b'A')); t(lambda: z.cast('b').shape); t(lambda: z.cast('b', ()).shape); t(lambda: z.cast('B', (1,)).shape); t(lambda: z.cast('B', (1, 1)).shape); t(lambda: memoryview(z).ndim); t(lambda: z.toreadonly().ndim); t(lambda: bool(z))
zb = bytearray(b'AAAA'); zw = memoryview(zb).cast('i', ())
def s1(): zw[()] = 5; return zb
def s2(): zw[...] = 6; return zb
def s3(): zw[0] = 7
def s4(): zw[:] = b'aaaa'
def s5(): del zw[()]
t(s1); t(s2); t(s3); t(s4); t(s5)
for shape in ((23,), (25,), (2, 11), (0,), (0, 24), (24, 0), (-1, -24), (-24,), (2, -12), (1.0, 24), ('a',), (None,), (I(24),), (2 ** 63, 1), (2 ** 62, 4), (2 ** 70,), (2 ** 32, 2 ** 32), 24, 'ab', None, {24}, range(24), iter([24]), (1,) * 64 + (24,), (1,) * 65):
    t(lambda: memoryview(data).cast('B', shape).shape)
t(lambda: memoryview(data).cast('B', (1,) * 63 + (24,)).ndim)
t(lambda: memoryview(data).cast('B', (1,) * 63 + (24,)).tolist() == eval('[' * 63 + repr(list(data)) + ']' * 63))
t(lambda: memoryview(data).cast('i', (24,)))
t(lambda: memoryview(data).cast('i', (2, 4)))
t(lambda: memoryview(b'').cast('B', (0,)))
t(lambda: memoryview(b'').cast('B', ()))
t(lambda: memoryview(b'').cast('B', (1,)))
t(lambda: memoryview(b'').cast('i').shape)
m = memoryview(data).cast('B', (2, 3, 4))
t(lambda: m.cast('B', (4, 6)))
t(lambda: m.cast('B', (24,)).shape)
t(lambda: m.cast('B').shape)
t(lambda: m.cast('i').shape)
t(lambda: m.cast('i', (6,)).shape)
t(lambda: m.cast('i', (2, 3)).shape)
t(lambda: m.cast('B', ()))
for k in ((0, 0, 0), (1, 2, 3), (-1, -1, -1), (-2, -3, -4), (I(1), I(0), True), (0, 0), (0,), 0, -1, (), (0, 0, 0, 0), (2, 0, 0), (0, 3, 0), (0, 0, 4), (0, 0, -5), (-3, 0, 0), (0, 2 ** 70, 0), (0, 'a', 0), (0, 1.0, 0), (0, None, 0), (slice(None), slice(None), slice(None)), (slice(None),), (0, slice(None), 0), (slice(None), 0, 0), ..., (..., 0), None, 'a', 1.0):
    t(lambda: m[k])
t(lambda: m[0:1].shape); t(lambda: attrs(m[1:])); t(lambda: m[1:].tolist()); t(lambda: attrs(m[::-1])); t(lambda: m[::-1].tolist()); t(lambda: m[::-1].tobytes()); t(lambda: m[::-1].tobytes('F')); t(lambda: m[::-1].tobytes('A')); t(lambda: m[::-1].hex()); t(lambda: attrs(m[5:])); t(lambda: m[5:].tolist()); t(lambda: m[::2].c_contiguous); t(lambda: bytes(m[::-1])); t(lambda: m[::-1][(0, 0, 0)]); t(lambda: m[::-1].cast('B')); t(lambda: m[1:].cast('B').tolist()); t(lambda: m[5:].cast('B'))
t(lambda: iter(m)); t(lambda: list(m)); t(lambda: 0 in m); t(lambda: m.index(0)); t(lambda: m.count(0)); t(lambda: len(m)); t(lambda: hash(m) == hash(data)); t(lambda: hash(m[::-1]) == hash(m[::-1].tobytes()))
w = bytearray(data); mw = memoryview(w).cast('B', (2, 3, 4))
def a1(): mw[(1, 2, 3)] = 200; mw[0, 0, 0] = 201; mw[-1, -1, -2] = 202; return w
def a2(): mw[0] = 1
def a3(): mw[(0, 0)] = 1
def a4(): mw[:] = mw
def a5(): mw[(slice(None), slice(None), slice(None))] = mw
def a6(): mw[(0, 0, 4)] = 1
def a7(): mw[(0, 0, 0, 0)] = 1
def a8(): mw[(0, 0, 0)] = 256
def a9(): mw[()] = 1
def a10(): mw[...] = 1
def a11(): mw['a'] = 1
def a12(): del mw[(0, 0, 0)]
for f in (a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12): t(f)
for o in ('C', 'F', 'A', None):
    t(lambda: m.tobytes(o)); t(lambda: m.tobytes(order=o) == m.tobytes(o))
for o in ('c', 'f', '', 'CF', 'X', 1, b'C', 'C\0', '\0'):
    t(lambda: m.tobytes(o))
t(lambda: m.tobytes('C', 'F')); t(lambda: m.tobytes(x=1))
t(lambda: memoryview(data).tobytes('F') == data); t(lambda: memoryview(data)[::2].tobytes('F') == data[::2]); t(lambda: memoryview(data)[::2].tobytes('A') == data[::2])
