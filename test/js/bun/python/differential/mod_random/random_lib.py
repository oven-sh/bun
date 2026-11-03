# Lib/random.py on top of _random and math: the same numbers as in CPython.
import random

for seed in (0, 1, 42, -7, 2**70, 123456789):
    r = random.Random(seed)
    print(seed, r.random(), r.uniform(-5, 5), r.randint(1, 6), r.randint(-10**30, 10**30), r.randrange(100), r.randrange(10, 1000, 7), r.randrange(2**100), r.getrandbits(77), r.randbytes(9))
    print(r.choice('abcdefgh'), r.choice(range(1000)), r.choices('abc', k=8), r.choices(range(5), weights=[1, 2, 3, 4, 5], k=8), r.choices('xyz', cum_weights=[1, 3, 10], k=5))
    l = list(range(20))
    r.shuffle(l)
    print(l, r.sample(range(1000), 7), r.sample('abcdefghij', 4), r.sample(['a', 'b'], counts=[5, 5], k=6))
    print(r.triangular(), r.triangular(1, 10, 3), r.gauss(0, 1), r.gauss(10, 2), r.normalvariate(0, 1), r.lognormvariate(0, 1), r.expovariate(1.5), r.vonmisesvariate(1, 2), r.vonmisesvariate(0, 1e-7))
    print(r.gammavariate(0.5, 2), r.gammavariate(1, 2), r.gammavariate(3.5, 2), r.betavariate(2, 5), r.paretovariate(3), r.weibullvariate(1, 1.5))
    print(r.binomialvariate(10, 0.5), r.binomialvariate(100, 0.03), r.binomialvariate(1000, 0.7), r.binomialvariate(1, 0.2), r.binomialvariate(50, 0.0), r.binomialvariate(50, 1.0))

r = random.Random(5)
state = r.getstate()
print(state[0], len(state[1]), state[1][:3], state[1][-1], state[2])
a = [r.random() for i in range(5)]
r.setstate(state)
print([r.random() for i in range(5)] == a)
r.gauss(0, 1)
state = r.getstate()
print(state[2])
b = r.gauss(0, 1)
r.setstate(state)
print(r.gauss(0, 1) == b)
r.seed(5)
print([r.random() for i in range(5)] == a)
r.seed(1.5)
print(r.random())
r.seed(None)
print(0 <= r.random() < 1)

def show(f, *args, **kw):
    try:
        print(f.__name__, args, kw or '', repr(f(*args, **kw)))
    except Exception as e:
        print(f.__name__, args, kw or '', '%s: %s' % (type(e).__name__, e))
r = random.Random(1)
show(r.randrange, 0)
show(r.randrange, 5, 5)
show(r.randrange, 1.5)
show(r.randint, 5, 1)
show(r.choice, [])
show(r.sample, [1, 2], 3)
show(r.sample, {1, 2}, 1)
show(r.getrandbits, -1)
show(r.getrandbits, 0)
show(r.randbytes, 0)
show(r.seed, [])
show(r.seed, (1, 2))
show(r.setstate, (1, 2, 3))
show(r.setstate, (3, (1, 2), None))
show(r.choices, 'abc', [1, 2], k=2)
show(r.expovariate, 0)
show(r.gammavariate, 0, 1)
show(r.binomialvariate, -1, 0.5)
show(r.binomialvariate, 1, 1.5)

random.seed(99)
print(random.random(), random.randint(1, 10), random.choice([1, 2, 3]), random.getrandbits(20))
print(type(random._inst).__name__, isinstance(random._inst, random.Random), random.Random.__mro__, random.Random.__bases__[0].__module__)
class Mine(random.Random):
    def random(self):
        return 0.5
m = Mine()
print(m.random(), m.uniform(0, 10), m.choice('abc'), m.randrange(10))
