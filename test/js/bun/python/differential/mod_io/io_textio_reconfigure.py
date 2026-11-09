# _io.TextIOWrapper.reconfigure()
import _io

def t(f, *a, **k):
    try:
        r = f(*a, **k)
    except BaseException as e:
        print(type(e).__name__ + ':', e)
    else:
        print(repr(r))

TW = _io.TextIOWrapper
BytesIO = _io.BytesIO

def state(w):
    return w.encoding, w.errors, w.line_buffering, w.write_through

print('--- nothing changes')
raw = BytesIO()
w = TW(raw, 'ascii', 'replace', '\n', True, True)
print(w.reconfigure(), state(w))
print(w.reconfigure(encoding=None, errors=None, newline=None, line_buffering=None, write_through=None), state(w))

print('--- arguments')
t(w.reconfigure, 'utf-8')
t(w.reconfigure, bad=1)
t(w.reconfigure, encoding=5)
t(w.reconfigure, encoding=b'ascii')
t(w.reconfigure, errors=5)
t(w.reconfigure, newline=5)
t(w.reconfigure, newline='x')
t(w.reconfigure, newline='\n\n')
t(w.reconfigure, encoding='no-such-encoding')
t(w.reconfigure, encoding='hex')
t(w.reconfigure, line_buffering='x')
t(w.reconfigure, write_through='x')
t(w.reconfigure, line_buffering=1.5)
t(w.reconfigure, line_buffering=2 ** 70)
print(state(w))

print('--- buffering')
class Log(_io._BufferedIOBase):
    def __init__(self):
        self.log = []
    def writable(self): return True
    def write(self, b):
        self.log.append(bytes(b))
        return len(b)
    def flush(self):
        self.log.append('flush')
    def take(self):
        log, self.log = self.log, []
        return log
l = Log()
w = TW(l, 'ascii')
w.write('a\n')
print(l.take(), w.reconfigure(line_buffering=True), l.take(), state(w))
w.write('b\n')
print(l.take(), w.reconfigure(line_buffering=False), l.take(), state(w))
w.write('c\n')
print(l.take(), w.reconfigure(write_through=True), l.take(), state(w))
w.write('d')
print(l.take(), w.reconfigure(write_through=0, line_buffering=5), l.take(), state(w))
w.write('e')
print(l.take(), w.reconfigure(line_buffering=None), state(w), l.take())

print('--- encoding and errors, when writing')
raw = BytesIO()
w = TW(raw, 'latin-1', newline='\n')
w.write('é\n')
print(w.reconfigure(encoding='utf-8'), state(w), raw.getvalue())
w.write('é\n')
w.flush()
print(raw.getvalue())
w.reconfigure(encoding='ascii', errors='replace')
w.write('é\n')
print(state(w), w.flush(), raw.getvalue())
w.reconfigure(errors='xmlcharrefreplace')
w.write('é\n')
print(state(w), w.flush(), raw.getvalue())
w.reconfigure(encoding='latin-1')
print(state(w))
w.reconfigure(errors='ignore')
w.reconfigure(encoding='ascii')
print(state(w))
t(w.write, 'é')
w.reconfigure(encoding='locale')
print(state(w))
w.reconfigure(encoding='UTF8', errors='strict')
print(state(w))

print('--- byte order marks')
raw = BytesIO()
w = TW(raw, 'ascii')
w.reconfigure(encoding='utf-16')
w.write('a')
w.flush()
print(raw.getvalue())
w.reconfigure(encoding='utf-8-sig')
w.write('b')
w.flush()
print(raw.getvalue())
w.reconfigure(encoding='utf-16')
w.write('c')
w.flush()
print(raw.getvalue())
raw = BytesIO()
w = TW(raw, 'utf-8-sig')
w.write('a')
w.reconfigure(encoding='utf-8-sig')
w.write('b')
w.flush()
print(raw.getvalue())

print('--- newline, when writing')
raw = BytesIO()
w = TW(raw, 'ascii', newline='\n')
for nl in ('\r\n', '\r', '', None, '\n'):
    w.reconfigure(newline=nl)
    w.write('x\n')
w.flush()
print(raw.getvalue())

print('--- when reading')
w = TW(BytesIO('é\r\nb\r\n'.encode('latin-1')), 'utf-8')
print(w.reconfigure(encoding='latin-1', newline=''), state(w), repr(w.readline()))
t(w.reconfigure, encoding='utf-8')
t(w.reconfigure, errors='replace')
t(w.reconfigure, newline=None)
t(w.reconfigure, newline='\n')
print(w.reconfigure(line_buffering=True), state(w), repr(w.read()))
t(w.reconfigure, encoding='utf-8')
w = TW(BytesIO(b'a\r\nb\rc\n'), 'ascii')
w.reconfigure(newline='\r')
print(w.readlines(), w.newlines)
w = TW(BytesIO(b'a\r\nb\rc\n'), 'ascii', newline='\n')
w.reconfigure(newline=None)
print(w.readlines(), w.newlines)
w = TW(BytesIO(b'a\xffb'), 'ascii')
w.reconfigure(errors='replace')
print(ascii(w.read()), state(w))
w = TW(BytesIO(b'abc'), 'ascii')
print(repr(w.read(0)))
t(w.reconfigure, encoding='utf-8')
w = TW(BytesIO(b''), 'ascii')
print(repr(w.read()))
t(w.reconfigure, encoding='utf-8')
w = TW(BytesIO(b''), 'ascii')
print(repr(w.read(1)))
t(w.reconfigure, encoding='utf-8')
w = TW(BytesIO(b'abc'), 'ascii')
w.read(1)
w.seek(0)
t(w.reconfigure, encoding='utf-8')

print('--- the flush fails')
class BadFlush(BytesIO):
    def flush(self):
        raise OSError('flush failed')
w = TW(BadFlush(), 'ascii')
t(w.reconfigure, encoding='utf-8', line_buffering=True)
print(state(w))
BadFlush.flush = BytesIO.flush

print('--- by what the stream is using, in the middle')
class Acts(BytesIO):
    act = None
    def read1(self, size=-1):
        act, self.act = self.act, None
        if act:
            act()
        return super().read1(size)
for size in (), (4,), (40,):
    raw = Acts(b'ab\ncd\r\nef\ngh')
    w = TW(raw, 'ascii', newline='\n')
    raw.act = lambda: w.reconfigure(newline='\r\n')
    print(size, repr(w.readline(*size)), repr(w.readline(*size)), repr(w.read()))
import codecs
class Encoder(codecs.IncrementalEncoder):
    act = None
    def encode(self, text, final=False):
        act, Encoder.act = Encoder.act, None
        if act:
            act()
        return text.encode('ascii')
    def getstate(self):
        return 0
codecs.register(lambda name: codecs.CodecInfo(codecs.ascii_encode, codecs.ascii_decode, incrementalencoder=Encoder, incrementaldecoder=codecs.getincrementaldecoder('ascii'), name='acts') if name == 'acts' else None)
for encoding in 'utf-16', 'utf-8-sig', 'utf-32':
    raw = BytesIO()
    w = TW(raw, 'acts')
    Encoder.act = lambda: w.reconfigure(encoding=encoding)
    print(w.write('a'), w.write('b'), w.flush(), raw.getvalue(), state(w))
