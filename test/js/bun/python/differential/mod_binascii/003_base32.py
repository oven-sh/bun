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

for n in range(0, 14):
    d = lcg(n, n + 3); e = B.b2a_base32(d)
    print(n, e, B.a2b_base32(e) == d, B.b2a_base32(d, padded=False), B.a2b_base32(B.b2a_base32(d, padded=False), padded=False) == d, B.b2a_base32(d, alphabet=B.BASE32HEX_ALPHABET))
d = lcg(33)
for w in (0, 1, 7, 8, 9, 15, 16, 17, 40, 55, 56, 57, 1000):
    print(w, B.b2a_base32(d, wrapcol=w), B.b2a_base32(b"", wrapcol=w), B.b2a_base32(d[:6], wrapcol=w, padded=False))
t(lambda: B.b2a_base32("a")); t(lambda: B.b2a_base32(b"a", wrapcol=-1)); t(lambda: B.b2a_base32(b"a", alphabet=b"a")); t(lambda: B.b2a_base32(b"a", alphabet="a")); t(lambda: B.b2a_base32(b"a", True)); t(lambda: B.b2a_base32()); t(lambda: B.b2a_base32(b"a", newline=True)); print(B.b2a_base32(b"abc", alphabet=bytearray(range(32))))
for s in (b"", b"ME======", b"MFRA====", b"MFRGG===", b"MFRGGZA=", b"MFRGGZDF", "MFRGGZDF", bytearray(b"MFRGGZDF"), b"ME", b"MFRA", b"MFRGG", b"MFRGGZA", b"M", b"MFR", b"MFRGGZ", b"MFRGGZDFM", b"me======", b"ME=====", b"ME=======", b"ME======ME======", b"ME======M", b"=", b"========", b"=ME=====", b"ME=A====", b"ME==A===", b"M=======", b"MFR=====", b"MFRGGZ==", b"ME======\n", b"ME ======", b"M E======", b"MF======", b"MFRB====", b"MFRGH===", b"MFRGGZB=", b"ME1=====", b"ME0=====", b"ME8=====", b"\xffME======", b"MFRGGZDFME======", b"MFRGGZDF=", b"MFRGGZDF========", b"AA======", b"AB======", b"00======", b"C4======"):
    print(s, end=" -> "); t(lambda: B.a2b_base32(s))
    for kw in (dict(padded=False), dict(canonical=True), dict(ignorechars=b" \n"), dict(ignorechars=b"="), dict(ignorechars=b"=\n 018"), dict(alphabet=B.BASE32HEX_ALPHABET), dict(padded=False, ignorechars=b"="), dict(padded=False, canonical=True)):
        print("   ", kw, end=" -> "); t(lambda: B.a2b_base32(s, **kw))
t(lambda: B.a2b_base32()); t(lambda: B.a2b_base32(1)); t(lambda: B.a2b_base32("\xe9")); t(lambda: B.a2b_base32(b"", 1)); t(lambda: B.a2b_base32(b"", alphabet="a")); t(lambda: B.a2b_base32(b"", alphabet=b"a")); t(lambda: B.a2b_base32(b"", alphabet=bytearray(32))); t(lambda: B.a2b_base32(b"", ignorechars="a")); t(lambda: B.a2b_base32(b"", foo=1)); t(lambda: B.a2b_base32(b"", strict_mode=True)); t(lambda: B.a2b_base32(b"", ignorechars=None))
big = lcg(50000, 9); e = B.b2a_base32(big); print(len(e), B.crc32(e), B.a2b_base32(e) == big, B.a2b_base32(B.b2a_base32(big, wrapcol=64), ignorechars=b"\n") == big, B.crc32(B.b2a_base32(big, wrapcol=64)))
