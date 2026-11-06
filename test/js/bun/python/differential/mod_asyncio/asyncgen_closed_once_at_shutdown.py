# An asynchronous generator that goes through another in `async for` is dropped half way. When asyncio.run() ends, shutdown_asyncgens()
# closes both, in whatever order it finds them. The `finally` clause of the inner one awaits: it is closed once, and comes to its end.
import asyncio
for turn in range(12):
    events = []
    async def g():
        try:
            yield 1
            yield 2
        finally:
            events.append('the clause begins')
            try:
                await asyncio.sleep(0)
            except BaseException as e:
                events.append('the clause gets ' + type(e).__name__)
                raise
            events.append('the clause ends')
    async def outer():
        async for x in g():
            yield x
    # (So that they are at other addresses each time, which is what the order depends on.)
    padding = [object() for i in range(turn * 7)]
    async def main():
        o = outer()
        events.append('item %d' % await anext(o))
        keep = o if turn % 2 else None
        del o
        await asyncio.sleep(0)
    asyncio.run(main())
    print(turn, events)
