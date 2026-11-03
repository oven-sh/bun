def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

a = bytearray(b"hello")
print(a, len(a), a[0], a[-1], a[1:3], type(a[1:3]), a[::-1], list(a), str(a), repr(bytearray()), repr(bytearray(b"'\"\\\n\x00\xff")))
print(bytearray(), bytearray(3), bytearray([1, 2]), bytearray(b"ab"), bytearray("é", "utf-8"), bytearray(range(3)), bytearray(bytearray(b"x")), bytearray(iter([65])), bytearray("a", encoding="ascii"))
t(lambda: bytearray("a"))
t(lambda: bytearray(-1))
t(lambda: bytearray([256]))
t(lambda: bytearray(["a"]))
t(lambda: bytearray(1.5))
t(lambda: bytearray(None))
t(lambda: bytearray(b"a", "utf-8"))
a[0] = 72; print(a)
a[-1] = ord("O"); print(a)
a[1:3] = b"EL"; print(a)
a[1:3] = b"xyz"; print(a)
a[1:4] = b""; print(a)
a[1:1] = b"123"; print(a)
a[::2] = b"ABC"; print(a)
a[:] = b"hello"; print(a)
a[1:3] = [65, 66]; print(a)
a[5:] = bytearray(b"!!"); print(a)
a[10:] = b"z"; print(a)
a[1:2] = range(3); print(a)
def bad(f):
    x = bytearray(b"hello")
    try:
        f(x)
        print(x)
    except Exception as e:
        print(type(e).__name__ + ':', e)
def s1(x): x[0] = 256
def s2(x): x[0] = -1
def s3(x): x[0] = "a"
def s4(x): x[0] = b"a"
def s5(x): x[5] = 1
def s6(x): x[-6] = 1
def s7(x): x[::2] = b"ab"
def s8(x): x[0:1] = "a"
def s9(x): x[0:1] = 5
def s10(x): x[0:1] = [256]
def s11(x): x["a"] = 1
def s12(x): x[0] = 1.0
def s13(x): del x[5]
def s14(x): del x["a"]
def s15(x): x[0:1] = None
def s16(x): x[::0] = b""
for f in (s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16): bad(f)
a = bytearray(b"hello world")
del a[0]; print(a)
del a[-1]; print(a)
del a[1:3]; print(a)
del a[::2]; print(a)
del a[:]; print(a)
a = bytearray(b"ab")
a.append(99); print(a)
a.extend(b"de"); print(a)
a.extend([102, 103]); print(a)
a.extend(range(104, 106)); print(a)
a.extend(bytearray(b"j")); print(a)
a.extend(a); print(a)
a.insert(0, 65); print(a)
a.insert(100, 90); print(a)
a.insert(-1, 89); print(a)
a.insert(-100, 64); print(a)
print(a.pop(), a.pop(0), a.pop(-1), a.pop(1), a)
a.remove(99); print(a)
a.reverse(); print(a)
c = a.copy(); c.append(1); print(a == c, len(a), len(c), type(c))
a.clear(); print(a, len(a))
t(lambda: bytearray().pop())
t(lambda: bytearray(b"a").pop(5))
t(lambda: bytearray(b"a").remove(98))
t(lambda: bytearray(b"a").remove(256))
t(lambda: bytearray(b"a").remove("a"))
t(lambda: bytearray(b"a").append(256))
t(lambda: bytearray(b"a").append("a"))
t(lambda: bytearray(b"a").append(b"a"))
t(lambda: bytearray(b"a").extend("a"))
t(lambda: bytearray(b"a").extend([256]))
t(lambda: bytearray(b"a").extend(1))
t(lambda: bytearray(b"a").extend(["a"]))
t(lambda: bytearray(b"a").insert(0, 256))
t(lambda: bytearray(b"a").insert("a", 1))
t(lambda: bytearray(b"a").insert(0))
a = bytearray(b"ab")
b = a
a += b"cd"; print(a, b, a is b)
a *= 2; print(a, b, a is b)
a += bytearray(b"!"); print(a)
a *= 0; print(a, b)
def iadd_bad():
    x = bytearray(b"a"); x += "b"
t(iadd_bad)
def iadd_bad2():
    x = bytearray(b"a"); x += [1]
t(iadd_bad2)
def imul_bad():
    x = bytearray(b"a"); x *= "b"
t(imul_bad)
a = bytearray(b"Hello World")
print(a + b"!", b"!" + a, type(a + b"!"), type(b"!" + a), a * 2, 2 * a, a == b"Hello World", a != b"x", a < b"I", a == bytearray(a), a == "Hello World", 72 in a, b"World" in a, bytearray(b"lo") in a)
t(lambda: hash(a))
t(lambda: {a: 1})
t(lambda: a + "x")
t(lambda: a < "x")
print(a.upper(), a.lower(), a.swapcase(), a.title(), a.capitalize(), type(a.upper()), a.strip(b"Hd"), a.split(), a.split(b"o"), a.rsplit(None, 1), a.partition(b" "), a.rpartition(b"o"), a.replace(b"o", b"0"), a.find(b"o"), a.rfind(b"o"), a.index(b"W"), a.count(b"l"), a.startswith(b"He"), a.endswith(b"ld"), a.center(15, b"*"), a.ljust(13, b"."), a.rjust(13), a.zfill(13), a.expandtabs(), a.splitlines(), a.join([b"1", b"2"]), a.hex(), a.decode(), a.isalpha(), a.isascii(), a.removeprefix(b"Hello "), a.removesuffix(b"World"), a.translate(None, b"lo"), a.lstrip(b"H"), a.rstrip(b"d"))
print(type(a.split()[0]), type(a.partition(b" ")[0]), type(a.partition(b" ")[1]), type(a.join([])), type(a.replace(b"x", b"y")), a.replace(b"x", b"y") is a, a.upper() is a, a[:] is a, a.strip() is a, type(a.splitlines()[0]), type(a.copy()))
print(bytearray.fromhex("0102"), type(bytearray.fromhex("")), bytearray.maketrans(b"a", b"b")[97], bytes(a), bytearray(bytes(a)) == a, list(reversed(a))[:2], sorted(bytearray(b"cab")), type(iter(a)).__name__)
it = iter(a); print(next(it), next(it))
g = bytearray(b"abc")
res = []
for x in g:
    res.append(x)
    if len(g) < 6:
        g.append(x + 1)
print(res, g)
r = bytearray(b"abc"); r.resize(5); print(r); r.resize(2); print(r); r.resize(0); print(r)
t(lambda: bytearray(b"a").resize(-1))
big = bytearray()
for i in range(1000):
    big.append(i % 256)
print(len(big), big[:5], big[-3:], sum(big), big.count(0), big.find(b"\xff\x00"))
big[100:900] = b""
print(len(big), big[99:102])
print(bytearray(b"abc").__len__(), bytearray(b"abc").__getitem__(0), bytearray(b"abc").__contains__(97), bytearray(b"abc").__eq__(b"abc"), bytearray(b"abc").__alloc__() >= 3, bytearray.__hash__, bytearray.__mro__, sorted(set(dir(bytearray)) - set(dir(bytes))))
class BA(bytearray):
    def extra(self): return len(self)
x = BA(b"abc"); x.append(100)
print(x, x.extra(), type(x), type(x[:2]), type(x + b"a"), type(x.upper()), type(x.copy()), isinstance(x, bytearray), x == b"abcd")
class BS(bytes):
    def __repr__(self): return "BS(" + super().__repr__() + ")"
y = BS(b"abc")
print(y, type(y), type(y[:2]), type(y + b"a"), type(y.upper()), y == b"abc", hash(y) == hash(b"abc"), bytes(y), type(bytes(y)), len(y), y[0], {y: 1}[b"abc"], BS("é", "utf-8"), BS(3), BS([1, 2]))
