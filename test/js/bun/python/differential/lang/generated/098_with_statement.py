try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    class CM:
        def __init__(s, name="cm", suppress=False, value=None): s.name = name; s.suppress = suppress; s.value = value
        def __enter__(s): print("enter", s.name, end="; "); return s.value if s.value is not None else s
        def __exit__(s, t, v, tb):
            print("exit", s.name, t.__name__ if t else None, repr(v), tb is not None, end="; "); return s.suppress
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CM:')
try:
    with CM(): print("body", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with CM(): print("body", end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with CM() as c: print("body", c.name, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with CM() as c: print("body", c.name, end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with CM(value=5) as v: print(v, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with CM(value=5) as v: print(v, end="; ")')
try: print(v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v')
try:
    with CM("a"), CM("b"): print("body", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with CM("a"), CM("b"): print("body", end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with CM("a") as a, CM("b") as b: print(a.name, b.name, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with CM("a") as a, CM("b") as b: print(a.name, b.name, end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with (CM("a") as a, CM("b") as b): print("parenthesised", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with (CM("a") as a, CM("b") as b): print("parenthesised", end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with (CM("a") as a, CM("b") as b,): print("trailing comma", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with (CM("a") as a, CM("b") as b,): print("trailing comma", end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with (CM("a"), CM("b")): print("no as", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with (CM("a"), CM("b")): print("no as", end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with (CM("a")): print("single in parens", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with (CM("a")): print("single in parens", end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with (CM("a")) as x: print("parens then as", x.name, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with (CM("a")) as x: print("parens then as", x.name, end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with (
        CM("a") as a,
        CM("b"),
        CM("c") as c,
    ): print("multi-line", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with (')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with CM("outer"):
        with CM("inner"): print("nested", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with CM("outer"):')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with CM(value=(1, 2)) as (p, q): print(p, q, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with CM(value=(1, 2)) as (p, q): print(p, q, end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with CM(value=[1, [2, 3]]) as [p, [q, r]]: print(p, q, r, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with CM(value=[1, [2, 3]]) as [p, [q, r]]: print(p, q, r, end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with CM(value=(1, 2, 3)) as (p, *q): print(p, q, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with CM(value=(1, 2, 3)) as (p, *q): print(p, q, end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    class O: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O: pass')
try: o = O()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = O()')
try: l = [0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = [0]')
try: d = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = {}')
try:
    with CM(value=1) as o.attr, CM(value=2) as l[0], CM(value=3) as d["k"]: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with CM(value=1) as o.attr, CM(value=2) as l[0], CM(value=3) as d["k"...')
try: print('o.attr =>', o.attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.attr')
try: print('l =>', l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: print('d =>', d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')
# Exceptions.
try:
    def e1():
        with CM(): raise ValueError("propagates")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e1():')
try:
    def e2():
        with CM(suppress=True): raise ValueError("suppressed")
        return "continues after the with"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e2():')
try:
    def e3():
        with CM("outer"), CM("inner", suppress=True): raise ValueError("inner suppresses")
        return "outer sees no exception"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e3():')
try:
    def e4():
        with CM("outer", suppress=True), CM("inner"): raise ValueError("outer suppresses")
        return "ok"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e4():')
try:
    def e5():
        with CM("a"), CM("b"): raise KeyError("both see it")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e5():')
try:
    for f in (e1, e2, e3, e4, e5): t(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (e1, e2, e3, e4, e5): t(f)')
try:
    for ret in (True, False, None, 0, 1, "", "x", [], [0], 0.0, NotImplemented if False else 2):
        class R:
            def __enter__(s): pass
            def __exit__(s, *a): return ret
        try:
            with R(): raise ValueError
            print(repr(ret), "suppressed", end="; ")
        except ValueError: print(repr(ret), "propagated", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for ret in (True, False, None, 0, 1, "", "x", [], [0], 0.0, NotImplem...')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    class BadBool:
        def __bool__(s): raise RuntimeError("bool of the __exit__ result failed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadBool:')
try:
    class RB:
        def __enter__(s): pass
        def __exit__(s, *a): return BadBool()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class RB:')
try:
    def e6():
        with RB(): raise ValueError("orig")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e6():')
try:
    def e7():
        with RB(): pass
        return "result not tested without an exception"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e7():')
try: print('e6() =>', end=" "); t(e6)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(e6)')
try: print('e7() =>', end=" "); t(e7)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(e7)')
# Failures in __enter__ and __exit__.
try:
    class EnterRaises:
        def __enter__(s): raise RuntimeError("enter failed")
        def __exit__(s, *a): print("exit must not run")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class EnterRaises:')
try:
    class ExitRaises:
        def __enter__(s): return s
        def __exit__(s, *a): raise RuntimeError("exit failed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ExitRaises:')
try:
    def f1():
        with EnterRaises(): print("body must not run")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f1():')
try:
    def f2():
        with CM("first"), EnterRaises(): print("no")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f2():')
try:
    def f3():
        with ExitRaises(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f3():')
try:
    def f4():
        try:
            with ExitRaises(): raise ValueError("body")
        except RuntimeError as e: return repr(e), repr(e.__context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f4():')
try:
    def f5():
        with CM("outer"), ExitRaises(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f5():')
try:
    def f6():
        with CM("outer", suppress=True), ExitRaises(): raise ValueError("replaced")
        return "outer suppressed the RuntimeError"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f6():')
try:
    def f7():
        with CM(value=(1, 2, 3)) as (a, b): print("no")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f7():')
try:
    for f in (f1, f2, f3, f4, f5, f6, f7): t(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (f1, f2, f3, f4, f5, f6, f7): t(f)')
# Objects that are not context managers.
try:
    class NoExit:
        def __enter__(s): print("enter must not run")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoExit:')
try:
    class NoEnter:
        def __exit__(s, *a): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoEnter:')
try:
    class InstanceOnly: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class InstanceOnly: pass')
try: io = InstanceOnly()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: io = InstanceOnly()')
try: io.__enter__ = lambda: 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: io.__enter__ = lambda: 1')
try: io.__exit__ = lambda *a: None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: io.__exit__ = lambda *a: None')
try:
    class AsyncOnly:
        async def __aenter__(s): pass
        async def __aexit__(s, *a): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AsyncOnly:')
try:
    class NoneEnter:
        __enter__ = None
        def __exit__(s, *a): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoneEnter:')
try:
    def w(x):
        with x: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def w(x):')
try:
    for x in (1, None, "s", [], object(), NoExit(), NoEnter(), io, AsyncOnly(), int, len, NoneEnter(), (CM(), CM()), (x for x in ())): t(lambda: w(x))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in (1, None, "s", [], object(), NoExit(), NoEnter(), io, AsyncO...')
# Control flow out of the body.
try:
    def r1():
        with CM(): return "returned"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r1():')
try:
    def r2():
        for i in range(3):
            with CM(str(i)):
                if i == 1: break
        return i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r2():')
try:
    def r3():
        out = []
        for i in range(3):
            with CM(str(i)):
                if i == 1: continue
                out.append(i)
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r3():')
try:
    def r4():
        with CM("a"):
            with CM("b"): return "deep return"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r4():')
try:
    def r5():
        class Override:
            def __enter__(s): pass
            def __exit__(s, *a): return True
        with Override(): return "return is not an exception"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r5():')
try:
    def r6():
        with CM():
            try: return "try"
            finally: print("finally first", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r6():')
try:
    def r7():
        while True:
            with CM(): break
        return "after loop"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r7():')
try:
    for f in (r1, r2, r3, r4, r5, r6, r7): t(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (r1, r2, r3, r4, r5, r6, r7): t(f)')
try:
    def gen():
        with CM("gen"):
            yield 1
            yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen():')
try: print(list(gen()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(gen())')
try: g = gen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = gen()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: g.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try: g = gen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = gen()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.throw(ValueError("thrown into the with")) =>', end=" "); t(lambda: g.throw(ValueError("thrown into the with")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(ValueError("thrown into the with")))')
# Order of evaluation and lookup.
try:
    class Tr:
        def __getattribute__(s, n): print("instance getattribute", n); return object.__getattribute__(s, n)
        def __enter__(s): print("enter", end="; "); return s
        def __exit__(s, *a): print("exit", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Tr:')
try:
    with Tr(): print("special methods are looked up on the type", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with Tr(): print("special methods are looked up on the type", end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    def ev(n): print("eval", n, end="; "); return CM(n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ev(n): print("eval", n, end="; "); return CM(n)')
try:
    with ev("x") as a, ev("y") as b: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with ev("x") as a, ev("y") as b: pass')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    class Desc:
        def __init__(s, n): s.n = n
        def __get__(s, o, t): print("get", s.n, end="; "); return lambda *a: None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Desc:')
try:
    class DC:
        __enter__ = Desc("__enter__"); __exit__ = Desc("__exit__")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class DC:')
try:
    with DC(): print("body", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with DC(): print("body", end="; ")')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    class SelfReplace:
        def __enter__(s): return "replacement"
        def __exit__(s, *a): print("exit is called on the manager, not on the value", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SelfReplace:')
try:
    with SelfReplace() as sr: sr = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with SelfReplace() as sr: sr = None')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try: cm = CM("rebound")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cm = CM("rebound")')
try:
    with cm:
        cm = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with cm:')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
# The exception passed to __exit__.
try:
    class Inspect:
        def __enter__(s): return s
        def __exit__(s, t, v, tb):
            print(t, type(v), v.args if v else None, isinstance(v, t) if t else None, tb.tb_frame.f_code.co_name if tb else None, v.__traceback__ is tb if v else None); return True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Inspect:')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def insp():')
try: insp()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: insp()')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    class SeesExc:
        def __enter__(s): return s
        def __exit__(s, *a): print(repr(sys.exception()), end="; "); return True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SeesExc:')
try:
    with SeesExc(): raise ValueError("visible in __exit__")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with SeesExc(): raise ValueError("visible in __exit__")')
try: print(sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.exception()')
try:
    class Reraise:
        def __enter__(s): return s
        def __exit__(s, t, v, tb): raise v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Reraise:')
try:
    try:
        with Reraise(): raise ValueError("same")
    except ValueError as e: print(repr(e), e.__context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
# Reusable, reentrant, nested use of the same manager.
try: c = CM("same")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = CM("same")')
try:
    with c, c: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with c, c: pass')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with c:
        with c: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with c:')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    for src in ("with: pass", "with x", "with x:", "with x as: pass", "with x as 1: pass", "with x as f(): pass", "with x as y, : pass", "with x, : pass", "with (x, ): pass", "with (x as y, ): pass", "with (): pass", "with x as (y): pass", "with x as (y, z): pass", "with x as [y]: pass", "with x as y.z: pass", "with x as y[0]: pass", "with x as *y: pass", "with x as (*y,): pass", "with x as y as z: pass", "with (x as y) as z: pass", "with (x as y): pass", "with (x, y) as z: pass", "with (x, y as z): pass", "with (x as y, z): pass", "with x as y, z as w: pass", "with x y: pass", "with x as None: pass", "with x as True: pass", "with x as y + 1: pass", "with x as -y: pass", "with x as 'a': pass", "with x as (y, 1): pass", "with x as {y}: pass", "with x as lambda: 1: pass", "with (yield): pass", "with x if y else z: pass", "with x if y else z as w: pass", "with lambda: 1: pass", "with (lambda: 1): pass", "with x := y: pass", "with (x := y): pass", "with (x := y) as z: pass", "with (x := y, z): pass", "with *x: pass", "with (*x,): pass", "with x as y:\npass", "with x as y: pass\nelse: pass", "with x, y, z: pass", "with (x), (y): pass", "with (x) as a, (y) as b: pass", "with (x)(y): pass", "with (x).y: pass", "with (x)[0] as y: pass", "with (x, y)[0]: pass", "with (x for x in y): pass", "with [x]: pass", "with x() as y, y() as z: pass", "with await x: pass", "with x as __debug__: pass", "with (a as b, c as d) as e: pass", "with open(f) as a, open(g) as b,: pass", "with(x): pass", "with x as y : pass", "with x as(y): pass"):
        try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
        except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("with: pass", "with x", "with x:", "with x as: pass", "wi...')
