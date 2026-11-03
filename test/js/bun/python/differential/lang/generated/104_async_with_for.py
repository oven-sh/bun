try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')
try:
    def run(coro):
        steps = []
        try:
            while True: steps.append(coro.send(None))
        except StopIteration as e:
            return (steps, e.value) if steps else e.value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(coro):')
try:
    class Suspend:
        def __init__(s, tag): s.tag = tag
        def __await__(s):
            r = yield s.tag
            return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Suspend:')

try:
    class ACM:
        def __init__(s, name="acm", suppress=False, suspend=False): s.name = name; s.suppress = suppress; s.suspend = suspend
        async def __aenter__(s):
            print("aenter", s.name, end="; ")
            if s.suspend: await Suspend("entering " + s.name)
            return s
        async def __aexit__(s, t, v, tb):
            print("aexit", s.name, t.__name__ if t else None, end="; ")
            if s.suspend: await Suspend("exiting " + s.name)
            return s.suppress
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ACM:')
try:
    async def w1():
        async with ACM(): print("body", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def w1():')
try:
    async def w2():
        async with ACM("n") as a: return a.name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def w2():')
try:
    async def w3():
        async with ACM("a") as a, ACM("b") as b: print(a.name + b.name, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def w3():')
try:
    async def w4():
        async with (ACM("a") as a, ACM("b") as b,): print("parenthesised", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def w4():')
try:
    async def w5():
        async with ACM("s", suspend=True): print("body", end="; "); await Suspend("in body")
        return "done"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def w5():')
try:
    async def w6():
        async with ACM(): raise ValueError("propagates")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def w6():')
try:
    async def w7():
        async with ACM(suppress=True): raise ValueError("suppressed")
        return "continues"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def w7():')
try:
    async def w8():
        async with ACM("outer"):
            async with ACM("inner", suppress=True): raise KeyError("k")
        return "ok"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def w8():')
try:
    async def w9():
        for i in range(3):
            async with ACM(str(i)):
                if i == 0: continue
                if i == 1: break
        return i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def w9():')
try:
    async def w10():
        async with ACM("a"):
            with CM():
                async with ACM("b"): return "mixed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def w10():')
try:
    class CM:
        def __enter__(s): print("enter", end="; ")
        def __exit__(s, *a): print("exit", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CM:')
try:
    for f in (w1, w2, w3, w4, w5, w6, w7, w8, w9, w10): t(lambda: run(f()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (w1, w2, w3, w4, w5, w6, w7, w8, w9, w10): t(lambda: run(f()))')
# Objects that do not qualify.
try:
    class NoAexit:
        async def __aenter__(s): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoAexit:')
try:
    class NoAenter:
        async def __aexit__(s, *a): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoAenter:')
try:
    class SyncMethods:
        def __aenter__(s): return 5
        def __aexit__(s, *a): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SyncMethods:')
try:
    class SyncExit:
        async def __aenter__(s): pass
        def __aexit__(s, *a): return None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SyncExit:')
try:
    async def aw(x):
        async with x: print("body", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def aw(x):')
try:
    for x in (1, None, CM(), NoAexit(), NoAenter(), SyncMethods(), SyncExit(), object(), [], ACM): t(lambda: run(aw(x)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in (1, None, CM(), NoAexit(), NoAenter(), SyncMethods(), SyncEx...')
try:
    def sync_with(x):
        with x: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sync_with(x):')
try: print('sync_with(ACM()) =>', end=" "); t(lambda: sync_with(ACM()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sync_with(ACM()))')
try:
    class AenterRaises:
        async def __aenter__(s): raise RuntimeError("aenter failed")
        async def __aexit__(s, *a): print("must not run")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AenterRaises:')
try:
    class AexitRaises:
        async def __aenter__(s): pass
        async def __aexit__(s, *a): raise RuntimeError("aexit failed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AexitRaises:')
try: print('run(aw(AenterRaises())) =>', end=" "); t(lambda: run(aw(AenterRaises())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(aw(AenterRaises())))')
try: print('run(aw(AexitRaises())) =>', end=" "); t(lambda: run(aw(AexitRaises())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(aw(AexitRaises())))')
try:
    async def ctx():
        try:
            async with AexitRaises(): raise ValueError("body")
        except RuntimeError as e: return repr(e), repr(e.__context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def ctx():')
try: print(run(ctx()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(ctx())')
try:
    class AwaitableResult:
        def __aenter__(s): return Suspend("custom awaitable enter")
        def __aexit__(s, *a): return Suspend("custom awaitable exit")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AwaitableResult:')
try:
    async def car():
        async with AwaitableResult() as v: return ("entered with", v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def car():')
try: c = car()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = car()')
try: print('c.send(None) =>', c.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: print('c.send("sent value") =>', c.send("sent value"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send("sent value")')
try:
    try: c.send(True)
    except StopIteration as e: print(e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: c.send(True)')
# async for
try:
    class AIter:
        def __init__(s, n, suspend=False): s.n = n; s.i = 0; s.suspend = suspend
        def __aiter__(s): return s
        async def __anext__(s):
            if s.i >= s.n: raise StopAsyncIteration
            s.i += 1
            if s.suspend: await Suspend("item %d" % s.i)
            return s.i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AIter:')
try:
    async def f1():
        out = []
        async for x in AIter(3): out.append(x)
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def f1():')
try:
    async def f2():
        out = []
        async for x in AIter(2): out.append(x)
        else: out.append("else")
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def f2():')
try:
    async def f3():
        async for x in AIter(5):
            if x == 2: break
        else: return "no break"
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def f3():')
try:
    async def f4():
        out = []
        async for x in AIter(4):
            if x % 2: continue
            out.append(x)
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def f4():')
try:
    async def f5():
        out = []
        async for x in AIter(2, suspend=True): out.append(x)
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def f5():')
try:
    async def f6():
        out = []
        async for x in AIter(2):
            async for y in AIter(2): out.append((x, y))
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def f6():')
try:
    async def f7():
        async for x in AIter(0): return "never"
        else: return "empty"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def f7():')
try:
    async def f8():
        async for x in AIter(3): return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def f8():')
try:
    class Pairs:
        def __init__(s): s.it = iter([(1, 2), (3, 4)])
        def __aiter__(s): return s
        async def __anext__(s):
            try: return next(s.it)
            except StopIteration: raise StopAsyncIteration from None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Pairs:')
try:
    async def f9():
        out = []
        async for a, b in Pairs(): out.append(a + b)
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def f9():')
try:
    async def f10():
        class O: pass
        o = O(); l = [0]
        async for o.x in AIter(2): pass
        async for l[0] in AIter(3): pass
        async for (a, *b) in Pairs(): pass
        return o.x, l, a, b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def f10():')
try:
    async def f11():
        async for x in AIter(1): pass
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def f11():')
try:
    for f in (f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11): t(lambda: run(f()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11): t(lambda: ru...')
try:
    class NoAnext:
        def __aiter__(s): return s
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoAnext:')
try:
    class AiterCoroutine:
        async def __aiter__(s): return s
        async def __anext__(s): raise StopAsyncIteration
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AiterCoroutine:')
try:
    class AiterBad:
        def __aiter__(s): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AiterBad:')
try:
    class SyncAnext:
        def __aiter__(s): return s
        def __anext__(s): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SyncAnext:')
try:
    class AnextRaises:
        def __aiter__(s): return s
        async def __anext__(s): raise KeyError("anext failed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AnextRaises:')
try:
    class AnextStopIteration:
        def __aiter__(s): return s
        async def __anext__(s): raise StopIteration("wrong kind")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AnextStopIteration:')
try:
    class AiterRaises:
        def __aiter__(s): raise RuntimeError("aiter failed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AiterRaises:')
try:
    class SyncAnextRaisesStop:
        def __aiter__(s): return s
        def __anext__(s): raise StopAsyncIteration
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SyncAnextRaisesStop:')
try:
    async def af(x):
        async for v in x: print("item", v, end="; ")
        return "finished"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def af(x):')
try:
    for x in (1, None, [1], iter([1]), "s", NoAnext(), AiterCoroutine(), AiterBad(), SyncAnext(), AnextRaises(), AnextStopIteration(), AiterRaises(), SyncAnextRaisesStop(), object(), range(2), (x for x in ()), AIter): t(lambda: run(af(x)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in (1, None, [1], iter([1]), "s", NoAnext(), AiterCoroutine(), ...')
try:
    def sync_for(x):
        for v in x: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sync_for(x):')
try: print('sync_for(AIter(1)) =>', end=" "); t(lambda: sync_for(AIter(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sync_for(AIter(1)))')
# aiter() and anext()
try:
    async def b1():
        it = aiter(AIter(2))
        return await anext(it), await anext(it), await anext(it, "default"), await anext(it, None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def b1():')
try:
    async def b2():
        it = AIter(0)
        try: await anext(it)
        except StopAsyncIteration as e: return "StopAsyncIteration", e.args
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def b2():')
try: print('run(b1()) =>', run(b1()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(b1())')
try: print('run(b2()) =>', run(b2()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(b2())')
try: print('type(aiter(AIter(1))).__name__ =>', type(aiter(AIter(1))).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(aiter(AIter(1))).__name__')
try: a = anext(AIter(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = anext(AIter(1))')
try: print(type(a).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(a).__name__')
try: a.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.close()')
try: a = anext(AIter(1), "d")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = anext(AIter(1), "d")')
try: print('type(a).__name__ =>', type(a).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(a).__name__')
try: print('hasattr(a, "__await__") =>', hasattr(a, "__await__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(a, "__await__")')
try: print('hasattr(a, "send") =>', hasattr(a, "send"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(a, "send")')
try: a.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.close()')
try: print('aiter(1) =>', end=" "); t(lambda: aiter(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: aiter(1))')
try: print('aiter([1]) =>', end=" "); t(lambda: aiter([1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: aiter([1]))')
try: print('aiter() =>', end=" "); t(lambda: aiter())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: aiter())')
try: print('aiter(AIter(1), 2) =>', end=" "); t(lambda: aiter(AIter(1), 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: aiter(AIter(1), 2))')
try: print('anext(1) =>', end=" "); t(lambda: anext(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: anext(1))')
try: print('anext([1]) =>', end=" "); t(lambda: anext([1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: anext([1]))')
try: print('anext() =>', end=" "); t(lambda: anext())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: anext())')
try: print('anext(AIter(1), 1, 2) =>', end=" "); t(lambda: anext(AIter(1), 1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: anext(AIter(1), 1, 2))')
try: print('aiter(NoAnext()) =>', end=" "); t(lambda: aiter(NoAnext()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: aiter(NoAnext()))')
try: print('aiter(AiterBad()) =>', end=" "); t(lambda: aiter(AiterBad()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: aiter(AiterBad()))')
try: print('anext(iter([1])) =>', end=" "); t(lambda: anext(iter([1])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: anext(iter([1])))')
try: print('next(AIter(1)) =>', end=" "); t(lambda: next(AIter(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(AIter(1)))')
try: print('iter(AIter(1)) =>', end=" "); t(lambda: iter(AIter(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: iter(AIter(1)))')
# Exceptions in the loop body; break does not call aclose on a plain async iterator.
try:
    async def body_raises():
        async for x in AIter(3):
            if x == 2: raise ValueError("in body at %d" % x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def body_raises():')
try: print('run(body_raises()) =>', end=" "); t(lambda: run(body_raises()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(body_raises()))')
try:
    async def stop_in_body():
        async for x in AIter(3): raise StopAsyncIteration("raised by the body, not by __anext__")
        return "not swallowed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def stop_in_body():')
try: print('run(stop_in_body()) =>', end=" "); t(lambda: run(stop_in_body()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(stop_in_body()))')
try:
    async def try_in_loop():
        out = []
        async for x in AIter(3):
            try:
                if x == 2: raise ValueError
                out.append(x)
            except ValueError: out.append("caught")
            finally: out.append("f")
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def try_in_loop():')
try: print(run(try_in_loop()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(try_in_loop())')
# Interleaving two coroutines by hand.
try:
    async def worker(name, n, log):
        for i in range(n):
            log.append("%s%d" % (name, i)); await Suspend(name)
        return name + " done"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def worker(name, n, log):')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try: tasks = [worker("a", 2, log), worker("b", 3, log), worker("c", 1, log)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tasks = [worker("a", 2, log), worker("b", 3, log), worker("c", 1, log)]')
try: results = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: results = []')
try:
    while tasks:
        for tk in list(tasks):
            try: tk.send(None)
            except StopIteration as e: results.append(e.value); tasks.remove(tk)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while tasks:')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: print('results =>', results)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: results')
