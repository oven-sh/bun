# objects with more slots than fit anywhere by default, with and without a __dict__, through collections and class changes
try: import gc, weakref, copy, pickle
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc, weakref, copy, pickle')
try:
    def make(n, **extra):
        return type("S%d" % n, (), {"__slots__": tuple("a%d" % i for i in range(n)), **extra})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make(n, **extra):')
try:
    for n in (0, 1, 5, 6, 7, 8, 9, 20, 59, 60, 61, 62, 63, 64, 65, 100, 300):
        try: C = make(n)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C = make(n)')
        try: objects = []
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: objects = []')
        for k in range(50):
            try: o = C()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = C()')
            for i in range(n): setattr(o, "a%d" % i, (k, i))
            try: objects.append(o)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: objects.append(o)')
        try: gc.collect()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
        try: assert all(getattr(o, "a%d" % i) == (k, i) for k, o in enumerate(objects) for i in range(n))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert all(getattr(o, "a%d" % i) == (k, i) for k, o in enumerate(obje...')
        class D(C): pass                                # has a __dict__ too
        try: d = D()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = D()')
        for i in range(n): setattr(d, "a%d" % i, i)
        for i in range(12): setattr(d, "b%d" % i, -i)
        try: gc.collect()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
        try: assert [getattr(d, "a%d" % i) for i in range(n)] == list(range(n)) and sorted(d.__dict__) == sorted("b%d" % i for i in range(12))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert [getattr(d, "a%d" % i) for i in range(n)] == list(range(n)) an...')
        class E(C): __slots__ = ("x", "y", "__weakref__")
        try: e = E()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = E()')
        try: e.x = 1
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.x = 1')
        try: e.y = 2
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.y = 2')
        for i in range(n): setattr(e, "a%d" % i, str(i))
        try: r = weakref.ref(e)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = weakref.ref(e)')
        try: gc.collect()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
        try: assert r() is e and (e.x, e.y) == (1, 2) and all(getattr(e, "a%d" % i) == str(i) for i in range(n))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert r() is e and (e.x, e.y) == (1, 2) and all(getattr(e, "a%d" % i...')
        for i in range(0, n, 2): delattr(e, "a%d" % i)
        try: assert [hasattr(e, "a%d" % i) for i in range(n)] == [bool(i % 2) for i in range(n)]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert [hasattr(e, "a%d" % i) for i in range(n)] == [bool(i % 2) for ...')
        class F(C): __slots__ = ("x", "y", "__weakref__")
        try: e.__class__ = F
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.__class__ = F')
        try: assert type(e) is F and e.x == 1 and all(getattr(e, "a%d" % i) == str(i) for i in range(1, n, 2))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert type(e) is F and e.x == 1 and all(getattr(e, "a%d" % i) == str...')
        try: c = copy.copy(e)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = copy.copy(e)')
        try: assert type(c) is F and c.y == 2 and all(getattr(c, "a%d" % i) == str(i) for i in range(1, n, 2))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert type(c) is F and c.y == 2 and all(getattr(c, "a%d" % i) == str...')
        try: print('n [' + 'n=' + (repr(n) if type(n) in (str, int, float, bytes, bool, type(None)) or (type(n) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in n)) else n.__name__ if type(n) is type else type(n).__name__) + '] =>', n)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n')
        try: print("ok")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "ok"')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for n in (0, 1, 5, 6, 7, 8, 9, 20, 59, 60, 61, 62, 63, 64, 65, 100, 3...')
try:
    class Handle:
        __slots__ = ("_callback", "_args", "_cancelled", "_loop", "_source_traceback", "_repr", "__weakref__", "_context")
        def __init__(self, a, b):
            self._context = a; self._loop = b; self._callback = a; self._args = b; self._cancelled = False; self._repr = None; self._source_traceback = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Handle:')
try:
    class Timer(Handle):
        __slots__ = ["_scheduled", "_when"]
        def __init__(self, a, b):
            super().__init__(a, b); self._when = a; self._scheduled = False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Timer(Handle):')
try: hs = [Timer(i, str(i)) for i in range(2000)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hs = [Timer(i, str(i)) for i in range(2000)]')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print('sum(h._when for h in hs) =>', sum(h._when for h in hs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(h._when for h in hs)')
try: print('hs[7]._args =>', hs[7]._args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hs[7]._args')
try: print('hs[1999]._source_traceback =>', hs[1999]._source_traceback)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hs[1999]._source_traceback')
try: print('hs[5]._scheduled =>', hs[5]._scheduled)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hs[5]._scheduled')
