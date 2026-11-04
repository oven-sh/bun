# What tools hear of an exception that passes an `async for`: no more handlers than CPython's code has.
import sys, asyncio
E = sys.monitoring.events
class It:
    def __aiter__(self): return self
    async def __anext__(self): raise KeyError('x')
class It2:
    def __init__(self): self.n = 0
    def __aiter__(self): return self
    async def __anext__(self):
        self.n += 1
        if self.n > 1: raise StopAsyncIteration
        return self.n
async def f1():
    async for x in It():
        pass
async def f2():
    try:
        async for x in It():
            pass
    except KeyError:
        return 'caught'
async def f3():
    async for x in It2():
        pass
    return 'done'
async def f4():
    return [x async for x in It()]
async def f5():
    async with M():
        async for x in It():
            pass
class M:
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
def run(fn):
    seen = []
    names = {E.RAISE: 'RAISE', E.RERAISE: 'RERAISE', E.EXCEPTION_HANDLED: 'HANDLED', E.PY_UNWIND: 'UNWIND', E.PY_THROW: 'THROW'}
    sys.monitoring.use_tool_id(3, 't')
    for ev, name in names.items():
        def cb(code, offset, exc, name=name):
            if code.co_name.startswith('f'):
                seen.append((name, code.co_name, type(exc).__name__))
        sys.monitoring.register_callback(3, ev, cb)
    sys.monitoring.set_events(3, sum(names))
    try:
        r = asyncio.run(fn())
    except BaseException as e:
        r = type(e).__name__
    sys.monitoring.set_events(3, 0)
    sys.monitoring.free_tool_id(3)
    print(fn.__name__, r, seen)
for fn in (f1, f2, f3, f4, f5): run(fn)


async def f6():
    async for x in It2():
        raise KeyError('in the body')
async def f7():
    try:
        async for x in It2():
            raise KeyError('in the body')
    except KeyError:
        return 'caught'
async def f8():
    async for x in It2():
        async for y in It():
            pass
async def f9():
    return {x: y async for x in It2() async for y in It()}
for fn in (f6, f7, f8, f9): run(fn)


def traced(fn):
    seen = []
    def trace(frame, event, arg):
        if frame.f_code.co_name.startswith('f'):
            seen.append((event, frame.f_lineno - frame.f_code.co_firstlineno))
            return trace
    sys.settrace(trace)
    try:
        r = asyncio.run(fn())
    except BaseException as e:
        r = type(e).__name__
    finally:
        sys.settrace(None)
    print(fn.__name__, r, seen)
for fn in (f1, f2, f3, f4, f5, f6, f7, f8, f9): traced(fn)
