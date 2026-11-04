# Built-in types called as functions; lists made, extended and sorted many items at a time.
import collections, random, re
out = []
def rec(label, f, *a, **k):
    try:
        r = re.sub(r" at 0x[0-9a-f]+", " at 0x...", repr(f(*a, **k)))
    except Exception as e:
        r = type(e).__name__ + ":" + str(e)
    out.append("%s -> %s" % (label, r))

# ---- Calling the types ----
def shown(v):
    if type(v).__name__ in ("enumerate", "zip", "map", "filter", "reversed", "list_reverseiterator", "range_iterator", "list_iterator", "tuple_iterator"): return (type(v).__name__, list(v))
    if isinstance(v, (set, frozenset)): return (type(v).__name__, sorted(v, key=repr))
    if isinstance(v, memoryview): return ("memoryview", bytes(v))
    if isinstance(v, BaseException): return (type(v).__name__, v.args)
    return v
TYPES = [int, float, bool, str, bytes, bytearray, complex, list, tuple, dict, set, frozenset, range, slice, enumerate, zip, map, filter, reversed, object, memoryview, property, staticmethod, classmethod,
         BaseException, Exception, OSError, KeyError, StopIteration, SystemExit, UnicodeDecodeError, ImportError, collections.deque, collections.defaultdict, collections.OrderedDict, collections.Counter, type(None), type(Ellipsis),
         type(NotImplemented), type(len), type(lambda: 0), type(iter([])), type(1 .__add__), super]
ARGS = [(), (0,), (3,), (-1,), ("12",), ("ab",), (b"ab",), ([1, 2],), ((1, 2),), ({1: 2},), (None,), (1.5,), (1, 2), (1, 5, 2), (1, 5, 0), ("ff", 16), (b"ab", "ascii"), (2, "No such file"), (2, "No such file", "name"), (13, "x"), (len, "ab"), (None, [0, 1]),
        ([1, 2], 5), ([(1, 2)],), (int,), (int, [(1, 2)]), ([3, 1, 2], 2), (1, 2, 3, 4), (1, 2, 3, 4, 5), ("utf-8", b"\xff", 0, 1, "bad"), (range(3),), (iter([1, 2]),), ("abc", "b"), (2 ** 70,), (True,)]
KW = [{"x": 1}, {"key": 1}, {"start": 1}, {"base": 2}, {"encoding": "ascii"}, {"maxlen": 2}, {"strict": True}, {"name": "n"}, {"a": 1, "b": 2}, {"fget": None}, {"real": 1}, {"object": "o"}, {"iterable": [1]}]
for t in TYPES:
    for n, a in enumerate(ARGS):
        rec("%s %d" % (t.__name__, n), lambda: shown(t(*a)))
    for n, k in enumerate(KW):
        rec("%s kw %d" % (t.__name__, n), lambda: shown(t(**k)))
        rec("%s kw1 %d" % (t.__name__, n), lambda: shown(t([1, 2], **k)))
rec("what __new__ makes", lambda: [type(v).__name__ for v in (OSError(2, "x"), OSError(13, "x"), OSError(17, "x"), OSError(1), OSError(), OSError(2, "x", "f", 0, "g"), OSError(11, "x"), OSError(32, "x"), bool(2), int(True), str(b"x"), tuple(()), frozenset())])
rec("the same object", lambda: (tuple(t := (1, 2)) is t, frozenset(f := frozenset({1})) is f, str(s := "ab") is s, bytes(b := b"ab") is b, int(i := 2 ** 70) is i, list(l := [1]) is l, dict(d := {}) is d))
class E(enumerate): pass
for t in (enumerate, E):
    for n, (a, k) in enumerate((((), dict(iterable=[], start=2, x=2)), (([],), dict(start=1, x=2)), (([], 1), dict(x=2)), (([], 1, 2), {}), ((), dict(a=1, b=2, c=3)), ((), dict(x=1)), ((), {}), ((), dict(start=1)), (([],), dict(iterable=[])),
                                ((), dict(start=1, iterable="ab")), ((), dict(iterable="ab", x=1)))):
        rec("%s names %d" % (t.__name__, n), lambda: list(t(*a, **k)))
import functools
for n, f in enumerate((lambda: type(1, a=1), lambda: type.__call__(type, 1, a=1), lambda: functools.partial(type, a=1)(1), lambda: type.__call__(type, 1), lambda: type(1, 2), lambda: type.__call__(type, 1, 2), lambda: type(), lambda: type(a=1),
                       lambda: type.__call__(type, a=1), lambda: list(map(type, [1])))):
    rec("type %d" % n, f)
# The two halves by themselves.
rec("new alone", lambda: (list.__new__(list, [1, 2]), dict.__new__(dict, a=1), set.__new__(set, [1]), bytearray.__new__(bytearray, 3), collections.deque.__new__(collections.deque, [1])))
def again():
    l = [1, 2, 3]; l.__init__("ab"); d = {1: 2}; d.__init__(a=1); s = {1}; s.__init__([2]); b = bytearray(b"x"); b.__init__(2); q = collections.deque([1]); q.__init__([2, 3], 1); l2 = [1]; l2.__init__()
    return l, d, s, b, q, l2
rec("init again", again)
class L(list):
    def __init__(self, *a): super().__init__(a)
class L2(list):
    def __new__(cls, *a): return super().__new__(cls)
class T(tuple):
    def __new__(cls, *a): return super().__new__(cls, a)
class I(int):
    def __init__(self, *a): self.seen = a
class D(dict): pass
class NoInit(list):
    __init__ = None
class ReturnsOther(list):
    def __new__(cls): return 5
class BadInit(list):
    def __init__(self): return 1
rec("derived", lambda: (L(1, 2), L2([1, 2]), T(1, 2), I(5).seen, I("7") + 1, D(a=1), D([(1, 2)]), ReturnsOther()))
rec("no init", NoInit); rec("bad init", BadInit)
rec("through C++", lambda: (list(map(int, "123")), list(map(list, ["ab", "c"])), list(map(range, [1, 2])), list(map(tuple, [[1], [2]])), sorted(map(str, [2, 1])), list(map(dict, [[(1, 2)]])), list(map(bool, [0, 1])), list(map(OSError, [1, 2]))[0].args))
def one_site(t, *a): return t(*a)
rec("one site", lambda: [shown(one_site(t, [1, 2])) for _ in range(2) for t in (list, tuple, set, L, frozenset, len, D.fromkeys, sorted, T, reversed, enumerate, str, bool, lambda x: x)])

# ---- range ----
BOUNDS = [0, 1, -1, 2, 3, 10, -10, 2 ** 31 - 1, -2 ** 31, 2 ** 31, 2 ** 32, 2 ** 53, 2 ** 63, -2 ** 63, 2 ** 70]
for a in BOUNDS:
    for b in BOUNDS:
        for s in (1, -1, 2, -3, 2 ** 31 - 1, -2 ** 31, 2 ** 40):
            r = range(a, b, s)
            try: n = len(r)
            except OverflowError: n = "overflow"
            out.append("range %d %d %d: %s %s %s" % (a, b, s, n, bool(r), (r[0], r[-1]) if r else ()))
rec("range values", lambda: [list(range(*a)) for a in ((0,), (3,), (-3,), (1, 4), (4, 1), (4, 1, -1), (0, 10, 3), (10, 0, -3), (2 ** 31 - 2, 2 ** 31 + 2), (-2 ** 31 - 2, -2 ** 31 + 2), (2 ** 53 - 1, 2 ** 53 + 2), (2 ** 63 - 1, 2 ** 63 + 2), (True, 3), (0, 2 ** 33, 2 ** 32))])
class Ix:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
rec("range of indexes", lambda: (range(Ix(1), Ix(7), Ix(2)), list(range(Ix(3))), len(range(Ix(2 ** 40)))))
rec("range loops", lambda: [sum(1 for _ in range(n)) for n in (0, 1, 2, 9, 10, 11, 100)])

# ---- Lists from what there is ----
SOURCES = [[], [1], [1, 2, 3], list(range(100)), (), (1,), tuple(range(50)), "", "abc", "a\xe9€\U0001f600", b"ab", bytearray(b"cd"), range(0), range(7), range(5, 0, -2), {1: 2, 3: 4}, {1: 2}.keys(), {1: 2}.values(), {1: 2}.items(), {5}, frozenset({6}),
           collections.deque([1, 2]), L(1, 2), T(3, 4), D(a=1), [None, True, 1.0, 2.5, 10 ** 30, "s", [1], (2,)], [[]] * 3]
for n, s in enumerate(SOURCES):
    rec("from %d" % n, lambda: (list(s), tuple(s), [*s], (*s,), [0, *s, 1], [x for x in s], sorted(s, key=repr), list(reversed(list(s))), list(iter(s)), list(x for x in s), [*s, *s], list(enumerate(s))[:3], list(zip(s, s))[:3]))
    def extend():
        l = [9]; l.extend(s); l += s; m = []; m.extend(s); m.extend(m); k = list(s); k += k; k.extend(k)
        return l, m, len(k), k[:5]
    rec("extend %d" % n, extend)
rec("copies", lambda: ((a := [1, [2]]) is not list(a), list(a)[1] is a[1], a[:] == a, a.copy() == a, list(a) == a))
def grows():
    l = []; sizes = []
    for n in range(0, 70, 7):
        l.extend(list(range(n))); sizes.append(len(l)); l.append(n); l += (n,); l.extend(x for x in range(3))
    return sizes, sum(l), len(l)
rec("grows", grows)
class Hint:
    def __init__(self, n, hint): self.n = n; self.hint = hint
    def __iter__(self): return self
    def __next__(self):
        if not self.n: raise StopIteration
        self.n -= 1; return self.n
    def __length_hint__(self):
        if isinstance(self.hint, BaseException): raise self.hint
        return self.hint
for hint in (0, 1, 5, 1000, 10 ** 6, -1, 2 ** 62, 2 ** 63, 2 ** 70, "x", None, NotImplemented, 1.5, True, TypeError("t"), ValueError("v")):
    rec("hint %r" % (hint,), lambda: (list(Hint(3, hint)), [*Hint(2, hint)], tuple(Hint(2, hint))))
class Shrinks(list):
    def __iter__(self): self.clear(); return iter((7, 8))
rec("derived source", lambda: (list(Shrinks([1, 2, 3])), [*Shrinks([1])], tuple(Shrinks([1]))))
def changes_while_copied():
    l = [1, 2, 3]
    def gen():
        for x in l:
            if len(l) < 6: l.append(x * 10)
            yield x
    return list(gen()), l
rec("changes", changes_while_copied)
def raises_midway():
    seen = []
    def gen():
        yield 1; yield 2; raise KeyError("stop")
    l = [0]
    try: l.extend(gen())
    except KeyError: seen.append(list(l))
    try: [x for x in gen()]
    except KeyError: seen.append("comprehension")
    try: [*gen(), 5]
    except KeyError: seen.append("display")
    return seen
rec("raises", raises_midway)

# ---- Comprehensions and displays ----
rec("comprehensions", lambda: ([x * 2 for x in range(5)], [x for x in range(10) if x % 3], [(x, y) for x in range(3) for y in range(x)], [[y for y in range(x)] for x in range(4)], [x for x in "abc"], [None for _ in range(3)], [1.0 for _ in range(2)],
                               [x for x in []], len([x for x in range(1000)]), sum([x for x in range(1000)]), [f for f in (len, abs)][1](-1), [(lambda v=x: v)() for x in range(3)], [x := y for y in range(3)][-1], [*range(3), *"ab", *[], *(1,)]))
rec("long", lambda: [len([i for i in range(n)]) for n in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 1000, 4097)])
async def acomp():
    async def agen():
        for i in range(3): yield i
    return [x async for x in agen()], [x + 1 async for x in agen() if x]
def run(c):
    try: c.send(None)
    except StopIteration as e: return e.value
rec("async", run, acomp())
def groups():
    try:
        try: raise ExceptionGroup("g", [ValueError(1), KeyError(2), TypeError(3)])
        except* ValueError as e: raise IndexError("from the handler")
        except* KeyError: pass
    except BaseException as e: return type(e).__name__, [type(x).__name__ for x in e.exceptions]
rec("except*", groups)

# ---- Sorting ----
random.seed(12345)
def check(label, l, **k):
    rec("sort " + label, lambda: (sorted(l, **k), sorted(l, reverse=True, **k)))
    def in_place():
        m = list(l); r = m.sort(**k); n = list(l); n.sort(reverse=True, **k); return r, m == sorted(l, **k), n == sorted(l, reverse=True, **k)
    rec("sort in place " + label, in_place)
nan = float("nan")
check("empty", []); check("one", [1]); check("two", [2, 1]); check("ints", [3, 1, 2, -5, 0, 2 ** 31 - 1, -2 ** 31, 7, 7, 3])
check("wide ints", [2 ** 31, -2 ** 31 - 1, 2 ** 53, 5, -2 ** 53, 2 ** 40, 0]); check("big ints", [2 ** 70, 1, -2 ** 70, 2 ** 64, 2 ** 63, 3]); check("floats", [2.5, -1.5, 0.25, 1e300, -1e300, 1e-300, float("inf"), float("-inf")])
check("whole floats", [2.0, 1.0, 3.0, -0.0, 0.0]); check("mixed numbers", [2, 1.5, 1, 2.5, 0, -0.5, 1.0, True, False, 2 ** 70, 3.0]); check("bools", [True, False, True]); check("nan", [3.5, nan, 1.5, nan, 2.5, 0.5, nan, -1.5])
check("nan and ints", [3, nan, 1, 2, nan, 0]); check("strs", ["b", "a", "", "ab", "B", "aa", "\xe9", "z"]); check("wide strs", ["€", "a", "\U0001f600", "퟿", "￿", "\xff", "Ā", "ab€", "ab"])
check("ropes", ["a" * 20 + str(i % 3) + "b" * 20 for i in range(7)]); check("tuples", [(2, "a"), (1, "b"), (2,), (1, "a"), (), (1,)]); check("lists", [[2], [1, 2], [], [1]]); check("bytes", [b"b", b"a", b""]); check("none", [None])
check("unorderable", [1, "a"]); check("unorderable later", [1, 2, 3, None]); check("strs and a number", ["a", "b", 1]); check("key", ["bb", "a", "ccc", "dd"], key=len); check("key neg", [3, 1, 2], key=lambda v: -v); check("key none", [3, 1, 2], key=None)
check("key str", [10, 9, 100, 1], key=str); check("key raises", [1, 0, 2], key=lambda v: 1 // v)
for n in (5, 31, 63, 64, 65, 100, 127, 128, 129, 500, 1000, 3000):
    kinds = {"random": [random.randrange(n * 2) for _ in range(n)], "few": [random.randrange(4) for _ in range(n)], "up": list(range(n)), "down": list(range(n, 0, -1)), "saw": [i % 17 for i in range(n)], "nearly": [i if i % 50 else n - i for i in range(n)],
             "two runs": list(range(0, n, 2)) + list(range(1, n, 2)), "floats": [random.random() for _ in range(n)], "strs": [str(random.randrange(n)) for _ in range(n)], "mixed": [random.choice((1, 2.5, 3, 0.5)) * i for i in range(n)],
             "with nan": [nan if i % 13 == 5 else random.randrange(n) + 0.5 for i in range(n)], "organ": list(range(n // 2)) + list(range(n // 2, 0, -1))}
    for name, l in kinds.items():
        def digest(l=l):
            a, b = sorted(l), sorted(l, reverse=True)
            h = 0
            for i, v in enumerate(a + b): h = (h * 31 + (hash(repr(v)[:0]) or 0) + sum(map(ord, repr(v))) * (i + 1)) % (2 ** 61 - 1)
            return h, a[:3], a[-3:], b[:3]
        rec("sort %d %s" % (n, name), digest)
# Equal items keep their order.
class Tag(int):
    def __new__(cls, v, tag): self = super().__new__(cls, v); self.tag = tag; return self
rec("stable", lambda: ([(int(v), v.tag) for v in sorted([Tag(i % 3, i) for i in range(12)])], [(int(v), v.tag) for v in sorted([Tag(i % 3, i) for i in range(12)], reverse=True)]))
def stable_plain():
    l = ["a" + "b" * i for i in (1, 1, 0, 1)]
    return [v is w for v, w in zip(sorted(l), [l[2], l[0], l[1], l[3]])]
rec("stable, plain", stable_plain)
def sees_the_list():
    l = []; seen = []
    class C:
        def __init__(self, v): self.v = v
        def __lt__(self, o): seen.append(len(l)); return self.v < o.v
    l.extend(C(i) for i in (3, 1, 2)); l.sort(); return seen, [c.v for c in l]
rec("empty meanwhile", sees_the_list)
def modified():
    l = []
    class C:
        def __lt__(self, o): l.append(1); return False
    l.extend([C(), C()]); l.sort()
rec("modified", modified)
class SL(list): pass
def derived_sort():
    l = SL([3, 1, 2]); l.sort(); m = SL("cab"); m.sort(reverse=True); return l, m, type(sorted(l)).__name__
rec("derived list", derived_sort)
print("\n".join(out))
print(len(out))
