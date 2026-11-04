# Objects that are not what the module expects: nothing here may do worse than raise.
import decimal, gc, copy, pickle, sys, weakref, contextvars
from decimal import Decimal, Context

def attempt(label, f):
    try:
        r = f()
    except BaseException as e:
        print(label, "->", type(e).__name__, e)
    else:
        print(label, "->", repr(r))

# ---- Instances that were never initialized ----
attempt("Decimal.__new__(Decimal)", lambda: Decimal.__new__(Decimal))
attempt("object.__new__(Decimal)", lambda: object.__new__(Decimal))
attempt("Decimal.__new__(int)", lambda: Decimal.__new__(int))
attempt("Decimal.__new__(Context)", lambda: Decimal.__new__(Context))
attempt("Decimal.__new__()", lambda: Decimal.__new__())
attempt("Decimal.__new__(1)", lambda: Decimal.__new__(1))
attempt("Context.__new__(Context)", lambda: Context.__new__(Context))
attempt("object.__new__(Context)", lambda: object.__new__(Context))
attempt("Context.__new__(Decimal)", lambda: Context.__new__(Decimal))
attempt("Context.__new__(Context).add", lambda: Context.__new__(Context).add(1, 2))
attempt("Context.__new__(Context, 1, x=2)", lambda: Context.__new__(Context, 1, x=2).prec)
SignalDict = type(Context().flags)
Mixin = SignalDict.__mro__[1]
for cls in (SignalDict, Mixin):
    name = cls.__name__
    attempt(name + "()", lambda: len(cls()))
    attempt(name + ".__new__", lambda: repr(cls.__new__(cls)))
    attempt(name + " iter", lambda: list(cls()))
    attempt(name + " copy", lambda: cls().copy())
    attempt(name + " eq", lambda: cls() == cls())
c = Context()
flags = c.flags
attempt("flags.__init__()", lambda: flags.__init__())
attempt("flags after __init__", lambda: flags[decimal.Inexact])
attempt("context after that", lambda: (c.flags is flags, c.add(1, 2)))
attempt("repr(context) after that", lambda: repr(c))
Manager = type(decimal.localcontext())
attempt("ContextManager()", lambda: Manager())
attempt("ContextManager.__new__", lambda: Manager.__new__(Manager))
attempt("object.__new__(ContextManager)", lambda: object.__new__(Manager))
attempt("__enter__ of another", lambda: Manager.__enter__(Context()))
attempt("__exit__ of another", lambda: Manager.__exit__(1))

# ---- Methods on the wrong objects ----
for name in ("__add__", "__str__", "__hash__", "sqrt", "quantize", "as_tuple", "__format__", "__round__", "__reduce__", "__bool__", "__int__", "__float__", "__eq__", "__pow__", "__radd__", "__sizeof__", "real", "imag"):
    d = Decimal.__dict__[name]
    for wrong in (1, None, Context(), "x", 1.5):
        if hasattr(d, "__get__") and name in ("real", "imag"):
            attempt("Decimal.%s on %s" % (name, type(wrong).__name__), lambda: d.__get__(wrong))
        else:
            attempt("Decimal.%s on %s" % (name, type(wrong).__name__), lambda: d(wrong) if name not in ("__add__", "__eq__", "__pow__", "__radd__", "quantize", "__format__") else d(wrong, wrong))
for name in ("add", "abs", "copy", "__repr__", "__reduce__", "Etiny", "clear_flags", "create_decimal", "power", "__init__", "__getattribute__", "__setattr__", "__delattr__", "prec", "rounding"):
    d = Context.__dict__[name]
    for wrong in (1, None, Decimal(1), "x"):
        if name in ("prec", "rounding"):
            attempt("Context.%s on %s" % (name, type(wrong).__name__), lambda: d.__get__(wrong))
            attempt("Context.%s = on %s" % (name, type(wrong).__name__), lambda: d.__set__(wrong, 1))
        else:
            attempt("Context.%s on %s" % (name, type(wrong).__name__), lambda: d(wrong))
for name in ("__getitem__", "__setitem__", "__len__", "__iter__", "__repr__", "copy", "__eq__", "__init__"):
    attempt("SignalDictMixin.%s on a dict" % name, lambda: Mixin.__dict__[name]({}))
    attempt("SignalDictMixin.%s on a Context" % name, lambda: Mixin.__dict__[name](Context()))

# ---- Arguments with ideas of their own ----
class EvilIndex:
    def __index__(self):
        raise RuntimeError("index")
class EvilFloat(float):
    def __float__(self):
        raise RuntimeError("float")
    def as_integer_ratio(self):
        raise RuntimeError("ratio")
    def __abs__(self):
        raise RuntimeError("abs")
class EvilInt(int):
    def __index__(self):
        raise RuntimeError("index")
    def __int__(self):
        raise RuntimeError("int")
    def bit_length(self):
        raise RuntimeError("bit_length")
class EvilStr(str):
    def __str__(self):
        raise RuntimeError("str")
    def strip(self):
        raise RuntimeError("strip")
    def __len__(self):
        return -1
class EvilBool:
    def __init__(self, action):
        self.action = action
    def __bool__(self):
        return self.action()
class EvilTuple(tuple):
    def __len__(self):
        return 100
    def __getitem__(self, i):
        raise RuntimeError("item")
    def __iter__(self):
        raise RuntimeError("iter")
class EvilList(list):
    def __len__(self):
        return 100
    def __getitem__(self, i):
        raise RuntimeError("item")
attempt("Decimal(EvilFloat)", lambda: Decimal(EvilFloat(1.5)))
attempt("from_float(EvilFloat)", lambda: Decimal.from_float(EvilFloat(1.5)))
attempt("Decimal(EvilInt)", lambda: Decimal(EvilInt(15)))
attempt("Decimal + EvilInt", lambda: Decimal(1) + EvilInt(15))
attempt("Decimal == EvilFloat", lambda: Decimal("1.5") == EvilFloat(1.5))
attempt("Decimal(EvilStr)", lambda: Decimal(EvilStr("1.5")))
attempt("Decimal(EvilTuple)", lambda: Decimal(EvilTuple((0, (1, 2), -1))))
attempt("Decimal((0, EvilTuple, 1))", lambda: Decimal((0, EvilTuple((1, 2)), -1)))
attempt("Decimal(EvilList)", lambda: Decimal(EvilList([0, EvilList([1, 2]), -1])))
attempt("round(Decimal, EvilIndex)", lambda: round(Decimal(1), EvilIndex()))
attempt("round(Decimal, EvilInt)", lambda: round(Decimal("1.2345"), EvilInt(2)))
attempt("IEEEContext(EvilIndex)", lambda: decimal.IEEEContext(EvilIndex()))
attempt("Context(prec=EvilInt)", lambda: Context(prec=EvilInt(5)).prec)
attempt("Context(rounding=EvilStr)", lambda: Context(rounding=EvilStr("ROUND_UP")).rounding)
attempt("format(Decimal, EvilStr)", lambda: format(Decimal("1.5"), EvilStr(".3f")))

c = Context()
def grow():
    d[1] = 2
    return True
d = dict.fromkeys(c.flags, False)
d[decimal.Inexact] = EvilBool(grow)
attempt("traps = a dict that changes meanwhile", lambda: (setattr(c, "traps", d), c.traps[decimal.Inexact]))
d = dict.fromkeys(c.flags, EvilBool(lambda: 1 / 0))
attempt("traps = a dict of values that raise", lambda: setattr(c, "traps", d))
attempt("flags == such a dict", lambda: c.flags == d)

class EvilKey:
    def __hash__(self):
        raise RuntimeError("hash")
attempt("flags[EvilKey]", lambda: c.flags[EvilKey()])
class EqualToAll:
    def __eq__(self, other):
        return True
    def __hash__(self):
        return hash(decimal.Inexact)
attempt("flags[EqualToAll]", lambda: c.flags[EqualToAll()])
attempt("traps = dict with such keys", lambda: setattr(c, "traps", {EqualToAll(): True}))

# ---- Rationals of a kind ----
import numbers
class Rat(numbers.Rational):
    def __init__(self, n, d):
        self.n, self.d = n, d
    numerator = property(lambda self: self.n() if callable(self.n) else self.n)
    denominator = property(lambda self: self.d() if callable(self.d) else self.d)
    def _no(self, *a):
        return NotImplemented
    __abs__ = __add__ = __ceil__ = __floor__ = __floordiv__ = __le__ = __lt__ = __mod__ = __mul__ = __neg__ = __pos__ = __pow__ = __radd__ = __rfloordiv__ = __rmod__ = __rmul__ = __round__ = __rpow__ = __rtruediv__ = __truediv__ = __trunc__ = _no
    def __eq__(self, other):
        return NotImplemented
    __hash__ = None
def boom():
    raise RuntimeError("attribute")
for n, d in ((1, 2), (3, 2), ("1", 2), (1, "2"), (1.5, 2), (1, None), (boom, 2), (1, boom), (10 ** 400, 10 ** 399), (1, 0), (True, True)):
    attempt("Decimal('1.5') == Rat(%s, %s)" % (getattr(n, "__name__", n) if not isinstance(n, int) or n < 10 ** 9 else "big", getattr(d, "__name__", d) if not isinstance(d, int) or d < 10 ** 9 else "big"), lambda: (Decimal("1.5") == Rat(n, d), Decimal("1.5") < Rat(n, d)))
attempt("NaN == Rat(1, boom)", lambda: Decimal("NaN") == Rat(1, boom))
attempt("Infinity > Rat(1, boom)", lambda: Decimal("Infinity") > Rat(1, boom))
class Meta(type):
    def __instancecheck__(cls, obj):
        raise RuntimeError("instancecheck")

# ---- Classes derived from those of the module ----
class D(Decimal):
    def __new__(cls, *args):
        return Decimal.__new__(cls, *args)
    def __add__(self, other):
        return "added"
    def __hash__(self):
        return 5
    def __str__(self):
        return "str"
    def __repr__(self):
        return "D(...)"
    def __eq__(self, other):
        return "eq"
    def __format__(self, spec):
        return "formatted"
x = D("1.5")
x.attribute = [x]
attempt("subclass", lambda: (x + 1, 1 + x, x - 1, Decimal(1) + x, hash(x), str(x), repr(x), x == 1, format(x), f"{x}", type(x - 1).__name__, type(+x).__name__, type(x.quantize(1)).__name__, type(abs(x)).__name__))
attempt("subclass copies", lambda: (copy.copy(x) is x, copy.deepcopy(x) is x, type(pickle.loads(pickle.dumps(x))).__name__, Decimal(x), type(Decimal(x)).__name__, type(D(x)).__name__, D(x) is x))
attempt("subclass reduce", lambda: Decimal.__reduce__(x))
attempt("weakref to a Decimal", lambda: weakref.ref(Decimal(1)))
attempt("weakref to an instance of a subclass", lambda: weakref.ref(x)() is x)
attempt("attribute of a Decimal", lambda: setattr(Decimal(1), "a", 1))
attempt("__dict__ of a Decimal", lambda: Decimal(1).__dict__)
attempt("__class__ of a Decimal", lambda: setattr(Decimal(1), "__class__", D))
attempt("__class__ of a D", lambda: setattr(D(1), "__class__", Decimal))
class Slotted(Decimal):
    __slots__ = ("a", "b")
s = Slotted(5)
s.a = s
attempt("slots", lambda: (s.a is s, s + 1, hasattr(s, "b"), hasattr(s, "__dict__")))
class NewReturnsOther(Decimal):
    def __new__(cls, value):
        return 42
attempt("from_float of a class whose __new__ returns something else", lambda: NewReturnsOther.from_float(1.5))
attempt("from_number of it", lambda: NewReturnsOther.from_number(1))
class NewRaises(Decimal):
    def __new__(cls, value):
        raise RuntimeError("new")
attempt("from_float of a class whose __new__ raises", lambda: NewRaises.from_float(1.5))
attempt("class (Decimal, Context)", lambda: type("Both", (Decimal, Context), {}))
attempt("class (Decimal, int)", lambda: type("Both", (Decimal, int), {}))
attempt("class (ContextManager)", lambda: type("M", (Manager,), {}))
attempt("class (SignalDictMixin, dict)", lambda: type("M", (Mixin, dict), {}))
class C(Context):
    def __init__(self, *args, **kwargs):
        self.extra = 1
        super().__init__(*args, **kwargs)
    def add(self, a, b):
        return "added"
    def __repr__(self):
        return "C()"
k = C(prec=5)
attempt("context subclass", lambda: (k.prec, k.extra, k.add(1, 2), repr(k), type(k.copy()).__name__, type(copy.copy(k)).__name__, k.__reduce__()[0].__name__, type(pickle.loads(pickle.dumps(k))).__name__))
def use():
    decimal.setcontext(k)
    try:
        return (decimal.getcontext() is k, Decimal(1) / 3, Decimal(1) + 2)
    finally:
        decimal.setcontext(Context())
attempt("context subclass as the current one", use)
attempt("del k.extra", lambda: delattr(k, "extra"))
class NoInit(Context):
    def __init__(self):
        pass
attempt("context subclass without init", lambda: NoInit().divide(1, 3))
attempt("type attributes", lambda: setattr(Decimal, "x", 1))
attempt("type attributes", lambda: setattr(Context, "x", 1))
attempt("type attributes", lambda: delattr(Decimal, "sqrt"))

# ---- The context variable ----
decimal.getcontext()
variables = [v for v in contextvars.copy_context() if v.name == "decimal_context"]
print(len(variables))
def other():
    decimal.getcontext().prec = 3
    return Decimal(1) / 3
attempt("contextvars.Context().run", lambda: (contextvars.Context().run(other), Decimal(1) / 3))
attempt("copy_context().run", lambda: (contextvars.copy_context().run(other), Decimal(1) / 3))
decimal.setcontext(Context())

# ---- Cycles, and the collector ----
for i in range(3):
    c = Context()
    c2 = C()
    c2.me = c2
    c2.flags_again = c2.flags
    f = c.flags
    del c
    gc.collect()
    print(f[decimal.Inexact] if sys.implementation.name != "cpython" else False)
values = [Decimal(i) / 7 for i in range(2000)]
gc.collect()
print(sum(values))
