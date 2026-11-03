# Delegation (yield from, await), what a suspended generator keeps, and generators that are dropped.
import gc, sys, types, warnings, inspect

def attempt(f, *a):
    try:
        return f(*a)
    except BaseException as e:
        return "<%s: %s>" % (type(e).__name__, e)

def run(coro):
    out = []
    try:
        v = None
        while True:
            out.append(coro.send(v))
            v = len(out)
    except StopIteration as e:
        return out, e.value

def drain(g):
    out = []
    try:
        while True: out.append(next(g))
    except StopIteration as e:
        return out, e.value

# ---- await ----
class Awaitable:
    def __init__(self, *items): self.items = items
    def __await__(self):
        got = []
        for i in self.items: got.append((yield i))
        return got
class NotIterator:
    def __await__(self): return 5
class ReturnsCoroutine:
    def __await__(self): return simple()
class Raises:
    def __await__(self): raise KeyError("await")
async def simple(): return "simple"
async def twice(x): return (await x), "after"
@types.coroutine
def old_style(n):
    r = yield n
    return r
def plain_generator():
    yield 1

print(run(twice(simple())))
print(run(twice(Awaitable(1, 2, 3))))
print(run(twice(Awaitable())))
print(run(twice(old_style(7))))
print(attempt(run, twice(5)))
print(attempt(run, twice(None)))
print(attempt(run, twice(NotIterator())))
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    print(attempt(run, twice(ReturnsCoroutine())))
    gc.collect()
print(attempt(run, twice(Raises())))
print(attempt(run, twice(plain_generator())))
print(attempt(run, twice(iter([1]))))

# One that is awaited already, is running, or is done.
async def suspended(): return await Awaitable("s")
c = suspended(); print(c.send(None))
print(attempt(run, twice(c)))
print(attempt(c.send, "x"))
print(attempt(run, twice(c)))
async def awaits_itself():
    return await me
me = awaits_itself()
print(attempt(run, me))
done = simple(); print(attempt(done.send, None)); print(attempt(run, twice(done)))

# cr_await, gi_yieldfrom
async def outer(inner): return await inner
a = Awaitable(1)
i = outer(a); o = outer(i)
print(o.cr_await, i.cr_await)
o.send(None)
print(o.cr_await is i, type(i.cr_await).__name__, inspect.getcoroutinestate(o), inspect.getcoroutinestate(i))
print(attempt(o.send, "end"), o.cr_await, i.cr_await, inspect.getcoroutinestate(o))

# async with, with what is not awaitable
class CM:
    def __init__(self, enter, exit): self.enter, self.exit = enter, exit
    def __aenter__(self): return self.enter
    def __aexit__(self, *a): return self.exit
async def use(cm):
    async with cm as v:
        return v
print(run(use(CM(simple(), simple()))))
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    print(attempt(run, use(CM(1, simple()))))
    print(attempt(run, use(CM(simple(), 2))))
    gc.collect()
print(run(use(CM(Awaitable("in"), Awaitable("out")))))

# ---- yield from ----
def leaf():
    got = []
    try:
        for i in range(3):
            got.append((yield i))
    except ValueError as e:
        got.append(("caught", str(e)))
        got.append((yield "after"))
    finally:
        log.append("leaf done")
    return got
def mid(): return ("mid", (yield from leaf()))
def top():
    r = yield from mid()
    yield "top"
    return r
log = []
g = top()
print(next(g), g.send("a"), g.gi_yieldfrom.gi_yieldfrom.gi_code.co_name, g.throw(ValueError("v")), g.send("b"), log)
print(attempt(next, g))
log = []
g = top(); next(g); print(g.close(), log, g.gi_yieldfrom, g.gi_frame)
log = []
g = top(); next(g); print(attempt(g.throw, KeyError("k")), log)
def from_things():
    a = yield from [1, 2]
    b = yield from (x for x in "ab")
    c = yield from iter({7: 8})
    d = yield from range(2)
    e = yield from ()
    return a, b, c, d, e
print(drain(from_things()))
g = from_things(); next(g); print(attempt(g.send, "not None"))
class Sendable:
    def __iter__(self): return self
    def __next__(self): return "next"
    def send(self, v): return ("send", v)
    def throw(self, *a): return ("throw", a)
    def close(self): log.append("closed")
def from_sendable(): yield from Sendable()
log = []
g = from_sendable(); print(next(g), g.send(None), g.send(3), g.throw(ValueError), g.close(), log)
def returns_tuple():
    return (1, 2)
    yield
def takes(): return (yield from returns_tuple())
print(run(takes()))
def raises_stop():
    raise StopIteration("inner")
    yield
def takes_stop(): return (yield from raises_stop())
print(attempt(run, takes_stop()))
class StopsWith:
    def __iter__(self): return self
    def __next__(self): raise StopIteration("value")
def takes_value(): return (yield from StopsWith())
print(run(takes_value()))
def deep(n):
    if n: return 1 + (yield from deep(n - 1))
    yield "bottom"
    return 0
print(run(deep(50)))
def reenter():
    yield from again
again = reenter()
print(attempt(next, again))

# ---- What is sent, wanted or not ----
def statements():
    yield 1
    x = yield 2
    yield x
    (yield 3)
    y = [(yield 4), (yield 5)]
    return y
print(run(statements()))

# ---- The variables of a suspended generator ----
def variables(a, b=2, *c, d=4, **e):
    unused = "unused"
    late = None
    del late
    yield
    inner = a
    cell = 1
    yield lambda: cell
    for loop in range(1):
        yield
g = variables(1, 2, 3, x=5)
print(sorted(g.gi_frame.f_locals.items()))
next(g); print(sorted(g.gi_frame.f_locals.items()))
next(g); print(sorted(g.gi_frame.f_locals.items()))
next(g); print(sorted(g.gi_frame.f_locals.items()))
print(attempt(next, g), g.gi_frame)
f = None
def keeps_frame():
    global f
    f = sys._getframe()
    v = "v"
    yield 1
    w = "w"
    yield 2
    return 3
g = keeps_frame()
print(next(g), sorted(f.f_locals), f.f_lineno - f.f_code.co_firstlineno, f is g.gi_frame, f.f_back)
print(next(g), sorted(f.f_locals), f.f_lineno - f.f_code.co_firstlineno)
print(attempt(next, g), sorted(f.f_locals), g.gi_frame)

# ---- Dropped before they are done ----
log = []
def cleans(name):
    try:
        yield 1
        yield 2
    finally:
        log.append(name)
g = cleans("never started"); del g; gc.collect(); print(log)
g = cleans("started"); next(g); del g; gc.collect(); print(log)
g = cleans("survives a collection"); next(g); gc.collect(); gc.collect(); print(log); del g; gc.collect(); print(log)
g = cleans("finished"); list(g); gc.collect(); del g; gc.collect(); print(log)
g = cleans("closed"); next(g); g.close(); gc.collect(); del g; gc.collect(); print(log)
many = [cleans(i) for i in range(100)]
for g in many[::2]: next(g)
for g in many[::4]: list(g)
log.clear(); del many, g; gc.collect(); print(sorted(log) == [i for i in range(100) if i % 4 == 2], len(log))
def show(message, category, filename, lineno, file=None, line=None):
    print("warning:", category.__name__, message)
warnings.showwarning = show
warnings.simplefilter("always")
simple(); gc.collect()
c = simple(); gc.collect(); gc.collect(); print("kept"); del c; gc.collect()
c = simple(); print(attempt(c.send, None)); del c; gc.collect()
c = simple(); c.close(); del c; gc.collect()
c = suspended(); c.send(None); del c; gc.collect(); print("a suspended one says nothing")
for _ in range(3): simple()
gc.collect()

# ---- Too deep ----
def recurse(n):
    yield from recurse(n + 1)
print(attempt(next, recurse(0))[:40])
def recurse_for(n):
    for x in recurse_for(n + 1): yield x
print(attempt(next, recurse_for(0))[:40])
async def recurse_await(n): await recurse_await(n + 1)
print(attempt(recurse_await(0).send, None)[:40])
g = (x for x in range(3)); print(next(g), "still works", list(g))
print("end")
