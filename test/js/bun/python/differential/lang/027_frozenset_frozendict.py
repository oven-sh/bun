def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

f = frozenset([1, 2, 3]); g = frozenset([3, 4])
print(f, len(f), 1 in f, 9 in f, frozenset(), frozenset("a"), frozenset({1: 2}), frozenset(range(3)), frozenset(f) is f, frozenset([1, 1]), bool(frozenset()), bool(f), type(f), repr(frozenset()), repr(frozenset({1})), repr(frozenset({frozenset()})), str(f))
print(f | g, f & g, f - g, f ^ g, type(f | g), type(f | {9}), type({9} | f), f | {9}, {9} | f, f & {1}, {1, 9} & f, type({1} & f), type(f & {1}), f.union([9]), f.intersection([1]), f.difference([1]), f.symmetric_difference([1, 9]), type(f.union([9])), f.copy() is f, f.isdisjoint(g), f.issubset(range(9)), f.issuperset([1]), f == {1, 2, 3}, {1, 2, 3} == f, f != g, f < {1, 2, 3, 4}, f <= f, f > {1}, f >= g)
print(hash(f) == hash(frozenset([3, 2, 1])), hash(frozenset()) == hash(frozenset()), {f: 1}[frozenset({1, 2, 3})], f in {f}, {frozenset({1}), frozenset({1})}, hash(frozenset()), hash(frozenset({1})), hash(frozenset({1, 2})), hash(frozenset(range(10))), hash(frozenset({0})), hash(frozenset({-1})), hash(frozenset({frozenset()})), hash(frozenset({(1, 2)})))
for m in ("add", "remove", "discard", "pop", "clear", "update", "intersection_update", "difference_update", "symmetric_difference_update"):
    t(lambda: getattr(f, m))
t(lambda: frozenset([[]]))
t(lambda: frozenset(1))
t(lambda: frozenset(1, 2))
t(lambda: f | [1])
t(lambda: f[0])
t(lambda: f < [1])
h = k = frozenset({1}); h |= {2}; print(h, k, h is k, type(h)); h &= {2}; print(h); h -= {2}; print(h); h ^= {5}; print(h)
class FS(frozenset): pass
x = FS([1, 2]); print(x, type(x), type(x | {3}), type(x.copy()), type(frozenset(x)), x == {1, 2}, hash(x) == hash(frozenset({1, 2})), repr(FS()), FS(x) is x, type(x & x))
print(sorted(n for n in dir(frozenset) if not n.startswith("_")), frozenset.__mro__)

# frozendict, new in 3.15.
d = frozendict({"a": 1, "b": 2})
print(d, len(d), d["a"], "a" in d, "z" in d, list(d), list(d.keys()), list(d.values()), list(d.items()), d.get("a"), d.get("z"), d.get("z", 0), bool(d), bool(frozendict()), type(d), repr(frozendict()), str(d), list(reversed(d)))
print(frozendict(), frozendict(a=1), frozendict([("a", 1)]), frozendict({"a": 1}, b=2), frozendict(d) is d, frozendict(zip("ab", (1, 2))), frozendict({1: [2]}), frozendict(frozendict(x=1), y=2), frozendict.fromkeys("ab"), frozendict.fromkeys("ab", 0), type(frozendict.fromkeys("a")))
t(lambda: d["z"])
t(lambda: d[[]])
t(lambda: frozendict(1))
t(lambda: frozendict([1]))
t(lambda: frozendict({}, {}))
t(lambda: frozendict({[]: 1}))
def setitem(): d["c"] = 3
def delitem(): del d["a"]
t(setitem); t(delitem)
for m in ("pop", "popitem", "clear", "update", "setdefault", "__setitem__", "__delitem__", "__ior__"):
    t(lambda: getattr(d, m))
print(d == {"a": 1, "b": 2}, {"a": 1, "b": 2} == d, d == frozendict(b=2, a=1), d != frozendict(), d == [("a", 1)], d == frozendict(a=1), frozendict() == {}, d.keys() == {"a", "b"}, d.items() == {("a", 1), ("b", 2)})
print(hash(d) == hash(frozendict(b=2, a=1)), hash(frozendict()) == hash(frozendict()), {d: 1}[frozendict(a=1, b=2)], d in {d}, len({frozendict(a=1), frozendict(a=1), frozendict(a=2)}), isinstance(hash(d), int))
t(lambda: hash(frozendict(a=[])))
t(lambda: {frozendict(a={}): 1})
print(d | {"c": 3}, type(d | {"c": 3}), {"c": 3} | d, type({"c": 3} | d), d | frozendict(a=0), d | d is d or True, d | {}, frozendict() | frozendict())
t(lambda: d | [("c", 3)])
t(lambda: d | 1)
t(lambda: d < d)
t(lambda: d + d)
e = f2 = d; e |= {"z": 26}; print(e, f2, e is f2, type(e))
print(d.copy(), d.copy() is d, type(d.copy()), dict(d), type(dict(d)), {**d}, {**d, "x": 0}, dict(d, x=0), (lambda **k: k)(**d), [k for k in d], {k: v for k, v in d.items()}, sorted(d), max(d), len(d.items()), tuple(d), set(d) == {"a", "b"}, "%(a)s" % d, "{a}".format(**d), "{0[a]}".format(d), "{a}".format_map(d))
print(isinstance(d, dict), issubclass(frozendict, dict), frozendict.__mro__, isinstance(d, frozendict), frozendict.__name__, sorted(n for n in dir(frozendict) if not n.startswith("_")))
x = {}; x.update(d); print(x); x |= d; print(x); print(dict.fromkeys(d), list(zip(d, d.values())), d.keys() & {"a"}, d.keys().mapping == d)
n = frozendict(a=frozendict(b=(1, 2))); print(n, n["a"]["b"], hash(n) == hash(frozendict(a=frozendict(b=(1, 2)))))
m = frozendict(l=[1]); m["l"].append(2); print(m)
class FD(frozendict):
    def extra(self): return len(self)
y = FD(a=1); print(y, type(y), y.extra(), y == {"a": 1}, hash(y) == hash(frozendict(a=1)), type(y | {"b": 2}), type(y.copy()), isinstance(y, frozendict), repr(FD()))
match d:
    case {"a": v, **rest}: print("matched", v, rest, type(rest))
match d:
    case frozendict(): print("class pattern")
it = iter(d); print(next(it), next(it), next(it, "end"), type(it).__name__, type(d.keys()).__name__, type(d.items()).__name__)
print(eval("a + b", d) if False else "", eval("a + b", {}, d), eval("a + b", dict(d)))
big = frozendict((i, i) for i in range(1000)); print(len(big), big[999], 1000 in big, sum(big.values()), list(big)[:3])
