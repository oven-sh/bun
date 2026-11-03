# What is said when futures and tasks are dropped: at the collection that finds them.
import asyncio, gc, re, weakref, _asyncio
def clean(s): return re.sub(r"Task-\d+", "Task-N", re.sub(r"0x[0-9a-f]+", "0x..", re.sub(r'/[^ :"]*/', "", str(s))))
loop = asyncio.new_event_loop(); seen = []
loop.set_exception_handler(lambda l, c: seen.append({k: (clean(repr(v)) if k != "source_traceback" else type(v).__name__) for k, v in sorted(c.items())}))
def collect():
    for _ in range(3): gc.collect()
    out = list(seen); seen.clear(); return out
def drop_future(retrieve=None, cls=None):
    f = (cls or asyncio.Future)(loop=loop); f.set_exception(ValueError("lost"))
    if retrieve: retrieve(f)
drop_future(); print(collect())
drop_future(lambda f: f.exception()); print(collect())
def res(f):
    try: f.result()
    except ValueError: pass
drop_future(res); print(collect())
drop_future(lambda f: setattr(f, "_log_traceback", False)); print(collect())
class MyFuture(asyncio.Future): pass
drop_future(cls=MyFuture); print(collect())
def plain(): f = loop.create_future(); f.set_result(1); g = loop.create_future(); h = loop.create_future(); h.cancel()
plain(); print(collect())
async def forever(): await loop.create_future()
async def boom(): raise KeyError("task")
def drop_task(started, quiet=False, cls=None):
    t = (cls or asyncio.Task)(forever(), loop=loop)
    if started: loop.run_until_complete(asyncio.sleep(0))
    else: loop._ready.clear()
    if quiet: t._log_destroy_pending = False
    return weakref.ref(t)
import warnings
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    r = drop_task(True); print(collect(), r() is None, _asyncio.all_tasks(loop))
    r = drop_task(False); print(collect(), r() is None)
    r = drop_task(True, quiet=True); print(collect(), r() is None, _asyncio.all_tasks(loop))
    class MyTask(asyncio.Task): pass
    r = drop_task(True, cls=MyTask); print(collect(), r() is None, _asyncio.all_tasks(loop))
    class Silent(asyncio.Task):
        def __del__(self): pass
    r = drop_task(True, cls=Silent); print(collect(), r() is None, _asyncio.all_tasks(loop))
    class Loud(asyncio.Task):
        def __del__(self): seen.append("Loud.__del__"); super().__del__()
    r = drop_task(True, cls=Loud); print(collect(), r() is None, _asyncio.all_tasks(loop))
def drop_failed():
    t = loop.create_task(boom()); loop.run_until_complete(asyncio.sleep(0))
drop_failed(); print(collect())
# the handler keeps the task: it is still there, and still scheduled
kept = []
loop.set_exception_handler(lambda l, c: kept.append(c["task"]))
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    drop_task(True); collect(); print(len(kept), kept[0] in _asyncio.all_tasks(loop), kept[0].done())
    kept[0].cancel(); loop.run_until_complete(asyncio.gather(kept[0], return_exceptions=True)); print(kept[0].cancelled(), _asyncio.all_tasks(loop))
    kept.clear(); collect(); print(kept)
# many
loop.set_exception_handler(lambda l, c: seen.append(c["message"]))
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    for _ in range(300): drop_task(True)
    got = collect(); print(len(got), set(got), _asyncio.all_tasks(loop))
# debug mode says where
loop.set_exception_handler(lambda l, c: seen.append(sorted(c)))
loop.set_debug(True); drop_future(); print(collect()); loop.set_debug(False)
# a handler that fails
import sys
loop.call_exception_handler = lambda c: 1 / 0
hooked = []; sys.unraisablehook = lambda u: hooked.append((u.exc_type.__name__, clean(u.err_msg)[:60]))
drop_future(); collect(); print(hooked)
print(hasattr(_asyncio.Future, "__del__"), hasattr(_asyncio.Task, "__del__"), _asyncio.Future.__del__ is not _asyncio.Task.__del__)
del loop.call_exception_handler
loop.close()
