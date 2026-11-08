# The running loop and the current task belong to a thread. Where those of the threads that are not running were kept in a dict, gc.get_objects() handed it out, and what came out of it at the next switch of threads was believed.
import asyncio, gc, threading
N = 6
loops = [None] * N; tasks = [None] * N; steady = [None] * N
arrived = [threading.Event() for i in range(N)]; go = threading.Event()
async def work(i):
    loops[i] = asyncio.get_running_loop(); tasks[i] = asyncio.current_task()
    arrived[i].set(); go.wait()                 # The thread waits in the middle of a step of its task.
    ok = True
    for n in range(100):
        ok = ok and asyncio.get_running_loop() is loops[i] and asyncio.current_task() is tasks[i]
        await asyncio.sleep(0)
    steady[i] = ok
threads = [threading.Thread(target=lambda i=i: asyncio.run(work(i))) for i in range(N)]
for thread in threads: thread.start()
for event in arrived: event.wait()

async def main():
    mine = asyncio.current_task()
    print('the task of each other loop:', [asyncio.current_task(loops[i]) is tasks[i] for i in range(N)])
    tables = [o for o in gc.get_objects() if type(o) is dict and o and all(type(v) is tuple and len(v) == 2 and isinstance(v[0], asyncio.AbstractEventLoop) for v in o.values())]
    print('dicts of (loop, task):', len(tables))
    for table in tables:
        for key in list(table): table[key] = 1
    go.set()
    ok = True
    for n in range(100):
        ok = ok and asyncio.current_task() is mine
        await asyncio.sleep(0)
    print('the main thread:', ok)
asyncio.run(main())
for thread in threads: thread.join()
print('the others:', steady)
