# The same instruction gets, sets or calls an attribute again and again while what it may have remembered stops being true.
try: import sys, types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, types')

try:
    def get_x(o): return o.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def get_x(o): return o.x')
try:
    def set_x(o, v): o.x = v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def set_x(o, v): o.x = v')
try:
    def call_m(o, *a): return o.m(*a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def call_m(o, *a): return o.m(*a)')
try:
    def get_m(o): return o.m
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def get_m(o): return o.m')
try:
    def try_(f, *a):
        try:
            return f(*a)
        except Exception as e:
            return type(e).__name__ + ": " + str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def try_(f, *a):')

try:
    def warm(f, *a):
        for _ in range(5):
            r = f(*a)
        return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def warm(f, *a):')

try: print("--- instance attribute, then the class changes")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- instance attribute, then the class changes"')
try:
    class A:
        def __init__(self): self.x = 1
        def m(self, *a): return ("A.m", a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A:')
try: a = A()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = A()')
try: print(warm(get_x, a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, a)')
try: A.x = property(lambda self: "property")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.x = property(lambda self: "property")')
try: print('get_x(a) =>', get_x(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(a)')
try: print('try_(set_x, a, 5) =>', try_(set_x, a, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(set_x, a, 5)')
try: del A.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del A.x')
try: print(get_x(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(a)')
try: A.x = "class value"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.x = "class value"')
try: print(get_x(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(a)')
try: del a.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del a.x')
try: print(warm(get_x, a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, a)')
try: A.x = "other class value"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.x = "other class value"')
try: print(get_x(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(a)')
try: del A.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del A.x')
try: print(try_(get_x, a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(get_x, a)')
try: a.x = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.x = 3')
try: print(warm(get_x, a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, a)')

try: print("--- different layouts at one place")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- different layouts at one place"')
try:
    class B:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B:')
try: b1 = B()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b1 = B()')
try: b1.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b1.x = 1')
try: b1.y = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b1.y = 2')
try: b2 = B()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b2 = B()')
try: b2.y = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b2.y = 2')
try: b2.x = 10
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b2.x = 10')
try: b3 = B()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b3 = B()')
try: b3.z = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b3.z = 0')
try: b3.y = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b3.y = 0')
try: b3.x = 100
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b3.x = 100')
try: print([get_x(o) for o in (b1, b2, b3, b1, b1, b2, b2, b3, b3)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [get_x(o) for o in (b1, b2, b3, b1, b1, b2, b2, b3, b3)]')
try:
    for o in (b1, b2, b3, b1, b2, b3):
        try: set_x(o, get_x(o) + 1)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: set_x(o, get_x(o) + 1)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for o in (b1, b2, b3, b1, b2, b3):')
try: print('[get_x(o) for o in (b1, b2, b3)] =>', [get_x(o) for o in (b1, b2, b3)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [get_x(o) for o in (b1, b2, b3)]')
try: print('b1.__dict__ =>', b1.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b1.__dict__')
try: print('b2.__dict__ =>', b2.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b2.__dict__')
try: print('b3.__dict__ =>', b3.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b3.__dict__')

try: print("--- adding attributes through one place")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- adding attributes through one place"')
try: objs = [B() for _ in range(6)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: objs = [B() for _ in range(6)]')
try:
    for i, o in enumerate(objs):
        if i == 3: o.w = "first"
        try: set_x(o, i)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: set_x(o, i)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i, o in enumerate(objs):')
try: print([(get_x(o), list(vars(o))) for o in objs])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [(get_x(o), list(vars(o))) for o in objs]')

try: print("--- methods")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- methods"')
try: print(warm(call_m, a, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, a, 1)')
try: A.m = lambda self, *a: ("new A.m", a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.m = lambda self, *a: ("new A.m", a)')
try: print(call_m(a, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_m(a, 2)')
try: a.m = lambda *a: ("on the instance", a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.m = lambda *a: ("on the instance", a)')
try: print(warm(call_m, a, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, a, 3)')
try: del a.m
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del a.m')
try: print(warm(call_m, a, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, a, 4)')
try:
    class A2(A):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A2(A):')
try: a2 = A2()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a2 = A2()')
try: print(warm(call_m, a2, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, a2, 5)')
try: A.m = lambda self, *a: ("newer A.m", a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.m = lambda self, *a: ("newer A.m", a)')
try: print(call_m(a2, 6))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_m(a2, 6)')
try: A2.m = lambda self, *a: ("A2.m", a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A2.m = lambda self, *a: ("A2.m", a)')
try: print('call_m(a2, 7) =>', call_m(a2, 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_m(a2, 7)')
try: print('call_m(a, 7) =>', call_m(a, 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_m(a, 7)')
try: del A2.m
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del A2.m')
try: print(call_m(a2, 8))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_m(a2, 8)')
try: A.m = staticmethod(lambda *a: ("static", a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.m = staticmethod(lambda *a: ("static", a))')
try: print('warm(call_m, a2, 9) =>', warm(call_m, a2, 9))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, a2, 9)')
try: print('warm(get_m, a2)(10) =>', warm(get_m, a2)(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_m, a2)(10)')
try: A.m = classmethod(lambda cls, *a: ("class", cls.__name__, a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.m = classmethod(lambda cls, *a: ("class", cls.__name__, a))')
try: print('warm(call_m, a2, 11) =>', warm(call_m, a2, 11))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, a2, 11)')
try: print('warm(call_m, a, 11) =>', warm(call_m, a, 11))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, a, 11)')
try: print('warm(get_m, a2)(12) =>', warm(get_m, a2)(12))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_m, a2)(12)')
try: A.m = len
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.m = len')
try: print(warm(call_m, a2, "four"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, a2, "four")')
try: A.m = B
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.m = B')
try: print(type(warm(call_m, a2)).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(warm(call_m, a2)).__name__')
try: A.m = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.m = 5')
try: print('try_(call_m, a2) =>', try_(call_m, a2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(call_m, a2)')
try: print('warm(get_m, a2) =>', warm(get_m, a2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_m, a2)')
try:
    class Callable:
        def __call__(self, *a): return ("callable object", a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Callable:')
try: A.m = Callable()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.m = Callable()')
try: print(warm(call_m, a2, 13))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, a2, 13)')
try:
    class Descriptor:
        def __get__(self, o, t): return lambda *a: ("from __get__", type(o).__name__, a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Descriptor:')
try: A.m = Descriptor()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.m = Descriptor()')
try: print(warm(call_m, a2, 14))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, a2, 14)')
try: a2.m = lambda *a: ("instance beats non-data descriptor", a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a2.m = lambda *a: ("instance beats non-data descriptor", a)')
try: print(warm(call_m, a2, 15))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, a2, 15)')
try: Descriptor.__set__ = lambda self, o, v: None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Descriptor.__set__ = lambda self, o, v: None')
try: print(warm(call_m, a2, 16))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, a2, 16)')
try: del Descriptor.__set__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Descriptor.__set__')
try: print(warm(call_m, a2, 17))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, a2, 17)')

try: print("--- __dict__")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- __dict__"')
try:
    class C:
        def __init__(self): self.x = 1; self.y = 2
        def m(self): return "C.m"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')
try: c = C()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = C()')
try: print('warm(get_x, c) =>', warm(get_x, c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, c)')
try: print('warm(call_m, c) =>', warm(call_m, c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, c)')
try: d = c.__dict__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = c.__dict__')
try: d["x"] = "through the dict"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d["x"] = "through the dict"')
try: print(get_x(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(c)')
try: d["m"] = lambda: "in the dict"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d["m"] = lambda: "in the dict"')
try: print(call_m(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_m(c)')
try: del d["m"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del d["m"]')
try: del d["x"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del d["x"]')
try: print('call_m(c) =>', call_m(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_m(c)')
try: print('try_(get_x, c) =>', try_(get_x, c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(get_x, c)')
try: set_x(c, 9)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: set_x(c, 9)')
try: print('d =>', d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')
try: print('get_x(c) =>', get_x(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(c)')
try: c.__dict__ = {"x": "new dict"}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.__dict__ = {"x": "new dict"}')
try: print('warm(get_x, c) =>', warm(get_x, c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, c)')
try: print('d =>', d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')
try: c2 = C()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2 = C()')
try: print('warm(get_x, c2) =>', warm(get_x, c2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, c2)')
try: print('get_x(c) =>', get_x(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(c)')
try: print('get_x(c2) =>', get_x(c2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(c2)')
try: vars(c2)["x"] = 7
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars(c2)["x"] = 7')
try: print('get_x(c2) =>', get_x(c2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(c2)')
try: print('get_x(C()) =>', get_x(C()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(C())')
try: c3 = C()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c3 = C()')
try: c3.__dict__.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c3.__dict__.clear()')
try: print('try_(get_x, c3) =>', try_(get_x, c3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(get_x, c3)')
try: print('c3.__dict__ =>', c3.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c3.__dict__')
try: set_x(c3, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: set_x(c3, 1)')
try: print(c3.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c3.__dict__')

try: print("--- __class__")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- __class__"')
try:
    class D1:
        x = "D1.x"
        def m(self): return "D1.m"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D1:')
try:
    class D2:
        x = "D2.x"
        def m(self): return "D2.m"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D2:')
try: o = D1()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = D1()')
try: print('warm(get_x, o) =>', warm(get_x, o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, o)')
try: print('warm(call_m, o) =>', warm(call_m, o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, o)')
try: o.__class__ = D2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__class__ = D2')
try: print('warm(get_x, o) =>', warm(get_x, o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, o)')
try: print('warm(call_m, o) =>', warm(call_m, o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, o)')
try: o.x = "own"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.x = "own"')
try: print(warm(get_x, o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, o)')
try: o.__class__ = D1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__class__ = D1')
try: print('warm(get_x, o) =>', warm(get_x, o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, o)')
try: print('warm(call_m, o) =>', warm(call_m, o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, o)')

try: print("--- __getattr__, __getattribute__, __setattr__ that come later")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- __getattr__, __getattribute__, __setattr__ that come later"')
try:
    class E:
        def __init__(self): self.x = 1
        def m(self): return "E.m"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E:')
try: e = E()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = E()')
try: print('warm(get_x, e) =>', warm(get_x, e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, e)')
try: print('warm(call_m, e) =>', warm(call_m, e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, e)')
try: E.__getattr__ = lambda self, name: "fallback " + name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E.__getattr__ = lambda self, name: "fallback " + name')
try: print('get_x(e) =>', get_x(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(e)')
try: print('call_m(e) =>', call_m(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_m(e)')
try: del e.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del e.x')
try: print(warm(get_x, e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, e)')
try: del E.__getattr__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del E.__getattr__')
try: print(try_(get_x, e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(get_x, e)')
try: e.x = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.x = 2')
try: print(warm(get_x, e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, e)')
try: E.__getattribute__ = lambda self, name: (lambda: "intercepted call") if name == "m" else "intercepted " + name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E.__getattribute__ = lambda self, name: (lambda: "intercepted call") ...')
try: print('get_x(e) =>', get_x(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(e)')
try: print('call_m(e) =>', call_m(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_m(e)')
try: del E.__getattribute__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del E.__getattribute__')
try: print('get_x(e) =>', get_x(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(e)')
try: print('call_m(e) =>', call_m(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_m(e)')
try: warm(set_x, e, 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(set_x, e, 3)')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try: E.__setattr__ = lambda self, name, value: log.append((name, value))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E.__setattr__ = lambda self, name, value: log.append((name, value))')
try: set_x(e, 4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: set_x(e, 4)')
try: print('get_x(e) =>', get_x(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(e)')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: del E.__setattr__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del E.__setattr__')
try: set_x(e, 5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: set_x(e, 5)')
try: print(get_x(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(e)')

try: print("--- __slots__")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- __slots__"')
try:
    class S:
        __slots__ = ("x", "y")
        def m(self): return "S.m"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S:')
try: s = S()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = S()')
try: print(try_(get_x, s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(get_x, s)')
try: warm(set_x, s, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(set_x, s, 1)')
try: print('warm(get_x, s) =>', warm(get_x, s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, s)')
try: print('warm(call_m, s) =>', warm(call_m, s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, s)')
try: del s.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del s.x')
try: print(try_(get_x, s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(get_x, s)')
try: set_x(s, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: set_x(s, 2)')
try: print(get_x(s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(s)')
try: s2 = S()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s2 = S()')
try: s2.y = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s2.y = 0')
try: s2.x = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s2.x = 5')
try: print('get_x(s2) =>', get_x(s2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(s2)')
try: print('get_x(s) =>', get_x(s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(s)')
try: print('get_x(s2) =>', get_x(s2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(s2)')
try:
    class S2(S):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S2(S):')
try: s3 = S2()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s3 = S2()')
try: s3.x = "slot"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s3.x = "slot"')
try: s3.z = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s3.z = 1')
try: print('warm(get_x, s3) =>', warm(get_x, s3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, s3)')
try: print('s3.__dict__ =>', s3.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s3.__dict__')
try:
    class S3(S):
        __slots__ = ()
        x = "hides the slot"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S3(S):')
try: print('warm(get_x, S3()) =>', warm(get_x, S3()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, S3())')
try: print('try_(set_x, S3(), 1) =>', try_(set_x, S3(), 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(set_x, S3(), 1)')

try: print("--- __bases__")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- __bases__"')
try:
    class F1:
        x = "F1.x"
        def m(self): return "F1.m"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F1:')
try:
    class F2:
        x = "F2.x"
        def m(self): return "F2.m"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F2:')
try:
    class G(F1):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G(F1):')
try: g = G()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = G()')
try: print('warm(get_x, g) =>', warm(get_x, g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, g)')
try: print('warm(call_m, g) =>', warm(call_m, g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, g)')
try: G.__bases__ = (F2,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: G.__bases__ = (F2,)')
try: print('warm(get_x, g) =>', warm(get_x, g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, g)')
try: print('warm(call_m, g) =>', warm(call_m, g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, g)')

try: print("--- many attributes, and deleting")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- many attributes, and deleting"')
try:
    class H:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class H:')
try: h = H()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h = H()')
try:
    for i in range(200):
        try: setattr(h, "a%d" % i, i)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(h, "a%d" % i, i)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(200):')
try: h.x = "after 200"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h.x = "after 200"')
try: print(warm(get_x, h))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, h)')
try:
    for i in range(0, 200, 2):
        try: delattr(h, "a%d" % i)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: delattr(h, "a%d" % i)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(0, 200, 2):')
try: print('warm(get_x, h) =>', warm(get_x, h))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, h)')
try: print('len(vars(h)) =>', len(vars(h)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(vars(h))')
try: del h.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del h.x')
try: print(try_(get_x, h))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(get_x, h)')
try: h.x = "again"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h.x = "again"')
try: print(warm(get_x, h))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, h)')
try: k = H()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k = H()')
try:
    for _ in range(50):
        try: k.x = 1
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k.x = 1')
        try: k.y = 2
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k.y = 2')
        try: del k.x
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del k.x')
        try: assert try_(get_x, k).startswith("AttributeError")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert try_(get_x, k).startswith("AttributeError")')
        try: k.x = 3
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k.x = 3')
        try: assert get_x(k) == 3
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert get_x(k) == 3')
        try: del k.y
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del k.y')
        try: del k.x
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del k.x')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(50):')
try: print(vars(k))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars(k)')

try: print("--- names that are no property names")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- names that are no property names"')
try: n = H()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n = H()')
try: setattr(n, "0", "zero")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(n, "0", "zero")')
try: setattr(n, "x", 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(n, "x", 1)')
try: setattr(n, "", "empty")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(n, "", "empty")')
try: setattr(n, "a b", "space")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(n, "a b", "space")')
try: setattr(n, "4294967295", "big")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(n, "4294967295", "big")')
try: print('vars(n) =>', vars(n))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars(n)')
try: print('getattr(n, "0") =>', getattr(n, "0"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(n, "0")')
try: print('warm(get_x, n) =>', warm(get_x, n))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, n)')
try: print('getattr(n, "") =>', getattr(n, ""))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(n, "")')
try: print('getattr(n, "4294967295") =>', getattr(n, "4294967295"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(n, "4294967295")')
try:
    class Str(str):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Str(str):')
try: n2 = H()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n2 = H()')
try: n2.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n2.x = 1')
try: setattr(n2, Str("y"), 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(n2, Str("y"), 2)')
try: print('[(type(key).__name__, key) for key in vars(n2)] =>', [(type(key).__name__, key) for key in vars(n2)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [(type(key).__name__, key) for key in vars(n2)]')
try: print('n2.y =>', n2.y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n2.y')
try: print('warm(get_x, n2) =>', warm(get_x, n2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, n2)')
try: n3 = H()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n3 = H()')
try: n3.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n3.x = 1')
try: print('getattr(n3, "x" + "") =>', getattr(n3, "x" + ""))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(n3, "x" + "")')
try: print('getattr(n3, "".join(["x"])) =>', getattr(n3, "".join(["x"])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(n3, "".join(["x"]))')
try: print('hasattr(n3, "".join(["y", "z"])) =>', hasattr(n3, "".join(["y", "z"])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(n3, "".join(["y", "z"]))')

try: print("--- modules")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- modules"')
try: m = types.ModuleType("m")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m = types.ModuleType("m")')
try: m.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.x = 1')
try: m.m = lambda *a: ("function of the module", a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.m = lambda *a: ("function of the module", a)')
try: print('warm(get_x, m) =>', warm(get_x, m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, m)')
try: print('warm(call_m, m, 1) =>', warm(call_m, m, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(call_m, m, 1)')
try: m.x = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.x = 2')
try: print(get_x(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(m)')
try: del m.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del m.x')
try: print(try_(get_x, m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(get_x, m)')
try: m.__getattr__ = lambda name: "module fallback " + name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.__getattr__ = lambda name: "module fallback " + name')
try: print(warm(get_x, m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, m)')
try: m.x = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.x = 3')
try: print(warm(get_x, m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, m)')
try: m.__dict__["x"] = 4
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.__dict__["x"] = 4')
try: print(get_x(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(m)')
try:
    for i in range(100):
        try: setattr(m, "v%d" % i, i)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(m, "v%d" % i, i)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(100):')
try: print('get_x(m) =>', get_x(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(m)')
try: print('call_m(m, 2) =>', call_m(m, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_m(m, 2)')
try: m2 = types.ModuleType("m2")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m2 = types.ModuleType("m2")')
try: m2.x = "m2"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m2.x = "m2"')
try: print([get_x(o) for o in (m, m2, m, m2, m2)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [get_x(o) for o in (m, m2, m, m2, m2)]')
try:
    class M(types.ModuleType):
        x = property(lambda self: "property of the module's class")
        def m(self, *a): return ("method of the module's class", a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M(types.ModuleType):')
try: print(warm(get_x, m2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, m2)')
try: m2.__class__ = M
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m2.__class__ = M')
try: print('get_x(m2) =>', get_x(m2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(m2)')
try: print('try_(call_m, m2, 3) =>', try_(call_m, m2, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(call_m, m2, 3)')
try: m2.__class__ = types.ModuleType
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m2.__class__ = types.ModuleType')
try: print('get_x(m2) =>', get_x(m2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(m2)')
try: print('try_(call_m, m2, 3) =>', try_(call_m, m2, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(call_m, m2, 3)')

try: print("--- built-in types and their subclasses at one place")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- built-in types and their subclasses at one place"')
try:
    def call_count(o, v): return o.count(v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def call_count(o, v): return o.count(v)')
try:
    def call_upper(o): return o.upper()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def call_upper(o): return o.upper()')
try:
    class L(list):
        def count(self, v): return "L.count"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L(list):')
try:
    class L2(list):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L2(list):')
try:
    class T(str):
        def upper(self): return "T.upper"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class T(str):')
try: print([call_count(o, 1) for o in ([1, 1], [1.5, 1], ["a"], (1, 1, 1), L([1]), [1], L2([1, 1]), "111", b"\x01", [], range(3))])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [call_count(o, 1) for o in ([1, 1], [1.5, 1], ["a"], (1, 1, 1), L([1]...')
try: print([call_upper(o) for o in ("a", T("b"), "c", b"d", "e", bytearray(b"f"), T("g"))])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [call_upper(o) for o in ("a", T("b"), "c", b"d", "e", bytearray(b"f")...')
try: l2 = L2([1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l2 = L2([1])')
try: l2.count = lambda v: "on the instance"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l2.count = lambda v: "on the instance"')
try: print('call_count(l2, 1) =>', call_count(l2, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_count(l2, 1)')
try: print('call_count(L2([1]), 1) =>', call_count(L2([1]), 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_count(L2([1]), 1)')
try: print('call_count([1], 1) =>', call_count([1], 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call_count([1], 1)')
try:
    def call_get(o, key): return o.get(key)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def call_get(o, key): return o.get(key)')
try:
    class Dict(dict):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Dict(dict):')
try:
    class Dict2(dict):
        def get(self, key): return "Dict2.get"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Dict2(dict):')
try: dd = Dict(a=1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dd = Dict(a=1)')
try: dd2 = Dict(a=2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dd2 = Dict(a=2)')
try: dd2.get = lambda key: "instance"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dd2.get = lambda key: "instance"')
try: print([call_get(o, "a") for o in ({"a": 0}, dd, dd2, Dict2(a=3), {"a": 4}, dd, dd2)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [call_get(o, "a") for o in ({"a": 0}, dd, dd2, Dict2(a=3), {"a": 4}, ...')

try: print("--- classes with the same layout")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- classes with the same layout"')
try:
    class P1:
        k = "P1"
        def __init__(self): self.x = "p1"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class P1:')
try:
    class P2:
        k = "P2"
        def __init__(self): self.x = "p2"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class P2:')
try:
    def get_k(o): return o.k
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def get_k(o): return o.k')
try: print([(get_x(o), get_k(o)) for o in (P1(), P2(), P1(), P1(), P2(), P2())])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [(get_x(o), get_k(o)) for o in (P1(), P2(), P1(), P1(), P2(), P2())]')

try: print("--- what a cached_property does")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- what a cached_property does"')
try: import functools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import functools')
try:
    class Q:
        calls = 0
        @functools.cached_property
        def x(self):
            Q.calls += 1
            return "computed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Q:')
try: q = Q()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q = Q()')
try: print('warm(get_x, q) =>', warm(get_x, q))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, q)')
try: print('Q.calls =>', Q.calls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Q.calls')
try: print('vars(q) =>', vars(q))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars(q)')
try: del q.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del q.x')
try: print('warm(get_x, q) =>', warm(get_x, q))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, q)')
try: print('Q.calls =>', Q.calls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Q.calls')

try: print("--- classes that come and go")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- classes that come and go"')
try: import gc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc')
try:
    def make(i):
        class Temp:
            def __init__(self): self.x = i
            def m(self): return i
        return Temp
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make(i):')
try: total = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: total = 0')
try:
    for i in range(300):
        try: t = make(i)()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t = make(i)()')
        try: total += get_x(t) + call_m(t)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: total += get_x(t) + call_m(t)')
        try: set_x(t, 0)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: set_x(t, 0)')
        if i % 50 == 0:
            try: gc.collect()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(300):')
try: print(total)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: total')

try: print("--- exceptions and functions have dicts of their own")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- exceptions and functions have dicts of their own"')
try: err = ValueError("v")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: err = ValueError("v")')
try: err.x = "on the exception"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: err.x = "on the exception"')
try:
    def func(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def func(): pass')
try: func.x = "on the function"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: func.x = "on the function"')
try: print([get_x(o) for o in (err, func, err, func)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [get_x(o) for o in (err, func, err, func)]')
try: err2 = ValueError()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: err2 = ValueError()')
try: print(try_(get_x, err2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(get_x, err2)')
try: ValueErrorSub = type("ValueErrorSub", (ValueError,), {"x": "class"})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ValueErrorSub = type("ValueErrorSub", (ValueError,), {"x": "class"})')
try: e3 = ValueErrorSub()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e3 = ValueErrorSub()')
try: print(warm(get_x, e3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, e3)')
try: e3.x = "own"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e3.x = "own"')
try: print(warm(get_x, e3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warm(get_x, e3)')
try: del e3.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del e3.x')
try: print(get_x(e3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: get_x(e3)')
