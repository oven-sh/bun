/**
 * Node keeps the handle of a ChildProcess and of an fs.FSWatcher in an own enumerable
 * `_handle`, one object per instance, and sets it to null once the process or the watcher is gone:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L267-L282
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/watchers.js#L252-L265 and #L341-L351
 * The handle has a function under an own key (`onexit`, `onchange`). So structured clone refuses
 * an object that has a handle, and clones it again when the handle is gone. kill(), ref() and
 * unref() of a ChildProcess read `_handle` (child_process.js#L521-L556), and so do close(), ref()
 * and unref() of an FSWatcher. So they also work on an object that inherits from the child or
 * the watcher, or that is a Proxy of it.
 *
 * This file uses node:test/node:assert so the identical file also runs under `node --test`,
 * which is where the expected values come from. The tests that are skipped under node say what
 * is bun's own. The file cannot import from "harness" for the same reason, so it manages its
 * own temporary directory and starts process.execPath.
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { ChildProcess, fork, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import v8 from "node:v8";
import { setEnvironmentData, Worker } from "node:worker_threads";

// `_handle` is not in the public typings.
type WithHandle<T, Handle = object> = T & { _handle: Handle | null };
type ProcessHandle = { onexit: unknown; pid?: number; kill(signal?: number | string): number };

const onlyBun = typeof Bun === "undefined" ? test.skip : test;
// libuv's number for "no such process".
const UV_ESRCH: number = process.binding("uv").UV_ESRCH;

// What every DOM road throws, in node and in bun.
const dataCloneError = { constructor: DOMException, name: "DataCloneError", code: 25 };
// v8.serialize and child.send are no DOM roads. Node throws a plain Error from them, and bun
// reports every refusal as a DataCloneError.
const serializerError = typeof Bun === "undefined" ? { constructor: Error, name: "Error" } : dataCloneError;

const markName = "handle-layout";
// A child that outlives every test here. Each test kills it; the timer only ends a child whose
// test failed before it reached that kill().
const idleChild = ["-e", "setTimeout(() => {}, 60_000)"];

let dir: string;
let file: string;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "handle-layout-"));
  file = path.join(dir, "a.txt");
  fs.writeFileSync(file, "abcd");
  fs.writeFileSync(path.join(dir, "ipc-child.js"), `process.on("message", () => {});`);
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function eachRoad(value: unknown, check: (road: string, send: () => unknown, refusal: object) => void) {
  const { port1, port2 } = new MessageChannel();
  const broadcast = new BroadcastChannel(markName);
  try {
    check("structuredClone", () => structuredClone(value), dataCloneError);
    check("structuredClone in an object", () => structuredClone({ value }), dataCloneError);
    check("structuredClone in an array", () => structuredClone([value]), dataCloneError);
    check("structuredClone in a Map", () => structuredClone(new Map([["key", value]])), dataCloneError);
    check("structuredClone in a Set", () => structuredClone(new Set([value])), dataCloneError);
    check("v8.serialize", () => v8.serialize(value), serializerError);
    check("MessagePort.postMessage", () => port2.postMessage(value), dataCloneError);
    check("BroadcastChannel.postMessage", () => broadcast.postMessage(value), dataCloneError);
    check("performance.mark detail", () => performance.mark(markName, { detail: value }), dataCloneError);
  } finally {
    port1.close();
    port2.close();
    broadcast.close();
    performance.clearMarks(markName);
  }
}

// A listener is a function, and a function alone makes its EventEmitter uncloneable. So every test
// below checks the refusals before it adds a listener, and checks the clones after the listener is gone.
function assertRefused(value: unknown) {
  eachRoad(value, (road, send, refusal) => assert.throws(send, refusal, road));
}

function assertCloned(value: unknown) {
  eachRoad(value, (road, send) => assert.doesNotThrow(send, road));
}

// Runs a script in a process of its own. Gives what the script printed and its exit code.
async function runScript(script: string) {
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", chunk => (stderr += chunk));
  const [code] = await once(child, "close");
  return { stdout, stderr, code };
}

describe("ChildProcess", () => {
  test("has a writable handle of its own from construction", () => {
    const first = new ChildProcess() as WithHandle<ChildProcess, ProcessHandle>;
    const second = new ChildProcess() as WithHandle<ChildProcess, ProcessHandle>;
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(first, "_handle"), {
      value: first._handle,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    assert.deepStrictEqual(
      [first._handle!.constructor.name, first._handle!.pid, first._handle === second._handle],
      ["Process", undefined, false],
    );
    // A function under an own enumerable key is what structured clone refuses.
    assert.strictEqual(typeof first._handle!.onexit, "function");
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(first._handle!, "onexit"), {
      value: first._handle!.onexit,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    assertRefused(first);

    // async-listener puts its wrapper there, in strict mode, for every child.
    const wrapper = () => {};
    first._handle!.onexit = wrapper;
    assert.deepStrictEqual([first._handle!.onexit === wrapper, second._handle!.onexit === wrapper], [true, false]);
  });

  test("has its pid on the handle while it runs, and no handle from 'exit' on", async () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" }) as WithHandle<ChildProcess, ProcessHandle>;
    const handle = child._handle!;
    assert.deepStrictEqual([Object.keys(handle), handle.pid === child.pid], [["onexit", "pid"], true]);
    assertRefused(child);

    // Read inside 'exit': there a handle that the program kept still answers in node. Later node has closed it.
    const atExit = await new Promise(resolve => child.once("exit", () => resolve([child._handle, handle.kill(0)])));
    assert.deepStrictEqual(atExit, [null, UV_ESRCH]);
    const clone = structuredClone(child) as unknown as Record<string, unknown>;
    assert.deepStrictEqual([clone._handle, clone.exitCode, clone.signalCode], [null, 0, null]);
    assertCloned(child);
  });

  test("kill(), ref() and unref() read the handle, so they work through Object.create(child)", async () => {
    const child = spawn(process.execPath, idleChild, { stdio: "ignore" }) as WithHandle<ChildProcess>;
    try {
      const derived: ChildProcess = Object.create(child);
      assert.deepStrictEqual([derived.unref(), derived.ref(), derived.kill()], [undefined, undefined, true]);
      assert.deepStrictEqual([Object.hasOwn(derived, "killed"), derived.killed, child.killed], [true, true, false]);
      assertRefused(child);
    } finally {
      child.kill();
    }
    await once(child, "exit");
    assert.deepStrictEqual([child._handle, child.kill()], [null, false]);
    assertCloned(child);
  });

  test("kill() asks what is in _handle, also when the program put it there", async () => {
    const child = spawn(process.execPath, idleChild, { stdio: "ignore" }) as WithHandle<ChildProcess, ProcessHandle>;
    const own = child._handle!;
    try {
      // This handle answers 0 and sends nothing: the child counts as killed and runs on.
      child._handle = { onexit: own.onexit, kill: () => 0 };
      assert.deepStrictEqual([child.kill(), child.killed], [true, true]);
      child._handle = null;
      assert.strictEqual(child.kill(), false);
    } finally {
      child._handle = own;
      child.kill();
    }
    await once(child, "exit");
  });

  test("the handle takes a signal as a number, so no argument and a name are signal 0", async () => {
    // This child ends by itself with code 0 when its stdin ends. A signal ends it with that signal.
    const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], {
      stdio: ["pipe", "ignore", "ignore"],
    }) as WithHandle<ChildProcess, ProcessHandle>;
    try {
      assert.deepStrictEqual([child._handle!.kill(), child._handle!.kill("SIGTERM")], [0, 0]);
    } finally {
      child.stdin!.end();
    }
    assert.deepStrictEqual(await once(child, "exit"), [0, null]);
  });

  test("unref() and ref() through Object.create(child) release and hold the event loop", async () => {
    // Each parent prints what it saw before it ended. 'beforeExit' comes when nothing holds its event loop.
    const parent = (ref: boolean) => `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ${JSON.stringify(idleChild)}, { stdio: "ignore" });
      const derived = Object.create(child);
      const seen = [];
      child.on("exit", () => seen.push("exit"));
      process.on("beforeExit", () => seen.push("beforeExit"));
      process.on("exit", () => {
        child.kill();
        console.log(seen.join(","));
      });
      derived.unref();
      if (${ref}) {
        derived.ref();
        setImmediate(() => child.kill());
      }
    `;
    assert.deepStrictEqual(await Promise.all([runScript(parent(false)), runScript(parent(true))]), [
      { stdout: "beforeExit\n", stderr: "", code: 0 },
      { stdout: "exit,beforeExit\n", stderr: "", code: 0 },
    ]);
  });

  test("keeps its handle until a failed spawn reports the error", async () => {
    const child = spawn(path.join(dir, "no-such-binary"), [], { stdio: "ignore" }) as WithHandle<
      ChildProcess,
      ProcessHandle
    >;
    let handleAtError: unknown;
    let handleAtClose: unknown;
    let error: NodeJS.ErrnoException | undefined;
    try {
      assert.strictEqual(child._handle!.pid, undefined);
      assertRefused(child);
    } finally {
      child.once("error", reported => {
        error = reported;
        handleAtError = child._handle;
      });
      await new Promise<void>(resolve =>
        child.once("close", () => {
          handleAtClose = child._handle;
          resolve();
        }),
      );
    }
    assert.deepStrictEqual([error?.code, handleAtError, handleAtClose], ["ENOENT", null, null]);
    assertCloned(child);
  });

  // A cwd that is a file is ENOENT on Windows, which both runtimes report in 'error' and not by a throw.
  (process.platform === "win32" ? test.skip : test)("has no handle after a spawn that throws", () => {
    const child = new ChildProcess() as WithHandle<ChildProcess>;
    const options = { file: process.execPath, args: [process.execPath, "-e", ""], cwd: file, stdio: "ignore" };
    assert.throws(() => (child as unknown as { spawn(options: object): void }).spawn(options), {
      code: "ENOTDIR",
      syscall: "spawn",
    });
    assert.strictEqual(child._handle, null);
    assertCloned(child);
  });

  test("keeps its handle when spawn() throws after the process started", async () => {
    const child = new ChildProcess() as WithHandle<ChildProcess>;
    // Both runtimes touch `stdio` right after the process started (node assigns it, bun reads it). Fail that one time.
    const failure = new RangeError("stdio");
    let failed = false;
    const failOnce = () => {
      if (failed) return [];
      failed = true;
      throw failure;
    };
    Object.defineProperty(child, "stdio", { get: failOnce, set: failOnce });
    const options = { file: process.execPath, args: [process.execPath, ...idleChild], stdio: "ignore" };
    try {
      assert.throws(() => (child as unknown as { spawn(options: object): void }).spawn(options), failure);
      assert.ok(child._handle);
    } finally {
      assert.strictEqual(child.kill(), true);
    }
    await once(child, "exit");
    assert.strictEqual(child._handle, null);
  });

  // Node throws when spawn() is called on a child that has no handle. Bun starts the process, so the child needs a handle again.
  onlyBun("has a handle again when it is spawned again after its exit", async () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" }) as WithHandle<ChildProcess, ProcessHandle>;
    const first = child._handle!;
    await once(child, "exit");
    const options = { file: process.execPath, args: [process.execPath, ...idleChild], stdio: "ignore" };
    (child as unknown as { spawn(options: object): void }).spawn(options);
    try {
      assert.ok(child._handle);
      assertRefused(child);
      // The first handle keeps the child it was made for. It does not reach the new one.
      assert.deepStrictEqual([child._handle === first, first.kill(0), child._handle!.kill(0)], [false, UV_ESRCH, 0]);
    } finally {
      assert.strictEqual(child.kill(), true);
    }
    await once(child, "exit");
  });

  // Node's handle signals the pid that its unused memory holds, and gets its `pid` key when the process starts.
  onlyBun("answers ESRCH, and has its pid key, before the process starts", () => {
    const child = new ChildProcess() as WithHandle<ChildProcess, ProcessHandle>;
    assert.deepStrictEqual([child.kill(0), child._handle!.kill(0)], [false, UV_ESRCH]);
    assert.deepStrictEqual(Object.keys(child._handle!), ["onexit", "pid"]);
  });

  // What the script of a disposed graph starts does not start: no process, no 'error' and no 'close'.
  onlyBun("has no handle when the script of a disposed Bun.ModuleGraph started it", () => {
    const graph = new Bun.ModuleGraph();
    const inGraph = graph.run(() => AsyncLocalStorage.snapshot());
    graph.dispose();
    const child = inGraph(() => spawn(process.execPath, ["-e", ""], { stdio: "ignore" })) as WithHandle<ChildProcess>;
    assert.deepStrictEqual([child.pid, child._handle], [undefined, null]);
    assertCloned(child);
  });

  test("reports 'error' for a missing binary to code that wraps spawn() and assigns _handle.onexit", async () => {
    // What async-listener does to every child, in strict mode:
    // https://github.com/othiym23/async-listener/blob/v0.6.10/index.js#L173-L185
    const script = `
      "use strict";
      const { ChildProcess, spawn } = require("node:child_process");
      const original = ChildProcess.prototype.spawn;
      ChildProcess.prototype.spawn = function () {
        const result = original.apply(this, arguments);
        if (this._handle) {
          const onexit = this._handle.onexit;
          this._handle.onexit = function () {
            return onexit.apply(this, arguments);
          };
        }
        return result;
      };
      spawn(${JSON.stringify(path.join(dir, "no-such-binary"))}, [], { stdio: "ignore" }).on("error", error => {
        console.log(error.code);
      });
    `;
    assert.deepStrictEqual(await runScript(script), { stdout: "ENOENT\n", stderr: "", code: 0 });
  });
});

describe("FSWatcher", () => {
  test("is refused while it has a handle and has node's five own keys once closed", () => {
    const watcher = fs.watch(dir) as WithHandle<fs.FSWatcher>;
    try {
      assert.deepStrictEqual(Object.keys(watcher._handle!), ["onchange"]);
      assertRefused(watcher);
    } finally {
      watcher.close();
    }
    assert.deepStrictEqual(structuredClone(watcher), {
      _events: {},
      _eventsCount: 0,
      _maxListeners: undefined,
      _handle: null,
      _ignoreMatcher: null,
    });
    assertCloned(watcher);
  });

  test("keeps its handle, and stays refused, when it never started", () => {
    // `throwIfNoEntry` is spread in because the typings do not list this node v26 option yet.
    const options: fs.WatchOptionsWithStringEncoding = { persistent: true, ...{ throwIfNoEntry: false } };
    const watcher = fs.watch(path.join(dir, "missing"), options) as WithHandle<fs.FSWatcher>;
    assertRefused(watcher);
    watcher.close();
    assert.ok(watcher._handle);
    assertRefused(watcher);
  });

  test("has no handle, and clones, once an AbortSignal closed it", async () => {
    const controller = new AbortController();
    const watcher = fs.watch(dir, { signal: controller.signal }) as WithHandle<fs.FSWatcher>;
    try {
      assertRefused(watcher);
      const handle = watcher._handle;
      const closed = new Promise(resolve => watcher.once("close", resolve));
      controller.abort();
      assert.strictEqual(watcher._handle, null);
      // The abort closed that handle. Put back, it stays in place as every handle that is closed does.
      // (Read in this turn: node ends the process when a closed handle is asked for its state later.)
      watcher._handle = handle;
      watcher.close();
      assert.strictEqual(watcher._handle, handle);
      watcher._handle = null;
      await closed;
      assertCloned(watcher);
    } finally {
      watcher.close();
    }
  });

  test("has no handle, and clones, once a signal that was already aborted closed it", async () => {
    const watcher = fs.watch(dir, { signal: AbortSignal.abort() }) as WithHandle<fs.FSWatcher>;
    try {
      assertRefused(watcher);
      await new Promise(resolve => watcher.once("close", resolve));
      assert.strictEqual(watcher._handle, null);
      assertCloned(watcher);
    } finally {
      watcher.close();
    }
  });

  test("close(), ref() and unref() work through Object.create(watcher) and through a Proxy", async () => {
    const wrappers: [string, (watcher: fs.FSWatcher) => fs.FSWatcher][] = [
      ["Object.create", watcher => Object.create(watcher)],
      ["Proxy", watcher => new Proxy(watcher, {})],
    ];
    for (const [name, wrap] of wrappers) {
      const watcher = fs.watch(dir) as WithHandle<fs.FSWatcher>;
      let closed = false;
      try {
        const wrapper = wrap(watcher) as WithHandle<fs.FSWatcher>;
        assert.deepStrictEqual([wrapper.unref(), wrapper.ref()], [wrapper, wrapper], name);
        const closeEvent = once(watcher, "close");
        wrapper.close();
        closed = true;
        // close() writes null to its receiver: an object that inherits gets a key of its own, a Proxy passes the write on.
        assert.strictEqual(wrapper._handle, null, name);
        await closeEvent;
      } finally {
        // Only when the close() above did not happen: node ends the process when a handle that is closed is asked for its state in a later turn.
        if (!closed) watcher.close();
      }
    }
  });

  test("keeps what is in _handle when the program closes the handle itself", () => {
    const watcher = fs.watch(dir) as WithHandle<fs.FSWatcher, { close(): void }>;
    const own = watcher._handle!;
    own.close();
    // In the same turn, for the reason above. A handle that is closed stays, as one that never started does.
    watcher.close();
    assert.strictEqual(watcher._handle, own);
    assertRefused(watcher);

    const replaced = fs.watch(dir) as WithHandle<fs.FSWatcher, { close(): void }>;
    const ownOfReplaced = replaced._handle!;
    const replacement = { close() {} };
    replaced._handle = replacement;
    ownOfReplaced.close();
    assert.strictEqual(replaced._handle, replacement);
  });

  test("stays refused after close when it has an ignore matcher", () => {
    // `ignore` is spread in because the typings do not list this node v26 option yet.
    const options: fs.WatchOptionsWithStringEncoding = { persistent: true, ...{ ignore: "*.log" } };
    const watcher = fs.watch(dir, options) as WithHandle<fs.FSWatcher> & { _ignoreMatcher: unknown };
    watcher.close();
    assert.deepStrictEqual([watcher._handle, typeof watcher._ignoreMatcher], [null, "function"]);
    assertRefused(watcher);
  });
});

describe("FileHandle", () => {
  // Node refuses a FileHandle in every state: it can be transferred and cannot be cloned. Its `close` is a
  // function under an own key. Bun's FileHandle has no such key yet, so bun clones it.
  test(
    "is refused while it is open and after it is closed",
    { expectFailure: typeof Bun !== "undefined" && "bun clones a FileHandle. Remove this option when it refuses one." },
    async () => {
      const handle = await fsp.open(file, "r");
      try {
        assertRefused(handle);
      } finally {
        await handle.close();
      }
      assertRefused(handle);
    },
  );
});

describe("worker and child process roads", () => {
  async function withLiveHandles(run: (values: [string, object][]) => void | Promise<void>) {
    const child = spawn(process.execPath, idleChild, { stdio: "ignore" });
    const watcher = fs.watch(dir);
    try {
      await run([
        ["ChildProcess", child],
        ["FSWatcher", watcher],
      ]);
    } finally {
      watcher.close();
      child.kill();
    }
  }

  // The constructor serializes workerData and environmentData, so a refusal throws before a thread starts.
  async function assertWorkerRefused(name: string, options: { workerData?: unknown }) {
    let worker: Worker | undefined;
    try {
      assert.throws(() => void (worker = new Worker("", { eval: true, ...options })), dataCloneError, name);
    } finally {
      await worker?.terminate();
    }
  }

  test("new Worker refuses them in workerData and in environmentData", async () => {
    await withLiveHandles(async values => {
      for (const [name, value] of values) {
        await assertWorkerRefused(`${name} in workerData`, { workerData: { value } });
        setEnvironmentData(markName, value);
        try {
          await assertWorkerRefused(`${name} in environmentData`, {});
        } finally {
          setEnvironmentData(markName, undefined);
        }
      }
    });
  });

  test("worker.postMessage refuses them", async () => {
    await withLiveHandles(async values => {
      const worker = new Worker("require('node:worker_threads').parentPort.on('message', () => {})", { eval: true });
      try {
        for (const [name, value] of values) {
          assert.throws(() => worker.postMessage(value), dataCloneError, name);
        }
      } finally {
        await worker.terminate();
      }
    });
  });

  test("child.send refuses them over advanced IPC and still sends them over JSON IPC", async () => {
    await withLiveHandles(async values => {
      const childPath = path.join(dir, "ipc-child.js");
      // send() serializes the message before it returns, so neither child has to finish starting.
      const advanced = fork(childPath, { serialization: "advanced" });
      const json = fork(childPath, { serialization: "json" });
      try {
        for (const [name, value] of values) {
          assert.throws(() => advanced.send({ value }), serializerError, name);
          assert.strictEqual(json.send({ value }), true, name);
        }
      } finally {
        advanced.kill();
        json.kill();
        await Promise.all([once(advanced, "exit"), once(json, "exit")]);
      }
    });
  });
});
