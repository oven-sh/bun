# The n format in the locales that the machine has: separators of several bytes, groups of unequal sizes, LC_NUMERIC without LC_CTYPE.
import locale, sys
from decimal import Decimal
names = "ps_AF.UTF-8 de_DE.UTF-8 fr_FR.UTF-8 en_IN.UTF-8 cs_CZ.UTF-8 hi_IN.UTF-8 ru_RU.UTF-8 en_US.UTF-8 de_CH.UTF-8 pt_BR.UTF-8 ar_SA.UTF-8 fa_IR.UTF-8 de_DE.ISO-8859-1 fr_FR.ISO-8859-1 ru_RU.KOI8-R".split()
values = ["0", "1", "-1.5", "1234567.891", "-123456789012345678901234567890.12345", "1E+10", "1E-10", "0.000001234", "NaN", "-Infinity", "12345.678E+5", "999999.5"]
specs = ["n", "10n", ",n", "020n", "<30n", "^30n", ">+30n", ".3n", ".10n", "+n", " n", "=+25n", "x>20n", "030.5n", "_n", "z.2n", "#n", "é^20n"]
for name in names:
    for category in (locale.LC_ALL, locale.LC_NUMERIC):
        locale.setlocale(locale.LC_ALL, "C")
        try:
            locale.setlocale(category, name)
        except locale.Error as e:
            print(name, category == locale.LC_ALL, "unavailable", e)
            continue
        conv = locale.localeconv()
        print(name, category == locale.LC_ALL, ascii(conv["decimal_point"]), ascii(conv["thousands_sep"]), conv["grouping"])
        for v in values:
            row = []
            for s in specs:
                try:
                    row.append(ascii(format(Decimal(v), s)))
                except Exception as e:
                    row.append("%s: %s" % (type(e).__name__, e))
            print("  ", v, row)
