# _io.IncrementalNewlineDecoder
import _io

def t(f, *a, **k):
    try:
        r = f(*a, **k)
    except BaseException as e:
        print(type(e).__name__ + ':', e)
    else:
        print(repr(r))

IND = _io.IncrementalNewlineDecoder

print('--- construction')
t(IND)
t(IND, None)
t(IND, None, True, 'strict', 1)
t(IND, None, True, bad=1)
d = IND(decoder=None, translate=True, errors='ignore')
print(d.newlines, d.getstate())
d = IND(None, 0)
print(d.decode('a\r\nb'))
d = IND(None, [1])
print(repr(d.decode('a\r\nb')))
d = IND.__new__(IND)
t(d.decode, 'x')
t(d.getstate)
t(d.setstate, (b'', 0))
t(d.reset)
t(getattr, d, 'newlines')
t(setattr, IND(None, True), 'x', 1)
t(getattr, IND(None, True), '__dict__')
t(setattr, IND(None, True), 'newlines', 1)

print('--- text in, text out')
for translate in (True, False):
    d = IND(None, translate)
    print(translate)
    for piece in ('abc', 'a\nb', 'c\r', '\nd', 'e\r', 'f', '\r', '\r', '\n', '', 'g\r\n\r\nh\n\ri', '\r'):
        print('  ', repr(piece), repr(d.decode(piece)), d.newlines, d.getstate())
    print('  ', repr(d.decode('', True)), d.newlines, d.getstate())
    print('  ', repr(d.decode('x\r', True)), repr(d.decode('\r', final=True)), repr(d.decode(input='\n')), d.getstate())
    d.reset()
    print('  ', d.newlines, d.getstate())

print('--- which newlines were seen')
for text in ('', 'x', '\n', '\r', '\r\n', '\n\r', '\r\r\n', '\n\r\n', '\r\n\r\n', '\n\r\r\n', 'a\nb\rc\r\nd'):
    for translate in (True, False):
        d = IND(None, translate)
        print(repr(text), translate, repr(d.decode(text, True)), d.newlines)
d = IND(None, False)
for text in ('\n', '\r\n', 'x', '\ry'):
    d.decode(text)
    print(d.newlines)

print('--- wide characters')
for translate in (True, False):
    d = IND(None, translate)
    print(ascii(d.decode('€\r\n\U0001f600\r')), ascii(d.decode('਍ഊ\n')), d.newlines)
    d = IND(None, translate)
    print(ascii(d.decode('਍ഊ')), d.newlines, ascii(d.decode('€\n')), d.newlines)

print('--- what is unchanged is the same object')
d = IND(None, True)
s = 'some text\n'
print(d.decode(s) is s)
class MyStr(str):
    pass
s = MyStr('abc')
print(type(d.decode(s)).__name__, type(d.decode(MyStr('a\r\nb'))).__name__)

print('--- state')
d = IND(None, True)
d.decode('a\r')
print(d.getstate())
d.setstate((b'', 0))
print(repr(d.decode('\n')), d.getstate())
d.setstate((b'', 1))
print(repr(d.decode('\n')), repr(d.decode('x')))
d.setstate((b'ignored', 3))
print(d.getstate(), repr(d.decode('x')))
t(d.setstate, None)
t(d.setstate, [b'', 0])
t(d.setstate, (b'',))
t(d.setstate, (b'', 0, 0))
t(d.setstate, (b'', 'x'))
t(d.setstate, (b'', 1.5))
t(d.setstate)
print(d.setstate((b'', -1)), d.getstate())
print(d.setstate((5, 0)), d.getstate())

print('--- over another decoder')
class Dec:
    def __init__(self):
        self.log = []
        self.state = (b'', 0)
    def decode(self, data, final=False):
        self.log.append(('decode', data, final))
        return data.decode('latin-1')
    def getstate(self):
        self.log.append('getstate')
        return self.state
    def setstate(self, state):
        self.log.append(('setstate', state))
        self.state = state
    def reset(self):
        self.log.append('reset')
inner = Dec()
d = IND(inner, True)
print(repr(d.decode(b'a\r\nb\r')), repr(d.decode(b'\n', True)), d.newlines, inner.log)
inner.log.clear()
inner.state = (b'xy', 5)
d.decode(b'\r')
print(d.getstate(), d.setstate((b'q', 7)), d.getstate(), d.reset(), d.getstate(), inner.log)
for bad in (None, [b'', 0], (b'',), (b'', 'x'), (b'', 0, 0)):
    inner.state = bad
    t(d.getstate)
inner.state = (b'', 2 ** 63)
print(d.getstate())
inner.state = (b'', -1)
print(d.getstate())
class BadDec(Dec):
    def decode(self, data, final=False):
        return data
t(IND(BadDec(), True).decode, b'x')
class NoneDec(Dec):
    def decode(self, data, final=False):
        return None
t(IND(NoneDec(), True).decode, b'x')
t(IND(None, True).decode, b'x')
t(IND(None, True).decode, 5)
t(IND(None, True).decode, None)
t(IND(5, True).decode, 'x')
t(IND(5, True).getstate)
t(IND(5, True).reset)
t(IND(None, True).decode)
t(IND(None, True).decode, 'x', True, 1)

print('--- subclasses')
class Sub(IND):
    def decode(self, *a):
        return 'sub:' + super().decode(*a)
s = Sub(None, True)
s.attr = 1
print(repr(s.decode('a\r\n')), s.newlines, s.attr, [c.__name__ for c in Sub.__mro__])

print('--- the type')
print(IND, IND.__name__, IND.__qualname__, IND.__module__, IND.__bases__)
t(setattr, IND, 'x', 1)
