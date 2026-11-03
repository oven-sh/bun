import _thread, re
def t(f, *a, **k):
    try:
        print(re.sub(r'0x[0-9a-f]+', '0x', repr(f(*a, **k))))
    except BaseException as e:
        print(type(e).__name__ + ':', re.sub(r'0x[0-9a-f]+', '0x', str(e)))

print(sorted(n for n in dir(_thread) if not n.startswith('__')))
print(_thread.error is RuntimeError, _thread.LockType is _thread.lock, _thread.TIMEOUT_MAX, _thread._NAME_MAXLEN)
print(_thread.allocate is not None, _thread.get_ident() == _thread._get_main_thread_ident(), type(_thread.get_ident()), type(_thread.get_native_id()), _thread.get_ident() != 0)

# lock
l = _thread.allocate_lock()
print(type(l), type(l).__mro__, type(l).__name__, type(l).__module__, type(l).__qualname__)
print(sorted(n for n in dir(l) if not n.startswith('__')))
t(repr, l); print(l.locked(), l.acquire(), l.locked()); t(repr, l)
print(l.acquire(False), l.acquire(blocking=False), l.acquire(True, 0.01), l.acquire(timeout=0.01), l.acquire(1, 0), l.acquire(False, -1))
print(l.release(), l.locked())
t(l.release)
t(l.acquire, False, 1); t(l.acquire, False, 0); t(l.acquire, True, -2); t(l.acquire, True, -0.5); t(l.acquire, timeout=1e100); t(l.acquire, timeout=_thread.TIMEOUT_MAX + 1); t(l.acquire, 1, 2, 3); t(l.acquire, 'x', 'y'); t(l.acquire, timeout='y'); t(l.acquire, nope=1); t(l.acquire, timeout=None)
if l.locked(): l.release()
t(l.acquire, timeout=float('nan'))
if l.locked(): l.release()
with l as x:
    print(x, l.locked())
print(l.locked())
try:
    with l:
        raise ValueError('in with')
except ValueError as e:
    print(e, l.locked())
print(l.acquire_lock(), l.locked_lock(), l.release_lock(), l.locked_lock())
l.acquire(); print(l._at_fork_reinit(), l.locked())
t(l.__exit__); t(l.__enter__); t(l.__exit__, None, None, None); t(l.__exit__, 1)
t(_thread.lock); t(_thread.lock, 1); t(_thread.LockType)
t(lambda: type('X', (_thread.lock,), {}))
t(setattr, l, 'x', 1)
import weakref; print(weakref.ref(l)() is l)
t(hash, l) if False else None
print(l == l, l != _thread.allocate_lock())

# RLock
r = _thread.RLock()
print(type(r), type(r).__mro__, sorted(n for n in dir(r) if not n.startswith('__')))
t(repr, r); print(r.acquire(), r.acquire(), r.acquire(False), r.acquire(True, 1), r._recursion_count(), r._is_owned(), r.locked())
print(re.sub(r'owner=\d+', 'owner=N', re.sub(r'0x[0-9a-f]+', '0x', repr(r))))
print(r.release(), r.release(), r.release(), r._recursion_count(), r.release(), r._recursion_count(), r._is_owned(), r.locked())
t(r.release)
t(r.acquire, False, 1); t(r.acquire, True, -2); t(r.acquire, timeout=1e100); t(r.acquire, 1, 2, 3)
while r._is_owned(): r.release()
with r as x:
    print(x, r._recursion_count())
    with r:
        print(r._recursion_count())
        s = r._release_save(); print(type(s), len(s), s[0], s[1] == _thread.get_ident(), r._is_owned(), r._recursion_count())
        print(r._acquire_restore(s), r._recursion_count())
print(r._recursion_count())
t(r._release_save); t(r._acquire_restore, 1); t(r._acquire_restore, (1,)); t(r._acquire_restore, (1, 2, 3)); t(r._acquire_restore, ('a', 'b')); t(r._acquire_restore)
while r._is_owned(): r.release()
r.acquire(); print(r._at_fork_reinit(), r._is_owned(), r._recursion_count())
class MyR(_thread.RLock):
    pass
m = MyR(); print(type(m).__name__, m.acquire(), m._recursion_count()); m.release()
t(_thread.RLock, 1); t(_thread.RLock, a=1)
print(weakref.ref(r)() is r)
t(setattr, r, 'x', 1)

# _local
loc = _thread._local()
print(type(loc), type(loc).__mro__)
loc.a = 1; loc.b = [2]; print(loc.a, loc.b, loc.__dict__, sorted(vars(loc)))
del loc.a; t(getattr, loc, 'a'); t(delattr, loc, 'a')
t(_thread._local, 1); t(_thread._local, x=1)
class L(_thread._local):
    cls = 'class attribute'
    def __init__(self, v=0, **kw): self.v = v; self.kw = kw; print('init', v, kw)
x = L(5, k=1); print(x.v, x.kw, x.cls, x.__dict__)
class L2(_thread._local):
    __slots__ = ('s',)
y = L2(); y.s = 1; y.d = 2; print(y.s, y.d, y.__dict__)
t(setattr, loc, '__dict__', {}); t(delattr, loc, '__dict__')
print(weakref.ref(loc)() is loc)
loc.__dict__['via'] = 'dict'; print(loc.via)

# handles
h = _thread._ThreadHandle()
print(type(h), sorted(n for n in dir(h) if not n.startswith('__')))
t(repr, h); print(h.ident, h.is_done())
t(h.join); t(h.join, 0); t(h.join, None); t(h._set_done); t(h.join, 'x'); t(h.join, 1, 2)
t(setattr, h, 'ident', 1)
t(_thread._ThreadHandle, 1, 2, a=3)
m = _thread._make_thread_handle(_thread.get_ident())
print(m.ident == _thread.get_ident(), m.is_done())
t(m.join); t(m.join, 0)
print(m._set_done(), m.is_done(), m.join(), m.join(1), m._set_done(), m.is_done())
t(_thread._make_thread_handle); t(_thread._make_thread_handle, 'x'); t(_thread._make_thread_handle, -1); t(_thread._make_thread_handle, 1.5); t(_thread._make_thread_handle, 2**70)
o = _thread._make_thread_handle(12345); print(o.ident, o.is_done()); t(repr, o)
t(lambda: type('X', (_thread._ThreadHandle,), {}))

# functions
print(_thread.stack_size(), _thread.stack_size(0), _thread._count(), _thread.daemon_threads_allowed(), _thread._is_main_interpreter(), _thread._shutdown())
t(_thread.stack_size, -1); t(_thread.stack_size, 'x'); t(_thread.stack_size, 1, 2); t(_thread.stack_size, 100)
print(_thread.stack_size(1 << 20), _thread.stack_size(), _thread.stack_size(0), _thread.stack_size())
t(_thread.exit); t(_thread.exit_thread); t(_thread.exit, 1)
t(_thread.get_ident, 1); t(_thread._count, 1)
t(_thread.start_new_thread); t(_thread.start_new_thread, 1); t(_thread.start_new_thread, 1, ()); t(_thread.start_new_thread, print, 1); t(_thread.start_new_thread, print, (), 1); t(_thread.start_new_thread, print, (), {}, 1)
t(_thread.start_joinable_thread); t(_thread.start_joinable_thread, 1); t(_thread.start_joinable_thread, function=1); t(_thread.start_joinable_thread, print, handle=1); t(_thread.start_joinable_thread, print, nope=1)
t(_thread.interrupt_main, 0); t(_thread.interrupt_main, -1); t(_thread.interrupt_main, 1000); t(_thread.interrupt_main, 'x')
t(_thread.set_name); t(_thread.set_name, 1); t(_thread.set_name, b'x')
old = _thread._get_name(); print(type(old))
print(_thread.set_name('worker'), _thread._get_name(), _thread.set_name(name='a-very-long-thread-name-indeed'), _thread._get_name(), _thread.set_name('é€'), _thread._get_name())
_thread.set_name(old)
A = _thread._ExceptHookArgs
print(A, A.__match_args__, A.n_fields, A.n_sequence_fields, A.__module__, A.__name__)
a = A((ValueError, ValueError('boom'), None, None)); print(a.exc_type, repr(a.exc_value), a.exc_traceback, a.thread, len(a))
t(A, (1, 2)); t(A)
t(_thread._excepthook, 1); t(_thread._excepthook, (1, 2, 3, 4)); t(_thread._excepthook)
print(_thread._excepthook(A((SystemExit, SystemExit(), None, None))))
