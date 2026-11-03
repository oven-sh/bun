import signal, os, time, select, _thread
def t(f, *a, **k):
    try:
        print(repr(f(*a, **k)))
    except BaseException as e:
        print(type(e).__name__ + ':', e)
me = os.getpid()
U1, U2 = signal.SIGUSR1, signal.SIGUSR2

# Blocked, with the default action: it stays pending for the thread of Python, whatever other threads there are.
print(signal.pthread_sigmask(signal.SIG_BLOCK, [U1, U2]))
os.kill(me, U1); time.sleep(0.02); print(signal.sigpending()); print(signal.sigwait([U1, U2]), signal.sigpending())
os.kill(me, U2); time.sleep(0.02); i = signal.sigwaitinfo([U1, U2]); print(type(i).__name__, i.si_signo, i.si_pid == me, i.si_uid == os.getuid(), len(i), i.si_errno)
os.kill(me, U1); time.sleep(0.02); i = signal.sigtimedwait([U1], 1); print(i.si_signo, signal.sigtimedwait([U1], 0), signal.sigtimedwait([U1], 0.01))
print(signal.getsignal(U1), signal.getsignal(U2))
signal.raise_signal(U1); print(signal.sigpending(), signal.sigwait({U1}))
signal.pthread_kill(_thread.get_ident(), U2); print(signal.sigpending(), signal.sigwait(iter([U2])))
# SIGCHLD, which is dropped by default.
print(signal.pthread_sigmask(signal.SIG_BLOCK, [signal.SIGCHLD]) == {U1, U2})
os.kill(me, signal.SIGCHLD); time.sleep(0.02); print(signal.sigpending(), signal.sigwait([signal.SIGCHLD]))
pid = os.posix_spawn('/bin/true', ['true'], {}); i = signal.sigtimedwait([signal.SIGCHLD], 10); print(i.si_signo, i.si_signo == signal.SIGCHLD); print(os.waitpid(pid, 0) == (pid, 0))
# A handler given while it is blocked and pending
log = []
os.kill(me, U1); time.sleep(0.02)
signal.signal(U1, lambda n, f: log.append(n)); print(log, signal.sigpending())
print(sorted(signal.pthread_sigmask(signal.SIG_SETMASK, [])), log, signal.sigpending(), signal.pthread_sigmask(signal.SIG_SETMASK, []))
# The default again, while blocked; ignored while pending
signal.pthread_sigmask(signal.SIG_BLOCK, [U1]); signal.signal(U1, signal.SIG_DFL); os.kill(me, U1); time.sleep(0.02); print(signal.sigpending())
signal.signal(U1, signal.SIG_IGN); print(signal.sigpending()); signal.pthread_sigmask(signal.SIG_UNBLOCK, [U1]); print('alive')
signal.signal(U1, signal.SIG_DFL)

# The wakeup descriptor
r, w = os.pipe(); os.set_blocking(r, False); os.set_blocking(w, False)
signal.signal(U1, lambda n, f: log.append(('h', n))); signal.signal(U2, lambda n, f: log.append(('h', n))); log.clear()
signal.set_wakeup_fd(w)
os.kill(me, U1); os.kill(me, U2); print(os.read(r, 10), log); log.clear()
signal.signal(signal.SIGALRM, lambda n, f: log.append(('h', n))); signal.setitimer(signal.ITIMER_REAL, 0.05)
print(select.select([r], [], [], 5)[0] == [r], os.read(r, 10), log); log.clear()
p = select.poll(); p.register(r, select.POLLIN); signal.setitimer(signal.ITIMER_REAL, 0.05); print(p.poll(5000) == [(r, select.POLLIN)], os.read(r, 10), log); log.clear()
_thread.interrupt_main(U1); print(os.read(r, 10), log); log.clear()
# select goes on after a handler that returns, for the time that is left
signal.set_wakeup_fd(-1)
start = time.monotonic(); signal.setitimer(signal.ITIMER_REAL, 0.03); print(select.select([r], [], [], 0.15), time.monotonic() - start >= 0.15, log); log.clear()
class Boom(Exception): pass
def boom(n, f): raise Boom(n)
signal.signal(signal.SIGALRM, boom); signal.setitimer(signal.ITIMER_REAL, 0.03); t(select.select, [r], [], [], 5)
signal.setitimer(signal.ITIMER_REAL, 0.03); t(p.poll, 5000)
# A full pipe
import sys, io
signal.set_wakeup_fd(w, warn_on_full_buffer=False)
try:
    while True: os.write(w, b'x' * 65536)
except BlockingIOError: pass
os.kill(me, U1); print('no warning', log); log.clear()
signal.set_wakeup_fd(w, warn_on_full_buffer=True)
hooked = []
sys.unraisablehook = lambda u: hooked.append((type(u.exc_value).__name__, u.exc_value.errno == 11, u.err_msg, u.object))
os.kill(me, U1)
for i in range(3): pass
print(hooked, log); log.clear()
sys.unraisablehook = sys.__unraisablehook__
signal.set_wakeup_fd(-1); os.close(r); os.close(w)

# Blocking reads and writes (PEP 475)
r, w = os.pipe()
signal.signal(signal.SIGALRM, lambda n, f: (log.append(n), os.write(w, b'data')))
signal.setitimer(signal.ITIMER_REAL, 0.03); print(os.read(r, 10), log); log.clear()
signal.signal(signal.SIGALRM, boom); signal.setitimer(signal.ITIMER_REAL, 0.03); t(os.read, r, 10)
f = open(r, 'rb', closefd=False); signal.setitimer(signal.ITIMER_REAL, 0.03); t(f.read, 1)
f = open(r, 'rb', buffering=0, closefd=False); signal.setitimer(signal.ITIMER_REAL, 0.03); t(f.read, 1)
signal.signal(signal.SIGALRM, lambda n, f: (log.append(n), os.write(w, b'line\n')))
f = open(r, 'r', closefd=False); signal.setitimer(signal.ITIMER_REAL, 0.03); print(repr(f.readline()), log); log.clear()
pid = os.posix_spawn('/bin/sleep', ['sleep', '0.1'], {})
signal.signal(signal.SIGALRM, lambda n, f: log.append(n)); signal.setitimer(signal.ITIMER_REAL, 0.02); print(os.waitpid(pid, 0) == (pid, 0), log); log.clear()
pid = os.posix_spawn('/bin/sleep', ['sleep', '5'], {})
signal.signal(signal.SIGALRM, boom); signal.setitimer(signal.ITIMER_REAL, 0.02); t(os.waitpid, pid, 0); os.kill(pid, signal.SIGKILL); print(os.waitpid(pid, 0)[1])
# siginterrupt(False): the call is restarted by the system, and the handler waits
signal.signal(signal.SIGALRM, lambda n, f: log.append(n)); signal.siginterrupt(signal.SIGALRM, False)
signal.setitimer(signal.ITIMER_REAL, 0.02); start = time.monotonic(); print(select.select([r], [], [], 0.1), log); log.clear()
# A signal the program sends itself is pending at once.
signal.siginterrupt(signal.SIGALRM, True); signal.signal(U1, signal.SIG_DFL); signal.pthread_sigmask(signal.SIG_BLOCK, [U1, signal.SIGALRM])
for i in range(20):
    os.kill(me, U1); assert signal.sigpending() == {U1}, i; assert signal.sigtimedwait([U1], 0).si_signo == U1, i
    os.kill(me, signal.SIGALRM); assert signal.sigtimedwait([signal.SIGALRM], 0).si_signo == signal.SIGALRM, i
print('pending at once', signal.sigpending())
t(os.kill, me, 0); t(os.kill, me, 1000); t(os.kill, me, -1)
