def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
class C:
    m = str.upper
    w = list.__len__
    __len__ = list.__len__
    __enter__ = str.upper
    def __exit__(self, *a): return False
    __iter__ = list.__iter__
    __hash__ = str.__hash__
    __repr__ = bytes.__repr__
    __getitem__ = dict.__getitem__
    __add__ = list.__add__
    __call__ = str.lower
    __eq__ = dict.__eq__
    __bool__ = int.__bool__
    __contains__ = set.__contains__
    c = dict.fromkeys
c = C()
t(lambda: c.m)
t(lambda: c.m())
t(lambda: c.w)
t(lambda: c.w())
t(lambda: len(c))
t(lambda: iter(c))
t(lambda: hash(c))
t(lambda: repr(c))
t(lambda: c[0])
t(lambda: c + c)
t(lambda: c())
t(lambda: c == c)
t(lambda: bool(c))
t(lambda: 1 in c)
t(lambda: c.c([1]))
def w():
    with c: pass
t(w)
t(lambda: str.upper.__get__(c))
t(lambda: str.upper.__get__(c, C))
t(lambda: str.upper.__get__(None, str))
t(lambda: str.upper.__get__("a")())
t(lambda: list.__len__.__get__(c))
t(lambda: getattr(c, "m"))
t(lambda: [x for x in c])
t(lambda: super(C, c).__init__ and C.m)
class S(str):
    up = str.upper
    __len__ = str.__len__
t(lambda: (S("a").up(), len(S("ab"))))
class G:
    real = int.__dict__["real"]
    __getattribute__ = type.__getattribute__
class H:
    __getattribute__ = type(sys := __import__("sys")).__getattribute__
class A:
    __slots__ = ("x",)
class K:
    x = A.__dict__["x"]
    r = int.__dict__["real"]
    __new__ = dict.__new__
t(lambda: G().real)
t(lambda: H().x)
t(lambda: object.__new__(K).x)
t(lambda: setattr(object.__new__(K), "x", 1))
t(lambda: delattr(object.__new__(K), "x"))
t(lambda: object.__new__(K).r)
t(lambda: setattr(object.__new__(K), "r", 1))
t(lambda: type(K()).__name__)
class N:
    f = dict.__dict__["fromkeys"]
    h = bytes.__dict__["fromhex"]
t(lambda: N().f)
t(lambda: N.f)
t(lambda: N.h("00"))
class O(dict):
    f = dict.__dict__["fromkeys"]
t(lambda: (O.f([1]), type(O().f([2])).__name__))
