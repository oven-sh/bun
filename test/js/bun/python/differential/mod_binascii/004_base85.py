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

for n in range(0, 11):
    d = lcg(n, n + 7)
    e = B.b2a_base85(d); a = B.b2a_ascii85(d); z = B.b2a_base85(d, alphabet=B.Z85_ALPHABET)
    print(n, e, a, z, B.a2b_base85(e) == d, B.a2b_ascii85(a) == d, B.a2b_base85(z, alphabet=B.Z85_ALPHABET) == d, B.b2a_base85(d, pad=True), B.b2a_ascii85(d, pad=True), B.b2a_ascii85(d, adobe=True), B.a2b_ascii85(B.b2a_ascii85(d, adobe=True), adobe=True) == d, B.a2b_base85(B.b2a_base85(d, pad=True)), B.a2b_base85(e, canonical=True) == d, B.a2b_ascii85(a, canonical=True) == d)
for d in (bytes(4), bytes(8), bytes(3), bytes(5), b"    ", b"        ", b"   ", b"a" + bytes(4), bytes(4) + b"    " + b"ab", b"\xff" * 4, b"\xff" * 7, bytes(1), bytes(2)):
    print(d, B.b2a_ascii85(d), B.b2a_ascii85(d, foldspaces=True), B.b2a_ascii85(d, pad=True), B.b2a_ascii85(d, foldspaces=True, pad=True, adobe=True), B.b2a_base85(d), B.a2b_ascii85(B.b2a_ascii85(d, foldspaces=True), foldspaces=True) == d)
d = lcg(30, 2) + bytes(8) + b"    " + lcg(5)
for w in (0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 20, 50, 58, 59, 60, 61, 62, 63, 64, 1000):
    print(w, B.b2a_ascii85(d, wrapcol=w), B.b2a_ascii85(d, wrapcol=w, adobe=True), B.b2a_base85(d, wrapcol=w), B.b2a_ascii85(b"", wrapcol=w), B.b2a_ascii85(b"", wrapcol=w, adobe=True), B.b2a_base85(b"", wrapcol=w), B.b2a_ascii85(b"a", wrapcol=w, adobe=True))
for s in (b"", b"z", b"zz", b"y", b"yy", b"!!!!!", b"!!", b"!!!", b"!!!!", b"!", b"a", b"ab", b"abc", b"abcd", b"abcde", b"abcdef", b"s8W-!", b"s8W-\"", b"uuuuu", b"s8W-", b"s8W", b"s8", b"abz", b"aby", b"zab", b"ab cd e", b"ab\ncde", b"v", b"abcdv", b"\x01", b"\xe9", b"~>", b"<~~>", b"<~ab~>", b"ab~>", b"<~ab", b"<~", b"~", b">", b"<~z~>", b"<~<~ab~>", b"ab~>~>", b"5sdp", b"5sdq", b"5sd", b"5se", b"5s", b"5t", "abcde", bytearray(b"abcde"), b"+<VdL", b"+<Vd", b"z!!!!!z"):
    print(s, end=" -> "); t(lambda: B.a2b_ascii85(s))
    for kw in (dict(foldspaces=True), dict(adobe=True), dict(ignorechars=b" \n"), dict(canonical=True), dict(foldspaces=True, canonical=True), dict(adobe=True, ignorechars=b" \t\n\r\x0b"), dict(ignorechars=b"yzv~<>")):
        print("   ", kw, end=" -> "); t(lambda: B.a2b_ascii85(s, **kw))
for s in (b"", b"0", b"00", b"000", b"0000", b"00000", b"000000", b"|NsC0", b"|NsC1", b"~~~~~", b"|NsC", b"|Ns", b"|N", b"|", b"VPa!s", b"VPa!", b"VPa", b"VP", b"VQ", b"ab cd", b"ab\ncde", b"\"", b"abc\"e", b"abcdeabc,", b"\xe9", "VPa!s", bytearray(b"VPa!s"), b"00000~~~~~", b"0000000000~~~~~", b"abcdefg", b"z", b"y"):
    print(s, end=" -> "); t(lambda: B.a2b_base85(s))
    for kw in (dict(ignorechars=b" \n"), dict(canonical=True), dict(alphabet=B.Z85_ALPHABET), dict(alphabet=B.ASCII85_ALPHABET), dict(ignorechars=b"\",\xe9")):
        print("   ", kw, end=" -> "); t(lambda: B.a2b_base85(s, **kw))
t(lambda: B.a2b_ascii85()); t(lambda: B.a2b_ascii85(1)); t(lambda: B.a2b_ascii85("\xe9")); t(lambda: B.a2b_ascii85(b"", 1)); t(lambda: B.a2b_ascii85(b"", ignorechars="a")); t(lambda: B.a2b_ascii85(b"", foo=1)); t(lambda: B.a2b_ascii85(b"", alphabet=b""))
t(lambda: B.b2a_ascii85()); t(lambda: B.b2a_ascii85("a")); t(lambda: B.b2a_ascii85(b"a", 1)); t(lambda: B.b2a_ascii85(b"a", wrapcol=-1)); t(lambda: B.b2a_ascii85(b"a", wrapcol="x")); t(lambda: B.b2a_ascii85(b"a", foo=1))
t(lambda: B.a2b_base85()); t(lambda: B.a2b_base85(1)); t(lambda: B.a2b_base85(b"", alphabet=b"a")); t(lambda: B.a2b_base85(b"", alphabet="a")); t(lambda: B.a2b_base85(b"", alphabet=bytearray(85))); t(lambda: B.a2b_base85(b"", ignorechars=1)); t(lambda: B.a2b_base85(b"", 1))
t(lambda: B.b2a_base85()); t(lambda: B.b2a_base85("a")); t(lambda: B.b2a_base85(b"a", alphabet=b"a")); t(lambda: B.b2a_base85(b"a", alphabet="a")); t(lambda: B.b2a_base85(b"a", wrapcol=-1)); t(lambda: B.b2a_base85(b"a", True)); print(B.b2a_base85(b"abcd", alphabet=bytearray(range(85))))
big = lcg(40000, 11) + bytes(400) + b" " * 400
for enc, dec, kw in ((B.b2a_base85, B.a2b_base85, {}), (B.b2a_ascii85, B.a2b_ascii85, {}), (B.b2a_ascii85, B.a2b_ascii85, dict(foldspaces=True))):
    e = enc(big, **kw); print(len(e), B.crc32(e), dec(e, **kw) == big)
