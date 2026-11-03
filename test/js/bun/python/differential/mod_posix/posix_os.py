# Lib/os.py, posixpath.py, genericpath.py and stat.py on top of the module posix.
import os, os.path, stat, sys

def show(function, *args, **kwargs):
    try:
        result = function(*args, **kwargs)
    except BaseException as e:
        print(type(e).__name__, e)
    else:
        print(repr(result))

def write_file(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.write(fd, text.encode())
    os.close(fd)

print(os.name, os.sep, os.pathsep, os.linesep == '\n', os.curdir, os.pardir, os.extsep, os.altsep, os.devnull, os.defpath)
print(os.path.__name__, os.error is OSError, os.stat_result.__name__, os.terminal_size.__name__)
ABSENT = {'fork', 'forkpty', 'spawnl', 'spawnle', 'spawnlp', 'spawnlpe', 'spawnv', 'spawnve', 'spawnvp', 'spawnvpe', 'P_WAIT', 'P_NOWAIT', 'P_NOWAITO'}
# CPython has those that the headers knew which it was built with.
ABSENT |= {'STATX_MNT_ID', 'STATX_DIOALIGN', 'STATX_MNT_ID_UNIQUE', 'STATX_SUBVOL', 'STATX_WRITE_ATOMIC', 'STATX_DIO_READ_ALIGN'}
print(sorted(n for n in os.__all__ if n not in ABSENT))
print(sorted(f.__name__ for f in os.supports_dir_fd))
print(sorted(f.__name__ for f in os.supports_fd))
print(sorted(f.__name__ for f in os.supports_follow_symlinks))
print(sorted(f.__name__ for f in os.supports_effective_ids))
print(os.supports_bytes_environ, os.SEEK_SET, os.SEEK_CUR, os.SEEK_END)

base = '/tmp/pyposix_os_%d' % os.getpid()
os.mkdir(base)
os.chdir(base)
old_mask = os.umask(0o022)
try:
    print('-- makedirs, removedirs, renames')
    show(os.makedirs, 'a/b/c')
    show(os.makedirs, 'a/b/c')
    show(os.makedirs, 'a/b/c', exist_ok=True)
    show(os.makedirs, b'x/y', 0o700)
    print(sorted(os.listdir('.')), os.listdir('a'), os.listdir('a/b'), oct(os.stat('x/y').st_mode))
    show(os.removedirs, 'x/y')
    print(sorted(os.listdir('.')))
    write_file('a/b/c/file.txt', 'hello')
    show(os.renames, 'a/b/c/file.txt', 'p/q/moved.txt')
    print(sorted(os.listdir('.')), os.listdir('p/q'))

    print('-- walk')
    os.makedirs('tree/one/deep')
    os.makedirs('tree/two')
    for name in ('tree/top.txt', 'tree/one/a.txt', 'tree/one/b.txt', 'tree/one/deep/c.txt'):
        write_file(name, name)
    os.symlink('one', 'tree/link')
    for root, dirs, files in os.walk('tree'):
        dirs.sort()
        print(root, dirs, sorted(files))
    for root, dirs, files in os.walk('tree', topdown=False):
        print(root, sorted(dirs), sorted(files))
    print(sorted(root for root, dirs, files in os.walk('tree', followlinks=True)))
    print(sorted(root for root, dirs, files in os.walk(b'tree')))
    print(list(os.walk('nope')))
    errors = []
    list(os.walk('nope', onerror=errors.append))
    print(errors)
    for root, dirs, files, fd in os.fwalk('tree'):
        dirs.sort()
        print(root, dirs, sorted(files), type(fd).__name__)

    print('-- path')
    p = os.path
    print(p.exists('tree'), p.exists('nope'), p.lexists('tree/link'), p.isdir('tree'), p.isfile('tree'), p.isfile('tree/top.txt'), p.islink('tree/link'), p.isdir('tree/link'))
    print(p.getsize('tree/top.txt'), type(p.getmtime('tree/top.txt')).__name__, p.samefile('tree/one', 'tree/link'), p.samefile('tree/one', 'tree/two'))
    print(p.abspath('x') == base + '/x', p.realpath('tree/link') == p.realpath(base) + '/tree/one', p.relpath(base + '/tree/one') , p.relpath('tree/one', 'tree/two'))
    print(p.join('a', 'b', '/c', 'd'), p.split('/a/b/c'), p.splitext('a/b.tar.gz'), p.basename('/a/b/'), p.dirname('/a/b/c'), p.normpath('a//b/../c/.'), p.isabs('/a'), p.isabs('a'))
    print(p.commonpath(['/a/b/c', '/a/b/d']), p.commonprefix(['/a/bc', '/a/bd']), p.splitroot('//a/b'), p.splitdrive('/a'), p.ismount('/'), p.ismount(base))
    print(p.expanduser('~root'), p.expanduser('~no_such_user_here/x'), p.expandvars('$PYPOSIX_NOPE/${HOME}') == '$PYPOSIX_NOPE/' + os.environ['HOME'])
    os.environ['HOME'] = '/my/home'
    print(p.expanduser('~'), p.expanduser('~/x'), p.expanduser(b'~/x'))
    del os.environ['HOME']
    import pwd
    print(p.expanduser('~') == pwd.getpwuid(os.getuid()).pw_dir)
    print(p.isjunction('tree'), p.isreserved('x') if hasattr(p, 'isreserved') else None, p.isdevdrive('x') if hasattr(p, 'isdevdrive') else None)

    print('-- environ')
    e = os.environ
    print(type(e).__name__, 'PATH' in e, type(e['PATH']).__name__)
    e['PYPOSIX_X'] = 'caf\xe9'
    print(e['PYPOSIX_X'], os.getenv('PYPOSIX_X'), os.environb[b'PYPOSIX_X'], os.getenvb(b'PYPOSIX_X'), os.system('test "$PYPOSIX_X" = "caf\xe9"'))
    del e['PYPOSIX_X']
    print(os.getenv('PYPOSIX_X'), os.getenv('PYPOSIX_X', 'default'), os.system('test -z "$PYPOSIX_X"'))
    show(e.__getitem__, 'PYPOSIX_X')
    show(e.__setitem__, 'a', 5)
    show(e.__setitem__, 5, 'a')
    show(e.__setitem__, 'A=B', 'a')
    show(e.__delitem__, 'PYPOSIX_X')
    os.putenv('PYPOSIX_Y', '1')
    print('PYPOSIX_Y' in e)
    os.reload_environ()
    print(e.get('PYPOSIX_Y'))
    os.unsetenv('PYPOSIX_Y')
    print(e.setdefault('PYPOSIX_Z', 'z'), e.pop('PYPOSIX_Z'), e.copy() == dict(e), len(e) == len(os.environb))
    print(os.get_exec_path({'PATH': '/a:/b'}), os.get_exec_path({}) == os.defpath.split(':'))
    print(os.fsencode('caf\xe9\udcff'), os.fsdecode(b'caf\xc3\xa9\xff') == 'caf\xe9\udcff', os.fsencode(b'x'), os.fsdecode('x'))
    show(os.fsencode, 5)

    print('-- PathLike')
    class P:
        def __fspath__(self):
            return 'tree/top.txt'
    print(isinstance(P(), os.PathLike), issubclass(P, os.PathLike), isinstance('x', os.PathLike), isinstance(next(os.scandir('tree')), os.PathLike))
    print(os.fspath(P()), os.path.getsize(P()), os.stat(P()).st_size, os.path.basename(P()))
    print(os.PathLike[str])

    print('-- files')
    fd = os.open('data', os.O_RDWR | os.O_CREAT, 0o600)
    os.write(fd, b'through os.write\n')
    os.close(fd)
    print(os.stat('data').st_size, stat.filemode(os.stat('data').st_mode), stat.filemode(os.stat('tree').st_mode), stat.filemode(os.lstat('tree/link').st_mode))
    print(stat.S_IMODE(os.stat('data').st_mode), stat.S_IFMT(os.stat('data').st_mode) == stat.S_IFREG)
    print(os.cpu_count() >= 1, os.process_cpu_count() >= 1, os.process_cpu_count() == len(os.sched_getaffinity(0)))
    print(type(os.get_terminal_size).__name__, os.getlogin.__name__, len(os.urandom(5)), os.strerror(2))
    print(os.access in os.supports_dir_fd, os.stat in os.supports_fd)

    print('-- exec helpers')
    show(os.execvp, 'no_such_command_here', ['x'])
    show(os.execvpe, 'no_such_command_here', ['x'], {'PATH': '/bin'})
    show(os.execl, '/nonexistent', 'x')
    show(os.execle, '/nonexistent', 'x', {})
    show(os.execlp, 'no_such_command_here', 'x')
    show(os.execvp, '', ['x'])
finally:
    os.umask(old_mask)
    os.chdir('/')
    for root, dirs, files in os.walk(base, topdown=False):
        for name in files:
            os.unlink(os.path.join(root, name))
        for name in dirs:
            path = os.path.join(root, name)
            os.unlink(path) if os.path.islink(path) else os.rmdir(path)
    os.rmdir(base)
print(os.path.exists(base))
sys.stdout.flush()
os.execvp('echo', ['echo', 'replaced by echo'])
