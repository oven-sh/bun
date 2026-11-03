def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

type A = int
print(A, repr(A), str(A), type(A).__name__, type(A).__module__, A.__name__, A.__value__, A.__type_params__, A.__parameters__, A.__module__, A == A, hash(A) == hash(A), A.__qualname__)
type B = list[int] | None
type C = "forward string"
type D = undefined_later
type E = (int, str)
type F = lambda: 1
type G = [x for x in range(2)]
print(B.__value__, repr(C.__value__), E.__value__, F.__value__(), G.__value__)
t(lambda: D.__value__)
undefined_later = float; print(D.__value__)
log = []
def ev(v): log.append(v); return v
type L = ev("evaluated")
print(log, L.__value__, log, L.__value__, log)
type R = list[R] | int
print(R.__value__, R.__value__.__args__[0].__args__[0] is R)
type M1 = list[M2]
type M2 = list[M1]
print(M1.__value__, M2.__value__)
type Err = 1 / 0
t(lambda: Err.__value__); t(lambda: Err.__value__)
# Generic aliases.
type Lst[T] = list[T]
type Pair[K, V] = dict[K, V]
type Bnd[T: int] = list[T]
type Var[*Ts] = tuple[*Ts]
type Spec[**P] = P
type Dfl[T = int] = list[T]
print(Lst, Lst.__type_params__, Lst.__parameters__, Lst.__value__, Lst[int], type(Lst[int]).__name__, Lst[int].__origin__ is Lst, Lst[int].__args__, Pair[str, int], Pair.__value__, Bnd.__type_params__[0].__bound__, Var[int, str], Var.__value__, Spec.__type_params__, Dfl.__type_params__[0].__default__, Lst[int] == Lst[int], Lst[int] == Lst[str], Lst[Lst[int]], Lst[int].__value__)
t(lambda: A[int]); t(lambda: Lst[int][str]); t(lambda: Lst()); t(lambda: A()); t(lambda: isinstance(1, A)); t(lambda: issubclass(int, A)); t(lambda: isinstance([], Lst[int])); t(lambda: type("X", (A,), {})); t(lambda: A.nope); t(lambda: len(A)); t(lambda: A < A); t(lambda: bool(A)); t(lambda: list(A)); t(lambda: [*Var]) 
def s1(): A.__name__ = "x"
def s2(): A.__value__ = str
def s3(): A.custom = 1
def s4(): del A.__name__
for s in (s1, s2, s3, s4): t(s)
print(A | int, int | A, A | None, A | A, Lst[int] | str, (A | int).__args__, list[A], dict[A, B], tuple[A, ...], A | "str" if False else "")
# Scoping.
def in_function():
    local = "local value"
    type X = local
    type Y[T] = (T, local)
    return X.__value__, Y.__value__, X.__qualname__ if hasattr(X, "__qualname__") else None
print(in_function())
def late_binding():
    v = 1
    type X = v
    v = 2
    return X.__value__
print(late_binding())
class K:
    attr = "class attribute"
    type X = attr
    type Y[T] = (T, attr)
    type Z = [attr for _ in range(1)]
    def m(self): return K.X.__value__
t(lambda: K.Z.__value__)
print(K.X, K.X.__value__, K.Y.__value__, K().m(), type(K.__dict__["X"]).__name__, K.X.__module__)
type Shadow[int] = int
print(Shadow.__value__, Shadow.__value__ is Shadow.__type_params__[0])
for i in range(2):
    type Loop = i
print(Loop.__value__)
type A = str
print(A.__value__, "rebinding an alias name is an ordinary assignment")
if True:
    type Cond = int
print(Cond)
print(type(A)("Manual", int), type(A)("Manual", int).__value__, type(A)("G", list, type_params=Lst.__type_params__).__type_params__)
t(lambda: type(A)()); t(lambda: type(A)("X")); t(lambda: type(A)(1, int)); t(lambda: type(A)("X", int, type_params=[1])); t(lambda: type(A)("X", int, nope=1)); t(lambda: type(A)("X", int, type_params=(1,)).__type_params__)
# `type` stays an ordinary name.
print(type(1), type("X", (), {}).__name__, type.__name__)
type = 5; print(type + 1); del type; print(type(1))
for src in ("type X = int", "type X=int", "type X", "type X =", "type = 1", "type X = int = str", "type X: int", "type X += 1", "type X.Y = int", "type X[0] = int", "type X[T] = T", "type X[] = int", "type X[T, T] = T", "type X[T: int = str] = T", "type X[*Ts] = Ts", "type X[**P] = P", "type (X) = int", "type X, Y = int, str", "type X = int, str", "type X = *a", "type X = (yield)", "type X = await y", "type X = (y := 1)", "type X = y := 1", "type X[T: (y := 1)] = T", "type 1 = int", "type 'X' = int", "type None = int", "type True = int", "type __debug__ = int", "type type = int", "type match = int", "type _ = int", "type X = lambda: 1", "type X = x if y else z", "type X = not y", "type X = [y for y in z]", "type X = int; type Y = str", "type\\\nX = int", "type X\\\n= int", "type X = (\nint\n)", "def f(): type X = int", "class C: type X = int", "lambda: type X = int", "if 1: type X = int", "type X = int if 1 else str", "x = type X = int", "print(type X = int)", "type X = yield", "def f(): type X = (yield)", "async def f(): type X = await y", "type X[T] = (yield)", "type(X)", "type (X)", "type[X]", "type [X]", "type.X", "type X", "type * 2", "type -1", "type in x", "type is x", "type: int = 1", "type, x = 1, 2", "type += 1", "del type", "global type", "import type", "type = type", "type type", "type X = type", "type X[type] = type", "for type in x: pass", "def type(): pass", "class type: pass", "type()", "type(type)", "type X = int # comment", "@d\ntype X = int", "type X = int\n  pass", "type é = int"):
    try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
# Union types.
u = int | str
print(u, repr(u), type(u).__name__, type(u).__module__, u.__args__, u == (str | int), u == (int | str), hash(u) == hash(str | int), int | int, type(int | int).__name__, int | str | int, int | None, None | int, (int | None).__args__, int | str | float, (int | str) | (float | int), u | bytes, bytes | u, list[int] | str, int | list[int], u.__parameters__, (list[int] | int).__args__, isinstance(1, u), isinstance(1.5, u), issubclass(bool, u), u.__name__ if hasattr(u, "__name__") else "", u.__origin__ if hasattr(u, "__origin__") else "", bool(u))
t(lambda: int | 1); t(lambda: 1 | int); t(lambda: int | "str"); t(lambda: "str" | int); t(lambda: None | None); t(lambda: int | [str]); t(lambda: u()); t(lambda: u[int]); t(lambda: type(u)()); t(lambda: type(u)[int, str]); t(lambda: type(u)[int]); t(lambda: type("X", (type(u),), {})); t(lambda: u < u); t(lambda: len(u)); t(lambda: list(u)); t(lambda: u.nope); t(lambda: int | (lambda: 0)); t(lambda: int | ...); t(lambda: int | len); t(lambda: int | (1, 2)); t(lambda: isinstance(1, int | list[int])); t(lambda: u | 1)
def s5(): u.__args__ = ()
def s6(): u.x = 1
t(s5); t(s6)
class Meta(type):
    def __or__(c, o): return "Meta.__or__"
    def __ror__(c, o): return "Meta.__ror__"
class WithMeta(metaclass=Meta): pass
print(WithMeta | int, int | WithMeta, WithMeta | None, None | WithMeta)
# Generic aliases of built-in types.
g = list[int]
print(g, repr(g), type(g).__name__, type(g).__module__, g.__origin__, g.__args__, g.__parameters__, g == list[int], g == list[str], hash(g) == hash(list[int]), g(), g([1, "a"]), type(g()), g.__name__, g.__qualname__, g.__module__, g.__doc__ == list.__doc__, g.append, g.__class__, dict[str, int], dict[str, list[int]], tuple[int, ...], tuple[()], tuple[int], list[int, str], list[None], list[...], list["fwd"], list[1], list[[int]], type[int], set[int], frozenset[int], list[list], list[int | str], collections_free := "no imports", callable(g), g.__mro_entries__((g,)), g.__unpacked__, [*tuple[int, str]], (*tuple[int],)[0].__unpacked__, dir(g) == dir(g), isinstance(g, type), type(g)(list, (int,)), type(g)(list, int), type(g)(dict, (str, int)).__args__)
t(lambda: isinstance([], g)); t(lambda: issubclass(list, g)); t(lambda: g[int]); t(lambda: int[str]); t(lambda: str[int]); t(lambda: list[int](5)); t(lambda: g.nope); t(lambda: type(g)()); t(lambda: type(g)(list)); t(lambda: len(g)); t(lambda: g < g); t(lambda: g | 1); t(lambda: type("X", (type(g),), {}).__name__); t(lambda: list[int].__origin__[str]); t(lambda: g.__reduce__()[1]); t(lambda: list[()]); t(lambda: bool(g))
class FromAlias(list[int]): pass
class FromDict(dict[str, int]): pass
print(FromAlias.__bases__, FromAlias.__orig_bases__, FromAlias([1]), FromDict.__mro__[1], FromDict(a=1))
