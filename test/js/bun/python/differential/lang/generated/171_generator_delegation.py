# Delegation (yield from, await), what a suspended generator keeps, and generators that are dropped.
try: import gc, sys, types, warnings, inspect
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc, sys, types, warnings, inspect')

try:
    def attempt(f, *a):
        try:
            return f(*a)
        except BaseException as e:
            return "<%s: %s>" % (type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def attempt(f, *a):')

try:
    def run(coro):
        out = []
        try:
            v = None
            while True:
                out.append(coro.send(v))
                v = len(out)
        except StopIteration as e:
            return out, e.value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(coro):')

try:
    def drain(g):
        out = []
        try:
            while True: out.append(next(g))
        except StopIteration as e:
            return out, e.value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def drain(g):')

# ---- await ----
try:
    class Awaitable:
        def __init__(self, *items): self.items = items
        def __await__(self):
            got = []
            for i in self.items: got.append((yield i))
            return got
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Awaitable:')
try:
    class NotIterator:
        def __await__(self): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NotIterator:')
try:
    class ReturnsCoroutine:
        def __await__(self): return simple()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ReturnsCoroutine:')
try:
    class Raises:
        def __await__(self): raise KeyError("await")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Raises:')
try:
    async def simple(): return "simple"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def simple(): return "simple"')
try:
    async def twice(x): return (await x), "after"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def twice(x): return (await x), "after"')
try:
    @types.coroutine
    def old_style(n):
        r = yield n
        return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def old_style(n):')
try:
    def plain_generator():
        yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain_generator():')

try: print(run(twice(simple())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(twice(simple()))')
try: print(run(twice(Awaitable(1, 2, 3))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(twice(Awaitable(1, 2, 3)))')
try: print(run(twice(Awaitable())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(twice(Awaitable()))')
try: print(run(twice(old_style(7))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(twice(old_style(7)))')
try: print(attempt(run, twice(5)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(run, twice(5))')
try: print(attempt(run, twice(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(run, twice(None))')
try: print(attempt(run, twice(NotIterator())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(run, twice(NotIterator()))')
try:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        print(attempt(run, twice(ReturnsCoroutine())))
        gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with warnings.catch_warnings():')
try: print(attempt(run, twice(Raises())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(run, twice(Raises()))')
try: print(attempt(run, twice(plain_generator())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(run, twice(plain_generator()))')
try: print(attempt(run, twice(iter([1]))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(run, twice(iter([1])))')

# One that is awaited already, is running, or is done.
try:
    async def suspended(): return await Awaitable("s")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def suspended(): return await Awaitable("s")')
try: c = suspended()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = suspended()')
try: print(c.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: print(attempt(run, twice(c)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(run, twice(c))')
try: print(attempt(c.send, "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(c.send, "x")')
try: print(attempt(run, twice(c)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(run, twice(c))')
try:
    async def awaits_itself():
        return await me
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def awaits_itself():')
try: me = awaits_itself()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me = awaits_itself()')
try: print(attempt(run, me))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(run, me)')
try: done = simple()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: done = simple()')
try: print(attempt(done.send, None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(done.send, None)')
try: print(attempt(run, twice(done)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(run, twice(done))')

# cr_await, gi_yieldfrom
try:
    async def outer(inner): return await inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def outer(inner): return await inner')
try: a = Awaitable(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = Awaitable(1)')
try: i = outer(a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = outer(a)')
try: o = outer(i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = outer(i)')
try: print('o.cr_await =>', o.cr_await)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.cr_await')
try: print('i.cr_await =>', i.cr_await)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.cr_await')
try: o.send(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.send(None)')
try: print('o.cr_await is i =>', o.cr_await is i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.cr_await is i')
try: print('type(i.cr_await).__name__ =>', type(i.cr_await).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(i.cr_await).__name__')
try: print('inspect.getcoroutinestate(o) =>', inspect.getcoroutinestate(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getcoroutinestate(o)')
try: print('inspect.getcoroutinestate(i) =>', inspect.getcoroutinestate(i))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getcoroutinestate(i)')
try: print('attempt(o.send, "end") =>', attempt(o.send, "end"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(o.send, "end")')
try: print('o.cr_await =>', o.cr_await)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.cr_await')
try: print('i.cr_await =>', i.cr_await)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.cr_await')
try: print('inspect.getcoroutinestate(o) =>', inspect.getcoroutinestate(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getcoroutinestate(o)')

# async with, with what is not awaitable
try:
    class CM:
        def __init__(self, enter, exit): self.enter, self.exit = enter, exit
        def __aenter__(self): return self.enter
        def __aexit__(self, *a): return self.exit
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CM:')
try:
    async def use(cm):
        async with cm as v:
            return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def use(cm):')
try: print(run(use(CM(simple(), simple()))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(use(CM(simple(), simple())))')
try:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        print(attempt(run, use(CM(1, simple()))))
        print(attempt(run, use(CM(simple(), 2))))
        gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with warnings.catch_warnings():')
try: print(run(use(CM(Awaitable("in"), Awaitable("out")))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(use(CM(Awaitable("in"), Awaitable("out"))))')

# ---- yield from ----
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def leaf():')
try:
    def mid(): return ("mid", (yield from leaf()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def mid(): return ("mid", (yield from leaf()))')
try:
    def top():
        r = yield from mid()
        yield "top"
        return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def top():')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try: g = top()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = top()')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.send("a") =>', g.send("a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.send("a")')
try: print('g.gi_yieldfrom.gi_yieldfrom.gi_code.co_name =>', g.gi_yieldfrom.gi_yieldfrom.gi_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_yieldfrom.gi_yieldfrom.gi_code.co_name')
try: print('g.throw(ValueError("v")) =>', g.throw(ValueError("v")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(ValueError("v"))')
try: print('g.send("b") =>', g.send("b"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.send("b")')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: print(attempt(next, g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(next, g)')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try: g = top()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = top()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.close() =>', g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: print('g.gi_yieldfrom =>', g.gi_yieldfrom)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_yieldfrom')
try: print('g.gi_frame =>', g.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try: g = top()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = top()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('attempt(g.throw, KeyError("k")) =>', attempt(g.throw, KeyError("k")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(g.throw, KeyError("k"))')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try:
    def from_things():
        a = yield from [1, 2]
        b = yield from (x for x in "ab")
        c = yield from iter({7: 8})
        d = yield from range(2)
        e = yield from ()
        return a, b, c, d, e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def from_things():')
try: print(drain(from_things()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: drain(from_things())')
try: g = from_things()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = from_things()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(attempt(g.send, "not None"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(g.send, "not None")')
try:
    class Sendable:
        def __iter__(self): return self
        def __next__(self): return "next"
        def send(self, v): return ("send", v)
        def throw(self, *a): return ("throw", a)
        def close(self): log.append("closed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Sendable:')
try:
    def from_sendable(): yield from Sendable()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def from_sendable(): yield from Sendable()')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try: g = from_sendable()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = from_sendable()')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.send(None) =>', g.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.send(None)')
try: print('g.send(3) =>', g.send(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.send(3)')
try: print('g.throw(ValueError) =>', g.throw(ValueError))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(ValueError)')
try: print('g.close() =>', g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try:
    def returns_tuple():
        return (1, 2)
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def returns_tuple():')
try:
    def takes(): return (yield from returns_tuple())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def takes(): return (yield from returns_tuple())')
try: print(run(takes()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(takes())')
try:
    def raises_stop():
        raise StopIteration("inner")
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raises_stop():')
try:
    def takes_stop(): return (yield from raises_stop())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def takes_stop(): return (yield from raises_stop())')
try: print(attempt(run, takes_stop()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(run, takes_stop())')
try:
    class StopsWith:
        def __iter__(self): return self
        def __next__(self): raise StopIteration("value")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class StopsWith:')
try:
    def takes_value(): return (yield from StopsWith())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def takes_value(): return (yield from StopsWith())')
try: print(run(takes_value()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(takes_value())')
try:
    def deep(n):
        if n: return 1 + (yield from deep(n - 1))
        yield "bottom"
        return 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def deep(n):')
try: print(run(deep(50)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(deep(50))')
try:
    def reenter():
        yield from again
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def reenter():')
try: again = reenter()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: again = reenter()')
try: print(attempt(next, again))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(next, again)')

# ---- What is sent, wanted or not ----
try:
    def statements():
        yield 1
        x = yield 2
        yield x
        (yield 3)
        y = [(yield 4), (yield 5)]
        return y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def statements():')
try: print(run(statements()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(statements())')

# ---- The variables of a suspended generator ----
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def variables(a, b=2, *c, d=4, **e):')
try: g = variables(1, 2, 3, x=5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = variables(1, 2, 3, x=5)')
try: print(sorted(g.gi_frame.f_locals.items()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(g.gi_frame.f_locals.items())')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(sorted(g.gi_frame.f_locals.items()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(g.gi_frame.f_locals.items())')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(sorted(g.gi_frame.f_locals.items()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(g.gi_frame.f_locals.items())')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(sorted(g.gi_frame.f_locals.items()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(g.gi_frame.f_locals.items())')
try: print('attempt(next, g) =>', attempt(next, g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(next, g)')
try: print('g.gi_frame =>', g.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame')
try: f = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f = None')
try:
    def keeps_frame():
        global f
        f = sys._getframe()
        v = "v"
        yield 1
        w = "w"
        yield 2
        return 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def keeps_frame():')
try: g = keeps_frame()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = keeps_frame()')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('sorted(f.f_locals) =>', sorted(f.f_locals))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(f.f_locals)')
try: print('f.f_lineno - f.f_code.co_firstlineno =>', f.f_lineno - f.f_code.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_lineno - f.f_code.co_firstlineno')
try: print('f is g.gi_frame =>', f is g.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f is g.gi_frame')
try: print('f.f_back =>', f.f_back)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_back')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('sorted(f.f_locals) =>', sorted(f.f_locals))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(f.f_locals)')
try: print('f.f_lineno - f.f_code.co_firstlineno =>', f.f_lineno - f.f_code.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_lineno - f.f_code.co_firstlineno')
try: print('attempt(next, g) =>', attempt(next, g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(next, g)')
try: print('sorted(f.f_locals) =>', sorted(f.f_locals))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(f.f_locals)')
try: print('g.gi_frame =>', g.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame')

# ---- Dropped before they are done ----
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
    def cleans(name):
        try:
            yield 1
            yield 2
        finally:
            log.append(name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cleans(name):')
try: g = cleans("never started")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cleans("never started")')
try: del g
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del g')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: g = cleans("started")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cleans("started")')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: del g
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del g')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: g = cleans("survives a collection")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cleans("survives a collection")')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: del g
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del g')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: g = cleans("finished")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cleans("finished")')
try: list(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(g)')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: del g
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del g')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: g = cleans("closed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cleans("closed")')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: g.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: del g
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del g')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: many = [cleans(i) for i in range(100)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: many = [cleans(i) for i in range(100)]')
try:
    for g in many[::2]: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for g in many[::2]: next(g)')
try:
    for g in many[::4]: list(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for g in many[::4]: list(g)')
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try: del many, g
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del many, g')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print('sorted(log) == [i for i in range(100) if i % 4 == 2] =>', sorted(log) == [i for i in range(100) if i % 4 == 2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(log) == [i for i in range(100) if i % 4 == 2]')
try: print('len(log) =>', len(log))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(log)')
try:
    def show(message, category, filename, lineno, file=None, line=None):
        print("warning:", category.__name__, message)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(message, category, filename, lineno, file=None, line=None):')
try: warnings.showwarning = show
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warnings.showwarning = show')
try: warnings.simplefilter("always")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warnings.simplefilter("always")')
try: simple()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: simple()')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: c = simple()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = simple()')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print("kept")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "kept"')
try: del c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del c')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: c = simple()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = simple()')
try: print(attempt(c.send, None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(c.send, None)')
try: del c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del c')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: c = simple()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = simple()')
try: c.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.close()')
try: del c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del c')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: c = suspended()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = suspended()')
try: c.send(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: del c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del c')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print("a suspended one says nothing")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "a suspended one says nothing"')
try:
    for _ in range(3): simple()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(3): simple()')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')

# ---- Too deep ----
try:
    def recurse(n):
        yield from recurse(n + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def recurse(n):')
try: print(attempt(next, recurse(0))[:40])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(next, recurse(0))[:40]')
try:
    def recurse_for(n):
        for x in recurse_for(n + 1): yield x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def recurse_for(n):')
try: print(attempt(next, recurse_for(0))[:40])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(next, recurse_for(0))[:40]')
try:
    async def recurse_await(n): await recurse_await(n + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def recurse_await(n): await recurse_await(n + 1)')
try: print(attempt(recurse_await(0).send, None)[:40])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(recurse_await(0).send, None)[:40]')
try: g = (x for x in range(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = (x for x in range(3))')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print("still works", 'list(g) =>', list(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(g)')
try: print("end")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "end"')
