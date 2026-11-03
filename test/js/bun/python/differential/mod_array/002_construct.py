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

t(lambda: A()); t(lambda: A(1)); t(lambda: A("i", [], 3)); t(lambda: A("x")); t(lambda: A("x", 5)); t(lambda: A("i", 5)); t(lambda: A(typecode="i")); t(lambda: A("i", initializer=[])); t(lambda: A("ii")); t(lambda: A("")); t(lambda: A("i\0")); t(lambda: A(b"i")); t(lambda: A("i", "abc")); t(lambda: A("i", A("w", "a"))); t(lambda: A("w", A("i", [97]))); t(lambda: A("i", b"abc")); t(lambda: A("i", None)); t(lambda: A("é")); t(lambda: A(None)); t(lambda: A("Z")); t(lambda: A("Zx")); t(lambda: A("zf"))
print(A("i", [1, 2]), A("i", (1, 2)), A("i", range(3)), A("i", iter([4, 5])), A("i", b"\1\0\0\0\2\0\0\0"), A("i", bytearray(b"\1\0\0\0")), A("i", A("i", [7, 8])), A("i", A("h", [7, 8])), A("d", A("i", [1, 2])), A("i", {3: 1}), A("i", set([9])), A("h", b""), A("B", b"abc"), A("i", []))
t(lambda: A("i", A("d", [1.0])))
def gen():
    yield 1
    yield 2
    raise KeyError("boom")
t(lambda: A("i", gen()))
t(lambda: A("i", [1, "x"])); t(lambda: A("i", (1, None)))
class S(A): pass
s = S("i", [1, 2]); s.x = 5
print(s, type(s).__name__, s.x, s.__dict__, isinstance(s, A), type(s[:]).__name__, type(s + s).__name__, type(s * 2).__name__, type(s.__copy__()).__name__, type(s.__deepcopy__({})).__name__, S("i"), S("w", "ab"))
t(lambda: S("i", x=1)); t(lambda: S(typecode="i"))
class S2(A):
    def __init__(self, *a, **k): self.k = k
print(S2("i", x=1), S2("i", x=1).k); t(lambda: S2(typecode="i")); t(lambda: S2("i", [1], 2))
class S3(A):
    def __new__(cls, n): return super().__new__(cls, "b", range(n))
print(S3(4))
class L(list):
    def __getitem__(self, i): return 42
    def __iter__(self): return iter([7])
print(A("i", L([1, 2, 3])))
class T(tuple):
    def __getitem__(self, i): return 43
print(A("i", T([1, 2])))
class Shrink:
    def __init__(self, l): self.l = l
    def __index__(self):
        self.l.clear()
        return 1
l = []; l.extend([Shrink(l), 2, 3]); t(lambda: A("i", l))
print(A.__name__, A.__qualname__, A.__module__, A.__mro__, A.__base__, A.__hash__, A[int], A[int].__origin__ is A)
tn(lambda: hash(A("i")))
tn(lambda: setattr(A, "foo", 1)); tn(lambda: setattr(A("i"), "foo", 1)); tn(lambda: setattr(A("i"), "typecode", "b")); tn(lambda: setattr(A("i"), "itemsize", 1))
print(sorted(k for k in A.__dict__ if k not in ("__doc__", "__module__", "__getattribute__", "__buffer__", "__release_buffer__")))
match A("i", [1, 2]):
    case [x, y]:
        print("seq", x, y)
import collections.abc
print(isinstance(A("i"), collections.abc.MutableSequence), issubclass(A, collections.abc.Sequence), isinstance(A("i"), collections.abc.Hashable))
print([A("i").__sizeof__(), A("i", [1]).__sizeof__(), A("i", [1, 2, 3]).__sizeof__(), A("d", range(10)).__sizeof__(), A("b", b"abc").__sizeof__(), A("w", "abc").__sizeof__(), A("i", iter([1])).__sizeof__()])
a = A("i"); sizes = []
for i in range(70):
    a.append(i); sizes.append(a.__sizeof__())
print(sizes)
for i in range(70):
    a.pop(); sizes.append(a.__sizeof__())
print(sizes[70:])
b = a.buffer_info(); print(type(b).__name__, len(b), b[1], b[0] == 0); a.append(1); b = a.buffer_info(); print(b[1], b[0] != 0, type(b[0]).__name__)
import warnings
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter("always")
    u = A("u", "ab€\U0001f600")
    print(len(w), w[0].category.__name__, w[0].message)
    print(u, u.itemsize, u.typecode, u.tolist(), u.tounicode(), len(u), u[3], u.tobytes().hex())
    u.append("z"); u.fromunicode("yy"); u.extend("q"); print(u, u == A("u", u.tounicode()), u == A("w", u.tounicode()), u.__reduce_ex__(4)[1][1:3])
    t(lambda: A("u", b"\xff\xff\xff\xff").tounicode()); t(lambda: A("u", b"\x00\xd8\x00\x00").tounicode()); t(lambda: A("u", b"\xff\xff\xff\xff")[0]); t(lambda: A("u", ["ab"])); t(lambda: A("u", [1]))
with warnings.catch_warnings():
    warnings.simplefilter("error")
    t(lambda: A("u"))
