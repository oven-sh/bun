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
    async def ag():
        yield 1
        yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def ag():')
try: g = ag()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = ag()')
try: print('type(g).__name__ =>', type(g).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(g).__name__')
try: print('g.__name__ =>', g.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__name__')
try: print('g.__qualname__ =>', g.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__qualname__')
try: print('g.ag_running =>', g.ag_running)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.ag_running')
try: print('g.ag_suspended =>', g.ag_suspended)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.ag_suspended')
try: print('g.ag_await =>', g.ag_await)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.ag_await')
try: print('g.ag_code is ag.__code__ =>', g.ag_code is ag.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.ag_code is ag.__code__')
try: print('g.ag_frame is not None =>', g.ag_frame is not None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.ag_frame is not None')
try: print('aiter(g) is g =>', aiter(g) is g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: aiter(g) is g')
try: print('g.__aiter__() is g =>', g.__aiter__() is g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__aiter__() is g')
try: print('repr(g)[:28] =>', repr(g)[:28])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(g)[:28]')
try: a = g.__anext__()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = g.__anext__()')
try: print('type(a).__name__ =>', type(a).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(a).__name__')
try: print('hasattr(a, "__await__") =>', hasattr(a, "__await__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(a, "__await__")')
try: print('iter(a.__await__()) is a.__await__() or True =>', iter(a.__await__()) is a.__await__() or True)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: iter(a.__await__()) is a.__await__() or True')
try:
    try: a.send(None)
    except StopIteration as e: print("yielded", e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: a.send(None)')
try: print(run(g.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print('run(g.__anext__()) =>', end=" "); t(lambda: run(g.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.__anext__()))')
try: print('run(g.__anext__()) =>', end=" "); t(lambda: run(g.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.__anext__()))')
try: print(g.ag_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.ag_frame')
try:
    async def collect(x):
        out = []
        async for v in x: out.append(v)
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def collect(x):')
try: print('run(collect(ag())) =>', run(collect(ag())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(collect(ag()))')
try: print('run(collect(ag())) =>', run(collect(ag())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(collect(ag()))')
try:
    async def with_await():
        yield "a"
        r = await Suspend("suspended in the generator")
        yield ("resumed with", r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def with_await():')
try: print(run(collect(with_await())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(collect(with_await()))')
try:
    async def empty():
        return
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def empty():')
try: print(run(collect(empty())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(collect(empty()))')
try:
    async def args(a, *b, c=3): yield a; yield b; yield c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def args(a, *b, c=3): yield a; yield b; yield c')
try: print(run(collect(args(1, 2))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(collect(args(1, 2)))')
try: print('args() =>', end=" "); t(lambda: args())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: args())')
try:
    async def nested():
        async for v in ag(): yield v * 10
        for v in range(2): yield v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def nested():')
try: print(run(collect(nested())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(collect(nested()))')
# asend
try:
    async def echo():
        r = None
        while True:
            r = yield ("echo", r)
            if r == "stop": return
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def echo():')
try: g = echo()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = echo()')
try: print('run(g.asend(None)) =>', run(g.asend(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.asend(None))')
try: print('run(g.asend(1)) =>', run(g.asend(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.asend(1))')
try: print('run(g.asend("x")) =>', run(g.asend("x")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.asend("x"))')
try: print('run(g.__anext__()) =>', run(g.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print('run(g.asend("stop")) =>', end=" "); t(lambda: run(g.asend("stop")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.asend("stop")))')
try: print('run(g.asend(1)) =>', end=" "); t(lambda: run(g.asend(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.asend(1)))')
try: print('run(echo().asend(5)) =>', end=" "); t(lambda: run(echo().asend(5)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(echo().asend(5)))')
try: print('echo().asend() =>', end=" "); t(lambda: echo().asend())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: echo().asend())')
try: print(type(echo().asend(None)).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(echo().asend(None)).__name__')
# athrow
try:
    async def thr():
        while True:
            try: yield "ready"
            except ValueError as e: yield ("caught", repr(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def thr():')
try: g = thr()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = thr()')
try: print('run(g.__anext__()) =>', run(g.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print('run(g.athrow(ValueError("v"))) =>', run(g.athrow(ValueError("v"))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.athrow(ValueError("v")))')
try: print('run(g.__anext__()) =>', run(g.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print('run(g.athrow(ValueError)) =>', run(g.athrow(ValueError)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.athrow(ValueError))')
try: print('run(g.athrow(KeyError("escapes"))) =>', end=" "); t(lambda: run(g.athrow(KeyError("escapes"))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.athrow(KeyError("escapes"))))')
try: print('run(g.__anext__()) =>', end=" "); t(lambda: run(g.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.__anext__()))')
try: g = thr()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = thr()')
try: print('run(g.athrow(ValueError("before start"))) =>', end=" "); t(lambda: run(g.athrow(ValueError("before start"))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.athrow(ValueError("before start"))))')
try: print('run(g.__anext__()) =>', end=" "); t(lambda: run(g.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.__anext__()))')
try: g = thr()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = thr()')
try: run(g.__anext__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print('g.athrow() =>', end=" "); t(lambda: g.athrow())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.athrow())')
try: print('run(g.athrow(1)) =>', end=" "); t(lambda: run(g.athrow(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.athrow(1)))')
try: print('run(g.athrow("s")) =>', end=" "); t(lambda: run(g.athrow("s")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.athrow("s")))')
try: print(type(g.athrow(ValueError)).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(g.athrow(ValueError)).__name__')
# aclose
try:
    async def cl():
        try:
            yield 1
            yield 2
        except GeneratorExit: print("GeneratorExit", end="; "); raise
        finally: print("cleanup", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def cl():')
try: g = cl()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl()')
try: run(g.__anext__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print('run(g.aclose()) =>', run(g.aclose()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.aclose())')
try: print('g.ag_frame =>', g.ag_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.ag_frame')
try: print('run(g.__anext__()) =>', end=" "); t(lambda: run(g.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.__anext__()))')
try: print(run(g.aclose()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.aclose())')
try: g = cl()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl()')
try: print(run(g.aclose()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.aclose())')
try: print('run(g.__anext__()) =>', end=" "); t(lambda: run(g.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.__anext__()))')
try:
    async def cl_await():
        try: yield 1
        finally:
            await Suspend("awaiting during cleanup"); print("cleaned", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def cl_await():')
try: g = cl_await()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_await()')
try: run(g.__anext__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print(run(g.aclose()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.aclose())')
try:
    async def cl_yield():
        try: yield 1
        finally: yield "ignoring"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def cl_yield():')
try: g = cl_yield()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_yield()')
try: run(g.__anext__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print('run(g.aclose()) =>', end=" "); t(lambda: run(g.aclose()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.aclose()))')
try:
    async def cl_raise():
        try: yield 1
        finally: raise KeyError("during aclose")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def cl_raise():')
try: g = cl_raise()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_raise()')
try: run(g.__anext__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print('run(g.aclose()) =>', end=" "); t(lambda: run(g.aclose()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.aclose()))')
try:
    async def cl_swallow():
        try: yield 1
        except GeneratorExit: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def cl_swallow():')
try: g = cl_swallow()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_swallow()')
try: run(g.__anext__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print(run(g.aclose()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.aclose())')
# Exceptions.
try:
    async def boom():
        yield 1
        raise ValueError("boom")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def boom():')
try: g = boom()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = boom()')
try: print(run(g.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print('run(g.__anext__()) =>', end=" "); t(lambda: run(g.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.__anext__()))')
try: print('run(g.__anext__()) =>', end=" "); t(lambda: run(g.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.__anext__()))')
try:
    async def stop1():
        yield 1
        raise StopIteration("si")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def stop1():')
try:
    async def stop2():
        yield 1
        raise StopAsyncIteration("sai")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def stop2():')
try:
    for f in (stop1, stop2):
        try: run(collect(f()))
        except RuntimeError as e: print(e, repr(e.__cause__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (stop1, stop2):')
try:
    async def catch_in_consumer():
        try:
            async for v in boom(): pass
        except ValueError as e: return "consumer caught " + str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def catch_in_consumer():')
try: print(run(catch_in_consumer()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(catch_in_consumer())')
# Misuse.
try: g = ag()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = ag()')
try: print('iter(g) =>', end=" "); t(lambda: iter(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: iter(g))')
try: print('next(g) =>', end=" "); t(lambda: next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(g))')
try: print('list(g) =>', end=" "); t(lambda: list(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list(g))')
try: print('len(g) =>', end=" "); t(lambda: len(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len(g))')
try: print('g.send(None) =>', end=" "); t(lambda: g.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.send(None))')
try: print('g.close() =>', end=" "); t(lambda: g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.close())')
try: print('g.throw(ValueError) =>', end=" "); t(lambda: g.throw(ValueError))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(ValueError))')
try: print('type(g)() =>', end=" "); t(lambda: type(g)())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(g)())')
try: print('g() =>', end=" "); t(lambda: g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g())')
try: print('bool(g) =>', end=" "); t(lambda: bool(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bool(g))')
try:
    async def await_it(): await g
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def await_it(): await g')
try: print('run(await_it()) =>', end=" "); t(lambda: run(await_it()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(await_it()))')
try:
    def sync_for():
        for v in g: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sync_for():')
try: print('sync_for() =>', end=" "); t(sync_for)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(sync_for)')
try:
    def yf(): yield from g
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def yf(): yield from g')
try: print('list(yf()) =>', end=" "); t(lambda: list(yf()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list(yf()))')
# Awaiting the same __anext__ twice; concurrent use.
try: g = ag()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = ag()')
try: a = g.__anext__()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = g.__anext__()')
try: print(run(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(a)')
try: print('run(a) =>', end=" "); t(lambda: run(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(a))')
try: print('a.send(None) =>', end=" "); t(lambda: a.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a.send(None))')
try:
    async def slow():
        await Suspend("slow")
        yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def slow():')
try: g = slow()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = slow()')
try: a1 = g.__anext__()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a1 = g.__anext__()')
try: print(a1.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a1.send(None)')
try: a2 = g.__anext__()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a2 = g.__anext__()')
try: print('a2.send(None) =>', end=" "); t(lambda: a2.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a2.send(None))')
try: print('g.aclose().send(None) =>', end=" "); t(lambda: g.aclose().send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.aclose().send(None))')
try: print('g.athrow(ValueError).send(None) =>', end=" "); t(lambda: g.athrow(ValueError).send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.athrow(ValueError).send(None))')
try: print(g.ag_running)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.ag_running')
try:
    try: a1.send(None)
    except StopIteration as e: print(e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: a1.send(None)')
try: a = ag().__anext__()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = ag().__anext__()')
try: print('a.send(5) =>', end=" "); t(lambda: a.send(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a.send(5))')
try: a.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.close()')
try: a = ag().__anext__()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = ag().__anext__()')
try: print('a.throw(ValueError("thrown into a fresh anext")) =>', end=" "); t(lambda: a.throw(ValueError("thrown into a fresh anext")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a.throw(ValueError("thrown into a fresh anext")))')
try: a = ag().__anext__()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = ag().__anext__()')
try: print(a.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.close()')
try: print('a.send(None) =>', end=" "); t(lambda: a.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a.send(None))')
# Attributes.
try: g = ag()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = ag()')
try: g.__name__ = "renamed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__name__ = "renamed"')
try: g.__qualname__ = "q.renamed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__qualname__ = "q.renamed"')
try: print('g.__name__ =>', g.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__name__')
try: print('g.__qualname__ =>', g.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__qualname__')
try: print('repr(g)[:30] =>', repr(g)[:30])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(g)[:30]')
try:
    def s1(): g.ag_code = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s1(): g.ag_code = 1')
try:
    def s2(): g.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s2(): g.x = 1')
try: print('s1() =>', end=" "); t(s1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s1)')
try: print('s2() =>', end=" "); t(s2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s2)')
try: print('ag.__code__.co_flags & 0x200 != 0 =>', ag.__code__.co_flags & 0x200 != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ag.__code__.co_flags & 0x200 != 0')
try: print('ag.__code__.co_flags & 0x80 != 0 =>', ag.__code__.co_flags & 0x80 != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ag.__code__.co_flags & 0x80 != 0')
try: print('ag.__code__.co_flags & 0x20 != 0 =>', ag.__code__.co_flags & 0x20 != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ag.__code__.co_flags & 0x20 != 0')
try: print('type(ag).__name__ =>', type(ag).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(ag).__name__')
try:
    async def selfinspect():
        yield me.ag_running, me.ag_suspended
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def selfinspect():')
try: me = selfinspect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me = selfinspect()')
try: print('run(me.__anext__()) =>', run(me.__anext__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(me.__anext__())')
try: print('me.ag_running =>', me.ag_running)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me.ag_running')
try: print('me.ag_suspended =>', me.ag_suspended)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me.ag_suspended')
try: g = with_await()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = with_await()')
try: run(g.__anext__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: a = g.__anext__()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = g.__anext__()')
try: a.send(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.send(None)')
try: print('type(g.ag_await).__name__ =>', type(g.ag_await).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(g.ag_await).__name__')
try: print('g.ag_running =>', g.ag_running)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.ag_running')
try: print('g.ag_suspended =>', g.ag_suspended)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.ag_suspended')
try: a.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.close()')
try:
    class K:
        async def __aiter__(s):
            yield "from"; yield "__aiter__"
        async def gen(s, n):
            for i in range(n): yield i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K:')
try: print('run(collect(K())) =>', run(collect(K())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(collect(K()))')
try: print('run(collect(K().gen(3))) =>', run(collect(K().gen(3))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(collect(K().gen(3)))')
try: print('K().gen(1).__qualname__ =>', K().gen(1).__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: K().gen(1).__qualname__')
# yield expressions of all kinds.
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def forms():')
try:
    async def val(v): return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def val(v): return v')
try: print(run(collect(forms())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(collect(forms()))')
# async with / try / loops inside async generators.
try:
    class ACM:
        async def __aenter__(s): print("aenter", end="; "); return "acm"
        async def __aexit__(s, t, v, tb): print("aexit", t.__name__ if t else None, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ACM:')
try:
    async def inside():
        async with ACM() as a:
            yield a
            try: yield "in try"
            finally: print("finally", end="; ")
        for i in range(2):
            if i: break
            yield i
        else: yield "no"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def inside():')
try: print(run(collect(inside())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(collect(inside()))')
try: g = inside()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = inside()')
try: run(g.__anext__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print(run(g.aclose()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.aclose())')
try: g = inside()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = inside()')
try: run(g.__anext__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print('run(g.athrow(ValueError("into the async with"))) =>', end=" "); t(lambda: run(g.athrow(ValueError("into the async with"))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(g.athrow(ValueError("into the async with"))))')
# A pipeline.
try:
    async def numbers(n):
        for i in range(n): yield i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def numbers(n):')
try:
    async def squares(src):
        async for v in src: yield v * v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def squares(src):')
try:
    async def odd(src):
        async for v in src:
            if v % 2: yield v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def odd(src):')
try: print(run(collect(odd(squares(numbers(8))))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(collect(odd(squares(numbers(8)))))')
try:
    async def take(src, n):
        async for v in src:
            if n <= 0: break
            n -= 1; yield v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def take(src, n):')
try:
    async def forever():
        i = 0
        while True: yield i; i += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def forever():')
try: src = forever()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: src = forever()')
try: print('run(collect(take(src, 3))) =>', run(collect(take(src, 3))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(collect(take(src, 3)))')
try: print('run(src.aclose()) =>', run(src.aclose()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(src.aclose())')
# sys.get/set_asyncgen_hooks
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: print('sys.get_asyncgen_hooks() =>', sys.get_asyncgen_hooks())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.get_asyncgen_hooks()')
try: print('type(sys.get_asyncgen_hooks()).__name__ =>', type(sys.get_asyncgen_hooks()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(sys.get_asyncgen_hooks()).__name__')
try: seen = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')
try: sys.set_asyncgen_hooks(firstiter=lambda g: seen.append(("first", g.__name__)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.set_asyncgen_hooks(firstiter=lambda g: seen.append(("first", g.__...')
try: g = ag()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = ag()')
try: print(seen)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
try: run(g.__anext__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print(seen)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
try: run(g.__anext__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.__anext__())')
try: print(seen)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
try: print(sys.get_asyncgen_hooks().finalizer)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.get_asyncgen_hooks().finalizer')
try: sys.set_asyncgen_hooks(firstiter=None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.set_asyncgen_hooks(firstiter=None)')
try: g2 = ag()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g2 = ag()')
try: run(g2.__anext__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g2.__anext__())')
try: print(seen)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
try: print('sys.set_asyncgen_hooks(firstiter=1) =>', end=" "); t(lambda: sys.set_asyncgen_hooks(firstiter=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys.set_asyncgen_hooks(firstiter=1))')
try: print('sys.set_asyncgen_hooks(finalizer="x") =>', end=" "); t(lambda: sys.set_asyncgen_hooks(finalizer="x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys.set_asyncgen_hooks(finalizer="x"))')
try: print('sys.set_asyncgen_hooks(1) =>', end=" "); t(lambda: sys.set_asyncgen_hooks(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys.set_asyncgen_hooks(1))')
try: run(g.aclose())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g.aclose())')
try: run(g2.aclose())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(g2.aclose())')
