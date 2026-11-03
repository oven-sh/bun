def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

def ident[T](x: T) -> T: return x
def variadic[*Ts](*a: *Ts): pass
T = ident.__type_params__[0]; Ts = variadic.__type_params__[0]
# Generic classes.
class Box[T]:
    def __init__(self, v: T): self.v = v
    def get(self) -> T: return self.v
    tp = T
print(Box.__type_params__, Box.__parameters__, Box.__bases__, Box.__orig_bases__, [c.__name__ for c in Box.__mro__], Box(1).get(), Box.tp, Box.tp is Box.__type_params__[0], Box.__init__.__annotations__, Box.get.__annotations__, Box.__name__, Box.__qualname__, "T" in Box.__dict__, sorted(k for k in Box.__dict__ if not k.startswith("__") or k in ("__type_params__", "__orig_bases__", "__parameters__")))
print(Box[int], type(Box[int]).__name__, Box[int].__origin__, Box[int].__args__, Box[int](5).v, Box[int](5).__orig_class__, isinstance(Box[int](5), Box), Box[int] == Box[int], Box[int] == Box[str], Box[Box[int]], Box[T], Box[T].__parameters__, Box[T][str])
t(lambda: Box[int, str]); t(lambda: Box[()]); t(lambda: isinstance(1, Box[int])); t(lambda: Box[int][str]); t(lambda: issubclass(Box, Box[int]))
class Pair[A, B]: pass
class Sub[T](Box[T]): pass
class Concrete(Box[int]): pass
class Multi[T](Box[T], Pair[T, int]): pass
class WithBase[T](dict): pass
class WithKw[T](Box[T], metaclass=type): pass
class Var[*Ts]: pass
class Spec[**P]: pass
class Dflt[T = int]: pass
print(Pair[int, str], Sub.__bases__, Sub.__orig_bases__, Sub[int], Concrete.__bases__, Concrete.__orig_bases__, Concrete.__type_params__, Concrete.__parameters__, [c.__name__ for c in Multi.__mro__], WithBase.__bases__, WithBase[int](a=1), type(WithKw).__name__, Var[int, str], Var[()], Var[int], Spec[[int, str]], Spec[int, str], Spec[...], Dflt[str], Dflt.__type_params__[0].__default__)
t(lambda: Pair[int]); t(lambda: Pair[int, str, float]); t(lambda: Concrete[int])
class ClsScope[T]:
    x = T
    class Inner:
        y = T
    def m(self): return T
    lam = lambda self: T
    comp = [T for _ in range(1)]
    attr: T
print(ClsScope.x, ClsScope.Inner.y, ClsScope().m(), ClsScope().lam(), ClsScope.comp, ClsScope.__annotations__)
class BaseUsesParam[T](list[T]): pass
print(BaseUsesParam.__orig_bases__, BaseUsesParam.__bases__, BaseUsesParam([1]))
class MethodGeneric[T]:
    def m[U](self, a: T, b: U): return T, U
print(MethodGeneric().m(1, 2), MethodGeneric.m.__type_params__, MethodGeneric.m.__annotations__)
class ClassVarVsTypeParam[T]:
    T = "class attribute wins inside the body after assignment"
    v = T
    def m(self): return T
print(ClassVarVsTypeParam.v, ClassVarVsTypeParam().m(), ClassVarVsTypeParam.__type_params__)
class Plain: pass
print(Plain.__type_params__, int.__type_params__, hasattr(Plain, "__parameters__"), hasattr(Plain, "__orig_bases__"))
Plain.__type_params__ = (T,); print(Plain.__type_params__)
def s4(): Plain.__type_params__ = [T]
def s5(): int.__type_params__ = ()
t(s4); t(s5)
class SuperInGeneric[T](Box[T]):
    def __init__(self, v): super().__init__(v * 2)
    def cls(self): return __class__
print(SuperInGeneric(2).v, SuperInGeneric(1).cls().__name__)
class InitSub:
    def __init_subclass__(cls, **kw): print("init_subclass", cls.__name__, cls.__type_params__, kw, end="; ")
class GenSub[T](InitSub, flag=1): pass
print()
# TypeVar objects.
t(lambda: type(T)("X").__name__); t(lambda: type(T)("X", int, str).__constraints__); t(lambda: type(T)("X", bound=int).__bound__); t(lambda: type(T)("X", int)); t(lambda: type(T)("X", int, str, bound=int)); t(lambda: type(T)()); t(lambda: type(T)(1)); t(lambda: type(T)("X", covariant=True, contravariant=True)); t(lambda: repr(type(T)("X", covariant=True))); t(lambda: repr(type(T)("X", contravariant=True))); t(lambda: repr(type(T)("X", infer_variance=True))); t(lambda: type(T)("X", default=int).__default__); t(lambda: type("S", (type(T),), {})); t(lambda: T()); t(lambda: T[int]); t(lambda: isinstance(1, T)); t(lambda: T | int); t(lambda: int | T); t(lambda: list[T]); t(lambda: list[T][int]); t(lambda: dict[T, T][str]); t(lambda: list[T].__parameters__); t(lambda: T < T); t(lambda: [*Ts]); t(lambda: tuple[*Ts]); t(lambda: tuple[*Ts][int, str]); t(lambda: tuple[int, *Ts, str][float]); t(lambda: len(T)); t(lambda: T.nope); t(lambda: T.__dict__ if hasattr(T, "__dict__") else "no dict")
def s6(): T.__name__ = "x"
def s7(): T.custom = 1; return T.custom
t(s6); t(s7)
