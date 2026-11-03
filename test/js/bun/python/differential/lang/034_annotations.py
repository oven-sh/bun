import sys
main = sys.modules["__main__"]
def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

def f(a: int, b: "str" = 1, *args: float, c: list[int] = None, **kw: dict) -> bool: pass
print(f.__annotations__, list(f.__annotations__), f.__annotate__(1) == f.__annotations__, type(f.__annotate__).__name__, f.__annotate__.__name__, f.__annotate__.__qualname__)
def g(): pass
print(g.__annotations__, g.__annotate__)
def h(x) -> None: pass
print(h.__annotations__)
# Evaluation is deferred until the annotations are asked for.
def later(a: Undefined1, b: "Undefined2") -> Undefined3: pass
t(lambda: later.__annotations__)
Undefined1 = int; Undefined3 = str
print(later.__annotations__)
log = []
def ev(x): log.append(x); return x
def lazy(a: ev("a"), b: ev("b") = ev("default")) -> ev("r"): pass
print(log); print(lazy.__annotations__, log); print(lazy.__annotations__, log); print(lazy.__annotate__(1), log)
t(lambda: lazy.__annotate__(2))
t(lambda: lazy.__annotate__(3))
t(lambda: lazy.__annotate__(4))
t(lambda: lazy.__annotate__(0))
t(lambda: lazy.__annotate__())
t(lambda: lazy.__annotate__("a"))
# Forward references to things defined later work.
class Node:
    nxt: Node
    def link(self, other: Node) -> Node: return other
print(Node.__annotations__, Node.link.__annotations__, Node.__annotate__(1), Node.__annotate__.__name__)
x: int = 5
y: str
z: "quoted" = 1
(w): int = 2
print(x, z, w, main.__annotations__, "y" in globals(), __annotate__(1) == main.__annotations__, "__annotations__" in globals())
t(lambda: y)
class C:
    a: int = 1
    b: str
    c: "list[int]" = []
    d: int | None = None
    def m(self): pass
print(C.__annotations__, C.a, hasattr(C, "b"), C.__dict__.get("__annotations__"), "__annotate_func__" in C.__dict__ or "__annotate__" in C.__dict__)
class D(C):
    e: float
class E(C): pass
print(D.__annotations__, E.__annotations__, E.__annotate__)
def local_ann():
    v: int = 1
    u: undefined_name_is_fine
    q: print("never evaluated") = 2
    return v, q, sorted(locals())
print(local_ann(), local_ann.__annotations__)
def local_unbound():
    v: int
    return v
t(local_unbound)
o = type("O", (), {})(); lst = [0]; dd = {}
o.attr: int = 5; lst[0]: int = 6; dd["k"]: str = "v"; o.noval: int
print(o.attr, lst, dd, hasattr(o, "noval"), "o" in main.__annotations__)
t(lambda: exec("undefined_obj.attr: int"))
t(lambda: exec("undefined_obj.attr: int = 1"))
t(lambda: exec("lst2[0]: int"))
f.__annotations__ = {"a": 1}; print(f.__annotations__, f.__annotate__)
f.__annotations__["z"] = 2; print(f.__annotations__); f.__annotations__ = None; print(f.__annotations__); del f.__annotations__; print(f.__annotations__)
g.__annotate__ = lambda fmt: {"x": fmt}; print(g.__annotations__, g.__annotate__(2)); g.__annotate__ = None; print(g.__annotations__, g.__annotate__)
def s1(): g.__annotate__ = 1
def s2(): del g.__annotate__
def s3(): g.__annotations__ = []
t(s1); t(s2); t(s3)
g.__annotate__ = lambda fmt: 5
t(lambda: g.__annotations__)
C.__annotations__ = {"q": 1}; print(C.__annotations__); del C.__annotations__; print(C.__annotations__)
t(lambda: int.__annotations__)
t(lambda: (1).__annotations__)
t(lambda: len.__annotations__)
print((lambda: 0).__annotations__, (lambda: 0).__annotate__)
# Scopes in annotations.
def outer():
    T = "local T"
    def inner(a: T) -> T: pass
    T = "rebound"
    return inner
print(outer().__annotations__)
class S:
    T = "class T"
    def m(self, a: T): pass
    attr: T
print(S.m.__annotations__, S.__annotations__)
S.T = "changed"; print(S.__annotate__(1), S.m.__annotate__(1))
glob = "global"
def useglob(a: glob): pass
glob = "changed global"; print(useglob.__annotations__)
def comp_in_ann(a: [i for i in range(3)], b: (lambda: 1)(), c: {k: 1 for k in "a"}): pass
print(comp_in_ann.__annotations__)
def mangled():
    class P:
        def m(self, __a: int, b: __priv = 1): pass
        __x: int
    return P
__priv = 1; _P__priv = "mangled lookup"
print(mangled().m.__annotations__, mangled().__annotations__)
def starann(*a: *tuple[int, str]): pass
print(starann.__annotations__)
for src in ("def f(a: yield): pass", "def f(a: await x): pass", "def f(a: (b := 1)): pass", "x: (yield)", "x: (y := 1)", "x: await y", "def f(): x: (yield)", "class C: x: (yield)", "def f() -> (yield): pass", "x: int = yield", "def f(): x: int = yield", "x: *y", "x: int, y: int", "x, y: int", "(x, y): int", "[x]: int", "x: int = 1, 2", "x: int = *a, b", "x: int: str", "1: int", "f(): int", "x: ", "x: int =", "lambda x: int: 1", "x += 1: int", "global x\nx: int" , "def f():\n global x\n x: int", "def f():\n nonlocal x\n x: int", "def f():\n x: int\n global x", "x.y: int", "x[0]: int", "(x): int", "((x)): int = 1", "(x.y): int", "None: int", "__debug__: int", "x: int = (yield)", "def f(a: int = 1, /, b: str = '', *, c: bytes = b'') -> None: pass", "def f(*, a: int): pass", "def f(a: lambda: 1): pass", "def f(a: 1 if 2 else 3 = 4): pass", "def f(a:int=1): pass", "def f(a) -> : pass", "def f(a) -> int, str: pass", "def f(a) ->: pass", "def f(a) -> *b: pass"):
    try:
        compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e:
        print("SyntaxError:", e.msg)
# from __future__ import annotations is tested through compile().
ns = {}
exec(compile("from __future__ import annotations\ndef f(a: int, b: 'str', c: list[int] = None, *d: x.y, **e: 1 + 2) -> Undefined | None: pass\nv: some.thing[1:2, ...] = 0\nclass K:\n    w: lambda q: (q, *r)\n    u: f'{a!r:>{b}}' 'c'\n    t: c if False else not -a ** b\n", "<s>", "exec"), ns)
print(ns["f"].__annotations__, ns.get("__annotations__"), ns["K"].__annotations__)
print(ns["f"].__code__.co_flags & 0x1000000 != 0, f.__code__.co_flags & 0x1000000)
