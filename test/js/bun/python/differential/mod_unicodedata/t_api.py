import unicodedata as u

def attempt(f, *args, **kwargs):
    try:
        r = f(*args, **kwargs)
    except BaseException as e:
        print('%s: %s' % (type(e).__name__, e))
    else:
        print(ascii(r))

print(sorted(n for n in dir(u) if not n.startswith('_')))
print(u.__name__, type(u.unidata_version), u.unidata_version.count('.'), u.ucd_3_2_0.unidata_version)
print(u.UCD, type(u.ucd_3_2_0), u.UCD.__name__, u.UCD.__module__, u.UCD.__mro__, sorted(n for n in dir(u.ucd_3_2_0) if not n.startswith('_')))
attempt(u.UCD)
attempt(setattr, u.ucd_3_2_0, 'unidata_version', '1')
attempt(setattr, u.ucd_3_2_0, 'foo', '1')

ONE = ['category', 'bidirectional', 'combining', 'mirrored', 'east_asian_width', 'decomposition', 'block', 'grapheme_cluster_break',
       'indic_conjunct_break', 'extended_pictographic', 'isxidstart', 'isxidcontinue']
TWO = ['decimal', 'digit', 'numeric', 'name']
for db in (u, u.ucd_3_2_0):
    for name in ONE + TWO:
        f = getattr(db, name, None)
        if f is None:
            continue
        print(name, f.__name__, f.__qualname__)
        for args in [(), ('ab',), ('',), (1,), (b'a',), (None,), ('a', 'b', 'c'), ('\U0001f600',), ('\ud800',), ('\U0001f600x',)]:
            attempt(f, *args)
        attempt(f, chr='a')
    for name in TWO:
        f = getattr(db, name)
        for args in [('a', None), ('a', 5), ('5', None), ('ab', 1), (1, 1), ('a', 'x'), ('\n', ())]:
            attempt(f, *args)
        attempt(f, 'a', default=1)

class S(str): pass
print(u.category(S('a')), u.name(S('a')), u.normalize(S('NFC'), S('a')), type(u.normalize('NFC', S('a'))), type(u.normalize('NFC', S(''))), type(u.normalize('NFD', S('\xe9'))), u.lookup(S('SPACE')))

for db in (u, u.ucd_3_2_0):
    for f in (db.normalize, db.is_normalized):
        for args in [(), ('NFC',), ('NFC', 'a', 'b'), ('X', 'a'), ('X', ''), ('nfc', 'a'), ('NFC', 1), (1, 'a'), (b'NFC', 'a'), ('NFC', b'a'), ('', 'a'), ('NFC ', '\xe9'),
                     ('NFC', ''), ('NFC', 'abc'), ('NFD', '\xe9'), ('NFC', 'é'), ('NFKC', 'ﬁ'), ('NFKD', '①½'), ('NFC', '\ud800é\udc00'), ('NFD', '\U0001d15e'),
                     ('NFC', '\U0001d157\U0001d165'), ('NFC', '각'), ('NFD', '각'), ('NFC', '각'), ('NFC', '가ᆧ'), ('NFC', 'à֮̀̕b'),
                     ('NFC', '̈́'), ('NFC', 'क़'), ('NFC', 'Å'), ('NFKC', 'ẛ̣'), ('NFD', 'ẛ̣'), ('NFC', 'A' * 300 + '̊' * 3), ('NFD', '\xc5' * 300)]:
            attempt(f, *args)
        attempt(f, form='NFC', unistr='a')
s = 'abc'
print(u.normalize('NFC', s) is s, u.normalize('NFKD', s) is s)

for db in (u, u.ucd_3_2_0):
    for arg in ['SPACE', 'space', 'Space', ' SPACE', 'SPACE ', '', 'foo', 'LATIN SMALL LETTER A', 'LATIN  SMALL LETTER A', 'LATIN-SMALL LETTER A', 'a' * 256, 'a' * 257, b'SPACE', bytearray(b'SPACE'), b'\xff',
                '\xe9', '€', 'SPACE\0', 1, None, ['SPACE'], 'CJK UNIFIED IDEOGRAPH-4E00', 'CJK UNIFIED IDEOGRAPH-4e00', 'CJK UNIFIED IDEOGRAPH-04E00', 'CJK UNIFIED IDEOGRAPH-3400', 'CJK UNIFIED IDEOGRAPH-20000',
                'CJK UNIFIED IDEOGRAPH-', 'CJK UNIFIED IDEOGRAPH-FFFF', 'CJK UNIFIED IDEOGRAPH-4E0', 'CJK UNIFIED IDEOGRAPH-4E00 ', 'CJK COMPATIBILITY IDEOGRAPH-F900', 'HANGUL SYLLABLE GA', 'HANGUL SYLLABLE GAG',
                'HANGUL SYLLABLE HIH', 'HANGUL SYLLABLE', 'HANGUL SYLLABLE ', 'HANGUL SYLLABLE X', 'hangul syllable ga', 'HANGUL SYLLABLE A', 'HANGUL SYLLABLE WEONJ', 'TANGUT IDEOGRAPH-17000',
                'NULL', 'LINE FEED', 'LF', 'NBSP', 'BELL', 'ALERT', 'BEL', 'BYTE ORDER MARK', 'BOM', 'ZWNBSP', 'LATIN CAPITAL LETTER GHA', 'VS17', 'PRESENTATION FORM FOR VERTICAL RIGHT WHITE LENTICULAR BRACKET',
                'LATIN SMALL LETTER R WITH TILDE', 'KEYCAP NUMBER SIGN', 'TAMIL SYLLABLE KAA', 'latin small letter r with tilde', '<control>', '<control-000A>', 'CONTROL-000A', 'GRINNING FACE', 'EURO SIGN']:
        attempt(db.lookup, arg)
    attempt(db.lookup)
    attempt(db.lookup, 'a', 'b')
    attempt(db.lookup, name='SPACE')
try:
    u.lookup('nope')
except KeyError as e:
    print(e.args)

print(ascii("\N{LINE FEED}\N{NULL}\N{NBSP}\N{BELL}\N{ALERT}\N{latin small letter a}\N{CJK UNIFIED IDEOGRAPH-4E00}\N{HANGUL SYLLABLE GA}\N{LATIN CAPITAL LETTER GHA}"))
for source in [r'"\N{LATIN SMALL LETTER R WITH TILDE}"', r'"\N{nope}"', r'"\N{}"', r'"\N{SPACE"', r'"\N"', r'b"\N{SPACE}"', r'"\N{ SPACE}"']:
    attempt(eval, source)
attempt(b'\\N{LINE FEED}\\N{BEL}'.decode, 'unicode_escape')
attempt(b'\\N{KEYCAP NUMBER SIGN}'.decode, 'unicode_escape')
attempt('\n\x07\xe9€\U0001f600\ud800가一'.encode, 'ascii', 'namereplace')

# Grapheme clusters.
it = u.iter_graphemes('ábc\r\n\U0001f1e6\U0001f1e7\U0001f1e8')
print(type(it), type(it).__name__, type(it).__module__, iter(it) is it, [n for n in dir(it) if not n.startswith('_')])
g = next(it)
print(type(g), type(g).__name__, type(g).__module__, g, ascii(str(g)), repr(g), g.start, g.end, [n for n in dir(g) if not n.startswith('_')])
print([(x.start, x.end, ascii(str(x))) for x in it], next(it, 'end'), next(it, 'end'))
attempt(type(it))
attempt(type(g))
attempt(setattr, g, 'start', 1)
attempt(setattr, g, 'foo', 1)
attempt(len, g)
attempt(lambda: g == g, )
for args in [(), (1,), (b'a',), ('abc', 'x'), ('abc', 0, 'x'), ('abc', None), ('abc', 0, 1, 2), ('abc', 2 ** 70), ('abc', 0, 2 ** 70), ('abc', -2 ** 70), ('abc', 1.0)]:
    attempt(u.iter_graphemes, *args)
attempt(u.iter_graphemes, unistr='a')
for args in [('',), ('abc',), ('abc', 1), ('abc', 1, 2), ('abc', -1), ('abc', -2, -1), ('abc', 5), ('abc', 2, 1), ('abc', 0, 100), ('abc', -100, 100), ('abc', 3), ('abc', 0, 0), ('abc', 0, -100),
             ('á́b', 1), ('á́b', 2), ('\U0001f600‍\U0001f600a', 0), ('\U0001f600‍\U0001f600a', 1), ('\U0001f600‍\U0001f600a', 2), ('x\U0001f1e6\U0001f1e7\U0001f1e8\U0001f1e9', 2),
             ('क्क', 0), ('क्क', 1), ('क्‍क्ष',), ('각각각ᆨ',), ('\r\n\n\r',), ('؀a',), ('aः',), (S('ab'),),
             ('𐀀'.encode('utf-16', 'surrogatepass').decode('utf-16'),), ('\udc00\ud800',)]:
    attempt(lambda: [(x.start, x.end, str(x)) for x in u.iter_graphemes(*args)])
