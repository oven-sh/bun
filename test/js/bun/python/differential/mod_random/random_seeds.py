# The numbers a seed gives are those it gives in CPython.
import _random

R = _random.Random

def digest(state):
    h = 0
    for w in state:
        h = (h * 1000003 + w) % (2**61 - 1)
    return h

class I(int):
    pass
class I2(int):
    def __abs__(self): return 'not called'
    def __hash__(self): return 12345
class H:
    def __init__(self, h): self.h = h
    def __hash__(self): return self.h
    def __repr__(self): return 'H(%r)' % self.h

SEEDS = [0, 1, -1, 2, 5, -5, 42, 255, 256, 2**31 - 1, 2**31, 2**32 - 1, 2**32, 2**32 + 1, 2**33, 2**53 - 1, 2**53, 2**53 + 1, -2**53 - 1, 2**63 - 1, 2**63, 2**64 - 1, 2**64, 2**64 + 1, -2**64, 2**96, 2**96 - 1,
         2**128 + 12345, 10**30, -10**30, 10**100, 3**400, 2**19968, 2**19968 - 1, 2**20000 + 7, 7**8000, True, False, I(7), I(-7), I2(9), I2(-9),
         1.5, -1.5, 0.0, -0.0, 1e300, float('inf'), float('-inf'), 2.0, 0.1, (), (1, 2), (1, (2, 3)), H(0), H(1), H(-2), H(2**60), H(-2**60), H(-1), 1j, 1 + 2j, frozenset(), None.__class__ is None]
for seed in SEEDS:
    r = R(seed)
    name = repr(seed) if len(repr(seed)) < 40 else 'int of %d bits' % seed.bit_length()
    print(name, digest(r.getstate()), r.getstate()[-1], [r.random() for i in range(3)], r.getrandbits(32), r.getrandbits(64), r.getrandbits(7))
    r2 = R()
    print(r2.seed(seed), r2.getstate() == R(seed).getstate())

r = R(12345)
print([r.random() for i in range(20)])
for i in range(2000):
    r.random()
print(r.random(), digest(r.getstate()), r.getstate()[-1])

r = R(2024)
for k in list(range(0, 70)) + [95, 96, 97, 127, 128, 129, 159, 160, 161, 191, 192, 193, 255, 256, 257, 1000, 1023, 1024, 1025, 4999, 20000, 100000]:
    v = r.getrandbits(k)
    print(k, v if k <= 200 else (v.bit_length(), v % (10**9 + 7), v >> (k - 40)), v < 2**k, type(v).__name__)
print(digest(r.getstate()), r.getstate()[-1])

# How many words each call takes.
for k in (0, 1, 31, 32, 33, 63, 64, 65, 96, 97):
    a = R(5)
    b = R(5)
    a.getrandbits(k)
    n = 0
    while a.getstate() != b.getstate():
        b.getrandbits(32)
        n += 1
        assert n < 10
    print(k, n)

# Without a seed, or with None: something else each time.
print(R().random() != R().random(), R(None).getstate() != R(None).getstate(), 0.0 <= R().random() < 1.0, len(R().getstate()), R().getstate()[-1])
r = R(1)
r.seed()
print(r.getstate() != R(1).getstate(), r.getstate()[-1], r.getstate()[0])
r.seed(None)
print(r.getstate()[-1], r.getstate()[0])
