# unicodedata is that of the version of Unicode this version of Python has, whatever ICU knows.
import unicodedata as u, hashlib, sys
print(u.unidata_version, u.ucd_3_2_0.unidata_version)

# Where something has changed since Unicode 15.1. (The g_* tests go through all characters.)
RANGES = [(0x290, 0x29F, 1), (0x880, 0x89F, 1), (0xC50, 0xCE0, 1), (0x1AC0, 0x1AFF, 1), (0x1B40, 0x1B7F, 1), (0x1C80, 0x1C8F, 1), (0x20C0, 0x20CF, 1),
          (0x2260, 0x226F, 1), (0x2380, 0x2BFF, 3), (0x2FF0, 0x31EF, 5), (0x5140, 0x514F, 1), (0xA7C0, 0xA7FF, 1), (0x105C0, 0x105FF, 1), (0x10940, 0x1095F, 1),
          (0x10D40, 0x10D8F, 1), (0x10EC0, 0x10EFF, 1), (0x11380, 0x113FF, 1), (0x116D0, 0x116EF, 1), (0x11B60, 0x11BFF, 1), (0x11DB0, 0x11DEF, 1),
          (0x11F50, 0x11F5F, 1), (0x13440, 0x14400, 37), (0x16100, 0x1613F, 1), (0x16D40, 0x16D7F, 1), (0x16EA0, 0x16EDF, 1), (0x16FF0, 0x16FFF, 1),
          (0x187F0, 0x18800, 1), (0x18CF0, 0x18D8F, 1), (0x1CC00, 0x1CEFF, 3), (0x1E5D0, 0x1E6FF, 1), (0x1F000, 0x1FBFF, 5), (0x2B730, 0x2B740, 1),
          (0x2CEA0, 0x2CEB0, 1), (0x323A0, 0x33480, 41)]
POINTS = [c for first, last, step in RANGES for c in range(first, last + 1, step)]

def digest(function):
    h = hashlib.sha256()
    for c in POINTS:
        h.update(repr(function(chr(c))).encode())
    return h.hexdigest()[:16]

for db in (u, u.ucd_3_2_0):
    for name in ("category", "bidirectional", "combining", "east_asian_width", "mirrored", "decomposition"):
        print(name, digest(getattr(db, name)))
    for name in ("decimal", "digit", "numeric", "name"):
        f = getattr(db, name)
        print(name, digest(lambda ch: f(ch, None)))
for name in ("grapheme_cluster_break", "extended_pictographic", "indic_conjunct_break", "block", "isxidstart", "isxidcontinue"):
    print(name, digest(getattr(u, name)))
for form in ("NFC", "NFD", "NFKC", "NFKD"):
    for db in (u, u.ucd_3_2_0):
        print(form, digest(lambda ch: db.normalize(form, ch)))

# Every name leads back.
wrong = 0
for c in POINTS:
    name = u.name(chr(c), None)
    if name is not None and (u.lookup(name) != chr(c) or u.lookup(name.lower()) != chr(c)):
        wrong += 1
print("names that do not lead back:", wrong)

# Characters of Unicode 16 and 17.
for ch in "࢏ࢗ꟱\U000105c9\U00010d40\U00011383\U00013460\U0001611e\U00016121\U000187f8\U00018cff\U0001ccd6\U000323b0\U00033479ʕ≭兆":
    print("%04X" % ord(ch), u.name(ch), u.category(ch), u.bidirectional(ch), u.combining(ch), u.east_asian_width(ch), u.mirrored(ch),
          repr(u.decomposition(ch)), u.decimal(ch, None), u.digit(ch, None), u.numeric(ch, None), u.block(ch), u.grapheme_cluster_break(ch))
print(ascii("\N{EGYPTIAN HIEROGLYPH-13460}\N{CJK UNIFIED IDEOGRAPH-323B0}\N{TANGUT IDEOGRAPH-187F8}\N{KHITAN SMALL SCRIPT CHARACTER-18CFF}\N{ARABIC PEPET}\N{garay capital letter a}"))
for name in ("EGYPTIAN HIEROGLYPH-1345F", "EGYPTIAN HIEROGLYPH-143FB", "EGYPTIAN HIEROGLYPH-013460", "EGYPTIAN HIEROGLYPH-", "CJK UNIFIED IDEOGRAPH-3347A",
             "CJK UNIFIED IDEOGRAPH-323BG", "ARABIC PEPE", "ARABIC PEPETS", ""):
    try:
        print(ascii(u.lookup(name)))
    except KeyError as e:
        print("KeyError", e)
print(ascii(u.ucd_3_2_0.lookup("ARABIC PEPET")), u.ucd_3_2_0.name("ࢗ", None), u.ucd_3_2_0.category("ࢗ"))

# Normalization of strings with them.
samples = ["\U000105d2̇", "a\U000105d2̇́b", "\U000105c9̣", "\U000105d2̣̇", "\U00011382\U000113c9", "\U000113c2\U000113c2\U000113c2",
           "\U00016121\U0001611f", "\U0001611e\U0001611e\U0001611f", "꟱x́", "é\U0001ccd6", "̣ࢗ́", "q̣ࢗ̇́",
           "각\U000105c9가", "\U00010d69\U00010d6á", "é\U00013460Å"]
for s in samples:
    print(ascii(s), *(ascii(u.normalize(f, s)) for f in ("NFC", "NFD", "NFKC", "NFKD")), *(u.is_normalized(f, s) for f in ("NFC", "NFD", "NFKC", "NFKD")))
print([ascii(str(g)) for g in u.iter_graphemes("aࢗ\U000113c2\U000113c9\U00016121\U0001611fz")])

# What hangs on the version.
import stringprep, encodings.idna
print("bücher.example".encode("idna"), b"xn--bcher-kva.example".decode("idna"), "straße".encode("idna"))
print(encodings.idna.nameprep("ªBßẞ"), stringprep.in_table_a1("ȡ"), stringprep.in_table_b1("­"), stringprep.map_table_b2("ẞ"))
