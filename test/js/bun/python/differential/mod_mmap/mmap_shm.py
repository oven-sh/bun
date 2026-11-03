import _posixshmem as P, os, mmap
def t(f):
    try: print(repr(f()))
    except BaseException as x: print(type(x).__name__ + ':', str(x).replace(str(os.getpid()), 'PID'), x.args)
print([n for n in dir(P) if not n.startswith('__')], P.shm_open.__text_signature__, P.shm_unlink.__text_signature__)
t(lambda: P.shm_open('/nonexistent-xyz', 0)); t(lambda: P.shm_unlink('/nonexistent-xyz')); t(lambda: P.shm_open(1, 0)); t(lambda: P.shm_open('a\0b', 0)); t(lambda: P.shm_open()); t(lambda: P.shm_open('/x', 'y')); t(lambda: P.shm_unlink(b'x')); t(lambda: P.shm_open(path='/nonexistent-xyz', flags=0, mode=0o600)); t(lambda: P.shm_unlink(path='/nonexistent-xyz')); t(lambda: P.shm_open('/x', 0, 0, 0)); t(lambda: P.shm_open('\ud800', 0))
try: P.shm_open('/nonexistent-xyz', 0)
except OSError as e: print(e.errno, e.filename)
name = '/pytest-shm-%d' % os.getpid()
fd = P.shm_open(name, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600); print(fd > 2, os.get_inheritable(fd), oct(os.fstat(fd).st_mode & 0o777)); os.ftruncate(fd, 100)
t(lambda: P.shm_open(name, os.O_CREAT | os.O_EXCL | os.O_RDWR).__class__)
m = mmap.mmap(fd, 100); m[:5] = b'hello'; fd2 = P.shm_open(name, os.O_RDONLY); m2 = mmap.mmap(fd2, 100, access=mmap.ACCESS_READ); print(m2[:5]); m.close(); m2.close(); os.close(fd); os.close(fd2)
print(P.shm_unlink(name)); t(lambda: P.shm_unlink(name).__class__)
from multiprocessing import shared_memory
s = shared_memory.SharedMemory(create=True, size=64, track=False); print(s.size >= 64, type(s.buf).__name__, s.name.startswith('psm_')); s.buf[:4] = b'data'
o = shared_memory.SharedMemory(s.name, track=False); print(bytes(o.buf[:4])); o.close(); s.close(); s.unlink()
try: shared_memory.SharedMemory(s.name, track=False)
except FileNotFoundError as e: print('FileNotFoundError', e.errno)
