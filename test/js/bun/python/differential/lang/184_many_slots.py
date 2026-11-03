# objects with more slots than fit anywhere by default, with and without a __dict__, through collections and class changes
import gc, weakref, copy, pickle
def make(n, **extra):
    return type("S%d" % n, (), {"__slots__": tuple("a%d" % i for i in range(n)), **extra})
for n in (0, 1, 5, 6, 7, 8, 9, 20, 59, 60, 61, 62, 63, 64, 65, 100, 300):
    C = make(n)
    objects = []
    for k in range(50):
        o = C()
        for i in range(n): setattr(o, "a%d" % i, (k, i))
        objects.append(o)
    gc.collect()
    assert all(getattr(o, "a%d" % i) == (k, i) for k, o in enumerate(objects) for i in range(n))
    class D(C): pass                                # has a __dict__ too
    d = D()
    for i in range(n): setattr(d, "a%d" % i, i)
    for i in range(12): setattr(d, "b%d" % i, -i)
    gc.collect()
    assert [getattr(d, "a%d" % i) for i in range(n)] == list(range(n)) and sorted(d.__dict__) == sorted("b%d" % i for i in range(12))
    class E(C): __slots__ = ("x", "y", "__weakref__")
    e = E(); e.x = 1; e.y = 2
    for i in range(n): setattr(e, "a%d" % i, str(i))
    r = weakref.ref(e); gc.collect()
    assert r() is e and (e.x, e.y) == (1, 2) and all(getattr(e, "a%d" % i) == str(i) for i in range(n))
    for i in range(0, n, 2): delattr(e, "a%d" % i)
    assert [hasattr(e, "a%d" % i) for i in range(n)] == [bool(i % 2) for i in range(n)]
    class F(C): __slots__ = ("x", "y", "__weakref__")
    e.__class__ = F
    assert type(e) is F and e.x == 1 and all(getattr(e, "a%d" % i) == str(i) for i in range(1, n, 2))
    c = copy.copy(e); assert type(c) is F and c.y == 2 and all(getattr(c, "a%d" % i) == str(i) for i in range(1, n, 2))
    print(n, "ok")
class Handle:
    __slots__ = ("_callback", "_args", "_cancelled", "_loop", "_source_traceback", "_repr", "__weakref__", "_context")
    def __init__(self, a, b):
        self._context = a; self._loop = b; self._callback = a; self._args = b; self._cancelled = False; self._repr = None; self._source_traceback = None
class Timer(Handle):
    __slots__ = ["_scheduled", "_when"]
    def __init__(self, a, b):
        super().__init__(a, b); self._when = a; self._scheduled = False
hs = [Timer(i, str(i)) for i in range(2000)]; gc.collect()
print(sum(h._when for h in hs), hs[7]._args, hs[1999]._source_traceback, hs[5]._scheduled)
