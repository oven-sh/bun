import asyncio, threading, time, js
print(await asyncio.to_thread(lambda: threading.current_thread() is not threading.main_thread()))
print(await asyncio.gather(*(asyncio.to_thread(lambda i=i: (time.sleep(0.02), i * i)[1]) for i in range(4))))
loop = asyncio.get_running_loop()
print(type(loop).__name__)
fut = loop.create_future()
threading.Thread(target=lambda: (time.sleep(0.02), loop.call_soon_threadsafe(fut.set_result, "set by a thread"))).start()
print(await fut)
async def coro(): await asyncio.sleep(0.01); return "run for a thread"
box = []
t = threading.Thread(target=lambda: box.append(asyncio.run_coroutine_threadsafe(coro(), loop).result())); t.start()
while t.is_alive(): await asyncio.sleep(0.005)
print(box)
# JS goes on while a thread works
ticks = []
h = js.setInterval(lambda: ticks.append(1), 2)
await asyncio.to_thread(time.sleep, 0.1)
js.clearInterval(h)
print(len(ticks) > 0)
info = await loop.getaddrinfo("localhost", 80)
print(len(info) > 0)
