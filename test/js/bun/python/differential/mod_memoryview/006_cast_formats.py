def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
def attrs(m):
    return (m.nbytes, m.readonly, m.itemsize, m.format, m.ndim, m.shape, m.strides, m.suboffsets, m.c_contiguous, m.f_contiguous, m.contiguous)
data = bytes(range(1, 33)) + bytes(range(255, 223, -1))
FORMATS = ['c', 'b', 'B', 'h', 'H', 'i', 'I', 'l', 'L', 'q', 'Q', 'n', 'N', 'f', 'd', 'e', '?', 'P', 'Zf', 'Zd']
for f in FORMATS:
    for p in ('', '@'):
        m = memoryview(data).cast(p + f)
        print(p + f, attrs(m), len(m), m[0], m[-1], m.tolist()[:3], list(m)[-2:], m.tobytes() == data, m[1:3].tolist(), m[::-1][0] == m[-1] or m[-1] != m[-1])
for f in ('', '@', 'x', 's', 'p', 'u', 'w', 'Z', 'Zx', 'Zff', 'BB', '2B', '<B', '>i', '=i', '!i', 'B ', ' B', '@@B', 'F', 'D', 'é', '€', 'B\0', 'i\0i'):
    t(lambda: memoryview(data).cast(f).format)
for f in (1, None, b'B', ['B'], 1.5):
    t(lambda: memoryview(data).cast(f))
t(lambda: memoryview(data).cast())
t(lambda: memoryview(data).cast('B', (64,), 1))
t(lambda: memoryview(data).cast(format='h').format)
t(lambda: memoryview(data).cast(format='h', shape=[4, 8]).shape)
t(lambda: memoryview(data).cast(shape=[4, 8]))
t(lambda: memoryview(data).cast('h', x=1))
# between two formats that are not bytes
t(lambda: memoryview(data).cast('h').cast('i'))
t(lambda: memoryview(data).cast('h').cast('h').format)
t(lambda: memoryview(data).cast('h').cast('b').cast('i').format)
t(lambda: memoryview(data).cast('i').cast('c').format)
t(lambda: memoryview(data).cast('?').cast('i'))
t(lambda: memoryview(data).cast('?').cast('B').format)
t(lambda: memoryview(data).cast('b').cast('c').cast('B').cast('@b').format)
# lengths
for n in (0, 1, 2, 3, 4, 7, 8, 15, 16):
    for f in ('h', 'i', 'q', 'Zd', 'e'):
        t(lambda: (n, f, memoryview(bytes(n)).cast(f).shape))
# not contiguous
t(lambda: memoryview(data)[::2].cast('B'))
t(lambda: memoryview(data)[::-1].cast('B'))
t(lambda: memoryview(data)[3:4:2].cast('B').shape)
t(lambda: memoryview(data)[2:10].cast('i').tolist())
t(lambda: memoryview(data)[1:9].cast('q').tolist())
# writing through a cast
b = bytearray(16)
m = memoryview(b)
m.cast('i')[1] = -2
m.cast('H')[0] = 0xabcd
m.cast('d')[1] = 1.5
print(b, m.cast('i').tolist(), m.cast('d').tolist())
print(m.cast('i').obj is b, m.cast('i').readonly, memoryview(bytes(b)).cast('i').readonly)
