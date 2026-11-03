def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)
def run(coro):
    steps = []
    try:
        while True: steps.append(coro.send(None))
    except StopIteration as e:
        return (steps, e.value) if steps else e.value
class Suspend:
    def __init__(s, tag): s.tag = tag
    def __await__(s):
        r = yield s.tag
        return r

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
async def w1():
    async with ACM(): print("body", end="; ")
async def w2():
    async with ACM("n") as a: return a.name
async def w3():
    async with ACM("a") as a, ACM("b") as b: print(a.name + b.name, end="; ")
async def w4():
    async with (ACM("a") as a, ACM("b") as b,): print("parenthesised", end="; ")
async def w5():
    async with ACM("s", suspend=True): print("body", end="; "); await Suspend("in body")
    return "done"
async def w6():
    async with ACM(): raise ValueError("propagates")
async def w7():
    async with ACM(suppress=True): raise ValueError("suppressed")
    return "continues"
async def w8():
    async with ACM("outer"):
        async with ACM("inner", suppress=True): raise KeyError("k")
    return "ok"
async def w9():
    for i in range(3):
        async with ACM(str(i)):
            if i == 0: continue
            if i == 1: break
    return i
async def w10():
    async with ACM("a"):
        with CM():
            async with ACM("b"): return "mixed"
class CM:
    def __enter__(s): print("enter", end="; ")
    def __exit__(s, *a): print("exit", end="; ")
for f in (w1, w2, w3, w4, w5, w6, w7, w8, w9, w10): t(lambda: run(f()))
# Objects that do not qualify.
class NoAexit:
    async def __aenter__(s): pass
class NoAenter:
    async def __aexit__(s, *a): pass
class SyncMethods:
    def __aenter__(s): return 5
    def __aexit__(s, *a): return 5
class SyncExit:
    async def __aenter__(s): pass
    def __aexit__(s, *a): return None
async def aw(x):
    async with x: print("body", end="; ")
for x in (1, None, CM(), NoAexit(), NoAenter(), SyncMethods(), SyncExit(), object(), [], ACM): t(lambda: run(aw(x)))
def sync_with(x):
    with x: pass
t(lambda: sync_with(ACM()))
class AenterRaises:
    async def __aenter__(s): raise RuntimeError("aenter failed")
    async def __aexit__(s, *a): print("must not run")
class AexitRaises:
    async def __aenter__(s): pass
    async def __aexit__(s, *a): raise RuntimeError("aexit failed")
t(lambda: run(aw(AenterRaises()))); t(lambda: run(aw(AexitRaises())))
async def ctx():
    try:
        async with AexitRaises(): raise ValueError("body")
    except RuntimeError as e: return repr(e), repr(e.__context__)
print(run(ctx()))
class AwaitableResult:
    def __aenter__(s): return Suspend("custom awaitable enter")
    def __aexit__(s, *a): return Suspend("custom awaitable exit")
async def car():
    async with AwaitableResult() as v: return ("entered with", v)
c = car(); print(c.send(None), c.send("sent value"))
try: c.send(True)
except StopIteration as e: print(e.value)
# async for
class AIter:
    def __init__(s, n, suspend=False): s.n = n; s.i = 0; s.suspend = suspend
    def __aiter__(s): return s
    async def __anext__(s):
        if s.i >= s.n: raise StopAsyncIteration
        s.i += 1
        if s.suspend: await Suspend("item %d" % s.i)
        return s.i
async def f1():
    out = []
    async for x in AIter(3): out.append(x)
    return out
async def f2():
    out = []
    async for x in AIter(2): out.append(x)
    else: out.append("else")
    return out
async def f3():
    async for x in AIter(5):
        if x == 2: break
    else: return "no break"
    return x
async def f4():
    out = []
    async for x in AIter(4):
        if x % 2: continue
        out.append(x)
    return out
async def f5():
    out = []
    async for x in AIter(2, suspend=True): out.append(x)
    return out
async def f6():
    out = []
    async for x in AIter(2):
        async for y in AIter(2): out.append((x, y))
    return out
async def f7():
    async for x in AIter(0): return "never"
    else: return "empty"
async def f8():
    async for x in AIter(3): return x
class Pairs:
    def __init__(s): s.it = iter([(1, 2), (3, 4)])
    def __aiter__(s): return s
    async def __anext__(s):
        try: return next(s.it)
        except StopIteration: raise StopAsyncIteration from None
async def f9():
    out = []
    async for a, b in Pairs(): out.append(a + b)
    return out
async def f10():
    class O: pass
    o = O(); l = [0]
    async for o.x in AIter(2): pass
    async for l[0] in AIter(3): pass
    async for (a, *b) in Pairs(): pass
    return o.x, l, a, b
async def f11():
    async for x in AIter(1): pass
    return x
for f in (f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11): t(lambda: run(f()))
class NoAnext:
    def __aiter__(s): return s
class AiterCoroutine:
    async def __aiter__(s): return s
    async def __anext__(s): raise StopAsyncIteration
class AiterBad:
    def __aiter__(s): return 5
class SyncAnext:
    def __aiter__(s): return s
    def __anext__(s): return 5
class AnextRaises:
    def __aiter__(s): return s
    async def __anext__(s): raise KeyError("anext failed")
class AnextStopIteration:
    def __aiter__(s): return s
    async def __anext__(s): raise StopIteration("wrong kind")
class AiterRaises:
    def __aiter__(s): raise RuntimeError("aiter failed")
class SyncAnextRaisesStop:
    def __aiter__(s): return s
    def __anext__(s): raise StopAsyncIteration
async def af(x):
    async for v in x: print("item", v, end="; ")
    return "finished"
for x in (1, None, [1], iter([1]), "s", NoAnext(), AiterCoroutine(), AiterBad(), SyncAnext(), AnextRaises(), AnextStopIteration(), AiterRaises(), SyncAnextRaisesStop(), object(), range(2), (x for x in ()), AIter): t(lambda: run(af(x)))
def sync_for(x):
    for v in x: pass
t(lambda: sync_for(AIter(1)))
# aiter() and anext()
async def b1():
    it = aiter(AIter(2))
    return await anext(it), await anext(it), await anext(it, "default"), await anext(it, None)
async def b2():
    it = AIter(0)
    try: await anext(it)
    except StopAsyncIteration as e: return "StopAsyncIteration", e.args
print(run(b1()), run(b2()), type(aiter(AIter(1))).__name__)
a = anext(AIter(1)); print(type(a).__name__); a.close()
a = anext(AIter(1), "d"); print(type(a).__name__, hasattr(a, "__await__"), hasattr(a, "send")); a.close()
t(lambda: aiter(1)); t(lambda: aiter([1])); t(lambda: aiter()); t(lambda: aiter(AIter(1), 2)); t(lambda: anext(1)); t(lambda: anext([1])); t(lambda: anext()); t(lambda: anext(AIter(1), 1, 2)); t(lambda: aiter(NoAnext())); t(lambda: aiter(AiterBad())); t(lambda: anext(iter([1]))); t(lambda: next(AIter(1))); t(lambda: iter(AIter(1)))
# Exceptions in the loop body; break does not call aclose on a plain async iterator.
async def body_raises():
    async for x in AIter(3):
        if x == 2: raise ValueError("in body at %d" % x)
t(lambda: run(body_raises()))
async def stop_in_body():
    async for x in AIter(3): raise StopAsyncIteration("raised by the body, not by __anext__")
    return "not swallowed"
t(lambda: run(stop_in_body()))
async def try_in_loop():
    out = []
    async for x in AIter(3):
        try:
            if x == 2: raise ValueError
            out.append(x)
        except ValueError: out.append("caught")
        finally: out.append("f")
    return out
print(run(try_in_loop()))
# Interleaving two coroutines by hand.
async def worker(name, n, log):
    for i in range(n):
        log.append("%s%d" % (name, i)); await Suspend(name)
    return name + " done"
log = []; tasks = [worker("a", 2, log), worker("b", 3, log), worker("c", 1, log)]; results = []
while tasks:
    for tk in list(tasks):
        try: tk.send(None)
        except StopIteration as e: results.append(e.value); tasks.remove(tk)
print(log, results)
