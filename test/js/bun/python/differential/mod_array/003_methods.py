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

a = A("i", [1, 2, 3])
a.append(4); print(a); a.insert(0, 0); a.insert(-1, 9); a.insert(100, 10); a.insert(-100, -10); a.insert(2, 22); print(a)
a.extend([5, 6]); a.extend(A("i", [7])); a.extend(range(2)); a.extend(a); print(a, len(a))
t(lambda: a.extend(5)); t(lambda: a.extend(A("h"))); t(lambda: a.extend([1, "x"])); print(len(a), a[-1]); t(lambda: a.append("x")); t(lambda: a.append()); t(lambda: a.append(1, 2)); t(lambda: a.insert("a", 1)); t(lambda: a.insert(1)); t(lambda: a.insert(0, "x")); t(lambda: a.insert(2 ** 70, 1)); t(lambda: a.append(v=1))
a = A("i", [1, 2, 3, 2, 1])
print(a.count(2), a.count(5), a.count("x"), a.count(2.0), a.index(2), a.index(2, 2), a.index(2, -2), a.index(1, 1, 100), 2 in a, 5 in a, "x" in a, 2.0 in a, None in a)
t(lambda: a.index(5)); t(lambda: a.index(2, 4)); t(lambda: a.index(2, 0, 1)); t(lambda: a.index(1, "a")); t(lambda: a.index(1, None)); t(lambda: a.index(1, 0, None)); t(lambda: a.index()); t(lambda: a.index(1, 2, 3, 4)); print(a.index(1, -100), a.index(1, 2 ** 70 - 2 ** 70, 2 ** 70)); t(lambda: a.index(1, 2 ** 70)); t(lambda: a.index(1, 0, -2 ** 70))
a.remove(2); print(a); t(lambda: a.remove(5)); t(lambda: a.remove("x"))
a.extend([7, 8]); print(a.pop(), a.pop(0), a.pop(-1), a.pop(1), a); t(lambda: a.pop(5)); t(lambda: a.pop(-5)); print(a.pop()); t(lambda: a.pop()); t(lambda: a.pop(0)); t(lambda: A("i", [1]).pop("a")); t(lambda: A("i", [1]).pop(1, 2)); t(lambda: A("i", [1]).pop(2 ** 70))
a = A("h", range(7)); a.reverse(); print(a); a = A("h", range(6)); a.reverse(); print(a); a = A("Zd", [1, 2j, 3]); a.reverse(); print(a); a = A("b"); a.reverse(); print(a); a = A("b", [1]); a.reverse(); print(a)
a = A("i", [1, 2]); a.clear(); print(a, len(a), a.__sizeof__()); a.clear(); a.append(1); print(a)
n = float("nan"); d = A("d", [n, 1.0]); print(n in d, d.count(n), d == d, d != d, d == A("d", [n, 1.0]), d < d, d <= d); t(lambda: d.index(n)); t(lambda: d.remove(n))
for tc in "bBhHiIlLqQefd":
    x = A(tc, [1, 2, 3]); x.byteswap(); print(tc, x.tobytes().hex(), end="; ")
print()
x = A("Zf", [1 + 2j]); x.byteswap(); print(x.tobytes().hex()); x.byteswap(); print(x)
x = A("Zd", [1 + 2j]); x.byteswap(); print(x.tobytes().hex()); x.byteswap(); print(x)
x = A("w", "ab"); x.byteswap(); print(x.tobytes().hex()); x.byteswap(); print(x)
t(lambda: A("i").byteswap(1))
a = A("i", [1, 2]); print(a.tolist(), a.tobytes(), type(a.tolist()).__name__, type(a.tobytes()).__name__)
a.fromlist([3, 4]); print(a); a.fromlist([]); t(lambda: a.fromlist((1,))); t(lambda: a.fromlist([5, "x"])); print(a); t(lambda: a.fromlist(None)); t(lambda: a.fromlist([2 ** 40])); print(a)
class L(list): pass
a.fromlist(L([9])); print(a)
a.frombytes(b"\5\0\0\0"); a.frombytes(bytearray(b"\6\0\0\0")); a.frombytes(b""); print(a); t(lambda: a.frombytes(b"abc")); t(lambda: a.frombytes("abcd")); t(lambda: a.frombytes(1)); t(lambda: a.frombytes()); print(len(a))
w = A("w", "ab"); w.fromunicode("cd€"); w.fromunicode(""); print(w, w.tounicode()); t(lambda: w.fromunicode(b"a")); t(lambda: w.fromunicode(1)); t(lambda: w.fromunicode(None)); t(lambda: a.fromunicode("a")); t(lambda: a.fromunicode(1)); t(lambda: a.tounicode())
t(lambda: A("w", b"\xff\xff\xff\xff")); t(lambda: A("w", b"\xff\xff\xff\xff")[0]); t(lambda: A("w", b"\xff\xff\xff\xff").tounicode()); t(lambda: A("w", b"\x00\xd8\x00\x00").tounicode()); t(lambda: A("w", b"\x00\xd8\x00\x00")[0]); t(lambda: A("w", "﻿ab").tounicode()); t(lambda: A("w", "﻿ab")); t(lambda: A("w", b"\xff\xff\xff\xff").tolist()); t(lambda: list(A("w", b"a\0\0\0\xff\xff\xff\xff"))); t(lambda: "a" in A("w", b"\xff\xff\xff\xff"))
class File:
    def __init__(self, data=b""): self.data = data; self.log = []
    def read(self, n): self.log.append(n); r, self.data = self.data[:n], self.data[n:]; return r
    def write(self, b): self.log.append((type(b).__name__, len(b))); self.data += b; return 5
f = File(); A("i", [1, 2, 3]).tofile(f); print(f.data, f.log); f = File(); A("i").tofile(f); print(f.log); f = File(); A("b", bytes(200000)).tofile(f); print(f.log, len(f.data))
f = File(b"\1\0\0\0\2\0\0\0\3\0"); a = A("i"); a.fromfile(f, 1); print(a, f.log); t(lambda: a.fromfile(f, 5)); print(a); a.fromfile(f, 0); print(a)
f = File(b"\1\0\0\0\2\0\0\0"); a = A("i"); t(lambda: a.fromfile(f, 3)); print(a)
t(lambda: a.fromfile(None, 1)); t(lambda: a.fromfile(f, -1)); t(lambda: a.fromfile(f, "a")); t(lambda: a.fromfile(f)); t(lambda: a.fromfile(f, 2 ** 62)); t(lambda: a.tofile(None)); t(lambda: A("i").tofile(None)); t(lambda: a.tofile())
class BadFile:
    def read(self, n): return "x" * n
t(lambda: a.fromfile(BadFile(), 1))
class BAFile:
    def read(self, n): return bytearray(n)
t(lambda: a.fromfile(BAFile(), 1))
a = A("i", [1])
for name, n in (("extend", 1), ("fromfile", 2), ("tofile", 1), ("__reduce_ex__", 1)):
    m = getattr(a, name)
    t(lambda: m()); t(lambda: m(*([1] * (n + 1)))); t(lambda: m(*([1] * n), x=1)); t(lambda: m(x=1))
it = iter(a); t(lambda: it.__reduce__(1)); t(lambda: it.__reduce__(x=1))
class I:
    n = 0
    def __index__(self): I.n += 1; return 1
counts = []
for f in (lambda: a.append(I()), lambda: a.insert(0, I()), lambda: a.__setitem__(0, I()), lambda: a.extend([I()]), lambda: A("i", [I()]), lambda: A("i", iter([I()])), lambda: a.fromlist([I()]), lambda: a.pop(I()), lambda: a[I()], lambda: a.index(1, I()), lambda: a * I()):
    I.n = 0; f(); counts.append(I.n)
print(counts)
