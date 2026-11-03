# Classes derived from Future and Task: what they override is used where CPython uses it.
import asyncio, re, _asyncio
def attempt(f, *a, **k):
    try: return f(*a, **k)
    except BaseException as e: return "%s: %s" % (type(e).__name__, e)
loop = asyncio.new_event_loop(); run = loop.run_until_complete; log = []
class F(asyncio.Future):
    __slots__ = ("slot",)
    def __init__(self, *, loop, tag): super().__init__(loop=loop); self.tag = tag
    def add_done_callback(self, cb, *, context=None): log.append(("add", self.tag, cb.__name__)); return super().add_done_callback(cb, context=context)
    def result(self): log.append(("result", self.tag)); return super().result()
    def cancel(self, msg=None): log.append(("cancel", self.tag, msg)); return super().cancel(msg)
    def get_loop(self): log.append(("get_loop", self.tag)); return super().get_loop()
    def done(self): log.append(("done", self.tag)); return super().done()
async def w(f): return await f
f = F(loop=loop, tag=1); f.slot = 3; t = loop.create_task(w(f)); run(asyncio.sleep(0)); print(log, f._asyncio_awaited_by == {t}, f.slot, f.tag); log.clear()
f.set_result("r"); print(run(t), log, f._asyncio_awaited_by); log.clear()
f = F(loop=loop, tag=2); t = loop.create_task(w(f)); run(asyncio.sleep(0)); t.cancel("m"); print(attempt(run, t), log); log.clear()
print(isinstance(f, _asyncio.Future), asyncio.isfuture(f), type(f).__mro__[1] is _asyncio.Future, repr(f)[:11], F.__base__.__name__)
class T(asyncio.Task):
    def __init__(self, coro, **kw): log.append("T.__init__"); super().__init__(coro, **kw); self.mine = 1
    def cancel(self, msg=None): log.append("T.cancel"); return super().cancel(msg)
    def set_name(self, n): log.append("T.set_name"); super().set_name(n)
    def __repr__(self): return "<T>"
async def one(): return asyncio.current_task()
t = T(one(), loop=loop, name="n"); print(run(t) is t, t.mine, log, repr(t), t.get_name()); log.clear()
loop.set_task_factory(lambda loop, coro, **kw: T(coro, loop=loop, **kw)); t = loop.create_task(one(), name="factory"); print(type(t).__name__, run(t) is t, log); loop.set_task_factory(None); log.clear()
async def waits_for_t():
    inner = T(asyncio.sleep(10), loop=loop); outer = asyncio.create_task(w(inner)); await asyncio.sleep(0); outer.cancel()
    try: await outer
    except asyncio.CancelledError: return log
print(run(waits_for_t())); log.clear()
print(attempt(type, "X", (asyncio.Future, asyncio.Task), {}), attempt(type, "Y", (asyncio.Task, asyncio.Future), {}).__name__, attempt(type, "Z", (asyncio.Future, dict), {}), attempt(type, "W", (type(iter(loop.create_future())),), {}))
print(attempt(setattr, asyncio.Future, "x", 1), attempt(setattr, asyncio.Task, "cancel", 1))
f = loop.create_future(); print(attempt(setattr, f, "__class__", F), attempt(setattr, F(loop=loop, tag=0), "__class__", asyncio.Future))
class G(asyncio.Future): pass
class H(asyncio.Future): pass
g = G(loop=loop); g.__class__ = H; print(type(g).__name__)
class TS(asyncio.Task): pass
print(attempt(setattr, g, "__class__", TS), attempt(setattr, G, "__bases__", (asyncio.Task,)), attempt(setattr, TS, "__bases__", (asyncio.Future,)), attempt(asyncio.Task.cancel, g), attempt(asyncio.Task.__init__, g, None))
# gather's own subclass, wrap_future, ensure_future
async def gathers():
    g = asyncio.gather(one(), one()); print(type(g).__mro__[1] is _asyncio.Future, type(g).__name__); await g
run(gathers())
import concurrent.futures
cf = concurrent.futures.Future(); af = asyncio.wrap_future(cf, loop=loop); print(type(af) is _asyncio.Future); cf.set_result(9); print(run(af))
loop.close()
