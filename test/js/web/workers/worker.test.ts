import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";
import wt from "worker_threads";

describe("web worker", () => {
  async function waitForWorkerResult(worker: Worker, message: any): Promise<any> {
    const promise = new Promise((resolve, reject) => {
      worker.onerror = reject;
      worker.onmessage = e => resolve(e.data);
    });
    worker.postMessage(message);
    try {
      return await promise;
    } finally {
      worker.terminate();
    }
  }

  describe("preload", () => {
    test("invalid file URL", async () => {
      expect(() => new Worker("file://:!:!:!!!!", {})).toThrow(/Invalid file URL/);
      expect(
        () =>
          new Worker(import.meta.url, {
            preload: ["file://:!:!:!!!!", "file://:!:!:!!!!2"],
          }),
      ).toThrow(/Invalid file URL/);
    });

    test("string", async () => {
      const worker = new Worker(new URL("worker-fixture-preload-entry.js", import.meta.url).href, {
        preload: new URL("worker-fixture-preload.js", import.meta.url).href,
      });
      const result = await waitForWorkerResult(worker, "hello world");
      expect(result).toEqual("hello world");
    });

    test("array of 2 strings", async () => {
      const worker = new Worker(new URL("worker-fixture-preload-entry.js", import.meta.url).href, {
        preload: [
          new URL("worker-fixture-preload.js", import.meta.url).href,
          new URL("worker-fixture-preload-2.js", import.meta.url).href,
        ],
      });
      const result = await waitForWorkerResult(worker, "hello world world");
      expect(result).toEqual("hello world world");
    });

    test("array of string", async () => {
      const worker = new Worker(new URL("worker-fixture-preload-entry.js", import.meta.url).href, {
        preload: [new URL("worker-fixture-preload.js", import.meta.url).href],
      });
      const result = await waitForWorkerResult(worker, "hello world");
      expect(result).toEqual("hello world");
    });

    test("error in preload doesn't crash parent", async () => {
      const worker = new Worker(new URL("worker-fixture-preload-entry.js", import.meta.url).href, {
        preload: [new URL("worker-fixture-preload-bad.js", import.meta.url).href],
      });
      const { resolve, promise } = Promise.withResolvers();
      worker.onerror = e => {
        resolve(e.message);
      };
      const result = await promise;
      expect(result).toMatch(
        /THIS IS AN ERROR AND THIS PARTICULAR STRING DOESNT APPEAR IN THE SOURCE CODE SO WE KNOW FOR SURE IT SENT THE ACTUAL MESSAGE AND NOT JUST A DUMP OF THE SOURCE CODE AS IT ORIGINALLY WAS/,
      );
    });
  });

  test("worker", done => {
    const worker = new Worker(new URL("worker-fixture.js", import.meta.url).href, {
      smol: true,
    });
    expect(worker.threadId).toBeGreaterThan(0);
    worker.postMessage("hello");
    worker.onerror = e => {
      done(e.error);
    };
    worker.onmessage = e => {
      try {
        expect(e.data).toEqual("initial message");
      } catch (e) {
        done(e);
      } finally {
        worker.terminate();
        done();
      }
      worker.terminate();
      done();
    };
  });

  test("worker-env", done => {
    const worker = new Worker(new URL("worker-fixture-env.js", import.meta.url).href, {
      env: {
        // Verify that we use putDirectMayBeIndex instead of putDirect
        [0]: "123",
        [1]: "234",

        hello: "world",
        another_key: 123 as any,
      },
    });
    worker.postMessage("hello");
    worker.onerror = e => {
      done(e.error);
    };
    worker.onmessage = e => {
      try {
        expect(e.data).toEqual({
          env: {
            [0]: "123",
            [1]: "234",
            hello: "world",
            another_key: "123",
          },
          hello: "world",
        });
      } catch (e) {
        done(e);
      } finally {
        worker.terminate();
        done();
      }
    };
  });

  test("worker-env with a lot of properties", done => {
    const obj: any = {};

    for (let i = 0; i < 1000; i++) {
      obj["prop " + i] = Math.random().toString();
    }

    const worker = new Worker(new URL("worker-fixture-env.js", import.meta.url).href, {
      env: obj,
    });
    worker.postMessage("hello");
    worker.onerror = e => {
      done(e.error);
    };
    worker.onmessage = e => {
      try {
        expect(e.data).toEqual({
          env: obj,
          hello: undefined,
        });
      } catch (e) {
        done(e);
      } finally {
        worker.terminate();
        done();
      }
    };
  });

  test("argv / execArgv defaults", async () => {
    const worker = new Worker(new URL("worker-fixture-argv.js", import.meta.url).href, {});
    worker.postMessage("hello");
    const result = await waitForWorkerResult(worker, "hello");

    expect(result.argv).toHaveLength(2);
    expect(result.execArgv).toEqual(process.execArgv);
  });

  test("argv / execArgv options", async () => {
    const worker_argv = ["--some-arg=1", "--some-arg=2"];
    const worker_execArgv = ["--no-warnings", "--no-deprecation", "--tls-min-v1.2"];
    const original_argv = [...process.argv];
    const original_execArgv = [...process.execArgv];
    const worker = new Worker(new URL("worker-fixture-argv.js", import.meta.url).href, {
      argv: worker_argv,
      execArgv: worker_execArgv,
    });
    const result = await waitForWorkerResult(worker, "hello");

    expect(result).toEqual({
      argv: [original_argv[0], original_argv[1].replace(import.meta.file, "worker-fixture-argv.js"), ...worker_argv],
      execArgv: worker_execArgv,
    });
    // ensure they didn't change for the main thread
    expect(process.argv).toEqual(original_argv);
    expect(process.execArgv).toEqual(original_execArgv);
  });

  test("sending 50 messages should just work", done => {
    const worker = new Worker(new URL("worker-fixture-many-messages.js", import.meta.url).href, {});

    worker.postMessage("initial message");
    worker.addEventListener("message", ({ data }) => {
      if (data.done) {
        worker.terminate();
        done();
      } else {
        worker.postMessage({ i: data.i + 1 });
      }
    });
  });

  test("worker with event listeners doesn't close event loop", done => {
    const x = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "many-messages-event-loop.js"), "worker-fixture-many-messages.js"],
      env: bunEnv,
      stdio: ["inherit", "pipe", "inherit"],
    });

    const timer = setTimeout(() => {
      x.kill();
      done(new Error("timeout"));
    }, 1000);

    x.exited.then(async code => {
      clearTimeout(timer);
      if (code !== 0) {
        done(new Error("exited with non-zero code"));
      } else {
        const text = await new Response(x.stdout).text();
        if (!text.includes("done")) {
          console.log({ text });
          done(new Error("event loop killed early"));
        } else {
          done();
        }
      }
    });
  });

  test("worker with event listeners doesn't close event loop 2", done => {
    const x = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "many-messages-event-loop.js"), "worker-fixture-many-messages2.js"],
      env: bunEnv,
      stdio: ["inherit", "pipe", "inherit"],
    });

    const timer = setTimeout(() => {
      x.kill();
      done(new Error("timeout"));
    }, 1000);

    x.exited.then(async code => {
      clearTimeout(timer);
      if (code !== 0) {
        done(new Error("exited with non-zero code"));
      } else {
        const text = await new Response(x.stdout).text();
        if (!text.includes("done")) {
          console.log({ text });
          done(new Error("event loop killed early"));
        } else {
          done();
        }
      }
    });
  });

  test("worker with process.exit", done => {
    const worker = new Worker(new URL("worker-fixture-process-exit.js", import.meta.url).href, {
      smol: true,
    });
    worker.addEventListener("close", e => {
      try {
        expect(e.code).toBe(2);
      } catch (e) {
        done(e);
      }
      done();
    });
  });
});

// TODO: move to node:worker_threads tests directory
describe("worker_threads", () => {
  test("worker with process.exit", done => {
    const worker = new wt.Worker(new URL("worker-fixture-process-exit.js", import.meta.url).href, {
      smol: true,
    });
    worker.on("exit", code => {
      try {
        expect(code).toBe(2);
      } catch (e) {
        done(e);
        return;
      }
      done();
    });
  });

  test("worker terminate", async () => {
    const worker = new wt.Worker(new URL("worker-fixture-hang.js", import.meta.url).href, {
      smol: true,
    });
    const code = await worker.terminate();
    expect(code).toBe(0);
  });

  test("worker with process.exit (delay) and terminate", async () => {
    const worker = new wt.Worker(new URL("worker-fixture-process-exit.js", import.meta.url).href, {
      smol: true,
    });
    await Bun.sleep(200);
    const code = await worker.terminate();
    expect(code).toBe(2);
  });

  test.todo("worker terminating forcefully properly interrupts", async () => {
    const worker = new wt.Worker(new URL("worker-fixture-while-true.js", import.meta.url).href, {});
    await new Promise<void>(done => {
      worker.on("message", () => done());
    });
    const code = await worker.terminate();
    expect(code).toBe(0);
  });

  test("worker without argv/execArgv", async () => {
    const worker = new wt.Worker(new URL("worker-fixture-argv.js", import.meta.url), {});
    const promise = new Promise<any>(resolve => worker.on("message", resolve));
    worker.postMessage("hello");
    const result = await promise;

    expect(result.argv).toHaveLength(process.argv.length);
    expect(result.execArgv).toHaveLength(process.execArgv.length);
  });

  test("worker with argv/execArgv", async () => {
    const worker_argv = ["--some-arg=1", "--some-arg=2"];
    const worker_execArgv = ["--no-warnings", "--no-deprecation", "--tls-min-v1.2"];
    const original_argv = [...process.argv];
    const original_execArgv = [...process.execArgv];
    const worker = new wt.Worker(new URL("worker-fixture-argv.js", import.meta.url), {
      argv: worker_argv,
      execArgv: worker_execArgv,
    });
    const promise = new Promise<any>(resolve => worker.once("message", resolve));
    worker.postMessage("hello");
    const result = await promise;

    expect(result).toEqual({
      argv: [original_argv[0], original_argv[1].replace(import.meta.file, "worker-fixture-argv.js"), ...worker_argv],
      execArgv: worker_execArgv,
    });

    // ensure they didn't change for the main thread
    expect(process.argv).toEqual(original_argv);
    expect(process.execArgv).toEqual(original_execArgv);
  });

  test("worker with eval = false fails with code", async () => {
    let has_error = false;
    try {
      const worker = new wt.Worker("console.log('this should not get printed')", { eval: false });
    } catch (err) {
      expect(err.constructor.name).toEqual("TypeError");
      expect(err.message).toMatch(/BuildMessage: ModuleNotFound.+/);
      has_error = true;
    }
    expect(has_error).toBe(true);
  });

  test("worker with eval = true succeeds with valid code", async () => {
    let message;
    const worker = new wt.Worker("postMessage('hello')", { eval: true });
    worker.on("message", e => {
      message = e;
    });
    const p = new Promise((resolve, reject) => {
      worker.on("error", reject);
      worker.on("exit", resolve);
    });
    await p;
    expect(message).toEqual("hello");
  });
});
