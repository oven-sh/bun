import _signal, signal, os, sys
def t(f, *a, **k):
    try:
        print(repr(f(*a, **k)))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

d = {k: getattr(_signal, k) for k in dir(_signal) if not k.startswith('__')}
print(sorted((k, v) for k, v in d.items() if isinstance(v, int)))
print(sorted(k for k, v in d.items() if not isinstance(v, int)))
print(_signal.ItimerError.__mro__, _signal.ItimerError.__module__, _signal.ItimerError.__name__, _signal.ItimerError.__qualname__)
print(_signal.struct_siginfo, _signal.struct_siginfo.__match_args__, _signal.struct_siginfo.n_fields, _signal.struct_siginfo.n_sequence_fields)
print(sorted(_signal.valid_signals()))
print([_signal.strsignal(i) for i in range(1, _signal.NSIG)])
print('_signal' in sys.modules, _signal.__name__)
# Bun has its own handlers for crashes, and the engine keeps SIGPWR.
mine = [i for i in range(1, _signal.NSIG) if i not in (_signal.SIGSEGV, _signal.SIGBUS, _signal.SIGILL, _signal.SIGFPE, _signal.SIGPWR, _signal.SIGABRT, _signal.SIGTRAP, _signal.SIGSYS)]
print([(i, _signal.getsignal(i)) for i in mine if _signal.getsignal(i) != 0])
print(_signal.getsignal(_signal.SIGINT) is _signal.default_int_handler, signal.getsignal(signal.SIGINT) is signal.default_int_handler)
print(signal.getsignal(signal.SIGPIPE), signal.getsignal(signal.SIGUSR1), signal.SIGINT, repr(signal.SIGINT), signal.Signals(2).name, signal.Handlers.SIG_DFL, signal.Sigmasks.SIG_BLOCK)

for f in (_signal.getsignal, _signal.strsignal):
    for a in (0, -1, _signal.NSIG, 1000, 2**40, 'x', None, 1.5):
        t(f, a)
t(_signal.getsignal); t(_signal.getsignal, 1, 2)
for a in (0, -1, _signal.NSIG, 2**40, 'x'):
    t(_signal.signal, a, _signal.SIG_DFL)
t(_signal.signal, _signal.SIGUSR1, None); t(_signal.signal, _signal.SIGUSR1, 2); t(_signal.signal, _signal.SIGUSR1, 'x'); t(_signal.signal, _signal.SIGUSR1, True); t(_signal.signal, _signal.SIGUSR1, 0.0); t(_signal.signal, _signal.SIGUSR1)
t(_signal.signal, _signal.SIGKILL, _signal.SIG_IGN); t(_signal.signal, _signal.SIGSTOP, print); t(_signal.signal, 32, print); t(_signal.signal, _signal.SIGKILL, _signal.SIG_DFL)
def h(*a): pass
print(_signal.signal(_signal.SIGUSR1, h), _signal.signal(_signal.SIGUSR1, _signal.SIG_IGN) is h, _signal.signal(_signal.SIGUSR1, print), _signal.getsignal(_signal.SIGUSR1) is print, _signal.signal(_signal.SIGUSR1, _signal.SIG_DFL) is print, _signal.getsignal(_signal.SIGUSR1))
print(signal.signal(signal.SIGUSR1, signal.SIG_IGN), signal.signal(signal.SIGUSR1, signal.SIG_DFL), signal.getsignal(signal.SIGUSR1))
class C:
    def __call__(self, *a): pass
c = C(); _signal.signal(_signal.SIGUSR2, c); print(_signal.getsignal(_signal.SIGUSR2) is c); _signal.signal(_signal.SIGUSR2, 0)

t(_signal.default_int_handler, 2, None); t(_signal.default_int_handler); t(_signal.default_int_handler, 'x', None); t(_signal.default_int_handler, 2)
t(_signal.raise_signal, 0); t(_signal.raise_signal, -1); t(_signal.raise_signal, 1000); t(_signal.raise_signal, 'x'); t(_signal.raise_signal)
t(_signal.alarm, 0); t(_signal.alarm, 'x'); t(_signal.alarm, 1.5); t(_signal.alarm); t(_signal.alarm, 100); t(_signal.alarm, 0); t(_signal.alarm, 2**40)
t(_signal.siginterrupt, 0, 1); t(_signal.siginterrupt, _signal.NSIG, 1); t(_signal.siginterrupt, _signal.SIGUSR1, 1); t(_signal.siginterrupt, _signal.SIGUSR1, False); t(_signal.siginterrupt, _signal.SIGUSR1, 'x'); t(_signal.siginterrupt, _signal.SIGKILL, 1); t(_signal.siginterrupt, 1)

t(_signal.getitimer, _signal.ITIMER_REAL); t(_signal.getitimer, _signal.ITIMER_VIRTUAL); t(_signal.getitimer, _signal.ITIMER_PROF); t(_signal.getitimer, -1); t(_signal.getitimer, 99); t(_signal.getitimer, 'x'); t(_signal.getitimer)
t(_signal.setitimer, _signal.ITIMER_REAL, 0); t(_signal.setitimer, _signal.ITIMER_REAL, -1); t(_signal.setitimer, -1, 0); t(_signal.setitimer, _signal.ITIMER_REAL, 'x'); t(_signal.setitimer, _signal.ITIMER_REAL, 1, 'x'); t(_signal.setitimer, _signal.ITIMER_REAL); t(_signal.setitimer, _signal.ITIMER_REAL, float('nan')); t(_signal.setitimer, _signal.ITIMER_REAL, 1e30); t(_signal.setitimer, _signal.ITIMER_REAL, 0, 0, 0)
print(_signal.setitimer(_signal.ITIMER_REAL, 1000, 2.5), [round(x, 1) for x in _signal.getitimer(_signal.ITIMER_REAL)][1], 999 < _signal.getitimer(_signal.ITIMER_REAL)[0] <= 1000)
old = _signal.setitimer(_signal.ITIMER_REAL, 0); print(type(old), len(old), type(old[0]), old[1], _signal.getitimer(_signal.ITIMER_REAL))
try: _signal.setitimer(-1, 0)
except _signal.ItimerError as e: print(type(e), e.errno, e.strerror, e.args, isinstance(e, OSError))
print(_signal.setitimer(_signal.ITIMER_VIRTUAL, 100.5, 1), _signal.setitimer(_signal.ITIMER_VIRTUAL, 0)[1])
_signal.signal(_signal.SIGALRM, _signal.SIG_IGN); print(_signal.setitimer(_signal.ITIMER_REAL, 1e-7)[0], _signal.setitimer(_signal.ITIMER_REAL, 0)[0] <= 1e-6); _signal.signal(_signal.SIGALRM, _signal.SIG_DFL)

t(_signal.set_wakeup_fd); t(_signal.set_wakeup_fd, 'x'); t(_signal.set_wakeup_fd, -1); t(_signal.set_wakeup_fd, 9999); t(_signal.set_wakeup_fd, -2); t(_signal.set_wakeup_fd, 2**40); t(_signal.set_wakeup_fd, fd=1); t(_signal.set_wakeup_fd, -1, True); t(_signal.set_wakeup_fd, -1, warn_on_full_buffer=False); t(_signal.set_wakeup_fd, -1, nope=1)
r, w = os.pipe()
try: _signal.set_wakeup_fd(w)
except ValueError as e: print(str(e).replace(str(w), 'W'))
os.set_blocking(w, False)
print(_signal.set_wakeup_fd(w), _signal.set_wakeup_fd(w) == w, _signal.set_wakeup_fd(-1) == w, _signal.set_wakeup_fd(-1))
os.close(r); os.close(w)

for f in (lambda m: _signal.pthread_sigmask(_signal.SIG_BLOCK, m), _signal.sigwait, _signal.sigwaitinfo, lambda m: _signal.sigtimedwait(m, 0)):
    for m in (1, None, 'x', [0], [-1], [_signal.NSIG], [1000], [2**70], [-2**70], ['x'], [1.5], [None]):
        t(f, m)
t(_signal.pthread_sigmask); t(_signal.pthread_sigmask, 1); t(_signal.pthread_sigmask, 'x', []); t(_signal.pthread_sigmask, 99, []); t(_signal.pthread_sigmask, -1, [1])
t(_signal.sigtimedwait, [], -1); t(_signal.sigtimedwait, [], 'x'); t(_signal.sigtimedwait, [], None); t(_signal.sigtimedwait, [], float('nan')); t(_signal.sigtimedwait, []); t(_signal.sigtimedwait, [], 0); t(_signal.sigtimedwait, [_signal.SIGUSR1], 0.01); t(_signal.sigtimedwait, [], 1e30)
import warnings
with warnings.catch_warnings(record=True) as ws:
    warnings.simplefilter('always')
    print(_signal.pthread_sigmask(_signal.SIG_BLOCK, [32, 33]))
    print([(w.category.__name__, str(w.message)) for w in ws])
t(_signal.sigpending); t(_signal.sigpending, 1); t(_signal.valid_signals, 1); t(_signal.pause, 1)
t(_signal.pthread_kill); t(_signal.pthread_kill, 'x', 1); t(_signal.pthread_kill, 1.5, 1); t(_signal.pthread_kill, None, 0)
import _thread
t(_signal.pthread_kill, _thread.get_ident(), 0); t(_signal.pthread_kill, _thread.get_ident(), 1000); t(_signal.pthread_kill, _thread.get_ident(), 'x'); t(_signal.pthread_kill, _thread.get_ident(), -1)
t(_signal.pidfd_send_signal); t(_signal.pidfd_send_signal, -1, 0); t(_signal.pidfd_send_signal, 0, 0, 1); t(_signal.pidfd_send_signal, 'x', 0); t(_signal.pidfd_send_signal, -1, 0, None, 'x'); t(_signal.pidfd_send_signal, -1, 0, None, 0, 0)
fd = os.pidfd_open(os.getpid()); t(_signal.pidfd_send_signal, fd, 0); t(_signal.pidfd_send_signal, fd, 0, None, 0); t(_signal.pidfd_send_signal, fd, 0, None, 99); os.close(fd)
print(signal.strsignal(signal.SIGTERM), signal.valid_signals() == {signal.Signals(s) if s in signal.Signals._value2member_map_ else s for s in _signal.valid_signals()})
print(sorted(n for n in dir(signal) if n.startswith(('SIG', 'ITIMER'))) == sorted(n for n in dir(_signal) if n.startswith(('SIG', 'ITIMER'))))
