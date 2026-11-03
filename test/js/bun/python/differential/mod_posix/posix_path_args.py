# How arguments are converted: paths, file descriptors, ids, and the messages when they are wrong.
import posix, warnings

def show(function, *args, **kwargs):
    try:
        result = function(*args, **kwargs)
    except BaseException as e:
        print(type(e).__name__, e)
    else:
        print(repr(result))

class P:
    def __init__(self, value):
        self.value = value
    def __fspath__(self):
        if isinstance(self.value, BaseException):
            raise self.value
        return self.value

class NoneFspath:
    __fspath__ = None

class InstanceOnly:
    pass
instance_only = InstanceOnly()
instance_only.__fspath__ = lambda: '/'

class StrSub(str):
    pass
class BytesSub(bytes):
    pass
class Index:
    def __init__(self, value):
        self.value = value
    def __index__(self):
        return self.value

MISSING = 'surely/not/there'

print('-- kinds of path')
for path in (MISSING, MISSING.encode(), P(MISSING), P(MISSING.encode()), StrSub(MISSING), BytesSub(MISSING.encode()),
             P(StrSub(MISSING)), P(5), P(None), P(P('/')), P(ValueError('boom')), NoneFspath(), instance_only,
             bytearray(b'abc'), memoryview(b'abc'), 1.5, None, [], (), object(), 'a\0b', b'a\0b', P('a\0b'),
             '\udcff/nope', '\ud800', 'caf\xe9/nope', '€\U0001f40d/nope', b'\xff\xfe/nope', ''):
    show(posix.stat, path)

print('-- which functions take what')
for name in ('stat', 'lstat', 'listdir', 'scandir', 'mkdir', 'chdir', 'chmod', 'chown', 'open', 'readlink', 'rmdir', 'unlink', 'remove',
             'truncate', 'utime', 'statvfs', 'access', 'pathconf', 'execv', 'execve', 'chroot', 'mkfifo', 'mknod', 'lchown',
             'getxattr', 'listxattr', 'statx', '_path_normpath', '_path_splitroot_ex'):
    function = getattr(posix, name)
    extra = {'chmod': (0,), 'chown': (0, 0), 'lchown': (0, 0), 'open': (0,), 'truncate': (0,), 'access': (0,), 'pathconf': (0,),
             'execv': (['x'],), 'execve': (['x'], {}), 'getxattr': ('a',), 'statx': (0,)}.get(name, ())
    show(function, 1.5, *extra)
    show(function, 'a\0b', *extra)
for name in ('rename', 'replace', 'link', 'symlink'):
    function = getattr(posix, name)
    show(function, 1, 'a')
    show(function, 'a', 1)
    show(function, 'a\0', 'a')
    show(function, 'a', b'a\0')
    show(function, MISSING, MISSING + '2')
    show(function, MISSING.encode(), MISSING + '2')
    show(function, P(MISSING), P(MISSING.encode()))
show(posix.getxattr, '/', 5)
show(posix.getxattr, '/', 'a\0')
show(posix.setxattr, '/', 'user.x', 'text')
show(posix.removexattr, 5.0, 'a')

print('-- a descriptor for a path')
show(posix.stat, 9999)
show(posix.stat, -1)
show(posix.stat, 2**31)
show(posix.stat, -2**31 - 1)
show(posix.stat, 2**70)
show(posix.stat, -2**70)
try:
    posix.stat(Index(9999))
except OSError as e:
    print(type(e).__name__, e.errno, type(e.filename).__name__)
show(posix.stat, Index(2**40))
show(posix.listdir, 9999)
show(posix.scandir, 9999)
show(posix.chdir, 9999)
show(posix.truncate, 9999, 0)
show(posix.utime, 9999)
show(posix.statvfs, 9999)
show(posix.chmod, 9999, 0)
show(posix.chown, 9999, -1, -1)
show(posix.pathconf, 9999, 'PC_NAME_MAX')
with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter('always')
    print(type(posix.stat(False)).__name__)
    show(posix.stat, '.', dir_fd=True)
    show(posix.fsync, True)
    print([(w.category.__name__, str(w.message)) for w in caught])
with warnings.catch_warnings():
    warnings.simplefilter('error')
    show(posix.stat, True)
    show(posix.fchdir, False)

print('-- dir_fd and follow_symlinks')
show(posix.stat, MISSING, dir_fd='a')
show(posix.stat, MISSING, dir_fd=1.5)
show(posix.stat, MISSING, dir_fd=2**40)
show(posix.stat, MISSING, dir_fd=-2**40)
show(posix.stat, MISSING, dir_fd=None)
show(posix.stat, MISSING, dir_fd=9999)
show(posix.stat, MISSING, dir_fd=Index(9999))
show(posix.stat, 0, dir_fd=1)
show(posix.stat, 0, follow_symlinks=False)
show(posix.lstat, 0)
show(posix.lstat, MISSING, dir_fd=9999)
show(posix.utime, 0, dir_fd=1)
show(posix.utime, 0, follow_symlinks=False)
show(posix.chown, 0, -1, -1, dir_fd=1)
show(posix.chown, 0, -1, -1, follow_symlinks=False)
show(posix.statx, 0, 0, dir_fd=1)
show(posix.statx, 0, 0, follow_symlinks=False)
show(posix.getxattr, 0, 'user.x', follow_symlinks=False)
show(posix.listxattr, 0, follow_symlinks=False)
show(posix.access, MISSING, 0, dir_fd='x')
show(posix.mkdir, MISSING, dir_fd=9999)
show(posix.open, MISSING, 0, dir_fd=9999)
show(posix.unlink, MISSING, dir_fd=9999)
show(posix.rmdir, MISSING, dir_fd=9999)
show(posix.readlink, MISSING, dir_fd=9999)
show(posix.rename, MISSING, MISSING, src_dir_fd=9999)
show(posix.rename, MISSING, MISSING, dst_dir_fd=9999)
show(posix.link, MISSING, MISSING, src_dir_fd=9999)
show(posix.symlink, MISSING, MISSING, dir_fd=9999)
show(posix.mkfifo, MISSING, dir_fd=9999)
show(posix.mknod, MISSING, dir_fd=9999)

print('-- int')
for value in ('a', 1.5, None, 2**31, -2**31 - 1, 2**70, -2**70, Index(2**31), Index('a'), [], b'1'):
    show(posix.close, value)
for value in ('a', 1.5, None, 2**63, -2**63 - 1, 2**70):
    show(posix.lseek, 9999, value, 0)
    show(posix.read, 9999, value)
    show(posix.ftruncate, 9999, value)
show(posix.read, 9999, -1)
show(posix.pread, 9999, -1, 0)
show(posix.urandom, -1)
show(posix.urandom, 'a')
show(posix.urandom, 2**70)
show(posix.getrandom, -1)
show(posix.sendfile, 9999, 9999, 0, -1)
show(posix.sendfile, 9999, 9999, 'a', 1)
show(posix.sendfile, 9999, 9999, 'a', -1)
show(posix.copy_file_range, 9999, 9999, -1)
show(posix.splice, 9999, 9999, -1)
show(posix.splice, 9999, 9999, 1, flags=-1)
show(posix.splice, 9999, 9999, 1, flags=2**32)
show(posix.kill, 'a', 0)
show(posix.kill, 0, 'a')
show(posix.kill, 2**31, 0)
show(posix.kill, 0, 2**70)

print('-- what has fileno()')
class F:
    def __init__(self, value):
        self.value = value
    def fileno(self):
        return self.value
for value in ('a', 1.5, None, -1, -5, 2**31, 2**70, 9999, F(9999), F(-1), F('a'), F(1.5), F(2**40), F(True), Index(9999)):
    show(posix.fsync, value)
show(posix.fdatasync, 'a')
show(posix.fchdir, 9999)
show(posix.fpathconf, 'a', 0)
show(posix.eventfd_read, 'a')
show(posix.timerfd_gettime, -1)
show(posix.grantpt, 'a')
show(posix.ptsname, 9999)

print('-- uid, gid')
for value in ('a', 1.5, None, -2, -2**70, 2**32, 2**32 - 1, 2**63, 2**64, 2**70, Index('a')):
    show(posix.chown, MISSING, value, -1)
    show(posix.chown, MISSING, -1, value)
show(posix.setuid, 'a')
show(posix.setgid, 1.5)
show(posix.setreuid, -2, 0)
show(posix.setresgid, 0, 0, 2**70)

print('-- what becomes bytes')
for value in (5, None, 'a\0b', b'a\0b', '\ud800', P(5), P('a\0')):
    show(posix.putenv, value, 'x')
    show(posix.putenv, 'x', value)
    show(posix.unsetenv, value)
    show(posix.system, value)
    show(posix.memfd_create, value)
show(posix.fspath, 5)
show(posix.fspath, 'a')
show(posix.fspath, b'a')
show(posix.fspath, P('x'))
show(posix.fspath, P(b'x'))
show(posix.fspath, P(5))
show(posix.fspath, NoneFspath())
show(posix.fspath, instance_only)
show(posix.fspath, StrSub('x'))
print(type(posix.fspath(StrSub('x'))).__name__, type(posix.fspath(P(BytesSub(b'x')))).__name__)
show(posix.fspath, path='kw')
