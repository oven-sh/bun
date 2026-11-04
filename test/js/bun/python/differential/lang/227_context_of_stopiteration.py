# Which StopIteration remembers what was being handled: the one that says an iterator has ended does, the one that carries a result does not.
def g1():
    return 1
    yield
def g2():
    return
    yield
def g3():
    yield 1
    return 'done'
async def c1():
    return 5
def ctx(f):
    try:
        raise LookupError('outside')
    except LookupError:
        try:
            f()
        except StopIteration as e:
            return (e.value, type(e.__context__).__name__)
print('next, return 1', ctx(lambda: next(g1())))
print('next, return None', ctx(lambda: next(g2())))
print('send', ctx(lambda: g1().send(None)))
print('__next__', ctx(lambda: g1().__next__()))
def second():
    g = g3(); next(g); next(g)
print('second next', ctx(second))
print('coroutine send', ctx(lambda: c1().send(None)))
print('next(iter(()))', ctx(lambda: next(iter(()))))
print('throw', ctx(lambda: g1().throw(StopIteration(7))))

import asyncio
def ctx2(f):
    try:
        raise LookupError('outside')
    except LookupError:
        try:
            f()
        except (StopIteration, StopAsyncIteration) as e:
            return (type(e).__name__, getattr(e, 'value', '-'), e.args, type(e.__context__).__name__)
async def ag():
    yield None
    yield 1
    yield (1, 2)
a = ag()
print('asend None', ctx2(lambda: a.asend(None).send(None)))
print('anext 1', ctx2(lambda: a.__anext__().send(None)))
print('anext tuple', ctx2(lambda: a.__anext__().send(None)))
print('anext end', ctx2(lambda: a.__anext__().send(None)))
async def c_none(): return None
async def c_tuple(): return (1, 2)
print('coro None', ctx2(lambda: c_none().send(None)))
print('coro tuple', ctx2(lambda: c_tuple().send(None)))
print('coro await', ctx2(lambda: c_tuple().__await__().send(None)))
print('coro await next', ctx2(lambda: next(c_tuple().__await__())))
loop = asyncio.new_event_loop()
f = loop.create_future(); f.set_result(3)
print('future', ctx2(lambda: next(iter(f))))
f = loop.create_future(); f.set_result(None)
print('future None', ctx2(lambda: next(iter(f))))
f = loop.create_future(); f.set_result(4)
print('future send', ctx2(lambda: f.__await__().send(None)))
loop.close()
async def ag2():
    return
    yield
print('anext default', ctx2(lambda: anext(ag2(), 'dflt').send(None)))
print('anext default next', ctx2(lambda: next(anext(ag2(), 'dflt').__await__())))
def g():
    x = yield from inner()
    return x
def inner():
    return 9
    yield
print('yield from', ctx2(lambda: next(g())))
def gt():
    try:
        yield
    except ValueError:
        return 8
def thrown():
    x = gt(); next(x); x.throw(ValueError)
print('throw returns', ctx2(thrown))
def closes():
    x = gt(); next(x)
    return x.close()
print(closes())
import types
@types.coroutine
def tc():
    return 6
    yield
print('types.coroutine', ctx2(lambda: tc().send(None)))
print('aclose', ctx2(lambda: ag().aclose().send(None)))
