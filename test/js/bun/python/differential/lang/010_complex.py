def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

inf = float("inf"); nan = float("nan")
print(1j, 1 + 2j, 1 - 2j, -1 + 2j, -1 - 2j, 0j, -0j, 1.5j, 1e10j, 1e100j, 1 + 0j, 0 + 1j, (1 + 2j), 3.0 + 4.0j, -(1 + 2j), +(1 + 2j), 1e-5j, 1.5e16 + 1e16j)
print(repr(1j), str(1j), repr(1 + 2j), repr(complex(0, 0)), repr(complex(-0.0, 0)), repr(complex(0, -0.0)), repr(complex(-0.0, -0.0)), repr(complex(1, -0.0)), repr(complex(-0.0, 1)), repr(-1j), repr(-(1j)), repr(0 - 1j), repr(complex(inf, nan)), repr(complex(-inf, -inf)), repr(complex(nan, 1)), repr(complex(0, inf)))
print((1 + 2j) + (3 + 4j), (1 + 2j) - (3 + 4j), (1 + 2j) * (3 + 4j), (1 + 2j) / (3 + 4j), (1 + 2j) ** 2, (1 + 2j) ** 0, (1 + 2j) ** -1, (1 + 2j) ** 0.5, (1 + 2j) ** (1 + 1j), 2 ** 1j, 2.0 ** (1 + 1j), 1j ** 2, 1j * 1j, 1j ** 1j, (-1) ** 0.5, (-8) ** (1 / 3), 0j ** 0, 0j ** 2, (1 + 2j) ** 3, (1 + 2j) ** 10, (2 + 0j) ** 3)
print((1 + 2j) + 1, 1 + (1 + 2j), (1 + 2j) + 1.5, (1 + 2j) * 2, 2 * (1 + 2j), (1 + 2j) / 2, 2 / (1 + 2j), (1 + 2j) - 1, 1 - (1 + 2j), (1 + 2j) + True, 10 ** 20 + 1j, (1 + 2j) * 1.5, 1.5 / 1j)
t(lambda: (1 + 2j) / 0)
t(lambda: (1 + 2j) / 0j)
t(lambda: 1 / 0j)
t(lambda: 0j ** -1)
t(lambda: 0j ** 1j)
t(lambda: (1 + 2j) // 1)
t(lambda: (1 + 2j) % 1)
t(lambda: divmod(1 + 2j, 1))
t(lambda: 1 // 1j)
t(lambda: (1 + 2j) < (1 + 3j))
t(lambda: (1 + 2j) >= 1)
t(lambda: int(1j))
t(lambda: float(1j))
t(lambda: round(1j))
t(lambda: pow(1j, 2, 3))
t(lambda: 1e200j * 1e200j ** 2)
t(lambda: (1e308 + 1e308j) ** 2)
t(lambda: 10 ** 400 + 1j)
print((1 + 2j).real, (1 + 2j).imag, (1 + 2j).conjugate(), abs(3 + 4j), abs(1j), abs(-1j), abs(0j), abs(complex(inf, nan)), abs(complex(nan, 1)), abs(1e200 + 1e200j), type((1 + 2j).real))
t(lambda: abs(1e308 + 1e308j))
print((1 + 2j) == (1 + 2j), (1 + 2j) != (1 + 2j), (1 + 0j) == 1, 1 == (1 + 0j), (1 + 0j) == 1.0, (1 + 1j) == 1, 1j == "1j", 1j != None, (1 + 0j) == True, complex(nan, 0) == complex(nan, 0), 10 ** 30 == complex(1e30, 0), (2 ** 53 + 1) == complex(2.0 ** 53, 0))
print(bool(0j), bool(1j), bool(1 + 0j), bool(complex(0, -0.0)), bool(complex(nan, 0)))
print(hash(0j), hash(1 + 0j), hash(1j), hash(1 + 1j), hash(-1j), hash(1.5 + 2.5j), hash(complex(inf, 0)), hash(complex(0, inf)), hash(1 + 0j) == hash(1), {1: "a"}[1 + 0j], hash(-1 + 0j), hash(3 - 4j))
print(complex(), complex(1), complex(1, 2), complex(1.5), complex(1.5, 2.5), complex(1j), complex(1j, 1j), complex(1, 1j), complex(1 + 2j, 3 + 4j), complex(True, False), complex(10 ** 20), complex(real=1), complex(imag=1), complex(real=1, imag=2))
print(complex("1"), complex("1j"), complex("1+2j"), complex("1-2j"), complex(" 1+2j "), complex("(1+2j)"), complex(" ( 1+2j ) "), complex("1.5e3+2.5e-3j"), complex("j"), complex("-j"), complex("+j"), complex("1+j"), complex("1-j"), complex("inf"), complex("infj"), complex("nan+nanj"), complex("-inf-infj"), complex("1_0+2_0j"), complex("1J"), complex(".5j"), complex("5.j"), complex("1e1j"))
for s in ("", " ", "a", "1+", "1+2", "1 + 2j", "1+2j+3", "(1+2j", "1+2j)", "1+2i", "jj", "1j+2", "1j2", "++1", "1+-2j", "()", "1__0j", "1+2j\x00", "e1j"):
    t(lambda: complex(s))
t(lambda: complex("1", 2))
t(lambda: complex(1, "2"))
t(lambda: complex(None))
t(lambda: complex([]))
t(lambda: complex(1, None))
t(lambda: complex(1, 2, 3))
t(lambda: complex(b"1"))
class C:
    def __complex__(self): return 5 + 6j
class F:
    def __float__(self): return 2.5
class I:
    def __index__(self): return 7
class Bad:
    def __complex__(self): return 1
print(complex(C()), complex(F()), complex(I()), complex(F(), F()), complex(I(), I()), complex(1, F()))
t(lambda: complex(Bad()))
t(lambda: complex(1, C()))
print(complex.from_number(1), complex.from_number(1.5), complex.from_number(1j), complex.from_number(C()))
t(lambda: complex.from_number("1"))
print((1 + 2j).__add__(1), (1 + 2j).__radd__(1), (1 + 2j).__add__("a"), (1 + 2j).__eq__(1 + 2j), (1 + 2j).__lt__(1) if hasattr(1j, "__lt__") else "", (1 + 2j).__neg__(), (1 + 2j).__pos__(), (1 + 2j).__abs__(), (1 + 2j).__bool__(), (1 + 2j).__complex__(), (1 + 2j).__getnewargs__(), (1 + 2j).__rpow__(2), (1 + 2j).__rtruediv__(1), (1 + 2j).__rsub__(1), (1 + 2j).__rmul__(2))
print(type(1j), isinstance(1j, complex), isinstance(1, complex), complex.__mro__, type(1j * 1j), type(1j + 1), type(1j ** 2), type(abs(1j)))
print(sum([1j, 2j, 1]), sum([1 + 1j] * 3), sum([0.1 + 0.1j] * 10), sum([1, 2.5, 1j]), sum([1j], 1), max([1j], key=abs), sorted([3j, 1j, 2j], key=abs), sum([1e100 + 1j, 1.0, -1e100]))
print(inf * 1j, complex(inf, 0) * 1j, complex(inf, inf) * complex(1, 1), complex(0, inf) * complex(0, inf), complex(inf, 0) / complex(1, 1), 1 / complex(inf, inf), complex(nan, nan) * 0, complex(1, 1) / complex(inf, 0), -complex(0.0, 0.0), complex(0.0, 0.0) * -1, 0j + -0.0, complex(-0.0, -0.0) + 0)
print(1 - 0j, 1 + -0j, -0.0 + 0j, 0.0 - 0j, -0.0 - 0j, 1j - 0.0, 1j * 0.0, 1j * -0.0, (-0.0) * 1j, 2 * complex(-0.0, 0.0), complex(1, -0.0) - 1, 1 - complex(1, 0.0), 1.0 - complex(1, -0.0))
print(str([1j, 1 + 1j]), str((1j,)), str({1j: 2j}), f"{1j}", f"{1 + 2j!r}", "%s %r" % (1j, 1 + 1j), "{}".format(2j))
