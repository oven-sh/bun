# The abstract classes of _io, through subclasses written in Python.
import _io

def t(f, *a, **k):
    try:
        r = f(*a, **k)
    except BaseException as e:
        print(type(e).__name__ + ':', e)
    else:
        print(repr(r))

print('--- plain _IOBase')
b = _io._IOBase()
print(type(b).__name__, b.closed, b.readable(), b.writable(), b.seekable())
t(b.isatty)
t(b.fileno)
t(b.seek, 0)
t(b.seek, 0, 1)
t(b.seek, 'x')
t(b.tell)
t(b.truncate)
t(b.truncate, 3)
t(b.flush)
t(b._checkClosed)
t(b._checkReadable)
t(b._checkWritable)
t(b._checkSeekable)
t(b.readline)
t(b.readlines)
t(b.writelines, [])
t(b.writelines, [b'x'])
print(b.__dict__)
b.x = 1
print(b.__dict__)
t(setattr, b, '__dict__', {})
t(setattr, b, 'closed', True)
print(iter(b) is b)
with b as c:
    print(c is b, b.closed)
print(b.closed, sorted(b.__dict__))
t(b.flush)
t(b.close)
t(b.isatty)
t(b.__enter__)
t(iter, b)
t(b._checkClosed)
t(b.writelines, [])
t(b.readable)
t(b.__exit__)
t(b.__exit__, 1, 2, 3, 4)

print('--- order of the calls in close()')
class Log(_io._IOBase):
    def flush(self):
        print('flush, closed =', self.closed)
        super().flush()
l = Log()
l.close()
l.close()
print(l.closed)

class BadFlush(_io._IOBase):
    def flush(self):
        raise OSError('flush failed')
f = BadFlush()
t(f.close)
print(f.closed)
t(f.close)

class BadBoth(_io._IOBase):
    def flush(self):
        raise OSError('flush failed')
    def __setattr__(self, name, value):
        raise RuntimeError('cannot set ' + name)
f = BadBoth()
try:
    f.close()
except RuntimeError as e:
    print('RuntimeError:', e, '| context:', repr(e.__context__))
object.__setattr__(f, '_BadBoth__x', 1)

print('--- closed is looked up on the object')
class Closed(_io._IOBase):
    closed = True
c = Closed()
t(c.isatty)
t(c._checkClosed)
t(c.__enter__)
t(c.flush)
class NoClosed(_io._IOBase):
    @property
    def closed(self):
        raise AttributeError('closed')
n = NoClosed()
t(n.isatty)
class BadClosed(_io._IOBase):
    @property
    def closed(self):
        raise KeyError('closed')
n = BadClosed()
t(n.isatty)

print('--- _check*')
class Caps(_io._IOBase):
    def __init__(self, v):
        self.v = v
    def readable(self): return self.v
    def writable(self): return self.v
    def seekable(self): return self.v
for v in (True, False, 1, None, 'yes'):
    c = Caps(v)
    t(c._checkReadable)
    t(c._checkWritable)
    t(c._checkSeekable)

print('--- readline through read()')
class R(_io._IOBase):
    def __init__(self, data):
        self.data = data
        self.calls = []
    def read(self, n):
        self.calls.append(n)
        r, self.data = self.data[:n], self.data[n:]
        return r
r = R(b'ab\ncd\n\nef')
print(r.readline(), r.calls)
print(r.readline(1), r.readline(None), r.readline(0), r.readline(-5))
print(r.readline(), r.readline(), r.readline())
t(r.readline, 'x')
t(r.readline, 1.5)
t(r.readline, 1, 2)
r = R(b'ab\ncd\n\nef')
print(list(r))
r = R(b'ab\ncd\n\nef')
print(r.readlines())
for hint in (0, -1, None, 1, 2, 3, 4, 5, 6, 7, 100):
    r = R(b'ab\ncd\n\nef')
    print(hint, r.readlines(hint))
r = R(b'ab\ncd')
print(next(r), next(r))
t(next, r)
t(next, r)

class BadRead(_io._IOBase):
    def read(self, n):
        return 'text'
t(BadRead().readline)
class NoneRead(_io._IOBase):
    def read(self, n):
        return None
t(NoneRead().readline)
class ArrayRead(_io._IOBase):
    def read(self, n):
        return bytearray(b'x')
t(ArrayRead().readline)

print('--- readline through peek()')
class P(R):
    def peek(self, n):
        self.calls.append(('peek', n))
        return self.data[:4]
p = P(b'ab\ncdefghi\nj')
print(p.readline(), p.calls)
p.calls.clear()
print(p.readline(), p.calls)
p.calls.clear()
print(p.readline(), p.calls)
p.calls.clear()
print(p.readline(), p.calls)
p = P(b'abcdefghij')
print(p.readline(6), p.calls)
p = P(b'abcdefghij')
print(p.readline(3), p.calls)
class BadPeek(R):
    def peek(self, n):
        return 'x'
t(BadPeek(b'abc').readline)

print('--- interrupted calls are retried')
import errno
class Interrupted(R):
    n = 0
    def read(self, n):
        self.n += 1
        if self.n % 2:
            raise OSError(errno.EINTR, 'interrupted')
        return super().read(n)
print(Interrupted(b'ab\nc').readline())
class Failing(R):
    def read(self, n):
        raise OSError(errno.EIO, 'io error')
t(Failing(b'').readline)

print('--- __next__ with odd readline()')
class N(_io._IOBase):
    def __init__(self, *values):
        self.values = list(values)
    def readline(self):
        return self.values.pop(0)
print(list(N('a', [1], (2, 3), '')))
t(next, N(5))
t(next, N(None))

print('--- writelines')
class W(_io._IOBase):
    def __init__(self):
        self.written = []
    def write(self, x):
        self.written.append(x)
w = W()
w.writelines([b'a', 'b', 3])
w.writelines(iter('xyz'))
print(w.written)
t(w.writelines, 5)
t(w.writelines, None)
w.close()
t(w.writelines, [b'a'])

print('--- _RawIOBase')
raw = _io._RawIOBase()
t(raw.read)
t(raw.read, 5)
t(raw.readall)
t(raw.readinto, bytearray(2))
t(raw.readinto)
t(raw.write, b'x')
t(raw.write)
print(isinstance(raw, _io._IOBase), _io._RawIOBase.__mro__)

class Raw(_io._RawIOBase):
    def __init__(self, *chunks):
        self.chunks = list(chunks)
        self.sizes = []
    def readinto(self, b):
        self.sizes.append((type(b).__name__, len(b)))
        if not self.chunks:
            return 0
        c = self.chunks.pop(0)
        if c is None:
            return None
        if len(c) > len(b):
            self.chunks.insert(0, c[len(b):])
            c = c[:len(b)]
        b[:len(c)] = c
        return len(c)
r = Raw(b'abc', b'de', None, b'f')
print(r.read(5), r.read(2), r.read(3), r.read(1), r.read(1), r.sizes)
r = Raw(b'abc', b'de', b'f')
print(r.read(), r.sizes)
r = Raw(b'abc', b'de', b'f')
print(r.read(-1), r.read(-7), r.readall())
r = Raw(b'abc', None, b'f')
print(r.readall(), r.readall(), r.readall())
r = Raw(None)
print(r.readall())
r = Raw()
print(r.read(0), r.sizes)
t(r.read, None)
t(r.read, 'x')
t(r.read, 2 ** 70)
print(Raw(b'ab\n', b'c\nd').readlines())

class BadCount(_io._RawIOBase):
    def __init__(self, v):
        self.v = v
    def readinto(self, b):
        return self.v
for v in (-1, 6, 'x', 2 ** 70, 1.5):
    t(BadCount(v).read, 5)
class BadReadall(_io._RawIOBase):
    def read(self, n=-1):
        return 'text'
t(BadReadall().readall)

print('--- _BufferedIOBase')
bb = _io._BufferedIOBase()
t(bb.read)
t(bb.read, 3)
t(bb.read, 'x')
t(bb.read1)
t(bb.read1, 3)
t(bb.write, b'x')
t(bb.detach)
t(bb.readinto, bytearray(3))
t(bb.readinto1, bytearray(3))
t(bb.readinto, b'abc')
t(bb.readinto, None)
t(bb.readinto1, 'abc')
class B(_io._BufferedIOBase):
    def __init__(self, result):
        self.result = result
    def read(self, n):
        print('read', n)
        return self.result
    def read1(self, n):
        print('read1', n)
        return self.result
a = bytearray(b'.....')
print(B(b'xy').readinto(a), a)
print(B(b'z').readinto1(a), a)
print(B(b'').readinto(a), a)
print(B(b'12345').readinto(a), a)
t(B(b'123456').readinto, a)
t(B('12').readinto, a)
t(B(None).readinto1, a)
t(B(bytearray(b'1')).readinto, a)
print(a)

print('--- _TextIOBase')
tb = _io._TextIOBase()
t(tb.read)
t(tb.read, 2)
t(tb.readline)
t(tb.write, 'x')
t(tb.write, b'x')
t(tb.write, None)
t(tb.detach)
print(tb.encoding, tb.newlines, tb.errors)
t(setattr, tb, 'encoding', 'x')
t(next, tb)
t(tb.readlines)

print('--- the types')
for name in ('_IOBase', '_RawIOBase', '_BufferedIOBase', '_TextIOBase'):
    cls = getattr(_io, name)
    print(cls, cls.__name__, cls.__qualname__, cls.__module__, cls.__bases__, type(cls.__doc__).__name__)
    t(setattr, cls, 'x', 1)
print(repr(_io._IOBase())[:23])
t(_io._IOBase, 1)
t(_io._IOBase, x=1)
class Multi(_io._RawIOBase, _io._BufferedIOBase):
    pass
print([c.__name__ for c in Multi.__mro__])
t(Multi().read, 1)
