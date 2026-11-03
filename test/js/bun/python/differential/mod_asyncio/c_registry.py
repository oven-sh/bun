# The running loop, the current task, all_tasks, entering and leaving tasks, eager tasks, foreign tasks, threads.
import asyncio, re, threading, _asyncio
def clean(s): return re.sub(r"Task-\d+", "Task-N", re.sub(r"0x[0-9a-f]+", "0x..", re.sub(r'/[^ :"]*/', "", str(s))))
def attempt(f, *a, **k):
    try: return f(*a, **k)
    except BaseException as e: return "%s: %s" % (type(e).__name__, clean(e))
print(_asyncio._get_running_loop(), attempt(_asyncio.get_running_loop), attempt(_asyncio.current_task), attempt(_asyncio.all_tasks), attempt(asyncio.get_event_loop))
print(asyncio.get_running_loop is _asyncio.get_running_loop, asyncio.current_task is _asyncio.current_task, asyncio.all_tasks is _asyncio.all_tasks, asyncio.events._get_running_loop is _asyncio._get_running_loop,
      asyncio.tasks._register_task is _asyncio._register_task, asyncio.futures.future_add_to_awaited_by is _asyncio.future_add_to_awaited_by, repr(_asyncio.get_running_loop), _asyncio.get_running_loop.__module__)
loop = asyncio.new_event_loop()
print(_asyncio.current_task(loop), _asyncio.all_tasks(loop), _asyncio.current_task(loop=loop))
marker = object(); _asyncio._set_running_loop(marker); print(_asyncio._get_running_loop() is marker, _asyncio.get_running_loop() is marker, _asyncio.get_event_loop() is marker, _asyncio.current_task())
print(attempt(_asyncio._enter_task, loop, "t"), _asyncio._enter_task(marker, "t"), _asyncio.current_task(), attempt(_asyncio._enter_task, marker, "u"), attempt(_asyncio._leave_task, marker, "u"), attempt(_asyncio._leave_task, loop, "t"),
      _asyncio._swap_current_task(marker, "v"), _asyncio.current_task(), _asyncio._swap_current_task(marker, None), _asyncio.current_task(), attempt(_asyncio._leave_task, marker, "v"), attempt(_asyncio._swap_current_task, loop, "x"))
_asyncio._set_running_loop(None); print(_asyncio._get_running_loop())
print(attempt(_asyncio._enter_task, task=1, loop=None), attempt(_asyncio._leave_task, None, 1), attempt(_asyncio._set_running_loop), attempt(_asyncio._register_task), attempt(_asyncio.current_task, 1, 2))

async def sleeper(): await asyncio.sleep(10)
async def main():
    me = asyncio.current_task(); print(me is not None, asyncio.all_tasks() == {me}, asyncio.get_running_loop() is loop, asyncio.get_event_loop() is loop, asyncio.current_task(loop) is me)
    ts = [asyncio.create_task(sleeper()) for _ in range(100)]
    print(len(asyncio.all_tasks()), asyncio.all_tasks() == {me, *ts}, type(asyncio.all_tasks()).__name__)
    await asyncio.sleep(0)
    for t in ts[::2]: t.cancel()
    await asyncio.sleep(0); print(len(asyncio.all_tasks()), asyncio.all_tasks() == {me, *ts[1::2]})
    _asyncio._unregister_task(ts[1]); print(ts[1] in asyncio.all_tasks()); _asyncio._register_task(ts[1]); _asyncio._register_task(ts[1]); print(ts[1] in asyncio.all_tasks(), len(asyncio.all_tasks()))
    _asyncio._register_task(ts[0]); print(ts[0] in asyncio.all_tasks()); _asyncio._unregister_task(ts[0])       # it is done
    for t in ts: t.cancel()
    await asyncio.gather(*ts, return_exceptions=True); print(asyncio.all_tasks() == {me})
    # tasks of other kinds
    class Foreign:
        def __init__(self, loop, done=False): self._loop = loop; self._done = done
        def done(self): return self._done
        def get_loop(self): return self._loop
    a, b, c, d = Foreign(loop), Foreign(loop, True), Foreign(None), Foreign(loop)
    for x in (a, b, c): _asyncio._register_task(x)
    _asyncio._register_eager_task(d); print(asyncio.all_tasks() == {me, a, d}); _asyncio._unregister_task(a); _asyncio._unregister_eager_task(d); _asyncio._unregister_task(d); _asyncio._unregister_eager_task(a); print(asyncio.all_tasks() == {me})
    print(attempt(_asyncio._register_task, 5), attempt(_asyncio._register_eager_task, []))
    # classes derived from Task
    class Sub(asyncio.Task): pass
    s = Sub(sleeper(), loop=loop); print(s in asyncio.all_tasks()); s.cancel(); await asyncio.gather(s, return_exceptions=True); print(s in asyncio.all_tasks())
    class PyT(asyncio.tasks._PyTask): pass
    p = PyT(sleeper(), loop=loop); print(p in asyncio.all_tasks()); p.cancel(); await asyncio.gather(p, return_exceptions=True); print(p in asyncio.all_tasks())
loop.run_until_complete(main())

# eager tasks
async def eager_main():
    log = []
    async def quick(): log.append(("quick", asyncio.current_task().get_name())); return 1
    async def slow(): log.append("slow starts"); await asyncio.sleep(0); log.append("slow ends"); return 2
    me = asyncio.current_task()
    t = asyncio.Task(quick(), loop=loop, eager_start=True, name="q"); print(t.done(), t.result(), log, asyncio.current_task() is me, t in asyncio.all_tasks(), t._coro)
    t = asyncio.Task(slow(), loop=loop, eager_start=True); print(t.done(), log[-1], t in asyncio.all_tasks(), asyncio.current_task() is me); print(await t, log[-1])
    async def fails(): raise KeyError("eager")
    t = asyncio.Task(fails(), loop=loop, eager_start=True); print(t.done(), repr(t.exception()))
    async def cancels(): raise asyncio.CancelledError
    t = asyncio.Task(cancels(), loop=loop, eager_start=True); print(t.cancelled())
    loop.set_task_factory(asyncio.eager_task_factory); t = asyncio.create_task(quick()); print(t.done(), type(t).__name__); loop.set_task_factory(None)
    import contextvars; v = contextvars.ContextVar("v", default=0)
    async def sets(): v.set(1); return v.get()
    t = asyncio.Task(sets(), loop=loop, eager_start=True); print(t.result(), v.get())
    ctx = contextvars.copy_context()
    def inside(): return attempt(asyncio.Task, quick(), loop=loop, eager_start=True, context=ctx)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore"); print(ctx.run(inside), asyncio.current_task() is me)
loop.run_until_complete(eager_main())
t = asyncio.Task(sleeper(), loop=loop, eager_start=True); print(t.done(), len(loop._ready)); t.cancel(); loop.run_until_complete(asyncio.gather(t, return_exceptions=True))    # the loop is not running

# threads: each has its own running loop and current task
results = {}
def in_thread(name):
    async def m():
        await asyncio.sleep(0.01); results[name] = (asyncio.current_task().get_name(), len(asyncio.all_tasks()), asyncio.get_running_loop() is not loop)
    asyncio.run(m(), debug=False)
async def with_threads():
    ths = [threading.Thread(target=in_thread, args=(i,)) for i in range(4)]
    for th in ths: th.start()
    while any(th.is_alive() for th in ths): await asyncio.sleep(0.001)
    for th in ths: th.join()
    return asyncio.get_running_loop() is loop, len(asyncio.all_tasks())
print(loop.run_until_complete(with_threads()), sorted((k, v[1], v[2]) for k, v in results.items()))
# the current task of a loop that runs in another thread
other = {}; ready = threading.Event(); go = threading.Event()
def runs():
    async def m(): other["loop"] = asyncio.get_running_loop(); other["task"] = asyncio.current_task(); ready.set(); go.wait(5)
    asyncio.run(m())
th = threading.Thread(target=runs); th.start(); ready.wait(5); print(asyncio.current_task(other["loop"]) is other["task"], asyncio.all_tasks(other["loop"]) == {other["task"]}, _asyncio._get_running_loop()); go.set(); th.join()
print(asyncio.current_task(other["loop"]), asyncio.all_tasks(other["loop"]))
loop.close()
