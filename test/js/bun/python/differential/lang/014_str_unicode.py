def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

# Characters outside the BMP count as one.
s = "a😀b𝒳c"
print(len(s), s[0], s[1], s[2], s[3], s[4], s[-1], s[-2], s[-4], s[1:2], s[1:4], s[::-1], s[::2], s[1::2], s[3:], s[:2], s[-2:], s[4:0:-2], list(s), [ord(c) for c in s], [len(c) for c in s])
t(lambda: s[5])
t(lambda: s[-6])
print(s.index("b"), s.index("𝒳"), s.find("c"), s.rfind("😀"), s.count("😀"), s.find("😀", 2), s.index("c", 3), s.rindex("a"), s.find("b", 2, 3), s.find("b", 3))
print(s.upper(), s.replace("😀", "!"), s.split("😀"), s.partition("𝒳"), s.center(9, "*"), s.ljust(7, "."), s.rjust(7, "😀"), s.zfill(7), s.startswith("a😀"), s.endswith("𝒳c"), s.startswith("😀", 1), s.strip("ac"), s.strip("a😀"), "😀" in s, "😀b" in s, "\ud83d" in s, s.isalpha(), s.isprintable(), s.isascii(), s.title(), s.swapcase())
print(s * 2, len(s * 2), s + s == s * 2, (s * 2)[5], (s * 2)[6], s == "a\U0001F600b\U0001D4B3c", s < "a😁", s > "a￿", "😀" > "￿", "\U00010000" > "￿", "￿" < "\U00010000", sorted(["\U00010000", "￿", "a", "", "😀"]), max("a￿\U00010000"), min("😀￿"))
print(repr(s), ascii(s), str(s), "%s|%r|%a" % (s, s, s), "{}|{!r}|{!a}".format(s, s, s), f"{s}|{s!r}|{s!a}|{s:>7}|{s:*^9}|{s:.2}|{s:.3}", "%.2s|%7s|%-7s|" % (s, s, s), format(s, "<8") + "|")
print(s.encode("utf-8"), s.encode("utf-16-le"), s.encode("utf-32-le")[:12], s.encode("ascii", "replace"), s.encode("ascii", "xmlcharrefreplace"), s.encode("ascii", "backslashreplace"), s.encode("utf-8").decode("utf-8") == s, len(s.encode("utf-8")), s.encode("utf-16-le").decode("utf-16-le") == s)
try:
    s.encode("ascii")
except UnicodeEncodeError as e:
    print(e.start, e.end, e.reason, e)
try:
    "ab😀😀c".encode("latin-1")
except UnicodeEncodeError as e:
    print(e.start, e.end, e)
it = iter(s)
print([next(it) for _ in range(5)], next(it, None), list(reversed(s)), list(enumerate(s))[1], dict.fromkeys(s), sorted(set(s)) == sorted(s), "".join(sorted(s)), tuple(s)[3], [c for c in s if ord(c) > 0xffff])
print(s.translate({0x1F600: "X", ord("a"): "😁"}), str.maketrans("😀", "x"), s.expandtabs(), s.splitlines(), s.casefold(), s.capitalize(), "😀".join("ab"), "😀".isidentifier(), "𝒳".isidentifier(), "𝒳".isalpha(), "𝟙".isdigit(), "𝟙".isdecimal(), int("𝟙𝟚"), float("𝟙.𝟝"), "𝒳".upper(), "𐐨".upper(), "𐐀".lower(), "𐐨".upper() == "𐐀", "𐐨x".title(), "𐐨".isupper(), "𐐨".islower())
# Lone surrogates are characters of their own.
l = "\ud83d"; h = "\ude00"
print(len(l), len(h), len(l + "a"), repr(l), repr(h), repr(l + "x" + h), ord(l), ord(h), l == "\ud83d", l < h, l.isprintable(), repr("a\udc80b"), len("a\udc80b"), "a\udc80b"[1] == "\udc80", l.encode("utf-8", "surrogatepass"), repr(b"\xed\xa0\xbd".decode("utf-8", "surrogatepass")), repr(b"\x80".decode("utf-8", "surrogateescape")))
# Combining characters, widths and so on are not interpreted.
e1 = "é"; e2 = "é"
print(len(e1), len(e2), e1 == e2, e2[0], repr(e2[1]), e2.upper() == "É", e2[::-1] == "́e", "ｆｕｌｌ".upper(), len("ｆｕｌｌ"), "ｆｕｌｌ".center(6, "*"), len("👨‍👩‍👧"), list("🇫🇷"), len("é".encode()), len(e2.encode()))
# Case mappings that change the length.
for c in ("ß", "ﬁ", "ŉ", "ǰ", "ΐ", "İ", "ﬃ", "և", "ẞ", "ᾳ", "ᾼ", "ǅ", "ǆ", "Ǆ"):
    print(c, c.upper(), c.lower(), c.title(), c.capitalize(), c.casefold(), c.swapcase(), len(c.upper()), len(c.lower()), end=" | ")
print()
print("ὈΔΥΣΣΕΎΣ".lower(), "ΣΑΣ".lower(), "Σ".lower(), "ΑΣ1".lower(), "ΑΣ'".lower(), "Α'Σ".lower(), "Α Σ".lower(), "ΑΣΑ".lower(), "ς".upper(), "σ".upper())
print("straße".upper(), "STRASSE".lower(), "straße".casefold() == "STRASSE".casefold(), "Ǆ".title(), "ǆungla".title(), "ĳ".upper(), "ÿ".upper(), "µ".upper(), "ı".upper(), "ſ".upper(), "K".lower(), "Å".lower(), "Ω".lower())
# Whitespace, digits, numerics.
ws = [c for c in map(chr, range(0x3100)) if c.isspace()]
print([hex(ord(c)) for c in ws])
print([hex(ord(c)) for c in map(chr, range(0x3100)) if len(("a" + c + "b").split()) == 2] == [hex(ord(c)) for c in ws], [hex(ord(c)) for c in map(chr, range(0x3100)) if len(("a" + c + "b").splitlines()) == 2])
print(sum(1 for c in map(chr, range(0x2500)) if c.isdecimal()), sum(1 for c in map(chr, range(0x2500)) if c.isdigit()), sum(1 for c in map(chr, range(0x2500)) if c.isnumeric()))
print(sum(1 for c in map(chr, range(0x2500)) if c.isalpha()), sum(1 for c in map(chr, range(0x2500)) if c.isupper()), sum(1 for c in map(chr, range(0x2500)) if c.islower()), sum(1 for c in map(chr, range(0x2500)) if c.isprintable()), sum(1 for c in map(chr, range(0x2500)) if c.isidentifier()), sum(1 for c in map(chr, range(0x2500)) if c.isspace()), sum(1 for c in map(chr, range(0x2500)) if c.istitle()))
print(sum(ord(c.upper()[0]) for c in map(chr, range(0x2500)) if not 0xd800 <= ord(c) < 0xe000), sum(ord(c.lower()[0]) for c in map(chr, range(0x2500)) if not 0xd800 <= ord(c) < 0xe000), sum(len(c.casefold()) for c in map(chr, range(0x2500))), sum(len(repr(c)) for c in map(chr, range(0x2500))))
# Identifiers may be non-ASCII, and are normalised (NFKC).
été = 1; 変数 = 2; ﬁ = 3; 𝒳 = 4
print(été, 変数, fi, X, "ﬁ" in globals(), "fi" in globals(), "𝒳" in globals())
class Ünï:
    ñ = 5
print(Ünï.ñ, Ünï.__name__, getattr(Ünï, "ñ"), Ünï().ñ)
def ƒ(µ): return µ
print(ƒ(µ=1), ƒ.__name__, ƒ.__code__.co_varnames)
print("\N{SNOWMAN}", "\N{GRINNING FACE}", "\N{LATIN SMALL LETTER E WITH ACUTE}", "\N{HANGUL SYLLABLE GAG}", "\N{CJK UNIFIED IDEOGRAPH-4E00}", "\N{greek capital letter omega}", "\N{LINE FEED}" == "\n", "\N{NBSP}" == "\xa0")
for src in (r'"\N{NOPE}"', r'"\N{}"', r'"\N"', r'"\x4"', r'"\u123"', r'"\U0011ffff"', r'"\U1234567"', r'b"\xg0"', 'b"é"'):
    try:
        print(repr(eval(src)))
    except SyntaxError as e:
        print("SyntaxError:", e.msg)
