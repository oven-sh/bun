def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

g = (x * x for x in range(5))
print(type(g).__name__, g.__name__, g.__qualname__, iter(g) is g, next(g), next(g), list(g), list(g), next(g, "done"))
print(sum(x for x in range(10)), max(x % 3 for x in range(10)), list(x for x in "abc"), tuple(x for x in ()), set(x % 2 for x in range(5)), dict((x, x * 2) for x in range(3)), "".join(c.upper() for c in "abc"), any(x > 3 for x in range(5)), all(x > 3 for x in range(5)), sorted(-x for x in range(3)), min((x for x in [3, 1, 2]), key=lambda v: -v), list(enumerate(x for x in "ab")), list(zip((x for x in "ab"), (y for y in "cd"))), [*(x for x in range(2))], (lambda *a: a)(*(x for x in range(3))), 2 in (x for x in range(5)), len(list(x for x in range(7) if x % 2)))
print(list((x, y) for x in range(3) for y in range(x)), list(x for x in range(10) if x % 2 if x % 3), list((x, y) for x in range(3) if x for y in range(3) if y != x), list(x for y in [[1, 2], [3]] for x in y), list((a, b) for a, b in [(1, 2), (3, 4)]), list(a for a, *b in [(1, 2, 3)]), list(y for x in range(3) for y in (x * 2,)), list(list(y for y in range(x)) for x in range(3)))
# The first iterable is evaluated immediately; everything else lazily.
def it(name, v): print("evaluating", name, end="; "); return v
g = (x + y for x in it("outer", [1, 2]) for y in it("inner", [10])); print("created"); print(list(g))
g = (x for x in it("src", [1, 2, 3]) if it("cond", x > 1)); print("created"); print(list(g))
t(lambda: (x for x in 5)); t(lambda: (x for x in None)); t(lambda: (x for x in undefined_name)); t(lambda: type((x for x in [1] for y in 5)).__name__); t(lambda: list(x for x in [1] for y in 5)); t(lambda: list(x for x in [1] if undefined_name)); t(lambda: list(undefined_name for x in [1])); t(lambda: list(undefined_name for x in []))
l = [1, 2, 3]; g = (x for x in l); l.append(4); print(list(g))
l = [1, 2, 3]; g = (x for x in l); l = [9]; print(list(g))
n = 1; g = (x + n for x in range(2)); n = 100; print(list(g))
k = [1, 2]; g = (x for _ in range(1) for x in k); k = [7, 8]; print(list(g))
fs = list((lambda: i) for i in range(3)); print([f() for f in fs])
fs = [(lambda i=i: i) for i in range(3)]; print([f() for f in fs])
# Scope.
x = "outer x"; g = (x for x in range(2)); print(list(g), x)
def scope():
    v = 10
    g = (v + i for i in range(2))
    v = 20
    return list(g)
print(scope())
class K:
    a = [1, 2]; b = 10
    first = list(v for v in a)
    try: second = list(v + b for v in a)
    except NameError as e: second = str(e)
print(K.first, K.second)
def walrus():
    g = ((y := v * 2) for v in range(3))
    r = list(g)
    return r, y
print(walrus())
# send, throw, close work too.
g = (x for x in range(3)); print(next(g), g.send(None), g.send("ignored")); t(lambda: g.send(1))
g = (x for x in range(3)); next(g); t(lambda: g.throw(ValueError("thrown"))); print(list(g))
g = (x for x in range(3)); next(g); print(g.close(), list(g))
g = (x for x in range(3)); t(lambda: g.send(1))
g = ((yield_val) for yield_val in range(1)); print(list(g))
g = (x for x in range(2)); print(g.gi_running, g.gi_suspended, g.gi_frame.f_code.co_name, g.gi_code.co_name, g.gi_yieldfrom, list(g.gi_frame.f_locals), g.gi_code.co_varnames, g.gi_code.co_argcount)
def qual():
    return (x for x in ())
print(qual().__qualname__, (x for x in ()).__qualname__, K.__dict__.get("nope"), (lambda: (x for x in ()))().__qualname__)
# Errors while iterating.
g = (1 / x for x in [1, 0, 2]); print(next(g)); t(lambda: next(g)); t(lambda: next(g))
g = (next(iter([])) for _ in range(1)); t(lambda: list(g))
def raise_stop(): raise StopIteration("s")
t(lambda: list(raise_stop() for _ in range(1))); t(lambda: [raise_stop() for _ in range(1)]); t(lambda: list(x for x in iter(raise_stop, 1)))
class BadNext:
    def __iter__(s): return s
    def __next__(s): raise KeyError("from __next__")
t(lambda: list(x for x in BadNext()))
me = None
def reenter(): return next(me)
me = (reenter() for _ in range(1)); t(lambda: next(me))
# Parenthesisation.
print(sum(x for x in range(3)), sum((x for x in range(3))), sum((x for x in range(3)), 10), list(map(str, (x for x in range(2)))), print(*(x for x in range(2)), sep="-"), (lambda a: list(a))(x for x in range(2)), (lambda a, b: list(a))((x for x in range(2)), 1), (lambda a, b=1: list(a))((x for x in range(2)), b=2))
for src in ("f(x for x in y)", "f(x for x in y, 1)", "f(1, x for x in y)", "f((x for x in y), 1)", "f(x for x in y, a=1)", "f(a=x for x in y)", "f(a=(x for x in y))", "f(x for x in y for z in w)", "f(*x for x in y)", "f(**x for x in y)", "(x for x in y)", "x for x in y", "(x for x in)", "(for x in y)", "(x for in y)", "(x for x y)", "(x for x in y if)", "(x for x in y if z else w)", "(x for x in (y if z else w))", "(x for x in y if (z if a else b))", "(x, y for x in z)", "((x, y) for x in z)", "(x for x, in y)", "(x for x, y in z)", "(x for (x, y) in z)", "(x for [x, y] in z)", "(x for x.a in y)", "(x for x[0] in y)", "(x for 1 in y)", "(x for f() in y)", "(x for x in y, z)", "(x for x in (y, z))", "(x for x in *y)", "(x for x in *y, z)", "(x for *x in y)", "(x for *x, in y)", "(*x for x in y)", "(**x for x in y)", "(x: y for x in z)", "(x for x in lambda: y)", "(x for x in y if lambda: z)", "(lambda: x for x in y)", "(x := 1 for x in y)", "((z := x) for x in y)", "((x := 1) for x in y)", "(x for x in (x := y))", "(x for x in y if (x := 1))", "(x for x in y if (w := 1))", "(x for x in y for z in (w := 1))", "(x async for x in y)", "(await x for x in y)", "(x for x in await y)", "class C(x for x in y): pass", "@(x for x in y)\ndef f(): pass", "del (x for x in y)", "(x for x in y) = 1", "(x for x in y) += 1", "for (x for x in y) in z: pass", "with (x for x in y) as z: pass", "(x for x in y)[0]", "(x for x in y).z", "(x for x in y)()", "print(x for x in y)", "f(x for x in y)(z for z in w)", "[x for x in y](z)", "(x for x in y if z if w for a in b if c)", "(x for x in y\n for z in w\n if q)", "(not x for x in y)", "(x if y else z for x in w)", "(x for x in y or z)", "(x for x in not y)", "(x for x in y < z)", "(yield for x in y)", "((yield) for x in y)", "(x for x in (yield))", "def f(): return (x for x in (yield))"):
    try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
# With a star or `:=` in front. Only `x for ...`, or the last of several positional arguments and what follows it, is taken for a generator expression
# that lacks parentheses.
for src in ('print(*a for a in x, 1)', 'print(a for a in x, 1)', 'print(1, *a for a in x)', 'print(1, a for a in x)', 'print(*a for a in x)', 'print(*a for a in x,)', 'print(a for a in x,)', 'print(**a for a in x, 1)', 'print(**a for a in x)', 'print(1, *a for a in x, 2)', 'print(b=1, *a for a in x)', 'print(b=1, a for a in x)', 'print(*a for a in x, b=1)', 'print(a for a in x, b=1)', 'print(*a for a in x, *b for b in y)', 'print(a for a in x, *b for b in y)', 'print(*a for a in x, b for b in y)', 'class C(*a for a in x, 1): pass', 'class C(a for a in x, 1): pass', 'class C(*a for a in x): pass', 'class C(1, *a for a in x): pass', 'f(*a, *b for b in y)', 'f(*a for a in x)(1)', 'f(x, *a async for a in x)', 'f(*a async for a in x, 1)', 'f(*(a) for a in x, 1)', 'f(* a for a in x if a, 1)', 'f(a := 1 for a in x, 1)', 'f(1, a := 1 for a in x)', 'f(*a := 1 for a in x, 1)'):
    try: compile(src, "<s>", "exec"); print("ok:", src)
    except SyntaxError as e: print("SyntaxError:", e.msg, e.offset, e.end_offset, "<-", src)
# Laziness in pipelines.
def numbers():
    n = 0
    while True: n += 1; yield n
evens = (n for n in numbers() if n % 2 == 0); squares = (n * n for n in evens); big = (n for n in squares if n > 50)
print(next(big), next(big), next(big))
log = []
def src():
    for i in range(3): log.append("produce %d" % i); yield i
for v in (x * 2 for x in src()): log.append("consume %d" % v)
print(log)
print(list(x for x in range(1000) if x % 100 == 0), sum(x * y for x in range(20) for y in range(20)), sum(1 for _ in range(5000)))
