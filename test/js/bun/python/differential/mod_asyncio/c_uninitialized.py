import asyncio, gc, _asyncio
def attempt(f, *a, **k):
    try: print("ok", f(*a, **k))
    except BaseException as e: print(type(e).__name__, e)
loop = asyncio.new_event_loop()
async def c(): await asyncio.sleep(0)
class Sub(asyncio.Task):
    def __del__(self): print("Sub.__del__")
class SubF(asyncio.Future):
    pass
def setclass(o, cls): o.__class__ = cls
co = c(); t = asyncio.Task(co, loop=loop)
attempt(setclass, t, Sub)
print(type(t).__name__)
f = asyncio.Future(loop=loop)
attempt(setclass, f, SubF)
attempt(setclass, f, asyncio.Task)
s = Sub(c(), loop=loop)
class Sub2(asyncio.Task): pass
attempt(setclass, s, Sub2)
attempt(setclass, s, asyncio.Task)
print(type(s).__name__)
loop.run_until_complete(asyncio.gather(t, s))
del t, s, f; gc.collect(); gc.collect()
u = asyncio.Task.__new__(asyncio.Task)
for name in ("cancel", "cancelling", "uncancel", "get_name", "get_coro", "get_context", "done", "cancelled", "result", "exception", "get_loop", "get_stack", "__repr__", "__await__", "__del__"):
    print(name, end=": "); attempt(getattr(u, name))
for name in ("_coro", "_fut_waiter", "_must_cancel", "_log_destroy_pending", "_state", "_loop", "_callbacks", "_result", "_exception", "_log_traceback", "_source_traceback", "_cancel_message", "_asyncio_awaited_by", "_asyncio_future_blocking"):
    print(name, end=": "); attempt(getattr, u, name)
attempt(_asyncio._register_task, u); print(len(_asyncio.all_tasks(loop)))
attempt(_asyncio._unregister_task, u)
attempt(_asyncio._register_task, u)
del u; gc.collect(); gc.collect(); print(len(_asyncio.all_tasks(loop)))
loop.close()
