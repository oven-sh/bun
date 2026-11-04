# Formats, precisions and exponents at the limits of the module: what is refused, with which exception, and what is out of memory.
import sys
from decimal import *

M = sys.maxsize

def attempt(label, f):
    try:
        r = f()
        r = repr(r)
        r = r if len(r) < 80 else "%d characters" % len(r)
    except BaseException as e:
        r = "%s: %s" % (type(e).__name__, e)
    print(label, "->", r)

for v in ("1.23456789", "NaN", "Infinity", "0", "1E+999999999999999999", "1E-999999999999999999"):
    for spec in ("=%d.1" % M, "%d" % M, ".%d" % M, ".%df" % M, "%d.%df" % (M, M), "1000000000000000000", "999999999999999999", ".1000000000000000000f", ".999999999999999999f",
                 ".999999999999999999e", ".999999999999999999g", ".999999999999999999%", ".99999999999999999999999", "f", "%", "e", "g", ",f", "E", "G", "n"):
        attempt("format(%s, %r)" % (v, spec), lambda: format(Decimal(v), spec))

print(MAX_PREC, MAX_EMAX, MIN_EMIN, MIN_ETINY)
for name, good, bad in (("prec", (1, MAX_PREC), (0, -1, MAX_PREC + 1, M, M + 1, -M - 2)), ("Emax", (0, MAX_EMAX), (-1, MAX_EMAX + 1, M, M + 1)),
                        ("Emin", (0, MIN_EMIN), (1, MIN_EMIN - 1, -M - 1, -M - 2)), ("clamp", (0, 1), (2, -1, M + 1)), ("capitals", (0, 1), (2, -1, M + 1))):
    for value in good + bad:
        attempt("Context(%s=%d)" % (name, value), lambda: getattr(Context(**{name: value}), name))
        c = Context()
        attempt("c.%s = %d" % (name, value), lambda: (setattr(c, name, value), getattr(c, name))[1])

widest = Context(prec=MAX_PREC, Emax=MAX_EMAX, Emin=MIN_EMIN, traps=[])
attempt("Etiny, Etop", lambda: (widest.Etiny(), widest.Etop()))
for text in ("1E+999999999999999999", "1E+1000000000000000000", "9.9E+999999999999999999", "1E-999999999999999999", "1E-1999999999999999997", "1E-1999999999999999998",
             "1E+9223372036854775807", "1E+9223372036854775808", "1E-9223372036854775808", "1E-9223372036854775809", "1E+99999999999999999999999999", "0E+99999999999999999999999999",
             "0E-99999999999999999999999999", "-0E+9223372036854775807"):
    attempt("Decimal(%r)" % text, lambda: Decimal(text))
    widest.clear_flags()
    attempt("create_decimal(%r)" % text, lambda: (widest.create_decimal(text), [s.__name__ for s, on in widest.flags.items() if on]))

big, small = Decimal("9E+999999999999999999"), Decimal("1E-1999999999999999997")
for label, f in (("big + big", lambda c: c.add(big, big)), ("big * big", lambda c: c.multiply(big, big)), ("small * small", lambda c: c.multiply(small, small)), ("small / big", lambda c: c.divide(small, big)),
                 ("big / small", lambda c: c.divide(big, small)), ("1 / 3", lambda c: c.divide(1, 3)), ("sqrt(2)", lambda c: c.sqrt(2)), ("exp(1)", lambda c: c.exp(1)),
                 ("big + 1", lambda c: c.add(big, 1)), ("big - small", lambda c: c.subtract(big, small)),
                 ("big // 1", lambda c: c.divide_int(big, 1)), ("big % 7", lambda c: c.remainder(big, 7)), ("quantize", lambda c: c.quantize(big, 1)), ("to_integral", lambda c: c.to_integral_value(big)),
                 ("scaleb", lambda c: c.scaleb(1, MAX_EMAX)), ("scaleb more", lambda c: c.scaleb(1, 2 * MAX_EMAX + 1)), ("shift", lambda c: c.shift(1, 10)), ("rotate", lambda c: c.rotate(1, 10)),
                 ("next_plus", lambda c: c.next_plus(big)), ("next_minus", lambda c: c.next_minus(0)), ("logb", lambda c: c.logb(big)), ("fma", lambda c: c.fma(big, big, 1)),
                 ("normalize", lambda c: c.normalize(big)), ("compare", lambda c: c.compare(big, small)),
                 ("max", lambda c: c.max(big, small)), ("logical_invert", lambda c: c.logical_invert(0)), ("int(big)", lambda c: int(big)), ("float(big)", lambda c: float(big)), ("float(small)", lambda c: float(small)),
                 ("hash(big)", lambda c: hash(big)), ("hash(small)", lambda c: hash(small)), ("str(big)", lambda c: str(big)), ("as_tuple", lambda c: big.as_tuple()), ("adjusted", lambda c: (big.adjusted(), small.adjusted())),
                 ("round(big)", lambda c: round(big)), ("round(big, 2)", lambda c: round(big, 2)), ("big == small", lambda c: big == small), ("big > 10**30", lambda c: big > 10 ** 30),
                 ("big > 1e300", lambda c: big > 1e300), ("to_eng_string", lambda c: c.to_eng_string(big))):
    for traps in ([], [Overflow, Underflow, InvalidOperation, DivisionByZero]):
        c = Context(prec=MAX_PREC, Emax=MAX_EMAX, Emin=MIN_EMIN, traps=traps)
        attempt("%s%s" % (label, " trapped" if traps else ""), lambda: (f(c), [s.__name__ for s, on in c.flags.items() if on]))
for bits in (0, 1, 31, 32, 64, 96, 128, 160, 512, 544, -32, 33, M, M + 1):
    attempt("IEEEContext(%d)" % bits, lambda: IEEEContext(bits))
print(IEEE_CONTEXT_MAX_BITS)
