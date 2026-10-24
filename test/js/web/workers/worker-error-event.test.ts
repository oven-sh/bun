import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// Not concurrent: on a debug build, 15 parents at once take up to 4.7 s each, and one at a time at most 1.7 s.
describe("Worker 'error' event", () => {
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
    test.each([
      ["a throw at evaluation", `throw new Error("WEB-WORKER-UNCAUGHT")`],
      ["a rejection at evaluation", `Promise.reject(new Error("WEB-WORKER-UNCAUGHT"))`],
      ["a throw in a timer", `setTimeout(() => { throw new Error("WEB-WORKER-UNCAUGHT") }, 1)`],
      [
        "a rejection in a timer",
        `setInterval(() => {}, 1000); setTimeout(() => { Promise.reject(new Error("WEB-WORKER-UNCAUGHT")) }, 1)`,
      ],
    ])("%s is printed by the parent, which exits 1", async (_, body) => {
      const { stderr, exitCode } = await runParent(`new Worker(${JSON.stringify(dataUrl(body))});`);
      expect(stderr.split("\n")[0]).toBe("error: Uncaught error in worker");
      expect(stderr).toContain("WEB-WORKER-UNCAUGHT");
      expect(exitCode).toBe(1);
    });

    test("an entry point that does not resolve is printed by the parent, which exits 1", async () => {
      const { stderr, exitCode } = await runParent(`new Worker("./no-such-entry.js", { name: "resizer" });`);
      expect(stderr.split("\n").slice(0, 2)).toEqual([
        `error: Uncaught error in worker "resizer"`,
        `BuildMessage: ModuleNotFound resolving "./no-such-entry.js" (entry point)`,
      ]);
      expect(exitCode).toBe(1);
    });

    test("the parent's process.on('uncaughtException') takes it", async () => {
      const { stdout, stderr, exitCode } = await runParent(
        `process.on("uncaughtException", (err, origin) => console.log(JSON.stringify({ origin, name: err.constructor.name, lines: err.message.split("\\n").filter(line => /^[A-Za-z]/.test(line)), stack: err.stack === "Error: " + err.message })));
         const worker = new Worker(${JSON.stringify(dataUrl(`throw new TypeError("WEB-WORKER-UNCAUGHT")`))});
         worker.addEventListener("close", event => console.log("worker closed", event.code));`,
      );
      expect(stderr).toBe("");
      expect(stdout.split("\n")).toEqual([
        JSON.stringify({
          origin: "uncaughtException",
          name: "Error",
          lines: ["Uncaught error in worker", "TypeError: WEB-WORKER-UNCAUGHT"],
          stack: true,
        }),
        "worker closed 1",
        "",
      ]);
      expect(exitCode).toBe(0);
    });

    // A worker whose own nested worker dies sees that as its own uncaught error, so the report
    // repeats one level up until something takes it or the main thread prints it.
    test("on a nested worker it is that worker's own uncaught error", async () => {
      using dir = tempDir("worker-nested-error", {
        "inner.js": `setTimeout(() => { throw new Error("WEB-WORKER-NESTED-UNCAUGHT") }, 1);`,
        "middle.js": `new Worker(new URL("inner.js", import.meta.url).href);`,
      });
      const run = (listen: boolean) =>
        runParent(
          `const worker = new Worker("./middle.js");
           ${listen ? `worker.addEventListener("error", event => console.log("main saw", event.message.includes("WEB-WORKER-NESTED-UNCAUGHT")));` : ""}
           worker.addEventListener("close", event => console.log("middle closed", event.code));`,
          String(dir),
        );
      const [nobody, main] = await Promise.all([run(false), run(true)]);
      expect(nobody.stderr.split("\n")[0]).toBe("error: Uncaught error in worker");
      expect(nobody.stderr).toContain("WEB-WORKER-NESTED-UNCAUGHT");
      expect(nobody.exitCode).toBe(1);
      expect(main).toEqual({ stdout: "main saw true\nmiddle closed 1\n", stderr: "", exitCode: 0 });
    });

    // A Worker belongs to the Bun.ModuleGraph whose code made it: its unobserved error is that
    // graph's uncaught error, not the host's.
    test("a worker made by a Bun.ModuleGraph reports to that graph's onError", async () => {
      using dir = tempDir("worker-error-module-graph", {
        "app.mjs": `export const start = name =>
          new Worker("data:text/javascript," + encodeURIComponent('setTimeout(() => { throw new Error("' + name + '") }, 1)'));`,
      });
      const app = JSON.stringify(path.join(String(dir), "app.mjs"));
      const result = await runParent(
        `const seen = [];
         const note = who => error =>
           seen.push(who + ": " + error.message.split("\\n").filter(line => /^(Uncaught error in worker|error: )/.test(line)).join(" / "));
         process.on("uncaughtException", note("host"));
         const graph = new Bun.ModuleGraph({ onError: (error, kind) => note("graph " + kind)(error) });
         const inGraph = await graph.import(${app});
         const inHost = await import(${app});
         const closed = worker => new Promise(resolve => worker.addEventListener("close", resolve));
         await Promise.all([
           closed(graph.run(() => inGraph.start("WORKER-OF-THE-GRAPH"))),
           closed(inHost.start("WORKER-OF-THE-HOST")),
         ]);
         console.log(JSON.stringify(seen.sort()));`,
      );
      expect(result).toEqual({
        stdout:
          JSON.stringify([
            "graph uncaughtException: Uncaught error in worker / error: WORKER-OF-THE-GRAPH",
            "host: Uncaught error in worker / error: WORKER-OF-THE-HOST",
          ]) + "\n",
        stderr: "",
        exitCode: 0,
      });
    });

    // node:worker_threads does not use this default: its 'error' goes to an EventEmitter, which
    // reports an 'error' with no listener itself.
    test("node:worker_threads still reports its own unobserved error, once", async () => {
      const { stdout, stderr, exitCode } = await runParent(
        `const { Worker } = require("node:worker_threads");
         new Worker('throw new Error("NODE-WORKER-UNCAUGHT")', { eval: true });`,
      );
      expect({
        stdout,
        reports: stderr.split("error: NODE-WORKER-UNCAUGHT").length - 1,
        webWorkerReport: stderr.includes("Uncaught error in worker"),
        exitCode,
      }).toEqual({ stdout: "", reports: 1, webWorkerReport: false, exitCode: 1 });
    });

    // The worker's 'exit' listener runs after its error was posted. The parent blocks until then with
    // no turn of its event loop, so the error is still queued when terminate() is called.
    test("an error still queued when terminate() is called is not reported", async () => {
      const worker = dataUrl(
        `import { workerData } from "node:worker_threads";
         process.on("exit", () => { Atomics.store(workerData, 0, 1); Atomics.notify(workerData, 0); });
         throw new Error("POST-TERMINATE");`,
      );
      const result = await runParent(
        `process.on("uncaughtException", err => console.log("reported", err.message));
         const posted = new Int32Array(new SharedArrayBuffer(4));
         const worker = new Worker(${JSON.stringify(worker)}, { workerData: posted });
         worker.addEventListener("close", () => console.log("closed"));
         const signal = Atomics.wait(posted, 0, 0, 4000);
         worker.terminate();
         console.log(signal === "timed-out" ? "the worker posted no error" : "terminated");`,
      );
      expect(result).toEqual({ stdout: "terminated\nclosed\n", stderr: "", exitCode: 0 });
    });

    // The first thread to read sub/ logs the warning of its tsconfig.json: here that is a worker.
    test.each([
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
  test("a registered listener takes it, whatever it does with the event", async () => {
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

  // A listener on the worker's own global scope was given the error. The Worker object still fires
  // 'error', but the parent does not report what the worker's own code saw.
  test("an error that a listener in the worker saw does not end a parent with no listener", async () => {
    const worker = (install: string) =>
      dataUrl(`${install} setTimeout(() => { throw new Error("WEB-WORKER-SEEN") }, 1);`);
    const scenarios = {
      "addEventListener": worker(`self.addEventListener("error", () => postMessage("seen"));`),
      "preventDefault()": worker(
        `self.addEventListener("error", event => { event.preventDefault(); postMessage("seen"); });`,
      ),
      "onerror": worker(`self.onerror = () => { postMessage("seen"); };`),
      "onerror returning true": worker(`self.onerror = () => { postMessage("seen"); return true; };`),
      "a passive listener": worker(`self.addEventListener("error", () => postMessage("seen"), { passive: true });`),
    };
    const each = (errors: number) =>
      Object.fromEntries(Object.keys(scenarios).map(name => [name, { messages: ["seen"], errors, close: 1 }]));
    const [unobserved, listening] = await Promise.all([observe(scenarios), observe(scenarios, countErrors)]);
    expect(unobserved).toEqual({ seen: each(0), stderr: "", exitCode: 0 });
    expect(listening).toEqual({ seen: each(1), stderr: "", exitCode: 0 });
  });

  test("under bun test, a worker's unobserved error fails the test that started it", async () => {
    using dir = tempDir("worker-error-bun-test", {
      "worker.mjs": `setTimeout(() => { throw new Error("WEB-WORKER-UNCAUGHT") }, 1);`,
      "worker.test.ts": `
        import { test, expect } from "bun:test";
        import { once } from "node:events";
        test("a worker runs", async () => {
          const [close] = await once(new Worker(new URL("./worker.mjs", import.meta.url)), "close");
          expect(close.code).toBe(1);
        });`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./worker.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const output = stdout + stderr;
    expect(output).toContain("error: Uncaught error in worker");
    expect(output).toContain("(fail) a worker runs");
    expect(exitCode).toBe(1);
  });
});
