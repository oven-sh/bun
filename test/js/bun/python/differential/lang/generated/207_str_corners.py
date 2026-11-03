# str: the arguments of str(), copies, sizes, the names of types in the messages of %, ascii().
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')

try:
    def t(label, f):
        try:
            print(label, 'ok', repr(f()))
        except Exception as e:
            print(label, type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(label, f):')

try:
    class S(str): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S(str): pass')
try: t('4 arguments', lambda: str(b'a', 'ascii', 'strict', 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('4 arguments', lambda: str(b'a', 'ascii', 'strict', 1))")
try: t('4 arguments', lambda: S(b'a', 'ascii', 'strict', 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('4 arguments', lambda: S(b'a', 'ascii', 'strict', 1))")
try: t('3 + keyword', lambda: str(b'a', 'ascii', 'strict', errors='strict'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('3 + keyword', lambda: str(b'a', 'ascii', 'strict', errors='strict'))")
try: t('4 keywords', lambda: str(object=b'a', encoding='ascii', errors='strict', x=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('4 keywords', lambda: str(object=b'a', encoding='ascii', errors='st...")
try: t('unknown keyword', lambda: str(b'a', x=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('unknown keyword', lambda: str(b'a', x=1))")
try: t('twice', lambda: str(b'a', 'ascii', encoding='ascii'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('twice', lambda: str(b'a', 'ascii', encoding='ascii'))")
try: t('encoding of a str', lambda: str('a', 'ascii'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('encoding of a str', lambda: str('a', 'ascii'))")
try: t('errors of a str', lambda: str('a', errors='strict'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('errors of a str', lambda: str('a', errors='strict'))")
try: t('encoding not a str', lambda: str(b'a', 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('encoding not a str', lambda: str(b'a', 1))")
try: t('errors not a str', lambda: str(b'a', 'ascii', 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('errors not a str', lambda: str(b'a', 'ascii', 1))")
try: t('int with encoding', lambda: str(1, 'ascii'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('int with encoding', lambda: str(1, 'ascii'))")
try: t('keywords only', lambda: str(encoding='ascii'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('keywords only', lambda: str(encoding='ascii'))")
try: t('keywords only', lambda: str(errors='strict'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('keywords only', lambda: str(errors='strict'))")
try: t('object keyword', lambda: str(object=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('object keyword', lambda: str(object=1))")
try: t('bytes', lambda: str(object=b'a', errors='strict'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('bytes', lambda: str(object=b'a', errors='strict'))")

try: s = 'some text'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: s = 'some text'")
try: args = s.__getnewargs__()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: args = s.__getnewargs__()')
try: print('args =>', args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: args')
try: print('args[0] == s =>', args[0] == s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: args[0] == s')
try: print('args[0] is s =>', args[0] is s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: args[0] is s')
try: print("type(S('x').__getnewargs__()[0]).__name__ =>", type(S('x').__getnewargs__()[0]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: type(S('x').__getnewargs__()[0]).__name__")

try:
    for text in ('', 'a', 'abc', 'a' * 100, 'abc\xe9', '€', 'ab€', '\U0001f600', 'ab\U0001f600'):
        try: print('ascii(text[:4]) [' + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + '] =>', ascii(text[:4]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ascii(text[:4])')
        try: print('len(text) [' + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + '] =>', len(text))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(text)')
        try: print('sys.getsizeof(text) [' + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + '] =>', sys.getsizeof(text))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.getsizeof(text)')
        try: print('text.__sizeof__() [' + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + '] =>', text.__sizeof__())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: text.__sizeof__()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for text in ('', 'a', 'abc', 'a' * 100, 'abc\\xe9', '€', 'ab€', '\\U000...")

try:
    class C: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C: pass')
try:
    class N:
        class Inner: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class N:')
try:
    for spec in ('%d', '%i', '%x', '%o', '%c', '%f', '%e', '%g'):
        for value in (C(), N.Inner(), 'text', None, 1j, [1], b'x'):
            try: t(spec + ' ' + type(value).__name__, lambda: spec % (value,))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t(spec + ' ' + type(value).__name__, lambda: spec % (value,))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for spec in ('%d', '%i', '%x', '%o', '%c', '%f', '%e', '%g'):")
try: t('%c big', lambda: '%c' % 0x110000)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('%c big', lambda: '%c' % 0x110000)")
try: t('%c negative', lambda: '%c' % -1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('%c negative', lambda: '%c' % -1)")
try: t('%c str', lambda: '%c' % 'ab')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('%c str', lambda: '%c' % 'ab')")
try: t('* not int', lambda: '%*d' % ('a', 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('* not int', lambda: '%*d' % ('a', 1))")
try: t('.* not int', lambda: '%.*f' % (C(), 1.0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('.* not int', lambda: '%.*f' % (C(), 1.0))")
try: t('mapping', lambda: '%(a)s' % C())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('mapping', lambda: '%(a)s' % C())")
try: t('not all', lambda: '%s' % (1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('not all', lambda: '%s' % (1, 2))")
try: t('not enough', lambda: '%s %s' % (1,))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('not enough', lambda: '%s %s' % (1,))")
try: t('unsupported', lambda: '%y' % 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('unsupported', lambda: '%y' % 1)")
try: t('incomplete', lambda: '%' % ())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('incomplete', lambda: '%' % ())")

try:
    class R:
        def __init__(self, text): self.text = text
        def __repr__(self): return self.text
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R:')
try:
    class T(str): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class T(str): pass')
try:
    for value in (R('plain'), R(T('a subclass')), R('\xe9'), R(T('\xe9')), R('\U0001f600\n')):
        try: result = ascii(value)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: result = ascii(value)')
        try: print('type(result).__name__ [' + 'value=' + (repr(value) if type(value) in (str, int, float, bytes, bool, type(None)) or (type(value) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in value)) else value.__name__ if type(value) is type else type(value).__name__) + '] =>', type(result).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(result).__name__')
        try: print('result [' + 'value=' + (repr(value) if type(value) in (str, int, float, bytes, bool, type(None)) or (type(value) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in value)) else value.__name__ if type(value) is type else type(value).__name__) + '] =>', result)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: result')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for value in (R('plain'), R(T('a subclass')), R('\\xe9'), R(T('\\xe9'))...")
try: t('not a str', lambda: ascii(R(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('not a str', lambda: ascii(R(1)))")
