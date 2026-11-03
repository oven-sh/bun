import weakref, gc
def t1():
    class C:
        def m(self): pass
    o = C()
    r = weakref.ref(C.m)
    del C.m
    gc.collect()
    return r() is None
def t2():
    class C:
        def m(self): pass
    o = C()
    b = o.m
    r = weakref.ref(b.__func__)
    del b
    del C.m
    gc.collect()
    return r() is None
def t3():
    class C:
        def m(self): pass
    o = C()
    o.m()
    r = weakref.ref(C.__dict__['m'])
    del C.m
    gc.collect()
    return r() is None
def t4():
    class C:
        def m(self): pass
    o = C()
    r = weakref.WeakMethod(o.m)
    del C.m
    gc.collect()
    return r() is None
def t5():
    class C:
        x = type("V", (), {})()
    o = C()
    o.x
    r = weakref.ref(C.x)
    del C.x
    gc.collect()
    return r() is None
print(t1(), t2(), t3(), t4(), t5())
class V: pass
def d1():
    v = V(); d = {'m': v}; r = weakref.ref(v); del v
    del d['m']; gc.collect(); return r() is None
def d2():
    class C: pass
    C.m = V(); r = weakref.ref(C.__dict__['m'])
    del C.m; gc.collect(); return r() is None
def d3():
    class C: pass
    C.m = V(); r = weakref.ref(C.m)
    del C.m; gc.collect(); return r() is None
def d4():
    class C: pass
    C.m = V(); r = weakref.ref(C.m)
    C.m = 1; gc.collect(); return r() is None
def d5():
    class C:
        m = V()
    r = weakref.ref(C.__dict__['m'])
    del C.m; gc.collect(); return r() is None
def d6():
    ns = {'m': V()}
    C = type('C', (), ns)
    r = weakref.ref(ns['m'])
    del ns, C.m; gc.collect(); return r() is None
print(d1(), d2(), d3(), d4(), d5(), d6())
