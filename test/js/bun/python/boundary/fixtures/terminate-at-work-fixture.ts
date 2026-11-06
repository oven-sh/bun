// Terminates workers whose Python is in the middle of something. `process.argv[2]` says of what. The program tells when it is there, so
// nothing depends on how long anything takes.
import { isMainThread, parentPort, workerData } from "node:worker_threads";

const programs: Record<string, string> = {
  // Its thread owes the other finalizers when it ends.
  "in a finalizer, with more to come": `
import threading
entered = threading.Event()
class D:
    def __del__(self):
        entered.set()
        while True: pass
def work():
    while True: [D() for _ in range(200)]
threading.Thread(target=work, daemon=True).start()
entered.wait()
tell()`,
  "in sys.unraisablehook": `
import sys, threading
entered = threading.Event()
def hook(args):
    entered.set()
    while True: pass
sys.unraisablehook = hook
class D:
    def __del__(self): raise KeyError("finalizer")
def work():
    while True: [D() for _ in range(200)]
threading.Thread(target=work, daemon=True).start()
entered.wait()
tell()`,
  "in an audit hook for sys.unraisablehook": `
import sys, threading
entered = threading.Event()
def audit(event, args):
    if event == "sys.unraisablehook":
        entered.set()
        while True: pass
sys.addaudithook(audit)
class D:
    def __del__(self): raise KeyError("finalizer")
def work():
    while True: [D() for _ in range(200)]
threading.Thread(target=work, daemon=True).start()
entered.wait()
tell()`,
  "two threads collect, and finalizers make more to finalize": `
import gc, threading
class D:
    def __del__(self): pass
class M:
    def __del__(self): [D() for _ in range(5)]
collected = threading.Semaphore(0)
def work():
    while True:
        [M() for _ in range(20)]
        gc.collect()
        collected.release()
for i in range(2): threading.Thread(target=work, daemon=True).start()
for i in range(4): collected.acquire()
tell()`,
  // What is told of an exception is code of the program too. Whoever had it told goes no further: what would come next says so on stderr.
  "in sys.unraisablehook, for what a thread raised": `
import _thread, sys, threading
entered = threading.Event()
def hook(args):
    entered.set()
    while True: pass
sys.unraisablehook = hook
def work(): raise KeyError("thread")
_thread.start_new_thread(work, ())
entered.wait()
tell()`,
  "in sys.unraisablehook, for what one of gc.callbacks raised": `
import gc, os, sys
def hook(args):
    tell()
    while True: pass
sys.unraisablehook = hook
def first(phase, info): raise KeyError("callback")
def second(phase, info): os.write(2, b"the next callback was called\\n")
gc.callbacks += [first, second]
gc.collect()`,
  "in sys.unraisablehook, for what warning of a coroutine raised": `
import os, sys, warnings
def hook(args):
    tell()
    while True: pass
sys.unraisablehook = hook
shown = []
def show(*args):
    if shown: os.write(2, b"it was warned of again\\n")
    shown.append(args)
    raise KeyError("warning")
warnings.showwarning = show
async def f(): pass
while True: f()`,
  "in sys.stderr.write(), for what a finalizer raised in a thread": `
import sys, threading
entered = threading.Event()
class Errors:
    def write(self, text):
        entered.set()
        while True: pass
    def flush(self): pass
sys.stderr = Errors()
del sys.unraisablehook
class D:
    def __del__(self): raise KeyError("finalizer")
def work():
    while True: [D() for _ in range(200)]
threading.Thread(target=work, daemon=True).start()
entered.wait()
tell()`,
  "in sys.stderr.write(), for what sys.unraisablehook raised": `
import sys
class Errors:
    def write(self, text):
        tell()
        while True: pass
    def flush(self): pass
sys.stderr = Errors()
def hook(args): raise ValueError("hook")
sys.unraisablehook = hook
class D:
    def __del__(self): raise KeyError("finalizer")
while True: [D() for _ in range(200)]`,
  "in sys.stderr.write(), for gc.DEBUG_STATS": `
import gc, os, sys
class Errors:
    def write(self, text):
        tell()
        while True: pass
    def flush(self): pass
sys.stderr = Errors()
gc.set_debug(gc.DEBUG_STATS)
gc.callbacks.append(lambda phase, info: phase == "stop" and os.write(2, b"the collection went on\\n"))
gc.collect()`,
  // Nobody hears what goes wrong there. The termination is not for them to call off: whatever comes next is ended.
  "in the finalizer of a stream, which asks whether it is closed": `
import io
class Raw(io.RawIOBase):
    @property
    def closed(self):
        tell()
        while True: pass
while True: Raw()`,
  "in the finalizer of a stream, which sets an attribute": `
import io
class Raw(io.RawIOBase):
    def __setattr__(self, name, value):
        tell()
        while True: pass
while True: Raw()`,
  "in the finalizer of a stream, and then waits for a lock": `
import gc, io, threading, time
threading.Thread(target=time.sleep, args=(1000,), daemon=True).start()
class Raw(io.RawIOBase):
    @property
    def closed(self):
        tell()
        while True: pass
Raw()
gc.collect()
lock = threading.Lock()
lock.acquire()
lock.acquire()`,
  "in the finalizer of a stream, and then sleeps": `
import gc, io, time
class Raw(io.RawIOBase):
    @property
    def closed(self):
        tell()
        while True: pass
Raw()
gc.collect()
time.sleep(1000)`,
  "in the finalizer of a stream, and then returns to a loop in JavaScript": `
import gc, io
class Raw(io.RawIOBase):
    @property
    def closed(self):
        tell()
        while True: pass
Raw()
gc.collect()`,
  "in the __repr__ of what is named in a report": `
import _lsprof
class Timer:
    def __call__(self): raise KeyError("timer")
    def __repr__(self):
        tell()
        while True: pass
_lsprof.Profiler(Timer()).enable()
(lambda: None)()`,
  "in sys.unraisablehook, for a stream that cannot be written before a system call": `
import os, sys
def hook(args):
    tell()
    while True: pass
sys.unraisablehook = hook
r, w = os.pipe()
os.close(r)
broken = os.fdopen(w, "wb")
broken.write(b"lost")
os.stat(".")
while True: pass`,
  // It is closed by what unwinds the frame, which puts terminations off.
  "in the finally of a generator, while an exception leaves its loop": `
def gen():
    try: yield
    finally:
        tell()
        while True: pass
try:
    for y in gen(): raise ValueError
except ValueError: pass`,
  "in the finally of a generator, while an exception leaves its loop in a thread": `
import threading
entered = threading.Event()
def gen():
    try: yield
    finally:
        entered.set()
        while True: pass
def work():
    try:
        for y in gen(): raise ValueError
    except ValueError: pass
threading.Thread(target=work, daemon=True).start()
entered.wait()
tell()`,
  "in sys.excepthook, for a KeyboardInterrupt": `
import sys
def hook(*args):
    tell()
    while True: pass
sys.excepthook = hook
raise KeyboardInterrupt`,
  // What follows makes something else of the exception that it gets.
  "in from_param() of an argument for C": `
import ctypes
class P:
    @classmethod
    def from_param(cls, value):
        tell()
        while True: pass
abs = ctypes.CDLL(None).abs
abs.argtypes = [P]
abs(1)`,
  "in _as_parameter_ of an argument for C": `
import ctypes
class P:
    @property
    def _as_parameter_(self):
        tell()
        while True: pass
ctypes.CDLL(None).abs(P())`,
  "in a function that C calls": `
import ctypes
Compare = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
def compare(a, b):
    tell()
    while True: pass
ctypes.CDLL(None).qsort((ctypes.c_int * 5)(5, 1, 4, 2, 3), 5, 4, Compare(compare))`,
  "in the codec of a source": `
import codecs
def decode(data, errors="strict"):
    tell()
    while True: pass
codecs.register(lambda name: codecs.CodecInfo(None, decode, name=name) if name == "endless" else None)
exec(b"# coding: endless\\nx = 1")`,
  "in __index__ of what a handler of expat returns": `
from xml.parsers import expat
class N:
    def __index__(self):
        tell()
        while True: pass
parser = expat.ParserCreate()
parser.NotStandaloneHandler = N
parser.Parse(b'<?xml version="1.0"?><!DOCTYPE a SYSTEM "x"><a/>', True)`,
  // A module written in C++ is not ended halfway, but what it imports is code of the program.
  "in an audit hook, for what the initializer of a module imports": `
import sys
sys.modules.pop("collections.abc", None)
def hook(event, args):
    if event == "import" and args[0] == "collections.abc":
        tell()
        while True: pass
sys.addaudithook(hook)
import array`,
  // The file is closed as soon as read() is over, if it can be.
  "in __index__ of how much a file that nothing else refers to is to read": `
import sys
class N:
    def __index__(self):
        tell()
        while True: pass
open(sys.executable, "rb").read(N())`,
  // These are called by what unwinds the frames.
  "in a trace function that is told of an exception": `
import sys
def trace(frame, event, arg):
    if event == "exception":
        tell()
        while True: pass
    return trace
def f():
    try: raise ValueError
    except ValueError: pass
sys.settrace(trace)
f()`,
  "in a trace function that is told of the return of a frame that an exception leaves": `
import sys
def trace(frame, event, arg):
    if event == "return" and frame.f_code.co_name == "g":
        tell()
        while True: pass
    return trace
def g(): raise ValueError
def f():
    try: g()
    except ValueError: pass
sys.settrace(trace)
f()`,
  "in a profile function that is told of the return of a frame that an exception leaves": `
import sys
def profile(frame, event, arg):
    if event == "return" and frame.f_code.co_name == "g":
        tell()
        while True: pass
def g(): raise ValueError
def f():
    try: g()
    except ValueError: pass
sys.setprofile(profile)
f()`,
  "in toString() of what JavaScript has thrown, of which a trace function is to be told": `
import sys
def trace(frame, event, arg): return trace
def f():
    try: throw_what_cannot_be_shown()
    except BaseException: pass
sys.settrace(trace)
f()`,
  "in a callback of sys.monitoring for RAISE": `
import sys
def callback(*args):
    tell()
    while True: pass
sys.monitoring.use_tool_id(1, "test")
sys.monitoring.register_callback(1, sys.monitoring.events.RAISE, callback)
sys.monitoring.set_events(1, sys.monitoring.events.RAISE)
def f():
    try: raise ValueError
    except ValueError: pass
f()`,
  "in a callback of sys.monitoring for PY_UNWIND": `
import sys
def callback(*args):
    tell()
    while True: pass
sys.monitoring.use_tool_id(1, "test")
sys.monitoring.register_callback(1, sys.monitoring.events.PY_UNWIND, callback)
sys.monitoring.set_events(1, sys.monitoring.events.PY_UNWIND)
def g(): raise ValueError
def f():
    try: g()
    except ValueError: pass
f()`,
  "in a callback of sys.monitoring for EXCEPTION_HANDLED": `
import sys
def callback(*args):
    tell()
    while True: pass
sys.monitoring.use_tool_id(1, "test")
sys.monitoring.register_callback(1, sys.monitoring.events.EXCEPTION_HANDLED, callback)
sys.monitoring.set_events(1, sys.monitoring.events.EXCEPTION_HANDLED)
def f():
    try: raise ValueError
    except ValueError: pass
f()`,
  "in toString() of what JavaScript has thrown, which leaves a generator": `
def g():
    throw_what_cannot_be_shown()
    yield
next(g())`,
  "in toString() of what JavaScript has thrown, which leaves a coroutine": `
async def c():
    throw_what_cannot_be_shown()
c().send(None)`,
  "in toString() of what JavaScript has thrown, which leaves an asynchronous generator": `
async def g():
    throw_what_cannot_be_shown()
    yield
g().asend(None).send(None)`,
  "in a getter of the error that JavaScript has thrown, which leaves a generator": `
def g():
    throw_error_with_getter()
    yield
next(g())`,
  // The generator is resumed with what is made of the error, whatever has become of the look at it.
  "in a getter of the error that JavaScript throws into a generator": `
def inner():
    yield 1
def g():
    yield from inner()
throw_error_with_getter_into(g())`,
  // About two in three were lost.
  "catching what JavaScript throws, over and over": `
tell()
while True:
    try: throw_new_error()
    except Exception: pass`,
  "in the finally of a generator that only enumerate() has, while an exception leaves the loop": `
def g():
    try:
        yield 1
    finally:
        tell()
        while True: pass
for i, x in enumerate(g()):
    raise ValueError`,
  "in the finally of a generator that \`in\` has left half way, and then in a loop": `
def g():
    try:
        yield 1
        yield 2
    finally:
        tell()
        while True: pass
1 in g()
while True: pass`,
  "in the finally of a generator that islice() lets go of, and then in a loop": `
import itertools
def g():
    try:
        yield 1
        yield 2
    finally:
        tell()
        while True: pass
for x in itertools.islice(g(), 1): pass
while True: pass`,
  // Nothing looks for a termination between the additions, so nearly always it is the call that finds it, before the frame has a callee.
  "about to call what is not an object to JavaScript": `
def f(none, one):
    tell()
    while True:
        try:
${"            two = one + one\n".repeat(5000)}
            none()
        except TypeError: pass
        try:
${"            two = one + one\n".repeat(5000)}
            one()
        except TypeError: pass
f(None, 1)`,
};

if (isMainThread) {
  for (let round = 0; round < 3; ++round) {
    const worker = new Worker(import.meta.url, { workerData: process.argv[2] });
    const closed = new Promise(resolve => worker.addEventListener("close", resolve));
    await new Promise(resolve => worker.addEventListener("message", resolve, { once: true }));
    worker.terminate();
    await closed;
  }
  console.log("survived");
} else {
  // Not an import: only the worker is to start Python.
  const { exec, dict } = require("python:builtins");
  // Or it would end by itself, and could no longer be reached.
  setInterval(() => {}, 1000);
  const tell = () => parentPort!.postMessage("there");
  const throwWhatCannotBeShown = () => {
    throw {
      toString() {
        tell();
        for (;;);
      },
    };
  };
  const errorWithGetter = () =>
    Object.defineProperty(new Error("with a getter"), "errno", {
      get() {
        tell();
        for (;;);
      },
    });
  const throwErrorWithGetter = () => {
    throw errorWithGetter();
  };
  const throwErrorWithGetterInto = (generator: Iterable<unknown>) => {
    const iterator = generator[Symbol.iterator]();
    iterator.next();
    iterator.throw!(errorWithGetter());
  };
  const throwNewError = () => {
    throw new Error("new each time");
  };
  exec(
    programs[workerData],
    dict([
      ["tell", tell],
      ["throw_what_cannot_be_shown", throwWhatCannotBeShown],
      ["throw_error_with_getter", throwErrorWithGetter],
      ["throw_error_with_getter_into", throwErrorWithGetterInto],
      ["throw_new_error", throwNewError],
    ]),
  );
  if (workerData.endsWith("a loop in JavaScript")) for (;;);
}
