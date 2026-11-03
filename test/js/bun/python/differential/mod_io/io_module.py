# Lib/io.py on top of _io.
import io, _io, abc

def t(f, *a, **k):
    try:
        r = f(*a, **k)
    except BaseException as e:
        print(type(e).__name__ + ':', e)
    else:
        print(repr(r))

print(sorted(io.__all__))
for name in ('open', 'open_code', 'text_encoding', 'FileIO', 'BytesIO', 'StringIO', 'BufferedReader', 'BufferedWriter', 'BufferedRWPair', 'BufferedRandom',
             'IncrementalNewlineDecoder', 'TextIOWrapper', 'UnsupportedOperation', 'BlockingIOError', 'DEFAULT_BUFFER_SIZE'):
    print(name, getattr(io, name) is getattr(_io, name))
print(io.SEEK_SET, io.SEEK_CUR, io.SEEK_END, io.BlockingIOError is BlockingIOError, open is io.open)

print('--- the abstract base classes')
for cls in (io.IOBase, io.RawIOBase, io.BufferedIOBase, io.TextIOBase):
    print(cls, type(cls).__name__, [c.__name__ for c in cls.__mro__], type(cls.__doc__).__name__)
objects = [io.FileIO('/dev/null'), io.BytesIO(), io.StringIO(), io.BufferedReader(io.BytesIO()), io.BufferedWriter(io.BytesIO()), io.BufferedRandom(io.BytesIO()),
           io.BufferedRWPair(io.BytesIO(), io.BytesIO()), io.TextIOWrapper(io.BytesIO()), open('/dev/null'), open('/dev/null', 'rb'), open('/dev/null', 'wb', 0)]
for o in objects:
    print(type(o).__name__, [isinstance(o, c) for c in (io.IOBase, io.RawIOBase, io.BufferedIOBase, io.TextIOBase)], [isinstance(o, c) for c in (io.Reader, io.Writer)])
for c in (io.FileIO, io.BytesIO, io.StringIO, io.TextIOWrapper):
    print(c.__name__, [issubclass(c, b) for b in (io.IOBase, io.RawIOBase, io.BufferedIOBase, io.TextIOBase, _io._IOBase)])

print('--- UnsupportedOperation')
print(io.UnsupportedOperation.__mro__, io.UnsupportedOperation.__module__, io.UnsupportedOperation.__name__)
for exc in (OSError, ValueError, io.UnsupportedOperation):
    try:
        io.BytesIO().fileno()
    except exc as e:
        print(exc.__name__, repr(e), e.args, e.errno)
e = io.UnsupportedOperation(1, 'two')
print(repr(e), e.errno, e.strerror)

print('--- streams written in Python')
class Upper(io.RawIOBase):
    def __init__(self, data):
        self.data = data
    def readable(self):
        return True
    def readinto(self, b):
        n = min(len(b), len(self.data), 3)
        b[:n] = self.data[:n].upper()
        self.data = self.data[n:]
        return n
u = Upper(b'hello\nworld')
print(u.read(2), u.readline(), u.readall(), u.closed)
print(io.BufferedReader(Upper(b'hello\nworld')).read())
print(io.TextIOWrapper(io.BufferedReader(Upper(b'hello\nworld'))).readlines())
print(list(io.TextIOWrapper(Upper(b'a\nb'))))
with Upper(b'x') as u:
    pass
print(u.closed)
t(u.read)

class Collect(io.TextIOBase):
    def __init__(self):
        self.parts = []
    def writable(self):
        return True
    def write(self, s):
        self.parts.append(s)
        return len(s)
c = Collect()
print('a', 1, [2], sep='-', end='!\n', file=c)
c.writelines(['x', 'y'])
print(c.parts, c.encoding, c.errors, c.newlines)
t(c.read)
t(c.detach)

class Buf(io.BufferedIOBase):
    def read(self, n=-1):
        return b'abc'[:n if n >= 0 else None]
    read1 = read
a = bytearray(2)
print(Buf().readinto(a), a, Buf().readinto1(a))

class Abstract(io.IOBase):
    @abc.abstractmethod
    def frob(self): pass
t(Abstract)

print('--- Reader and Writer')
class R:
    def read(self, n=-1): pass
class W:
    def write(self, d): pass
print(isinstance(R(), io.Reader), isinstance(R(), io.Writer), isinstance(W(), io.Writer), issubclass(W, io.Reader), io.Reader[bytes], io.Writer[str])

print('--- print and input through real streams')
s = io.StringIO()
print('hello', 'world', file=s)
print(1, 2, 3, sep=', ', end='', file=s, flush=True)
print(repr(s.getvalue()))
b = io.BytesIO()
w = io.TextIOWrapper(b, 'utf-8', newline='\r\n')
print('é', file=w, flush=True)
print(b.getvalue())
for o in objects:
    o.close()
