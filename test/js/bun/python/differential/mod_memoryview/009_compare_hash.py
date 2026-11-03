import math, struct
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
m = memoryview(b'abc')
for o in (b'abc', bytearray(b'abc'), memoryview(b'abc'), memoryview(bytearray(b'abc')), b'abd', b'ab', b'abcd', b'', 'abc', [97, 98, 99], (97, 98, 99), None, 1, m, m[:], m[::-1], m[::-1][::-1], memoryview(b'a-b-c-')[::2], memoryview(b'cba')[::-1]):
    print(m == o, m != o, o == m, o != m)
print(m.__eq__(b'abc'), m.__eq__('abc'), m.__ne__('abc'), m.__ne__(b'abc'), m.__lt__(m), m.__le__(m), m.__gt__(b'a'), m.__ge__(1))
for op in ('<', '<=', '>', '>='):
    t(lambda: eval('m %s m' % op)); t(lambda: eval('m %s b"abc"' % op)); t(lambda: eval('b"abc" %s m' % op)); t(lambda: eval('bytearray(b"abc") %s m' % op))
# by value, not by representation
def mv(fmt, *values):
    return memoryview(struct.pack('%d%s' % (len(values), fmt), *values)).cast(fmt)
FORMATS = 'bBhHiIlLqQnNefd'
for f in FORMATS:
    print(f, [mv(f, 1, 2, 3) == mv(g, 1, 2, 3) for g in FORMATS], [mv(f, 1, 2, 3) == mv(g, 1, 2, 4) for g in FORMATS])
print(mv('b', -1) == mv('B', 255), mv('b', -1) == mv('h', -1), mv('B', 255) == mv('h', 255), mv('i', -1) == mv('I', 2 ** 32 - 1), mv('q', -1) == mv('Q', 2 ** 64 - 1), mv('Q', 2 ** 64 - 1) == mv('d', 2.0 ** 64), mv('Q', 2 ** 63) == mv('d', 2.0 ** 63), mv('q', 2 ** 53 + 1) == mv('d', 2.0 ** 53))
print(mv('?', True, False) == mv('b', 1, 0), mv('?', True) == mv('d', 1.0), mv('?', True) == memoryview(b'\x02').cast('?'), mv('B', 97) == memoryview(b'a').cast('c'), memoryview(b'a').cast('c') == memoryview(b'a').cast('c'), memoryview(b'a').cast('c') == b'a', memoryview(b'a').cast('b') == b'a', memoryview(b'\xff').cast('b') == b'\xff')
print(mv('P', 5) == mv('Q', 5), mv('P', 5) == mv('P', 5), mv('f', 0.5) == mv('d', 0.5), mv('f', 0.1) == mv('d', 0.1), mv('e', 0.5) == mv('f', 0.5), mv('d', 0.0) == mv('d', -0.0), mv('f', 0.0) == mv('d', -0.0))
z1 = memoryview(struct.pack('2d', 1.0, 2.0)).cast('Zd'); z2 = memoryview(struct.pack('2f', 1.0, 2.0)).cast('Zf')
print(z1 == z1, z1 == z2, z2 == z1, z1 == memoryview(struct.pack('2d', 1.0, 2.0)).cast('Zd'), z1 == memoryview(struct.pack('2d', 1.0, 3.0)).cast('Zd'), z1.tolist(), z2.tolist(), memoryview(struct.pack('2d', 1.0, 0.0)).cast('Zd') == mv('d', 1.0), memoryview(struct.pack('2d', 1.0, 0.0)).cast('Zd') == mv('b', 1))
# NaN
for f in 'efd':
    n = mv(f, math.nan)
    print(f, n == n, n != n, n == mv(f, math.nan), n == mv('d', math.nan), n == n[:])
nz = memoryview(struct.pack('2d', math.nan, 0.0)).cast('Zd'); print(nz == nz, nz == nz[:])
i = mv('i', 1, 2); print(i == i, i == i[:], i != i)
p = mv('P', 1); print(p == p)
# shapes
d = bytes(range(12))
a = memoryview(d).cast('B', (3, 4)); b = memoryview(d).cast('B', (4, 3)); c = memoryview(d).cast('B', (3, 4)); e = memoryview(d)
print(a == b, a == c, a == e, a == d, e == d, a == a, a[::-1] == c[::-1], a[::-1] == c, a[1:] == c[1:], a[1:] == memoryview(d[4:]).cast('B', (2, 4)), a[3:] == b[4:], a[3:] == memoryview(b'').cast('B'), a[3:].shape, b[4:].shape, a[3:] == c[3:])
s0 = memoryview(b'A').cast('B', ()); print(s0 == s0, s0 == memoryview(b'A').cast('B', ()), s0 == memoryview(b'B').cast('B', ()), s0 == b'A', s0 == memoryview(b'A'), s0 == memoryview(b'A\0\0\0').cast('i', ()))
print(memoryview(d).cast('h') == memoryview(d).cast('H'), memoryview(d).cast('h', (2, 3)) == memoryview(d).cast('H', (2, 3)), memoryview(d).cast('h', (2, 3)) == memoryview(d).cast('H', (3, 2)))
# hash
for x in (b'', b'a', b'abc', bytes(range(256))):
    print(hash(memoryview(x)) == hash(x), hash(memoryview(x)[::-1]) == hash(x[::-1]), hash(memoryview(x)[::2]) == hash(x[::2]), hash(memoryview(x).cast('b')) == hash(x), hash(memoryview(x).cast('c')) == hash(x), hash(memoryview(x).cast('@B')) == hash(x))
t(lambda: hash(memoryview(bytearray(b'abc'))))
t(lambda: hash(memoryview(bytearray(b'abc')).toreadonly()))
t(lambda: hash(memoryview(b'abcd').cast('h')))
t(lambda: hash(memoryview(b'abcd').cast('?')))
t(lambda: hash(memoryview(b'abcd').cast('i', ())))
t(lambda: hash(memoryview(b'abcd').cast('B', (2, 2))) == hash(b'abcd'))
t(lambda: {memoryview(b'ab'): 1}[b'ab'])
t(lambda: {b'ab': 1}[memoryview(b'ab')])
t(lambda: len({memoryview(b'ab'), b'ab', memoryview(b'ab')[:]}))
h = memoryview(b'abc'); hv = hash(h); h.release(); print(hash(h) == hv == hash(b'abc'))
h = memoryview(b'abc'); h.release(); t(lambda: hash(h))
