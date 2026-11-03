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

for n in (0, 1, 2, 3, 4, 5, 44, 45):
    d = lcg(n, n + 1); e = B.b2a_uu(d); print(n, e, B.a2b_uu(e) == d, B.b2a_uu(d, backtick=True), B.a2b_uu(B.b2a_uu(d, backtick=True)) == d)
print(B.b2a_uu(bytes(5)), B.b2a_uu(bytes(5), backtick=True), B.b2a_uu(bytearray(b"abc")), B.b2a_uu(b"", backtick=True), B.b2a_uu(b"", backtick=False))
t(lambda: B.b2a_uu(b"a", True)); t(lambda: B.b2a_uu(b"a" * 46)); t(lambda: B.b2a_uu("a")); t(lambda: B.b2a_uu()); t(lambda: B.b2a_uu(b"a", foo=1)); t(lambda: B.b2a_uu(b"a", backtick=[]))
for s in (b"", b" ", b"`", b"\x7f", b"!\x01", b" abc", b"#86)C", b"#86)C\n", b"#86)C\r\n", b"#86)C  ", b"#86)C``", b"#86)Cx", b"#86)", b"#86", b"#8", b"#", b"#\n", b"#86\n)C", "#86)C", bytearray(b"#86)C"), b"!86)C", b"\"86)C", b"$86)C", b"M", b"#86)\x00", b"#86)a", b"#86)\xe9", b"#86)`", b"\x00", b"\xa3" + b"86)C", b"# 6)C", b"#`6)C"):
    print(s, end=" -> "); t(lambda: B.a2b_uu(s))
t(lambda: B.a2b_uu()); t(lambda: B.a2b_uu(1)); t(lambda: B.a2b_uu("\xe9")); t(lambda: B.a2b_uu(b"", 1)); t(lambda: B.a2b_uu(data=b""))
# quoted-printable
for s in (b"", b"abc", b"a=3Db", b"a=3db", b"=", b"a=", b"==", b"a==b", b"=\n", b"a=\nb", b"a=\r\nb", b"a=\rb", b"a=\rb\nc", b"=3", b"=3\n", b"=3G", b"=G3", b"=AB=CD", b"a_b", b"=5F", b"a b", b"=00", b"=\x00", b"=20\n", b"a=\n", b"a=\r", b"===", b"=3D=3D", b"\xff=FF", "a=3Db", bytearray(b"a=3Db"), b"a\nb\r\nc", b"=a", b"=aZ", b"= \n"):
    print(s, B.a2b_qp(s), B.a2b_qp(s, header=True), B.a2b_qp(s, True), B.a2b_qp(data=s, header=False))
t(lambda: B.a2b_qp()); t(lambda: B.a2b_qp(1)); t(lambda: B.a2b_qp("\xe9")); t(lambda: B.a2b_qp(b"a", 1, 2)); t(lambda: B.a2b_qp(b"a", foo=1)); t(lambda: B.a2b_qp(b"a", header=[]))
CASES = (b"", b"abc", b"a=b", b"a b", b"a\tb", b"a ", b"a\t", b" ", b"\t", b"a \n", b"a\t\n", b"a \r\n", b"a\nb", b"a\r\nb", b"a\rb", b"a\r", b"a\n", b"\n", b"\r\n", b"\r", b".", b".\n", b".a", b"a.", b"a\n.", b"a\n.\n", b"a\n.b", b".\r\n", b".\x00", b"..", b"_", b"a_b", b"\x00\x01\x1f", b"\x7e\x7f\x80\xff", b"x" * 75, b"x" * 76, b"x" * 77, b"x" * 200, b"=" * 30, b"x" * 74 + b"=", b"x" * 73 + b"=", b"x" * 72 + b"=", b"x" * 75 + b"\n" + b"y" * 80, b"x" * 76 + b"\n", b"x" * 75 + b" ", b"x" * 75 + b" y", b"x" * 80 + b"\r\n" + b"y" * 80, b"a\r\n" + b"x" * 100 + b"\nb \nc", b"a\n" + b"x" * 100 + b"\r\nb", b"a  \n  b\n", b"hello world\n" * 3, b"\xe9" * 40, b" " * 100, b"\t" * 100, b"a\n\nb", b"a \t \n", lcg(300, 4))
for s in CASES:
    print(s[:40], len(s))
    for kw in ({}, dict(quotetabs=True), dict(istext=False), dict(header=True), dict(quotetabs=True, istext=False, header=True), dict(quotetabs=True, header=True), dict(istext=False, header=True)):
        e = B.b2a_qp(s, **kw); print("   ", kw, e, B.a2b_qp(e, header=kw.get("header", False)) == s)
print(B.b2a_qp(b"a b", True), B.b2a_qp(b"a\nb", False, False), B.b2a_qp(b"a b", False, True, True), B.b2a_qp(data=b"a=b"), B.b2a_qp(bytearray(b"a=b")))
t(lambda: B.b2a_qp()); t(lambda: B.b2a_qp("a")); t(lambda: B.b2a_qp(b"a", 1, 1, 1, 1)); t(lambda: B.b2a_qp(b"a", foo=1)); t(lambda: B.b2a_qp(1))
