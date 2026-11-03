# How `with` finds and calls __enter__ and __exit__: in the class alone, whatever kind of thing they are there.
try: import functools, threading, io, asyncio, contextlib, types, sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import functools, threading, io, asyncio, contextlib, types, sys')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
    def attempt(f, *a):
        try: return f(*a)
        except BaseException as e: return type(e).__name__ + ": " + str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def attempt(f, *a):')
try:
    class Plain:
        def __init__(self, name="plain", swallow=False): self.name = name; self.swallow = swallow
        def __enter__(self): log.append(("enter", self.name)); return self.name
        def __exit__(self, t, v, tb): log.append(("exit", self.name, t and t.__name__, str(v) if v else v, tb is not None)); return self.swallow
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Plain:')
try:
    def use(manager, body=lambda v: v):
        with manager as v:
            return body(v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def use(manager, body=lambda v: v):')
try:
    def show(*a):
        print(*a, log); log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(*a):')
try: show(use(Plain()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(Plain()))')
try: show(attempt(use, Plain(), lambda v: 1 / 0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(attempt(use, Plain(), lambda v: 1 / 0))')
try: show(attempt(use, Plain("quiet", True), lambda v: 1 / 0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(attempt(use, Plain("quiet", True), lambda v: 1 / 0))')

# what the instance has does not count
try: p = Plain("instance")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = Plain("instance")')
try: p.__enter__ = lambda: "from the instance"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__enter__ = lambda: "from the instance"')
try: p.__exit__ = lambda *a: log.append("from the instance")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__exit__ = lambda *a: log.append("from the instance")')
try: show(use(p))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(p))')

# the same place in the code sees many classes, and classes that change
try:
    class Other(Plain):
        def __enter__(self): log.append("other enter"); return "other"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Other(Plain):')
try:
    class Slots:
        __slots__ = ("x",)
        def __enter__(self): return "slots"
        def __exit__(self, *a): log.append(("slots exit", len(a)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Slots:')
try:
    for m in (Plain("a"), Other("b"), Slots(), Plain("c"), Other("d")):
        try: show(use(m))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(m))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for m in (Plain("a"), Other("b"), Slots(), Plain("c"), Other("d")):')
try: originals = Plain.__enter__, Plain.__exit__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: originals = Plain.__enter__, Plain.__exit__')
try:
    for i in range(6):
        if i == 2: Plain.__enter__ = lambda self: "replaced"
        if i == 4: Plain.__exit__ = lambda self, *a: log.append("replaced exit")
        try: show(i, use(Plain("loop")), use(Other("loop")))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(i, use(Plain("loop")), use(Other("loop")))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(6):')
try: Plain.__enter__, Plain.__exit__ = originals
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Plain.__enter__, Plain.__exit__ = originals')

# things that are not functions
try:
    class Callable:
        def __init__(self, name): self.name = name
        def __call__(self, *a): log.append((self.name, len(a))); return self.name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Callable:')
try:
    class Descriptor:
        def __init__(self, name): self.name = name
        def __get__(self, obj, cls): log.append(("get", self.name, type(obj).__name__, cls.__name__)); return lambda *a: (log.append((self.name, len(a))), self.name)[1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Descriptor:')
try:
    def free(*a): log.append(("free", len(a))); return "free"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def free(*a): log.append(("free", len(a))); return "free"')
try:
    class Odd:
        __enter__ = Callable("callable enter"); __exit__ = Callable("callable exit")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Odd:')
try: show(use(Odd()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(Odd()))')
try:
    class Odd:
        __enter__ = Descriptor("descriptor enter"); __exit__ = Descriptor("descriptor exit")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Odd:')
try: show(use(Odd()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(Odd()))')
try:
    class Odd:
        __enter__ = staticmethod(free); __exit__ = staticmethod(free)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Odd:')
try: show(use(Odd()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(Odd()))')
try:
    class Odd:
        __enter__ = classmethod(free); __exit__ = classmethod(free)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Odd:')
try: show(use(Odd()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(Odd()))')
try:
    class Odd:
        __enter__ = functools.partial(free, 1, 2); __exit__ = functools.partial(free, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Odd:')
try: show(use(Odd()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(Odd()))')
try:
    class Odd:
        __enter__ = Plain("bound").__enter__; __exit__ = Plain("bound").__exit__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Odd:')
try: show(use(Odd()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(Odd()))')
try:
    class Odd:
        __enter__ = len; __exit__ = print
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Odd:')
try: show(attempt(use, Odd()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(attempt(use, Odd()))')
try:
    class Odd:
        __enter__ = functools.partialmethod(free, "x"); __exit__ = functools.partialmethod(free)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Odd:')
try: show(use(Odd()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(Odd()))')
try:
    class Odd:
        __enter__ = str.upper; __exit__ = free
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Odd:')
try: show(attempt(use, Odd()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(attempt(use, Odd()))')

# missing, or None
try:
    class NoExit:
        def __enter__(self): log.append("entered")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoExit:')
try:
    class NoEnter:
        def __exit__(self, *a): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoEnter:')
try:
    class NoneEnter:
        __enter__ = None
        def __exit__(self, *a): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoneEnter:')
try:
    class NoneExit:
        def __enter__(self): log.append("entered")
        __exit__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoneExit:')
try:
    class OnlyAsync:
        async def __aenter__(self): pass
        async def __aexit__(self, *a): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OnlyAsync:')
try:
    for cls in (NoExit, NoEnter, NoneEnter, NoneExit, OnlyAsync, object, int):
        try: show(cls.__name__, attempt(use, cls()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(cls.__name__, attempt(use, cls()))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for cls in (NoExit, NoEnter, NoneEnter, NoneExit, OnlyAsync, object, ...')
try:
    class Raises:
        @property
        def __enter__(self): raise KeyError("no enter today")
        def __exit__(self, *a): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Raises:')
try: show(attempt(use, Raises()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(attempt(use, Raises()))')
try:
    class GetAttr:
        def __getattr__(self, name): log.append(name); return lambda *a: None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class GetAttr:')
try: show(attempt(use, GetAttr()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(attempt(use, GetAttr()))')

# a class as a manager, through its metaclass
try:
    class Meta(type):
        def __enter__(cls): return "meta " + cls.__name__
        def __exit__(cls, *a): log.append(("meta exit", cls.__name__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta(type):')
try:
    class WithMeta(metaclass=Meta):
        def __enter__(self): return "not this one"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithMeta(metaclass=Meta):')
try: show(use(WithMeta))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(WithMeta))')

# managers written in C
try: lock = threading.Lock()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lock = threading.Lock()')
try: show(use(lock, lambda v: (v, lock.locked())), lock.locked())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(lock, lambda v: (v, lock.locked())), lock.locked())')
try: rlock = threading.RLock()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rlock = threading.RLock()')
try: show(use(rlock, lambda v: v))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(rlock, lambda v: v))')
try: f = io.StringIO("text")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f = io.StringIO("text")')
try: show(use(f, lambda v: v is f), f.closed)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(f, lambda v: v is f), f.closed)')
try: m = memoryview(b"abc")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m = memoryview(b"abc")')
try: show(use(m, lambda v: v is m), attempt(lambda: m[0]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(m, lambda v: v is m), attempt(lambda: m[0]))')
try: show(use(contextlib.nullcontext(5)), use(contextlib.suppress(ZeroDivisionError), lambda v: 1 / 0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(use(contextlib.nullcontext(5)), use(contextlib.suppress(ZeroDivi...')
try: show(attempt(use, contextlib.ExitStack(), lambda s: s.callback(log.append, "callback") and None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(attempt(use, contextlib.ExitStack(), lambda s: s.callback(log.ap...')
try:
    class MyLock(type(threading.RLock())): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MyLock(type(threading.RLock())): pass')
try: show(attempt(lambda: use(MyLock(), lambda v: v)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(attempt(lambda: use(MyLock(), lambda v: v)))')

# leaving by return, break, continue; nesting; several items
try:
    def leaves():
        for i in range(3):
            with Plain("outer%d" % i), Plain("inner%d" % i) as v:
                if i == 0: continue
                if i == 1:
                    with Plain("deep"):
                        break
        with Plain("last"):
            return "returned"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def leaves():')
try: show(leaves())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(leaves())')
try:
    def exit_raises():
        class Bad(Plain):
            def __exit__(self, *a): raise KeyError("from exit")
        with Plain("outer", True):
            with Bad("bad"):
                raise ValueError("body")
        return "went on"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def exit_raises():')
try: show(exit_raises())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(exit_raises())')
try:
    def exit_result(result):
        class R(Plain):
            def __exit__(self, *a): return result
        with R():
            raise ValueError("body")
        return "swallowed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def exit_result(result):')
try:
    class Falsy:
        def __bool__(self): log.append("asked"); return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Falsy:')
try:
    for r in (0, 1, "", "x", None, [], [0], Falsy()):
        try: show(repr(r)[:12], attempt(exit_result, r))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(repr(r)[:12], attempt(exit_result, r))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for r in (0, 1, "", "x", None, [], [0], Falsy()):')

# in generators: what a `with` holds outlives a yield
try:
    def gen():
        with Plain("in generator") as v:
            yield v
            yield "again"
        yield "after"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen():')
try: show(list(gen()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(list(gen()))')
try: g = gen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = gen()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: g.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: show("closed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("closed")')
try: g = gen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = gen()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: show(attempt(g.throw, ValueError("thrown")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(attempt(g.throw, ValueError("thrown")))')

# async with
try:
    class Async:
        def __init__(self, name, swallow=False): self.name = name; self.swallow = swallow
        async def __aenter__(self): log.append(("aenter", self.name)); await asyncio.sleep(0); return self.name
        async def __aexit__(self, t, v, tb): log.append(("aexit", self.name, t and t.__name__)); await asyncio.sleep(0); return self.swallow
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Async:')
try:
    class NotAwaitable:
        def __aenter__(self): return 5
        def __aexit__(self, *a): return 6
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NotAwaitable:')
try:
    class ExitNotAwaitable:
        async def __aenter__(self): return 5
        def __aexit__(self, *a): return 6
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ExitNotAwaitable:')
try:
    async def ause(manager, body=lambda v: v):
        async with manager as v:
            return body(v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def ause(manager, body=lambda v: v):')
try:
    def arun(*a): return attempt(lambda: asyncio.run(ause(*a)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def arun(*a): return attempt(lambda: asyncio.run(ause(*a)))')
try: show(arun(Async("a")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(arun(Async("a")))')
try: show(arun(Async("b"), lambda v: 1 / 0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(arun(Async("b"), lambda v: 1 / 0))')
try: show(arun(Async("c", True), lambda v: 1 / 0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(arun(Async("c", True), lambda v: 1 / 0))')
try: show(arun(NotAwaitable()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(arun(NotAwaitable()))')
try: show(arun(ExitNotAwaitable()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(arun(ExitNotAwaitable()))')
try: show(arun(Plain()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(arun(Plain()))')
try: show(arun(object()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(arun(object()))')
try: a = Async("instance")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = Async("instance")')
try: a.__aenter__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__aenter__ = None')
try: show(arun(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(arun(a))')
try:
    async def amany():
        for i in range(3):
            async with Async("x%d" % i), Async("y%d" % i):
                if i == 1: continue
                if i == 2: break
        async with Async("z"):
            return "returned"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def amany():')
try: show(asyncio.run(amany()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(asyncio.run(amany()))')
