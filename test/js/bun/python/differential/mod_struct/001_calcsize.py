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

CODES = ["x", "b", "B", "c", "s", "p", "h", "H", "i", "I", "l", "L", "n", "N", "q", "Q", "?", "e", "f", "d", "F", "D", "Zf", "Zd", "P"]
for order in ("", "@", "=", "<", ">", "!"):
    row = []
    for c in CODES:
        try:
            row.append((c, S.calcsize(order + c), S.calcsize(order + "b" + c), S.calcsize(order + "3" + c), S.calcsize(order + "0" + c)))
        except S.error as e:
            row.append((c, str(e)))
    print(repr(order), row)
for f in ("", " ", "  i  h ", "\ti\nh\rb\fb\vb", "bi", "bh", "bq", "bd", "bP", "bhbibq", "ibh", "iq0b", "b0q", "b0i", "bb0h", "3sh", "3s0i", "5pq", "?i", "e?e", "bF", "bD", "bZf", "bZd", "2i3h", "10s10p", "i 2 h", "xxxi", "3xi", "x0q", "0s", "0p", "0x", "<bi", ">bq", "=bd", "!bh", "@bi", "nN", "bn", "100000000s", "i" * 50):
    t(lambda: (f, S.calcsize(f), S.Struct(f).size))
for f in ("z", "Z", "Zx", "iz", "3", "i3", "3 i", "i@", "i<", "<<i", "@@", "<n", "<N", ">P", "=n", "!P", "9" * 30 + "i", "9223372036854775807i", "9223372036854775807s", "9223372036854775807x", "9223372036854775807b", "9223372036854775808b", "4611686018427387904h", "9223372036854775807s1b", "b9223372036854775807q", "i\0", "\0", "é", "i€", "-1i", "+i", "1.5i", "a", "(", "i,h", "0", "00", "Z f", "2Z"):
    t(lambda: S.calcsize(f))
t(lambda: S.calcsize(b"<ih")); t(lambda: S.calcsize(b"\xe9")); t(lambda: S.calcsize(b"i\0")); t(lambda: S.calcsize(1)); t(lambda: S.calcsize(None)); t(lambda: S.calcsize(bytearray(b"i"))); t(lambda: S.calcsize([])); t(lambda: S.calcsize()); t(lambda: S.calcsize("i", 1)); t(lambda: S.calcsize(format="i"))
class Str(str): pass
class Byt(bytes): pass
print(S.calcsize(Str("ih")), S.calcsize(Byt(b"ih")), S.Struct(Str("ih")).format, type(S.Struct(Str("ih")).format).__name__, S.Struct(Byt(b"ih")).format)
