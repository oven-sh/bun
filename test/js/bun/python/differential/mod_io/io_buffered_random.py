# _io.BufferedRandom and _io.BufferedRWPair
import _io

def t(f, *a, **k):
    try:
        r = f(*a, **k)
    except BaseException as e:
        print(type(e).__name__ + ':', e)
    else:
        print(repr(r))

class Raw(_io._RawIOBase):
    """A file in memory that records how it is called."""
    def __init__(self, data=b''):
        self.data = bytearray(data)
        self.pos = 0
        self.log = []
    def readable(self): return True
    def writable(self): return True
    def seekable(self): return True
    def readinto(self, b):
        c = self.data[self.pos:self.pos + len(b)]
        b[:len(c)] = c
        self.pos += len(c)
        self.log.append(('readinto', len(b), bytes(c)))
        return len(c)
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
    def take(self):
        log, self.log = self.log, []
        return log

BRandom = _io.BufferedRandom

print('--- construction')
r = Raw(b'0123456789')
b = BRandom(r)
print(b.raw is r, b.closed, b.readable(), b.writable(), b.seekable(), b.isatty(), repr(b), r.take())
t(BRandom)
t(BRandom, r, 0)
t(BRandom, r, bad=1)
t(BRandom, raw=r, buffer_size=16)
class Cap(_io._RawIOBase):
    def __init__(self, r, w, s): self.c = (r, w, s)
    def readable(self):
        print('  readable')
        return self.c[0]
    def writable(self):
        print('  writable')
        return self.c[1]
    def seekable(self):
        print('  seekable')
        return self.c[2]
t(BRandom, Cap(False, True, True))
t(BRandom, Cap(True, False, True))
t(BRandom, Cap(True, True, False))
t(b.__getstate__)

print('--- reads and writes interleaved')
r = Raw(b'0123456789abcdefghij')
b = BRandom(r, 8)
r.take()
print(b.read(2), r.take(), b.write(b'XY'), r.take(), b.read(2), r.take(), bytes(r.data))
print(b.tell(), r.take(), b.flush(), r.take(), bytes(r.data), b.tell())
print(b.read(3), r.take(), b.write(b'ZZZZZZZZZZ'), r.take(), bytes(r.data), b.tell(), b.read(), r.take())
r = Raw(b'0123456789abcdefghij')
b = BRandom(r, 8)
r.take()
print(b.write(b'AB'), r.take(), b.read(2), r.take(), b.write(b'CD'), b.seek(0), r.take(), b.read(), bytes(r.data))
r = Raw(b'0123456789abcdefghij')
b = BRandom(r, 8)
r.take()
print(b.peek(1), r.take(), b.write(b'A'), b.peek(1), r.take(), b.read1(3), r.take(), b.write(b'B'), b.read1(), r.take(), bytes(r.data))
r = Raw(b'ab\ncd\nef\ngh\n')
b = BRandom(r, 4)
r.take()
print(b.readline(), b.write(b'X'), b.readline(), b.tell(), b.write(b'YZ'), b.readline(), b.readlines(), bytes(r.data))
r = Raw(b'0123456789abcdefghij')
b = BRandom(r, 8)
a = bytearray(3)
print(b.readinto(a), a, b.write(b'--'), b.readinto(a), a, b.readinto1(a), a, b.seek(0), b.read())
r = Raw(b'0123456789')
b = BRandom(r, 4)
print(list(iter(lambda: (b.read(1), b.write(b'.'))[0], b'')), bytes(r.data))

print('--- seek')
r = Raw(b'0123456789abcdefghij')
b = BRandom(r, 8)
r.take()
print(b.seek(3), r.take(), b.read(1), r.take(), b.seek(5), r.take(), b.write(b'W'), b.seek(4), r.take(), b.read(3), r.take())
print(b.seek(-1, 1), b.read(1), b.seek(0, 2), b.write(b'END'), b.seek(-5, 2), b.read(), bytes(r.data))
print(b.seek(30), b.write(b'!'), b.flush(), bytes(r.data))
print(b.seek(1), b.write(b'a'), b.seek(1, 1), b.write(b'b'), b.seek(-4, 1), b.read(5))

print('--- truncate')
r = Raw(b'0123456789abcdefghij')
b = BRandom(r, 8)
r.take()
print(b.read(3), b.truncate(), r.take(), bytes(r.data), b.tell(), b.read())
print(b.seek(0), b.write(b'ABCDE'), b.truncate(4), r.take(), bytes(r.data), b.tell())
print(b.truncate(10), bytes(r.data))

print('--- close, detach')
r = Raw(b'0123')
b = BRandom(r, 8)
b.read(1)
b.write(b'x')
print(b.close(), bytes(r.data), b.closed, r.closed)
t(b.read)
t(b.write, b'x')
t(b.seek, 0)
r = Raw(b'0123')
b = BRandom(r, 8)
b.read(2)
b.write(b'x')
r.take()
print(b.detach() is r, r.take(), bytes(r.data), r.pos)
t(b.read)

print('--- over a BytesIO')
raw = _io.BytesIO(b'hello world')
b = BRandom(raw, 4)
print(b.read(5), b.write(b'_'), b.read(), b.seek(0), b.read(), raw.getvalue())
print(b.seek(0), b.write(b'HELLO, WORLD AND MORE'), b.seek(7), b.read(5), raw.getvalue())

print('--- BufferedRWPair')
Pair = _io.BufferedRWPair
closes = []
class R(_io._RawIOBase):
    def __init__(self, data):
        self.data = data
    def readable(self): return True
    def readinto(self, b):
        c, self.data = self.data[:len(b)], self.data[len(b):]
        b[:len(c)] = c
        return len(c)
    def close(self):
        closes.append('reader')
        super().close()
class W(_io._RawIOBase):
    def __init__(self):
        self.data = b''
    def writable(self): return True
    def write(self, b):
        self.data += bytes(b)
        return len(b)
    def close(self):
        closes.append('writer')
        super().close()
r, w = R(b'abc\ndefghi'), W()
p = Pair(r, w, 4)
print(repr(p)[:28], p.closed, p.readable(), p.writable(), p.seekable(), p.isatty())
print(p.read(1), p.peek(1), p.peek(), p.read1(1), p.read1(), p.readline(), p.read(), p.read(1))
a = bytearray(2)
p2 = Pair(R(b'xyz'), W())
print(p2.readinto(a), a, p2.readinto1(a), a)
print(p.write(b'12'), w.data, p.write(b'345'), w.data, p.flush(), w.data)
t(p.seek, 0)
t(p.tell)
t(p.truncate)
t(p.fileno)
t(p.detach)
t(getattr, p, 'raw')
t(getattr, p, 'name')
t(p.read, size=1)
t(p.write, b=b'x')
t(p.read, 1, 2)
t(p.write)
t(p.flush, 1)
p.write(b'z')
closes.clear()
print(p.close(), p.closed, r.closed, w.closed, w.data, p.close(), closes)
t(p.read)
t(p.write, b'x')
t(p.flush)
t(p.readable)
t(p.isatty)
t(Pair)
t(Pair, R(b''))
t(Pair, R(b''), W(), 4, 5)
t(Pair, R(b''), W(), 0)
t(Pair, R(b''), W(), 'x')
t(Pair, reader=R(b''), writer=W())
t(Pair, W(), W())
t(Pair, R(b''), R(b''))
t(Pair, 1, 2)
p = Pair.__new__(Pair)
t(p.read)
t(p.write, b'x')
t(p.close)
t(getattr, p, 'closed')
t(p.isatty)
class TTY(W):
    def isatty(self): return True
class RTTY(R):
    def isatty(self): return True
print(Pair(R(b''), TTY()).isatty(), Pair(RTTY(b''), W()).isatty(), Pair(RTTY(b''), TTY()).isatty())
class BadCloseW(W):
    def close(self):
        super().close()
        raise OSError('writer')
class BadCloseR(R):
    def close(self):
        super().close()
        raise KeyError('reader')
p = Pair(R(b''), BadCloseW())
t(p.close)
p = Pair(BadCloseR(b''), W())
t(p.close)
p = Pair(BadCloseR(b''), BadCloseW())
try:
    p.close()
except KeyError as e:
    print(repr(e), repr(e.__context__))
with Pair(R(b'q'), W()) as p:
    print(p.read())
print(p.closed)
p = Pair(R(b'a\nb\n'), W())
print(list(p))
p.x = 1
print(p.__dict__)
class SubPair(Pair):
    pass
print([c.__name__ for c in SubPair.__mro__], SubPair(R(b'z'), W()).read())

print('--- the types')
print(BRandom, BRandom.__bases__, Pair, Pair.__bases__, Pair.__module__)
