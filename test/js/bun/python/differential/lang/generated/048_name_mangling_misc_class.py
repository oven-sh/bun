try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    class A:
        __cls = "class private"
        _single = "single"
        __dunder__ = "dunder"
        __ = "two underscores"
        ___ = "three"
        __a_ = "one trailing"
        def __init__(self): self.__inst = "instance private"; self.__dict__["raw"] = 1
        def __method(self): return "private method"
        def get(self): return self.__inst, self.__cls, A.__cls, self.__method(), self.__dunder__, self.__, self.___, self.__a_
        def set(self, v): self.__inst = v
        def delete(self): del self.__inst
        def has(self): return hasattr(self, "__inst"), hasattr(self, "_A__inst"), getattr(self, "_A__inst", None)
        def local(self):
            __loc = 5
            return __loc, sorted(locals())
        def param(self, __p, *, __k=1): return __p, __k
        def glob(self): return __g
        def nested(self):
            def inner(): return self.__inst
            return inner(), (lambda: self.__cls)(), [self.__cls for _ in range(1)]
        def imp(self):
            import sys as __s
            return __s.__name__, sorted(k for k in locals() if "s" in k and k != "self")
        def kwcall(self): return dict(__x=1), (lambda **k: k)(__y=2)
        def other(self, o): return o.__inst
        def string(self): return "__inst", getattr(self, "__inst", "not mangled in strings")
        class __Inner:
            __deep = "deep"
            def get(self): return self.__deep
        def inner(self): return self.__Inner().get(), self.__Inner.__name__, self.__Inner.__qualname__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A:')
try: _A__g = "mangled global"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: _A__g = "mangled global"')
try: a = A()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = A()')
try: print('a.get() =>', a.get())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.get()')
try: print('sorted(k for k in a.__dict__) =>', sorted(k for k in a.__dict__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(k for k in a.__dict__)')
try: print('sorted(k for k in A.__dict__ if "cls" in k or "method" in k or k in (... =>', sorted(k for k in A.__dict__ if "cls" in k or "method" in k or k in ("__", "___") or "a_" in k or "Inner" in k))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(k for k in A.__dict__ if "cls" in k or "method" in k or k in (...')
try: print('a._A__inst =>', a._A__inst)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a._A__inst')
try: print('a._A__cls =>', a._A__cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a._A__cls')
try: print('a._A__method() =>', a._A__method())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a._A__method()')
try: print('a.has() =>', a.has())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.has()')
try: print('a.local() =>', a.local())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.local()')
try: print('a.param(1) =>', a.param(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.param(1)')
try: print('a.param(_A__p=2, _A__k=3) =>', a.param(_A__p=2, _A__k=3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.param(_A__p=2, _A__k=3)')
try: print('a.glob() =>', a.glob())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.glob()')
try: print('a.nested() =>', a.nested())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.nested()')
try: print('a.imp() =>', a.imp())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.imp()')
try: print('a.kwcall() =>', a.kwcall())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.kwcall()')
try: print('a.other(A()) =>', a.other(A()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.other(A())')
try: print('a.string() =>', a.string())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.string()')
try: print('a.inner() =>', a.inner())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.inner()')
try: print('A.param.__code__.co_varnames =>', A.param.__code__.co_varnames)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.param.__code__.co_varnames')
try: print('A._A__method.__name__ =>', A._A__method.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A._A__method.__name__')
try: print('A._A__method.__qualname__ =>', A._A__method.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A._A__method.__qualname__')
try: print('a.__inst =>', end=" "); t(lambda: a.__inst)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a.__inst)')
try: print('a.__cls =>', end=" "); t(lambda: a.__cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a.__cls)')
try: print('A.__cls =>', end=" "); t(lambda: A.__cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A.__cls)')
try: print('a.__method() =>', end=" "); t(lambda: a.__method())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a.__method())')
try: print('a.param(__p=1) =>', end=" "); t(lambda: a.param(__p=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a.param(__p=1))')
try: a.set(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.set(5)')
try: print(a._A__inst)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a._A__inst')
try: a.delete()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.delete()')
try: print(a.has())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.has()')
try: a.__outside = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__outside = 1')
try: print(a.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__')
try:
    class B(A):
        def get_b(self): return self.__inst
        def get_ok(self): return self._A__inst
        __cls = "B's own"
        def both(self): return self.__cls, self._A__cls
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B(A):')
try: b = B()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b = B()')
try: print('b.get_b() =>', end=" "); t(b.get_b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b.get_b)')
try: print('b.get_ok() =>', b.get_ok())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b.get_ok()')
try: print('b.both() =>', b.both())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b.both()')
try: print('b.get()[1] =>', b.get()[1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b.get()[1]')
try:
    class _Lead:
        __x = 1
        def g(self): return self.__x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class _Lead:')
try:
    class __Lead2:
        __x = 2
        def g(self): return self.__x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class __Lead2:')
try:
    class ___:
        __x = 3
        def g(self): return self.__x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ___:')
try: print('_Lead().g() =>', _Lead().g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: _Lead().g()')
try: print('sorted(k for k in _Lead.__dict__ if "x" in k) =>', sorted(k for k in _Lead.__dict__ if "x" in k))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(k for k in _Lead.__dict__ if "x" in k)')
try: print('__Lead2().g() =>', __Lead2().g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: __Lead2().g()')
try: print('sorted(k for k in __Lead2.__dict__ if "x" in k) =>', sorted(k for k in __Lead2.__dict__ if "x" in k))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(k for k in __Lead2.__dict__ if "x" in k)')
try: print('___().g() =>', ___().g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ___().g()')
try: print('sorted(k for k in ___.__dict__ if "x" in k) =>', sorted(k for k in ___.__dict__ if "x" in k))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(k for k in ___.__dict__ if "x" in k)')
try:
    class Attr:
        def f(self, o): o.__v = 1; return o.__dict__
        def g(self): return Attr.__name__, self.__class__.__name__, self.__dict__, self.__module__
        def h(self):
            global __gl
            __gl = "global via mangling"
        def k(self):
            try: raise ValueError
            except ValueError as __e: return type(__e).__name__
        def w(self):
            class CM:
                def __enter__(s): return "cm"
                def __exit__(s, *a): pass
            with CM() as __w: return __w
        def fo(self):
            for __i in range(2): pass
            return __i
        def wal(self): return (__z := 4), __z
        def de(self):
            def __fn(): return "fn"
            class __Cl: pass
            return __fn(), __fn.__name__, __Cl.__name__, sorted(locals())
        def ma(self, v):
            match v:
                case {"k": __m}: return __m
                case Attr(__at=1): return "class pattern"
                case [__a, *__b]: return __a, __b
        __at = 1
        def lam(self): return (lambda __q: __q)(1), (lambda __q=2: __q).__code__.co_varnames
        def ann(self, __an: int = 0) -> None: pass
        def dl(self):
            __d = 1; del __d
            return "__d" in locals(), "_Attr__d" in locals()
        def nl(self):
            __n = 1
            def inner():
                nonlocal __n; __n += 1
            inner(); return __n
        def fs(self): __f = 7; return f"{__f} {__f=}"
        def dotted(self):
            import sys
            return sys.__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Attr:')
try: at = Attr()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at = Attr()')
try: print('at.f(type("O", (), {})()) =>', at.f(type("O", (), {})()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.f(type("O", (), {})())')
try: print('at.g() =>', at.g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.g()')
try: print('at.h() =>', at.h())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.h()')
try: print('_Attr__gl =>', _Attr__gl)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: _Attr__gl')
try: print('at.k() =>', at.k())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.k()')
try: print('at.w() =>', at.w())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.w()')
try: print('at.fo() =>', at.fo())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.fo()')
try: print('at.wal() =>', at.wal())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.wal()')
try: print('at.de() =>', at.de())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.de()')
try: print('at.ma({"k": 1}) =>', at.ma({"k": 1}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.ma({"k": 1})')
try: print('at.ma(Attr()) =>', at.ma(Attr()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.ma(Attr())')
try: print('at.ma([1, 2, 3]) =>', at.ma([1, 2, 3]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.ma([1, 2, 3])')
try: print('at.lam() =>', at.lam())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.lam()')
try: print('Attr.ann.__annotations__ =>', Attr.ann.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Attr.ann.__annotations__')
try: print('at.dl() =>', at.dl())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.dl()')
try: print('at.nl() =>', at.nl())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.nl()')
try: print('at.fs() =>', at.fs())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.fs()')
try: print('at.dotted() =>', at.dotted())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: at.dotted()')
try:
    def outside(self): return self.__x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outside(self): return self.__x')
try:
    class Late: __x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Late: __x = 1')
try: Late.m = outside
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Late.m = outside')
try: print('Late().m() =>', end=" "); t(lambda: Late().m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Late().m())')
try: T = type("T", (), {"__x": 1, "m": lambda self: self.__x})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T = type("T", (), {"__x": 1, "m": lambda self: self.__x})')
try: print('T().m() =>', T().m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T().m()')
try: print('"__x" in T.__dict__ =>', "__x" in T.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__x" in T.__dict__')
# Class bodies: what they can see and do.
try: x = "global x"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = "global x"')
try:
    class Body:
        y = x
        x = "class x"
        z = x
        def m(self): return x
        lam = lambda self: x
        comp = [x for _ in range(1)]
        gen = list(x for _ in range(1))
        first = [v for v in (x,)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Body:')
try: print('Body.y =>', Body.y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Body.y')
try: print('Body.z =>', Body.z)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Body.z')
try: print('Body().m() =>', Body().m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Body().m()')
try: print('Body().lam() =>', Body().lam())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Body().lam()')
try: print('Body.comp =>', Body.comp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Body.comp')
try: print('Body.gen =>', Body.gen)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Body.gen')
try: print('Body.first =>', Body.first)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Body.first')
try:
    class Del:
        v = 1; del v
        try: v
        except NameError as e: err = str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Del:')
try: print('Del.err =>', Del.err)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Del.err')
try: print('hasattr(Del, "v") =>', hasattr(Del, "v"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(Del, "v")')
try: gname = "g"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gname = "g"')
try:
    class GlobalInClass:
        global gname2
        gname2 = "set from class body"
        gname = "class level"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class GlobalInClass:')
try: print('gname2 =>', gname2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gname2')
try: print('gname =>', gname)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gname')
try: print('GlobalInClass.gname =>', GlobalInClass.gname)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: GlobalInClass.gname')
try: print('hasattr(GlobalInClass, "gname2") =>', hasattr(GlobalInClass, "gname2"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(GlobalInClass, "gname2")')
try:
    def f_nonlocal():
        v = 1
        class K:
            nonlocal v
            v = 2
            w = v
        return v, K.w, hasattr(K, "v")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f_nonlocal():')
try: print(f_nonlocal())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f_nonlocal()')
try:
    class LocalsInBody:
        a = 1
        snapshot = sorted(k for k in locals() if not k.startswith("__"))
        locals()["injected"] = "via locals()"
        b = injected
        v = vars() is locals()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class LocalsInBody:')
try: print('LocalsInBody.snapshot =>', LocalsInBody.snapshot)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LocalsInBody.snapshot')
try: print('LocalsInBody.injected =>', LocalsInBody.injected)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LocalsInBody.injected')
try: print('LocalsInBody.b =>', LocalsInBody.b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LocalsInBody.b')
try: print('LocalsInBody.v =>', LocalsInBody.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LocalsInBody.v')
try:
    class Loop:
        for i in range(3):
            locals()["attr%d" % i] = i
        fns = [lambda self, i=i: i for i in range(2)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Loop:')
try: print('Loop.attr0 =>', Loop.attr0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Loop.attr0')
try: print('Loop.attr2 =>', Loop.attr2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Loop.attr2')
try: print('Loop.i =>', Loop.i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Loop.i')
try: print('[f(None) for f in Loop.fns] =>', [f(None) for f in Loop.fns])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [f(None) for f in Loop.fns]')
try:
    class Cond:
        if True:
            def m(self): return "true branch"
        else:
            def m(self): return "false branch"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Cond:')
try: print(Cond().m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Cond().m()')
try:
    class Redef:
        def m(self): return 1
        first = m
        def m(self): return 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Redef:')
try: print('Redef().m() =>', Redef().m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Redef().m()')
try: print('Redef().first() =>', Redef().first())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Redef().first()')
try:
    def raises_in_body():
        class X:
            a = 1
            raise ValueError("in body")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raises_in_body():')
try: print('raises_in_body() =>', end=" "); t(raises_in_body)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(raises_in_body)')
try:
    class ReturnsSelfRef:
        try: me = ReturnsSelfRef
        except NameError as e: me = str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ReturnsSelfRef:')
try: print(ReturnsSelfRef.me)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ReturnsSelfRef.me')
try:
    for src in ("class C: return 1", "class C: yield 1", "class C: await x", "class C:\n  def f(self): pass\n  return", "class C: nonlocal x", "class C(): pass", "class C(,): pass", "class C(a, b=1, *c, **d): pass", "class C(a for a in b): pass", "class C(*a): pass", "class C(**k): pass", "class C(x=1, y): pass", "class C(x=1, x=2): pass", "class 1: pass", "class C", "class C:", "class C pass", "class C.D: pass", "class C[T]: pass", "class C[]: pass", "class None: pass", "class C(metaclass=M, metaclass=N): pass", "class C: x: int", "class C: pass; pass", "class C:\npass", "class C: break", "class C: continue", "class C:\n  import os as o\n  from sys import path", "class C: from sys import *", "class __debug__: pass", "class C(yield): pass", "class C((yield)): pass", "class C(x := 1): pass", "class C: global x; x = 1", "class C: x = 1; global x"):
        try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
        except SyntaxError as e: print("SyntaxError:", e.msg)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("class C: return 1", "class C: yield 1", "class C: await ...')
