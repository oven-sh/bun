# listdir, scandir and DirEntry.
import posix, stat

def show(function, *args, **kwargs):
    try:
        result = function(*args, **kwargs)
    except BaseException as e:
        print(type(e).__name__, e)
    else:
        print(repr(result))

def remove_tree(path):
    for entry in posix.scandir(path):
        if entry.is_dir(follow_symlinks=False):
            remove_tree(entry.path)
        else:
            posix.unlink(entry.path)
    posix.rmdir(path)

def touch(path, data=b''):
    fd = posix.open(path, posix.O_WRONLY | posix.O_CREAT, 0o644)
    posix.write(fd, data)
    posix.close(fd)

base = '/tmp/pyposix_dirs_%d' % posix.getpid()
posix.mkdir(base)
posix.chdir(base)
try:
    posix.mkdir('top')
    posix.mkdir('top/dir')
    touch('top/file', b'12345')
    touch('top/.hidden')
    posix.symlink('file', 'top/link_file')
    posix.symlink('dir', 'top/link_dir')
    posix.symlink('nowhere', 'top/link_broken')
    posix.mkfifo('top/fifo')
    touch('top/caf\xe9')
    touch(b'top/raw\xff')

    print('-- listdir')
    print(ascii(sorted(posix.listdir('top'))))
    print(sorted(posix.listdir(b'top')))
    print(sorted(posix.listdir('top/dir')), posix.listdir('top/link_dir'))
    posix.chdir('top')
    print(ascii(sorted(posix.listdir())) == ascii(sorted(posix.listdir('.'))), ascii(sorted(posix.listdir(None))) == ascii(sorted(posix.listdir('.'))))
    posix.chdir('..')
    print(type(posix.listdir('top')).__name__)
    fd = posix.open('top', posix.O_RDONLY)
    print(ascii(sorted(posix.listdir(fd))))
    print(ascii(sorted(posix.listdir(fd))))
    posix.close(fd)
    show(posix.listdir, fd)
    show(posix.listdir, 'nope')
    show(posix.listdir, b'nope')
    show(posix.listdir, 'top/file')
    show(posix.listdir, '')
    show(posix.listdir, path='top/dir')
    fd = posix.open('top/file', posix.O_RDONLY)
    for function in (posix.listdir, posix.scandir):
        try:
            function(fd)
        except OSError as e:
            print(type(e).__name__, e.errno, e.strerror, e.filename == fd)
    posix.close(fd)

    print('-- scandir')
    it = posix.scandir('top')
    print(type(it).__name__, type(it).__module__, iter(it) is it)
    entries = sorted(it, key=lambda e: ascii(e.name))
    show(next, it)
    show(next, it)
    for e in entries:
        print(ascii(e.name), ascii(e.path), ascii(e), e.is_dir(), e.is_file(), e.is_symlink(), e.is_junction(),
              e.is_dir(follow_symlinks=False), e.is_file(follow_symlinks=False), ascii(e.__fspath__()), ascii(posix.fspath(e)))
        print('  ', e.inode() == posix.lstat(e.path).st_ino, e.stat(follow_symlinks=False) == posix.lstat(e.path), type(e.inode()).__name__)
        if e.name != 'link_broken':
            print('  ', e.stat() == posix.stat(e.path), e.stat() is e.stat(), e.stat(follow_symlinks=False) is e.stat(follow_symlinks=False),
                  (e.stat() is e.stat(follow_symlinks=False)) == (not e.is_symlink()))
        else:
            show(e.stat)
    e = [e for e in entries if e.name == 'file'][0]
    print(type(e), type(e).__name__, type(e).__module__, type(e).__qualname__, type(e) is posix.DirEntry)
    show(setattr, e, 'name', 'x')
    show(setattr, e, 'path', 'x')
    show(delattr, e, 'name')
    show(setattr, e, 'other', 'x')
    show(e.is_dir, True)
    show(e.is_dir, follow=True)
    show(e.stat, False)
    show(posix.DirEntry)
    show(posix.DirEntry.__class_getitem__, str)
    print(posix.DirEntry[bytes])
    show(type(it))
    show(hash, e) if False else None
    print(e == e, e != e)

    print('-- bytes, None, a descriptor')
    for e in sorted(posix.scandir(b'top'), key=lambda e: e.name):
        print(e.name, e.path, e, e.__fspath__(), e.is_file())
    posix.chdir('top')
    print(ascii(sorted((e.name, e.path) for e in posix.scandir())))
    print(ascii(sorted((e.name, e.path) for e in posix.scandir(None))) == ascii(sorted((e.name, e.path) for e in posix.scandir())))
    print(ascii(sorted((e.name, e.path) for e in posix.scandir('.'))))
    posix.chdir('..')
    print(sorted(e.path for e in posix.scandir('top/')if e.name.isascii()))
    print(sorted(e.path for e in posix.scandir('top//') if e.name.isascii()))
    print(sorted(e.path for e in posix.scandir(base + '/top') if e.name == 'file') == [base + '/top/file'])
    fd = posix.open('top', posix.O_RDONLY)
    for e in sorted(posix.scandir(fd), key=lambda e: ascii(e.name)):
        print(ascii(e.name), ascii(e.path), e.is_dir(), e.is_file(), e.is_symlink(), e.stat(follow_symlinks=False).st_size if e.name == 'file' else '-')
    print(len(list(posix.scandir(fd))))
    by_fd = {e.name: e for e in posix.scandir(fd)}
    print(by_fd['link_file'].stat().st_size, by_fd['link_file'].is_file())
    posix.close(fd)
    show(by_fd['link_dir'].stat)
    show(by_fd['file'].stat)
    print(by_fd['link_dir'].is_dir(follow_symlinks=False), by_fd['file'].is_file())
    show(by_fd['link_dir'].is_dir)

    class P:
        def __fspath__(self):
            return 'top/dir'
    touch('top/dir/inner')
    print([(e.name, e.path) for e in posix.scandir(P())])

    print('-- closing')
    it = posix.scandir('top')
    first = next(it)
    show(it.close)
    show(next, it)
    show(it.close)
    with posix.scandir('top') as it:
        print(type(it.__enter__()).__name__, it.__enter__() is it)
        next(it)
    show(next, it)
    it = posix.scandir('top')
    show(it.__exit__, None, None, None)
    show(it.__exit__)
    show(next, it)
    show(list, it)
    show(it.close, 1)

    print('-- what is cached, and what is gone')
    entries = {e.name: e for e in posix.scandir('top')}
    posix.unlink('top/file')
    e = entries['file']
    print(e.is_file(), e.is_dir(), e.is_symlink())
    show(e.stat)
    l = entries['link_file']
    print(l.is_symlink(), l.is_file(), l.is_dir(), l.is_file(follow_symlinks=False))
    show(l.stat)
    print(stat.S_ISLNK(l.stat(follow_symlinks=False).st_mode))
    touch('top/file', b'new')
    print(e.stat().st_size, l.stat().st_size)
    posix.unlink('top/file')
    print(e.stat().st_size, l.stat().st_size)

    print('-- errors')
    show(posix.scandir, 'nope')
    show(posix.scandir, b'nope')
    show(posix.scandir, 'top/fifo')
    show(posix.scandir, '')
    show(posix.scandir, 'a', 'b')
    print(type(posix.scandir(path='top/dir')).__name__)

    print('-- many')
    posix.mkdir('many')
    for i in range(300):
        touch('many/f%03d' % i)
    names = sorted(posix.listdir('many'))
    print(len(names), names[0], names[-1], sorted(e.name for e in posix.scandir('many')) == names)
finally:
    posix.chdir('/')
    remove_tree(base)
