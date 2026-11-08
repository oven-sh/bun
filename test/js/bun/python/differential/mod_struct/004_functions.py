import _struct as S

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__module__ + "." + type(e).__name__, e)

def tn(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__)

t(lambda: S.pack()); t(lambda: S.pack(1)); t(lambda: S.pack("i")); t(lambda: S.pack("i", 1, 2)); t(lambda: S.pack(format="i")); t(lambda: S.pack("i", x=1)); t(lambda: S.pack("")); t(lambda: S.pack("", 1)); t(lambda: S.pack("3s")); t(lambda: S.pack("2i", 1))
t(lambda: S.unpack("i")); t(lambda: S.unpack("i", "abcd")); t(lambda: S.unpack("i", b"abc")); t(lambda: S.unpack("i", b"abcde")); t(lambda: S.unpack("i", b"abcd", 1)); t(lambda: S.unpack(None, b"")); t(lambda: S.unpack("i", None)); t(lambda: S.unpack("i", 5)); t(lambda: S.unpack("", b"a")); t(lambda: S.unpack("i", buffer=b"abcd")); t(lambda: S.unpack())
print(S.unpack("i", bytearray(b"abcd")), S.unpack("<hh", bytearray(b"abcd")), S.unpack("<i", b"abcd"), type(S.unpack("<i", b"abcd")).__name__)
t(lambda: S.unpack_from("i")); t(lambda: S.unpack_from("i", b"abcd", 1)); t(lambda: S.unpack_from("i", b"abcd", -1)); t(lambda: S.unpack_from("i", b"abcd", -10)); t(lambda: S.unpack_from("i", buffer=b"abcd", offset=0)); t(lambda: S.unpack_from("i", b"abcd", "a")); t(lambda: S.unpack_from("i", b"abcd", 0, 1)); t(lambda: S.unpack_from("i", b"abcd", foo=1)); t(lambda: S.unpack_from(format="i", buffer=b"abcd")); t(lambda: S.unpack_from("i", 5)); t(lambda: S.unpack_from("i", b"abcd", 2 ** 70)); t(lambda: S.unpack_from("i", b"abcd", None)); t(lambda: S.unpack_from("i", b"abcd", 1.0)); t(lambda: S.unpack_from()); t(lambda: S.unpack_from("i", b"abcd", offset=0, buffer=b"")); t(lambda: S.unpack_from("i", "abcd"))
data = bytes(range(16))
print([S.unpack_from("<h", data, o) for o in (0, 1, 14, -2, -16, -3)], S.unpack_from("<h", data), S.unpack_from("<h", data, offset=4), S.unpack_from("", data, 16), S.unpack_from("", b""), S.unpack_from("", data, -1) if False else None, S.unpack_from("<16B", data))
t(lambda: S.unpack_from("<h", data, 15)); t(lambda: S.unpack_from("<h", data, 16)); t(lambda: S.unpack_from("<h", data, 100)); t(lambda: S.unpack_from("<h", data, -1)); t(lambda: S.unpack_from("<h", data, -17)); t(lambda: S.unpack_from("", data, 17)); t(lambda: S.unpack_from("", data, -1)); t(lambda: S.unpack_from("", data, -17)); t(lambda: S.unpack_from("<h", b"")); t(lambda: S.unpack_from("<h", data, 2 ** 63 - 1)); t(lambda: S.unpack_from("<h", data, -2 ** 63))
t(lambda: S.pack_into("i")); t(lambda: S.pack_into("i", b"abcd", 0, 1)); t(lambda: S.pack_into("i", bytearray(4))); t(lambda: S.pack_into("i", bytearray(4), "a", 1)); t(lambda: S.pack_into("i", bytearray(4), 1, 1)); t(lambda: S.pack_into("i", bytearray(4), -1, 1)); t(lambda: S.pack_into("i", bytearray(4), -10, 1)); t(lambda: S.pack_into("i", bytearray(4), 0)); t(lambda: S.pack_into("i", "abc", 0, 1)); t(lambda: S.pack_into("i", bytearray(4), 0, 1, x=1)); t(lambda: S.pack_into("i", None, 0, 1)); t(lambda: S.pack_into("i", bytearray(4), None, 1)); t(lambda: S.pack_into("i", bytearray(4), 0, 1, 2)); t(lambda: S.pack_into()); t(lambda: S.pack_into("i", bytearray(4), 2 ** 70, 1)); t(lambda: S.pack_into("z", bytearray(4), 0)); t(lambda: S.pack_into("i", 5, 0, 1))
b = bytearray(b"." * 10)
print(S.pack_into("<h", b, 0, 0x4142), b, S.pack_into("<h", b, -2, 0x4344), b, S.pack_into("<bxb", b, 4, 0x45, 0x46), b, S.pack_into("", b, 10), S.pack_into("", b, 0), S.pack_into("3s", b, 3, b"z"), b)
t(lambda: S.pack_into("<h", b, 9, 1)); t(lambda: S.pack_into("<h", b, 10, 1)); t(lambda: S.pack_into("<h", b, -1, 1)); t(lambda: S.pack_into("<h", b, -11, 1)); t(lambda: S.pack_into("", b, 11)); t(lambda: S.pack_into("", b, -11)); print(b)
b = bytearray(b"." * 8); t(lambda: S.pack_into("<hhh", b, 1, 0x4142, "x", 3)); print(b)
import array
a = array.array("b", bytes(8)); S.pack_into("<hi", a, 1, 0x0102, 0x03040506); print(a, S.unpack_from("<hi", a.tobytes(), 1))
a = array.array("i", [0, 0]); S.pack_into("<q", a, 0, -2); print(a); t(lambda: S.pack_into("<q", a, 1, 0))
class Resize:
    def __init__(self, b): self.b = b
    def __index__(self):
        try:
            self.b.clear()
        except BufferError as e:
            print("BufferError", e)
        return 7
b = bytearray(8); S.pack_into("<bb", b, 0, 1, Resize(b)); print(b); b.clear(); print(b)
a = array.array("b", bytes(4)); S.pack_into("<bb", a, 0, 1, Resize(a)); print(a); a.clear(); print(a)
b = bytearray(8); t(lambda: S.pack_into("<b", b, Resize(b), 1)); print(b)
b = bytearray(8); t(lambda: S.unpack_from("<b", b, Resize(b)))
t(lambda: S.iter_unpack("i")); t(lambda: S.iter_unpack("i", "abcd")); t(lambda: S.iter_unpack("i", b"abc")); t(lambda: S.iter_unpack("", b"")); t(lambda: S.iter_unpack("i", b"abcd", 1)); t(lambda: S.iter_unpack("0s", b"")); t(lambda: S.iter_unpack("i", None)); t(lambda: S.iter_unpack("z", b""))
it = S.iter_unpack("<hb", bytes(range(9)))
print(type(it).__name__, type(it).__module__, iter(it) is it, it.__length_hint__(), next(it), it.__length_hint__(), list(it), it.__length_hint__()); t(lambda: next(it)); t(lambda: next(it))
print(list(S.iter_unpack("<h", b"")), list(S.iter_unpack("<h", bytearray(b"abcd"))), [x for x, in S.iter_unpack("B", b"abc")], list(S.iter_unpack("2s", b"aabbcc")), list(S.iter_unpack("x", b"ab")))
t(lambda: list(S.iter_unpack("B", memoryview(b"abcd")[::-1]))); t(lambda: list(S.iter_unpack("B", memoryview(b"abcd")[::2]))); t(lambda: list(S.Struct("B").iter_unpack(memoryview(bytearray(b"abcd"))[::-1]))); print(list(S.iter_unpack("B", memoryview(b"abcd")[1:3])))
tn(lambda: type(it)()); print(sorted(k for k in type(it).__dict__ if k not in ("__doc__", "__module__", "__getattribute__")))
t(lambda: S._clearcache(1)); print(S._clearcache())
for i in range(250):
    assert S.calcsize("%db" % i) == i
print(S.calcsize("249b"), S.pack("<2b", 1, 2))
print(S.error, S.error.__module__, S.error.__name__, S.error.__qualname__, S.error.__mro__, issubclass(S.error, Exception), S.error("x", 1).args, str(S.error("boom")))
try:
    S.pack("i", "x")
except S.error as e:
    print("caught", e.args, type(e) is S.error)
class MyErr(S.error): pass
print(MyErr("a").args, MyErr.__mro__[1] is S.error)
print(sorted(n for n in dir(S) if not n.startswith("__")))
