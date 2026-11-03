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
