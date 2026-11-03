import array, sys
from array import array as A

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)

def tn(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__)

CODES = [c for c in array.typecodes if c != "u"]
print(array.typecodes, array.ArrayType is A)
for tc in CODES:
    a = A(tc)
    print(tc, a.itemsize, a.typecode, a, len(a), bool(a), a.tolist(), a.tobytes())
INTS = "bBhHiIlLqQ"
LIMITS = {"b": (-128, 127), "B": (0, 255), "h": (-2**15, 2**15 - 1), "H": (0, 2**16 - 1), "i": (-2**31, 2**31 - 1), "I": (0, 2**32 - 1),
          "l": (-2**63, 2**63 - 1), "L": (0, 2**64 - 1), "q": (-2**63, 2**63 - 1), "Q": (0, 2**64 - 1)}
for tc in INTS:
    lo, hi = LIMITS[tc]
    a = A(tc, [lo, hi, 0, 1])
    print(tc, a, a.tobytes().hex(), a[0] == lo, a[1] == hi, type(a[0]).__name__)
    t(lambda: A(tc, [lo - 1])); t(lambda: A(tc, [hi + 1])); t(lambda: A(tc, [2 ** 70])); t(lambda: A(tc, [-2 ** 70]))
    t(lambda: A(tc, [1.5])); t(lambda: A(tc, ["a"])); t(lambda: A(tc, [None])); t(lambda: A(tc, [1j])); t(lambda: A(tc, [b"a"]))
    t(lambda: A(tc, [True, False]))
t(lambda: A("b", [300])); t(lambda: A("b", [-300])); t(lambda: A("b", [70000])); t(lambda: A("b", [-70000])); t(lambda: A("H", [2 ** 31])); t(lambda: A("H", [-2 ** 31 - 1])); t(lambda: A("I", [2 ** 63]))
class I:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
for tc in INTS:
    print(A(tc, [I(5)]), end=" ")
print()
t(lambda: A("i", [I(2 ** 40)])); t(lambda: A("I", [I(-1)])); t(lambda: A("Q", [I(-1)])); t(lambda: A("d", [I(3)])); t(lambda: A("f", [I(3)])); t(lambda: A("Zd", [I(3)]))
class F:
    def __float__(self): return 2.5
class C:
    def __complex__(self): return 1 + 2j
for tc in "efd":
    a = A(tc, [0.0, 1.5, -2.25, 1, F(), True, float("inf"), float("-inf"), -0.0])
    print(tc, a, a.tobytes().hex())
    print(A(tc, [float("nan")]), A(tc, [0.1])[0], A(tc, [1e-10])[0], A(tc, [65504])[0])
    t(lambda: A(tc, ["a"])); t(lambda: A(tc, [None])); t(lambda: A(tc, [1j])); t(lambda: A(tc, [10 ** 400])); t(lambda: A(tc, [C()]))
t(lambda: A("e", [65520])); t(lambda: A("e", [65519])); t(lambda: A("e", [1e300])); t(lambda: A("e", [-70000.0])); t(lambda: A("f", [1e300])); t(lambda: A("f", [-1e300])); t(lambda: A("f", [3.4e38])); t(lambda: A("f", [3.5e38]))
print([A("e", [x])[0] for x in (2 ** -24, 2 ** -25, 2 ** -25 * 1.0001, 2 ** -14, 2 ** -14 - 2 ** -25, 1.0009765625, 1.00048828125, 1.00146484375, 2049, 2051, 1 / 3)])
for tc in ("Zf", "Zd"):
    a = A(tc, [1 + 2j, 0, 1.5, -1j, C(), F(), True, complex("inf+nanj")])
    print(tc, a, a.itemsize, a.tobytes().hex()[:96], type(a[0]).__name__)
    t(lambda: A(tc, ["a"])); t(lambda: A(tc, [None])); t(lambda: A(tc, [10 ** 400]))
print(A("Zf", [1e300 + 1e300j]), A("Zf", [0.1 + 0.2j]))
a = A("w", "héllo€\U0001f600"); print(a, len(a), a.itemsize, a.tolist(), a.tounicode(), a[5], a[6], a.tobytes().hex())
t(lambda: A("w", [97])); t(lambda: A("w", ["ab"])); t(lambda: A("w", [""])); t(lambda: A("w", [None])); t(lambda: A("w", [b"a"])); print(A("w", ["a", "€", "\U0001f600"]), A("w", ("x",)), A("w", iter("xyz")))
class Sub(str): pass
print(A("w", Sub("ab")), A("w", [Sub("a")]))
class Foo: pass
t(lambda: A("w", [Foo()]))
