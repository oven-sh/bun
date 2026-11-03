try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')
try: c = C()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = C()')
try: print('c.m =>', end=" "); t(lambda: c.m)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c.m)')
try: print('c.m() =>', end=" "); t(lambda: c.m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c.m())')
try: print('c.w =>', end=" "); t(lambda: c.w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c.w)')
try: print('c.w() =>', end=" "); t(lambda: c.w())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c.w())')
try: print('len(c) =>', end=" "); t(lambda: len(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len(c))')
try: print('iter(c) =>', end=" "); t(lambda: iter(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: iter(c))')
try: print('hash(c) =>', end=" "); t(lambda: hash(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: hash(c))')
try: print('repr(c) =>', end=" "); t(lambda: repr(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: repr(c))')
try: print('c[0] =>', end=" "); t(lambda: c[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c[0])')
try: print('c + c =>', end=" "); t(lambda: c + c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c + c)')
try: print('c() =>', end=" "); t(lambda: c())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c())')
try: print('c == c =>', end=" "); t(lambda: c == c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c == c)')
try: print('bool(c) =>', end=" "); t(lambda: bool(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bool(c))')
try: print('1 in c =>', end=" "); t(lambda: 1 in c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: 1 in c)')
try: print('c.c([1]) =>', end=" "); t(lambda: c.c([1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c.c([1]))')
try:
    def w():
        with c: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def w():')
try: print('w() =>', end=" "); t(w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(w)')
try: print('str.upper.__get__(c) =>', end=" "); t(lambda: str.upper.__get__(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: str.upper.__get__(c))')
try: print('str.upper.__get__(c, C) =>', end=" "); t(lambda: str.upper.__get__(c, C))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: str.upper.__get__(c, C))')
try: print('str.upper.__get__(None, str) =>', end=" "); t(lambda: str.upper.__get__(None, str))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: str.upper.__get__(None, str))')
try: print('str.upper.__get__("a")() =>', end=" "); t(lambda: str.upper.__get__("a")())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: str.upper.__get__("a")())')
try: print('list.__len__.__get__(c) =>', end=" "); t(lambda: list.__len__.__get__(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list.__len__.__get__(c))')
try: print('getattr(c, "m") =>', end=" "); t(lambda: getattr(c, "m"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: getattr(c, "m"))')
try: print('[x for x in c] =>', end=" "); t(lambda: [x for x in c])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: [x for x in c])')
try: print('super(C, c).__init__ and C.m =>', end=" "); t(lambda: super(C, c).__init__ and C.m)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: super(C, c).__init__ and C.m)')
try:
    class S(str):
        up = str.upper
        __len__ = str.__len__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S(str):')
try: print('(S("a").up(), len(S("ab"))) =>', end=" "); t(lambda: (S("a").up(), len(S("ab"))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: (S("a").up(), len(S("ab"))))')
try:
    class G:
        real = int.__dict__["real"]
        __getattribute__ = type.__getattribute__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G:')
try:
    class H:
        __getattribute__ = type(sys := __import__("sys")).__getattribute__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class H:')
try:
    class A:
        __slots__ = ("x",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A:')
try:
    class K:
        x = A.__dict__["x"]
        r = int.__dict__["real"]
        __new__ = dict.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K:')
try: print('G().real =>', end=" "); t(lambda: G().real)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: G().real)')
try: print('H().x =>', end=" "); t(lambda: H().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: H().x)')
try: print('object.__new__(K).x =>', end=" "); t(lambda: object.__new__(K).x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__new__(K).x)')
try: print('setattr(object.__new__(K), "x", 1) =>', end=" "); t(lambda: setattr(object.__new__(K), "x", 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: setattr(object.__new__(K), "x", 1))')
try: print('delattr(object.__new__(K), "x") =>', end=" "); t(lambda: delattr(object.__new__(K), "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: delattr(object.__new__(K), "x"))')
try: print('object.__new__(K).r =>', end=" "); t(lambda: object.__new__(K).r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__new__(K).r)')
try: print('setattr(object.__new__(K), "r", 1) =>', end=" "); t(lambda: setattr(object.__new__(K), "r", 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: setattr(object.__new__(K), "r", 1))')
try: print('type(K()).__name__ =>', end=" "); t(lambda: type(K()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(K()).__name__)')
try:
    class N:
        f = dict.__dict__["fromkeys"]
        h = bytes.__dict__["fromhex"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class N:')
try: print('N().f =>', end=" "); t(lambda: N().f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: N().f)')
try: print('N.f =>', end=" "); t(lambda: N.f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: N.f)')
try: print('N.h("00") =>', end=" "); t(lambda: N.h("00"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: N.h("00"))')
try:
    class O(dict):
        f = dict.__dict__["fromkeys"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O(dict):')
try: print('(O.f([1]), type(O().f([2])).__name__) =>', end=" "); t(lambda: (O.f([1]), type(O().f([2])).__name__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: (O.f([1]), type(O().f([2])).__name__))')
