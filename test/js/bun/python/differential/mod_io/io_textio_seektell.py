# _io.TextIOWrapper: seek(), tell(), truncate().
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

print('--- ASCII')
w = TW(BytesIO(b'0123456789\nabcdefghij\n'), 'ascii')
print(w.tell(), w.read(3), w.tell(), w.readline(), w.tell(), w.read(), w.tell())
print(w.seek(0), w.read(1), w.seek(5), w.read(2), w.seek(0, 1), w.read(1), w.seek(0, 2), repr(w.read()), w.seek(100), repr(w.read()), w.tell())
t(w.seek, -1)
t(w.seek, 1, 1)
t(w.seek, -1, 1)
t(w.seek, 1, 2)
t(w.seek, -1, 2)
t(w.seek, 0, 3)
t(w.seek, 0, -1)
t(w.seek, 'x')
t(w.seek, None)
t(w.seek, 1.5)
t(w.seek, 0, 'x')
t(w.seek, 0, None)
t(w.seek)
t(w.seek, 2 ** 200)
t(w.seek, -2 ** 70)
print(w.seek(True), w.read(1), w.seek(2.0), w.read(1))

print('--- every position can be returned to')
def roundtrip(text, enc, chunk, **k):
    data = text.encode(enc)
    w = TW(BytesIO(data), enc, **k)
    w._CHUNK_SIZE = chunk
    expected = TW(BytesIO(data), enc, **k).read()
    cookies = []
    for i in range(len(expected) + 1):
        cookies.append(w.tell())
        w.read(1)
    ok = True
    for i, c in enumerate(cookies):
        w.seek(c)
        if w.read() != expected[i:]:
            ok = False
            print('  wrong at', i, c)
    return ok, cookies
text = 'aé€\U0001f600b\nc\r\nd\re'
for enc in ('ascii', 'latin-1', 'utf-8', 'utf-8-sig', 'utf-16', 'utf-16-le', 'utf-16-be', 'utf-32', 'utf-32-be', 'utf-7'):
    s = text if enc not in ('ascii', 'latin-1') else 'abc\nd\r\ne\rf'
    for chunk in (1, 2, 3, 5, 8192):
        for nl in (None, '', '\n'):
            print(enc, chunk, repr(nl), *roundtrip(s, enc, chunk, newline=nl))

print('--- tell after readline')
w = TW(BytesIO('é\n€€\n\U0001f600\n'.encode()), 'utf-8')
pos = [w.tell()]
for line in iter(w.readline, ''):
    pos.append(w.tell())
print(pos)
for p in pos:
    w.seek(p)
    print(p, ascii(w.readline()))

print('--- tell is disabled by iteration')
w = TW(BytesIO(b'a\nb\nc\n'), 'ascii')
print(next(w))
t(w.tell)
t(w.seek, 0, 1)
print(w.seek(0), w.tell(), next(w))
t(w.tell)
print(w.flush())
print(list(w), w.tell())
w = TW(BytesIO(b'a\nb\nc\n'), 'ascii')
for line in w:
    pass
print(w.tell())

print('--- writing')
raw = BytesIO()
w = TW(raw, 'utf-8')
print(w.tell(), w.write('aé€'), w.tell(), raw.getvalue(), w.seek(1), w.write('XY'), w.tell(), w.seek(0), ascii(w.read()))
print(w.seek(0, 2), w.write('end'), w.seek(0), ascii(w.read()), w.tell())
raw = BytesIO(b'0123456789')
w = TW(raw, 'ascii')
print(w.read(3), w.tell(), w.seek(w.tell()), w.write('AB'), w.tell(), w.read(2), raw.getvalue())

print('--- byte order marks')
for enc in ('utf-16', 'utf-32', 'utf-8-sig'):
    raw = BytesIO()
    w = TW(raw, enc)
    w.write('a')
    w.write('b')
    p = w.tell()
    print(enc, p, raw.getvalue())
    w.seek(0)
    w.write('c')
    w.seek(p)
    w.write('d')
    w.seek(0, 2)
    w.write('e')
    w.flush()
    print('  ', raw.getvalue(), w.seek(0), w.read())
    # Appending to what is there already.
    raw2 = BytesIO(raw.getvalue())
    raw2.seek(0, 2)
    w2 = TW(raw2, enc)
    w2.write('f')
    w2.flush()
    print('  ', raw2.getvalue(), w2.seek(0), w2.read())
    w3 = TW(BytesIO(), enc)
    w3.seek(0, 2)
    w3.write('g')
    w3.flush()
    print('  ', w3.buffer.getvalue())

print('--- truncate')
raw = BytesIO(b'0123456789')
w = TW(raw, 'ascii')
print(w.read(3), w.truncate(), raw.getvalue())
raw = BytesIO(b'0123456789')
w = TW(raw, 'ascii')
print(w.truncate(4), raw.getvalue(), w.tell(), w.read(), w.truncate(None), w.truncate(2), raw.getvalue())
raw = BytesIO()
w = TW(raw, 'ascii')
print(w.write('abcdef'), w.truncate(3), raw.getvalue(), w.tell())
t(w.truncate, -1)
t(w.truncate, 'x')

print('--- not seekable')
class NoSeek(_io._BufferedIOBase):
    def readable(self): return True
    def writable(self): return True
    def read1(self, n=-1): return b''
    def read(self, n=-1): return b''
    def write(self, b): return len(b)
w = TW(NoSeek(), 'ascii')
print(w.seekable())
t(w.tell)
t(w.seek, 0)
t(w.seek, 0, 1)
t(w.seek, 0, 2)
t(w.truncate)

print('--- cookies that make no sense')
w = TW(BytesIO('é€'.encode() * 10), 'utf-8')
t(w.seek, 1)
t(w.read, 1)
w.seek(0)
t(w.seek, 1 << 64)
t(w.seek, (5 << 128) + (1 << 96))
t(w.seek, 1 << 167)
t(w.seek, 1 << 168)

print('--- decoders written in Python')
import codecs
class Dec(codecs.IncrementalDecoder):
    """Two bytes make a character."""
    def __init__(self, errors='strict'):
        super().__init__(errors)
        self.buffer = b''
    def decode(self, data, final=False):
        data = self.buffer + data
        n = len(data) // 2 * 2
        self.buffer = data[n:]
        return ''.join(chr(data[i] * 16 + data[i + 1] - 0x330) for i in range(0, n, 2))
    def getstate(self):
        return self.buffer, 0
    def setstate(self, state):
        self.buffer = state[0]
    def reset(self):
        self.buffer = b''
class Enc(codecs.IncrementalEncoder):
    def encode(self, text, final=False):
        return b''.join(b'%x%x' % divmod(ord(c), 16) for c in text)
def search(name):
    if name == 'test_hexpairs':
        return codecs.CodecInfo(lambda s, e='strict': (Enc().encode(s), len(s)), lambda b, e='strict': (Dec().decode(bytes(b), True), len(b)),
                                incrementalencoder=Enc, incrementaldecoder=Dec, name='test-hexpairs')
codecs.register(search)
raw = BytesIO()
w = TW(raw, 'test_hexpairs')
print(w.write('AB\nCD'), w.tell(), raw.getvalue(), w.seek(0), w.read(1), w.tell(), w.readline(), w.tell(), w.read(), w.encoding)
w._CHUNK_SIZE = 3
w.seek(0)
cookies = []
for i in range(6):
    cookies.append(w.tell())
    w.read(1)
print(cookies)
for c in cookies:
    w.seek(c)
    print(c, repr(w.read()))

class BadState(Dec):
    state = None
    def getstate(self):
        return self.state
def search2(name):
    if name == 'test_badstate':
        return codecs.CodecInfo(None, None, incrementalencoder=Enc, incrementaldecoder=BadState, name='test-badstate')
codecs.register(search2)
for state in (None, 5, (), (b'',), (b'', 0, 0), ('', 0), (5, 0), [b'', 0]):
    BadState.state = state
    w = TW(BytesIO(b'4142'), 'test_badstate', newline='\n')
    print(state, end=' ')
    t(w.read, 1)
BadState.state = (b'', 'x')
w = TW(BytesIO(b'4142'), 'test_badstate', newline='\n')
print(w.read(1))
t(w.tell)
class BadResult(Dec):
    def decode(self, data, final=False):
        return data
def search3(name):
    if name == 'test_badresult':
        return codecs.CodecInfo(None, None, incrementalencoder=BadEnc, incrementaldecoder=BadResult, name='test-badresult')
class BadEnc(Enc):
    def encode(self, text, final=False):
        return [text]
codecs.register(search3)
for nl in (None, '\n'):
    w = TW(BytesIO(b'4142'), 'test_badresult', newline=nl)
    t(w.read, 1)
    t(w.read)
    t(w.readline)
w = TW(BytesIO(), 'test_badresult')
t(w.write, 'x')
