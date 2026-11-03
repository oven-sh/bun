# What `await future` runs.
import asyncio, re, warnings, _asyncio
def clean(s): return re.sub(r"0x[0-9a-f]+", "0x..", str(s))
def attempt(f, *a, **k):
    try: return f(*a, **k)
    except BaseException as e: return "%s: %r %s" % (type(e).__name__, e.args, getattr(e, "value", ""))
loop = asyncio.new_event_loop()
f = loop.create_future(); it = iter(f)
print(type(it).__name__, type(it).__module__, type(it).__qualname__, iter(it) is it, type(f.__await__()) is type(it), clean(repr(it)), sorted(n for n in dir(it) if n not in dir(object) and n != "__module__"))
print(next(it) is f, f._asyncio_future_blocking, attempt(next, it), attempt(it.send, None))
f._asyncio_future_blocking = False; print(it.send(5) is f)
f.set_result((1, 2)); print(attempt(next, it), attempt(it.send, 7), attempt(next, it))
f = loop.create_future(); f.set_result(None); print(attempt(next, iter(f)))
f = loop.create_future(); f.set_result(StopIteration(3)); print(attempt(next, iter(f)))
f = loop.create_future(); f.set_exception(KeyError("k")); print(attempt(next, iter(f)), f._log_traceback)
f = loop.create_future(); f.cancel("gone"); print(attempt(next, iter(f)))
f = loop.create_future(); it = iter(f); print(it.close(), attempt(next, it), attempt(it.send, 1), it.close())
f = loop.create_future(); it = iter(f); print(attempt(it.throw, ValueError("v")), attempt(next, it))
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter("always")
    for args in ((ValueError,), (ValueError, None), (ValueError, "a"), (ValueError, ("a", "b")), (ValueError, ValueError("i")), (ValueError, None, None), (ValueError("x"), None), (ValueError("x"), 1),
                 (ValueError, 1, 2), (int,), (3,), (), (1, 2, 3, 4), (list,)):
        print(args, attempt(iter(loop.create_future()).throw, *args))
    print(len(w), {str(x.message) for x in w}, {x.category.__name__ for x in w})
def tb():
    try: 1 / 0
    except ZeroDivisionError as e: return e.__traceback__
t = tb()
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    try: iter(loop.create_future()).throw(ValueError, ValueError("x"), t)
    except ValueError as e: print(e.__traceback__.tb_next is t or e.__traceback__ is t)
print(attempt(it.throw, exc=1), attempt(it.send), attempt(it.close, 1))

# in coroutines, without a loop
async def waits(f): return await f
f = loop.create_future(); c = waits(f); print(c.send(None) is f, c.cr_await.__class__.__name__); f.set_result("r"); print(attempt(c.send, None))
f = loop.create_future(); c = waits(f); c.send(None); print(attempt(c.throw, KeyError("thrown")))
f = loop.create_future(); c = waits(f); c.send(None); print(c.close(), f._state)
def gen(f): return (yield from f)
f = loop.create_future(); g = gen(f); print(next(g) is f); f.set_result(1); print(attempt(next, g))
loop.close()
