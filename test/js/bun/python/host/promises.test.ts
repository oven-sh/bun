// Promises and asyncio, timers, events, cancellation.
import { expect } from "bun:test";
import { lines, program, run, script } from "./helpers";

const group = program();

const setup = `
import js, asyncio
delay = js.eval("(ms, v) => new Promise(r => setTimeout(() => r(v), ms))")
never = js.eval("() => new Promise(() => {})")
fail = js.eval("(ms, m) => new Promise((_, r) => setTimeout(() => r(new RangeError(m)), ms))")
async def co(x):
    await asyncio.sleep(0.001)
    return x * 2
async def bad():
    raise KeyError("k")
loop = asyncio.get_running_loop()
async def until(condition):
    for _ in range(5000):
        if condition(): return
        await asyncio.sleep(0.001)
    raise TimeoutError("the condition never held")
`;

group("Python awaits promises", { setup }, [
  ["p = delay(1, 7)\ntype(p).__name__, await p, await p", "('JSPromise', 7, 7)"],
  ["await asyncio.gather(delay(5, 1), delay(1, 2), asyncio.sleep(0.001, 3), co(2))", "[1, 2, 3, 4]"],
  ["await asyncio.gather(delay(1, 1), fail(50, 'x'), return_exceptions=True)", "[1, JSError('RangeError: x')]"],
  ["await asyncio.wait_for(delay(1, 1), 5)", "1"],
  ["await asyncio.wait_for(never(), 0.01)", "!TimeoutError: "],
  ["await fail(1, 'bad')", "!JSError: RangeError: bad"],
  [
    "try:\n    await fail(1, 'bad')\nexcept Exception as e:\n    r = e.value.name, e.value.message, isinstance(e.value, js.RangeError), isinstance(e.value, js.Error), e.args\nr",
    "('RangeError', 'bad', True, True, ('RangeError: bad',))",
  ],
  ["await js.Promise.reject('a string')", "!JSError: a string"],
  ["await js.Promise.reject(ValueError('of Python'))", "!ValueError: of Python"],
  [
    "await delay(1, 7).then(lambda v: v + 1), await delay(1, 7).then(co), await delay(1, 7).then(lambda v: 1 / 0).catch(lambda e: type(e).__name__)",
    "(8, 14, 'ZeroDivisionError')",
  ],
  ["seen = []\nawait getattr(delay(1, 7), 'finally')(lambda: seen.append(1)), seen", "(7, [1])"],
  [
    "t = asyncio.ensure_future(never())\nawait asyncio.sleep(0)\nt.cancel()\nawait asyncio.wait_for(t, 1)",
    "!CancelledError: ",
  ],
  [
    "done, pending = await asyncio.wait([asyncio.ensure_future(delay(1, 'a')), asyncio.ensure_future(never())], return_when=asyncio.FIRST_COMPLETED)\n[t.cancel() for t in pending]\n[t.result() for t in done], len(pending)",
    "(['a'], 1)",
  ],
  ["[await f for f in asyncio.as_completed([delay(20, 'slow'), delay(1, 'fast')])]", "['fast', 'slow']"],
  ["async with asyncio.timeout(0.01):\n    await never()\n0", "!TimeoutError: "],
  [
    "f = loop.create_future()\njs.setTimeout(lambda: f.set_result('set by a timer of JavaScript'), 1)\nawait f",
    "'set by a timer of JavaScript'",
  ],
  [
    "await js.eval('(async () => 5)()'), await js.Promise.resolve(js.Promise.resolve(6)), await js.eval('({ then(r) { r(7); } })')",
    "(5, 6, 7)",
    "an object with then() that is no promise cannot be awaited",
  ],
  ["async with asyncio.TaskGroup() as g:\n    t = g.create_task(delay(1, 2))\nt.result()", "2"],
  ["await asyncio.create_task(delay(1, 2))", "2"],
]);

group("JavaScript awaits coroutines, tasks and futures", { setup }, [
  ["await js.Promise.all([delay(1, 1), 2, asyncio.sleep(0, 3), co(2)])", "[1, 2, 3, 4]"],
  ["await js.Promise.race([co(1), never()]), await js.Promise.any([bad(), co(2)])", "(2, 4)"],
  [
    "[(r.status, getattr(r, 'value', None), type(getattr(r, 'reason', None)).__name__) for r in await js.Promise.allSettled([co(1), bad(), fail(1, 'r')])]",
    "[('fulfilled', 2, 'NoneType'), ('rejected', None, 'KeyError'), ('rejected', None, 'JSObject')]",
  ],
  [
    "await js.Promise.resolve(co(4)), await js.eval('async f => (await f(3)) + 1')(co), await js.eval('async c => (await c) + 1')(co(3))",
    "(8, 7, 7)",
  ],
  [
    "await js.eval('async f => { try { await f(); } catch (e) { return [e.name, e.message, e instanceof Error]; } }')(bad)",
    `['KeyError', "'k'", True]`,
  ],
  ["await js.eval('async f => { await f(); }')(bad)", "!KeyError: 'k'"],
  ["t = asyncio.create_task(co(1))\nawait js.Promise.resolve(t), await js.eval('async t => await t')(t)", "(2, 2)"],
  [
    "f = loop.create_future()\nloop.call_later(0.001, f.set_result, 'later')\nawait js.eval('async f => await f')(f)",
    "'later'",
  ],
  [
    "c = asyncio.sleep(0)\nr = js.eval('f => f(1) instanceof Promise')(co), js.eval('c => typeof c.then')(c)\nawait c\nr",
    "(True, 'function')",
  ],
  [
    "async def agen():\n    yield 'a'\n    await asyncio.sleep(0.001)\n    yield 'b'\nawait js.Array.fromAsync(agen()), await js.eval('async g => { const out = []; for await (const x of g) out.push(x); return out; }')(agen())",
    "(['a', 'b'], ['a', 'b'])",
  ],
  ["await js.Array.fromAsync([co(1), delay(1, 5), 3])", "[2, 5, 3]"],
  [
    "from node.util import promisify, callbackify\ndef nodeback(a, cb): cb(None, a * 2)\nawait promisify(nodeback)(4)",
    "8",
  ],
  ["def failing(a, cb): cb(ValueError('no'))\nawait promisify(failing)(4)", "!ValueError: no"],
  ["out = loop.create_future()\ncallbackify(co)(1, lambda err, v: out.set_result((err, v)))\nawait out", "(None, 2)"],
]);

group("timers, events, abort signals", { setup }, [
  [
    "order = []\njs.setTimeout(lambda: order.append('t10'), 10)\nh = js.setTimeout(lambda: order.append('never'), 5)\njs.clearTimeout(h)\njs.setTimeout(lambda a, b: order.append((a, b)), 1, 'x', 'y')\njs.setImmediate(lambda: order.append('immediate'))\njs.queueMicrotask(lambda: order.append('micro'))\njs.process.nextTick(lambda *a: order.append(('tick', a)), 1)\nawait until(lambda: 't10' in order)\nsorted(order[:2], key=str), order[2:]",
    "([('tick', (1,)), 'micro'], ['immediate', ('x', 'y'), 't10'])",
  ],
  [
    "n = [0]\ndef tick():\n    n[0] += 1\n    if n[0] == 3: js.clearInterval(iv)\niv = js.setInterval(tick, 1)\nawait until(lambda: n[0] == 3)\nawait delay(5, 0)\nn",
    "[3]",
  ],
  [
    "from node.timers import promises as timers\nawait timers.setTimeout(1, 'value'), await js.Bun.sleep(1)",
    "('value', None)",
  ],
  [
    "t = js.EventTarget()\nseen = []\nt.addEventListener('go', lambda e: seen.append((e.type, getattr(e, 'detail', None))))\nt.dispatchEvent(js.Event('go')), t.dispatchEvent(js.CustomEvent('go', detail={'a': 1})), seen",
    "(True, True, [('go', None), ('go', {'a': 1})])",
  ],
  [
    "class L:\n    def handleEvent(self, e): seen.append('handleEvent')\nt.addEventListener('object', L())\nt.dispatchEvent(js.Event('object'))\nseen[-1]",
    "'handleEvent'",
  ],
  [
    "def once(e): seen.append('once')\nt.addEventListener('o', once, once=True)\nt.dispatchEvent(js.Event('o'))\nt.dispatchEvent(js.Event('o'))\nseen.count('once')",
    "1",
  ],
  [
    "def f(e): seen.append('removed')\nt.addEventListener('r', f)\nt.removeEventListener('r', f)\nt.dispatchEvent(js.Event('r'))\n'removed' in seen",
    "False",
  ],
  [
    "c = js.AbortController()\nwhat = []\nc.signal.addEventListener('abort', lambda e: what.append((c.signal.aborted, c.signal.reason.name)))\nc.abort()\nwhat",
    "[(True, 'AbortError')]",
  ],
  ["c = js.AbortController()\nc.abort(ValueError('why'))\nc.signal.reason", "ValueError('why')"],
  ["c.signal.throwIfAborted()", "!ValueError: why"],
  [
    "await js.eval(\"s => new Promise((_, r) => s.addEventListener('abort', () => r(s.reason)))\")(js.AbortSignal.timeout(2))",
    "!JSError: TimeoutError: The operation timed out.",
  ],
  [
    "await js.fetch('http://127.0.0.1:9/', signal=js.AbortSignal.abort())",
    "!JSError: AbortError: The operation was aborted.",
  ],
  [
    "aborted = []\nstarted = []\nasync def work(signal):\n    signal.addEventListener('abort', lambda e: aborted.append(True))\n    started.append(True)\n    await never()\nasync def cancellable():\n    c = js.AbortController()\n    try:\n        await work(c.signal)\n    except asyncio.CancelledError:\n        c.abort()\n        raise\nt = asyncio.create_task(cancellable())\nawait until(lambda: started)\nt.cancel()\nawait asyncio.gather(t, return_exceptions=True), aborted",
    "([CancelledError('')], [True])",
  ],
  [
    "from node.async_hooks import AsyncLocalStorage\nstore = AsyncLocalStorage()\nstore.run('s', lambda: store.getStore()), await store.run('s', js.eval('s => async () => { await 1; return s.getStore(); }')(store))",
    "('s', 's')",
  ],
  [
    "async def inner():\n    await asyncio.sleep(0.001)\n    return store.getStore()\nawait store.run('s', inner)",
    "'s'",
    "a coroutine does not run in the async context it was called in",
  ],
]);

group(
  "asyncio in what JavaScript calls",
  { setup: "import contextvars, threading, time\nfrom node.events import EventEmitter\n" },
  [
    // The loop that Bun runs counts as the running loop for whatever Bun's event loop or JavaScript calls.
    [
      "ran = loop.create_future()\nasync def task(): ran.set_result('ran')\ne = EventEmitter.new()\ne.on('x', lambda: asyncio.create_task(task()))\ne.emit('x')\nawait ran",
      "'ran'",
    ],
    // A timer, a reaction of a promise and the handlers of Bun.serve() call the function with nothing in between.
    [
      "f = loop.create_future()\ndef callback():\n    try:\n        f.set_result(asyncio.get_running_loop() is loop)\n    except RuntimeError as e:\n        f.set_result(str(e))\njs.setTimeout(callback, 1)\nawait f",
      "True",
    ],
    ["f = loop.create_future()\njs.Promise.resolve(1).then(lambda v: callback())\nawait f", "True"],
    [
      "from bun import serve\nf = loop.create_future()\ndef fetch(request):\n    callback()\n    return js.Response('x')\ns = serve(port=0, hostname='127.0.0.1', fetch=fetch)\nawait js.fetch(f'http://127.0.0.1:{s.port}/')\ns.stop(True)\nawait f",
      "True",
    ],
    [
      "v = contextvars.ContextVar('v', default='default')\nasync def sets():\n    v.set('in the task')\n    await delay(1, 0)\n    return v.get()\nawait sets(), await asyncio.create_task(sets())",
      "('in the task', 'in the task')",
    ],
    ["v.set('main')\nasync def reads(): return v.get()\nawait js.eval('async f => await f()')(reads)", "'main'"],
    [
      "f = loop.create_future()\njs.setTimeout(lambda: f.set_result(v.get()), 1)\nawait f, await delay(1, 0).then(lambda _: v.get())",
      "('main', 'main')",
      "a callback runs in an empty context, not in that of whoever handed it over, as loop.call_later() has it",
    ],
    [
      "async def inner(x): return (await delay(1, x)) + 1\nawait js.eval('async (f, x) => (await f(x)) * 2')(inner, 1), sum(await asyncio.gather(*[delay(i % 3, i) for i in range(500)])), sum(await js.Promise.all([inner(i) for i in range(200)]))",
      "(4, 124750, 20100)",
    ],
    [
      "closed = []\nasync def closing():\n    try:\n        yield 1\n        yield 2\n    finally:\n        closed.append(True)\nawait js.eval('async g => { for await (const x of g) return x; }')(closing()), closed",
      "(1, [True])",
    ],
    [
      "def mixed():\n    yield 1\n    yield delay(1, 2)\nawait js.eval('async g => { const out = []; for await (const x of g) out.push(x); return out; }')(mixed())",
      "[1, 2]",
    ],
    [
      "await loop.run_in_executor(None, lambda: 42), await asyncio.to_thread(time.sleep, 0), type(loop).__name__, loop.is_running()",
      "(42, None, 'BunEventLoop', True)",
    ],
    [
      "f = loop.create_future()\nthreading.Thread(target=lambda: loop.call_soon_threadsafe(f.set_result, 'from a thread')).start()\nawait f",
      "'from a thread'",
    ],
    [
      "p = await asyncio.create_subprocess_exec('echo', 'hi', stdout=asyncio.subprocess.PIPE)\n(await p.communicate())[0], p.returncode",
      "(b'hi\\n', 0)",
    ],
    [
      "q = asyncio.Queue()\njs.setTimeout(lambda: q.put_nowait('from a timer'), 1)\ne = asyncio.Event()\njs.queueMicrotask(e.set)\nawait q.get(), await e.wait()",
      "('from a timer', True)",
    ],
    [
      "s = asyncio.Semaphore(2)\nasync def limited(i):\n    async with s:\n        return await delay(1, i)\nawait asyncio.gather(*[limited(i) for i in range(5)]), await asyncio.shield(delay(1, 'shielded'))",
      "([0, 1, 2, 3, 4], 'shielded')",
    ],
    [
      "class Thenable:\n    def then(self, resolve, reject=None): resolve('a thenable of Python')\nclass Awaitable:\n    def __await__(self):\n        yield from asyncio.sleep(0).__await__()\n        return 'an awaitable of Python'\nawait js.Promise.resolve(Thenable()), await js.eval('async x => await x')(Awaitable())",
      "('a thenable of Python', 'an awaitable of Python')",
    ],
    [
      "c = inner(1)\nawait js.Promise.resolve(c), await js.Promise.resolve(c).catch(lambda e: str(e))",
      "(2, 'cannot reuse already awaited coroutine')",
    ],
    [
      "c = inner(1)\ntry:\n    asyncio.run(c)\nfinally:\n    c.close()\n0",
      "!RuntimeError: asyncio.run() cannot be called from a running event loop",
    ],
    [
      "js.Promise is js.Promise, js.Promise.resolve(1).constructor is js.Promise, js.Map is js.Map",
      "(True, True, True)",
    ],
  ],
);

script(
  "a promise that asyncio has taken on is not an unhandled rejection",
  {
    "main.py": `
import js, asyncio
print(await asyncio.gather(js.Promise.reject(js.Error("x")), return_exceptions=True))
try:
    await asyncio.wait_for(js.Promise.reject(js.Error("y")), 1)
except Exception as e:
    print(e)
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stdout).toBe(lines("[JSError('Error: x')]", "Error: y"));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
);

script(
  "what a callback raises with nobody to catch it ends the program, as in JavaScript",
  {
    "main.py": `
import js
def callback():
    js.setTimeout(lambda: print("not reached"), 1)
    raise ValueError("in a timer")
js.setTimeout(callback, 1)
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stdout).toBe("");
    expect(stderr).toContain("ValueError: in a timer");
    expect(exitCode).toBe(1);
  },
);

script(
  "a rejection that nobody handles is reported",
  {
    "main.py": `
import js
async def bad():
    raise ValueError("nobody awaits this")
js.eval("f => { f(); }")(bad)
js.setTimeout(lambda: print("went on"), 1)
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stdout).toBe(lines("went on"));
    expect(stderr).toContain("ValueError: nobody awaits this");
    expect(exitCode).toBe(1);
  },
);

script(
  "asyncio.run() and loops of the program's own await promises too",
  {
    "main.py": `
import js, asyncio
from bun import serve
delay = js.eval("(ms, v) => new Promise(r => setTimeout(() => r(v), ms))")
async def main():
    a = await delay(1, "a promise")
    b = await asyncio.gather(delay(2, 1), asyncio.sleep(0.001, 2))
    c = await (await js.fetch("data:text/plain,hello")).text()
    return a, b, c, type(asyncio.get_running_loop()).__name__
print(asyncio.run(main()))
loop = asyncio.new_event_loop()
print(loop.run_until_complete(delay(1, "run_until_complete")), loop.run_until_complete(main())[0])
loop.close()
with asyncio.Runner() as runner:
    print(runner.run(main())[1])
async def served():
    async def handler(request):
        await asyncio.sleep(0.001)
        return js.Response("a handler that awaits")
    server = serve(port=0, hostname="127.0.0.1", fetch=handler)
    try:
        return await (await js.fetch(f"http://127.0.0.1:{server.port}/")).text()
    finally:
        server.stop(True)
print(asyncio.run(served()))
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stderr).toBe("");
    expect(stdout).toBe(
      lines(
        "('a promise', [1, 2], 'hello', '_UnixSelectorEventLoop')",
        "run_until_complete a promise",
        "[1, 2]",
        "a handler that awaits",
      ),
    );
    expect(exitCode).toBe(0);
  },
);

script(
  "a coroutine that JavaScript starts runs although the module ends at once",
  {
    "main.py": `
import js
async def work():
    print("ran")
js.eval("f => { f(); }")(work)
print("end of the module")
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stdout).toBe(lines("end of the module", "ran"));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
);

script(
  "what a program that awaits nothing has queued runs when it ends",
  {
    "main.py": `
import js
js.queueMicrotask(lambda: print("microtask"))
js.Promise.resolve(1).then(lambda value: print("reaction"))
js.process.nextTick(lambda: print("tick"))
print("end of the module")
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stdout).toBe(lines("end of the module", "tick", "microtask", "reaction"));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
);

script(
  "no loop is running for what a program does itself, and Bun's is for what Bun calls meanwhile",
  {
    "main.py": `
import asyncio, js, select, threading
def running():
    try:
        return type(asyncio.get_running_loop()).__name__
    except RuntimeError as error:
        return str(error)
print("the program:", running())
print("called by JavaScript:", js.eval("f => f()")(running))
js.setTimeout(lambda: print("a timer during a wait:", running()), 1)
select.select([], [], [], 0.05)
print("the program again:", running())
thread = threading.Thread(target=lambda: print("a thread:", running()))
thread.start()
thread.join()
async def main():
    return running()
print("asyncio.run():", asyncio.run(main()))
js.setTimeout(lambda: print("a timer afterwards:", running()), 1)
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stdout).toBe(
      lines(
        "the program: no running event loop",
        "called by JavaScript: BunEventLoop",
        "a timer during a wait: BunEventLoop",
        "the program again: no running event loop",
        "a thread: no running event loop",
        "asyncio.run(): _UnixSelectorEventLoop",
        "a timer afterwards: BunEventLoop",
      ),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
);

// `for await` tells the iterator when it is left before the end, and what is written in JavaScript counts on it.
script(
  "`async for` over an object of JavaScript that is left early closes the iterator",
  {
    "main.py": `
import asyncio, js
from node.timers import promises as timers

make = js.eval("""log => ({
  [Symbol.asyncIterator]() {
    let i = 0;
    return {
      next() { return Promise.resolve({ value: i++, done: i > 5 }); },
      async return() { log.push("return"); await 0; log.push("returned"); return { done: true }; },
    };
  },
})""")
never = js.eval("""log => ({
  [Symbol.asyncIterator]() {
    return { next() { return new Promise(() => {}); }, return() { log.push("return"); return {}; } };
  },
})""")

async def by_break(log):
    async for x in make(log):
        if x == 1: break
    log.append("after")

async def by_return(log):
    async for x in make(log):
        async for y in make(log):
            return "value"

async def by_exception(log):
    try:
        async for x in make(log):
            raise ValueError("in the body")
    except ValueError as error:
        log.append(str(error))

async def to_the_end(log):
    async for x in make(log): pass
    else: log.append("else")

async def comprehension(log):
    try:
        [1 / (1 - x) async for x in make(log)]
    except ZeroDivisionError:
        log.append("caught")

async def iterator_of_the_program(log):
    iterator = aiter(make(log))
    async for x in iterator: break
    log.append(await anext(iterator))
    await iterator.aclose()

async def cancelled(log):
    async def loop():
        async for x in never(log): pass
    task = asyncio.create_task(loop())
    await asyncio.sleep(0.001)
    task.cancel()
    try: await task
    except asyncio.CancelledError: log.append("cancelled")

async def closed(log):
    async def loop():
        async for x in never(log): pass
    coroutine = loop()
    coroutine.send(None)
    coroutine.close()

for function in [by_break, by_return, by_exception, to_the_end, comprehension, iterator_of_the_program, cancelled, closed]:
    log = []
    print(function.__name__, await function(log), log)

# The timer would keep the process alive.
async for _ in timers.setInterval(1): break
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stdout).toBe(
      lines(
        "by_break None ['return', 'returned', 'after']",
        "by_return value ['return', 'returned', 'return', 'returned']",
        "by_exception None ['return', 'returned', 'in the body']",
        "to_the_end None ['else']",
        "comprehension None ['return', 'returned', 'caught']",
        "iterator_of_the_program None [1, 'return', 'returned']",
        "cancelled None ['return', 'cancelled']",
        "closed None ['return']",
      ),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
);
