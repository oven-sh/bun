import math
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
class I:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
class F:
    def __init__(self, v): self.v = v
    def __float__(self): return self.v
class C:
    def __complex__(self): return 1+2j
class B:
    def __bool__(self): raise KeyError('no')
class BadI:
    def __index__(self): raise KeyError('idx')
class BadI2:
    def __index__(self): return 'x'
def st(fmt, v):
    b = bytearray(16)
    m = memoryview(b).cast(fmt)
    def f():
        m[0] = v
        return (m[0], bytes(b[:m.itemsize]))
    print(fmt, repr(v) if not isinstance(v, (I, F, C, B, BadI, BadI2, memoryview)) else type(v).__name__, end=' -> ')
    t(f)
INTS = {'b': 8, 'h': 16, 'i': 32, 'l': 64, 'q': 64, 'n': 64}
for f, bits in INTS.items():
    for v in (0, 1, -1, 2 ** (bits - 1) - 1, -2 ** (bits - 1), 2 ** (bits - 1), -2 ** (bits - 1) - 1, 2 ** 100, -2 ** 100, True, I(5), I(2 ** 70), 1.0, '1', None, b'a', BadI(), BadI2(), 1j):
        st(f, v)
for f, bits in {'B': 8, 'H': 16, 'I': 32, 'L': 64, 'Q': 64, 'N': 64}.items():
    for v in (0, 1, -1, 2 ** bits - 1, 2 ** bits, 2 ** 100, -2 ** 100, True, I(5), I(-5), 1.0, '1', None, BadI()):
        st(f, v)
for v in (0, 1, -1, 2 ** 64 - 1, 2 ** 64, -2 ** 63, -2 ** 63 - 1, True, I(5), 1.0, None, 'a'):
    st('P', v)
for f in 'efd':
    for v in (0.0, -0.0, 1.5, -2.25, 1, True, 10 ** 3, 65504.0, 65519.0, 65520.0, 1e5, 1e38, 3.5e38, 1e300, 1e-8, 5e-324, 6e-8, 2e-8, math.inf, -math.inf, 10 ** 400, F(2.5), I(3), '1', None, b'a', 1j, 0.1, 1 / 3):
        st(f, v)
    b = bytearray(8); m = memoryview(b).cast(f); m[0] = math.nan; print(f, m[0] != m[0], math.isnan(m[0]))
for f in ('Zf', 'Zd'):
    for v in (0j, 1+2j, -1.5-2.5j, 1, 2.5, True, C(), F(2.5), I(3), '1', None, complex(math.inf, -math.inf), 1e300+1e300j, 10 ** 400):
        st(f, v)
for v in (True, False, 0, 1, 2, -1, 256, '', 'a', [], [0], None, 0.0, B()):
    st('?', v)
for v in (b'a', b'\xff', b'', b'ab', bytearray(b'a'), memoryview(b'a'), 97, 'a', None):
    st('c', v)
class Byt(bytes): pass
st('c', Byt(b'z'))
# bool bytes that are neither 0 nor 1
print(memoryview(bytes([0, 1, 2, 255])).cast('?').tolist())
# -0.0 and friends come back as they are
b = bytearray(8); m = memoryview(b).cast('d'); m[0] = -0.0; print(m[0], math.copysign(1, m[0]), type(m[0]).__name__)
m[0] = 3.0; print(m[0], type(m[0]).__name__, m.tolist())
m2 = memoryview(b).cast('q'); m2[0] = 2 ** 62; print(m2[0], type(m2[0]).__name__)
m3 = memoryview(b).cast('Q'); m3[0] = 2 ** 64 - 1; print(m3[0], m2[0], memoryview(b).cast('P')[0], memoryview(b).cast('n')[0], memoryview(b).cast('N')[0])
