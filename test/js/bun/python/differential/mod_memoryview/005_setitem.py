def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
class I:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
def st(m, k, v):
    def f():
        m[k] = v
        return m.tobytes()
    t(f)
def dl(m, k):
    def f():
        del m[k]
    t(f)
r = memoryview(b'abc')
st(r, 0, 1); st(r, slice(0, 1), b'x'); st(r, 'a', 1); st(r, 10, 1); dl(r, 0); dl(r, slice(None))
b = bytearray(b'0123456789')
m = memoryview(b)
for k, v in ((0, 65), (-1, 66), (I(1), I(67)), (2, True), (9, 255), (9, 0)):
    st(m, k, v)
for k, v in ((0, 256), (0, -1), (0, 1 << 70), (0, 1.0), (0, 'a'), (0, b'a'), (0, None), (10, 1), (-11, 1), (1 << 70, 1), (1.0, 1), ('a', 1), (None, 1), ((0, 0), 1), ((), 1), (..., 1), ((slice(None),), b'x'), ((0,), 70), ((I(1),), 71), ((10,), 1)):
    st(m, k, v)
dl(m, 0); dl(m, slice(None)); dl(m, 'a')
print(b)
for k, v in ((slice(0, 3), b'abc'), (slice(0, 3), bytearray(b'ABC')), (slice(0, 3), memoryview(b'xyz')), (slice(None, None, 2), b'.....'), (slice(None, None, -1), b'0123456789'), (slice(8, 2, -2), b'XYZ'), (slice(3, 3), b''), (slice(5, 2), b''), (slice(0, 4), memoryview(b'a-b-c-d-')[::2]), (slice(0, 4), memoryview(b'abcd')[::-1])):
    st(m, k, v)
for k, v in ((slice(0, 3), b'ab'), (slice(0, 3), b'abcd'), (slice(0, 3), b''), (slice(0, 3), 1), (slice(0, 3), 'abc'), (slice(0, 3), [1, 2, 3]), (slice(0, 3), None), (slice(0, 2), memoryview(b'abcd').cast('h')), (slice(0, 3), memoryview(b'abc').cast('b')), (slice(0, 3), memoryview(b'abc').cast('c')), (slice(0, 3), memoryview(b'abc').cast('@B')), (slice(0, 4), memoryview(b'abcd').cast('B', (2, 2))), (slice(0, 0, 0), b''), (slice('a'), b'')):
    st(m, k, v)
# overlapping
b = bytearray(b'0123456789'); m = memoryview(b)
m[0:5] = m[5:10]; print(b)
b[:] = b'0123456789'; m[1:6] = m[0:5]; print(b)
b[:] = b'0123456789'; m[0:5] = m[1:6]; print(b)
b[:] = b'0123456789'; m[:] = m[::-1]; print(b)
b[:] = b'0123456789'; m[::2] = m[1::2]; print(b)
b[:] = b'0123456789'; m[0:5] = m[::2]; print(b)
b[:] = b'0123456789'; m[::2] = m[0:5]; print(b)
b[:] = b'0123456789'; m[::-1] = m; print(b)
b[:] = b'0123456789'; m[2:8][::-1] = m[3:9]; print(b)
b[:] = b'0123456789'; m[:] = b; print(b)
# views of views write through
b = bytearray(b'0123456789'); m = memoryview(b)
s = m[2:8][::2]
s[0] = 65; s[-1] = 66; s[1:2] = b'z'
print(b, s.tobytes(), m.tobytes())
ro = m.toreadonly()
st(ro, 0, 1)
print(ro.readonly, m.readonly, ro[1:].readonly, memoryview(ro).readonly, ro.cast('b').readonly)
b[0] = 88
print(ro[0], m[0])

# the value releases the view
b = bytearray(b'abc')
m = memoryview(b)
class Evil:
    def __index__(self):
        m.release()
        return 65
st(m, 0, Evil())
print(b)
m = memoryview(b)
st(m, Evil(), 65)
m = memoryview(b)
st(m, slice(Evil(), None), b'')
m = memoryview(b)
t(lambda: m[Evil()])
m = memoryview(b)
t(lambda: m[Evil():].tobytes())
m = memoryview(b)
t(lambda: m[(Evil(),)])
b.append(1); print(b)
