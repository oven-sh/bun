import types
log = []
async def add(a, b): return a + b
async def half(x): return x / 2
async def nested(x):
    y = await add(x, 1)
    return await add(y, 1)
async def fails(): raise ValueError("async failure")
@types.coroutine
def give_way():
    yield
async def yields_none():
    await give_way()
    await give_way()
    return "after giving way"
@types.coroutine
def wait_for_something():
    yield "a future"
async def needs_loop(): await wait_for_something()
class Awaitable:
    def __init__(self, v): self.v = v
    def __await__(self):
        return iter(())  # no result
class AwaitableValue:
    def __await__(self):
        yield
        return 99
async def agen(n):
    try:
        for i in range(n):
            yield i * 1.0
    finally:
        log.append("agen closed")
class AIter:
    def __init__(self): self.i = 0
    def __aiter__(self): return self
    async def __anext__(self):
        self.i += 1
        if self.i > 2: raise StopAsyncIteration
        return self.i
async def agen_fails():
    yield 1
    raise KeyError("in agen")
# Called by JS, an async function returns a promise. A coroutine that JS comes by in another way is a coroutine.
held = [add(1, 2), add(3, 4)]
class Plain: pass
plain = Plain()
d = {}
