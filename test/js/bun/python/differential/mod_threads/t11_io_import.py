# Streams shared by threads, and imports from several threads at once.
import threading, sys, os, tempfile, time, _imp, io
sys.setswitchinterval(1e-5)

with tempfile.TemporaryDirectory() as d:
    # one buffered text file written by many threads: no line is torn or lost
    path = os.path.join(d, "out.txt")
    with open(path, "w", buffering=64) as f:
        def w(k):
            for i in range(300): f.write(f"{k}:{i}\n")
        ts = [threading.Thread(target=w, args=(k,)) for k in range(6)]
        [t.start() for t in ts]; [t.join() for t in ts]
    lines = open(path).read().split("\n")
    print(len(lines), sorted(lines[:-1]) == sorted(f"{k}:{i}" for k in range(6) for i in range(300)))

    # a binary one, with a small buffer, so that most writes reach the system
    path = os.path.join(d, "out.bin")
    with open(path, "wb", buffering=16) as f:
        def wb(k):
            for i in range(300): f.write(bytes([65 + k]) * 10)
        ts = [threading.Thread(target=wb, args=(k,)) for k in range(6)]
        [t.start() for t in ts]; [t.join() for t in ts]
    data = open(path, "rb").read()
    print(len(data), all(len(set(data[i:i + 10])) == 1 for i in range(0, len(data), 10)))

    # many readers of one buffered file: every byte is read once
    got = []; glock = threading.Lock()
    with open(path, "rb", buffering=32) as f:
        def rb():
            while (chunk := f.read(10)):
                with glock: got.append(chunk)
        ts = [threading.Thread(target=rb) for _ in range(6)]
        [t.start() for t in ts]; [t.join() for t in ts]
    print(sum(map(len, got)) == len(data), sorted(b"".join(got)) == sorted(data))

    # a reader blocked on a pipe does not keep others from other streams, and a second reader of the same stream waits
    r, w_ = os.pipe(); fr = os.fdopen(r, "rb")
    res = []
    ts = [threading.Thread(target=lambda: res.append(fr.read(3))) for _ in range(2)]
    [t.start() for t in ts]; time.sleep(0.02)
    os.write(w_, b"abcdef"); [t.join() for t in ts]; print(sorted(res))

    # the same thread entering a stream again is still an error
    class Raw(io.RawIOBase):
        def writable(self): return True
        def write(self, b):
            try: buffered.write(b"x")
            except RuntimeError as e: print("RuntimeError", str(e).split(" <")[0])
            return len(b)
    buffered = io.BufferedWriter(Raw(), 4); buffered.write(b"0123456789"); 

    # a module imported by many threads at once runs once
    with open(os.path.join(d, "slowmod.py"), "w") as f:
        f.write("import time\nruns = globals().get('runs', 0) + 1\nimport builtins\nbuiltins.slow_runs = getattr(builtins, 'slow_runs', 0) + 1\ntime.sleep(0.05)\nvalue = 42\n")
    sys.path.insert(0, d)
    seen = []
    def imp():
        import slowmod
        seen.append(slowmod.value)
    ts = [threading.Thread(target=imp) for _ in range(8)]
    [t.start() for t in ts]; [t.join() for t in ts]
    import builtins
    print(seen, builtins.slow_runs)

    # modules that import each other from two threads do not deadlock
    with open(os.path.join(d, "cyc_a.py"), "w") as f: f.write("import time; time.sleep(0.02)\nimport cyc_b\nname = 'a'\n")
    with open(os.path.join(d, "cyc_b.py"), "w") as f: f.write("import time; time.sleep(0.02)\nimport cyc_a\nname = 'b'\n")
    out = []
    def ia():
        import cyc_a; out.append(cyc_a.name)
    def ib():
        import cyc_b; out.append(cyc_b.name)
    ts = [threading.Thread(target=ia), threading.Thread(target=ib)]
    [t.start() for t in ts]; [t.join() for t in ts]; print(sorted(out))
    sys.path.remove(d)

# the import lock
print(_imp.lock_held()); _imp.acquire_lock(); _imp.acquire_lock(); print(_imp.lock_held())
held = []
def other():
    held.append(_imp.lock_held())
    try: _imp.release_lock()
    except RuntimeError as e: held.append(str(e))
    _imp.acquire_lock(); held.append("acquired"); _imp.release_lock()
t = threading.Thread(target=other); t.start(); time.sleep(0.02); print(held)
_imp.release_lock(); time.sleep(0.02); print(held); _imp.release_lock(); t.join(); print(held, _imp.lock_held())
try: _imp.release_lock()
except RuntimeError as e: print("RuntimeError", e)
