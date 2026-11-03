import abc, enum
class Base:
    kind = "base"
    count = 0
    def __init__(self, a, b=2, *rest, key="k"):
        self.a = a; self.b = b; self.rest = rest; self.key = key
        Base.count += 1
    def describe(self): return f"{type(self).__name__}({self.a}, {self.b}, {self.rest}, {self.key})"
    def __repr__(self): return "<" + self.describe() + ">"
    def __call__(self, x): return ("called", self.a, x)
class Derived(Base):
    kind = "derived"
    def describe(self): return "derived " + super().describe()
class Other: pass
class Meta(type):
    def __instancecheck__(cls, obj): return obj == 42
class Magic(metaclass=Meta): pass
class Color(enum.Enum):
    RED = 1
    GREEN = 2
class Abstract(abc.ABC):
    @abc.abstractmethod
    def f(self): ...
class WithNew:
    def __new__(cls, v):
        if v == 0: return "not an instance"
        return super().__new__(cls)
    def __init__(self, v): self.v = v
def func(a, b, c=3): "doc of func"; return a + b + c
func.tag = "tagged"
lam = lambda: 1
def is_base(o): return isinstance(o, Base)
def type_of(o): return type(o)
def make_class(name): return type(name, (Base,), {"extra": 1})
