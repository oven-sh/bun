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

INTS = {"b": 1, "B": 1, "h": 2, "H": 2, "i": 4, "I": 4, "l": 4, "L": 4, "q": 8, "Q": 8}
NATIVE = dict(INTS, l=8, L=8, n=8, N=8)
class I:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
for order in ("@", "=", "<", ">", "!"):
    for c, size in (NATIVE if order == "@" else INTS).items():
        f = order + c
        signed = c.islower()
        lo, hi = (-(1 << (8 * size - 1)), (1 << (8 * size - 1)) - 1) if signed else (0, (1 << (8 * size)) - 1)
        out = []
        for v in (lo, hi, 0, 1, hi // 3, True, I(5)):
            p = S.pack(f, v); out.append((p.hex(), S.unpack(f, p)[0]))
        print(f, out)
        t(lambda: S.pack(f, lo - 1)); t(lambda: S.pack(f, hi + 1)); t(lambda: S.pack(f, 2 ** 100)); t(lambda: S.pack(f, -2 ** 100)); t(lambda: S.pack(f, I(hi + 1))); t(lambda: S.pack(f, I(2 ** 100)))
    t(lambda: S.pack(order + "i", 1.5)); t(lambda: S.pack(order + "i", "1")); t(lambda: S.pack(order + "i", None)); t(lambda: S.pack(order + "Q", 1.0)); t(lambda: S.pack(order + "b", b"a")); t(lambda: S.pack(order + "H", 1j))
class BadIndex:
    def __index__(self): raise ZeroDivisionError("idx")
class StrIndex:
    def __index__(self): return "x"
t(lambda: S.pack("i", BadIndex())); t(lambda: S.pack("<Q", BadIndex())); t(lambda: S.pack("i", StrIndex()))
print(S.pack("P", 0), S.pack("P", 2 ** 64 - 1), S.pack("P", -1), S.pack("P", -2 ** 63), S.pack("P", I(7)), S.unpack("P", b"\xff" * 8), S.unpack("P", bytes(8)))
t(lambda: S.pack("P", 2 ** 64)); t(lambda: S.pack("P", -2 ** 63 - 1)); t(lambda: S.pack("P", I(2 ** 64))); t(lambda: S.pack("P", I(-2 ** 63 - 1))); t(lambda: S.pack("P", 1.5)); t(lambda: S.pack("P", None))
for order in ("@", "<", ">"):
    print(order, [S.pack(order + "?", v) for v in (True, False, 0, 1, 5, "", "a", [], [0], None, 0.0)], [S.unpack(order + "?", bytes([b]))[0] for b in (0, 1, 2, 255)])
class BadBool:
    def __bool__(self): raise ZeroDivisionError("bool")
t(lambda: S.pack("?", BadBool())); t(lambda: S.pack(">?", BadBool()))
print(S.pack("c", b"a"), S.pack("3c", b"a", b"b", b"c"), S.unpack("3c", b"abc"), S.pack("<c", b"\xff"))
t(lambda: S.pack("c", b"ab")); t(lambda: S.pack("c", b"")); t(lambda: S.pack("c", "a")); t(lambda: S.pack("c", 97)); t(lambda: S.pack("c", bytearray(b"a"))); t(lambda: S.pack("c", None))
for f in ("s", "0s", "1s", "3s", "5s", "p", "0p", "1p", "2p", "3p", "5p", "300p"):
    print(f, [S.pack(f, v)[:12] for v in (b"", b"a", b"abc", b"abcdefgh", bytearray(b"xy"))], len(S.pack(f, b"z" * 400)), S.pack(f, b"z" * 400)[:2], S.unpack(f, S.pack(f, b"abcdefgh"))[0][:10])
print(S.unpack("5p", b"\x09abcd"), S.unpack("5p", b"\x02abcd"), S.unpack("5p", b"\x00abcd"), S.unpack("1p", b"\x05"), S.unpack("0p", b""), S.unpack("0s", b""), S.unpack("2s2s", b"abcd"), S.unpack("300p", b"\xff" + b"q" * 299)[0][-3:], len(S.unpack("300p", b"\xff" + b"q" * 299)[0]))
t(lambda: S.pack("s", "a")); t(lambda: S.pack("3s", 1)); t(lambda: S.pack("p", "a")); t(lambda: S.pack("3p", None)); t(lambda: S.pack("s", memoryview(b"a")))
print(S.pack("xbx", 1), S.pack("3x"), S.pack("x"), S.unpack("xbx", b"\1\2\3"), S.unpack("3x", b"abc"), S.pack(""), S.unpack("", b""), S.pack("0i"), S.unpack("0i", b""), S.pack("b0i", 1), S.pack("bi", 1, 2), S.pack("<bi", 1, 2), S.pack("ibh", 1, 2, 3), S.pack("bq", 1, 2), S.pack("2h3b", 1, 2, 3, 4, 5), S.unpack("2h3b", bytes(range(7))))
print(S.pack(b"<h", 1), S.unpack(b">h", b"\0\1"), S.pack(" < h".strip(), 1), S.pack("< h b", 1, 2))
