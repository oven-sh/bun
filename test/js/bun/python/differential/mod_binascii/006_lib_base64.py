import base64, binascii

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__module__ + "." + type(e).__name__, e)

data = bytes(range(0, 256, 7)) + b"hello world"
for enc, dec in ((base64.b64encode, base64.b64decode), (base64.standard_b64encode, base64.standard_b64decode), (base64.urlsafe_b64encode, base64.urlsafe_b64decode), (base64.b32encode, base64.b32decode), (base64.b32hexencode, base64.b32hexdecode), (base64.b16encode, base64.b16decode), (base64.a85encode, base64.a85decode), (base64.b85encode, base64.b85decode), (base64.z85encode, base64.z85decode), (base64.encodebytes, base64.decodebytes)):
    e = enc(data); print(enc.__name__, e, dec(e) == data, dec(e.decode("ascii")) == data if dec is not base64.decodebytes else None)
print(base64.b64encode(b"\xfb\xff", altchars=b"-_"), base64.b64decode(b"-_8=", altchars=b"-_"), base64.b64decode(b"YQ==\n"), base64.b64decode("YQ"+"=="), base64.b64encode(b""), base64.b64decode(b""))
t(lambda: base64.b64decode(b"YQ=")); t(lambda: base64.b64decode(b"Y")); t(lambda: base64.b64decode(b"YQ==!", validate=True)); t(lambda: base64.b64decode(b"Y!Q==")); t(lambda: base64.b64decode("é")); t(lambda: base64.b64encode("a")); t(lambda: base64.b64decode(1)); t(lambda: base64.b64encode(b"a", altchars=b"-"))
print(base64.b32decode(b"me======", casefold=True), base64.b32decode(b"M1======", map01=b"L") if False else None, base64.b16decode(b"abcd", casefold=True), base64.b32encode(b"a"), base64.b16encode(b"\xab"))
t(lambda: base64.b32decode(b"me======")); t(lambda: base64.b32decode(b"ME=====")); t(lambda: base64.b16decode(b"abcd")); t(lambda: base64.b16decode(b"ABC")); t(lambda: base64.b16decode(b"GG"))
print(base64.a85encode(b"hello   world" + bytes(8), foldspaces=True, wrapcol=7, pad=True, adobe=True), base64.a85decode(b"<~87cURD]i,\"Ebo80~>", adobe=True), base64.a85decode(b"87cUR D]i,\"\nEbo80"), base64.a85encode(bytes(4)), base64.a85decode(b"z"), base64.a85decode(b"y", foldspaces=True))
t(lambda: base64.a85decode(b"abz")); t(lambda: base64.a85decode(b"ab", adobe=True)); t(lambda: base64.a85decode(b"uuuuu")); t(lambda: base64.a85decode(b"\x7f")); t(lambda: base64.b85decode(b"~~~~~")); t(lambda: base64.b85decode(b"\"")); t(lambda: base64.z85decode(b"~"))
print(base64.b85encode(b"abc", pad=True), base64.b85decode(base64.b85encode(b"abc", pad=True)), base64.encodebytes(bytes(100)), base64.decodebytes(b"YQ==\nYg==\n"))
print(sorted(base64.__all__))
