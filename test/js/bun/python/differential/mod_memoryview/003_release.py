def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
m = memoryview(b'abc')
print(m.release(), m.release())
for name in ('obj', 'nbytes', 'readonly', 'itemsize', 'format', 'ndim', 'shape', 'strides', 'suboffsets', 'c_contiguous', 'f_contiguous', 'contiguous'):
    t(lambda: getattr(m, name))
t(lambda: m.tobytes())
t(lambda: m.tolist())
t(lambda: m.hex())
t(lambda: m.toreadonly())
t(lambda: m.cast('b'))
t(lambda: m[0])
t(lambda: m[:])
t(lambda: m[()])
t(lambda: len(m))
t(lambda: iter(m))
t(lambda: list(m))
t(lambda: hash(m))
t(lambda: m.count(1))
t(lambda: m.index(1))
t(lambda: memoryview(m))
t(lambda: bytes(m))
t(lambda: bytearray(m))
t(lambda: m.__enter__())
t(lambda: m.__exit__(None, None, None))
t(lambda: m.__buffer__(0))
t(lambda: 1 in m)
t(lambda: m == m)
t(lambda: m != m)
t(lambda: m == b'abc')
t(lambda: m == memoryview(b'abc'))
t(lambda: memoryview(b'abc') == m)
t(lambda: b'abc' == m)
t(lambda: b'x' + m)
t(lambda: b''.join([m]))
def s(): m[0] = 1
t(s)
def d(): del m[0]
t(d)

b = bytearray(b'hello')
with memoryview(b) as m:
    print(m.tobytes())
    t(lambda: b.append(1))
    t(lambda: b.clear())
    t(lambda: b.extend(b'x'))
    t(lambda: b.pop())
    t(lambda: b.__init__(b'z'))
    b[0] = 72
    b[1:3] = b'EL'
    def grow(): b[1:3] = b'ELL'
    t(grow)
    def dl(): del b[0]
    t(dl)
    print(m.tobytes())
b.append(33)
print(b, m)if False else print(b)
t(lambda: m.tobytes())

# several views share one export
b = bytearray(b'hello')
m1 = memoryview(b)
m2 = m1[1:3]
m3 = memoryview(m1)
m4 = m2.cast('b')
m5 = m1.toreadonly()
m1.release()
t(lambda: b.append(1))
print(m2.tobytes(), m3.tobytes(), m4.tolist(), m5.readonly)
m2.release(); m3.release(); m4.release()
t(lambda: b.append(1))
m5.release()
t(lambda: b.append(1))
print(b)

# the iterator notices
m = memoryview(b'abc')
it = iter(m)
print(next(it))
m.release()
t(lambda: next(it))
t(lambda: next(it))

# exit with an exception
b = bytearray(b'xy')
try:
    with memoryview(b) as m:
        raise KeyError('k')
except KeyError as e:
    print('caught', e)
b.append(1)
print(b)
t(lambda: memoryview(b).__exit__())
t(lambda: memoryview(b).__exit__(1, 2, 3, 4, 5))
t(lambda: memoryview(b).release(1))
