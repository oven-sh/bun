import sys
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)
def run(coro):
    "Drive a coroutine to completion; every suspension is resumed with None."
    steps = []
    try:
        while True: steps.append(coro.send(None))
    except StopIteration as e:
        return (steps, e.value) if steps else e.value
class Suspend:
    "An awaitable that suspends once, yielding `tag`, and evaluates to what is sent back."
    def __init__(s, tag): s.tag = tag
    def __await__(s):
        r = yield s.tag
        return r

async def simple(): return 42
c = simple(); print(type(c).__name__, c.__name__, c.__qualname__, c.cr_running, c.cr_suspended, c.cr_await, c.cr_code is simple.__code__, c.cr_frame is not None, c.cr_origin, repr(c)[:26])
try: c.send(None)
except StopIteration as e: print("result", e.value, e.args)
print(c.cr_frame, c.cr_running, c.cr_suspended)
t(lambda: c.send(None)); t(lambda: c.throw(ValueError("x"))); print(c.close())
async def none(): pass
print(run(none()), run(simple()))
async def args(a, b=2, *c, d, **e): return a, b, c, d, e
print(run(args(1, d=4)), run(args(1, 2, 3, d=4, z=5))); t(lambda: args()); t(lambda: args(1))
async def lazy(): print("body runs only when driven", end="; "); return 1
c = lazy(); print("created"); print(run(c))
async def outer():
    a = await simple()
    b = await simple()
    return a + b
print(run(outer()))
async def chain(n): return 0 if n == 0 else 1 + await chain(n - 1)
print(run(chain(50)))
async def susp():
    x = await Suspend("first")
    y = await Suspend("second")
    return x, y
c = susp(); print(c.send(None), c.cr_suspended, type(c.cr_await).__name__, c.send("A"))
try: c.send("B")
except StopIteration as e: print(e.value)
print(run(susp()))
async def deep3(): return await Suspend("deep")
async def deep2(): return await deep3()
async def deep1(): return await deep2()
c = deep1(); print(c.send(None), c.cr_await.__name__, c.cr_await.cr_await.__name__)
try: c.send("value sent to the bottom")
except StopIteration as e: print(e.value)
t(lambda: simple().send(1)); t(lambda: simple().send()); 
# Exceptions.
async def raises(): raise ValueError("from coroutine")
t(lambda: run(raises()))
async def catches():
    try: await raises()
    except ValueError as e: return "caught " + str(e)
print(run(catches()))
async def fin():
    try: await raises()
    finally: print("finally", end="; ")
t(lambda: run(fin()))
async def thrown_into():
    try: await Suspend("waiting")
    except KeyError as e: return "handled " + repr(e)
c = thrown_into(); c.send(None)
try: c.throw(KeyError("k"))
except StopIteration as e: print(e.value)
c = thrown_into(); c.send(None); t(lambda: c.throw(ValueError("unhandled"))); t(lambda: c.send(None))
c = thrown_into(); t(lambda: c.throw(ValueError("before start"))); t(lambda: c.send(None))
async def stop_inside(): raise StopIteration("leaks")
t(lambda: run(stop_inside()))
async def stop_inside2(): next(iter([]))
try: run(stop_inside2())
except RuntimeError as e: print(e, repr(e.__cause__))
async def stop_async(): raise StopAsyncIteration("allowed here")
t(lambda: run(stop_async()))
async def returns_stop(): return StopIteration("as a value")
print(repr(run(returns_stop())))
async def returns_tuple(): return 1, 2
print(run(returns_tuple()))
# close
async def closing():
    try: await Suspend("s")
    except GeneratorExit: print("GeneratorExit in coroutine", end="; "); raise
    finally: print("cleanup", end="; ")
c = closing(); c.send(None); print(c.close(), c.cr_frame); print(c.close())
c = closing(); print(c.close()); t(lambda: c.send(None))
async def ignores_close():
    try: await Suspend("a")
    except GeneratorExit: await Suspend("b")
c = ignores_close(); c.send(None); t(c.close)
async def close_returns():
    try: await Suspend("a")
    except GeneratorExit: return "value"
c = close_returns(); c.send(None); print(c.close())
# What can be awaited.
async def aw(x): return await x
class AwIter:
    def __await__(s): return iter(["y1", "y2"])
class AwGen:
    def __await__(s):
        yield "g1"
        return "gen result"
class AwBad1:
    def __await__(s): return 5
class AwBad2:
    def __await__(s): return [1]
class AwBad3:
    def __await__(s): return simple()
class AwBad4:
    __await__ = None
class AwRaises:
    def __await__(s): raise RuntimeError("__await__ failed")
class AwInst: pass
awi = AwInst(); awi.__await__ = lambda: iter([])
print(run(aw(AwIter())), run(aw(AwGen())), run(aw(simple())), run(aw(aw(aw(simple())))))
def plain_gen(): yield 1
for x in (1, None, "s", [], iter([]), plain_gen(), plain_gen, simple, AwBad1(), AwBad2(), AwBad4(), AwRaises(), awi, object(), len, (x for x in ()), range(1), AwIter):
    t(lambda: run(aw(x)))
bad3 = aw(AwBad3()); t(lambda: run(bad3))
# A coroutine can only be awaited once, and not while running.
async def twice():
    c = simple()
    a = await c
    try: await c
    except RuntimeError as e: return a, str(e)
print(run(twice()))
async def self_await(): return await me
me = self_await(); t(lambda: me.send(None))
async def reenter():
    try: me2.send(None)
    except ValueError as e: return str(e)
me2 = reenter(); print(run(me2))
c = susp(); c.send(None)
async def await_suspended(): return await c
t(lambda: run(await_suspended())); c.close()
# Coroutines are not iterable.
c = simple()
t(lambda: iter(c)); t(lambda: next(c)); t(lambda: list(c)); t(lambda: [x for x in c]); t(lambda: len(c)); t(lambda: c()); t(lambda: c + c); t(lambda: bool(c)); t(lambda: c == c); t(lambda: hash(c) == hash(c)); t(lambda: type(c)()); t(lambda: type("X", (type(c),), {}))
def yf(): yield from c
t(lambda: list(yf()))
w = c.__await__(); print(type(w).__name__, iter(w) is w); t(lambda: next(w)); t(lambda: next(w))
c2 = susp(); w = c2.__await__(); print(next(w), w.send("x")); t(lambda: w.throw(ValueError("via wrapper"))); print(w.close())
# Attributes.
c = simple(); c.__name__ = "renamed"; c.__qualname__ = "q.renamed"; print(c.__name__, c.__qualname__, repr(c)[:28])
def s1(): c.__name__ = 1
def s2(): c.cr_code = 1
def s3(): c.x = 1
t(s1); t(s2); t(s3); c.close()
print(simple.__code__.co_flags & 0x80 != 0, simple.__code__.co_flags & 0x20 != 0, type(simple).__name__, plain_gen.__code__.co_flags & 0x80 != 0)
async def inspect_self(): return me3.cr_running, me3.cr_suspended, me3.cr_await
me3 = inspect_self(); print(run(me3))
class K:
    async def m(s, v): return ("method", v)
    @classmethod
    async def cm(cls): return cls.__name__
    @staticmethod
    async def sm(): return "static"
    async def __call__(s): return "called"
    @property
    async def p(s): return "prop"
k = K(); print(run(k.m(1)), run(K.cm()), run(K.sm()), run(k()), run(k.p), k.m(1).close(), K.m.__qualname__)
def make():
    v = 10
    async def inner(): nonlocal v; v += 1; return v
    return inner
i = make(); print(run(i()), run(i()))
# await in expressions.
async def val(v): return v
async def exprs():
    a = await val(1) + await val(2)
    b = [await val(3), await val(4)]
    c = {await val("k"): await val("v")}
    d = (await val(5)) * 2
    e = -await val(6)
    f = await val(7) if await val(True) else await val(8)
    g = f"{await val(9)} {await val(10)!r:>3}"
    h = (await val([1, 2, 3]))[await val(1)]
    i = (await val("abc")).upper()
    j = await val(await val(await val(11)))
    k = await val(2) ** await val(3)
    l = not await val(0)
    m = await val(1) < await val(2) < await val(3)
    n = (await val(lambda x: x + 1))(await val(1))
    o = print(await val("printed"), end="; ")
    p = await val(1) and await val(0) or await val("or")
    q, r = await val((1, 2))
    s = [*await val([1, 2])]
    u = dict(**await val({"z": 1}))
    return a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, u
print(run(exprs()))
async def order():
    log = []
    async def ev(n): log.append(n); return n
    x = [await ev(1), await ev(2)][await ev(0)] + await ev(3)
    (await ev({}))[await ev("k")] = await ev("v") if False else await ev("w")
    return log
print(run(order()))
async def stmts():
    out = []
    if await val(True): out.append("if")
    while await val(len(out) < 3): out.append("while")
    for x in await val([1, 2]): out.append(x)
    assert await val(True), await val("msg")
    with (await val(CM())) as c: out.append(c)
    try: raise await val(ValueError("raised"))
    except ValueError as e: out.append(str(e))
    del (await val({"a": 1, "b": 2}))["a"]
    match await val((1, 2)):
        case (a, b): out.append(a + b)
    return out
class CM:
    def __enter__(s): return "cm"
    def __exit__(s, *a): pass
print(run(stmts()))
# sys.exception() across suspensions.
async def exc_state():
    r = [repr(sys.exception())]
    try: raise KeyError("inner")
    except KeyError:
        await Suspend("in handler")
        r.append(repr(sys.exception()))
    r.append(repr(sys.exception())); return r
c = exc_state()
try: raise ValueError("outer")
except ValueError: c.send(None)
print(sys.exception())
try: c.send(None)
except StopIteration as e: print(e.value)
