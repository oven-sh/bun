# decimal: what kills the C module of CPython 3.15, and what asks for more digits than there is memory for.
# usage: evil_decimal.py --list | GROUP
import sys, decimal, contextvars, gc
from decimal import Decimal, Context

def attempt(label, f):
    try:
        r = f()
    except BaseException as e:
        print(label, "->", type(e).__name__, str(e)[:200])
    else:
        r = repr(r)
        print(label, "->", r if len(r) < 200 else "%s... (%d characters)" % (r[:100], len(r)))
    sys.stdout.flush()

SignalDict = type(Context().flags)
GROUPS = {}
def group(f):
    GROUPS[f.__name__] = f
    return f

@group
def signal_dict_without_context_as_traps():
    attempt("Context(traps=SignalDict())", lambda: Context(traps=SignalDict()))
    attempt("Context(flags=SignalDict())", lambda: Context(flags=SignalDict()))

@group
def signal_dict_without_context_assigned():
    attempt("c.traps = SignalDict()", lambda: setattr(Context(), "traps", SignalDict()))
    attempt("c.flags = SignalDict()", lambda: setattr(Context(), "flags", SignalDict()))

@group
def signal_dict_parted_while_set():
    c = Context()
    class Evil:
        def __bool__(self):
            c.flags.__init__()
            return True
    attempt("flags[Inexact] = Evil()", lambda: c.flags.__setitem__(decimal.Inexact, Evil()))
    attempt("afterwards", lambda: (c.add(1, 2), repr(c)))

@group
def signal_dict_outlives_context():
    flags = Context().flags
    gc.collect()
    attempt("flags of a context that is gone", lambda: flags[decimal.Inexact] in (True, False))
    attempt("set", lambda: flags.__setitem__(decimal.Inexact, True))

@group
def context_variable_holds_something_else():
    decimal.getcontext()
    variable, = [v for v in contextvars.copy_context() if v.name == "decimal_context"]
    def spoil():
        variable.set(42)
        return Decimal(1) + 1
    attempt("Decimal(1) + 1", lambda: contextvars.copy_context().run(spoil))
    attempt("outside", lambda: Decimal(1) + 1)

def unbounded(**kw):
    c = Context(prec=decimal.MAX_PREC, Emax=decimal.MAX_EMAX, Emin=decimal.MIN_EMIN, traps=[])
    for k, v in kw.items():
        setattr(c, k, v)
    return c

def each(name, operations):
    for i, (label, f) in enumerate(operations):
        def g(label=label, f=f):
            attempt(label, f)
        GROUPS["%s_%02d" % (name, i)] = g

c = unbounded()
big = Decimal("1E+999999999999999999")
tiny = Decimal("1E-999999999999999999")
each("max_context", [
    ("1 / 3", lambda: c.divide(1, 3)),
    ("1 / 8", lambda: c.divide(1, 8)),
    ("sqrt(2)", lambda: c.sqrt(2)),
    ("sqrt(4)", lambda: c.sqrt(4)),
    ("sqrt(1E+999999999999999998)", lambda: c.sqrt(Decimal("1E+999999999999999998"))),
    ("exp(1)", lambda: c.exp(1)),
    ("exp(0)", lambda: c.exp(0)),
    ("ln(2)", lambda: c.ln(2)),
    ("ln(1)", lambda: c.ln(1)),
    ("log10(2)", lambda: c.log10(2)),
    ("log10(1E+5)", lambda: c.log10(Decimal("1E+5"))),
    ("2 ** 0.5", lambda: c.power(2, Decimal("0.5"))),
    ("2 ** 100", lambda: c.power(2, 100)),
    ("2 ** -1", lambda: c.power(2, -1)),
    ("3 ** -1", lambda: c.power(3, -1)),
    ("10 ** 999999999999999999", lambda: c.power(10, 999999999999999999)),
    ("10 ** 10**18", lambda: c.power(10, 10 ** 18)),
    ("2 ** 10**17", lambda: c.power(2, 10 ** 17)),
    ("big + 1", lambda: c.add(big, 1)),
    ("big - tiny", lambda: c.subtract(big, tiny)),
    ("big * big", lambda: c.multiply(big, big)),
    ("tiny * tiny", lambda: c.multiply(tiny, tiny)),
    ("big / tiny", lambda: c.divide(big, tiny)),
    ("big // 7", lambda: c.divide_int(big, 7)),
    ("big % 7", lambda: c.remainder(big, 7)),
    ("divmod(big, 7)", lambda: c.divmod(big, 7)),
    ("remainder_near(big, 7)", lambda: c.remainder_near(big, 7)),
    ("fma(big, 1, 1)", lambda: c.fma(big, 1, 1)),
    ("quantize(1, tiny)", lambda: c.quantize(1, tiny)),
    ("quantize(big, 1)", lambda: c.quantize(big, 1)),
    ("to_integral_value(big)", lambda: c.to_integral_value(big)),
    ("to_integral_exact(tiny)", lambda: c.to_integral_exact(tiny)),
    ("shift(1, 999999999999999998)", lambda: c.shift(1, 999999999999999998)),
    ("rotate(1, 999999999999999998)", lambda: c.rotate(1, 999999999999999998)),
    ("scaleb(1, 999999999999999999)", lambda: c.scaleb(1, 999999999999999999)),
    ("logical_invert(0)", lambda: c.logical_invert(0)),
    ("logical_and(1, 1)", lambda: c.logical_and(1, 1)),
    ("next_plus(1)", lambda: c.next_plus(1)),
    ("next_minus(1)", lambda: c.next_minus(1)),
    ("next_toward(1, 2)", lambda: c.next_toward(1, 2)),
    ("next_plus(0)", lambda: c.next_plus(0)),
    ("normalize(big)", lambda: c.normalize(big)),
    ("plus(big)", lambda: c.plus(big)),
    ("compare(big, tiny)", lambda: c.compare(big, tiny)),
    ("max(big, tiny)", lambda: c.max(big, tiny)),
    ("logb(big)", lambda: c.logb(big)),
    ("power(3, 5, 7)", lambda: c.power(3, 5, 7)),
    ("power(big, 5, 7)", lambda: c.power(big, 5, 7)),
    ("create_decimal('1' + '0' * 100)", lambda: c.create_decimal("1" + "0" * 100)),
    ("clamp: plus(1)", lambda: unbounded(clamp=1).plus(1)),
    ("clamp: plus(big)", lambda: unbounded(clamp=1).plus(big)),
    ("clamp: plus(0E+999999999999999999)", lambda: unbounded(clamp=1).plus(Decimal("0E+999999999999999999"))),
])
each("written_out", [
    ("int(big)", lambda: int(big)),
    ("int(1E+10000000000)", lambda: int(Decimal("1E+10000000000"))),
    ("int(tiny)", lambda: int(tiny)),
    ("round(big)", lambda: round(big)),
    ("floor(big)", lambda: big.__floor__()),
    ("float(big)", lambda: float(big)),
    ("float(tiny)", lambda: float(tiny)),
    ("complex(big)", lambda: complex(big)),
    ("hash(big)", lambda: hash(big)),
    ("hash(tiny)", lambda: hash(tiny)),
    ("str(big)", lambda: str(big)),
    ("str(0E-999999999999999999)", lambda: str(Decimal("0E-999999999999999999"))),
    ("str(0E+999999999999999999)", lambda: str(Decimal("0E+999999999999999999"))),
    ("to_eng_string(0E-999999999999999999)", lambda: Decimal("0E-999999999999999999").to_eng_string()),
    ("format(big, 'f')", lambda: format(big, "f")),
    ("format(tiny, 'f')", lambda: format(tiny, "f")),
    ("format(1E+100000000000, 'f')", lambda: format(Decimal("1E+100000000000"), "f")),
    ("format(1, '.999999999999999999f')", lambda: format(Decimal(1), ".999999999999999999f")),
    ("format(1, '.100000000000f')", lambda: format(Decimal(1), ".100000000000f")),
    ("format(1, '.100000000000e')", lambda: format(Decimal(1), ".100000000000e")),
    ("format(1, '100000000000')", lambda: format(Decimal(1), "100000000000")),
    ("format(1, '999999999999999999')", lambda: format(Decimal(1), "999999999999999999")),
    ("format(big, '%')", lambda: format(big, "%")),
    ("format(big, 'e')", lambda: format(big, "e")),
    ("format(big, 'g')", lambda: format(big, "g")),
    ("format(big, ',')", lambda: format(big, ",")),
    ("as_integer_ratio(big)", lambda: big.as_integer_ratio()),
    ("as_integer_ratio(tiny)", lambda: tiny.as_integer_ratio()),
    ("as_integer_ratio(1E+10000000000)", lambda: Decimal("1E+10000000000").as_integer_ratio()),
    ("as_tuple(big)", lambda: big.as_tuple()),
    ("big == 10**100", lambda: big == 10 ** 100),
    ("big > 1.5", lambda: big > 1.5),
    ("tiny < Fraction", lambda: tiny < __import__("fractions").Fraction(1, 3)),
    ("big == Fraction", lambda: big == __import__("fractions").Fraction(10 ** 50, 3)),
    ("round(big, 5)", lambda: round(big, 5)),
    ("round(1, 999999999999999999)", lambda: round(Decimal(1), 999999999999999999)),
    ("round(1, 10**17)", lambda: round(Decimal(1), 10 ** 17)),
    ("Decimal((0, (1,), 999999999999999999))", lambda: Decimal((0, (1,), 999999999999999999))),
    ("Decimal('1' * 10**6) digits", lambda: len(Decimal("1" * 10 ** 6).as_tuple().digits)),
    ("Decimal(10 ** 100000) adjusted", lambda: Decimal(10 ** 100000).adjusted()),
    ("pickle", lambda: __import__("pickle").loads(__import__("pickle").dumps(big))),
])
half = Context(prec=10 ** 13, Emax=decimal.MAX_EMAX, Emin=decimal.MIN_EMIN, traps=[])
each("more_than_the_machine_has", [
    ("prec 10**13: 1 / 3", lambda: half.divide(1, 3)),
    ("prec 10**13: sqrt(2)", lambda: half.sqrt(2)),
    ("prec 10**13: exp(1)", lambda: half.exp(1)),
    ("prec 10**13: ln(2)", lambda: half.ln(2)),
    ("prec 10**13: next_plus(1)", lambda: half.next_plus(1)),
    ("prec 10**13: logical_invert(0)", lambda: half.logical_invert(0)),
    ("prec 10**13: shift(1, 10**13 - 1)", lambda: half.shift(1, 10 ** 13 - 1)),
    ("prec 10**13: 1E+9999999999999 + 1", lambda: half.add(Decimal("1E+9999999999999"), 1)),
    ("prec 10**13: quantize(1, 1E-9999999999999)", lambda: half.quantize(1, Decimal("1E-9999999999999"))),
])

if __name__ == "__main__":
    if sys.argv[1:] == ["--list"]:
        print("\n".join(GROUPS))
    else:
        for name in sys.argv[1:] or GROUPS:
            GROUPS[name]()
