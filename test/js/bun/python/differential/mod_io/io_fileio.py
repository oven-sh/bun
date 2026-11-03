# _io.FileIO
import _io, posix, errno

D = '/tmp/pyio_fileio_%d' % posix.getpid()
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
    FileIO = _io.FileIO
    print('--- write, then read')
    f = FileIO('a', 'w')
    print(f, f.name, f.mode, f.closefd, f.closed)
    print(f.readable(), f.writable(), f.seekable(), f.isatty(), type(f.fileno()).__name__)
    print(f.write(b'hello'), f.write(bytearray(b' world')), f.write(b''), f.tell())
    t(f.read)
    t(f.read, 1)
    t(f.readall)
    t(f.readinto, bytearray(1))
    t(f.write, 'text')
    t(f.write, 5)
    t(f.write, None)
    print(f.flush())
    print(f.close(), f.closed, f)
    print(f.close())
    print(f.name, f.mode, f.closefd)
    for m in ('read', 'readall', 'tell', 'fileno', 'isatty', 'readable', 'writable', 'seekable', 'truncate', 'flush', '__enter__', '__iter__', 'readline', 'readlines'):
        print(m, end=' ')
        t(getattr(f, m))
    t(f.write, b'x')
    t(f.readinto, bytearray(1))
    t(f.seek, 0)
    t(f.writelines, [])

    f = FileIO('a')
    print(f, f.mode, f.readable(), f.writable(), f.seekable())
    print(f.read(2), f.read(0), f.tell(), f.read(None), f.read(), f.read(5), f.readall(), f.tell())
    print(f.seek(0), f.readall(), f.seek(3), f.read(-1), f.seek(-2, 2), f.read(100), f.seek(1), f.seek(2, 1), f.read(1))
    print(f.seek(100), f.read(), f.read(3), f.tell())
    t(f.write, b'x')
    t(f.truncate)
    t(f.truncate, 0)
    t(f.seek, -1)
    t(f.seek, 0, 9)
    t(f.seek, 'x')
    t(f.seek, 1.5)
    t(f.seek, 0, 'x')
    t(f.seek, 2 ** 70)
    t(f.seek, 0, 2 ** 40)
    t(f.read, 'x')
    t(f.read, 1.5)
    t(f.read, 2 ** 70)
    f.seek(0)
    a = bytearray(b'........')
    print(f.readinto(a), a, f.readinto(a), a, f.readinto(a), a, f.readinto(bytearray()))
    t(f.readinto, b'abc')
    t(f.readinto, 'abc')
    t(f.readinto, None)
    f.close()

    print('--- lines')
    with FileIO('lines', 'w') as f:
        f.writelines([b'one\n', b'two\n', b'\n', b'last'])
    with FileIO('lines') as f:
        print(f.readline(), f.readline(2), f.readline(), f.readlines())
    with FileIO('lines') as f:
        print(list(f))
    with FileIO('lines') as f:
        print(next(f), f.readlines(3), next(f), next(f))
        t(next, f)
    print(f.closed)

    print('--- modes')
    for mode in ('r', 'w', 'a', 'x', 'r+', 'w+', 'a+', 'x+', 'rb', 'wb', 'ab', 'rb+', 'r+b', 'br', '+r', 'b+w', 'wb+'):
        name = 'm'
        if 'x' in mode:
            try: posix.unlink(name)
            except OSError: pass
        else:
            with FileIO(name, 'w') as f:
                f.write(b'0123456789')
        f = FileIO(name, mode)
        print(repr(mode), f.mode, f.readable(), f.writable(), f.tell(), f)
        f.close()
        print(posix.stat(name).st_size)
    for mode in ('', 'b', '+', 'rw', 'rr', 'wa', 'xr', 'r++', 'z', 'rt', 'U', 'rU', 'r ', 'R', 'é', 'r\0'):
        t(FileIO, 'm', mode)
    t(FileIO, 'm', None)
    t(FileIO, 'm', 5)
    t(FileIO, 'm', b'r')
    t(FileIO, 'm', 'x')
    t(FileIO, 'nonexistent')
    t(FileIO, 'nonexistent', 'r+')
    t(FileIO, 'nodir/x', 'w')
    t(FileIO, '.')
    t(FileIO, '.', 'w')
    t(FileIO, b'nonexistent')
    t(FileIO, '')
    t(FileIO, 'a\0b')
    t(FileIO, b'a\0b')
    t(FileIO, None)
    t(FileIO, 1.5)
    t(FileIO, [])
    t(FileIO, -1)
    t(FileIO, -5)
    t(FileIO, 2 ** 40)
    t(FileIO)
    t(FileIO, 'a', 'r', True, None, 5)
    t(FileIO, 'a', bad=1)
    t(FileIO, 'a', file='b')
    t(FileIO, mode='r')
    t(FileIO, 'a', closefd=False)
    t(FileIO, 'a\udcff', 'r')
    t(FileIO, 'a\ud800', 'r')
    try:
        FileIO('nonexistent')
    except OSError as e:
        print(type(e).__name__, e.errno == errno.ENOENT, e.filename, e.strerror, e.args)

    print('--- append')
    with FileIO('ap', 'w') as f:
        f.write(b'abc')
    with FileIO('ap', 'a') as f:
        print(f.tell(), f.write(b'def'), f.tell(), f.seek(0), f.write(b'ghi'), f.tell())
    with FileIO('ap', 'a+') as f:
        print(f.tell(), f.read(), f.seek(0), f.read())

    print('--- read and write')
    with FileIO('rw', 'w+') as f:
        print(f.write(b'0123456789'), f.seek(2), f.read(3), f.write(b'XY'), f.seek(0), f.read())
        print(f.truncate(4), f.tell(), f.seek(0), f.read(), f.truncate(), f.seek(0, 2))
        print(f.truncate(8), f.seek(0), f.read())
        print(f.seek(2), f.truncate(None), f.seek(0), f.read())
        t(f.truncate, -1)
        t(f.truncate, 'x')
        t(f.truncate, 1.5)
        print(f.truncate(True), f.seek(0), f.read())

    print('--- path-like and bytes names')
    class P:
        def __init__(self, p): self.p = p
        def __fspath__(self): return self.p
        def __repr__(self): return 'P(%r)' % (self.p,)
    f = FileIO(P('a'))
    print(f, f.name, f.read(3))
    f.close()
    f = FileIO(b'a')
    print(f, f.name, f.read(3))
    f.close()
    f = FileIO(P(b'a'))
    print(f, f.read(3))
    f.close()
    t(FileIO, P(5))
    t(FileIO, P(None))
    with FileIO('é\udc80', 'w') as f:
        print(f, ascii(f.name))
    print(sorted(n for n in posix.listdir(b'.') if n[0] > 127))

    print('--- file descriptors')
    fd = posix.open('a', posix.O_RDONLY)
    f = FileIO(fd)
    print(f.fileno() == fd, f.name == fd, f.closefd, f.mode, repr(f).replace(str(fd), 'FD'), f.read(5))
    f.close()
    t(posix.close, fd)
    fd = posix.open('a', posix.O_RDONLY)
    f = FileIO(fd, 'r', False)
    print(f.closefd, repr(f).replace(str(fd), 'FD'), f.read(5))
    f.close()
    print(f.closed, f.closefd)
    t(f.read)
    print(posix.read(fd, 3))
    g = FileIO(fd, closefd=True)
    print(g.read())
    g.close()
    t(FileIO, fd)
    class I:
        def __index__(self): return fd2
    fd2 = posix.open('a', posix.O_RDONLY)
    f = FileIO(I())
    print(type(f.name).__name__, f.read(2))
    f.close()
    # The mode is believed.
    fd = posix.open('a', posix.O_RDONLY)
    f = FileIO(fd, 'w')
    print(f.mode, f.writable())
    t(f.write, b'x')
    f.close()

    print('--- opener')
    def opener(name, flags):
        print('opener', name, flags & posix.O_ACCMODE == posix.O_RDONLY, bool(flags & posix.O_CLOEXEC))
        return posix.open(name, flags)
    f = FileIO('a', 'r', True, opener)
    print(f, f.read(3), posix.get_inheritable(f.fileno()))
    f.close()
    f = FileIO(P('a'), opener=opener)
    f.close()
    t(FileIO, 'a', opener=lambda n, fl: -1)
    t(FileIO, 'a', opener=lambda n, fl: -7)
    t(FileIO, 'a', opener=lambda n, fl: 'x')
    t(FileIO, 'a', opener=lambda n, fl: None)
    t(FileIO, 'a', opener=lambda n, fl: 1.0)
    t(FileIO, 'a', opener=lambda n, fl: 2 ** 40)
    t(FileIO, 'a', opener=lambda n, fl: 1 / 0)
    t(FileIO, 'a', opener=5)
    t(FileIO, 'a', opener=lambda n, fl: posix.open('.', posix.O_RDONLY))
    t(FileIO, 'a', opener=lambda n, fl: 10 ** 6)

    print('--- attributes')
    f = FileIO('a')
    print(f._finalizing, type(f._blksize).__name__, f._blksize > 1, f._isatty_open_only())
    f._finalizing = True
    print(f._finalizing)
    f._finalizing = False
    t(setattr, f, '_finalizing', 1)
    t(delattr, f, '_finalizing')
    for name in ('closed', 'closefd', 'mode', '_blksize'):
        t(setattr, f, name, 1)
    f.name = 'other'
    f.extra = 5
    print(f, sorted(f.__dict__))
    del f.name
    print(repr(f).replace(str(f.fileno()), 'FD'))
    t(f.__getstate__)
    t(f.__reduce__)
    t(f.__reduce_ex__, 2)
    print(f._dealloc_warn(f))
    f.name = f
    t(repr, f)
    del f.name
    f.close()
    print(f._blksize == _io.DEFAULT_BUFFER_SIZE)

    print('--- uninitialized')
    f = FileIO.__new__(FileIO)
    print(f, f.closed, f.closefd, f.mode)
    t(f.read)
    t(f.fileno)
    print(f.close())
    t(object.__new__, FileIO)
    t(FileIO.__new__, int)
    t(FileIO.__new__)

    print('--- initialized again')
    f = FileIO('a')
    fd = f.fileno()
    f.__init__('lines')
    print(f, f.read(3))
    f.__init__('ap', 'r')
    print(f.name, f.read(3))
    t(f.__init__, 'nonexistent')
    print(f.closed, f)
    f.__init__('a')
    print(f.closed, f.read(2))
    f.close()

    print('--- subclasses')
    class Sub(FileIO):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self.reads = 0
        def read(self, n=-1):
            self.reads += 1
            return super().read(n)
        def close(self):
            print('Sub.close')
            super().close()
    with Sub('lines') as s:
        print(s, type(s).__mro__[1:3], s.readline(), s.reads, isinstance(s, _io._RawIOBase))
    print(s.closed, s)
    t(s.__getstate__)
    class Slots(FileIO):
        __slots__ = ('x',)
    s = Slots('a')
    s.x = 1
    s.y = 2
    print(s.x, s.y, s.read(1))
    s.close()

    print('--- flush that fails')
    class BadFlush(FileIO):
        def flush(self):
            raise RuntimeError('no flush')
    b = BadFlush('a')
    fd = b.fileno()
    t(b.close)
    print(b.closed)
    t(posix.fstat, fd)

    print('--- closed behind its back')
    f = FileIO('a')
    posix.close(f.fileno())
    t(f.read)
    t(f.read, 1)
    t(f.tell)
    print(f.seekable())
    t(f.close)
    print(f.closed)

    print('--- pipes')
    r, w = posix.pipe()
    fr, fw = FileIO(r), FileIO(w, 'w')
    print(fr.seekable(), fw.seekable(), fr.isatty())
    t(fr.tell)
    t(fw.seek, 0)
    print(fw.write(b'abc\ndef'))
    print(fr.read(2), fr.readline(), fr.read(100))
    fw.write(b'xyz')
    fw.close()
    print(fr.readall(), fr.read(), fr.read(1))
    fr.close()
    r, w = posix.pipe()
    fw = FileIO(w, 'a')
    print(fw.mode)
    fw.close()
    posix.close(r)
    r, w = posix.pipe()
    posix.set_blocking(r, False)
    fr, fw = FileIO(r), FileIO(w, 'w')
    print(fr.read(5), fr.readall(), fr.read(), fr.readinto(bytearray(3)))
    fw.write(b'ab')
    print(fr.readall(), fr.read())
    fw.write(b'cd')
    fw.close()
    print(fr.readall(), fr.read(), fr.read(1))
    fr.close()
    r, w = posix.pipe()
    posix.set_blocking(w, False)
    fw = FileIO(w, 'w')
    total = 0
    while True:
        n = fw.write(b'x' * 65536)
        if n is None:
            break
        total += n
    print(total > 0, n)
    posix.close(r)
    fw.close()

    print('--- large files')
    with FileIO('big', 'w') as f:
        for i in range(40):
            f.write(bytes([65 + i % 26]) * 5000)
    with FileIO('big') as f:
        d = f.readall()
        print(len(d), d[:3], d[-3:], f.tell())
        f.seek(150000)
        d = f.read()
        print(len(d), d[:2])
        f.seek(0)
        print(len(f.read(70000)), len(f.read(10 ** 6)), f.read(10))
    # It grows after it was opened.
    with FileIO('grow', 'w') as f:
        f.write(b'a' * 10)
    with FileIO('grow') as f:
        with FileIO('grow', 'a') as g:
            g.write(b'b' * 100000)
        d = f.readall()
        print(len(d), d[8:12])
    # It shrinks.
    with FileIO('grow') as f:
        with FileIO('grow', 'r+') as g:
            g.truncate(5)
        print(f.readall())
    with FileIO('empty', 'w') as f:
        pass
    with FileIO('empty') as f:
        print(f.readall(), f.read(), f.read(3))
    with FileIO('/dev/null') as f:
        print(f.read(), f.readall(), f.isatty(), f._isatty_open_only())
    with FileIO('/dev/zero') as f:
        print(f.read(4))
    with FileIO('/proc/self/stat') as f:
        print(len(f.read()) > 10)

    print('--- the type')
    print(FileIO, FileIO.__name__, FileIO.__qualname__, FileIO.__module__, FileIO.__bases__)
    t(setattr, FileIO, 'x', 1)

try:
    main()
finally:
    for n in posix.listdir(b'.'):
        posix.unlink(n)
    posix.chdir('/')
    posix.rmdir(D)
