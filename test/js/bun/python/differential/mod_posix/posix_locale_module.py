# Lib/locale.py on top of the module _locale.
import locale

def show(function, *args, **kwargs):
    try:
        result = function(*args, **kwargs)
    except BaseException as e:
        print(type(e).__name__, e)
    else:
        print(repr(result))

print(locale.Error.__module__, locale.Error.__name__, locale.LC_ALL, locale.CHAR_MAX)
show(locale.getlocale)
show(locale.getlocale, locale.LC_NUMERIC)
show(locale.getencoding)
show(locale.getpreferredencoding)
show(locale.getpreferredencoding, False)
show(locale.setlocale, locale.LC_ALL, 'C')
show(locale.getlocale)
show(locale.setlocale, locale.LC_ALL, ('C', 'UTF-8'))
show(locale.getlocale)
show(locale.setlocale, locale.LC_ALL, 'C.UTF-8')
show(locale.setlocale, locale.LC_ALL, 'no_SUCH')
show(locale.setlocale, locale.LC_ALL, ('no', 'such'))
show(locale.setlocale, locale.LC_ALL)
show(locale.localeconv)
show(locale.format_string, '%d', 1234567, grouping=True)
show(locale.format_string, '%.2f and %s', (1234.5, 'x'))
show(locale.str, 1.5)
show(locale.atof, '1.5')
show(locale.atoi, '15')
show(locale.delocalize, '1,234.5')
show(locale.localize, '1234.5', grouping=True)
show(locale.currency, 1234.5)
# Only the sign means anything: how far from 0 the C library's answer is depends on where the strings are in memory.
print(locale.strcoll('a', 'b') < 0, locale.strcoll('b', 'a') > 0, locale.strcoll('a', 'a'))
show(locale.strxfrm, 'abc')
print(sorted(['b', 'a', 'C', 'B'], key=locale.strxfrm))
import functools
print(sorted(['b', 'a', 'C', 'B'], key=functools.cmp_to_key(locale.strcoll)))
show(locale.normalize, 'en_US')
show(locale.normalize, 'de_DE@euro')
show(locale.normalize, 'C')
show(locale.nl_langinfo, locale.CODESET)
show(locale.nl_langinfo, locale.DAY_1)
show(locale.gettext, 'x')
show(locale.textdomain, None)
