import gc, asyncio
class P:
    async def communicate(self, d):
        await asyncio.sleep(0); gc.collect(); return d, None
    async def wait(self): return 0
async def f(*a, **k):
    await asyncio.sleep(0); gc.collect(); return len(a)
class G:
    y = 1
    async def __call__(self, *a):
        gc.collect(); return await asyncio.gather(*a)
async def main(proc, f, g):
    a = await f(1, 2, 3, 4, 5, x=g.y)
    b, _ = await proc.communicate(b"some data")
    print(a, b, await g(*[proc.wait() for _ in range(10)]))
def gen(f, xs):
    yield f(1, 2, 3, 4)
    try:
        yield f(f(1), [x for x in xs], *[f(x, x) for x in xs])
    finally:
        yield f(xs, k={x: f(x) for x in xs})
for _ in range(5):
    asyncio.run(main(P(), f, G()))
    for v in gen(lambda *a, **k: (gc.collect(), len(a) + len(k))[1], [1, 2, 3]): print(v)
