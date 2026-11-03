def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

def ident[T](x: T) -> T: return x
print(ident(1), ident.__type_params__, type(ident.__type_params__), type(ident.__type_params__[0]).__name__, ident.__annotations__, ident.__name__, ident.__qualname__)
T = ident.__type_params__[0]
print(T, repr(T), str(T), T.__name__, T.__bound__, T.__constraints__, T.__covariant__, T.__contravariant__, T.__infer_variance__, T.has_default(), T.__module__, type(T).__module__, type(T).__qualname__, T == T, hash(T) == hash(T), T is ident.__annotations__["x"], T.__default__, repr(T.__default__), type(T.__default__).__name__)
def two[A, B](a: A, b: B): pass
def bounded[T: int](x: T): pass
def constrained[T: (int, str)](x: T): pass
def variadic[*Ts](*a: *Ts): pass
def paramspec[**P](*a: P.args, **k: P.kwargs): pass
def everything[T, U: int, V: (int, str), *Ts, **P](): pass
print(two.__type_params__, bounded.__type_params__[0].__bound__, bounded.__type_params__[0].__constraints__, constrained.__type_params__[0].__constraints__, constrained.__type_params__[0].__bound__, variadic.__type_params__, type(variadic.__type_params__[0]).__name__, repr(variadic.__type_params__[0]), paramspec.__type_params__, type(paramspec.__type_params__[0]).__name__, repr(paramspec.__type_params__[0]), everything.__type_params__, [type(p).__name__ for p in everything.__type_params__])
P = paramspec.__type_params__[0]; Ts = variadic.__type_params__[0]
print(P.__name__, P.args, P.kwargs, type(P.args).__name__, type(P.kwargs).__name__, P.args.__origin__ is P, P.__bound__, P.has_default(), Ts.__name__, Ts.has_default(), paramspec.__annotations__, variadic.__annotations__, P.args == P.args, P.args == P.kwargs)
print((lambda: 0).__type_params__, len.__type_params__ if hasattr(len, "__type_params__") else "builtins have none", print.__class__.__name__)
def plain(): pass
print(plain.__type_params__); plain.__type_params__ = (T,); print(plain.__type_params__)
def s1(): plain.__type_params__ = [T]
def s2(): plain.__type_params__ = None
def s3(): del plain.__type_params__
t(s1); t(s2); t(s3)
# Bounds, constraints and defaults are evaluated lazily.
def lazy[T: undefined_bound](): pass
tp = lazy.__type_params__[0]; print(tp.__name__); t(lambda: tp.__bound__)
undefined_bound = "defined later"; print(tp.__bound__)
def lazy2[T: (undefined_c1, int)](): pass
t(lambda: lazy2.__type_params__[0].__constraints__)
log = []
def ev(n, v): log.append(n); return v
def traced[T: ev("bound", int) = ev("default", bool)](): pass
print(log); tp = traced.__type_params__[0]; print(tp.__bound__, log, tp.__bound__, log, tp.__default__, log, tp.__default__, log)
def forward[T: "Fwd"](): pass
print(repr(forward.__type_params__[0].__bound__))
def selfref[T: list[T]](): pass
print(selfref.__type_params__[0].__bound__)
def mutual[A: list[B], B: list[A]](): pass
print([p.__bound__ for p in mutual.__type_params__])
# Defaults (PEP 696).
def d1[T = int](): pass
def d2[T: int = bool](): pass
def d3[*Ts = *tuple[int, str]](): pass
def d4[**P = [int, str]](): pass
def d5[T = None](): pass
def d6[A, B = A](): pass
def d7[**P = ...](): pass
print(d1.__type_params__[0].__default__, d1.__type_params__[0].has_default(), d2.__type_params__[0].__default__, d2.__type_params__[0].__bound__, d3.__type_params__[0].__default__, d4.__type_params__[0].__default__, d5.__type_params__[0].__default__, d5.__type_params__[0].has_default(), d6.__type_params__[1].__default__, d7.__type_params__[0].__default__)
# Scoping.
outer_name = "global"
def scope[T](x: T, y: outer_name = outer_name) -> list[T]:
    return T, x
print(scope(1), scope.__annotations__, scope.__defaults__)
def shadow[outer_name](x: outer_name): return outer_name
print(shadow(1), shadow.__annotations__, outer_name)
t(lambda: T2 if False else ident.__type_params__[0].__name__)
def not_leaked[Leak](): pass
t(lambda: Leak)
def default_cannot_see[T](x=lambda: T): return x()
print(default_cannot_see())
def nested_generic[T]():
    def inner[U](a: T, b: U): return T, U
    return inner
i = nested_generic(); print(i(1, 2), i.__type_params__, i.__annotations__, i.__qualname__)
def same_name[T]():
    def inner[T](): return T
    return T, inner(), T is inner()
r = same_name(); print(r)
def param_same_as_typevar[T](T): return T
print(param_same_as_typevar(5))
def assign_in_body[T]():
    before = T
    return before
print(assign_in_body())
def decorated_order():
    log = []
    def deco(f): log.append("deco sees " + repr(f.__type_params__)); return f
    @deco
    def g[T](x=log.append("default")): pass
    return log
print(decorated_order())
def deco_scope():
    def deco(v): return lambda f: f
    try:
        @deco(T9)
        def g[T9](): pass
    except NameError as e: return str(e)
print(deco_scope())
for src in ("def f[T](): pass", "def f[](): pass", "def f[T,](): pass", "def f[T, U](): pass", "def f[T, T](): pass", "def f[T, *T](): pass", "def f[*T, **T](): pass", "def f[1](): pass", "def f['T'](): pass", "def f[T.U](): pass", "def f[T: int](): pass", "def f[T: (int, str)](): pass", "def f[T: (int,)](): pass", "def f[T: ()](): pass", "def f[T: int, str](): pass", "def f[T:](): pass", "def f[T: int: str](): pass", "def f[*T: int](): pass", "def f[**T: int](): pass", "def f[***T](): pass", "def f[*T, *U](): pass", "def f[**P, **Q](): pass", "def f[T = int](): pass", "def f[T = int, U](): pass", "def f[T = int, U = str](): pass", "def f[T = int, *Ts](): pass", "def f[T = int, **P](): pass", "def f[*Ts = int](): pass", "def f[*Ts = *x](): pass", "def f[T = *x](): pass", "def f[**P = *x](): pass", "def f[T =](): pass", "def f[T: int = str](): pass", "def f[T = int: str](): pass", "def f[T := int](): pass", "def f[T: (x := int)](): pass", "def f[T = (x := int)](): pass", "def f[T: (yield)](): pass", "def f[T: (await x)](): pass", "def f[T = (yield)](): pass", "def f[T: lambda: 1](): pass", "def f[T: [x for x in y]](): pass", "def f[T] (): pass", "def f [T](): pass", "def f[T]: pass", "def f[T]", "def [T]f(): pass", "def f()[T]: pass", "lambda[T]: 1", "class C[T]: pass", "class C[T](): pass", "class C[T](Base): pass", "class C[T](Base[T]): pass", "class C[]: pass", "class C[T, T]: pass", "class C(Base)[T]: pass", "class C[T](x := 1): pass", "class C[T]((yield)): pass", "class C[T](await x): pass", "class C[T](metaclass=M): pass", "class C[T](*bases, **kw): pass", "class C[T: int = str, *Ts = *x, **P = [int]]: pass", "async def f[T](): pass", "def f[None](): pass", "def f[True](): pass", "def f[__debug__](): pass", "def f[_](): pass", "def f[match](): pass", "def f[type](): pass", "def f[T](T): pass", "def f[T](x: T = T): pass", "def f[T]() -> T: pass", "def f[T](): global T", "def f[T](): nonlocal T", "class C[T]:\n nonlocal T", "class C[T]:\n global T", "def f[T](x: (y := T)): pass", "def f[T](x: (yield)): pass", "def f[T]() -> (yield): pass", "def f[é](): pass", "def f[T\n, U](): pass", "def f[T: int\n](): pass", "@d[T]\ndef f(): pass", "def f[T](*args: *T): pass", "def f[*Ts](*args: *Ts): pass", "def f[*Ts](x: *Ts): pass", "def f[T](x, /, y, *, z): pass"):
    try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
