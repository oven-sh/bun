# Cancellation of tasks: messages, counts, uncancel, what is being waited for.
import asyncio, re, _asyncio
def attempt(f, *a, **k):
    try: return f(*a, **k)
    except BaseException as e: return "%s: %r" % (type(e).__name__, e.args)
loop = asyncio.new_event_loop()
def run(c): return loop.run_until_complete(c)
async def forever(): await loop.create_future()
t = loop.create_task(forever()); print(t.cancel(), t._must_cancel, t.cancelling(), t.cancelled(), t._cancel_message); print(attempt(run, t), t.cancelled(), t._must_cancel, t.cancelling(), t.cancel(), t._state)
t = loop.create_task(forever()); run(asyncio.sleep(0)); w = t._fut_waiter; print(w._asyncio_awaited_by == frozenset({t}), t.cancel("msg"), t._must_cancel, w.cancelled(), w._cancel_message, t._cancel_message); print(attempt(run, t), attempt(t.result), attempt(t.exception), w._asyncio_awaited_by)
t = loop.create_task(forever()); t.cancel("first"); t.cancel("second"); print(t.cancelling(), attempt(run, t))
async def stubborn(log):
    for i in range(3):
        try: await loop.create_future()
        except asyncio.CancelledError as e: log.append((i, e.args, asyncio.current_task().cancelling(), asyncio.current_task().uncancel()))
    return "survived"
async def drive():
    log = []; t = asyncio.create_task(stubborn(log))
    for i in range(3):
        await asyncio.sleep(0); print(t.cancel(i))
    print(await t, log, t.cancelled(), t.cancelling(), t.uncancel())
run(drive())
async def late():
    asyncio.current_task().cancel("at the end"); return 1
t = loop.create_task(late()); print(attempt(run, t), t.cancelled(), t._cancel_message)
async def uncancels():
    me = asyncio.current_task(); me.cancel(); print(me._must_cancel, me.uncancel(), me._must_cancel); await asyncio.sleep(0); return "fine"
print(run(loop.create_task(uncancels())))
async def raises_cancelled(): raise asyncio.CancelledError("own")
t = loop.create_task(raises_cancelled()); print(attempt(run, t), t.cancelled(), t._cancel_message, attempt(t.result))
async def inner(): await loop.create_future()
async def outer(): await asyncio.create_task(inner())
t = loop.create_task(outer()); run(asyncio.sleep(0)); run(asyncio.sleep(0)); print(type(t._fut_waiter).__name__, t.cancel("down")); print(attempt(run, t))
# the same exception object travels, with its traceback
async def catcher():
    try: await loop.create_future()
    except asyncio.CancelledError as e: catcher.e = e; raise
t = loop.create_task(catcher()); run(asyncio.sleep(0)); t.cancel()
try: run(t)
except asyncio.CancelledError as e: print(e is catcher.e, [x.tb_frame.f_code.co_name for x in iter(lambda tb=[e.__traceback__]: tb.__setitem__(0, tb[0].tb_next) or tb[0], None)][-1:])
# a waiter that refuses to be cancelled
class Refuses(asyncio.Future):
    def cancel(self, msg=None): self.asked = msg; return False
async def waits(f): return await f
f = Refuses(loop=loop); t = loop.create_task(waits(f)); run(asyncio.sleep(0)); print(t.cancel("please"), f.asked, t._must_cancel); f.set_result(1); print(attempt(run, t))
# cancelled before the first step, waiting for a future in the first step
f = loop.create_future(); t = loop.create_task(waits(f)); t.cancel("early"); print(attempt(run, t), f.cancelled())
# wait_for, shield, timeout
async def slow(): await asyncio.sleep(10)
print(attempt(run, asyncio.wait_for(slow(), 0.001)))
async def shielded():
    inner = asyncio.create_task(asyncio.sleep(0.01, "inner done")); t = asyncio.create_task(waits(asyncio.shield(inner))); await asyncio.sleep(0); t.cancel()
    try: await t
    except asyncio.CancelledError: pass
    return await inner
print(run(shielded()))
async def with_timeout():
    try:
        async with asyncio.timeout(0.001): await asyncio.sleep(10)
    except TimeoutError as e: return (type(e).__name__, type(e.__cause__).__name__, asyncio.current_task().cancelling())
print(run(with_timeout()))
loop.close()
