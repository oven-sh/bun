# Each thread has a context of its own, which starts as a copy of DefaultContext; so has each task of asyncio.
import decimal, threading, asyncio, contextvars
from decimal import Decimal, getcontext, setcontext, localcontext, Context

results = {}
barrier = threading.Barrier(8)

def work(n):
    c = getcontext()
    first = (c.prec, c is decimal.DefaultContext, [s.__name__ for s, v in c.flags.items() if v])
    c.prec = n + 3
    barrier.wait()
    total = Decimal(0)
    for i in range(1, 400):
        total += Decimal(1) / i
        if i % 50 == 0:
            barrier.wait()
        if getcontext() is not c or getcontext().prec != n + 3:
            results[n] = "the context changed"
            return
    with localcontext(prec=2) as inner:
        barrier.wait()
        short = Decimal(1) / 3
        same = getcontext() is inner
    results[n] = (first, str(total), str(short), same, getcontext() is c, c.flags[decimal.Inexact])

getcontext().prec = 11
decimal.DefaultContext.prec = 17
threads = [threading.Thread(target=work, args=(n,)) for n in range(8)]
for t in threads:
    t.start()
for t in threads:
    t.join()
for n in sorted(results):
    print(n, results[n])
print(getcontext().prec, Decimal(1) / 3)
decimal.DefaultContext.prec = 28

# A context that several threads share is one context.
shared = Context(prec=5)
def share():
    setcontext(shared)
    barrier2.wait()
    for i in range(200):
        Decimal(1) / 7
barrier2 = threading.Barrier(4)
threads = [threading.Thread(target=share) for _ in range(4)]
for t in threads:
    t.start()
for t in threads:
    t.join()
print(shared.flags[decimal.Inexact], shared.prec, getcontext() is shared)

async def task(n):
    getcontext().prec = n
    await asyncio.sleep(0)
    a = Decimal(1) / 3
    with localcontext() as c:
        c.prec = n + 10
        await asyncio.sleep(0)
        b = Decimal(1) / 3
    await asyncio.sleep(0)
    return (n, str(a), str(b), getcontext().prec)

async def main():
    setcontext(Context(prec=4))
    # The tasks begin with a copy of the variables, not of the context object: what one sets, all see, until each sets its own.
    print(await asyncio.gather(*(task(n) for n in (3, 6, 9))))
    print(getcontext().prec)
    async def own(n):
        setcontext(Context(prec=n))
        await asyncio.sleep(0)
        return str(Decimal(1) / 3)
    print(await asyncio.gather(*(own(n) for n in (3, 6, 9))))
    print(getcontext().prec)
asyncio.run(main())
print(getcontext().prec)

def generator():
    with localcontext(prec=3):
        yield Decimal(1) / 3
        yield Decimal(2) / 3
g = generator()
print(next(g), Decimal(1) / 3, next(g))
g.close()
print(Decimal(1) / 3)
print(contextvars.copy_context().run(lambda: (setcontext(Context(prec=2)), Decimal(1) / 3)[1]), Decimal(1) / 3)
