# math.integer: gcd, lcm, isqrt, factorial, perm, comb.
import math

def show(name, *args, **kw):
    try:
        r = getattr(math, name)(*args, **kw)
        r = repr(r) if not isinstance(r, int) or r.bit_length() < 400 else 'int of %d bits, %d mod 10**9+7, hex tail %x' % (r.bit_length(), r % (10**9 + 7), r & 0xffffffffffff)
    except Exception as e:
        r = '%s: %s' % (type(e).__name__, e)
    a = repr(args)
    print(name, a if len(a) < 100 else a[:97] + '...', kw or '', r)

class Idx:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
    def __repr__(self): return 'Idx(%r)' % self.v
class I(int):
    pass
class Bad:
    def __index__(self): raise KeyError('bad')
    def __repr__(self): return 'Bad()'

INTS = [0, 1, -1, 2, -2, 3, 6, 12, 18, -18, 35, 97, 120, 2**31, 2**32 - 1, 2**53, 2**53 + 1, -2**53 - 2, 2**62, 2**63 - 1, 2**63, -2**63, 2**64 - 1, 2**64, 2**64 + 6, 10**20, -10**20,
        3**50, 2**100, 2**100 * 3**5, 10**40 + 6, 6 * 10**50]
for name in ('gcd', 'lcm'):
    show(name)
    for a in INTS:
        show(name, a)
        for b in INTS:
            show(name, a, b)
    for args in ((12, 18, 24), (12, 18, 24, 7), (0, 0, 0), (2**70, 2**65, 2**80), (6, 10, 15), (True, 2), (False, False), (Idx(12), Idx(18)), (I(12), 18), (I(-12),), (Idx(-5),), (True,),
                 (1.0,), (12, 1.5), (1, 'a'), ('a', 1), (1, 1, 'a'), (0, 0, 'a'), (0, 5, 'a'), (None,), (Bad(),), (1, Bad()), (2, 3, 1.0), (10**30, 10**20, 10**25), (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)):
        show(name, *args)
    show(name, 1, x=2)
    show(name, integers=(1, 2))

# Consecutive Fibonacci numbers: the longest run of Euclid's algorithm.
a, b = 1, 1
for i in range(400):
    a, b = b, a + b
show('gcd', a, b)
show('gcd', a * 12345678901234567890, b * 12345678901234567890)
show('lcm', a, b)

for n in list(range(0, 70)) + [99, 100, 101, 2**16 - 1, 2**16, 2**31, 2**32 - 1, 2**32, 2**32 + 1, 2**52, 2**53 - 1, 2**53, 2**53 + 1, 2**62, 2**63 - 1, 2**63, 2**64 - 1, 2**64, 2**64 + 1,
                                (2**32 - 1)**2, (2**32 - 1)**2 - 1, (2**32)**2 - 1, 4294967295 * 4294967297, 10**19, 10**20, 10**30, 10**40 - 1, 10**40, 10**100, 10**100 - 1, 2**200 - 1, 2**201, (10**50 + 7)**2, (10**50 + 7)**2 - 1,
                                (10**50 + 7)**2 + 1, 10**1000, 3**999, (2**500 - 1)**2 - 1, (2**500 - 1)**2]:
    show('isqrt', n)
for x in (-1, -10**30, 1.0, 'a', None, True, Idx(17), I(26), Idx(-1), Bad(), 4.0):
    show('isqrt', x)
show('isqrt')
show('isqrt', 1, 2)
show('isqrt', n=4)
for k in range(60, 140):
    n = 3**k
    r = math.isqrt(n)
    assert r * r <= n < (r + 1) * (r + 1), n

for n in list(range(0, 40)) + [50, 64, 100, 127, 128, 129, 170, 171, 200, 255, 256, 257, 500, 1000, 1023, 1024, 2000, 3000]:
    show('factorial', n)
for x in (-1, -10**30, 10**30, 2**63, 1.0, 5.0, 5.5, 'a', None, True, False, Idx(5), I(6), Idx(-1), Bad()):
    show('factorial', x)
show('factorial')
show('factorial', 1, 2)
show('factorial', n=4)
f = 1
for n in range(1, 300):
    f *= n
    assert math.factorial(n) == f, n

for name in ('perm', 'comb'):
    for n in list(range(0, 12)) + [20, 30, 34, 35, 61, 62, 63, 66, 67, 68, 100, 127, 128, 1000, 2**16, 2**31, 2**32, 2**53, 2**63 - 1, 2**63, 2**64, 10**30]:
        for k in (0, 1, 2, 3, 4, 5, 7, 10, 11, 20, 21, 33, 34, 60, 64, 65, 100):
            show(name, n, k)
    for args in ((5,), (), (5, 2, 1), (-1, 2), (2, -1), (-1, -1), (5, 10**30), (10**30, 10**30 + 1), (10**30, 10**20), (2**64, 2**63),
                 (5.0, 2), (5, 2.0), ('a', 2), (5, 'a'), (None, 2), (5, None), (True, True), (Idx(10), Idx(3)), (I(10), I(3)), (Bad(), 1), (1, Bad()), (-1, 'a'), (1.0, 'a'), (200, 100), (201, 100), (1000, 500), (1000, 998), (300, 150), (10**6, 3), (10, None), (-1, None), (1.5, None)):
        show(name, *args)
    show(name, n=5, k=2)
    show(name, 5, k=2)
for args in ((10**6, 10**6 - 3), (2**63 - 1, 2**63 - 1), (2**63 - 1, 2**63 - 2), (2**63 - 1, 2**63 - 3), (10**30, 10**30), (10**30, 10**30 - 1), (10**30, 10**30 - 2), (2**63, 2**63), (2**64, 2**63), (2**64 + 5, 2**64), (5000, 2500)):
    show('comb', *args)
for n in range(0, 45):
    row = [math.comb(n, k) for k in range(n + 2)]
    assert sum(row) == 2**n, n
    for k in range(n + 1):
        assert math.perm(n, k) == math.comb(n, k) * math.factorial(k), (n, k)
print('ok')
