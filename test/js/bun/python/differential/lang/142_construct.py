# Name(...): what is called may or may not be a class, and a class may or may not be made in the common way.
import abc, dataclasses, traceback, sys, gc, warnings

def try_(f, *a, **k):
    try:
        return f(*a, **k)
    except BaseException as e:
        return type(e).__name__ + ": " + str(e)

class Point:
    def __init__(self, x, y=2, *rest, z=3, **more):
        self.x = x; self.y = y; self.rest = rest; self.z = z; self.more = more
    def __repr__(self): return f"Point({self.x}, {self.y}, {self.rest}, {self.z}, {self.more})"

print(Point(1), Point(1, 5), Point(1, 2, 3, 4), Point(1, z=9), Point(x=1, y=7), Point(1, w=0), Point(*[1, 2], **{"z": 5}))
print(try_(lambda: Point()), try_(lambda: Point(1, x=2)), sep="\n")
print(type(Point(1)) is Point, isinstance(Point(1), Point))

print("--- one place, many callees")
def Function(*a, **k): return ("function", a, k)
class NoInit: pass
class WithNew:
    def __new__(cls, *a): return ("from __new__", a)
class NewAndInit:
    def __new__(cls, v):
        self = super().__new__(cls); self.log = ["new"]; return self
    def __init__(self, v): self.log.append(("init", v))
class Meta(type):
    def __call__(cls, *a): return ("from the metaclass", cls.__name__, a)
class WithMeta(metaclass=Meta):
    def __init__(self, *a): raise AssertionError
class PlainMeta(type): pass
class WithPlainMeta(metaclass=PlainMeta):
    def __init__(self, v): self.v = v
class Slots:
    __slots__ = ("v",)
    def __init__(self, v): self.v = v
class Derived(Point):
    def __init__(self, v): super().__init__(v, v)
class Inherits(Point): pass
class FromList(list):
    def __init__(self, v): super().__init__([v, v])
class FromError(ValueError):
    def __init__(self, v): super().__init__("error " + str(v))
def show(o):
    if isinstance(o, NewAndInit): return o.log
    if isinstance(o, (WithPlainMeta, Slots)): return (type(o).__name__, o.v)
    if isinstance(o, NoInit): return "NoInit"
    return o
for Callee in (Point, Function, Point, WithNew, NewAndInit, WithMeta, WithPlainMeta, Slots, Derived, Inherits, FromList, FromError, int, str, Point, len, NoInit, 5, None):
    print(show(try_(lambda: Callee(1))))
print(show(NoInit()), try_(lambda: NoInit(1)), try_(lambda: NoInit(a=1)))

print("--- what __init__ returns")
class ReturnsValue:
    def __init__(self): return 5
class ReturnsNone:
    def __init__(self): return None
class Generator:
    def __init__(self): yield 1
class Coroutine:
    async def __init__(self): pass
print(try_(lambda: ReturnsValue()), type(ReturnsNone()).__name__, try_(lambda: Generator()), sep="\n")
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    print(try_(lambda: Coroutine()))
    gc.collect()

print("--- __init__ that is not a plain function")
class StaticInit:
    @staticmethod
    def __init__(*a): print("static", len(a))
class ClassInit:
    @classmethod
    def __init__(cls, *a): print("class", cls.__name__, a)
class CallableInit:
    class Init:
        def __call__(self, *a): print("callable", a)
    __init__ = Init()
class LambdaInit:
    __init__ = lambda self, v: setattr(self, "v", v)
class BuiltinInit:
    __init__ = print
StaticInit(1); ClassInit(1); CallableInit(1); print(LambdaInit(4).v); print(type(try_(lambda: BuiltinInit("printed"))).__name__)

print("--- the class changes")
class Changing:
    def __init__(self, v): self.v = ("first", v)
def make(v): return Changing(v)
print(make(1).v, make(2).v)
Changing.__init__ = lambda self, v: setattr(self, "v", ("second", v))
print(make(3).v)
Changing.__new__ = lambda cls, v: "new took over"
print(make(4))
class Changing:
    def __init__(self, v): self.v = ("another class", v)
print(make(5).v)
del Changing.__init__
print(try_(make, 6))
Changing.__init__ = lambda self, v: setattr(self, "v", ("third", v))
print(make(7).v)
class Base1:
    def __init__(self, v): self.v = ("Base1", v)
class Base2:
    def __init__(self, v): self.v = ("Base2", v)
class Child(Base1): pass
def make_child(v): return Child(v)
print(make_child(1).v)
Child.__bases__ = (Base2,)
print(make_child(2).v)

print("--- abstract classes")
class Abstract(abc.ABC):
    def __init__(self): print("not reached")
    @abc.abstractmethod
    def f(self): pass
class Concrete(Abstract):
    def __init__(self): print("Concrete.__init__")
    def f(self): pass
print(try_(lambda: Abstract())); print(type(Concrete()).__name__)

print("--- order of evaluation, and exceptions")
log = []
def arg(v): log.append(v); return v
class Logs:
    def __init__(self, a, b): log.append(("init", a, b))
Logs(arg(1), arg(2)); print(log)
class Deleted:
    count = 0
    def __init__(self, v): Deleted.count += 1
    def __del__(self): log.append("finalized")
log.clear()
def raises(): raise KeyError("in an argument")
print(try_(lambda: Deleted(raises())), Deleted.count)
gc.collect(); print(log)
class Raises:
    def __init__(self, v):
        raise ValueError(v)
def where():
    try:
        Raises(
            "multi-line call")
    except ValueError:
        return [(f.name, f.lineno - where.__code__.co_firstlineno) for f in traceback.extract_tb(sys.exc_info()[2])]
print(where())
d = Deleted(1); del d; gc.collect(); print(log)

print("--- recursion")
class Node:
    def __init__(self, depth): self.child = Node(depth - 1) if depth else None
n = Node(50); depth = 0
while n.child: n = n.child; depth += 1
print(depth)
class Endless:
    def __init__(self): Endless()
print(try_(lambda: Endless())[:40])

print("--- names from modules, nested names, generics")
import collections, fractions, types
print(collections.OrderedDict(a=1), fractions.Fraction(1, 3), collections.Counter("aab"), types.SimpleNamespace(a=1))
class Outer:
    class Inner:
        def __init__(self, v): self.v = v
    def make(self): return self.Inner(3).v, Outer.Inner(4).v
print(Outer().make())
class Generic[T]:
    def __init__(self, v): self.v = v
print(Generic(1).v, Generic[int](2).v)
@dataclasses.dataclass
class Data:
    a: int
    b: str = "b"
print(Data(1), Data(1, "c"), Data(b="x", a=0), try_(lambda: Data()))
_Private = Point
print(_Private(1), __builtins__.__dict__["ValueError"]("v") if hasattr(__builtins__, "__dict__") else ValueError("v"))
T = lambda v: ("a lambda named T", v)
print(T(1))
print(try_(lambda: Undefined(1)))
