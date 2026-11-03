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
try: print('ident(1) =>', ident(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ident(1)')
try: print('ident.__type_params__ =>', ident.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ident.__type_params__')
try: print('type(ident.__type_params__) =>', type(ident.__type_params__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(ident.__type_params__)')
try: print('type(ident.__type_params__[0]).__name__ =>', type(ident.__type_params__[0]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(ident.__type_params__[0]).__name__')
try: print('ident.__annotations__ =>', ident.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ident.__annotations__')
try: print('ident.__name__ =>', ident.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ident.__name__')
try: print('ident.__qualname__ =>', ident.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ident.__qualname__')
try: T = ident.__type_params__[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T = ident.__type_params__[0]')
try: print('T =>', T)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T')
try: print('repr(T) =>', repr(T))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(T)')
try: print('str(T) =>', str(T))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(T)')
try: print('T.__name__ =>', T.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__name__')
try: print('T.__bound__ =>', T.__bound__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__bound__')
try: print('T.__constraints__ =>', T.__constraints__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__constraints__')
try: print('T.__covariant__ =>', T.__covariant__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__covariant__')
try: print('T.__contravariant__ =>', T.__contravariant__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__contravariant__')
try: print('T.__infer_variance__ =>', T.__infer_variance__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__infer_variance__')
try: print('T.has_default() =>', T.has_default())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.has_default()')
try: print('T.__module__ =>', T.__module__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__module__')
try: print('type(T).__module__ =>', type(T).__module__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(T).__module__')
try: print('type(T).__qualname__ =>', type(T).__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(T).__qualname__')
try: print('T == T =>', T == T)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T == T')
try: print('hash(T) == hash(T) =>', hash(T) == hash(T))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(T) == hash(T)')
try: print('T is ident.__annotations__["x"] =>', T is ident.__annotations__["x"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T is ident.__annotations__["x"]')
try: print('T.__default__ =>', T.__default__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__default__')
try: print('repr(T.__default__) =>', repr(T.__default__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(T.__default__)')
try: print('type(T.__default__).__name__ =>', type(T.__default__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(T.__default__).__name__')
try:
    def two[A, B](a: A, b: B): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def two[A, B](a: A, b: B): pass')
try:
    def bounded[T: int](x: T): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bounded[T: int](x: T): pass')
try:
    def constrained[T: (int, str)](x: T): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def constrained[T: (int, str)](x: T): pass')
try:
    def variadic[*Ts](*a: *Ts): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def variadic[*Ts](*a: *Ts): pass')
try:
    def paramspec[**P](*a: P.args, **k: P.kwargs): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def paramspec[**P](*a: P.args, **k: P.kwargs): pass')
try:
    def everything[T, U: int, V: (int, str), *Ts, **P](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def everything[T, U: int, V: (int, str), *Ts, **P](): pass')
try: print('two.__type_params__ =>', two.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: two.__type_params__')
try: print('bounded.__type_params__[0].__bound__ =>', bounded.__type_params__[0].__bound__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bounded.__type_params__[0].__bound__')
try: print('bounded.__type_params__[0].__constraints__ =>', bounded.__type_params__[0].__constraints__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bounded.__type_params__[0].__constraints__')
try: print('constrained.__type_params__[0].__constraints__ =>', constrained.__type_params__[0].__constraints__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: constrained.__type_params__[0].__constraints__')
try: print('constrained.__type_params__[0].__bound__ =>', constrained.__type_params__[0].__bound__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: constrained.__type_params__[0].__bound__')
try: print('variadic.__type_params__ =>', variadic.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: variadic.__type_params__')
try: print('type(variadic.__type_params__[0]).__name__ =>', type(variadic.__type_params__[0]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(variadic.__type_params__[0]).__name__')
try: print('repr(variadic.__type_params__[0]) =>', repr(variadic.__type_params__[0]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(variadic.__type_params__[0])')
try: print('paramspec.__type_params__ =>', paramspec.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: paramspec.__type_params__')
try: print('type(paramspec.__type_params__[0]).__name__ =>', type(paramspec.__type_params__[0]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(paramspec.__type_params__[0]).__name__')
try: print('repr(paramspec.__type_params__[0]) =>', repr(paramspec.__type_params__[0]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(paramspec.__type_params__[0])')
try: print('everything.__type_params__ =>', everything.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: everything.__type_params__')
try: print('[type(p).__name__ for p in everything.__type_params__] =>', [type(p).__name__ for p in everything.__type_params__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [type(p).__name__ for p in everything.__type_params__]')
try: P = paramspec.__type_params__[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P = paramspec.__type_params__[0]')
try: Ts = variadic.__type_params__[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Ts = variadic.__type_params__[0]')
try: print('P.__name__ =>', P.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.__name__')
try: print('P.args =>', P.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.args')
try: print('P.kwargs =>', P.kwargs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.kwargs')
try: print('type(P.args).__name__ =>', type(P.args).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(P.args).__name__')
try: print('type(P.kwargs).__name__ =>', type(P.kwargs).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(P.kwargs).__name__')
try: print('P.args.__origin__ is P =>', P.args.__origin__ is P)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.args.__origin__ is P')
try: print('P.__bound__ =>', P.__bound__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.__bound__')
try: print('P.has_default() =>', P.has_default())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.has_default()')
try: print('Ts.__name__ =>', Ts.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Ts.__name__')
try: print('Ts.has_default() =>', Ts.has_default())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Ts.has_default()')
try: print('paramspec.__annotations__ =>', paramspec.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: paramspec.__annotations__')
try: print('variadic.__annotations__ =>', variadic.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: variadic.__annotations__')
try: print('P.args == P.args =>', P.args == P.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.args == P.args')
try: print('P.args == P.kwargs =>', P.args == P.kwargs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.args == P.kwargs')
try: print('(lambda: 0).__type_params__ =>', (lambda: 0).__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda: 0).__type_params__')
try: print('len.__type_params__ if hasattr(len, "__type_params__") else "builtins... =>', len.__type_params__ if hasattr(len, "__type_params__") else "builtins have none")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len.__type_params__ if hasattr(len, "__type_params__") else "builtins...')
try: print('print.__class__.__name__ =>', print.__class__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print.__class__.__name__')
try:
    def plain(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain(): pass')
try: print(plain.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: plain.__type_params__')
try: plain.__type_params__ = (T,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: plain.__type_params__ = (T,)')
try: print(plain.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: plain.__type_params__')
try:
    def s1(): plain.__type_params__ = [T]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s1(): plain.__type_params__ = [T]')
try:
    def s2(): plain.__type_params__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s2(): plain.__type_params__ = None')
try:
    def s3(): del plain.__type_params__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s3(): del plain.__type_params__')
try: print('s1() =>', end=" "); t(s1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s1)')
try: print('s2() =>', end=" "); t(s2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s2)')
try: print('s3() =>', end=" "); t(s3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s3)')
# Bounds, constraints and defaults are evaluated lazily.
try:
    def lazy[T: undefined_bound](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lazy[T: undefined_bound](): pass')
try: tp = lazy.__type_params__[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp = lazy.__type_params__[0]')
try: print(tp.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp.__name__')
try: print('tp.__bound__ =>', end=" "); t(lambda: tp.__bound__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: tp.__bound__)')
try: undefined_bound = "defined later"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: undefined_bound = "defined later"')
try: print(tp.__bound__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp.__bound__')
try:
    def lazy2[T: (undefined_c1, int)](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lazy2[T: (undefined_c1, int)](): pass')
try: print('lazy2.__type_params__[0].__constraints__ =>', end=" "); t(lambda: lazy2.__type_params__[0].__constraints__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: lazy2.__type_params__[0].__constraints__)')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
    def ev(n, v): log.append(n); return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ev(n, v): log.append(n); return v')
try:
    def traced[T: ev("bound", int) = ev("default", bool)](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def traced[T: ev("bound", int) = ev("default", bool)](): pass')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: tp = traced.__type_params__[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp = traced.__type_params__[0]')
try: print('tp.__bound__ =>', tp.__bound__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp.__bound__')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: print('tp.__bound__ =>', tp.__bound__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp.__bound__')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: print('tp.__default__ =>', tp.__default__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp.__default__')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: print('tp.__default__ =>', tp.__default__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp.__default__')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try:
    def forward[T: "Fwd"](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def forward[T: "Fwd"](): pass')
try: print(repr(forward.__type_params__[0].__bound__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(forward.__type_params__[0].__bound__)')
try:
    def selfref[T: list[T]](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def selfref[T: list[T]](): pass')
try: print(selfref.__type_params__[0].__bound__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: selfref.__type_params__[0].__bound__')
try:
    def mutual[A: list[B], B: list[A]](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def mutual[A: list[B], B: list[A]](): pass')
try: print([p.__bound__ for p in mutual.__type_params__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [p.__bound__ for p in mutual.__type_params__]')
# Defaults (PEP 696).
try:
    def d1[T = int](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d1[T = int](): pass')
try:
    def d2[T: int = bool](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d2[T: int = bool](): pass')
try:
    def d3[*Ts = *tuple[int, str]](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d3[*Ts = *tuple[int, str]](): pass')
try:
    def d4[**P = [int, str]](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d4[**P = [int, str]](): pass')
try:
    def d5[T = None](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d5[T = None](): pass')
try:
    def d6[A, B = A](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d6[A, B = A](): pass')
try:
    def d7[**P = ...](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d7[**P = ...](): pass')
try: print('d1.__type_params__[0].__default__ =>', d1.__type_params__[0].__default__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d1.__type_params__[0].__default__')
try: print('d1.__type_params__[0].has_default() =>', d1.__type_params__[0].has_default())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d1.__type_params__[0].has_default()')
try: print('d2.__type_params__[0].__default__ =>', d2.__type_params__[0].__default__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d2.__type_params__[0].__default__')
try: print('d2.__type_params__[0].__bound__ =>', d2.__type_params__[0].__bound__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d2.__type_params__[0].__bound__')
try: print('d3.__type_params__[0].__default__ =>', d3.__type_params__[0].__default__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d3.__type_params__[0].__default__')
try: print('d4.__type_params__[0].__default__ =>', d4.__type_params__[0].__default__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d4.__type_params__[0].__default__')
try: print('d5.__type_params__[0].__default__ =>', d5.__type_params__[0].__default__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d5.__type_params__[0].__default__')
try: print('d5.__type_params__[0].has_default() =>', d5.__type_params__[0].has_default())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d5.__type_params__[0].has_default()')
try: print('d6.__type_params__[1].__default__ =>', d6.__type_params__[1].__default__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d6.__type_params__[1].__default__')
try: print('d7.__type_params__[0].__default__ =>', d7.__type_params__[0].__default__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d7.__type_params__[0].__default__')
# Scoping.
try: outer_name = "global"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outer_name = "global"')
try:
    def scope[T](x: T, y: outer_name = outer_name) -> list[T]:
        return T, x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def scope[T](x: T, y: outer_name = outer_name) -> list[T]:')
try: print('scope(1) =>', scope(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: scope(1)')
try: print('scope.__annotations__ =>', scope.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: scope.__annotations__')
try: print('scope.__defaults__ =>', scope.__defaults__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: scope.__defaults__')
try:
    def shadow[outer_name](x: outer_name): return outer_name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def shadow[outer_name](x: outer_name): return outer_name')
try: print('shadow(1) =>', shadow(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: shadow(1)')
try: print('shadow.__annotations__ =>', shadow.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: shadow.__annotations__')
try: print('outer_name =>', outer_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outer_name')
try: print('T2 if False else ident.__type_params__[0].__name__ =>', end=" "); t(lambda: T2 if False else ident.__type_params__[0].__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: T2 if False else ident.__type_params__[0].__name__)')
try:
    def not_leaked[Leak](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def not_leaked[Leak](): pass')
try: print('Leak =>', end=" "); t(lambda: Leak)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Leak)')
try:
    def default_cannot_see[T](x=lambda: T): return x()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def default_cannot_see[T](x=lambda: T): return x()')
try: print(default_cannot_see())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: default_cannot_see()')
try:
    def nested_generic[T]():
        def inner[U](a: T, b: U): return T, U
        return inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nested_generic[T]():')
try: i = nested_generic()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = nested_generic()')
try: print('i(1, 2) =>', i(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i(1, 2)')
try: print('i.__type_params__ =>', i.__type_params__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.__type_params__')
try: print('i.__annotations__ =>', i.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.__annotations__')
try: print('i.__qualname__ =>', i.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.__qualname__')
try:
    def same_name[T]():
        def inner[T](): return T
        return T, inner(), T is inner()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def same_name[T]():')
try: r = same_name()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = same_name()')
try: print(r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r')
try:
    def param_same_as_typevar[T](T): return T
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def param_same_as_typevar[T](T): return T')
try: print(param_same_as_typevar(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: param_same_as_typevar(5)')
try:
    def assign_in_body[T]():
        before = T
        return before
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def assign_in_body[T]():')
try: print(assign_in_body())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign_in_body()')
try:
    def decorated_order():
        log = []
        def deco(f): log.append("deco sees " + repr(f.__type_params__)); return f
        @deco
        def g[T](x=log.append("default")): pass
        return log
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def decorated_order():')
try: print(decorated_order())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: decorated_order()')
try:
    def deco_scope():
        def deco(v): return lambda f: f
        try:
            @deco(T9)
            def g[T9](): pass
        except NameError as e: return str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def deco_scope():')
try: print(deco_scope())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: deco_scope()')
try:
    for src in ("def f[T](): pass", "def f[](): pass", "def f[T,](): pass", "def f[T, U](): pass", "def f[T, T](): pass", "def f[T, *T](): pass", "def f[*T, **T](): pass", "def f[1](): pass", "def f['T'](): pass", "def f[T.U](): pass", "def f[T: int](): pass", "def f[T: (int, str)](): pass", "def f[T: (int,)](): pass", "def f[T: ()](): pass", "def f[T: int, str](): pass", "def f[T:](): pass", "def f[T: int: str](): pass", "def f[*T: int](): pass", "def f[**T: int](): pass", "def f[***T](): pass", "def f[*T, *U](): pass", "def f[**P, **Q](): pass", "def f[T = int](): pass", "def f[T = int, U](): pass", "def f[T = int, U = str](): pass", "def f[T = int, *Ts](): pass", "def f[T = int, **P](): pass", "def f[*Ts = int](): pass", "def f[*Ts = *x](): pass", "def f[T = *x](): pass", "def f[**P = *x](): pass", "def f[T =](): pass", "def f[T: int = str](): pass", "def f[T = int: str](): pass", "def f[T := int](): pass", "def f[T: (x := int)](): pass", "def f[T = (x := int)](): pass", "def f[T: (yield)](): pass", "def f[T: (await x)](): pass", "def f[T = (yield)](): pass", "def f[T: lambda: 1](): pass", "def f[T: [x for x in y]](): pass", "def f[T] (): pass", "def f [T](): pass", "def f[T]: pass", "def f[T]", "def [T]f(): pass", "def f()[T]: pass", "lambda[T]: 1", "class C[T]: pass", "class C[T](): pass", "class C[T](Base): pass", "class C[T](Base[T]): pass", "class C[]: pass", "class C[T, T]: pass", "class C(Base)[T]: pass", "class C[T](x := 1): pass", "class C[T]((yield)): pass", "class C[T](await x): pass", "class C[T](metaclass=M): pass", "class C[T](*bases, **kw): pass", "class C[T: int = str, *Ts = *x, **P = [int]]: pass", "async def f[T](): pass", "def f[None](): pass", "def f[True](): pass", "def f[__debug__](): pass", "def f[_](): pass", "def f[match](): pass", "def f[type](): pass", "def f[T](T): pass", "def f[T](x: T = T): pass", "def f[T]() -> T: pass", "def f[T](): global T", "def f[T](): nonlocal T", "class C[T]:\n nonlocal T", "class C[T]:\n global T", "def f[T](x: (y := T)): pass", "def f[T](x: (yield)): pass", "def f[T]() -> (yield): pass", "def f[é](): pass", "def f[T\n, U](): pass", "def f[T: int\n](): pass", "@d[T]\ndef f(): pass", "def f[T](*args: *T): pass", "def f[*Ts](*args: *Ts): pass", "def f[*Ts](x: *Ts): pass", "def f[T](x, /, y, *, z): pass"):
        try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
        except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("def f[T](): pass", "def f[](): pass", "def f[T,](): pass...')
