import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";

// These builds take seconds to start Python, and half a minute to import asyncio.
if (isDebug || isASAN) setDefaultTimeout(180_000);

async function run(files: Record<string, string>, entry = "main.py", env = bunEnv) {
  using dir = tempDir("python-threads", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env,
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

// What the collections of gc.collect() find, and those of the main thread as it ends, is for the caller to make. The thread that made the objects is not told, though the finalizers let go of the GIL, or
// really wait: to start a thread is to wait for an event. It sits in recv(), where it does not look for garbage by itself, as it would in a wait for another thread: so it comes only if it is told.
// (In CPython the thread that drops an object finalizes it: so this is not among the tests that are compared with it.)
for (const where of ["gc.collect()", "the end of the main thread"]) {
  for (const [what, how] of [
    ["200 objects", "do nothing else"],
    ["200 objects", "write"],
    ["200 objects", "sleep"],
    ["200 objects", "start a thread"],
    ["a chain of 200", "read a file"],
    ["a cycle of 200", "read a file"],
    ["one object", "do nothing else"],
  ]) {
    if (what === "a cycle of 200" && where !== "gc.collect()") continue; // Cyclic garbage is not finalized before the callbacks of atexit, as in CPython.
    it(`${where} makes the calls that are owed by a thread that sits in a system call: ${what}, whose finalizers ${how}`, async () => {
      const { stdout, stderr, exitCode } = await run({
        "main.py": `
import atexit, gc, os, socket, threading, time

where, what, how = ${JSON.stringify(where)}, ${JSON.stringify(what)}, ${JSON.stringify(how)}
names = []; null = os.open(os.devnull, os.O_WRONLY); a, b = socket.socketpair(); ready = []
class Node:
    def __init__(self, next=None): self.next = next
    def __del__(self):
        if how == "write": os.write(null, b"x")
        elif how == "sleep": time.sleep(0.001)
        elif how == "start a thread": threading.Thread(target=int).start()
        elif how == "read a file":
            with open(__file__, "rb", buffering=0) as f: f.read(64)
        names.append(threading.current_thread().name)
def work():
    if what == "200 objects": x = [Node() for i in range(200)]
    elif what == "one object": x = Node()
    else:
        x = last = Node()
        for i in range(199): x = Node(x)
        if what == "a cycle of 200": last.next = x
        del last
    del x
    ready.append(1); a.recv(1)
gc.collect()  # So that no collection of the engine's own is under way, or due, when the thread drops them: that would hand them out, and tell the thread.
threading.Thread(target=work, daemon=True, name="maker").start()
while not ready: pass  # (In a wait the main thread would look for garbage by itself after a while, and hand out what it finds.)
def report(): print(len(names), sorted(set(names)), flush=True)
if where == "gc.collect()": gc.collect(); report()
else: atexit.register(report)
`,
      });
      expect(stderr).toBe("");
      expect(stdout).toBe(`${what === "one object" ? 1 : 200} ['MainThread']\n`);
      expect(exitCode).toBe(0);
    });
  }
}

// The rest of what gc.collect() has found is still the caller's when the handler of a signal raises out of it: it makes it at its next safe point. A thread makes X, hands it on, takes a plain lock and goes on
// with it until X's finalizer has begun. The main thread drops X and calls gc.collect(); a timer's signal falls into the collection. In the thread itself X's finalizer would never get the lock.
// (In CPython no handler is called between a collection and its finalizers: so this is not among the tests that are compared with it.)
it("what the handler of a signal raises out of gc.collect() does not leave the rest to a thread that has a lock in its hand", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import faulthandler, gc, signal, threading

faulthandler.dump_traceback_later(60, exit=True)
class Stop(Exception): pass
armed = False
def handler(*_):
    global armed
    if armed:
        armed = False; signal.setitimer(signal.ITIMER_REAL, 0)
        raise Stop
signal.signal(signal.SIGALRM, handler)
lock = threading.Lock(); box = []; holds = []; begun = []; log = []
class X:
    def __del__(self):
        log.append("X begins in " + threading.current_thread().name); begun.append(1)
        with lock: log.append("X has the lock")
def work():
    box.append(X())
    with lock:
        holds.append(1)
        while not begun: pass
        log.append("the thread lets go of the lock")
ballast = [[i] for i in range(400000)]  # So that the collection takes many times as long as the timer's interval.
thread = threading.Thread(target=work, name="maker"); thread.start()
while not holds: pass
box.clear()
signal.setitimer(signal.ITIMER_REAL, 0.001, 0.001)
try:
    armed = True  # (No call: signals are looked at behind every call. So no handler finds this before the collection.)
    gc.collect(); log.append("gc.collect() has returned")
except Stop: log.append("gc.collect() was left")
thread.join()
print(log, flush=True)
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe("['gc.collect() was left', 'X begins in MainThread', 'the thread lets go of the lock', 'X has the lock']\n");
  expect(exitCode).toBe(0);
});

// What other collections have handed out comes first: it was found earlier. When nothing can move any more, what gc.collect() has found and not begun goes back to the threads that made the objects, among
// what they owe already, in the order in which all of it was queued.
// (In CPython each of these is finalized where it is dropped: so this is not among the tests that are compared with it.)
it("what gc.collect() gives back at a standstill goes among what the thread owes already, in the order in which it was queued", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import faulthandler, gc, sys, threading, weakref

faulthandler.dump_traceback_later(60, exit=True)
never = threading.Event(); let = threading.Event(); done = threading.Event(); log = []; begun = []; box = {}; refs = []
up = [threading.Event() for _ in range(3)]
class N:
    def __init__(self, what): self.what = what
    def __del__(self):
        log.append(self.what)
        if self.what == "c1": begun.append(1); let.wait()
        elif self.what == "e": let.set()
        elif len(log) == 7: done.set()
class O: pass
def f(r):
    log.append("f")
    del box["c4"]; gc.get_objects()  # One more is handed out, behind what gc.collect() has found.
    done.wait()
def make(what):
    if what == "o": box[what] = O(); refs.append(weakref.ref(box[what], f))
    else: box[what] = N(what)
def work(i):
    for what in (("o",), ("c1", "c2", "c3", "d", "c4"), ("e",))[i]: make(what)
    up[i].set(); never.wait()
for i in range(3): threading.Thread(target=work, args=(i,), daemon=True).start(); up[i].wait()
# The main thread drops all of it, so that no thread goes to sleep with something dropped, which it would look for by itself after a while.
for what in ("c1", "c2", "c3"): del box[what]; gc.get_objects()  # Collections that only hand out, one for each: their thread begins c1, which waits.
while not begun: pass
sys.setswitchinterval(5)  # From here on a thread goes on until it waits.
del box["o"], box["d"], box["e"]
gc.collect()  # It makes c2 and c3, which their thread has not come to. It finds f, d and e, and begins f, a callback, which waits: nothing can move any more.
print(log, flush=True)
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe("['c1', 'c2', 'c3', 'f', 'e', 'd', 'c4']\n");
  expect(exitCode).toBe(0);
});

// A slot is freed by the finalizer of a callback that the program has dropped, and within a finalizer no other is called: there is nothing to be had from a collection there, and none is made. (That none
// is made cannot be seen from here. A build with assertions stops if one is: whoever collects for this makes the calls of other threads, and gc.collect(), which has called the finalizer, does so already.)
it("a finalizer that finds the table of ctypes' callbacks full is told so", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import ctypes, gc

F = ctypes.CFUNCTYPE(ctypes.c_int)
keep = [F(lambda: 0) for _ in range(512)]
log = []
class N:
    def __del__(self):
        try: F(lambda: 0); log.append("made")
        except MemoryError as e: log.append(str(e))
n = N(); del n
gc.collect()
print(log, flush=True)
del keep[0]
F(lambda: 0)  # Anywhere else the collector is asked, and finds the one that has been dropped.
print("made", flush=True)
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe("['too many ctypes callbacks are alive']\nmade\n");
  expect(exitCode).toBe(0);
});


// The call that has called process.exit() never returns, and within a call that is owed no other is made: so nothing more is finalized; the callbacks of atexit are called. (A build with assertions
// stops if the steps of the exit that make the calls of other threads are gone through here: gc.collect(), which has called the finalizer, makes them already.)
it("process.exit() in a finalizer that gc.collect() runs", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "m.py": `
import atexit, gc

atexit.register(lambda: print("a callback of atexit", flush=True))
class N:
    def __init__(self, leave): self.leave = leave
    def __del__(self): print("the finalizer begins", flush=True); self.leave()
class Other:
    def __del__(self): print("another finalizer", flush=True)
def run(leave):
    kept = Other(); n = N(leave); dropped = Other()
    del n, dropped
    gc.collect()
    print("gc.collect() has returned", flush=True)
`,
      "main.js": `
import { run } from "./m.py";
process.on("exit", code => console.log("exit", code));
run(() => { console.log("process.exit()"); process.exit(3); });
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("the finalizer begins\nprocess.exit()\na callback of atexit\nexit 3\n");
  expect(exitCode).toBe(3);
});
// With no other thread the GIL is not given up: the thread sleeps inside the VM, and what gets it out when the host ends what runs is the engine's own signal. A thread that waits also looks by
// itself, less and less often: some four times in the first two seconds, and then not for two seconds or more. So the end comes after two seconds, and is not to take until the next look.
for (const wait of ["threading.Event().wait(1000)", "lock.acquire(timeout=1000)", "queue.Queue().get(timeout=1000)"]) {
  it(`a time limit of node:vm ends a wait at once where there is no other thread: ${wait}`, async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "waits.py": `
import queue, threading

lock = threading.Lock(); lock.acquire()
def wait(): ${wait}
`,
        "main.js": `
import vm from "node:vm";
import { wait } from "./waits.py";
const start = performance.now();
try {
  vm.runInContext("wait()", vm.createContext({ wait }), { timeout: 2000 });
  console.log("returned");
} catch (e) {
  console.log(e.code, performance.now() - start < 3500 ? "in time" : "late");
}
`,
      },
      "main.js",
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT in time\n");
    expect(exitCode).toBe(0);
  });
}

it("terminate() ends a worker that waits at once where there is no other thread", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "waits.py": `
import threading

lock = threading.Lock(); lock.acquire()
def wait(): lock.acquire(timeout=1000)
`,
      "worker.js": `
import { wait } from "./waits.py";
postMessage("started");
wait();
`,
      "main.js": `
const worker = new Worker(new URL("./worker.js", import.meta.url).href);
const closed = new Promise(resolve => worker.addEventListener("close", resolve));
await new Promise(resolve => worker.addEventListener("message", resolve, { once: true }));
await Bun.sleep(2000); // Between two of its own looks: see above.
const start = performance.now();
worker.terminate();
await closed;
console.log(performance.now() - start < 1500 ? "in time" : "late");
`,
    },
    "main.js",
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("in time\n");
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

// A thread that gives up the interpreter takes what it has in every runtime of the VM along. There was room for four.
const stateOfAThread = `
import contextvars, ctypes, gc, os, queue, sys, threading, time, weakref

class Marker:
    def __init__(self, number): self.number = number

variable = contextvars.ContextVar("variable")
local = threading.local()
references = []
calls = []

# What the thread has in this runtime, and nothing else refers to.
def put(number):
    for where, marker in ((variable.set, Marker(number)), (lambda m: setattr(local, "value", m), Marker(-number))):
        where(marker)
        references.append(weakref.ref(marker))

def look():
    return f"{variable.get().number} {local.value.number} {[r() is not None for r in references]}"

def collect():
    for _ in range(3):
        gc.collect()
        [bytearray(1000) for _ in range(2000)]

# Whoever calls waits, without the interpreter, while another thread collects.
def collect_in_a_thread():
    thread = threading.Thread(target=collect)
    thread.start()
    thread.join()

# The other thread gives the one that waits a profile function, which then is nowhere but in what that one has taken along.
def profile_from_a_thread():
    def work():
        class Profile:
            def __init__(self): self.marker = Marker(7)
            def __call__(self, frame, event, argument):
                if event == "call" and frame.f_code.co_name == "profiled": calls.append(self.marker.number)
        threading.setprofile_all_threads(Profile())
        sys.setprofile(None)
        collect()
    thread = threading.Thread(target=work)
    thread.start()
    thread.join()
    def profiled(): pass
    profiled()
    sys.setprofile(None)
    return str(calls)

# What a thread finds in a runtime where it has never been.
def fresh():
    return f"{variable.get(None)} {hasattr(local, 'value')}"

# A thread of this runtime's that waits, without the interpreter, to be told which of these functions to call.
jobs, results = queue.SimpleQueue(), queue.SimpleQueue()
done, is_done = os.pipe()
def serve():
    while True:
        name, arguments = jobs.get()
        results.put(str(globals()[name](*arguments)))
        os.write(is_done, b".")
def start_servant():
    threading.Thread(target=serve, daemon=True).start()
def ask(name, *arguments):
    jobs.put((name, arguments))
    os.read(done, 1)
    return results.get()
# Whoever calls waits in C, where nothing wakes it and it asks for nothing. So it is the thread that makes every call that comes to be owed meanwhile.
def ask_and_wait_in_c(name, *arguments):
    jobs.put((name, arguments))
    ctypes.CDLL(None).read(done, ctypes.create_string_buffer(1), 1)
    return results.get()

# What other threads read in, or take out of, what a thread that waits has taken along.
def exception_of_a_thread_that_waits():
    handling, go = threading.Event(), threading.Event()
    def work():
        try: raise ValueError("handled by the thread")
        except ValueError:
            handling.set()
            go.wait()
    thread = threading.Thread(target=work)
    thread.start()
    handling.wait()
    result = repr(sys._current_exceptions()[thread.ident])
    go.set()
    thread.join()
    return result

def traceback_seen_by_a_thread():
    def raises(): raise ValueError("raised by the one that waits")
    seen = []
    try: raises()
    except ValueError as e:
        def work():
            names, traceback = [], e.__traceback__
            while traceback:
                names.append(traceback.tb_frame.f_code.co_name)
                traceback = traceback.tb_next
            seen.append(names)
            collect()
        thread = threading.Thread(target=work)
        thread.start()
        thread.join()
    return str(seen)

def trace_from_a_thread():
    events = []
    def work():
        def trace(frame, event, argument):
            if frame.f_code.co_name == "traced": events.append(event)
            return trace
        threading.settrace_all_threads(trace)
        sys.settrace(None)
        collect()
    thread = threading.Thread(target=work)
    thread.start()
    thread.join()
    def traced(): pass
    traced()
    sys.settrace(None)
    return str(events)

# What a thread makes is finalized by that thread. (Whichever thread runs or is woken tells of a collection: the main one, if one comes by itself before it waits.)
finalized, made = [], []
class Finalized:
    def __init__(self): self.maker = threading.current_thread().name
    def __del__(self): finalized.append((self.maker, threading.current_thread().name))
def make_garbage_after_collections():
    def callback(phase, info):
        if phase == "stop" and not made and threading.current_thread().name != "MainThread":
            made.append(1)
            cycle = Finalized()
            cycle.me = cycle
    gc.callbacks.append(callback)
def what_was_finalized():
    return str(finalized)
`;

it("a thread waits while seven runtimes are alive in the VM, and finds in each what it had there", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "state.py": stateOfAThread,
      "main.js": `
const realms = [];
for (let i = 0; i < 6; i++) {
  const realm = new ShadowRealm(), functions = {};
  for (const name of ["put", "look", "collect_in_a_thread", "profile_from_a_thread", "exception_of_a_thread_that_waits", "traceback_seen_by_a_thread", "trace_from_a_thread"])
    functions[name] = await realm.importValue("./state.py", name);
  realms.push(functions);
}
realms.push(await import("./state.py"));
realms.forEach((realm, i) => realm.put(i + 1));
for (const realm of realms) {
  realm.collect_in_a_thread();
  console.log(realms.map(other => String(other.look())).join(" | "));
}
console.log(realms.map(realm => String(realm.profile_from_a_thread()) + " " + String(realm.look())).join(" | "));
for (const realm of realms) console.log(String(realm.exception_of_a_thread_that_waits()), String(realm.traceback_seen_by_a_thread()), String(realm.trace_from_a_thread()));
`,
    },
    "main.js",
  );
  const all = [1, 2, 3, 4, 5, 6, 7];
  const states = all.map(i => `${i} -${i} [True, True]`).join(" | ") + "\n";
  expect(stderr).toBe("");
  expect(stdout).toBe(
    all.map(() => states).join("") +
      all.map(i => `[7] ${i} -${i} [True, True]`).join(" | ") +
      "\n" +
      "ValueError('handled by the thread') [['traceback_seen_by_a_thread', 'raises']] ['call', 'line', 'return']\n".repeat(7),
  );
  expect(exitCode).toBe(0);
});

// Only the main thread can make one. Each of the others has taken along as many states as there were runtimes when it last gave up the interpreter.
it("runtimes are made while threads wait, three of them and then six more", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "state.py": stateOfAThread,
      "main.js": `
const realms = [];
async function make(hasThread = true) {
  const realm = new ShadowRealm(), functions = {};
  for (const name of ["put", "look", "collect", "collect_in_a_thread", "start_servant", "ask"]) functions[name] = await realm.importValue("./state.py", name);
  if (!hasThread) return functions;
  realms.push(functions);
  functions.put(realms.length);
  functions.start_servant();
  console.log(String(functions.ask("fresh")));
  functions.ask("put", 10 * realms.length);
}
const look = () => console.log(realms.map(realm => String(realm.ask("look")) + ", " + String(realm.look())).join(" | "));
const globalObjects = () => require("bun:jsc").heapStats().objectTypeCounts.GlobalObject;
async function untilThereAre(count) {
  for (let round = 0; round < 100 && globalObjects() > count; round++) {
    Bun.gc(true);
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log(globalObjects() - count);
}
// (In a property: a variable of a module that awaits is saved at an await while it is in use, and what was saved stays.)
const held = { first: await make(false) };
for (let i = 0; i < 3; i++) await make();
for (let i = 0; i < 6; i++) {
  await make();
  realms.at(-1).collect();
  Bun.gc(true);
  look();
}
realms[0].collect_in_a_thread();
look();
// Two that nothing keeps. Each thread has its turn, so that it waits with an entry for them, and then they go.
const before = globalObjects();
await make(false);
await make(false);
console.log(globalObjects() - before);
look();
await untilThereAre(before);
look();
// The first of all, which is the one that says what is scanned with the stacks. Every thread waits with an entry for it in front.
held.first = null;
await untilThereAre(before - 1);
look();
realms[0].collect_in_a_thread();
look();
// Collections that come by themselves.
let junk;
for (let i = 0; i < 100000; i++) junk = new Array(64).fill({ i });
look();
process.exit(0);
`,
    },
    "main.js",
  );
  const states = (count: number) =>
    Array.from({ length: count }, (_, i) => `${10 * (i + 1)} -${10 * (i + 1)} [True, True, True, True], ${i + 1} -${i + 1} [True, True, True, True]`).join(" | ") + "\n";
  expect(stderr).toBe("");
  expect(stdout).toBe("None False\n".repeat(3) + [4, 5, 6, 7, 8, 9].map(count => "None False\n" + states(count)).join("") + states(9) + "2\n" + states(9) + "0\n" + states(9) + "0\n" + states(9).repeat(3));
  expect(exitCode).toBe(0);
});

// The calls that are owed are made in every runtime of the VM by whichever thread runs.
it.each(["before the thread is started", "while the thread waits"])("a thread is known by its number in a runtime that is made %s", async when => {
  const { stdout, stderr, exitCode } = await run(
    {
      "state.py": stateOfAThread,
      "main.js": `
async function make() {
  const realm = new ShadowRealm(), functions = {};
  for (const name of ["start_servant", "ask", "ask_and_wait_in_c", "make_garbage_after_collections", "what_was_finalized"]) functions[name] = await realm.importValue("./state.py", name);
  return functions;
}
const first = await make();
const early = ${when.startsWith("before")} ? await make() : null;
first.start_servant();
first.ask("fresh");
const second = early ?? (await make());
second.make_garbage_after_collections();
first.ask_and_wait_in_c("collect");
console.log(String(second.what_was_finalized()));
process.exit(0);
`,
    },
    "main.js",
  );
  expect({ stdout, stderr }).toEqual({ stdout: "[('Dummy-1', 'Dummy-1')]\n", stderr: "" });
  expect(exitCode).toBe(0);
});

it("a worker with seven runtimes and a thread that waits in each is terminated, exits, comes to its end", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "state.py": stateOfAThread,
      "main.js": `
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
if (isMainThread) {
  for (const how of ["terminate", "exit", "return"]) {
    const worker = new Worker(__filename, { workerData: how });
    const closed = new Promise(resolve => worker.once("exit", resolve));
    await new Promise(resolve => worker.once("message", resolve));
    if (how === "terminate") worker.terminate();
    console.log(how, await closed);
  }
} else {
  for (let i = 0; i < 7; i++) {
    const realm = new ShadowRealm(), functions = {};
    for (const name of ["put", "start_servant", "ask", "collect"]) functions[name] = await realm.importValue("./state.py", name);
    functions.put(i + 1);
    functions.start_servant();
    functions.ask("put", 10 * (i + 1));
    functions.collect();
  }
  parentPort.postMessage("ready");
  if (workerData === "exit") process.exit(3);
  if (workerData === "terminate") setInterval(() => {}, 1000);
}
`,
    },
    "main.js",
  );
  expect({ stdout, stderr }).toEqual({ stdout: "terminate 1\nexit 3\nreturn 0\n", stderr: "" });
  expect(exitCode).toBe(0);
});

it("each runtime has the threads that it waits for at exit to itself, and gc gives no list of them", async () => {
  // The host runs the handlers at exit of the main realm: its threads are joined, in whatever order they end. Those of another realm are cut off.
  const { stdout, stderr, exitCode } = await run(
    {
      "threads.py": `
import gc, threading
ending = threading.Event(); threading._register_atexit(ending.set)
threads = []
def start(name):
    previous = threads[-1] if threads else None
    def run():
        ending.wait()
        if previous: previous.join()
        print("the thread of", name, "ends", flush=True)
    threads.append(threading.Thread(target=run)); threads[-1].start()
def referrers():
    return str([sorted(type(o).__name__ for o in gc.get_referrers(t._os_thread_handle)) for t in threads])
`,
      "main.mjs": `
import { start, referrers } from "./threads.py";
const realm = new ShadowRealm();
const startThere = await realm.importValue("./threads.py", "start"), referrersThere = await realm.importValue("./threads.py", "referrers");
start("the main realm"); startThere("a shadow realm"); start("the main realm, a second");
console.log(String(referrers()), referrersThere());
console.log("main ends");
`,
    },
    "main.mjs",
  );
  expect({ stdout, stderr }).toEqual({
    stdout:
      "[['Thread'], ['Thread']] [['Thread']]\nmain ends\nthe thread of the main realm ends\nthe thread of the main realm, a second ends\n",
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

it("bun test --isolate: a thread in each of six files", async () => {
  const files: Record<string, string> = {
    "thread.py": `
import threading
def thread():
    t = threading.Thread(target=lambda: None); t.start(); t.join(); return "joined"
`,
  };
  for (let i = 1; i <= 6; i++)
    files[`t${i}.test.mjs`] = `
import { test, expect } from "bun:test";
const m = await import("./thread.py");
test("a thread", () => { expect(String(m.thread())).toBe("joined") });
`;
  using dir = tempDir("python-threads-isolate", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(" 6 pass\n");
  expect(stderr).toContain(" 0 fail\n");
  expect({ exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 0, signalCode: null });
});

// What a collection has found dead no later collection marks. A cell with a destructor that a collection finds dead while a thread of Python's has the VM is left unswept for the main thread, while what it
// refers to is swept. The first eight cells of a class are allocations of their own, which used to be taken for alive as long as they had not been swept: by the scan of the stacks, and by ctypes.
// Two kinds of run say nothing. `precise` is false: a collection had left an empty block, and the class took that for its first cells. `freed` is not 0: an allocation of that kind reads as alive again
// once it has been freed, and a full collection on the main thread, between its next turn and its look, frees them all; `freed` counts those that nothing can have brought back.
async function runUntilItSaysSomething(files: Record<string, string>) {
  for (let attempt = 1; ; attempt++) {
    // With --smol the first cells of a class are no allocations of their own.
    const result = await run(files, "main.js", { ...bunEnv, BUN_OPTIONS: "" });
    if (attempt === 10 || !/"precise":false|"freed":[1-9]/.test(result.stdout)) return result;
  }
}

it("a word on a stack does not bring back an object of the host's that is dead and not yet swept", async () => {
  const { stdout, stderr, exitCode } = await runUntilItSaysSomething({
    "lib.py": `
import ctypes, gc, sys, threading

collected, looked = threading.Event(), threading.Event()

def collect_with_words_on_the_stack(objects, kept, dropped):
    kept = [int(address) for address in str(kept).split()]
    dropped = [int(address) for address in str(dropped).split()]
    # Until the other thread lets go of them the objects are held, so that no collection on the main thread (one of the engine's own, or that of a thread that has waited for 50 ms) finds them dead and sweeps.
    held = list(objects)
    objects.clear()
    del objects
    sys.setswitchinterval(1000)     # The main thread, which is sent for to sweep, gets no turn between the two collections.
    def call(addresses, then):
        if not addresses:
            return then()
        # The address is the argument of a function of C that is still running when the stacks are scanned. (PYFUNCTYPE: the GIL is not let go of.)
        ctypes.PYFUNCTYPE(None, ctypes.c_void_p)(lambda pointer: call(addresses[1:], then))(addresses[0])
    def other():
        # The first collection finds dead all but those whose addresses are on the stack by then, and they stay there until the main thread has looked.
        call(kept, lambda: (held.clear(), gc.collect(), call(dropped, gc.collect), collected.set(), looked.wait()))
    thread = threading.Thread(target=other); thread.start(); collected.wait()
    return thread

def let_go(thread):
    looked.set(); thread.join()
`,
    "main.js": `
import { jscInternals } from "bun:internal-for-testing";
const objects = [];
function make(count) {
  return Array.from({ length: count }, () => {
    const immediate = setImmediate(() => {});
    clearImmediate(immediate);
    objects.push(immediate);
    return { address: jscInternals.rawCellAddress(immediate), weak: new WeakRef(immediate) };
  });
}
const addresses = group => group.map(x => x.address).join(" ");
// Before anything else: a class whose first cell is made while a collection has left an empty block takes that block.
const kept = make(2), dropped = make(3), without = make(3);
const precise = [...kept, ...dropped, ...without].every(x => x.address & 8n);
const { collect_with_words_on_the_stack, let_go } = await import("./lib.py");
await new Promise(resolve => setTimeout(resolve, 1)); // A WeakRef keeps what it refers to until the job is over.
const thread = collect_with_words_on_the_stack(objects, addresses(kept), addresses(dropped));
try {
  // A WeakRef is cleared by the collection that finds the object dead.
  const wasFoundDead = x => x.weak.deref() === undefined;
  const isMarkedAllTheSame = x => precise && wasFoundDead(x) && jscInternals.isLiveCellAtRawAddress(x.address);
  console.log(JSON.stringify({
    precise,
    keptByWord: kept.filter(x => !wasFoundDead(x)).length,
    foundDead: dropped.some(wasFoundDead) && without.some(wasFoundDead),
    broughtBack: dropped.filter(isMarkedAllTheSame).length,
    freed: without.filter(isMarkedAllTheSame).length,
  }));
} finally {
  let_go(thread);
}
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe('{"precise":true,"keptByWord":2,"foundDead":true,"broughtBack":0,"freed":0}\n');
  expect(exitCode).toBe(0);
}, 180_000);

it("ctypes does not take the bits of an object of the host's that is dead and not yet swept for an object", async () => {
  const { stdout, stderr, exitCode } = await runUntilItSaysSomething({
    "lib.py": `
import ctypes, gc, sys, threading

def ask_for_the_objects_at(objects, addresses, alive):
    addresses, alive = [int(address) for address in str(addresses).split()], int(alive)
    # Until the other thread lets go of them the objects are held, so that no collection on the main thread (one of the engine's own, or that of a thread that has waited for 50 ms) finds them dead and sweeps.
    held = list(objects)
    objects.clear()
    del objects
    sys.setswitchinterval(1000)     # The main thread, which is sent for to sweep, gets no turn before the other thread has ended.
    given, answers = [], []
    def other():
        del held[alive:]
        gc.collect()                # This finds them dead.
        for index, address in enumerate(addresses):
            try:
                given.append(ctypes.cast(address, ctypes.py_object).value)
                answers.append("itself" if index < alive and given[-1] is held[index] else "something")
            except ValueError:
                answers.append("nothing")
        gc.collect()                # This marks what the list refers to.
    thread = threading.Thread(target=other); thread.start(); thread.join()
    return " ".join(answers)
`,
    "main.js": `
import { jscInternals } from "bun:internal-for-testing";
const objects = [];
function make(count) {
  return Array.from({ length: count }, () => {
    const immediate = setImmediate(() => {});
    clearImmediate(immediate);
    objects.push(immediate);
    return { address: jscInternals.rawCellAddress(immediate), weak: new WeakRef(immediate) };
  });
}
// Before anything else: a class whose first cell is made while a collection has left an empty block takes that block.
const alive = make(2), dropped = make(3), without = make(3);
const precise = [...alive, ...dropped, ...without].every(x => x.address & 8n);
const { ask_for_the_objects_at } = await import("./lib.py");
await new Promise(resolve => setTimeout(resolve, 1)); // A WeakRef keeps what it refers to until the job is over.
const answers = String(ask_for_the_objects_at(objects, [...alive, ...dropped].map(x => x.address).join(" "), alive.length)).split(" ");
// A WeakRef is cleared by the collection that finds the object dead.
const wasFoundDead = x => x.weak.deref() === undefined;
const isMarkedAllTheSame = x => precise && wasFoundDead(x) && jscInternals.isLiveCellAtRawAddress(x.address);
console.log(JSON.stringify({
  precise,
  alive: answers.slice(0, alive.length).join(" "),
  foundDead: dropped.some(wasFoundDead) && without.some(wasFoundDead),
  givenOut: dropped.filter((x, index) => wasFoundDead(x) && answers[alive.length + index] !== "nothing").length,
  broughtBack: dropped.filter(isMarkedAllTheSame).length,
  freed: without.filter(isMarkedAllTheSame).length,
}));
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(
    '{"precise":true,"alive":"itself itself","foundDead":true,"givenOut":0,"broughtBack":0,"freed":0}\n',
  );
  expect(exitCode).toBe(0);
}, 180_000);
