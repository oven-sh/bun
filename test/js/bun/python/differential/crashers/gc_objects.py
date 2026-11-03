# Whatever gc.get_objects(), get_referrers() and get_referents() hand out must be an object like any other: everything is done to it
# that a program might do to an object it knows nothing about, at moments when the runtime is in the middle of something.
# Prints "done": the point is that the process survives. Usage: gc_objects.py [seed [n]]   (n: look only every n-th time, for slow builds)
import asyncio, collections, functools, gc, io, itertools, json, os, re, sys, tempfile, threading, weakref
for name in ("array", "ast", "bisect", "contextvars", "csv", "datetime", "decimal", "enum", "hashlib", "heapq", "inspect", "logging",
             "operator", "pickle", "queue", "random", "select", "socket", "sqlite3", "ssl", "struct", "subprocess", "time", "tokenize",
             "traceback", "types", "typing", "unicodedata", "warnings", "zlib"):
    try:
        __import__(name)
    except ImportError:
        pass

seed = int(sys.argv[1]) if len(sys.argv) > 1 else 0
every = int(sys.argv[2]) if len(sys.argv) > 2 else 1
asked = 0
count = 0
busy = False


def touch(o):
    t = type(o)
    t.__name__, id(o)
    for f in (hash, len, bool, iter, dir):
        try:
            f(o)
        except Exception:
            pass
    try:
        o == o, o != 1, o in (o,)
    except Exception:
        pass
    try:
        if t in (list, tuple, set, frozenset, collections.deque):
            items = list(o)[:40]
        elif t is dict:
            items = [x for pair in list(o.items())[:20] for x in pair]
        else:
            items = None
        if items is None or len(items) < 8:
            repr(o), str(o)
        if items:
            for x in items:
                type(x).__name__, id(x)
                if type(x) in (int, float, str, bytes, bool, type(None)):
                    repr(x)
    except Exception:
        pass


def look(step=7):
    """Looks at one object in `step`, and at who refers to a few of them and to what they refer."""
    global asked, count, busy
    asked += 1
    if busy or (asked + seed) % every:
        return
    busy = True
    try:
        objects = gc.get_objects()
        for i in range((seed + count) % step, len(objects), step):
            touch(objects[i])
        for i in range((seed + count) % 997, len(objects), 997):
            for other in gc.get_referents(objects[i]):
                touch(other)
        for i in range((seed + count) % 4999, len(objects), 4999):
            for other in gc.get_referrers(objects[i]):
                touch(other)
        count += 1
    finally:
        busy = False


class Looker:
    """Looks whenever the runtime asks it anything."""
    def __init__(self, n=0): self.n = n
    def __hash__(self): look(); return self.n
    def __eq__(self, other): look(); return self is other
    def __lt__(self, other): look(); return self.n < other.n
    def __len__(self): look(); return 1
    def __iter__(self): look(); yield self; look(); yield 2
    def __repr__(self): look(); return "Looker"
    def __index__(self): look(); return 1
    def __del__(self): look()
    def __enter__(self): look(); return self
    def __exit__(self, *a): look()
    def __getattr__(self, name): look(); raise AttributeError(name)
    def __set_name__(self, owner, name): look()
    def __call__(self, *a, **k): look(); return 0


def generator():
    local = [Looker(1)]
    try:
        yield 1
        look()
        yield local
    finally:
        look()


def scenarios():
    yield lambda: tuple(x for x in Looker())
    yield lambda: list(Looker()) + [*Looker()]
    yield lambda: {Looker(1): 1, Looker(1): 2, Looker(2): 3}
    yield lambda: {Looker(1), Looker(1)} | frozenset([Looker(3)])
    yield lambda: sorted([Looker(3), Looker(1), Looker(2)])
    yield lambda: sorted([3, 1, 2], key=Looker())
    yield lambda: dict(zip(Looker(), Looker()))
    yield lambda: "".join(str(x) for x in Looker())
    yield lambda: "%s %r" % (Looker(), Looker()) + f"{Looker()!r}"
    yield lambda: list(map(Looker(), [1, 2])) + list(filter(Looker(), [1, 2]))
    yield lambda: [1, 2, 3][Looker()] + len(Looker())
    yield lambda: collections.deque(Looker(), maxlen=1)
    yield lambda: collections.OrderedDict([(Looker(1), 1), (Looker(2), 2)]).popitem()
    yield lambda: collections.defaultdict(Looker())[1]
    yield lambda: functools.reduce(Looker(), [1, 2, 3])
    yield lambda: functools.partial(Looker(), 1)(2)
    yield lambda: list(itertools.chain(Looker(), Looker())) + list(itertools.product(Looker(), repeat=2))
    yield lambda: json.dumps([1, {"a": [2]}], default=Looker())
    yield lambda: re.sub("a", Looker().__repr__() and (lambda m: (look(), "b")[1]), "aaa")
    yield lambda: type("C", (), {"x": Looker()})
    yield lambda: getattr(Looker(), "missing", None)

    def with_statement():
        with Looker() as a, Looker() as b:
            look()
    yield with_statement

    def generators():
        g = generator(); next(g); look(); h = generator(); next(h); next(h); del h; gc.collect(); g.close()
    yield generators

    def exceptions():
        try:
            try:
                [Looker()][5]
            except IndexError as e:
                look(); raise KeyError(Looker()) from e
        except KeyError as e:
            look(); tb = e.__traceback__; frame = tb.tb_frame; frame.f_locals; look()
        try:
            raise ExceptionGroup("g", [ValueError(1), TypeError(Looker())])
        except* ValueError:
            look()
        except* TypeError:
            look()
    yield exceptions

    def classes():
        class Meta(type):
            @classmethod
            def __prepare__(mcls, name, bases): look(); return {}
            def __new__(mcls, name, bases, ns): look(); return super().__new__(mcls, name, bases, ns)
        class Base(metaclass=Meta):
            def __init_subclass__(cls): look()
        class Derived(Base):
            __slots__ = ("a", "b")
            x = Looker()
        d = Derived(); d.a = d; look()
    yield classes

    def weak():
        class K: pass
        k = K(); r = weakref.ref(k, lambda r: look()); p = weakref.proxy(k); d = weakref.WeakValueDictionary(a=k); f = weakref.finalize(k, look)
        look(); del k; gc.collect(); look()
    yield weak

    def files():
        path = tempfile.mktemp()
        f = open(path, "w"); f.write("x"); look(); del f; look(); open(path).read(); os.remove(path)
        b = io.BytesIO(b"abc"); v = b.getbuffer(); look(); del v; io.StringIO("a\nb").readline(); look()
    yield files

    def threads():
        local = threading.local(); local.x = Looker()
        ts = [threading.Thread(target=look) for _ in range(2)]
        for t in ts: t.start()
        look()
        for t in ts: t.join()
    yield threads

    def tasks():
        async def child(): look(); await asyncio.sleep(0); look(); return 1
        async def main():
            async with asyncio.TaskGroup() as tg:
                tg.create_task(child()); tg.create_task(child()); look()
            try:
                async with asyncio.timeout(-1):
                    await asyncio.sleep(0)
            except TimeoutError as e:
                look()
        asyncio.run(main())
    yield tasks

    def tracing():
        def tracer(frame, event, arg): look(31); return tracer
        def traced():
            for i in range(2):
                try:
                    raise ValueError(i)
                except ValueError:
                    pass
            return [x for x in range(2)]
        sys.settrace(tracer)
        try:
            traced()
        finally:
            sys.settrace(None)
    yield tracing

    def callbacks():
        gc.callbacks.append(lambda phase, info: look(31))
        try:
            l = []; l.append(l); del l; gc.collect()
        finally:
            gc.callbacks.clear()
    yield callbacks


for scenario in scenarios():
    try:
        scenario()
    except Exception as e:
        print("raised", type(e).__name__, file=sys.stderr)
    gc.collect()
print("done", count > 20)
