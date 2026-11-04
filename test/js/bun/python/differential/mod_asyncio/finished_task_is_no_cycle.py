# A task that has finished is not part of a cycle: what it handed to the loop and to the futures it waited for does not stay with it.
import asyncio, gc


async def waits(future):
    await asyncio.sleep(0)
    return await future


class Foreign:                          # a future of another kind: add_done_callback is found by name
    _asyncio_future_blocking = False
    def __init__(self, loop): self.loop = loop
    def get_loop(self): return self.loop
    def add_done_callback(self, callback, *, context=None): self.loop.call_soon(callback, self, context=context)
    def result(self): return "foreign"
    def __await__(self):
        self._asyncio_future_blocking = True
        yield self
        return self.result()


async def waits_for_foreign(loop):
    return await Foreign(loop)


async def main():
    loop = asyncio.get_running_loop()
    gc.collect()
    gc.disable()
    gc.set_debug(gc.DEBUG_SAVEALL)
    try:
        future = loop.create_future()
        task = asyncio.ensure_future(waits(future))
        loop.call_soon(future.set_result, 5)
        print(await task)
        print(await asyncio.ensure_future(waits_for_foreign(loop)))
        print(await asyncio.gather(asyncio.sleep(0, "a"), asyncio.sleep(0.001, "b")))
        del future, task
        found = gc.collect()
        print("unreachable:", found, [type(o).__name__ for o in gc.garbage])
    finally:
        gc.set_debug(0)
        gc.garbage.clear()
        gc.enable()


asyncio.run(main())
