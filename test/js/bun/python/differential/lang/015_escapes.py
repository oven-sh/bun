# Escape sequences in literals, spelled out in the source.
print(ascii("\u00e9 \u20ac \uffff \u0041 \u2028 \ufeff \u200b \u0000"), len("\u00e9\u20ac"))
print(ascii("\U0001F600\U00000041\U0010FFFF"), len("\U0001F600"))
print(ascii("\x41\x00\xff\x7f\x80"), ascii("\101\0\7\77\377\1011\08"), ascii("\a\b\f\n\r\t\v\\\'\""))
print(ascii("\ud800"), ascii("\udfff"), ascii("\ud83dx\ude00"), len("\ud83dx\ude00"))
print(ascii("\N{BULLET}\N{EURO SIGN}\N{PILE OF POO}"))
print(ascii(r"\u00e9\x41\n\N{BULLET}"), len(r"\u00e9"), ascii(rb"\x41\n"), ascii(b"\x41\n\0\101\\\'\"\a"), b"\u00e9" == b"\\u00e9", len(b"\N{BULLET}"))
print(ascii(f"\u00e9{1}\x41{'\u00e9'}\N{BULLET}"), ascii(rf"\u00e9{1}\n"), ascii(fr"\{1}"), ascii(f"\{{1}}") if False else "")
print(ascii("a\
b"), ascii('''a\
b'''), ascii("""a
b"""), ascii(r"a\
b"), ascii("a\\\
b"))
print(ascii("'"), ascii('"'), ascii("'\""), ascii('\''), ascii("\""), ascii("""'"'"""), ascii('''"'"'''), ascii(""""a" """), ascii('''\''''), ascii("""a\""""))
import sys
def w(src):
    # Invalid escapes are warnings; the text is kept.
    try:
        print(ascii(eval(src)))
    except SyntaxError as e:
        print("SyntaxError:", e.msg)
for src in (r'"\x"', r'"\x1"', r'"\xg"', r'"\u"', r'"\u12"', r'"\U"', r'"\U0001F60"', r'"\U00110000"', r'"\N"', r'"\N{"', r'"\N{}"', r'"\N{no such}"', r'b"\x"', r'b"\x1"', r'"\777"' , r'"\400"', r'b"\377"', '"a', "'a", '"""a', '"a\nb"', "'''a''", 'b"\\', '"\\'):
    w(src)
print(ascii(eval(r'"\u00e9"')), ascii(eval(r'"\\\u00e9"')), ascii(eval(r'r"\u00e9"')), ascii(eval(r'b"\u00e9"')), ascii(eval('"\\u00e9"')), ascii(eval('"\\x41\\101\\n"')))
print(ascii(str(b"\u00e9", "unicode_escape")), ascii(b"\\x41\\n\\101".decode("unicode_escape")), ascii("é\n\x00€😀".encode("unicode_escape")), ascii("é\n€😀".encode("raw_unicode_escape")), ascii(b"\u20ac\\n".decode("raw_unicode_escape")))
