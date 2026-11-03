import signal, os, sys, time, _thread
def t(f, *a, **k):
    try:
        print(repr(f(*a, **k)))
    except BaseException as e:
        print(type(e).__name__ + ':', e)
log = []
def h(n, frame):
    log.append((n, type(frame).__name__, frame.f_code.co_name if frame else None))

signal.signal(signal.SIGUSR1, h)
# Right after the call that sends it.
os.kill(os.getpid(), signal.SIGUSR1); print(log); log.clear()
signal.raise_signal(signal.SIGUSR1); print(log); log.clear()
signal.pthread_kill(_thread.get_ident(), signal.SIGUSR1); print(log); log.clear()
def inner():
    os.kill(os.getpid(), signal.SIGUSR1)
    return list(log)
print(inner()); log.clear()
_thread.interrupt_main(signal.SIGUSR1); print(log); log.clear()
# The number is a plain int when the handler is called; signal.py does not wrap it.
def show(n, f): print(type(n), n, f.f_lineno > 0)
signal.signal(signal.SIGUSR2, show); signal.raise_signal(signal.SIGUSR2)

# Several at once: in the order of their numbers.
signal.signal(signal.SIGUSR2, h); signal.signal(signal.SIGHUP, h); signal.signal(signal.SIGTERM, h)
signal.pthread_sigmask(signal.SIG_BLOCK, [signal.SIGUSR1, signal.SIGUSR2, signal.SIGHUP, signal.SIGTERM])
for s in (signal.SIGTERM, signal.SIGUSR2, signal.SIGUSR1, signal.SIGHUP, signal.SIGUSR1):
    os.kill(os.getpid(), s)
print(log, sorted(signal.sigpending()))
print(sorted(signal.pthread_sigmask(signal.SIG_UNBLOCK, [signal.SIGUSR1, signal.SIGUSR2, signal.SIGHUP, signal.SIGTERM])))
print([x[0] for x in log], signal.sigpending(), signal.pthread_sigmask(signal.SIG_BLOCK, [])); log.clear()

# What a handler raises is raised in the code that runs.
class Boom(Exception): pass
def boom(n, f): raise Boom(n)
signal.signal(signal.SIGUSR1, boom)
t(os.kill, os.getpid(), signal.SIGUSR1)
t(signal.raise_signal, signal.SIGUSR1)
try:
    os.kill(os.getpid(), signal.SIGUSR1)
    print('not reached')
except Boom as e:
    print('caught', e, e.__traceback__.tb_next.tb_frame.f_code.co_name)
def loop():
    signal.setitimer(signal.ITIMER_REAL, 0.01)
    n = 0
    while True:
        n += 1
signal.signal(signal.SIGALRM, boom)
try: loop()
except Boom as e: print('loop ended by', e)
def recurse(n):
    return recurse(n + 1) if n % 50 else recurse2(n)
def recurse2(n):
    for i in range(3): pass
    return 0 if stop else recurse3()
def recurse3(): return recurse(1)
stop = False
signal.setitimer(signal.ITIMER_REAL, 0.01)
try:
    while True: recurse2(0) if False else sum(range(10))
except Boom as e: print('natives in a loop ended by', e)
# Two, and the first raises: the second is handled afterwards.
signal.signal(signal.SIGUSR2, h)
signal.pthread_sigmask(signal.SIG_BLOCK, [signal.SIGUSR1, signal.SIGUSR2])
os.kill(os.getpid(), signal.SIGUSR1); os.kill(os.getpid(), signal.SIGUSR2)
try:
    signal.pthread_sigmask(signal.SIG_UNBLOCK, [signal.SIGUSR1, signal.SIGUSR2])
except Boom as e:
    print('first', e)
for i in range(3): pass
print([x[0] for x in log]); log.clear()

# Waiting
signal.signal(signal.SIGALRM, h)
start = time.monotonic(); signal.setitimer(signal.ITIMER_REAL, 0.05); time.sleep(0.2); print('slept on', time.monotonic() - start >= 0.2, log); log.clear()
signal.signal(signal.SIGALRM, boom)
start = time.monotonic(); signal.setitimer(signal.ITIMER_REAL, 0.05)
try: time.sleep(5)
except Boom as e: print('sleep ended by', e, time.monotonic() - start < 2)
signal.signal(signal.SIGALRM, h); signal.setitimer(signal.ITIMER_REAL, 0.05); print(signal.pause(), log); log.clear()
signal.signal(signal.SIGALRM, boom); signal.setitimer(signal.ITIMER_REAL, 0.05); t(signal.pause)
# A lock that is held: the handler may raise, or release it.
l = _thread.allocate_lock(); l.acquire()
signal.setitimer(signal.ITIMER_REAL, 0.05); t(l.acquire)
signal.setitimer(signal.ITIMER_REAL, 0.05); t(l.acquire, True, 5)
signal.signal(signal.SIGALRM, lambda n, f: l.release())
signal.setitimer(signal.ITIMER_REAL, 0.05); t(l.acquire); print(l.locked())
signal.setitimer(signal.ITIMER_REAL, 0.05); t(l.acquire, True, 5); print(l.locked())
signal.signal(signal.SIGALRM, h)
start = time.monotonic(); signal.setitimer(signal.ITIMER_REAL, 0.02); print(l.acquire(True, 0.1), time.monotonic() - start >= 0.1, log); log.clear()
import threading
e = threading.Event(); signal.signal(signal.SIGALRM, lambda n, f: e.set()); signal.setitimer(signal.ITIMER_REAL, 0.05); print(e.wait(), e.wait(5))
# An interval
count = []
signal.signal(signal.SIGALRM, lambda n, f: count.append(n)); signal.setitimer(signal.ITIMER_REAL, 0.01, 0.01)
while len(count) < 3: pass
signal.setitimer(signal.ITIMER_REAL, 0); print(count[:3])
signal.signal(signal.SIGVTALRM, lambda n, f: count.append(n)); signal.setitimer(signal.ITIMER_VIRTUAL, 0.01)
while count[-1] != signal.SIGVTALRM: pass
print('virtual')
signal.signal(signal.SIGALRM, h); print(signal.alarm(1), signal.alarm(0), signal.alarm(0))

# Ignoring, and the default
signal.signal(signal.SIGUSR1, signal.SIG_IGN); os.kill(os.getpid(), signal.SIGUSR1); print('ignored', log)
_thread.interrupt_main(signal.SIGUSR1); print(log)
signal.signal(signal.SIGUSR1, signal.SIG_DFL); _thread.interrupt_main(signal.SIGUSR1); print('nothing', log)
signal.signal(signal.SIGCHLD, signal.SIG_DFL); os.kill(os.getpid(), signal.SIGCHLD); print('SIGCHLD does nothing')

# KeyboardInterrupt
try:
    os.kill(os.getpid(), signal.SIGINT)
    print('not reached')
except KeyboardInterrupt as e:
    print('KeyboardInterrupt', e.args)
try:
    _thread.interrupt_main()
    print('not reached')
except KeyboardInterrupt:
    print('KeyboardInterrupt again')
try:
    signal.raise_signal(signal.SIGINT)
except KeyboardInterrupt:
    print('and again')
# A handler that sends a signal; a handler for a signal that arrives while it runs
def outer(n, f):
    log.append('outer in'); os.kill(os.getpid(), signal.SIGUSR2); log.append('outer out')
signal.signal(signal.SIGUSR1, outer); signal.signal(signal.SIGUSR2, lambda n, f: log.append('nested'))
os.kill(os.getpid(), signal.SIGUSR1); print(log); log.clear()
# The handler is replaced by itself
def once(n, f):
    log.append('once'); signal.signal(n, signal.SIG_IGN)
signal.signal(signal.SIGUSR1, once); os.kill(os.getpid(), signal.SIGUSR1); os.kill(os.getpid(), signal.SIGUSR1); print(log, signal.getsignal(signal.SIGUSR1)); log.clear()
# In a generator, a comprehension, a with block, a finally
signal.signal(signal.SIGUSR1, boom)
def gen():
    try:
        yield 1
        os.kill(os.getpid(), signal.SIGUSR1)
        yield 2
    finally:
        print('gen finally')
t(list, gen())
t(lambda: [os.kill(os.getpid(), signal.SIGUSR1) for _ in range(2)])
