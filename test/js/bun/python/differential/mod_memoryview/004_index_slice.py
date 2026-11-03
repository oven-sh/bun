def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
def attrs(m):
    return (m.tobytes(), m.nbytes, m.readonly, m.itemsize, m.format, m.ndim, m.shape, m.strides, m.c_contiguous, m.f_contiguous, m.contiguous, len(m))
class I:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
src = bytes(range(10, 30))
m = memoryview(src)
for i in (0, 1, 19, -1, -20, True, False, I(3), I(-3)):
    t(lambda: m[i])
for i in (20, -21, 1 << 70, -(1 << 70), I(20), 1.0, 'a', None, b'a', [1], {}, (0, 0), (), (slice(None),), (slice(None), slice(None)), (0, slice(None)), ..., (...,), (1.0,), ('a',)):
    t(lambda: m[i])
t(lambda: m[(3,)])
t(lambda: m[(I(3),)])
t(lambda: m[(20,)])
t(lambda: m[(-21,)])
for s in (slice(None), slice(0), slice(1, 5), slice(5, 1), slice(-3, None), slice(None, None, 2), slice(None, None, -1), slice(1, 15, 3), slice(15, 1, -3), slice(100, 200), slice(-100, 100), slice(0, 0, 2), slice(3, 4, 5), slice(I(2), I(9), I(2)), slice(None, None, 1 << 70), slice(None, None, -(1 << 70)), slice(1 << 70, None), slice(19, None, 7)):
    t(lambda: attrs(m[s]))
    t(lambda: m[s].tobytes() == src[s])
    t(lambda: m[s].tolist() == list(src[s]))
    t(lambda: list(m[s]) == list(src[s]))
t(lambda: m[::0])
t(lambda: m['a':])
t(lambda: m[1.0:])
t(lambda: m[::'x'])
# slices of slices
a = m[2:18:2]
print(attrs(a))
print(attrs(a[::-1]), attrs(a[1:5]), attrs(a[::2]), attrs(a[::-2][1:]), attrs(a[5:2:-1]))
print(a[::-1][0], a[::-1][-1], a[::2][1], a[-1], a[0])
t(lambda: a[8])
t(lambda: a[-9])
print(a.obj is src, a[::-1].obj is src)
for step in range(-4, 5):
    if step:
        for start in (None, 0, 3, -3, 25):
            for stop in (None, 0, 7, -2, 25):
                x = m[start:stop:step]
                assert x.tobytes() == src[start:stop:step], (start, stop, step)
                assert x[::-1].tobytes() == src[start:stop:step][::-1]
                assert x[1::2].tolist() == list(src[start:stop:step][1::2])
                assert bytes(x) == src[start:stop:step] and bytearray(x) == src[start:stop:step]
print('ok')
# what needs the items to follow one another
n = m[::2]
t(lambda: b'x' + n)
t(lambda: b''.join([n]))
t(lambda: b'abc'.find(n))
t(lambda: bytearray(b'x').extend(n))
t(lambda: n.cast('b'))
t(lambda: int.from_bytes(n, 'big') == int.from_bytes(src[::2], 'big'))
t(lambda: n.hex() == src[::2].hex())
t(lambda: hash(n) == hash(src[::2]))
t(lambda: n == src[::2])
t(lambda: src[::2] == n)
t(lambda: bytearray(src[::2]) == n)
t(lambda: memoryview(n).strides)
t(lambda: n.toreadonly().strides)
t(lambda: m[::-1].c_contiguous)
t(lambda: m[5:6:-1].c_contiguous)
t(lambda: m[5:6:3].c_contiguous)
t(lambda: m[5:5:3].c_contiguous)
