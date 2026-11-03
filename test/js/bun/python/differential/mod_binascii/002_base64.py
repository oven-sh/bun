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

for n in range(0, 12):
    d = lcg(n, n + 1); e = B.b2a_base64(d)
    print(n, e, B.a2b_base64(e) == d, B.b2a_base64(d, newline=False), B.b2a_base64(d, padded=False), B.a2b_base64(B.b2a_base64(d, padded=False), padded=False) == d)
d = lcg(60)
for w in (0, 1, 3, 4, 5, 7, 8, 20, 76, 79, 80, 81, 1000, 2 ** 63):
    print(w, B.b2a_base64(d, wrapcol=w), B.b2a_base64(d[:1], wrapcol=w, newline=False), B.b2a_base64(b"", wrapcol=w), B.b2a_base64(d[:7], wrapcol=w, padded=False, newline=False))
print(B.b2a_base64(d[:10], alphabet=B.URLSAFE_BASE64_ALPHABET), B.b2a_base64(b"\xfb\xff\xfe", alphabet=B.URLSAFE_BASE64_ALPHABET), B.b2a_base64(b"\xfb\xff\xfe"), B.b2a_base64(b"abc", alphabet=bytearray(B.CRYPT_ALPHABET)), B.b2a_base64(b"abc", alphabet=bytes(range(64))), B.b2a_base64(bytearray(b"abc")))
t(lambda: B.b2a_base64("a")); t(lambda: B.b2a_base64(b"a", wrapcol=-1)); t(lambda: B.b2a_base64(b"a", wrapcol="a")); t(lambda: B.b2a_base64(b"a", wrapcol=2 ** 64)); t(lambda: B.b2a_base64(b"a", wrapcol=1.0)); t(lambda: B.b2a_base64(b"a", alphabet="a")); t(lambda: B.b2a_base64(b"a", alphabet=b"a")); t(lambda: B.b2a_base64(b"a", alphabet=bytes(65))); t(lambda: B.b2a_base64(b"a", newline=None)); t(lambda: B.b2a_base64(b"a", True)); t(lambda: B.b2a_base64()); t(lambda: B.b2a_base64(b"a", foo=1)); t(lambda: B.b2a_base64(data=b"a")); t(lambda: B.b2a_base64(b"a", alphabet=None)); t(lambda: B.b2a_base64(None)); t(lambda: B.b2a_base64(b"a", wrapcol=None)); t(lambda: B.b2a_base64(b"a", padded=[], newline=""))
# decoding, lenient
for s in (b"", b"YQ==", b"YWI=", b"YWJj", "YWJj", bytearray(b"YWJj"), b"YWJj\n", b"Y W\nJ\tj", b"YQ", b"YQ=", b"YWI", b"Y", b"YWJjY", b"=", b"==", b"====", b"=YWJj", b"YQ==YWJj", b"YQ=YWJj", b"YQ==\n", b"YQ===", b"YQ====", b"YW=Jj", b"Y=WJj", b"Y===", b"YWJj====", b"!@#$", b"Y!Q@=#=", b"YQ=!=", b"\xff\xfeYQ==", b"YR==", b"YWJ=", b"YWK=", b"YQ==Y", b"YQ==YQ==", b"YWJjZA", b"YWJjZGU", b"-_-_", b"+/+/", b"A", b"AA", b"AAA", b"AAAA", b"AAAAA", b"A=", b"A==", b"A===", b"AA=A", b"AA=AA", b"AAA=A", b"AAA=AAAA"):
    print(s, end=" -> "); t(lambda: B.a2b_base64(s))
    for kw in (dict(strict_mode=True), dict(padded=False), dict(strict_mode=True, padded=False), dict(canonical=True), dict(strict_mode=True, canonical=True), dict(ignorechars=b""), dict(ignorechars=b" \n\t"), dict(ignorechars=b"="), dict(ignorechars=b"=!@#$\n"), dict(strict_mode=False, ignorechars=b""), dict(strict_mode=True, ignorechars=b"\n ="), dict(alphabet=B.URLSAFE_BASE64_ALPHABET), dict(alphabet=B.URLSAFE_BASE64_ALPHABET, strict_mode=True)):
        print("   ", kw, end=" -> "); t(lambda: B.a2b_base64(s, **kw))
t(lambda: B.a2b_base64()); t(lambda: B.a2b_base64(1)); t(lambda: B.a2b_base64("\xe9")); t(lambda: B.a2b_base64("€")); t(lambda: B.a2b_base64(b"", 1)); t(lambda: B.a2b_base64(b"", alphabet="a")); t(lambda: B.a2b_base64(b"", alphabet=b"a")); t(lambda: B.a2b_base64(b"", alphabet=bytearray(64))); t(lambda: B.a2b_base64(b"", ignorechars="a")); t(lambda: B.a2b_base64(b"", strict_mode=[])); t(lambda: B.a2b_base64(b"", foo=1)); t(lambda: B.a2b_base64(data=b"")); t(lambda: B.a2b_base64(b"", alphabet=None)); t(lambda: B.a2b_base64(b"", ignorechars=None)); t(lambda: B.a2b_base64(None)); t(lambda: B.a2b_base64([]))
alpha = bytes(range(100, 164)); print(B.a2b_base64(B.b2a_base64(b"hello world", alphabet=alpha), alphabet=alpha), B.a2b_base64(b"====", alphabet=b"=" + B.BASE64_ALPHABET[1:]), B.a2b_base64(b"AAAA", alphabet=b"A" * 64), B.a2b_base64(b"ABCD", alphabet=B.BASE64_ALPHABET[::-1]))
big = lcg(100000, 5); e = B.b2a_base64(big); print(len(e), B.crc32(e), B.a2b_base64(e) == big, B.a2b_base64(B.b2a_base64(big, wrapcol=76)) == big, B.crc32(B.b2a_base64(big, wrapcol=76)), B.a2b_base64(e, strict_mode=True, ignorechars=b"\n") == big)
class Sub(bytes): pass
class SubStr(str): pass
print(B.a2b_base64(Sub(b"YQ==")), B.a2b_base64(SubStr("YQ==")), B.a2b_base64(b"YQ==", alphabet=Sub(B.BASE64_ALPHABET)), B.b2a_base64(Sub(b"a")))
class Evil:
    def __init__(self, b): self.b = b
    def __bool__(self):
        try:
            self.b.clear()
        except BufferError as e:
            print("BufferError", e)
        return True
b = bytearray(b"YWJj" * 100); print(B.a2b_base64(b, strict_mode=Evil(b)), b)
b = bytearray(b"abc" * 100); print(B.b2a_base64(b, newline=Evil(b)), b)
