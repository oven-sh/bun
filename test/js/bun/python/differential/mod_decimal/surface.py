# What the module _decimal has, and what its types have: names, kinds, signatures, docstrings.
import _decimal, decimal, inspect, numbers, collections.abc, warnings
warnings.simplefilter("ignore")

def doc(v):
    d = getattr(v, "__doc__", None)
    return None if d is None else (len(d), d.split("\n")[0][:60])

def describe(cls):
    print("==", cls.__module__, cls.__qualname__, type(cls).__name__, [b.__name__ for b in cls.__mro__], cls.__flags__ & ((1 << 7) | (1 << 8) | (1 << 10)),
          cls.__dictoffset__ != 0, cls.__weakrefoffset__ != 0, getattr(cls, "__text_signature__", None), doc(cls))
    for k, v in sorted(vars(cls).items()):
        if k == "__new__" and cls.__name__ == "SignalDictMixin":
            continue
        print("  ", k, type(v).__name__, repr(getattr(v, "__text_signature__", None)), doc(v) if not isinstance(v, (str, type(None), frozenset)) else v if k != "__doc__" else "")

c = _decimal.getcontext()
for cls in (_decimal.Decimal, _decimal.Context, type(c.flags), type(c.flags).__mro__[1], type(_decimal.localcontext()), _decimal.DecimalTuple):
    if cls is not _decimal.DecimalTuple:
        describe(cls)
print("== module", _decimal.__name__, _decimal.__doc__, _decimal.__spec__.name)
for k, v in sorted(vars(_decimal).items()):
    if k in ("__file__", "__loader__", "__spec__", "__package__", "__cached__"):
        continue
    print("  ", k, type(v).__name__, repr(getattr(v, "__text_signature__", None)), v if isinstance(v, (int, str, bool)) else "", getattr(v, "__module__", None), doc(v) if callable(v) and not isinstance(v, type) else "")
for name in ("DecimalException", "Clamped", "InvalidOperation", "ConversionSyntax", "DivisionByZero", "DivisionImpossible", "DivisionUndefined", "Inexact", "InvalidContext", "Rounded",
             "Subnormal", "Overflow", "Underflow", "FloatOperation"):
    e = getattr(_decimal, name)
    print(e, [b.__name__ for b in e.__bases__], e.__module__, e.__qualname__, e.__doc__, sorted(vars(e)), [b.__name__ for b in e.__mro__])
print(_decimal.DecimalTuple, _decimal.DecimalTuple.__module__, _decimal.DecimalTuple._fields, _decimal.DecimalTuple.__mro__)
# A module that is part of the program has no __file__.
print(sorted(set(dir(decimal)) - set(dir(_decimal)) - {"__file__"}), sorted(n for n in set(dir(_decimal)) - set(dir(decimal))))
print(decimal.Decimal is _decimal.Decimal, decimal.getcontext is _decimal.getcontext, decimal.__name__, decimal.__version__, decimal.__libmpdec_version__, decimal.SPEC_VERSION)
print(isinstance(_decimal.Decimal(1), numbers.Number), isinstance(_decimal.Decimal(1), numbers.Real), issubclass(_decimal.Decimal, numbers.Number), isinstance(c.flags, collections.abc.MutableMapping))
for f in (_decimal.Decimal, _decimal.Context, _decimal.Decimal.quantize, _decimal.Decimal.__format__, _decimal.Decimal.__round__, _decimal.Context.power, _decimal.Context.create_decimal,
          _decimal.localcontext, _decimal.getcontext, _decimal.setcontext, _decimal.IEEEContext, _decimal.Decimal.from_float, _decimal.Decimal(1).fma, c.fma):
    try:
        print(getattr(f, "__qualname__", f), inspect.signature(f))
    except (ValueError, TypeError) as e:
        print(getattr(f, "__qualname__", f), type(e).__name__, e)
for o in (_decimal.Decimal(1).sqrt, c.sqrt, _decimal.Decimal.sqrt, _decimal.Decimal.__add__, _decimal.Decimal(1).__add__, _decimal.Decimal.from_float, _decimal.getcontext, _decimal.Decimal.real, _decimal.Context.prec):
    print(repr(o).split(" at 0x")[0], getattr(o, "__name__", None), getattr(o, "__qualname__", None), getattr(o, "__module__", None), getattr(getattr(o, "__objclass__", None), "__name__", None))
print(_decimal.DefaultContext, _decimal.BasicContext, _decimal.ExtendedContext, sep="\n")
