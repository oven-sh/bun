# tracemalloc: its state, and where objects with finalizers were made. (No memory is measured here: nothing of that is compared.)
import tracemalloc, sys, gc, warnings, socket, os, subprocess, re
sys.stderr = sys.stdout

print(tracemalloc.is_tracing(), tracemalloc.get_traceback_limit())
f = open(__file__)
print(tracemalloc.get_object_traceback(f))
f.close()

def show(obj):
    tb = tracemalloc.get_object_traceback(obj)
    print(type(obj).__name__, None if tb is None else [(os.path.basename(frame.filename), frame.lineno) for frame in tb])

tracemalloc.start()
print(tracemalloc.is_tracing(), tracemalloc.get_traceback_limit())
tracemalloc.start(5)                      # It is on: no change.
print(tracemalloc.get_traceback_limit())
f = open(__file__)
show(f)
f.close()
tracemalloc.stop()
print(tracemalloc.is_tracing(), tracemalloc.get_traceback_limit())
show(f)

class WithDel:
    def __del__(self):
        pass

def make(what):
    return what()
def outer(what):
    return make(what)

tracemalloc.start(3)
print(tracemalloc.is_tracing(), tracemalloc.get_traceback_limit())
objects = [outer(lambda: open(__file__)), outer(lambda: open(__file__, "rb")), outer(lambda: open(__file__, "rb", buffering=0)),
           outer(socket.socket), outer(WithDel)]
for obj in objects:
    show(obj)
    if hasattr(obj, "close"):
        obj.close()
tracemalloc.clear_traces()
show(objects[0])
print(tracemalloc.is_tracing())

# What a ResourceWarning says.
def leak():
    open(__file__)
def clean(text):
    return re.sub(r"'[^']*/", "'", re.sub(r'"[^"]*/', '"', text))
with warnings.catch_warnings():
    warnings.simplefilter("always")
    warnings.showwarning = None
    del warnings.showwarning
    import io
    sys.stderr = io.StringIO()
    leak()
    gc.collect()
    text, sys.stderr = sys.stderr.getvalue(), sys.stdout
    # The place of the warning itself is where the collector ran.
    print(clean(text.split(": ", 1)[1].split("\n")[0]))
    print(clean(text[text.index("Object allocated"):]))
tracemalloc.stop()

for bad in (0, -1, 2**16, 2**40, "1", None):
    try:
        tracemalloc.start(bad)
    except (ValueError, TypeError, OverflowError) as e:
        print(type(e).__name__, e)
print(tracemalloc.is_tracing())

def python(*args, **env):
    p = subprocess.run([sys.executable, *args], capture_output=True, text=True, env={**os.environ, **env})
    lines = p.stderr.splitlines()
    if "Object allocated at (most recent call last):" in lines:
        lines = lines[lines.index("Object allocated at (most recent call last):"):]
    print(p.returncode, p.stdout.strip(), [line for line in lines if "tracemalloc" in line or "lineno" in line or "Object" in line][:4])
code = "import tracemalloc; print(tracemalloc.is_tracing(), tracemalloc.get_traceback_limit())"
python("-c", code)
python("-X", "tracemalloc", "-c", code)
python("-X", "tracemalloc=7", "-c", code)
python("-c", code, PYTHONTRACEMALLOC="1")
python("-c", code, PYTHONTRACEMALLOC="10")
python("-E", "-c", code, PYTHONTRACEMALLOC="10")
python("-c", code, PYTHONTRACEMALLOC="0")
python("-X", "tracemalloc=0", "-c", code)
python("-X", "tracemalloc=x", "-c", code)
python("-c", code, PYTHONTRACEMALLOC="-1")
python("-X", "tracemalloc=2", "-Wd", "-c", "def f():\n    open(%r)\nf()\nimport gc; gc.collect()" % __file__)
