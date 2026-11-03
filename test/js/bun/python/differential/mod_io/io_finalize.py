# Streams nothing refers to any more are flushed and closed.
import _io, gc, posix, resource

D = '/tmp/pyio_finalize_%d' % posix.getpid()
posix.mkdir(D)
posix.chdir(D)

def collect():
    for i in range(3):
        gc.collect()

def fds():
    return len(posix.listdir('/proc/self/fd'))

def main():
    open = _io.open
    before = fds()

    print('--- text, buffered and raw files')
    def write(name, mode, data, *a):
        f = open(name, mode, *a)
        f.write(data)
    write('t', 'w', 'text\n')
    write('b', 'wb', b'bytes\n')
    write('r', 'wb', b'raw\n', 0)
    write('u', 'w+', 'update\n')
    collect()
    print(fds() - before)
    for name in 'tbru':
        with open(name, 'rb') as f:
            print(name, f.read())

    print('--- readers')
    def read(name, mode):
        return open(name, mode).read()
    print([read('t', 'r'), read('b', 'rb')])
    collect()
    print(fds() - before)

    print('--- the layers are taken apart from the outside in')
    log = []
    class Raw(_io.FileIO):
        def write(self, b):
            log.append(('raw.write', bytes(b)))
            return super().write(b)
        def close(self):
            log.append('raw.close')
            super().close()
    class Buffered(_io.BufferedWriter):
        def close(self):
            log.append('buffered.close')
            super().close()
    class Text(_io.TextIOWrapper):
        def close(self):
            log.append('text.close')
            super().close()
    def layers():
        t = Text(Buffered(Raw('l', 'w')), 'ascii')
        t.write('abc')
    layers()
    collect()
    print(log)

    print('--- raw streams written in Python')
    log.clear()
    class PyRaw(_io._RawIOBase):
        def writable(self): return True
        def write(self, b):
            log.append(('write', bytes(b), self.closed))
            return len(b)
        def close(self):
            log.append('close')
            super().close()
    def pyraw():
        b = _io.BufferedWriter(PyRaw())
        b.write(b'xyz')
    pyraw()
    collect()
    print(log)
    log.clear()
    def alone():
        PyRaw()
    alone()
    collect()
    print(log)

    print('--- close() is called once, and not at all on what is closed')
    log.clear()
    def closed():
        r = PyRaw()
        r.close()
    closed()
    collect()
    print(log)

    print('--- detached')
    log.clear()
    def detached():
        b = _io.BufferedWriter(PyRaw())
        b.write(b'1')
        return b.detach()
    r = detached()
    collect()
    print(log, r.closed)
    del r
    collect()
    print(log)

    print('--- subclasses of the streams in memory')
    log.clear()
    class B(_io.BytesIO):
        def close(self):
            log.append('B.close')
            super().close()
    class S(_io.StringIO):
        def close(self):
            log.append('S.close')
            super().close()
    def memory():
        B(b'x'); S('y')
    memory()
    collect()
    print(sorted(log))

    print('--- __del__')
    log.clear()
    f = _io.FileIO('t')
    print(f.__del__(), f.closed, f._finalizing, f.__del__())
    class D2(_io.FileIO):
        def __del__(self):
            log.append('D2.__del__')
            super().__del__()
    def d2():
        D2('t')
        x = D2('t')
        x.close()
    d2()
    collect()
    print(log, fds() - before)

    print('--- a wrapper that goes away closes what it wraps')
    raw = _io.BytesIO()
    def wrap():
        w = _io.TextIOWrapper(raw, 'ascii')
        w.write('abc')
    wrap()
    collect()
    print(raw.closed)

    print('--- more files than can be open at once')
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, hard))
    try:
        total = 0
        for i in range(1000):
            f = open('t')
            total += len(f.read())
        print(total)
        keep = []
        try:
            for i in range(100):
                keep.append(open('t'))
        except OSError as e:
            print(type(e).__name__, e.strerror, e.filename)
        for f in keep:
            f.close()
    finally:
        resource.setrlimit(resource.RLIMIT_NOFILE, (soft, hard))

try:
    main()
finally:
    for n in posix.listdir('.'):
        posix.unlink(n)
    posix.chdir('/')
    posix.rmdir(D)
