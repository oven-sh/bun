import concurrent.futures, threading, time, asyncio, socket, queue, sys

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
    print(list(ex.map(lambda x: x * x, range(10))))
    fs = [ex.submit(pow, 2, n) for n in range(5)]
    print(sorted(f.result() for f in concurrent.futures.as_completed(fs)))
    f = ex.submit(lambda: 1 / 0)
    print(type(f.exception()).__name__)
    names = set(ex.map(lambda _: (time.sleep(0.01), threading.current_thread().name)[1], range(8)))
    print(len(names) > 1, all(n.startswith("ThreadPoolExecutor") for n in names))
    done, not_done = concurrent.futures.wait([ex.submit(time.sleep, 0.01), ex.submit(time.sleep, 0.02)])
    print(len(done), len(not_done))
print(threading.active_count())

async def main():
    loop = asyncio.get_running_loop()
    print(await loop.run_in_executor(None, lambda: threading.current_thread() is not threading.main_thread()))
    print(await asyncio.to_thread(sum, range(100)))
    print(await asyncio.gather(*(asyncio.to_thread(lambda i=i: (time.sleep(0.01), i)[1]) for i in range(5))))
    info = await loop.getaddrinfo("localhost", 80, type=socket.SOCK_STREAM, family=socket.AF_INET)
    print(info[0][4])
    print(await loop.getnameinfo(("127.0.0.1", 80), socket.NI_NUMERICHOST | socket.NI_NUMERICSERV))
    # a server on a host name, and a client
    async def serve(reader, writer):
        writer.write((await reader.readline()).upper()); await writer.drain(); writer.close()
    server = await asyncio.start_server(serve, "localhost", 0, family=socket.AF_INET)
    port = server.sockets[0].getsockname()[1]
    r, w = await asyncio.open_connection("localhost", port, family=socket.AF_INET)
    w.write(b"hello\n"); print(await r.readline()); w.close(); server.close(); await server.wait_closed()
    # call_soon_threadsafe, run_coroutine_threadsafe
    fut = loop.create_future()
    threading.Thread(target=lambda: loop.call_soon_threadsafe(fut.set_result, "from a thread")).start()
    print(await fut)
    async def coro(): await asyncio.sleep(0.01); return "coroutine run for a thread"
    res = queue.Queue()
    threading.Thread(target=lambda: res.put(asyncio.run_coroutine_threadsafe(coro(), loop).result())).start()
    while res.empty(): await asyncio.sleep(0.005)
    print(res.get())
asyncio.run(main())

# an event loop in a thread that is not the main one
out = []
def loop_in_thread():
    async def inner(): await asyncio.sleep(0.01); return threading.current_thread().name
    out.append(asyncio.run(inner()))
t = threading.Thread(target=loop_in_thread, name="looper"); t.start(); t.join(); print(out)
print(threading.active_count())
