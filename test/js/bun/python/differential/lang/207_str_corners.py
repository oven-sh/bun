# str: the arguments of str(), copies, sizes, the names of types in the messages of %, ascii().
import sys

def t(label, f):
    try:
        print(label, 'ok', repr(f()))
    except Exception as e:
        print(label, type(e).__name__, e)

class S(str): pass
t('4 arguments', lambda: str(b'a', 'ascii', 'strict', 1))
t('4 arguments', lambda: S(b'a', 'ascii', 'strict', 1))
t('3 + keyword', lambda: str(b'a', 'ascii', 'strict', errors='strict'))
t('4 keywords', lambda: str(object=b'a', encoding='ascii', errors='strict', x=1))
t('unknown keyword', lambda: str(b'a', x=1))
t('twice', lambda: str(b'a', 'ascii', encoding='ascii'))
t('encoding of a str', lambda: str('a', 'ascii'))
t('errors of a str', lambda: str('a', errors='strict'))
t('encoding not a str', lambda: str(b'a', 1))
t('errors not a str', lambda: str(b'a', 'ascii', 1))
t('int with encoding', lambda: str(1, 'ascii'))
t('keywords only', lambda: str(encoding='ascii'))
t('keywords only', lambda: str(errors='strict'))
t('object keyword', lambda: str(object=1))
t('bytes', lambda: str(object=b'a', errors='strict'))

s = 'some text'
args = s.__getnewargs__()
print(args, args[0] == s, args[0] is s, type(S('x').__getnewargs__()[0]).__name__)

for text in ('', 'a', 'abc', 'a' * 100, 'abc\xe9', '€', 'ab€', '\U0001f600', 'ab\U0001f600'):
    print(ascii(text[:4]), len(text), sys.getsizeof(text), text.__sizeof__())

class C: pass
class N:
    class Inner: pass
for spec in ('%d', '%i', '%x', '%o', '%c', '%f', '%e', '%g'):
    for value in (C(), N.Inner(), 'text', None, 1j, [1], b'x'):
        t(spec + ' ' + type(value).__name__, lambda: spec % (value,))
t('%c big', lambda: '%c' % 0x110000)
t('%c negative', lambda: '%c' % -1)
t('%c str', lambda: '%c' % 'ab')
t('* not int', lambda: '%*d' % ('a', 1))
t('.* not int', lambda: '%.*f' % (C(), 1.0))
t('mapping', lambda: '%(a)s' % C())
t('not all', lambda: '%s' % (1, 2))
t('not enough', lambda: '%s %s' % (1,))
t('unsupported', lambda: '%y' % 1)
t('incomplete', lambda: '%' % ())

class R:
    def __init__(self, text): self.text = text
    def __repr__(self): return self.text
class T(str): pass
for value in (R('plain'), R(T('a subclass')), R('\xe9'), R(T('\xe9')), R('\U0001f600\n')):
    result = ascii(value)
    print(type(result).__name__, result)
t('not a str', lambda: ascii(R(1)))
