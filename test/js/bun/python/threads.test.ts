import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";

// These builds take seconds to start Python, and half a minute to import asyncio.
if (isDebug || isASAN) setDefaultTimeout(180_000);

async function run(files: Record<string, string>, entry = "main.py") {
  using dir = tempDir("python-threads", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Threads are POSIX only so far.
const it = isWindows ? test.skip : test.concurrent;

it("a wait that nothing can end is an error where JavaScript has called into Python", async () => {
  // A program of Python sleeps until a signal comes, as in CPython. Here nothing of JavaScript runs while the thread waits.
  const { stdout, stderr, exitCode } = await run(
    {
      "waits.py": `
import os, signal, threading

def wait():
    threading.Event().wait()

def wait_for_a_signal():
    signal.signal(signal.SIGUSR1, lambda number, frame: 1 / 0)
    os.kill(os.getpid(), signal.SIGUSR1)
    threading.Event().wait()
`,
      "main.js": `
import { wait, wait_for_a_signal } from "./waits.py";
for (const f of [wait, wait_for_a_signal]) {
  try {
    f();
  } catch (e) {
    console.log(e.name + ": " + e.message);
  }
}
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout).toBe(
    "RuntimeError: deadlock: the lock is held, and there is no other thread\nZeroDivisionError: division by zero\n",
  );
  expect(exitCode).toBe(0);
});

it("threads run while others wait in blocking calls", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import os, select, socket, threading, time

# Each wait below ends only because another thread gets to run meanwhile.
r, w = os.pipe()
threading.Thread(target=os.write, args=(w, b"x")).start()
print("os.read", os.read(r, 1))

a, b = socket.socketpair()
threading.Thread(target=b.sendall, args=(b"y",)).start()
print("recv", a.recv(1))

threading.Thread(target=b.sendall, args=(b"z",)).start()
print("select", select.select([a], [], []) == ([a], [], []), a.recv(1))

server = socket.create_server(("127.0.0.1", 0))
def connect():
    with socket.create_connection(server.getsockname()) as c:
        c.sendall(b"hello")
threading.Thread(target=connect).start()
connection, _ = server.accept()
print("accept", connection.recv(5))

lock = threading.Lock(); lock.acquire()
threading.Thread(target=lock.release).start()
print("lock", lock.acquire())

event = threading.Event()
threading.Thread(target=event.set).start()
print("event", event.wait())

done = []
t = threading.Thread(target=lambda: (time.sleep(0.01), done.append(1)))
t.start(); t.join()
print("join", done)
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe("os.read b'x'\nrecv b'y'\nselect True b'z'\naccept b'hello'\nlock True\nevent True\njoin [1]\n");
  expect(exitCode).toBe(0);
});

it("a busy thread is made to give way", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import threading

stop = False
counts = [0, 0]
def spin(i):
    while not stop:
        counts[i] += 1
threads = [threading.Thread(target=spin, args=(i,)) for i in range(2)]
for t in threads: t.start()
# The main thread is busy too. All three make progress.
before = list(counts)
n = 0
while not (counts[0] > before[0] + 1000 and counts[1] > before[1] + 1000):
    n += 1
stop = True
for t in threads: t.join()
print(counts[0] > 1000, counts[1] > 1000, n > 0)
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe("True True True\n");
  expect(exitCode).toBe(0);
});

it("locks, conditions, semaphores, barriers and queues", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import queue, threading

total = 0
lock = threading.Lock()
def add(n):
    global total
    for _ in range(n):
        with lock:
            total += 1
threads = [threading.Thread(target=add, args=(2000,)) for _ in range(4)]
for t in threads: t.start()
for t in threads: t.join()
print("lock", total)

r = threading.RLock()
with r:
    with r:
        print("rlock", threading.Thread(target=lambda: print("other thread gets it:", r.acquire(blocking=False))).start())

items, condition, got = [], threading.Condition(), []
def consume():
    with condition:
        condition.wait_for(lambda: items)
        got.append(items.pop())
c = threading.Thread(target=consume); c.start()
with condition:
    items.append("item"); condition.notify()
c.join(); print("condition", got)

semaphore, order = threading.Semaphore(0), []
def waiter():
    semaphore.acquire(); order.append("acquired")
s = threading.Thread(target=waiter); s.start()
order.append("releasing"); semaphore.release(); s.join(); print("semaphore", order)

barrier = threading.Barrier(3)
arrived = []
def meet(): arrived.append(barrier.wait() in (0, 1, 2))
bs = [threading.Thread(target=meet) for _ in range(2)]
for t in bs: t.start()
meet()
for t in bs: t.join()
print("barrier", arrived)

q, results = queue.Queue(maxsize=2), []
def worker():
    while (item := q.get()) is not None:
        results.append(item * item); q.task_done()
    q.task_done()
w = threading.Thread(target=worker); w.start()
for i in range(10): q.put(i)
q.put(None); q.join(); w.join()
print("queue", results)
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(
    [
      "lock 8000",
      "other thread gets it: False",
      "rlock None",
      "condition ['item']",
      "semaphore ['releasing', 'acquired']",
      "barrier [True, True, True]",
      "queue [0, 1, 4, 9, 16, 25, 36, 49, 64, 81]",
      "",
    ].join("\n"),
  );
  expect(exitCode).toBe(0);
});

it("each thread has its own thread-locals, context, exception state and recursion depth", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import contextvars, sys, threading

local = threading.local(); local.x = "main"
var = contextvars.ContextVar("var", default="default"); var.set("main")
seen = {}
turn = [threading.Event(), threading.Event()]
def depth(n): return n if n == 0 else depth(n - 1) + 1
def other():
    seen["local"] = hasattr(local, "x"); local.x = "other"
    seen["context"] = var.get(); var.set("other")
    try:
        raise KeyError("other")
    except KeyError:
        turn[0].set(); turn[1].wait()          # The main thread handles an exception of its own meanwhile.
        seen["exception"] = repr(sys.exception())
    seen["depth"] = depth(500)
    seen["ident"] = threading.get_ident() != main_ident and threading.current_thread() is t
main_ident = threading.get_ident()
t = threading.Thread(target=other); t.start()
turn[0].wait()
try:
    raise ValueError("main")
except ValueError:
    turn[1].set(); t.join()
    print(repr(sys.exception()))
print(local.x, var.get(), sorted(seen.items()))
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(
    "ValueError('main')\nmain main [('context', 'default'), ('depth', 500), ('exception', \"KeyError('other')\"), ('ident', True), ('local', False)]\n",
  );
  expect(exitCode).toBe(0);
});

it("an exception ends its thread, not the program", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import threading

def fail(): raise RuntimeError("in the thread")
t = threading.Thread(target=fail, name="failing"); t.start(); t.join()
print("alive:", t.is_alive())

caught = []
threading.excepthook = lambda args: caught.append((args.exc_type.__name__, str(args.exc_value), args.thread.name))
t = threading.Thread(target=fail, name="hooked"); t.start(); t.join()
print(caught)

def leave(): raise SystemExit(3)
t = threading.Thread(target=leave); t.start(); t.join()
print("still here")
`,
  });
  expect(stderr).toContain("Exception in thread failing:");
  expect(stderr).toContain("RuntimeError: in the thread");
  expect(stderr).not.toContain("hooked");
  expect(stdout).toBe("alive: False\n[('RuntimeError', 'in the thread', 'hooked')]\nstill here\n");
  expect(exitCode).toBe(0);
});

it("at exit other threads are joined, daemon threads are not", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import atexit, threading

started = threading.Event()
release = threading.Event()
def forever():
    started.set()
    while True:
        pass
def blocked():
    threading.Event().wait()
threading.Thread(target=forever, daemon=True).start()
threading.Thread(target=blocked, daemon=True).start()
started.wait()

def late():
    release.wait()
    print("the other thread ends", flush=True)
threading.Thread(target=late).start()
atexit.register(lambda: print("atexit", flush=True))
print("the main thread ends", flush=True)
release.set()
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe("the main thread ends\nthe other thread ends\natexit\n");
  expect(exitCode).toBe(0);
});

it("JavaScript belongs to the main thread", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import js, threading

array = js.Array.of(1, 2, 3)
function = js.eval("(x) => x + 1")
out = []
def attempt(name, f):
    try:
        out.append((name, f()))
    except RuntimeError as e:
        out.append((name, str(e)))
def other():
    attempt("call", lambda: function(1))
    attempt("attribute", lambda: js.Bun.version)
    attempt("promise", lambda: js.Promise.resolve(1))
    attempt("list", lambda: array[0] + len(array))       # A JS array is a list, which is Python's as much as JS's.
t = threading.Thread(target=other); t.start(); t.join()
for line in out: print(*line)
print(function(1))
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(
    [
      "call JavaScript can only be used from the main thread",
      "attribute JavaScript can only be used from the main thread",
      "promise JavaScript can only be used from the main thread",
      "list 4",
      "2",
      "",
    ].join("\n"),
  );
  expect(exitCode).toBe(0);
});

it("another thread may look at an object of JavaScript where that runs no code", async () => {
  const { stdout, stderr, exitCode } = await run({
    "lib.mjs": `export const exported = 1;`,
    "main.py": `
import js, lib, sys, threading, unittest, warnings
import bun, node.events, node.fs

js.eval("var declared = 5")
o = js.eval("({ value: 1, nested: { deep: [1] }, method() { return 2 }, get getter() { return 3 }, from: 4 })")
instance = js.eval("new (class A { field = 1; method() {} get getter() { return 1 } })")
proxy = js.Proxy(js.Object(), js.Object())
out = []
def attempt(name, f):
    try:
        out.append((name, f()))
    except (RuntimeError, AttributeError) as e:
        out.append((name, type(e).__name__, str(e)))
def other():
    # What unittest, warnings and inspect do to everything in sys.modules.
    attempt("modules", lambda: [getattr(m, "__warningregistry__", None) for m in list(sys.modules.values())].count(None) == len(sys.modules))
    with unittest.TestCase().assertWarns(UserWarning):
        warnings.warn("in a thread", UserWarning)
    attempt("value", lambda: (o.value, o.nested.deep, o.from_, instance.field, js.declared))
    attempt("absent", lambda: (hasattr(o, "nothing"), hasattr(js, "nothing"), hasattr(node.events, "nothing"), hasattr(lib, "nothing"), hasattr(instance, "nothing")))
    attempt("missing", lambda: o.nothing)
    attempt("of Python", lambda: (type(o).__name__, o.__class__.__name__, type(js).__name__, type(node.events).__name__))
    attempt("repr", lambda: (repr(o).split(" at ")[0], repr(instance).split(" at ")[0], repr(o.method).split(" at ")[0]))
    attempt("method", lambda: o.method is method)
    attempt("call", lambda: o.method())
    attempt("getter", lambda: o.getter)
    attempt("inherited getter", lambda: instance.getter)
    attempt("proxy", lambda: proxy.anything)
    attempt("export", lambda: lib.exported)
    attempt("made when asked for", lambda: js.WeakRef)
    attempt("set", lambda: setattr(o, "value", 2))
    attempt("import", lambda: __import__("js") is js)
method = o.method
t = threading.Thread(target=other); t.start(); t.join()
for line in out: print(*line)
`,
  });
  const refused = "RuntimeError JavaScript can only be used from the main thread";
  expect(stderr).toBe("");
  expect(stdout).toBe(
    [
      "modules True",
      "value (1, [1], 4, 1, 5)",
      "absent (False, False, False, False, False)",
      "missing AttributeError 'JSPlainObject' object has no attribute 'nothing'",
      "of Python ('JSPlainObject', 'JSPlainObject', 'JSObject', 'JSFunction')",
      "repr ('<JavaScript object', '<JavaScript object', '<JavaScript function ')",
      "method True",
      "call " + refused,
      "getter " + refused,
      "inherited getter " + refused,
      "proxy " + refused,
      "export " + refused,
      "made when asked for " + refused,
      "set " + refused,
      "import True",
      "",
    ].join("\n"),
  );
  expect(exitCode).toBe(0);
});

it("threads run while JS awaits, and the event loop waits for them", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "worker.py": `
import threading, time

def compute(n):
    def work():
        total = sum(i * i for i in range(n))
        results.append(total)
    t = threading.Thread(target=work); t.start()
    return t
results = []
def finished(t): return not t.is_alive()
`,
      "main.js": `
import { compute, finished, results } from "./worker.py";
const t = compute(20000);
let turns = 0;
while (!finished(t)) { turns++; await new Promise(resolve => setImmediate(resolve)); }
console.log(results[0], turns >= 0);
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("2666466670000 true\n");
  expect(exitCode).toBe(0);
});

it("concurrent.futures.ThreadPoolExecutor", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import concurrent.futures, threading

def square(x):
    if x == 3: raise ValueError("three")
    return x * x
with concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="pool") as pool:
    print(list(pool.map(lambda x: x + 1, range(8))))
    futures = [pool.submit(square, i) for i in range(5)]
    concurrent.futures.wait(futures)
    print([f.result() if not f.exception() else repr(f.exception()) for f in futures])
    print(pool.submit(lambda: threading.current_thread().name.startswith("pool")).result())
    print(sorted(f.result() for f in concurrent.futures.as_completed([pool.submit(pow, 2, i) for i in range(4)])))
print(threading.active_count())
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe("[1, 2, 3, 4, 5, 6, 7, 8]\n[0, 1, 4, \"ValueError('three')\", 16]\nTrue\n[1, 2, 4, 8]\n1\n");
  expect(exitCode).toBe(0);
});

it("asyncio hands work to threads, at the top level and in asyncio.run()", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import asyncio, socket, threading, time

def blocking(x):
    time.sleep(0.01)
    return x, threading.current_thread() is not threading.main_thread()

print(await asyncio.to_thread(blocking, "top level"))
loop = asyncio.get_running_loop()
print(await loop.run_in_executor(None, blocking, "executor"))
info = await loop.getaddrinfo("localhost", 80, family=socket.AF_INET, type=socket.SOCK_STREAM)
print(info[0][4])
print(await asyncio.gather(*[asyncio.to_thread(blocking, i) for i in range(3)]))

def from_thread(loop, future):
    loop.call_soon_threadsafe(future.set_result, "set from a thread")
future = loop.create_future()
threading.Thread(target=from_thread, args=(loop, future)).start()
print(await future)

async def main():
    return await asyncio.to_thread(blocking, "asyncio.run")
def in_thread(): results.append(asyncio.run(main()))
results = []
t = threading.Thread(target=in_thread); t.start()
await asyncio.to_thread(t.join)
print(results)
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(
    [
      "('top level', True)",
      "('executor', True)",
      "('127.0.0.1', 80)",
      "[(0, True), (1, True), (2, True)]",
      "set from a thread",
      "[('asyncio.run', True)]",
      "",
    ].join("\n"),
  );
  expect(exitCode).toBe(0);
});

it("signal handlers run in the main thread, whatever the threads do", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import os, signal, threading

handled = []
signal.signal(signal.SIGUSR1, lambda number, frame: handled.append(threading.current_thread() is threading.main_thread()))

# Sent by another thread while the main one waits for it.
t = threading.Thread(target=os.kill, args=(os.getpid(), signal.SIGUSR1)); t.start(); t.join()
while not handled: pass
print(handled)

# Sent to another thread.
ready, leave = threading.Event(), threading.Event()
def idle(): ready.set(); leave.wait()
t = threading.Thread(target=idle); t.start(); ready.wait()
signal.pthread_kill(t.ident, signal.SIGUSR1)
while len(handled) < 2: pass
leave.set(); t.join()
print(handled)

def install():
    try:
        signal.signal(signal.SIGUSR2, lambda *a: None)
    except ValueError as e:
        print(e)
t = threading.Thread(target=install); t.start(); t.join()

# A wait without end in the main thread is interrupted by what the handler raises.
class Interrupted(Exception): pass
def interrupt(number, frame): raise Interrupted
signal.signal(signal.SIGUSR1, interrupt)
try:
    threading.Thread(target=os.kill, args=(os.getpid(), signal.SIGUSR1)).start()
    threading.Event().wait()
except Interrupted:
    print("interrupted")
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe("[True]\n[True, True]\nsignal only works in main thread of the main interpreter\ninterrupted\n");
  expect(exitCode).toBe(0);
});

it("collections in other threads leave the host's objects to the main thread", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import gc, os, threading, _bun_loop, js

def churn():
    keep = None
    for i in range(20000):
        keep = [i, str(i), (i, keep and keep[0]), {i: i}]
    gc.collect()

for _ in range(20):
    _bun_loop.Timer(lambda: print("fired")).set(1000)
pipes = [os.pipe() for _ in range(10)]
for r, w in pipes:
    _bun_loop.Watcher(r, lambda: print("ready"))
for i in range(50):
    js.Response.new("body"); js.URL.new("http://example.com/"); js.TextDecoder.new(); js.Blob.new(["x"]); js.Buffer.alloc(100000)
threads = [threading.Thread(target=churn) for _ in range(3)]
for t in threads: t.start()
for t in threads: t.join()
gc.collect()
print("done")
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe("done\n");
  expect(exitCode).toBe(0);
});

it("a thread that waits idly collects: what a dropped object held open is closed", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import socket, threading

# The reader sees the end of the stream only when the file object that the main thread has dropped, not closed, is finalized.
a, b = socket.socketpair()
def drop():
    f = a.makefile("wb"); f.write(b"data"); f.flush()
    a.close()            # The descriptor stays open for as long as the file object has not been closed.
got = []
t = threading.Thread(target=lambda: got.append(b.makefile("rb").read()))
t.start()
drop()
t.join()
print(got)
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe("[b'data']\n");
  expect(exitCode).toBe(0);
});

it("cyclic garbage of one class that two threads have made goes to each its own", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "m.py": `
import threading

by = {}
class D:
    def __init__(self): self.maker = threading.current_thread().name
    def __del__(self):
        key = "%s's by %s" % (self.maker, threading.current_thread().name)
        by[key] = by.get(key, 0) + 1
def pair():
    a = D()
    b = D()
    a.other = b
    b.other = a
def deep(n):
    return deep(n - 1) + 1 if n else 0
stop = threading.Event()
ready = threading.Event()
def work():
    pair()
    deep(50)
    ready.set()
    stop.wait()
thread = threading.Thread(target=work, name="the other")

def make():
    thread.start()
    ready.wait()
    for _ in range(100):
        pair()
    deep(50)
def report():
    # (No instance is left, so the engine's record of their shape has died with them.)
    for _ in range(10000000):
        if sum(by.values()) >= 202:
            break
    stop.set()
    thread.join()
    return str(sorted(by.items()))
`,
      "main.js": `
const { make, report } = await import("./m.py");
make();
// A collection of the engine's own: it hands out, each finalizer to the thread that made the object.
Bun.gc(true);
console.log(report());
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout).toBe(`[("MainThread's by MainThread", 200), ("the other's by the other", 2)]\n`);
  expect(exitCode).toBe(0);
});

it("a thread that ran Python in a realm that is gone starts it again with a state of its own", async () => {
  // The states of the threads go with the last runtime of the VM. Here strings get their memory before Python starts again.
  const { stdout, stderr, exitCode } = await run(
    {
      "lib.py": `
import threading, time

def look():
    time.sleep(0.001)
    lock = threading.RLock()
    with lock, lock:
        return threading.current_thread() is threading.main_thread()
`,
      "main.js": `
let realm = new ShadowRealm();
console.log("in the realm:", (await realm.importValue("./lib.py", "look"))());
realm = null;
for (let i = 0; i < 5; i++) {
  Bun.gc(true);
  await new Promise(resolve => setImmediate(resolve));
}
const strings = [];
for (let round = 0; round < 512; round++) {
  for (let length = 8; length <= 1024; length += 8) strings.push("a".repeat(length));
}
const { look } = await import("./lib.py");
console.log("behind it:", look());
console.log("strings that have changed:", strings.filter(string => string !== "a".repeat(string.length)).length);
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("in the realm: true\nbehind it: true\nstrings that have changed: 0\n");
  expect(exitCode).toBe(0);
});

it("the signals of a realm that is gone are for the next that asks", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "lib.py": `
import os, signal

def look():
    seen = []
    before = signal.signal(signal.SIGUSR1, lambda number, frame: seen.append(number))
    os.kill(os.getpid(), signal.SIGUSR1)
    for _ in range(1000000):
        if seen:
            break
    # (Before the handler is taken away again: that looks at what has arrived, too.)
    result = seen == [signal.SIGUSR1]
    signal.signal(signal.SIGUSR1, before)
    return result
`,
      "main.js": `
let realm = new ShadowRealm();
console.log("in the realm:", (await realm.importValue("./lib.py", "look"))());
realm = null;
for (let i = 0; i < 5; i++) {
  Bun.gc(true);
  await new Promise(resolve => setImmediate(resolve));
}
const { look } = await import("./lib.py");
console.log("behind it:", look());
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("in the realm: true\nbehind it: true\n");
  expect(exitCode).toBe(0);
});

it("faulthandler lets go of a realm that is gone", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "lib.py": `
import faulthandler

def enable():
    faulthandler.enable()
    return faulthandler.is_enabled()

def is_enabled():
    return faulthandler.is_enabled()
`,
      "main.js": `
let realm = new ShadowRealm();
const weak = new WeakRef(realm);
console.log("in the realm:", (await realm.importValue("./lib.py", "enable"))());
realm = null;
for (let i = 0; i < 50 && (i < 5 || weak.deref()); i++) {
  Bun.gc(true);
  await new Promise(resolve => setImmediate(resolve));
}
console.log("the realm is gone:", !weak.deref());
const { is_enabled } = await import("./lib.py");
console.log("behind it:", is_enabled());
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("in the realm: true\nthe realm is gone: true\nbehind it: false\n");
  expect(exitCode).toBe(0);
});

it("the lock of imports that a realm that is gone has left held is free for the next", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "first.py": `
import _imp, threading

def take():
    thread = threading.Thread(target=lambda: None)
    thread.start()
    thread.join()
    _imp.acquire_lock()
    return _imp.lock_held()
`,
      "second.py": `
import _imp, threading

def look():
    held = _imp.lock_held()
    imported = []
    def work():
        import colorsys  # Not imported so far.
        imported.append(colorsys.__name__)
    thread = threading.Thread(target=work, daemon=True)
    thread.start()
    thread.join(30)
    return "held: %s; a thread has imported: %s" % (held, imported)
`,
      "main.js": `
let realm = new ShadowRealm();
console.log("held in the realm:", (await realm.importValue("./first.py", "take"))());
realm = null;
for (let i = 0; i < 5; i++) {
  Bun.gc(true);
  await new Promise(resolve => setImmediate(resolve));
}
console.log((await new ShadowRealm().importValue("./second.py", "look"))());
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("held in the realm: true\nheld: False; a thread has imported: ['colorsys']\n");
  expect(exitCode).toBe(0);
});

it("the lock of imports that a realm that is gone has left held is nothing to a runtime that lives on", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "realm.py": `
import _imp, _warnings

def take():
    _imp.acquire_lock()
    _warnings._acquire_lock()
    return _imp.lock_held()
`,
      "m.py": `
import _imp, importlib, threading, warnings

def look(name):
    held = _imp.lock_held()
    done = []
    def work():
        # Not imported so far.
        done.append(importlib.import_module(name).__name__)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            warnings.warn("a warning")
        done.append(len(caught))
    thread = threading.Thread(target=work, daemon=True)
    thread.start()
    thread.join(30)
    return "held: %s; a thread has imported and warned: %s" % (held, done)
`,
      "main.js": `
const { look } = await import("./m.py");
console.log("before:", look("colorsys"));
let realm = new ShadowRealm();
console.log("held in the realm:", (await realm.importValue("./realm.py", "take"))());
console.log("beside it:", look("stringprep"));
realm = null;
for (let i = 0; i < 5; i++) {
  Bun.gc(true);
  await new Promise(resolve => setImmediate(resolve));
}
console.log("behind it:", look("quopri"));
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  const fine = (name: string) => `held: False; a thread has imported and warned: ['${name}', 1]\n`;
  expect(stdout).toBe(
    "before: " + fine("colorsys") + "held in the realm: true\nbeside it: " + fine("stringprep") + "behind it: " + fine("quopri"),
  );
  expect(exitCode).toBe(0);
}, 180_000);

it("what the handler of a signal raises in the middle of a call that another runtime owes", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      // (It does not import signal: the signals are for the runtime that asks first.)
      "first.py": `
import os

class Sends:
    def __init__(self, number): self.number = number
    def __del__(self):
        os.kill(os.getpid(), self.number)
        for _ in range(1000):
            pass
def drop(number):
    Sends(number)
`,
      // (gc.get_objects() collects, and hands out what it finds. Not gc.collect(): in the middle of a call that gc.collect() makes for this
      // runtime itself, a callback of importlib's weak references, say, what the handler raises is that call's, as in CPython, and
      // whether there is such a call just then depends on when the collector last came.)
      "second.py": `
import gc, signal

class Stop(Exception):
    pass
def install():
    def handler(number, frame):
        raise Stop
    signal.signal(signal.SIGUSR1, handler)
    return int(signal.SIGUSR1)
def wait():
    try:
        gc.get_objects()
        for _ in range(3000000):
            pass
        return "not ended by the signal"
    except Stop:
        return "ended by the signal"
`,
      // The handler is there before there is anything to finalize: a collection of the engine's own may come at any time, and then the
      // signal may have come before wait() is in its try.
      "main.js": `
const { drop } = await import("./first.py");
const realm = new ShadowRealm();
const install = await realm.importValue("./second.py", "install");
const wait = await realm.importValue("./second.py", "wait");
const number = install();
try {
  drop(number);
  console.log(wait());
} catch (error) {
  console.log("ended by the signal");
}
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("ended by the signal\n");
  expect(exitCode).toBe(0);
});

it("what JS throws in the handler of a signal in the middle of a call that another runtime owes", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "first.py": `
import os

class Sends:
    def __init__(self, number): self.number = number
    def __del__(self):
        os.kill(os.getpid(), self.number)
        for _ in range(1000):
            pass
def drop(number):
    Sends(number)
`,
      // Each runtime makes an exception of its own of what JS threw.
      "second.py": `
import gc, signal

def install(throws):
    signal.signal(signal.SIGUSR1, lambda number, frame: throws())
    return int(signal.SIGUSR1)
def wait():
    gc.get_objects()
    for _ in range(3000000):
        pass
    return "not ended by the signal"
`,
      // (The handler first, as above.)
      "main.js": `
const { drop } = await import("./first.py");
const realm = new ShadowRealm();
const install = await realm.importValue("./second.py", "install");
const wait = await realm.importValue("./second.py", "wait");
const number = install(() => { throw new RangeError("thrown by JS in the handler"); });
try {
  drop(number);
  console.log(wait());
} catch (error) {
  console.log("ended by the signal");
}
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("ended by the signal\n");
  expect(exitCode).toBe(0);
});

it("a signal ends a wait of a runtime that has not got the signals", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "first.py": `
import _thread, gc, sys, threading, time

def wait(how, arm):
    try:
        number = arm(how)       # (Inside the try: whenever the signal comes from here on, it ends this.)
        if how == "lock":
            lock = threading.Lock()
            lock.acquire()
            lock.acquire(timeout=3)
        elif how == "event, and no other thread":
            threading.Event().wait()
        elif how == "interrupt_main":
            _thread.interrupt_main(number)
            for _ in range(3000000):
                pass
        else:
            time.sleep(3)
    except:
        # An exception of the other runtime, in a frame of this one, and nobody has named it.
        name = sys.exc_info()[0].__name__
        return "ended by " + name + (" " if gc.get_objects() else "")
    return "not ended by the signal"
`,
      // (An end of its own, which decides nothing: a wait that nothing ends would outlive the test.)
      "second.py": `
import faulthandler, signal

faulthandler.dump_traceback_later(60, exit=True)
class Stop(Exception):
    pass
def handler(number, frame):
    raise Stop
def arm(how):
    signal.signal(signal.SIGALRM, signal.default_int_handler if how == "sleep, and a handler that is no Python code" else handler)
    if how != "interrupt_main":
        signal.setitimer(signal.ITIMER_REAL, 0.2)
    return int(signal.SIGALRM)
`,
      "main.js": `
const { wait } = await import("./first.py");
const arm = await new ShadowRealm().importValue("./second.py", "arm");
for (const how of ["sleep", "lock", "event, and no other thread", "interrupt_main", "sleep, and a handler that is no Python code"])
  console.log(how + ": " + wait(how, arm));
process.exit(0);
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout.split("\n")).toEqual([
    "sleep: ended by Stop ",
    "lock: ended by Stop ",
    "event, and no other thread: ended by Stop ",
    "interrupt_main: ended by Stop ",
    "sleep, and a handler that is no Python code: ended by KeyboardInterrupt ",
    "",
  ]);
  expect(exitCode).toBe(0);
});

it("the main thread is got out of a system call behind a realm that is gone, too", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "first.py": `
import signal, threading

def run():
    # It has the signals, and there has been a second thread.
    signal.signal(signal.SIGUSR1, lambda number, frame: None)
    thread = threading.Thread(target=lambda: None)
    thread.start()
    thread.join()
    return True
`,
      "second.py": `
import os, signal, threading, time

class Writes:
    def __init__(self, fd): self.fd = fd
    def __del__(self): os.write(self.fd, b"x\\n")

def drop(fd):
    Writes(fd)

def run():
    # SIGURG is the program's to block. What gets the main thread out of a system call is a signal that is nobody else's.
    signal.pthread_sigmask(signal.SIG_BLOCK, [signal.SIGURG])
    r, w = os.pipe()
    child = os.posix_spawn("/bin/sh", ["sh", "-c", "read x"], os.environ, file_actions=[(os.POSIX_SPAWN_DUP2, r, 0)])
    waits = []
    stop = []
    def work():
        while not waits:
            pass
        limit = time.monotonic() + 60
        while not stop:
            [[i] for i in range(1000)]
            if time.monotonic() > limit:
                # So that a run in which the main thread is not got out of the call ends too, and says so.
                os.kill(child, signal.SIGKILL)
                break
    thread = threading.Thread(target=work, daemon=True)
    thread.start()
    drop(w)
    # With reference counts the line is written by now. Here the finalizer is owed by this thread, which hears of it in the middle of a call that cannot be made piece by piece.
    waits.append(1)
    pid, status = os.wait()
    stop.append(1)
    thread.join()
    return pid == child and status == 0
`,
      "main.js": `
let realm = new ShadowRealm();
console.log("the realm has had a thread:", (await realm.importValue("./first.py", "run"))());
realm = null;
for (let i = 0; i < 5; i++) {
  Bun.gc(true);
  await new Promise(resolve => setImmediate(resolve));
}
console.log("the child has ended:", (await new ShadowRealm().importValue("./second.py", "run"))());
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("the realm has had a thread: true\nthe child has ended: true\n");
  expect(exitCode).toBe(0);
}, 180_000);

it("JS cannot take away memory that a thread is using", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import js, os, threading

class Buffers:
    # os.readv() takes the buffer of each item in turn: while it asks for the second, it holds the first.
    def __init__(self, first, between):
        self.items, self.between = [first, bytearray(1)], between
    def __len__(self): return 2
    def __getitem__(self, i):
        if i == 1: self.between()
        return self.items[i]

def read_into(target, meanwhile):
    r, w = os.pipe()
    held, go_on, out = threading.Event(), threading.Event(), []
    def between(): held.set(); go_on.wait()
    t = threading.Thread(target=lambda: out.append(os.readv(r, Buffers(target, between))))
    t.start(); held.wait()
    result = meanwhile()
    go_on.set(); os.write(w, b"abcdefghi"); t.join()
    os.close(r); os.close(w)
    return out, result

small = js.Uint8Array.new(8)
out, copy = read_into(small, lambda: small.buffer.transfer())
print(out, bytes(small), small.buffer.detached, copy.byteLength)

resizable = js.eval("new ArrayBuffer(8, { maxByteLength: 16 })")
def shrink():
    try:
        resizable.resize(4)
    except Exception as e:
        return str(e)
out, error = read_into(resizable, shrink)
print(out, bytes(resizable), error)

resizable.resize(4); print(resizable.byteLength)
moved = small.buffer.transfer(); print(small.buffer.detached, len(bytes(moved)))
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(
    [
      "[9] b'abcdefgh' False 8",
      "[9] b'abcdefgh' RangeError: ArrayBuffer resize failed with new byte length 4",
      "4",
      "True 8",
      "",
    ].join("\n"),
  );
  expect(exitCode).toBe(0);
});

it("a time limit of node:vm ends what the main thread is doing, not another thread", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "worker.py": `
import threading

state = []
stop = threading.Event()
def spin():
    def work():
        while not stop.is_set(): pass
        state.append("worker finished")
    t = threading.Thread(target=work); t.start(); t.join()
    state.append("joined")
def finish():
    stop.set()
    for t in threading.enumerate():
        if t is not threading.current_thread(): t.join()
    return state
`,
      "main.js": `
import vm from "node:vm";
import { spin, finish } from "./worker.py";
try {
  vm.runInContext("spin(); for (;;) {}", vm.createContext({ spin }), { timeout: 100 });
  console.log("returned");
} catch (e) {
  console.log(e.code);
}
console.log(finish().join());
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT\nworker finished\n");
  expect(exitCode).toBe(0);
});

it("an interrupt ends the wait for the other threads at exit", async () => {
  using dir = tempDir("python-threads", {
    "main.py": `
import threading

threading.Thread(target=threading.Event().wait).start()
threading._register_atexit(lambda: print("shutting down", flush=True))
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.py"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = proc.stdout.getReader();
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toBe("shutting down\n");
  proc.kill("SIGINT");
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toStartWith("Exception ignored on threading shutdown:");
  expect(stderr.trimEnd()).toEndWith("KeyboardInterrupt");
  expect(exitCode).toBe(0);
});

it("process.execve() while tracebacks of faulthandler fall due", async () => {
  // The thread of dump_traceback_later() gets the main thread's attention with a signal, which the new program does not expect.
  using dir = tempDir("python-threads", {
    "later.py": `
import faulthandler, os, tempfile

log = tempfile.TemporaryFile()

def later(seconds):
    faulthandler.dump_traceback_later(seconds, repeat=True, file=log)

def written():
    return os.fstat(log.fileno()).st_size
`,
    "main.js": `
import later from "./later.py";
later.later(0.000005);
while (later.written() < 20000);
process.execve("/bin/echo", ["echo", "the new program"], {});
`,
  });
  const results = await Promise.all(
    Array.from({ length: 8 }, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "ignore",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      return { stdout, exitCode, signalCode: proc.signalCode };
    }),
  );
  expect(results).toEqual(Array(8).fill({ stdout: "the new program\n", exitCode: 0, signalCode: null }));
});
