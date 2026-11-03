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

async def ag():
    yield 1
    yield 2
g = ag(); print(type(g).__name__, g.__name__, g.__qualname__, g.ag_running, g.ag_suspended, g.ag_await, g.ag_code is ag.__code__, g.ag_frame is not None, aiter(g) is g, g.__aiter__() is g, repr(g)[:28])
a = g.__anext__(); print(type(a).__name__, hasattr(a, "__await__"), iter(a.__await__()) is a.__await__() or True)
try: a.send(None)
except StopIteration as e: print("yielded", e.value)
print(run(g.__anext__())); t(lambda: run(g.__anext__())); t(lambda: run(g.__anext__())); print(g.ag_frame)
async def collect(x):
    out = []
    async for v in x: out.append(v)
    return out
print(run(collect(ag())), run(collect(ag())))
async def with_await():
    yield "a"
    r = await Suspend("suspended in the generator")
    yield ("resumed with", r)
print(run(collect(with_await())))
async def empty():
    return
    yield
print(run(collect(empty())))
async def args(a, *b, c=3): yield a; yield b; yield c
print(run(collect(args(1, 2)))); t(lambda: args())
async def nested():
    async for v in ag(): yield v * 10
    for v in range(2): yield v
print(run(collect(nested())))
# asend
async def echo():
    r = None
    while True:
        r = yield ("echo", r)
        if r == "stop": return
g = echo(); print(run(g.asend(None)), run(g.asend(1)), run(g.asend("x")), run(g.__anext__())); t(lambda: run(g.asend("stop"))); t(lambda: run(g.asend(1)))
t(lambda: run(echo().asend(5))); t(lambda: echo().asend()); print(type(echo().asend(None)).__name__)
# athrow
async def thr():
    while True:
        try: yield "ready"
        except ValueError as e: yield ("caught", repr(e))
g = thr(); print(run(g.__anext__()), run(g.athrow(ValueError("v"))), run(g.__anext__()), run(g.athrow(ValueError))); t(lambda: run(g.athrow(KeyError("escapes")))); t(lambda: run(g.__anext__()))
g = thr(); t(lambda: run(g.athrow(ValueError("before start")))); t(lambda: run(g.__anext__()))
g = thr(); run(g.__anext__()); t(lambda: g.athrow()); t(lambda: run(g.athrow(1))); t(lambda: run(g.athrow("s"))); print(type(g.athrow(ValueError)).__name__)
# aclose
async def cl():
    try:
        yield 1
        yield 2
    except GeneratorExit: print("GeneratorExit", end="; "); raise
    finally: print("cleanup", end="; ")
g = cl(); run(g.__anext__()); print(run(g.aclose()), g.ag_frame); t(lambda: run(g.__anext__())); print(run(g.aclose()))
g = cl(); print(run(g.aclose())); t(lambda: run(g.__anext__()))
async def cl_await():
    try: yield 1
    finally:
        await Suspend("awaiting during cleanup"); print("cleaned", end="; ")
g = cl_await(); run(g.__anext__()); print(run(g.aclose()))
async def cl_yield():
    try: yield 1
    finally: yield "ignoring"
g = cl_yield(); run(g.__anext__()); t(lambda: run(g.aclose()))
async def cl_raise():
    try: yield 1
    finally: raise KeyError("during aclose")
g = cl_raise(); run(g.__anext__()); t(lambda: run(g.aclose()))
async def cl_swallow():
    try: yield 1
    except GeneratorExit: pass
g = cl_swallow(); run(g.__anext__()); print(run(g.aclose()))
# Exceptions.
async def boom():
    yield 1
    raise ValueError("boom")
g = boom(); print(run(g.__anext__())); t(lambda: run(g.__anext__())); t(lambda: run(g.__anext__()))
async def stop1():
    yield 1
    raise StopIteration("si")
async def stop2():
    yield 1
    raise StopAsyncIteration("sai")
for f in (stop1, stop2):
    try: run(collect(f()))
    except RuntimeError as e: print(e, repr(e.__cause__))
async def catch_in_consumer():
    try:
        async for v in boom(): pass
    except ValueError as e: return "consumer caught " + str(e)
print(run(catch_in_consumer()))
# Misuse.
g = ag()
t(lambda: iter(g)); t(lambda: next(g)); t(lambda: list(g)); t(lambda: len(g)); t(lambda: g.send(None)); t(lambda: g.close()); t(lambda: g.throw(ValueError)); t(lambda: type(g)()); t(lambda: g()); t(lambda: bool(g))
async def await_it(): await g
t(lambda: run(await_it()))
def sync_for():
    for v in g: pass
t(sync_for)
def yf(): yield from g
t(lambda: list(yf()))
# Awaiting the same __anext__ twice; concurrent use.
g = ag(); a = g.__anext__(); print(run(a)); t(lambda: run(a)); t(lambda: a.send(None))
async def slow():
    await Suspend("slow")
    yield 1
g = slow(); a1 = g.__anext__(); print(a1.send(None)); a2 = g.__anext__(); t(lambda: a2.send(None)); t(lambda: g.aclose().send(None)); t(lambda: g.athrow(ValueError).send(None)); print(g.ag_running)
try: a1.send(None)
except StopIteration as e: print(e.value)
a = ag().__anext__(); t(lambda: a.send(5)); a.close()
a = ag().__anext__(); t(lambda: a.throw(ValueError("thrown into a fresh anext"))); 
a = ag().__anext__(); print(a.close()); t(lambda: a.send(None))
# Attributes.
g = ag(); g.__name__ = "renamed"; g.__qualname__ = "q.renamed"; print(g.__name__, g.__qualname__, repr(g)[:30])
def s1(): g.ag_code = 1
def s2(): g.x = 1
t(s1); t(s2)
print(ag.__code__.co_flags & 0x200 != 0, ag.__code__.co_flags & 0x80 != 0, ag.__code__.co_flags & 0x20 != 0, type(ag).__name__)
async def selfinspect():
    yield me.ag_running, me.ag_suspended
me = selfinspect(); print(run(me.__anext__()), me.ag_running, me.ag_suspended)
g = with_await(); run(g.__anext__()); a = g.__anext__(); a.send(None); print(type(g.ag_await).__name__, g.ag_running, g.ag_suspended); a.close()
class K:
    async def __aiter__(s):
        yield "from"; yield "__aiter__"
    async def gen(s, n):
        for i in range(n): yield i
print(run(collect(K())), run(collect(K().gen(3))), K().gen(1).__qualname__)
# yield expressions of all kinds.
async def forms():
    yield
    yield None
    yield 1, 2
    yield *[1, 2], 3
    x = yield "x"
    y = (yield "y1"), (yield "y2")
    yield (x, y)
    yield await val(5)
    yield [await val(6), (yield 7)]
async def val(v): return v
print(run(collect(forms())))
# async with / try / loops inside async generators.
class ACM:
    async def __aenter__(s): print("aenter", end="; "); return "acm"
    async def __aexit__(s, t, v, tb): print("aexit", t.__name__ if t else None, end="; ")
async def inside():
    async with ACM() as a:
        yield a
        try: yield "in try"
        finally: print("finally", end="; ")
    for i in range(2):
        if i: break
        yield i
    else: yield "no"
print(run(collect(inside())))
g = inside(); run(g.__anext__()); print(run(g.aclose()))
g = inside(); run(g.__anext__()); t(lambda: run(g.athrow(ValueError("into the async with"))))
# A pipeline.
async def numbers(n):
    for i in range(n): yield i
async def squares(src):
    async for v in src: yield v * v
async def odd(src):
    async for v in src:
        if v % 2: yield v
print(run(collect(odd(squares(numbers(8))))))
async def take(src, n):
    async for v in src:
        if n <= 0: break
        n -= 1; yield v
async def forever():
    i = 0
    while True: yield i; i += 1
src = forever(); print(run(collect(take(src, 3))), run(src.aclose()))
# sys.get/set_asyncgen_hooks
import sys
print(sys.get_asyncgen_hooks(), type(sys.get_asyncgen_hooks()).__name__)
seen = []
sys.set_asyncgen_hooks(firstiter=lambda g: seen.append(("first", g.__name__)))
g = ag(); print(seen); run(g.__anext__()); print(seen); run(g.__anext__()); print(seen); print(sys.get_asyncgen_hooks().finalizer)
sys.set_asyncgen_hooks(firstiter=None); g2 = ag(); run(g2.__anext__()); print(seen); t(lambda: sys.set_asyncgen_hooks(firstiter=1)); t(lambda: sys.set_asyncgen_hooks(finalizer="x")); t(lambda: sys.set_asyncgen_hooks(1))
run(g.aclose()); run(g2.aclose())
