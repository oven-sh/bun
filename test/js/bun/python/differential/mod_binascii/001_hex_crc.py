import binascii as B

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__module__ + "." + type(e).__name__, e)

def lcg(n, seed=1):
    out = bytearray()
    for _ in range(n):
        seed = (seed * 1103515245 + 12345) % 2 ** 31
        out.append((seed >> 16) & 255)
    return bytes(out)

for n in sorted(dir(B)):
    v = getattr(B, n)
    if not n.startswith("__") and isinstance(v, bytes): print(n, v)
print(sorted(n for n in dir(B) if not n.startswith("__")))
print(B.Error.__mro__, B.Incomplete.__mro__, B.Error.__module__, B.Error.__name__, B.__doc__, B.Error("x").args, issubclass(B.Error, ValueError))
# hex
print(B.hexlify(b""), B.hexlify(b"\x00\xffabc"), B.b2a_hex(bytearray(b"xyz")), B.hexlify(bytes(range(256)))[:40], type(B.hexlify(b"a")).__name__)
data = bytes(range(1, 8))
for sep in ("-", b":", "\xe9", b"\xe9", " "):
    print(sep, [B.hexlify(data, sep, n) for n in (1, 2, 3, 6, 7, 8, 100, 0, -1, -2, -3, -7, -100)])
print(B.hexlify(data, sep="_", bytes_per_sep=4), B.hexlify(data=data), B.hexlify(b"", "-"), B.hexlify(b"a", "-"), B.hexlify(b"ab", "-", 2 ** 62), B.hexlify(b"ab", "-", -2 ** 63), B.b2a_hex(data, "."), B.hexlify(data, bytes_per_sep=2))
t(lambda: B.hexlify(b"abc", 1)); t(lambda: B.hexlify(b"abc", "ab")); t(lambda: B.hexlify(b"abc", "")); t(lambda: B.hexlify(b"abc", "€")); t(lambda: B.hexlify(b"abc", bytearray(b"-"))); t(lambda: B.hexlify(b"abc", "-", "a")); t(lambda: B.hexlify(b"abc", None)); t(lambda: B.hexlify("abc")); t(lambda: B.hexlify(b"abc", "-", 2 ** 70)); t(lambda: B.hexlify(b"abc", "-", 1, 2)); t(lambda: B.hexlify()); t(lambda: B.hexlify(1)); t(lambda: B.hexlify(b"a", foo=1)); t(lambda: B.hexlify(b"abc", [1])); t(lambda: B.hexlify(b"abc", "-", 1.5)); t(lambda: B.b2a_hex()); t(lambda: B.hexlify(b"a", b"--"))
print(B.unhexlify(""), B.unhexlify("00ffAbCd"), B.a2b_hex(b"6162"), B.unhexlify(bytearray(b"6162")), B.unhexlify("a b\nc d", ignorechars=b" \n"), B.unhexlify("a-b", ignorechars=bytearray(b"-")), B.unhexlify("ab", ignorechars=b""), B.unhexlify("  ", ignorechars=b" "), B.a2b_hex("abgg", ignorechars=b"g"))
t(lambda: B.unhexlify("abc")); t(lambda: B.unhexlify("zz")); t(lambda: B.unhexlify("a")); t(lambda: B.unhexlify("a b")); t(lambda: B.unhexlify(b"ab", b"")); t(lambda: B.unhexlify(1)); t(lambda: B.unhexlify("€")); t(lambda: B.unhexlify("\xe9")); t(lambda: B.unhexlify(None)); t(lambda: B.unhexlify()); t(lambda: B.unhexlify("ab", ignorechars=" ")); t(lambda: B.unhexlify("ab", ignorechars=None)); t(lambda: B.unhexlify("ab", foo=1)); t(lambda: B.unhexlify(hexstr="ab")); t(lambda: B.unhexlify("a b c", ignorechars=b" ")); t(lambda: B.unhexlify(b"\xff\xff")); t(lambda: B.unhexlify("0x"))
print(B.unhexlify(B.hexlify(lcg(1000))) == lcg(1000))
# crc
print(B.crc32(b""), B.crc32(b"a"), B.crc32(b"hello world"), B.crc32(b"hello", 0), B.crc32(b" world", B.crc32(b"hello")), B.crc32(lcg(10000)), B.crc32(bytearray(b"abc")), B.crc32(b"a", 1), B.crc32(b"a", 2 ** 32 - 1), B.crc32(b"a", -1), B.crc32(b"a", -2 ** 31), B.crc32(b"a", True), B.crc32(b"", 12345))
print(B.crc_hqx(b"", 0), B.crc_hqx(b"a", 0), B.crc_hqx(b"hello world", 0), B.crc_hqx(b" world", B.crc_hqx(b"hello", 0)), B.crc_hqx(lcg(10000), 0), B.crc_hqx(b"a", 0xffff), B.crc_hqx(b"a", 0x10000), B.crc_hqx(b"a", -1), B.crc_hqx(b"", 0x12345), B.crc_hqx(b"123456789", 0), B.crc_hqx(b"123456789", 0xffff))
t(lambda: B.crc32()); t(lambda: B.crc32(b"a", "a")); t(lambda: B.crc32(b"a", 1.5)); t(lambda: B.crc32("a")); t(lambda: B.crc32(b"a", crc=1)); t(lambda: B.crc32(b"a", 1, 2)); t(lambda: B.crc32(b"a", None)); t(lambda: B.crc_hqx(b"a")); t(lambda: B.crc_hqx("a", 0)); t(lambda: B.crc_hqx(b"a", "a")); t(lambda: B.crc_hqx()); t(lambda: B.crc_hqx(b"a", 0, 0))
import warnings
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter("always")
    print(B.crc32(b"a", 2 ** 32), B.crc32(b"a", 2 ** 40 + 5), B.crc32(b"a", -2 ** 31 - 1), B.crc32(b"a", 2 ** 70 + 1), B.crc32(b"a", -2 ** 70), B.crc_hqx(b"a", 2 ** 70 + 3), B.crc_hqx(b"a", -2 ** 40))
    print(len(w), sorted(set((x.category.__name__, str(x.message)) for x in w)))
with warnings.catch_warnings():
    warnings.simplefilter("error")
    t(lambda: B.crc32(b"a", 2 ** 32))
class I:
    def __index__(self): return 7
print(B.crc32(b"a", I()), B.crc_hqx(b"a", I()), B.hexlify(b"abcdefghij", "-", I()))
