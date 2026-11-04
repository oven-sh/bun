# The program ends while a daemon thread is in the middle of a call on a buffered file, whose lock it holds. Nothing is said about it.
import os, sys, subprocess, threading, time

if len(sys.argv) > 1:
    r, w = os.pipe()
    f = {"reader": lambda: os.fdopen(r, "rb"), "text": lambda: os.fdopen(r, "r"), "raw": lambda: os.fdopen(r, "rb", 0)}[sys.argv[1]]()
    started = threading.Event()

    def read():
        started.set()
        f.read(1)

    threading.Thread(target=read, daemon=True).start()
    started.wait()
    time.sleep(0.2)
    print("bye", flush=True)
else:
    for kind in ("reader", "text", "raw"):
        p = subprocess.run([sys.executable, __file__, kind], capture_output=True, text=True, timeout=60)
        print(kind, p.returncode, repr(p.stdout), repr(p.stderr))
