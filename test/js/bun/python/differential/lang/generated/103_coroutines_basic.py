try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')
try:
    def run(coro):
        "Drive a coroutine to completion; every suspension is resumed with None."
        steps = []
        try:
            while True: steps.append(coro.send(None))
        except StopIteration as e:
            return (steps, e.value) if steps else e.value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(coro):')
try:
    class Suspend:
        "An awaitable that suspends once, yielding `tag`, and evaluates to what is sent back."
        def __init__(s, tag): s.tag = tag
        def __await__(s):
            r = yield s.tag
            return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Suspend:')

try:
    async def simple(): return 42
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def simple(): return 42')
try: c = simple()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = simple()')
try: print('type(c).__name__ =>', type(c).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(c).__name__')
try: print('c.__name__ =>', c.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.__name__')
try: print('c.__qualname__ =>', c.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.__qualname__')
try: print('c.cr_running =>', c.cr_running)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_running')
try: print('c.cr_suspended =>', c.cr_suspended)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_suspended')
try: print('c.cr_await =>', c.cr_await)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_await')
try: print('c.cr_code is simple.__code__ =>', c.cr_code is simple.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_code is simple.__code__')
try: print('c.cr_frame is not None =>', c.cr_frame is not None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_frame is not None')
try: print('c.cr_origin =>', c.cr_origin)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_origin')
try: print('repr(c)[:26] =>', repr(c)[:26])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(c)[:26]')
try:
    try: c.send(None)
    except StopIteration as e: print("result", e.value, e.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: c.send(None)')
try: print('c.cr_frame =>', c.cr_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_frame')
try: print('c.cr_running =>', c.cr_running)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_running')
try: print('c.cr_suspended =>', c.cr_suspended)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_suspended')
try: print('c.send(None) =>', end=" "); t(lambda: c.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c.send(None))')
try: print('c.throw(ValueError("x")) =>', end=" "); t(lambda: c.throw(ValueError("x")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c.throw(ValueError("x")))')
try: print(c.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.close()')
try:
    async def none(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def none(): pass')
try: print('run(none()) =>', run(none()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(none())')
try: print('run(simple()) =>', run(simple()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(simple())')
try:
    async def args(a, b=2, *c, d, **e): return a, b, c, d, e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def args(a, b=2, *c, d, **e): return a, b, c, d, e')
try: print('run(args(1, d=4)) =>', run(args(1, d=4)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(args(1, d=4))')
try: print('run(args(1, 2, 3, d=4, z=5)) =>', run(args(1, 2, 3, d=4, z=5)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(args(1, 2, 3, d=4, z=5))')
try: print('args() =>', end=" "); t(lambda: args())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: args())')
try: print('args(1) =>', end=" "); t(lambda: args(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: args(1))')
try:
    async def lazy(): print("body runs only when driven", end="; "); return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def lazy(): print("body runs only when driven", end="; "); retu...')
try: c = lazy()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = lazy()')
try: print("created")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "created"')
try: print(run(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(c)')
try:
    async def outer():
        a = await simple()
        b = await simple()
        return a + b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def outer():')
try: print(run(outer()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(outer())')
try:
    async def chain(n): return 0 if n == 0 else 1 + await chain(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def chain(n): return 0 if n == 0 else 1 + await chain(n - 1)')
try: print(run(chain(50)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(chain(50))')
try:
    async def susp():
        x = await Suspend("first")
        y = await Suspend("second")
        return x, y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def susp():')
try: c = susp()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = susp()')
try: print('c.send(None) =>', c.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: print('c.cr_suspended =>', c.cr_suspended)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_suspended')
try: print('type(c.cr_await).__name__ =>', type(c.cr_await).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(c.cr_await).__name__')
try: print('c.send("A") =>', c.send("A"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send("A")')
try:
    try: c.send("B")
    except StopIteration as e: print(e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: c.send("B")')
try: print(run(susp()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(susp())')
try:
    async def deep3(): return await Suspend("deep")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def deep3(): return await Suspend("deep")')
try:
    async def deep2(): return await deep3()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def deep2(): return await deep3()')
try:
    async def deep1(): return await deep2()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def deep1(): return await deep2()')
try: c = deep1()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = deep1()')
try: print('c.send(None) =>', c.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: print('c.cr_await.__name__ =>', c.cr_await.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_await.__name__')
try: print('c.cr_await.cr_await.__name__ =>', c.cr_await.cr_await.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_await.cr_await.__name__')
try:
    try: c.send("value sent to the bottom")
    except StopIteration as e: print(e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: c.send("value sent to the bottom")')
try: print('simple().send(1) =>', end=" "); t(lambda: simple().send(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: simple().send(1))')
try: print('simple().send() =>', end=" "); t(lambda: simple().send())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: simple().send())')
# Exceptions.
try:
    async def raises(): raise ValueError("from coroutine")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def raises(): raise ValueError("from coroutine")')
try: print('run(raises()) =>', end=" "); t(lambda: run(raises()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(raises()))')
try:
    async def catches():
        try: await raises()
        except ValueError as e: return "caught " + str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def catches():')
try: print(run(catches()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(catches())')
try:
    async def fin():
        try: await raises()
        finally: print("finally", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def fin():')
try: print('run(fin()) =>', end=" "); t(lambda: run(fin()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(fin()))')
try:
    async def thrown_into():
        try: await Suspend("waiting")
        except KeyError as e: return "handled " + repr(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def thrown_into():')
try: c = thrown_into()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = thrown_into()')
try: c.send(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try:
    try: c.throw(KeyError("k"))
    except StopIteration as e: print(e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: c.throw(KeyError("k"))')
try: c = thrown_into()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = thrown_into()')
try: c.send(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: print('c.throw(ValueError("unhandled")) =>', end=" "); t(lambda: c.throw(ValueError("unhandled")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c.throw(ValueError("unhandled")))')
try: print('c.send(None) =>', end=" "); t(lambda: c.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c.send(None))')
try: c = thrown_into()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = thrown_into()')
try: print('c.throw(ValueError("before start")) =>', end=" "); t(lambda: c.throw(ValueError("before start")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c.throw(ValueError("before start")))')
try: print('c.send(None) =>', end=" "); t(lambda: c.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c.send(None))')
try:
    async def stop_inside(): raise StopIteration("leaks")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def stop_inside(): raise StopIteration("leaks")')
try: print('run(stop_inside()) =>', end=" "); t(lambda: run(stop_inside()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(stop_inside()))')
try:
    async def stop_inside2(): next(iter([]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def stop_inside2(): next(iter([]))')
try:
    try: run(stop_inside2())
    except RuntimeError as e: print(e, repr(e.__cause__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: run(stop_inside2())')
try:
    async def stop_async(): raise StopAsyncIteration("allowed here")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def stop_async(): raise StopAsyncIteration("allowed here")')
try: print('run(stop_async()) =>', end=" "); t(lambda: run(stop_async()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(stop_async()))')
try:
    async def returns_stop(): return StopIteration("as a value")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def returns_stop(): return StopIteration("as a value")')
try: print(repr(run(returns_stop())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(run(returns_stop()))')
try:
    async def returns_tuple(): return 1, 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def returns_tuple(): return 1, 2')
try: print(run(returns_tuple()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(returns_tuple())')
# close
try:
    async def closing():
        try: await Suspend("s")
        except GeneratorExit: print("GeneratorExit in coroutine", end="; "); raise
        finally: print("cleanup", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def closing():')
try: c = closing()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = closing()')
try: c.send(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: print('c.close() =>', c.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.close()')
try: print('c.cr_frame =>', c.cr_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_frame')
try: print(c.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.close()')
try: c = closing()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = closing()')
try: print(c.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.close()')
try: print('c.send(None) =>', end=" "); t(lambda: c.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c.send(None))')
try:
    async def ignores_close():
        try: await Suspend("a")
        except GeneratorExit: await Suspend("b")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def ignores_close():')
try: c = ignores_close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = ignores_close()')
try: c.send(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: print('c.close() =>', end=" "); t(c.close)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(c.close)')
try:
    async def close_returns():
        try: await Suspend("a")
        except GeneratorExit: return "value"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def close_returns():')
try: c = close_returns()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = close_returns()')
try: c.send(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: print(c.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.close()')
# What can be awaited.
try:
    async def aw(x): return await x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def aw(x): return await x')
try:
    class AwIter:
        def __await__(s): return iter(["y1", "y2"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AwIter:')
try:
    class AwGen:
        def __await__(s):
            yield "g1"
            return "gen result"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AwGen:')
try:
    class AwBad1:
        def __await__(s): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AwBad1:')
try:
    class AwBad2:
        def __await__(s): return [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AwBad2:')
try:
    class AwBad3:
        def __await__(s): return simple()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AwBad3:')
try:
    class AwBad4:
        __await__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AwBad4:')
try:
    class AwRaises:
        def __await__(s): raise RuntimeError("__await__ failed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AwRaises:')
try:
    class AwInst: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AwInst: pass')
try: awi = AwInst()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: awi = AwInst()')
try: awi.__await__ = lambda: iter([])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: awi.__await__ = lambda: iter([])')
try: print('run(aw(AwIter())) =>', run(aw(AwIter())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(aw(AwIter()))')
try: print('run(aw(AwGen())) =>', run(aw(AwGen())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(aw(AwGen()))')
try: print('run(aw(simple())) =>', run(aw(simple())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(aw(simple()))')
try: print('run(aw(aw(aw(simple())))) =>', run(aw(aw(aw(simple())))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(aw(aw(aw(simple()))))')
try:
    def plain_gen(): yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain_gen(): yield 1')
try:
    for x in (1, None, "s", [], iter([]), plain_gen(), plain_gen, simple, AwBad1(), AwBad2(), AwBad4(), AwRaises(), awi, object(), len, (x for x in ()), range(1), AwIter):
        try: print('run(aw(x)) [' + 'x=' + (repr(x) if type(x) in (str, int, float, bytes, bool, type(None)) or (type(x) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in x)) else x.__name__ if type(x) is type else type(x).__name__) + '] =>', end=" "); t(lambda: run(aw(x)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(aw(x)))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in (1, None, "s", [], iter([]), plain_gen(), plain_gen, simple,...')
try: bad3 = aw(AwBad3())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bad3 = aw(AwBad3())')
try: print('run(bad3) =>', end=" "); t(lambda: run(bad3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(bad3))')
# A coroutine can only be awaited once, and not while running.
try:
    async def twice():
        c = simple()
        a = await c
        try: await c
        except RuntimeError as e: return a, str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def twice():')
try: print(run(twice()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(twice())')
try:
    async def self_await(): return await me
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def self_await(): return await me')
try: me = self_await()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me = self_await()')
try: print('me.send(None) =>', end=" "); t(lambda: me.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: me.send(None))')
try:
    async def reenter():
        try: me2.send(None)
        except ValueError as e: return str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def reenter():')
try: me2 = reenter()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me2 = reenter()')
try: print(run(me2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(me2)')
try: c = susp()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = susp()')
try: c.send(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try:
    async def await_suspended(): return await c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def await_suspended(): return await c')
try: print('run(await_suspended()) =>', end=" "); t(lambda: run(await_suspended()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: run(await_suspended()))')
try: c.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.close()')
# Coroutines are not iterable.
try: c = simple()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = simple()')
try: print('iter(c) =>', end=" "); t(lambda: iter(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: iter(c))')
try: print('next(c) =>', end=" "); t(lambda: next(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(c))')
try: print('list(c) =>', end=" "); t(lambda: list(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list(c))')
try: print('[x for x in c] =>', end=" "); t(lambda: [x for x in c])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: [x for x in c])')
try: print('len(c) =>', end=" "); t(lambda: len(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len(c))')
try: print('c() =>', end=" "); t(lambda: c())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c())')
try: print('c + c =>', end=" "); t(lambda: c + c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c + c)')
try: print('bool(c) =>', end=" "); t(lambda: bool(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bool(c))')
try: print('c == c =>', end=" "); t(lambda: c == c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c == c)')
try: print('hash(c) == hash(c) =>', end=" "); t(lambda: hash(c) == hash(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: hash(c) == hash(c))')
try: print('type(c)() =>', end=" "); t(lambda: type(c)())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(c)())')
try: print('type("X", (type(c),), {}) =>', end=" "); t(lambda: type("X", (type(c),), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (type(c),), {}))')
try:
    def yf(): yield from c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def yf(): yield from c')
try: print('list(yf()) =>', end=" "); t(lambda: list(yf()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list(yf()))')
try: w = c.__await__()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w = c.__await__()')
try: print('type(w).__name__ =>', type(w).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(w).__name__')
try: print('iter(w) is w =>', iter(w) is w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: iter(w) is w')
try: print('next(w) =>', end=" "); t(lambda: next(w))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(w))')
try: print('next(w) =>', end=" "); t(lambda: next(w))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(w))')
try: c2 = susp()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2 = susp()')
try: w = c2.__await__()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w = c2.__await__()')
try: print('next(w) =>', next(w))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(w)')
try: print('w.send("x") =>', w.send("x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.send("x")')
try: print('w.throw(ValueError("via wrapper")) =>', end=" "); t(lambda: w.throw(ValueError("via wrapper")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: w.throw(ValueError("via wrapper")))')
try: print(w.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.close()')
# Attributes.
try: c = simple()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = simple()')
try: c.__name__ = "renamed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.__name__ = "renamed"')
try: c.__qualname__ = "q.renamed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.__qualname__ = "q.renamed"')
try: print('c.__name__ =>', c.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.__name__')
try: print('c.__qualname__ =>', c.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.__qualname__')
try: print('repr(c)[:28] =>', repr(c)[:28])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(c)[:28]')
try:
    def s1(): c.__name__ = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s1(): c.__name__ = 1')
try:
    def s2(): c.cr_code = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s2(): c.cr_code = 1')
try:
    def s3(): c.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s3(): c.x = 1')
try: print('s1() =>', end=" "); t(s1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s1)')
try: print('s2() =>', end=" "); t(s2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s2)')
try: print('s3() =>', end=" "); t(s3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s3)')
try: c.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.close()')
try: print('simple.__code__.co_flags & 0x80 != 0 =>', simple.__code__.co_flags & 0x80 != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: simple.__code__.co_flags & 0x80 != 0')
try: print('simple.__code__.co_flags & 0x20 != 0 =>', simple.__code__.co_flags & 0x20 != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: simple.__code__.co_flags & 0x20 != 0')
try: print('type(simple).__name__ =>', type(simple).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(simple).__name__')
try: print('plain_gen.__code__.co_flags & 0x80 != 0 =>', plain_gen.__code__.co_flags & 0x80 != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: plain_gen.__code__.co_flags & 0x80 != 0')
try:
    async def inspect_self(): return me3.cr_running, me3.cr_suspended, me3.cr_await
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def inspect_self(): return me3.cr_running, me3.cr_suspended, me...')
try: me3 = inspect_self()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me3 = inspect_self()')
try: print(run(me3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(me3)')
try:
    class K:
        async def m(s, v): return ("method", v)
        @classmethod
        async def cm(cls): return cls.__name__
        @staticmethod
        async def sm(): return "static"
        async def __call__(s): return "called"
        @property
        async def p(s): return "prop"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K:')
try: k = K()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k = K()')
try: print('run(k.m(1)) =>', run(k.m(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(k.m(1))')
try: print('run(K.cm()) =>', run(K.cm()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(K.cm())')
try: print('run(K.sm()) =>', run(K.sm()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(K.sm())')
try: print('run(k()) =>', run(k()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(k())')
try: print('run(k.p) =>', run(k.p))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(k.p)')
try: print('k.m(1).close() =>', k.m(1).close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k.m(1).close()')
try: print('K.m.__qualname__ =>', K.m.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: K.m.__qualname__')
try:
    def make():
        v = 10
        async def inner(): nonlocal v; v += 1; return v
        return inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make():')
try: i = make()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = make()')
try: print('run(i()) =>', run(i()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(i())')
try: print('run(i()) =>', run(i()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(i())')
# await in expressions.
try:
    async def val(v): return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def val(v): return v')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def exprs():')
try: print(run(exprs()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(exprs())')
try:
    async def order():
        log = []
        async def ev(n): log.append(n); return n
        x = [await ev(1), await ev(2)][await ev(0)] + await ev(3)
        (await ev({}))[await ev("k")] = await ev("v") if False else await ev("w")
        return log
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def order():')
try: print(run(order()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(order())')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def stmts():')
try:
    class CM:
        def __enter__(s): return "cm"
        def __exit__(s, *a): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CM:')
try: print(run(stmts()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(stmts())')
# sys.exception() across suspensions.
try:
    async def exc_state():
        r = [repr(sys.exception())]
        try: raise KeyError("inner")
        except KeyError:
            await Suspend("in handler")
            r.append(repr(sys.exception()))
        r.append(repr(sys.exception())); return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def exc_state():')
try: c = exc_state()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = exc_state()')
try:
    try: raise ValueError("outer")
    except ValueError: c.send(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: raise ValueError("outer")')
try: print(sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.exception()')
try:
    try: c.send(None)
    except StopIteration as e: print(e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: c.send(None)')
