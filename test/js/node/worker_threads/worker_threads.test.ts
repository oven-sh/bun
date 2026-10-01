import { describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir, tmpdirSync } from "harness";
import { once } from "node:events";
import fs from "node:fs";
import { join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import wt, {
  BroadcastChannel,
  getEnvironmentData,
  isMainThread,
  markAsUncloneable,
  markAsUntransferable,
  MessageChannel,
  MessagePort,
  moveMessagePortToContext,
  parentPort,
  receiveMessageOnPort,
  resourceLimits,
  setEnvironmentData,
  SHARE_ENV,
  threadId,
  Worker,
  workerData,
} from "worker_threads";

// Worker startup under debug/ASAN is slow enough that several tests here cannot
// finish inside the 5s default.
setDefaultTimeout(isDebug ? 90_000 : 10_000);

test("support eval in worker", async () => {
  const worker = new Worker(`postMessage(1 + 1)`, {
    eval: true,
  });
  const result = await new Promise(resolve => {
    worker.on("message", resolve);
  });
  expect(result).toBe(2);
  await worker.terminate();
});

test("all worker_threads module properties are present", () => {
  expect(wt).toHaveProperty("getEnvironmentData");
  expect(wt).toHaveProperty("isMainThread");
  expect(wt).toHaveProperty("markAsUntransferable");
  expect(wt).toHaveProperty("moveMessagePortToContext");
  expect(wt).toHaveProperty("parentPort");
  expect(wt).toHaveProperty("receiveMessageOnPort");
  expect(wt).toHaveProperty("resourceLimits");
  expect(wt).toHaveProperty("SHARE_ENV");
  expect(wt).toHaveProperty("setEnvironmentData");
  expect(wt).toHaveProperty("threadId");
  expect(wt).toHaveProperty("workerData");
  expect(wt).toHaveProperty("BroadcastChannel");
  expect(wt).toHaveProperty("MessageChannel");
  expect(wt).toHaveProperty("MessagePort");
  expect(wt).toHaveProperty("Worker");

  expect(getEnvironmentData).toBeFunction();
  expect(isMainThread).toBeBoolean();
  expect(markAsUntransferable).toBeFunction();
  expect(moveMessagePortToContext).toBeFunction();
  expect(parentPort).toBeNull();
  expect(receiveMessageOnPort).toBeFunction();
  expect(resourceLimits).toBeDefined();
  expect(SHARE_ENV).toBeDefined();
  expect(setEnvironmentData).toBeFunction();
  expect(threadId).toBeNumber();
  expect(workerData).toBeNull();
  expect(BroadcastChannel).toBeDefined();
  expect(MessageChannel).toBeDefined();
  expect(MessagePort).toBeDefined();
  expect(Worker).toBeDefined();

  // markAsUntransferable / isMarkedAsUntransferable / markAsUncloneable are implemented.
  expect(wt.markAsUntransferable).toBeFunction();
  expect(wt.isMarkedAsUntransferable).toBeFunction();
  expect(wt.markAsUncloneable).toBeFunction();
  {
    const ab = new ArrayBuffer(8);
    expect(wt.isMarkedAsUntransferable(ab)).toBe(false);
    wt.markAsUntransferable(ab);
    expect(wt.isMarkedAsUntransferable(ab)).toBe(true);
  }

  expect(() => {
    const { port1 } = new MessageChannel();
    wt.moveMessagePortToContext(port1, {});
  }).toThrow("not yet implemented");
});

// The markers are JSC private names (node uses v8 Privates): invisible to user code,
// unforgeable via the registry symbol or a public property, and not removable.
test("markAsUncloneable and markAsUntransferable markers are private, unforgeable, and permanent", () => {
  const expectDataCloneError = (fn: () => void) => {
    let err: any;
    try {
      fn();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DOMException);
    expect(err?.name).toBe("DataCloneError");
  };

  // The mark is not observable on the object.
  const marked: any = { a: 1 };
  wt.markAsUncloneable(marked);
  expect(Object.getOwnPropertySymbols(marked)).toHaveLength(0);
  expect(Reflect.ownKeys(marked)).toEqual(["a"]);
  expectDataCloneError(() => structuredClone(marked));

  const markedBuffer = new ArrayBuffer(8);
  markAsUntransferable(markedBuffer);
  expect(Object.getOwnPropertySymbols(markedBuffer)).toHaveLength(0);
  expect(wt.isMarkedAsUntransferable(markedBuffer)).toBe(true);

  // User code cannot forge a mark with the well-known registry symbol or a public name.
  const forged: any = { a: 1 };
  forged[Symbol.for("nodejs.worker_threads.uncloneable")] = true;
  forged.isUncloneable = true;
  expect(structuredClone(forged)).toEqual({ a: 1, isUncloneable: true });

  const forgedBuffer: any = new ArrayBuffer(8);
  forgedBuffer[Symbol.for("nodejs.worker_threads.untransferable")] = true;
  expect(wt.isMarkedAsUntransferable(forgedBuffer)).toBe(false);
  {
    const { port1, port2 } = new MessageChannel();
    expect(() => port1.postMessage(forgedBuffer, [forgedBuffer])).not.toThrow();
    port1.close();
    port2.close();
  }

  // A real mark survives every removal user code can attempt.
  const unmarkAttempt: any = {};
  wt.markAsUncloneable(unmarkAttempt);
  delete unmarkAttempt[Symbol.for("nodejs.worker_threads.uncloneable")];
  for (const sym of Object.getOwnPropertySymbols(unmarkAttempt)) delete unmarkAttempt[sym];
  expectDataCloneError(() => structuredClone(unmarkAttempt));
});

test("all worker_threads worker instance properties are present", async () => {
  const worker = new Worker(new URL("./worker.js", import.meta.url));
  expect(worker).toHaveProperty("threadId");
  expect(worker).toHaveProperty("ref");
  expect(worker).toHaveProperty("unref");
  expect(worker).toHaveProperty("stdin");
  expect(worker).toHaveProperty("stdout");
  expect(worker).toHaveProperty("stderr");
  expect(worker).toHaveProperty("performance");
  expect(worker).toHaveProperty("terminate");
  expect(worker).toHaveProperty("postMessage");
  expect(worker).toHaveProperty("getHeapSnapshot");
  expect(worker).toHaveProperty("setMaxListeners");
  expect(worker).toHaveProperty("getMaxListeners");
  expect(worker).toHaveProperty("emit");
  expect(worker).toHaveProperty("addListener");
  expect(worker).toHaveProperty("on");
  expect(worker).toHaveProperty("prependListener");
  expect(worker).toHaveProperty("once");
  expect(worker).toHaveProperty("prependOnceListener");
  expect(worker).toHaveProperty("removeListener");
  expect(worker).toHaveProperty("off");
  expect(worker).toHaveProperty("removeAllListeners");
  expect(worker).toHaveProperty("listeners");
  expect(worker).toHaveProperty("rawListeners");
  expect(worker).toHaveProperty("listenerCount");
  expect(worker).toHaveProperty("eventNames");

  expect(worker.threadId).toBeNumber();
  expect(worker.ref).toBeFunction();
  expect(worker.unref).toBeFunction();
  expect(worker.stdin).toBeNull();
  // node always exposes worker.stdout/stderr as Readables (fed by the worker's
  // process.stdout/stderr); only stdin stays null until { stdin: true }.
  expect(worker.stdout).not.toBeNull();
  expect(worker.stderr).not.toBeNull();
  expect(worker.performance).toBeDefined();
  expect(worker.terminate).toBeFunction();
  expect(worker.postMessage).toBeFunction();
  expect(worker.getHeapSnapshot).toBeFunction();
  expect(worker.setMaxListeners).toBeFunction();
  expect(worker.getMaxListeners).toBeFunction();
  expect(worker.emit).toBeFunction();
  expect(worker.addListener).toBeFunction();
  expect(worker.on).toBeFunction();
  expect(worker.prependListener).toBeFunction();
  expect(worker.once).toBeFunction();
  expect(worker.prependOnceListener).toBeFunction();
  expect(worker.removeListener).toBeFunction();
  expect(worker.off).toBeFunction();
  expect(worker.removeAllListeners).toBeFunction();
  expect(worker.listeners).toBeFunction();
  expect(worker.rawListeners).toBeFunction();
  expect(worker.listenerCount).toBeFunction();
  expect(worker.eventNames).toBeFunction();
  await worker.terminate();
});

test("threadId module and worker property is consistent", async () => {
  const worker1 = new Worker(new URL("./worker-thread-id.ts", import.meta.url));
  expect(threadId).toBe(0);
  expect(worker1.threadId).toBeGreaterThan(0);
  expect(() => worker1.postMessage({ workerId: worker1.threadId })).not.toThrow();
  const worker2 = new Worker(new URL("./worker-thread-id.ts", import.meta.url));
  expect(worker2.threadId).toBeGreaterThan(worker1.threadId);
  expect(() => worker2.postMessage({ workerId: worker2.threadId })).not.toThrow();
  await worker1.terminate();
  await worker2.terminate();
});

test("receiveMessageOnPort works across threads", async () => {
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL("./worker.js", import.meta.url), {
    workerData: port2,
    transferList: [port2],
  });
  let sharedBuffer = new SharedArrayBuffer(8);
  let sharedBufferView = new Int32Array(sharedBuffer);
  let msg = { sharedBuffer };
  worker.postMessage(msg);
  expect(await Atomics.waitAsync(sharedBufferView, 0, 0).value).toBe("ok");
  const message = receiveMessageOnPort(port1);
  expect(message).toBeDefined();
  expect(message!.message).toBe("done!");
  await worker.terminate();
}, 9999999);

test("receiveMessageOnPort works as FIFO", () => {
  const { port1, port2 } = new MessageChannel();

  const message1 = { hello: "world" };
  const message2 = { foo: "bar" };

  // Make sure receiveMessageOnPort() works in a FIFO way, the same way it does
  // when we’re using events.
  expect(receiveMessageOnPort(port2)).toBe(undefined);
  port1.postMessage(message1);
  port1.postMessage(message2);
  expect(receiveMessageOnPort(port2)).toStrictEqual({ message: message1 });
  expect(receiveMessageOnPort(port2)).toStrictEqual({ message: message2 });
  expect(receiveMessageOnPort(port2)).toBe(undefined);
  expect(receiveMessageOnPort(port2)).toBe(undefined);

  // Make sure message handlers aren’t called.
  port2.on("message", () => {
    expect().fail("message handler must not be called");
  });
  port1.postMessage(message1);
  expect(receiveMessageOnPort(port2)).toStrictEqual({ message: message1 });
  port1.close();

  for (const value of [null, 0, -1, {}, []]) {
    expect(() => {
      // @ts-expect-error invalid type
      receiveMessageOnPort(value);
    }).toThrow();
  }
}, 9999999);

test("you can override globalThis.postMessage", async () => {
  const worker = new Worker(new URL("./worker-override-postMessage.js", import.meta.url));
  const message = await new Promise(resolve => {
    worker.on("message", resolve);
    worker.postMessage("Hello from worker!");
  });
  expect(message).toBe("Hello from worker!");
  await worker.terminate();
});

test("support require in eval", async () => {
  const worker = new Worker(`postMessage(require('process').argv[0])`, { eval: true });
  const result = await new Promise(resolve => {
    worker.on("message", resolve);
    worker.on("error", resolve);
  });
  expect(result).toBe(Bun.argv[0]);
  await worker.terminate();
});

test("support require in eval for a file", async () => {
  const cwd = process.cwd();
  console.log("cwd", cwd);
  const dir = import.meta.dir;
  const testfile = resolve(dir, "fixture-argv.js");
  const realpath = relative(cwd, testfile).replaceAll("\\", "/");
  console.log("realpath", realpath);
  expect(() => fs.accessSync(join(cwd, realpath))).not.toThrow();
  const worker = new Worker(`postMessage(require('./${realpath}').argv[0])`, { eval: true });
  const result = await new Promise(resolve => {
    worker.on("message", resolve);
    worker.on("error", resolve);
  });
  expect(result).toBe(Bun.argv[0]);
  await worker.terminate();
});

test("support require in eval for a file that doesnt exist", async () => {
  const worker = new Worker(`postMessage(require('./fixture-invalid.js').argv[0])`, { eval: true });
  const result = await new Promise(resolve => {
    worker.on("message", resolve);
    worker.on("error", resolve);
  });
  expect(result.toString()).toInclude(`error: Cannot find module './fixture-invalid.js' from 'blob:`);
  await worker.terminate();
});

test("support worker eval that throws", async () => {
  const worker = new Worker(`postMessage(throw new Error("boom"))`, { eval: true });
  const result = await new Promise(resolve => {
    worker.on("message", resolve);
    worker.on("error", resolve);
  });
  expect(result.toString()).toInclude("Unexpected throw");
  expect(result.name).toBe("SyntaxError");
  await worker.terminate();
});

describe("execArgv option", async () => {
  // this needs to be a subprocess to ensure that the parent's execArgv is not empty
  // otherwise we could not distinguish between the worker inheriting the parent's execArgv
  // vs. the worker getting a fresh empty execArgv
  async function run(execArgv: string, expected: string) {
    const proc = Bun.spawn({
      // pass --smol so that the parent thread has some known, non-empty execArgv
      cmd: [bunExe(), "--smol", "fixture-execargv.js", execArgv],
      env: bunEnv,
      cwd: __dirname,
    });
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(await proc.stdout.text()).toBe(expected);
  }

  it("inherits the parent's execArgv when falsy or unspecified", async () => {
    await run("null", '["--smol"]\n');
    await run("0", '["--smol"]\n');
  });
  it("provides empty execArgv when passed an empty array", async () => {
    // empty array should result in empty execArgv, not inherited from parent thread
    await run("[]", "[]\n");
  });
  it("can specify an array of strings", async () => {
    await run('["--no-warnings"]', '["--no-warnings"]\n');
  });
  // TODO(@190n) get our handling of non-string array elements in line with Node's
});

test("eval does not leak source code", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), "eval-source-leak-fixture.js"],
    env: bunEnv,
    cwd: __dirname,
    stderr: "pipe",
    stdout: "ignore",
  });
  await proc.exited;
  const errors = await proc.stderr.text();
  if (errors.length > 0) throw new Error(errors);
  expect(proc.exitCode).toBe(0);
});

describe("captured stdio backpressure", () => {
  // node flow control (lib/internal/worker/io.js): a writev batch's callback is
  // withheld until the reader acks (STDIO_WANTS_MORE_DATA), so 'drain' must not
  // fire while the parent is not consuming worker.stdout.
  test("stdout write completion is withheld until the parent reads", async () => {
    const worker = new Worker(
      `
      const { parentPort } = require("worker_threads");
      let drained = false;
      process.stdout.write(Buffer.alloc(1 << 20, 0x61));
      process.stdout.once("drain", () => {
        drained = true;
        // EOF so the parent can observe the byte count deterministically.
        process.stdout.end();
        parentPort.postMessage("drained");
      });
      parentPort.on("message", () => parentPort.postMessage({ drained }));
      `,
      { eval: true, stdout: true },
    );
    let onMessage: ((m: any) => void) | undefined;
    worker.on("message", m => onMessage?.(m));
    const nextMessage = () => new Promise(resolve => (onMessage = resolve));

    // Round-trip through the message port: by the time the worker answers it
    // has run its pending ticks, so a synchronous write completion (the old
    // no-flow-control behavior) would already have emitted 'drain'.
    let reply = nextMessage();
    worker.postMessage("check");
    expect(await reply).toEqual({ drained: false });

    // Start consuming: the reader ack releases the in-flight writev -> 'drain'.
    reply = nextMessage();
    let received = 0;
    const ended = new Promise(resolve => worker.stdout.on("end", resolve));
    worker.stdout.on("data", chunk => (received += chunk.length));
    expect(await reply).toBe("drained");
    await ended;
    expect(received).toBe(1 << 20);
    await worker.terminate();
  });

  test("large stdout survives writev batching and repeated acks", async () => {
    // Mixed string/Buffer writes; while one batch awaits its ack the rest queue
    // in the Writable and flush as multi-chunk writev batches.
    const worker = new Worker(
      `
      const chunk = "x".repeat(8 * 1024);
      let i = 0;
      (function writeMore() {
        while (i < 128) {
          i++;
          const ok = i % 2 ? process.stdout.write(chunk) : process.stdout.write(Buffer.from(chunk));
          if (!ok) {
            process.stdout.once("drain", writeMore);
            return;
          }
        }
        process.stdout.end();
      })();
      `,
      { eval: true, stdout: true },
    );
    let received = 0;
    for await (const data of worker.stdout) received += data.length;
    expect(received).toBe(128 * 8 * 1024);
    await worker.terminate();
  });

  // An unconsumed captured stream must not keep the worker (or parent) alive on its
  // own. Regression: the lazy message listener meant the worker's writev ack never
  // arrived, so its stdio port stayed ref'd and neither side could exit.
  test("captured stdio that is never consumed does not prevent exit", async () => {
    // One worker writing to both captured streams is enough to trip the hang.
    const script = `
      const { Worker } = require("node:worker_threads");
      const { once } = require("node:events");
      const src = [
        'process.stdout.write("o", () => require("node:worker_threads").parentPort.postMessage("cb"));',
        'process.stderr.write("e");',
      ].join("");
      const w = new Worker(src, { eval: true, stdout: true, stderr: true });
      // Touching the getter must not matter either.
      void w.stderr;
      void w.stdout;
      let cb = false;
      w.on("message", () => (cb = true));
      // The condition under test is "process exits on its own"; the watchdog turns
      // a hang into a fast, distinguishable failure instead of the suite timeout.
      w.on("online", () => setTimeout(() => process.exit(42), ${isDebug ? 20_000 : 5_000}).unref());
      const [code] = await once(w, "exit");
      // Data was pushed into the Readable buffer even though nothing consumed it,
      // and stays readable after the worker has exited.
      const out = w.stdout.read()?.toString() ?? null;
      const err = w.stderr.read()?.toString() ?? null;
      console.log(JSON.stringify({ code, cb, out, err }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      stdout: stdout.trim(),
      stderr: exitCode === 0 ? "" : stderr,
      exitCode,
      signalCode: proc.signalCode,
    }).toEqual({
      stdout: JSON.stringify({ code: 0, cb: true, out: "o", err: "e" }),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});

// A synchronous worker exit leaves no loop turns for the reader's ack to release
// the parked writev, so everything buffered behind it must be flushed from the
// worker's process 'exit' (node's flushSync).
describe("stdio is flushed when the worker exits synchronously", () => {
  const N = 300;

  test.each(["stdout", "stderr"] as const)("captured %s: console + raw write, then process.exit(0)", async name => {
    const method = name === "stdout" ? "log" : "error";
    const worker = new Worker(
      `for (let i = 0; i < ${N}; i++) {
         if (i % 2) console.${method}("W" + i); else process.${name}.write("W" + i + "\\n");
       }
       process.exit(0);`,
      { eval: true, stdout: true, stderr: true },
    );
    let out = "";
    worker[name].setEncoding("utf8").on("data", d => (out += d));
    const [code] = await once(worker, "exit");
    expect(out).toBe(Array.from({ length: N }, (_, i) => "W" + i + "\n").join(""));
    expect(code).toBe(0);
  });

  test.concurrent.each([
    ["process.exit", "process.exit(0);", 0],
    ["uncaught exception", 'throw new Error("boom");', 1],
    ["unhandled rejection", 'Promise.reject(new Error("boom"));', 1],
  ])("auto-piped stdout survives %s", async (_label, exit, expectedWorkerCode) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Worker } = require("node:worker_threads");
         const w = new Worker(${JSON.stringify(`for (let i = 0; i < ${N}; i++) console.log("W" + i);\n${exit}`)}, { eval: true });
         w.on("error", () => {});
         w.on("exit", c => console.error("[exit " + c + "]"));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(Array.from({ length: N }, (_, i) => "W" + i + "\n").join(""));
    expect(stderr).toBe(`[exit ${expectedWorkerCode}]\n`);
    expect(exitCode).toBe(0);
  });

  // Output buffered behind the parked batch is flushed first, then each write
  // from the user's 'exit' handler goes through synchronously; all of it arrives,
  // in order, before the parent's 'exit', and the exitCode the handler sets wins.
  test("buffered output, then 'exit' handler output, arrive in order; handler exitCode wins", async () => {
    const M = 200;
    const worker = new Worker(
      `process.on("exit", code => {
         for (let i = 0; i < ${M}; i++) process.stdout.write("L" + i + " " + code + " " + process._exiting + "\\n");
         process.exitCode = 42;
       });
       for (let i = 0; i < ${N}; i++) console.log("W" + i);
       process.exit(7);`,
      { eval: true, stdout: true },
    );
    let out = "";
    worker.stdout.setEncoding("utf8").on("data", d => (out += d));
    const [code] = await once(worker, "exit");
    expect(out).toBe(
      Array.from({ length: N }, (_, i) => "W" + i + "\n").join("") +
        Array.from({ length: M }, (_, i) => "L" + i + " 7 true\n").join(""),
    );
    expect(code).toBe(42);
  });

  // Same on an uncaught exception: the user's handler sees code 1 with _exiting
  // set, buffered + exit-time output arrives, and its exitCode wins (as in node).
  // Spawned so the test runner's unhandled-error hook doesn't intercept the
  // worker's uncaught exception.
  test.concurrent("user 'exit' handler on uncaught exception: output flushed and exitCode honored", async () => {
    const workerSrc = `process.on("exit", code => {
        process.stdout.write("exit handler " + code + " " + process._exiting + "\\n");
        process.exitCode = 42;
      });
      console.log("hello");
      throw new Error("boom");`;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Worker } = require("node:worker_threads");
         const w = new Worker(${JSON.stringify(workerSrc)}, { eval: true, stdout: true });
         let out = "";
         w.stdout.setEncoding("utf8").on("data", d => (out += d));
         w.on("error", e => console.log("error " + e.message));
         w.on("exit", c => console.log(JSON.stringify({ code: c, out })));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(`error boom\n${JSON.stringify({ code: 42, out: "hello\nexit handler 1 true\n" })}\n`);
    expect(exitCode).toBe(0);
  });
});

describe("worker event", () => {
  test("is emitted on the next tick with the right value", () => {
    const { promise, resolve } = Promise.withResolvers();
    let worker: Worker | undefined = undefined;
    let called = false;
    process.once("worker", eventWorker => {
      called = true;
      expect(eventWorker as any).toBe(worker);
      resolve();
    });
    worker = new Worker(new URL("data:text/javascript,"));
    expect(called).toBeFalse();
    return promise;
  });

  test("uses an overridden process.emit function", async () => {
    const previousEmit = process.emit;
    try {
      const { promise, resolve, reject } = Promise.withResolvers();
      let worker: Worker | undefined;
      // should not actually emit the event
      process.on("worker", expect.unreachable);
      worker = new Worker("", { eval: true });
      // should look up process.emit on the next tick, not synchronously during the Worker constructor
      (process as any).emit = (event, value) => {
        try {
          expect(event).toBe("worker");
          expect(value).toBe(worker);
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      await promise;
    } finally {
      process.emit = previousEmit;
      process.off("worker", expect.unreachable);
    }
  });

  test("throws if process.emit is not a function", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "emit-non-function-fixture.js"],
      env: bunEnv,
      cwd: __dirname,
      stderr: "pipe",
      stdout: "ignore",
    });
    await proc.exited;
    const errors = await proc.stderr.text();
    if (errors.length > 0) throw new Error(errors);
    expect(proc.exitCode).toBe(0);
  });
});

test("terminate() of a running, idle worker resolves 1 like Node", async () => {
  const worker = new Worker(
    `const { parentPort } = require("worker_threads"); parentPort.on("message", () => {}); parentPort.postMessage("ready");`,
    { eval: true },
  );
  await once(worker, "message");
  expect(await worker.terminate()).toBe(1);
});

describe("environmentData", () => {
  test("can pass a value to a child", async () => {
    setEnvironmentData("foo", new Map([["hello", "world"]]));
    const worker = new Worker(
      /* js */ `
      const { getEnvironmentData, parentPort } = require("worker_threads");
      parentPort.postMessage(getEnvironmentData("foo"));
    `,
      { eval: true },
    );
    const [msg] = await once(worker, "message");
    expect(msg).toEqual(new Map([["hello", "world"]]));
  });

  test("child modifications do not affect parent", async () => {
    const worker = new Worker('require("worker_threads").setEnvironmentData("does_not_exist", "foo")', { eval: true });
    const [code] = await once(worker, "exit");
    expect(code).toBe(0);
    expect(getEnvironmentData("does_not_exist")).toBeUndefined();
  });

  test("is deeply inherited", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "environmentdata-inherit-fixture.js"],
      env: bunEnv,
      cwd: __dirname,
      stderr: "pipe",
      stdout: "pipe",
    });
    await proc.exited;
    const errors = await proc.stderr.text();
    if (errors.length > 0) throw new Error(errors);
    expect(proc.exitCode).toBe(0);
    const out = await proc.stdout.text();
    expect(out).toBe("foo\n".repeat(5));
  });

  test("can be used if parent thread had not imported worker_threads", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "environmentdata-empty-fixture.js"],
      env: bunEnv,
      cwd: __dirname,
      stderr: "pipe",
      stdout: "ignore",
    });
    await proc.exited;
    const errors = await proc.stderr.text();
    if (errors.length > 0) throw new Error(errors);
    expect(proc.exitCode).toBe(0);
  });
});

describe("error event", () => {
  test("is fired with a copy of the error value", async () => {
    const worker = new Worker("throw new TypeError('oh no')", { eval: true });
    const [err] = await once(worker, "error");
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe("oh no");
  });

  test("falls back to string when the error cannot be serialized", async () => {
    const worker = new Worker(
      /* js */ `
      import { MessageChannel } from "node:worker_threads";
      const { port1 } = new MessageChannel();
      throw port1;`,
      { eval: true },
    );
    const [err] = await once(worker, "error");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/MessagePort \[EventTarget\] \{.*\}/s);
  });
});

describe("getHeapSnapshot", () => {
  test("throws if the wrong options are passed", () => {
    const worker = new Worker("", { eval: true });
    // @ts-expect-error
    expect(() => worker.getHeapSnapshot(0)).toThrow({
      name: "TypeError",
      message: 'The "options" argument must be of type object. Received type number (0)',
    });
    // @ts-expect-error
    expect(() => worker.getHeapSnapshot({ exposeInternals: 0 })).toThrow({
      name: "TypeError",
      message: 'The "options.exposeInternals" property must be of type boolean. Received type number (0)',
    });
    // @ts-expect-error
    expect(() => worker.getHeapSnapshot({ exposeNumericValues: 0 })).toThrow({
      name: "TypeError",
      message: 'The "options.exposeNumericValues" property must be of type boolean. Received type number (0)',
    });
  });

  // "entry throws" is omitted: under `bun test`, isBunTest makes a worker's
  // uncaught_exception return handled=true so spin() continues to
  // fireEarlyMessages (the call resolves with real data). Under `bun -e`
  // it rejects — see the test-worker-heapdump-failure.js vendored test for
  // subprocess coverage. A worker whose entry is not found takes the
  // shutdown() path directly, so it exercises the m_pendingTasks abandon drain
  // regardless.
  test("rejects ERR_WORKER_NOT_RUNNING when called before a worker that fails to start", async () => {
    const worker = new Worker("/nonexistent/__bun_worker_path__.js");
    worker.on("error", () => {});
    // Called immediately (m_state still Pending) so the task queues into
    // m_pendingTasks; dispatchExit drains it on the parent thread when the
    // worker never reaches Running and runs each abandon callback to reject.
    // Capture the rejection synchronously (.catch) — it fires inside the same
    // parent-side task that emits 'exit', so a later await would race the
    // unhandledRejection check.
    const captured = [
      worker.getHeapSnapshot().then(
        v => ({ resolved: v }),
        e => e,
      ),
      worker.getHeapStatistics().then(
        v => ({ resolved: v }),
        e => e,
      ),
      worker.cpuUsage().then(
        v => ({ resolved: v }),
        e => e,
      ),
      worker.startCpuProfile().then(
        v => ({ resolved: v }),
        e => e,
      ),
    ];
    for (const p of captured) {
      expect(await p).toMatchObject({ code: "ERR_WORKER_NOT_RUNNING" });
    }
  });

  test("queues while the worker is starting and rejects once it has exited", async () => {
    const worker = new Worker("require('worker_threads').parentPort.once('message', () => {})", { eval: true });
    // Called immediately after construction (m_state still Pending): node — and now
    // bun — queues into m_pendingTasks and resolves once the worker is Running,
    // instead of racing against dispatchOnline and spuriously rejecting.
    const pendingCall = worker.getHeapSnapshot();
    await once(worker, "online");
    await expect(pendingCall).resolves.toBeDefined();
    worker.postMessage("done");
    await once(worker, "exit");
    // After exit (m_state Closed) it rejects.
    await expect(worker.getHeapSnapshot()).rejects.toMatchObject({
      name: "Error",
      code: "ERR_WORKER_NOT_RUNNING",
      message: "Worker instance not running",
    });
  });

  test("resolves to a Stream.Readable with JSON text in V8 format", async () => {
    const worker = new Worker(
      /* js */ `
        import { parentPort } from "node:worker_threads";
        parentPort.on("message", () => process.exit(0));
      `,
      { eval: true },
    );
    await once(worker, "online");
    const stream = await worker.getHeapSnapshot();
    expect(stream).toBeInstanceOf(Readable);
    expect(stream.constructor.name).toBe("HeapSnapshotStream");
    const json = await new Promise<string>(resolve => {
      let json = "";
      stream.on("data", chunk => {
        json += chunk;
      });
      stream.on("end", () => {
        resolve(json);
      });
    });
    const object = JSON.parse(json);
    expect(Object.keys(object).toSorted()).toEqual([
      "edges",
      "locations",
      "nodes",
      "samples",
      "snapshot",
      "strings",
      "trace_function_infos",
      "trace_tree",
    ]);
    worker.postMessage(0);
  });
});

test("failed Worker construction restores transferred FileHandles", async () => {
  const dir = tmpdirSync("worker-fh-transfer");
  const file = join(dir, "x.txt");
  fs.writeFileSync(file, "hello");
  const fh = await fs.promises.open(file, "r");
  // Non-cloneable workerData makes the WebWorker constructor throw after the
  // FileHandle has already been neutered by the transfer machinery; the fd
  // must be restored so the handle stays usable.
  expect(() => {
    new Worker(file, { transferList: [fh as any], workerData: { fh, bad: () => {} } } as any);
  }).toThrow();
  const { bytesRead } = await fh.read(Buffer.alloc(5), 0, 5, 0);
  expect(bytesRead).toBe(5);
  await fh.close();
});

test("transferred FileHandles are not neutered when name/filename validation rejects", async () => {
  const dir = tmpdirSync("worker-fh-transfer");
  const file = join(dir, "x.txt");
  fs.writeFileSync(file, "hello");
  // ERR_WORKER_PATH (bare specifier): node validates filename before processing
  // the transferList, so the FileHandle is never touched.
  {
    const fh = await fs.promises.open(file, "r");
    expect(() => {
      new Worker("not/a/valid/worker/path", { workerData: { fh }, transferList: [fh as any] } as any);
    }).toThrow(expect.objectContaining({ code: "ERR_WORKER_PATH" }));
    expect(fh.fd).toBeGreaterThanOrEqual(0);
    const { bytesRead } = await fh.read(Buffer.alloc(5), 0, 5, 0);
    expect(bytesRead).toBe(5);
    await fh.close();
  }
  // ERR_INVALID_ARG_TYPE on truthy non-string options.name (node ignores falsy).
  {
    const fh = await fs.promises.open(file, "r");
    expect(() => {
      new Worker(file, { name: {} as any, workerData: { fh }, transferList: [fh as any] } as any);
    }).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(fh.fd).toBeGreaterThanOrEqual(0);
    await fh.close();
  }
});

test("worker name survives parent-side GC and terminate cycles", async () => {
  // options.name is materialized as a worker-heap JSString, so it must not
  // share a (possibly atomized) parent-heap StringImpl — both threads would
  // ref/deref a non-atomic refcount. Stress the path in a subprocess so
  // ASAN/debug assertions fail the test loudly.
  const fixture = `
    const { Worker } = require("node:worker_threads");
    const src = \`
      const { threadName, parentPort } = require("node:worker_threads");
      globalThis.keep = [];
      for (let i = 0; i < 50; i++) keep.push(threadName + i);
      keep.length = 0;
      Bun.gc(true);
      parentPort.postMessage(threadName);
    \`;
    for (let i = 0; i < 4; i++) {
      // Object.keys returns strings backed by atomized property-name impls.
      const holder = { ["workerNameStress" + i + "Abcdefghij"]: 1 };
      const name = Object.keys(holder)[0];
      const w = new Worker(src, { eval: true, name });
      const got = await new Promise((res, rej) => { w.on("message", res); w.on("error", rej); });
      if (got !== name) throw new Error("name mismatch: " + got);
      await w.terminate();
      Bun.gc(true);
    }
    console.log("done");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("done");
  expect(exitCode).toBe(0);
});

test("partially transferred FileHandles are restored when a later transfer throws", async () => {
  const dir = tmpdirSync("worker-fh-transfer");
  const file = join(dir, "x.txt");
  fs.writeFileSync(file, "hello");
  const fh1 = await fs.promises.open(file, "r");
  const fh2 = await fs.promises.open(file, "r");
  const pending = fh2.read(Buffer.alloc(5), 0, 5, 0); // fh2 is in use -> its transfer throws
  expect(() => {
    new Worker(file, { transferList: [fh1 as any, fh2 as any], workerData: { fh1, fh2 } } as any);
  }).toThrow(expect.objectContaining({ name: "DataCloneError" }));
  await pending;
  const { bytesRead } = await fh1.read(Buffer.alloc(5), 0, 5, 0);
  expect(bytesRead).toBe(5);
  await fh1.close();
  await fh2.close();
});

test("a FileHandle referenced twice in workerData deserializes to one instance", async () => {
  const dir = tmpdirSync("worker-fh-transfer");
  const file = join(dir, "x.txt");
  fs.writeFileSync(file, "hello");
  const script = join(dir, "w.mjs");
  fs.writeFileSync(
    script,
    `import { workerData, parentPort } from "worker_threads";
     const { a, b } = workerData;
     const same = a === b;
     await a.close();
     // b is the same handle, so it must be closed too (no stale second
     // instance wrapping an already-closed fd)
     const closed = b.fd === -1;
     parentPort.postMessage({ same, closed });`,
  );
  const fh = await fs.promises.open(file, "r");
  const worker = new Worker(script, { workerData: { a: fh, b: fh }, transferList: [fh as any] } as any);
  const [message] = await once(worker, "message");
  await worker.terminate();
  expect(message).toEqual({ same: true, closed: true });
});

test("duplicate FileHandle transferList entries throw DataCloneError and roll back", async () => {
  const dir = tmpdirSync("worker-fh-transfer");
  const file = join(dir, "x.txt");
  fs.writeFileSync(file, "hello");
  const fh = await fs.promises.open(file, "r");
  expect(() => {
    new Worker(file, { workerData: { fh }, transferList: [fh as any, fh as any] } as any);
  }).toThrow(expect.objectContaining({ name: "DataCloneError" }));
  // like node, the handle is still usable after the rejected transfer
  const { bytesRead } = await fh.read(Buffer.alloc(5), 0, 5, 0);
  expect(bytesRead).toBe(5);
  await fh.close();
});

test("a FileHandle in transferList but not in workerData is detached without leaking", async () => {
  const dir = tmpdirSync("worker-fh-transfer");
  const file = join(dir, "x.txt");
  fs.writeFileSync(file, "hello");
  const script = join(dir, "noop.mjs");
  fs.writeFileSync(script, `import { parentPort } from "worker_threads"; parentPort.postMessage("ok");`);
  const fh = await fs.promises.open(file, "r");
  const fd = fh.fd;
  const ino = fs.fstatSync(fd).ino;
  const worker = new Worker(script, { workerData: {}, transferList: [fh as any] } as any);
  const [message] = await once(worker, "message");
  expect(message).toBe("ok");
  await worker.terminate();
  // the parent handle is neutered like node...
  expect(fh.fd).toBe(-1);
  // ...and the orphaned fd was closed (not leaked). The number may have been
  // recycled by the worker machinery in the meantime, so accept either EBADF
  // or a descriptor that no longer refers to our file.
  let closedOrRecycled = false;
  try {
    closedOrRecycled = fs.fstatSync(fd).ino !== ino;
  } catch (e: any) {
    closedOrRecycled = e.code === "EBADF";
  }
  expect(closedOrRecycled).toBe(true);
});

test("failed construction restores an unreferenced transferred FileHandle intact", async () => {
  const dir = tmpdirSync("worker-fh-transfer");
  const file = join(dir, "x.txt");
  fs.writeFileSync(file, "hello");
  const fh = await fs.promises.open(file, "r");
  // workerData is non-cloneable, so WebWorker construction throws *after*
  // the handle was neutered; the rollback must hand back a live fd, not a
  // number that was already closed by the orphan-fd cleanup.
  expect(() => {
    new Worker(file, { workerData: () => {}, transferList: [fh as any] } as any);
  }).toThrow();
  const { bytesRead } = await fh.read(Buffer.alloc(5), 0, 5, 0);
  expect(bytesRead).toBe(5);
  await fh.close();
});

test("FileHandles nested in Map and Set workerData are transferred", async () => {
  const dir = tmpdirSync("worker-fh-transfer");
  const file = join(dir, "x.txt");
  fs.writeFileSync(file, "hello");
  const script = join(dir, "ms.mjs");
  fs.writeFileSync(
    script,
    `import { workerData, parentPort } from "worker_threads";
     const m = workerData.m.get("h");
     const s = [...workerData.s][0];
     const sameInstance = m === s;
     const { buffer, bytesRead } = await m.read(Buffer.alloc(5), 0, 5, 0);
     parentPort.postMessage({ sameInstance, text: buffer.toString("utf8", 0, bytesRead) });
     await m.close();`,
  );
  const fh = await fs.promises.open(file, "r");
  const worker = new Worker(script, {
    workerData: { m: new Map([["h", fh]]), s: new Set([fh]) },
    transferList: [fh as any],
  } as any);
  const [message] = await once(worker, "message");
  await worker.terminate();
  // parent side is neutered, worker read through the Map entry, and the Map
  // and Set entries deserialized to the same single instance
  expect(fh.fd).toBe(-1);
  expect(message).toEqual({ sameInstance: true, text: "hello" });
});

test("MessagePort.hasRef() reports actual loop-ref state", () => {
  const { port1 } = new MessageChannel();
  expect(port1.hasRef()).toBe(false);
  port1.on("message", () => {});
  expect(port1.hasRef()).toBe(true);
  port1.unref();
  expect(port1.hasRef()).toBe(false);
  port1.ref();
  expect(port1.hasRef()).toBe(true);
  port1.close();
});

// In a node worker only parentPort receives what the parent posts; the global
// scope's `self.onmessage` is not a channel there (as in node). Libraries that
// install both a parentPort listener and self.onmessage as a node/web shim
// must see one delivery, not two.
test("a parent message reaches parentPort only, not self.onmessage, in a node worker", async () => {
  const w = new Worker(
    `const { parentPort } = require("node:worker_threads");
     let count = 0;
     parentPort.on("message", () => { count++; });
     self.onmessage = () => { count += 100; };
     parentPort.on("message", () => setImmediate(() => parentPort.postMessage(count)));`,
    { eval: true },
  );
  w.postMessage("x");
  const [count] = await once(w, "message");
  await w.terminate();
  expect(count).toBe(1);
});

// node's setupPortReferencing tracks 'message' listeners only: a 'messageerror'
// handler alone neither starts the port nor keeps the loop alive.
test("onmessageerror alone does not ref the port", () => {
  const { port1 } = new MessageChannel();
  port1.onmessageerror = () => {};
  const errorOnly = port1.hasRef();
  port1.onmessage = () => {};
  const withMessage = port1.hasRef();
  port1.onmessage = null;
  expect({ errorOnly, withMessage, afterClearingMessage: port1.hasRef() }).toEqual({
    errorOnly: false,
    withMessage: true,
    afterClearingMessage: false,
  });
  port1.close();
});

// Collecting the unreferenced peer must not look like a peer close: node never
// closes a channel because a port was garbage-collected, so ref() still works.
test("hasRef() survives collection of the unreferenced peer", () => {
  const { port1 } = new MessageChannel(); // port2 unreachable from birth
  Bun.gc(true);
  Bun.gc(true);
  port1.on("message", () => {});
  const afterListener = port1.hasRef();
  port1.unref();
  port1.ref();
  expect({ afterListener, afterRefCycle: port1.hasRef() }).toEqual({ afterListener: true, afterRefCycle: true });
  port1.close();
});

// markAsUncloneable blocks *cloning*, not transfer: a marked port in the transfer
// list is moved, so node lets it through and it still works on the far side.
test("markAsUncloneable blocks cloning a port but not transferring it", async () => {
  const { port1, port2 } = new MessageChannel();
  const { port1: a, port2: b } = new MessageChannel();
  markAsUncloneable(a);

  // cloned (not in the transfer list) -> DataCloneError, like an unmarked plain object
  expect(() => port1.postMessage(a)).toThrow(expect.objectContaining({ name: "DataCloneError" }));
  const plain = {};
  markAsUncloneable(plain);
  expect(() => port1.postMessage(plain)).toThrow(expect.objectContaining({ name: "DataCloneError" }));

  const { promise, resolve } = Promise.withResolvers<unknown>();
  port2.on("message", received => {
    received.on("message", resolve);
    b.postMessage("through");
  });
  port1.postMessage(a, [a]);
  expect(await promise).toBe("through");

  port1.close();
  port2.close();
  b.close();
});

// postMessageToThread routes through a Map of thread -> port. A user-replaced
// Map.prototype must not be able to break cross-thread delivery.
test("postMessageToThread survives a tampered Map prototype", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const wt = require("worker_threads");
       const boom = n => function () { throw new Error("tampered " + n); };
       for (const n of ["get", "set", "delete", "has", "values", "keys", "forEach"]) {
         Map.prototype[n] = boom("Map." + n);
       }
       Object.defineProperty(Map.prototype, "size", { get: boom("Map.size"), configurable: true });
       Map.prototype[Symbol.iterator] = boom("Map[Symbol.iterator]");

       const w = new wt.Worker(
         \`const wt = require("worker_threads");
           wt.parentPort.on("message", async () => { await wt.postMessageToThread(0, "pong"); });\`,
         { eval: true },
       );
       process.on("workerMessage", v => {
         console.log(v);
         w.terminate();
       });
       w.postMessage("ping");`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("pong");
  expect(exitCode).toBe(0);
});

// The listener registry must not route through user-overridable Map/Set/WeakMap:
// not their methods, not the `size` getter, not their iterators. Spawned, because
// it clobbers prototypes and would poison the whole runner.
test("the listener registry survives tampered Map/Set/WeakMap prototypes", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { MessageChannel } = require("worker_threads");
       const boom = name => function () { throw new Error("tampered " + name); };
       for (const [C, names] of [
         [Map, ["get", "set", "delete", "has", "values", "keys", "entries", "forEach"]],
         [Set, ["add", "delete", "has", "values", "keys", "entries", "forEach"]],
         [WeakMap, ["get", "set", "has", "delete"]],
       ]) {
         for (const n of names) C.prototype[n] = boom(C.name + "." + n);
         Object.defineProperty(C.prototype, "size", { get: boom(C.name + ".size"), configurable: true });
         C.prototype[Symbol.iterator] = boom(C.name + "[Symbol.iterator]");
       }

       const { port1, port2 } = new MessageChannel();
       const fn = () => {};
       port1.on("message", fn);
       const c1 = port1.listenerCount("message");
       port1.once("close", () => {});
       const names = port1.eventNames().sort();
       port1.off("message", fn);
       const c2 = port1.listenerCount("message");
       port1.removeAllListeners();
       console.log(JSON.stringify({ c1, names, c2, after: port1.eventNames() }));
       port1.close();
       port2.close();`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(JSON.parse(stdout)).toEqual({ c1: 1, names: ["close", "message"], c2: 0, after: [] });
  expect(exitCode).toBe(0);
});

// EventTarget dedupes on (type, callback): the first registration of a listener
// wins outright, including its once-ness, and later adds of the same function
// are no-ops. Wrapping each add in a fresh closure defeated that.
test.each([
  ["on+on", (p, fn) => (p.on("message", fn), p.on("message", fn)), { count: 1, calls: 1, persists: true }],
  ["on+once", (p, fn) => (p.on("message", fn), p.once("message", fn)), { count: 1, calls: 1, persists: true }],
  ["once+on", (p, fn) => (p.once("message", fn), p.on("message", fn)), { count: 1, calls: 1, persists: false }],
  ["once+once", (p, fn) => (p.once("message", fn), p.once("message", fn)), { count: 1, calls: 1, persists: false }],
])("%s registers one listener, first-add wins", async (_name, setup, want) => {
  const { port1, port2 } = new MessageChannel();
  let calls = 0;
  const fn = () => calls++;
  setup(port1, fn);
  expect(port1.listenerCount("message")).toBe(want.count);

  port2.postMessage(1);
  for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r));
  expect(calls).toBe(want.calls);
  expect(port1.listenerCount("message")).toBe(want.persists ? 1 : 0);

  port1.off("message", fn);
  expect(port1.listenerCount("message")).toBe(0);
  port1.close();
  port2.close();
});

// off() used to resolve the wrapper through a single slot stamped on the user's
// function, so one listener shared across two events (or two ports) lost track.
test("off() removes only the listener it names, per event and per port", () => {
  const fn = () => {};
  {
    const { port1, port2 } = new MessageChannel();
    port1.on("message", fn);
    port1.on("close", fn);
    port1.off("message", fn);
    expect({ message: port1.listenerCount("message"), close: port1.listenerCount("close") }).toEqual({
      message: 0,
      close: 1,
    });
    port1.close();
    port2.close();
  }
  {
    const a = new MessageChannel();
    const b = new MessageChannel();
    a.port1.on("message", fn);
    b.port1.on("message", fn);
    a.port1.off("message", fn);
    expect({ a: a.port1.listenerCount("message"), b: b.port1.listenerCount("message") }).toEqual({ a: 0, b: 1 });
    a.port1.close();
    a.port2.close();
    b.port1.close();
    b.port2.close();
  }
});

// bun collects entangled ports; node never does. A worker that drops its transferred
// port must therefore still notify the peer, or the peer's loop ref is never released
// and the parent hangs forever. Spawned: the symptom is "the process never exits".
test("a collected port in a worker does not strand its peer", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Worker, MessageChannel } = require("worker_threads");
       const channel = new MessageChannel();
       new Worker(
         \`const { workerData } = require("worker_threads");
          workerData.messagePort.postMessage("Meow");
          workerData.messagePort = null;
          Bun.gc(true); Bun.gc(true);\`,
         { eval: true, workerData: { messagePort: channel.port2 }, transferList: [channel.port2] },
       );
       channel.port1.on("message", m => console.log(m));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // signalCode null => it exited on its own rather than being killed.
  expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "Meow",
    exitCode: 0,
    signalCode: null,
  });
});

// A peer that sends then closes before this side has any listener: node delivers the
// queued messages first and 'close' last, whichever listener was registered first.
// registerCloseContext()'s retroactive peer-Closed notify used to jump the queue.
test.each([
  ["close listener first", true],
  ["message listener first", false],
])("queued messages arrive before the peer's close (%s)", async (_name, closeFirst) => {
  const { port1, port2 } = new MessageChannel();
  port2.postMessage("m1");
  port2.postMessage("m2");
  port2.close();

  const events: string[] = [];
  if (closeFirst) {
    port1.on("close", () => events.push("close"));
    port1.on("message", m => events.push("msg:" + m));
  } else {
    port1.on("message", m => events.push("msg:" + m));
    port1.on("close", () => events.push("close"));
  }
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  expect(events).toEqual(["msg:m1", "msg:m2", "close"]);
  port1.close();
});

// An orphaned transferred endpoint IS a real close -- node fires 'close' on its peer.
test("dropping a transferred port notifies its peer", async () => {
  const { port1, port2 } = new MessageChannel();
  const { port1: a, port2: b } = new MessageChannel();
  const { promise, resolve } = Promise.withResolvers<void>();
  b.on("close", () => resolve());
  port1.postMessage(a, [a]); // queued in port2's inbox, never received
  port2.close(); // drops the queued message, orphaning `a`
  await promise;
  b.close();
  port1.close();
});

// close() outside a dispatch drops whatever is queued; close() from inside a
// 'message' handler lets the in-flight drain finish. Both are node's behaviour.
test("close() drops queued messages unless it runs inside a dispatch", async () => {
  {
    const { port1, port2 } = new MessageChannel();
    let got = 0;
    port2.on("message", () => got++);
    port1.postMessage("x");
    port2.close(); // sync close before the first drain
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    expect(got).toBe(0);
    port1.close();
  }
  {
    const { port1, port2 } = new MessageChannel();
    const seen: number[] = [];
    port2.on("message", m => {
      seen.push(m);
      if (m === 1) port2.close();
    });
    port1.postMessage(1);
    port1.postMessage(2);
    port1.postMessage(3);
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    expect(seen).toEqual([1, 2, 3]);
    port1.close();
  }
});

// node reports every bad transfer-list entry the same way, from both the array
// overload and the options bag, and accepts any iterable -- not just arrays.
describe("postMessage transfer list", () => {
  const dataClone = expect.objectContaining({ name: "DataCloneError", code: 25 });

  test.each([
    ["array, number", p => p.postMessage({}, [5])],
    ["array, string", p => p.postMessage({}, ["x"])],
    ["array, plain object", p => p.postMessage({}, [{}])],
    ["bag, number", p => p.postMessage({}, { transfer: [5] })],
    ["bag, plain object", p => p.postMessage({}, { transfer: [{}] })],
    ["bag, Set", p => p.postMessage({}, { transfer: new Set([5]) })],
    [
      "bag, generator",
      p =>
        p.postMessage(
          {},
          {
            transfer: (function* () {
              yield 5;
            })(),
          },
        ),
    ],
  ])("%s throws DataCloneError", (_name, post) => {
    const { port1, port2 } = new MessageChannel();
    expect(() => post(port1)).toThrow(dataClone);
    expect(() => post(port1)).toThrow("Found invalid value in transferList.");
    port1.close();
    port2.close();
  });

  // A genuinely non-iterable transfer arg is still ERR_INVALID_ARG_TYPE, not DataCloneError.
  test.each([
    ["second arg", p => p.postMessage({}, 5)],
    ["bag number", p => p.postMessage({}, { transfer: 5 })],
    ["bag plain object", p => p.postMessage({}, { transfer: {} })],
  ])("%s throws ERR_INVALID_ARG_TYPE", (_name, post) => {
    const { port1, port2 } = new MessageChannel();
    expect(() => post(port1)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    port1.close();
    port2.close();
  });

  test("an iterable that throws propagates the user error unchanged", () => {
    const { port1, port2 } = new MessageChannel();
    expect(() =>
      port1.postMessage(
        {},
        {
          transfer: {
            *[Symbol.iterator]() {
              throw new Error("user boom");
            },
          },
        },
      ),
    ).toThrow("user boom");
    port1.close();
    port2.close();
  });

  test("valid transferables still transfer", async () => {
    const ab = new ArrayBuffer(8);
    const { port1, port2 } = new MessageChannel();
    port1.postMessage(ab, [ab]);
    expect(ab.byteLength).toBe(0);

    const { port1: a, port2: b } = new MessageChannel();
    const { promise, resolve } = Promise.withResolvers<unknown>();
    port2.on("message", received => {
      if (received?.on) {
        received.on("message", resolve);
        b.postMessage("hi");
      }
    });
    port1.postMessage(a, [a]);
    expect(await promise).toBe("hi");
    port1.close();
    port2.close();
    b.close();
  });
});

test("MessagePort NodeEventTarget methods", () => {
  const { port1 } = new MessageChannel();
  expect(typeof port1.listenerCount).toBe("function");
  expect(typeof port1.eventNames).toBe("function");
  expect(typeof port1.removeAllListeners).toBe("function");
  expect(typeof port1.getMaxListeners).toBe("function");
  expect(typeof port1.setMaxListeners).toBe("function");
  expect((port1 as any).prependListener).toBeUndefined();
  expect((port1 as any).prependOnceListener).toBeUndefined();
  const fn = () => {};
  port1.on("message", fn);
  expect(port1.listenerCount("message")).toBe(1);
  expect(port1.eventNames()).toContain("message");
  port1.removeAllListeners("message");
  expect(port1.listenerCount("message")).toBe(0);
  port1.close();
});

// jsRef() only gated on m_isDetached, so .ref()/onmessage= after the peer closed
// re-took an event-loop ref that nothing releases and the process hung. Node no-ops
// both. Spawned, because the symptom is "the process never exits".
test("ref()/onmessage after the peer closes does not pin the loop", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { MessageChannel } = require("worker_threads");
       const { port1, port2 } = new MessageChannel();
       port1.on("message", () => {});
       port1.on("close", () => {
         setImmediate(() => {
           port1.ref();
           port1.onmessage = () => {};
           console.log("hasRef=" + port1.hasRef());
         });
       });
       port2.close();`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // signalCode null ⇒ it exited on its own rather than being killed by a timeout.
  expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "hasRef=false",
    exitCode: 0,
    signalCode: null,
  });
});

// EventTarget removes a {once:true} listener natively, so the JS-side registry
// backing listenerCount()/eventNames() has to drop it too.
test("a fired once() listener stops being counted", async () => {
  const { port1, port2 } = new MessageChannel();
  let fired = 0;
  port1.once("message", () => fired++);
  expect(port1.listenerCount("message")).toBe(1);
  port2.postMessage(1);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  expect({ fired, count: port1.listenerCount("message"), named: port1.eventNames().includes("message") }).toEqual({
    fired: 1,
    count: 0,
    named: false,
  });
  port1.close();
  port2.close();
});

// once() re-points listener[wrappedListener] at the self-purging wrapper, so
// off() must still find it through the user's original function.
test("off() removes a pending once() listener", () => {
  const { port1, port2 } = new MessageChannel();
  const fn = () => {};
  port1.once("message", fn);
  expect(port1.listenerCount("message")).toBe(1);
  port1.off("message", fn);
  expect(port1.listenerCount("message")).toBe(0);
  port1.close();
  port2.close();
});

test("close(cb) interleaves with other close listeners in registration order", async () => {
  // node's mechanism is `this.once('close', cb)`, so cb interleaves with other
  // close listeners in the order they were registered (verified against node).
  const { port1 } = new MessageChannel();
  const order: string[] = [];
  port1.on("close", () => order.push("A"));
  port1.close(() => order.push("B"));
  port1.on("close", () => order.push("C"));
  order.push("sync");
  await new Promise(r => setImmediate(() => setImmediate(r)));
  expect(order).toEqual(["sync", "A", "B", "C"]);

  // A listener added AFTER close(cb) fires after cb.
  const { port1: p2 } = new MessageChannel();
  const order2: string[] = [];
  p2.close(() => order2.push("B"));
  p2.on("close", () => order2.push("C"));
  await new Promise(r => setImmediate(() => setImmediate(r)));
  expect(order2).toEqual(["B", "C"]);
});

test("getHeapStatistics settles when terminated mid-request", async () => {
  const w = new Worker("setInterval(() => {}, 1e6)", { eval: true });
  await once(w, "online");
  const p = w.getHeapStatistics();
  await w.terminate();
  // Either resolves (round-trip completed first) or rejects with ERR_WORKER_NOT_RUNNING; never hangs.
  await expect(
    p.then(
      () => "ok",
      e => e?.code,
    ),
  ).resolves.toMatch(/^(ok|ERR_WORKER_NOT_RUNNING)$/);
});

test("*Internal introspection methods are DontEnum on Worker.prototype", () => {
  const enumerable: string[] = [];
  for (const k in globalThis.Worker.prototype) enumerable.push(k);
  expect(enumerable).not.toContain("startCpuProfileInternal");
  expect(enumerable).not.toContain("stopCpuProfileInternal");
  expect(enumerable).not.toContain("cpuUsageInternal");
});

test("env: process.env reads in a worker module are evaluated at runtime against the worker's env", async () => {
  using dir = tempDir("worker-threads-env-runtime-reads", {
    "worker.js": `
      const { parentPort } = require("node:worker_threads");
      const inherited = process.env.BUN_TEST_WT_ENV_KEY;
      process.env["BUN_TEST_WT_ENV_KEY"] = "assigned-in-worker";
      const assigned = process.env.BUN_TEST_WT_ENV_KEY;
      parentPort.postMessage({ inherited, assigned, nodeEnv: process.env.NODE_ENV });
    `,
    "main.js": `
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(require("node:path").join(__dirname, "worker.js"), {
        env: { BUN_TEST_WT_ENV_KEY: "from-worker-option", NODE_ENV: "production" },
      });
      worker.on("error", err => { console.error(err); process.exit(1); });
      worker.on("message", msg => {
        console.log(JSON.stringify(msg));
        worker.terminate();
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: { ...bunEnv, BUN_TEST_WT_ENV_KEY: "from-parent-process", NODE_ENV: "development" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    message: stdout ? JSON.parse(stdout) : stdout,
    stderr: exitCode === 0 ? "" : stderr,
    exitCode,
  }).toEqual({
    message: { inherited: "from-worker-option", assigned: "assigned-in-worker", nodeEnv: "production" },
    stderr: "",
    exitCode: 0,
  });
});

describe("env: SHARE_ENV shares the spawning thread's env, not a process-wide one", () => {
  async function run(mode: string) {
    const proc = Bun.spawn({
      cmd: [bunExe(), "fixture-share-env-tree.js", mode],
      env: bunEnv,
      cwd: __dirname,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Surface the fixture's own error output when it fails, but don't require an
    // empty stderr: ASAN/debug lanes emit benign warnings there.
    expect({ mode, exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ mode, exitCode: 0, stderr: "" });
    return JSON.parse(stdout);
  }

  // main -> A (snapshot env) -> B (SHARE_ENV) is a tree disjoint from
  // main -> C (SHARE_ENV); values must not cross between them.
  it("keeps disjoint SHARE_ENV chains isolated", async () => {
    expect(await run("tree")).toEqual({
      B_sees_FROM_A: "a",
      B_sees_FROM_MAIN: "main",
      A_sees_FROM_B: "b",
      C_sees_FROM_B: null,
      C_sees_FROM_MAIN: "main",
      main_sees_FROM_B: null,
      main_sees_FROM_C: "c",
    });
  });

  // Founding a store must not adopt another tree's value for a key the founding
  // thread already has.
  it("does not clobber a worker's own env when it founds a store", async () => {
    expect(await run("clobber")).toEqual({
      A_SHARED_KEY_before: "from-A",
      A_SHARED_KEY_after: "from-A",
      B_sees_SHARED_KEY: "from-A",
      main_SHARED_KEY: "from-main",
    });
  });

  // Node's EnvDefiner rejects an accessor descriptor on process.env for every env
  // store, so the SHARE_ENV map must answer exactly like the regular one. An
  // accessor is also unrepresentable here: it would land on the base object while
  // reads hit the store first, so the getter would be silently shadowed.
  it("rejects an accessor defined on process.env, on both the regular and shared map", async () => {
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Worker, SHARE_ENV } = require("worker_threads");
         const probe = \`process.env.FOO = "old";
           let err = null;
           try {
             Object.defineProperty(process.env, "FOO", { get: () => "new", configurable: true });
           } catch (e) {
             err = { code: e.code, name: e.constructor.name, message: e.message };
           }
           ({ err, read: process.env.FOO })\`;
         const regular = eval(probe);
         const w = new Worker(
           'const { parentPort } = require("worker_threads"); parentPort.postMessage(eval(' + JSON.stringify(probe) + '));',
           { eval: true, env: SHARE_ENV },
         );
         w.on("message", shared => console.log(JSON.stringify({ regular, shared })));
         // Surface a worker that dies before posting, instead of exiting 0 with
         // no output and reporting as an unrelated JSON parse error.
         w.on("error", e => { console.error("worker error: " + (e && e.stack || e)); process.exit(1); });
         w.on("exit", code => { if (code !== 0) { console.error("worker exited " + code); process.exit(1); } });`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Same code/class/message node v26.3.0 throws; the assignment stands unchanged.
    const want = {
      err: {
        code: "ERR_INVALID_OBJECT_DEFINE_PROPERTY",
        name: "TypeError",
        message: "'process.env' does not accept an accessor(getter/setter) descriptor",
      },
      read: "old",
    };
    // One combined object so a dead child shows its stderr and exit code rather
    // than surfacing as a parse error on empty stdout.
    expect({ parsed: stdout ? JSON.parse(stdout) : stdout, stderr, exitCode }).toEqual({
      parsed: { regular: want, shared: want },
      stderr: "",
      exitCode: 0,
    });
  });

  // node roots a main-founded SHARE_ENV tree at its RealEnvStore, so a worker writing
  // through it reaches the real environment a child process inherits; a snapshot
  // worker's store is private and never does. (child_process enumerates the JS
  // process.env, so this checks the store, not the OS environment.)
  it.each([
    ["SHARE_ENV", "written-by-worker"],
    ["snapshot", "absent"],
  ])("a %s worker's env write is %s to a child process", async (mode, want) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Worker, SHARE_ENV, isMainThread, parentPort } = require("worker_threads");
         const { execFileSync } = require("child_process");
         if (isMainThread) {
           const opts = ${JSON.stringify(mode)} === "SHARE_ENV" ? { env: SHARE_ENV, eval: true } : { eval: true };
           const w = new Worker('process.env.FROM_WORKER = "written-by-worker";', opts);
           w.on("exit", () => {
             // no env option: the child inherits the parent's environment
             const out = execFileSync(process.execPath, ["-e", "console.log(process.env.FROM_WORKER ?? 'absent')"], {
               encoding: "utf8",
             }).trim();
             console.log(out);
           });
         }`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe(want);
    expect(exitCode).toBe(0);
  });

  // Integer-like keys reach JSC through the indexed hooks; without ByIndex overrides
  // they land in JSObject's indexed storage and never touch the shared store.
  it("routes integer-like env keys through the shared store", async () => {
    expect(await run("indexed")).toEqual({
      worker_sees_123: "from-main",
      worker_keys_numeric: ["123", "456"],
      main_sees_456: "from-worker",
      main_sees_123: "from-main",
      main_sees_7_after_delete: null,
    });
  });

  // Two SHARE_ENV children of one thread alias a single store: writes, deletes and
  // enumeration cross between them, and a default-env grandchild snapshots it.
  it("aliases one store across siblings, deletes and enumeration", async () => {
    expect(await run("siblings")).toEqual({
      s2_sees_S1_write: "s1",
      s2_sees_TO_DELETE: null,
      s2_keys_have_FROM_S1: true,
      grandchild_sees_S1_write: "s1",
      main_sees_FROM_S1: "s1",
      main_sees_TO_DELETE: null,
    });
  });

  // Founding a tree replaces process.env; Bun.env is reified from the same object
  // at startup and must not be left observing the orphaned pre-swap env.
  it("keeps Bun.env pointing at process.env after founding a tree", async () => {
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Worker, SHARE_ENV } = require("worker_threads");
         Bun.env.HOME;
         const w = new Worker("require('worker_threads').parentPort.postMessage(1)", { eval: true, env: SHARE_ENV });
         w.on("exit", () => {
           process.env.AFTER = "x";
           console.log(JSON.stringify({ same: Bun.env === process.env, bunEnv: Bun.env.AFTER ?? null }));
         });`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual({ same: true, bunEnv: "x" });
    expect(exitCode).toBe(0);
  });
});

test("postMessage with a non-object transfer element throws DataCloneError", () => {
  // Both the array-form and options-bag paths converge on Node's
  // DataCloneError, not TypeError / ERR_INVALID_ARG_TYPE.
  const { port1 } = new MessageChannel();
  for (const args of [
    [{}, [5]],
    [{}, { transfer: [5] }],
  ] as const) {
    let err: any;
    try {
      port1.postMessage(...args);
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ name: "DataCloneError", code: 25 });
    expect(err.message).toContain("Found invalid value in transferList");
  }
  port1.close();
});

test("MessageEvent ports validation walks the iterator once and gives a detailed error for any iterable", () => {
  expect(() => new MessageEvent("message", { ports: new Set([{}]) })).toThrow(
    /Expected eventInitDict\.ports\[0\] \("\{\}"\) to be an instance of MessagePort/,
  );
  expect(
    () =>
      new MessageEvent("message", {
        ports: (function* () {
          yield {};
        })(),
      }),
  ).toThrow(/Expected eventInitDict\.ports\[0\]/);
  const { port1 } = new MessageChannel();
  const traps: string[] = [];
  const proxy = new Proxy([port1], { get: (t, k) => (traps.push(String(k)), (t as any)[k]) });
  expect(() => new MessageEvent("message", { ports: proxy })).not.toThrow();
  // Symbol.iterator is read exactly once.
  expect(traps.filter(k => k.includes("Symbol")).length).toBe(1);
  port1.close();
});

test("MessagePort: transferring a port from inside its own close()'s flush window throws DataCloneError", async () => {
  // Queue two messages. The first handler calls A.close(); close()'s flush
  // (running because m_inMessageDispatch is true) delivers the second, whose
  // handler tries to transfer A. A is m_isClosing at that point, so the
  // transfer path rejects it with DataCloneError.
  const { port1: A, port2: A2 } = new MessageChannel();
  const { port1: B1, port2: B2 } = new MessageChannel();
  let err: any;
  let done!: () => void;
  const p = new Promise<void>(r => (done = r));
  let n = 0;
  A.on("message", () => {
    n++;
    if (n === 1) {
      A.close();
      done();
    } else {
      try {
        B1.postMessage(null, [A]);
      } catch (e) {
        err = e;
      }
    }
  });
  A2.postMessage("first");
  A2.postMessage("second");
  await p;
  expect(err).toMatchObject({ name: "DataCloneError" });
  let b2Got = false;
  B2.on("message", () => (b2Got = true));
  await new Promise(r => setImmediate(() => setImmediate(r)));
  expect(b2Got).toBe(false);
  B1.close();
  B2.close();
});

test("MessagePort: peer closing while a port is in transit still delivers 'close' and doesn't hang", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Worker } = require("worker_threads");
       const { port1, port2 } = new MessageChannel();
       const w = new Worker(
         \`require("worker_threads").parentPort.once("message", ({ port }) => {
            port.on("message", () => {});
            port.on("close", () => require("worker_threads").parentPort.postMessage("closed"));
          });\`,
         { eval: true },
       );
       w.on("message", m => { console.log(m); w.unref(); });
       w.on("online", () => {
         w.postMessage({ port: port2 }, [port2]);
         // Peer closes while port2 is in transit (worker hasn't attached yet).
         port1.close();
       });`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "closed",
    stderr,
    exitCode: 0,
    signalCode: null,
  });
});

test("workerData is not unwrapped for a non-node globalThis.Worker", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const src = 'const wt = require("worker_threads"); self.postMessage({ workerData: wt.workerData });';
       const url = URL.createObjectURL(new Blob([src]));
       const w = new globalThis.Worker(url, { workerData: { "@@bunWorkerThreadsMessaging": {}, data: 1 } });
       w.onerror = e => { console.error(e.message || e); process.exit(1); };
       w.onmessage = e => { console.log(JSON.stringify(e.data)); w.terminate(); };`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const out = JSON.parse(stdout);
  // The unwrap block was skipped: workerData is the original object, not `.data`.
  expect({ workerData: out.workerData, stderr, exitCode }).toEqual({
    workerData: { "@@bunWorkerThreadsMessaging": {}, data: 1 },
    stderr,
    exitCode: 0,
  });
});

// process.debugPort defaults to 9229 on the main thread (node parity). Lives here, not
// in the vendored test/js/node/test/parallel/test-set-process-debug-port.js, which should
// stay byte-identical to upstream.
test("process.debugPort defaults to 9229 on the main thread", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(process.debugPort)"],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("9229");
  expect(exitCode).toBe(0);
});

// Founding a SHARE_ENV tree replaces the founding thread's process.env object. If the
// replacement were orphaned, the founder's later writes would go nowhere. child_process
// enumerates the JS process.env (a var deleted from the map is invisible to the child),
// so this guards the swap -- it cannot observe Windows' SetEnvironmentVariableW, which
// has no JS-visible reader.

test("the SHARE_ENV founding thread's process.env stays live after the swap", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Worker, SHARE_ENV } = require("worker_threads");
       const cp = require("child_process");
       new Worker("1", { eval: true, env: SHARE_ENV }).on("exit", () => {
         process.env.BUN_SHARE_ENV_SET = "yes";
         process.env.BUN_SHARE_ENV_DEL = "yes";
         delete process.env.BUN_SHARE_ENV_DEL;
         const out = cp
           .execFileSync(process.execPath, [
             "-e",
             "process.stdout.write((process.env.BUN_SHARE_ENV_SET || 'unset') + ',' + (process.env.BUN_SHARE_ENV_DEL || 'unset'))",
           ])
           .toString();
         console.log(out);
       });`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("yes,unset");
  expect(exitCode).toBe(0);
});

test("terminating a worker stops the workers it spawned", async () => {
  // The leaf heartbeats to the main thread over a MessagePort routed through the
  // middle worker. Terminating the middle worker must stop the leaf, which the main
  // thread observes as its end of the channel closing.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { Worker, MessageChannel } = require("worker_threads");
        const { port1, port2 } = new MessageChannel();
        const middle = new Worker(
          \`const { Worker, workerData, parentPort } = require("worker_threads");
           const leaf = new Worker(
             'const { workerData } = require("worker_threads");' +
             'setInterval(() => workerData.port.postMessage("beat"), 5);',
             { eval: true, workerData: { port: workerData.port }, transferList: [workerData.port] });
           leaf.on("online", () => parentPort.postMessage("leaf-online"));\`,
          { eval: true, workerData: { port: port2 }, transferList: [port2] },
        );
        let beats = 0;
        port1.on("message", () => { beats++; });
        middle.on("message", async m => {
          if (m !== "leaf-online") return;
          while (beats === 0) await new Promise(r => setImmediate(r));
          port1.on("close", () => {
            console.log("leaf port closed");
            port1.close();
          });
          await middle.terminate();
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("leaf port closed");
  expect(exitCode).toBe(0);
});

// parentPort is a real MessagePort entangled with the parent Worker's public
// port, so it follows Node's lifecycle: a 'message' listener keeps the thread
// alive, and close()/unref() let it exit.
test("parentPort.close() ends a worker that is only listening for messages", async () => {
  const w = new Worker(
    `const { parentPort } = require("worker_threads");
     parentPort.on("message", m => { parentPort.postMessage("got " + m); if (m === "close") parentPort.close(); });`,
    { eval: true },
  );
  const messages: string[] = [];
  w.on("message", m => messages.push(m));
  const exited = new Promise<number>(resolve => w.on("exit", resolve));
  w.postMessage("hello");
  w.postMessage("close");
  expect(await exited).toBe(0);
  expect(messages).toEqual(["got hello", "got close"]);
});

test("parentPort.unref() lets a listening worker exit", async () => {
  const w = new Worker(
    `const { parentPort } = require("worker_threads");
     parentPort.on("message", () => {});
     parentPort.unref();`,
    { eval: true },
  );
  const exited = new Promise<number>(resolve => w.on("exit", resolve));
  expect(await exited).toBe(0);
});

test("receiveMessageOnPort distinguishes an undefined message from an empty queue", () => {
  const { port1, port2 } = new MessageChannel();
  port1.postMessage(undefined);
  port1.postMessage(0);
  expect(receiveMessageOnPort(port2)).toEqual({ message: undefined });
  expect(receiveMessageOnPort(port2)).toEqual({ message: 0 });
  expect(receiveMessageOnPort(port2)).toBeUndefined();
  port1.close();
  port2.close();
});

// A message the parent posts at construction is delivered only after the
// worker's entry module has evaluated (Node's ordering). Delivered early, an
// uncaught throw from the listener raced the still-loading entry and the exit
// handler's exitCode was overwritten.
test("parent messages are delivered after the worker's entry evaluated; exit handler's exitCode wins", async () => {
  const w = new Worker(
    `const { parentPort } = require("worker_threads");
     parentPort.once("message", () => {
       process.on("exit", () => { process.exitCode = 0; });
       throw new Error("ok");
     });`,
    { eval: true },
  );
  const errors: string[] = [];
  w.on("error", e => errors.push(e.message));
  const exited = new Promise<number>(resolve => w.on("exit", resolve));
  w.postMessage(0);
  expect(await exited).toBe(0);
  expect(errors).toEqual(["ok"]);
});

// node: assigning a non-function to parentPort.onmessage clears the handler and
// releases the ref the previous handler took, so the worker can exit.
test("parentPort.onmessage = <not a function> lets the worker exit", async () => {
  const w = new Worker(
    `const { parentPort } = require("worker_threads");
     parentPort.onmessage = () => { throw new Error("must not be called"); };
     parentPort.onmessage = "fhqwhgads";`,
    { eval: true },
  );
  const exited = new Promise<number>(resolve => w.on("exit", resolve));
  w.postMessage(2);
  expect(await exited).toBe(0);
});

// #15408: a worker whose top-level await has not settled is started (Node) —
// its parentPort listener registered before the await receives messages, and
// the await keeps running in the normal event loop.
test("parentPort messages are delivered while a top-level await is pending", async () => {
  const w = new Worker(
    `import { parentPort } from "worker_threads";
     parentPort.on("message", m => { parentPort.postMessage("got " + m); if (m === "bye") process.exit(0); });
     await new Promise(() => {});`,
    { eval: true },
  );
  const replies: string[] = [];
  w.on("message", m => {
    replies.push(m);
    if (m === "got hi") w.postMessage("bye");
  });
  const exited = new Promise<number>(resolve => w.on("exit", resolve));
  w.postMessage("hi");
  expect(await exited).toBe(0);
  expect(replies).toEqual(["got hi", "got bye"]);
});

// parentPort is a MessagePort: it queues what the parent posts until a 'message' listener is
// attached, and again while none is, as in Node — unlike the Web Worker global scope, which drops
// a message dispatched while it has no handler (#40141). A second MessagePort is the gate: the
// parent posts everything, then says "go", so the listener is attached strictly afterwards.
describe("parentPort queues messages until a 'message' listener is attached", () => {
  async function run(workerSrc: string, batch: unknown[]) {
    const { port1, port2 } = new MessageChannel();
    const w = new Worker(workerSrc, { eval: true, workerData: { gate: port2 }, transferList: [port2] });
    w.postMessage("early");
    const replies: unknown[] = [];
    w.on("message", m => {
      if (m !== "started") return replies.push(m);
      for (const item of batch) w.postMessage(item);
      port1.postMessage("go");
    });
    const [code] = await once(w, "exit");
    port1.close();
    return { replies, code };
  }

  test("listener attached after a top-level await", async () => {
    const { replies, code } = await run(
      `import { parentPort, workerData } from "worker_threads";
       parentPort.postMessage("started");
       await new Promise(resolve => workerData.gate.once("message", resolve));
       parentPort.on("message", m => { parentPort.postMessage("got " + m); if (m === 2) process.exit(0); });`,
      [0, 1, 2],
    );
    expect(replies).toEqual(["got early", "got 0", "got 1", "got 2"]);
    expect(code).toBe(0);
  });

  // All five are queued before the first listener exists, so one drain batch holds them; removing
  // the listener after the first must put the rest back, in order, for the next one.
  test("removing the last listener pauses delivery until one is attached again", async () => {
    const { replies, code } = await run(
      `import { parentPort, workerData } from "worker_threads";
       const first = m => { parentPort.postMessage("first:" + m); parentPort.off("message", first); setImmediate(() => parentPort.on("message", second)); };
       const second = m => { parentPort.postMessage("second:" + m); if (m === 3) process.exit(0); };
       parentPort.postMessage("started");
       await new Promise(resolve => workerData.gate.once("message", resolve));
       parentPort.on("message", first);`,
      [0, 1, 2, 3],
    );
    expect(replies).toEqual(["first:early", "second:0", "second:1", "second:2", "second:3"]);
    expect(code).toBe(0);
  });
});

// A top-level await that rejects while other work keeps the loop alive fails the
// worker at rejection time (Node), not when the loop eventually drains.
// (Subprocess: inside `bun test` a worker's uncaught error counts as handled.)
test("a top-level await rejecting while the loop is alive fails the worker then", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Worker } = require("worker_threads");
       const w = new Worker(
         'setInterval(() => {}, 1000); await new Promise((_, reject) => setTimeout(() => reject(new Error("late")), 5));',
         { eval: true },
       );
       w.on("error", e => console.log("error: " + e.message));
       w.on("exit", c => console.log("exit " + c));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("error: late\nexit 1\n");
  expect(exitCode).toBe(0);
});

// Static imports that are still being read/transpiled are loading, not a
// top-level await: message delivery waits for the graph to execute.
test("a file worker's static imports load before it counts as started", async () => {
  using dir = tempDir("worker-static-import-start", {
    "dep.js": `export const listeners = [];\n${"// filler\n".repeat(2000)}`,
    "w.js": `import { listeners } from "./dep.js";
import { parentPort } from "worker_threads";
parentPort.on("message", m => parentPort.postMessage("got " + m + " " + listeners.length));`,
  });
  const w = new Worker(join(String(dir), "w.js"));
  const reply = new Promise<string>(resolve => w.on("message", resolve));
  w.postMessage("hi");
  expect(await reply).toBe("got hi 0");
  await w.terminate();
});

// node posts 'online' before it evaluates the entry, so it always precedes a
// message the entry's top-level code posts (#41375: @discordjs/ws attaches its
// 'message' listener only after `once(worker, "online")`).
describe("'online' precedes the worker's first message", () => {
  test("in event order", async () => {
    const w = new Worker(`require("worker_threads").parentPort.postMessage("ready")`, { eval: true });
    const order: string[] = [];
    w.on("online", () => order.push("online"));
    w.on("message", m => order.push("message:" + m));
    const [code] = await once(w, "exit");
    expect(order).toEqual(["online", "message:ready"]);
    expect(code).toBe(0);
  });

  test("a 'message' listener attached after 'online' sees it", async () => {
    const w = new Worker(`require("worker_threads").parentPort.postMessage("ready")`, { eval: true });
    await once(w, "online");
    const ready = new Promise<string>(resolve => w.on("message", resolve));
    const exited = once(w, "exit").then(() => "exited first");
    expect(await Promise.race([ready, exited])).toBe("ready");
    await exited;
  });

  test("a worker whose entry does not resolve reports 'online' then 'error'", async () => {
    using dir = tempDir("worker-online-missing-entry", {});
    const w = new Worker(join(String(dir), "missing.js"));
    const order: string[] = [];
    w.on("online", () => order.push("online"));
    w.on("error", e => order.push("error:" + (e as any).code));
    // not events.once(): it rejects on the 'error' event this test expects
    const code = await new Promise<number>(resolve => w.on("exit", resolve));
    expect(order).toEqual(["online", "error:MODULE_NOT_FOUND"]);
    expect(code).toBe(1);
  });
});

// ─── worker teardown vs. work still in flight ────────────────────────────────
// Each of these terminates a worker (or exits the process) while some off-thread
// or cross-thread work of that worker is still pending. They exercise the
// refusal / wait paths of VM teardown; a broken build crashes or trips ASAN
// rather than failing an assertion.
describe("terminate with work in flight", () => {
  test("a transpile queued on the thread pool that starts after terminate()", async () => {
    using dir = tempDir("worker-terminate-transpile", {
      // large enough that the pool job is still queued/running at terminate
      "big.ts": Array.from({ length: 4000 }, (_, i) => `export const v${i}: number = ${i};`).join("\n"),
      "w.js": `require("worker_threads").parentPort.postMessage("go"); import("./big.ts").then(() => {});`,
    });
    for (let i = 0; i < 8; i++) {
      const w = new Worker(join(String(dir), "w.js"));
      await new Promise(r => w.once("message", r));
      expect(await w.terminate()).toBe(1);
    }
  });

  test("a SubtleCrypto digest still on the work queue at terminate()", async () => {
    for (let i = 0; i < 4; i++) {
      const w = new Worker(
        `const { parentPort } = require("worker_threads");
         crypto.subtle.digest("SHA-256", new Uint8Array(64 << 20)).then(() => {});
         parentPort.postMessage("go");`,
        { eval: true },
      );
      await new Promise(r => w.once("message", r));
      expect(await w.terminate()).toBe(1);
    }
  });

  test("an async zlib job on the thread pool at terminate()", async () => {
    for (let i = 0; i < 4; i++) {
      const w = new Worker(
        `const { parentPort } = require("worker_threads");
         const zlib = require("zlib");
         const buf = Buffer.alloc(32 << 20, "a");
         zlib.deflate(buf, () => {});
         zlib.brotliCompress(buf.subarray(0, 4 << 20), () => {});
         parentPort.postMessage("go");`,
        { eval: true },
      );
      await new Promise(r => w.once("message", r));
      expect(await w.terminate()).toBe(1);
    }
  });

  test("a fetch whose body is still streaming at terminate(), then process exit", async () => {
    // Subprocess: the exiting main thread must not touch the dead worker's fetch.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Worker } = require("worker_threads");
         const server = Bun.serve({
           port: 0,
           fetch() {
             // never-ending chunked body
             return new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024)); return Bun.sleep(5); } }));
           },
         });
         const w = new Worker(
           'const { parentPort, workerData } = require("worker_threads");' +
           'fetch(workerData).then(async r => { const rd = r.body.getReader(); await rd.read(); parentPort.postMessage("streaming"); for (;;) await rd.read(); });',
           { eval: true, workerData: "http://127.0.0.1:" + server.port + "/" },
         );
         w.once("message", async () => {
           await w.terminate();
           server.stop(true);
           console.log("exiting");
           process.exit(0);
         });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("exiting\n");
    expect(exitCode).toBe(0);
  });

  test("the main thread exits while a worker is mid-way through sqlite statements", async () => {
    using dir = tempDir("worker-sqlite-main-exit", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Worker } = require("worker_threads");
         const w = new Worker(
           'const { DatabaseSync } = require("node:sqlite"); const { Database } = require("bun:sqlite");' +
           'const a = new DatabaseSync("a.db"); a.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS t (x)");' +
           'const b = new Database("b.db"); b.run("PRAGMA journal_mode=WAL"); b.run("CREATE TABLE IF NOT EXISTS t (x)");' +
           'const ins = a.prepare("INSERT INTO t VALUES (?)");' +
           'require("worker_threads").parentPort.postMessage("busy");' +
           'for (let i = 0; ; i++) { ins.run(i); b.run("INSERT INTO t VALUES (?)", [i]); }',
           { eval: true },
         );
         // Posted right before the worker enters its endless insert loop.
         w.once("message", () => process.exit(0));`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    expect(await proc.exited).toBe(0);
  });

  test("a fetch still in flight when the main thread exits", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        // The server never responds; exit once both requests have reached it.
        `let seen = 0;
         const server = Bun.serve({ port: 0, fetch: () => { if (++seen === 2) { console.log("exiting"); process.exit(0); } return new Promise(() => {}); } });
         fetch("http://127.0.0.1:" + server.port + "/").catch(() => {});
         fetch("http://127.0.0.1:" + server.port + "/").catch(() => {});`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("exiting\n");
    expect(exitCode).toBe(0);
  });
});

// A JS preload's modules are not the entry: parent messages are delivered only
// once the worker's own entry graph has executed.
test("a worker with a preload is not started before its entry module runs", async () => {
  using dir = tempDir("worker-preload-start", {
    "setup.js": `globalThis.setupRan = true;`,
    "dep.js": `export const dep = 1;\n${"// filler\n".repeat(3000)}`,
    "w.mjs": `import { dep } from "./dep.js";
import { parentPort } from "worker_threads";
parentPort.on("message", m => parentPort.postMessage(["got", m, dep, globalThis.setupRan === true]));`,
  });
  const w = new Worker(join(String(dir), "w.mjs"), { preload: join(String(dir), "setup.js") });
  const reply = new Promise(resolve => w.on("message", resolve));
  w.postMessage("hi");
  expect(await reply).toEqual(["got", "hi", 1, true]);
  await w.terminate();
});

// Releasing the last keep-alive from an immediate (after the tick, before the
// poll) must be noticed before the loop parks.
test("closing the only ref'd port from setImmediate lets the process exit", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { port1 } = new MessageChannel();
       port1.onmessage = () => {};
       setImmediate(() => { port1.close(); console.log("closed"); });`,
    ],
    // Without the idle GC timer nothing else would ever wake a parked loop.
    env: { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("closed\n");
  expect(exitCode).toBe(0);
});

// A worker's own stop requests (process.exit(), an uncaught error) have to wake
// its loop the way the parent's terminate() does: made from an immediate they
// land after the turn's tick and before its poll, and the run loop only looks
// for them again once the poll returns. With a parentPort listener keeping the
// loop alive, nothing else ends that poll: the exit used to wait for the idle GC
// timer (about a second), and without it (disabled here) never happened.
describe("a worker that stops itself from an immediate exits right away", () => {
  test.concurrent.each([
    ["process.exit()", "process.exit(7);", { errors: [], code: 7 }],
    [
      "process.exit() from a nextTick the immediate queued",
      "process.nextTick(() => process.exit(7));",
      { errors: [], code: 7 },
    ],
    ["an uncaught exception", 'throw new Error("boom");', { errors: ["boom"], code: 1 }],
  ])("%s", async (_label, stop, expected) => {
    const workerSrc = `const { parentPort } = require("node:worker_threads");
      parentPort.on("message", () => {});
      // Scheduled a little after startup so the worker's startup GC timers have
      // fired by then and nothing is left that would end the poll on its own.
      setTimeout(() => setImmediate(() => { parentPort.postMessage("stopping"); ${stop} }), 300);`;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Worker } = require("node:worker_threads");
         const w = new Worker(${JSON.stringify(workerSrc)}, { eval: true });
         const seen = { messages: [], errors: [] };
         w.on("message", m => seen.messages.push(m));
         w.on("error", e => seen.errors.push(e.message));
         w.on("exit", code => console.log(JSON.stringify({ ...seen, code })));`,
      ],
      env: { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ messages: ["stopping"], ...expected }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

// Node's setupPortReferencing: the parent side of parentPort keeps the parent
// alive while the Worker has 'message' listeners, independently of unref().
test("an unref'ed worker with a 'message' listener still delivers to the parent", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Worker } = require("worker_threads");
       const w = new Worker('require("worker_threads").parentPort.postMessage("hello"); setTimeout(() => {}, 1000);', { eval: true });
       w.unref();
       w.on("message", m => { console.log(m); process.exit(0); });`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("hello\n");
  expect(exitCode).toBe(0);
});

// A Bun.build whose plugin never answers, in a worker that is terminated: the
// build is cancelled with the worker, and the process-wide bundle thread stays
// usable for the parent.
test("terminating a worker mid-Bun.build (plugin pending) does not wedge the bundler", async () => {
  using dir = tempDir("worker-build-cancel", {
    "entry.js": `import "./dep.js"; console.log("entry");`,
    "dep.js": `console.log("dep");`,
    "w.js": `
      const { parentPort } = require("worker_threads");
      Bun.build({
        entrypoints: ["./entry.js"],
        // onLoad never answers; it tells the parent once the bundler is waiting on it.
        plugins: [{ name: "hang", setup(b) { b.onLoad({ filter: /dep\\.js$/ }, () => { parentPort.postMessage("pending"); return new Promise(() => {}); }); } }],
      }).then(() => parentPort.postMessage("built"), e => parentPort.postMessage("failed"));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Worker } = require("worker_threads");
       const w = new Worker("./w.js");
       w.once("message", async m => {
         console.log("worker:", m);
         await w.terminate();
         const out = await Bun.build({ entrypoints: ["./entry.js"] });
         console.log("parent build:", out.success, out.outputs.length > 0);
         process.exit(0);
       });`,
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("worker: pending\nparent build: true true\n");
  expect(exitCode).toBe(0);
});

// The worker gets its own copies of options.argv/execArgv strings (they live in
// the parent's WorkerOptions); empty strings included.
test("worker argv/execArgv option strings, read repeatedly in the worker", async () => {
  const src = `const { parentPort } = require("node:worker_threads");
    for (let i = 0; i < 200; i++) { process.argv; process.execArgv }
    parentPort.postMessage({ argv: process.argv.slice(2), execArgv: process.execArgv })`;
  const ws = Array.from(
    { length: 4 },
    (_, i) => new Worker(src, { eval: true, argv: ["", "a" + i, "\u00fc\u2603", ""], execArgv: ["", "--x"] }),
  );
  const got = await Promise.all(ws.map(w => new Promise(res => w.once("message", res))));
  expect(got).toEqual([0, 1, 2, 3].map(i => ({ argv: ["", "a" + i, "\u00fc\u2603", ""], execArgv: ["", "--x"] })));
  await Promise.all(ws.map(w => w.terminate()));
});

// A build whose plugin answers slowly (async setup + async onLoad) is in every
// possible phase when the worker goes away; each must cancel, not wait on the
// worker's JS thread for an answer that will never come.
test("terminate()/exit while Bun.build with a slow plugin is mid-flight in the worker", async () => {
  using dir = tempDir("worker-build-slow-plugin", {
    "entry.ts":
      Array.from({ length: 20 }, (_, i) => `export * as n${i} from "./m${i}.ts"`).join("\n") +
      `\nimport data from "virtual:data"\nexport { data }\n`,
    ...Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        `m${i}.ts`,
        `import { v as a } from "./m${(i + 1) % 20}.ts"\nexport const v: number = ${i}\nexport function f${i}(x: number) { return x + a }\n`,
      ]),
    ),
  });
  const workerSrc = `
    import { join } from "node:path";
    const SRC = process.env.SRC, OUT = process.env.OUT;
    const slow = { name: "slow", setup(build) {
      build.onResolve({ filter: /^virtual:data$/ }, () => ({ path: "data", namespace: "virt" }));
      build.onLoad({ filter: /.*/, namespace: "virt" }, async () => { await Bun.sleep(5 + Math.random() * 40); return { contents: "export default 1", loader: "js" } });
      return Bun.sleep(Math.random() * 30);
    } };
    let n = 0;
    const one = () => Bun.build({ entrypoints: [join(SRC, "entry.ts")], outdir: join(OUT, String(n++)), plugins: [slow] });
    self.onmessage = e => { if (e.data === "exit") process.exit(0) };
    let inflight = 0;
    (function pump() { while (inflight < 3) { inflight++; Promise.resolve().then(one).catch(() => {}).finally(() => { inflight--; setImmediate(pump) }) } })();
    postMessage("busy");
  `;
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const url = URL.createObjectURL(new Blob([${JSON.stringify(workerSrc)}]));
       for (let r = 0; r < 6; r++) {
         const door = r % 2 ? "exit" : "terminate";
         const ws = Array.from({ length: 1 + (r % 3) }, (_, i) => new Worker(url, { env: { ...process.env, OUT: process.env.OUT + "/r" + r + "w" + i } }));
         await Promise.all(ws.map(w => new Promise(res => { w.onmessage = e => e.data === "busy" && res(); w.addEventListener("close", res) })));
         await Bun.sleep((r * 11) % 60);
         const closed = ws.map(w => new Promise(res => w.addEventListener("close", res)));
         for (const w of ws) { if (door === "terminate") w.terminate(); else w.postMessage("exit") }
         await Promise.all(closed);
       }
       console.log("PASS");`,
    ],
    env: { ...bunEnv, SRC: String(dir), OUT: join(String(dir), "out") },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("PASS\n");
  expect(exitCode).toBe(0);
}, 60_000);

// The IPC channel belongs to the process; a worker in a forked child sees the
// inherited NODE_CHANNEL_FD but must not open a second endpoint on it (Node:
// process.send is undefined in worker threads).
test("a worker inside a process with an IPC channel has no process.send of its own", async () => {
  using dir = tempDir("worker-no-ipc", {
    "main.js": `
      if (process.argv[2] === "child") {
        const { Worker } = require("node:worker_threads");
        const w = new Worker(
          'const { parentPort } = require("node:worker_threads"); parentPort.postMessage({ send: typeof process.send, connected: process.connected, channel: typeof process.channel });',
          { eval: true },
        );
        w.once("message", m => {
          process.send({ worker: m, main: { send: typeof process.send, connected: process.connected } });
          w.terminate().then(() => process.exit(0));
        });
      } else {
        const { fork } = require("node:child_process");
        const child = fork(__filename, ["child"]);
        child.on("message", m => console.log(JSON.stringify(m)));
        child.on("exit", code => process.exit(code));
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(JSON.parse(stdout.trim())).toEqual({
    worker: { send: "undefined", connected: false, channel: "undefined" },
    main: { send: "function", connected: true },
  });
  expect(exitCode).toBe(0);
});

describe("VM teardown ordering", () => {
  // The exiting main thread must not park the process-wide HTTP thread while a
  // child can still start a request: the child then waits for a hand-back that
  // never comes and the parent waits for the child.
  test("process.exit() while a worker keeps starting fetches", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Worker } = require("worker_threads");
         const w = new Worker(
           'const { workerData, parentPort } = require("worker_threads");' +
           'parentPort.postMessage("ready");' +
           '(async () => { for (;;) { fetch(workerData.url).catch(() => {}); await 1; } })();',
           { eval: true, workerData: { url: "${server.url.href}" } });
         w.once("message", () => setImmediate(() => process.exit(0)));`,
      ],
      env: bunEnv,
      stdout: "ignore",
      stderr: "inherit",
    });
    expect(await proc.exited).toBe(0);
  });

  // A shell `cp` hands its copy to an fs.cp task on the pool; the pool part is
  // over then, not when the JS-thread continuation runs.
  test("process.exit() with a shell cp in flight", async () => {
    const files: Record<string, Buffer> = {};
    for (let i = 0; i < 60; i++) files[`src/f${i}.bin`] = Buffer.alloc(512 * 1024, 120);
    using dir = tempDir("exit-shell-cp", files);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const fs = require("fs");
         Bun.$\`cp -R src dst\`.then(() => {});
         // Exit once the copy is visibly under way.
         (function poll() {
           fs.existsSync("dst") && fs.readdirSync("dst").length > 0 ? process.exit(0) : setImmediate(poll);
         })();`,
      ],
      env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
      cwd: String(dir),
      stdout: "ignore",
      stderr: "inherit",
    });
    expect(await proc.exited).toBe(0);
  });

  // An S3 upload aborted by its worker's teardown must not retry onto the
  // closed VM: the retry would complete on the HTTP thread against a dead handle.
  test("terminating a worker mid S3 upload does not retry onto the dead VM", async () => {
    let first = true;
    using server = Bun.serve({
      port: 0,
      fetch: () => {
        if (first) {
          first = false;
          return new Promise(() => {}); // the upload terminate() interrupts
        }
        return new Response("no", { status: 503 }); // any retry fails fast
      },
    });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Worker } = require("worker_threads");
         const w = new Worker(
           'const { workerData, parentPort } = require("worker_threads");' +
           'const s3 = new Bun.S3Client({ accessKeyId: "k", secretAccessKey: "s", bucket: "b", endpoint: workerData.url, retry: 3 });' +
           // writer(): a MultiPartUpload, whose single-send failure path retries.
           'const wr = s3.file("key").writer({ retry: 3 }); wr.write(Buffer.alloc(1024 * 1024)); wr.end().catch(() => {});' +
           'parentPort.postMessage("uploading");',
           { eval: true, workerData: { url: "${server.url.href}" } });
         w.once("message", async () => {
           console.log("exit", await w.terminate());
           // Outlive any retry the HTTP thread would complete.
           setTimeout(() => process.exit(0), 500);
         });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("exit 1\n");
    expect(exitCode).toBe(0);
  });
});

// A native completion on the worker's own loop (here: a dns lookup finishing)
// after the parent requested termination must not settle a promise with the
// empty value its interrupted JS conversion produced.
test("terminate() while dns lookups keep completing in the worker", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Worker } = require("worker_threads");
       const w = new Worker(
         'const dns = require("dns"); const { parentPort } = require("worker_threads");' +
         'let n = 0;' +
         '(function go() { dns.lookup("localhost", () => {}); dns.promises.lookup("localhost").catch(() => {}); if (++n === 50) parentPort.postMessage("going"); setImmediate(go); })();',
         { eval: true });
       w.once("message", async () => { console.log("exit", await w.terminate()); process.exit(0); });`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("exit 1\n");
  expect(exitCode).toBe(0);
}, 30_000);

// What a worker's own handlers may observe of its stop, in what order. Every
// callback the worker could run appends a tag to a shared log the parent reads
// after the thread is gone, so ordering is checked from outside the dying VM.
//  - terminate(): the stop is not the worker's choice — no 'exit' handler, no
//    resource 'close'/'error' handler, nothing at all runs after the request.
//  - process.exit() from inside a callback: 'exit' handlers run exactly once and
//    are the last script the worker runs; resources are closed natively after
//    that, so none of their handlers follow.
// In both the parent's loop returns to idle afterwards (nothing the worker held
// keeps it alive) — the test process exiting at all is that check.
describe("worker stop ordering as seen by the worker's own handlers", () => {
  const TAG = {
    exitHandler: 1,
    serverClose: 2,
    socketClose: 3,
    socketError: 4,
    udpClose: 5,
    watcherClose: 6,
    intervalTick: 7,
    streamCancel: 8,
    portClose: 9,
    beforeExit: 10,
    afterExitCall: 11,
    ready: 12,
  } as const;
  const workerSource = (door: "terminate" | "exit") => `
    const { workerData, parentPort } = require("node:worker_threads");
    const log = workerData.log;
    const put = tag => { const i = Atomics.add(log, 0, 1) + 1; if (i < log.length) Atomics.store(log, i, tag); };
    process.on("exit", () => put(${TAG.exitHandler}));
    process.on("beforeExit", () => put(${TAG.beforeExit}));
    const net = require("node:net"), dgram = require("node:dgram"), fs = require("node:fs"), os = require("node:os");
    const server = net.createServer(() => {}).listen(0, "127.0.0.1");
    server.on("close", () => put(${TAG.serverClose}));
    const udp = dgram.createSocket("udp4"); udp.bind(0, "127.0.0.1"); udp.on("close", () => put(${TAG.udpClose}));
    const watcher = fs.watch(os.tmpdir(), () => {}); watcher.on("close", () => put(${TAG.watcherClose}));
    setInterval(() => put(${TAG.intervalTick}), 1).unref();
    const { port1, port2 } = new MessageChannel(); port1.on("message", () => {}); port1.on("close", () => put(${TAG.portClose})); globalThis.keepPeer = port2;
    Bun.serve({ port: 0, development: false, fetch: () => new Response("x") });
    new ReadableStream({ pull() {}, cancel() { put(${TAG.streamCancel}); } }).getReader().read();
    server.on("listening", () => {
      const sock = net.connect(server.address().port, "127.0.0.1");
      sock.on("close", () => put(${TAG.socketClose}));
      sock.on("error", () => put(${TAG.socketError}));
      sock.on("connect", () => {
        put(${TAG.ready});
        parentPort.postMessage("ready");
        ${door === "exit" ? `parentPort.on("message", () => { process.exit(7); put(${TAG.afterExitCall}); });` : `parentPort.on("message", () => {});`}
      });
    });
  `;

  async function run(door: "terminate" | "exit") {
    const log = new Int32Array(new SharedArrayBuffer(4 * 256));
    const w = new Worker(workerSource(door), { eval: true, workerData: { log } });
    const errors: unknown[] = [];
    w.on("error", e => errors.push(e));
    const exited = once(w, "exit").then(([code]) => code as number);
    await once(w, "message"); // "ready": every resource is up
    let code: number;
    if (door === "terminate") {
      const t = w.terminate();
      code = await exited;
      // terminate() resolves the same code the 'exit' event carried.
      expect(await t).toBe(code);
    } else {
      w.postMessage("go");
      code = await exited;
    }
    const n = Math.min(Atomics.load(log, 0), log.length - 1);
    const tags = Array.from(log.slice(1, 1 + n)).filter(t => t !== TAG.intervalTick);
    return { code, tags, errors };
  }

  test("terminate(): nothing of the worker's runs after the request", async () => {
    const { code, tags, errors } = await run("terminate");
    expect(errors).toEqual([]);
    // Only what ran before the parent asked: the "ready" marker. No 'exit'
    // handler (not the worker's choice), no close/error/cancel handler.
    expect(tags).toEqual([TAG.ready]);
    expect(code).toBe(1);
  });

  test("process.exit() inside a callback: 'exit' handlers are the last script; no resource handler follows", async () => {
    const { code, tags, errors } = await run("exit");
    expect(errors).toEqual([]);
    // ready → the 'exit' handler once → nothing: the statement after
    // process.exit() never runs, and closing the server/socket/udp/watcher/
    // port/stream natively afterwards dispatches none of their handlers.
    expect(tags).toEqual([TAG.ready, TAG.exitHandler]);
    expect(code).toBe(7);
  });
});

// Once a worker's VM has been stopped — by its own process.exit(), from a timer, from a subprocess
// onExit callback (a foreign trampoline), or by the parent's terminate() landing mid-callback —
// nothing it had queued may run: not the rest of the callback, not a nextTick, not a microtask.
describe("nothing queued runs after the worker's VM stops", () => {
  const cases: [string, string, (w: Worker) => void][] = [
    [
      "process.exit() in a timer",
      `setTimeout(() => {
         process.nextTick(() => parentPort.postMessage("nextTick ran"));
         Promise.resolve().then(() => parentPort.postMessage("microtask ran"));
         process.exit(0);
         parentPort.postMessage("sync code after exit ran");
       }, 5);`,
      () => {},
    ],
    [
      "process.exit() in Bun.spawn onExit",
      `Bun.spawn({ cmd: [process.execPath, "-e", "0"], env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" }, onExit() {
         process.nextTick(() => parentPort.postMessage("nextTick ran"));
         Promise.resolve().then(() => parentPort.postMessage("microtask ran"));
         process.exit(0);
       }});`,
      () => {},
    ],
    [
      "terminate() landing mid-callback",
      `parentPort.on("message", () => {});
       setTimeout(() => {
         process.nextTick(() => parentPort.postMessage("nextTick ran"));
         Promise.resolve().then(() => parentPort.postMessage("microtask ran"));
         parentPort.postMessage("ready");
         const t = Date.now(); while (Date.now() - t < 5000) {}
         parentPort.postMessage("busy loop was not interrupted");
       }, 5);`,
      w => w.on("message", m => m === "ready" && w.terminate()),
    ],
  ];
  for (const [name, body, arm] of cases) {
    test(name, async () => {
      const w = new Worker(`const { parentPort } = require("worker_threads");\n${body}`, { eval: true });
      const messages: string[] = [];
      w.on("message", m => m !== "ready" && messages.push(m));
      arm(w);
      const [code] = await once(w, "exit");
      expect(messages).toEqual([]);
      expect(typeof code).toBe("number");
    });
  }
});

// A worker's stop makes JSC forbid execution in the step that throws its TerminationException (WebCore's
// forbidExecutionOnTermination, armed per stop). Whatever was queued or in flight when a callback got stuck —
// due timers, immediates, nextTicks, microtasks, socket data, MessagePort deliveries, intervals, 'exit'
// listeners — must not enter JS once the termination has unwound that callback: any such entry is one that
// happened after termination, by construction (only the termination could have unwound the endless loop).
describe("no JS entry after a worker's termination has been thrown", () => {
  const worker = (stuckIn: "portMessage" | "socketData") => `
    const { parentPort, workerData } = require("node:worker_threads");
    const c = new Int32Array(workerData.sab);
    let armed = false;
    const B = i => () => { if (armed) Atomics.add(c, i, 1); };
    let stuckOnce = false;
    function scheduleEverythingThenGetStuck() {
      if (stuckOnce) return;
      stuckOnce = true;
      for (let k = 0; k < 50; k++) { setTimeout(B(0), 0); setImmediate(B(1)); process.nextTick(B(2)); queueMicrotask(B(3)); Promise.resolve().then(B(3)); }
      setInterval(B(6), 1);
      process.on("exit", B(7));
      parentPort.postMessage("stuck");
      const t = Date.now(); while (Date.now() - t < 30) {}
      // Stuck in native code each iteration, so no JIT tier can turn this into a poll-free loop.
      for (;;) Atomics.wait(c, 7, 0, 5);
    }
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: {
      open(s) { setInterval(() => { for (let k = 0; k < 8; k++) s.write("x"); }, 1); }, data() {}, drain() {} } });
    Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { open() {}, drain() {},
      data() { if (!armed) return; B(4)(); if (${JSON.stringify(stuckIn)} === "socketData") scheduleEverythingThenGetStuck(); } } });
    parentPort.on("message", m => {
      if (m !== "go") { B(5)(); return; }
      armed = true;
      if (${JSON.stringify(stuckIn)} === "portMessage") scheduleEverythingThenGetStuck();
    });
  `;
  for (const stuckIn of ["portMessage", "socketData"] as const) {
    test(`stuck in a ${stuckIn} callback`, async () => {
      const sab = new SharedArrayBuffer(4 * 8);
      const counts = new Int32Array(sab);
      const w = new Worker(worker(stuckIn), { eval: true, workerData: { sab } });
      w.postMessage("go");
      expect(await once(w, "message")).toEqual(["stuck"]);
      for (let k = 0; k < 200; k++) w.postMessage("flood");
      const t = Date.now();
      while (Date.now() - t < 50) {}
      await w.terminate();
      const names = [
        "timeout",
        "immediate",
        "nextTick",
        "microtask",
        "socketData",
        "portMessage",
        "interval",
        "exitHandler",
      ];
      const after = Object.fromEntries(names.map((n, i) => [n, counts[i]]));
      // The one socket data callback the worker got stuck in ran before termination.
      if (stuckIn === "socketData") after.socketData -= 1;
      expect(after).toEqual(Object.fromEntries(names.map(n => [n, 0])));
    });
  }
});
