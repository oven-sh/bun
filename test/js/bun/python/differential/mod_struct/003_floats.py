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

inf = float("inf"); nan = float("nan")
class F:
    def __float__(self): return 2.5
class I:
    def __index__(self): return 3
class C:
    def __complex__(self): return 1 + 2j
for order in ("@", "=", "<", ">", "!"):
    for c in "efd":
        f = order + c
        print(f, [(S.pack(f, v).hex(), S.unpack(f, S.pack(f, v))[0]) for v in (0.0, -0.0, 1.0, -1.5, 0.1, 1, True, 65504, inf, -inf, F(), I(), 1e-8, 2 ** -24, 2 ** -149, 5e-324)])
        print(S.pack(f, nan).hex(), S.unpack(f, S.pack(f, nan)))
        t(lambda: S.pack(f, "1")); t(lambda: S.pack(f, None)); t(lambda: S.pack(f, 1j)); t(lambda: S.pack(f, 10 ** 400)); t(lambda: S.pack(f, b"a")); t(lambda: S.pack(f, C()))
        t(lambda: S.pack(f, 1e300).hex()); t(lambda: S.pack(f, -1e300).hex()); t(lambda: S.pack(f, 10 ** 300).hex()); t(lambda: S.pack(f, 65520.0).hex()); t(lambda: S.pack(f, 65520).hex()); t(lambda: S.pack(f, 65519.9).hex()); t(lambda: S.pack(f, 3.4028235677973366e38).hex()); t(lambda: S.pack(f, 3.4028235677973362e38).hex())
    for c in ("F", "D", "Zf", "Zd"):
        f = order + c
        print(f, [(S.pack(f, v).hex(), S.unpack(f, S.pack(f, v))[0]) for v in (0j, 1 + 2j, -1.5j, 1, 2.5, True, C(), F(), I(), complex(inf, -inf), complex(-0.0, -0.0), 0.1 + 0.2j)])
        t(lambda: S.pack(f, "1")); t(lambda: S.pack(f, None)); t(lambda: S.pack(f, 10 ** 400)); t(lambda: S.pack(f, 1e300).hex()); t(lambda: S.pack(f, 1e300j).hex()); t(lambda: S.pack(f, 10 ** 300).hex())
class BadFloat:
    def __float__(self): raise ZeroDivisionError("flt")
t(lambda: S.pack("d", BadFloat())); t(lambda: S.pack("<e", BadFloat())); t(lambda: S.pack("D", BadFloat()))
# rounding of half floats
for v in (1.0009765625, 1.00048828125, 1.00146484375, 1.000488281250001, 2049.0, 2051.0, 2 ** -25, 2 ** -25 * 1.0000001, 2 ** -24 * 1.5, 2 ** -24 * 2.5, 2 ** -14 - 2 ** -25, 2 ** -14 - 2 ** -26, 65519.99, 1 / 3, 1e-5, 6.1e-5, 0.00006103515625):
    print(v, S.pack("<e", v).hex(), S.unpack("<e", S.pack("<e", v))[0])
print([S.unpack("<e", bytes([lo, hi]))[0] for lo, hi in ((0, 0), (1, 0), (255, 3), (0, 4), (0, 60), (255, 123), (0, 124), (0, 252), (0, 128), (1, 128))])
# NaN payloads and signs survive a round trip
import math
for f, raws in (("<e", ("017e", "01fe", "007e", "00fe", "017c", "fffd", "ff7f")), (">e", ("7e01", "fc01")), ("<f", ("0100c07f", "0100c0ff", "0000c07f", "ffffff7f")), (">f", ("7fc00001", "ffc00001", "7f800001", "ff800001", "7fa00000")), ("<d", ("010000000000f87f", "010000000000f8ff", "010000000000f07f", "ffffffffffffffff", "000000000000f8ff")), (">d", ("7ff8000000000001", "fff0000000000001"))):
    for raw in raws:
        v = S.unpack(f, bytes.fromhex(raw))[0]
        print(f, raw, v, S.pack(f, v).hex(), math.copysign(1, v), S.pack("<d", v).hex())
v = S.unpack("<d", bytes.fromhex("010000000000f8ff"))[0]
print(S.pack("<e", v).hex(), S.pack("<f", v).hex(), S.pack(">f", v).hex(), v != v, type(v).__name__, repr(v))
v = S.unpack("<D", bytes.fromhex("010000000000f8ff" + "020000000000f07f"))[0]; print(v, S.pack("<D", v).hex(), S.pack(">D", v).hex(), S.pack(">F", v).hex())
