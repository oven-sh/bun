def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

print(1 < 2, 2 < 1, 1 <= 1, 1 >= 2, 1 == 1, 1 != 1, 1 == 1.0, 1 != 1.0, True == 1, False == 0, True == 2)
print(1 < 2 < 3, 1 < 2 > 1, 1 < 3 < 2, 3 > 2 > 1, 1 == 1 == 1, 1 == 1 != 2, 1 < 2 <= 2 < 3 != 4)
print("a" < "b", "a" < "B", "abc" < "abd", "ab" < "abc", "" < "a", "a" == "a", "a" != "b", "Z" < "a", "é" > "z")
print([1, 2] < [1, 3], [1, 2] < [1, 2, 3], [] < [1], [1, 2] == [1, 2], [1] != [2], [2] > [1, 5], [[1]] < [[2]])
print((1, 2) < (1, 3), (1,) < (1, 0), () == (), (1, "a") == (1, "a"), (1, 2) >= (1, 2))
print(None == None, None != None, None == 0, None is None, None is not None, 0 is not None)
print(10 ** 30 > 10 ** 29, 10 ** 30 == 10 ** 30, 10 ** 30 < 1e31, 10 ** 30 == 1e30, 2 ** 53 == 2.0 ** 53, 2 ** 53 + 1 == 2.0 ** 53, 2 ** 53 + 1 > 2.0 ** 53)
print(1 < 1.5, 1.5 < 2, 2 > 1.5, 0.1 + 0.2 == 0.3, 0.5 == 1 / 2, float("inf") > 10 ** 400, float("-inf") < -(10 ** 400))
nan = float("nan")
print(nan == nan, nan != nan, nan < 1, nan > 1, nan <= nan, [nan] == [nan], (nan,) == (nan,), nan in [nan], nan is nan)
t(lambda: 1 < "a")
t(lambda: "a" < 1)
t(lambda: [1] < (1,))
t(lambda: None < None)
t(lambda: None < 1)
t(lambda: 1 <= None)
t(lambda: {} < {})
t(lambda: [1, "a"] < [1, 2])
t(lambda: 1j < 2j)
t(lambda: object() < object())
t(lambda: (1, None) > (1, 2))
t(lambda: len < len)
t(lambda: int < int)
print(1 == "1", "1" == 1, [1] == (1,), {} == [], 1 != "1", None != "None", b"a" == "a")
print(bool(0), bool(1), bool(-1), bool(0.0), bool(0.1), bool(""), bool(" "), bool([]), bool([0]), bool(()), bool((0,)), bool({}), bool({0: 0}), bool(set()), bool({0}), bool(None), bool(0j), bool(1j), bool(b""), bool(b"\0"), bool(range(0)), bool(range(1)), bool(10 ** 30), bool(nan))
print(1 and 2, 0 and 2, 1 or 2, 0 or 2, "" or "x", "a" and "", None or 0, None and 1, [] or {}, [] and {}, 0 or "" or None, 1 and 2 and 3, 1 and 0 and 3, 0 or 1 and 2, (0 or 1) and 2, not 1 or 2, not (1 or 2))
print(not True, not False, not None, not "", not "a", not [], not 0.0, not not 5)
def side(x, log=[]):
    log.append(x)
    return x
print(side(0) and side(1), side(1) or side(2), side(1) and side(0) or side(3), side.__defaults__[0])
print(1 if True else 2, 1 if False else 2, 1 if 0 else 2 if 0 else 3, (1 if 1 else 2) if 0 else 4, "y" if [] else "n")
print(1 in [1, 2], 3 in [1, 2], 1 not in [1, 2], "a" in "abc", "ac" in "abc", "" in "abc", 1 in (1,), 1 in {1: 2}, 2 in {1: 2}, 1 in {1}, 1.0 in [1], True in [1], 1 in range(3), 3 in range(3))
t(lambda: 1 in 5)
t(lambda: 1 in "abc")
t(lambda: "a" in 5)
t(lambda: 1 not in None)
x = [1]; y = [1]; z = x
print(x is y, x is z, x is not y, x == y)
print(isinstance(True, int), isinstance(True, bool), isinstance(1, bool), issubclass(bool, int), type(True + 1), type(True & False), type(True & 1), type(True | False), type(True ^ True), type(~True))
print(True & False, True | False, True ^ True, True ^ False, True & 3, True | 2, False ^ 5)
print(int(True), int(False), float(True), str(True), repr(False), bool("False"), bool(bool), True.real, True.imag, True.bit_length(), True.numerator)
t(lambda: bool(1, 2))
print(bool(), int(), float(), str(), list(), tuple(), dict(), set(), bytes(), complex(), frozenset())
print(max(True, 0), min(True, 2), sorted([True, 0, 2, False]), sum([True, True, False]))
print(hash(True), hash(False), hash(1), {True: "a", 1: "b", 1.0: "c"})
class A:
    def __bool__(self): return False
class B:
    def __len__(self): return 0
class C:
    def __len__(self): return 3
class D:
    def __bool__(self): return 1
class E:
    def __len__(self): return -1
class F:
    __bool__ = None
print(bool(A()), bool(B()), bool(C()), not A(), A() or "dflt", C() and "yes")
t(lambda: bool(D()))
t(lambda: bool(E()))
t(lambda: bool(F()))
t(lambda: not D())
t(lambda: 1 if D() else 2)
