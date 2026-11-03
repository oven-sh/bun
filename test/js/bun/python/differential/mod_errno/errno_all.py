# Every name, every value, and errorcode in its order.
import errno

print(errno.__name__, repr(errno.__doc__))
names = sorted(n for n in dir(errno) if not n.startswith('__'))
print(len(names))
for n in names:
    v = getattr(errno, n)
    print(n, type(v).__name__, v if n != 'errorcode' else len(v))
print(type(errno.errorcode).__name__, len(errno.errorcode))
for code, name in errno.errorcode.items():
    print(code, name, type(code).__name__, type(name).__name__, getattr(errno, name) == code)
print(errno.EWOULDBLOCK == errno.EAGAIN, errno.errorcode[errno.EAGAIN], errno.EDEADLOCK == errno.EDEADLK, errno.errorcode[errno.EDEADLK], errno.ENOTSUP == errno.EOPNOTSUPP, errno.errorcode[errno.ENOTSUP])
try:
    errno.ENOSUCHERROR
except AttributeError as e:
    print(type(e).__name__, e)
for code in (errno.ENOENT, errno.EACCES, errno.EEXIST, errno.EPIPE, errno.EINTR, errno.ECHILD, errno.ESRCH, errno.ETIMEDOUT, errno.ECONNRESET, errno.EISDIR, errno.ENOTDIR, errno.EAGAIN, errno.EPERM, errno.EINVAL, errno.ECONNREFUSED, errno.ECONNABORTED, errno.EINPROGRESS, errno.EALREADY, errno.ESHUTDOWN, errno.ENOTCAPABLE if hasattr(errno, 'ENOTCAPABLE') else 0):
    print(code, type(OSError(code, 'x')).__name__)
