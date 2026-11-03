# Error handlers that are registered: what they are given, and what they may and may not return.
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

answer = None
def handler(e):
    print('   ', type(e).__name__, e.encoding, repr(e.object), e.start, e.end, e.reason)
    if isinstance(answer, BaseException):
        raise answer
    return answer(e) if callable(answer) else answer
codecs.register_error('test.handler', handler)

class I(int): pass
class S(str): pass
class B(bytes): pass
class T(tuple): pass
class Index:
    def __index__(self): return 1
    def __repr__(self): return 'Index()'

answers = [None, 1, 'x', (), ('x',), ('x', 1, 2), ['x', 1], ('x', 'y'), ('x', 1.0), ('x', None), (1, 1), (None, 1), ('x', Index()), (bytearray(b'x'), 1), 
           ('x', 0), ('x', 1), ('x', 2), ('x', 3), ('x', 4), ('x', 5), ('x', -1), ('x', -2), ('x', -3), ('x', -4), ('x', -5), ('x', 1 << 70), ('x', -(1 << 70)), ('x', (1 << 63) - 1), ('x', -(1 << 63)),
           ('x', True), ('x', I(2)), (S('x'), 2), T(('x', 2)), ('', 2), ('\u3042', 2), ('\xff', 2), ('a\xffb', 2), ('\U0001F600', 2), ('\udc80', 2), ('xyz' * 5, 2),
           (b'x', 2), (b'', 2), (b'\xff\xfe', 2), (B(b'x'), 2), KeyError('k'), UnicodeError('u'), StopIteration(), SystemExit(3)]
for name in ('shift_jis', 'euc_kr', 'gb18030', 'big5hkscs', 'iso2022_jp', 'hz', 'euc_jis_2004'):
    info = codecs.lookup(name)
    for answer in answers:
        if isinstance(answer, tuple) and len(answer) == 2 and isinstance(answer[0], str) and isinstance(answer[1], int) and answer[1] in (0, 1, -3, -4):
            # These go back to what was wrong, for ever.
            continue
        print(name, repr(answer))
        print('  ', outcome(info.encode, 'a\ud800bc', 'test.handler'))
        print('  ', outcome(info.decode, b'a\xffbc', 'test.handler'))

# Going back, a limited number of times.
for name in ('shift_jis', 'iso2022_jp', 'hz'):
    info = codecs.lookup(name)
    left = 3
    def answer(e):
        global left
        left -= 1
        return ('<%d>' % left, e.start if left else e.end)
    print(name, outcome(info.encode, 'a\ud800b', 'test.handler'))
    left = 3
    print(name, outcome(info.decode, b'a\xffb', 'test.handler'))
    left = 3
    def answer(e):
        global left
        left -= 1
        return ('<%d>' % left, 0 if left else e.end)
    print(name, outcome(info.encode, '\u3042\ud800b', 'test.handler'))
    left = 3
    print(name, outcome(info.decode, info.encode('\u3042')[0] + b'\xffb', 'test.handler'))

# The same exception object serves for all errors of a call. What the handler does to it makes no difference to the codec.
kept = []
def answer(e):
    kept.append(e)
    if isinstance(e, UnicodeEncodeError):
        e.object = 'zzzzzzzzzzzz'
    else:
        e.object = b'zzzzzzzzzzzz'
    e.start = 5
    e.end = 7
    e.reason = 'changed'
    return ('?', len(kept) * 2)
for name in ('cp949', 'iso2022_kr'):
    info = codecs.lookup(name)
    kept.clear()
    print(name, outcome(info.encode, 'a\ud800b\ud801c\ud802d', 'test.handler'), len(kept), len(set(map(id, kept))))
    kept.clear()
    print(name, outcome(info.decode, b'a\xffb\xffc\xffd', 'test.handler'), len(kept), len(set(map(id, kept))))

# The replacement is encoded with the state as it is, and changes it.
answer = lambda e: ('\u3042', e.end)
for name in ('iso2022_jp', 'iso2022_jp_2', 'iso2022_kr', 'hz'):
    info = codecs.lookup(name)
    print(name, [outcome(info.encode, text, 'test.handler') for text in ('\ud800', 'a\ud800', '\u3044\ud800', '\u3044\ud800a', '\ud800\ud800', '\uac00\ud800\u4e00')])
answer = lambda e: ('a', e.end)
for name in ('iso2022_jp', 'iso2022_kr', 'hz'):
    info = codecs.lookup(name)
    print(name, [outcome(info.encode, text, 'test.handler') for text in ('\ud800', '\u3044\ud800\u3044', '\uac00\ud800\uac00', '\u4e00\ud800\u4e00')])
answer = lambda e: (b'a', e.end)
for name in ('iso2022_jp', 'iso2022_kr', 'hz'):
    info = codecs.lookup(name)
    print(name, [outcome(info.encode, text, 'test.handler') for text in ('\ud800', '\u3044\ud800\u3044', '\uac00\ud800\uac00', '\u4e00\ud800\u4e00')])
# 'replace' writes its question mark through the codec.
for name in ALL:
    info = codecs.lookup(name)
    print(name, [info.encode(text, 'replace')[0] for text in ('\ud800', '\u3042\ud800\u3042', '\uac00\ud800\uac00', '\u4e00\ud800\u4e00', '\ud800' * 3)], [info.encode(text, 'ignore')[0] for text in ('\ud800', '\u3042\ud800\u3042', '\uac00\ud800', '\u4e00\ud800\u4e00')])

# A handler that is looked up each time there is an error, and only then.
for name in ('big5', 'iso2022_jp'):
    info = codecs.lookup(name)
    print(name, outcome(info.encode, 'abc', 'test.none'), outcome(info.decode, b'abc', 'test.none'), outcome(info.encode, '\ud800', 'test.none'), outcome(info.decode, b'\xff', 'test.none'))
def first(e):
    codecs.register_error('test.changing', second)
    return ('1', e.end)
def second(e):
    return ('2', e.end)
codecs.register_error('test.changing', first)
print(outcome(codecs.lookup('big5').encode, '\ud800\ud800\ud800', 'test.changing'))
codecs.register_error('test.changing', first)
print(outcome(codecs.lookup('big5').decode, b'\xff\xff\xff', 'test.changing'))

# The handlers that come with Python.
texts = ['a\xe9b', '\u3042\ud800', '\udc80', '\udcff\udc00', '\U0001F600x', '\x80', 'a\u20acb\u20ac', '\ufffd']
datas = [b'a\xffb', b'\x80', b'\xff\xff', b'\x81', b'a\x81', b'\xa1\xff', b'\x8f\xa1', b'\xfe\xfe\xfe', b'\x1b$B\x21', b'~{!', b'\xed\xa0\x80']
for name in ALL:
    info = codecs.lookup(name)
    for errors in ('strict', 'ignore', 'replace', 'xmlcharrefreplace', 'backslashreplace', 'namereplace', 'surrogateescape', 'surrogatepass'):
        print(name, errors, [outcome(info.encode, text, errors) for text in texts])
        print(name, errors, [outcome(info.decode, data, errors) for data in datas])

# The exception has the very object that was to be encoded.
class X:
    def __str__(self): return S('\ud800')
info = codecs.lookup('euc_jis_2004')
answer = lambda e: (S('\ud801'), e.end)
pending = info.incrementalencoder()
pending.encode('\u304b')
for function, args in ((info.encode, (S('a\ud800'),)), (info.incrementalencoder().encode, (S('a\ud800'),)), (pending.encode, (S('\ud800'),)), (info.encode, ('\ud800', 'test.handler')), (info.encode, (X(),))):
    try:
        function(*args)
    except UnicodeEncodeError as e:
        print(type(e.object).__name__, ascii(e.object))
