import sys
def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

class C:
    cls = "class attr"
    def __init__(s): s.inst = "inst attr"
    def m(s): return "m"
c = C()
print(getattr(c, "inst"), getattr(c, "cls"), getattr(c, "m")(), getattr(c, "nope", "default"), getattr(c, "nope", None), getattr(C, "cls"), getattr(1, "real"), getattr("s", "upper")(), getattr([], "append").__name__, getattr(sys, "maxsize") == sys.maxsize, getattr(c, "__class__").__name__, getattr(c, "__dict__"))
t(lambda: getattr(c, "nope")); t(lambda: getattr(c)); t(lambda: getattr()); t(lambda: getattr(c, 1)); t(lambda: getattr(c, None)); t(lambda: getattr(c, b"inst")); t(lambda: getattr(c, "a", "b", "c")); t(lambda: getattr(c, 1, "default")); t(lambda: getattr(c, "nope", default=1)); t(lambda: getattr(None, "x")); t(lambda: getattr(C, "inst")); t(lambda: getattr(c, "")); t(lambda: getattr(c, "in st"))
print(hasattr(c, "inst"), hasattr(c, "nope"), hasattr(c, "m"), hasattr(C, "inst"), hasattr(1, "real"), hasattr(1, "nope"), hasattr(None, "__class__"), hasattr([], "__len__"), hasattr(1, "__len__"), hasattr(c, ""), hasattr(len, "__call__"), hasattr(c, "__call__"), hasattr(int, "__add__"), hasattr(object(), "__dict__"), hasattr(c, "__dict__"), hasattr(c, "__slots__"))
t(lambda: hasattr(c)); t(lambda: hasattr(c, 1)); t(lambda: hasattr(c, None)); t(lambda: hasattr()); t(lambda: hasattr(c, "a", "b"))
class Pr:
    @property
    def ok(s): return 1
    @property
    def attr_err(s): raise AttributeError("hidden")
    @property
    def other_err(s): raise ValueError("boom")
p = Pr(); print(hasattr(p, "ok"), hasattr(p, "attr_err"), getattr(p, "attr_err", "dflt")); t(lambda: hasattr(p, "other_err")); t(lambda: getattr(p, "other_err", "dflt")); t(lambda: getattr(p, "attr_err"))
print(setattr(c, "new", 1), c.new, setattr(c, "inst", 2), c.inst, setattr(C, "added", 3), c.added, setattr(c, "not an identifier", 4), c.__dict__["not an identifier"], getattr(c, "not an identifier"), setattr(c, "", 5), getattr(c, ""), delattr(c, ""), delattr(c, "not an identifier"))
t(lambda: setattr(c, "a")); t(lambda: setattr(c, 1, 2)); t(lambda: setattr(1, "a", 2)); t(lambda: setattr("s", "a", 2)); t(lambda: setattr(None, "a", 2)); t(lambda: setattr(int, "a", 2)); t(lambda: setattr(object(), "a", 2)); t(lambda: setattr([], "a", 2)); t(lambda: setattr(len, "a", 2)); t(lambda: setattr(c, "a", 1, 2)); t(lambda: setattr(p, "ok", 2)); t(lambda: setattr(1, "real", 2)); t(lambda: setattr(c, None, 1)); t(lambda: setattr())
print(delattr(c, "new"), hasattr(c, "new"), delattr(C, "added"), hasattr(c, "added"))
t(lambda: delattr(c, "nope")); t(lambda: delattr(c, "cls")); t(lambda: delattr(c, "m")); t(lambda: delattr(c)); t(lambda: delattr(c, 1)); t(lambda: delattr(1, "real")); t(lambda: delattr(int, "real")); t(lambda: delattr(p, "ok")); t(lambda: delattr(None, "x")); t(lambda: delattr(C, "nope")); t(lambda: delattr(c, "a", "b"))
def fn(): pass
setattr(fn, "tag", 1); print(fn.tag, fn.__dict__, getattr(fn, "__name__")); delattr(fn, "tag"); print(fn.__dict__)
# isinstance / issubclass
class A: pass
class B(A): pass
print(isinstance(1, int), isinstance(True, int), isinstance(1, bool), isinstance(1, float), isinstance(1.0, (int, float)), isinstance("s", str), isinstance(None, type(None)), isinstance(B(), A), isinstance(A(), B), isinstance(B, type), isinstance(B, A), isinstance(int, type), isinstance(type, type), isinstance(type, object), isinstance(object, type), isinstance(1, object), isinstance(1, (str, (float, (int,)))), isinstance(1, ()), isinstance(1, int | str), isinstance("s", int | str), isinstance(None, int | None), isinstance(1.5, int | str), isinstance([], list), isinstance((), tuple), isinstance(len, type(len)), isinstance(lambda: 0, type(fn)), isinstance(1, (int | str, float)), isinstance(ValueError(), Exception), isinstance(ValueError, type), isinstance(..., type(...)), isinstance(NotImplemented, type(NotImplemented)))
print(issubclass(bool, int), issubclass(int, bool), issubclass(int, int), issubclass(B, A), issubclass(A, B), issubclass(B, object), issubclass(B, (str, A)), issubclass(int, ()), issubclass(type, object), issubclass(object, type), issubclass(int, int | str), issubclass(bool, int | str), issubclass(float, int | str), issubclass(ValueError, Exception), issubclass(KeyError, LookupError), issubclass(B, (str, (int, (A,)))), issubclass(type(None), int | None))
t(lambda: isinstance(1)); t(lambda: isinstance(1, 1)); t(lambda: isinstance(1, "int")); t(lambda: isinstance(1, None)); t(lambda: isinstance(1, [int])); t(lambda: isinstance(1, (int, 1))); t(lambda: isinstance("s", (int, 1))); t(lambda: isinstance(1, list[int])); t(lambda: isinstance(1, int, str)); t(lambda: isinstance(1, int | list[int])); t(lambda: isinstance([], int | list[int])); t(lambda: isinstance()); t(lambda: isinstance(1, {int}))
t(lambda: issubclass(1, int)); t(lambda: issubclass(int, 1)); t(lambda: issubclass(int, "int")); t(lambda: issubclass(int, None)); t(lambda: issubclass(int, [int])); t(lambda: issubclass(int, (str, 1))); t(lambda: issubclass(int, (int, 1))); t(lambda: issubclass("int", str)); t(lambda: issubclass(int)); t(lambda: issubclass(int, list[int])); t(lambda: issubclass(list[int], list)); t(lambda: issubclass(None, type(None))); t(lambda: issubclass(B(), A)); t(lambda: issubclass(int | str, int))
class Meta(type):
    def __instancecheck__(cls, o): print("instancecheck", cls.__name__, type(o).__name__, end="; "); return "truthy"
    def __subclasscheck__(cls, s): print("subclasscheck", cls.__name__, s.__name__, end="; "); return 0
class V(metaclass=Meta): pass
class VS(V): pass
print(isinstance(1, V), isinstance(V(), V), isinstance(VS(), V), issubclass(int, V), issubclass(V, V), issubclass(VS, V), isinstance(1, (str, V)), isinstance(1, (int, V)), issubclass(int, (str, V)))
class FakeClass:
    @property
    def __class__(s): return int
print(isinstance(FakeClass(), int), isinstance(FakeClass(), FakeClass), type(FakeClass()).__name__, FakeClass().__class__)
class Bases:
    __bases__ = (A,)
t(lambda: issubclass(Bases(), A)); t(lambda: issubclass(Bases(), B)); t(lambda: isinstance(1, Bases())); t(lambda: issubclass(B, Bases()))
class RaisesCheck(type):
    def __instancecheck__(cls, o): raise RuntimeError("check failed")
class RC(metaclass=RaisesCheck): pass
t(lambda: isinstance(1, RC)); t(lambda: isinstance(RC(), RC)); t(lambda: isinstance(1, (int, RC))); t(lambda: isinstance(1, (RC, int)))
# type, id, callable
print(type(1), type(1.0), type("s"), type(b""), type(None), type(True), type([]), type(()), type({}), type(set()), type(1j), type(...), type(NotImplemented), type(len), type(fn), type(c.m), type(C.m), type([].append), type(str.upper), type(int.__add__), type((1).__add__), type(C), type(type), type(object()), type(range(1)), type(slice(1)), type(iter([])), type(x for x in ()), type(sys), type(fn.__code__), type(C.__dict__), type(int.real), type(property()), type(sys._getframe()), type(ValueError()), type(int | str), type(list[int]), type(memoryview(b"")), type(frozendict()), type(dict.fromkeys), type(object.__init__), type(object().__init__), type(type.__dict__["__dict__"]), type(fn.__globals__), type(super(C, c)), type(classmethod(fn)), type(staticmethod(fn)), type(enumerate([])), type(zip()), type(map(fn, [])), type(filter(fn, [])), type(reversed([])))
print(id(c) == id(c), id(c) != id(C()), type(id(c)), id(None) == id(None), id(1) == id(1), c is c, id(c) > 0); t(lambda: id()); t(lambda: id(1, 2))
# dir
class D:
    x = 1
    def __init__(s): s.y = 2
    def m(s): pass
class E(D): z = 3
def pub(o): return [n for n in dir(o) if not n.startswith("_")]
print(pub(D), pub(D()), pub(E), pub(E()), pub(1)[:5], pub("")[:5], pub([]), pub({}), pub(()), pub(set())[:6], pub(None), pub(fn), pub(len), pub(1.5), pub(1j), pub(b"")[:4], pub(range(1)), pub(slice(1)), pub(object()), pub(type)[:3], pub(property()), pub(ValueError()), pub(x for x in ()), pub(fn.__code__)[:6])
print([n for n in dir(object()) ], len(dir(object)) == len(dir(object())), sorted(dir(D())) == dir(D()), "__dict__" in dir(D()), "__class__" in dir(1), "__init__" in dir(D), "mro" in dir(D), "mro" in dir(type), "__mro__" in dir(D), "__name__" in dir(D), "__name__" in dir(type))
def local_dir():
    a = 1; b = 2
    return dir()
print(local_dir(), "local_dir" in dir(), "sys" in dir(), dir() == sorted(globals()))
print([n for n in dir(sys) if n.startswith("max")], "path" in dir(sys))
# vars, locals, globals
print(vars(c), vars(c) is c.__dict__, type(vars(C)).__name__, vars(sys) is sys.__dict__, vars() is globals(), locals() is globals(), globals()["c"] is c, "__name__" in globals(), globals()["__name__"], __name__, "__builtins__" in globals(), "__file__" in globals(), __file__.rsplit("/", 1)[-1], __doc__, __package__, type(__spec__).__name__, type(__loader__).__name__ != "", sorted(k for k in globals() if k.startswith("__")))
def loc(a, b=2, *c, **d):
    e = 5
    l = locals()
    f = 6
    return l, sorted(locals()), locals() is locals(), locals() == locals()
print(loc(1, 3, 4, k=5))
def loc_write():
    x = 1
    locals()["x"] = 2; locals()["y"] = 3
    return x, "y" in locals()
print(loc_write())
def loc_snapshot():
    x = 1; s = locals(); x = 2
    return s["x"], locals()["x"]
print(loc_snapshot())
def loc_closure():
    free = "f"
    def inner(): unused = 1; return sorted(locals()), free, sorted(locals())
    return inner()
print(loc_closure())
def loc_comp(): return [sorted(locals()) for i in range(1)], [locals()["i"] for i in range(2)]
print(loc_comp())
def loc_del():
    x = 1; del x
    return locals()
print(loc_del())
globals()["made_by_globals"] = 7; print(made_by_globals); del globals()["made_by_globals"]; t(lambda: made_by_globals)
t(lambda: vars(1)); t(lambda: vars("s")); t(lambda: vars(None)); t(lambda: vars([])); t(lambda: vars(1, 2)); t(lambda: locals(1)); t(lambda: globals(1)); t(lambda: vars(object())); t(lambda: dir(1, 2))
# repr, ascii, str of assorted objects.
print(repr(len), repr(print), repr(int), repr(C), repr(type), repr(sys), repr(None), repr(...), repr(NotImplemented), repr([].append)[:36], repr(str.upper), repr(int.__add__), repr((1).__add__)[:36], repr(int.real), repr(dict.fromkeys)[:42], repr(C.m)[:18], repr(c.m)[:21], repr(fn)[:13], repr(lambda: 0)[:19], repr(range(3)), repr(slice(1, 2)), repr(C.__dict__)[:14], repr(object())[:17], repr(property())[:17], repr(int | str), repr(list[int]), repr(type(None)), repr(type(...)), repr(type(NotImplemented)), repr(type(len)), repr(type(fn)), repr(memoryview(b""))[:10], repr(classmethod(fn))[:14], repr(staticmethod(fn))[:15], repr(super(C, c))[:28], repr(fn.__code__)[:16], repr(Exception), repr(sys.flags)[:10], repr(sys.version_info)[:24])
print(ascii("é"), ascii("😀"), ascii("a\n"), ascii(["é"]), ascii({"é": "ü"}), ascii(1), ascii(None), ascii("\x7f\x80"), ascii("'"), ascii('"'), ascii("\ud800"), ascii(b"\xff"), ascii(("é",)), ascii("\\"))
t(lambda: repr()); t(lambda: repr(1, 2)); t(lambda: ascii()); t(lambda: str(1, 2)); t(lambda: str(b"a", "nope")); t(lambda: str("a", "utf-8")); t(lambda: str(1, "utf-8")); t(lambda: str(object=1, nope=2)); print(str(), str(object=5), str(b"a"), str(b"\xc3\xa9", "utf-8"), str(b"\xff", "utf-8", "replace"), str(b"a", encoding="ascii"), str(b"\xff", errors="ignore"), str(bytearray(b"x"), "ascii"), str(None), str(True), str(1.0), str([1, "a"]), str(("a",)), str({"a": 1}), str(int), str(ValueError("m")), str(memoryview(b"ab"), "ascii"))
