import asyncio, signal, os
async def main():
    loop = asyncio.get_running_loop(); fut = loop.create_future()
    loop.add_signal_handler(signal.SIGUSR1, lambda: fut.set_result('usr1'))
    loop.call_later(0.01, os.kill, os.getpid(), signal.SIGUSR1)
    print(await fut, loop.remove_signal_handler(signal.SIGUSR1), loop.remove_signal_handler(signal.SIGUSR1))
asyncio.run(main())
