import { describe, expect, it, mock, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import { once } from "node:events";
import fs from "node:fs";
import { join, relative, resolve } from "node:path";
import { duplexPair, Readable, Writable } from "node:stream";
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
  expect(worker.stdout).toBeInstanceOf(Readable);
  expect(worker.stderr).toBeInstanceOf(Readable);
  expect(Object.getOwnPropertyDescriptor(Worker.prototype, "stdout")?.get).toBeFunction();
  expect(Object.getOwnPropertyDescriptor(Worker.prototype, "stderr")?.get).toBeFunction();
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
    expect(await new Response(proc.stdout).text()).toBe(expected);
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

// debug builds use way more memory and do not give useful results for this test
test.skipIf(isDebug)("eval does not leak source code", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), "eval-source-leak-fixture.js"],
    env: bunEnv,
    cwd: __dirname,
    stderr: "pipe",
    stdout: "ignore",
  });
  await proc.exited;
  const errors = await new Response(proc.stderr).text();
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
    const errors = await new Response(proc.stderr).text();
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
    const errors = await new Response(proc.stderr).text();
    if (errors.length > 0) throw new Error(errors);
    expect(proc.exitCode).toBe(0);
    const out = await new Response(proc.stdout).text();
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
    const errors = await new Response(proc.stderr).text();
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

describe("stdio", () => {
  type OutputStream = "stdout" | "stderr";

  function readToEnd(stream: Readable): Promise<string> {
    let data = "";
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    stream.on("error", reject);
    stream.on("data", chunk => {
      expect(chunk).toBeInstanceOf(Buffer);
      data += chunk.toString("utf8");
    });
    stream.on("end", () => resolve(data));
    return promise;
  }

  function overrideProcessStdio<S extends OutputStream>(which: S, stream: Writable): Disposable {
    const originalStream = process[which];
    // stream is missing the `fd` property that the real process streams have, but we
    // don't need it
    // @ts-expect-error
    process[which] = stream;
    return {
      [Symbol.dispose]() {
        process[which] = originalStream;
      },
    };
  }

  function captureProcessStdio<S extends OutputStream>(
    stream: S,
  ): Disposable & { data: Promise<string>; end: () => void } {
    const [streamToInstall, streamToObserve] = duplexPair();

    return {
      ...overrideProcessStdio(stream, streamToInstall),
      data: readToEnd(streamToObserve),
      end: () => streamToInstall.end(),
    };
  }

  describe.each<OutputStream>(["stdout", "stderr"])("%s", stream => {
    it(`process.${stream} written in worker writes to parent process.${stream}`, async () => {
      using capture = captureProcessStdio(stream);
      const worker = new Worker(
        String.raw/* js */ `
          import assert from "node:assert";
          process.${stream}.write("hello", (err) => {
            assert.strictEqual(err, null);
            process.${stream}.write("\ncallback 1");
          });
          // " world"
          process.${stream}.write(new Uint16Array([0x7720, 0x726f, 0x646c]), (err) => {
            assert.strictEqual(err, null);
            process.${stream}.write("\ncallback 2");
          });
        `,
        { eval: true },
      );
      const [code] = await once(worker, "exit");
      expect(code).toBe(0);
      capture.end();
      expect(await capture.data).toBe("hello world\ncallback 1\ncallback 2");
    });

    it(`process.${stream} written in worker writes to worker.${stream} in parent`, async () => {
      const worker = new Worker(`process.${stream}.write("hello");`, { eval: true });
      const resultPromise = readToEnd(worker[stream]);
      const [code] = await once(worker, "exit");
      expect(code).toBe(0);
      expect(await resultPromise).toBe("hello");
    });

    it(`can still receive data on worker.${stream} if you override it later`, async () => {
      const worker = new Worker(`process.${stream}.write("hello");`, { eval: true });
      const resultPromise = readToEnd(worker[stream]);
      Object.defineProperty(worker, stream, { value: undefined });
      const [code] = await once(worker, "exit");
      expect(code).toBe(0);
      expect(await resultPromise).toBe("hello");
    });

    const consoleFunction = stream == "stdout" ? "log" : "error";

    it(`console.${consoleFunction} in worker writes to both streams in parent`, async () => {
      using capture = captureProcessStdio(stream);
      const worker = new Worker(`console.${consoleFunction}("hello");`, { eval: true });
      const resultPromise = readToEnd(worker[stream]);
      const [code] = await once(worker, "exit");
      expect(code).toBe(0);
      capture.end();
      expect(await capture.data).toBe("hello\n");
      expect(await resultPromise).toBe("hello\n");
    });

    describe(`with ${stream}: true option`, () => {
      it(`writes to worker.${stream} but not process.${stream}`, async () => {
        using capture = captureProcessStdio(stream);
        const worker = new Worker(`process.${stream}.write("hello");`, { eval: true, [stream]: true });
        const resultPromise = readToEnd(worker[stream]);
        const [code] = await once(worker, "exit");
        expect(code).toBe(0);
        capture.end();
        expect(await capture.data).toBe("");
        expect(await resultPromise).toBe("hello");
      });
    });

    it("worker write() doesn't wait for parent _write() to complete", async () => {
      const sharedBuffer = new SharedArrayBuffer(4);
      const sharedArray = new Int32Array(sharedBuffer);
      const { promise, resolve } = Promise.withResolvers();

      const writeFn = mock((chunk: Buffer, encoding: string, callback: () => void) => {
        expect(chunk).toEqual(Buffer.from("hello"));
        expect(encoding).toBe("buffer");
        // wait for worker to indicate that its write() callback ran
        Atomics.wait(sharedArray, 0, 0);
        // now run the callback
        callback();
        // and resolve our promise
        resolve();
      });

      class DelayStream extends Writable {
        _write(data: Buffer, encoding: string, callback: () => void) {
          return writeFn(data, encoding, callback);
        }
      }

      using override = overrideProcessStdio(stream, new DelayStream());
      const worker = new Worker(
        /* js */ `
          import { workerData } from "node:worker_threads";
          const sharedArray = new Int32Array(workerData);
          import assert from "node:assert";
          process.${stream}.write("hello", "utf8", (err) => {
            assert.strictEqual(err, null);
            // tell parent that our callback has run
            Atomics.store(sharedArray, 0, 1);
            Atomics.notify(sharedArray, 0, 1);
          });
        `,
        { eval: true, workerData: sharedBuffer },
      );
      const [code] = await once(worker, "exit");
      expect(code).toBe(0);
      await promise;
      expect(writeFn).toHaveBeenCalledTimes(1);
    });

    it(`console uses overridden process.${stream} in worker`, async () => {
      const worker = new Worker(
        /* js */ `
          import { Writable } from "node:stream";
          const original = process.${stream};
          class WrapStream extends Writable {
            _write(chunk, encoding, callback) {
              original.write("[wrapped] " + chunk.toString());
              callback();
            }
          }
          process.${stream} = new WrapStream();
          console.${consoleFunction}("hello");
        `,
        { eval: true, [stream]: true },
      );
      const resultPromise = readToEnd(worker[stream]);
      const [code] = await once(worker, "exit");
      expect(code).toBe(0);
      expect(await resultPromise).toBe("[wrapped] hello\n");
    });

    it("has no fd", async () => {
      const worker = new Worker(
        /* js */ `
          import assert from "node:assert";
          assert.strictEqual(process.${stream}.fd, undefined);
        `,
        { eval: true },
      );
      const [code] = await once(worker, "exit");
      expect(code).toBe(0);
    });
  });

  describe("console", () => {
    it("all functions are captured", async () => {
      const worker = new Worker(
        /* js */ `
        console.assert();
        console.assert(false);
        // TODO: https://github.com/oven-sh/bun/issues/19953
        // this should be "Assertion failed: should be true," not "should be true"
        // but we still want to make sure it is captured in workers
        console.assert(false, "should be true");
        console.debug("debug");
        console.error("error");
        console.info("info");
        console.log("log");
        console.table([{ a: 5 }]);
        // TODO: https://github.com/oven-sh/bun/issues/19952
        // this goes to the wrong place but we still want to make sure it is captured in workers
        console.trace("trace");
        console.warn("warn");
      `,
        { eval: true, stdout: true, stderr: true },
      );
      // normalize the random blob URL and lines and columns from internal modules
      const stdout = (await readToEnd(worker.stdout))
        .replace(/blob:[0-9a-f\-]{36}/, "blob:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
        .replaceAll(/\(\d+:\d+\)$/gm, "(line:col)");
      const stderr = await readToEnd(worker.stderr);

      let expectedStdout = `debug
info
log
┌───┬───┐
│   │ a │
├───┼───┤
│ 0 │ 5 │
└───┴───┘
trace
      at blob:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:15:17
      at loadAndEvaluateModule (line:col)
`;
      if (isDebug) {
        expectedStdout += `      at asyncFunctionResume (line:col)
      at promiseReactionJobWithoutPromiseUnwrapAsyncContext (line:col)
      at promiseReactionJob (line:col)
`;
      }

      expect(stdout).toBe(expectedStdout);
      expect(stderr).toBe(`Assertion failed
Assertion failed
should be true
error
warn
`);
    });

    it("handles exceptions", async () => {
      const cases = [
        {
          code: /* js */ `process.stdout.write = () => { throw new Error("write()"); }; console.log("hello");`,
          expectedException: {
            name: "Error",
            message: "write()",
          },
        },
        {
          code: /* js */ `process.stdout.write = 6; console.log("hello");`,
          expectedException: {
            name: "TypeError",
            message: expect.stringMatching(/is not a function.*is 6/),
          },
        },
        {
          code: /* js */ `Object.defineProperty(process.stdout, "write", { get() { throw new Error("write getter"); } }); console.log("hello");`,
          expectedException: {
            name: "Error",
            message: "write getter",
          },
        },
        {
          code: /* js */ `Object.defineProperty(process, "stdout", { get() { throw new Error("stdout getter"); } }); console.log("hello");`,
          expectedException: {
            name: "Error",
            message: "stdout getter",
          },
        },
      ];

      for (const { code, expectedException } of cases) {
        const worker = new Worker(code, { eval: true, stdout: true });
        const stdoutPromise = readToEnd(worker.stdout);
        const [exception] = await once(worker, "error");
        expect(exception).toMatchObject(expectedException);
        expect(await stdoutPromise).toBe("");
      }
    });

    // blocked on more JS internals that use `process` while it has been overridden
    it.todo("works if the entire process object is overridden", async () => {
      const worker = new Worker(/* js */ `process = 5; console.log("hello");`, { eval: true, stdout: true });
      expect(await readToEnd(worker.stdout)).toBe("hello\n");
    });
  });

  describe("stdin", () => {
    it("by default, process.stdin is readable and worker.stdin is null", async () => {
      const worker = new Worker(
        /* js */ `
          import assert from "node:assert";
          assert.strictEqual(process.stdin.constructor.name, "ReadableWorkerStdio");
        `,
        { eval: true },
      );
      expect(worker.stdin).toBeNull();
      const [code] = await once(worker, "exit");
      expect(code).toBe(0);
    });

    it("has no fd", async () => {
      const worker = new Worker(
        /* js */ `
          import assert from "node:assert";
          assert.strictEqual(process.stdin.fd, undefined);
        `,
        { eval: true },
      );
      const [code] = await once(worker, "exit");
      expect(code).toBe(0);
    });

    it.todo("does not keep the event loop alive if worker does not listen for events", async () => {});
    it.todo("hangs if parent does not call end()", async () => {});

    it("child can read data from parent", async () => {
      const chunks: Buffer[] = [];
      const { promise, resolve, reject } = Promise.withResolvers();
      const worker = new Worker("process.stdin.pipe(process.stdout)", { stdin: true, stdout: true, eval: true });
      expect(worker.stdin!.constructor.name).toBe("WritableWorkerStdio");
      worker.on("error", reject);
      worker.stdout.on("data", chunk => {
        chunks.push(chunk);
        if (chunks.length == 2) resolve();
        if (chunks.length > 2) throw new Error("too much data");
      });
      worker.stdin!.write("hello");
      // " world"
      worker.stdin!.write(new Uint16Array([0x7720, 0x726f, 0x646c]));
      await promise;
      expect(chunks).toEqual([Buffer.from("hello"), Buffer.from(" world")]);
      worker.stdin!.end();
    });
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
