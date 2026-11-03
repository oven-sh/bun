try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: main = sys.modules["__main__"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main = sys.modules["__main__"]')
try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    def f(a: int, b: "str" = 1, *args: float, c: list[int] = None, **kw: dict) -> bool: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f(a: int, b: "str" = 1, *args: float, c: list[int] = None, **kw: ...')
try: print('f.__annotations__ =>', f.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__annotations__')
try: print('list(f.__annotations__) =>', list(f.__annotations__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(f.__annotations__)')
try: print('f.__annotate__(1) == f.__annotations__ =>', f.__annotate__(1) == f.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__annotate__(1) == f.__annotations__')
try: print('type(f.__annotate__).__name__ =>', type(f.__annotate__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(f.__annotate__).__name__')
try: print('f.__annotate__.__name__ =>', f.__annotate__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__annotate__.__name__')
try: print('f.__annotate__.__qualname__ =>', f.__annotate__.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__annotate__.__qualname__')
try:
    def g(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g(): pass')
try: print('g.__annotations__ =>', g.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__annotations__')
try: print('g.__annotate__ =>', g.__annotate__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__annotate__')
try:
    def h(x) -> None: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def h(x) -> None: pass')
try: print(h.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h.__annotations__')
# Evaluation is deferred until the annotations are asked for.
try:
    def later(a: Undefined1, b: "Undefined2") -> Undefined3: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def later(a: Undefined1, b: "Undefined2") -> Undefined3: pass')
try: print('later.__annotations__ =>', end=" "); t(lambda: later.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: later.__annotations__)')
try: Undefined1 = int
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Undefined1 = int')
try: Undefined3 = str
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Undefined3 = str')
try: print(later.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: later.__annotations__')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
    def ev(x): log.append(x); return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ev(x): log.append(x); return x')
try:
    def lazy(a: ev("a"), b: ev("b") = ev("default")) -> ev("r"): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lazy(a: ev("a"), b: ev("b") = ev("default")) -> ev("r"): pass')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: print('lazy.__annotations__ =>', lazy.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lazy.__annotations__')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: print('lazy.__annotations__ =>', lazy.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lazy.__annotations__')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: print('lazy.__annotate__(1) =>', lazy.__annotate__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lazy.__annotate__(1)')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: print('lazy.__annotate__(2) =>', end=" "); t(lambda: lazy.__annotate__(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: lazy.__annotate__(2))')
try: print('lazy.__annotate__(3) =>', end=" "); t(lambda: lazy.__annotate__(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: lazy.__annotate__(3))')
try: print('lazy.__annotate__(4) =>', end=" "); t(lambda: lazy.__annotate__(4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: lazy.__annotate__(4))')
try: print('lazy.__annotate__(0) =>', end=" "); t(lambda: lazy.__annotate__(0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: lazy.__annotate__(0))')
try: print('lazy.__annotate__() =>', end=" "); t(lambda: lazy.__annotate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: lazy.__annotate__())')
try: print('lazy.__annotate__("a") =>', end=" "); t(lambda: lazy.__annotate__("a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: lazy.__annotate__("a"))')
# Forward references to things defined later work.
try:
    class Node:
        nxt: Node
        def link(self, other: Node) -> Node: return other
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Node:')
try: print('Node.__annotations__ =>', Node.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Node.__annotations__')
try: print('Node.link.__annotations__ =>', Node.link.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Node.link.__annotations__')
try: print('Node.__annotate__(1) =>', Node.__annotate__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Node.__annotate__(1)')
try: print('Node.__annotate__.__name__ =>', Node.__annotate__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Node.__annotate__.__name__')
try: x: int = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x: int = 5')
try: y: str
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: y: str')
try: z: "quoted" = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: z: "quoted" = 1')
try: (w): int = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (w): int = 2')
try: print('x =>', x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: print('z =>', z)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: z')
try: print('w =>', w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w')
try: print('main.__annotations__ =>', main.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main.__annotations__')
try: print('"y" in globals() =>', "y" in globals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "y" in globals()')
try: print('__annotate__(1) == main.__annotations__ =>', __annotate__(1) == main.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: __annotate__(1) == main.__annotations__')
try: print('"__annotations__" in globals() =>', "__annotations__" in globals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__annotations__" in globals()')
try: print('y =>', end=" "); t(lambda: y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: y)')
try:
    class C:
        a: int = 1
        b: str
        c: "list[int]" = []
        d: int | None = None
        def m(self): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')
try: print('C.__annotations__ =>', C.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__annotations__')
try: print('C.a =>', C.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.a')
try: print('hasattr(C, "b") =>', hasattr(C, "b"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(C, "b")')
try: print('C.__dict__.get("__annotations__") =>', C.__dict__.get("__annotations__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__dict__.get("__annotations__")')
try: print('"__annotate_func__" in C.__dict__ or "__annotate__" in C.__dict__ =>', "__annotate_func__" in C.__dict__ or "__annotate__" in C.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__annotate_func__" in C.__dict__ or "__annotate__" in C.__dict__')
try:
    class D(C):
        e: float
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D(C):')
try:
    class E(C): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(C): pass')
try: print('D.__annotations__ =>', D.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: D.__annotations__')
try: print('E.__annotations__ =>', E.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E.__annotations__')
try: print('E.__annotate__ =>', E.__annotate__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E.__annotate__')
try:
    def local_ann():
        v: int = 1
        u: undefined_name_is_fine
        q: print("never evaluated") = 2
        return v, q, sorted(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def local_ann():')
try: print('local_ann() =>', local_ann())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: local_ann()')
try: print('local_ann.__annotations__ =>', local_ann.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: local_ann.__annotations__')
try:
    def local_unbound():
        v: int
        return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def local_unbound():')
try: print('local_unbound() =>', end=" "); t(local_unbound)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(local_unbound)')
try: o = type("O", (), {})()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = type("O", (), {})()')
try: lst = [0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lst = [0]')
try: dd = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dd = {}')
try: o.attr: int = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.attr: int = 5')
try: lst[0]: int = 6
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lst[0]: int = 6')
try: dd["k"]: str = "v"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dd["k"]: str = "v"')
try: o.noval: int
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.noval: int')
try: print('o.attr =>', o.attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.attr')
try: print('lst =>', lst)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lst')
try: print('dd =>', dd)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dd')
try: print('hasattr(o, "noval") =>', hasattr(o, "noval"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(o, "noval")')
try: print('"o" in main.__annotations__ =>', "o" in main.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "o" in main.__annotations__')
try: print('exec("undefined_obj.attr: int") =>', end=" "); t(lambda: exec("undefined_obj.attr: int"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("undefined_obj.attr: int"))')
try: print('exec("undefined_obj.attr: int = 1") =>', end=" "); t(lambda: exec("undefined_obj.attr: int = 1"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("undefined_obj.attr: int = 1"))')
try: print('exec("lst2[0]: int") =>', end=" "); t(lambda: exec("lst2[0]: int"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("lst2[0]: int"))')
try: f.__annotations__ = {"a": 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__annotations__ = {"a": 1}')
try: print('f.__annotations__ =>', f.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__annotations__')
try: print('f.__annotate__ =>', f.__annotate__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__annotate__')
try: f.__annotations__["z"] = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__annotations__["z"] = 2')
try: print(f.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__annotations__')
try: f.__annotations__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__annotations__ = None')
try: print(f.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__annotations__')
try: del f.__annotations__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del f.__annotations__')
try: print(f.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__annotations__')
try: g.__annotate__ = lambda fmt: {"x": fmt}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__annotate__ = lambda fmt: {"x": fmt}')
try: print('g.__annotations__ =>', g.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__annotations__')
try: print('g.__annotate__(2) =>', g.__annotate__(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__annotate__(2)')
try: g.__annotate__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__annotate__ = None')
try: print('g.__annotations__ =>', g.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__annotations__')
try: print('g.__annotate__ =>', g.__annotate__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__annotate__')
try:
    def s1(): g.__annotate__ = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s1(): g.__annotate__ = 1')
try:
    def s2(): del g.__annotate__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s2(): del g.__annotate__')
try:
    def s3(): g.__annotations__ = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s3(): g.__annotations__ = []')
try: print('s1() =>', end=" "); t(s1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s1)')
try: print('s2() =>', end=" "); t(s2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s2)')
try: print('s3() =>', end=" "); t(s3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s3)')
try: g.__annotate__ = lambda fmt: 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__annotate__ = lambda fmt: 5')
try: print('g.__annotations__ =>', end=" "); t(lambda: g.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.__annotations__)')
try: C.__annotations__ = {"q": 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__annotations__ = {"q": 1}')
try: print(C.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__annotations__')
try: del C.__annotations__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del C.__annotations__')
try: print(C.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__annotations__')
try: print('int.__annotations__ =>', end=" "); t(lambda: int.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: int.__annotations__)')
try: print('(1).__annotations__ =>', end=" "); t(lambda: (1).__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: (1).__annotations__)')
try: print('len.__annotations__ =>', end=" "); t(lambda: len.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len.__annotations__)')
try: print('(lambda: 0).__annotations__ =>', (lambda: 0).__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda: 0).__annotations__')
try: print('(lambda: 0).__annotate__ =>', (lambda: 0).__annotate__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda: 0).__annotate__')
# Scopes in annotations.
try:
    def outer():
        T = "local T"
        def inner(a: T) -> T: pass
        T = "rebound"
        return inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer():')
try: print(outer().__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outer().__annotations__')
try:
    class S:
        T = "class T"
        def m(self, a: T): pass
        attr: T
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S:')
try: print('S.m.__annotations__ =>', S.m.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: S.m.__annotations__')
try: print('S.__annotations__ =>', S.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: S.__annotations__')
try: S.T = "changed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: S.T = "changed"')
try: print('S.__annotate__(1) =>', S.__annotate__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: S.__annotate__(1)')
try: print('S.m.__annotate__(1) =>', S.m.__annotate__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: S.m.__annotate__(1)')
try: glob = "global"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: glob = "global"')
try:
    def useglob(a: glob): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def useglob(a: glob): pass')
try: glob = "changed global"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: glob = "changed global"')
try: print(useglob.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: useglob.__annotations__')
try:
    def comp_in_ann(a: [i for i in range(3)], b: (lambda: 1)(), c: {k: 1 for k in "a"}): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def comp_in_ann(a: [i for i in range(3)], b: (lambda: 1)(), c: {k: 1 ...')
try: print(comp_in_ann.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: comp_in_ann.__annotations__')
try:
    def mangled():
        class P:
            def m(self, __a: int, b: __priv = 1): pass
            __x: int
        return P
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def mangled():')
try: __priv = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: __priv = 1')
try: _P__priv = "mangled lookup"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: _P__priv = "mangled lookup"')
try: print('mangled().m.__annotations__ =>', mangled().m.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mangled().m.__annotations__')
try: print('mangled().__annotations__ =>', mangled().__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mangled().__annotations__')
try:
    def starann(*a: *tuple[int, str]): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def starann(*a: *tuple[int, str]): pass')
try: print(starann.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: starann.__annotations__')
try:
    for src in ("def f(a: yield): pass", "def f(a: await x): pass", "def f(a: (b := 1)): pass", "x: (yield)", "x: (y := 1)", "x: await y", "def f(): x: (yield)", "class C: x: (yield)", "def f() -> (yield): pass", "x: int = yield", "def f(): x: int = yield", "x: *y", "x: int, y: int", "x, y: int", "(x, y): int", "[x]: int", "x: int = 1, 2", "x: int = *a, b", "x: int: str", "1: int", "f(): int", "x: ", "x: int =", "lambda x: int: 1", "x += 1: int", "global x\nx: int" , "def f():\n global x\n x: int", "def f():\n nonlocal x\n x: int", "def f():\n x: int\n global x", "x.y: int", "x[0]: int", "(x): int", "((x)): int = 1", "(x.y): int", "None: int", "__debug__: int", "x: int = (yield)", "def f(a: int = 1, /, b: str = '', *, c: bytes = b'') -> None: pass", "def f(*, a: int): pass", "def f(a: lambda: 1): pass", "def f(a: 1 if 2 else 3 = 4): pass", "def f(a:int=1): pass", "def f(a) -> : pass", "def f(a) -> int, str: pass", "def f(a) ->: pass", "def f(a) -> *b: pass"):
        try:
            compile(src, "<s>", "exec")
            print("ok:", 'src.replace("\\n", "\\\\n") [' + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + '] =>', src.replace("\n", "\\n"))
        except SyntaxError as e:
            print("SyntaxError:", 'e.msg [' + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + '] =>', e.msg)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("def f(a: yield): pass", "def f(a: await x): pass", "def ...')
# from __future__ import annotations is tested through compile().
try: ns = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = {}')
try: exec(compile("from __future__ import annotations\ndef f(a: int, b: 'str', c: list[int] = None, *d: x.y, **e: 1 + 2) -> Undefined | None: pass\nv: some.thing[1:2, ...] = 0\nclass K:\n    w: lambda q: (q, *r)\n    u: f'{a!r:>{b}}' 'c'\n    t: c if False else not -a ** b\n", "<s>", "exec"), ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec(compile("from __future__ import annotations\\ndef f(a: int, b: \'s...')
try: print('ns["f"].__annotations__ =>', ns["f"].__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns["f"].__annotations__')
try: print('ns.get("__annotations__") =>', ns.get("__annotations__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns.get("__annotations__")')
try: print('ns["K"].__annotations__ =>', ns["K"].__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns["K"].__annotations__')
try: print('ns["f"].__code__.co_flags & 0x1000000 != 0 =>', ns["f"].__code__.co_flags & 0x1000000 != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns["f"].__code__.co_flags & 0x1000000 != 0')
try: print('f.__code__.co_flags & 0x1000000 =>', f.__code__.co_flags & 0x1000000)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__code__.co_flags & 0x1000000')
