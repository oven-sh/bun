import asyncio, time, sys
async def sleeper(n, d):
    await asyncio.sleep(d); return n * 2
async def main():
    t0 = time.monotonic()
    print(await sleeper(1, 0.01))
    print(await asyncio.gather(sleeper(1, 0.03), sleeper(2, 0.01), sleeper(3, 0.02)))
    print(time.monotonic() - t0 < 60)
    task = asyncio.create_task(sleeper(5, 0.01)); print(task.done()); print(await task, task.done(), task.result())
    try: await asyncio.wait_for(asyncio.sleep(5), 0.02)
    except TimeoutError as e: print('TimeoutError', type(e).__name__)
    try:
        async with asyncio.timeout(0.02): await asyncio.sleep(5)
    except TimeoutError: print('timeout()')
    t = asyncio.create_task(asyncio.sleep(5)); await asyncio.sleep(0); t.cancel()
    try: await t
    except asyncio.CancelledError: print('cancelled', t.cancelled())
    q = asyncio.Queue()
    async def producer():
        for i in range(3): await q.put(i); await asyncio.sleep(0)
        await q.put(None)
    async def consumer():
        out = []
        while (x := await q.get()) is not None: out.append(x)
        return out
    print((await asyncio.gather(producer(), consumer()))[1])
    ev = asyncio.Event(); loop = asyncio.get_running_loop(); loop.call_later(0.01, ev.set); await ev.wait(); print('event', ev.is_set())
    fut = loop.create_future(); loop.call_soon(fut.set_result, 'soon'); print(await fut)
    lock = asyncio.Lock()
    async with lock: print(lock.locked())
    sem = asyncio.Semaphore(2)
    async def work(i):
        async with sem: await asyncio.sleep(0.005); return i
    print(await asyncio.gather(*(work(i) for i in range(5))))
    async with asyncio.TaskGroup() as tg:
        a = tg.create_task(sleeper(1, 0.005)); b = tg.create_task(sleeper(2, 0.001))
    print(a.result(), b.result())
    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(sleeper(1, 1))
            async def boom(): raise ValueError('boom')
            tg.create_task(boom())
    except* ValueError as eg: print('group', [str(e) for e in eg.exceptions])
    done, pending = await asyncio.wait([asyncio.create_task(sleeper(i, 0.001 * i)) for i in range(3)]); print(sorted(t.result() for t in done), len(pending))
    # Whichever of the two is started first.
    is_first_done = asyncio.Event()
    async def first(): is_first_done.set(); return 2
    async def second(): await is_first_done.wait(); return 6
    print([await f for f in asyncio.as_completed([second(), first()])])
    print(await asyncio.shield(sleeper(4, 0.001)))
    print(type(loop).__name__, type(loop._selector).__name__, loop.is_running(), loop.time() > 0)
    print(await loop.run_in_executor(None, lambda: 'executor') if False else 'skip executor')
    return 'done'
print(asyncio.run(main()))
print(asyncio.run(sleeper(21, 0)))
with asyncio.Runner() as r: print(r.run(sleeper(1, 0)), r.run(sleeper(2, 0)))
loop = asyncio.new_event_loop(); print(loop.run_until_complete(sleeper(7, 0.001)), loop.is_closed()); loop.close(); print(loop.is_closed())
