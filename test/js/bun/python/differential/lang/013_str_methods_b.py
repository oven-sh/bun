def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

print(repr("a".center(5)), repr("a".center(4)), repr("ab".center(5)), repr("ab".center(4)), "a".center(5, "*"), "abc".center(2), "a".center(0), "a".center(-1), repr("".center(3)), "a".center(6, "é"), "ab".center(7, "😀"), repr("abc".center(6)), repr("abc".center(7)), repr("abcd".center(7)))
print(repr("a".ljust(3)), repr("a".rjust(3)), "a".ljust(3, "-"), "a".rjust(3, "-"), "abc".ljust(2), "abc".rjust(2), "a".ljust(0), "é".rjust(3, "ü"), "😀".ljust(3, "x"))
t(lambda: "a".center(5, "ab"))
t(lambda: "a".center(5, ""))
t(lambda: "a".ljust("5"))
t(lambda: "a".rjust(5, 1))
t(lambda: "a".center())
t(lambda: "a".center(1.5))
print("5".zfill(3), "-5".zfill(4), "+5".zfill(4), "abc".zfill(5), "".zfill(2), "-".zfill(3), "123".zfill(2), "--5".zfill(5), "5".zfill(0), "5".zfill(-1), "é".zfill(3), " 5".zfill(4))
t(lambda: "5".zfill("3"))
print("a\tb".expandtabs(), "a\tb".expandtabs(4), "ab\tc".expandtabs(4), "abcd\te".expandtabs(4), "a\tb\tc".expandtabs(2), "\t".expandtabs(), "a\nb\tc".expandtabs(4), "a\r\tb".expandtabs(4), "a\tb".expandtabs(0), "a\tb".expandtabs(-1), "a\tb".expandtabs(1), "a\tb".expandtabs(tabsize=3), "é\tb".expandtabs(4), "".expandtabs())
tests = ["", "a", "A", "1", " ", "a1", "A1", "aA", "a b", "Ab", "Ab Cd", "AB", "ab", "1a", "_", "a_1", "é", "É", "ß", "١", "²", "½", "Ⅷ", "一", "\n", "\t ", "\x00", "\x7f", "\xa0", " ", "😀", "a😀", "ǅ", "ǅa", "Aǅ", "ª", "ʰ", "3.5", "-1", "１", "a.b", "for", "None", "a b\n", "\ud800", "̀", "à", "·", "a·", "℘", "℘a"]
for name in ("isalpha", "isdigit", "isdecimal", "isnumeric", "isalnum", "isspace", "isupper", "islower", "istitle", "isidentifier", "isprintable", "isascii"):
    print(name, "".join("1" if getattr(s, name)() else "0" for s in tests))
print("Hello World".istitle(), "Hello world".istitle(), "HELLO".istitle(), "A".istitle(), "A B".istitle(), "Ab'Cd".istitle(), "Ab'cd".istitle(), "1A".istitle(), "1a".istitle(), "A1a".istitle(), "A1A".istitle())
print(str.maketrans("ab", "xy"), str.maketrans("ab", "xy", "c"), str.maketrans({"a": "x", "b": None, 99: "z"}), str.maketrans("", ""), str.maketrans({}), str.maketrans("é", "e"), str.maketrans({"a": 65}))
print("abcabc".translate(str.maketrans("ab", "xy")), "abcabc".translate(str.maketrans("ab", "xy", "c")), "abc".translate({97: "XX", 98: None, 99: 100}), "abc".translate({}), "abc".translate({97: ""}), "abc".translate({97: "😀"}), "a😀".translate({0x1f600: "b"}), "abc".translate({97: 0x1f600}), "abc".translate(str.maketrans({"a": "1", "c": "3"})))
class M:
    def __getitem__(self, k):
        if k == 97: return "A"
        if k == 98: raise LookupError
        if k == 99: return None
        raise KeyError(k)
print("abcd".translate(M()), "abc".translate(["x"] * 100))
t(lambda: str.maketrans("a", "xy"))
t(lambda: str.maketrans("a"))
t(lambda: str.maketrans({"ab": "x"}))
t(lambda: str.maketrans({1.5: "x"}))
t(lambda: str.maketrans(1, 2))
t(lambda: str.maketrans("a", "b", 1))
t(lambda: "a".translate({97: 1.5}))
t(lambda: "a".translate({97: -1}))
t(lambda: "a".translate({97: 0x110000}))
t(lambda: "a".translate(None))
t(lambda: "a".translate())
print("abc".encode(), "é".encode(), "é".encode("utf-8"), "é".encode("latin-1"), "€".encode("utf-8"), "😀".encode("utf-8"), "a".encode("ascii"), "é".encode("ascii", "ignore"), "é".encode("ascii", "replace"), "é".encode("ascii", "backslashreplace"), "é".encode("ascii", "xmlcharrefreplace"), "é".encode("ascii", "namereplace"), "😀".encode("ascii", "backslashreplace"), "€".encode("latin-1", "replace"), "ab".encode("utf-16-le"), "ab".encode("utf-16-be"), "a".encode("utf-16") in (b"\xff\xfea\x00", b"\xfe\xff\x00a"), "😀".encode("utf-16-le"), "a".encode("utf-32-le"), "😀".encode("utf-32-be"), "".encode(), "a".encode(encoding="utf-8", errors="strict"), "\ud800".encode("utf-8", "surrogatepass"), "\udc80".encode("utf-8", "surrogateescape"), "a".encode("UTF8"), "a".encode("utf_8"), "a".encode("Latin1"), "a".encode("iso-8859-1"), "a".encode("US-ASCII"))
t(lambda: "é".encode("ascii"))
t(lambda: "aé€".encode("ascii"))
t(lambda: "€".encode("latin-1"))
t(lambda: "\ud800".encode("utf-8"))
t(lambda: "a\ud800b".encode())
t(lambda: "\ud800".encode("utf-16"))
t(lambda: "a".encode("nope"))
t(lambda: "é".encode("ascii", "nope"))
t(lambda: "a".encode(1))
t(lambda: "a".encode("ascii", 1))
try:
    "abé€".encode("ascii")
except UnicodeEncodeError as e:
    print(e.encoding, repr(e.object), e.start, e.end, e.reason, e.args)
print("{}".format(1), "a".format(), "{0}{1}{0}".format("a", "b"), "{x}".format(x=1), "{x}".format_map({"x": 2}))
class D(dict):
    def __missing__(self, k): return "<" + k + ">"
print("{a}{b}".format_map(D(a=1)))
t(lambda: "{a}".format_map({}))
t(lambda: "{a}".format_map(1))
print(sorted(n for n in dir(str) if not n.startswith("_")))
print(str.upper("abc"), str.join(",", ["a", "b"]), str.split("a b"), list(map(str.upper, ["a", "b"])), str.__len__("abc"), sorted(["b", "A", "c"], key=str.lower))
t(lambda: str.upper(1))
t(lambda: str.upper())
t(lambda: str.join(1, []))
t(lambda: "a".upper(1))
t(lambda: "a".nope())
t(lambda: "a".upper.nope)
def setattr_str(): "a".x = 1
t(setattr_str)
print("a".upper.__name__, "a".upper.__self__, str.upper.__name__, str.upper.__qualname__, "a".upper.__qualname__, type("a".upper).__name__, type(str.upper).__name__, str.upper.__objclass__)
print("abc".isalpha.__doc__ is not None or True, "Hello"[1:].upper().lower().title().swapcase().center(9, "*").strip("*").replace("E", "3"))
