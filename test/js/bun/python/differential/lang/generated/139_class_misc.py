try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

# __abstractmethods__ is what makes a class abstract; no abc module is needed for the core mechanism.
try:
    class Abs:
        def f(self): pass
        def g(self): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Abs:')
try: Abs.__abstractmethods__ = frozenset({"f"})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Abs.__abstractmethods__ = frozenset({"f"})')
try: print('Abs() =>', end=" "); t(Abs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(Abs)')
try: Abs.__abstractmethods__ = frozenset({"g", "f"})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Abs.__abstractmethods__ = frozenset({"g", "f"})')
try: print('Abs() =>', end=" "); t(Abs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(Abs)')
try: Abs.__abstractmethods__ = frozenset({"c", "a", "b"})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Abs.__abstractmethods__ = frozenset({"c", "a", "b"})')
try: print('Abs() =>', end=" "); t(Abs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(Abs)')
try: Abs.__abstractmethods__ = frozenset()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Abs.__abstractmethods__ = frozenset()')
try: print(type(Abs()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Abs()).__name__')
try: Abs.__abstractmethods__ = {"f"}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Abs.__abstractmethods__ = {"f"}')
try: print('Abs() =>', end=" "); t(Abs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(Abs)')
try: Abs.__abstractmethods__ = ["f"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Abs.__abstractmethods__ = ["f"]')
try: print('Abs() =>', end=" "); t(Abs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(Abs)')
try: Abs.__abstractmethods__ = "fg"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Abs.__abstractmethods__ = "fg"')
try: print('Abs() =>', end=" "); t(Abs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(Abs)')
try: Abs.__abstractmethods__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Abs.__abstractmethods__ = ()')
try: print('type(Abs()).__name__ =>', type(Abs()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Abs()).__name__')
try: print('Abs.__abstractmethods__ =>', Abs.__abstractmethods__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Abs.__abstractmethods__')
try:
    class AbsSub(Abs): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AbsSub(Abs): pass')
try: Abs.__abstractmethods__ = frozenset({"f"})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Abs.__abstractmethods__ = frozenset({"f"})')
try: print('type(AbsSub()).__name__ =>', type(AbsSub()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(AbsSub()).__name__')
try: print("the flag is per class")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "the flag is per class"')
try: print('AbsSub.__abstractmethods__ =>', end=" "); t(lambda: AbsSub.__abstractmethods__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: AbsSub.__abstractmethods__)')
try: print('object.__abstractmethods__ =>', end=" "); t(lambda: object.__abstractmethods__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__abstractmethods__)')
try: print('int.__abstractmethods__ =>', end=" "); t(lambda: int.__abstractmethods__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: int.__abstractmethods__)')
try: print('type.__abstractmethods__ =>', end=" "); t(lambda: type.__abstractmethods__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__abstractmethods__)')
try: del Abs.__abstractmethods__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Abs.__abstractmethods__')
try: print(type(Abs()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Abs()).__name__')
try: print('Abs.__abstractmethods__ =>', end=" "); t(lambda: Abs.__abstractmethods__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Abs.__abstractmethods__)')
try:
    def d1(): del Abs.__abstractmethods__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d1(): del Abs.__abstractmethods__')
try:
    def d2(): int.__abstractmethods__ = frozenset()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d2(): int.__abstractmethods__ = frozenset()')
try:
    def d3(): Abs.__abstractmethods__ = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d3(): Abs.__abstractmethods__ = 5')
try: print('d1() =>', end=" "); t(d1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(d1)')
try: print('d2() =>', end=" "); t(d2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(d2)')
try: print('d3() =>', end=" "); t(d3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(d3)')
try: print('Abs() =>', end=" "); t(Abs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(Abs)')
try:
    class AbsNew:
        def __new__(cls): return "custom __new__ that never reaches object.__new__"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AbsNew:')
try: AbsNew.__abstractmethods__ = frozenset({"x"})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: AbsNew.__abstractmethods__ = frozenset({"x"})')
try: print(AbsNew())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: AbsNew()')
try:
    class AbsTuple(tuple): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AbsTuple(tuple): pass')
try: AbsTuple.__abstractmethods__ = frozenset({"x"})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: AbsTuple.__abstractmethods__ = frozenset({"x"})')
try: print('AbsTuple() =>', end=" "); t(AbsTuple)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(AbsTuple)')
try:
    class AbsExc(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AbsExc(Exception): pass')
try: AbsExc.__abstractmethods__ = frozenset({"x"})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: AbsExc.__abstractmethods__ = frozenset({"x"})')
try: print('type(AbsExc()).__name__ =>', end=" "); t(lambda: type(AbsExc()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(AbsExc()).__name__)')
# __class__ assignment.
try:
    class A:
        def who(self): return "A"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A:')
try:
    class B:
        def who(self): return "B"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B:')
try:
    class C(A):
        def who(self): return "C"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C(A):')
try: o = A()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = A()')
try: o.v = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.v = 1')
try: o.__class__ = B
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__class__ = B')
try: print('o.who() =>', o.who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.who()')
try: print('type(o).__name__ =>', type(o).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(o).__name__')
try: print('isinstance(o, A) =>', isinstance(o, A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(o, A)')
try: print('isinstance(o, B) =>', isinstance(o, B))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(o, B)')
try: print('o.v =>', o.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.v')
try: o.__class__ = C
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__class__ = C')
try: print('o.who() =>', o.who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.who()')
try: print('isinstance(o, A) =>', isinstance(o, A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(o, A)')
try:
    for target in (int, str, object, type, 5, None, list, type("S", (), {"__slots__": ("a",)}), type("L", (list,), {}), type("E", (Exception,), {})):
        try: o.__class__ = target; print("ok", target)
        except TypeError as e: print("TypeError:", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for target in (int, str, object, type, 5, None, list, type("S", (), {...')
try:
    def c1(): (1).__class__ = int
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c1(): (1).__class__ = int')
try:
    def c2(): [].__class__ = type("L", (list,), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c2(): [].__class__ = type("L", (list,), {})')
try:
    def c3(): object().__class__ = A
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c3(): object().__class__ = A')
try:
    def c4(): A.__class__ = type
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c4(): A.__class__ = type')
try:
    def c5(): del o.__class__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c5(): del o.__class__')
try:
    def c6(): None.__class__ = A
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c6(): None.__class__ = A')
try:
    def c7(): (lambda: 0).__class__ = A
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c7(): (lambda: 0).__class__ = A')
try:
    for c in (c1, c2, c3, c4, c5, c6, c7): t(c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for c in (c1, c2, c3, c4, c5, c6, c7): t(c)')
try:
    class L1(list): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L1(list): pass')
try:
    class L2(list):
        def first(self): return self[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L2(list):')
try: l = L1([1, 2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = L1([1, 2])')
try: l.__class__ = L2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l.__class__ = L2')
try: print('l.first() =>', l.first())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l.first()')
try: print('type(l).__name__ =>', type(l).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(l).__name__')
try: print('l =>', l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try:
    class M1(type): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M1(type): pass')
try:
    class M2(type): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M2(type): pass')
try:
    class WithMeta(metaclass=M1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithMeta(metaclass=M1): pass')
try: WithMeta.__class__ = M2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: WithMeta.__class__ = M2')
try: print(type(WithMeta).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(WithMeta).__name__')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: Mod = type(sys)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Mod = type(sys)')
try:
    class ModSub(Mod):
        @property
        def answer(self): return 42
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ModSub(Mod):')
try: mod = Mod("m")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mod = Mod("m")')
try: mod.__class__ = ModSub
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mod.__class__ = ModSub')
try: print('mod.answer =>', mod.answer)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mod.answer')
try: print('type(mod).__name__ =>', type(mod).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(mod).__name__')
# __subclasses__, __subclasshook__, __bases__, __base__, __mro__.
try:
    class R: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R: pass')
try:
    class R1(R): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R1(R): pass')
try:
    class R2(R): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R2(R): pass')
try:
    class R11(R1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R11(R1): pass')
try: print('[c.__name__ for c in R.__subclasses__()] =>', [c.__name__ for c in R.__subclasses__()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in R.__subclasses__()]')
try: print('[c.__name__ for c in R1.__subclasses__()] =>', [c.__name__ for c in R1.__subclasses__()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in R1.__subclasses__()]')
try: print('R11.__subclasses__() =>', R11.__subclasses__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: R11.__subclasses__()')
try: print('R11.__base__.__name__ =>', R11.__base__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: R11.__base__.__name__')
try: print('R11.__bases__ =>', R11.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: R11.__bases__')
try: print('[c.__name__ for c in R11.__mro__] =>', [c.__name__ for c in R11.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in R11.__mro__]')
try: print('object.__base__ =>', object.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__base__')
try: print('object.__bases__ =>', object.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__bases__')
try: print('type.__base__ =>', type.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__base__')
try: print('int.__base__ =>', int.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int.__base__')
try: print('bool.__base__ =>', bool.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool.__base__')
try: print('bool.__bases__ =>', bool.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool.__bases__')
try: print('R.__subclasshook__(R1) =>', R.__subclasshook__(R1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: R.__subclasshook__(R1)')
try: print('object.__subclasshook__(int) =>', object.__subclasshook__(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__subclasshook__(int)')
try: print('type(R.__subclasses__).__name__ =>', type(R.__subclasses__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(R.__subclasses__).__name__')
try: print('int in object.__subclasses__() =>', int in object.__subclasses__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int in object.__subclasses__()')
try: print('bool in int.__subclasses__() =>', bool in int.__subclasses__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool in int.__subclasses__()')
try:
    class Multi(R1, R2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Multi(R1, R2): pass')
try: print('Multi.__base__.__name__ =>', Multi.__base__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Multi.__base__.__name__')
try: print('[c.__name__ for c in Multi.__bases__] =>', [c.__name__ for c in Multi.__bases__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Multi.__bases__]')
try: print('[c.__name__ for c in R2.__subclasses__()] =>', [c.__name__ for c in R2.__subclasses__()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in R2.__subclasses__()]')
try:
    class DictAndR(R, dict): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class DictAndR(R, dict): pass')
try:
    class IntAndR(R, int): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class IntAndR(R, int): pass')
try: print('DictAndR.__base__ =>', DictAndR.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: DictAndR.__base__')
try: print('IntAndR.__base__ =>', IntAndR.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: IntAndR.__base__')
try: print('DictAndR.__bases__[0].__name__ =>', DictAndR.__bases__[0].__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: DictAndR.__bases__[0].__name__')
try:
    def b1(): R.__mro__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b1(): R.__mro__ = ()')
try:
    def b2(): R.__base__ = object
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b2(): R.__base__ = object')
try:
    def b3(): del R.__bases__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b3(): del R.__bases__')
try:
    def b4(): R.__bases__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b4(): R.__bases__ = ()')
try:
    def b5(): R.__bases__ = (R,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b5(): R.__bases__ = (R,)')
try:
    def b6(): R.__bases__ = (R1,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b6(): R.__bases__ = (R1,)')
try:
    def b7(): R.__bases__ = [object]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b7(): R.__bases__ = [object]')
try:
    def b8(): R.__bases__ = (1,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b8(): R.__bases__ = (1,)')
try:
    def b9(): object.__bases__ = (R,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b9(): object.__bases__ = (R,)')
try:
    def b10(): R.__bases__ = (int,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b10(): R.__bases__ = (int,)')
try:
    for b in (b1, b2, b3, b4, b5, b6, b7, b8, b9, b10): t(b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for b in (b1, b2, b3, b4, b5, b6, b7, b8, b9, b10): t(b)')
# Names: __name__, __qualname__, __module__, __doc__.
try:
    def outer():
        class Local:
            class Nested:
                def m(self): pass
            def m(self):
                def inner(): pass
                return inner
            lam = lambda self: 0
        return Local
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer():')
try: Lc = outer()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Lc = outer()')
try: print('Lc.__name__ =>', Lc.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Lc.__name__')
try: print('Lc.__qualname__ =>', Lc.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Lc.__qualname__')
try: print('Lc.Nested.__qualname__ =>', Lc.Nested.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Lc.Nested.__qualname__')
try: print('Lc.Nested.m.__qualname__ =>', Lc.Nested.m.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Lc.Nested.m.__qualname__')
try: print('Lc.m.__qualname__ =>', Lc.m.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Lc.m.__qualname__')
try: print('Lc().m().__qualname__ =>', Lc().m().__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Lc().m().__qualname__')
try: print('Lc.lam.__qualname__ =>', Lc.lam.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Lc.lam.__qualname__')
try: print('Lc.__module__ =>', Lc.__module__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Lc.__module__')
try: print('repr(Lc) =>', repr(Lc))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(Lc)')
try: print('repr(Lc.Nested) =>', repr(Lc.Nested))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(Lc.Nested)')
try: print('repr(Lc())[:40] =>', repr(Lc())[:40])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(Lc())[:40]')
try: print('repr(Lc.m)[:38] =>', repr(Lc.m)[:38])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(Lc.m)[:38]')
try:
    class Doc:
        "class doc"
        def m(self):
            "method doc"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Doc:')
try:
    class NoDoc(Doc):
        def m(self): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoDoc(Doc):')
try:
    class DocAttr: __doc__ = "explicit"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class DocAttr: __doc__ = "explicit"')
try:
    class DocProp:
        __doc__ = property(lambda self: "dynamic doc")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class DocProp:')
try: print('Doc.__doc__ =>', Doc.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc.__doc__')
try: print('Doc().__doc__ =>', Doc().__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc().__doc__')
try: print('NoDoc.__doc__ =>', NoDoc.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NoDoc.__doc__')
try: print('NoDoc.m.__doc__ =>', NoDoc.m.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NoDoc.m.__doc__')
try: print('Doc.m.__doc__ =>', Doc.m.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc.m.__doc__')
try: print('DocAttr.__doc__ =>', DocAttr.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: DocAttr.__doc__')
try: print('DocProp().__doc__ =>', DocProp().__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: DocProp().__doc__')
try: print('type(DocProp.__doc__).__name__ =>', type(DocProp.__doc__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(DocProp.__doc__).__name__')
try: print('type(int.__doc__).__name__ =>', type(int.__doc__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(int.__doc__).__name__')
try: print('type(len.__doc__).__name__ =>', type(len.__doc__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(len.__doc__).__name__')
try: print('(lambda: 0).__doc__ =>', (lambda: 0).__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda: 0).__doc__')
try: print('type(object.__doc__).__name__ =>', type(object.__doc__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(object.__doc__).__name__')
try: print('type(type.__doc__).__name__ =>', type(type.__doc__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(type.__doc__).__name__')
try: Doc.__doc__ = "changed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc.__doc__ = "changed"')
try: print(Doc.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc.__doc__')
try: print('delattr(Doc, "__doc__") =>', end=" "); t(lambda: delattr(Doc, "__doc__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: delattr(Doc, "__doc__"))')
try: print(Doc.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc.__doc__')
try:
    def n1(): Doc.__name__ = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n1(): Doc.__name__ = 5')
try:
    def n2(): Doc.__name__ = "a\0b"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n2(): Doc.__name__ = "a\\0b"')
try:
    def n3(): Doc.__qualname__ = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n3(): Doc.__qualname__ = 5')
try:
    def n4(): int.__name__ = "x"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n4(): int.__name__ = "x"')
try:
    def n5(): del Doc.__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n5(): del Doc.__name__')
try:
    def n6(): del Doc.__qualname__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n6(): del Doc.__qualname__')
try:
    def n7(): int.__doc__ = "x"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n7(): int.__doc__ = "x"')
try:
    def n8(): del Doc.__module__; return Doc.__module__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n8(): del Doc.__module__; return Doc.__module__')
try:
    def n9(): int.__module__ = "x"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n9(): int.__module__ = "x"')
try:
    for n in (n1, n2, n3, n4, n5, n6, n7, n8, n9): t(n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for n in (n1, n2, n3, n4, n5, n6, n7, n8, n9): t(n)')
try: Doc.__name__ = "Renamed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc.__name__ = "Renamed"')
try: Doc.__qualname__ = "Q.Renamed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc.__qualname__ = "Q.Renamed"')
try: Doc.__module__ = "some.mod"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc.__module__ = "some.mod"')
try: print('Doc.__name__ =>', Doc.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc.__name__')
try: print('repr(Doc) =>', repr(Doc))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(Doc)')
try: print('repr(Doc())[:28] =>', repr(Doc())[:28])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(Doc())[:28]')
try: print('Doc.m.__qualname__ =>', Doc.m.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc.m.__qualname__')
try: Doc.__module__ = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc.__module__ = 5')
try: print(repr(Doc))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(Doc)')
try: Doc.__module__ = "builtins"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc.__module__ = "builtins"')
try: print(repr(Doc))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(Doc)')
try: Doc.__module__ = "__main__"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Doc.__module__ = "__main__"')
try: print(repr(Doc))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(Doc)')
# object's own methods.
try: ob = object()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob = object()')
try: print('ob.__eq__(ob) =>', ob.__eq__(ob))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__eq__(ob)')
try: print('ob.__eq__(1) =>', ob.__eq__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__eq__(1)')
try: print('ob.__ne__(ob) =>', ob.__ne__(ob))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__ne__(ob)')
try: print('ob.__ne__(1) =>', ob.__ne__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__ne__(1)')
try: print('ob.__lt__(1) =>', ob.__lt__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__lt__(1)')
try: print('ob.__hash__() == hash(ob) =>', ob.__hash__() == hash(ob))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__hash__() == hash(ob)')
try: print('ob.__repr__()[:17] =>', ob.__repr__()[:17])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__repr__()[:17]')
try: print('ob.__str__()[:17] =>', ob.__str__()[:17])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__str__()[:17]')
try: print('ob.__format__("")[:17] =>', ob.__format__("")[:17])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__format__("")[:17]')
try: print('ob.__class__ =>', ob.__class__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__class__')
try: print('type(ob.__doc__).__name__ =>', type(ob.__doc__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(ob.__doc__).__name__')
try: print('ob.__init__() =>', ob.__init__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__init__()')
try: print('ob.__dir__() == dir(ob) or sorted(ob.__dir__()) == dir(ob) =>', ob.__dir__() == dir(ob) or sorted(ob.__dir__()) == dir(ob))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__dir__() == dir(ob) or sorted(ob.__dir__()) == dir(ob)')
try: print('ob.__sizeof__() > 0 =>', ob.__sizeof__() > 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__sizeof__() > 0')
try: print('ob.__init_subclass__() =>', ob.__init_subclass__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__init_subclass__()')
try: print('ob.__subclasshook__(int) =>', ob.__subclasshook__(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__subclasshook__(int)')
try: print('ob.__getstate__() =>', ob.__getstate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ob.__getstate__()')
try: print('type(ob.__reduce_ex__(2)).__name__ =>', type(ob.__reduce_ex__(2)).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(ob.__reduce_ex__(2)).__name__')
try: print('object.__new__(object).__class__ =>', object.__new__(object).__class__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__new__(object).__class__')
try: print('object.__call__().__class__ =>', object.__call__().__class__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__call__().__class__')
try: print('object().__setattr__.__name__ =>', object().__setattr__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object().__setattr__.__name__')
try: print('object.__eq__(1, 1) =>', object.__eq__(1, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__eq__(1, 1)')
try: print('object.__eq__(1, 2) =>', object.__eq__(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__eq__(1, 2)')
try: print('object.__hash__(1) == object.__hash__(1) =>', object.__hash__(1) == object.__hash__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__hash__(1) == object.__hash__(1)')
try: print('object.__repr__(1)[:14] =>', object.__repr__(1)[:14])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__repr__(1)[:14]')
try: print('object.__str__(1) =>', object.__str__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__str__(1)')
try: print('object.__ne__(1, 1) =>', object.__ne__(1, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__ne__(1, 1)')
try: print('object.__getattribute__(1, "real") =>', object.__getattribute__(1, "real"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__getattribute__(1, "real")')
try: print('object.__dir__(1) == (1).__dir__() =>', object.__dir__(1) == (1).__dir__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__dir__(1) == (1).__dir__()')
try: print('object(1) =>', end=" "); t(lambda: object(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object(1))')
try: print('object(a=1) =>', end=" "); t(lambda: object(a=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object(a=1))')
try: print('object.__new__() =>', end=" "); t(lambda: object.__new__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__new__())')
try: print('object.__new__(1) =>', end=" "); t(lambda: object.__new__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__new__(1))')
try: print('object.__new__(int) =>', end=" "); t(lambda: object.__new__(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__new__(int))')
try: print('object.__new__(list) =>', end=" "); t(lambda: object.__new__(list))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__new__(list))')
try: print('object.__new__(type) =>', end=" "); t(lambda: object.__new__(type))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__new__(type))')
try: print('object.__init__() =>', end=" "); t(lambda: object.__init__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__init__())')
try: print('object.__init__(ob, 1) =>', end=" "); t(lambda: object.__init__(ob, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__init__(ob, 1))')
try: print('ob.__format__("x") =>', end=" "); t(lambda: ob.__format__("x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ob.__format__("x"))')
try: print('ob.__reduce_ex__() =>', end=" "); t(lambda: ob.__reduce_ex__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ob.__reduce_ex__())')
try: print('ob.x =>', end=" "); t(lambda: ob.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ob.x)')
try: print('setattr(ob, "x", 1) =>', end=" "); t(lambda: setattr(ob, "x", 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: setattr(ob, "x", 1))')
try: print('ob.__dict__ =>', end=" "); t(lambda: ob.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ob.__dict__)')
try: print('ob < ob =>', end=" "); t(lambda: ob < ob)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ob < ob)')
try: print('ob() =>', end=" "); t(lambda: ob())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ob())')
try: print('len(ob) =>', end=" "); t(lambda: len(ob))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len(ob))')
try: print('int.__new__(object) =>', end=" "); t(lambda: int.__new__(object))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: int.__new__(object))')
try: print('int.__new__(str) =>', end=" "); t(lambda: int.__new__(str))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: int.__new__(str))')
try: print('int.__new__(bool) =>', end=" "); t(lambda: int.__new__(bool))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: int.__new__(bool))')
try: print('list.__new__(dict) =>', end=" "); t(lambda: list.__new__(dict))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list.__new__(dict))')
try: print('tuple.__new__(A) =>', end=" "); t(lambda: tuple.__new__(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: tuple.__new__(A))')
try: print('A.__new__(int) =>', end=" "); t(lambda: A.__new__(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A.__new__(int))')
try: print('object.__new__(A).who() =>', end=" "); t(lambda: object.__new__(A).who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__new__(A).who())')
try: print('dict.__new__(type("D", (dict,), {})) =>', end=" "); t(lambda: dict.__new__(type("D", (dict,), {})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: dict.__new__(type("D", (dict,), {})))')
try:
    class St:
        def __init__(self): self.a = 1; self.b = [2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class St:')
try:
    class StSlots:
        __slots__ = ("x", "y")
        def __init__(self): self.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class StSlots:')
try:
    class StBoth(StSlots):
        def __init__(self): super().__init__(); self.z = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class StBoth(StSlots):')
try:
    class StEmpty: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class StEmpty: pass')
try: print('St().__getstate__() =>', St().__getstate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: St().__getstate__()')
try: print('StSlots().__getstate__() =>', StSlots().__getstate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: StSlots().__getstate__()')
try: print('StBoth().__getstate__() =>', StBoth().__getstate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: StBoth().__getstate__()')
try: print('StEmpty().__getstate__() =>', StEmpty().__getstate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: StEmpty().__getstate__()')
try: print('(1).__getstate__() =>', (1).__getstate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (1).__getstate__()')
try: print('"s".__getstate__() =>', "s".__getstate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "s".__getstate__()')
try: print('[].__getstate__() =>', [].__getstate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [].__getstate__()')
try: print('St().__getstate__() is not St().__dict__ =>', St().__getstate__() is not St().__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: St().__getstate__() is not St().__dict__')
try: print('St().__reduce_ex__(2)[1:] =>', St().__reduce_ex__(2)[1:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: St().__reduce_ex__(2)[1:]')
try: print('St().__reduce_ex__(4)[0].__name__ =>', St().__reduce_ex__(4)[0].__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: St().__reduce_ex__(4)[0].__name__')
try: print('type("LS", (list,), {})([1]).__reduce_ex__(2)[1] =>', type("LS", (list,), {})([1]).__reduce_ex__(2)[1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type("LS", (list,), {})([1]).__reduce_ex__(2)[1]')
try: print('list(type("LS", (list,), {})([1, 2]).__reduce_ex__(2)[3]) =>', list(type("LS", (list,), {})([1, 2]).__reduce_ex__(2)[3]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(type("LS", (list,), {})([1, 2]).__reduce_ex__(2)[3])')
try: print('list(type("DS", (dict,), {})(a=1).__reduce_ex__(2)[4]) =>', list(type("DS", (dict,), {})(a=1).__reduce_ex__(2)[4]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(type("DS", (dict,), {})(a=1).__reduce_ex__(2)[4])')
# Instance dictionaries.
try:
    class P: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class P: pass')
try: p = P()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = P()')
try: p.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.a = 1')
try: print('p.__dict__ =>', p.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__dict__')
try: print('vars(p) is p.__dict__ =>', vars(p) is p.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars(p) is p.__dict__')
try: p.__dict__["b"] = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__dict__["b"] = 2')
try: print(p.b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.b')
try: p.__dict__ = {"c": 3}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__dict__ = {"c": 3}')
try: print('p.c =>', p.c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.c')
try: print('hasattr(p, "a") =>', hasattr(p, "a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(p, "a")')
try: d = {"shared": 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = {"shared": 1}')
try: q1, q2 = P(), P()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q1, q2 = P(), P()')
try: q1.__dict__ = d
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q1.__dict__ = d')
try: q2.__dict__ = d
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q2.__dict__ = d')
try: q1.x = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q1.x = 5')
try: print('q2.x =>', q2.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q2.x')
try: print('q2.__dict__ is d =>', q2.__dict__ is d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q2.__dict__ is d')
try: del p.__dict__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del p.__dict__')
try: print(p.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__dict__')
try: p.__dict__[1] = "non-string key"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__dict__[1] = "non-string key"')
try: print('p.__dict__ =>', p.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__dict__')
try: print('dir(p)[-1:] if False else "" =>', dir(p)[-1:] if False else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dir(p)[-1:] if False else ""')
try:
    class DSub(dict):
        def __getitem__(self, k): return "never used for attribute lookup"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class DSub(dict):')
try: p.__dict__ = DSub(z=1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__dict__ = DSub(z=1)')
try: print('p.z =>', p.z)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.z')
try: print('type(p.__dict__).__name__ =>', type(p.__dict__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(p.__dict__).__name__')
try:
    def s1(): p.__dict__ = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s1(): p.__dict__ = 5')
try:
    def s2(): p.__dict__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s2(): p.__dict__ = None')
try:
    def s3(): p.__dict__ = [("a", 1)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s3(): p.__dict__ = [("a", 1)]')
try:
    def s4(): P.__dict__ = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s4(): P.__dict__ = {}')
try:
    def s5(): P.__dict__["x"] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s5(): P.__dict__["x"] = 1')
try:
    def s6(): del P.__dict__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s6(): del P.__dict__')
try:
    def s7(): p.__dict__ = P.__dict__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s7(): p.__dict__ = P.__dict__')
try:
    for s in (s1, s2, s3, s4, s5, s6, s7): t(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for s in (s1, s2, s3, s4, s5, s6, s7): t(s)')
try: print('type(P.__dict__).__name__ =>', type(P.__dict__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(P.__dict__).__name__')
try: print('"__dict__" in P.__dict__ =>', "__dict__" in P.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__dict__" in P.__dict__')
try: print('"__weakref__" in P.__dict__ =>', "__weakref__" in P.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__weakref__" in P.__dict__')
try: print('type(P.__dict__["__dict__"]).__name__ =>', type(P.__dict__["__dict__"]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(P.__dict__["__dict__"]).__name__')
try: print('P.__dict__["__dict__"].__get__(q1) is d =>', P.__dict__["__dict__"].__get__(q1) is d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.__dict__["__dict__"].__get__(q1) is d')
try: print('sorted(P.__dict__) =>', sorted(P.__dict__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(P.__dict__)')
try: print('P.__dict__.get("nope") =>', P.__dict__.get("nope"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.__dict__.get("nope")')
try: print('len(P.__dict__) == len(list(P.__dict__)) =>', len(P.__dict__) == len(list(P.__dict__)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(P.__dict__) == len(list(P.__dict__))')
try: print('P.__dict__ == P.__dict__ =>', P.__dict__ == P.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.__dict__ == P.__dict__')
try: print('P.__dict__.copy() == dict(P.__dict__) =>', P.__dict__.copy() == dict(P.__dict__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.__dict__.copy() == dict(P.__dict__)')
try: print('"__module__" in P.__dict__ =>', "__module__" in P.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__module__" in P.__dict__')
try: print('P.__dict__["__module__"] =>', P.__dict__["__module__"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.__dict__["__module__"]')
try: many = P()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: many = P()')
try:
    for i in range(50): setattr(many, "a%d" % i, i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(50): setattr(many, "a%d" % i, i)')
try:
    for i in range(0, 50, 2): delattr(many, "a%d" % i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(0, 50, 2): delattr(many, "a%d" % i)')
try: print('len(many.__dict__) =>', len(many.__dict__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(many.__dict__)')
try: print('list(many.__dict__)[:4] =>', list(many.__dict__)[:4])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(many.__dict__)[:4]')
try: print('many.a49 =>', many.a49)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: many.a49')
try: print('sum(many.__dict__.values()) =>', sum(many.__dict__.values()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(many.__dict__.values())')
try: objs = [P() for _ in range(5)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: objs = [P() for _ in range(5)]')
try:
    for i, ob_ in enumerate(objs):
        for name in ("x", "y", "z")[i % 3:] + ("x", "y", "z")[:i % 3]: setattr(ob_, name, i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i, ob_ in enumerate(objs):')
try: print([list(o_.__dict__) for o_ in objs])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [list(o_.__dict__) for o_ in objs]')
# Class attributes versus instance attributes.
try:
    class Cnt:
        n = 0; items = []
        def bump(self): self.n += 1; self.items.append(self.n); return self
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Cnt:')
try: c1_, c2_ = Cnt().bump().bump(), Cnt().bump()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1_, c2_ = Cnt().bump().bump(), Cnt().bump()')
try: print('c1_.n =>', c1_.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1_.n')
try: print('c2_.n =>', c2_.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2_.n')
try: print('Cnt.n =>', Cnt.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Cnt.n')
try: print('Cnt.items =>', Cnt.items)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Cnt.items')
try: print('c1_.items is c2_.items =>', c1_.items is c2_.items)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1_.items is c2_.items')
try: print('c1_.__dict__ =>', c1_.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1_.__dict__')
try: print('"n" in Cnt.__dict__ =>', "n" in Cnt.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "n" in Cnt.__dict__')
try: del c1_.n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del c1_.n')
try: print(c1_.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1_.n')
try: Cnt.n = 10
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Cnt.n = 10')
try: print('c1_.n =>', c1_.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1_.n')
try: print('c2_.n =>', c2_.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2_.n')
try: print('delattr(c1_, "n") =>', end=" "); t(lambda: delattr(c1_, "n"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: delattr(c1_, "n"))')
try: Cnt.late = "added later"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Cnt.late = "added later"')
try: print('c1_.late =>', c1_.late)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1_.late')
try: print('c2_.late =>', c2_.late)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2_.late')
try: del Cnt.late
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Cnt.late')
try: print('c1_.late =>', end=" "); t(lambda: c1_.late)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: c1_.late)')
try: Cnt.bump = lambda self: "patched"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Cnt.bump = lambda self: "patched"')
try: print(c1_.bump())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1_.bump()')
try: c1_.bump = lambda: "instance function, no self"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1_.bump = lambda: "instance function, no self"')
try: print('c1_.bump() =>', c1_.bump())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1_.bump()')
try: print('c2_.bump() =>', c2_.bump())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2_.bump()')
try: del c1_.bump
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del c1_.bump')
try: print(c1_.bump())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1_.bump()')
# Callable classes, classes as values.
try: classes = {"a": A, "b": B}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: classes = {"a": A, "b": B}')
try: print('[classes[k]().who() for k in sorted(classes)] =>', [classes[k]().who() for k in sorted(classes)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [classes[k]().who() for k in sorted(classes)]')
try: print('[cls.__name__ for cls in (A, B, C)] =>', [cls.__name__ for cls in (A, B, C)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [cls.__name__ for cls in (A, B, C)]')
try: print('(A if True else B)().who() =>', (A if True else B)().who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (A if True else B)().who()')
try: print('[k().who() for k in [A, B] * 2] =>', [k().who() for k in [A, B] * 2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [k().who() for k in [A, B] * 2]')
try: print('sorted([C, A, B], key=lambda k: k.__name__)[0].__name__ =>', sorted([C, A, B], key=lambda k: k.__name__)[0].__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted([C, A, B], key=lambda k: k.__name__)[0].__name__')
try: print('{A: 1}[A] =>', {A: 1}[A])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {A: 1}[A]')
try: print('A == A =>', A == A)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A == A')
try: print('A != B =>', A != B)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A != B')
try: print('A is A =>', A is A)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A is A')
try: print('hash(A) == hash(A) =>', hash(A) == hash(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(A) == hash(A)')
try: print('isinstance(A, type) =>', isinstance(A, type))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(A, type)')
try: print('callable(A) =>', callable(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: callable(A)')
try: print('type(A)("Dyn", (A,), {})().who() =>', type(A)("Dyn", (A,), {})().who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(A)("Dyn", (A,), {})().who()')
try: print('max([A, B, C], key=lambda k: len(k.__mro__)).__name__ =>', max([A, B, C], key=lambda k: len(k.__mro__)).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max([A, B, C], key=lambda k: len(k.__mro__)).__name__')
try: print('A < B =>', end=" "); t(lambda: A < B)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A < B)')
try: print('A + B =>', end=" "); t(lambda: A + B)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A + B)')
try: print('A[0] =>', end=" "); t(lambda: A[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A[0])')
try: print('len(A) =>', end=" "); t(lambda: len(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len(A))')
try: print('iter(A) =>', end=" "); t(lambda: iter(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: iter(A))')
try: print('A.who() =>', end=" "); t(lambda: A.who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A.who())')
try: print('A.who(1) =>', end=" "); t(lambda: A.who(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A.who(1))')
try: print('A.who(B()) =>', end=" "); t(lambda: A.who(B()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A.who(B()))')
try: print('A().who(1) =>', end=" "); t(lambda: A().who(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A().who(1))')
try: print('A(1) =>', end=" "); t(lambda: A(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A(1))')
try: print('A.nope =>', end=" "); t(lambda: A.nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A.nope)')
try: print('A().nope =>', end=" "); t(lambda: A().nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A().nope)')
try: print('-A =>', end=" "); t(lambda: -A)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: -A)')
try: print('A()() =>', end=" "); t(lambda: A()())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A()())')
try: print('A() + 1 =>', end=" "); t(lambda: A() + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A() + 1)')
try: print('A() < A() =>', end=" "); t(lambda: A() < A())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A() < A())')
try: print('int(A()) =>', end=" "); t(lambda: int(A()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: int(A()))')
try: print('str(A)[:8] =>', end=" "); t(lambda: str(A)[:8])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: str(A)[:8])')
