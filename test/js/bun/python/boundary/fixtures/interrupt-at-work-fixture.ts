// Cuts short what Python is in the middle of, after which the program goes on: a script of node:vm that SIGINT breaks. `process.argv[2]`
// says in the middle of what. It is the program that sends the signal, where it is to arrive, so nothing depends on how long anything takes.
import vm from "node:vm";
import { dict, exec } from "python:builtins";

const programs: Record<string, string> = {
  // That the pipe is full is reported before the handlers are called.
  "sys.unraisablehook, before the handlers of signals are called": `
sys.unraisablehook = lambda args: (log.append(args.err_msg), interrupt())
signal.signal(signal.SIGUSR1, lambda number, frame: log.append(signal.Signals(number).name))
r, w = os.pipe()
os.set_blocking(w, False)
try:
    while True: os.write(w, bytes(4096))
except BlockingIOError: pass
signal.set_wakeup_fd(w)
def work():
    signal.raise_signal(signal.SIGUSR1)
    while True: pass
def after():
    signal.set_wakeup_fd(-1)`,
  "sys.unraisablehook, between the handlers of two signals": `
sys.unraisablehook = lambda args: (log.append("hook"), interrupt())
# They are called in the order of their numbers. That the second has none any more is reported.
def first(number, frame):
    log.append("first")
    signal.signal(signal.SIGUSR1, signal.SIG_IGN)
signal.signal(signal.SIGHUP, first)
signal.signal(signal.SIGUSR1, lambda number, frame: log.append("second"))
signal.signal(signal.SIGUSR2, lambda number, frame: log.append("third"))
def work():
    signals = {signal.SIGHUP, signal.SIGUSR1, signal.SIGUSR2}
    signal.pthread_sigmask(signal.SIG_BLOCK, signals)
    for number in signals: os.kill(os.getpid(), number)
    signal.pthread_sigmask(signal.SIG_UNBLOCK, signals)
    while True: pass
def after(): pass`,
  "sys.unraisablehook, between two of gc.callbacks": `
sys.unraisablehook = lambda args: (log.append("hook"), interrupt())
def first(phase, info):
    log.append("first " + phase)
    if len(log) == 1: raise KeyError
gc.callbacks += [first, lambda phase, info: log.append("second " + phase)]
def work(): gc.collect()
def after():
    collections = gc.get_stats()[2]["collections"]
    gc.collect()
    log.append(gc.get_stats()[2]["collections"] - collections)`,
  "sys.unraisablehook, between two finalizers": `
sys.unraisablehook = lambda args: (log.append("hook"), interrupt())
class D:
    def __del__(self):
        log.append("finalizer")
        if len(log) == 2: raise KeyError
def work():
    [D() for i in range(4)]
    gc.collect()
def after(): gc.collect()`,
  "sys.unraisablehook, between two callbacks of atexit": `
import atexit
sys.unraisablehook = lambda args: (log.append("hook"), interrupt())
def second():
    log.append("second")
    raise KeyError
atexit.register(log.append, "fourth")
atexit.register(log.append, "third")
atexit.register(second)
atexit.register(log.append, "first")
def work(): atexit._run_exitfuncs()
def after():
    log.append(atexit._ncallbacks())
    atexit._run_exitfuncs()`,
  "sys.stderr.write(), for gc.DEBUG_STATS": `
class Errors:
    def write(self, text):
        log.append("write")
        if len(log) == 2: interrupt()
    def flush(self): pass
errors, sys.stderr = sys.stderr, Errors()
gc.set_debug(gc.DEBUG_STATS)
gc.callbacks.append(lambda phase, info: log.append(phase))
def work(): gc.collect()
def after():
    gc.collect()
    gc.set_debug(0)
    sys.stderr = errors`,
  // Nobody hears what goes wrong there.
  "the finalizer of a stream, which asks whether it is closed": `
import io
class Raw(io.RawIOBase):
    @property
    def closed(self):
        log.append("closed")
        if len(log) == 1: interrupt()
        return True
def work():
    Raw()
    gc.collect()
    while True: pass
def after(): pass`,
  "sys.unraisablehook, between two streams with something left to write": `
sys.unraisablehook = lambda args: (log.append("hook"), interrupt())
r, w = os.pipe()
os.close(r)
broken = os.fdopen(w, "wb")
r, w = os.pipe()
whole = os.fdopen(w, "wb")
r2, w2 = os.pipe()
text = os.fdopen(w2, "w")
signal.signal(signal.SIGPIPE, signal.SIG_IGN)
def work():
    broken.write(b"lost")
    whole.write(b"kept")
    text.write("kept too")
    os.stat(".")
    while True: pass
def after():
    os.stat(".")
    for fd in r, r2:
        os.set_blocking(fd, False)
        log.append(os.read(fd, 10))`,
  // It is closed by what unwinds the frame.
  "the finally of a generator, while an exception leaves its loop": `
def gen():
    try: yield
    finally:
        log.append("finally")
        interrupt()
def work():
    try:
        for y in gen(): raise ValueError("on its way")
    except ValueError: log.append("caught")
    while True: pass
def after(): pass`,
  "a script within the finally of a generator, while an exception leaves its loop": `
def gen():
    try: yield
    finally: log.append(cut_short(interrupt))
def work():
    try:
        for y in gen(): raise ValueError("on its way")
    except ValueError as error: log.append((repr(error), error.__context__))
def after(): pass`,
  // Nothing propagates through the frames of C, which goes on and calls it again.
  "a function that C calls": `
import ctypes
Compare = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
def compare(a, b):
    log.append("compare")
    interrupt()
def work():
    ctypes.CDLL(None).qsort((ctypes.c_int * 5)(5, 1, 4, 2, 3), 5, 4, Compare(compare))
    log.append("went on")
    while True: pass
def after(): pass`,
  // The module is half made, and is made anew.
  "an audit hook, for what the initializer of a module imports": `
sys.modules.pop("collections.abc", None)
def hook(event, args):
    if event == "import" and args[0] == "collections.abc" and not log:
        log.append("hook")
        interrupt()
sys.addaudithook(hook)
def work():
    import array
    log.append("went on")
    while True: pass
def after():
    import array, collections.abc
    log.append(isinstance(array.array("i"), collections.abc.MutableSequence))`,
  // It is called by what unwinds the frame.
  "a trace function that is told of an exception": `
def trace(frame, event, arg):
    if event == "exception":
        log.append(event)
        interrupt()
    return trace
def f():
    try: raise ValueError
    except ValueError: log.append("caught")
    while True: pass
def work():
    sys.settrace(trace)
    f()
def after(): log.append(sys.gettrace())`,
  // What the runtime has to see to while the script is being ended is seen to, then or later.
  "__buffer__ of what a file that nothing else refers to is to read into": `
import tempfile
descriptor, path = tempfile.mkstemp()
os.close(descriptor)
class Evil:
    def __buffer__(self, flags): interrupt()
def work(): open(path, "rb", buffering=0).readinto(Evil())
def after():
    gc.collect()
    file = os.stat(path)
    for descriptor in range(256):
        try: other = os.fstat(descriptor)
        except OSError: continue
        if (other.st_dev, other.st_ino) == (file.st_dev, file.st_ino): log.append("still open")
    os.unlink(path)`,
  "__buffer__ of the second of two things to join, when the first is to be told of its release": `
class Exporter:
    def __buffer__(self, flags): return memoryview(b"exported")
    def __release_buffer__(self, view):
        log.append("released")
        view.release()
class Evil:
    def __buffer__(self, flags): interrupt()
def work(): b"".join([Exporter(), Evil()])
def after(): pass`,
};

function cutShort(f: () => void) {
  try {
    vm.runInContext("f()", vm.createContext({ f }), { breakOnSigint: true });
    return "returned";
  } catch (error: any) {
    return error.code;
  }
}

const globals = dict([["cut_short", cutShort]]);
exec(
  `
import gc, os, signal, sys
log = []
def interrupt():
    os.kill(os.getpid(), signal.SIGINT)
    while True: pass
` + programs[process.argv[2]],
  globals,
);
console.log(cutShort(globals.get("work")));
// It is over: nothing is cut short any more, in Python or in JavaScript.
exec(
  `
sys.unraisablehook = lambda args: log.append("another hook")
after()
for i in range(100000): pass
print(log, flush=True)`,
  globals,
);
for (let i = 0; i < 1e6; ++i);
console.log("the end");
