import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";

// These builds take a quarter of a minute to import asyncio.
if (isDebug || isASAN) setDefaultTimeout(180_000);

async function run(files: Record<string, string>, ...args: string[]) {
  using dir = tempDir("python-event-loop", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), Object.keys(files)[0], ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

const lines = (...all: string[]) => all.map(line => line + "\n").join("");

test.concurrent("a module awaits at the top level, on Bun's event loop", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import asyncio, js, time
t = time.monotonic()
await asyncio.sleep(0.05)
print("slept", time.monotonic() - t >= 0.05)

async def work(n):
    await asyncio.sleep(0.01 * n)
    return n * 2
print(await asyncio.gather(work(3), work(1), work(2)))

p = js.Promise.resolve(41)
print(type(p).__name__, await p)
print(await js.Promise.new(lambda resolve, reject: js.setTimeout(lambda: resolve("from a JS timer"), 20)))
try:
    await js.Promise.reject(js.Error.new("boom"))
except Exception as e:
    print(type(e).__name__, e)
try:
    await js.Promise.reject(ValueError("a Python exception"))
except ValueError as e:
    print("ValueError", e)
print(asyncio.current_task() is not None, type(asyncio.get_running_loop()).__name__)
try:
    async with asyncio.timeout(0.02):
        await asyncio.sleep(10)
except TimeoutError:
    print("timed out")
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(
    lines(
      "slept True",
      "[6, 2, 4]",
      "JSPromise 41",
      "from a JS timer",
      "JSError Error: boom",
      "ValueError a Python exception",
      "True BunEventLoop",
      "timed out",
    ),
  );
  expect(exitCode).toBe(0);
});

test.concurrent("what a module that awaits raises ends the program as it does in any other", async () => {
  const files = {
    "main.py": `
import asyncio, sys
await asyncio.sleep(0)
print("awake")
if sys.argv[1] == "exit":
    sys.exit(3)
raise ValueError("not caught")
`,
  };
  const exits = await run(files, "exit");
  expect(exits).toEqual({ stdout: "awake\n", stderr: "", exitCode: 3, signalCode: null });
  const raises = await run(files, "raise");
  expect(raises.stdout).toBe("awake\n");
  expect(raises.stderr).toEndWith("ValueError: not caught\n");
  expect(raises.exitCode).toBe(1);
});

test.skipIf(isWindows).concurrent("while Python waits, Bun's event loop turns", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import asyncio, js, os, select, time
ticks = []
interval = js.setInterval(lambda: ticks.append(1), 5)
async def main():
    # Only timers of JS end these loops.
    while len(ticks) < 4:
        await asyncio.sleep(0.01)
    value = await js.Promise.new(lambda resolve, reject: js.setTimeout(lambda: resolve("a JS timer inside asyncio.run()"), 10))
    return value, type(asyncio.get_running_loop()).__name__
print(asyncio.run(main()))

ticks.clear()
t = time.monotonic()
print(select.select([], [], [], 0.06), time.monotonic() - t >= 0.06)
while len(ticks) < 4:
    select.select([], [], [], 0.01)

r, w = os.pipe()
poll = select.poll()
poll.register(r, select.POLLIN)
js.setTimeout(lambda: os.write(w, b"x"), 20)
print(poll.poll(60000) == [(r, select.POLLIN)], os.read(r, 10))
js.clearInterval(interval)
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(
    lines("('a JS timer inside asyncio.run()', '_UnixSelectorEventLoop')", "([], [], []) True", "True b'x'"),
  );
  expect(exitCode).toBe(0);
});

test.concurrent("JavaScript awaits coroutines and iterates over async generators", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.js": `
      import { add, quick, fails, count, uses_js, Awaitable, closed } from "./coroutines.py";
      console.log(await add(1, 2), await quick());
      try { await fails(); } catch (e) { console.log(e.name, String(e)); }
      const seen = [];
      for await (const i of count(4)) seen.push(i);
      console.log(seen.join());
      for await (const i of count(10)) { if (i == 2) break; }
      console.log(closed.join());
      console.log(await uses_js(new Promise(resolve => setTimeout(() => resolve("a JS value"), 5))));
      console.log(await new Awaitable());
      console.log(await Promise.all([add(1, 1), add(2, 2), add(3, 3)]));
    `,
    "coroutines.py": `
import asyncio
closed = []
async def add(a, b):
    await asyncio.sleep(0.01)
    return a + b
async def quick():
    return "no suspension"
async def fails():
    await asyncio.sleep(0)
    raise ValueError("from a coroutine")
async def count(n):
    try:
        for i in range(n):
            await asyncio.sleep(0.001)
            yield i
    finally:
        closed.append(n)
async def uses_js(promise):
    return "Python got " + await promise
class Awaitable:
    def __await__(self):
        yield from asyncio.sleep(0.001).__await__()
        return "any awaitable"
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(
    lines(
      "3 no suspension",
      "ValueError ValueError: from a coroutine",
      "0,1,2,3",
      "4,10",
      "Python got a JS value",
      "any awaitable",
      "[ 2, 4, 6 ]",
    ),
  );
  expect(exitCode).toBe(0);
});

test
  .skipIf(isWindows)
  .concurrent("signal handlers and finalizers run while the process idles in the event loop", async () => {
    const files = {
      "main.py": `
import js, os, signal, sys
mode = sys.argv[1]
if mode == "handler":
    signal.signal(signal.SIGUSR1, lambda *a: (print("the handler ran"), js.clearTimeout(timeout)))
    timeout = js.setTimeout(lambda: print("not reached"), 600000)
    signal.signal(signal.SIGALRM, lambda *a: os.kill(os.getpid(), signal.SIGUSR1))
    signal.setitimer(signal.ITIMER_REAL, 0.03)
elif mode == "interrupt":
    js.setTimeout(lambda: print("not reached"), 600000)
    signal.signal(signal.SIGALRM, lambda *a: os.kill(os.getpid(), signal.SIGINT))
    signal.setitimer(signal.ITIMER_REAL, 0.03)
elif mode == "exit":
    js.setTimeout(lambda: sys.exit(4), 10)
    js.setTimeout(lambda: print("not reached"), 600000)
elif mode == "finalizer":
    class A:
        def __del__(self):
            print("finalized")
            js.clearInterval(interval)
    A()
    junk = []
    def churn():
        junk.clear()
        junk.extend([i] * 1000 for i in range(400))
    interval = js.setInterval(churn, 1)
print("the module is over")
`,
    };
    expect(await run(files, "handler")).toEqual({
      stdout: lines("the module is over", "the handler ran"),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    const interrupted = await run(files, "interrupt");
    expect(interrupted.stdout).toBe("the module is over\n");
    expect(interrupted.stderr).toEndWith("KeyboardInterrupt\n");
    expect(interrupted.signalCode).toBe("SIGINT");
    expect(await run(files, "exit")).toEqual({
      stdout: "the module is over\n",
      stderr: "",
      exitCode: 4,
      signalCode: null,
    });
    expect(await run(files, "finalizer")).toEqual({
      stdout: lines("the module is over", "finalized"),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

test.skipIf(isWindows).concurrent("a signal interrupts a wait", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import asyncio, os, select, signal
async def main():
    asyncio.get_running_loop().call_later(0.05, os.kill, os.getpid(), signal.SIGINT)
    try:
        await asyncio.sleep(600)
    except asyncio.CancelledError:
        print("cancelled")
        raise
try:
    asyncio.run(main())
except KeyboardInterrupt:
    print("KeyboardInterrupt")

signal.signal(signal.SIGALRM, lambda *a: print("the handler ran"))
signal.setitimer(signal.ITIMER_REAL, 0.03)
print(select.select([], [], [], 0.2))
signal.signal(signal.SIGALRM, lambda *a: 1 / 0)
signal.setitimer(signal.ITIMER_REAL, 0.03)
try:
    select.select([], [], [], 600)
except ZeroDivisionError:
    print("raised in the wait")
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(lines("cancelled", "KeyboardInterrupt", "the handler ran", "([], [], [])", "raised in the wait"));
  expect(exitCode).toBe(0);
});

test.concurrent("an async function of Python is an async function to Bun's APIs", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import js
from bun import serve

async def handler(request, server):
    body = await request.text() if request.method == "POST" else ""
    return js.Response.json({"path": js.URL.new(request.url).pathname, "method": request.method, "body": body,
                             "header": request.headers.get("x-test"), "list": [1, 2.5, "x", None, True]})

server = serve(port=0, fetch=handler)
base = f"http://localhost:{server.port}"
response = await js.fetch(base + "/hello")
print(response.status, await response.text())
response = await js.fetch(base + "/post", method="POST", body="from Python", headers={"x-test": "a dict of headers"})
data = await response.json()
print(type(data).__name__, data.method, data.body, data.header, data.list, type(data.list).__name__)
server.stop()
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(
    lines(
      `200 {"path":"/hello","method":"GET","body":"","header":null,"list":[1,2.5,"x",null,true]}`,
      "JSPlainObject POST from Python a dict of headers [1, 2.5, 'x', None, True] list",
    ),
  );
  expect(exitCode).toBe(0);
});

test.concurrent("tasks and futures are the native ones, which resume a coroutine outside any handler", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import asyncio, sys, js, _asyncio
print(asyncio.Task is _asyncio.Task, asyncio.Future is _asyncio.Future, type(asyncio.current_task()) is _asyncio.Task)
try:
    await js.Promise.reject(ValueError("awaited"))
except ValueError as e:
    print(repr(e), e.__context__)
print(sys.exception())
try:
    1 / 0
except ZeroDivisionError as e:
    print(e.__context__)
`,
  });
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: lines("True True True", "ValueError('awaited') None", "None", "None"),
    stderr: "",
    exitCode: 0,
  });
});

test.skipIf(isWindows).concurrent("tasks on Bun's loop go on while a task of another loop waits", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import asyncio, os, select, _bun_asyncio
done = []
async def background():
    done.append(asyncio.current_task().get_name())
    await asyncio.sleep(0.01)
    done.append(type(asyncio.get_running_loop()).__name__)
_bun_asyncio.loop().create_task(background(), name="background")
async def main():
    me = asyncio.current_task()
    r, w = os.pipe()
    while len(done) < 2:
        select.select([r], [], [], 0.01)
    return asyncio.current_task() is me, type(asyncio.get_running_loop()).__name__
print(asyncio.run(main()), done)
`,
  });
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: lines("(True, '_UnixSelectorEventLoop') ['background', 'BunEventLoop']"),
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("a promise is to asyncio what a coroutine object is", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import asyncio, collections.abc, inspect, js

def later(value, fails=False):
    return js.Promise.new(lambda resolve, reject: js.setTimeout(lambda: (reject if fails else resolve)(value), 1))

never = js.Promise.new(lambda resolve, reject: None)
rejected = js.Promise.reject(js.Error("at once"))
print(asyncio.iscoroutine(rejected), asyncio.isfuture(rejected), inspect.isawaitable(rejected), isinstance(rejected, collections.abc.Coroutine))
# Nothing here counts as a rejection that nobody handled.
print(await asyncio.gather(rejected, later(js.Error("later"), True), later(1), return_exceptions=True))

task = asyncio.ensure_future(never)
print(type(task).__name__, task.get_loop() is asyncio.get_running_loop())
await asyncio.sleep(0)
print(task.cancel())
try:
    await task
except asyncio.CancelledError:
    print("the waiting is cancelled", task.cancelled())
try:
    await asyncio.wait_for(asyncio.gather(never, never), 0.001)
except TimeoutError:
    print("TimeoutError")

try:
    await asyncio.wait([later(2)])
except TypeError as error:
    print(error)
done, waiting = await asyncio.wait([asyncio.create_task(later(2)), asyncio.ensure_future(later(js.RangeError("no"), True))])
print(sorted(str(task.exception() or task.result()) for task in done), len(waiting))
print(await asyncio.shield(later(3)), [await first for first in asyncio.as_completed([later(4)])])
print(await asyncio.wait_for(later(5), 10))

# By hand, as a task drives a coroutine.
promise = later(6)
future = promise.send(None)
print(asyncio.isfuture(future))
future._asyncio_future_blocking = False
await future
try:
    promise.send(None)
except StopIteration as stop:
    print(stop.value)
promise.close()
later(7).close()
try:
    later(8).throw(KeyError("thrown in"))
except KeyError as error:
    print(error)

async def coroutine():
    await asyncio.sleep(3600)
promise = js.Function("f", "return f()")(coroutine)
task = asyncio.ensure_future(promise)
await asyncio.sleep(0)
print(type(promise).__name__, task.cancel())
try:
    await promise
except asyncio.CancelledError:
    print("the coroutine is cancelled")
print(asyncio.get_running_loop().is_running())
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(
    lines(
      "True False True True",
      "[JSError('Error: at once'), JSError('Error: later'), 1]",
      "Task True",
      "True",
      "the waiting is cancelled True",
      "TimeoutError",
      "Passing coroutines is forbidden, use tasks explicitly.",
      "['2', 'RangeError: no'] 0",
      "3 [4]",
      "5",
      "True",
      "6",
      "'thrown in'",
      "JSPromise True",
      "the coroutine is cancelled",
      "True",
    ),
  );
  expect(exitCode).toBe(0);
});

test.concurrent("a loop that the program runs itself takes a promise", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.py": `
import asyncio, js

def later(value):
    return js.Promise.new(lambda resolve, reject: js.setTimeout(lambda: resolve(value), 1))

print(asyncio.run(later("run")))
loop = asyncio.new_event_loop()
print(loop.run_until_complete(later("run_until_complete")))
print(loop.run_until_complete(loop.create_task(later("create_task"))))
loop.close()
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(lines("run", "run_until_complete", "create_task"));
  expect(exitCode).toBe(0);
});

// The record asks for the name of the current task, and so for the running loop.
test.concurrent("what the making of Bun's loop logs is logged once", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.ts": `
import { kwargs } from "bun:python";
import asyncio from "python:asyncio";
import io from "python:io";
import logging from "python:logging";
const stream = io.StringIO();
logging.basicConfig(kwargs({ stream, level: logging.DEBUG, format: "%(taskName)s %(message)s" }));
const loop = asyncio.get_event_loop();
console.log(stream.getvalue().trim().replace(/: .*/, ""));
console.log(asyncio.get_event_loop() === loop);
`,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe(lines("None Using selector", "true"));
  expect(exitCode).toBe(0);
});
