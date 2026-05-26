import { describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { once } from "node:events";
import fs from "node:fs";
import { join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import wt, {
  BroadcastChannel,
  getEnvironmentData,
  isMainThread,
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

// Several tests spawn a fresh bun subprocess (sometimes one that itself spawns
// nested workers), which is much slower to start up under the debug/ASAN build
// and can exceed the 5s default timeout. Give the whole file more headroom
// there; it doesn't affect the fast in-process tests.
if (isDebug || isASAN) setDefaultTimeout(60_000);

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

  expect(() => {
    // @ts-expect-error no args
    wt.markAsUntransferable();
  }).toThrow("not yet implemented");

  expect(() => {
    // @ts-expect-error no args
    wt.moveMessagePortToContext();
  }).toThrow("not yet implemented");
});

test("all worker_threads worker instance properties are present", async () => {
  const worker = new Worker(new URL("./worker.js", import.meta.url).href);
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
  expect(worker.stdout).toBeNull();
  expect(worker.stderr).toBeNull();
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

// Bun does not enforce worker resource limits, but the `resourceLimits` passed
// to `new Worker(...)` must be reflected back through `worker.resourceLimits`
// and the module-level `resourceLimits` export inside the worker, matching
// Node's shape (unset numeric fields default to -1, `stackSizeMb` to 4).
describe("resourceLimits", () => {
  test("worker.resourceLimits echoes the limits passed to the constructor", async () => {
    const worker = new Worker(`setInterval(() => {}, 1000);`, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, codeRangeSizeMb: 4, stackSizeMb: 2 },
    });
    expect(worker.resourceLimits).toEqual({
      maxYoungGenerationSizeMb: 8,
      maxOldGenerationSizeMb: 32,
      codeRangeSizeMb: 4,
      stackSizeMb: 2,
    });
    await worker.terminate();
  });

  test("worker.resourceLimits fills defaults for fields not passed", async () => {
    const worker = new Worker(`setInterval(() => {}, 1000);`, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 16 },
    });
    expect(worker.resourceLimits).toEqual({
      maxYoungGenerationSizeMb: -1,
      maxOldGenerationSizeMb: 16,
      codeRangeSizeMb: -1,
      stackSizeMb: 4,
    });
    await worker.terminate();
  });

  test("worker.resourceLimits is an empty object once the worker has stopped", async () => {
    const worker = new Worker(`setInterval(() => {}, 1000);`, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 16 },
    });
    const exited = once(worker, "exit");
    expect(worker.resourceLimits).toMatchObject({ maxOldGenerationSizeMb: 16 });
    await worker.terminate();
    await exited;
    expect(worker.resourceLimits).toEqual({});
  });

  test("worker.resourceLimits is a defaulted object when no resourceLimits is passed", async () => {
    const worker = new Worker(`setInterval(() => {}, 1000);`, { eval: true });
    expect(worker.resourceLimits).toEqual({
      maxYoungGenerationSizeMb: -1,
      maxOldGenerationSizeMb: -1,
      codeRangeSizeMb: -1,
      stackSizeMb: 4,
    });
    await worker.terminate();
  });

  test("module-level resourceLimits inside a worker reflects the applied limits", async () => {
    const worker = new Worker(
      `
        const { parentPort, resourceLimits } = require("node:worker_threads");
        parentPort.postMessage(resourceLimits);
      `,
      {
        eval: true,
        resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, codeRangeSizeMb: 4, stackSizeMb: 2 },
      },
    );
    const [message] = await once(worker, "message");
    expect(message).toEqual({
      maxYoungGenerationSizeMb: 8,
      maxOldGenerationSizeMb: 32,
      codeRangeSizeMb: 4,
      stackSizeMb: 2,
    });
    await worker.terminate();
  });

  test("module-level resourceLimits inside a worker fills defaults for fields not passed", async () => {
    const worker = new Worker(
      `
        const { parentPort, resourceLimits } = require("node:worker_threads");
        parentPort.postMessage(resourceLimits);
      `,
      { eval: true, resourceLimits: { maxOldGenerationSizeMb: 16 } },
    );
    const [message] = await once(worker, "message");
    expect(message).toEqual({
      maxYoungGenerationSizeMb: -1,
      maxOldGenerationSizeMb: 16,
      codeRangeSizeMb: -1,
      stackSizeMb: 4,
    });
    await worker.terminate();
  });

  test("module-level resourceLimits on the main thread is an empty object", () => {
    expect(resourceLimits).toEqual({});
  });

  test("non-number resourceLimits fields fall back to defaults", async () => {
    const worker = new Worker(`setInterval(() => {}, 1000);`, {
      eval: true,
      // @ts-expect-error intentionally passing wrong types
      resourceLimits: { maxOldGenerationSizeMb: "16", codeRangeSizeMb: null },
    });
    expect(worker.resourceLimits).toEqual({
      maxYoungGenerationSizeMb: -1,
      maxOldGenerationSizeMb: -1,
      codeRangeSizeMb: -1,
      stackSizeMb: 4,
    });
    await worker.terminate();
  });

  test("worker.resourceLimits normalizes values like Node", async () => {
    // Node clamps maxOldGenerationSizeMb to >= 2 and treats a non-positive
    // stackSizeMb as the 4 MB default; maxYoung/codeRange are echoed verbatim.
    const worker = new Worker(`setInterval(() => {}, 1000);`, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 1, stackSizeMb: 0, maxYoungGenerationSizeMb: 0, codeRangeSizeMb: -2 },
    });
    expect(worker.resourceLimits).toEqual({
      maxYoungGenerationSizeMb: 0,
      maxOldGenerationSizeMb: 2,
      codeRangeSizeMb: -2,
      stackSizeMb: 4,
    });
    await worker.terminate();
  });

  test("worker.resourceLimits stays {} after a clean exit then terminate()", async () => {
    // A worker that exits cleanly gets exit code 0. terminate() must not treat
    // that falsy code as "not yet exited" — doing so would hang the returned
    // promise and revert resourceLimits from {} to the populated object.
    const worker = new Worker(`1 + 1;`, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 16 },
    });
    const [code] = await once(worker, "exit");
    expect(code).toBe(0);
    expect(worker.resourceLimits).toEqual({});
    // terminate() after a clean exit must resolve (not hang). If it hangs, the
    // test times out and fails, which is the assertion we want here.
    await worker.terminate();
    expect(worker.resourceLimits).toEqual({});
  });
});

test("threadId module and worker property is consistent", async () => {
  const worker1 = new Worker(new URL("./worker-thread-id.ts", import.meta.url).href);
  expect(threadId).toBe(0);
  expect(worker1.threadId).toBeGreaterThan(0);
  expect(() => worker1.postMessage({ workerId: worker1.threadId })).not.toThrow();
  const worker2 = new Worker(new URL("./worker-thread-id.ts", import.meta.url).href);
  expect(worker2.threadId).toBeGreaterThan(worker1.threadId);
  expect(() => worker2.postMessage({ workerId: worker2.threadId })).not.toThrow();
  await worker1.terminate();
  await worker2.terminate();
});

test("receiveMessageOnPort works across threads", async () => {
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL("./worker.js", import.meta.url).href, {
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
  const worker = new Worker(new URL("./worker-override-postMessage.js", import.meta.url).href);
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
  expect(result.toString()).toInclude(`error: Unexpected throw`);
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
    expect(err.message).toMatch(/MessagePort \{.*\}/s);
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

  test("returns a rejected promise if the worker is not running", () => {
    const worker = new Worker("", { eval: true });
    expect(worker.getHeapSnapshot()).rejects.toMatchObject({
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
