import { describe, expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, tempDir } from "harness";
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

    // https://github.com/oven-sh/bun/issues/5170
    describe("inherited from bunfig/CLI", () => {
      const pluginFile = `
        import { plugin } from "bun";
        plugin({
          name: "virtual",
          setup(build) {
            build.module("my-virtual-module", () => ({
              contents: 'export default "from-plugin";',
              loader: "js",
            }));
          },
        });
        globalThis.__preloadRan = (globalThis.__preloadRan ?? 0) + 1;
      `;
      const workerFile = `
        import msg from "my-virtual-module";
        postMessage({ msg, preloadRan: globalThis.__preloadRan });
      `;
      const mainFile = `
        import msg from "my-virtual-module";
        const worker = new Worker(new URL("./worker.ts", import.meta.url));
        const result = await new Promise((resolve, reject) => {
          worker.onmessage = e => resolve(e.data);
          worker.onerror = e => reject(new Error(e.message));
        });
        console.log(JSON.stringify({ main: { msg, preloadRan: globalThis.__preloadRan }, worker: result }));
        await worker.terminate();
      `;

      test.concurrent("bunfig preload runs in Web Worker", async () => {
        using dir = tempDir("worker-bunfig-preload", {
          "bunfig.toml": `preload = ["./plugin.ts"]`,
          "plugin.ts": pluginFile,
          "worker.ts": workerFile,
          "main.ts": mainFile,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "run", "main.ts"],
          env: bunEnv,
          cwd: String(dir),
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout.trim())).toEqual({
          main: { msg: "from-plugin", preloadRan: 1 },
          worker: { msg: "from-plugin", preloadRan: 1 },
        });
        expect(exitCode).toBe(0);
      });

      test.concurrent("--preload flag runs in Web Worker", async () => {
        using dir = tempDir("worker-cli-preload", {
          "plugin.ts": pluginFile,
          "worker.ts": workerFile,
          "main.ts": mainFile,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--preload", "./plugin.ts", "main.ts"],
          env: bunEnv,
          cwd: String(dir),
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout.trim())).toEqual({
          main: { msg: "from-plugin", preloadRan: 1 },
          worker: { msg: "from-plugin", preloadRan: 1 },
        });
        expect(exitCode).toBe(0);
      });

      test.concurrent("bunfig preload runs in node:worker_threads Worker", async () => {
        using dir = tempDir("worker-bunfig-preload-wt", {
          "bunfig.toml": `preload = ["./plugin.ts"]`,
          "plugin.ts": pluginFile,
          "worker.ts": `
            import { parentPort } from "node:worker_threads";
            import msg from "my-virtual-module";
            parentPort.postMessage({ msg, preloadRan: globalThis.__preloadRan });
          `,
          "main.ts": `
            import { Worker } from "node:worker_threads";
            import msg from "my-virtual-module";
            const worker = new Worker(new URL("./worker.ts", import.meta.url));
            const result = await new Promise((resolve, reject) => {
              worker.on("message", resolve);
              worker.on("error", reject);
            });
            console.log(JSON.stringify({ main: { msg, preloadRan: globalThis.__preloadRan }, worker: result }));
            await worker.terminate();
          `,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "run", "main.ts"],
          env: bunEnv,
          cwd: String(dir),
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout.trim())).toEqual({
          main: { msg: "from-plugin", preloadRan: 1 },
          worker: { msg: "from-plugin", preloadRan: 1 },
        });
        expect(exitCode).toBe(0);
      });

      test.concurrent("bunfig preload runs in nested Worker", async () => {
        using dir = tempDir("worker-bunfig-preload-nested", {
          "bunfig.toml": `preload = ["./plugin.ts"]`,
          "plugin.ts": pluginFile,
          "inner.ts": workerFile,
          "outer.ts": `
            import msg from "my-virtual-module";
            const inner = new Worker(new URL("./inner.ts", import.meta.url));
            const result = await new Promise((resolve, reject) => {
              inner.onmessage = e => resolve(e.data);
              inner.onerror = e => reject(new Error(e.message));
            });
            postMessage({ outer: { msg, preloadRan: globalThis.__preloadRan }, inner: result });
            await inner.terminate();
          `,
          "main.ts": `
            const outer = new Worker(new URL("./outer.ts", import.meta.url));
            const result = await new Promise((resolve, reject) => {
              outer.onmessage = e => resolve(e.data);
              outer.onerror = e => reject(new Error(e.message));
            });
            console.log(JSON.stringify(result));
            await outer.terminate();
          `,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "run", "main.ts"],
          env: bunEnv,
          cwd: String(dir),
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout.trim())).toEqual({
          outer: { msg: "from-plugin", preloadRan: 1 },
          inner: { msg: "from-plugin", preloadRan: 1 },
        });
        expect(exitCode).toBe(0);
      });

      test.concurrent(
        "inherited preload runs after node:worker_threads bootstrap (captured stdio, stubbed process)",
        async () => {
          using dir = tempDir("worker-preload-wt-order", {
            "bunfig.toml": `preload = ["./setup.ts"]`,
            "setup.ts": `
              if (!require("node:worker_threads").isMainThread) {
                console.log("from inherited preload");
                let chdirErr = "no throw";
                try { process.chdir("/"); } catch (e) { chdirErr = e.code; }
                globalThis.__chdirErr = chdirErr;
              }
            `,
            "worker.ts": `
              const { parentPort } = require("node:worker_threads");
              console.log("from worker entry");
              parentPort.postMessage({ chdirErr: globalThis.__chdirErr });
            `,
            "main.ts": `
              const { Worker } = require("node:worker_threads");
              const { once } = require("node:events");
              const worker = new Worker(new URL("./worker.ts", import.meta.url), { stdout: true });
              let captured = "";
              worker.stdout.setEncoding("utf8");
              worker.stdout.on("data", d => { captured += d; });
              const [[msg]] = await Promise.all([
                once(worker, "message"),
                once(worker.stdout, "end"),
                once(worker, "exit"),
              ]);
              console.log(JSON.stringify({ captured: captured.trim().split("\\n"), chdirErr: msg.chdirErr }));
            `,
          });
          await using proc = Bun.spawn({
            cmd: [bunExe(), "run", "main.ts"],
            env: bunEnv,
            cwd: String(dir),
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stderr).toBe("");
          expect(JSON.parse(stdout.trim())).toEqual({
            captured: ["from inherited preload", "from worker entry"],
            chdirErr: "ERR_WORKER_UNSUPPORTED_OPERATION",
          });
          expect(exitCode).toBe(0);
        },
      );

      test.concurrent("inherited preload runs before option.preload", async () => {
        using dir = tempDir("worker-preload-order", {
          "bunfig.toml": `preload = ["./first.ts"]`,
          "first.ts": `globalThis.__order = ["bunfig"];`,
          "second.ts": `globalThis.__order.push("option");`,
          "worker.ts": `postMessage(globalThis.__order);`,
          "main.ts": `
            const worker = new Worker(new URL("./worker.ts", import.meta.url), {
              preload: [new URL("./second.ts", import.meta.url).href],
            });
            const result = await new Promise((resolve, reject) => {
              worker.onmessage = e => resolve(e.data);
              worker.onerror = e => reject(new Error(e.message));
            });
            console.log(JSON.stringify(result));
            await worker.terminate();
          `,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "run", "main.ts"],
          env: bunEnv,
          cwd: String(dir),
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout.trim())).toEqual(["bunfig", "option"]);
        expect(exitCode).toBe(0);
      });
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

  // https://github.com/oven-sh/bun/issues/32247
  // Spawned: founding a SHARE_ENV tree permanently replaces this thread's
  // process.env object, so doing it in-process would leave every later test
  // (and any module that captured process.env at import) holding a stale one.
  test("worker-env: SHARE_ENV via the global Worker constructor", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const wt = require("worker_threads");
         const key = "BUN_TEST_SHARE_ENV";
         process.env[key] = "from-parent";
         // The Web Worker constructor doesn't go through node:worker_threads, so the
         // native option parser must recognize the SHARE_ENV registry symbol itself.
         const worker = new Worker(
           "data:text/javascript," + encodeURIComponent(\`
             self.onmessage = e => {
               const seen = process.env[e.data.key];
               process.env[e.data.key] = "from-worker";
               self.postMessage(seen);
             };
           \`),
           { env: wt.SHARE_ENV },
         );
         worker.onerror = e => { console.error(e.message); process.exit(1); };
         worker.onmessage = e => {
           console.log(JSON.stringify({ seen: e.data, parentSees: process.env[key] }));
           worker.terminate();
         };
         worker.postMessage({ key });`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual({ seen: "from-parent", parentSees: "from-worker" });
    expect(exitCode).toBe(0);
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
    const worker = new Worker(new URL("worker-fixture-process-exit.js", import.meta.url), {
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

  describe("worker event", () => {
    test("is fired with the right object", () => {
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
  });

  describe("error event", () => {
    test("is fired with a string of the error", async () => {
      const worker = new Worker("data:text/javascript,throw 5");
      const [err] = await once(worker, "error");
      expect(err.type).toBe("error");
      expect(err.message).toBe("5");
      expect(err.error).toBe(null);
    });
  });
});

// TODO: move to node:worker_threads tests directory
describe("worker_threads", () => {
  test("worker with process.exit", done => {
    const worker = new wt.Worker(new URL("worker-fixture-process-exit.js", import.meta.url), {
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

  test("worker terminate while setting up thread", async () => {
    // this test is inherently somewhat flaky: if we call terminate() before the worker starts
    // running any JavaScript the code will be 0 like we expect, but if we terminate while it is
    // running code the exit code is 1 instead (this happens in Node.js too). this means we can
    // randomly see an exit code of 1 if the main thread happens to run slower than usual and allows
    // the worker to run some code.
    //
    // to prevent it from polluting the flaky test list, we try 10 times and expect:
    // - at least 1 time the exit code was 0
    // - the exit code is never something other than 0 or 1
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const worker = new wt.Worker(new URL("worker-fixture-hang.js", import.meta.url), {
        smol: true,
      });
      worker.on("error", expect.unreachable);
      const code = await worker.terminate();
      expect(code === 0 || code === 1, `unexpected exit code ${code}`).toBeTrue();
      codes.push(code);
    }
    expect(codes.includes(0)).toBeTrue();
  });

  test("worker with process.exit (delay) and terminate", async () => {
    const worker = new wt.Worker(new URL("worker-fixture-process-exit.js", import.meta.url), {
      smol: true,
    });
    // Wait for the worker to self-exit (its setTimeout fires process.exit(2)
    // after 10 ms) — a fixed sleep races with worker startup, which under
    // debug/ASAN can exceed 200 ms.
    const [code] = await once(worker, "exit");
    await worker.terminate();
    expect(code).toBe(2);
  });

  test("worker terminating forcefully properly interrupts", async () => {
    const worker = new wt.Worker(new URL("worker-fixture-while-true.js", import.meta.url), {});
    await new Promise<void>(done => {
      worker.on("message", () => done());
    });
    const code = await worker.terminate();
    expect(code).toBe(1);
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

  test("worker with eval = false validates the filename", () => {
    // eval:false is equivalent to omitting eval, so a bare string that isn't a
    // path is rejected synchronously like Node (ERR_WORKER_PATH), rather than
    // being treated as a module specifier.
    let err: any;
    try {
      new wt.Worker("console.log('this should not get printed')", { eval: false });
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("ERR_WORKER_PATH");
    expect(err?.constructor.name).toBe("TypeError");
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
