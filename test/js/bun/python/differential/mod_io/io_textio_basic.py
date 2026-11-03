# _io.TextIOWrapper: construction, attributes, reading, writing, closing.
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

print('--- construction')
raw = BytesIO(b'abc')
w = TW(raw)
print(w.buffer is raw, w.encoding, w.errors, w.newlines, w.line_buffering, w.write_through, w.closed, w._CHUNK_SIZE, w._finalizing)
print(repr(w), w.readable(), w.writable(), w.seekable(), w.isatty())
t(w.fileno)
t(getattr, w, 'name')
t(getattr, w, 'mode')
keep = []
def make(*a, **k):
    w = TW(*a, **k)
    keep.append(w)
    return w.encoding, w.errors, w.line_buffering, w.write_through
t(make, BytesIO(), 'utf-8')
t(make, BytesIO(), 'UTF8', 'replace', '\n', True, True)
t(make, BytesIO(), 'Latin-1', None, None, 0, 1)
t(make, BytesIO(), None, None, None)
t(make, BytesIO(), 'locale')
t(make, BytesIO(), encoding='ascii', errors='ignore', newline='', line_buffering=[1], write_through='x')
t(make, buffer=BytesIO())
t(make)
t(make, BytesIO(), 5)
t(make, BytesIO(), b'utf-8')
t(make, BytesIO(), 'utf-8', 5)
t(make, BytesIO(), 'utf-8', b'strict')
t(make, BytesIO(), 'utf-8', None, 5)
t(make, BytesIO(), 'utf-8', None, b'\n')
t(make, BytesIO(), 'utf-8', None, 'x')
t(make, BytesIO(), 'utf-8', None, '\n\r')
t(make, BytesIO(), 'utf-8', None, '\r\n\n')
t(make, BytesIO(), 'no-such-encoding')
t(make, BytesIO(), '')
t(make, BytesIO(), 'utf\0-8')
t(make, BytesIO(), 'utf-8', 'str\0ict')
t(make, BytesIO(), 'utf-8', None, '\0')
t(make, BytesIO(), 'utf-8', 'no-such-handler')
t(make, BytesIO(), 'hex')
t(make, BytesIO(), 'rot13')
t(make, BytesIO(), 'utf-8', None, None, False, False, 1)
t(make, BytesIO(), bad=1)
t(make, 5)
t(make, None)
t(make, 'text')

print('--- attributes')
for name in ('buffer', 'encoding', 'errors', 'newlines', 'line_buffering', 'write_through', 'closed', 'name'):
    t(setattr, w, name, 1)
w.mode = 'r'
w.extra = 1
print(repr(w), sorted(w.__dict__))
raw.name = 'the name'
print(w.name, repr(w))
raw.name = w
t(repr, w)
del raw.name
w._CHUNK_SIZE = 16
print(w._CHUNK_SIZE)
t(setattr, w, '_CHUNK_SIZE', 0)
t(setattr, w, '_CHUNK_SIZE', -1)
t(setattr, w, '_CHUNK_SIZE', 'x')
t(setattr, w, '_CHUNK_SIZE', 2 ** 70)
t(setattr, w, '_CHUNK_SIZE', 1.5)
t(delattr, w, '_CHUNK_SIZE')
w._finalizing = True
print(w._finalizing)
w._finalizing = False
t(setattr, w, '_finalizing', 0)
t(w.__getstate__)
t(w.__reduce_ex__, 2)

print('--- read')
w = TW(BytesIO('héllo wörld €uro \U0001f600!'.encode()), 'utf-8')
print(w.read(1), w.read(2), repr(w.read(0)), w.read(9), ascii(w.read(7)), w.read(None), repr(w.read()), repr(w.read(3)))
w = TW(BytesIO('héllo'.encode()), 'utf-8')
print(w.read(), repr(w.read()))
w = TW(BytesIO('héllo'.encode()), 'utf-8')
print(w.read(-1), w.seek(0), w.read(-5), w.seek(0), w.read(2), w.read(-1))
t(w.read, 'x')
t(w.read, 1.5)
t(w.read, 2 ** 70)
t(w.read, 1, 2)
text = ''.join(chr(0x20 + i % 0x500) for i in range(30000))
w = TW(BytesIO(text.encode()), 'utf-8')
print(w.read(10000) == text[:10000], w.read(1) == text[10000], w.read(15000) == text[10001:25001], w.read() == text[25001:])
w = TW(BytesIO(text.encode()), 'utf-8')
w._CHUNK_SIZE = 7
print(''.join(iter(lambda: w.read(11), '')) == text)

print('--- chunks that split characters')
class Chunked(_io._BufferedIOBase):
    def __init__(self, *chunks):
        self.chunks = list(chunks)
        self.log = []
    def readable(self): return True
    def read1(self, n=-1):
        self.log.append(('read1', n))
        return self.chunks.pop(0) if self.chunks else b''
    def read(self, n=-1):
        self.log.append(('read', n))
        if n is None or n < 0:
            r, self.chunks = b''.join(self.chunks), []
            return r
        return self.chunks.pop(0) if self.chunks else b''
data = 'a€\U0001f600é'.encode()
for size in (1, 2, 3):
    c = Chunked(*[data[i:i + size] for i in range(0, len(data), size)])
    w = TW(c, 'utf-8')
    print(size, [ascii(w.read(1)) for i in range(5)], len(c.log))
c = Chunked(b'ab', b'\xe2\x82', b'\xac', b'c')
w = TW(c, 'utf-8')
print(ascii(w.read(3)), c.log, ascii(w.read()), c.log)
c = Chunked(b'ab\xe2')
w = TW(c, 'utf-8')
print(w.read(2))
t(w.read, 1)
c = Chunked(b'ab\xe2')
t(TW(c, 'utf-8').read)
c = Chunked(b'ab\xe2')
print(ascii(TW(c, 'utf-8', 'replace').read()))
c = Chunked(b'ab\xe2', b'')
w = TW(c, 'utf-8', 'replace')
print(ascii(w.read(5)), ascii(w.read(5)))

print('--- size hints')
c = Chunked(*[b'x' * 10] * 5)
w = TW(c, 'ascii')
w.read(3)
w.read(20000)
print(c.log)
c = Chunked('é'.encode() * 10, b'y' * 30)
w = TW(c, 'utf-8')
w._CHUNK_SIZE = 4
w.read(3)
w.read(20)
print(c.log)

print('--- a buffer without read1')
class NoRead1:
    closed = False
    def __init__(self, data): self.data = data
    def readable(self): return True
    def writable(self): return False
    def seekable(self): return False
    def read(self, n=-1):
        print('  read', n)
        if n is None or n < 0: n = len(self.data)
        r, self.data = self.data[:n], self.data[n:]
        return r
    def flush(self): pass
    def close(self): self.closed = True
w = TW(NoRead1(b'abc\ndef'), 'ascii')
print(w.readline(), w.read())

print('--- what the buffer may get wrong')
class BadRead(Chunked):
    def __init__(self, v):
        super().__init__()
        self.v = v
    def read1(self, n=-1): return self.v
    def read(self, n=-1): return self.v
for v in ('text', 5, None, [b'x']):
    t(TW(BadRead(v), 'ascii').read, 1)
    t(TW(BadRead(v), 'ascii').read)
    t(TW(BadRead(v), 'ascii').readline)
print(TW(BadRead(bytearray(b'ab')), 'ascii').read(1))

print('--- write')
raw = BytesIO()
w = TW(raw, 'utf-8')
print(w.write('abc'), raw.getvalue(), w.write('é€\U0001f600'), w.write(''), w.flush(), raw.getvalue())
t(w.write, b'x')
t(w.write, 5)
t(w.write, None)
t(w.write)
t(w.write, 'a', 'b')
w.writelines(['a', 'b\n', 'c'])
w.writelines(iter('de'))
t(w.writelines, ['x', b'y'])
t(w.writelines, 5)
w.flush()
print(raw.getvalue()[-8:])
class MyStr(str):
    pass
print(w.write(MyStr('sub')), w.flush(), raw.getvalue()[-3:])

print('--- when the buffer is written to')
class Log(_io._BufferedIOBase):
    def __init__(self):
        self.log = []
    def writable(self): return True
    def write(self, b):
        self.log.append(('write', type(b).__name__, len(b) if len(b) > 20 else bytes(b)))
        return len(b)
    def flush(self):
        self.log.append('flush')
    def take(self):
        log, self.log = self.log, []
        return log
l = Log()
w = TW(l, 'utf-8')
w.write('a'); w.write('b'); w.write('\n'); w.write('é')
print(l.take(), w.flush(), l.take(), w.flush(), l.take())
w.write('x' * 8191)
print(l.take())
w.write('y')
print(l.take())
w.write('x' * 5000); w.write('é' * 1000); w.write('z' * 2000)
print(l.take(), w.flush(), l.take())
w.write('a'); w.write('x' * 8192)
print(l.take(), w.flush(), l.take())
w.write('a'); w.write('é' * 5000); w.write('b')
print(l.take(), w.flush(), l.take())
w._CHUNK_SIZE = 4
w.write('ab'); w.write('c')
print(l.take())
w.write('d')
print(l.take())
w.write('efghi')
print(l.take())
l = Log()
w = TW(l, 'utf-8', line_buffering=True)
w.write('ab'); print(l.take())
w.write('c\nd'); print(l.take())
w.write('e\r'); print(l.take())
w.write(''); print(l.take())
l = Log()
w = TW(l, 'utf-8', write_through=True)
w.write('ab'); print(l.take())
w.write(''); print(l.take())
w.write('c\n'); print(l.take())
l = Log()
w = TW(l, 'utf-8', newline='\r\n', line_buffering=True)
w.write('a\nb'); print(l.take())

print('--- not readable, not writable')
class RO(_io._BufferedIOBase):
    def readable(self): return True
    def read1(self, n=-1): return b''
    def read(self, n=-1): return b''
w = TW(RO(), 'utf-8')
print(w.readable(), w.writable(), w.seekable())
t(w.write, 'x')
t(w.write, '')
t(w.writelines, ['x'])
print(repr(w.read()), w.flush())
w = TW(Log(), 'utf-8')
print(w.readable(), w.writable(), w.seekable())
t(w.read)
t(w.read, 0)
t(w.read, 1)
t(w.readline)
t(w.readlines)
t(next, w)
t(w.tell)
t(w.seek, 0)

print('--- reading after writing')
raw = BytesIO(b'0123456789')
w = TW(raw, 'ascii')
print(w.read(2), w.write('AB'), w.read(), raw.getvalue())
raw = BytesIO(b'0123456789')
w = TW(raw, 'ascii')
print(w.write('AB'), w.read(3), raw.getvalue(), w.tell())
raw = BytesIO(b'0123456789')
w = TW(raw, 'ascii')
print(w.write('AB'), w.readline(), raw.getvalue())

print('--- encoding errors')
for enc, err in (('ascii', 'strict'), ('ascii', 'replace'), ('ascii', 'ignore'), ('ascii', 'backslashreplace'), ('ascii', 'xmlcharrefreplace'), ('ascii', 'namereplace'),
                 ('latin-1', 'strict'), ('latin-1', 'replace'), ('utf-8', 'strict'), ('utf-8', 'surrogateescape'), ('utf-8', 'surrogatepass'), ('utf-8', 'replace')):
    raw = BytesIO()
    w = TW(raw, enc, err)
    print(enc, err, end=' ')
    try:
        w.write('a\xe9€\udc80z')
        w.flush()
        print(raw.getvalue())
    except UnicodeError as e:
        print(type(e).__name__, e, raw.getvalue())
for enc, err in (('ascii', 'strict'), ('ascii', 'replace'), ('ascii', 'ignore'), ('ascii', 'backslashreplace'), ('ascii', 'surrogateescape'),
                 ('utf-8', 'strict'), ('utf-8', 'replace'), ('utf-8', 'ignore'), ('utf-8', 'surrogateescape'), ('utf-8', 'backslashreplace'), ('latin-1', 'strict')):
    w = TW(BytesIO(b'a\xe9\xff\xc3\xa9z'), enc, err)
    print(enc, err, end=' ')
    try:
        print(ascii(w.read()))
    except UnicodeError as e:
        print(type(e).__name__, e)
w = TW(BytesIO(b'ok\n\xff\n'), 'utf-8')
t(w.readline)
w = TW(BytesIO(), 'utf-8', 'no-such-handler')
print(w.write('abc'))
t(w.write, '\udc80')
w = TW(BytesIO(b'abc\xff'), 'utf-8', 'no-such-handler')
t(w.read)

print('--- close')
class CloseLog(BytesIO):
    def close(self):
        print('  buffer.close, value =', self.getvalue())
        super().close()
    def flush(self):
        print('  buffer.flush')
        super().flush()
raw = CloseLog()
w = TW(raw, 'utf-8')
w.write('abc')
print(w.close(), w.closed, raw.closed, w.close(), repr(w))
for m in ('read', 'readline', 'readlines', 'flush', 'tell', 'truncate', 'isatty', 'readable', 'writable', 'seekable', '__next__', '__enter__', '__iter__', 'detach', 'fileno'):
    print(m, end=' ')
    t(getattr(w, m))
t(w.write, 'x')
t(w.write, '')
t(w.write, b'x')
t(w.writelines, [])
t(w.seek, 0)
t(w.read, 0)
t(w.reconfigure, encoding='ascii')
t(w.reconfigure)
print(w.encoding, w.errors, w.buffer is raw, w.line_buffering, w.newlines, w._CHUNK_SIZE)
with TW(BytesIO(b'x'), 'ascii') as c:
    print(c.read())
print(c.closed, c.buffer.closed)
class BadFlush(BytesIO):
    def flush(self):
        raise OSError('flush failed')
w = TW(BadFlush(), 'ascii')
t(w.close)
print(w.closed)
class BadClose(BytesIO):
    def close(self):
        super().close()
        raise KeyError('close failed')
w = TW(BadClose(), 'ascii')
t(w.close)
print(w.closed)
class BadBoth(BytesIO):
    def flush(self):
        raise OSError('flush failed')
    def close(self):
        super().close()
        raise KeyError('close failed')
w = TW(BadBoth(), 'ascii')
try:
    w.close()
except KeyError as e:
    print(repr(e), repr(e.__context__))
raw = BytesIO()
w = TW(raw, 'ascii')
w.write('lost')
raw.close()
print(w.closed)
t(w.flush)
t(w.write, 'x')
print(w.close())

print('--- detach')
raw = BytesIO()
w = TW(raw, 'ascii')
w.write('abc')
print(w.detach() is raw, raw.getvalue(), raw.closed, repr(w))
for m in ('read', 'readline', 'flush', 'close', 'detach', 'tell', 'truncate', 'readable', 'writable', 'seekable', 'isatty', 'fileno', '__next__', '__iter__', '__enter__'):
    print(m, end=' ')
    t(getattr(w, m))
t(w.write, 'x')
t(w.seek, 0)
t(w.reconfigure, line_buffering=True)
for name in ('buffer', 'closed', 'name', 'newlines', '_CHUNK_SIZE'):
    print(name, end=' ')
    t(getattr, w, name)
print(w.encoding, w.errors, w.line_buffering)
t(setattr, w, '_CHUNK_SIZE', 5)

print('--- uninitialized')
w = TW.__new__(TW)
for m in ('read', 'readline', 'flush', 'close', 'detach', 'tell', 'readable', '__next__', '__repr__'):
    print(m, end=' ')
    t(getattr(w, m))
t(w.write, 'x')
for name in ('buffer', 'closed', 'name', 'newlines', 'errors', '_CHUNK_SIZE', 'encoding', 'line_buffering'):
    print(name, end=' ')
    t(getattr, w, name)
t(w.__init__, BytesIO(), 'no-such-encoding')
t(w.read)
print(w.encoding, w.closed)
w.__init__(BytesIO(b'ok'), 'ascii')
print(w.read(), w.encoding)
w.__init__(BytesIO('é'.encode('latin-1')), 'latin-1', newline='\r')
print(w.read(), w.encoding)
t(w.__init__, BytesIO(), 'ascii', None, 'x')
t(w.read)

print('--- subclasses')
class Sub(TW):
    def readline(self, *a):
        print('  Sub.readline')
        return super().readline(*a)
s = Sub(BytesIO(b'a\nb\n'), 'ascii')
print(list(s), repr(s), [c.__name__ for c in Sub.__mro__])
class BadLine(TW):
    def readline(self):
        return b'x'
t(next, BadLine(BytesIO(b'a'), 'ascii'))
class ClosedSub(TW):
    closed = True
c = ClosedSub(BytesIO(b'a'), 'ascii')
t(c.read)
t(c.write, 'x')
t(c.flush)
t(Sub(BytesIO()).__getstate__)

print('--- the type')
print(TW, TW.__name__, TW.__qualname__, TW.__module__, TW.__bases__)
t(setattr, TW, 'x', 1)
