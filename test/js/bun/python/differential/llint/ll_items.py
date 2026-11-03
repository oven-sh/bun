# Subscripts, iteration, unpacking.
out = []
def rec(label, f, *a):
    try:
        r = repr(f(*a))
    except Exception as e:
        r = type(e).__name__ + ":" + str(e)
    out.append("%s -> %s" % (label, r))

def get(c, i): return c[i]
def put(c, i, v):
    c[i] = v
    return c
class LS(list): pass
class LG(list):
    def __getitem__(self, i): return ("LG", i)
    def __setitem__(self, i, v): list.__setitem__(self, 0, ("set", i, v))
class TS(tuple): pass
class TG(tuple):
    def __getitem__(self, i): return ("TG", i)
from collections import namedtuple
NT = namedtuple("NT", "a b c")
def containers():
    ints = []
    for i in range(5): ints.append(i)          # int32 storage
    floats = []
    for i in range(5): floats.append(i + 0.5)  # double storage
    big = []
    for i in range(5): big.append(2**40 + i)   # doubles that are ints
    mixed = []
    for i in range(5): mixed.append(i)
    mixed[2] = 2.5                             # int32 to double
    objs = []
    for i in range(5): objs.append(str(i))
    whole = []
    for i in range(5): whole.append(float(i))  # objects
    lit = [1, 2, 3, 4, 5]
    lit2 = [1.5, 2.5, 3.5, 4.5, 5.5]
    return [ints, floats, big, mixed, objs, whole, lit, lit2, [], [None], LS([1, 2, 3]), LG([1, 2, 3]), (), (1,), (1, 2.0, "x", None, 5), TS((1, 2, 3)), TG((1, 2, 3)),
            NT(1, 2, 3), "abc", "", b"abc", bytearray(b"abc"), range(5), range(10, 0, -3), {0: "z", 1: "o", -1: "m", True: "t"}, {}, None, 5, 1.5]
IDX = [0, 1, 2, 4, 5, 6, -1, -2, -5, -6, -7, 2**31 - 1, -2**31, 2**31, 2**40, -2**40, 2**64, True, False, 1.0, 1.5, "0", None, slice(1, 3), (0,)]
for n, c in enumerate(containers()):
    for i in IDX:
        rec("get %d %r" % (n, i), get, c, i)
VAL = [7, -7, 2**31, 2**40, 2**53, 2**64, 0.5, 1.0, -0.0, float("inf"), float("nan"), None, True, "s", [1], (1,)]
for v in VAL:
    for i in [0, 2, 4, 5, -1, -5, -6, 2**31, True, 1.0, None]:
        for n, c in enumerate(containers()):
            if n > 12 and n not in (20, 21, 24, 25): continue
            rec("put %d %r %r" % (n, i, v), put, c, i, v)

def loop(c):
    r = []
    for x in c:
        r.append(x)
    return r
for n, c in enumerate(containers()):
    rec("loop %d" % n, loop, c)
def ranges():
    return [range(0), range(3), range(-3, 3), range(3, -3, -1), range(0, 10, 3), range(10, 0, -3), range(2**31 - 3, 2**31 + 3), range(-2**31 - 3, -2**31 + 3), range(2**31 + 3, 2**31 - 3, -1),
            range(2**31 - 1, 2**31), range(0, 2**33, 2**31), range(0, 2**31, 2**30), range(2**53 - 2, 2**53 + 3), range(2**62, 2**62 + 3), range(2**63 - 2, 2**63 + 2), range(2**64, 2**64 + 3), range(0, -2**33, -2**31),
            range(5, 5), range(5, 4), range(1, 2**70, 2**69), range(2**31 - 2, -2**31, -2**31)]
for n, c in enumerate(ranges()):
    rec("range %d" % n, loop, c)
    rec("rangesum %d" % n, sum, c)
    rec("rangerev %d" % n, loop, reversed(c))

def grow(c):
    n = 0
    for x in c:
        n += 1
        if n < 4: c.append(x)
    return c, n
def shrink(c):
    r = []
    for x in c:
        r.append(x)
        if len(c) > 1: c.pop()
    return r
def clear(c):
    r = []
    for x in c:
        r.append(x)
        c.clear()
    return r
def exhausted(c):
    it = iter(c)
    r = [x for x in it]
    c.append(99)
    r2 = [x for x in it]
    return r, r2, list(it)
def change_kind(c):
    r = []
    for i, x in enumerate(c):
        pass
    for x in c:
        r.append(x)
        if len(r) == 1: c[2] = "str"
        if len(r) == 2: c[3] = 1.5
    return r
def partial(c):
    it = iter(c)
    a = next(it)
    r = []
    for x in it:
        r.append(x)
        break
    return a, r, next(it, "end"), it.__length_hint__() if hasattr(it, "__length_hint__") else None
for f in [grow, shrink, clear, exhausted, change_kind]:
    for n, c in enumerate(containers()[:9]):
        rec("%s %d" % (f.__name__, n), f, c)
for n, c in enumerate(containers()[:24] + ranges()):
    rec("partial %d" % n, partial, c)
import pickle, copy
def state(c):
    it = iter(c)
    next(it)
    it2 = copy.copy(it)
    return list(it), list(it2), list(pickle.loads(pickle.dumps(iter(c))))
for n, c in enumerate(containers()[:8] + ranges()[1:6]):
    rec("state %d" % n, state, c)
def setstate(c, k):
    it = iter(c)
    it.__setstate__(k)
    return [x for x in it]
for k in [0, 1, 3, 5, 6, 100, -1, -100, 2**31, 2**40, 2**64, -2**64]:
    for n, c in enumerate([[1, 2, 3, 4, 5], (1, 2, 3, 4, 5), range(5), range(10, 0, -2), range(2**31 - 2, 2**31 + 2)]):
        rec("setstate %d %r" % (n, k), setstate, c, k)

def u0(c):
    [] = c
    return "ok"
def u1(c):
    a, = c
    return a
def u2(c):
    a, b = c
    return a, b
def u3(c):
    a, b, c = c
    return c, b, a
def u5(c):
    a, b, c, d, e = c
    return e, d, c, b, a
def us(c):
    a, *b = c
    return a, b
def us2(c):
    *a, b = c
    return a, b
def us3(c):
    a, *b, c = c
    return a, b, c
def un(c):
    (a, b), c = c
    return a, b, c
def uf(c):
    r = []
    for a, b in c:
        r.append(b)
        r.append(a)
    return r
class TI(tuple):
    def __iter__(self): return iter((9, 8, 7))
class LI(list):
    def __iter__(self): return iter((9, 8))
for f in [u0, u1, u2, u3, u5, us, us2, us3]:
    for n, c in enumerate(containers() + [TI((1, 2)), TI((1, 2, 3)), LI([1, 2]), LI([1, 2, 3]), [1], [1, 2], [1.5, 2.5], [1, 2, 3], (1, 2), (1, 2, 3), "ab", {1: 2, 3: 4}, {1, 2}, iter([1, 2]), (x for x in (1, 2, 3))]):
        rec("%s %d" % (f.__name__, n), f, c)
rec("un", un, ((1, 2), 3)); rec("un", un, ([1, 2], 3)); rec("un", un, ((1, 2, 3), 3)); rec("un", un, (1, 3))
rec("uf", uf, [(1, 2), [3, 4], "ab", NT(1, 2, 3)]); rec("uf", uf, {1: 2}.items()); rec("uf", uf, enumerate("ab")); rec("uf", uf, zip((1, 2), (3, 4)))
def swap(a, b):
    a, b = b, a
    return a, b
rec("swap", swap, 1, 2.0)
def selfref():
    a = (1, 2)
    a, b = a
    return a, b
rec("selfref", selfref)
import hashlib, sys
print(len(out), hashlib.md5("\n".join(out).encode()).hexdigest())
if len(sys.argv) > 1:
    print("\n".join(out))
