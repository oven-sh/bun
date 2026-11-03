# The buffer protocol in _io: memoryviews and arrays as arguments, BytesIO.getbuffer(), what raw streams are handed.
import _io, array, posix

D = '/tmp/pyio_buffers_%d' % posix.getpid()
posix.mkdir(D)
posix.chdir(D)

def t(f, *a, **k):
    try:
        r = f(*a, **k)
    except BaseException as e:
        print(type(e).__name__ + ':', e)
    else:
        print(repr(r))

def main():
    print('--- getbuffer')
    b = _io.BytesIO(b'0123456789')
    m = b.getbuffer()
    print(type(m).__name__, len(m), bytes(m), m.readonly, m.format, m.itemsize, m.ndim, m.shape, type(m.obj).__name__)
    m[0] = 65
    m[2:4] = b'XY'
    print(b.getvalue(), b.read(3), b.tell(), b.seek(0), b.readline())
    t(b.write, b'x')
    t(b.write, b'')
    t(b.truncate)
    t(b.truncate, 3)
    t(b.close)
    t(b.__init__, b'new')
    t(b.__setstate__, (b'a', 0, None))
    t(b.writelines, [b'a'])
    print(b.closed, b.getvalue())
    m2 = b.getbuffer()
    m.release()
    t(b.write, b'x')
    m2.release()
    print(b.seek(0), b.write(b'zz'), b.getvalue())
    t(bytes, m)
    with b.getbuffer() as m:
        m[-1] = 33
    print(b.getvalue(), b.truncate(4), b.getvalue())
    data = b'shared'
    b = _io.BytesIO(data)
    with b.getbuffer() as m:
        m[0] = 83
    print(data, b.getvalue())
    b = _io.BytesIO()
    with b.getbuffer() as m:
        print(len(m), bytes(m))
    b.write(b'abc')
    v = b.getvalue()
    with b.getbuffer() as m:
        m[0] = 65
        print(v, b.getvalue(), b.getvalue() is b.getvalue())
    b.seek(10)
    with b.getbuffer() as m:
        print(len(m))
    b.close()
    t(b.getbuffer)
    b = _io.BytesIO(b'abcdef')
    m = b.getbuffer()[2:4]
    t(b.write, b'x')
    m[:] = b'..'
    m.release()
    print(b.getvalue())

    print('--- memoryviews and arrays as data')
    a = array.array('H', [0x4142, 0x4344])
    views = [memoryview(b'mv'), memoryview(bytearray(b'mw')), memoryview(b'0123456789')[2:5], a, memoryview(a)]
    b = _io.BytesIO()
    print([b.write(v) for v in views], b.getvalue())
    b = _io.BytesIO(memoryview(b'init'))
    print(b.getvalue())
    b = _io.BytesIO()
    b.writelines(views)
    print(b.getvalue())
    t(b.write, memoryview(b'0123456789')[::2])
    with _io.FileIO('f', 'w') as f:
        print([f.write(v) for v in views])
        t(f.write, memoryview(b'0123456789')[::2])
    with _io.FileIO('f') as f:
        print(f.read())
    raw = _io.BytesIO()
    w = _io.BufferedWriter(raw, 4)
    print([w.write(v) for v in views], w.flush(), raw.getvalue())
    with _io.open('g', 'wb') as f:
        print([f.write(v) for v in views])
    with _io.open('g', 'rb') as f:
        print(f.read())

    print('--- memoryviews and arrays to read into')
    def targets():
        ba = bytearray(4)
        ar = array.array('b', [0] * 4)
        big = bytearray(8)
        return [(ba, ba), (memoryview(ba), ba), (ar, ar), (memoryview(big)[2:6], big)]
    for make in (lambda: _io.BytesIO(b'abcdefgh'), lambda: _io.FileIO('g'), lambda: _io.open('g', 'rb'), lambda: _io.BufferedReader(_io.BytesIO(b'abcdefgh'), 2), lambda: _io.BufferedRandom(_io.BytesIO(b'abcdefgh'), 16)):
        for target, show in targets():
            s = make()
            print(type(s).__name__, type(target).__name__, s.readinto(target), bytes(show), s.readinto1(target) if hasattr(s, 'readinto1') else None, bytes(show))
            s.close()
    for s in (_io.BytesIO(b'abc'), _io.FileIO('g'), _io.open('g', 'rb')):
        t(s.readinto, memoryview(b'abc'))
        t(s.readinto, memoryview(bytearray(8))[::2])
        t(s.readinto, b'abc')
        s.close()
    ar = array.array('i', [0, 0])
    print(_io.BytesIO(b'\1\0\0\0\2\0\0\0\3').readinto(ar), ar)

    print('--- a bytearray cannot be resized while it is being read into or written')
    class Resizer(_io._RawIOBase):
        def readable(self): return True
        def writable(self): return True
        def readinto(self, b):
            try:
                target.extend(b'x')
            except BufferError as e:
                print('  BufferError:', e)
            b[:1] = b'r'
            return 1
        def write(self, b):
            try:
                target.clear()
            except BufferError as e:
                print('  BufferError:', e)
            return len(b)
    target = bytearray(10)
    print(_io.BufferedReader(Resizer(), 4).readinto(target), target)
    target.extend(b'!')
    print(_io.BufferedWriter(Resizer(), 4).write(target), len(target))
    target.clear()

    print('--- what a raw stream is handed')
    class Spy(_io._RawIOBase):
        def __init__(self):
            self.kept = []
        def readable(self): return True
        def writable(self): return True
        def readinto(self, b):
            print('  readinto', type(b).__name__, len(b), b.readonly, b.format, b.obj)
            self.kept.append(b)
            b[:2] = b'hi'
            return 2
        def write(self, b):
            print('  write', type(b).__name__, len(b), b.readonly, bytes(b), b.obj)
            self.kept.append(b)
            try:
                b[0] = 0
            except TypeError as e:
                print('  TypeError:', e)
            return len(b)
    s = Spy()
    r = _io.BufferedReader(s, 8)
    print(r.read(1), r.read1(), r.read(20)[:6])
    print(r.readinto(bytearray(20)))
    w = _io.BufferedWriter(s, 8)
    w.write(b'abc')
    w.flush()
    w.write(b'0123456789')
    w.write(bytearray(b'0123456789'))

    print('--- text over buffers that return other things than bytes')
    class Odd(_io._BufferedIOBase):
        def __init__(self, *chunks):
            self.chunks = list(chunks)
        def readable(self): return True
        def read1(self, n=-1):
            return self.chunks.pop(0) if self.chunks else b''
        def read(self, n=-1):
            return self.read1()
    for chunks in ((bytearray(b'ab\n'), memoryview(b'cd\n'), array.array('b', b'ef')),):
        print(_io.TextIOWrapper(Odd(*chunks), 'ascii').readlines())
        print(_io.TextIOWrapper(Odd(*chunks), 'utf-8', newline='\n').read(7))
        print(_io.TextIOWrapper(Odd(*chunks), 'latin-1').read())

try:
    main()
finally:
    for n in posix.listdir('.'):
        posix.unlink(n)
    posix.chdir('/')
    posix.rmdir(D)
