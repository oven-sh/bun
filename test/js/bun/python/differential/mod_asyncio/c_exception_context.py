# The exception being handled, and the context of what is raised next, in coroutines that a task resumes.
import asyncio, sys, traceback
class F:
    "an async iterator whose __anext__ is a future that fails with StopAsyncIteration"
    def __init__(self): self.n = 0
    def __aiter__(self): return self
    def __anext__(self):
        self.n += 1
        f = asyncio.get_running_loop().create_future()
        if self.n < 2: f.set_result(self.n)
        else: asyncio.get_running_loop().call_soon(f.set_exception, StopAsyncIteration())
        return f
async def fails(e):
    await asyncio.sleep(0); raise e
async def main():
    print([x async for x in F()], sys.exception())
    try: 1 / 0
    except ZeroDivisionError as e: print(repr(e.__context__))
    try: await asyncio.create_task(fails(KeyError("k")))
    except KeyError as e: print(repr(e), repr(e.__context__), repr(sys.exception()))
    print(sys.exception())
    try: raise ValueError("after")
    except ValueError as e: print(repr(e.__context__))
    f = asyncio.get_running_loop().create_future(); asyncio.get_running_loop().call_soon(f.set_exception, OSError("late"))
    try: await f
    except OSError as e:
        print([x.name for x in traceback.extract_tb(e.__traceback__)])
        try: await asyncio.sleep(0); raise LookupError("inside")
        except LookupError as e2: print(repr(e2.__context__))
    t = asyncio.create_task(asyncio.sleep(10)); await asyncio.sleep(0); t.cancel()
    try: await t
    except asyncio.CancelledError as e: print(repr(e.__context__), sys.exception() is e)
    print(sys.exception())
    async def seen(): return sys.exception()
    try: raise RuntimeError("handled while a task starts")
    except RuntimeError: print(await asyncio.create_task(seen()), repr(await seen()))
asyncio.run(main())
async def uncaught():
    f = asyncio.get_running_loop().create_future(); asyncio.get_running_loop().call_soon(f.set_exception, StopAsyncIteration())
    try: await f
    except StopAsyncIteration: pass
    raise TypeError("no context")
try: asyncio.run(uncaught())
except TypeError as e: print(repr(e.__context__), "".join(traceback.format_exception(e)).count("During handling"))
# what is thrown into a coroutine that awaits while it handles an exception
async def chained():
    async def raise_error(): raise ValueError
    try: raise KeyError(3)
    except Exception:
        t = asyncio.create_task(raise_error())
        try: await t
        except Exception as exc: print(type(exc).__name__, repr(exc.__context__))
        f = asyncio.get_running_loop().create_future(); f.set_exception(OSError("done already"))
        try: await f
        except OSError as exc: print(repr(exc.__context__))
    try:
        async with asyncio.timeout(0.01):
            try: 1 / 0
            finally: await asyncio.sleep(1)
    except TimeoutError as e: print(type(e.__cause__).__name__, type(e.__cause__.__context__).__name__)
    async def inner():
        try: raise LookupError("inner")
        except LookupError: await asyncio.sleep(1)
    async def outer():
        try: raise IndexError("outer")
        except IndexError: await inner()
    t = asyncio.create_task(outer()); await asyncio.sleep(0); t.cancel()
    try: await t
    except asyncio.CancelledError as e: print(repr(e.__context__), repr(e.__context__.__context__))
asyncio.run(chained())
