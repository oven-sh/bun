import { describe, expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
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

    // Reaching the real limit needs 2.5 GB, so the child runs with a 64 KiB synthetic allocation limit
    // (2730 24-byte entries).
    test("throws a RangeError for more entries than the native list allows", async () => {
      const LIMIT_BYTES = 64 * 1024;
      const MAX_ENTRIES = Math.floor(LIMIT_BYTES / 24);
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          // The last entry is an invalid file URL, so a list within the limit still throws and never starts a thread.
          const construct = count => {
            const preload = new Array(count).fill("./preload.js");
            preload[count - 1] = "file://:!:!:!!!!";
            try {
              new Worker("./entry.js", { preload });
              return "constructed";
            } catch (e) {
              return e.name + ": " + e.message;
            }
          };
          console.log(JSON.stringify({ atLimit: construct(${MAX_ENTRIES}), onePast: construct(${MAX_ENTRIES + 1}) }));
          `,
        ],
        env: { ...bunEnv, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: String(LIMIT_BYTES) },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout || "null")).toEqual({
        atLimit: 'TypeError: Invalid file URL: "file://:!:!:!!!!"',
        onePast: "RangeError: Out of memory",
      });
      expect(exitCode).toBe(0);
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

  test("worker-env: process.env reads inside a worker reflect the worker's own environment at runtime", async () => {
    using dir = tempDir("worker-env-runtime-reads", {
      "worker.js": `
        const inherited = process.env.BUN_TEST_WORKER_ENV_KEY;
        process.env["BUN_TEST_WORKER_ENV_KEY"] = "assigned-in-worker";
        const assigned = process.env.BUN_TEST_WORKER_ENV_KEY;
        postMessage({ inherited, assigned, nodeEnv: process.env.NODE_ENV });
      `,
      "main.js": `
        const worker = new Worker(new URL("./worker.js", import.meta.url).href, {
          env: { BUN_TEST_WORKER_ENV_KEY: "from-worker-option", NODE_ENV: "production" },
        });
        worker.onerror = e => { console.error(e.message); process.exit(1); };
        worker.onmessage = e => {
          console.log(JSON.stringify(e.data));
          worker.terminate();
        };
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: { ...bunEnv, BUN_TEST_WORKER_ENV_KEY: "from-parent-process", NODE_ENV: "development" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual({
      inherited: "from-worker-option",
      assigned: "assigned-in-worker",
      nodeEnv: "production",
    });
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
    } as Bun.WorkerOptions);
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

  describe("open event", () => {
    // 'open' is posted before the entry runs, so it precedes anything the
    // entry's top-level code posts (node:worker_threads turns it into 'online').
    test("precedes the worker's first message", async () => {
      const worker = new Worker("data:text/javascript,postMessage('ready')");
      const order: string[] = [];
      worker.addEventListener("open", () => order.push("open"));
      worker.addEventListener("message", e => order.push("message:" + e.data));
      await once(worker, "close");
      expect(order).toEqual(["open", "message:ready"]);
    });

    test("is fired for a worker whose entry does not resolve", async () => {
      using dir = tempDir("worker-open-missing-entry", {});
      const worker = new Worker(path.join(String(dir), "missing.js"));
      const order: string[] = [];
      worker.addEventListener("open", () => order.push("open"));
      worker.addEventListener("error", () => order.push("error"));
      await once(worker, "close");
      expect(order).toEqual(["open", "error"]);
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

    test("names the entry point when its path is too long for a path buffer", async () => {
      // Resolving it failed without logging anything, so the event carried
      // "BuildMessage: undefined". Longer than the buffer on every platform.
      const specifier = "./" + Buffer.alloc(100_000, "w").toString();
      const worker = new Worker(specifier);
      const [err] = await once(worker, "error");
      expect(err.message).toBe(`BuildMessage: ModuleNotFound resolving "${specifier}" (entry point)`);
    });

    // Runs `source` as the parent. Each scenario gets a process of its own: an unobserved worker
    // error ends it.
    async function runParent(source: string, cwd?: string) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", source],
        env: bunEnv,
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }
    const dataUrl = (body: string) => "data:text/javascript," + encodeURIComponent(body);
    // Parent source: starts one worker per scenario and prints what each one's Worker object saw.
    const observeWorkers = `
      async function observe(scenarios, listen) {
        const seen = {};
        await Promise.all(Object.entries(scenarios).map(([name, url]) => new Promise(resolve => {
          const worker = new Worker(url);
          const mine = (seen[name] = { messages: [], errors: 0 });
          worker.onmessage = event => mine.messages.push(event.data);
          listen?.(worker, mine);
          worker.addEventListener("close", event => { mine.close = event.code; resolve(); });
        })));
        console.log(JSON.stringify(seen));
      }`;
    const countErrors = `(worker, mine) => worker.addEventListener("error", () => mine.errors++)`;
    async function observe(scenarios: Record<string, string>, listen?: string, cwd?: string) {
      const { stdout, stderr, exitCode } = await runParent(
        `${observeWorkers}
         await observe(${JSON.stringify(scenarios)}${listen ? ", " + listen : ""});`,
        cwd,
      );
      return { seen: stdout ? JSON.parse(stdout) : stdout, stderr, exitCode };
    }

    // A worker that dies of an error nobody took is its owner's uncaught error: printed, exit code 1.
    describe("with no listener", () => {
      test.concurrent.each([
        ["a throw at evaluation", `throw new Error("WEB-WORKER-UNCAUGHT")`],
        ["a rejection at evaluation", `Promise.reject(new Error("WEB-WORKER-UNCAUGHT"))`],
        ["a throw in a timer", `setTimeout(() => { throw new Error("WEB-WORKER-UNCAUGHT") }, 1)`],
        [
          "a rejection in a timer",
          `setInterval(() => {}, 1000); setTimeout(() => { Promise.reject(new Error("WEB-WORKER-UNCAUGHT")) }, 1)`,
        ],
        [
          "an error its own listener saw and did not cancel",
          `self.addEventListener("error", () => {}); setTimeout(() => { throw new Error("WEB-WORKER-UNCAUGHT") }, 1)`,
        ],
        [
          "an error its own onerror returned false for",
          `self.onerror = () => false; setTimeout(() => { throw new Error("WEB-WORKER-UNCAUGHT") }, 1)`,
        ],
      ])("%s is printed by the parent, which exits 1", async (_, body) => {
        const { stderr, exitCode } = await runParent(`new Worker(${JSON.stringify(dataUrl(body))});`);
        expect(stderr.split("\n")[0]).toBe("error: Uncaught error in worker");
        expect(stderr).toContain("WEB-WORKER-UNCAUGHT");
        expect(exitCode).toBe(1);
      });

      test.concurrent("an entry point that does not resolve is printed by the parent, which exits 1", async () => {
        const { stderr, exitCode } = await runParent(`new Worker("/does/not/exist/entry.js", { name: "resizer" });`);
        expect(stderr.split("\n").slice(0, 2)).toEqual([
          `error: Uncaught error in worker "resizer"`,
          `BuildMessage: ModuleNotFound resolving "/does/not/exist/entry.js" (entry point)`,
        ]);
        expect(exitCode).toBe(1);
      });

      test.concurrent("the parent's process.on('uncaughtException') takes it", async () => {
        const { stdout, stderr, exitCode } = await runParent(
          `process.on("uncaughtException", (err, origin) => console.log(JSON.stringify({ origin, name: err.constructor.name, lines: err.message.split("\\n").filter(line => /^[A-Za-z]/.test(line)), stack: typeof err.stack })));
           const worker = new Worker(${JSON.stringify(dataUrl(`throw new TypeError("WEB-WORKER-UNCAUGHT")`))});
           worker.addEventListener("close", event => console.log("worker closed", event.code));`,
        );
        expect(stderr).toBe("");
        expect(stdout.split("\n")).toEqual([
          JSON.stringify({
            origin: "uncaughtException",
            name: "Error",
            lines: ["Uncaught error in worker", "TypeError: WEB-WORKER-UNCAUGHT"],
            stack: "undefined",
          }),
          "worker closed 1",
          "",
        ]);
        expect(exitCode).toBe(0);
      });

      // The one form that sends the thrown value as a clone without node:worker_threads' own
      // listener: the clone is what is reported.
      test.concurrent("new Worker(url, options, nodeWorker) reports the thrown value", async () => {
        const { stdout, stderr, exitCode } = await runParent(
          `process.on("uncaughtException", err => console.log(JSON.stringify({ name: err.constructor.name, message: err.message, code: err.code })));
           new Worker(${JSON.stringify(dataUrl(`throw Object.assign(new RangeError("WEB-WORKER-UNCAUGHT"), { code: "E_WORKER" })`))}, {}, {});`,
        );
        expect(stderr).toBe("");
        expect(stdout).toBe(
          JSON.stringify({ name: "RangeError", message: "WEB-WORKER-UNCAUGHT", code: "E_WORKER" }) + "\n",
        );
        expect(exitCode).toBe(0);
      });

      // A worker whose own nested worker dies sees that as its own uncaught error, so the report
      // repeats one level up until something takes it or the main thread prints it.
      test.concurrent("on a nested worker it is that worker's own uncaught error", async () => {
        using dir = tempDir("worker-nested-error", {
          "inner.js": `setTimeout(() => { throw new Error("WEB-WORKER-NESTED-UNCAUGHT") }, 1);`,
          "middle.js": `new Worker(new URL("inner.js", import.meta.url).href);`,
          "middle-cancels.js": `self.addEventListener("error", event => { event.preventDefault(); postMessage("middle took: " + event.message.includes("WEB-WORKER-NESTED-UNCAUGHT")); });
            new Worker(new URL("inner.js", import.meta.url).href);`,
        });
        const run = (middle: string, listen: boolean) =>
          runParent(
            `const worker = new Worker(${JSON.stringify(middle)});
             worker.onmessage = event => console.log(event.data);
             ${listen ? `worker.addEventListener("error", event => console.log("main saw", event.message.includes("WEB-WORKER-NESTED-UNCAUGHT")));` : ""}
             worker.addEventListener("close", event => console.log("middle closed", event.code));`,
            String(dir),
          );
        const [nobody, main, middle] = await Promise.all([
          run("./middle.js", false),
          run("./middle.js", true),
          run("./middle-cancels.js", false),
        ]);
        expect(nobody.stderr.split("\n")[0]).toBe("error: Uncaught error in worker");
        expect(nobody.stderr).toContain("WEB-WORKER-NESTED-UNCAUGHT");
        expect(nobody.exitCode).toBe(1);
        expect(main).toEqual({ stdout: "main saw true\nmiddle closed 1\n", stderr: "", exitCode: 0 });
        expect(middle).toEqual({ stdout: "middle took: true\nmiddle closed 0\n", stderr: "", exitCode: 0 });
      });

      test.concurrent("it is not reported after terminate()", async () => {
        // Whether each in-flight error task lands before or after terminate(), it must never surface
        // as an unhandled exception on the parent.
        const result = await runParent(
          `process.on("uncaughtException", err => { console.error("UNHANDLED", err.message); process.exitCode = 2; });
           const src = ${JSON.stringify(dataUrl(`throw new Error("POST-TERMINATE")`))};
           const N = 32;
           let closed = 0;
           const { promise, resolve } = Promise.withResolvers();
           for (let i = 0; i < N; i++) {
             const w = new Worker(src);
             w.addEventListener("close", () => { if (++closed === N) resolve(); });
             w.terminate();
           }
           await promise;
           console.log("done");`,
        );
        expect(result).toEqual({ stdout: "done\n", stderr: "", exitCode: 0 });
      });

      // The first thread to read sub/ logs the warning of its tsconfig.json: here that is a worker.
      test.concurrent.each([
        ["with an 'error' listener", countErrors],
        ["with none", undefined],
      ])("a worker that did not fail posts no 'error' to a parent %s", async (_, listen) => {
        using dir = tempDir("worker-healthy-log", {
          "tsconfig.base.json": `{"compilerOptions":{"baseUrl":"."}}`,
          "sub/tsconfig.json": `{"extends":"../tsconfig.base.json","compilerOptions":{"paths":{"lib":["sub/lib.ts"]}}}`,
          "sub/lib.ts": `export const x = 1;`,
          "sub/worker.ts": `postMessage("ran");`,
          "exits.ts": `process.exit(3);`,
        });
        expect(await observe({ warned: "./sub/worker.ts", exited: "./exits.ts" }, listen, String(dir))).toEqual({
          seen: {
            warned: { messages: ["ran"], errors: 0, close: 0 },
            exited: { messages: [], errors: 0, close: 3 },
          },
          stderr: "",
          exitCode: 0,
        });
      });
    });

    // Being registered is what takes the error, as for node:worker_threads' 'error': the listener
    // does not have to cancel the event.
    test.concurrent("a registered listener takes it, whatever it does with the event", async () => {
      const { stdout, stderr, exitCode } = await runParent(
        `const failing = ${JSON.stringify(dataUrl(`throw new Error("WEB-WORKER-UNCAUGHT")`))};
         const onRequest = ${JSON.stringify(dataUrl(`onmessage = () => { throw new Error("WEB-WORKER-UNCAUGHT") }`))};
         const seen = {};
         const start = (name, url, attach) => new Promise(resolve => {
           const worker = new Worker(url);
           seen[name] = [];
           attach(worker, event => seen[name].push({ named: event.message.includes("WEB-WORKER-UNCAUGHT"), error: event.error, cancelable: event.cancelable }));
           worker.addEventListener("close", resolve);
         });
         await Promise.all([
           start("addEventListener", failing, (worker, record) => worker.addEventListener("error", record)),
           start("once", failing, (worker, record) => worker.addEventListener("error", record, { once: true })),
           start("onerror", failing, (worker, record) => { worker.onerror = record; }),
           start("onerror returning false", failing, (worker, record) => { worker.onerror = event => (record(event), false); }),
           start("preventDefault", failing, (worker, record) => worker.addEventListener("error", event => (record(event), event.preventDefault()))),
           // Presence is read when the error arrives, not when the worker is made.
           start("registered late", onRequest, (worker, record) => worker.addEventListener("open", () => { worker.addEventListener("error", record); worker.postMessage("go"); })),
         ]);
         console.log(JSON.stringify(seen));`,
      );
      const one = [{ named: true, error: null, cancelable: true }];
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        "addEventListener": one,
        "once": one,
        "onerror": one,
        "onerror returning false": one,
        "preventDefault": one,
        "registered late": one,
      });
      expect(exitCode).toBe(0);
    });

    // The worker's global scope hears of an uncaught error first. A listener there that cancels the
    // event has handled it: the Worker object is not told and the worker keeps running.
    describe("handled in the worker", () => {
      // What the handler schedules runs: the worker was not stopped.
      const handle = `postMessage("handled, cancelable: " + event.cancelable); setTimeout(() => postMessage("still running"), 1);`;
      const handlers = {
        "preventDefault()": `self.addEventListener("error", event => { ${handle} event.preventDefault(); });`,
        "onerror returning true": `self.onerror = event => { ${handle} return true; };`,
      };
      const producers = {
        "throw in a timer": `setTimeout(() => { throw new Error("WEB-WORKER-HANDLED") }, 1);`,
        "rejection at evaluation": `Promise.reject(new Error("WEB-WORKER-HANDLED"));`,
        "throw at evaluation": `throw new Error("WEB-WORKER-HANDLED");`,
      };
      const scenarios: Record<string, string> = {};
      for (const [handler, install] of Object.entries(handlers))
        for (const [producer, fail] of Object.entries(producers))
          scenarios[`${handler}, ${producer}`] = dataUrl(`${install} ${fail}`);
      const handled = Object.fromEntries(
        Object.keys(scenarios).map(name => [
          name,
          { messages: ["handled, cancelable: true", "still running"], errors: 0, close: 0 },
        ]),
      );

      test.concurrent.each([
        ["no 'error' listener", undefined],
        ["an 'error' listener", countErrors],
      ])("is not reported to a parent with %s", async (_, listen) => {
        expect(await observe(scenarios, listen)).toEqual({ seen: handled, stderr: "", exitCode: 0 });
      });

      test.concurrent("only a cancelled event counts", async () => {
        const worker = (install: string) =>
          dataUrl(`${install} setTimeout(() => { throw new Error("WEB-WORKER-NOT-HANDLED") }, 1);`);
        const forwarded = (close: number) => ({ messages: ["seen"], errors: 1, named: true, close });
        expect(
          await observe(
            {
              "listener that does not cancel": worker(`self.addEventListener("error", () => postMessage("seen"));`),
              "onerror returning false": worker(`self.onerror = () => { postMessage("seen"); return false; };`),
              "listener that throws": worker(
                `self.addEventListener("error", event => { postMessage("seen"); event.preventDefault(); throw new Error("from the listener"); });`,
              ),
              // The listener chose the exit code; the error it did not cancel is still reported.
              "listener that exits": worker(
                `self.addEventListener("error", () => { postMessage("seen"); process.exit(3); });`,
              ),
            },
            `(worker, mine) => worker.addEventListener("error", event => { mine.errors++; mine.named = event.message.includes("WEB-WORKER-NOT-HANDLED"); })`,
          ),
        ).toEqual({
          seen: {
            "listener that does not cancel": forwarded(1),
            "onerror returning false": forwarded(1),
            "listener that throws": forwarded(1),
            "listener that exits": forwarded(3),
          },
          stderr: "",
          exitCode: 0,
        });
      });
    });

    describe("under bun test", () => {
      async function runTests(files: Record<string, string>) {
        using dir = tempDir("worker-error-bun-test", files);
        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", "./worker.test.ts"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { output: stdout + stderr, exitCode };
      }
      const awaitClose = (expected: string) => `
        import { test, expect } from "bun:test";
        import { once } from "node:events";
        test("a worker runs", async () => {
          const worker = new Worker(new URL("./worker.mjs", import.meta.url));
          const events = [];
          worker.onmessage = event => events.push(event.data);
          const [close] = await once(worker, "close");
          expect([...events, close.code]).toEqual(${expected});
        });`;

      test.concurrent("a worker's unobserved error fails the test that started it", async () => {
        const { output, exitCode } = await runTests({
          "worker.mjs": `setTimeout(() => { throw new Error("WEB-WORKER-UNCAUGHT") }, 1);`,
          "worker.test.ts": awaitClose(`[1]`),
        });
        expect(output).toContain("error: Uncaught error in worker");
        expect(output).toContain("(fail) a worker runs");
        expect(exitCode).toBe(1);
      });

      test.concurrent("a worker handles its error, and expect().toThrow() in a worker still collects one", async () => {
        const { output, exitCode } = await runTests({
          "worker.mjs": `
            import { expect } from "bun:test";
            expect(() => { Promise.reject(new Error("collected")); throw new Error("thrown"); }).toThrow("thrown");
            postMessage("collected");
            self.addEventListener("error", event => { event.preventDefault(); postMessage("handled"); });
            setTimeout(() => { throw new Error("WEB-WORKER-HANDLED") }, 1);`,
          "worker.test.ts": awaitClose(`["collected", "handled", 0]`),
        });
        expect(output).toContain("(pass) a worker runs");
        expect(output).not.toContain("WEB-WORKER-HANDLED");
        expect(exitCode).toBe(0);
      });
    });
  });

  // As in browsers (and Node's Web Worker), the worker's implicit port opens once the entry's
  // synchronous part has run: a message dispatched while no 'message' handler exists is dropped.
  // node:worker_threads' parentPort is what queues until a listener is attached. #40141
  describe("message delivery does not wait for a 'message' handler", () => {
    async function withWorker(
      src: string,
      drive: (w: Worker, got: unknown[], done: PromiseWithResolvers<void>) => void,
    ) {
      const w = new Worker(URL.createObjectURL(new Blob([src])));
      const got: unknown[] = [];
      const done = Promise.withResolvers<void>();
      w.onerror = e => done.reject(e.error ?? e.message);
      w.addEventListener("close", e => done.reject(new Error(`worker closed (${e.code}) with ${JSON.stringify(got)}`)));
      drive(w, got, done);
      try {
        await done.promise;
      } finally {
        w.terminate();
      }
      return got;
    }

    // Posted while the worker is still starting: queued, and delivered once the entry has run and
    // installed its handler — the top-level await never settling does not hold them back (#15408).
    test("a handler installed before a top-level await that never settles receives what was queued during startup", async () => {
      const got = await withWorker(
        `self.onmessage = e => postMessage(e.data);
         postMessage("installed");
         await new Promise(() => {});`,
        (w, got, done) => {
          w.postMessage("early");
          w.onmessage = e => {
            if (e.data === "installed") return [0, 1, 2].forEach(m => w.postMessage(m));
            got.push(e.data);
            if (e.data === 2) done.resolve();
          };
        },
      );
      expect(got).toEqual(["early", 0, 1, 2]);
    });

    // The worker joins a BroadcastChannel first thing and installs a one-shot "probe" listener; the
    // parent posts "probe" at construction. Its arrival proves the worker's port is live (a post
    // that lands while the worker is still starting is buffered, and startup runs other queued
    // tasks before it drains them), so the worker says "ready" from that handler, after removing
    // it. The parent then posts 0..2 and answers "go". Those reach the worker as tasks in that
    // order, so 0..2 are dispatched — to no handler — strictly before `await gate` resumes and
    // installs one. 3 and 4 come after it.
    test("a handler installed after a top-level await misses what was dispatched before it", async () => {
      const gateName = "worker-gate-" + crypto.randomUUID();
      const gate = new BroadcastChannel(gateName);
      try {
        const got = await withWorker(
          `const c = new BroadcastChannel(${JSON.stringify(gateName)});
           const gate = new Promise(go => { c.onmessage = () => { c.close(); go(); }; });
           self.addEventListener("message", function probe(e) {
             if (e.data !== "probe") return;
             self.removeEventListener("message", probe);
             c.postMessage("ready");
           });
           await gate;
           self.onmessage = e => postMessage(e.data);
           postMessage("installed");`,
          (w, got, done) => {
            w.postMessage("probe");
            gate.onmessage = () => {
              [0, 1, 2].forEach(m => w.postMessage(m));
              gate.postMessage("go");
            };
            w.onmessage = e => {
              if (e.data === "installed") return [3, 4].forEach(m => w.postMessage(m));
              got.push(e.data);
              if (e.data === 4) done.resolve();
            };
          },
        );
        expect(got).toEqual([3, 4]);
      } finally {
        gate.close();
      }
    });
  });

  describe("terminate() races and lifecycle edges", () => {
    // A vm timeout inside a worker is a transient termination of that VM; it
    // must not leave the worker unable to run script (parent messages dropped).
    test("parent messages still arrive after a node:vm timeout in the worker", async () => {
      const src = `import vm from "node:vm";
        self.onmessage = e => postMessage("pong " + e.data);
        try { vm.runInNewContext("for(;;){}", {}, { timeout: 20 }) } catch {}
        postMessage("ready");`;
      const w = new Worker(URL.createObjectURL(new Blob([src])));
      const got: string[] = [];
      const done = Promise.withResolvers<void>();
      w.onmessage = e => {
        if (e.data === "ready") {
          for (let i = 0; i < 3; i++) w.postMessage(i);
          return;
        }
        got.push(e.data);
        if (got.length === 3) done.resolve();
      };
      await done.promise;
      expect(got).toEqual(["pong 0", "pong 1", "pong 2"]);
      w.terminate();
    });

    // As in browsers and Node: not an error, the message is dropped.
    test("postMessage() to a terminated worker is a no-op", async () => {
      const w = new Worker("data:text/javascript,postMessage('up')");
      await new Promise(r => (w.onmessage = r));
      w.terminate();
      await once(w, "close");
      expect(() => w.postMessage("late")).not.toThrow();
    });

    // A data: URL is the module itself and never a path (no length limit).
    test("a long data: URL worker", async () => {
      const pad = "/*" + Buffer.alloc(4000, "x").toString() + "*/";
      const w = new Worker("data:text/javascript," + encodeURIComponent(pad + "postMessage('hi')"));
      const [msg] = await once(w, "message");
      expect(msg.data).toBe("hi");
      w.terminate();
    });

    // terminate() landing while the worker reports that its entry point does not
    // resolve: the report is skipped, not turned into a panic.
    test("terminate() while the entry point fails to resolve", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `let done = 0;
           async function one(i) {
             const w = new Worker("/nonexistent/path-" + i + ".js");
             const closed = new Promise(r => w.addEventListener("close", r));
             w.onerror = () => {};
             setTimeout(() => w.terminate(), i % 8);
             await closed;
             done++;
           }
           for (let r = 0; r < 12; r++) await Promise.all(Array.from({ length: 8 }, (_, i) => one(r * 8 + i)));
           console.log("done", done);`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toBe("done 96\n");
      expect(exitCode).toBe(0);
    });

    // A worker posting faster than the parent can deserialize must not pin the
    // parent inside one drain: its timers and I/O still get their turn.
    test("a message flood from a worker does not starve the parent's event loop", async () => {
      const src = `const p = { s: Buffer.alloc(200, "x").toString(), a: [1, 2, 3], n: 0 };
        (function burst() { for (let i = 0; i < 2000; i++) { p.n++; postMessage(p) } setImmediate(burst) })()`;
      const w = new Worker(URL.createObjectURL(new Blob([src])));
      let received = 0;
      const { promise: first, resolve: gotFirst } = Promise.withResolvers<void>();
      w.onmessage = () => {
        received++;
        gotFirst();
      };
      // Worker startup is slow under debug/ASAN: count timer turns only once the flood has begun.
      await first;
      const before = received;
      // Three timer turns while the flood is running is the property; not the timing.
      for (let i = 0; i < 3; i++) await new Promise<void>(r => setTimeout(r, 10));
      expect(received).toBeGreaterThan(before);
      w.terminate();
      await once(w, "close");
    });

    // node:vm's timeout machinery shares the VM's termination bit with
    // terminate(); a terminate() landing mid-script is not a vm timeout.
    test("terminate() while a node:vm script with a timeout is running", async () => {
      const src = `import vm from "node:vm"; postMessage("busy");
        for (;;) { try { vm.runInNewContext("for(let i=0;i<1e7;i++){}", {}, { timeout: 1000 }) } catch {} await new Promise(r => setImmediate(r)) }`;
      const url = URL.createObjectURL(new Blob([src]));
      for (let r = 0; r < 6; r++) {
        const w = new Worker(url);
        await new Promise(res => (w.onmessage = res));
        w.terminate();
        await once(w, "close");
      }
    });

    // terminate() mid `import "node:*"`: the native module's export walk stops
    // at the termination instead of clearing it and reading on.
    test("terminate() while importing every builtin module", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import { builtinModules } from "node:module";
           const L = builtinModules.filter(m => !m.startsWith("_") && !/^(bun|detect-libc|undici|ws)/.test(m));
           const src = "for (const b of " + JSON.stringify(L) + ") { try { await import('node:' + b) } catch {} } postMessage('done')";
           const url = URL.createObjectURL(new Blob([src]));
           for (let r = 0; r < 6; r++) await Promise.all(Array.from({ length: 4 }, (_, i) => new Promise(res => {
             const w = new Worker(url); w.addEventListener("close", res); w.onmessage = () => w.terminate();
             setTimeout(() => w.terminate(), (r * 4 + i) * 15) })));
           console.log("PASS");`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toBe("PASS\n");
      expect(exitCode).toBe(0);
    });

    // A preload's un-awaited import() finishing while the entry is still
    // fetching is not "the entry started evaluating": message delivery opens
    // only once the entry's own graph runs (and installs its handler).
    // Three transpiles of big.js take about 2s each under debug/ASAN.
    test(
      "preload with an un-awaited import() does not open message delivery before the entry runs",
      async () => {
        using dir = tempDir("worker-preload-dynamic-import", {
          "side.js": `globalThis.sideRan = true;`,
          "preload.js": `import("./side.js");`,
          // big enough that the entry graph is still transpiling when side.js evaluates
          "big.js": Array.from(
            { length: 4000 },
            (_, i) => `export function f${i}(x) { return x * ${i} + ${i % 7}; }`,
          ).join("\n"),
          "worker.js": `import "./big.js";
          const got = [];
          self.onmessage = e => { got.push(e.data); if (e.data === "last") postMessage(got); };`,
        });
        for (let i = 0; i < 3; i++) {
          const w = new Worker(path.join(String(dir), "worker.js"), {
            preload: [path.join(String(dir), "preload.js")],
          });
          w.postMessage("first");
          w.postMessage("second");
          w.postMessage("last");
          const [ev] = await once(w, "message");
          expect(ev.data).toEqual(["first", "second", "last"]);
          w.terminate();
        }
      },
      isDebug ? 30_000 : 5_000,
    );

    // Everything a worker posted before it exited arrives before 'close'.
    test("messages posted right before a natural exit are all delivered before close", async () => {
      const K = 5000;
      const src = `const p = Buffer.alloc(256, "x").toString(); for (let i = 0; i < ${K}; i++) postMessage({ i, p })`;
      const url = URL.createObjectURL(new Blob([src]));
      for (let r = 0; r < 3; r++) {
        let got = 0;
        const w = new Worker(url);
        w.onmessage = () => got++;
        await once(w, "close");
        expect(got).toBe(K);
      }
    });

    // process.exit() from inside nested node:vm contexts in a worker: the
    // termination unwinds through both frames like any exception.
    test("process.exit() from a nested node:vm context inside a worker", async () => {
      const src = `const vm = require("node:vm"); postMessage("in");
        vm.runInNewContext('run("exit(0)")', { run: s => vm.runInNewContext(s, { exit: process.exit.bind(process) }) })`;
      const w = new Worker(URL.createObjectURL(new Blob([src])));
      const [ev] = await once(w, "close");
      expect(ev.code).toBe(0);
    });

    // fs completions racing terminate(): whatever completes on the worker
    // after the request must release, not build script values under it.
    test("terminate() while fs.readFile completions keep arriving", async () => {
      using dir = tempDir("worker-readfile-churn", { "f.bin": Buffer.alloc(65536, 7) });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const src = \`import { readFile } from "node:fs";
             let n = 0; (function pump(){ while (n < 16) { n++; readFile(\${JSON.stringify(process.argv[1])}, () => { n--; setImmediate(pump) }) } })();
             postMessage("busy")\`;
           const url = URL.createObjectURL(new Blob([src]));
           for (let r = 0; r < 12; r++) await Promise.all(Array.from({ length: 4 }, (_, i) => new Promise(res => {
             const w = new Worker(url); w.addEventListener("close", res); w.onmessage = () => setTimeout(() => w.terminate(), (r + i) % 10) })));
           console.log("PASS");`,
          path.join(String(dir), "f.bin"),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toBe("PASS\n");
      expect(exitCode).toBe(0);
    });
  });
});

// TODO: move to node:worker_threads tests directory
describe("worker_threads", () => {
  test("worker with process.exit", done => {
    const worker = new wt.Worker(new URL("worker-fixture-process-exit.js", import.meta.url), {
      smol: true,
    } as wt.WorkerOptions);
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
    // As in Node: a worker stopped by terminate() reports 1 once its thread's environment
    // exists, 0 only if it was stopped before that. Which one depends on timing.
    for (let i = 0; i < 10; i++) {
      const worker = new wt.Worker(new URL("worker-fixture-hang.js", import.meta.url), {
        smol: true,
      } as wt.WorkerOptions);
      worker.on("error", expect.unreachable);
      const code = await worker.terminate();
      expect(code === 0 || code === 1, `unexpected exit code ${code}`).toBeTrue();
    }
  });

  test("worker with process.exit (delay) and terminate", async () => {
    const worker = new wt.Worker(new URL("worker-fixture-process-exit.js", import.meta.url), {
      smol: true,
    } as wt.WorkerOptions);
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
