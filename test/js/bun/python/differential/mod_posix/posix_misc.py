# What the system says of itself, random bytes, paths as text, device numbers.
import posix

def show(function, *args, **kwargs):
    try:
        result = function(*args, **kwargs)
    except BaseException as e:
        print(type(e).__name__, e)
    else:
        print(repr(result))

print('-- uname, times')
u = posix.uname()
print(type(u), len(u), [type(x).__name__ for x in u], u.sysname, u[0] == u.sysname, u.machine == u[4])
show(posix.uname, 1)
t = posix.times()
print(type(t), len(t), [type(x).__name__ for x in t], t.user >= 0, t.elapsed > 0, t[0] == t.user)

print('-- sysconf, confstr, pathconf')
for name in ('SC_PAGESIZE', 'SC_PAGE_SIZE', 'SC_CLK_TCK', 'SC_ARG_MAX', 'SC_NGROUPS_MAX', 'SC_LINE_MAX', 'SC_IOV_MAX', 'SC_2_VERSION', 'SC_VERSION', 'SC_CHAR_BIT', 'SC_THREADS'):
    show(posix.sysconf, name)
print(posix.sysconf(posix.sysconf_names['SC_PAGESIZE']) == posix.sysconf('SC_PAGESIZE'))
show(posix.sysconf, 'SC_NOPE')
show(posix.sysconf, -1)
show(posix.sysconf, 99999)
show(posix.sysconf, 1.5)
show(posix.sysconf, None)
show(posix.sysconf, b'SC_PAGESIZE')
show(posix.sysconf, 2**40)
show(posix.sysconf)
show(posix.sysconf, name='SC_PAGESIZE')
posix.sysconf_names['SC_MINE'] = posix.sysconf_names['SC_CLK_TCK']
show(posix.sysconf, 'SC_MINE')
posix.sysconf_names['SC_BAD'] = 'text'
show(posix.sysconf, 'SC_BAD')
del posix.sysconf_names['SC_MINE'], posix.sysconf_names['SC_BAD']
show(posix.confstr, 'CS_PATH')
print(posix.confstr('CS_GNU_LIBC_VERSION').startswith('glibc '))
show(posix.confstr, 'CS_LFS_CFLAGS')
show(posix.confstr, 'CS_NOPE')
show(posix.confstr, -1)
show(posix.confstr, 1.5)
show(posix.pathconf, '/', 'PC_NAME_MAX')
show(posix.pathconf, b'/', 'PC_PATH_MAX')
show(posix.pathconf, '/', 'PC_PIPE_BUF')
show(posix.pathconf, '/', posix.pathconf_names['PC_LINK_MAX']) if False else None
show(posix.pathconf, '/', 'PC_NOPE')
show(posix.pathconf, '/', -1)
show(posix.pathconf, '/nonexistent', 'PC_NAME_MAX')
show(posix.pathconf, '/nonexistent', -1)
show(posix.pathconf, path='/', name='PC_NAME_MAX')
fd = posix.open('/', posix.O_RDONLY)
show(posix.pathconf, fd, 'PC_NAME_MAX')
show(posix.fpathconf, fd, 'PC_NAME_MAX')
show(posix.fpathconf, fd, 'PC_NOPE')
show(posix.fpathconf, fd, -1)
posix.close(fd)
show(posix.fpathconf, fd, 'PC_NAME_MAX')

print('-- counts')
n = posix.cpu_count()
print(type(n).__name__, n >= 1, n == posix.sysconf('SC_NPROCESSORS_ONLN'))
l = posix.getloadavg()
print(type(l).__name__, len(l), [type(x).__name__ for x in l], all(x >= 0 for x in l))

print('-- strerror')
import errno
for code in (0, 1, 2, errno.EEXIST, errno.EINVAL, errno.ENOTEMPTY, 133, 134, 99999, -1):
    show(posix.strerror, code)
show(posix.strerror, 'a')
show(posix.strerror, 2**40)
show(posix.strerror, code=1)

print('-- random')
for size in (0, 1, 16, 1000, 100000):
    data = posix.urandom(size)
    print(type(data).__name__, len(data))
print(posix.urandom(16) != posix.urandom(16), len(set(posix.urandom(10000))) > 200)
print(len(posix.urandom(True)))
for size in (0, 1, 16, 256):
    data = posix.getrandom(size)
    print(type(data).__name__, len(data))
print(len(posix.getrandom(8, posix.GRND_NONBLOCK)), len(posix.getrandom(size=8, flags=0)))
show(posix.getrandom, 8, -1)
show(posix.getrandom, 8, 'a')
show(posix.getrandom)

print('-- normpath')
CASES = ['', '.', '..', '/', '//', '///', '////', '/.', '/..', '/../..', '//..', '///..', 'a', 'a/', 'a//', 'a/b', 'a//b', 'a/./b', 'a/../b', 'a/b/..', 'a/b/../..',
         'a/b/../../..', '../a', '../../a', '../a/..', './a', './/a', './', '././.', '/a/b/c/../../d', '//a/b', '///a/b', '/a/./b/', 'a/.../b', '...', '..a', 'a..', '.a', 'a.',
         '/./a', '/../a', '//../a', 'a/b/c/../../../../d', '../..', '.././..', 'a/\0/b', '\0', 'a\0', '/\0/..', 'caf\xe9/./€/../\U0001f40d', '\udcff/../x', ' ', ' / ', 'a/ /..']
for case in CASES:
    print(ascii(case), ascii(posix._path_normpath(case)), posix._path_normpath(case.encode('utf-8', 'surrogateescape')))
class P:
    def __init__(self, value):
        self.value = value
    def __fspath__(self):
        return self.value
show(posix._path_normpath, P('a/../b'))
show(posix._path_normpath, P(b'a/../b'))
show(posix._path_normpath, path='x/.')
show(posix._path_normpath, 5)
show(posix._path_normpath, None)
show(posix._path_normpath)
show(posix._path_normpath, b'\xff/./\xfe')
show(posix._path_normpath, 'x' * 5000 + '/../y')
print(len(posix._path_normpath('/'.join(['ab'] * 3000))), posix._path_normpath('/'.join(['ab', '..'] * 3000)))

print('-- splitroot')
for case in CASES:
    print(ascii(case), ascii(posix._path_splitroot_ex(case)), posix._path_splitroot_ex(case.encode('utf-8', 'surrogateescape')))
show(posix._path_splitroot_ex, P('/a'))
show(posix._path_splitroot_ex, P(b'//a'))
show(posix._path_splitroot_ex, 5)
show(posix._path_splitroot_ex, path='x')

print('-- devices')
for device in (0, 1, 255, 256, 0x1234, 0x12345678, 2**32, 2**40 + 5, 2**63, 2**64 - 1, 2**64 - 2, -1):
    print(device, posix.major(device), posix.minor(device), posix.makedev(posix.major(device), posix.minor(device)) == device)
for value in (-2, 2**64, 'a', 1.5, None):
    show(posix.major, value)
    show(posix.minor, value)
    show(posix.makedev, value, 0)
    show(posix.makedev, 0, value)
for pair in ((1, 2), (8, 1), (259, 1048575), (4095, 255), (2**32 - 1, 2**32 - 1), (2**32 - 2, 0), (2**32, 0), (0, 2**32), (-1, -1), (-1, 0), (0, -1), (True, False)):
    show(posix.makedev, *pair)
print(posix.NODEV)

print('-- umask')
old = posix.umask(0o027)
print(posix.umask(0o077), posix.umask(old) == 0o077)
show(posix.umask, 'a')
show(posix.umask, 2**40)
show(posix.umask)

print('-- the rest')
show(posix._inputhook)
show(posix._is_inputhook_installed)
show(posix.register_at_fork)
show(posix.register_at_fork, before=5)
show(posix.register_at_fork, after_in_child='x')
show(posix.register_at_fork, after_in_parent=None)
show(posix.register_at_fork, before=print)
show(posix.register_at_fork, before=print, after_in_child=len, after_in_parent=lambda: None)
show(posix.register_at_fork, other=print)
