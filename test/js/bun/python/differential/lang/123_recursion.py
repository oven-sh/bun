import sys
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

# Ordinary recursion.
def fact(n): return 1 if n <= 1 else n * fact(n - 1)
def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)
def ack(m, n): return n + 1 if m == 0 else ack(m - 1, 1) if n == 0 else ack(m - 1, ack(m, n - 1))
def gcd(a, b): return a if b == 0 else gcd(b, a % b)
def depth(n): return 0 if n == 0 else 1 + depth(n - 1)
def hanoi(n, a="A", b="B", c="C"): return [] if n == 0 else hanoi(n - 1, a, c, b) + [(a, c)] + hanoi(n - 1, b, a, c)
def perms(s): return [s] if len(s) <= 1 else [c + p for i, c in enumerate(s) for p in perms(s[:i] + s[i + 1:])]
def flatten(x): return [y for e in x for y in flatten(e)] if isinstance(x, list) else [x]
def is_even(n): return True if n == 0 else is_odd(n - 1)
def is_odd(n): return False if n == 0 else is_even(n - 1)
def power_set(s): return [[]] if not s else [x + y for x in ([], [s[0]]) for y in power_set(s[1:])]
print(fact(20), fact(100) % 10 ** 9, fib(15), ack(2, 3), gcd(1071, 462), depth(150), len(hanoi(6)), hanoi(2), perms("abc"), flatten([1, [2, [3, [4, [5]]]], []]), is_even(100), is_odd(101), power_set([1, 2, 3]))
Y = lambda f: (lambda x: x(x))(lambda x: f(lambda *a: x(x)(*a))); print(Y(lambda f: lambda n: 1 if n == 0 else n * f(n - 1))(10))
class Node:
    def __init__(s, v, *kids): s.v = v; s.kids = kids
    def total(s): return s.v + sum(k.total() for k in s.kids)
    def height(s): return 1 + max((k.height() for k in s.kids), default=0)
    def __repr__(s): return "N(%r%s)" % (s.v, "".join(", %r" % k for k in s.kids))
tree = Node(1, Node(2, Node(4), Node(5, Node(8))), Node(3, Node(6), Node(7))); print(tree.total(), tree.height(), tree)
def memo_fib(n, cache={}):
    if n < 2: return n
    if n not in cache: cache[n] = memo_fib(n - 1) + memo_fib(n - 2)
    return cache[n]
print(memo_fib(150))
def gen_rec(n):
    if n: yield n; yield from gen_rec(n - 1)
print(sum(gen_rec(100)))
# The limit.
print(type(sys.getrecursionlimit()).__name__, sys.getrecursionlimit())
t(lambda: sys.setrecursionlimit(0)); t(lambda: sys.setrecursionlimit(-1)); t(lambda: sys.setrecursionlimit("a")); t(lambda: sys.setrecursionlimit(1.5)); t(lambda: sys.setrecursionlimit()); t(lambda: sys.setrecursionlimit(2 ** 70)); t(lambda: sys.getrecursionlimit(1))
def inf(n=0): return inf(n + 1)
t(inf)
try: inf()
except RecursionError as e: print(type(e).__mro__[1].__name__, e.args, isinstance(e, RuntimeError))
print("still working after a RecursionError", depth(100))
for _ in range(3):
    try: inf()
    except RecursionError: print("caught again", end="; ")
print()
def count_depth():
    n = 0
    def go():
        nonlocal n
        n += 1; go()
    try: go()
    except RecursionError: pass
    return n
old = sys.getrecursionlimit()
sys.setrecursionlimit(200); a = count_depth(); sys.setrecursionlimit(300); b = count_depth(); sys.setrecursionlimit(old)
print(b - a, 150 < a < 200, sys.getrecursionlimit() == old)
sys.setrecursionlimit(100); t(lambda: depth(50)); t(lambda: depth(150)); sys.setrecursionlimit(old); print(depth(150))
def low():
    def nest(n):
        if n: return nest(n - 1)
        sys.setrecursionlimit(5)
    try: nest(20)
    finally: sys.setrecursionlimit(old)
t(low)
# finally blocks and handlers run while unwinding.
def with_finally(n, log):
    try: return with_finally(n + 1, log)
    finally:
        if n < 3: log.append(n)
log = []
try: with_finally(0, log)
except RecursionError: print(log)
def catch_deep(n=0):
    try: return catch_deep(n + 1)
    except RecursionError: return "caught somewhere deep"
print(catch_deep())
# Unbounded recursion through special methods and other indirect routes.
class GA:
    def __getattr__(s, n): return s.other
class RP:
    def __repr__(s): return repr(s)
class ST:
    def __str__(s): return str(s)
class EQ:
    def __eq__(s, o): return s == o
    __hash__ = None
class CL:
    def __call__(s): return s()
class GI:
    def __getitem__(s, k): return s[k]
class AD:
    def __add__(s, o): return s + o
class IT:
    def __iter__(s): return iter(s)
class LN:
    def __len__(s): return len(s)
class BL:
    def __bool__(s): return bool(s)
class HS:
    def __hash__(s): return hash(s)
class IN:
    def __init__(s): IN()
class PR:
    @property
    def p(s): return s.p
class CT:
    def __contains__(s, v): return v in s
class FM:
    def __format__(s, f): return format(s, f)
class EN:
    def __enter__(s):
        with s: pass
    def __exit__(s, *a): pass
class SA:
    def __setattr__(s, n, v): setattr(s, n, v)
class LT:
    def __lt__(s, o): return s < o
class IX:
    def __index__(s): return [0][s]
for name, f in (("getattr", lambda: GA().x), ("repr", lambda: repr(RP())), ("str", lambda: str(ST())), ("eq", lambda: EQ() == 1), ("call", lambda: CL()()), ("getitem", lambda: GI()[0]), ("add", lambda: AD() + 1), ("iter", lambda: iter(IT())), ("len", lambda: len(LN())), ("bool", lambda: bool(BL())), ("hash", lambda: hash(HS())), ("init", lambda: IN()), ("property", lambda: PR().p), ("contains", lambda: 1 in CT()), ("format", lambda: format(FM())), ("with", lambda: EN().__enter__()), ("setattr", lambda: setattr(SA(), "a", 1)), ("lt", lambda: LT() < 1), ("index", lambda: [0][IX()]), ("lambda", lambda: (lambda f: f(f))(lambda f: f(f))), ("map", lambda: (m := lambda x: list(map(m, [x])))(1)), ("sorted key", lambda: (k := lambda x: sorted([x], key=k))(1)), ("comprehension", lambda: (c := lambda: [c() for _ in range(1)])()), ("genexpr", lambda: (g := lambda: list(g() for _ in range(1)))()), ("eval", lambda: eval("r()", {"r": (r := lambda: eval("r()", {"r": r}))})), ("getattr builtin", lambda: (ga := lambda: getattr(type("X", (), {"p": property(lambda s: ga())})(), "p"))()), ("class body", lambda: (cb := lambda: type("X", (), {"v": cb()}))()), ("method", lambda: type("X", (), {"m": lambda s: s.m()})().m()), ("classmethod", lambda: type("X", (), {"m": classmethod(lambda c: c.m())}).m()), ("super", lambda: type("Y", (type("X", (), {"m": lambda s: s.m()}),), {}) ().m()), ("decorator", lambda: (d := lambda f: d(f))(1)), ("generator", lambda: (gr := lambda: (yield from gr()))().__next__() if False else list((lambda: (yield from inf_gen()))()))):
    try: f(); print(name, "no error?")
    except RecursionError as e: print(name, "RecursionError", end="; ")
    except NameError as e: print(name, "NameError", e, end="; ")
print()
def inf_gen(): yield from inf_gen()
t(lambda: next(inf_gen()))
# Self-referential containers print with an ellipsis instead of recursing.
l = [1]; l.append(l); print(l, repr(l), str(l), len(l), l[1] is l, l[1][1][1][0])
d = {"k": 1}; d["self"] = d; print(d)
tp = ([],); tp[0].append(tp); print(tp)
l2 = [[]]; l2[0].append(l2); print(l2)
a = []; b = [a]; a.append(b); print(a, b)
dd = {}; dl = [dd]; dd["l"] = dl; print(dd, dl)
s = [1]; st_ = {"a": s}; s.append(st_); print(s, f"{s}", "%s" % (s,), "{}".format(s))
dv = {}; dv["v"] = dv.values(); print(dv); dk = {}; dk["i"] = dk.items(); print(dk)
class LS(list): pass
ls = LS(); ls.append(ls); print(ls)
ba = [1, 2]; ba[0] = ba; ba[1] = ba; print(ba)
def tn(f):
    try: print(repr(f()), end="; ")
    except Exception as e: print(type(e).__name__, end="; ")
tn(lambda: l == l); tn(lambda: l == [1, l]); l3 = [1]; l3.append(l3); tn(lambda: l == l3); tn(lambda: l < l3); tn(lambda: d == d); d3 = {"k": 1}; d3["self"] = d3; tn(lambda: d == d3); tn(lambda: hash(tp)); tn(lambda: l in l); tn(lambda: l.count(l)); tn(lambda: l.index(l)); print()
# Deeply nested data built at run time.
deep = []
for _ in range(100): deep = [deep]
print(repr(deep) == "[" * 101 + "]" * 101, deep == eval(repr(deep)), len(str(deep)))
def survives(what, f):
    "Either an answer or a RecursionError is fine; a crash is not."
    try: f()
    except RecursionError: pass
    print("survived", what)
very_deep = []
for _ in range(100000): very_deep = [very_deep]
vd2 = []
for _ in range(100000): vd2 = [vd2]
vt = ()
for _ in range(100000): vt = (vt,)
survives("repr of a deep list", lambda: repr(very_deep)); survives("comparison of deep lists", lambda: very_deep == vd2); survives("hash of a deep tuple", lambda: hash(vt)); survives("repr of a deep tuple", lambda: repr(vt)); survives("str of a deep list", lambda: str(very_deep)); survives("ordering of deep lists", lambda: very_deep < vd2)
# Taking such structures apart iteratively keeps their destruction from recursing.
while very_deep: very_deep = very_deep[0]
while vd2: vd2 = vd2[0]
while vt: vt = vt[0]
t(lambda: eval("(" * 150 + "1" + ")" * 150)); t(lambda: eval("-" * 5000 + "1")) if False else None
t(lambda: compile("[" * 5000 + "]" * 5000, "<s>", "eval")); t(lambda: compile("x" + ".a" * 20000, "<s>", "eval") and "long attribute chains are iterative"); t(lambda: compile("+".join(["1"] * 20000), "<s>", "eval") and "long sums compile")
print("done")
