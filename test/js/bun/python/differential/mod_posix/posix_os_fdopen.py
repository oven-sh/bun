# os.fdopen(), which needs the module io.
import os

def show(function, *args, **kwargs):
    try:
        result = function(*args, **kwargs)
    except BaseException as e:
        print(type(e).__name__, e)
    else:
        print(repr(result))

path = '/tmp/pyposix_fdopen_%d' % os.getpid()
fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
try:
    with os.fdopen(fd, 'w+') as f:
        f.write('through fdopen\n')
        f.seek(0)
        print(f.read())
    show(os.fstat, fd)
    show(os.fdopen, 'a')
    with open(path) as f:
        print(f.read(), os.fstat(f.fileno()).st_size, os.get_inheritable(f.fileno()))
        show(os.fsync, f)
finally:
    os.unlink(path)
