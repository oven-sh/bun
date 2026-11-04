# A daemon thread that is still there when the program ends never runs again, and what its frames refer to, directly or by way of the
# globals of its functions, is never finalized. A module that is still referred to is emptied, though, and so are sys and builtins.
import subprocess, sys, threading, types


def module(name, source):
    made = sys.modules[name] = types.ModuleType(name)
    exec(source, made.__dict__)
    return made


if len(sys.argv) > 1:
    mode = sys.argv[1]
    # The class and its finalizer know nothing of the program.
    A = module("kinds", '''
import os
class A:
    def __init__(self, name): self.name = name
    def __del__(self, write=os.write): write(1, (self.name + "\\n").encode())
del os
''').A
    helper = module("helper", '''
import os, threading
def waits(ready, *held):
    ready.set()
    threading.Event().wait()
class Stream:
    is_open = True
    def close(self, ready):
        ready.set()
        os.read(os.pipe()[0], 1)  # It is closed as far as the system goes,
        self.is_open = False      # and this is never done.
    def __del__(self, write=os.write):
        if self.is_open:
            write(1, b"a stream that the thread is closing\\n")
def closes(ready):
    Stream().close(ready)
''')
    ways = module("ways", '''
import contextvars, threading
from kinds import A
local = threading.local()
variable = contextvars.ContextVar("variable")
def block(ready, *ignored):
    ready.set()
    threading.Event().wait()
def two(a, b): pass
def temporary(ready):
    two(A("an argument of a call that has not begun"), block(ready))
def generator(ready):
    held = A("a variable of a generator that is running")
    yield block(ready)
def running(ready):
    for _ in generator(ready): pass
def suspended(ready):
    def g():
        held = A("a variable of a generator that is suspended")
        yield
    it = g()
    next(it)
    block(ready)
def native(ready):
    list(map(block, [ready], [A("an item of what a built-in function goes through")]))
def context(ready):
    variable.set(A("the value of a context variable"))
    block(ready)
def named(ready):
    try:
        raise ValueError(A("an argument of the exception being handled, which has a name"))
    except ValueError as e:
        block(ready)
def closure(ready):
    held = A("a variable of an enclosing function")
    def inner():
        held
        block(ready)
    inner()
def instance(ready):
    class K:
        thing = A("an attribute of the class of a local")
    k = K()
    del K
    block(ready)
# These belong to the thread, not to its frames, and go.
def thread_local(ready):
    local.thing = A("a thread-local value")
    block(ready)
''')
    ready = threading.Event()

    def waits():
        local = A("a local of the thread")
        ready.set()
        threading.Event().wait()

    a_global = A("a global of __main__")
    sys.thing = A("an attribute of sys")
    __builtins__.thing = A("an attribute of builtins")
    helper.thing = A("a global of another module")

    class K:
        thing = A("an attribute of a class of __main__")

    cycle = A("a global of __main__ that is in a cycle")
    cycle.me = cycle
    dropped = A("a cycle that was dropped")
    dropped.me = dropped
    del dropped
    if mode == "of __main__":
        threading.Thread(target=waits, daemon=True).start()
    elif mode == "of another module":
        threading.Thread(target=helper.waits, args=(ready, A("an argument of the thread")), daemon=True).start()
    elif mode == "in a system call":
        threading.Thread(target=helper.closes, args=(ready,), daemon=True).start()
    elif mode == "of many kinds":
        for name in ("temporary", "running", "suspended", "native", "context", "named", "closure", "instance", "thread_local"):
            ready.clear()
            threading.Thread(target=getattr(ways, name), args=(ready,), daemon=True).start()
            ready.wait()
    else:
        ready.set()
    ready.wait()
    del module, A, ways
else:
    for mode in ("none", "of __main__", "of another module", "in a system call", "of many kinds"):
        p = subprocess.run([sys.executable, __file__, mode], capture_output=True, text=True, timeout=120)
        print("The frames of the daemon thread are", mode, "- status", p.returncode, p.stderr)
        for line in sorted(p.stdout.splitlines()):
            print("    finalized:", line)
