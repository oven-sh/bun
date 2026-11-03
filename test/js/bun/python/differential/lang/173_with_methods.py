# How `with` finds and calls __enter__ and __exit__: in the class alone, whatever kind of thing they are there.
import functools, threading, io, asyncio, contextlib, types, sys
log = []
def attempt(f, *a):
    try: return f(*a)
    except BaseException as e: return type(e).__name__ + ": " + str(e)
class Plain:
    def __init__(self, name="plain", swallow=False): self.name = name; self.swallow = swallow
    def __enter__(self): log.append(("enter", self.name)); return self.name
    def __exit__(self, t, v, tb): log.append(("exit", self.name, t and t.__name__, str(v) if v else v, tb is not None)); return self.swallow
def use(manager, body=lambda v: v):
    with manager as v:
        return body(v)
def show(*a):
    print(*a, log); log.clear()
show(use(Plain()))
show(attempt(use, Plain(), lambda v: 1 / 0))
show(attempt(use, Plain("quiet", True), lambda v: 1 / 0))

# what the instance has does not count
p = Plain("instance")
p.__enter__ = lambda: "from the instance"
p.__exit__ = lambda *a: log.append("from the instance")
show(use(p))

# the same place in the code sees many classes, and classes that change
class Other(Plain):
    def __enter__(self): log.append("other enter"); return "other"
class Slots:
    __slots__ = ("x",)
    def __enter__(self): return "slots"
    def __exit__(self, *a): log.append(("slots exit", len(a)))
for m in (Plain("a"), Other("b"), Slots(), Plain("c"), Other("d")):
    show(use(m))
originals = Plain.__enter__, Plain.__exit__
for i in range(6):
    if i == 2: Plain.__enter__ = lambda self: "replaced"
    if i == 4: Plain.__exit__ = lambda self, *a: log.append("replaced exit")
    show(i, use(Plain("loop")), use(Other("loop")))
Plain.__enter__, Plain.__exit__ = originals

# things that are not functions
class Callable:
    def __init__(self, name): self.name = name
    def __call__(self, *a): log.append((self.name, len(a))); return self.name
class Descriptor:
    def __init__(self, name): self.name = name
    def __get__(self, obj, cls): log.append(("get", self.name, type(obj).__name__, cls.__name__)); return lambda *a: (log.append((self.name, len(a))), self.name)[1]
def free(*a): log.append(("free", len(a))); return "free"
class Odd:
    __enter__ = Callable("callable enter"); __exit__ = Callable("callable exit")
show(use(Odd()))
class Odd:
    __enter__ = Descriptor("descriptor enter"); __exit__ = Descriptor("descriptor exit")
show(use(Odd()))
class Odd:
    __enter__ = staticmethod(free); __exit__ = staticmethod(free)
show(use(Odd()))
class Odd:
    __enter__ = classmethod(free); __exit__ = classmethod(free)
show(use(Odd()))
class Odd:
    __enter__ = functools.partial(free, 1, 2); __exit__ = functools.partial(free, 1)
show(use(Odd()))
class Odd:
    __enter__ = Plain("bound").__enter__; __exit__ = Plain("bound").__exit__
show(use(Odd()))
class Odd:
    __enter__ = len; __exit__ = print
show(attempt(use, Odd()))
class Odd:
    __enter__ = functools.partialmethod(free, "x"); __exit__ = functools.partialmethod(free)
show(use(Odd()))
class Odd:
    __enter__ = str.upper; __exit__ = free
show(attempt(use, Odd()))

# missing, or None
class NoExit:
    def __enter__(self): log.append("entered")
class NoEnter:
    def __exit__(self, *a): pass
class NoneEnter:
    __enter__ = None
    def __exit__(self, *a): pass
class NoneExit:
    def __enter__(self): log.append("entered")
    __exit__ = None
class OnlyAsync:
    async def __aenter__(self): pass
    async def __aexit__(self, *a): pass
for cls in (NoExit, NoEnter, NoneEnter, NoneExit, OnlyAsync, object, int):
    show(cls.__name__, attempt(use, cls()))
class Raises:
    @property
    def __enter__(self): raise KeyError("no enter today")
    def __exit__(self, *a): pass
show(attempt(use, Raises()))
class GetAttr:
    def __getattr__(self, name): log.append(name); return lambda *a: None
show(attempt(use, GetAttr()))

# a class as a manager, through its metaclass
class Meta(type):
    def __enter__(cls): return "meta " + cls.__name__
    def __exit__(cls, *a): log.append(("meta exit", cls.__name__))
class WithMeta(metaclass=Meta):
    def __enter__(self): return "not this one"
show(use(WithMeta))

# managers written in C
lock = threading.Lock()
show(use(lock, lambda v: (v, lock.locked())), lock.locked())
rlock = threading.RLock()
show(use(rlock, lambda v: v))
f = io.StringIO("text")
show(use(f, lambda v: v is f), f.closed)
m = memoryview(b"abc")
show(use(m, lambda v: v is m), attempt(lambda: m[0]))
show(use(contextlib.nullcontext(5)), use(contextlib.suppress(ZeroDivisionError), lambda v: 1 / 0))
show(attempt(use, contextlib.ExitStack(), lambda s: s.callback(log.append, "callback") and None))
class MyLock(type(threading.RLock())): pass
show(attempt(lambda: use(MyLock(), lambda v: v)))

# leaving by return, break, continue; nesting; several items
def leaves():
    for i in range(3):
        with Plain("outer%d" % i), Plain("inner%d" % i) as v:
            if i == 0: continue
            if i == 1:
                with Plain("deep"):
                    break
    with Plain("last"):
        return "returned"
show(leaves())
def exit_raises():
    class Bad(Plain):
        def __exit__(self, *a): raise KeyError("from exit")
    with Plain("outer", True):
        with Bad("bad"):
            raise ValueError("body")
    return "went on"
show(exit_raises())
def exit_result(result):
    class R(Plain):
        def __exit__(self, *a): return result
    with R():
        raise ValueError("body")
    return "swallowed"
class Falsy:
    def __bool__(self): log.append("asked"); return False
for r in (0, 1, "", "x", None, [], [0], Falsy()):
    show(repr(r)[:12], attempt(exit_result, r))

# in generators: what a `with` holds outlives a yield
def gen():
    with Plain("in generator") as v:
        yield v
        yield "again"
    yield "after"
show(list(gen()))
g = gen(); next(g); g.close(); show("closed")
g = gen(); next(g); show(attempt(g.throw, ValueError("thrown")))

# async with
class Async:
    def __init__(self, name, swallow=False): self.name = name; self.swallow = swallow
    async def __aenter__(self): log.append(("aenter", self.name)); await asyncio.sleep(0); return self.name
    async def __aexit__(self, t, v, tb): log.append(("aexit", self.name, t and t.__name__)); await asyncio.sleep(0); return self.swallow
class NotAwaitable:
    def __aenter__(self): return 5
    def __aexit__(self, *a): return 6
class ExitNotAwaitable:
    async def __aenter__(self): return 5
    def __aexit__(self, *a): return 6
async def ause(manager, body=lambda v: v):
    async with manager as v:
        return body(v)
def arun(*a): return attempt(lambda: asyncio.run(ause(*a)))
show(arun(Async("a")))
show(arun(Async("b"), lambda v: 1 / 0))
show(arun(Async("c", True), lambda v: 1 / 0))
show(arun(NotAwaitable()))
show(arun(ExitNotAwaitable()))
show(arun(Plain()))
show(arun(object()))
a = Async("instance"); a.__aenter__ = None
show(arun(a))
async def amany():
    for i in range(3):
        async with Async("x%d" % i), Async("y%d" % i):
            if i == 1: continue
            if i == 2: break
    async with Async("z"):
        return "returned"
show(asyncio.run(amany()))
