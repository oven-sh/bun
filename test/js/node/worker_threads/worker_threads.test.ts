import { bunEnv, bunExe, tmpdirSync } from "harness";
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
  // subprocess coverage. The two cases below take the shutdown() path
  // directly so they exercise the m_pendingTasks abandon drain regardless.
  test.each([
    ["entry not found", undefined],
    ["unsettled top-level await", "await new Promise(() => {})"],
  ])("rejects ERR_WORKER_NOT_RUNNING when called before a worker that fails to start (%s)", async (_, src) => {
    const worker =
      src === undefined ? new Worker("/nonexistent/__bun_worker_path__.js") : new Worker(src, { eval: true });
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

// The listener registry must not route through user-overridable Map/Set/WeakMap
// methods. Spawned: it clobbers prototypes, which would poison the whole runner.
test("the listener registry survives tampered Map/Set/WeakMap prototypes", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { MessageChannel } = require("worker_threads");
       const boom = name => function () { throw new Error("tampered " + name); };
       Map.prototype.get = boom("Map.get");
       Map.prototype.set = boom("Map.set");
       Map.prototype.delete = boom("Map.delete");
       Set.prototype.add = boom("Set.add");
       Set.prototype.delete = boom("Set.delete");
       WeakMap.prototype.get = boom("WeakMap.get");
       WeakMap.prototype.set = boom("WeakMap.set");

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

test("close(cb) fires cb asynchronously after this tick's setImmediate", async () => {
  const { port1 } = new MessageChannel();
  const order: string[] = [];
  port1.close(() => order.push("cb"));
  order.push("sync");
  setImmediate(() => order.push("immediate1"));
  await new Promise(r => setImmediate(() => setImmediate(() => setImmediate(r))));
  // node fires the close callback from libuv's close-callbacks phase, i.e.
  // after any setImmediate the caller queued in the same tick as close().
  expect(order[0]).toBe("sync");
  expect(order).toContain("cb");
  expect(order.indexOf("immediate1")).toBeLessThan(order.indexOf("cb"));
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

  // An accessor installed via defineProperty lands on the base object, but reads hit
  // the store first — so the store entry must go, or the getter is shadowed. (Node
  // rejects accessors on process.env entirely; bun allows them on the regular map,
  // so the shared map matches the regular one rather than diverging from it.)
  it("does not let the store shadow an accessor defined on process.env", async () => {
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Worker, SHARE_ENV } = require("worker_threads");
         const probe = \`process.env.FOO = "old";
           Object.defineProperty(process.env, "FOO", { get: () => "new", configurable: true });
           const count = Object.keys(process.env).filter(k => k === "FOO").length;
           const read = process.env.FOO;
           delete process.env.FOO;
           ({ read, count, afterDelete: process.env.FOO ?? null })\`;
         const regular = eval(probe);
         const w = new Worker(
           'const { parentPort } = require("worker_threads"); parentPort.postMessage(eval(' + JSON.stringify(probe) + '));',
           { eval: true, env: SHARE_ENV },
         );
         w.on("message", shared => console.log(JSON.stringify({ regular, shared })));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // count === 1: defineProperty on an existing enumerable key keeps it enumerable.
    const want = { read: "new", count: 1, afterDelete: null };
    expect(JSON.parse(stdout)).toEqual({ regular: want, shared: want });
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
