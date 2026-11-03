try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

# Ordinary recursion.
try:
    def fact(n): return 1 if n <= 1 else n * fact(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fact(n): return 1 if n <= 1 else n * fact(n - 1)')
try:
    def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)')
try:
    def ack(m, n): return n + 1 if m == 0 else ack(m - 1, 1) if n == 0 else ack(m - 1, ack(m, n - 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ack(m, n): return n + 1 if m == 0 else ack(m - 1, 1) if n == 0 el...')
try:
    def gcd(a, b): return a if b == 0 else gcd(b, a % b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gcd(a, b): return a if b == 0 else gcd(b, a % b)')
try:
    def depth(n): return 0 if n == 0 else 1 + depth(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def depth(n): return 0 if n == 0 else 1 + depth(n - 1)')
try:
    def hanoi(n, a="A", b="B", c="C"): return [] if n == 0 else hanoi(n - 1, a, c, b) + [(a, c)] + hanoi(n - 1, b, a, c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def hanoi(n, a="A", b="B", c="C"): return [] if n == 0 else hanoi(n -...')
try:
    def perms(s): return [s] if len(s) <= 1 else [c + p for i, c in enumerate(s) for p in perms(s[:i] + s[i + 1:])]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def perms(s): return [s] if len(s) <= 1 else [c + p for i, c in enume...')
try:
    def flatten(x): return [y for e in x for y in flatten(e)] if isinstance(x, list) else [x]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def flatten(x): return [y for e in x for y in flatten(e)] if isinstan...')
try:
    def is_even(n): return True if n == 0 else is_odd(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def is_even(n): return True if n == 0 else is_odd(n - 1)')
try:
    def is_odd(n): return False if n == 0 else is_even(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def is_odd(n): return False if n == 0 else is_even(n - 1)')
try:
    def power_set(s): return [[]] if not s else [x + y for x in ([], [s[0]]) for y in power_set(s[1:])]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def power_set(s): return [[]] if not s else [x + y for x in ([], [s[0...')
try: print('fact(20) =>', fact(20))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fact(20)')
try: print('fact(100) % 10 ** 9 =>', fact(100) % 10 ** 9)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fact(100) % 10 ** 9')
try: print('fib(15) =>', fib(15))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fib(15)')
try: print('ack(2, 3) =>', ack(2, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ack(2, 3)')
try: print('gcd(1071, 462) =>', gcd(1071, 462))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gcd(1071, 462)')
try: print('depth(150) =>', depth(150))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth(150)')
try: print('len(hanoi(6)) =>', len(hanoi(6)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(hanoi(6))')
try: print('hanoi(2) =>', hanoi(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hanoi(2)')
try: print('perms("abc") =>', perms("abc"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: perms("abc")')
try: print('flatten([1, [2, [3, [4, [5]]]], []]) =>', flatten([1, [2, [3, [4, [5]]]], []]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: flatten([1, [2, [3, [4, [5]]]], []])')
try: print('is_even(100) =>', is_even(100))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: is_even(100)')
try: print('is_odd(101) =>', is_odd(101))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: is_odd(101)')
try: print('power_set([1, 2, 3]) =>', power_set([1, 2, 3]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: power_set([1, 2, 3])')
try: Y = lambda f: (lambda x: x(x))(lambda x: f(lambda *a: x(x)(*a)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Y = lambda f: (lambda x: x(x))(lambda x: f(lambda *a: x(x)(*a)))')
try: print(Y(lambda f: lambda n: 1 if n == 0 else n * f(n - 1))(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Y(lambda f: lambda n: 1 if n == 0 else n * f(n - 1))(10)')
try:
    class Node:
        def __init__(s, v, *kids): s.v = v; s.kids = kids
        def total(s): return s.v + sum(k.total() for k in s.kids)
        def height(s): return 1 + max((k.height() for k in s.kids), default=0)
        def __repr__(s): return "N(%r%s)" % (s.v, "".join(", %r" % k for k in s.kids))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Node:')
try: tree = Node(1, Node(2, Node(4), Node(5, Node(8))), Node(3, Node(6), Node(7)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tree = Node(1, Node(2, Node(4), Node(5, Node(8))), Node(3, Node(6), N...')
try: print('tree.total() =>', tree.total())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tree.total()')
try: print('tree.height() =>', tree.height())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tree.height()')
try: print('tree =>', tree)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tree')
try:
    def memo_fib(n, cache={}):
        if n < 2: return n
        if n not in cache: cache[n] = memo_fib(n - 1) + memo_fib(n - 2)
        return cache[n]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def memo_fib(n, cache={}):')
try: print(memo_fib(150))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: memo_fib(150)')
try:
    def gen_rec(n):
        if n: yield n; yield from gen_rec(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen_rec(n):')
try: print(sum(gen_rec(100)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(gen_rec(100))')
# The limit.
try: print('type(sys.getrecursionlimit()).__name__ =>', type(sys.getrecursionlimit()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(sys.getrecursionlimit()).__name__')
try: print('sys.getrecursionlimit() =>', sys.getrecursionlimit())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.getrecursionlimit()')
try: print('sys.setrecursionlimit(0) =>', end=" "); t(lambda: sys.setrecursionlimit(0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys.setrecursionlimit(0))')
try: print('sys.setrecursionlimit(-1) =>', end=" "); t(lambda: sys.setrecursionlimit(-1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys.setrecursionlimit(-1))')
try: print('sys.setrecursionlimit("a") =>', end=" "); t(lambda: sys.setrecursionlimit("a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys.setrecursionlimit("a"))')
try: print('sys.setrecursionlimit(1.5) =>', end=" "); t(lambda: sys.setrecursionlimit(1.5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys.setrecursionlimit(1.5))')
try: print('sys.setrecursionlimit() =>', end=" "); t(lambda: sys.setrecursionlimit())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys.setrecursionlimit())')
try: print('sys.setrecursionlimit(2 ** 70) =>', end=" "); t(lambda: sys.setrecursionlimit(2 ** 70))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys.setrecursionlimit(2 ** 70))')
try: print('sys.getrecursionlimit(1) =>', end=" "); t(lambda: sys.getrecursionlimit(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys.getrecursionlimit(1))')
try:
    def inf(n=0): return inf(n + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inf(n=0): return inf(n + 1)')
try: print('inf() =>', end=" "); t(inf)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(inf)')
try:
    try: inf()
    except RecursionError as e: print(type(e).__mro__[1].__name__, e.args, isinstance(e, RuntimeError))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: inf()')
try: print("still working after a RecursionError", 'depth(100) =>', depth(100))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth(100)')
try:
    for _ in range(3):
        try: inf()
        except RecursionError: print("caught again", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(3):')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    def count_depth():
        n = 0
        def go():
            nonlocal n
            n += 1; go()
        try: go()
        except RecursionError: pass
        return n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def count_depth():')
try: old = sys.getrecursionlimit()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: old = sys.getrecursionlimit()')
try: sys.setrecursionlimit(200)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.setrecursionlimit(200)')
try: a = count_depth()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = count_depth()')
try: sys.setrecursionlimit(300)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.setrecursionlimit(300)')
try: b = count_depth()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b = count_depth()')
try: sys.setrecursionlimit(old)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.setrecursionlimit(old)')
try: print('b - a =>', b - a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b - a')
try: print('150 < a < 200 =>', 150 < a < 200)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 150 < a < 200')
try: print('sys.getrecursionlimit() == old =>', sys.getrecursionlimit() == old)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.getrecursionlimit() == old')
try: sys.setrecursionlimit(100)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.setrecursionlimit(100)')
try: print('depth(50) =>', end=" "); t(lambda: depth(50))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: depth(50))')
try: print('depth(150) =>', end=" "); t(lambda: depth(150))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: depth(150))')
try: sys.setrecursionlimit(old)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.setrecursionlimit(old)')
try: print(depth(150))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth(150)')
try:
    def low():
        def nest(n):
            if n: return nest(n - 1)
            sys.setrecursionlimit(5)
        try: nest(20)
        finally: sys.setrecursionlimit(old)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def low():')
try: print('low() =>', end=" "); t(low)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(low)')
# finally blocks and handlers run while unwinding.
try:
    def with_finally(n, log):
        try: return with_finally(n + 1, log)
        finally:
            if n < 3: log.append(n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with_finally(n, log):')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
    try: with_finally(0, log)
    except RecursionError: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: with_finally(0, log)')
try:
    def catch_deep(n=0):
        try: return catch_deep(n + 1)
        except RecursionError: return "caught somewhere deep"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def catch_deep(n=0):')
try: print(catch_deep())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: catch_deep()')
# Unbounded recursion through special methods and other indirect routes.
try:
    class GA:
        def __getattr__(s, n): return s.other
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class GA:')
try:
    class RP:
        def __repr__(s): return repr(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class RP:')
try:
    class ST:
        def __str__(s): return str(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ST:')
try:
    class EQ:
        def __eq__(s, o): return s == o
        __hash__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class EQ:')
try:
    class CL:
        def __call__(s): return s()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CL:')
try:
    class GI:
        def __getitem__(s, k): return s[k]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class GI:')
try:
    class AD:
        def __add__(s, o): return s + o
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AD:')
try:
    class IT:
        def __iter__(s): return iter(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class IT:')
try:
    class LN:
        def __len__(s): return len(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class LN:')
try:
    class BL:
        def __bool__(s): return bool(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BL:')
try:
    class HS:
        def __hash__(s): return hash(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class HS:')
try:
    class IN:
        def __init__(s): IN()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class IN:')
try:
    class PR:
        @property
        def p(s): return s.p
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class PR:')
try:
    class CT:
        def __contains__(s, v): return v in s
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CT:')
try:
    class FM:
        def __format__(s, f): return format(s, f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class FM:')
try:
    class EN:
        def __enter__(s):
            with s: pass
        def __exit__(s, *a): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class EN:')
try:
    class SA:
        def __setattr__(s, n, v): setattr(s, n, v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SA:')
try:
    class LT:
        def __lt__(s, o): return s < o
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class LT:')
try:
    class IX:
        def __index__(s): return [0][s]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class IX:')
try:
    for name, f in (("getattr", lambda: GA().x), ("repr", lambda: repr(RP())), ("str", lambda: str(ST())), ("eq", lambda: EQ() == 1), ("call", lambda: CL()()), ("getitem", lambda: GI()[0]), ("add", lambda: AD() + 1), ("iter", lambda: iter(IT())), ("len", lambda: len(LN())), ("bool", lambda: bool(BL())), ("hash", lambda: hash(HS())), ("init", lambda: IN()), ("property", lambda: PR().p), ("contains", lambda: 1 in CT()), ("format", lambda: format(FM())), ("with", lambda: EN().__enter__()), ("setattr", lambda: setattr(SA(), "a", 1)), ("lt", lambda: LT() < 1), ("index", lambda: [0][IX()]), ("lambda", lambda: (lambda f: f(f))(lambda f: f(f))), ("map", lambda: (m := lambda x: list(map(m, [x])))(1)), ("sorted key", lambda: (k := lambda x: sorted([x], key=k))(1)), ("comprehension", lambda: (c := lambda: [c() for _ in range(1)])()), ("genexpr", lambda: (g := lambda: list(g() for _ in range(1)))()), ("eval", lambda: eval("r()", {"r": (r := lambda: eval("r()", {"r": r}))})), ("getattr builtin", lambda: (ga := lambda: getattr(type("X", (), {"p": property(lambda s: ga())})(), "p"))()), ("class body", lambda: (cb := lambda: type("X", (), {"v": cb()}))()), ("method", lambda: type("X", (), {"m": lambda s: s.m()})().m()), ("classmethod", lambda: type("X", (), {"m": classmethod(lambda c: c.m())}).m()), ("super", lambda: type("Y", (type("X", (), {"m": lambda s: s.m()}),), {}) ().m()), ("decorator", lambda: (d := lambda f: d(f))(1)), ("generator", lambda: (gr := lambda: (yield from gr()))().__next__() if False else list((lambda: (yield from inf_gen()))()))):
        try: f(); print(name, "no error?")
        except RecursionError as e: print(name, "RecursionError", end="; ")
        except NameError as e: print(name, "NameError", e, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, f in (("getattr", lambda: GA().x), ("repr", lambda: repr(RP...')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    def inf_gen(): yield from inf_gen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inf_gen(): yield from inf_gen()')
try: print('next(inf_gen()) =>', end=" "); t(lambda: next(inf_gen()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(inf_gen()))')
# Self-referential containers print with an ellipsis instead of recursing.
try: l = [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = [1]')
try: l.append(l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l.append(l)')
try: print('l =>', l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: print('repr(l) =>', repr(l))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(l)')
try: print('str(l) =>', str(l))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(l)')
try: print('len(l) =>', len(l))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(l)')
try: print('l[1] is l =>', l[1] is l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l[1] is l')
try: print('l[1][1][1][0] =>', l[1][1][1][0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l[1][1][1][0]')
try: d = {"k": 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = {"k": 1}')
try: d["self"] = d
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d["self"] = d')
try: print(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')
try: tp = ([],)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp = ([],)')
try: tp[0].append(tp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp[0].append(tp)')
try: print(tp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp')
try: l2 = [[]]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l2 = [[]]')
try: l2[0].append(l2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l2[0].append(l2)')
try: print(l2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l2')
try: a = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = []')
try: b = [a]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b = [a]')
try: a.append(b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.append(b)')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: print('b =>', b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b')
try: dd = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dd = {}')
try: dl = [dd]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dl = [dd]')
try: dd["l"] = dl
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dd["l"] = dl')
try: print('dd =>', dd)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dd')
try: print('dl =>', dl)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dl')
try: s = [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = [1]')
try: st_ = {"a": s}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st_ = {"a": s}')
try: s.append(st_)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.append(st_)')
try: print('s =>', s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s')
try: print('f"{s}" =>', f"{s}")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f"{s}"')
try: print('"%s" % (s,) =>', "%s" % (s,))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "%s" % (s,)')
try: print('"{}".format(s) =>', "{}".format(s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "{}".format(s)')
try: dv = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dv = {}')
try: dv["v"] = dv.values()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dv["v"] = dv.values()')
try: print(dv)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dv')
try: dk = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dk = {}')
try: dk["i"] = dk.items()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dk["i"] = dk.items()')
try: print(dk)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dk')
try:
    class LS(list): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class LS(list): pass')
try: ls = LS()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ls = LS()')
try: ls.append(ls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ls.append(ls)')
try: print(ls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ls')
try: ba = [1, 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba = [1, 2]')
try: ba[0] = ba
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba[0] = ba')
try: ba[1] = ba
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba[1] = ba')
try: print(ba)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba')
try:
    def tn(f):
        try: print(repr(f()), end="; ")
        except Exception as e: print(type(e).__name__, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tn(f):')
try: tn(lambda: l == l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tn(lambda: l == l)')
try: tn(lambda: l == [1, l])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tn(lambda: l == [1, l])')
try: l3 = [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l3 = [1]')
try: l3.append(l3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l3.append(l3)')
try: tn(lambda: l == l3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tn(lambda: l == l3)')
try: tn(lambda: l < l3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tn(lambda: l < l3)')
try: tn(lambda: d == d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tn(lambda: d == d)')
try: d3 = {"k": 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d3 = {"k": 1}')
try: d3["self"] = d3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d3["self"] = d3')
try: tn(lambda: d == d3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tn(lambda: d == d3)')
try: tn(lambda: hash(tp))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tn(lambda: hash(tp))')
try: tn(lambda: l in l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tn(lambda: l in l)')
try: tn(lambda: l.count(l))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tn(lambda: l.count(l))')
try: tn(lambda: l.index(l))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tn(lambda: l.index(l))')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
# Deeply nested data built at run time.
try: deep = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: deep = []')
try:
    for _ in range(100): deep = [deep]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(100): deep = [deep]')
try: print('repr(deep) == "[" * 101 + "]" * 101 =>', repr(deep) == "[" * 101 + "]" * 101)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(deep) == "[" * 101 + "]" * 101')
try: print('deep == eval(repr(deep)) =>', deep == eval(repr(deep)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: deep == eval(repr(deep))')
try: print('len(str(deep)) =>', len(str(deep)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(str(deep))')
try:
    def survives(what, f):
        "Either an answer or a RecursionError is fine; a crash is not."
        try: f()
        except RecursionError: pass
        print("survived", what)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def survives(what, f):')
try: very_deep = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: very_deep = []')
try:
    for _ in range(100000): very_deep = [very_deep]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(100000): very_deep = [very_deep]')
try: vd2 = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vd2 = []')
try:
    for _ in range(100000): vd2 = [vd2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(100000): vd2 = [vd2]')
try: vt = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vt = ()')
try:
    for _ in range(100000): vt = (vt,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(100000): vt = (vt,)')
try: survives("repr of a deep list", lambda: repr(very_deep))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: survives("repr of a deep list", lambda: repr(very_deep))')
try: survives("comparison of deep lists", lambda: very_deep == vd2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: survives("comparison of deep lists", lambda: very_deep == vd2)')
try: survives("hash of a deep tuple", lambda: hash(vt))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: survives("hash of a deep tuple", lambda: hash(vt))')
try: survives("repr of a deep tuple", lambda: repr(vt))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: survives("repr of a deep tuple", lambda: repr(vt))')
try: survives("str of a deep list", lambda: str(very_deep))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: survives("str of a deep list", lambda: str(very_deep))')
try: survives("ordering of deep lists", lambda: very_deep < vd2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: survives("ordering of deep lists", lambda: very_deep < vd2)')
# Taking such structures apart iteratively keeps their destruction from recursing.
try:
    while very_deep: very_deep = very_deep[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while very_deep: very_deep = very_deep[0]')
try:
    while vd2: vd2 = vd2[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while vd2: vd2 = vd2[0]')
try:
    while vt: vt = vt[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while vt: vt = vt[0]')
try: print('eval("(" * 150 + "1" + ")" * 150) =>', end=" "); t(lambda: eval("(" * 150 + "1" + ")" * 150))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: eval("(" * 150 + "1" + ")" * 150))')
try: t(lambda: eval("-" * 5000 + "1")) if False else None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: eval("-" * 5000 + "1")) if False else None')
try: print('compile("[" * 5000 + "]" * 5000, "<s>", "eval") =>', end=" "); t(lambda: compile("[" * 5000 + "]" * 5000, "<s>", "eval"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: compile("[" * 5000 + "]" * 5000, "<s>", "eval"))')
try: print('compile("x" + ".a" * 20000, "<s>", "eval") and "long attribute chains... =>', end=" "); t(lambda: compile("x" + ".a" * 20000, "<s>", "eval") and "long attribute chains are iterative")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: compile("x" + ".a" * 20000, "<s>", "eval") and "long attrib...')
try: print('compile("+".join(["1"] * 20000), "<s>", "eval") and "long sums compile" =>', end=" "); t(lambda: compile("+".join(["1"] * 20000), "<s>", "eval") and "long sums compile")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: compile("+".join(["1"] * 20000), "<s>", "eval") and "long s...')
try: print("done")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "done"')
