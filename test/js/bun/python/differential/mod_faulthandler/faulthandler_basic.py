import faulthandler, sys, os, re, select, signal, time, tempfile
def t(f, *a, **k):
    try:
        print(repr(f(*a, **k)))
    except BaseException as e:
        print(type(e).__name__ + ':', e)
def norm(b):
    s = b.decode() if isinstance(b, bytes) else b
    s = re.sub(r'0x[0-9a-f]{16}', '0xT', s); s = re.sub(r' \[[^\]]*\]', ' [name]', s); s = re.sub(r'File ".*?([^/"]*)"', r'File "\1"', s)
    return s
r, w = os.pipe(); os.set_blocking(r, False)
def raw():
    try: return os.read(r, 65536)
    except BlockingIOError: return b''
def got(): return norm(raw())

print(sorted(n for n in dir(faulthandler) if not n.startswith('_')))
print(faulthandler.is_enabled(), faulthandler.disable(), faulthandler.enable(w), faulthandler.is_enabled(), faulthandler.enable(file=w, all_threads=False, c_stack=False, max_threads=5), faulthandler.disable(), faulthandler.is_enabled(), faulthandler.disable())
def f():
    faulthandler.dump_traceback(w)
def g(): f()
g(); print(got())
def f2(): faulthandler.dump_traceback(w, False)
f2(); print(got())
faulthandler.dump_traceback(file=w, all_threads=False, max_threads=1); print(got())
class C:
    def method(self): faulthandler.dump_traceback(w, all_threads=False)
C().method(); print(got())
(lambda: faulthandler.dump_traceback(w, all_threads=False))(); print(got())
def gen():
    faulthandler.dump_traceback(w, all_threads=False); yield
list(gen()); print(got())
[faulthandler.dump_traceback(w, all_threads=False) for _ in range(1)]; print(got())
def deep(n):
    if n: deep(n - 1)
    else: faulthandler.dump_traceback(w, all_threads=False)
deep(50); print(got().count('\n'))
deep(98); print(got().count('\n'))
deep(99); print(got().count('\n'))
deep(150); s = got(); print(s.count('\n'), s.splitlines()[-1])
exec(compile('def h\xe9\u4e2d(): faulthandler.dump_traceback(w, False)\nh\xe9\u4e2d()', 'f\xefle €\U0001f600\n.py', 'exec')); print(got())
exec(compile('faulthandler.dump_traceback(w, False)', 'x' * 600, 'exec')); s = got(); print(len(s.splitlines()[1]), s.splitlines()[1][-30:])
# A file object: flushed first
with tempfile.TemporaryFile('w+') as tf:
    tf.write('before\n'); faulthandler.dump_traceback(tf, False); tf.seek(0); print(norm(tf.read()))
class F:
    def fileno(self): return w
    def flush(self): print('flushed')
faulthandler.dump_traceback(F(), False); print(got())
class F2(F):
    def flush(self): raise ValueError('ignored')
faulthandler.dump_traceback(F2(), False); print(got())

for f in (faulthandler.dump_traceback, faulthandler.enable, faulthandler.dump_c_stack, lambda file: faulthandler.register(signal.SIGUSR1, file), lambda file: faulthandler.dump_traceback_later(10, file=file)):
    for a in (-1, 'x', 1.5, object(), 2**40):
        t(f, a)
class Bad:
    def __init__(self, v): self.v = v
    def fileno(self): return self.v
for v in (-1, 'x', None, 2**40, 1.5):
    t(faulthandler.dump_traceback, Bad(v))
class Raises:
    def fileno(self): raise KeyError('fileno')
t(faulthandler.dump_traceback, Raises())
old = sys.stderr; sys.stderr = None; e = []
for f in (faulthandler.dump_traceback, faulthandler.enable, lambda: faulthandler.register(signal.SIGUSR1), lambda: faulthandler.dump_traceback_later(10)):
    try: f()
    except RuntimeError as x: e.append(str(x))
sys.stderr = old; print(e)
import warnings
with warnings.catch_warnings(record=True) as ws:
    warnings.simplefilter('always'); faulthandler.dump_traceback(True, False) if False else None
t(faulthandler.dump_traceback, w, False, 1); t(faulthandler.dump_traceback, nope=1); t(faulthandler.dump_traceback, w, max_threads='x'); got()
t(faulthandler.enable, w, True, True, 1); t(faulthandler.disable, 1); t(faulthandler.is_enabled, 1)
print(faulthandler.is_enabled())

# register
for a in (0, -1, signal.NSIG, 1000, 'x', signal.SIGSEGV, signal.SIGFPE, signal.SIGABRT, signal.SIGBUS, signal.SIGILL):
    t(faulthandler.register, a, w); t(faulthandler.unregister, a)
t(faulthandler.register); t(faulthandler.unregister); t(faulthandler.register, signal.SIGKILL, w)
print(faulthandler.unregister(signal.SIGUSR1), faulthandler.register(signal.SIGUSR1, w), signal.getsignal(signal.SIGUSR1))
def send(): os.kill(os.getpid(), signal.SIGUSR1)
send(); print(got())
faulthandler.register(signal.SIGUSR1, file=w, all_threads=False); send(); print(got())
print(faulthandler.unregister(signal.SIGUSR1), faulthandler.unregister(signal.SIGUSR1))
log = []
signal.signal(signal.SIGUSR1, lambda n, f: log.append(n))
faulthandler.register(signal.SIGUSR1, w, False); send(); print(got(), log)
faulthandler.unregister(signal.SIGUSR1); send(); print(repr(got()), log); log.clear()
faulthandler.register(signal.SIGUSR1, w, False, chain=True); send(); print(got(), log); log.clear()
faulthandler.unregister(signal.SIGUSR1); send(); print(repr(got()), log); log.clear()
signal.signal(signal.SIGUSR1, signal.SIG_IGN); faulthandler.register(signal.SIGUSR1, w, False, True); send(); print(got()); faulthandler.unregister(signal.SIGUSR1); send(); print(repr(got()))

# later
for a in (0, -1, 'x', None, float('nan'), 1e30):
    t(faulthandler.dump_traceback_later, a, file=w)
t(faulthandler.dump_traceback_later); t(faulthandler.cancel_dump_traceback_later); t(faulthandler.cancel_dump_traceback_later, 1)
def wait(n=1):
    # It is written piece by piece, by a thread that looks at the frames of this one as they are: no function of Python is called here.
    s = b''
    while (s.count(b'Timeout') < n or not s.endswith(b'<module>\n')) and select.select([r], [], [], 10)[0]:
        s += os.read(r, 65536)
    return norm(s)
faulthandler.dump_traceback_later(0.05, file=w); s = wait(); print(re.sub(r'line \d+ in wait', 'line N in wait', s))
faulthandler.dump_traceback_later(0.05, file=w); time.sleep(0.3); print(got())
faulthandler.dump_traceback_later(5, file=w); faulthandler.cancel_dump_traceback_later(); time.sleep(0.05); print(repr(got()))
faulthandler.dump_traceback_later(5, file=w); faulthandler.dump_traceback_later(0.05, file=w); time.sleep(0.3); print(got().count('Timeout'))
faulthandler.dump_traceback_later(0.05, repeat=True, file=w); time.sleep(0.4); faulthandler.cancel_dump_traceback_later(); print(got().count('Timeout (0:00:00.050000)!') >= 2)
faulthandler.dump_traceback_later(3661, file=w); faulthandler.cancel_dump_traceback_later()
# Long enough for the allocator's scavenger to come by while the watchdog thread waits.
faulthandler.dump_traceback_later(0.5, repeat=True, file=w); time.sleep(2.2); faulthandler.cancel_dump_traceback_later(); print(got().count('Timeout (0:00:00.500000)!') >= 3)
