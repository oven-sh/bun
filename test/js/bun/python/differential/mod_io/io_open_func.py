# _io.open(), open_code(), text_encoding()
import _io, posix, warnings

D = '/tmp/pyio_open_%d' % posix.getpid()
posix.mkdir(D)
posix.chdir(D)

def t(f, *a, **k):
    try:
        r = f(*a, **k)
    except BaseException as e:
        print(type(e).__name__ + ':', e)
    else:
        print(repr(r))
        if hasattr(r, 'close'):
            r.close()

def describe(f):
    layers = []
    x = f
    while x is not None:
        layers.append(type(x).__name__)
        x = getattr(x, 'buffer', None) or getattr(x, 'raw', None)
    return layers

def main():
    open = _io.open
    with open('a', 'w') as f:
        f.write('hello\nworld\n')

    print('--- what each mode makes')
    for mode in ('r', 'rt', 'tr', 'w', 'a', 'x', 'r+', 'w+', 'a+', 'x+', '+r', 'rt+', 'r+t', 'rb', 'br', 'wb', 'ab', 'xb', 'rb+', 'r+b', 'wb+', 'ab+', 'xb+', 'b+r'):
        if 'x' in mode:
            try: posix.unlink('x')
            except OSError: pass
        name = 'x' if 'x' in mode else 'm'
        if 'r' in mode:
            open(name, 'w').close()
        f = open(name, mode)
        print(repr(mode), describe(f), f.mode, f.name, f.readable(), f.writable(), repr(f))
        f.close()
    print('--- unbuffered')
    for mode in ('rb', 'wb', 'ab', 'rb+'):
        f = open('m', mode, 0)
        print(repr(mode), describe(f), f.mode, repr(f))
        f.close()
    for mode in ('r', 'w', 'r+', 'rt'):
        t(open, 'm', mode, 0)
    print(posix.stat('m').st_size)

    print('--- bad modes')
    for mode in ('', 'b', 't', '+', 'rw', 'ra', 'wx', 'rwa', 'rr', 'rbb', 'r++', 'tt', 'rtb', 'bt', 'z', 'U', 'rU', 'R', 'r ', ' r', 'r,w', 'é', 'rb\0'):
        t(open, 'a', mode)
    t(open, 'a', None)
    t(open, 'a', 5)
    t(open, 'a', b'r')

    print('--- binary mode takes no text arguments')
    t(open, 'a', 'rb', -1, 'utf-8')
    t(open, 'a', 'rb', errors='strict')
    t(open, 'a', 'rb', newline='\n')
    t(open, 'a', 'rb', newline='')
    t(open, 'a', 'rb', encoding=None, errors=None, newline=None)

    print('--- arguments')
    t(open)
    t(open, 'a', 'r', -1, None, None, None, True, None, 1)
    t(open, 'a', bad=1)
    t(open, file='a', mode='r', buffering=-1, encoding='ascii', errors='replace', newline='', closefd=True, opener=None)
    t(open, 'a', buffering='x')
    t(open, 'a', buffering=None)
    t(open, 'a', buffering=1.5)
    t(open, 'a', buffering=2 ** 40)
    t(open, 'a', encoding=5)
    t(open, 'a', errors=5)
    t(open, 'a', newline=5)
    t(open, 'a', newline='x')
    t(open, 'a', encoding='no-such-encoding')
    t(open, 'a', encoding='a\0b')
    t(open, 'a', closefd=False)
    t(open, 'a', closefd=0)
    t(open, 'a', closefd=[1])
    t(open, None)
    t(open, 1.5)
    t(open, [])
    t(open, -1)
    t(open, 'nonexistent')
    t(open, 'nonexistent', 'rb')
    t(open, 'nonexistent', 'r+')
    t(open, b'nonexistent')
    t(open, '.')
    t(open, '.', 'w')
    t(open, 'a', 'x')
    t(open, 'a\0b')
    t(open, '')
    class P:
        def __init__(self, p): self.p = p
        def __fspath__(self): return self.p
    t(open, P('a'))
    t(open, P(b'a'))
    t(open, P(5))
    t(open, P('nonexistent'))

    print('--- nothing is left open, or created, when it fails')
    before = len(posix.listdir('/proc/self/fd'))
    for a, k in ((('new1', 'w'), dict(encoding='no-such-encoding')), (('new2', 'w'), dict(newline='x')), (('new3', 'w', 0), {}), (('a', 'r'), dict(buffering=-5, encoding='zz'))):
        try:
            open(*a, **k)
        except Exception as e:
            print(type(e).__name__, e)
    print(len(posix.listdir('/proc/self/fd')) - before, sorted(n for n in posix.listdir('.') if n.startswith('new')))

    print('--- buffer sizes')
    class Spy(_io.FileIO):
        pass
    for buffering in (-1, -7, 1, 2, 16, 4096, 100000):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('always')
            f = open('a', 'rb', buffering)
            f.peek()
            print(buffering, describe(f), len(f.peek()), [(c.category.__name__, str(c.message)) for c in caught])
            f.close()
    with open('big', 'wb') as f:
        f.write(b'x' * 300000)
    for buffering in (-1, 1, 2, 16, 4096, 200000):
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            f = open('big', 'rb', buffering)
        print(buffering, len(f.peek()))
        f.close()
    for buffering in (-1, 1, 2, 4096):
        f = open('a', 'r', buffering)
        print(buffering, f.line_buffering, len(f.buffer.peek()))
        f.close()
        f = open('m', 'w', buffering)
        print(buffering, f.line_buffering, f.write_through)
        f.close()
    f = open('lb', 'w', 1)
    f.write('a')
    print(posix.stat('lb').st_size in (0, 1))  # When a buffer is written is up to the implementation: see io_pending_output.py.
    f.write('b\nc')
    print(posix.stat('lb').st_size)
    f.close()
    print(posix.stat('lb').st_size)

    print('--- text')
    with open('t', 'w', encoding='utf-8', newline='\r\n') as f:
        print(f.encoding, f.errors, f.newlines, f.write('é\n€\n'))
    with open('t', 'rb') as f:
        print(f.read())
    with open('t', encoding='utf-8') as f:
        print(f.readlines(), f.newlines)
    with open('t', encoding='utf-8', newline='') as f:
        print(f.readlines(), f.newlines)
    with open('t', encoding='ascii', errors='replace') as f:
        print(ascii(f.read()), f.errors)
    with open('t', encoding='ascii') as f:
        t(f.read)
    with open('t', encoding='latin-1') as f:
        print(ascii(f.read()))
    with open('t') as f:
        print(f.encoding, f.read(1))
    with open('t', 'a', encoding='utf-16') as f:
        f.write('x')
    with open('t', 'rb') as f:
        print(f.read()[-4:])
    with open('t16', 'w', encoding='utf-16') as f:
        f.write('ab')
    with open('t16', 'a', encoding='utf-16') as f:
        f.write('cd')
    with open('t16', 'rb') as f:
        print(f.read())
    with open('t16', encoding='utf-16') as f:
        print(f.read())

    print('--- read and write')
    with open('rw', 'w+') as f:
        print(f.write('0123456789'), f.seek(0), f.read(3), f.tell(), f.seek(3), f.write('AB'), f.seek(0), f.read())
    with open('rw', 'r+') as f:
        print(f.read(2), f.seek(0, 2), f.write('!'), f.seek(0), f.read())
    with open('rw', 'a+') as f:
        print(f.tell(), repr(f.read()), f.write('?'), f.seek(0), f.read())
    with open('rw', 'rb+') as f:
        print(f.read(2), f.write(b'__'), f.read(2), f.seek(0), f.read())
    with open('rw', 'r+') as f:
        print(f.truncate(4), f.read(), f.tell())

    print('--- file descriptors')
    fd = posix.open('a', posix.O_RDONLY)
    f = open(fd)
    print(f.name == fd, f.fileno() == fd, f.buffer.raw.closefd, f.read(5), repr(f).replace(str(fd), 'FD'))
    f.close()
    t(posix.close, fd)
    fd = posix.open('a', posix.O_RDONLY)
    f = open(fd, closefd=False)
    print(f.buffer.raw.closefd, f.read(5))
    f.close()
    print(posix.lseek(fd, 0, 0), posix.read(fd, 5))
    posix.close(fd)
    t(open, fd)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        fd = posix.dup(0)
        try:
            f = open(False, closefd=False)
            f.close()
        finally:
            posix.close(fd)
        print([(c.category.__name__, str(c.message)) for c in caught])

    print('--- opener')
    def opener(name, flags):
        print('  opener', name, flags & posix.O_ACCMODE, bool(flags & posix.O_CREAT), bool(flags & posix.O_TRUNC), bool(flags & posix.O_APPEND), bool(flags & posix.O_EXCL))
        return posix.open(name, flags, 0o600)
    for mode in ('r', 'w', 'a', 'r+', 'w+', 'rb'):
        open('a2' if mode != 'r' and mode != 'rb' and mode != 'r+' else 'a', mode, opener=opener).close()
    try: posix.unlink('a3')
    except OSError: pass
    open('a3', 'x', opener=opener).close()
    print(oct(posix.stat('a3').st_mode & 0o777))
    t(open, 'a', opener=lambda *a: -1)
    t(open, 'a', opener=lambda *a: 'x')
    t(open, 'a', opener=5)

    print('--- pipes')
    r, w = posix.pipe()
    fr, fw = open(r), open(w, 'w')
    print(describe(fr), describe(fw), fr.seekable(), fw.seekable(), fr.line_buffering, fw.line_buffering)
    fw.write('line one\nline two\nrest')
    fw.flush()
    print(repr(fr.readline()), repr(fr.readline()))
    fw.close()
    print(repr(fr.read()), repr(fr.read()))
    t(fr.tell)
    t(fr.seek, 0)
    fr.close()
    r, w = posix.pipe()
    t(open, r, 'r+')
    t(open, w, 'w+b')
    r, w = posix.pipe()
    fr, fw = open(r, 'rb'), open(w, 'wb')
    fw.write(b'abc')
    fw.flush()
    print(fr.read1(), fr.peek(0) if False else None)
    fw.write(b'def\nghi')
    fw.close()
    print(fr.readline(), fr.read(), fr.read())
    fr.close()

    print('--- open_code')
    f = _io.open_code('a')
    print(describe(f), f.read())
    f.close()
    t(_io.open_code, path='a')
    t(_io.open_code, b'a')
    t(_io.open_code, 5)
    t(_io.open_code, P('a'))
    t(_io.open_code)
    t(_io.open_code, 'nonexistent')

    print('--- text_encoding')
    t(_io.text_encoding, None)
    t(_io.text_encoding, None, 1)
    t(_io.text_encoding, 'latin-1')
    t(_io.text_encoding, 'latin-1', 5)
    t(_io.text_encoding, 5)
    t(_io.text_encoding)
    t(_io.text_encoding, None, 'x')
    t(_io.text_encoding, encoding=None)

    print('--- the functions')
    print(_io.open.__name__, _io.open.__qualname__, _io.open.__module__, type(_io.open).__name__, repr(_io.open))
    print(_io.open_code.__name__, _io.text_encoding.__name__)

try:
    main()
finally:
    for n in posix.listdir('.'):
        posix.unlink(n)
    posix.chdir('/')
    posix.rmdir(D)
