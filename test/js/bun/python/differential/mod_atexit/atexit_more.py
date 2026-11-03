# atexit: unregister() with an __eq__ that interferes, and what happens when the interpreter ends.
import atexit, subprocess, sys

log = []
def f1(): log.append(1)
def f2(): log.append(2)
def f3(): log.append(3)

class Pred:
    def __eq__(self, other):
        global cnt
        cnt += 1
        if cnt == when:
            atexit.unregister(what)
        return other is f2

for what in (f1, f2, f3):
    for when in range(1, 4):
        cnt = 0
        log.clear()
        for f in (f1, f2, f3):
            atexit.register(f)
        atexit.unregister(Pred())
        atexit._run_exitfuncs()
        print(what.__name__, when, log, cnt)

class Evil:
    def __eq__(self, other):
        action(other)
        return NotImplemented
for action in (atexit.unregister, lambda o: atexit._clear()):
    atexit.register(lambda: None)
    atexit.unregister(Evil())
    print(atexit._ncallbacks())
    atexit._clear()

# The same function several times; equal but not identical.
class Same:
    def __init__(self, n): self.n = n
    def __eq__(self, other): return isinstance(other, Same) and self.n == other.n
    def __call__(self): log.append(("same", self.n))
log.clear()
for n in (1, 2, 1, 3, 1):
    atexit.register(Same(n))
atexit.unregister(Same(1))
print(atexit._ncallbacks())
atexit._run_exitfuncs()
print(log)

class Raises:
    def __eq__(self, other): raise ZeroDivisionError("eq")
atexit.register(f1)
try:
    atexit.unregister(Raises())
except ZeroDivisionError as e:
    print("ZeroDivisionError", e, atexit._ncallbacks())
atexit._clear()

def python(code):
    p = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True)
    print(p.returncode, repr(p.stdout), p.stderr.splitlines()[-1:])

python("""
import atexit, threading, time
def run():
    print(24)
    time.sleep(0.2)
    print(42)
@atexit.register
def start_thread():
    threading.Thread(target=run).start()
""")
python("""
import atexit
def second(): print("second")
@atexit.register
def first():
    print("first")
    atexit.register(second)
""")
python("""
import atexit, sys
del sys.modules["atexit"]
atexit.register(print, "still called")
""")
python("""
import atexit, sys
atexit.register(lambda: print(sys.is_finalizing()))
""")
