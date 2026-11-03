# A task that is registered before it is initialized, then initialized as a Future, then dropped.
import asyncio, gc

loop = asyncio.new_event_loop()
for round in range(3):
    tasks = [asyncio.Task.__new__(asyncio.Task) for i in range(300)]
    for t in tasks:
        asyncio._register_task(t)
        asyncio.Future.__init__(t, loop=loop)
    n = len(asyncio.all_tasks(loop))
    del tasks, t
    for i in range(4):
        gc.collect()
    junk = [bytearray(200) for i in range(20000)]
    junk2 = [[i] * 20 for i in range(20000)]
    left = asyncio.all_tasks(loop)
    print(round, n, len(left), all(isinstance(t, asyncio.Task) for t in left))
    for t in left:
        repr(t)
        t.done()
    del left
loop.close()
print("done")
