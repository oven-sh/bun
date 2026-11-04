# At exit everything is finalized by the main thread: what ended threads, waiting daemon threads and the main thread have made.
import subprocess, sys, threading

if len(sys.argv) > 1:
    class A:
        def __init__(self, name):
            self.name = name

        def __del__(self):
            print(self.name, "finalized by", threading.current_thread().name, flush=True)

    kept = [A("made by the main thread")]
    ready = threading.Event()

    def ends():
        kept.append(A("made by a thread that has ended"))

    def waits():
        kept.append(A("made by a daemon thread that waits"))
        ready.set()
        threading.Event().wait()

    t = threading.Thread(target=ends)
    t.start()
    t.join()
    if sys.argv[1] == "daemon":
        threading.Thread(target=waits, daemon=True).start()
        ready.wait()
    print("the end", flush=True)
else:
    for mode in ("plain", "daemon"):
        p = subprocess.run([sys.executable, __file__, mode], capture_output=True, text=True, timeout=120)
        print(mode, p.returncode, sorted(p.stdout.splitlines()), p.stderr)
