def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

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
_A__g = "mangled global"
a = A()
print(a.get(), sorted(k for k in a.__dict__), sorted(k for k in A.__dict__ if "cls" in k or "method" in k or k in ("__", "___") or "a_" in k or "Inner" in k), a._A__inst, a._A__cls, a._A__method(), a.has(), a.local(), a.param(1), a.param(_A__p=2, _A__k=3), a.glob(), a.nested(), a.imp(), a.kwcall(), a.other(A()), a.string(), a.inner(), A.param.__code__.co_varnames, A._A__method.__name__, A._A__method.__qualname__)
t(lambda: a.__inst); t(lambda: a.__cls); t(lambda: A.__cls); t(lambda: a.__method()); t(lambda: a.param(__p=1))
a.set(5); print(a._A__inst); a.delete(); print(a.has()); a.__outside = 1; print(a.__dict__)
class B(A):
    def get_b(self): return self.__inst
    def get_ok(self): return self._A__inst
    __cls = "B's own"
    def both(self): return self.__cls, self._A__cls
b = B(); t(b.get_b); print(b.get_ok(), b.both(), b.get()[1])
class _Lead:
    __x = 1
    def g(self): return self.__x
class __Lead2:
    __x = 2
    def g(self): return self.__x
class ___:
    __x = 3
    def g(self): return self.__x
print(_Lead().g(), sorted(k for k in _Lead.__dict__ if "x" in k), __Lead2().g(), sorted(k for k in __Lead2.__dict__ if "x" in k), ___().g(), sorted(k for k in ___.__dict__ if "x" in k))
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
at = Attr(); print(at.f(type("O", (), {})()), at.g(), at.h(), _Attr__gl, at.k(), at.w(), at.fo(), at.wal(), at.de(), at.ma({"k": 1}), at.ma(Attr()), at.ma([1, 2, 3]), at.lam(), Attr.ann.__annotations__, at.dl(), at.nl(), at.fs(), at.dotted())
def outside(self): return self.__x
class Late: __x = 1
Late.m = outside; t(lambda: Late().m())
T = type("T", (), {"__x": 1, "m": lambda self: self.__x}); print(T().m(), "__x" in T.__dict__)
# Class bodies: what they can see and do.
x = "global x"
class Body:
    y = x
    x = "class x"
    z = x
    def m(self): return x
    lam = lambda self: x
    comp = [x for _ in range(1)]
    gen = list(x for _ in range(1))
    first = [v for v in (x,)]
print(Body.y, Body.z, Body().m(), Body().lam(), Body.comp, Body.gen, Body.first)
class Del:
    v = 1; del v
    try: v
    except NameError as e: err = str(e)
print(Del.err, hasattr(Del, "v"))
gname = "g"
class GlobalInClass:
    global gname2
    gname2 = "set from class body"
    gname = "class level"
print(gname2, gname, GlobalInClass.gname, hasattr(GlobalInClass, "gname2"))
def f_nonlocal():
    v = 1
    class K:
        nonlocal v
        v = 2
        w = v
    return v, K.w, hasattr(K, "v")
print(f_nonlocal())
class LocalsInBody:
    a = 1
    snapshot = sorted(k for k in locals() if not k.startswith("__"))
    locals()["injected"] = "via locals()"
    b = injected
    v = vars() is locals()
print(LocalsInBody.snapshot, LocalsInBody.injected, LocalsInBody.b, LocalsInBody.v)
class Loop:
    for i in range(3):
        locals()["attr%d" % i] = i
    fns = [lambda self, i=i: i for i in range(2)]
print(Loop.attr0, Loop.attr2, Loop.i, [f(None) for f in Loop.fns])
class Cond:
    if True:
        def m(self): return "true branch"
    else:
        def m(self): return "false branch"
print(Cond().m())
class Redef:
    def m(self): return 1
    first = m
    def m(self): return 2
print(Redef().m(), Redef().first())
def raises_in_body():
    class X:
        a = 1
        raise ValueError("in body")
t(raises_in_body)
class ReturnsSelfRef:
    try: me = ReturnsSelfRef
    except NameError as e: me = str(e)
print(ReturnsSelfRef.me)
for src in ("class C: return 1", "class C: yield 1", "class C: await x", "class C:\n  def f(self): pass\n  return", "class C: nonlocal x", "class C(): pass", "class C(,): pass", "class C(a, b=1, *c, **d): pass", "class C(a for a in b): pass", "class C(*a): pass", "class C(**k): pass", "class C(x=1, y): pass", "class C(x=1, x=2): pass", "class 1: pass", "class C", "class C:", "class C pass", "class C.D: pass", "class C[T]: pass", "class C[]: pass", "class None: pass", "class C(metaclass=M, metaclass=N): pass", "class C: x: int", "class C: pass; pass", "class C:\npass", "class C: break", "class C: continue", "class C:\n  import os as o\n  from sys import path", "class C: from sys import *", "class __debug__: pass", "class C(yield): pass", "class C((yield)): pass", "class C(x := 1): pass", "class C: global x; x = 1", "class C: x = 1; global x"):
    try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e: print("SyntaxError:", e.msg)
