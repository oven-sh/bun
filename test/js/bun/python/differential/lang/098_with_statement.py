def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

class CM:
    def __init__(s, name="cm", suppress=False, value=None): s.name = name; s.suppress = suppress; s.value = value
    def __enter__(s): print("enter", s.name, end="; "); return s.value if s.value is not None else s
    def __exit__(s, t, v, tb):
        print("exit", s.name, t.__name__ if t else None, repr(v), tb is not None, end="; "); return s.suppress
with CM(): print("body", end="; ")
print()
with CM() as c: print("body", c.name, end="; ")
print()
with CM(value=5) as v: print(v, end="; ")
print(v)
with CM("a"), CM("b"): print("body", end="; ")
print()
with CM("a") as a, CM("b") as b: print(a.name, b.name, end="; ")
print()
with (CM("a") as a, CM("b") as b): print("parenthesised", end="; ")
print()
with (CM("a") as a, CM("b") as b,): print("trailing comma", end="; ")
print()
with (CM("a"), CM("b")): print("no as", end="; ")
print()
with (CM("a")): print("single in parens", end="; ")
print()
with (CM("a")) as x: print("parens then as", x.name, end="; ")
print()
with (
    CM("a") as a,
    CM("b"),
    CM("c") as c,
): print("multi-line", end="; ")
print()
with CM("outer"):
    with CM("inner"): print("nested", end="; ")
print()
with CM(value=(1, 2)) as (p, q): print(p, q, end="; ")
print()
with CM(value=[1, [2, 3]]) as [p, [q, r]]: print(p, q, r, end="; ")
print()
with CM(value=(1, 2, 3)) as (p, *q): print(p, q, end="; ")
print()
class O: pass
o = O(); l = [0]; d = {}
with CM(value=1) as o.attr, CM(value=2) as l[0], CM(value=3) as d["k"]: pass
print(o.attr, l, d)
# Exceptions.
def e1():
    with CM(): raise ValueError("propagates")
def e2():
    with CM(suppress=True): raise ValueError("suppressed")
    return "continues after the with"
def e3():
    with CM("outer"), CM("inner", suppress=True): raise ValueError("inner suppresses")
    return "outer sees no exception"
def e4():
    with CM("outer", suppress=True), CM("inner"): raise ValueError("outer suppresses")
    return "ok"
def e5():
    with CM("a"), CM("b"): raise KeyError("both see it")
for f in (e1, e2, e3, e4, e5): t(f)
for ret in (True, False, None, 0, 1, "", "x", [], [0], 0.0, NotImplemented if False else 2):
    class R:
        def __enter__(s): pass
        def __exit__(s, *a): return ret
    try:
        with R(): raise ValueError
        print(repr(ret), "suppressed", end="; ")
    except ValueError: print(repr(ret), "propagated", end="; ")
print()
class BadBool:
    def __bool__(s): raise RuntimeError("bool of the __exit__ result failed")
class RB:
    def __enter__(s): pass
    def __exit__(s, *a): return BadBool()
def e6():
    with RB(): raise ValueError("orig")
def e7():
    with RB(): pass
    return "result not tested without an exception"
t(e6); t(e7)
# Failures in __enter__ and __exit__.
class EnterRaises:
    def __enter__(s): raise RuntimeError("enter failed")
    def __exit__(s, *a): print("exit must not run")
class ExitRaises:
    def __enter__(s): return s
    def __exit__(s, *a): raise RuntimeError("exit failed")
def f1():
    with EnterRaises(): print("body must not run")
def f2():
    with CM("first"), EnterRaises(): print("no")
def f3():
    with ExitRaises(): pass
def f4():
    try:
        with ExitRaises(): raise ValueError("body")
    except RuntimeError as e: return repr(e), repr(e.__context__)
def f5():
    with CM("outer"), ExitRaises(): pass
def f6():
    with CM("outer", suppress=True), ExitRaises(): raise ValueError("replaced")
    return "outer suppressed the RuntimeError"
def f7():
    with CM(value=(1, 2, 3)) as (a, b): print("no")
for f in (f1, f2, f3, f4, f5, f6, f7): t(f)
# Objects that are not context managers.
class NoExit:
    def __enter__(s): print("enter must not run")
class NoEnter:
    def __exit__(s, *a): pass
class InstanceOnly: pass
io = InstanceOnly(); io.__enter__ = lambda: 1; io.__exit__ = lambda *a: None
class AsyncOnly:
    async def __aenter__(s): pass
    async def __aexit__(s, *a): pass
class NoneEnter:
    __enter__ = None
    def __exit__(s, *a): pass
def w(x):
    with x: pass
for x in (1, None, "s", [], object(), NoExit(), NoEnter(), io, AsyncOnly(), int, len, NoneEnter(), (CM(), CM()), (x for x in ())): t(lambda: w(x))
# Control flow out of the body.
def r1():
    with CM(): return "returned"
def r2():
    for i in range(3):
        with CM(str(i)):
            if i == 1: break
    return i
def r3():
    out = []
    for i in range(3):
        with CM(str(i)):
            if i == 1: continue
            out.append(i)
    return out
def r4():
    with CM("a"):
        with CM("b"): return "deep return"
def r5():
    class Override:
        def __enter__(s): pass
        def __exit__(s, *a): return True
    with Override(): return "return is not an exception"
def r6():
    with CM():
        try: return "try"
        finally: print("finally first", end="; ")
def r7():
    while True:
        with CM(): break
    return "after loop"
for f in (r1, r2, r3, r4, r5, r6, r7): t(f)
def gen():
    with CM("gen"):
        yield 1
        yield 2
print(list(gen()))
g = gen(); next(g); g.close(); print()
g = gen(); next(g); t(lambda: g.throw(ValueError("thrown into the with")))
# Order of evaluation and lookup.
class Tr:
    def __getattribute__(s, n): print("instance getattribute", n); return object.__getattribute__(s, n)
    def __enter__(s): print("enter", end="; "); return s
    def __exit__(s, *a): print("exit", end="; ")
with Tr(): print("special methods are looked up on the type", end="; ")
print()
def ev(n): print("eval", n, end="; "); return CM(n)
with ev("x") as a, ev("y") as b: pass
print()
class Desc:
    def __init__(s, n): s.n = n
    def __get__(s, o, t): print("get", s.n, end="; "); return lambda *a: None
class DC:
    __enter__ = Desc("__enter__"); __exit__ = Desc("__exit__")
with DC(): print("body", end="; ")
print()
class SelfReplace:
    def __enter__(s): return "replacement"
    def __exit__(s, *a): print("exit is called on the manager, not on the value", end="; ")
with SelfReplace() as sr: sr = None
print()
cm = CM("rebound")
with cm:
    cm = None
print()
# The exception passed to __exit__.
class Inspect:
    def __enter__(s): return s
    def __exit__(s, t, v, tb):
        print(t, type(v), v.args if v else None, isinstance(v, t) if t else None, tb.tb_frame.f_code.co_name if tb else None, v.__traceback__ is tb if v else None); return True
def insp():
    with Inspect(): raise ValueError
    with Inspect(): raise ValueError("a", "b")
    with Inspect(): 1 / 0
    with Inspect(): pass
    with Inspect(): raise KeyboardInterrupt
    with Inspect(): raise SystemExit(3)
    with Inspect(): raise StopIteration("s")
    with Inspect(): [].pop()
    with Inspect(): raise ExceptionGroup("g", [ValueError()])
insp()
import sys
class SeesExc:
    def __enter__(s): return s
    def __exit__(s, *a): print(repr(sys.exception()), end="; "); return True
with SeesExc(): raise ValueError("visible in __exit__")
print(sys.exception())
class Reraise:
    def __enter__(s): return s
    def __exit__(s, t, v, tb): raise v
try:
    with Reraise(): raise ValueError("same")
except ValueError as e: print(repr(e), e.__context__)
# Reusable, reentrant, nested use of the same manager.
c = CM("same")
with c, c: pass
print()
with c:
    with c: pass
print()
for src in ("with: pass", "with x", "with x:", "with x as: pass", "with x as 1: pass", "with x as f(): pass", "with x as y, : pass", "with x, : pass", "with (x, ): pass", "with (x as y, ): pass", "with (): pass", "with x as (y): pass", "with x as (y, z): pass", "with x as [y]: pass", "with x as y.z: pass", "with x as y[0]: pass", "with x as *y: pass", "with x as (*y,): pass", "with x as y as z: pass", "with (x as y) as z: pass", "with (x as y): pass", "with (x, y) as z: pass", "with (x, y as z): pass", "with (x as y, z): pass", "with x as y, z as w: pass", "with x y: pass", "with x as None: pass", "with x as True: pass", "with x as y + 1: pass", "with x as -y: pass", "with x as 'a': pass", "with x as (y, 1): pass", "with x as {y}: pass", "with x as lambda: 1: pass", "with (yield): pass", "with x if y else z: pass", "with x if y else z as w: pass", "with lambda: 1: pass", "with (lambda: 1): pass", "with x := y: pass", "with (x := y): pass", "with (x := y) as z: pass", "with (x := y, z): pass", "with *x: pass", "with (*x,): pass", "with x as y:\npass", "with x as y: pass\nelse: pass", "with x, y, z: pass", "with (x), (y): pass", "with (x) as a, (y) as b: pass", "with (x)(y): pass", "with (x).y: pass", "with (x)[0] as y: pass", "with (x, y)[0]: pass", "with (x for x in y): pass", "with [x]: pass", "with x() as y, y() as z: pass", "with await x: pass", "with x as __debug__: pass", "with (a as b, c as d) as e: pass", "with open(f) as a, open(g) as b,: pass", "with(x): pass", "with x as y : pass", "with x as(y): pass"):
    try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
