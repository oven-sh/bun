def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

class C:
    def __init__(self): self._x = 1
    @property
    def x(self):
        "doc of x"
        return self._x
    @x.setter
    def x(self, v): self._x = v * 2
    @x.deleter
    def x(self): del self._x
    @property
    def ro(self): return "read only"
    wo = property(None, lambda self, v: setattr(self, "_w", v))
    def _get(self): return "old style"
    old = property(_get, doc="explicit doc")
    empty = property()
c = C()
print(c.x, C.x.__doc__, type(C.x).__name__, C.x.fget.__name__, C.x.fset.__name__, C.x.fdel.__name__, C.ro.fset, C.ro.fdel, C.wo.fget, C.old.__doc__, C.ro.__doc__, c.ro, c.old, C.x.__name__, C.old.__name__, isinstance(C.x, property))
c.x = 5; print(c.x, c._x, c.__dict__); del c.x; print(c.__dict__); t(lambda: c.x)
c.wo = 3; print(c._w)
def s1(): c.ro = 1
def s2(): del c.ro
def s3(): del c.wo
def s4(): c.empty = 1
def s5(): del c.empty
t(s1); t(s2); t(lambda: c.wo); t(s3); t(lambda: c.empty); t(s4); t(s5)
c.__dict__["ro"] = "in dict"; print(c.ro)
anon = property(); t(lambda: anon.__get__(c)); t(lambda: anon.__set__(c, 1)); t(lambda: anon.__delete__(c)); t(lambda: anon.__name__)
print(C.x.__get__(None, C) is C.x, C.ro.__get__(c), C.ro.__get__(c, C), property(lambda s: 1).__get__(5), C.x.getter(lambda s: "g").fget(0), C.x.getter(lambda s: "g").fset is C.x.fset, C.x.setter(None).fset is C.x.fset, type(C.x.deleter(lambda s: 0)).__name__)
p = property(lambda s: 1, doc="d"); print(p.__doc__); p.__doc__ = "changed"; print(p.__doc__)
def sp(): p.fget = 1
t(sp); t(lambda: property(1, 2, 3, 4, 5)); t(lambda: property(fget=1).__get__(c)); t(lambda: p.nope); t(lambda: property(nope=1))
print(property(fget=len, fset=None, fdel=None, doc="x").fget, property(len).__doc__ == len.__doc__, property(lambda s: 0).__isabstractmethod__)
class Sub(C):
    @C.x.getter
    def x(self): return "sub:" + str(self._x)
    @property
    def ro(self): return "sub " + super().ro
s = Sub(); s.x = 2; print(s.x, s.ro, Sub.x.fset is C.x.fset, C().x)
class PSub(property):
    def __get__(self, o, t=None): return ("psub", super().__get__(o, t))
class UsesPSub:
    @PSub
    def v(self):
        "vdoc"
        return 1
    @v.setter
    def v(self, x): pass
print(UsesPSub().v, type(UsesPSub.__dict__["v"]).__name__, UsesPSub.__dict__["v"].__doc__)
class Raises:
    @property
    def a(self): raise AttributeError("from property")
    @property
    def v(self): raise ValueError("value error")
    def __getattr__(self, n): return "getattr(%s)" % n
print(Raises().a, hasattr(Raises(), "a")); t(lambda: Raises().v); t(lambda: hasattr(Raises(), "v")); t(lambda: getattr(Raises(), "v", 1))
class Raises2:
    @property
    def a(self): raise AttributeError("from property")
    @property
    def b(self): return self.missing
t(lambda: Raises2().a); print(hasattr(Raises2(), "a"), getattr(Raises2(), "a", "dflt")); t(lambda: Raises2().b)
# classmethod, staticmethod
class M:
    n = "M"
    @classmethod
    def cm(cls, a=0): return cls.n, a
    @staticmethod
    def sm(a=0): return "static", a
    def im(self): return self.cm(), self.sm()
    cm2 = classmethod(lambda cls: cls.__name__)
    sm2 = staticmethod(len)
    sm3 = staticmethod(lambda: "lambda")
class N(M): n = "N"
print(M.cm(), M().cm(1), N.cm(), N().cm(a=2), M.sm(), M().sm(1), N.sm(), M().im(), N().im(), M.cm2(), N.cm2(), M.sm2([1]), M().sm2([1, 2]), M().sm3())
print(type(M.__dict__["cm"]).__name__, type(M.__dict__["sm"]).__name__, type(M.cm).__name__, type(M.sm).__name__, M.cm.__self__ is M, N.cm.__self__ is N, M().cm.__self__ is M, M.cm.__func__ is M.__dict__["cm"].__func__, M.sm is M.__dict__["sm"].__func__, M.cm.__name__, M.cm.__qualname__, M.sm.__qualname__, M.__dict__["cm"].__name__, M.__dict__["sm"].__name__, M.__dict__["cm"].__wrapped__ is M.cm.__func__, M.__dict__["sm"].__wrapped__ is M.sm, M.__dict__["cm"].__isabstractmethod__, M.cm == M.cm, M.cm is M.cm, M.cm == N.cm, M.__dict__["cm"].__doc__, M.__dict__["cm"].__module__)
print(repr(M.__dict__["sm2"]), M.__dict__["sm"](5), callable(M.__dict__["sm"]), callable(M.__dict__["cm"]), staticmethod(len)([1]), classmethod(len).__get__(None, [1, 2].__class__).__self__, classmethod(lambda c: c).__get__(5)(), classmethod(lambda c: c).__get__(None, int)(), staticmethod(1).__get__(None, int), staticmethod(1).__func__, classmethod(1).__func__)
t(lambda: M.__dict__["cm"]())
t(lambda: classmethod())
t(lambda: staticmethod())
t(lambda: classmethod(1, 2))
t(lambda: classmethod(1).__get__(None, int)())
t(lambda: staticmethod(1)())
t(lambda: classmethod(lambda c: c).__get__(None))
t(lambda: M.cm(1, 2))
t(lambda: M.sm(1, 2))
t(lambda: M.im())
sm = staticmethod(lambda: 0); sm.extra = 1; print(sm.extra, sm.__dict__.get("extra")); cm = classmethod(lambda c: 0); cm.extra = 2; print(cm.extra)
class CP:
    _v = "class value"
    @classmethod
    def make(cls, *a): o = cls.__new__(cls); o.a = a; return o
    @classmethod
    def chain(cls): return cls.make(1).a, cls._v
class CP2(CP): _v = "sub value"
print(type(CP2.make()).__name__, CP2.chain(), CP.chain())
# Methods are descriptors.
def fn(self, a=1): return self, a
print(fn.__get__(5)(), fn.__get__(5, int)(2), fn.__get__(None, int) is fn, type(fn.__get__(5)).__name__, fn.__get__(5).__self__, fn.__get__("s").__func__ is fn, (lambda s: s).__get__([1])(), len.__get__ if hasattr(len, "__get__") else "builtin functions do not bind")
t(lambda: fn.__get__())
t(lambda: fn.__get__(None, None))
t(lambda: fn.__get__(None))
class H:
    builtin = len
    typ = int
    lam = lambda self: "lam"
    inst = M()
    meth = M().im
    part = print
h = H(); print(h.builtin([1, 2]), h.typ("5"), h.lam(), type(h.inst).__name__, h.meth(), H.builtin is len, h.meth.__self__.__class__.__name__)
print(str.upper.__get__("abc")(), int.__add__.__get__(1)(2), list.append.__get__([]).__self__, type(str.upper.__get__("a")).__name__, type(int.__add__.__get__(1)).__name__, str.upper.__get__(None, str) is str.upper, dict.fromkeys.__self__, dict.__dict__["fromkeys"].__get__(None, dict)("a"), int.real.__get__(5), int.real.__get__(None, int) is int.real)
t(lambda: str.upper.__get__(1))
t(lambda: int.__add__.__get__("a"))
t(lambda: int.real.__get__("a"))
t(lambda: int.real.__set__(1, 2))
t(lambda: int.real.__delete__(1))
t(lambda: dict.__dict__["fromkeys"].__get__(None, int))
t(lambda: dict.__dict__["fromkeys"].__get__(None, 1))
t(lambda: dict.__dict__["fromkeys"].__get__(None))
t(lambda: str.upper(1))
t(lambda: int.__add__("a", 1))
t(lambda: list.append(1, 2))
t(lambda: str.upper())
t(lambda: int.__add__())
t(lambda: int.__add__(1))
t(lambda: int.__add__(1, 2, 3))
t(lambda: object.__repr__())
t(lambda: int.__new__())
t(lambda: int.__new__(1))
t(lambda: int.__new__(str))
t(lambda: int.__new__(object))
t(lambda: object.__new__(int))
t(lambda: object.__new__(1))
t(lambda: object.__new__())
t(lambda: list.__new__(dict))
t(lambda: object.__init__())
t(lambda: object.__init__(1, 2))
