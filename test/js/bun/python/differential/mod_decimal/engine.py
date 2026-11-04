# Random operations on the decimal module, one line of output for each: what was done, and the result with the flags it raised, or
# the exception with its message. The same seed gives the same operations everywhere, so two implementations can be compared line by line.
# The scripts g_KIND_SEED.py are samples (tools/gen.py writes them); tools/compare.py runs as many cases as one likes under two interpreters.
#
# usage: engine.py KIND SEED COUNT
import sys, math, copy, pickle, operator, warnings
from fractions import Fraction
import decimal as D
warnings.simplefilter("ignore")

Decimal, Context = D.Decimal, D.Context
SIGNALS = [D.InvalidOperation, D.FloatOperation, D.DivisionByZero, D.Overflow, D.Underflow, D.Subnormal, D.Inexact, D.Rounded, D.Clamped]
ROUNDINGS = [D.ROUND_UP, D.ROUND_DOWN, D.ROUND_CEILING, D.ROUND_FLOOR, D.ROUND_HALF_UP, D.ROUND_HALF_DOWN, D.ROUND_HALF_EVEN, D.ROUND_05UP]


class Random:
    def __init__(self, seed):
        self.s = (seed * 0x9E3779B97F4A7C15 + 0x1234567) & 0xFFFFFFFFFFFFFFFF or 1

    def bits(self):
        s = self.s
        s ^= (s << 13) & 0xFFFFFFFFFFFFFFFF
        s ^= s >> 7
        s ^= (s << 17) & 0xFFFFFFFFFFFFFFFF
        self.s = s
        return s

    def below(self, n):
        return self.bits() % n

    def randint(self, a, b):
        n = b - a + 1
        r = self.bits()
        while n > (1 << 60):
            r = (r << 64) | self.bits()
            n >>= 64
        return a + r % (b - a + 1)

    def chance(self, percent):
        return self.bits() % 100 < percent

    def choice(self, seq):
        return seq[self.bits() % len(seq)]


def digits(R, n, alphabet=None):
    if n <= 0:
        return "0"
    if alphabet is None:
        k = R.below(10)
        if k == 0:
            return "9" * n
        if k == 1:
            return R.choice("123456789") + "0" * (n - 1)
        alphabet = ("09", "05", "0123456789", "0123456789", "0123456789", "0123456789", "0123456789", "0123456789")[k - 2]
    return "".join(R.choice(alphabet) for _ in range(n))


def number_text(R, c):
    sign = R.choice(("", "", "-"))
    k = R.below(100)
    if k < 4:
        return sign + R.choice(("Infinity", "NaN", "sNaN", "NaN123", "sNaN9", "NaN" + digits(R, R.randint(1, c.prec + 3))))
    if k < 9:
        return sign + "0" + R.choice(("", "E%d" % R.randint(-50, 50), "E%d" % R.randint(c.Emin * 2 - 10, c.Emax * 2 + 10), ".000"))
    nd = R.choice((1, 2, 3, R.randint(1, c.prec), R.randint(1, c.prec), c.prec, c.prec + 1, R.randint(1, 2 * c.prec + 5), 19, 20, 38, 39))
    j = R.below(100)
    if j < 35:
        e = R.randint(-nd - 3, 5)
    elif j < 70:
        e = R.randint(-40, 40)
    elif j < 85:
        e = R.randint(c.Emin - c.prec - 5, c.Emax + 5)
    elif j < 95:
        e = R.choice((c.Emin, c.Emax, c.Etiny(), c.Etop(), c.Emin - nd, c.Emax - nd + 1, c.Emax - nd, c.Etiny() - 1)) + R.randint(-2, 2)
    else:
        e = R.randint(-10 ** R.randint(1, 17), 10 ** R.randint(1, 17))
    return "%s%sE%d" % (sign, digits(R, nd), e)


MAXCTX = Context(prec=D.MAX_PREC, Emax=D.MAX_EMAX, Emin=D.MIN_EMIN, traps=[])


def operand(R, c):
    k = R.below(100)
    if k < 12:
        return R.randint(-10 ** R.randint(1, 40), 10 ** R.randint(1, 40))
    if k < 14:
        return R.choice((True, False, 0, 1, -1))
    return Decimal(number_text(R, c), MAXCTX)


def small_operand(R, c):
    k = R.below(100)
    if k < 50:
        return Decimal(R.randint(-c.prec - 2, c.prec + 2))
    if k < 70:
        return R.randint(-c.prec - 2, c.prec + 2)
    if k < 85:
        return Decimal(R.randint(-1000, 1000))
    return operand(R, c)


def context(R, maxprec=45, traps=True):
    prec = R.choice((1, 2, 3, 9, 16, 19, 20, 28, 28, 28, 34, 38, 39, R.randint(1, maxprec), R.randint(1, maxprec)))
    k = R.below(100)
    if k < 35:
        emax, emin = 999999, -999999
    elif k < 60:
        emax, emin = R.randint(0, 100), -R.randint(0, 100)
    elif k < 80:
        emax, emin = R.randint(0, 10), -R.randint(0, 10)
    elif k < 90:
        emax, emin = D.MAX_EMAX, D.MIN_EMIN
    else:
        emax, emin = R.randint(0, 10 ** R.randint(1, 17)), -R.randint(0, 10 ** R.randint(1, 17))
    t = []
    if traps and R.chance(40):
        t = [s for s in SIGNALS if R.chance(25)]
    return Context(prec=prec, rounding=R.choice(ROUNDINGS), Emin=emin, Emax=emax, clamp=R.below(3) == 0, capitals=R.below(4) != 0, traps=t, flags=[])


def show_context(c):
    return "p%d %s %d %d c%d C%d t%s" % (c.prec, c.rounding[6:], c.Emin, c.Emax, c.clamp, c.capitals, "".join(s.__name__[0:2] for s in SIGNALS if c.traps[s]))


def show(v):
    if type(v) is float and v != v:
        return "nan" if math.copysign(1, v) > 0 else "-nan"
    if type(v) is complex and v != v:
        return "complex(%s, %s)" % (show(v.real), show(v.imag))
    if isinstance(v, tuple) and type(v) is tuple:
        return "(" + ", ".join(show(x) for x in v) + ")"
    return "%s:%r" % (type(v).__name__, v)


def attempt(label, c, f):
    try:
        r = show(f())
    except MemoryError:
        r = "!MemoryError"
    except RecursionError:
        r = "!RecursionError"
    except BaseException as e:
        r = "!%s: %s" % (type(e).__name__, e)
    flags = "".join(s.__name__[0:2] for s in SIGNALS if c.flags[s]) if c is not None else ""
    if len(r) > 1500:
        r = "%s... (%d characters, sum %d)" % (r[:700], len(r), sum(map(ord, r)) % 1000003)
    print(label[:1500], "->", r, flags)


UNARY = ("exp ln log10 next_minus next_plus normalize sqrt logb logical_invert number_class to_eng_string is_normal is_subnormal").split()
UNARY_PLAIN = ("adjusted canonical conjugate radix copy_abs copy_negate is_canonical is_finite is_infinite is_nan is_qnan is_snan is_signed is_zero "
               "as_tuple as_integer_ratio __copy__ __reduce__ __ceil__ __floor__ __trunc__ __complex__ __int__ __float__ __bool__ __hash__ __str__ __repr__ "
               "__neg__ __pos__ __abs__ __round__").split()
BINARY = ("compare compare_signal max max_mag min min_mag next_toward remainder_near compare_total compare_total_mag copy_sign same_quantum "
          "logical_and logical_or logical_xor rotate scaleb shift quantize").split()
CTX_UNARY = ("abs exp ln log10 minus next_minus next_plus normalize plus to_integral to_integral_exact to_integral_value sqrt is_canonical is_finite is_infinite "
             "is_nan is_normal is_qnan is_signed is_snan is_subnormal is_zero _apply canonical copy_abs copy_decimal copy_negate logb logical_invert number_class "
             "to_sci_string to_eng_string create_decimal").split()
CTX_BINARY = ("add compare compare_signal divide divide_int divmod max max_mag min min_mag multiply next_toward quantize remainder remainder_near subtract "
              "compare_total compare_total_mag copy_sign logical_and logical_or logical_xor rotate same_quantum scaleb shift power").split()
OPERATORS = [("+", operator.add), ("-", operator.sub), ("*", operator.mul), ("/", operator.truediv), ("//", operator.floordiv), ("%", operator.mod),
             ("divmod", divmod), ("**", operator.pow)]
COMPARISONS = [("==", operator.eq), ("!=", operator.ne), ("<", operator.lt), ("<=", operator.le), (">", operator.gt), (">=", operator.ge)]
SLOW = ("exp", "ln", "log10", "power", "**")


def tame(R, c, name, args):
    """Operands for which the operation neither takes long nor needs much memory."""
    if name in ("logical_and", "logical_or", "logical_xor", "logical_invert") and R.chance(80):
        return [Decimal(digits(R, R.randint(1, c.prec + 3), "01")) for _ in args]
    if name in ("rotate", "scaleb", "shift"):
        return [args[0], small_operand(R, c)]
    if name == "quantize" and R.chance(70):
        return [args[0], Decimal("1E%d" % R.randint(-c.prec - 3, c.prec + 3))]
    if name in ("power", "**"):
        k = R.below(100)
        if k < 40:
            return [args[0], R.choice((Decimal, int))(R.randint(-200, 200))]
        if k < 70:
            return [Decimal("%sE%d" % (digits(R, R.randint(1, c.prec)), R.randint(-c.prec - 2, 3))), Decimal("%s%sE%d" % (R.choice(("", "-")), digits(R, R.randint(1, 6)), R.randint(-6, 2)))]
        if k < 80:
            return [Decimal(R.choice(("1", "1.000", "-1", "1.0", "10", "0.1", "2", "0.5", "100", "-1.00"))), args[1]]
    if name in ("remainder", "remainder_near", "divide_int", "divmod", "//", "%") and R.chance(70):
        e = R.randint(-10, 10)
        return [Decimal("%s%sE%d" % (R.choice(("", "-")), digits(R, R.randint(1, c.prec + 2)), e + R.randint(-3, 3))), Decimal("%s%sE%d" % (R.choice(("", "-")), digits(R, R.randint(1, c.prec + 2)), e))]
    if name == "exp" and R.chance(70):
        return [Decimal("%s%sE%d" % (R.choice(("", "-")), digits(R, R.randint(1, c.prec + 2)), R.randint(-c.prec - 5, 3) - R.randint(0, c.prec)))]
    if name in ("ln", "log10", "sqrt") and R.chance(80) and isinstance(args[0], Decimal):
        return [args[0].copy_abs()]
    return args


def huge(v):
    """Whether turning the number into an int or a plain string would need a lot of memory."""
    return isinstance(v, Decimal) and v.is_finite() and abs(v.adjusted()) + abs(v.as_tuple().exponent) > 3000


def arithmetic(R, i):
    c = context(R)
    kind = R.below(100)
    where = show_context(c)
    if kind < 25:
        name, f = R.choice(OPERATORS)
        a, b = tame(R, c, name, [operand(R, c), operand(R, c)])
        if not isinstance(a, Decimal) and not isinstance(b, Decimal):
            a = Decimal(a)
        D.setcontext(c)
        attempt("%d [%s] %r %s %r" % (i, where, a, name, b), c, lambda: f(a, b))
    elif kind < 45:
        name = R.choice(CTX_BINARY)
        a, b = tame(R, c, name, [operand(R, c), operand(R, c)])
        attempt("%d [%s] c.%s(%r, %r)" % (i, where, name, a, b), c, lambda: getattr(c, name)(a, b))
    elif kind < 60:
        name = R.choice(CTX_UNARY)
        a, = tame(R, c, name, [operand(R, c)])
        if name in ("to_sci_string", "to_eng_string") and huge(a) and a == 0:
            a = Decimal(0)
        attempt("%d [%s] c.%s(%r)" % (i, where, name, a), c, lambda: getattr(c, name)(a))
    elif kind < 72:
        name = R.choice(BINARY)
        a, b = tame(R, c, name, [Decimal(operand(R, c)), operand(R, c)])
        if name == "quantize" and R.chance(30):
            r = R.choice(ROUNDINGS)
            attempt("%d [%s] %r.quantize(%r, %s)" % (i, where, a, b, r), c, lambda: a.quantize(b, rounding=r, context=c))
        elif R.chance(50):
            attempt("%d [%s] %r.%s(%r, c)" % (i, where, a, name, b), c, lambda: getattr(a, name)(b, context=c))
        else:
            D.setcontext(c)
            attempt("%d [%s] %r.%s(%r)" % (i, where, a, name, b), c, lambda: getattr(a, name)(b))
    elif kind < 82:
        name = R.choice(UNARY)
        a, = tame(R, c, name, [Decimal(operand(R, c))])
        if name == "to_eng_string" and huge(a) and a == 0:
            a = Decimal(0)
        attempt("%d [%s] %r.%s(c)" % (i, where, a, name), c, lambda: getattr(a, name)(context=c))
    elif kind < 92:
        name = R.choice(UNARY_PLAIN)
        a = Decimal(operand(R, c))
        if huge(a) and name in ("as_integer_ratio", "__ceil__", "__floor__", "__trunc__", "__int__", "__round__"):
            a = a.scaleb(-a.adjusted(), MAXCTX)
        D.setcontext(c)
        if name == "__hash__" and a.is_qnan():
            name = "__str__"
        attempt("%d [%s] %r.%s()" % (i, where, a, name), c, lambda: getattr(a, name)())
    elif kind < 95:
        a, b, t = operand(R, c), operand(R, c), operand(R, c)
        if R.chance(50):
            attempt("%d [%s] c.fma(%r, %r, %r)" % (i, where, a, b, t), c, lambda: c.fma(a, b, t))
        else:
            a = Decimal(a)
            attempt("%d [%s] %r.fma(%r, %r, c)" % (i, where, a, b, t), c, lambda: a.fma(b, t, context=c))
    elif kind < 98:
        a = R.randint(-10 ** R.randint(1, c.prec + 2), 10 ** R.randint(1, c.prec + 2))
        b = R.randint(-2, 10 ** R.randint(1, 12))
        m = R.randint(-10 ** R.randint(1, c.prec + 1), 10 ** R.randint(1, c.prec + 1))
        args = [R.choice((Decimal, int))(x) for x in (a, b, m)]
        if R.chance(15):
            args[R.choice((0, 2))] = Decimal(R.choice(("NaN", "sNaN", "Infinity", "1.5", "0", "-0", "1E3", "1E+30")))
        if R.chance(8):
            args[1] = Decimal(R.choice(("NaN", "sNaN", "Infinity", "-Infinity", "0", "-0", "1.5", "2.0", "0E5", "1E2")))
        if R.chance(50):
            attempt("%d [%s] c.power(%r, %r, %r)" % (i, where, *args), c, lambda: c.power(*args))
        else:
            D.setcontext(c)
            args[R.below(3)] = Decimal(args[0])
            attempt("%d [%s] pow(%r, %r, %r)" % (i, where, *args), c, lambda: pow(*args))
    else:
        name = R.choice(("to_integral", "to_integral_exact", "to_integral_value"))
        a = Decimal(operand(R, c))
        r = R.choice(ROUNDINGS + [None])
        attempt("%d [%s] %r.%s(%s, c)" % (i, where, a, name, r), c, lambda: getattr(a, name)(r, c))


class Odd:
    def __repr__(self):
        return "Odd()"


class IntLike:
    def __index__(self):
        return 7

    def __repr__(self):
        return "IntLike()"


class FloatLike:
    def __float__(self):
        return 1.5

    def __repr__(self):
        return "FloatLike()"


class MyInt(int):
    pass


class MyFloat(float):
    pass


class MyStr(str):
    pass


class MyDecimal(Decimal):
    pass


def random_float(R):
    k = R.below(100)
    if k < 10:
        return R.choice((0.0, -0.0, float("inf"), float("-inf"), float("nan"), 1e308, 5e-324, 2.2250738585072014e-308, 1.7976931348623157e308, 0.1))
    if k < 40:
        return R.randint(-10 ** 6, 10 ** 6) / R.choice((1, 2, 3, 7, 8, 10, 1000, 1024))
    m = R.randint(-(2 ** 53), 2 ** 53)
    return math.ldexp(m, R.randint(-1074 - 20, 971))


def random_text(R, c):
    k = R.below(100)
    s = number_text(R, c)
    if k < 30:
        nd = R.randint(1, 2 * c.prec + 3)
        t = digits(R, nd)
        p = R.randint(0, nd)
        s = R.choice(("", "-", "+")) + t[:p] + "." + t[p:] + R.choice(("", "e%d" % R.randint(-30, 30), "E+%d" % R.randint(0, 30), "e", "E-", "e99999999999999999999999", "e-99999999999999999999999"))
    elif k < 45:
        s = R.choice(("", ".", "-", "+", "e5", ".e5", "1e", "1.e5", ".5", "5.", "inf", "INFINITY", "infinit", "nAn", "SnaN00012", "nan1x", "--1", "1..2", "1e5.0", "0x10", "NaN0", "00", "0.0",
                      "00.00e-5", "1_000", "infinity1", "sNaN", "-sNaN000", "1__0", "_1", "1_", "1_e_5", "_", "1e+_5", "\x001", "1\x00", "١٢٣", "１.５", "1 2",
                      "\U0001d7d8\U0001d7d9", "½", "①", "\ud800", "1 1", "in_f", "na_n", "-٠"))
    if R.chance(20):
        s = R.choice((" ", "\t", "\n", " ", " ", "  ", "\x1f", "\x0c")) + s
    if R.chance(20):
        s = s + R.choice((" ", "\t", "\n", " ", "　", "  ", "\r\n"))
    if R.chance(10) and len(s) > 2:
        p = R.randint(1, len(s) - 1)
        s = s[:p] + "_" + s[p:]
    return s


def random_tuple(R, c):
    k = R.below(100)
    sign = R.choice((0, 1, 0, 1, 0, 1, True, False, 2, -1, "0", None, 1.0, 10 ** 30, MyInt(1)))
    nd = R.randint(0, c.prec + 3)
    ds = [R.below(10) for _ in range(nd)]
    if R.chance(8) and ds:
        ds[R.below(nd)] = R.choice((10, -1, "1", None, 1.0, 10 ** 30, True, MyInt(3)))
    ds = R.choice((tuple, tuple, tuple, list))(ds)
    if R.chance(4):
        ds = R.choice((None, "123", 5, {1, 2}, range(3), iter((1, 2))))
    e = R.choice((R.randint(-50, 50), R.randint(-50, 50), R.randint(c.Emin - 50, c.Emax + 50), "F", "n", "N", "f", "", "NaN", None, 1.0, 10 ** 30, -10 ** 30, True, 2 ** 63 - 1, -2 ** 63, MyStr("F"), MyInt(2)))
    t = [sign, ds, e]
    if k < 4:
        t = t[:R.below(3)]
    elif k < 7:
        t = t + [0]
    return R.choice((tuple, tuple, tuple, list))(t)


def construction(R, i):
    c = context(R)
    where = show_context(c)
    k = R.below(100)
    if k < 35:
        v = random_text(R, c)
        if R.chance(5):
            v = MyStr(v)
    elif k < 50:
        v = R.randint(-10 ** R.randint(1, 120), 10 ** R.randint(1, 120))
        if R.chance(10):
            v = MyInt(v)
    elif k < 65:
        v = random_float(R)
        if R.chance(10):
            v = MyFloat(v)
    elif k < 85:
        v = random_tuple(R, c)
    elif k < 93:
        v = R.choice((Decimal, MyDecimal))(number_text(R, c), MAXCTX)
    else:
        v = R.choice((None, Odd(), IntLike(), FloatLike(), b"1", bytearray(b"1"), 1j, Fraction(1, 2), {}, set(), True, False, Ellipsis, NotImplemented, Decimal, c))
    how = R.below(100)
    shown = ascii(v) if not isinstance(v, float) else show(v)
    if isinstance(v, (tuple, list)) and any(type(x).__name__.endswith("iterator") for x in v):
        shown = "<iterator>"
    if how < 35:
        D.setcontext(c)
        attempt("%d [%s] Decimal(%s)" % (i, where, shown), c, lambda: Decimal(v))
    elif how < 45:
        attempt("%d [%s] Decimal(%s, c)" % (i, where, shown), c, lambda: Decimal(v, c))
    elif how < 50:
        D.setcontext(c)
        attempt("%d [%s] MyDecimal(%s)" % (i, where, shown), c, lambda: MyDecimal(v))
    elif how < 75:
        attempt("%d [%s] c.create_decimal(%s)" % (i, where, shown), c, lambda: c.create_decimal(v))
    elif how < 83:
        D.setcontext(c)
        attempt("%d [%s] Decimal.from_float(%s)" % (i, where, shown), c, lambda: Decimal.from_float(v))
    elif how < 87:
        D.setcontext(c)
        attempt("%d [%s] MyDecimal.from_float(%s)" % (i, where, shown), c, lambda: MyDecimal.from_float(v))
    elif how < 93:
        D.setcontext(c)
        attempt("%d [%s] %s.from_number(%s)" % (i, where, "Decimal", shown), c, lambda: Decimal.from_number(v))
    else:
        attempt("%d [%s] c.create_decimal_from_float(%s)" % (i, where, shown), c, lambda: c.create_decimal_from_float(v))


def moderate(R, c):
    """A number that can be written out."""
    k = R.below(100)
    if k < 6:
        return Decimal(R.choice(("Infinity", "-Infinity", "NaN", "-NaN", "sNaN", "NaN123", "-sNaN45", "0", "-0", "0E+5", "0E-7", "-0.000")))
    return Decimal("%s%sE%d" % (R.choice(("", "-")), digits(R, R.randint(1, 45)), R.randint(-60, 25)))


def conversion(R, i):
    c = context(R)
    where = show_context(c)
    D.setcontext(c)
    a = moderate(R, c)
    k = R.below(100)
    if k < 10:
        n = R.choice((R.randint(-30, 30), R.randint(-30, 30), 0, None, 1.0, "1", 10 ** 30, -10 ** 30, True, 2 ** 63 - 1, -2 ** 63, IntLike(), MyInt(2)))
        attempt("%d [%s] round(%r, %r)" % (i, where, a, n), c, lambda: round(a, n))
    elif k < 40:
        name, f = R.choice((("int", int), ("float", float), ("complex", complex), ("round", round), ("floor", math.floor), ("ceil", math.ceil), ("trunc", math.trunc), ("bool", bool),
                            ("str", str), ("repr", repr), ("abs", abs), ("copy", copy.copy), ("deepcopy", copy.deepcopy), ("isnan", math.isnan), ("sqrt", math.sqrt), ("Fraction", Fraction)))
        attempt("%d [%s] %s(%r)" % (i, where, name, a), c, lambda: f(a))
    elif k < 55:
        if a.is_qnan():
            a = Decimal(1)
        attempt("%d [%s] hash(%r)" % (i, where, a), c, lambda: hash(a))
    elif k < 65:
        # Numbers that are equal have the same hash.
        n = R.randint(-10 ** R.randint(1, 30), 10 ** R.randint(1, 30))
        d = 2 ** R.randint(0, 20) * 5 ** R.randint(0, 8)
        f = Fraction(n, d)
        x = Decimal(f.numerator) / Decimal(f.denominator) if False else MAXCTX.divide(Decimal(f.numerator), Decimal(f.denominator))
        attempt("%d hash(%r) == hash(%r)" % (i, x, f), None, lambda: (hash(x) == hash(f), x == f, hash(x)))
    elif k < 72:
        x = random_float(R)
        attempt("%d hash(Decimal(%s))" % (i, show(x)), None, lambda: (x != x or hash(Decimal(x)) == hash(x), x != x or Decimal(x) == x))
    elif k < 82:
        p = R.randint(0, pickle.HIGHEST_PROTOCOL)
        v = R.choice((a, MyDecimal(a)))
        attempt("%d [%s] pickle %d %r" % (i, where, p, v), c, lambda: (lambda r: (r, type(r).__name__))(pickle.loads(pickle.dumps(v, p))))
    elif k < 90:
        attempt("%d [%s] %r real imag" % (i, where, a), c, lambda: (a.real, a.imag, a.conjugate(), a.real is a, a.canonical() is a, copy.copy(a) is a, +a is a))
    else:
        attempt("%d [%s] sum/min/max/sorted %r" % (i, where, a), c, lambda: (sum([a, 1, a]), min(a, 1), max(a, 1), sorted([a, Decimal(1), 0, Decimal("-1.5")])))


def comparison(R, i):
    c = context(R)
    where = show_context(c)
    D.setcontext(c)
    a = R.choice((moderate(R, c), moderate(R, c), Decimal(operand(R, c))))
    k = R.below(100)
    if k < 25:
        b = R.choice((moderate(R, c), a, a.copy_negate(), a.normalize(MAXCTX)))
    elif k < 40:
        b = R.choice((R.randint(-10 ** R.randint(1, 30), 10 ** R.randint(1, 30)), True, False, 0, MyInt(5)))
        if a.is_finite() and not huge(a) and R.chance(40):
            b = int(a)
    elif k < 60:
        b = random_float(R)
        if a.is_finite() and R.chance(40):
            b = float(a)
    elif k < 78:
        b = Fraction(R.randint(-10 ** R.randint(1, 25), 10 ** R.randint(1, 25)), R.randint(1, 10 ** R.randint(1, 20)))
        if a.is_finite() and not huge(a) and R.chance(40):
            b = Fraction(a)
    elif k < 88:
        b = complex(random_float(R), R.choice((0.0, 0.0, -0.0, 1.0, float("nan"))))
    else:
        b = R.choice((None, "1", Odd(), IntLike(), FloatLike(), [], (), b"1", Ellipsis, NotImplemented))
    name, f = R.choice(COMPARISONS)
    if R.chance(30):
        attempt("%d [%s] %s %s %r" % (i, where, show(b), name, a), c, lambda: f(b, a))
    else:
        attempt("%d [%s] %r %s %s" % (i, where, a, name, show(b)), c, lambda: f(a, b))


def random_spec(R):
    k = R.below(100)
    if k < 6:
        return R.choice(("", "z", "#", "_", "z.2f", "#.0f", "_.3f", ",_", "_,", "010_", "z", "+z.1e", " z#010.2f", "=", "<", "x<", "\x00<10", "\x00=+12.3f", "€>12", "\U0001f600^9.2f", "\ud800<5",
                         "10.", ".", "1.2.3", "ff", "5x", "d", "b", "s", "c", "r", "!r", "{}", "0", "00", "010", "-", "+", " ", ",", ",,", ".0", "%", "N", "n", "10n", ".3n", ",n", "010n", "e", "E", "F", "G",
                         ".999999999999999999999", "<<5", "=010", ">010", "^+010,.2f", "0=10", "\t>8", "\n^8", "\x7f<6"))
    s = ""
    if R.chance(40):
        s += R.choice(("", "*", "x", "0", " ", "é", "中", "<", "+", ".")) + R.choice("<>=^")
    s += R.choice(("", "", "+", "-", " "))
    if R.chance(6):
        s += "z"
    if R.chance(6):
        s += "#"
    if R.chance(20):
        s += "0"
    if R.chance(50):
        s += str(R.randint(1, 40))
    if R.chance(30):
        s += R.choice((",", ",", ",", "_"))
    if R.chance(60):
        s += "." + str(R.randint(0, 30))
    s += R.choice(("", "e", "E", "f", "F", "g", "G", "%", "n", "N"))
    return s


def formatting(R, i):
    c = context(R)
    where = show_context(c)
    D.setcontext(c)
    a = moderate(R, c)
    s = random_spec(R)
    k = R.below(100)
    if k < 80:
        attempt("%d [%s] format(%r, %a)" % (i, where, a, s), c, lambda: ascii(format(a, s)))
    elif k < 90:
        o = {}
        if R.chance(80):
            o["decimal_point"] = R.choice((".", ",", "", "٫", "ab", "abcde", "€€", 1, None, "\ud800", "x"))
        if R.chance(80):
            o["thousands_sep"] = R.choice((",", ".", "", " ", " ", "٬", "abcde", "'", 1, "--"))
        if R.chance(80):
            o["grouping"] = R.choice(("\x03", "\x03\x02", "\x01", "", "\x03\x00", "\x02\x7f", "\x7f", "\x03\x03\x00", "\x01\x02\x03", "3", 3, "\xff", "Ā"))
        if R.chance(5):
            o = R.choice((None, [], 1, "x", (), MAXCTX))
        attempt("%d [%s] %r.__format__(%a, %a)" % (i, where, a, s, o if not isinstance(o, Context) else "ctx"), c, lambda: ascii(a.__format__(s, o)))
    elif k < 95:
        attempt("%d [%s] f-string %r %a" % (i, where, a, s), c, lambda: ascii(("{:" + s + "}").format(a)))
    else:
        v = R.choice((None, 1, b"f", 1.0, MyStr(".2f"), [], Odd()))
        attempt("%d [%s] %r.__format__(%r)" % (i, where, a, v), c, lambda: a.__format__(v))


def bad_value(R):
    return R.choice((0, 1, -1, 2, 28, 10 ** 17, 10 ** 18 - 1, 10 ** 18, -10 ** 18, -10 ** 18 + 1, 2 ** 63 - 1, 2 ** 63, -2 ** 63, -2 ** 63 - 1, 10 ** 30, True, False, None, 1.0, "1", "ROUND_UP",
                     "ROUND_HALF_EVEN", "ROUND_05UP", "round_up", "ROUND", MyStr("ROUND_DOWN"), MyInt(5), IntLike(), Odd(), [], {}, (), b"ROUND_UP", 2 ** 31, 2 ** 31 - 1, -2 ** 31 - 1))


KEPT = []


def signal_collection(R):
    k = R.below(100)
    some = [s for s in SIGNALS if R.chance(40)]
    if k < 35:
        return some
    if k < 60:
        return {s: R.choice((True, False, 0, 1, "", "x", None, [])) for s in SIGNALS}
    if k < 70:
        return dict.fromkeys(some, True)
    if k < 80:
        # The mapping is of no use without its context.
        KEPT.append(Context(traps=some, flags=some))
        return KEPT[-1].traps if k < 75 else KEPT[-1].flags
    if k < 85:
        return tuple(some)
    if k < 90:
        return some + [R.choice((ArithmeticError, D.DecimalException, D.ConversionSyntax, D.DivisionImpossible, D.DivisionUndefined, D.InvalidContext, 1, None, "Inexact", ZeroDivisionError))]
    d = {s: False for s in SIGNALS}
    d[R.choice((ArithmeticError, D.ConversionSyntax, 1, "x"))] = True
    if R.chance(50):
        del d[R.choice(SIGNALS)]
    return R.choice((d, set(some), None, 1, "abc", iter(some), frozenset(some)))


def show_collection(v):
    if isinstance(v, dict):
        return "{" + ", ".join("%s: %r" % (getattr(k, "__name__", k), x) for k, x in v.items()) + "}"
    if isinstance(v, (list, tuple)):
        return type(v).__name__ + "[" + ", ".join(str(getattr(k, "__name__", k)) for k in v) + "]"
    if isinstance(v, (set, frozenset)):
        return type(v).__name__ + str(len(v))
    if type(v).__name__ == "SignalDict":
        return "SignalDict" + repr(v)
    if type(v).__name__.endswith("iterator"):
        return "<iterator>"
    return repr(v)


def contexts(R, i):
    c = context(R)
    where = show_context(c)
    k = R.below(100)
    if k < 20:
        name = R.choice(("prec", "Emin", "Emax", "rounding", "capitals", "clamp"))
        v = bad_value(R)

        def f():
            setattr(c, name, v)
            return repr(c)
        attempt("%d [%s] c.%s = %r" % (i, where, name, v), None, f)
    elif k < 35:
        name = R.choice(("traps", "flags"))
        v = signal_collection(R)

        def f():
            setattr(c, name, v)
            return repr(c)
        attempt("%d [%s] c.%s = %s" % (i, where, name, show_collection(v)), None, f)
    elif k < 55:
        names = ("prec", "rounding", "Emin", "Emax", "capitals", "clamp", "flags", "traps")
        kw = {}
        for n in names:
            if R.chance(30):
                kw[n] = signal_collection(R) if n in ("flags", "traps") else (bad_value(R) if R.chance(40) else getattr(context(R), n))
        if R.chance(4):
            kw[R.choice(("precision", "Prec", "emin", "ctx", "_flags"))] = 1
        shown = ", ".join("%s=%s" % (n, show_collection(v)) for n, v in kw.items())
        if R.chance(50):
            attempt("%d Context(%s)" % (i, shown), None, lambda: repr(Context(**kw)))
        else:
            D.setcontext(c)

            def f():
                with D.localcontext(**kw) as x:
                    return (repr(x), x is D.getcontext(), x is c)
            attempt("%d [%s] localcontext(%s)" % (i, where, shown), None, lambda: (f(), D.getcontext() is c))
    elif k < 62:
        args = [bad_value(R) if R.chance(30) else v for v in (c.prec, c.rounding, c.Emin, c.Emax, c.capitals, c.clamp, [], [])][:R.randint(0, 8)]
        if R.chance(5):
            args = args + [1] * (9 - len(args))
        attempt("%d Context(*%r)" % (i, args), None, lambda: repr(Context(*args)))
    elif k < 72:
        m = R.choice((c.traps, c.flags))
        key = R.choice(SIGNALS + [D.DecimalException, D.ConversionSyntax, ArithmeticError, None, 1, "Inexact", Odd()])
        v = R.choice((True, False, 0, 1, 2, "", "x", None, [], [0]))
        shown = getattr(key, "__name__", key)
        how = R.below(8)
        if how == 0:
            attempt("%d [%s] m[%s]" % (i, where, shown), None, lambda: m[key])
        elif how == 1:
            def f():
                m[key] = v
                return repr(c)
            attempt("%d [%s] m[%s] = %r" % (i, where, shown, v), None, f)
        elif how == 2:
            def f():
                del m[key]
            attempt("%d [%s] del m[%s]" % (i, where, shown), None, f)
        elif how == 3:
            attempt("%d [%s] mapping" % (i, where), None, lambda: (len(m), [s.__name__ for s in m], repr(m), sorted((s.__name__, b) for s, b in m.items()), key in m, m.get(key, "no")))
        elif how == 4:
            o = signal_collection(R)
            # What the C module makes of anything else depends on what is in the memory of that object.
            if not o or not isinstance(o, dict) and type(o).__name__ != "SignalDict":
                o = dict.fromkeys(SIGNALS, False)
            attempt("%d [%s] m == %s" % (i, where, show_collection(o)), None, lambda: (m == o, m != o, o == m))
        elif how == 5:
            attempt("%d [%s] m.copy()" % (i, where), None, lambda: (type(m.copy()).__name__, m.copy() == m, show_collection(m.copy())))
        elif how == 6:
            attempt("%d [%s] m < m, hash" % (i, where), None, lambda: m < m)
            attempt("%d [%s] hash(m)" % (i, where), None, lambda: hash(m))
        else:
            name = R.choice(("clear", "pop", "popitem", "update", "setdefault", "keys", "values"))
            args = {"pop": (key,), "update": ({D.Inexact: True},), "setdefault": (key, True)}.get(name, ())
            attempt("%d [%s] m.%s" % (i, where, name), None, lambda: (lambda r: (repr(list(r)) if name in ("keys", "values") else repr(r), repr(c)))(getattr(m, name)(*args)))
    elif k < 80:
        attempt("%d [%s] copies" % (i, where), None, lambda: (repr(c.copy()), repr(copy.copy(c)), repr(copy.deepcopy(c)), c.copy() is c, type(c.copy()).__name__, c.__reduce__()[1][:6],
                                                              [s.__name__ for s in c.__reduce__()[1][6]], [s.__name__ for s in c.__reduce__()[1][7]], c.Etiny(), c.Etop(), repr(c.radix())))
    elif k < 86:
        p = R.randint(0, pickle.HIGHEST_PROTOCOL)
        c.flags[R.choice(SIGNALS)] = True
        attempt("%d [%s] pickle %d" % (i, where, p), None, lambda: repr(pickle.loads(pickle.dumps(c, p))))
    elif k < 90:
        v = R.choice((32, 64, 96, 128, 160, 256, 512, 544, 0, -32, 33, 16, 1, 10 ** 30, 2 ** 31, 2 ** 31 + 32, 32.0, "32", None, True, IntLike(), MyInt(64)))
        attempt("%d IEEEContext(%r)" % (i, v), None, lambda: repr(D.IEEEContext(v)))
    elif k < 94:
        v = R.choice((c, D.DefaultContext, D.BasicContext, D.ExtendedContext, None, 1, "x", Context, Odd()))
        shown = "c" if v is c else ("template" if isinstance(v, Context) else repr(v))

        def f():
            D.setcontext(v)
            return (D.getcontext() is v, repr(D.getcontext()))
        attempt("%d [%s] setcontext(%s)" % (i, where, shown), None, f)
    elif k < 97:
        name = R.choice(("prec", "traps", "flags", "foo", "rounding", "__class__", "__dict__"))

        def f():
            delattr(c, name)
        attempt("%d delattr(c, %r)" % (i, name), None, f)
        name = R.choice(("foo", "_prec", "Prec", "__doc__", "copy", 1, None))

        def g():
            setattr(c, name, 1)
        attempt("%d setattr(c, %r, 1)" % (i, name), None, g)
        attempt("%d getattr(c, %r)" % (i, name), None, lambda: callable(getattr(c, name)))
    else:
        c.flags[R.choice(SIGNALS)] = True

        def f():
            a = repr(c)
            c.clear_flags()
            b = repr(c)
            c.clear_traps()
            return (a, b, repr(c))
        attempt("%d [%s] clear" % (i, where), None, f)


def wrong_arguments(R, i):
    c = context(R)
    D.setcontext(c)
    a = Decimal("1.5")
    junk = (None, "1", 1.5, Odd(), IntLike(), FloatLike(), [], (), {}, b"1", 1j, Fraction(1, 2), c, Decimal, Ellipsis)
    k = R.below(100)
    if k < 30:
        name = R.choice(BINARY + ["fma", "quantize"])
        args = [R.choice(junk + (1, a)) for _ in range(R.randint(0, 4))]
        attempt("%d a.%s(*%r)" % (i, name, [type(x).__name__ for x in args]), None, lambda: getattr(a, name)(*args))
    elif k < 45:
        name = R.choice(UNARY + UNARY_PLAIN + ["to_integral", "to_integral_exact", "to_integral_value"])
        args = [R.choice(junk + (1, a)) for _ in range(R.randint(1, 3))]
        attempt("%d a.%s(*%r)" % (i, name, [type(x).__name__ for x in args]), None, lambda: getattr(a, name)(*args))
    elif k < 70:
        name = R.choice(CTX_UNARY + CTX_BINARY + ["fma", "power", "Etiny", "Etop", "radix", "copy", "clear_flags", "clear_traps", "create_decimal_from_float", "__reduce__", "__copy__"])
        args = [R.choice(junk + (1, a)) for _ in range(R.randint(0, 4))]
        attempt("%d c.%s(*%r)" % (i, name, [type(x).__name__ for x in args]), None, lambda: getattr(c, name)(*args))
    elif k < 80:
        name = R.choice(BINARY + UNARY + ["fma", "quantize", "to_integral"])
        kw = {R.choice(("context", "other", "third", "exp", "rounding", "foo", "x", "self")): R.choice(junk + (1, a, D.ROUND_UP)) for _ in range(R.randint(1, 3))}
        attempt("%d a.%s(**%r)" % (i, name, sorted((n, type(x).__name__) for n, x in kw.items())), None, lambda: getattr(a, name)(**kw))
    elif k < 88:
        name = R.choice(CTX_UNARY + CTX_BINARY + ["fma", "power"])
        kw = {R.choice(("a", "b", "modulo", "x", "y", "z", "num", "f", "context")): R.choice(junk + (1, a)) for _ in range(R.randint(1, 3))}
        attempt("%d c.%s(**%r)" % (i, name, sorted((n, type(x).__name__) for n, x in kw.items())), None, lambda: getattr(c, name)(**kw))
    elif k < 94:
        name, f = R.choice(OPERATORS + COMPARISONS)
        b = R.choice(junk)
        if R.chance(50):
            attempt("%d a %s %s" % (i, name, type(b).__name__), None, lambda: f(a, b))
        else:
            attempt("%d %s %s a" % (i, type(b).__name__, name), None, lambda: f(b, a))
    else:
        f = R.choice((D.getcontext, D.setcontext, D.localcontext, D.IEEEContext, Decimal, Context, Decimal.from_float, Decimal.from_number))
        args = [R.choice(junk + (1, a)) for _ in range(R.randint(0, 4))]
        kw = {R.choice(("context", "value", "ctx", "prec", "bits", "f", "foo")): R.choice(junk + (1, a)) for _ in range(R.below(3))}
        attempt("%d %s(*%r, **%r)" % (i, f.__name__, [type(x).__name__ for x in args], sorted((n, type(x).__name__) for n, x in kw.items())), None, lambda: type(f(*args, **kw)).__name__)


LONG_PRECISIONS = (50, 76, 77, 100, 152, 153, 200, 400, 531, 532, 533, 1000, 1063, 1064, 1824, 1825, 2000, 3610, 4000, 6000)


def long_digits(R, n):
    k = R.below(14)
    if k == 0:
        return "9" * n
    if k == 1:
        return R.choice("123456789") + "0" * (n - 1)
    if k == 2:
        return (str(R.randint(1, 10 ** 19)) * (n // 2 + 1))[:n]
    if k == 3:
        return "1" + "0" * (n - 2) + "1" if n > 1 else "1"
    if k == 4:
        return ("9" * 19 + "0" * 19) * (n // 38) + "7" * (n % 38)
    return str(R.randint(10 ** (n - 1), 10 ** n - 1))


def long_number(R, c, alike=None):
    n = R.choice((c.prec, c.prec, c.prec - 1, c.prec + 1, 2 * c.prec, 2 * c.prec + 1, R.randint(1, c.prec), R.randint(1, 2 * c.prec), R.randint(1, 40), c.prec // 2, c.prec // 3 + 1))
    k = R.below(100)
    if alike is not None and k < 25:
        # Nearly the same number: what is left when they are subtracted, and comparisons that are decided late.
        t = alike.as_tuple()
        d = list(t.digits)
        d[-R.randint(1, min(len(d), 3))] = R.below(10)
        return Decimal((R.below(8) == 0, tuple(d), t.exponent))
    if k < 60:
        e = -R.randint(0, n + 5)
    elif k < 85:
        e = R.randint(-c.prec - 40, c.prec + 40)
    elif k < 95:
        e = R.randint(-3 * c.prec, 3 * c.prec)
    else:
        e = R.randint(-10 ** R.randint(3, 17), 10 ** R.randint(3, 17))
    return Decimal("%s%sE%d" % (R.choice(("", "", "-")), long_digits(R, max(n, 1)), e), MAXCTX)


def brief(v):
    if isinstance(v, Decimal):
        t = str(v)
        return "<%d digits, adjusted %s, sum %d>" % (len(v.as_tuple().digits), v.adjusted() if v.is_finite() else "-", sum(map(ord, t)) % 1000003)
    if isinstance(v, int) and abs(v) > 10 ** 30:
        return "<int of %d bits, %d>" % (v.bit_length(), v % 1000003)
    return repr(v)


def long_numbers(R, i):
    prec = R.choice(LONG_PRECISIONS + (R.randint(40, 700), R.randint(40, 700), R.randint(40, 7000)))
    wide = R.chance(85)
    c = Context(prec=prec, rounding=R.choice(ROUNDINGS), Emin=-999999999 if wide else -R.randint(0, 2 * prec), Emax=999999999 if wide else R.randint(0, 2 * prec), clamp=R.below(4) == 0, traps=[])
    where = "p%d %s %d %d c%d" % (c.prec, c.rounding[6:], c.Emin, c.Emax, c.clamp)
    a = long_number(R, c)
    b = long_number(R, c, a)
    kind = R.below(100)
    if kind < 40:
        name = R.choice(("add", "subtract", "multiply", "multiply", "multiply", "divide", "divide", "divide", "divide_int", "remainder", "divmod", "remainder_near", "compare", "compare_signal", "compare_total",
                         "compare_total_mag", "max", "min", "max_mag", "min_mag", "next_toward", "copy_sign", "same_quantum", "quantize"))
        if name in ("divide_int", "remainder", "divmod", "remainder_near") and R.chance(80):
            b = b.scaleb(a.adjusted() - b.adjusted() - R.randint(0, c.prec), MAXCTX)
        if name == "quantize" and R.chance(80):
            b = Decimal((0, (1,), a.adjusted() - R.randint(-2, c.prec + 2)))
        attempt("%d [%s] c.%s(%s, %s)" % (i, where, name, brief(a), brief(b)), c, lambda: getattr(c, name)(a, b))
    elif kind < 55:
        name = R.choice(("sqrt", "sqrt", "sqrt", "plus", "minus", "abs", "normalize", "to_integral_exact", "to_integral_value", "next_plus", "next_minus", "logb", "number_class", "to_sci_string", "to_eng_string",
                         "copy_negate", "_apply", "create_decimal"))
        if name == "sqrt":
            a = a.copy_abs()
        if name == "sqrt" and R.chance(30):
            r = long_number(R, Context(prec=max(c.prec // 2, 1)))
            a = MAXCTX.multiply(r, r)
        if name in ("to_sci_string", "to_eng_string") and huge(a) and a == 0:
            a = Decimal(0)
        attempt("%d [%s] c.%s(%s)" % (i, where, name, brief(a)), c, lambda: getattr(c, name)(a))
    elif kind < 60:
        t = long_number(R, c)
        attempt("%d [%s] c.fma(%s, %s, %s)" % (i, where, brief(a), brief(b), brief(t)), c, lambda: c.fma(a, b, t))
    elif kind < 66:
        name = R.choice(("logical_and", "logical_or", "logical_xor", "logical_invert", "shift", "rotate", "scaleb"))
        if name.startswith("logical"):
            x = Decimal(digits(R, R.randint(1, min(c.prec, 900) + 3), "01"))
            y = Decimal(digits(R, R.randint(1, min(c.prec, 900) + 3), "01"))
            args = (x,) if name == "logical_invert" else (x, y)
        else:
            args = (a, R.choice((Decimal, int))(R.randint(-c.prec - 2, c.prec + 2)))
        attempt("%d [%s] c.%s(%s)" % (i, where, name, ", ".join(map(brief, args))), c, lambda: getattr(c, name)(*args))
    elif kind < 72:
        c.prec = min(c.prec, R.randint(40, 260))
        name = R.choice(("exp", "ln", "log10", "power"))
        x = Decimal("%sE%d" % (long_digits(R, R.randint(1, c.prec + 3)), -R.randint(0, c.prec + 3)))
        if name == "exp":
            x = x.scaleb(-max(x.adjusted() - 4, 0), MAXCTX).copy_sign(a)
            args = (x,)
        elif name == "power":
            args = (x, Decimal("%s%sE%d" % (R.choice(("", "-")), long_digits(R, R.randint(1, 30)), -R.randint(0, 32))))
        else:
            args = (x,)
        attempt("%d [p%d %s] c.%s(%s)" % (i, c.prec, where, name, ", ".join(map(brief, args))), c, lambda: getattr(c, name)(*args))
    elif kind < 84:
        D.setcontext(c)
        if huge(a) and abs(a.adjusted()) > 30000:
            a = a.scaleb(-a.adjusted(), MAXCTX)
        name = R.choice(("str", "repr", "text and back", "int", "int and back", "from int", "hash", "float", "ratio", "tuple and back", "pickle", "floor", "ceil", "round", "round to", "bool", "deepcopy", "sizeof", "from float"))
        f = {"str": lambda: str(a), "repr": lambda: repr(a), "text and back": lambda: (Decimal(str(a)).compare_total(a), Decimal(" " + repr(a)[9:-2] + "\n").compare_total(a)),
             "int": lambda: brief(int(a)), "int and back": lambda: Decimal(int(a)).compare_total(a.to_integral_value(D.ROUND_DOWN, MAXCTX)),
             "from int": lambda: (Decimal(int(a.copy_abs().scaleb(-a.as_tuple().exponent, MAXCTX))), c.create_decimal(int(a.scaleb(-a.as_tuple().exponent, MAXCTX)))),
             "hash": lambda: (hash(a), hash(a) == hash(a + 0 if False else a)), "float": lambda: float(a), "ratio": lambda: tuple(map(brief, a.as_integer_ratio())),
             "tuple and back": lambda: (Decimal(a.as_tuple()).compare_total(a), Decimal(list(a.as_tuple())).compare_total(a), sum(a.as_tuple().digits)),
             "pickle": lambda: [pickle.loads(pickle.dumps(a, p)).compare_total(a) for p in (0, 2, 5)], "floor": lambda: brief(math.floor(a)), "ceil": lambda: brief(math.ceil(a)), "round": lambda: brief(round(a)),
             "round to": lambda: round(a, R.randint(-5, 40)), "bool": lambda: bool(a), "deepcopy": lambda: copy.deepcopy([a])[0] is a, "sizeof": lambda: sys.getsizeof(a) >= sys.getsizeof(Decimal(1)),
             "from float": lambda: Decimal(float(a)) if abs(a.adjusted()) < 300 else None}[name]
        attempt("%d [%s] %s of %s" % (i, where, name, brief(a)), c, f)
    elif kind < 92:
        D.setcontext(c)
        name, f = R.choice(COMPARISONS + OPERATORS[:7])
        other = R.choice((b, b, b, int(b) if abs(b.adjusted()) < 30000 else 7, Fraction(int(b), 7) if abs(b.adjusted()) < 3000 and name in ("==", "!=", "<", "<=", ">", ">=") else b))
        if name in ("//", "%", "divmod") and isinstance(other, Decimal) and R.chance(80):
            other = other.scaleb(a.adjusted() - other.adjusted() - R.randint(0, c.prec), MAXCTX)
        attempt("%d [%s] %s %s %s" % (i, where, brief(a), name, brief(other)), c, lambda: f(a, other))
    else:
        if huge(a) and abs(a.adjusted()) > 9000:
            a = a.scaleb(-a.adjusted(), MAXCTX)
        D.setcontext(c)
        spec = R.choice(("", "f", "e", "g", "E", ",", ",f", "_f" , ".%df" % R.randint(0, 2 * c.prec), ".%de" % R.randint(0, 2 * c.prec), ".%dg" % R.randint(0, 2 * c.prec), ",.%df" % R.randint(0, 300), "%", ".%d%%" % R.randint(0, 300),
                         "%d" % R.randint(0, 3 * c.prec), "0%d,f" % R.randint(0, 3 * c.prec), "*^%d.%df" % (R.randint(0, 3 * c.prec), R.randint(0, 50)), "+%d.%de" % (R.randint(0, 3 * c.prec), R.randint(0, c.prec)), "z.3f", "n"))
        attempt("%d [%s] format(%s, %r)" % (i, where, brief(a), spec), c, lambda: format(a, spec))


KINDS = {"arithmetic": arithmetic, "construction": construction, "conversion": conversion, "comparison": comparison, "formatting": formatting, "contexts": contexts,
         "wrong_arguments": wrong_arguments, "long_numbers": long_numbers}


def run(kind, seed, count):
    sys.set_int_max_str_digits(0)
    R = Random(seed)
    f = KINDS[kind]
    for i in range(count):
        f(R, i)
        D.setcontext(Context())
        del KEPT[:]


if __name__ == "__main__" and len(sys.argv) == 4:
    run(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
