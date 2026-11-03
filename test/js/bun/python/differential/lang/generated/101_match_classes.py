try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    class Point:
        __match_args__ = ("x", "y")
        def __init__(s, x, y): s.x = x; s.y = y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Point:')
try:
    class Point3(Point):
        __match_args__ = ("x", "y", "z")
        def __init__(s, x, y, z): super().__init__(x, y); s.z = z
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Point3(Point):')
try:
    class NoArgs:
        def __init__(s, **k): s.__dict__.update(k)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoArgs:')
try:
    def cls(p):
        match p:
            case Point(0, 0): return "origin"
            case Point(0, y): return ("on y axis", y)
            case Point(x=x, y=0): return ("on x axis", x)
            case Point3(x, y, z): return ("3d", x, y, z)
            case Point(x, y=y) if x == y: return ("diagonal", x)
            case Point(): return "some point"
            case NoArgs(a=1, b=b): return ("noargs", b)
            case NoArgs(): return "noargs any"
            case _: return "other"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cls(p):')
try: print([cls(v) for v in (Point(0, 0), Point(0, 5), Point(5, 0), Point3(1, 2, 3), Point3(0, 0, 9), Point(4, 4), Point(1, 2), NoArgs(a=1, b=2), NoArgs(a=2, b=2), NoArgs(a=1), 5, None, Point)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [cls(v) for v in (Point(0, 0), Point(0, 5), Point(5, 0), Point3(1, 2,...')
# Built-in types take one positional sub-pattern that matches the whole subject.
try:
    def bi(x):
        match x:
            case bool(b): return ("bool", b)
            case int(i): return ("int", i)
            case float(f): return ("float", f)
            case str(s): return ("str", s)
            case bytes(b): return ("bytes", b)
            case bytearray(b): return ("bytearray", b)
            case list(l): return ("list", l)
            case tuple(t_): return ("tuple", t_)
            case dict(d): return ("dict", d)
            case set(s): return ("set", s)
            case frozenset(s): return ("frozenset", s)
            case complex(): return "complex has no self-matching"
            case range(): return "range"
            case type(): return "a class"
            case object(): return "object"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bi(x):')
try:
    class MyInt(int): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MyInt(int): pass')
try:
    class MyStr(str): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MyStr(str): pass')
try: print([bi(v) for v in (True, 1, 1.5, "s", b"b", bytearray(b"a"), [1], (1,), {1: 2}, {1}, frozenset({1}), 1j, range(1), int, None, MyInt(3), MyStr("m"))])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [bi(v) for v in (True, 1, 1.5, "s", b"b", bytearray(b"a"), [1], (1,),...')
try:
    def bi2(x):
        match x:
            case int(0 | 1): return "bit"
            case int(n) if n > 100: return "large"
            case str("a" | "b" as s): return "ab:" + s
            case list([1, *r]): return ("list starting with 1", r)
            case dict({"k": v}): return ("dict with k", v)
            case tuple((a, b)): return ("pair", a, b)
            case int(real=r, imag=0): return ("attributes of int", r)
            case str(): return "str"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bi2(x):')
try: print([bi2(v) for v in (0, 1, 500, "a", [1, 2], {"k": 3}, (1, 2), 7, "zz", True)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [bi2(v) for v in (0, 1, 500, "a", [1, 2], {"k": 3}, (1, 2), 7, "zz", ...')
try: print('exec("match 1:\\n case int(1, 2): pass") =>', end=" "); t(lambda: exec("match 1:\n case int(1, 2): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("match 1:\\n case int(1, 2): pass"))')
try: print('exec("match \'a\':\\n case str(a, b): pass") =>', end=" "); t(lambda: exec("match 'a':\n case str(a, b): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("match \'a\':\\n case str(a, b): pass"))')
try: print('exec("match 1j:\\n case complex(a): pass") =>', end=" "); t(lambda: exec("match 1j:\n case complex(a): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("match 1j:\\n case complex(a): pass"))')
try: print('exec("match 1:\\n case object(a): pass") =>', end=" "); t(lambda: exec("match 1:\n case object(a): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("match 1:\\n case object(a): pass"))')
try: print('exec("match range(1):\\n case range(a): pass") =>', end=" "); t(lambda: exec("match range(1):\n case range(a): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("match range(1):\\n case range(a): pass"))')
try: print('exec("match []:\\n case list(a, b, c): pass") =>', end=" "); t(lambda: exec("match []:\n case list(a, b, c): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("match []:\\n case list(a, b, c): pass"))')
try: print('exec("match 1.5:\\n case int(1, 2): pass\\nprint(\'not an instance: the ... =>', end=" "); t(lambda: exec("match 1.5:\n case int(1, 2): pass\nprint('not an instance: the count is not checked')"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("match 1.5:\\n case int(1, 2): pass\\nprint(\'not an inst...')
# Errors.
try:
    def too_many(p):
        match p:
            case Point(1, 2, 3): return "?"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def too_many(p):')
try:
    def no_match_args(p):
        match p:
            case NoArgs(1): return "?"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def no_match_args(p):')
try:
    def not_a_class(p):
        x = 5
        match p:
            case x(): return "?"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def not_a_class(p):')
try:
    def not_a_class2(p):
        f = len
        match p:
            case f(): return "?"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def not_a_class2(p):')
try:
    def dup_attr(p):
        match p:
            case Point(1, x=1): return "?"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dup_attr(p):')
try:
    def undefined_class(p):
        match p:
            case Undefined(): return "?"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def undefined_class(p):')
try:
    def inst_as_class(p):
        c = Point(1, 2)
        match p:
            case c(): return "?"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inst_as_class(p):')
try:
    def union_class(p):
        u = int | str
        match p:
            case u(): return "union"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def union_class(p):')
try:
    def generic_class(p):
        g = list[int]
        match p:
            case g(): return "?"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generic_class(p):')
try:
    def tuple_class(p):
        tt = (int, str)
        match p:
            case tt(): return "?"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tuple_class(p):')
try:
    for f in (too_many, no_match_args, not_a_class, not_a_class2, dup_attr, undefined_class, inst_as_class, union_class, generic_class, tuple_class): t(lambda: f(Point(1, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (too_many, no_match_args, not_a_class, not_a_class2, dup_att...')
try: print('too_many(5) =>', end=" "); t(lambda: too_many(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: too_many(5))')
try: print('no_match_args(5) =>', end=" "); t(lambda: no_match_args(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: no_match_args(5))')
try: print('union_class(5) =>', end=" "); t(lambda: union_class(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: union_class(5))')
try:
    def bad_ma(ma):
        C = type("C", (), {"__match_args__": ma, "a": 1, "b": 2})
        match C():
            case C(x): return ("matched", x)
        return "no match"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bad_ma(ma):')
try: print('bad_ma(("a",)) =>', end=" "); t(lambda: bad_ma(("a",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bad_ma(("a",)))')
try: print('bad_ma(["a"]) =>', end=" "); t(lambda: bad_ma(["a"]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bad_ma(["a"]))')
try: print('bad_ma("a") =>', end=" "); t(lambda: bad_ma("a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bad_ma("a"))')
try: print('bad_ma((1,)) =>', end=" "); t(lambda: bad_ma((1,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bad_ma((1,)))')
try: print('bad_ma(()) =>', end=" "); t(lambda: bad_ma(()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bad_ma(()))')
try: print('bad_ma(None) =>', end=" "); t(lambda: bad_ma(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bad_ma(None))')
try: print('bad_ma(("missing",)) =>', end=" "); t(lambda: bad_ma(("missing",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bad_ma(("missing",)))')
try: print('bad_ma((b"a",)) =>', end=" "); t(lambda: bad_ma((b"a",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bad_ma((b"a",)))')
try: print('bad_ma(("a", "a")) =>', end=" "); t(lambda: bad_ma(("a", "a")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bad_ma(("a", "a")))')
try:
    def dup_ma():
        C = type("C", (), {"__match_args__": ("a", "a"), "a": 1})
        match C():
            case C(x, y): return (x, y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dup_ma():')
try: print('dup_ma() =>', end=" "); t(dup_ma)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(dup_ma)')
try:
    class TupSub(tuple): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class TupSub(tuple): pass')
try: print('bad_ma(TupSub(("a",))) =>', end=" "); t(lambda: bad_ma(TupSub(("a",))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bad_ma(TupSub(("a",))))')
# Attribute lookup.
try:
    class Props:
        __match_args__ = ("p", "q")
        @property
        def p(s): print("p read", end="; "); return 1
        @property
        def q(s): print("q read", end="; "); raise AttributeError("q is missing")
        @property
        def r(s): raise ValueError("not an AttributeError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Props:')
try:
    def props(x):
        match x:
            case Props(2): return "p is 2"
            case Props(1, q): return "has q"
            case Props(p=1, q=_): return "has q by keyword"
            case Props(p=v): return ("p only", v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def props(x):')
try: print(props(Props()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: props(Props())')
try:
    def props_err(x):
        match x:
            case Props(r=_): return "?"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def props_err(x):')
try: print('props_err(Props()) =>', end=" "); t(lambda: props_err(Props()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: props_err(Props()))')
try:
    class GA:
        def __getattr__(s, n):
            if n.startswith("dyn"): return n
            raise AttributeError(n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class GA:')
try:
    match GA():
        case GA(dyn_a=a, dyn_b=b): print(a, b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match GA():')
try:
    match GA():
        case GA(other=o): print("no")
        case GA(): print("missing attribute: no match")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match GA():')
try:
    class ClsAttr: shared = "class attribute"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ClsAttr: shared = "class attribute"')
try:
    match ClsAttr():
        case ClsAttr(shared=s): print(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match ClsAttr():')
try:
    match Point(1, 2):
        case Point(x=1, y=2, __class__=c): print(c.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match Point(1, 2):')
try:
    match Point(1, None):
        case Point(y=None): print("None attribute matches None")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match Point(1, None):')
# isinstance semantics, including __instancecheck__.
try:
    class Meta(type):
        def __instancecheck__(c, o): print("instancecheck", end="; "); return o == "magic"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta(type):')
try:
    class Virtual(metaclass=Meta): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Virtual(metaclass=Meta): pass')
try:
    def virt(x):
        match x:
            case Virtual(): return "virtual instance"
            case _: return "no"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def virt(x):')
try: print('virt("magic") =>', virt("magic"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: virt("magic")')
try: print('virt("plain") =>', virt("plain"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: virt("plain")')
try:
    class Base: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Base: pass')
try:
    class Derived(Base): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Derived(Base): pass')
try:
    def inh(x):
        match x:
            case Derived(): return "derived"
            case Base(): return "base"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inh(x):')
try: print('inh(Derived()) =>', inh(Derived()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inh(Derived())')
try: print('inh(Base()) =>', inh(Base()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inh(Base())')
try: print('inh(1) =>', inh(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inh(1)')
# Dotted class names, nested patterns.
try:
    class NSp:
        class Inner:
            __match_args__ = ("v",)
            def __init__(s, v): s.v = v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NSp:')
try:
    match NSp.Inner(5):
        case NSp.Inner(v): print("dotted class", v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match NSp.Inner(5):')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    match sys:
        case sys.__class__(): print("module type via dotted name")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match sys:')
try:
    class Line:
        __match_args__ = ("a", "b")
        def __init__(s, a, b): s.a = a; s.b = b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Line:')
try:
    def line(l):
        match l:
            case Line(Point(0, 0), Point(x, y)): return ("from origin to", x, y)
            case Line(Point(x=x1), Point(x=x2)) if x1 == x2: return "vertical"
            case Line(a=Point() as p, b=None): return ("open", p.x)
            case Line([Point(x, _), *_], _): return ("list of points", x)
            case Line({"p": Point(y=y)}, _): return ("dict of points", y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def line(l):')
try: print([line(v) for v in (Line(Point(0, 0), Point(1, 2)), Line(Point(3, 0), Point(3, 9)), Line(Point(7, 7), None), Line([Point(4, 5)], 0), Line({"p": Point(1, 8)}, 0), Line(1, 2))])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [line(v) for v in (Line(Point(0, 0), Point(1, 2)), Line(Point(3, 0), ...')
# Exceptions, types, and other objects as subjects.
try:
    def exc(e):
        match e:
            case ValueError(args=(msg,)): return ("ValueError", msg)
            case OSError(errno=2, filename=f): return ("ENOENT", f)
            case KeyError() | IndexError(): return "lookup"
            case Exception(args=[]): return "no args"
            case BaseException(): return "base"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def exc(e):')
try: print([exc(v) for v in (ValueError("m"), OSError(2, "x", "f.txt"), KeyError("k"), IndexError(), RuntimeError(), KeyboardInterrupt("x"), ValueError(1, 2))])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [exc(v) for v in (ValueError("m"), OSError(2, "x", "f.txt"), KeyError...')
try:
    def ty(x):
        match x:
            case type(__name__="int"): return "the int class"
            case type(__name__=n): return ("class", n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ty(x):')
try: print('ty(int) =>', ty(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ty(int)')
try: print('ty(str) =>', ty(str))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ty(str)')
try: print('ty(1) =>', ty(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ty(1)')
try:
    def sl(x):
        match x:
            case slice(start=None, stop=s, step=None): return ("simple slice", s)
            case slice(start=a, stop=b, step=c): return (a, b, c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sl(x):')
try: print('sl(slice(5)) =>', sl(slice(5)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sl(slice(5))')
try: print('sl(slice(1, 2, 3)) =>', sl(slice(1, 2, 3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sl(slice(1, 2, 3))')
# __match_args__ inheritance and overriding.
try:
    class A:
        __match_args__ = ("a",)
        a = 1; b = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A:')
try:
    class B(A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B(A): pass')
try:
    class C(A): __match_args__ = ("b", "a")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C(A): __match_args__ = ("b", "a")')
try:
    match B():
        case B(v): print("inherited", v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match B():')
try:
    match C():
        case C(v, w): print("overridden", v, w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match C():')
try:
    match C():
        case A(v): print("the pattern's class decides", v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match C():')
try: print('int.__dict__.get("__match_args__") =>', int.__dict__.get("__match_args__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int.__dict__.get("__match_args__")')
try: print('hasattr(int, "__match_args__") =>', hasattr(int, "__match_args__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(int, "__match_args__")')
try: print('Point.__match_args__ =>', Point.__match_args__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Point.__match_args__')
try: print('type(sys.version_info).__match_args__[:2] =>', type(sys.version_info).__match_args__[:2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(sys.version_info).__match_args__[:2]')
try: print('type(sys.float_info).__match_args__[:1] =>', type(sys.float_info).__match_args__[:1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(sys.float_info).__match_args__[:1]')
try:
    match sys.version_info:
        case (3, minor, *_) if minor >= 15: print("version tuple")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match sys.version_info:')
try:
    match sys.version_info:
        case sys.version_info.__class__(3, m): print("structseq positional", m >= 15)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match sys.version_info:')
# Keyword patterns evaluate in order; positional first.
try:
    class Ord:
        __match_args__ = ("p1", "p2")
        def __getattr__(s, n): print("read", n, end="; "); return n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Ord:')
try:
    match Ord():
        case Ord(_, _, k2=_, k1=_): print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match Ord():')
try:
    match Ord():
        case Ord("nope", _, k1=_): print("no")
        case _: print("stops at the first failure")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match Ord():')
