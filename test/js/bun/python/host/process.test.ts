// The process, workers, output, the end of the program.
import { expect } from "bun:test";
import { lines, program, script } from "./helpers";

const group = program();

group(
  "workers and messages",
  {
    files: {
      "worker.js": `self.onmessage = e => { postMessage({ echo: e.data, type: typeof e.data, isArray: Array.isArray(e.data) }); };`,
      "pyworker.py": `
import js
def on_message(event):
    js.postMessage(["a worker in Python got", event.data, __name__])
js.self.onmessage = on_message
`,
      "awaits.py": `
import js
await js.Promise.resolve(1)
js.postMessage("awaited")
`,
    },
    setup: `
import js, asyncio, os
here = os.path.dirname(os.path.abspath(__file__))
worker = js.Worker(os.path.join(here, "worker.js"))
queue = asyncio.Queue()
worker.onmessage = lambda event: queue.put_nowait(event.data)
async def echo(value):
    worker.postMessage(value)
    r = await queue.get()
    return r.echo, r.type, r.isArray
`,
    teardown: "worker.terminate()\n",
  },
  [
    [
      "[await echo(v) for v in (1, 's', 2.0, True, None, 2**64)]",
      "[(1, 'number', False), ('s', 'string', False), (2, 'number', False), (True, 'boolean', False), (None, 'undefined', False), (18446744073709551616, 'bigint', False)]",
    ],
    ["await echo([1, 'a', None, 2.5, [True]])", "([1, 'a', None, 2.5, [True]], 'object', True)"],
    ["r = await echo(js.Map([[1, js.Uint8Array(b'ab')]]))\nbytes(r[0].get(1))", "b'ab'"],
    ["dict((await echo({'a': 1}))[0])", "{'a': 1}", "DataCloneError: a dict cannot be sent"],
    ["(await echo((1, 2)))[0]", "[1, 2]"],
    ["(await echo([1.0]))[0]", "[1]"],
    ["bytes((await echo(b'ab'))[0])", "b'ab'"],
    ["worker.postMessage(print)", "!JSError: DataCloneError: The object can not be cloned."],
    [
      "w = js.Worker(os.path.join(here, 'pyworker.py'))\nf = asyncio.get_running_loop().create_future()\nw.onmessage = lambda event: f.set_result(event.data)\nw.postMessage([1, 2])\nr = await f\nw.terminate()\nr",
      "['a worker in Python got', [1, 2], 'pyworker']",
    ],
    [
      "w = js.Worker(os.path.join(here, 'awaits.py'))\nf = asyncio.get_running_loop().create_future()\nw.onmessage = lambda event: f.set_result(event.data)\nw.onerror = lambda event: f.set_result(event.message.strip().split('\\n')[-1])\nclosed = asyncio.get_running_loop().create_future()\nw.addEventListener('close', lambda event: closed.set_result(None))\nr = await f\nawait closed\nr",
      "'awaited'",
      "SyntaxError: the file of a worker is imported as a module, and only the main module may await at the top level",
    ],
    [
      "from node.worker_threads import isMainThread, MessageChannel\nc = MessageChannel()\nf = asyncio.get_running_loop().create_future()\nc.port2.on('message', lambda m: f.set_result(m))\nc.port1.postMessage([1, 'x'])\nr = await f\nc.port1.close()\nisMainThread, r",
      "(True, [1, 'x'])",
    ],
  ],
);

script(
  "output of both languages comes out in order",
  {
    "main.py": `
import js, sys
class K: pass
js.process.stdout.write("process.stdout\\n")
print("print")
js.console.log("console.log")
sys.stdout.write("sys.stdout\\n")
js.console.log("values:", {"a": 1}, [1, (2,)], None, True, 1.0, 1.5, b"x", K, len, "s")
js.console.log("%s and %d and %o", "s", 5, {"k": 1})
print("no newline", end="")
js.console.log(" then console.log")
js.console.error("console.error")
print("stderr of Python", file=sys.stderr)
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stdout).toBe(
      lines(
        "process.stdout",
        "print",
        "console.log",
        "sys.stdout",
        "values: {'a': 1} [ 1, (2,) ] undefined true 1 1.5 b'x' <class '__main__.K'> <built-in function len> s",
        "s and 5 and {'k': 1}",
        "no newline then console.log",
      ),
    );
    expect(stderr).toBe(lines("console.error", "stderr of Python"));
    expect(exitCode).toBe(0);
  },
);

// The threads and the atexit handlers of Python, then the "exit" event, then the end of the interpreter, which flushes.
script(
  "the handlers of both languages run when the program ends",
  {
    "main.py": `
import js, atexit
js.process.on("exit", lambda code: print("process.on('exit')", code))
js.process.on("beforeExit", lambda code: print("beforeExit", code))
atexit.register(lambda: print("atexit"))
js.process.exitCode = 7
print("end of the module")
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stderr).toBe("");
    expect(stdout).toBe(lines("end of the module", "beforeExit 7", "atexit", "process.on('exit') 7"));
    expect(exitCode).toBe(7);
  },
);

const handlers = `
import js, sys, atexit
atexit.register(lambda: print("atexit"))
js.process.on("exit", lambda code: print("exit", code, flush=True))
`;
script("sys.exit()", { "main.py": handlers + "sys.exit(3)\n" }, ({ stdout, exitCode }) => {
  expect(stdout).toBe(lines("atexit", "exit 3"));
  expect(exitCode).toBe(3);
});
script("process.exit()", { "main.py": handlers + "js.process.exit(4)\n" }, ({ stdout, exitCode }) => {
  expect(stdout).toBe(lines("atexit", "exit 4"));
  expect(exitCode).toBe(4);
});
script(
  "sys.exit() in a callback",
  {
    "main.py": `
import js, sys
js.setTimeout(lambda: sys.exit(5), 1)
js.setTimeout(lambda: print("not reached"), 200)
`,
  },
  ({ stdout, exitCode }) => {
    expect(stdout).toBe("");
    expect(exitCode).toBe(5);
  },
);

script(
  "signals reach the handlers of JavaScript and of Python",
  {
    "main.py": `
import js, asyncio, os, signal
loop = asyncio.get_running_loop()
f = loop.create_future()
js.process.on("SIGUSR2", lambda *a: f.set_result(a))
os.kill(os.getpid(), signal.SIGUSR2)
print(await asyncio.wait_for(f, 5))
g = loop.create_future()
signal.signal(signal.SIGUSR1, lambda number, frame: g.set_result(number))
js.process.kill(js.process.pid, "SIGUSR1")
print(await asyncio.wait_for(g, 5) == signal.SIGUSR1)
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stderr).toBe("");
    expect(stdout).toBe(lines("('SIGUSR2', 12)", "True"));
    expect(exitCode).toBe(0);
  },
);

script(
  "what keeps Bun's event loop alive keeps the program alive",
  {
    "main.py": `
import js
js.setTimeout(lambda: print("a timer, after the module has ended"), 20)
js.setTimeout(lambda: print("never"), 60000).unref()
print("end of the module")
`,
  },
  ({ stdout, exitCode }) => {
    expect(stdout).toBe(lines("end of the module", "a timer, after the module has ended"));
    expect(exitCode).toBe(0);
  },
);

script(
  "the collector sees through both languages",
  {
    "main.py": `
import js, gc, asyncio, weakref
class K:
    def __del__(self): print("__del__")
async def collect(until):
    for _ in range(200):
        gc.collect()
        js.Bun.gc(True)
        await asyncio.sleep(0.001)
        if until(): return
o = K()
ref = js.WeakRef(o)
print(ref.deref() is o)
held = []
registry = js.FinalizationRegistry(lambda value: held.append(value))
registry.register(o, "held value")
del o
await collect(lambda: held)
print(ref.deref(), held)
# A cycle through both: an object of Python in an object of JavaScript that the first refers to.
a = K()
w = weakref.ref(a)
a.js = js.Object()
a.js.py = a
del a
await collect(lambda: w() is None)
print(w())
# What JavaScript holds stays.
b = K()
js.keep = js.Map([["b", b]])
w = weakref.ref(b)
del b
gc.collect()
js.Bun.gc(True)
print(w() is js.keep.get("b"))
js.keep.clear()
await collect(lambda: w() is None)
print(w())
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stderr).toBe("");
    expect(stdout).toBe(lines("True", "__del__", "None ['held value']", "__del__", "None", "True", "__del__", "None"));
    expect(exitCode).toBe(0);
  },
);

script(
  "JavaScript belongs to the main thread",
  {
    "main.py": `
import js, threading
o = js.Object()
o.a = 1
f = js.eval("x => x + 1")
shared = js.eval("[1, 2]")
results = []
def work():
    for attempt in (lambda: js.Math.max(1, 2), lambda: o.a, lambda: f(1), lambda: len(o), lambda: str(o), lambda: shared[0], lambda: shared.append(3), lambda: o == o):
        try:
            results.append(attempt())
        except RuntimeError as e:
            results.append(str(e))
thread = threading.Thread(target=work)
thread.start()
thread.join()
for r in results: print(r)
print(shared, f(1))
`,
  },
  ({ stdout, stderr, exitCode }) => {
    const refused = "JavaScript can only be used from the main thread";
    expect(stderr).toBe("");
    expect(stdout).toBe(lines(refused, refused, refused, refused, refused, "1", "None", "True", "[1, 2, 3] 2"));
    expect(exitCode).toBe(0);
  },
);

script(
  "recursion through both languages ends in RecursionError",
  {
    "main.py": `
import js
bounce = js.eval("(f, n) => f(n + 1)")
deepest = 0
def ping(n):
    global deepest
    deepest = n
    return bounce(ping, n)
try:
    ping(0)
except RecursionError as e:
    print(type(e).__name__, deepest > 100)
down = js.eval("(function down(f, n) { try { return down(f, n + 1); } catch (e) { return f(n); } })")
print(down(lambda n: n > 100, 0))
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stderr).toBe("");
    expect(stdout).toBe(lines("RecursionError True", "True"));
    expect(exitCode).toBe(0);
  },
);

script(
  "process.on('uncaughtException') and process.on('unhandledRejection') take functions of Python",
  {
    "main.py": `
import js, asyncio
events = []
done = asyncio.get_running_loop().create_future()
def note(*event):
    events.append(event)
    if len(events) == 3: done.set_result(None)
js.process.on("uncaughtException", lambda e, origin: note("uncaughtException", type(e).__name__, str(e), origin))
js.process.on("unhandledRejection", lambda reason, promise: note("unhandledRejection", type(reason).__name__, str(reason)))
def callback(): raise ValueError("in a timer")
js.setTimeout(callback, 1)
js.setTimeout(js.eval("() => { throw new RangeError('of JavaScript, in a timer'); }"), 1)
async def bad(): raise KeyError("rejected")
js.eval("f => { f(); }")(bad)
await done
for event in sorted(events): print(*event)
print("went on")
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stderr).toBe("");
    expect(stdout).toBe(
      lines(
        "uncaughtException JSObject RangeError: of JavaScript, in a timer uncaughtException",
        "uncaughtException ValueError in a timer uncaughtException",
        "unhandledRejection KeyError 'rejected'",
        "went on",
      ),
    );
    expect(exitCode).toBe(0);
  },
);

script(
  "sys.excepthook is told of what a callback raises with nobody to catch it",
  {
    "main.py": `
import js, sys
sys.excepthook = lambda type, value, traceback: print("excepthook", type.__name__, value)
def callback(): raise ValueError("in a timer")
js.setTimeout(callback, 1)
`,
  },
  ({ stdout }) => {
    expect(stdout).toBe(lines("excepthook ValueError in a timer"));
  },
);
