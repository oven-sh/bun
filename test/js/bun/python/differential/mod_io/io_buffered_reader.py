# _io.BufferedReader, over raw streams written in Python that record how they are called.
import _io, errno

def t(f, *a, **k):
    try:
        r = f(*a, **k)
    except BaseException as e:
        print(type(e).__name__ + ':', e)
    else:
        print(repr(r))

class Raw(_io._RawIOBase):
    """Hands out the chunks one by one. None: it would block."""
    def __init__(self, *chunks):
        self.chunks = list(chunks)
        self.log = []
    def readable(self):
        return True
    def readinto(self, b):
        n = len(b)
        if not self.chunks:
            self.log.append(('readinto', n, 0))
            return 0
        c = self.chunks[0]
        if c is None:
            del self.chunks[0]
            self.log.append(('readinto', n, None))
            return None
        c, rest = c[:n], c[n:]
        if rest:
            self.chunks[0] = rest
        else:
            del self.chunks[0]
        b[:len(c)] = c
        self.log.append(('readinto', n, len(c)))
        return len(c)
    def take(self):
        log, self.log = self.log, []
        return log

class SeekRaw(_io._RawIOBase):
    """A file in memory."""
    def __init__(self, data):
        self.data = bytearray(data)
        self.pos = 0
        self.log = []
    def readable(self): return True
    def seekable(self): return True
    def readinto(self, b):
        c = self.data[self.pos:self.pos + len(b)]
        b[:len(c)] = c
        self.pos += len(c)
        self.log.append(('readinto', len(b), len(c)))
        return len(c)
    def seek(self, pos, whence=0):
        self.log.append(('seek', pos, whence))
        if whence == 0: self.pos = pos
        elif whence == 1: self.pos += pos
        else: self.pos = len(self.data) + pos
        return self.pos
    def tell(self):
        self.log.append(('tell',))
        return self.pos
    def take(self):
        log, self.log = self.log, []
        return log

BR = _io.BufferedReader

print('--- construction')
r = Raw(b'abc')
b = BR(r)
print(b.raw is r, b.closed, b.readable(), b.seekable(), b.isatty(), repr(b), r.take())
t(b.writable)
t(b.fileno)
t(getattr, b, 'name')
t(getattr, b, 'mode')
t(b.write, b'x')
t(BR)
t(BR, r, 0)
t(BR, r, -1)
t(BR, r, 'x')
t(BR, r, 1.5)
t(BR, r, 10, 5)
t(BR, r, bad=1)
t(BR, raw=r, buffer_size=16)
t(BR, 5)
t(BR, None)
t(BR, _io._RawIOBase())
t(BR, _io.BytesIO(b'x'))
class NotReadable(_io._RawIOBase):
    def readable(self): return False
t(BR, NotReadable())
class Truthy(_io._RawIOBase):
    def readable(self): return 1
t(BR, Truthy())
t(setattr, b, 'raw', r)
t(delattr, b, 'raw')
t(setattr, b, 'closed', True)
print(b._finalizing)
t(setattr, b, '_finalizing', 2)
t(b.__getstate__)
print(type(b.__sizeof__()).__name__)
b.extra = 1
print(b.__dict__)

print('--- read(n)')
r = Raw(b'abcdefghijklmnopqrstuvwxyz')
b = BR(r, 8)
print(b.read(3), r.take())
print(b.read(3), r.take())
print(b.read(3), r.take())
print(b.read(0), r.take())
print(b.read(10), r.take())
print(b.read(100), r.take())
print(b.read(1), r.take())
r = Raw(b'abc', b'defg', b'h', b'ijklmnop')
b = BR(r, 4)
print(b.read(2), r.take(), b.read(4), r.take(), b.read(9), r.take(), b.read(9), r.take())
r = Raw(b'x' * 100)
b = BR(r, 10)
print(len(b.read(35)), r.take(), len(b.read(5)), r.take(), len(b.read(20)), r.take(), len(b.read(40)), r.take(), b.read(1), r.take())
r = Raw(b'x' * 100)
b = BR(r, 16)
print(len(b.read(35)), r.take(), len(b.read(13)), r.take(), len(b.read(16)), r.take())
t(b.read, -2)
t(b.read, 'x')
t(b.read, 1.5)
t(b.read, 2 ** 70)

print('--- read()')
r = Raw(b'abc', b'def', b'g')
b = BR(r, 4)
print(b.read(), r.take(), b.read(), r.take())
r = Raw(b'abc', b'def', b'g')
b = BR(r, 4)
print(b.read(1), b.read(None), r.take())
r = Raw(b'abc', b'def', b'g')
b = BR(r, 4)
print(b.read(1), b.read(-1), r.take())
class NoReadall:
    """Not an _IOBase at all."""
    closed = False
    def __init__(self, *chunks):
        self.chunks = list(chunks)
    def readable(self): return True
    def readinto(self, b):
        c = self.read(len(b))
        b[:len(c)] = c
        return len(c)
    def read(self, n=-1):
        print('  raw.read', n)
        return self.chunks.pop(0) if self.chunks else b''
    def flush(self):
        pass
    def close(self):
        self.closed = True
b = BR(NoReadall(b'ab', b'cd', b'e'), 4)
print(b.read())
b = BR(NoReadall(b'ab', b'cd', None, b'e'), 4)
print(b.read(1), b.read(), b.read(), b.read())
b = BR(NoReadall(None), 4)
print(b.read())
b = BR(NoReadall('text'), 4)
t(b.read)
class BadReadall(Raw):
    def readall(self):
        return 'text'
t(BR(BadReadall(b'a')).read)
class NoneReadall(Raw):
    def readall(self):
        return None
b = BR(NoneReadall(b'abc'), 2)
print(b.read(), b.read(1), b.read())

print('--- would block')
r = Raw(b'abc', None, b'de', None, None, b'f')
b = BR(r, 4)
print(b.read(5), r.take(), b.read(5), r.take(), b.read(5), r.take(), b.read(5), r.take(), b.read(5), r.take())
r = Raw(None, b'ab', None)
b = BR(r, 4)
print(b.read1(3), b.read1(3), b.read1(3), b.read1(3), r.take())
r = Raw(None, b'ab', None)
b = BR(r, 4)
print(b.peek(), b.peek(), b.read(2), b.peek(), b.peek(), r.take())
r = Raw(None, b'ab\ncd', None, b'e\n')
b = BR(r, 4)
print(b.readline(), b.readline(), b.readline(), b.readline(), b.readline(), r.take())
r = Raw(None, b'ab', None, b'cd')
b = BR(r, 4)
a = bytearray(3)
print(b.readinto(a), a, b.readinto(a), a, b.readinto(a), a, b.readinto(a), a, b.readinto(a), r.take())
r = Raw(b'ab', None)
b = BR(r, 4)
print(b.read(), r.take())
r = Raw(None)
b = BR(r, 4)
print(b.read(), r.take())

print('--- read1')
r = Raw(b'abcdefghij', b'klm')
b = BR(r, 4)
print(b.read1(2), r.take(), b.read(1), r.take(), b.read1(10), r.take(), b.read1(10), r.take(), b.read1(), r.take(), b.read1(-1), r.take(), b.read1(0), b.read1(), r.take())
t(b.read1, None)
t(b.read1, 'x')

print('--- peek')
r = Raw(b'abcdefghij')
b = BR(r, 4)
print(b.peek(), r.take(), b.peek(1), b.peek(100), b.peek(-1), r.take(), b.read(3), b.peek(2), r.take(), b.read(1), b.peek(), r.take())
b.read()
print(b.peek(), r.take())
t(b.peek, None)
t(b.peek, 'x')

print('--- readinto')
r = Raw(b'abcdefghijklmnopqrstuvwxyz')
b = BR(r, 4)
a = bytearray(3)
print(b.readinto(a), a, r.take(), b.readinto(a), a, r.take())
a = bytearray(10)
print(b.readinto(a), a, r.take())
a = bytearray(4)
print(b.readinto(a), a, r.take(), b.readinto(bytearray()), r.take())
a = bytearray(20)
print(b.readinto(a), a, r.take(), b.readinto(a), r.take())
t(b.readinto, b'abc')
t(b.readinto, 'abc')
t(b.readinto, None)
r = Raw(b'abc', b'defgh', b'ijklmnopqrstuvwxyz')
b = BR(r, 4)
a = bytearray(6)
print(b.readinto1(a), a, r.take(), b.readinto1(a), a, r.take(), b.read(1), r.take(), b.readinto1(a), a, r.take(), b.readinto1(a), a, r.take())
a = bytearray(2)
print(b.readinto1(a), a, r.take(), b.readinto1(a), a, r.take())

print('--- lines')
r = Raw(b'one\ntwo\n\nthree and more\nlast')
b = BR(r, 6)
print(b.readline(), r.take(), b.readline(), r.take(), b.readline(), r.take(), b.readline(), r.take(), b.readline(), r.take(), b.readline(), r.take())
b = BR(Raw(b'one\ntwo\n\nthree and more\nlast'), 6)
print(b.readline(2), b.readline(0), b.readline(None), b.readline(-1), b.readline(100), b.readline(8), b.readline(8), b.readline(4), b.readline(4))
b = BR(Raw(b'one\ntwo\n\nthree and more\nlast'), 6)
print(b.readlines())
b = BR(Raw(b'one\ntwo\n\nthree and more\nlast'), 6)
print(b.readlines(5), list(b), list(b))
b = BR(Raw(b'a\nb'), 6)
print(next(b), next(b), iter(b) is b)
t(next, b)
t(b.readline, 'x')
t(b.readline, 1.5)
b = BR(Raw(b'ab', b'cd', b'\n', b'ef'), 100)
print(b.readline(), b.readline())

print('--- seek and tell')
r = SeekRaw(b'0123456789abcdefghij')
b = BR(r, 8)
print(r.take())
print(b.tell(), r.take(), b.read(2), r.take(), b.tell(), r.take())
print(b.seek(4), r.take(), b.read(1), b.seek(0), r.take(), b.read(1), b.seek(8), r.take(), b.read(1), r.take())
print(b.seek(2, 1), r.take(), b.read(1), b.seek(-3, 1), r.take(), b.read(1), b.seek(-9, 1), r.take(), b.read(1), r.take())
print(b.seek(-2, 2), r.take(), b.read(), r.take(), b.tell(), r.take())
print(b.seek(100), b.read(), b.read(1), b.tell(), r.take())
print(b.seek(0, 1), b.seek(0, 0), b.seek(True), b.seekable())
t(b.seek, 0, 5)
t(b.seek, 0, -1)
t(b.seek, 'x')
t(b.seek, 1.5)
t(b.seek, 0, 'x')
t(b.seek, 2 ** 70)
t(b.seek)
t(b.truncate)
t(b.truncate, 5)
b = BR(Raw(b'abc'), 8)
t(b.seek, 0)
t(b.tell)
print(b.read(1))
t(b.tell)
class BadTell(SeekRaw):
    def __init__(self, data, value):
        super().__init__(data)
        self.value = value
    def tell(self):
        return self.value
    def seek(self, pos, whence=0):
        return self.value
for v in (-1, -5, 'x', None, 2 ** 70, 1.5):
    b = BR(BadTell(b'abc', v))
    t(b.tell)
    t(b.seek, 1)
class NegativeTell(SeekRaw):
    def tell(self):
        return 2
b = BR(NegativeTell(b'0123456789'), 8)
print(b.read(1), b.tell())

print('--- what the raw stream may get wrong')
class BadReadinto(_io._RawIOBase):
    def __init__(self, v): self.v = v
    def readable(self): return True
    def readinto(self, b): return self.v
for v in (-1, 100, 'x', 1.5, 2 ** 70, []):
    b = BR(BadReadinto(v), 8)
    t(b.read, 1)
# One byte, of a buffer that nothing has written to.
print(len(BR(BadReadinto(True), 8).read(1)))
try:
    BR(BadReadinto('x'), 8).read(1)
except OSError as e:
    print(repr(e), repr(e.__cause__), e.__cause__ is e.__context__, e.__suppress_context__)
class Raising(Raw):
    def readinto(self, b):
        raise KeyError('boom')
for m, a in (('read', (1,)), ('read', ()), ('read1', ()), ('peek', ()), ('readline', ()), ('readinto', (bytearray(1),))):
    t(getattr(BR(Raising(), 8), m), *a)
class Interrupted(Raw):
    n = 0
    def readinto(self, b):
        self.n += 1
        if self.n % 2:
            raise OSError(errno.EINTR, 'interrupted')
        return super().readinto(b)
b = BR(Interrupted(b'abc', b'def'), 4)
print(b.read(5), b.read())

print('--- reentrant calls')
class Reenter(Raw):
    def readinto(self, b):
        return self.buffered.readinto(b)
r = Reenter(b'abc')
r.buffered = BR(r, 4)
t(r.buffered.read, 1)
t(r.buffered.peek)
print(r.buffered.closed)

print('--- close')
class CloseLog(Raw):
    def close(self):
        print('  raw.close, closed =', self.closed)
        super().close()
    def flush(self):
        print('  raw.flush')
        super().flush()
r = CloseLog(b'abc')
b = BR(r, 4)
print(b.read(1), b.flush(), b.close(), b.closed, r.closed, b.close(), repr(b))
for m in ('read', 'read1', 'peek', 'readline', 'readlines', 'flush', '__next__', '__enter__', '__iter__', 'isatty', 'readable', 'seekable', 'tell'):
    print(m, end=' ')
    t(getattr(b, m))
t(b.read, 0)
t(b.read, 1)
t(b.seek, 0)
t(b.readinto, bytearray(1))
t(b.readinto1, bytearray(1))
t(b.truncate)
print(b.raw is r)
with BR(Raw(b'x')) as c:
    print(c.read())
print(c.closed, c.raw.closed)
# The raw stream is closed behind its back: what is in the buffer can still be read.
r = Raw(b'abcdef')
b = BR(r, 4)
print(b.read(1))
r.close()
print(b.closed, b.read(1), b.peek(), b.readline(), end=' ')
t(b.read, 1)
class BadClose(Raw):
    def close(self):
        super().close()
        raise OSError('close failed')
b = BR(BadClose(b'a'))
t(b.close)
print(b.closed)
class BadFlush(Raw):
    def flush(self):
        raise OSError('flush failed')
b = BR(BadFlush(b'a'))
t(b.close)
print(b.closed, b.raw.closed)
class BadBoth(Raw):
    def flush(self):
        raise OSError('flush failed')
    def close(self):
        raise KeyError('close failed')
b = BR(BadBoth(b'a'))
try:
    b.close()
except KeyError as e:
    print(repr(e), repr(e.__context__))
BadBoth.close = Raw.close
BadBoth.flush = Raw.flush

print('--- detach')
r = Raw(b'abcdef')
b = BR(r, 4)
print(b.read(1), b.detach() is r, b.raw, repr(b), r.closed)
for m in ('read', 'read1', 'peek', 'readline', 'flush', 'close', 'detach', 'tell', 'readable', 'seekable', 'isatty', 'fileno', '__next__'):
    print(m, end=' ')
    t(getattr(b, m))
t(getattr, b, 'closed')
t(getattr, b, 'name')
t(getattr, b, 'mode')
t(b.seek, 0)
print(r.read())

print('--- uninitialized')
b = BR.__new__(BR)
print(b.raw, repr(b))
for m in ('read', 'read1', 'peek', 'readline', 'flush', 'close', 'detach', 'tell', 'readable', '__next__'):
    print(m, end=' ')
    t(getattr(b, m))
t(getattr, b, 'closed')
t(b.__init__, NotReadable())
t(b.read)
b.__init__(Raw(b'ok'))
print(b.read())
t(b.__init__, Raw(b'x'), 0)
t(b.read)
b.__init__(Raw(b'again'), 2)
print(b.read(3), b.read())

print('--- name and mode come from the raw stream')
r = Raw(b'')
r.name = 'the name'
r.mode = 'the mode'
b = BR(r)
print(b.name, b.mode, repr(b))
r.name = b
t(repr, b)
r.name = 5
print(repr(b))
class BadName(Raw):
    @property
    def name(self):
        raise KeyError('name')
t(repr, BR(BadName()))
class ValueName(Raw):
    @property
    def name(self):
        raise ValueError('name')
t(repr, BR(ValueName()))

print('--- subclasses')
class Sub(BR):
    def readline(self, *a):
        print('  Sub.readline')
        return super().readline(*a)
s = Sub(Raw(b'a\nb\n'), 4)
print(list(s), repr(s), [c.__name__ for c in Sub.__mro__])
class BadLine(BR):
    def readline(self):
        return 'x'
t(next, BadLine(Raw(b'a')))
t(Sub(Raw()).__getstate__)

print('--- over a BytesIO')
b = BR(_io.BytesIO(b'0123456789' * 3), 8)
print(b.read(5), b.tell(), b.seek(12), b.read(3), b.peek(), b.read(), b.tell(), b.seekable())

print('--- the type')
print(BR, BR.__name__, BR.__qualname__, BR.__module__, BR.__bases__)
t(setattr, BR, 'x', 1)
