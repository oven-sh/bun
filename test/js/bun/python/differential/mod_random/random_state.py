# getstate, setstate, and what they complain of.
import _random

R = _random.Random

def show(f, *args, **kw):
    try:
        r = repr(f(*args, **kw))
    except BaseException as e:
        r = '%s: %s' % (type(e).__name__, e)
    a = repr(args)
    print(getattr(f, '__name__', f), a if len(a) < 80 else a[:60] + '...', kw or '', r if len(r) < 200 else r[:200])

r = R(99)
s = r.getstate()
print(type(s).__name__, len(s), all(type(x) is int for x in s), all(0 <= x < 2**32 for x in s[:-1]), s[:3], s[-3:])
a = [r.random() for i in range(5)]
print(r.getstate()[-1])
print(r.setstate(s))
print([r.random() for i in range(5)] == a)
other = R(1)
other.setstate(s)
print([other.random() for i in range(5)] == a)
for i in range(700):
    r.getrandbits(32)
s2 = r.getstate()
print(s2[-1], s2[:2], s2 == s)
b = r.random()
r.setstate(s2)
print(r.random() == b)

class T(tuple):
    pass
class I(int):
    pass
class Idx:
    def __index__(self): return 3
    def __repr__(self): return 'Idx()'
r = R(0)
show(r.setstate, T(s))
print(r.getstate() == s)
show(r.setstate, list(s))
show(r.setstate, 1)
show(r.setstate, None)
show(r.setstate, ())
show(r.setstate, (1,))
show(r.setstate, s + (1,))
show(r.setstate, s[:-1])
show(r.setstate)
show(r.setstate, s, s)
show(r.setstate, state=s)
for bad in (-1, 2**64, 2**64 - 1, 2**32, 2**32 + 5, 2**63, 'a', 1.0, None, True, I(5), Idx(), -2**70, 10**30):
    before = r.getstate()
    show(r.setstate, (bad,) + s[1:])
    print(r.getstate() == before, r.getstate()[0])
    show(r.setstate, s[:100] + (bad,) + s[101:])
    print(r.getstate()[100])
for bad in (-1, 0, 1, 623, 624, 625, 2**31, 2**63, 2**64, -2**63 - 1, 'a', 1.0, None, True, I(5), Idx()):
    r.setstate(s)
    show(r.setstate, s[:-1] + (bad,))
    print(r.getstate()[-1], r.random())
show(r.setstate, (0,) * 625)
print(r.random(), r.getrandbits(40), r.getstate()[-1])
show(r.setstate, (0,) * 624 + (624,))
print(r.random(), r.getstate()[:3], r.getstate()[-1])
show(r.setstate, (2**32 - 1,) * 624 + (624,))
print(r.random(), r.getstate()[:3], r.getstate()[-1])

show(r.getstate, 1)
show(r.getstate, x=1)
show(r.random, 1)
show(r.random, x=1)
show(r.seed, 1, 2)
show(r.seed, n=1)
show(r.seed, [])
show(r.seed, {})
show(r.seed, [1])
for k in (-1, -2**70, 2**64, 2**64 - 1, 2**63, 2**62, 10**30, 1.0, 'a', None, True, False, I(8), Idx(), [], 1j):
    r.seed(3)
    show(r.getrandbits, k)
show(r.getrandbits)
show(r.getrandbits, 1, 2)
show(r.getrandbits, k=1)
