# After test_gc in Lib/test/test_memoryview.py. What a program has dropped is gone when gc.collect() returns, however often
# the code has run: from the third time on a call is made without the help of C++, which used to wipe the stack in passing.
import gc, weakref
class MyObject: pass
def test(tp, variant):
    if 'v' in variant:
        class MyView():
            def __init__(self, base):
                self.m = memoryview(base) if 'n' not in variant else base
    r = []
    if 'a' in variant:
        class MySource(tp): pass
        b = MySource(tp(b'abc'))
        m = (memoryview(b)[1:2] if 's' in variant else memoryview(b)) if 'n' not in variant else [b]
        o = MyObject()
        b.m = m; b.o = o
        wr = weakref.ref(o)
        b = m = o = None
        gc.collect()
        r.append(wr() is None)
    if 'v' in variant:
        m = MyView(tp(b'abc'))
        o = MyObject()
        m.x = m
        m.o = o
        wr = weakref.ref(o)
        m = o = None
        gc.collect()
        r.append(wr() is None)
    return r
for variant in ('a', 'v', 'av', 'as', 'avs', 'an', 'vn', 'avn'):
    for tp in (bytes, bytearray):
        print(variant, tp.__name__, [test(tp, variant) for i in range(5)])
def plain():
    o = MyObject(); l = [o]; l.append(l); wr = weakref.ref(o)
    del o, l
    gc.collect()
    return wr() is None
print([plain() for i in range(6)])
log = []
class D:
    def __init__(self, n): self.n = n; self.me = self
    def __del__(self): log.append(self.n)
def finalized(n):
    D(n)
    gc.collect()
    return list(log)
print([finalized(i) for i in range(5)])
import functools
print(functools.partial(gc.collect)() is not None, [f() is not None for f in [gc.collect] * 2], list(map(lambda f: f() is not None, [gc.collect])))
