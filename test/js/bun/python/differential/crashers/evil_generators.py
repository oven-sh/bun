# Generators and coroutines used in ways nobody means to: resumed from within, from finalizers, trace functions and other threads, with their
# frames read, written, cleared and jumped in, at the recursion limit and at the end of the stack.
# Each case must end in a result or an exception, never in a crash.
import sys, gc, threading, types, copy, pickle, weakref, inspect, itertools, time, collections, contextlib, asyncio

GROUP = sys.argv[1] if len(sys.argv) > 1 else None
def outcome(f):
    try:
        r = f()
        return "ok " + repr(r)[:100]
    except (RecursionError, MemoryError) as e:
        return type(e).__name__
    except BaseException as e:
        return type(e).__name__ + ": " + str(e)[:100]
CASES = []
def case(name):
    def register(f):
        CASES.append((name, f))
        return f
    return register

def collect():
    for _ in range(3): gc.collect()

# ---- Resumed from within ----

@case("send to itself")
def _():
    def g():
        yield 1
        yield me.send(None)
    me = g(); next(me)
    return next(me)

@case("next of itself through gi_frame")
def _():
    def g():
        yield 1
        f = sys._getframe()
        yield [outcome(lambda: next(x)) for x in gc.get_referrers(f) if isinstance(x, types.GeneratorType)]
    me = g(); next(me)
    return next(me)

for method, args in (("throw", (ValueError,)), ("close", ()), ("send", (1,)), ("__next__", ())):
    @case("running: " + method)
    def _(method=method, args=args):
        def g():
            yield outcome(lambda: getattr(me, method)(*args))
            yield 2
        me = g()
        return list(me)

@case("yield from itself")
def _():
    def g():
        yield 1
        yield from me
    me = g()
    return list(me)

@case("two that delegate to each other")
def _():
    def g(other):
        yield 1
        yield from other()
    a = g(lambda: b); b = g(lambda: a)
    return list(itertools.islice(a, 10))

@case("await itself")
def _():
    async def c():
        await me
    me = c()
    return me.send(None)

@case("resumed by its own finalizer")
def _():
    log = []
    class D:
        def __del__(self):
            log.append(outcome(lambda: next(me)))
    def g():
        d = D()
        yield 1
        del d
        collect()
        yield 2
    me = g()
    return list(me), log

@case("finalizer of a local resumes the dying generator")
def _():
    log = []
    class D:
        def __init__(self): self.g = None
        def __del__(self):
            log.append(outcome(lambda: next(self.g)))
            log.append(outcome(lambda: self.g.gi_frame))
    def g(d):
        try:
            yield 1
        finally:
            log.append("finally")
            yield 2
    d = D(); d.g = g(d); next(d.g)
    del d
    collect()
    return log

@case("generator resurrected by finally")
def _():
    keep = []
    def g():
        try:
            yield 1
        finally:
            keep.append(sys._getframe())
    x = g(); next(x); del x
    collect()
    f = keep[0]
    return f.f_lineno is not None, outcome(lambda: f.f_locals), outcome(lambda: f.clear()), outcome(lambda: f.f_back)

@case("close ignored for ever")
def _():
    def g():
        while True:
            try:
                yield 1
            except GeneratorExit:
                pass
    x = g(); next(x)
    r = outcome(x.close)
    del x
    collect()
    return r

@case("generators made in finalizers")
def _():
    log = []
    def g(n):
        try:
            yield n
        finally:
            if n:
                h = g(n - 1); next(h)
                log.append(n)
    x = g(50); next(x); del x
    for _ in range(60): gc.collect()
    return len(log)

@case("finalizer makes many generators during collection aftermath")
def _():
    made = []
    class D:
        def __del__(self):
            for i in range(2000):
                def g():
                    try: yield
                    finally: pass
                x = g(); next(x)
                if i % 100 == 0: made.append(x)
    for _ in range(20):
        D()
        collect()
    return len(made)

# ---- Frames ----

def suspended():
    def g(a, b=2):
        c = a + b
        yield c
        d = c * 2
        yield d
    x = g(1); next(x)
    return x

@case("f_locals of a suspended generator written")
def _():
    x = suspended(); f = x.gi_frame
    f.f_locals["c"] = "changed"; f.f_locals["new"] = 1
    r = outcome(lambda: f.f_locals.pop("c"))
    return r, next(x), sorted(f.f_locals)

@case("variable that is not bound yet")
def _():
    x = suspended(); f = x.gi_frame
    return "d" in f.f_locals, outcome(lambda: f.f_locals["d"]), repr(f.f_locals), next(x), f.f_locals["d"]

@case("clear a suspended frame")
def _():
    x = suspended(); f = x.gi_frame
    f.clear()
    return outcome(lambda: next(x)), x.gi_frame, outcome(lambda: f.f_locals), outcome(lambda: f.f_lineno)

@case("clear a frame that has not started")
def _():
    def g(a): yield a
    x = g([1]); f = x.gi_frame
    f.clear()
    return outcome(lambda: next(x)), outcome(lambda: f.f_locals)

@case("clear a running frame")
def _():
    def g():
        yield outcome(sys._getframe().clear)
        yield 2
    return list(g())

@case("clear the frame of a coroutine")
def _():
    async def c(): await asyncio.sleep(0)
    x = c(); f = x.cr_frame; f.clear()
    return outcome(lambda: x.send(None))

@case("frame outlives the generator")
def _():
    x = suspended(); f = x.gi_frame
    list(x); del x
    collect()
    return outcome(lambda: dict(f.f_locals)), f.f_lineno, f.f_back, outcome(f.clear), f.f_code.co_name, outcome(lambda: f.f_generator)

@case("frame of a dropped generator")
def _():
    x = suspended(); f = x.gi_frame
    del x
    collect()
    return outcome(lambda: dict(f.f_locals)), outcome(lambda: f.f_lineno), outcome(lambda: type(f.f_generator).__name__)

@case("f_back of a suspended generator")
def _():
    x = suspended()
    return x.gi_frame.f_back

@case("f_back chain from within nested generators")
def _():
    def inner():
        f = sys._getframe(); names = []
        while f: names.append(f.f_code.co_name); f = f.f_back
        yield names[:4]
    def outer(): yield from inner()
    return next(outer())

@case("f_lineno jump in a suspended generator")
def _():
    x = suspended(); f = x.gi_frame
    def set(): f.f_lineno = f.f_lineno + 1
    return outcome(set), outcome(lambda: next(x))

@case("f_lineno jump under a trace function")
def _():
    log = []
    def g():
        a = 1
        yield a
        b = 2
        yield b
        c = 3
        yield c
    first = g.__code__.co_firstlineno
    def trace(frame, event, arg):
        if frame.f_code is g.__code__:
            if event == "line" and frame.f_lineno == first + 3 and not log:
                log.append(outcome(lambda: setattr(frame, "f_lineno", first + 5)))
            return trace
    sys.settrace(trace)
    try: r = list(g())
    finally: sys.settrace(None)
    return r, log

@case("jump into and out of try in a generator")
def _():
    log = []
    def g():
        yield 1
        try:
            yield 2
        finally:
            yield 3
        yield 4
    first = g.__code__.co_firstlineno
    def trace(frame, event, arg):
        if frame.f_code is g.__code__ and event == "line":
            for target in range(first, first + 8):
                if len(log) < 40: log.append(outcome(lambda: setattr(frame, "f_lineno", target))[:12])
                break
        return trace
    sys.settrace(trace)
    try: r = outcome(lambda: list(itertools.islice(g(), 20)))
    finally: sys.settrace(None)
    return r, len(log)

@case("trace function resumes the generator it traces")
def _():
    log = []
    def g():
        yield 1
        yield 2
    x = g()
    def trace(frame, event, arg):
        if frame.f_code is g.__code__:
            log.append((event, outcome(lambda: next(x))[:40]))
            return trace
    sys.settrace(trace)
    try: r = list(x)
    finally: sys.settrace(None)
    return r, log[:4]

@case("trace function closes another generator and raises")
def _():
    def g():
        try:
            yield 1
            yield 2
        finally:
            pass
    x = g(); y = g(); next(y)
    def trace(frame, event, arg):
        if frame.f_code is g.__code__ and event == "line":
            y.close()
            raise KeyError("from trace")
        return trace
    sys.settrace(trace)
    try: r = outcome(lambda: list(x))
    finally: sys.settrace(None)
    return r, outcome(lambda: next(x)), outcome(lambda: next(y))

@case("profile function throws into generators")
def _():
    def g():
        yield 1
        yield 2
    n = [0]
    def profile(frame, event, arg):
        n[0] += 1
        if n[0] % 3 == 0: raise ValueError(event)
    rs = []
    sys.setprofile(profile)
    try:
        for _ in range(10): rs.append(outcome(lambda: list(g()))[:30])
    finally: sys.setprofile(None)
    return len(rs)

@case("sys.monitoring raises at every event of a generator")
def _():
    M = sys.monitoring; E = M.events
    def g():
        try:
            yield 1
            yield from [2, 3]
        finally:
            pass
    rs = []
    for event in (E.PY_START, E.PY_RESUME, E.PY_YIELD, E.PY_RETURN, E.LINE, E.INSTRUCTION, E.PY_UNWIND, E.PY_THROW, E.RAISE, E.STOP_ITERATION):
        M.use_tool_id(3, "t")
        def hook(*a): raise KeyError("hook")
        M.register_callback(3, event, hook)
        try:
            M.set_events(3, event)
            rs.append(outcome(lambda: list(g()))[:20])
            x = g(); rs.append(outcome(lambda: (next(x), x.throw(ValueError)))[:20]); rs.append(outcome(x.close)[:20])
        finally:
            M.set_events(3, 0); M.register_callback(3, event, None); M.free_tool_id(3)
    return len(rs)

# ---- Limits ----

@case("recursion limit exactly at resume")
def _():
    def g():
        yield 1
        yield 2
    def deep(n, x):
        if n: return deep(n - 1, x)
        return next(x)
    rs = set()
    for limit in range(60, 90):
        x = g(); next(x)
        sys.setrecursionlimit(limit + len(inspect.stack(0)))
        for n in range(limit - 8, limit + 4):
            rs.add(outcome(lambda: deep(n, x))[:14])
            x = g(); next(x)
    sys.setrecursionlimit(1000)
    return sorted(rs)

@case("generator goes on after RecursionError at resume")
def _():
    def g():
        for i in range(100): yield i
    x = g(); next(x)
    def deep(n):
        try: return deep(n + 1)
        except RecursionError: return outcome(lambda: next(x))
    a = deep(0)
    return a, outcome(lambda: next(x)), x.gi_frame is None

@case("chain of yield from at the recursion limit")
def _():
    def g(n):
        if n: yield from g(n - 1)
        else: yield 0
    return outcome(lambda: next(g(10 ** 6))), outcome(lambda: list(g(900)))

@case("chain of yield from, end of the stack")
def _():
    sys.setrecursionlimit(10 ** 8)
    def g(f): yield from f(f)
    return outcome(lambda: next(g(g)))

@case("chain of for loops over generators, end of the stack")
def _():
    sys.setrecursionlimit(10 ** 8)
    def g(f):
        for x in f(f): yield x
    return outcome(lambda: next(g(g)))

@case("chain of awaits, end of the stack")
def _():
    sys.setrecursionlimit(10 ** 8)
    async def c(f): await f(f)
    return outcome(lambda: c(c).send(None))

@case("end of the stack with finally blocks that resume generators")
def _():
    sys.setrecursionlimit(10 ** 8)
    log = []
    def h():
        while True: yield 1
    x = h()
    def g(f):
        try:
            yield from f(f)
        finally:
            log.append(outcome(lambda: next(x))[:6])
    r = outcome(lambda: next(g(g)))
    return r, len(log) > 0, set(log)

@case("end of the stack, collection while unwinding")
def _():
    sys.setrecursionlimit(10 ** 8)
    def g(f):
        junk = [[] for _ in range(20)]
        try:
            yield from f(f)
        finally:
            junk.append([bytearray(1000) for _ in range(10)])
    return outcome(lambda: next(g(g)))

@case("long chain suspended, then dropped")
def _():
    sys.setrecursionlimit(10 ** 6)
    def g(n):
        try:
            if n: yield from g(n - 1)
            else: yield 0
        finally:
            pass
    x = g(20000); r = outcome(lambda: next(x))
    del x
    collect()
    return r

@case("long chain suspended, then closed, thrown into")
def _():
    sys.setrecursionlimit(10 ** 6)
    def g(n):
        if n: yield from g(n - 1)
        else:
            while True:
                try: yield 0
                except ValueError: pass
    x = g(20000); r = outcome(lambda: next(x))
    return r, outcome(lambda: x.throw(ValueError)), outcome(x.close)

@case("many locals")
def _():
    n = 20000
    src = "def g():\n" + "".join("    v%d = %d\n" % (i, i) for i in range(n)) + "    yield v0\n    yield " + "+".join("v%d" % i for i in range(0, n, 100)) + "\n"
    ns = {}; exec(src, ns)
    x = ns["g"](); a = next(x); collect()
    return a, len(x.gi_frame.f_locals), next(x)

@case("many temporaries across a yield")
def _():
    n = 5000
    src = "def g():\n    return [" + ",".join("(yield %d)" % i for i in range(n)) + "]\n"
    ns = {}; exec(src, ns)
    x = ns["g"](); total = 0
    try:
        v = next(x)
        while True:
            total += 1
            if total % 1000 == 0: collect()
            v = x.send(v)
    except StopIteration as e:
        return total, len(e.value), e.value[-1]

@case("yield deep inside finally, with, except*")
def _():
    depth = 18
    src = "def g(cm):\n"
    ind = "    "
    for i in range(depth):
        kind = i % 3
        if kind == 0: src += ind + "try:\n" + ind + "    yield %d\n" % i + ind + "finally:\n"
        elif kind == 1: src += ind + "with cm():\n"
        else: src += ind + "try:\n" + ind + "    raise ExceptionGroup('g', [ValueError(%d)])\n" % i + ind + "except* ValueError:\n"
        ind += "    "
    src += ind + "yield 'bottom'\n"
    ns = {}; exec(src, ns)
    @contextlib.contextmanager
    def cm(): yield
    rs = []
    for stop in range(0, 9):
        x = ns["g"](cm); got = list(itertools.islice(x, stop))
        rs.append((len(got), outcome(lambda: x.throw(KeyError("k")))[:12], outcome(x.close)[:8]))
        del x; collect()
    return rs

# ---- Copies ----

for name, f in (("copy", copy.copy), ("deepcopy", copy.deepcopy), ("pickle", pickle.dumps), ("reduce", lambda x: x.__reduce_ex__(4)), ("weakref", lambda x: weakref.ref(x)() is x), ("hash", lambda x: hash(x) == hash(x)), ("sizeof", lambda x: sys.getsizeof(x) > 0), ("dir", lambda x: len(dir(x)) > 5)):
    @case("generator " + name)
    def _(f=f):
        async def c(): pass
        async def ag(): yield
        co = c(); r = outcome(lambda: f(suspended()))[:60], outcome(lambda: f(co))[:60], outcome(lambda: f(ag()))[:60], outcome(lambda: f(suspended().gi_frame))[:60]
        co.close()
        return r

@case("type(generator) called and subclassed")
def _():
    G = types.GeneratorType
    return outcome(G), outcome(lambda: G.__new__(G)), outcome(lambda: object.__new__(G)), outcome(lambda: type("S", (G,), {})), outcome(lambda: types.CoroutineType.__new__(types.CoroutineType)), outcome(lambda: types.FrameType.__new__(types.FrameType))

@case("__class__ of a generator")
def _():
    x = suspended()
    def set(t): x.__class__ = t
    return outcome(lambda: set(types.CoroutineType)), outcome(lambda: set(object)), outcome(lambda: set(types.AsyncGeneratorType)), next(x)

@case("names and code of a generator")
def _():
    x = suspended()
    def set(n, v): setattr(x, n, v)
    return [outcome(lambda n=n, v=v: set(n, v))[:40] for n in ("__name__", "__qualname__", "gi_code", "gi_frame", "gi_running", "gi_yieldfrom") for v in (1, "s", None)] + [outcome(lambda n=n: delattr(x, n))[:40] for n in ("__name__", "__qualname__")]

@case("function's code replaced while its generator is suspended")
def _():
    def g():
        a = 1
        yield a
        yield a + 1
    def h():
        yield "h"
    x = g(); next(x)
    g.__code__ = h.__code__
    return next(x), list(g()), x.gi_code.co_name

# ---- Threads ----

def in_thread(f, *args):
    box = []
    t = threading.Thread(target=lambda: box.append(outcome(lambda: f(*args))))
    t.start(); t.join()
    return box[0]

@case("resumed alternately by two threads")
def _():
    def g():
        n = 0
        while True:
            n += 1
            yield n, threading.get_ident() != main
    main = threading.get_ident()
    x = g()
    return [next(x)[0], in_thread(next, x)[:12], next(x)[0], in_thread(next, x)[:12]]

@case("used by another thread while it runs")
def _():
    started = threading.Event(); go = threading.Event()
    def g():
        started.set(); go.wait(10)
        yield 1
        yield 2
    x = g(); box = []
    t = threading.Thread(target=lambda: box.append(outcome(lambda: next(x))))
    t.start(); started.wait(10)
    f = x.gi_frame
    r = [outcome(lambda: next(x))[:40], outcome(lambda: x.throw(ValueError))[:40], outcome(x.close)[:40], x.gi_running, outcome(lambda: sorted(f.f_locals))[:40], outcome(lambda: f.f_lineno > 0), outcome(lambda: f.f_back.f_code.co_name)[:30], outcome(f.clear)[:40],
         outcome(lambda: f.f_locals.update(z=1))[:30]]
    collect()
    go.set(); t.join()
    return r, box, next(x)

@case("many threads fight over one generator")
def _():
    def g():
        n = 0
        while True:
            n += 1
            yield n
    x = g(); counts = collections.Counter()
    old = sys.getswitchinterval(); sys.setswitchinterval(1e-6)
    def work():
        for _ in range(3000):
            try: next(x); counts["ok"] += 1
            except ValueError: counts["busy"] += 1
    ts = [threading.Thread(target=work) for _ in range(6)]
    for t in ts: t.start()
    for t in ts: t.join()
    sys.setswitchinterval(old)
    return counts["ok"] + counts["busy"], next(x) == counts["ok"] + 1

@case("threads make and drop generators while others collect")
def _():
    stop = []
    def g():
        try:
            yield 1
        finally:
            pass
    def maker():
        while not stop:
            xs = [g() for _ in range(50)]
            for x in xs: next(x)
    def collector():
        while not stop: gc.collect()
    old = sys.getswitchinterval(); sys.setswitchinterval(1e-5)
    ts = [threading.Thread(target=maker) for _ in range(3)] + [threading.Thread(target=collector) for _ in range(2)]
    for t in ts: t.start()
    time.sleep(1.5); stop.append(1)
    for t in ts: t.join()
    sys.setswitchinterval(old)
    return "done"

@case("thread ends inside a generator that another thread holds")
def _():
    def g():
        try:
            yield 1
            raise SystemExit
        finally:
            pass
    x = g(); next(x)
    r = in_thread(next, x)
    collect()
    return r[:20], outcome(lambda: next(x)), x.gi_frame

@case("_current_frames and _current_exceptions with generators running in threads")
def _():
    started = threading.Barrier(4); go = threading.Event()
    def inner():
        try: raise ValueError("handled")
        except ValueError:
            started.wait(10); go.wait(10)
            yield 1
    def outer(): yield from inner()
    ts = [threading.Thread(target=lambda: list(outer())) for _ in range(3)]
    for t in ts: t.start()
    started.wait(10)
    collect()
    frames = sys._current_frames(); excs = sys._current_exceptions()
    r = sorted(f.f_code.co_name for f in frames.values())[:6], sorted(type(e).__name__ for e in excs.values())
    go.set()
    for t in ts: t.join()
    collect()
    return r, sorted(outcome(lambda f=f: f.f_lineno > 0) for f in frames.values())

@case("fork while generators run in other threads")
def _():
    import os
    started = threading.Event(); go = threading.Event()
    def g():
        try: raise KeyError
        except KeyError:
            started.set(); go.wait(10)
            yield 1
    t = threading.Thread(target=lambda: list(g())); t.start(); started.wait(10)
    r, w = os.pipe()
    import warnings; warnings.simplefilter("ignore")
    pid = os.fork()
    if not pid:
        try:
            junk = [[i] for i in range(100000)]; collect()
            text = repr((len(sys._current_frames()), len(sys._current_exceptions()), threading.active_count()))
            junk = [bytearray(100) for i in range(100000)]; collect()
            os.write(w, text.encode())
        finally:
            os._exit(0)
    os.close(w); text = os.read(r, 1000); status = os.waitpid(pid, 0)[1]
    go.set(); t.join()
    return text, status

# ---- Coroutines and asynchronous generators ----

@case("coroutine awaited twice, closed twice, thrown into when done")
def _():
    async def c(): return 1
    x = c()
    return outcome(lambda: x.send(None)), outcome(lambda: x.send(None)), outcome(x.close), outcome(x.close), outcome(lambda: x.throw(ValueError)), x.cr_frame, x.cr_await

@case("coroutine wrapper after the coroutine is gone")
def _():
    async def c(): await asyncio.sleep(0)
    w = c().__await__()
    collect()
    return outcome(lambda: next(w))[:30], outcome(lambda: w.send(None))[:30], outcome(lambda: w.throw(ValueError))[:30], outcome(w.close)

@case("asend, athrow, aclose objects used out of order")
def _():
    async def ag():
        try:
            yield 1
            yield 2
        finally:
            await asyncio.sleep(0)
    rs = []
    for order in itertools.permutations(range(3)):
        x = ag(); objs = [x.asend(None), x.athrow(ValueError), x.aclose()]
        for i in order:
            for m in ("send", "throw", "close", "send"):
                rs.append(outcome(lambda: getattr(objs[i], m)(*((None,) if m == "send" else (KeyError,) if m == "throw" else ())))[:10])
        del x, objs; collect()
    return len(rs)

@case("asynchronous generator hooks that misbehave")
def _():
    async def ag():
        try: yield 1
        finally: pass
    rs = []
    for first, final in ((lambda g: 1 / 0, None), (None, lambda g: 1 / 0), (lambda g: g.aclose().send(None), lambda g: g.asend(None).send(None)), (lambda g: sys.set_asyncgen_hooks(None, None), lambda g: keep.append(g))):
        keep = []
        sys.set_asyncgen_hooks(firstiter=first, finalizer=final)
        try:
            x = ag(); rs.append(outcome(lambda: x.asend(None).send(None))[:30])
            del x; collect()
        finally:
            sys.set_asyncgen_hooks(None, None)
    return rs

@case("coroutine origin tracking at depth")
def _():
    sys.set_coroutine_origin_tracking_depth(10 ** 6)
    async def c(): pass
    def deep(n): return deep(n - 1) if n else c()
    x = deep(500); n = len(x.cr_origin); x.close()
    sys.set_coroutine_origin_tracking_depth(0)
    return n > 400

@case("types.coroutine around odd things")
def _():
    rs = []
    for thing in (lambda: 1, lambda: iter([1]), lambda: suspended(), len, int, type, lambda: (yield)):
        rs.append(outcome(lambda: types.coroutine(thing))[:20])
        async def c(): return await types.coroutine(thing)()
        x = c(); rs.append(outcome(lambda: x.send(None))[:40]); x.close()
    return rs

@case("StopIteration in odd places")
def _():
    def g1(): raise StopIteration(1); yield
    def g2(): yield from iter_raising()
    class iter_raising:
        def __iter__(self): return self
        def __next__(self): raise StopIteration(self)
    async def c(): raise StopIteration
    async def ag(): raise StopAsyncIteration; yield
    x = c()
    return outcome(lambda: next(g1())), outcome(lambda: next(g2()))[:30], outcome(lambda: x.send(None)), outcome(lambda: ag().asend(None).send(None)), outcome(lambda: suspended().throw(StopIteration)), outcome(lambda: suspended().throw(StopIteration(1), None, None))[:40]

@case("throw with odd arguments")
def _():
    class Meta(type):
        def __call__(cls, *a): return 42
    class E(Exception, metaclass=Meta): pass
    class F(Exception):
        def __init__(self): raise KeyError("init")
    rs = []
    for args in ((1,), (None,), (E,), (F,), (ValueError, 1, 2), (ValueError(), ValueError()), (ValueError, None, sys._getframe()), (BaseException,), (GeneratorExit,), (type,), (ValueError, ValueError(1), None), ((ValueError,),)):
        rs.append(outcome(lambda: suspended().throw(*args))[:30])
    return rs

@case("delegate whose methods misbehave")
def _():
    rs = []
    class It:
        def __iter__(self): return self
        def __next__(self): return 1
    for name, value in (("close", 1), ("throw", 1), ("send", 1), ("close", lambda: 1 / 0), ("throw", lambda *a: 1 / 0), ("close", property(lambda s: 1 / 0)), ("throw", property(lambda s: 1 / 0))):
        T = type("T", (It,), {name: value if isinstance(value, property) or not callable(value) else staticmethod(value)})
        def g(): yield from T()
        x = g(); next(x)
        rs.append((outcome(lambda: x.send(5))[:20], outcome(lambda: x.throw(KeyError))[:20], outcome(x.close)[:20]))
    return rs

@case("delegate that resumes, closes or drops its waiter")
def _():
    rs = []
    for action in (lambda x: next(x), lambda x: x.close(), lambda x: x.throw(KeyError), lambda x: x.gi_frame.clear(), lambda x: x.gi_yieldfrom, lambda x: x.gi_frame.f_locals.clear()):
        class It:
            def __iter__(self): return self
            def __next__(self): return outcome(lambda: action(box[0]))[:40]
        def g(): yield from It()
        box = [g()]
        rs.append(next(box[0]))
    return rs

if GROUP == "--list":
    for name, f in CASES: print(name)
else:
    for name, f in CASES:
        if GROUP is None or GROUP == name:
            print(name, "->", outcome(f), flush=True)
