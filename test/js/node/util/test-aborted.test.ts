// Most of this test was copied from
// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/test/parallel/test-aborted-util.js#L1-L60
// and then translated to bun:test using Claude.
import { expect, test } from "bun:test";
import { getEventListeners } from "events";
import { bunEnv, bunExe, isMacOS, isWindows, tempDirWithFiles } from "harness";
import path from "node:path";
import { aborted } from "util";

// A file for the fs.promises.watch() test below. It is created here and not in the test: on macOS, a watcher
// can report the creation of a path that was made just before it started.
const watchedFile = path.join(tempDirWithFiles("aborted-watch", { "watched.txt": "" }), "watched.txt");

test("aborted works when provided a resource that was already aborted", async () => {
  const ac = new AbortController();
  const abortedPromise = aborted(ac.signal, {});
  ac.abort();

  expect(ac.signal.aborted).toBe(true);
  expect(getEventListeners(ac.signal, "abort").length).toBe(0);
  await expect(abortedPromise).resolves.toBeUndefined();
});

test("aborted resolves even when another listener stopped propagation", async () => {
  const ac = new AbortController();
  ac.signal.addEventListener("abort", e => e.stopImmediatePropagation());
  const abortedPromise = aborted(ac.signal, {});
  ac.abort();

  // aborted() resolves from a `once: true` listener, synchronously inside abort(),
  // so by now it has been consumed and only the listener that stopped propagation is left.
  expect(getEventListeners(ac.signal, "abort")).toHaveLength(1);
  await expect(abortedPromise).resolves.toBeUndefined();
});

test("aborted works when provided a resource that was not already aborted", async () => {
  const ac = new AbortController();
  var strong = {};
  globalThis.strong = strong;
  const abortedPromise = aborted(ac.signal, strong);
  expect(getEventListeners(ac.signal, "abort").length).toBe(1);
  const sleepy = Bun.sleep(10).then(() => {
    ac.abort();
  });
  await 42;
  expect(ac.signal.aborted).toBe(false);
  expect(Bun.peek.status(abortedPromise)).toBe("pending");
  await sleepy;
  await abortedPromise;
  expect(ac.signal.aborted).toBe(true);
  expect(getEventListeners(ac.signal, "abort").length).toBe(0);
  delete globalThis.strong;
  await expect(abortedPromise).resolves.toBeUndefined();
});

test("aborted with gc cleanup", async () => {
  const ac = new AbortController();
  let finalized = false;
  // make a FinalizationRegistry to tell us when the second argument to aborted()
  // has been garbage collected
  const registry = new FinalizationRegistry(() => {
    finalized = true;
  });
  const abortedPromise = (() => {
    const gcMe = {};
    registry.register(gcMe, undefined);
    const abortedPromise = aborted(ac.signal, gcMe);
    return abortedPromise;
    // gcMe is now out of scope and eligible to be collected
  })();
  abortedPromise.then(() => {
    throw new Error("this promise should never resolve");
  });

  // wait for the object to be GC'd by ticking the event loop and forcing garbage collection
  while (!finalized) {
    await new Promise(resolve => setImmediate(resolve));
    Bun.gc(true);
  }
  ac.abort();

  expect(ac.signal.aborted).toBe(true);
  expect(getEventListeners(ac.signal, "abort").length).toBe(0);
});

// The tests for invalid arguments are in util-aborted-async.test.ts, which also runs under Node.

test("the registry callback of aborted() does not keep the resource of the first call alive", async () => {
  // The first call creates the FinalizationRegistry of aborted(), and the registry keeps its callback for
  // the life of the process. So the callback must not be a closure of that call. JSC usually drops the
  // variables that a closure does not use. The option below keeps them all, as JSC does for a debugger
  // that has its breakpoints active.
  const script = `
    import { getEventListeners } from "node:events";
    import { aborted } from "node:util";

    const ac = new AbortController();
    let collected = false;
    const registry = new FinalizationRegistry(() => {
      collected = true;
    });
    (() => {
      const resource = {};
      registry.register(resource, undefined);
      aborted(ac.signal, resource);
    })();
    // aborted() removes its listener after the resource is collected.
    for (let round = 0; round < 10 && !(collected && getEventListeners(ac.signal, "abort").length === 0); round++) {
      await new Promise(resolve => setImmediate(resolve));
      Bun.gc(true);
    }
    console.log(JSON.stringify({ collected, listeners: getEventListeners(ac.signal, "abort").length }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, BUN_JSC_forceDebuggerBytecodeGeneration: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: '{"collected":true,"listeners":0}\n',
    stderr: "",
    exitCode: 0,
  });
});

test("aborted() and the next() of fs.promises.watch() on one signal settle in the order of Node", async () => {
  // A child process: a test callback can run with the event loop not entered, and then the promise reactions
  // run before abort() returns (#43356). Nothing writes to the file that the fixture watches.
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "aborted-watch-race-fixture.ts"), watchedFile],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // What Node v26.12.0 prints for the fixture. aborted() settles 2 or 3 ticks after the abort, and a next()
  // that waits settles on tick 3. A next() that is called after the abort settles on tick 2.
  const races = {
    "aborted() is called first, abort() comes in the same turn": "aborted() fulfilled",
    "aborted() is called first, abort() comes later": "aborted() fulfilled",
    "aborted() is called first, the signal is already aborted": "next() rejected with AbortError",
    "next() is called first, abort() comes in the same turn": "aborted() fulfilled",
    "next() is called first, abort() comes later": "aborted() fulfilled",
    "next() is called first, the signal is already aborted": "next() rejected with AbortError",
    "aborted(signal, watcher), for await, and abort() comes later":
      "aborted() fulfilled, for await rejected with AbortError",
  };
  // Except on macOS and Windows, Node has a JS watcher for `recursive`. A next() that waits settles on tick 2
  // there, so it settles before aborted() or the order of the two abort listeners decides.
  const recursiveRaces =
    isMacOS || isWindows
      ? races
      : {
          ...races,
          "aborted() is called first, abort() comes in the same turn": "next() rejected with AbortError",
          "next() is called first, abort() comes in the same turn": "next() rejected with AbortError",
          "next() is called first, abort() comes later": "next() rejected with AbortError",
        };

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ races, "races with recursive: true": recursiveRaces });
  expect(exitCode).toBe(0);
});

test("aborted resolves every waiter on the same signal with undefined", async () => {
  const ac = new AbortController();
  const first = aborted(ac.signal, {});
  const second = aborted(ac.signal, {});
  expect([first, second]).toEqual([expect.any(Promise), expect.any(Promise)]);
  expect(getEventListeners(ac.signal, "abort")).toHaveLength(2);
  ac.abort();
  // A second abort() is a no-op; the already-settled promises must not be touched.
  ac.abort();
  expect(await Promise.all([first, second])).toEqual([undefined, undefined]);
  expect(getEventListeners(ac.signal, "abort")).toHaveLength(0);
});

test("aborted does not hand its internal settle function to a patched Function.prototype.bind", () => {
  const originalBind = Function.prototype.bind;
  const receivers: Function[] = [];
  Function.prototype.bind = function (this: Function, ...args: any[]) {
    receivers.push(this);
    return originalBind.apply(this, args as [any, ...any[]]);
  };
  try {
    aborted(new AbortController().signal, {});
  } finally {
    Function.prototype.bind = originalBind;
  }
  expect(receivers).toEqual([]);
});
