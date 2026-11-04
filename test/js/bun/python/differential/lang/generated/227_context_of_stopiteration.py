# Which StopIteration remembers what was being handled: the one that says an iterator has ended does, the one that carries a result does not.
try:
    def g1():
        return 1
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g1():')
try:
    def g2():
        return
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g2():')
try:
    def g3():
        yield 1
        return 'done'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g3():')
try:
    async def c1():
        return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c1():')
try:
    def ctx(f):
        try:
            raise LookupError('outside')
        except LookupError:
            try:
                f()
            except StopIteration as e:
                return (e.value, type(e.__context__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ctx(f):')
try: print('next, return 1', 'ctx(lambda: next(g1())) =>', ctx(lambda: next(g1())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx(lambda: next(g1()))')
try: print('next, return None', 'ctx(lambda: next(g2())) =>', ctx(lambda: next(g2())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx(lambda: next(g2()))')
try: print('send', 'ctx(lambda: g1().send(None)) =>', ctx(lambda: g1().send(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx(lambda: g1().send(None))')
try: print('__next__', 'ctx(lambda: g1().__next__()) =>', ctx(lambda: g1().__next__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx(lambda: g1().__next__())')
try:
    def second():
        g = g3(); next(g); next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def second():')
try: print('second next', 'ctx(second) =>', ctx(second))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx(second)')
try: print('coroutine send', 'ctx(lambda: c1().send(None)) =>', ctx(lambda: c1().send(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx(lambda: c1().send(None))')
try: print('next(iter(()))', 'ctx(lambda: next(iter(()))) =>', ctx(lambda: next(iter(()))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx(lambda: next(iter(())))')
try: print('throw', 'ctx(lambda: g1().throw(StopIteration(7))) =>', ctx(lambda: g1().throw(StopIteration(7))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx(lambda: g1().throw(StopIteration(7)))')

try: import asyncio
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import asyncio')
try:
    def ctx2(f):
        try:
            raise LookupError('outside')
        except LookupError:
            try:
                f()
            except (StopIteration, StopAsyncIteration) as e:
                return (type(e).__name__, getattr(e, 'value', '-'), e.args, type(e.__context__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ctx2(f):')
try:
    async def ag():
        yield None
        yield 1
        yield (1, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def ag():')
try: a = ag()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = ag()')
try: print('asend None', 'ctx2(lambda: a.asend(None).send(None)) =>', ctx2(lambda: a.asend(None).send(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: a.asend(None).send(None))')
try: print('anext 1', 'ctx2(lambda: a.__anext__().send(None)) =>', ctx2(lambda: a.__anext__().send(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: a.__anext__().send(None))')
try: print('anext tuple', 'ctx2(lambda: a.__anext__().send(None)) =>', ctx2(lambda: a.__anext__().send(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: a.__anext__().send(None))')
try: print('anext end', 'ctx2(lambda: a.__anext__().send(None)) =>', ctx2(lambda: a.__anext__().send(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: a.__anext__().send(None))')
try:
    async def c_none(): return None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c_none(): return None')
try:
    async def c_tuple(): return (1, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c_tuple(): return (1, 2)')
try: print('coro None', 'ctx2(lambda: c_none().send(None)) =>', ctx2(lambda: c_none().send(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: c_none().send(None))')
try: print('coro tuple', 'ctx2(lambda: c_tuple().send(None)) =>', ctx2(lambda: c_tuple().send(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: c_tuple().send(None))')
try: print('coro await', 'ctx2(lambda: c_tuple().__await__().send(None)) =>', ctx2(lambda: c_tuple().__await__().send(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: c_tuple().__await__().send(None))')
try: print('coro await next', 'ctx2(lambda: next(c_tuple().__await__())) =>', ctx2(lambda: next(c_tuple().__await__())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: next(c_tuple().__await__()))')
try: loop = asyncio.new_event_loop()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loop = asyncio.new_event_loop()')
try: f = loop.create_future()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f = loop.create_future()')
try: f.set_result(3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.set_result(3)')
try: print('future', 'ctx2(lambda: next(iter(f))) =>', ctx2(lambda: next(iter(f))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: next(iter(f)))')
try: f = loop.create_future()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f = loop.create_future()')
try: f.set_result(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.set_result(None)')
try: print('future None', 'ctx2(lambda: next(iter(f))) =>', ctx2(lambda: next(iter(f))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: next(iter(f)))')
try: f = loop.create_future()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f = loop.create_future()')
try: f.set_result(4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.set_result(4)')
try: print('future send', 'ctx2(lambda: f.__await__().send(None)) =>', ctx2(lambda: f.__await__().send(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: f.__await__().send(None))')
try: loop.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loop.close()')
try:
    async def ag2():
        return
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def ag2():')
try: print('anext default', "ctx2(lambda: anext(ag2(), 'dflt').send(None)) =>", ctx2(lambda: anext(ag2(), 'dflt').send(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ctx2(lambda: anext(ag2(), 'dflt').send(None))")
try: print('anext default next', "ctx2(lambda: next(anext(ag2(), 'dflt').__await__())) =>", ctx2(lambda: next(anext(ag2(), 'dflt').__await__())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ctx2(lambda: next(anext(ag2(), 'dflt').__await__()))")
try:
    def g():
        x = yield from inner()
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g():')
try:
    def inner():
        return 9
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inner():')
try: print('yield from', 'ctx2(lambda: next(g())) =>', ctx2(lambda: next(g())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: next(g()))')
try:
    def gt():
        try:
            yield
        except ValueError:
            return 8
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gt():')
try:
    def thrown():
        x = gt(); next(x); x.throw(ValueError)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def thrown():')
try: print('throw returns', 'ctx2(thrown) =>', ctx2(thrown))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(thrown)')
try:
    def closes():
        x = gt(); next(x)
        return x.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def closes():')
try: print(closes())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: closes()')
try: import types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import types')
try:
    @types.coroutine
    def tc():
        return 6
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tc():')
try: print('types.coroutine', 'ctx2(lambda: tc().send(None)) =>', ctx2(lambda: tc().send(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: tc().send(None))')
try: print('aclose', 'ctx2(lambda: ag().aclose().send(None)) =>', ctx2(lambda: ag().aclose().send(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ctx2(lambda: ag().aclose().send(None))')
