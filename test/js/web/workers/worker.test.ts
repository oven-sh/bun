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

  describe("self.close()", () => {
    function workerFromSource(src: string) {
      return new Worker("data:text/javascript," + encodeURIComponent(src));
    }

    // Resolves with every message the worker posts, in order, once its "close" event fires.
    async function messagesUntilClose(worker: Worker): Promise<{ messages: any[]; code: number }> {
      const messages: any[] = [];
      worker.addEventListener("message", e => messages.push(e.data));
      const errored = new Promise<never>((_, reject) => (worker.onerror = e => reject(new Error(e.message))));
      const [close] = await Promise.race([once(worker, "close"), errored]);
      return { messages, code: close.code };
    }

    test("is a function on the worker global", async () => {
      const worker = workerFromSource(
        `postMessage({ hasClose: "close" in self, type: typeof self.close, sameAsGlobal: self.close === globalThis.close });`,
      );
      const [{ data }] = await once(worker, "message");
      worker.terminate();
      expect(data).toEqual({ hasClose: true, type: "function", sameAsGlobal: true });
    });

    test("the calling script finishes its task, queued work is discarded, and the close code is 0", async () => {
      const { messages, code } = await messagesUntilClose(
        workerFromSource(`
          const seen = [];
          const ac = new AbortController();
          ac.signal.addEventListener("abort", () => seen.push("abort"));
          setTimeout(() => postMessage("timer"), 0);
          setImmediate(() => postMessage("immediate"));
          queueMicrotask(() => {
            seen.push("microtask");
            postMessage(seen);
          });
          self.close();
          ac.abort();
          seen.push("sync");
          postMessage("after close");
        `),
      );
      expect(messages).toEqual(["after close", ["abort", "sync", "microtask"]]);
      expect(code).toBe(0);
    });

    test("runs the process 'exit' handlers of the worker", async () => {
      const { messages, code } = await messagesUntilClose(
        workerFromSource(`
          process.on("exit", code => postMessage("exit:" + code));
          self.close();
        `),
      );
      expect(messages).toEqual(["exit:0"]);
      expect(code).toBe(0);
    });

    test("from a timer callback, a later timer does not fire", async () => {
      const { messages, code } = await messagesUntilClose(
        workerFromSource(`
          setTimeout(() => { postMessage("first"); self.close(); }, 0);
          setTimeout(() => postMessage("second"), 0);
        `),
      );
      expect(messages).toEqual(["first"]);
      expect(code).toBe(0);
    });

    test("during a pending top-level await with a live handle, the worker exits with code 0", async () => {
      const { messages, code } = await messagesUntilClose(
        workerFromSource(`
          setInterval(() => postMessage("tick"), 1e6);
          self.close();
          postMessage("closing");
          await new Promise(() => {});
        `),
      );
      expect(messages).toEqual(["closing"]);
      expect(code).toBe(0);
    });

    test("terminate() still interrupts a script that keeps running after close()", async () => {
      const worker = workerFromSource(`self.close(); postMessage("closing"); while (true) {}`);
      const [{ data }] = await once(worker, "message");
      expect(data).toBe("closing");
      worker.terminate();
      // The close code is terminate()'s: the worker never reached the checkpoint that consumes close().
      const [close] = await once(worker, "close");
      expect(close.code).toBe(1);
    });

    // The worker chose to exit: the entry's unsettled top-level await is not the exit code 13.
    for (const exit of ["self.close()", "process.exit(0)"]) {
      test(`${exit} from a 'beforeExit' listener with the entry still pending gives close code 0, not 13`, async () => {
        const { messages, code } = await messagesUntilClose(
          workerFromSource(`
            process.on("exit", code => postMessage("exit:" + code));
            process.on("beforeExit", () => ${exit});
            await new Promise(() => {});
          `),
        );
        expect(messages).toEqual(["exit:0"]);
        expect(code).toBe(0);
      });
    }

    // The two tests below run in a child process: the test runner takes a worker's uncaught
    // errors itself, so its process listeners do not run and its exit code stays 0.
    const childProcessPrelude = `
      const run = (src, post) =>
        new Promise(resolve => {
          const events = [];
          const worker = new Worker("data:text/javascript," + encodeURIComponent(src));
          worker.addEventListener("message", e => events.push(e.data));
          // The message is the formatted error: a code frame, an "error: <message>" line, the stack.
          worker.onerror = e => {
            e.preventDefault();
            events.push(e.message.split("\\n").find(line => line.startsWith("error: ")) ?? e.message);
          };
          worker.addEventListener("close", e => resolve({ events, code: e.code }));
          if (post) worker.postMessage("go");
        });
    `;
    async function runInChildProcess(script: string) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", childProcessPrelude + script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      return { result: JSON.parse(stdout), exitCode };
    }

    test("what the closing task leaves uncaught is reported before the 'exit' listeners run", async () => {
      const { result, exitCode } = await runInChildProcess(`
        const onExit = 'process.on("exit", code => postMessage("exit:" + code));';
        console.log(
          JSON.stringify({
            entryThrows: await run(onExit + 'self.close(); throw new Error("boom");'),
            handlerRejects: await run('self.onmessage = async () => { self.close(); throw new Error("boom"); };', true),
            exitListenerSetsCode: await run(
              'process.on("exit", () => { process.exitCode = 5; }); self.close(); throw new Error("boom");',
            ),
          }),
        );
      `);
      expect(result).toEqual({
        entryThrows: { events: ["error: boom", "exit:1"], code: 1 },
        handlerRejects: { events: ["error: boom"], code: 1 },
        // As without close(): the code an 'exit' listener sets is the close code.
        exitListenerSetsCode: { events: ["error: boom"], code: 5 },
      });
      expect(exitCode).toBe(0);
    });

    // No checkpoint follows an 'unhandledRejection' listener, so the worker loop carries its close() out.
    test("from an 'unhandledRejection' listener, no later task runs", async () => {
      const { result, exitCode } = await runInChildProcess(`
        console.log(
          JSON.stringify(
            await run(\`
              process.on("unhandledRejection", () => {
                postMessage("rejection");
                setImmediate(() => postMessage("an immediate ran after close()"));
                self.close();
                queueMicrotask(() => postMessage("microtask of the listener"));
              });
              self.onmessage = () => {};
              Promise.reject(new Error("boom"));
            \`),
          ),
        );
      `);
      expect(result).toEqual({ events: ["rejection", "microtask of the listener"], code: 0 });
      expect(exitCode).toBe(0);
    });

    test("a checkpoint beneath the calling script does not end its task", async () => {
      const { messages, code } = await messagesUntilClose(
        workerFromSource(`
          queueMicrotask(() => postMessage("microtask"));
          self.close();
          require("bun:jsc").drainMicrotasks();
          postMessage("after the nested checkpoint");
        `),
      );
      expect(messages).toEqual(["microtask", "after the nested checkpoint"]);
      expect(code).toBe(0);
    });

    test("a synchronous wait beneath the calling script does not end its task", async () => {
      const { messages, code } = await messagesUntilClose(
        workerFromSource(`
          self.close();
          const rewriter = new HTMLRewriter().on("p", {
            async element(el) {
              await null;
              el.setInnerContent("rewritten");
            },
          });
          postMessage(rewriter.transform("<p>original</p>"));
        `),
      );
      expect(messages).toEqual(["<p>rewritten</p>"]);
      expect(code).toBe(0);
    });

    for (const kind of ["Web", "node:worker_threads"] as const) {
      test(`closing a ${kind} MessagePort from its own handler after close() does not cut the handler`, async () => {
        const channel = kind === "Web" ? "new MessageChannel()" : `new (require("node:worker_threads").MessageChannel)()`;
        const listen = kind === "Web" ? "port1.onmessage = e => handle(e.data)" : `port1.on("message", handle)`;
        const { messages, code } = await messagesUntilClose(
          workerFromSource(`
            const { port1, port2 } = ${channel};
            const handle = n => {
              postMessage("message " + n);
              if (n === 0) {
                self.close();
                port1.close();
                postMessage("after port1.close()");
              }
            };
            ${listen};
            for (let i = 0; i < 3; i++) port2.postMessage(i);
          `),
        );
        // port.close() inside a dispatch first delivers what that port had queued. Then the handler runs on.
        expect(messages).toEqual(["message 0", "message 1", "message 2", "after port1.close()"]);
        expect(code).toBe(0);
      });
    }

    for (const when of ["synchronously", "from a microtask"] as const) {
      test(`from a message handler ${when}, the rest of the batch is dropped`, async () => {
        const call = when === "synchronously" ? "self.close()" : "queueMicrotask(() => self.close())";
        const worker = workerFromSource(`self.onmessage = e => { postMessage(e.data); if (e.data === 0) ${call}; };`);
        const errored = new Promise<never>((_, reject) => (worker.onerror = e => reject(new Error(e.message))));
        await Promise.race([once(worker, "open"), errored]);
        for (let i = 0; i < 5; i++) worker.postMessage(i);
        const { messages, code } = await messagesUntilClose(worker);
        expect(messages).toEqual([0]);
        expect(code).toBe(0);
      });
    }

    test("from a MessagePort handler, the rest of that port's batch is dropped", async () => {
      const worker = workerFromSource(`
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = e => { postMessage(e.data); if (e.data === 0) self.close(); };
        self.onmessage = () => { for (let i = 0; i < 5; i++) port2.postMessage(i); };
      `);
      const errored = new Promise<never>((_, reject) => (worker.onerror = e => reject(new Error(e.message))));
      await Promise.race([once(worker, "open"), errored]);
      worker.postMessage("go");
      const { messages, code } = await messagesUntilClose(worker);
      expect(messages).toEqual([0]);
      expect(code).toBe(0);
    });

    // Several datagrams read in one poll reach the handler one after another inside one
    // native callback, with no task boundary between them.
    test("from a datagram handler, the rest of the read batch is dropped", async () => {
      const worker = workerFromSource(`
        const sock = await Bun.udpSocket({
          hostname: "127.0.0.1",
          port: 0,
          socket: {
            data(_socket, buf) {
              const text = buf.toString();
              postMessage(text);
              if (text === "0") self.close();
            },
          },
        });
        postMessage({ port: sock.port });
      `);
      const messages: any[] = [];
      worker.addEventListener("message", e => messages.push(e.data));
      const errored = new Promise<never>((_, reject) => (worker.onerror = e => reject(new Error(e.message))));
      const { promise: ready, resolve } = Promise.withResolvers<number>();
      worker.addEventListener("message", e => e.data?.port && resolve(e.data.port));
      const port = await Promise.race([ready, errored]);
      using sender = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
      for (let i = 0; i < 5; i++) sender.send(String(i), port, "127.0.0.1");
      const [close] = await Promise.race([once(worker, "close"), errored]);
      expect(messages).toEqual([{ port }, "0"]);
      expect(close.code).toBe(0);
    });

    test("is not defined on the main-thread global", () => {
      expect("close" in globalThis).toBe(false);
    });

    test("is not defined in a node:worker_threads worker", async () => {
      const worker = new wt.Worker(`require("worker_threads").parentPort.postMessage("close" in globalThis)`, {
        eval: true,
      });
      const [hasClose] = await once(worker, "message");
      await worker.terminate();
      expect(hasClose).toBe(false);
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
    // As in Node: a worker stopped by terminate() reports 1 once its thread's environment
    // exists, 0 only if it was stopped before that. Which one depends on timing.
    for (let i = 0; i < 10; i++) {
      const worker = new wt.Worker(new URL("worker-fixture-hang.js", import.meta.url), {
        smol: true,
      });
      worker.on("error", expect.unreachable);
      const code = await worker.terminate();
      expect(code === 0 || code === 1, `unexpected exit code ${code}`).toBeTrue();
    }
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
