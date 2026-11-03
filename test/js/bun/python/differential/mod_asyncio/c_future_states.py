# Future of _asyncio: states, results, exceptions, callbacks and their order, errors for what is not initialized.
import asyncio, contextvars, re, sys, _asyncio
def clean(s): return re.sub(r"0x[0-9a-f]+", "0x..", re.sub(r'"?/[^ "]*/', "", str(s)))
def attempt(f, *a, **k):
    try: return f(*a, **k)
    except BaseException as e: return "%s: %s" % (type(e).__name__, clean(e))
print(asyncio.Future is _asyncio.Future, asyncio.Task is _asyncio.Task, _asyncio.Future.__module__, _asyncio.Future.__name__, _asyncio.Future.__qualname__, _asyncio.Task.__mro__)
print(sorted(n for n in dir(_asyncio) if not n.startswith("__")))
print(sorted(n for n in dir(_asyncio.Future) if n not in dir(object) and n not in ("__weakref__", "__dict__", "__module__")))
print(sorted(n for n in dir(_asyncio.Task) if n not in dir(_asyncio.Future)))
print(_asyncio.Future.__text_signature__, _asyncio.Task.__text_signature__)
for t in (_asyncio.Future, _asyncio.Task):
    for n in sorted(dir(t)):
        s = getattr(getattr(t, n), "__text_signature__", None)
        if s and not n.startswith("__"): print(t.__name__, n, s)
for n in sorted(vars(_asyncio)):
    s = getattr(vars(_asyncio)[n], "__text_signature__", None)
    if s and not isinstance(vars(_asyncio)[n], type): print(n, s)

loop = asyncio.new_event_loop()
f = loop.create_future()
print(type(f).__name__, f._state, f.done(), f.cancelled(), f._result, f._exception, f._callbacks, f._loop is loop, f.get_loop() is loop, f._log_traceback, f._source_traceback, f._cancel_message, f._asyncio_future_blocking, f._asyncio_awaited_by)
print(clean(repr(f)), attempt(f.result), attempt(f.exception))
order = []
f.add_done_callback(lambda x: order.append(("a", x is f)))
f.add_done_callback(lambda x: order.append(("b", x.result())))
def c(x): order.append("c")
f.add_done_callback(c); f.add_done_callback(c); f.add_done_callback(lambda x: order.append("d"))
print(len(f._callbacks), [type(p).__name__ + str(len(p)) + type(p[1]).__name__ for p in f._callbacks], clean(repr(f)))
print(f.remove_done_callback(c), len(f._callbacks), f.remove_done_callback(c), f.remove_done_callback(print))
print(f.set_result(42), f._state, f.done(), f.result(), f.exception(), f._result, f._callbacks, order)
loop.run_until_complete(asyncio.sleep(0)); print(order)
print(attempt(f.set_result, 1), attempt(f.set_exception, ValueError()), f.cancel(), f.cancel("m"), clean(repr(f)))
f.add_done_callback(lambda x: order.append("late")); print(order[-1]); loop.run_until_complete(asyncio.sleep(0)); print(order[-1])

# one callback, removed
f = loop.create_future(); f.add_done_callback(c); print(f.remove_done_callback(c), f._callbacks)
f.add_done_callback(print); f.add_done_callback(c); print(f.remove_done_callback(c), len(f._callbacks), f.remove_done_callback(print), f._callbacks)

# exceptions
f = loop.create_future(); e = ValueError("boom"); print(f.set_exception(e), f._log_traceback, f.exception() is e, f._log_traceback, f._exception is e, attempt(f.result), clean(repr(f)))
f = loop.create_future(); f.set_exception(KeyError); print(repr(f.exception()), attempt(f.result))
f = loop.create_future(); print(attempt(f.set_exception, 3), attempt(f.set_exception, int), f._state)
f = loop.create_future(); print(attempt(f.set_exception, StopIteration(1))); x = f.exception(); print(repr(x), repr(x.__cause__), repr(x.__context__), x.__suppress_context__)
f = loop.create_future(); print(attempt(f.set_exception, StopIteration)); print(repr(f.exception()))
f = loop.create_future(); f.set_exception(ValueError("x")); f._log_traceback = False; print(f._log_traceback, attempt(setattr, f, "_log_traceback", True))
def raiser():
    try: 1 / 0
    except ZeroDivisionError as e: return e
f = loop.create_future(); e = raiser(); tb = e.__traceback__; f.set_exception(e); e.__traceback__ = None
try: f.result()
except ZeroDivisionError as e2: print(e2 is e, e2.__traceback__.tb_next is tb)
try: f.result()
except ZeroDivisionError as e2: print(e2.__traceback__.tb_next is None)

# cancellation
f = loop.create_future(); print(f.cancel(), f.cancelled(), f.done(), f._state, attempt(f.result), attempt(f.exception), f._cancel_message, clean(repr(f)))
f = loop.create_future(); print(f.cancel(msg="why"), f._cancel_message, attempt(f.result), repr(f._make_cancelled_error()))
f = loop.create_future(); f.cancel("a"); f._cancel_message = "b"; print(attempt(f.result))
print(attempt(delattr, f, "_cancel_message"), attempt(delattr, f, "_log_traceback"), attempt(delattr, f, "_asyncio_future_blocking"), attempt(delattr, f, "_state"), attempt(setattr, f, "_state", 1))

# attributes of its own, weak references, generic alias
import weakref
f = loop.create_future(); f.extra = 5; print(f.extra, weakref.ref(f)() is f, _asyncio.Future[int], _asyncio.Task[str], asyncio.isfuture(f), hash(f) == hash(f), f == f, f != loop.create_future())

# arguments
print(attempt(_asyncio.Future, 1), attempt(_asyncio.Future, loop=loop, x=1), type(attempt(_asyncio.Future, loop=loop)).__name__)
print(attempt(f.__init__, loop=loop), attempt(f.add_done_callback), attempt(f.add_done_callback, print, 1), attempt(f.add_done_callback, fn=print), attempt(f.cancel, 1, 2), attempt(f.result, 1))
ctx = contextvars.Context(); f.add_done_callback(print, context=ctx); print(f._callbacks[0][1] is ctx)
print(attempt(_asyncio.Future))   # no loop

# not initialized
class Bare(_asyncio.Future):
    def __init__(self): pass
b = Bare()
for n in ("result", "exception", "cancel", "cancelled", "done", "get_loop", "__iter__", "__await__", "__repr__", "_make_cancelled_error"):
    print(n, attempt(getattr(b, n)))
for n in ("set_result", "set_exception", "add_done_callback", "remove_done_callback"): print(n, attempt(getattr(b, n), print))
for n in ("_state", "_asyncio_future_blocking", "_loop", "_callbacks", "_result", "_exception", "_log_traceback", "_source_traceback", "_cancel_message", "_asyncio_awaited_by"):
    print(n, attempt(getattr, b, n))
print(attempt(setattr, b, "_asyncio_future_blocking", True))
print(attempt(_asyncio.Future.__new__, int), type(_asyncio.Future.__new__(_asyncio.Future)).__name__, attempt(object.__new__, _asyncio.Future), attempt(_asyncio.Future.result, 1))

# debug mode: where it was made
loop.set_debug(True); f = loop.create_future(); print(type(f._source_traceback).__name__, f._source_traceback[-1].name, clean(repr(f))); loop.set_debug(False)
loop.close()
