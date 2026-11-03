try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    def ident[T](x: T) -> T: return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ident[T](x: T) -> T: return x')
try:
    def variadic[*Ts](*a: *Ts): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def variadic[*Ts](*a: *Ts): pass')
try: T = ident.__type_params__[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T = ident.__type_params__[0]')
try: Ts = variadic.__type_params__[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Ts = variadic.__type_params__[0]')
# Generic classes.
try:
    class Box[T]:
        def __init__(self, v: T): self.v = v
        def get(self) -> T: return self.v
        tp = T
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Box[T]:')
try: print('Box.__type_params__ =>', Box.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box.__type_params__')
try: print('Box.__parameters__ =>', Box.__parameters__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box.__parameters__')
try: print('Box.__bases__ =>', Box.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box.__bases__')
try: print('Box.__orig_bases__ =>', Box.__orig_bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box.__orig_bases__')
try: print('[c.__name__ for c in Box.__mro__] =>', [c.__name__ for c in Box.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Box.__mro__]')
try: print('Box(1).get() =>', Box(1).get())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box(1).get()')
try: print('Box.tp =>', Box.tp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box.tp')
try: print('Box.tp is Box.__type_params__[0] =>', Box.tp is Box.__type_params__[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box.tp is Box.__type_params__[0]')
try: print('Box.__init__.__annotations__ =>', Box.__init__.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box.__init__.__annotations__')
try: print('Box.get.__annotations__ =>', Box.get.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box.get.__annotations__')
try: print('Box.__name__ =>', Box.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box.__name__')
try: print('Box.__qualname__ =>', Box.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box.__qualname__')
try: print('"T" in Box.__dict__ =>', "T" in Box.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "T" in Box.__dict__')
try: print('sorted(k for k in Box.__dict__ if not k.startswith("__") or k in ("__... =>', sorted(k for k in Box.__dict__ if not k.startswith("__") or k in ("__type_params__", "__orig_bases__", "__parameters__")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(k for k in Box.__dict__ if not k.startswith("__") or k in ("__...')
try: print('Box[int] =>', Box[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box[int]')
try: print('type(Box[int]).__name__ =>', type(Box[int]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Box[int]).__name__')
try: print('Box[int].__origin__ =>', Box[int].__origin__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box[int].__origin__')
try: print('Box[int].__args__ =>', Box[int].__args__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box[int].__args__')
try: print('Box[int](5).v =>', Box[int](5).v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box[int](5).v')
try: print('Box[int](5).__orig_class__ =>', Box[int](5).__orig_class__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box[int](5).__orig_class__')
try: print('isinstance(Box[int](5), Box) =>', isinstance(Box[int](5), Box))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(Box[int](5), Box)')
try: print('Box[int] == Box[int] =>', Box[int] == Box[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box[int] == Box[int]')
try: print('Box[int] == Box[str] =>', Box[int] == Box[str])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box[int] == Box[str]')
try: print('Box[Box[int]] =>', Box[Box[int]])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box[Box[int]]')
try: print('Box[T] =>', Box[T])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box[T]')
try: print('Box[T].__parameters__ =>', Box[T].__parameters__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box[T].__parameters__')
try: print('Box[T][str] =>', Box[T][str])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Box[T][str]')
try: print('Box[int, str] =>', end=" "); t(lambda: Box[int, str])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Box[int, str])')
try: print('Box[()] =>', end=" "); t(lambda: Box[()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Box[()])')
try: print('isinstance(1, Box[int]) =>', end=" "); t(lambda: isinstance(1, Box[int]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: isinstance(1, Box[int]))')
try: print('Box[int][str] =>', end=" "); t(lambda: Box[int][str])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Box[int][str])')
try: print('issubclass(Box, Box[int]) =>', end=" "); t(lambda: issubclass(Box, Box[int]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: issubclass(Box, Box[int]))')
try:
    class Pair[A, B]: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Pair[A, B]: pass')
try:
    class Sub[T](Box[T]): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Sub[T](Box[T]): pass')
try:
    class Concrete(Box[int]): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Concrete(Box[int]): pass')
try:
    class Multi[T](Box[T], Pair[T, int]): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Multi[T](Box[T], Pair[T, int]): pass')
try:
    class WithBase[T](dict): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithBase[T](dict): pass')
try:
    class WithKw[T](Box[T], metaclass=type): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithKw[T](Box[T], metaclass=type): pass')
try:
    class Var[*Ts]: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Var[*Ts]: pass')
try:
    class Spec[**P]: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Spec[**P]: pass')
try:
    class Dflt[T = int]: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Dflt[T = int]: pass')
try: print('Pair[int, str] =>', Pair[int, str])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Pair[int, str]')
try: print('Sub.__bases__ =>', Sub.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Sub.__bases__')
try: print('Sub.__orig_bases__ =>', Sub.__orig_bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Sub.__orig_bases__')
try: print('Sub[int] =>', Sub[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Sub[int]')
try: print('Concrete.__bases__ =>', Concrete.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Concrete.__bases__')
try: print('Concrete.__orig_bases__ =>', Concrete.__orig_bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Concrete.__orig_bases__')
try: print('Concrete.__type_params__ =>', Concrete.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Concrete.__type_params__')
try: print('Concrete.__parameters__ =>', Concrete.__parameters__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Concrete.__parameters__')
try: print('[c.__name__ for c in Multi.__mro__] =>', [c.__name__ for c in Multi.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Multi.__mro__]')
try: print('WithBase.__bases__ =>', WithBase.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: WithBase.__bases__')
try: print('WithBase[int](a=1) =>', WithBase[int](a=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: WithBase[int](a=1)')
try: print('type(WithKw).__name__ =>', type(WithKw).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(WithKw).__name__')
try: print('Var[int, str] =>', Var[int, str])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Var[int, str]')
try: print('Var[()] =>', Var[()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Var[()]')
try: print('Var[int] =>', Var[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Var[int]')
try: print('Spec[[int, str]] =>', Spec[[int, str]])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Spec[[int, str]]')
try: print('Spec[int, str] =>', Spec[int, str])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Spec[int, str]')
try: print('Spec[...] =>', Spec[...])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Spec[...]')
try: print('Dflt[str] =>', Dflt[str])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Dflt[str]')
try: print('Dflt.__type_params__[0].__default__ =>', Dflt.__type_params__[0].__default__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Dflt.__type_params__[0].__default__')
try: print('Pair[int] =>', end=" "); t(lambda: Pair[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Pair[int])')
try: print('Pair[int, str, float] =>', end=" "); t(lambda: Pair[int, str, float])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Pair[int, str, float])')
try: print('Concrete[int] =>', end=" "); t(lambda: Concrete[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Concrete[int])')
try:
    class ClsScope[T]:
        x = T
        class Inner:
            y = T
        def m(self): return T
        lam = lambda self: T
        comp = [T for _ in range(1)]
        attr: T
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ClsScope[T]:')
try: print('ClsScope.x =>', ClsScope.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ClsScope.x')
try: print('ClsScope.Inner.y =>', ClsScope.Inner.y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ClsScope.Inner.y')
try: print('ClsScope().m() =>', ClsScope().m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ClsScope().m()')
try: print('ClsScope().lam() =>', ClsScope().lam())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ClsScope().lam()')
try: print('ClsScope.comp =>', ClsScope.comp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ClsScope.comp')
try: print('ClsScope.__annotations__ =>', ClsScope.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ClsScope.__annotations__')
try:
    class BaseUsesParam[T](list[T]): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BaseUsesParam[T](list[T]): pass')
try: print('BaseUsesParam.__orig_bases__ =>', BaseUsesParam.__orig_bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: BaseUsesParam.__orig_bases__')
try: print('BaseUsesParam.__bases__ =>', BaseUsesParam.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: BaseUsesParam.__bases__')
try: print('BaseUsesParam([1]) =>', BaseUsesParam([1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: BaseUsesParam([1])')
try:
    class MethodGeneric[T]:
        def m[U](self, a: T, b: U): return T, U
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MethodGeneric[T]:')
try: print('MethodGeneric().m(1, 2) =>', MethodGeneric().m(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MethodGeneric().m(1, 2)')
try: print('MethodGeneric.m.__type_params__ =>', MethodGeneric.m.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MethodGeneric.m.__type_params__')
try: print('MethodGeneric.m.__annotations__ =>', MethodGeneric.m.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MethodGeneric.m.__annotations__')
try:
    class ClassVarVsTypeParam[T]:
        T = "class attribute wins inside the body after assignment"
        v = T
        def m(self): return T
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ClassVarVsTypeParam[T]:')
try: print('ClassVarVsTypeParam.v =>', ClassVarVsTypeParam.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ClassVarVsTypeParam.v')
try: print('ClassVarVsTypeParam().m() =>', ClassVarVsTypeParam().m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ClassVarVsTypeParam().m()')
try: print('ClassVarVsTypeParam.__type_params__ =>', ClassVarVsTypeParam.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ClassVarVsTypeParam.__type_params__')
try:
    class Plain: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Plain: pass')
try: print('Plain.__type_params__ =>', Plain.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Plain.__type_params__')
try: print('int.__type_params__ =>', int.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int.__type_params__')
try: print('hasattr(Plain, "__parameters__") =>', hasattr(Plain, "__parameters__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(Plain, "__parameters__")')
try: print('hasattr(Plain, "__orig_bases__") =>', hasattr(Plain, "__orig_bases__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(Plain, "__orig_bases__")')
try: Plain.__type_params__ = (T,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Plain.__type_params__ = (T,)')
try: print(Plain.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Plain.__type_params__')
try:
    def s4(): Plain.__type_params__ = [T]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s4(): Plain.__type_params__ = [T]')
try:
    def s5(): int.__type_params__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s5(): int.__type_params__ = ()')
try: print('s4() =>', end=" "); t(s4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s4)')
try: print('s5() =>', end=" "); t(s5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s5)')
try:
    class SuperInGeneric[T](Box[T]):
        def __init__(self, v): super().__init__(v * 2)
        def cls(self): return __class__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SuperInGeneric[T](Box[T]):')
try: print('SuperInGeneric(2).v =>', SuperInGeneric(2).v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SuperInGeneric(2).v')
try: print('SuperInGeneric(1).cls().__name__ =>', SuperInGeneric(1).cls().__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SuperInGeneric(1).cls().__name__')
try:
    class InitSub:
        def __init_subclass__(cls, **kw): print("init_subclass", cls.__name__, cls.__type_params__, kw, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class InitSub:')
try:
    class GenSub[T](InitSub, flag=1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class GenSub[T](InitSub, flag=1): pass')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
# TypeVar objects.
try: print('type(T)("X").__name__ =>', end=" "); t(lambda: type(T)("X").__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(T)("X").__name__)')
try: print('type(T)("X", int, str).__constraints__ =>', end=" "); t(lambda: type(T)("X", int, str).__constraints__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(T)("X", int, str).__constraints__)')
try: print('type(T)("X", bound=int).__bound__ =>', end=" "); t(lambda: type(T)("X", bound=int).__bound__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(T)("X", bound=int).__bound__)')
try: print('type(T)("X", int) =>', end=" "); t(lambda: type(T)("X", int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(T)("X", int))')
try: print('type(T)("X", int, str, bound=int) =>', end=" "); t(lambda: type(T)("X", int, str, bound=int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(T)("X", int, str, bound=int))')
try: print('type(T)() =>', end=" "); t(lambda: type(T)())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(T)())')
try: print('type(T)(1) =>', end=" "); t(lambda: type(T)(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(T)(1))')
try: print('type(T)("X", covariant=True, contravariant=True) =>', end=" "); t(lambda: type(T)("X", covariant=True, contravariant=True))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(T)("X", covariant=True, contravariant=True))')
try: print('repr(type(T)("X", covariant=True)) =>', end=" "); t(lambda: repr(type(T)("X", covariant=True)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: repr(type(T)("X", covariant=True)))')
try: print('repr(type(T)("X", contravariant=True)) =>', end=" "); t(lambda: repr(type(T)("X", contravariant=True)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: repr(type(T)("X", contravariant=True)))')
try: print('repr(type(T)("X", infer_variance=True)) =>', end=" "); t(lambda: repr(type(T)("X", infer_variance=True)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: repr(type(T)("X", infer_variance=True)))')
try: print('type(T)("X", default=int).__default__ =>', end=" "); t(lambda: type(T)("X", default=int).__default__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(T)("X", default=int).__default__)')
try: print('type("S", (type(T),), {}) =>', end=" "); t(lambda: type("S", (type(T),), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("S", (type(T),), {}))')
try: print('T() =>', end=" "); t(lambda: T())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: T())')
try: print('T[int] =>', end=" "); t(lambda: T[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: T[int])')
try: print('isinstance(1, T) =>', end=" "); t(lambda: isinstance(1, T))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: isinstance(1, T))')
try: print('T | int =>', end=" "); t(lambda: T | int)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: T | int)')
try: print('int | T =>', end=" "); t(lambda: int | T)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: int | T)')
try: print('list[T] =>', end=" "); t(lambda: list[T])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list[T])')
try: print('list[T][int] =>', end=" "); t(lambda: list[T][int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list[T][int])')
try: print('dict[T, T][str] =>', end=" "); t(lambda: dict[T, T][str])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: dict[T, T][str])')
try: print('list[T].__parameters__ =>', end=" "); t(lambda: list[T].__parameters__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list[T].__parameters__)')
try: print('T < T =>', end=" "); t(lambda: T < T)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: T < T)')
try: print('[*Ts] =>', end=" "); t(lambda: [*Ts])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: [*Ts])')
try: print('tuple[*Ts] =>', end=" "); t(lambda: tuple[*Ts])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: tuple[*Ts])')
try: print('tuple[*Ts][int, str] =>', end=" "); t(lambda: tuple[*Ts][int, str])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: tuple[*Ts][int, str])')
try: print('tuple[int, *Ts, str][float] =>', end=" "); t(lambda: tuple[int, *Ts, str][float])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: tuple[int, *Ts, str][float])')
try: print('len(T) =>', end=" "); t(lambda: len(T))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len(T))')
try: print('T.nope =>', end=" "); t(lambda: T.nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: T.nope)')
try: print('T.__dict__ if hasattr(T, "__dict__") else "no dict" =>', end=" "); t(lambda: T.__dict__ if hasattr(T, "__dict__") else "no dict")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: T.__dict__ if hasattr(T, "__dict__") else "no dict")')
try:
    def s6(): T.__name__ = "x"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s6(): T.__name__ = "x"')
try:
    def s7(): T.custom = 1; return T.custom
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s7(): T.custom = 1; return T.custom')
try: print('s6() =>', end=" "); t(s6)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s6)')
try: print('s7() =>', end=" "); t(s7)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s7)')
