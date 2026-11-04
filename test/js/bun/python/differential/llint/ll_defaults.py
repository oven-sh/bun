# Parameters that are left out: where the defaults come from, and when.
import functools, types
out = []
def rec(label, f, *a, **k):
    try:
        r = repr(f(*a, **k))
    except Exception as e:
        r = type(e).__name__ + ":" + str(e)
    out.append("%s -> %s" % (label, r))

def f0(): return ()
def f1(a): return (a,)
def d1(a=1): return (a,)
def d2(a, b=2): return (a, b)
def d3(a, b=2, c=3): return (a, b, c)
def dall(a=1, b=2, c=3, d=4): return (a, b, c, d)
def pos(a, b=2, /): return (a, b)
def pos2(a, /, b=2, c=3): return (a, b, c)
def kwo(a, b=2, *, c=3): return (a, b, c)
def kwr(a, b=2, *, c): return (a, b, c)
def var(a, b=2, *r): return (a, b, r)
def vkw(a, b=2, **k): return (a, b, k)
def both(a, b=2, *r, c=3, **k): return (a, b, r, c, k)
FUNCTIONS = [f0, f1, d1, d2, d3, dall, pos, pos2, kwo, kwr, var, vkw, both]
ARGS = [(), (10,), (10, 20), (10, 20, 30), (10, 20, 30, 40), (10, 20, 30, 40, 50)]
KW = [{}, {"a": 7}, {"b": 8}, {"c": 9}, {"b": 8, "c": 9}, {"z": 0}, {"a": 7, "b": 8, "c": 9, "d": 6}]
for f in FUNCTIONS:
    for a in ARGS:
        for n, k in enumerate(KW):
            rec("%s %d %d" % (f.__name__, len(a), n), f, *a, **k)

# Written out, so that each call is an instruction with that many arguments.
def direct():
    return [d1(), d1(5), d2(5), d2(5, 6), d3(5), d3(5, 6), d3(5, 6, 7), dall(), dall(5), dall(5, 6), dall(5, 6, 7), dall(5, 6, 7, 8), pos(5), pos2(5), pos2(5, 6), kwo(5), var(5), vkw(5), both(5)]
rec("direct", direct)
for label, call in (("d2()", lambda: d2()), ("d3()", lambda: d3()), ("d2(1,2,3)", lambda: d2(1, 2, 3)), ("d1(1,2)", lambda: d1(1, 2)), ("dall 5", lambda: dall(1, 2, 3, 4, 5)), ("pos()", lambda: pos()), ("kwr(1)", lambda: kwr(1)), ("f1()", lambda: f1())):
    rec(label, call)

# The defaults are those the function has when it is called.
def g(a, b=2, c=3): return (a, b, c)
def calls(): return [r for r in (try_(lambda: g()), try_(lambda: g(1)), try_(lambda: g(1, 20)), try_(lambda: g(1, 20, 30)))]
def try_(f):
    try: return f()
    except TypeError as e: return str(e)
rec("as written", calls)
for d in ((), None, (9,), (8, 9), (7, 8, 9), (6, 7, 8, 9), (5, 6, 7, 8, 9), ([],), (None, None)):
    g.__defaults__ = d
    rec("defaults %r" % (d,), calls)
    rec("has %r" % (d,), lambda: g.__defaults__)
del g.__defaults__
rec("deleted", calls)
for bad in (1, [1], "ab", {1: 2}): rec("bad %r" % (bad,), setattr, g, "__defaults__", bad)
class T(tuple): pass
g.__defaults__ = T((1, 2))
rec("subclass of tuple", lambda: (calls(), type(g.__defaults__).__name__))

# They are evaluated once, and shared.
def acc(x, into=[]):
    into.append(x); return into
rec("shared", lambda: (acc(1), acc(2), acc(3, []), acc(4), acc.__defaults__))
def late(n=len(out) * 0 + 5): return n
rec("once", lambda: (late(), late(1), late()))
def maker(k):
    def inner(a, b=k, c=k * 2): return (a, b, c)
    return inner
rec("closures", lambda: [m(0) for m in (maker(1), maker("x"), maker(None))] + [maker(2)(0, 1)])
rec("lambda", lambda: [(lambda a, b=i: (a, b))(0) for i in range(3)])
sentinel = object()
def same(a=sentinel): return a is sentinel
rec("identity", lambda: (same(), same(sentinel), same(None)))
def floats(a=1.0, b=2.5, c=-0.0, d=10 ** 30, e=True, f=None): return (a, b, c, d, e, f)
rec("kinds", lambda: (floats(), floats(0), floats(0, 0, 0)))

# Methods, classes, and other ways to a call.
class C:
    def __init__(self, x=1, y=2): self.x = x; self.y = y
    def m(self, a=3, b=4): return (self.x, self.y, a, b)
    @classmethod
    def cm(cls, a=5): return (cls.__name__, a)
    @staticmethod
    def sm(a=6, b=7): return (a, b)
    def __call__(self, a=8): return a
    def __getitem__(self, i, extra=9): return (i, extra)
    def __eq__(self, other, extra=10): return extra
    __hash__ = None
c = C()
rec("methods", lambda: (c.m(), c.m(0), c.m(0, 0), C(9).m(), C(9, 9).m(1), C.m(c), C.m(c, 1), c.cm(), C.cm(0), c.sm(), C.sm(0), c(), c(0), c[1], c == 1))
rec("method errors", lambda: [try_(lambda: c.m(1, 2, 3)), try_(lambda: C.m()), try_(lambda: C(1, 2, 3)), try_(lambda: c.cm(1, 2)), try_(lambda: c.sm(1, 2, 3))])
bound = c.m
rec("bound", lambda: (bound(), bound(1), bound(1, 2), bound(b=0)))
rec("through C++", lambda: (list(map(d2, [1, 2])), list(map(d3, [1], [2])), sorted([3, 1, 2], key=d1), functools.reduce(d3, [1, 2, 3]), list(filter(d1, [0, 1])), max([1, 2], key=dall), functools.partial(d3, 1)(), functools.partial(d3, 1, 2)(),
                            functools.partial(d3, c=0)(1)))
rec("star", lambda: (d3(*[1]), d3(*(1, 2)), d3(*[1, 2, 3]), d3(1, *[2]), d3(*[], **{"a": 1}), dall(*[]), dall(*"ab")))
def gen(a, b=2):
    yield a; yield b
async def co(a, b=2): return (a, b)
def run(c):
    try: c.send(None)
    except StopIteration as e: return e.value
rec("generators", lambda: (list(gen(1)), list(gen(1, 3)), run(co(1)), run(co(1, 3)), try_(lambda: gen()), try_(lambda: co())))
def rec_(n, acc=0): return acc if not n else rec_(n - 1, acc + n) if n % 2 else rec_(n - 1)
rec("recursion", rec_, 50)
copy = types.FunctionType(d3.__code__, globals(), "copy", (20, 30))
rec("FunctionType", lambda: (copy(1), copy(1, 2), types.FunctionType(d3.__code__, globals())(1, 2, 3), try_(lambda: types.FunctionType(d3.__code__, globals())(1))))
many = eval("lambda " + ", ".join("p%d=%d" % (i, i) for i in range(40)) + ": (" + ", ".join("p%d" % i for i in range(40)) + ")")
rec("many", lambda: (sum(many()), sum(many(100)), sum(many(*range(100, 139))), sum(many(*range(100, 140))), try_(lambda: many(*range(41)))))
print("\n".join(out))
print(len(out))
