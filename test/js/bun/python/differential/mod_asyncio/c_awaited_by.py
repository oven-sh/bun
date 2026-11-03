# Who awaits whom: _asyncio_awaited_by, asyncio.graph.
import asyncio, io, re, _asyncio
def clean(s): return re.sub(r"Task-\d+", "Task-N", re.sub(r"0x[0-9a-f]+", "0x..", re.sub(r'/[^ :"]*/', "", str(s))))
loop = asyncio.new_event_loop()
a, b, c, d = (loop.create_future() for _ in range(4))
print(a._asyncio_awaited_by, _asyncio.future_add_to_awaited_by(a, b), a._asyncio_awaited_by == frozenset({b}), type(a._asyncio_awaited_by).__name__)
_asyncio.future_add_to_awaited_by(a, c); _asyncio.future_add_to_awaited_by(a, c); _asyncio.future_add_to_awaited_by(a, d); print(a._asyncio_awaited_by == {b, c, d}, len(a._asyncio_awaited_by))
_asyncio.future_discard_from_awaited_by(a, c); _asyncio.future_discard_from_awaited_by(a, c); print(a._asyncio_awaited_by == {b, d})
_asyncio.future_discard_from_awaited_by(a, b); _asyncio.future_discard_from_awaited_by(a, d); print(a._asyncio_awaited_by)
_asyncio.future_add_to_awaited_by(b, c); _asyncio.future_discard_from_awaited_by(b, d); print(b._asyncio_awaited_by == {c}); _asyncio.future_discard_from_awaited_by(b, c); print(b._asyncio_awaited_by)
print(_asyncio.future_add_to_awaited_by(1, a), _asyncio.future_add_to_awaited_by(a, 1), a._asyncio_awaited_by, _asyncio.future_discard_from_awaited_by(1, 2))
py = asyncio.futures._PyFuture(loop=loop); _asyncio.future_add_to_awaited_by(py, a); _asyncio.future_add_to_awaited_by(a, py); print(py._asyncio_awaited_by, a._asyncio_awaited_by)
async def leaf(): 
    out = io.StringIO(); asyncio.print_call_graph(file=out); g = asyncio.capture_call_graph()
    return clean(out.getvalue()), type(g).__name__, [type(x).__name__ for x in g.call_stack], len(g.awaited_by), [clean(x.future.get_name()) for x in g.awaited_by]
async def middle(): return await asyncio.create_task(leaf(), name="leaf")
async def top():
    async with asyncio.TaskGroup() as tg: t = tg.create_task(middle(), name="middle")
    return t.result()
text, *rest = loop.run_until_complete(loop.create_task(top(), name="top")); print(text); print(rest)
async def many():
    f = loop.create_future()
    async def w(): return await f
    ts = [asyncio.create_task(w()) for _ in range(3)]; await asyncio.sleep(0); print(f._asyncio_awaited_by == set(ts)); f.set_result(1); await asyncio.gather(*ts); print(f._asyncio_awaited_by)
    g = asyncio.gather(asyncio.sleep(0), asyncio.sleep(0)); print([len(ch._asyncio_awaited_by) for ch in g._children]); await g
loop.run_until_complete(many())
loop.close()
