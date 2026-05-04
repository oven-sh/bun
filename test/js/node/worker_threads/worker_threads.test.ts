import { describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

// Many tests here spawn subprocesses or workers that each take 1-3s in debug/ASAN builds,
// and the default 5s per-test timeout is too tight under load.
setDefaultTimeout(30_000);

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
  expect(wt).toHaveProperty("postMessageToThread");
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

  // Each run() spawns a --smol subprocess that creates a worker; slow in debug builds.
  it("inherits the parent's execArgv when falsy or unspecified", async () => {
    await run("null", '["--smol"]\n');
    await run("0", '["--smol"]\n');
  }, 30_000);
  it("provides empty execArgv when passed an empty array", async () => {
    // empty array should result in empty execArgv, not inherited from parent thread
    await run("[]", "[]\n");
  }, 15_000);
  it("can specify an array of strings", async () => {
    await run('["--no-warnings"]', '["--no-warnings"]\n');
  }, 15_000);
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
}, 60_000); // Spawns six workers with 100 MiB of source each; slow in debug builds.

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
  }, 30_000); // Five nested workers; slow in debug builds.

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
  }, 30_000); // Two nested workers; slow in debug builds.
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

describe("postMessageToThread", () => {
  test("is exported", () => {
    expect(wt).toHaveProperty("postMessageToThread");
    expect(wt.postMessageToThread).toBeFunction();
  });

  test("rejects when targeting the same thread", async () => {
    await expect(wt.postMessageToThread(threadId)).rejects.toMatchObject({
      name: "Error",
      code: "ERR_WORKER_MESSAGING_SAME_THREAD",
    });
  });

  test("rejects when targeting an unknown thread", async () => {
    await expect(wt.postMessageToThread(2 ** 30)).rejects.toMatchObject({
      name: "Error",
      code: "ERR_WORKER_MESSAGING_FAILED",
    });
  });

  test("delivers to workerMessage listener in worker and back", async () => {
    const worker = new Worker(
      /* js */ `
        const wt = require("node:worker_threads");
        process.on("workerMessage", (value, source) => {
          wt.postMessageToThread(source, { echo: value, from: wt.threadId });
        });
        wt.parentPort.postMessage("ready");
        wt.parentPort.once("message", () => {});
      `,
      { eval: true },
    );
    const onWorkerMessage = (value, source) => resolve({ value, source });
    const { promise, resolve } = Promise.withResolvers();
    try {
      await once(worker, "message");
      process.on("workerMessage", onWorkerMessage);
      await wt.postMessageToThread(worker.threadId, "hello");
      const { value, source } = await promise;
      expect(value).toEqual({ echo: "hello", from: worker.threadId });
      expect(source).toBe(worker.threadId);
    } finally {
      process.removeListener("workerMessage", onWorkerMessage);
      worker.postMessage("done");
      await worker.terminate();
    }
  });

  test("rejects with ERR_WORKER_MESSAGING_FAILED when worker has no listener", async () => {
    const worker = new Worker(
      /* js */ `
        const wt = require("node:worker_threads");
        wt.parentPort.postMessage("ready");
        wt.parentPort.once("message", () => {});
      `,
      { eval: true },
    );
    try {
      await once(worker, "message");
      await expect(wt.postMessageToThread(worker.threadId, "hello")).rejects.toMatchObject({
        name: "Error",
        code: "ERR_WORKER_MESSAGING_FAILED",
      });
    } finally {
      worker.postMessage("done");
      await worker.terminate();
    }
  });

  test("rejects with ERR_WORKER_MESSAGING_ERRORED when handler throws", async () => {
    const worker = new Worker(
      /* js */ `
        const wt = require("node:worker_threads");
        process.on("workerMessage", () => { throw new Error("boom"); });
        wt.parentPort.postMessage("ready");
        wt.parentPort.once("message", () => {});
      `,
      { eval: true },
    );
    try {
      await once(worker, "message");
      await expect(wt.postMessageToThread(worker.threadId, "hello")).rejects.toMatchObject({
        name: "Error",
        code: "ERR_WORKER_MESSAGING_ERRORED",
      });
    } finally {
      worker.postMessage("done");
      await worker.terminate();
    }
  });

  test("rejects with ERR_WORKER_MESSAGING_FAILED for an exited worker's threadId", async () => {
    // The worker's port registration must be torn down on exit; previously
    // #onClose read the native threadId (which is -1 once the worker is
    // closing) and the stale port stayed in the map, so this would hang
    // until the timeout instead of failing immediately.
    const worker = new Worker("require('node:worker_threads')", { eval: true });
    const id = worker.threadId;
    await once(worker, "exit");
    expect(worker.threadId).toBe(-1);
    await expect(wt.postMessageToThread(id, "hello")).rejects.toMatchObject({
      name: "Error",
      code: "ERR_WORKER_MESSAGING_FAILED",
    });
  });
});

test("process.emit returns false when there are no listeners", () => {
  // process uses a native EventEmitter; it used to always return true.
  expect(process.emit("__bun_test_no_listener_event__")).toBe(false);
  let called = false;
  process.once("__bun_test_with_listener_event__", () => {
    called = true;
  });
  expect(process.emit("__bun_test_with_listener_event__")).toBe(true);
  expect(called).toBe(true);
});

test("GC of a ref'd MessagePort whose peer closed releases its event-loop ref", async () => {
  // port1.onmessage = fn takes an event-loop ref. port2.close() sets PeerClosed on
  // port1's pipe side so hasPendingActivity() → false and port1's wrapper is
  // collectible. ~MessagePort() used to not release the event-loop ref → hang.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
        (() => {
          const { port1, port2 } = new MessageChannel();
          port1.onmessage = () => {};
          port2.close();
        })();
        Bun.gc(true);
        setTimeout(() => { Bun.gc(true); console.log("DONE"); }, 50);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("DONE");
  expect(exitCode).toBe(0);
});

test("transferring a ref'd MessagePort releases its event-loop ref on the source thread", async () => {
  // port1.onmessage = fn takes an event-loop ref; transferring port1 detaches it from the
  // source context. disentangle() used to leave that ref behind, so the source process hung.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
        const { Worker } = require("node:worker_threads");
        const { port1 } = new MessageChannel();
        port1.onmessage = () => {};
        const w = new Worker("setTimeout(() => {}, 100)", { ev${/* bundler hates eval */ ""}al: true });
        w.postMessage({ p: port1 }, [port1]);
        w.unref();
        setTimeout(() => console.log("DONE"), 50);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("DONE");
  expect(exitCode).toBe(0);
});

test("on() after unref() on a transferred port re-refs (Node's newListener hook)", async () => {
  // Node's setupPortReferencing installs a 'newListener' hook that calls
  // this.ref() on the first 'message' listener, so port.unref(); port.on('message', fn)
  // re-refs and the worker stays alive. The reverse order (on; unref) stays unref'd.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
        const { Worker, workerData } = require("node:worker_threads");
        const { once } = require("node:events");
        const { port1, port2 } = new MessageChannel();
        const w = new Worker(
          "const p = require('node:worker_threads').workerData.port;" +
          "p.unref(); p.on('message', m => { console.log('got:' + m); p.close(); });" +
          "require('node:worker_threads').parentPort.postMessage(p.hasRef());",
          { ev${/* bundler hates eval */ ""}al: true, workerData: { port: port2 }, transferList: [port2] },
        );
        once(w, "message").then(([hasRef]) => {
          console.log("hasRef:" + hasRef);
          setTimeout(() => port1.postMessage("hi"), 50);
        });
        w.on("exit", c => { console.log("exit:" + c); port1.close(); });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n").sort()).toEqual(["exit:0", "got:hi", "hasRef:true"]);
  expect(exitCode).toBe(0);
});

test("worker does not stay alive after unref() on a transferred port with a listener", async () => {
  // A transferred MessagePort with a 'message' listener used to hold a separate
  // event loop ref that .unref() could not release, keeping the worker alive forever.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
        const { Worker, workerData } = require("node:worker_threads");
        const { port1, port2 } = new MessageChannel();
        const w = new Worker(
          "const p = require('node:worker_threads').workerData.port; p.addEventListener('message', () => {}); p.unref();",
          { ev${/* bundler hates eval */ ""}al: true, workerData: { port: port2 }, transferList: [port2] },
        );
        w.on("exit", code => { console.log("exit", code); port1.close(); });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("exit 0");
  expect(exitCode).toBe(0);
});
