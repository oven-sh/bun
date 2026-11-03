from _collections import defaultdict

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)

def tn(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__)

d = defaultdict(list)
d["a"].append(1); d["a"].append(2); d["b"]
print(d, len(d), d.default_factory is list, isinstance(d, dict), type(d).__name__)
print(d.get("z"), "z" in d, d)
e = defaultdict(); print(e, e.default_factory); t(lambda: e["x"]); t(lambda: e[(1, 2)])
e = defaultdict(None, {"a": 1}, b=2); print(e); t(lambda: e["zz"])
e = defaultdict(int, [("a", 1)], b=2); e["c"] += 5; print(e, e["q"], e)
t(lambda: defaultdict(1)); t(lambda: defaultdict("a")); t(lambda: defaultdict(int, 1)); t(lambda: defaultdict(int, {}, {}))
print(defaultdict(default_factory=int))
c = d.copy(); print(c, type(c).__name__, c.default_factory is list, c is d, c["a"] is d["a"])
c = d.__copy__(); print(c == d)
r = d.__reduce__(); print(r[0] is defaultdict, r[1], r[2], r[3], list(r[4]))
r = defaultdict().__reduce__(); print(r[1], list(r[4]))
print(d.__missing__("k"), d)
t(lambda: defaultdict().__missing__("k"))
d.default_factory = None; t(lambda: d["nope"]); d.default_factory = int; print(d["yes"])
del d.default_factory; print(d.default_factory); t(lambda: d["nope2"])
d.default_factory = 5; t(lambda: d["nope3"])
def boom(): raise ValueError("boom")
t(lambda: defaultdict(boom)["x"])
a = defaultdict(int, {1: 1}); b = defaultdict(list, {2: 2})
print(a | b, (a | b).default_factory is int, a | {3: 3}, {3: 3} | a, type({3: 3} | a).__name__, ({3: 3} | a).default_factory is int)
tn(lambda: a | [(1, 2)]); tn(lambda: [(1, 2)] | a); print(a.__or__(1), a.__ror__(1))
a |= {9: 9}; print(a, type(a).__name__)
a |= [(8, 8)]; print(a)
print(a == {1: 1, 9: 9, 8: 8}, defaultdict(int) == {}, defaultdict(int) == defaultdict(list))
class S(defaultdict):
    pass
s = S(int, a=1); s.attr = 1; print(s, type(s.copy()).__name__, s["zz"], s.__dict__, type(s | {}).__name__)
class M(defaultdict):
    def __missing__(self, key): return key * 2
print(M()["ab"], M())
class Rec(defaultdict):
    def __init__(self): self.default_factory = self._factory
    def _factory(self): return []
print(repr(Rec()), Rec()[1])
d = defaultdict(int); d[1] = d; print(d)
print(defaultdict.__name__, defaultdict.__module__, defaultdict.__mro__, defaultdict[str, int])
print(sorted(k for k in defaultdict.__dict__ if k not in ("__doc__", "__module__", "__getattribute__")))
print(defaultdict.__doc__)
tn(lambda: hash(defaultdict()))
class K:
    def __hash__(self): raise TypeError("nohash")
t(lambda: defaultdict(int)[K()])
t(lambda: defaultdict(int)[[]])
x = defaultdict(lambda: len(x)); print(x["a"], x["b"], x["a"], dict(x))
class Re:
    def __init__(self, d): self.d = d
    def __call__(self):
        self.d["k"] = "inner"
        return "outer"
y = defaultdict(); y.default_factory = Re(y); print(y["k"], dict(y))
