def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

def g():
    print("start", end="; ")
    yield 1
    print("middle", end="; ")
    yield 2
    print("end", end="; ")
it = g(); print(type(it).__name__, iter(it) is it)
print(next(it)); print(next(it)); t(lambda: next(it)); t(lambda: next(it)); print(next(it, "default"))
print(list(g())); print([x for x in g()]); print(sum(g()), max(g()), tuple(g()), 2 in g(), 5 in g())
a, b = g(); print(a, b); print(*g()); print(dict(zip(g(), g())))
def empty():
    return
    yield
def only_return():
    if False: yield
    return "value"
print(list(empty()), list(only_return()))
try: next(only_return())
except StopIteration as e: print(repr(e), e.value, e.args)
try: next(empty())
except StopIteration as e: print(repr(e), e.value, e.args)
def ret_tuple():
    yield 1
    return 1, 2
r = ret_tuple(); next(r)
try: next(r)
except StopIteration as e: print(repr(e), e.value, e.args)
def ret_exc():
    yield
    return ValueError("returned, not raised")
r = ret_exc(); next(r)
try: next(r)
except StopIteration as e: print(repr(e), repr(e.value))
def count(n):
    i = 0
    while i < n:
        yield i
        i += 1
print(list(count(5)), list(count(0)), sum(count(100)), list(zip(count(3), count(10))), list(map(lambda v: v * 2, count(3))), list(enumerate(count(2))), sorted(count(3), reverse=True), list(filter(None, count(3))), any(count(2)), all(count(2)), min(count(3)), "".join(str(v) for v in count(3)), [*count(2), *count(2)], {*count(3)}, {k: k for k in count(2)})
def fib():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b
f = fib(); print([next(f) for _ in range(15)])
def take(n, it):
    for _, v in zip(range(n), it): yield v
print(list(take(5, fib())), list(take(3, take(10, fib()))))
# Arguments and locals are kept between resumptions; the body does not start until the first next().
def lazy(x): print("body runs with", x, end="; "); yield x
l = lazy(1); print("created"); print(next(l))
def args(a, b=2, *c, d, **e): yield (a, b, c, d, e)
print(next(args(1, d=4)), next(args(1, 2, 3, d=4, z=5))); t(lambda: args()); t(lambda: args(1)); t(lambda: args(1, d=1, a=2))
def state():
    total = 0
    for i in range(3):
        total += i
        yield total, i, sorted(locals())
print(list(state()))
g1, g2 = count(3), count(3); print(next(g1), next(g1), next(g2), next(g1), next(g2))
# yield as an expression.
def echo():
    r = yield "first"
    while True: r = yield ("got", r)
e = echo(); print(next(e), next(e), e.send(5), e.send(None), e.send((1, 2)))
def exprs():
    x = yield
    y = (yield) or "dflt"
    z = [(yield 1), (yield 2)]
    w = (yield 3) + (yield 4)
    print((yield 5), end="; ")
    v = yield (yield 6)
    u = f"{(yield 7)}"
    d = {(yield 8): (yield 9)}
    s = yield 10, 11
    q = yield
    return x, y, z, w, v, u, d, s, q
ex = exprs(); out = [next(ex)]
try:
    for i in range(100): out.append(ex.send(i))
except StopIteration as st: print(out, st.value)
def yl():
    yield
    yield None
    yield ()
    yield 1,
    yield 1, 2
    yield (1, 2)
    yield [1]
    yield *[1, 2], 3
    yield lambda: 1
    yield not True
    yield 1 if False else 2
    yield (yield)
    x = yield; yield x
print([v if not callable(v) else "fn" for v in yl()])
# Generators in various constructs.
def in_try():
    try:
        yield 1
        yield 2
    finally: print("cleanup", end="; ")
print(list(in_try()))
def in_with():
    class CM:
        def __enter__(s): print("enter", end="; "); return "cm"
        def __exit__(s, *a): print("exit", a[0], end="; ")
    with CM() as c: yield c; yield c + "2"
print(list(in_with()))
def in_loop_else():
    for i in range(2): yield i
    else: yield "else"
    while False: yield "never"
    else: yield "while else"
print(list(in_loop_else()))
def nested_loops():
    for i in range(3):
        for j in range(3):
            if j == 2: break
            if i == 1: continue
            yield i, j
print(list(nested_loops()))
def in_except():
    try: raise ValueError("v")
    except ValueError as e:
        yield "handling " + str(e)
        yield "still handling " + str(e)
    yield "after"
print(list(in_except()))
def rec(n):
    if n > 0:
        yield n
        for v in rec(n - 1): yield v
print(list(rec(5)))
def tree(t):
    if isinstance(t, list):
        for x in t: yield from tree(x)
    else: yield t
print(list(tree([1, [2, [3, 4], 5], [[6]], []])))
class C:
    def __init__(s): s.items = [1, 2, 3]
    def __iter__(s):
        for x in s.items: yield x * 10
    def gen(s, k): yield from (x * k for x in s.items)
    @staticmethod
    def sg(): yield "static"
    @classmethod
    def cg(cls): yield cls.__name__
    @property
    def pg(s): yield "prop"
c = C(); print(list(c), list(c), list(c.gen(2)), list(C.sg()), list(c.cg()), list(c.pg), [a * b for a in c for b in c][:4], 20 in c, max(c))
lam = lambda: (yield 1); print(list(lam()), type(lam()).__name__)
lam2 = lambda x: [(yield x), (yield x + 1)]; print(list(lam2(1)))
# Attributes.
def named(): yield
n = named()
print(n.__name__, n.__qualname__, n.gi_code is named.__code__, n.gi_running, n.gi_suspended, n.gi_yieldfrom, n.gi_frame is not None, n.gi_frame.f_code.co_name, n.gi_frame.f_lineno == named.__code__.co_firstlineno, repr(n)[:29], type(n).__module__, hasattr(n, "__dict__"), n.gi_frame.f_locals, n.gi_frame.f_back)
next(n); print(n.gi_running, n.gi_suspended, n.gi_frame is not None); next(n, None); print(n.gi_running, n.gi_suspended, n.gi_frame)
n.__name__ = "renamed"; n.__qualname__ = "q.renamed"; print(n.__name__, n.__qualname__, repr(n)[:32], named.__name__)
def s1(): n.__name__ = 1
def s2(): n.gi_code = None
def s3(): n.x = 1
def s4(): del n.__name__
def s5(): n.gi_running = True
for s in (s1, s2, s3, s4, s5): t(s)
def running():
    yield me.gi_running, me.gi_suspended, me.gi_frame.f_lineno > 0
me = running(); print(next(me), me.gi_running, me.gi_suspended)
print(C.__iter__.__code__.co_flags & 0x20 != 0, named.__code__.co_flags & 0x20 != 0, (lambda: 0).__code__.co_flags & 0x20 != 0, type(named).__name__, C().gen(1).__qualname__)
t(lambda: type(n)()); t(lambda: type(n)(named.__code__)); t(lambda: len(n)); t(lambda: n[0]); t(lambda: n + n); t(lambda: n()); t(lambda: reversed(n)); t(lambda: hash(n) == hash(n)); t(lambda: n == n); t(lambda: n < n); t(lambda: bool(n)); t(lambda: type("X", (type(n),), {}))
import sys
t(lambda: n.__reduce__()) if False else None
# Locals visible through the frame.
def fl(a):
    b = a + 1
    yield
    c = b + 1
    yield
x = fl(1); print(x.gi_frame.f_locals); next(x); print(x.gi_frame.f_locals); next(x); print(x.gi_frame.f_locals)
for src in ("yield", "yield 1", "x = yield", "def f(): yield = 1", "def f(): x = yield = 1", "def f(): yield: int", "def f(): yield x for x in y", "def f(): (yield) = 1", "def f(): yield += 1", "def f(): x = yield 1, 2", "def f(): x = 1 + yield", "def f(): x = 1 + (yield)", "def f(): f(yield)", "def f(): f(yield 1)", "def f(): f(yield, 1)", "def f(): f(a=yield)", "def f(): [yield]", "def f(): [(yield)]", "def f(): x[yield]", "def f(): x[yield 1]", "def f(): return yield", "def f(): return (yield)", "def f(): yield yield", "def f(): yield (yield)", "def f(): del yield", "def f(): not yield", "def f(): yield not x", "def f(): lambda: yield", "def f(): lambda: (yield)", "def f(): x = yield from", "def f(): yield from x, y", "def f(): yield from *x", "def f(): yield *x", "def f(): yield *x, y", "def f(): yield **x", "class C: yield", "class C:\n def f(self): yield", "def f(): [(yield x) for x in y]", "def f(): ((yield x) for x in y)", "def f(): {(yield x) for x in y}", "def f(): {x: (yield) for x in y}", "def f(): [x for x in (yield)]", "def f(): [x for x in y if (yield)]", "def f(): [x for x in y for z in (yield)]", "def f(x=(yield)): pass", "def g():\n def f(x=(yield)): pass", "def f(x: (yield)): pass", "def f() -> (yield): pass", "def g():\n @(yield)\n def f(): pass", "def f(): if (yield): pass", "def f():\n if (yield): pass", "def f():\n while (yield): pass", "def f():\n for x in (yield): pass", "def f():\n with (yield): pass", "def f():\n with (yield) as x: pass", "def f():\n assert (yield)", "def f():\n raise (yield)", "def f(): yield; return 1", "def f(): await x; yield", "def f(): print(yield)", "def f(): x = yield; y = yield x", "def f(): (x := (yield))", "def f(): x := yield", "def f(): yield x := 1", "def f(): yield (x := 1)", "def f(): f'{yield}'", "def f(): f'{(yield)}'", "def f(): yield 1 if x else 2", "def f(): (yield 1) if x else (yield 2)", "def f(): x if yield else y", "def f(): yield,", "def f(): yield()", "def f(): yield[1]", "def f(): yield.x", "def f(): yield -1", "def f(): yield...", "def f(): global yield"):
    try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
