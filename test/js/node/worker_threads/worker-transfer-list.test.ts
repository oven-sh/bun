import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { Worker } from "worker_threads";
import { echoAnswer, echoEntry, owned, transferable } from "./worker-transfer-list-fixture.ts";

// The transferList option is converted as a whole before workerData is serialized,
// so an entry that is not an object throws instead of being silently skipped while
// the remaining entries get detached.
test("an invalid transferList entry throws before anything is detached", async () => {
  const buf = new ArrayBuffer(8);
  let worker: Worker | undefined;
  try {
    expect(() => {
      worker = new Worker("", { eval: true, workerData: buf, transferList: [buf, null as any] });
    }).toThrow(TypeError);
    expect(buf.byteLength).toBe(8);
  } finally {
    await worker?.terminate();
  }
});

test("a valid transferList still detaches the transferred buffer", async () => {
  const buf = new ArrayBuffer(8);
  const worker = new Worker("", { eval: true, workerData: buf, transferList: [buf] });
  try {
    expect(buf.byteLength).toBe(0);
  } finally {
    await worker.terminate();
  }
});

// A `new Worker()` that throws leaves the transfer list with the caller. The rows that Node has
// too are in worker-transfer-list-node.test.ts.

type WorkerConstructor<W = { terminate(): unknown }> = new (filename: string, options?: any) => W;
// It takes workerData, transferList and execArgv as well; its declared options leave them out.
const GlobalWorker: WorkerConstructor<globalThis.Worker> = globalThis.Worker;
const execArgvOfTheProcess = { execArgv: ["--disallow-code-generation-from-strings"] };
const invalidExecArgv = expect.objectContaining({ code: "ERR_WORKER_INVALID_EXEC_ARGV" });
// The message of the error names it.
const invalidFileURL = "file://:!:!:!!!!";
// Not a file: a constructor that throws does not load its entry.
const neverLoaded = join(import.meta.dir, "never-loaded.js");

describe.each<[string, WorkerConstructor]>([
  ["node:worker_threads", Worker],
  ["the global Worker", GlobalWorker],
])("%s: a rejected preload leaves the transfer list with the caller", (_, WorkerCtor) => {
  test("a preload that is not a valid file URL", () => {
    const { options, stillOwned } = transferable();
    expect(() => new WorkerCtor(neverLoaded, { ...options(), preload: [invalidFileURL] })).toThrow(invalidFileURL);
    expect(stillOwned()).toEqual(owned);
  });

  test("a preload that is a revoked blob: URL", () => {
    const { options, stillOwned } = transferable();
    const url = URL.createObjectURL(new Blob([""]));
    URL.revokeObjectURL(url);
    expect(() => new WorkerCtor(neverLoaded, { ...options(), preload: [url] })).toThrow("Blob URL is missing");
    expect(stillOwned()).toEqual(owned);
  });
});

describe("the global Worker: a rejected option leaves the transfer list with the caller", () => {
  test("an entry that is not a valid file URL", () => {
    const { options, stillOwned } = transferable();
    expect(() => new GlobalWorker(invalidFileURL, options())).toThrow(invalidFileURL);
    expect(stillOwned()).toEqual(owned);
  });

  test("an execArgv flag that only the process takes, and the same list then starts a worker", async () => {
    using dir = tempDir("worker-transfer-list", { "entry.js": echoEntry });
    const entry = join(String(dir), "entry.js");
    const { buf, port1, options, stillOwned } = transferable();
    expect(() => new GlobalWorker(entry, { ...options(), ...execArgvOfTheProcess })).toThrow(invalidExecArgv);
    expect(stillOwned()).toEqual(owned);

    const worker = new GlobalWorker(entry, options());
    try {
      const answer = await new Promise((resolve, reject) => {
        port1.once("message", resolve);
        worker.addEventListener("error", event => reject(new Error(event.message)));
        worker.addEventListener("close", () => reject(new Error("the worker closed before it answered")));
      });
      expect({ answer, bytes: buf.byteLength }).toEqual({ answer: echoAnswer, bytes: 0 });
    } finally {
      worker.terminate();
      port1.close();
    }
  });

  test("an execArgv flag is reported before workerData is read", () => {
    let reads = 0;
    const workerData = {
      get uncloneable() {
        reads++;
        return () => {};
      },
    };
    expect(() => new GlobalWorker(neverLoaded, { workerData, ...execArgvOfTheProcess })).toThrow(invalidExecArgv);
    expect(reads).toBe(0);
  });

  test("a new.target whose prototype getter throws", () => {
    const { options, stillOwned } = transferable();
    const newTarget = function () {}.bind(null);
    Object.defineProperty(newTarget, "prototype", {
      get() {
        throw new Error("prototype getter");
      },
    });
    expect(() => Reflect.construct(GlobalWorker, [neverLoaded, options()], newTarget)).toThrow("prototype getter");
    expect(stillOwned()).toEqual(owned);
  });
});

// dispose() stops the graph's context in a task of the host's loop, and `expect().resolves` runs that
// loop in place. So the context of the Worker stops between its creation and its start.
test("a context stopped while workerData is serialized: the Worker starts nothing", () => {
  const graph = new Bun.ModuleGraph();
  const hostTurn = new Promise(resolve => setImmediate(resolve));
  let stopped = false;
  const worker = graph.run(
    () =>
      new GlobalWorker(neverLoaded, {
        workerData: {
          get stop() {
            graph.dispose();
            expect(hostTurn).resolves.toBeUndefined();
            stopped = true;
            return 1;
          },
        },
      }),
  );
  expect({ stopped, threadId: worker.threadId }).toEqual({ stopped: true, threadId: -1 });
});

describe.concurrent("in a process of its own", () => {
  async function run(script: string, entry = neverLoaded) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script, entry],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  // Founding an env tree swaps process.env for a shared view, and that cannot be undone.
  test("env: SHARE_ENV does not swap process.env when execArgv is rejected", async () => {
    const result = await run(`
      const { Worker: ThreadWorker, SHARE_ENV } = require("node:worker_threads");
      const before = process.env;
      const kept = {};
      for (const [kind, WorkerCtor] of [["node:worker_threads", ThreadWorker], ["the global Worker", Worker]]) {
        try {
          new WorkerCtor(process.argv.at(-1), { env: SHARE_ENV, execArgv: ["--disallow-code-generation-from-strings"] });
          kept[kind] = "did not throw";
        } catch {
          kept[kind] = process.env === before;
        }
      }
      console.log(JSON.stringify(kept));
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({ "node:worker_threads": true, "the global Worker": true }),
      stderr: "",
      exitCode: 0,
    });
  });

  // Without the fix this passes too: workerData was serialized before there was a Worker to release.
  test("a constructor that throws while it serializes workerData leaves no Worker, no 'worker' event and no open handle", async () => {
    const result = await run(`
      const { Worker: ThreadWorker } = require("node:worker_threads");
      const { heapStats } = require("bun:jsc");
      let events = 0;
      process.on("worker", () => events++);
      const uncloneable = () => ({ workerData: () => {} });
      const throwing = () => ({ workerData: { get thrower() { throw new Error("workerData getter"); } } });
      const thrown = new Set();
      for (let i = 0; i < 25; i++) {
        for (const WorkerCtor of [ThreadWorker, Worker]) {
          for (const options of [uncloneable, throwing]) {
            try {
              new WorkerCtor(process.argv.at(-1), options());
              thrown.add("did not throw");
            } catch (e) {
              thrown.add(e.name + ": " + e.message);
            }
          }
        }
      }
      setImmediate(() => {
        Bun.gc(true);
        const workers = heapStats().objectTypeCounts.Worker ?? 0;
        const collected = workers < 10 ? "yes" : workers + " of 100 remain";
        console.log(JSON.stringify({ thrown: [...thrown], events, collected }));
      });
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({
        thrown: ["DataCloneError: The object can not be cloned.", "Error: workerData getter"],
        events: 0,
        collected: "yes",
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  test("a constructor that throws after it created the Worker starts no thread", async () => {
    using dir = tempDir("worker-transfer-list", {
      "entry.js": `require("node:fs").writeSync(1, "the entry ran\\n");`,
    });
    const result = await run(
      `
      const newTarget = function () {}.bind(null);
      Object.defineProperty(newTarget, "prototype", { get() { throw new Error("prototype getter"); } });
      try {
        Reflect.construct(Worker, [process.argv.at(-1)], newTarget);
        console.log("did not throw");
      } catch (e) {
        console.log(e.message);
      }
    `,
      join(String(dir), "entry.js"),
    );
    expect(result).toEqual({ stdout: "prototype getter", stderr: "", exitCode: 0 });
  });
});
