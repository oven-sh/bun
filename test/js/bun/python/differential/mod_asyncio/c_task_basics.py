# Task of _asyncio: steps, names, contexts, what a coroutine may yield, errors.
import asyncio, contextvars, re, sys, types, _asyncio
def clean(s): return re.sub(r"0x[0-9a-f]+", "0x..", re.sub(r'/[^ :"]*/', "", str(s)))
def attempt(f, *a, **k):
    try: return f(*a, **k)
    except BaseException as e: return "%s: %s" % (type(e).__name__, clean(e))
loop = asyncio.new_event_loop()
def run(c): return loop.run_until_complete(c)
async def ret(x): return x
async def boom(): raise ValueError("boom")

t = loop.create_task(ret(1))
print(type(t) is _asyncio.Task, isinstance(t, _asyncio.Future), t._state, t.done(), t.get_name().startswith("Task-"), t._must_cancel, t._log_destroy_pending, t._fut_waiter, t.cancelling(), type(t.get_context()).__name__,
      t.get_coro() is t._coro, t.get_coro().__name__, t.get_loop() is loop, t._asyncio_awaited_by)
print(clean(repr(t)).replace(t.get_name(), "Task-N"))
h = loop._ready[-1]; print(type(h._callback).__name__, type(h._callback).__module__, h._callback.__self__ is t, h._args, h._context is t.get_context(), clean(repr(h)), attempt(h._callback, 1), attempt(h._callback, a=1))
print(run(t), t.done(), t.result(), t._coro is not None, clean(repr(t)).replace(t.get_name(), "Task-N"))
print(attempt(t.set_result, 1), attempt(t.set_exception, ValueError()))
a, b = loop.create_task(ret(1)), loop.create_task(ret(2)); print(int(b.get_name()[5:]) - int(a.get_name()[5:])); run(a); run(b)
t = loop.create_task(ret(1), name="mine"); print(t.get_name()); t.set_name(5); print(repr(t.get_name())); t.set_name("x"); print(t.get_name()); run(t)
t = _asyncio.Task(ret(1), loop=loop, name=12); print(repr(t.get_name())); run(t)
class S(str): pass
t = _asyncio.Task(ret(1), loop=loop, name=S("sub")); print(type(t.get_name()).__name__, t.get_name()); run(t)

t = loop.create_task(boom()); print(attempt(run, t), repr(t.exception()), t._state, clean(repr(t)).replace(t.get_name(), "Task-N"))

# arguments
print(attempt(_asyncio.Task), attempt(_asyncio.Task, 1, loop=loop), attempt(_asyncio.Task, ret, loop=loop), attempt(_asyncio.Task, [], loop=loop))
c = ret(1); print(attempt(_asyncio.Task, c, loop=loop, context=5), attempt(_asyncio.Task, c, loop, 1), attempt(_asyncio.Task, c, loop=loop, nope=1)); c.close()
c = ret(1); print(attempt(_asyncio.Task, c)); c.close()

# contexts
var = contextvars.ContextVar("var", default="none")
async def reads(): return var.get()
async def sets(v): var.set(v); await asyncio.sleep(0); return var.get()
async def both(): return await asyncio.gather(sets(1), sets(2))
var.set("outer"); print(run(loop.create_task(reads())), run(both()), var.get())
ctx = contextvars.Context(); ctx.run(var.set, "given"); t = loop.create_task(reads(), context=ctx); print(t.get_context() is ctx, run(t))

# what a coroutine may yield
@types.coroutine
def yields(x): return (yield x)
async def y(x): return await yields(x)
for what in (None, 5, "s", (1,), object):
    print(repr(what), attempt(run, loop.create_task(y(what))))
def g(): yield
print(attempt(run, loop.create_task(y(g()))))
f = loop.create_future(); print(attempt(run, loop.create_task(y(f))).replace("Task-", "T")[:60])     # yield instead of yield from
other = asyncio.new_event_loop(); f = other.create_future()
async def w(f): return await f
print(re.sub(r"Task-\d+", "Task-N", attempt(run, loop.create_task(w(f))))); other.close()
async def selfish():
    return await asyncio.current_task()
print(re.sub(r"Task-\d+", "Task-N", attempt(run, loop.create_task(selfish()))))

# generator-based coroutines and other coroutine-likes
@types.coroutine
def old(): yield; return "old"
print(attempt(loop.create_task, old()))
class Like:
    def __init__(self): self.n = 0
    def send(self, v):
        self.n += 1
        if self.n > 2: raise StopIteration("like")
    def throw(self, *a): raise a[0]
    def close(self): pass
    def __await__(self): return self
import collections.abc; collections.abc.Coroutine.register(Like)
print(run(loop.create_task(Like())))

# a future-like object that is not a Future
class Duck:
    _asyncio_future_blocking = False
    def __init__(self, loop): self._loop = loop; self.cbs = []; self.log = []
    def get_loop(self): return self._loop
    def add_done_callback(self, cb, *, context=None): self.cbs.append((cb, context)); self.log.append(("add", type(cb).__name__, cb.__name__, cb.__qualname__, type(context).__name__))
    def result(self): return "duck"
    def cancel(self, msg=None): self.log.append(("cancel", msg)); return False
    def __await__(self):
        self._asyncio_future_blocking = True
        got = yield self
        return self.result()
d = Duck(loop)
async def wd(): return await d
t = loop.create_task(wd()); run(asyncio.sleep(0)); print(t._fut_waiter is d, d._asyncio_future_blocking, d.log, clean(repr(d.cbs[0][0])), d.cbs[0][0].__self__ is t)
loop.call_soon(d.cbs[0][0], d); print(run(t))

# steps after the end
t = loop.create_task(ret(1)); step = loop._ready[-1]._callback; run(t); print(re.sub(r"Task-\d+", "Task-N", attempt(step)))

# KeyboardInterrupt and SystemExit go through
async def interrupt(e): raise e
for e in (KeyboardInterrupt(), SystemExit(3)):
    t = loop.create_task(interrupt(e)); print(attempt(loop.run_until_complete, t), t.done(), repr(t.exception()))

# stack
async def deep(): await asyncio.sleep(10)
t = loop.create_task(deep()); run(asyncio.sleep(0)); print([fr.f_code.co_name for fr in t.get_stack()], len(t.get_stack(limit=0)))
import io; out = io.StringIO(); t.print_stack(file=out); print(clean(out.getvalue()).replace(t.get_name(), "Task-N")); t.cancel(); print(attempt(run, t), t.get_stack())
print(attempt(t.get_stack, 1), attempt(t.print_stack, 1))
loop.close()
