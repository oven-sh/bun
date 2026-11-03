import _multiprocessing as M, os, time, gc
def t(f):
    try: print(repr(f()))
    except BaseException as x: print(type(x).__name__ + ':', str(x).replace(str(os.getpid()), 'PID'))
print([n for n in dir(M) if not n.startswith('__')], M.flags)
S = M.SemLock
print(sorted(n for n in dir(S) if not n.startswith('__')), S.__mro__, S.SEM_VALUE_MAX, S.__name__, S.__module__)
for n in dir(S):
    f = getattr(S, n)
    if not n.startswith('__') and callable(f): print(n, f.__text_signature__, type(f).__name__)
print(M.sem_unlink.__text_signature__)
name = '/pytest-sem-%d' % os.getpid()
s = S(1, 2, 3, name, False)   # a semaphore
print(s.kind, s.maxvalue, s.name == name, type(s.handle).__name__, s.handle != 0, s._count(), s._get_value(), s._is_zero(), s._is_mine())
print(s.acquire(), s._count(), s._get_value(), s.acquire(), s._get_value(), s._is_zero(), s.acquire(False), s.acquire(block=False), s.acquire(True, 0), s.acquire(timeout=0.01), s._count(), s._is_mine())
t0 = time.monotonic(); print(s.acquire(True, 0.05), 0.045 <= time.monotonic() - t0 < 3); print(s.acquire(True, -1))
print(s.release(), s._get_value(), s.release(), s.release(), s._get_value(), s._count()); t(s.release)
t(lambda: S(1, 1, 1, name, False))
o = S._rebuild(s.handle, 1, 3, name); print(o._get_value(), o.name == name, o.kind, o.maxvalue, o.acquire(), s._get_value(), o._count(), s._count())
q = S._rebuild(s.handle, 1, 3, None); print(q.handle == s.handle, q.name, q._get_value())
print(M.sem_unlink(name)); t(lambda: M.sem_unlink(name)); t(lambda: S._rebuild(0, 1, 3, name))
with s as r: print(r, s._get_value())
print(s._get_value(), s.__exit__.__name__)
# a recursive lock
l = S(0, 1, 1, name, True); print(l.name, l.kind, l.acquire(), l.acquire(), l.acquire(False), l._count(), l._is_mine(), l._get_value(), l.release(), l.release(), l._count(), l._get_value(), l.release(), l._count(), l._is_mine(), l._get_value()); t(l.release)
l.acquire(); print(l._after_fork(), l._count(), l._is_mine()); t(lambda: M.sem_unlink(name))
# a lock
k = S(1, 1, 1, name, True); print(k.acquire(), k.acquire(False), k.release()); t(k.release)
t(lambda: S(2, 1, 1, name, True)); t(lambda: S(-1, 1, 1, name, True)); t(lambda: S()); t(lambda: S(1, 1, 1, name)); t(lambda: S('a', 1, 1, name, True)); t(lambda: S(1, 'a', 1, name, True)); t(lambda: S(1, 1, 1, 5, True)); t(lambda: S(1, 1, 1, 'a\0b', True)); t(lambda: S(1, -1, 1, name, True)); t(lambda: S(1, 1, 1, name, True, 1))
t(lambda: S(kind=1, value=1, maxvalue=1, name=name, unlink=True).kind); t(lambda: S(1, 2**40, 1, name, True)); t(lambda: S(1, 1, 1, '/no/such/dir', True)); t(lambda: S(1, 1, 1, b'x', True))
t(lambda: s.acquire(True, 'x')); t(lambda: s.acquire(1, 2, 3)); t(lambda: s.acquire(foo=1)); t(lambda: M.sem_unlink(1)); t(lambda: M.sem_unlink()); t(lambda: M.sem_unlink('a\0'))
def sk(): s.kind = 1
t(sk); t(lambda: s.x)
class Sub(S): pass
z = Sub(1, 1, 1, name, True); z.attr = 1; print(type(z).__name__, z.acquire(), z.attr)
del s, o, q, l, k, z; gc.collect()
import multiprocessing.synchronize as Y
print(Y.SEM_VALUE_MAX, Y.SemLock.__name__)
