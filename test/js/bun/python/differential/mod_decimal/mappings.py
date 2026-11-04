# context.flags and context.traps as mappings, and what else can be done with them.
import decimal, copy, pickle, weakref, collections.abc, operator
from decimal import Context, Inexact, Rounded, Clamped

def attempt(label, f):
    try:
        r = f()
    except BaseException as e:
        print(label, "->", type(e).__name__, e)
    else:
        print(label, "->", repr(r))

c = Context(flags=[Inexact], traps=[Rounded, Clamped])
f, t = c.flags, c.traps
names = lambda m: [k.__name__ for k, v in m.items() if v]
attempt("identity", lambda: (c.flags is f, c.traps is t, f is t, type(f) is type(t)))
attempt("type", lambda: (type(f).__name__, type(f).__module__, type(f).__qualname__, [b.__name__ for b in type(f).__mro__], type(type(f)).__name__))
attempt("isinstance", lambda: (isinstance(f, dict), isinstance(f, collections.abc.MutableMapping), isinstance(f, collections.abc.Mapping), isinstance(f, collections.abc.Hashable)))
attempt("dict()", lambda: names(dict(f)))
attempt("keys", lambda: [k.__name__ for k in f.keys()])
attempt("values", lambda: list(f.values()))
attempt("items", lambda: [(k.__name__, v) for k, v in t.items()])
attempt("len, bool", lambda: (len(f), bool(f)))
attempt("in", lambda: (Inexact in f, decimal.DecimalException in f, 1 in f, None in f))
attempt("get", lambda: (f.get(Inexact), f.get(Rounded), f.get(1), f.get(1, "x")))
attempt("reversed", lambda: list(reversed(f)))
attempt("iter twice", lambda: [a is b for a, b in zip(f, t)])
attempt("or", lambda: f | {})
attempt("ior", lambda: operator.ior(f, {}))
attempt("update", lambda: (f.update({Rounded: 1, Clamped: 0}), names(f), repr(c)))
attempt("update with a bad key", lambda: f.update({1: 1}))
attempt("update by keyword", lambda: f.update(a=1))
attempt("setdefault", lambda: (f.setdefault(Inexact, False), f.setdefault(Clamped, True), names(f)))
attempt("pop", lambda: f.pop(Inexact))
attempt("pop missing", lambda: f.pop(1))
attempt("pop default", lambda: f.pop(1, "x"))
attempt("popitem", lambda: f.popitem())
attempt("clear", lambda: f.clear())
attempt("after all that", lambda: (names(f), names(t)))
alike = Context(traps=[Rounded, Clamped])
attempt("eq", lambda: (f == f, f == t, f != t, f == dict(f), dict(f) == f, f == dict(t), t == alike.traps))
attempt("order", lambda: f < t)
attempt("hash", lambda: hash(f))
attempt("copy method", lambda: (type(f.copy()).__name__, names(f.copy())))
attempt("copy.copy", lambda: copy.copy(f))
attempt("copy.deepcopy", lambda: copy.deepcopy(f))
attempt("pickle", lambda: pickle.dumps(f))
attempt("reduce_ex", lambda: f.__reduce_ex__(2)[0].__name__)
attempt("weakref", lambda: weakref.ref(f)() is f)
attempt("attribute", lambda: (setattr(f, "x", 1), f.x, f.__dict__))
attempt("class attribute", lambda: (setattr(type(f), "y", 2), t.y, delattr(type(f), "y")))
attempt("str, format", lambda: (str(f) == repr(f), format(f) == repr(f)))
attempt("values that are not bools", lambda: (f.__setitem__(Inexact, "yes"), f[Inexact], f.__setitem__(Inexact, []), f[Inexact], f.__setitem__(Inexact, 2.5), f[Inexact]))
attempt("assigning one to the other", lambda: (setattr(c, "flags", t), names(c.flags), c.flags is f, setattr(c, "traps", f), c.traps is t))
other = Context(traps=[Inexact])
attempt("assigning another context's", lambda: (setattr(c, "traps", other.traps), names(c.traps), c.traps is t, other.traps.__setitem__(Rounded, True), names(c.traps)))
attempt("the context follows", lambda: (t.__setitem__(Inexact, False), c.divide(1, 3), f[Inexact], t.__setitem__(Inexact, True)))
attempt("and traps", lambda: c.divide(1, 3))
attempt("InvalidOperation covers its conditions", lambda: (c.clear_flags(), c.clear_traps(), c.create_decimal("x"), names(f), f == {k: k is decimal.InvalidOperation for k in f}, repr(c)))
attempt("set by hand it compares equal", lambda: (c.clear_flags(), f.__setitem__(decimal.InvalidOperation, True), f == {k: k is decimal.InvalidOperation for k in f}))
attempt("subclass", lambda: len(type("S", (type(f),), {})()))
attempt("abstract methods", lambda: sorted(type(f).__abstractmethods__))
attempt("match", lambda: (lambda m: "mapping" if isinstance(m, collections.abc.Mapping) else "no")(f))
def matches(m):
    match m:
        case {decimal.Inexact: v}:
            return ("matched", v)
        case _:
            return "no"
attempt("match statement", lambda: matches(f))
attempt("star-star", lambda: (lambda **k: k)(**f))
attempt("dict union from the left", lambda: {} | f)
attempt("sorted by name", lambda: [k.__name__ for k in sorted(f, key=lambda k: k.__name__)])
