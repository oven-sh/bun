def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

s = "hello world"
print(len(s), s[0], s[-1], s[4], s[-11], s[0:5], s[6:], s[:5], s[:], s[::2], s[::-1], s[1:8:3], s[-5:], s[:-6], s[-5:-2], s[8:2:-1], s[100:], s[:100], s[5:2], s[::-2], s[-100:3], s[3:-100:-1])
t(lambda: s[11])
t(lambda: s[-12])
t(lambda: s["a"])
t(lambda: s[1.0])
t(lambda: s[None])
t(lambda: s[::0])
t(lambda: s[1:"a"])
t(lambda: s[1, 2])
def assign(): s[0] = "H"
t(assign)
def delete(): del s[0]
t(delete)
print("a" + "b", "ab" * 3, 3 * "ab", "ab" * 0, "ab" * -1, "" * 5, "a" + "", "" + "", "ab" * True)
t(lambda: "a" + 1)
t(lambda: 1 + "a")
t(lambda: "a" + b"b")
t(lambda: "a" * "b")
t(lambda: "a" * 1.5)
t(lambda: "a" - "b")
t(lambda: "a" / 2)
t(lambda: -"a")
t(lambda: "a" + None)
t(lambda: "a" + ["b"])
print("a" in s, "hello" in s, "xyz" in s, "" in s, "o w" in s, "a" not in s, "" in "")
print(s == "hello world", s != "x", "a" < "b", "a" <= "a", "b" > "a", "abc" >= "abd", "a" == "A", "" == "", "a" * 3 == "aaa")
print(str(), str(""), str("a"), str(1), str(1.5), str(None), str([1]), str(b"a"), str(b"abc", "utf-8"), str(b"abc", encoding="ascii"), str(b"\xff", "utf-8", "replace"), str(b"\xc3\xa9", "utf-8"), str(object=5), str(bytearray(b"x"), "ascii"), str(encoding="utf-8"), str(errors="strict"))
t(lambda: str(1, "utf-8"))
t(lambda: str("a", "utf-8"))
t(lambda: str(b"\xff", "utf-8"))
t(lambda: str(b"a", "nope"))
t(lambda: str(1, 2, 3, 4))
t(lambda: str(b"a", 1))
for c in "abc":
    print(c, end=".")
print()
print(list("abc"), tuple("ab"), sorted("hello"), sorted(set("hello")), list(reversed("abc")), list(enumerate("ab")), "".join(reversed("abc")), max("hello"), min("hello"), list(zip("ab", "cd")))
print(ord("a"), ord("A"), ord("0"), ord(" "), ord("\n"), ord("é"), ord("€"), ord("😀"), ord("\x00"), ord("￿"), ord("\U0010ffff"), chr(97), chr(8364), chr(128512), chr(0), chr(0x10ffff), repr(chr(0xd800)), repr(chr(127)), repr(chr(160)), repr(chr(173)))
t(lambda: ord(""))
t(lambda: ord("ab"))
t(lambda: ord(1))
t(lambda: ord(b"ab"))
t(lambda: chr(-1))
t(lambda: chr(0x110000))
t(lambda: chr("a"))
t(lambda: chr(10 ** 30))
print(ord(b"a"), ord(bytearray(b"b")))
print(hash("") == hash(""), hash("a") == hash("a"), hash("a") != hash("b"), hash("ab") == hash("a" + "b"), isinstance(hash("abc"), int))
print(repr(""), repr("a'b"), repr('a"b'), repr("a'b\"c"), repr("\\"), repr("\n"), repr("\t"), repr("\r"), repr("\x00"), repr("\x01"), repr("\x1f"), repr("\x7f"), repr("\x80"), repr("\xa0"), repr("\xad"), repr("\xff"), repr("Ā"), repr(" "), repr("　"), repr("\ud800"), repr(""), repr("﻿"), repr("\U0001f600"), repr("\U000e0001"), repr("\U0010ffff"))
print(ascii("a"), ascii("é"), ascii("€"), ascii("😀"), ascii("a\nb"), ascii("\x7f\x80"), ascii(["é"]), ascii({"é": "ü"}), ascii("'"), ascii('"'), ascii("\ud800"))
print("\a\b\f\v".encode(), "\0\01\012\0123".encode(), "\x41A\U00000041\N{DIGIT ONE}\N{greek small letter alpha}", "\
continued", "a\
b")
print('\'', "\"", '\\', "\\n", r"\n", r"\\", r"\'", len(r"\'"), r'\"', rb"\x00", len(rb"\x00"))
print("abc".__len__(), "abc".__getitem__(1), "abc".__contains__("b"), "abc".__add__("d"), "abc".__mul__(2), "abc".__rmul__(2), "abc".__eq__("abc"), "abc".__eq__(1), "abc".__lt__("abd"), "abc".__lt__(1), "abc".__ne__("x"), "abc".__str__(), "abc".__repr__(), "abc".__hash__() == hash("abc"), "abc".__mod__(()), "a%sc".__mod__("b"), "abc".__rmod__("%s"), "abc".__getnewargs__(), "abc".__format__(">5"), "abc".__sizeof__() > 0)
print(type("a"), type("a") is str, isinstance("a", str), str.__mro__, str.__name__, "a".__class__, type("a" + "b"), type("a" * 2), type("abc"[0]), type("abc"[0:1]))
it = iter("ab")
print(next(it), next(it), next(it, "end"), type(it).__name__, it.__length_hint__())
big = "x" * 100000
print(len(big), len(big + big), big[99999], (big * 3)[250000], len(big[::7]), big.count("x"), big == "x" * 100000, big < big + "a")
parts = []
acc = ""
for i in range(200):
    acc += str(i)
print(len(acc), acc[:20], acc[-10:], acc[100:110])
print("a" "b" 'c' """d""" r"\e" f"{1}", ("x"
  "y"), "implicit" " " "concat")
print("%s" % s[0].upper() + s[1:], s.upper()[::-1].lower(), s[s.index("w"):], s[:s.find(" ")])
print("abc" is "abc" or True, "a" == 'a', "a\x00b" == "a\x00b", len("a\x00b"), "a\x00b" < "a\x00c", "a\x00b".split("\x00"))
