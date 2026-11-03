# What happens to threads when the program ends. Each case is a program of its own.
import subprocess, sys, os
cases = {
"non-daemon threads are waited for": '''
import threading, time
def late(): time.sleep(0.1); print("thread done")
threading.Thread(target=late).start()
print("main done")
''',
"daemon threads are not": '''
import threading, time
def forever():
    while True: time.sleep(0.01)
threading.Thread(target=forever, daemon=True).start()
def busy():
    while True: pass
threading.Thread(target=busy, daemon=True).start()
ev = threading.Event()
threading.Thread(target=ev.wait, daemon=True).start()
time.sleep(0.05)
print("main done")
''',
"atexit runs after the threads are joined": '''
import threading, time, atexit
atexit.register(lambda: print("atexit"))
threading.Thread(target=lambda: (time.sleep(0.05), print("thread"))).start()
print("main")
''',
"sys.exit in the main thread waits too": '''
import threading, time, sys
threading.Thread(target=lambda: (time.sleep(0.05), print("thread"))).start()
sys.exit(3)
''',
"os._exit does not": '''
import threading, time, os, sys
threading.Thread(target=lambda: (time.sleep(5), print("never"))).start()
print("main"); sys.stdout.flush()
os._exit(4)
''',
"an exception in the main thread": '''
import threading, time
threading.Thread(target=lambda: (time.sleep(0.05), print("thread"))).start()
raise ValueError("main fails")
''',
"no new threads at shutdown": '''
import threading, atexit
class A:
    def __del__(self):
        try: threading.Thread(target=print).start()
        except RuntimeError as e: print(type(e).__name__, e)
a = A()
''',
"finalizers at exit with a daemon thread blocked": '''
import threading, time
class F:
    def __del__(self): print("finalized")
f = F()
l = threading.Lock(); l.acquire()
threading.Thread(target=l.acquire, daemon=True).start()
time.sleep(0.02)
print("main done")
''',
"threading._register_atexit": '''
import threading, time
threading._register_atexit(lambda: print("threading atexit"))
threading.Thread(target=lambda: (time.sleep(0.03), print("thread"))).start()
print("main")
''',
}
import tempfile
for name, source in cases.items():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "case.py")
        with open(path, "w") as f: f.write(source)
        r = subprocess.run([sys.executable, path], capture_output=True, text=True, timeout=120)
    err = r.stderr.strip().split("\n")[-1] if r.stderr.strip() else ""
    print(name, "|", r.returncode, "|", r.stdout.replace("\n", ";"), "|", err)
