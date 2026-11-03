# _io.BufferedWriter, over raw streams written in Python that record how they are called.
import _io, errno

def t(f, *a, **k):
    try:
        r = f(*a, **k)
    except BaseException as e:
        print(type(e).__name__ + ':', e)
    else:
        print(repr(r))

class Raw(_io._RawIOBase):
    """Takes at most `limit` bytes at a time. An item of `script` replaces the result of a call."""
    def __init__(self, limit=None, script=()):
        self.limit = limit
        self.script = list(script)
        self.log = []
        self.data = bytearray()
    def writable(self):
        return True
    def write(self, b):
        b = bytes(b)
        if self.script:
            r = self.script.pop(0)
            if r is None or not isinstance(r, int):
                self.log.append(('write', b, r))
                if isinstance(r, BaseException):
                    raise r
                return r
            b = b[:r]
        elif self.limit is not None:
            b = b[:self.limit]
        self.data += b
        self.log.append(('write', b))
        return len(b)
    def take(self):
        log, self.log = self.log, []
        return log

class SeekRaw(Raw):
    def __init__(self, data=b''):
        super().__init__()
        self.data = bytearray(data)
        self.pos = 0
    def seekable(self): return True
    def write(self, b):
        b = bytes(b)
        self.log.append(('write', b))
        if self.pos > len(self.data):
            self.data += bytes(self.pos - len(self.data))
        self.data[self.pos:self.pos + len(b)] = b
        self.pos += len(b)
        return len(b)
    def seek(self, pos, whence=0):
        self.log.append(('seek', pos, whence))
        if whence == 0: self.pos = pos
        elif whence == 1: self.pos += pos
        else: self.pos = len(self.data) + pos
        return self.pos
    def tell(self):
        self.log.append(('tell',))
        return self.pos
    def truncate(self, size=None):
        self.log.append(('truncate', size))
        if size is None: size = self.pos
        del self.data[size:]
        return size

BW = _io.BufferedWriter

print('--- construction')
r = Raw()
b = BW(r)
print(b.raw is r, b.closed, b.writable(), b.seekable(), b.isatty(), repr(b), r.take())
t(b.readable)
t(b.fileno)
t(b.read)
t(b.read, 1)
t(b.read1)
t(b.readline)
t(b.readinto, bytearray(1))
t(getattr, b, 'peek')
t(next, b)
t(BW)
t(BW, r, 0)
t(BW, r, -1)
t(BW, r, 'x')
t(BW, r, 10, 5)
t(BW, r, bad=1)
t(BW, raw=r, buffer_size=16)
t(BW, 5)
t(BW, _io._RawIOBase())
class NotWritable(_io._RawIOBase):
    def writable(self): return False
t(BW, NotWritable())
t(b.__getstate__)

print('--- write')
r = Raw()
b = BW(r, 8)
print(b.write(b'abc'), r.take(), b.write(b'de'), r.take(), b.write(b'fgh'), r.take(), b.write(b'i'), r.take(), b.flush(), r.take())
print(b.write(b''), r.take(), b.flush(), r.take())
print(b.write(b'12345678'), r.take(), b.write(b'123456789'), r.take(), b.write(b'1234567'), r.take(), b.write(b'x' * 20), r.take(), b.flush(), r.take())
print(b.write(b'abc'), b.write(b'x' * 8), r.take(), b.write(b'abc'), b.write(b'x' * 7), r.take(), b.flush(), r.take())
print(b.write(bytearray(b'by')), b.flush(), r.take())
t(b.write, 'x')
t(b.write, 5)
t(b.write, None)
t(b.write)
b.writelines([b'a', b'bc', b'defghijkl', b'm'])
print(r.take(), b.flush(), r.take())
print(bytes(r.data)[-20:])

print('--- the argument is copied at once')
r = Raw()
b = BW(r, 8)
a = bytearray(b'abc')
b.write(a)
a[:] = b'xyz'
b.flush()
print(r.take())

print('--- partial writes')
r = Raw(limit=3)
b = BW(r, 8)
print(b.write(b'abcdefg'), r.take(), b.flush(), r.take())
print(b.write(b'0123456789abcdefghij'), r.take(), b.flush(), r.take())
r = Raw(script=[0, 0, 2, 1])
b = BW(r, 8)
print(b.write(b'abc'), b.flush(), r.take())

print('--- would block')
def fl(b):
    try:
        b.flush()
    except BlockingIOError as e:
        return 'blocked', e.characters_written
    return 'flushed'
def blocking(f, *a):
    try:
        r = f(*a)
    except BlockingIOError as e:
        print('BlockingIOError', e.args[1:], e.characters_written, type(e.errno).__name__)
    else:
        print(repr(r))
r = Raw(script=[None])
b = BW(r, 8)
print(b.write(b'abc'), r.take())
blocking(b.flush)
print(r.take(), fl(b), r.take())
r = Raw(script=[2, None])
b = BW(r, 8)
b.write(b'abcdef')
blocking(b.flush)
print(r.take(), fl(b), r.take())
# The buffer is full, the raw stream blocks: what fits is buffered.
r = Raw(script=[None])
b = BW(r, 8)
b.write(b'abcdef')
blocking(b.write, b'gh')
print(r.take(), fl(b), r.take())
r = Raw(script=[None, None])
b = BW(r, 8)
b.write(b'abcdef')
blocking(b.write, b'ghijk')
print(r.take())
blocking(b.write, b'l')
print(r.take(), fl(b), r.take())
r = Raw(script=[3, None])
b = BW(r, 8)
b.write(b'abcdef')
blocking(b.write, b'ghijk')
print(r.take(), fl(b), r.take())
r = Raw(script=[3, None])
b = BW(r, 8)
b.write(b'abcdef')
blocking(b.write, b'ghijklmnop')
print(r.take(), fl(b), r.take())
# A large write to an empty buffer.
r = Raw(script=[None])
b = BW(r, 8)
blocking(b.write, b'0123456789abcdef')
print(r.take(), fl(b), r.take())
r = Raw(script=[None])
b = BW(r, 8)
blocking(b.write, b'01234567')
print(r.take(), fl(b), r.take())
r = Raw(script=[5, None])
b = BW(r, 8)
blocking(b.write, b'0123456789abcdefghij')
print(r.take(), fl(b), r.take())
r = Raw(script=[12, None])
b = BW(r, 8)
blocking(b.write, b'0123456789abcdefghij')
print(r.take(), fl(b), r.take())

print('--- what the raw stream may get wrong')
for v in (-1, 100, 'x', 1.5, 2 ** 70, []):
    class Bad(_io._RawIOBase):
        def writable(self): return True
        def write(self, b): return v
    b = BW(Bad(), 8)
    b.write(b'abc')
    t(b.flush)
    Bad.write = lambda self, b: len(b)
r = Raw(script=[KeyError('boom')])
b = BW(r, 8)
b.write(b'abc')
t(b.flush)
print(r.take(), b.flush(), r.take())
r = Raw(script=[KeyError('boom')])
b = BW(r, 8)
b.write(b'abc')
t(b.write, b'x' * 10)
print(r.take(), b.flush(), r.take())
r = Raw(script=[OSError(errno.EINTR, 'interrupted'), 2, OSError(errno.EINTR, 'interrupted')])
b = BW(r, 8)
b.write(b'abc')
print(b.flush(), [e[:2] for e in r.take()])

print('--- seek, tell, truncate')
r = SeekRaw()
b = BW(r, 8)
print(r.take())
print(b.tell(), r.take(), b.write(b'abc'), b.tell(), r.take(), b.seek(1), r.take(), b.write(b'X'), b.tell(), r.take(), b.flush(), r.take(), bytes(r.data))
print(b.seek(0, 2), r.take(), b.write(b'de'), b.seek(-1, 1), r.take(), b.write(b'Y'), b.seek(0, 1), r.take(), bytes(r.data))
print(b.seek(10), b.write(b'z'), b.flush(), bytes(r.data), r.take())
print(b.write(b'123'), b.truncate(), r.take(), bytes(r.data), b.tell())
print(b.truncate(2), r.take(), bytes(r.data), b.tell(), b.truncate(None), bytes(r.data))
print(b.seek(0), b.write(b'q'), b.truncate(1), r.take(), bytes(r.data))
t(b.seek, 0, 5)
t(b.seek, 'x')
t(b.seek, 2 ** 70)
b = BW(Raw(), 8)
t(b.seek, 0)
t(b.tell)
t(b.truncate)
b.write(b'ab')
t(b.tell)

print('--- close')
class CloseLog(Raw):
    def close(self):
        print('  raw.close, closed =', self.closed)
        super().close()
    def flush(self):
        print('  raw.flush')
        super().flush()
r = CloseLog()
b = BW(r, 8)
b.write(b'abc')
print(b.close(), r.take(), b.closed, r.closed, b.close(), repr(b))
for m in ('flush', 'tell', 'truncate', 'writable', 'seekable', 'isatty', '__enter__'):
    print(m, end=' ')
    t(getattr(b, m))
t(b.write, b'x')
t(b.write, b'')
t(b.write, 'x')
t(b.writelines, [])
t(b.seek, 0)
with BW(Raw(), 8) as c:
    c.write(b'ctx')
print(c.closed, c.raw.take())
# The flush fails: the raw stream is closed all the same.
r = Raw(script=[OSError('write failed')])
b = BW(r, 8)
b.write(b'abc')
t(b.close)
print(b.closed, r.closed)
class BadClose(Raw):
    def close(self):
        super().close()
        raise KeyError('close failed')
r = BadClose(script=[OSError('write failed')])
b = BW(r, 8)
b.write(b'abc')
try:
    b.close()
except KeyError as e:
    print(repr(e), repr(e.__context__))
print(b.closed)
r = Raw()
b = BW(r, 8)
b.write(b'abc')
r.close()
print(b.closed)
t(b.write, b'x')
t(b.flush)
t(b.close)

print('--- detach')
r = Raw()
b = BW(r, 8)
b.write(b'abc')
print(b.detach() is r, r.take(), b.raw, repr(b), r.closed)
for m in ('flush', 'close', 'detach', 'tell', 'writable'):
    print(m, end=' ')
    t(getattr(b, m))
t(b.write, b'x')
t(getattr, b, 'closed')
r = Raw(script=[OSError('write failed')])
b = BW(r, 8)
b.write(b'abc')
t(b.detach)
print(b.raw is r, b.detach() is r, r.take())

print('--- uninitialized')
b = BW.__new__(BW)
print(b.raw, repr(b))
t(b.write, b'x')
t(b.flush)
t(b.close)
t(getattr, b, 'closed')
b.__init__(Raw(), 4)
print(b.write(b'ok'), b.flush(), b.raw.take())

print('--- reentrant calls')
class Reenter(Raw):
    def write(self, b):
        self.buffered.flush()
        return len(b)
r = Reenter()
r.buffered = BW(r, 4)
r.buffered.write(b'ab')
t(r.buffered.flush)
Reenter.write = Raw.write

print('--- subclasses')
class Sub(BW):
    def flush(self):
        print('  Sub.flush')
        super().flush()
s = Sub(Raw(), 8)
s.write(b'abc')
s.close()
print(s.raw.take(), repr(s), [c.__name__ for c in Sub.__mro__])

print('--- over a BytesIO')
raw = _io.BytesIO()
b = BW(raw, 8)
print(b.write(b'hello'), raw.getvalue(), b.write(b' world'), raw.getvalue(), b.tell(), b.seek(0), raw.getvalue(), b.write(b'J'), b.flush(), raw.getvalue())

print('--- the type')
print(BW, BW.__name__, BW.__qualname__, BW.__module__, BW.__bases__)
