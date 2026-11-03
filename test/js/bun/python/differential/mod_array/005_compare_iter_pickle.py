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

vals = [A("i"), A("i", [1]), A("i", [1, 2]), A("i", [1, 3]), A("i", [2]), A("h", [1, 2]), A("d", [1.0, 2.0]), A("d", [1.5]), A("B", [1, 2]), A("Q", [2 ** 63])]
for a in vals:
    print([(a == b, a != b, a < b, a <= b, a > b, a >= b) for b in vals])
print(A("i", [1]) == [1], A("i", [1]) != [1], A("i") == (), A("i", [1]).__eq__([1]), A("i", [1]).__lt__(1), A("i", [1]).__ne__(None), A("b", b"ab") == b"ab")
tn(lambda: A("i", [1]) < [1]); tn(lambda: A("i", [1]) >= None)
print(A("w", "abc") == A("w", "abc"), A("w", "abc") < A("w", "abd"), A("w", "ab") < A("w", "abc"), A("w", "b") > A("w", "abc"), A("w", "\U0001f600") > A("w", "￿"))
t(lambda: A("w", "a") == A("i", [97])); t(lambda: A("w", "a") != A("i", [97])); t(lambda: A("w", "a") < A("i", [97])); t(lambda: A("w") < A("i")); t(lambda: A("w") < A("i", [1]))
print(A("Zd", [1j]) == A("Zd", [1j]), A("Zd", [1j]) != A("Zf", [1j]), A("Zd", [1]) == A("i", [1]), A("Zd", [1j, 2]) == A("Zd", [1j, 3]), A("Zd", [1j]) < A("Zd", [1j, 2]), A("Zd", [1j]) <= A("Zd", [1j]))
t(lambda: A("Zd", [1j]) < A("Zd", [2j])); t(lambda: A("Zd", [1j]) >= A("d", [2]))
print(A("b", [-1]) < A("b", [1]), A("B", [255]) > A("B", [1]), A("b", [-1]) < A("B", [255]), A("q", [-2 ** 63]) < A("Q", [2 ** 64 - 1]), A("f", [0.1]) == A("d", [0.1]), A("f", [0.5]) == A("d", [0.5]), A("e", [0.5]) == A("f", [0.5]), A("d", [-0.0]) == A("d", [0.0]))
class S(A): pass
print(S("i", [1]) == A("i", [1]), A("i", [1]) == S("i", [1]), S("i", [1]) < S("i", [2]))

a = A("i", [1, 2, 3]); it = iter(a)
print(type(it).__name__, type(it).__module__, iter(it) is it, next(it), it.__reduce__()[1:], it.__reduce__()[0] is iter)
a.append(4); print(list(it)); t(lambda: next(it)); a.append(5); t(lambda: next(it)); print(it.__reduce__()[1:])
it = iter(a); it.__setstate__(3); print(list(it)); it = iter(a); it.__setstate__(-5); print(next(it)); it = iter(a); it.__setstate__(100); print(it.__reduce__()[2], list(it)); it.__setstate__(0); print(list(it))
it = iter(a); t(lambda: it.__setstate__("a")); t(lambda: it.__setstate__(1.5)); t(lambda: it.__setstate__(2 ** 70)); t(lambda: it.__setstate__()); it.__setstate__(True); print(next(it))
it = iter(a); next(it); del a[:]; print(list(it))
tn(lambda: type(it)()); print(sorted(k for k in type(it).__dict__ if k not in ("__doc__", "__module__", "__getattribute__")))
print(list(reversed(A("i", [1, 2, 3]))), sorted(A("i", [3, 1, 2])), sum(A("i", [1, 2, 3])), max(A("d", [1.5, 2.5])), list(map(str, A("b", [1, 2]))), tuple(A("w", "ab")), [*A("h", [1, 2])], dict.fromkeys(A("b", [1, 2])), "".join(A("w", "xyz")), list(zip(A("b", [1, 2]), A("w", "ab"))), len(A("i", range(1000))), list(enumerate(A("b", [5]))))
x, y = A("i", [1, 2]); print(x, y)

for proto in range(6):
    for a in (A("i", [1, -2]), A("w", "a€"), A("d", [1.5]), A("Zf", [1j]), A("e", [0.5]), A("b"), A("Q", [2 ** 64 - 1])):
        r = a.__reduce_ex__(proto)
        print(proto, r[0].__name__, r[1][1:] if r[0] is not A else r[1], r[2], r[0](*r[1]) == a, r[0](*r[1]).typecode)
class S(A): pass
s = S("i", [1]); s.x = 1; r = s.__reduce_ex__(4); print(r[0].__name__, r[1][0] is S, r[2], type(r[0](*r[1])).__name__); r = s.__reduce_ex__(2); print(r[0] is S, r[1], r[2])
t(lambda: A("i").__reduce_ex__("a")); t(lambda: A("i").__reduce_ex__(2 ** 70)); t(lambda: A("i").__reduce_ex__()); t(lambda: A("i").__reduce_ex__(1.0)); print(A("i", [1]).__reduce_ex__(True)[0] is A)
R = array._array_reconstructor
t(lambda: R(1, "i", 1, b"")); t(lambda: R(int, "i", 1, b"")); t(lambda: R(A, "x", 1, b"")); t(lambda: R(A, "i", 100, b"")); t(lambda: R(A, "i", 28, b"")); t(lambda: R(A, "i", -1, b"")); t(lambda: R(A, "i", 1, "")); t(lambda: R(A, "i", 1, bytearray())); t(lambda: R(A, "i", 9, b"abc")); t(lambda: R(A, 1, 9, b"abc")); t(lambda: R(A, "i", "a", b"abc")); t(lambda: R(A, "i", 9)); t(lambda: R(A, "i", 2 ** 70, b"")); t(lambda: R(A, "i\0", 9, b"")); t(lambda: R(A, None, 9, b"")); t(lambda: R(A, "i", 8, b"abc")); t(lambda: R(arraytype=A, typecode="i", mformat_code=8, items=b""))
data = bytes(range(1, 17))
for code in range(28):
    for tc in ("b", "i", "q", "d", "w", "Zd"):
        print(code, tc, end=" "); t(lambda: R(A, tc, code, data))
print(R(A, "w", 18, "a€\U0001f600xy".encode("utf-16-le")), R(A, "w", 19, "a€\U0001f600xy".encode("utf-16-be")), R(A, "w", 21, "ab".encode("utf-32-be")), R(A, "w", 20, "abc".encode("utf-32-le")))
t(lambda: R(A, "w", 21, "abc".encode("utf-32-be"))); t(lambda: R(A, "w", 19, "abc".encode("utf-16-be"))); t(lambda: R(A, "w", 18, b"\x00\xd8\x00\x00")); t(lambda: R(A, "i", 18, b"a\0b\0"))
print(R(S, "i", 9, b"\0\0\0\1"), type(R(S, "i", 9, b"\0\0\0\1")).__name__, R(A, "l", 13, b"\xff" * 8), R(A, "L", 11, b"\xff" * 8), R(A, "h", 3, b"\xff\xfe"), R(A, "b", 0, b"\xff"), R(A, "B", 1, b"\xff"), R(A, "d", 15, b"\x3f\x80\0\0"), R(A, "f", 17, b"\x3f\xf0" + bytes(6)), R(A, "e", 27, b"\x3c\0"), R(A, "d", 27, b"\x3c\0"))
import copy, pickle
for a in (A("i", [1, 2]), A("w", "ab"), s):
    c = copy.copy(a); d = copy.deepcopy(a); print(c, d, c == a, c is a, type(c).__name__, type(d).__name__)
    for proto in range(pickle.HIGHEST_PROTOCOL + 1):
        p = pickle.loads(pickle.dumps(a, proto)); print(proto, p, type(p).__name__, p == a, getattr(p, "x", None), end="; ")
    print()
it = iter(A("i", [1, 2, 3])); next(it); print(list(pickle.loads(pickle.dumps(it))), list(copy.copy(it)))
