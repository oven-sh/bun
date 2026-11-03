# Text files on disk, through all three layers.
import _io, posix

D = '/tmp/pyio_textfiles_%d' % posix.getpid()
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
    open = _io.open
    lines = ['line %d: %s\n' % (i, chr(0x41 + i % 26) * (i % 90)) for i in range(5000)]
    with open('big', 'w') as f:
        for line in lines:
            f.write(line)
    size = posix.stat('big').st_size
    print(size, size == sum(map(len, lines)))
    with open('big') as f:
        print(f.readlines() == lines)
    with open('big') as f:
        print(list(f) == lines)
    with open('big') as f:
        print(f.read() == ''.join(lines))
    with open('big') as f:
        got = []
        while True:
            line = f.readline()
            if not line:
                break
            got.append(line)
        print(got == lines, f.tell() == size)
    with open('big') as f:
        chunks = []
        while True:
            c = f.read(777)
            if not c:
                break
            chunks.append(c)
        print(''.join(chunks) == ''.join(lines), len(chunks))
    with open('big') as f:
        for i in range(100):
            f.readline()
        p = f.tell()
        a = f.readline()
        f.seek(p)
        print(p == sum(map(len, lines[:100])), f.readline() == a == lines[100])

    wide = ['%d é€\U0001f600 %s\n' % (i, chr(0x400 + i % 200) * (i % 40)) for i in range(3000)]
    for enc in ('utf-8', 'utf-16', 'utf-32', 'utf-16-le'):
        with open('wide', 'w', encoding=enc) as f:
            f.writelines(wide)
        with open('wide', encoding=enc) as f:
            print(enc, posix.stat('wide').st_size, f.readlines() == wide)
        with open('wide', encoding=enc) as f:
            for i in range(1500):
                f.readline()
            p = f.tell()
            rest = f.read()
            f.seek(p)
            print('  ', rest == ''.join(wide[1500:]), f.read() == rest, f.read(1) == '')
        with open('wide', encoding=enc) as f:
            f.read(12345)
            p = f.tell()
            c = f.read(10)
            f.seek(p)
            print('  ', f.read(10) == c == ''.join(wide)[12345:12355])

    print('--- updating in place')
    with open('u', 'w') as f:
        f.write('aaa\nbbb\nccc\n')
    with open('u', 'r+') as f:
        f.readline()
        p = f.tell()
        f.seek(p)
        f.write('BBB')
        f.seek(0)
        print(repr(f.read()))
    with open('u', 'r+') as f:
        f.seek(0, 2)
        f.write('ddd\n')
        f.seek(4)
        print(repr(f.readline()), repr(f.read()))
    with open('u', 'a') as f:
        print(f.tell(), f.write('eee\n'), f.tell())
    with open('u') as f:
        print(f.read().split())

    print('--- what is written can be seen once it is flushed')
    f = open('v', 'w')
    f.write('abc')
    print(posix.stat('v').st_size in (0, 3), f.flush(), posix.stat('v').st_size)
    f.write('x' * 200000)
    print(posix.stat('v').st_size > 3)
    f.close()
    print(posix.stat('v').st_size)
    f = open('v', 'wb')
    f.write(b'abc')
    print(posix.stat('v').st_size in (0, 3), f.flush(), posix.stat('v').st_size)
    f.close()
    f = open('v', 'wb', 0)
    f.write(b'abc')
    print(posix.stat('v').st_size)
    f.close()

    print('--- the layers')
    f = open('u')
    print(f.buffer.raw.name, f.buffer.name, f.name, f.buffer.raw.mode, f.buffer.mode, f.mode, f.fileno() == f.buffer.fileno() == f.buffer.raw.fileno())
    print(f.isatty(), f.seekable(), f.readable(), f.writable(), f.closed, f.buffer.closed, f.buffer.raw.closed)
    b = f.detach()
    print(type(b).__name__, b.closed, b.read(3))
    r = b.detach()
    print(type(r).__name__, r.closed, r.tell(), r.seek(0), r.read(3))
    r.close()
    f = open('u')
    f.buffer.raw.close()
    print(f.closed, f.buffer.closed)
    t(f.read)
    t(f.close)
    f = open('u')
    f.buffer.close()
    print(f.closed, f.buffer.raw.closed)
    t(f.readline)
    f = open('u', 'w')
    f.write('data')
    f.buffer.raw.close()
    t(f.flush)
    t(f.close)
    print(f.closed)

    print('--- many files')
    for i in range(300):
        with open('n%d' % (i % 7), 'w') as f:
            f.write(str(i))
    print([open('n%d' % i).read() for i in range(7)])

try:
    main()
finally:
    for n in posix.listdir('.'):
        posix.unlink(n)
    posix.chdir('/')
    posix.rmdir(D)
