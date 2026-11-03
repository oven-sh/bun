# _io.TextIOWrapper: lines and newline translation.
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

data = b'a\nbb\r\nccc\rdddd\n\r\r\n\neee'
print('--- reading')
for nl in (None, '', '\n', '\r', '\r\n'):
    print(repr(nl))
    w = TW(BytesIO(data), 'ascii', newline=nl)
    print('  read      ', repr(w.read()), w.newlines)
    w = TW(BytesIO(data), 'ascii', newline=nl)
    print('  readlines ', w.readlines(), w.newlines)
    w = TW(BytesIO(data), 'ascii', newline=nl)
    print('  iteration ', list(w), w.newlines)
    for chunk in (1, 2, 3, 5):
        w = TW(BytesIO(data), 'ascii', newline=nl)
        w._CHUNK_SIZE = chunk
        print('  chunks of', chunk, w.readlines() == TW(BytesIO(data), 'ascii', newline=nl).readlines(), w.newlines)
    w = TW(BytesIO(data), 'ascii', newline=nl)
    w._CHUNK_SIZE = 2
    print('  read(1)   ', [w.read(1) for i in range(24)], w.newlines)
    for limit in (0, 1, 2, 3, 4):
        w = TW(BytesIO(data), 'ascii', newline=nl)
        w._CHUNK_SIZE = 3
        print('  readline', limit, [w.readline(limit) for i in range(12)])
    w = TW(BytesIO(data), 'ascii', newline=nl)
    print('  mixed     ', repr(w.readline()), repr(w.read(3)), repr(w.readline()), repr(w.read(1)), repr(w.readline()), repr(w.read()))

print('--- newlines as they are seen')
w = TW(BytesIO(data), 'ascii')
w._CHUNK_SIZE = 1
seen = []
for line in iter(w.readline, ''):
    seen.append(w.newlines)
print(seen)

print('--- writing')
for nl in (None, '', '\n', '\r', '\r\n'):
    raw = BytesIO()
    w = TW(raw, 'ascii', newline=nl)
    print(repr(nl), w.write('a\nb\r\nc\rd\n\n'), w.write('\n'), w.write('x'), w.flush(), raw.getvalue(), w.newlines, w.tell())

print('--- readline')
w = TW(BytesIO(b'one\ntwo\n\nlast'), 'ascii')
print(repr(w.readline()), repr(w.readline(-1)), repr(w.readline(100)), repr(w.readline()), repr(w.readline()), repr(w.readline(5)))
t(w.readline, None)
t(w.readline, 'x')
t(w.readline, 1.5)
t(w.readline, 2 ** 70)
t(w.readline, 1, 2)
w = TW(BytesIO(b'one\ntwo\n\nlast'), 'ascii')
for hint in (None, 0, -1, 1, 3, 4, 5, 100):
    w.seek(0)
    print(hint, w.readlines(hint))
w = TW(BytesIO(b'a\nb'), 'ascii')
print(next(w), next(w), iter(w) is w)
t(next, w)
t(next, w)

print('--- long lines')
line = 'x' * 20000
w = TW(BytesIO((line + '\n' + line + '\r\n' + 'end').encode()), 'ascii')
a, b, c = w.readlines()
print(len(a), len(b), c, a == line + '\n', b == line + '\n')
w = TW(BytesIO((line + '\n').encode() * 3), 'ascii')
print(len(w.readline(8192)), len(w.readline(8192)), len(w.readline(8192)), len(w.readline(30000)), len(w.readline(20001)), len(w.readline()))

print('--- lines of wide characters')
text = 'é€\n\U0001f600\U0001f601x\r\n y\u0085z\x0b\x0c\x1c\n€'
for enc in ('utf-8', 'utf-16', 'utf-32-le'):
    for nl in (None, '', '\r\n'):
        w = TW(BytesIO(text.encode(enc)), enc, newline=nl)
        w._CHUNK_SIZE = 3
        print(enc, repr(nl), [ascii(x) for x in w])
        for limit in (1, 2, 3):
            w = TW(BytesIO(text.encode(enc)), enc, newline=nl)
            w._CHUNK_SIZE = 5
            print('   ', limit, [ascii(w.readline(limit)) for i in range(9)])

print('--- a carriage return at the end of a chunk')
class Chunked(_io._BufferedIOBase):
    def __init__(self, *chunks):
        self.chunks = list(chunks)
    def readable(self): return True
    def read1(self, n=-1):
        return self.chunks.pop(0) if self.chunks else b''
    def read(self, n=-1):
        r, self.chunks = b''.join(self.chunks), []
        return r
for nl in (None, '', '\r', '\r\n', '\n'):
    for chunks in ((b'a\r', b'\nb'), (b'a\r', b'b'), (b'a\r',), (b'a\r', b'\r', b'\n'), (b'\r', b'\n', b'\r', b'\n')):
        print(repr(nl), chunks, list(TW(Chunked(*chunks), 'ascii', newline=nl)), [TW(Chunked(*chunks), 'ascii', newline=nl).read(2)], repr(TW(Chunked(*chunks), 'ascii', newline=nl).read()))
