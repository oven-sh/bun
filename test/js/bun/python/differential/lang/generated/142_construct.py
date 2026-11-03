# Name(...): what is called may or may not be a class, and a class may or may not be made in the common way.
try: import abc, dataclasses, traceback, sys, gc, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import abc, dataclasses, traceback, sys, gc, warnings')

try:
    def try_(f, *a, **k):
        try:
            return f(*a, **k)
        except BaseException as e:
            return type(e).__name__ + ": " + str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def try_(f, *a, **k):')

try:
    class Point:
        def __init__(self, x, y=2, *rest, z=3, **more):
            self.x = x; self.y = y; self.rest = rest; self.z = z; self.more = more
        def __repr__(self): return f"Point({self.x}, {self.y}, {self.rest}, {self.z}, {self.more})"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Point:')

try: print('Point(1) =>', Point(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Point(1)')
try: print('Point(1, 5) =>', Point(1, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Point(1, 5)')
try: print('Point(1, 2, 3, 4) =>', Point(1, 2, 3, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Point(1, 2, 3, 4)')
try: print('Point(1, z=9) =>', Point(1, z=9))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Point(1, z=9)')
try: print('Point(x=1, y=7) =>', Point(x=1, y=7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Point(x=1, y=7)')
try: print('Point(1, w=0) =>', Point(1, w=0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Point(1, w=0)')
try: print('Point(*[1, 2], **{"z": 5}) =>', Point(*[1, 2], **{"z": 5}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Point(*[1, 2], **{"z": 5})')
try: print(try_(lambda: Point()), try_(lambda: Point(1, x=2)), sep="\n")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(try_(lambda: Point()), try_(lambda: Point(1, x=2)), sep="\\n")')
try: print('type(Point(1)) is Point =>', type(Point(1)) is Point)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Point(1)) is Point')
try: print('isinstance(Point(1), Point) =>', isinstance(Point(1), Point))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(Point(1), Point)')

try: print("--- one place, many callees")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- one place, many callees"')
try:
    def Function(*a, **k): return ("function", a, k)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def Function(*a, **k): return ("function", a, k)')
try:
    class NoInit: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoInit: pass')
try:
    class WithNew:
        def __new__(cls, *a): return ("from __new__", a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithNew:')
try:
    class NewAndInit:
        def __new__(cls, v):
            self = super().__new__(cls); self.log = ["new"]; return self
        def __init__(self, v): self.log.append(("init", v))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NewAndInit:')
try:
    class Meta(type):
        def __call__(cls, *a): return ("from the metaclass", cls.__name__, a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta(type):')
try:
    class WithMeta(metaclass=Meta):
        def __init__(self, *a): raise AssertionError
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithMeta(metaclass=Meta):')
try:
    class PlainMeta(type): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class PlainMeta(type): pass')
try:
    class WithPlainMeta(metaclass=PlainMeta):
        def __init__(self, v): self.v = v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithPlainMeta(metaclass=PlainMeta):')
try:
    class Slots:
        __slots__ = ("v",)
        def __init__(self, v): self.v = v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Slots:')
try:
    class Derived(Point):
        def __init__(self, v): super().__init__(v, v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Derived(Point):')
try:
    class Inherits(Point): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Inherits(Point): pass')
try:
    class FromList(list):
        def __init__(self, v): super().__init__([v, v])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class FromList(list):')
try:
    class FromError(ValueError):
        def __init__(self, v): super().__init__("error " + str(v))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class FromError(ValueError):')
try:
    def show(o):
        if isinstance(o, NewAndInit): return o.log
        if isinstance(o, (WithPlainMeta, Slots)): return (type(o).__name__, o.v)
        if isinstance(o, NoInit): return "NoInit"
        return o
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(o):')
try:
    for Callee in (Point, Function, Point, WithNew, NewAndInit, WithMeta, WithPlainMeta, Slots, Derived, Inherits, FromList, FromError, int, str, Point, len, NoInit, 5, None):
        try: print('show(try_(lambda: Callee(1))) [' + 'Callee=' + (repr(Callee) if type(Callee) in (str, int, float, bytes, bool, type(None)) or (type(Callee) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in Callee)) else Callee.__name__ if type(Callee) is type else type(Callee).__name__) + '] =>', show(try_(lambda: Callee(1))))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(try_(lambda: Callee(1)))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for Callee in (Point, Function, Point, WithNew, NewAndInit, WithMeta,...')
try: print('show(NoInit()) =>', show(NoInit()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(NoInit())')
try: print('try_(lambda: NoInit(1)) =>', try_(lambda: NoInit(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(lambda: NoInit(1))')
try: print('try_(lambda: NoInit(a=1)) =>', try_(lambda: NoInit(a=1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(lambda: NoInit(a=1))')

try: print("--- what __init__ returns")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- what __init__ returns"')
try:
    class ReturnsValue:
        def __init__(self): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ReturnsValue:')
try:
    class ReturnsNone:
        def __init__(self): return None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ReturnsNone:')
try:
    class Generator:
        def __init__(self): yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Generator:')
try:
    class Coroutine:
        async def __init__(self): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Coroutine:')
try: print(try_(lambda: ReturnsValue()), type(ReturnsNone()).__name__, try_(lambda: Generator()), sep="\n")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(try_(lambda: ReturnsValue()), type(ReturnsNone()).__name__, try...')
try:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        print(try_(lambda: Coroutine()))
        gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with warnings.catch_warnings():')

try: print("--- __init__ that is not a plain function")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- __init__ that is not a plain function"')
try:
    class StaticInit:
        @staticmethod
        def __init__(*a): print("static", len(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class StaticInit:')
try:
    class ClassInit:
        @classmethod
        def __init__(cls, *a): print("class", cls.__name__, a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ClassInit:')
try:
    class CallableInit:
        class Init:
            def __call__(self, *a): print("callable", a)
        __init__ = Init()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CallableInit:')
try:
    class LambdaInit:
        __init__ = lambda self, v: setattr(self, "v", v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class LambdaInit:')
try:
    class BuiltinInit:
        __init__ = print
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BuiltinInit:')
try: StaticInit(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: StaticInit(1)')
try: ClassInit(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ClassInit(1)')
try: CallableInit(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: CallableInit(1)')
try: print(LambdaInit(4).v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LambdaInit(4).v')
try: print(type(try_(lambda: BuiltinInit("printed"))).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(try_(lambda: BuiltinInit("printed"))).__name__')

try: print("--- the class changes")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- the class changes"')
try:
    class Changing:
        def __init__(self, v): self.v = ("first", v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Changing:')
try:
    def make(v): return Changing(v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make(v): return Changing(v)')
try: print('make(1).v =>', make(1).v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: make(1).v')
try: print('make(2).v =>', make(2).v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: make(2).v')
try: Changing.__init__ = lambda self, v: setattr(self, "v", ("second", v))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Changing.__init__ = lambda self, v: setattr(self, "v", ("second", v))')
try: print(make(3).v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: make(3).v')
try: Changing.__new__ = lambda cls, v: "new took over"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Changing.__new__ = lambda cls, v: "new took over"')
try: print(make(4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: make(4)')
try:
    class Changing:
        def __init__(self, v): self.v = ("another class", v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Changing:')
try: print(make(5).v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: make(5).v')
try: del Changing.__init__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Changing.__init__')
try: print(try_(make, 6))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(make, 6)')
try: Changing.__init__ = lambda self, v: setattr(self, "v", ("third", v))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Changing.__init__ = lambda self, v: setattr(self, "v", ("third", v))')
try: print(make(7).v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: make(7).v')
try:
    class Base1:
        def __init__(self, v): self.v = ("Base1", v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Base1:')
try:
    class Base2:
        def __init__(self, v): self.v = ("Base2", v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Base2:')
try:
    class Child(Base1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Child(Base1): pass')
try:
    def make_child(v): return Child(v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make_child(v): return Child(v)')
try: print(make_child(1).v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: make_child(1).v')
try: Child.__bases__ = (Base2,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Child.__bases__ = (Base2,)')
try: print(make_child(2).v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: make_child(2).v')

try: print("--- abstract classes")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- abstract classes"')
try:
    class Abstract(abc.ABC):
        def __init__(self): print("not reached")
        @abc.abstractmethod
        def f(self): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Abstract(abc.ABC):')
try:
    class Concrete(Abstract):
        def __init__(self): print("Concrete.__init__")
        def f(self): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Concrete(Abstract):')
try: print(try_(lambda: Abstract()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(lambda: Abstract())')
try: print(type(Concrete()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Concrete()).__name__')

try: print("--- order of evaluation, and exceptions")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- order of evaluation, and exceptions"')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
    def arg(v): log.append(v); return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def arg(v): log.append(v); return v')
try:
    class Logs:
        def __init__(self, a, b): log.append(("init", a, b))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Logs:')
try: Logs(arg(1), arg(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Logs(arg(1), arg(2))')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try:
    class Deleted:
        count = 0
        def __init__(self, v): Deleted.count += 1
        def __del__(self): log.append("finalized")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Deleted:')
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try:
    def raises(): raise KeyError("in an argument")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raises(): raise KeyError("in an argument")')
try: print('try_(lambda: Deleted(raises())) =>', try_(lambda: Deleted(raises())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(lambda: Deleted(raises()))')
try: print('Deleted.count =>', Deleted.count)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Deleted.count')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try:
    class Raises:
        def __init__(self, v):
            raise ValueError(v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Raises:')
try:
    def where():
        try:
            Raises(
                "multi-line call")
        except ValueError:
            return [(f.name, f.lineno - where.__code__.co_firstlineno) for f in traceback.extract_tb(sys.exc_info()[2])]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def where():')
try: print(where())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: where()')
try: d = Deleted(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = Deleted(1)')
try: del d
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del d')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')

try: print("--- recursion")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- recursion"')
try:
    class Node:
        def __init__(self, depth): self.child = Node(depth - 1) if depth else None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Node:')
try: n = Node(50)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n = Node(50)')
try: depth = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth = 0')
try:
    while n.child: n = n.child; depth += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while n.child: n = n.child; depth += 1')
try: print(depth)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth')
try:
    class Endless:
        def __init__(self): Endless()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Endless:')
try: print(try_(lambda: Endless())[:40])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(lambda: Endless())[:40]')

try: print("--- names from modules, nested names, generics")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- names from modules, nested names, generics"')
try: import collections, fractions, types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import collections, fractions, types')
try: print('collections.OrderedDict(a=1) =>', collections.OrderedDict(a=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: collections.OrderedDict(a=1)')
try: print('fractions.Fraction(1, 3) =>', fractions.Fraction(1, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fractions.Fraction(1, 3)')
try: print('collections.Counter("aab") =>', collections.Counter("aab"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: collections.Counter("aab")')
try: print('types.SimpleNamespace(a=1) =>', types.SimpleNamespace(a=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: types.SimpleNamespace(a=1)')
try:
    class Outer:
        class Inner:
            def __init__(self, v): self.v = v
        def make(self): return self.Inner(3).v, Outer.Inner(4).v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Outer:')
try: print(Outer().make())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Outer().make()')
try:
    class Generic[T]:
        def __init__(self, v): self.v = v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Generic[T]:')
try: print('Generic(1).v =>', Generic(1).v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Generic(1).v')
try: print('Generic[int](2).v =>', Generic[int](2).v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Generic[int](2).v')
try:
    @dataclasses.dataclass
    class Data:
        a: int
        b: str = "b"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Data:')
try: print('Data(1) =>', Data(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Data(1)')
try: print('Data(1, "c") =>', Data(1, "c"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Data(1, "c")')
try: print('Data(b="x", a=0) =>', Data(b="x", a=0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Data(b="x", a=0)')
try: print('try_(lambda: Data()) =>', try_(lambda: Data()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(lambda: Data())')
try: _Private = Point
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: _Private = Point')
try: print('_Private(1) =>', _Private(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: _Private(1)')
try: print('__builtins__.__dict__["ValueError"]("v") if hasattr(__builtins__, "__... =>', __builtins__.__dict__["ValueError"]("v") if hasattr(__builtins__, "__dict__") else ValueError("v"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: __builtins__.__dict__["ValueError"]("v") if hasattr(__builtins__, "__...')
try: T = lambda v: ("a lambda named T", v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T = lambda v: ("a lambda named T", v)')
try: print(T(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T(1)')
try: print(try_(lambda: Undefined(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(lambda: Undefined(1))')
